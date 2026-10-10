/**
 * Two-way, three-way-merge sync engine (#10). Electron-free.
 *
 * Remote layout (Drive appDataFolder, nothing else):
 *   manifest.json            — key → { fileId, hash, size, modifiedTime, device } (or a tombstone)
 *   item-<sha256(key)[:32]>  — one file per item, named by a hash so no remote
 *                              name ever becomes a local path
 *
 * Local state (<userData>/sync-state.json, mode 0600, no secrets): per-item
 * base { local hash, remote hash } at the last successful sync, device label,
 * options, last result/error and the open conflicts.
 *
 * Decisions come from shared/sync/decide.ts. Conflicts never overwrite either
 * side; the user resolves them, and the replaced version is first copied to
 * <workspace>/sync-conflicts/. Deletions are never propagated automatically.
 */
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { decide, type BaseRecord } from '../../shared/sync/decide';
import {
  DEFAULT_CATEGORIES, MAX_ITEM_BYTES, MAX_TOTAL_BYTES, SYNC_CATEGORIES, parseItemKey, sanitizeDeviceLabel,
  type CategoryToggles, type ItemCategory
} from '../../shared/sync/items';
import { MANIFEST_NAME, MAX_MANIFEST_BYTES, emptyManifest, parseManifest, type DeviceInfo, type Manifest, type ManifestEntry } from '../../shared/sync/manifest';
import { diffSummary, snippet } from '../../shared/sync/preview';
import type { ConflictView, SyncErrorCode, SyncResultCounts } from '../../shared/sync/status';
import type { DriveClient, DriveFile } from './driveClient';
import { SyncError, toSyncError } from './errors';
import type { LocalAdapter, LocalItem } from './localAdapter';
import { changeHash, decryptWithPassphrase, encryptWithPassphrase, hmacKeyFor } from './secretBox';

export interface ConflictRecord {
  view: ConflictView;
  localHash: string | null;
  remoteHash: string | null;
}

export interface SyncState {
  v: 1;
  deviceId: string;
  deviceLabel: string | null;
  autoSync: boolean;
  apiKeySync: boolean;
  categories: CategoryToggles;
  base: Record<string, BaseRecord>;
  localSeen: Record<string, { hash: string | null; at: number }>;
  lastSyncAt: number | null;
  lastError: { code: SyncErrorCode; at: number } | null;
  lastResult: SyncResultCounts | null;
  conflicts: ConflictRecord[];
}

/** Errors that stop the whole run (the network/account is the problem, not one item). */
const FATAL: ReadonlySet<SyncErrorCode> = new Set<SyncErrorCode>([
  'authExpired', 'notLoggedIn', 'noCredentials', 'network', 'apiDisabled', 'forbidden', 'quota',
  'rateLimit', 'server', 'scopeDenied'
]);

export function itemFileName(key: string): string {
  return `item-${createHash('sha256').update(key, 'utf8').digest('hex').slice(0, 32)}`;
}

const sha256 = (b: Buffer): string => createHash('sha256').update(b).digest('hex');

export interface EngineDeps {
  statePath: string;
  hostName: string;
  local: LocalAdapter;
  drive: () => DriveClient;
  now?: () => number;
}

export function defaultState(): SyncState {
  return {
    v: 1, deviceId: randomUUID(), deviceLabel: null, autoSync: false, apiKeySync: false,
    categories: { ...DEFAULT_CATEGORIES }, base: {}, localSeen: {}, lastSyncAt: null, lastError: null,
    lastResult: null, conflicts: []
  };
}

export function loadState(path: string): SyncState {
  const d = defaultState();
  if (!existsSync(path)) return d;
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    if (!raw || raw.v !== 1) return d;
    const categories = { ...DEFAULT_CATEGORIES };
    for (const c of SYNC_CATEGORIES) if (typeof raw.categories?.[c] === 'boolean') categories[c] = raw.categories[c];
    return {
      ...d,
      deviceId: typeof raw.deviceId === 'string' ? raw.deviceId : d.deviceId,
      deviceLabel: sanitizeDeviceLabel(raw.deviceLabel),
      autoSync: raw.autoSync === true,
      apiKeySync: raw.apiKeySync === true,
      categories,
      base: raw.base && typeof raw.base === 'object' ? raw.base : {},
      localSeen: raw.localSeen && typeof raw.localSeen === 'object' ? raw.localSeen : {},
      lastSyncAt: typeof raw.lastSyncAt === 'number' ? raw.lastSyncAt : null,
      lastError: raw.lastError && typeof raw.lastError.code === 'string' ? raw.lastError : null,
      lastResult: raw.lastResult ?? null,
      conflicts: Array.isArray(raw.conflicts) ? raw.conflicts : []
    };
  } catch {
    return d;
  }
}

export function saveState(path: string, st: SyncState): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${Math.random().toString(36).slice(2, 10)}`;
  writeFileSync(tmp, JSON.stringify(st, null, 2), { encoding: 'utf8', mode: 0o600 });
  renameSync(tmp, path);
}

interface Remote {
  files: DriveFile[];
  manifestId: string | null;
  manifest: Manifest;
  byName: Map<string, string>;
}

export interface SyncOptions {
  /** Only for the opt-in API-key item; never stored. */
  passphrase?: string;
}

export function createSyncEngine(deps: EngineDeps) {
  const now = deps.now ?? Date.now;
  let running: Promise<unknown> | null = null;

  const device = (st: SyncState): DeviceInfo => ({ label: st.deviceLabel ?? deps.hostName, host: deps.hostName });

  async function fetchRemote(drive: DriveClient): Promise<Remote> {
    const files = await drive.list();
    const manifests = files.filter((f) => f.name === MANIFEST_NAME);
    // Two devices racing on the very first sync can create two manifests; use the newest.
    manifests.sort((a, b) => (b.modifiedTime ?? '').localeCompare(a.modifiedTime ?? '') || a.id.localeCompare(b.id));
    const byName = new Map<string, string>();
    for (const f of files) if (f.name.startsWith('item-') && !byName.has(f.name)) byName.set(f.name, f.id);
    if (manifests.length === 0) return { files, manifestId: null, manifest: emptyManifest(), byName };
    const buf = await drive.download(manifests[0].id, MAX_MANIFEST_BYTES);
    let raw: unknown;
    try { raw = JSON.parse(buf.toString('utf8')); } catch { throw new SyncError('badRemote'); }
    const parsed = parseManifest(raw);
    if (!parsed) throw new SyncError('badRemote');
    return { files, manifestId: manifests[0].id, manifest: parsed.manifest, byName };
  }

  async function writeManifest(drive: DriveClient, remote: Remote, changes: Map<string, ManifestEntry>): Promise<void> {
    if (changes.size === 0) return;
    // Re-read right before writing, so entries another device wrote meanwhile
    // (for keys we did not touch) are kept. Narrows, but cannot close, the race.
    let latest = remote.manifest;
    if (remote.manifestId) {
      try {
        const buf = await drive.download(remote.manifestId, MAX_MANIFEST_BYTES);
        latest = parseManifest(JSON.parse(buf.toString('utf8')))?.manifest ?? remote.manifest;
      } catch (e) {
        if (e instanceof SyncError && FATAL.has(e.code)) throw e;
      }
    }
    const next: Manifest = { ...latest, updatedAt: now(), items: { ...latest.items } };
    for (const [k, v] of changes) next.items[k] = v;
    const body = Buffer.from(JSON.stringify(next), 'utf8');
    if (remote.manifestId) await drive.update(remote.manifestId, body, 'application/json');
    else remote.manifestId = (await drive.create(MANIFEST_NAME, body, 'application/json')).id;
    remote.manifest = next;
  }

  /** Download one item's content and verify it against the manifest. Returns PLAINTEXT. */
  async function download(drive: DriveClient, key: string, e: ManifestEntry, hmacKey: Buffer | null, pass?: string): Promise<{ plain: Buffer; raw: Buffer }> {
    if (!e.fileId || e.size > MAX_ITEM_BYTES * 2) throw new SyncError('tooLarge');
    const raw = await drive.download(e.fileId, MAX_ITEM_BYTES * 2);
    if (key === 'apikeys') {
      if (!hmacKey || !pass) throw new SyncError('passphraseRequired');
      const plain = decryptWithPassphrase(raw, pass);
      if (changeHash(hmacKey, plain) !== e.hash) throw new SyncError('badRemote');
      return { plain, raw };
    }
    if (raw.length > MAX_ITEM_BYTES) throw new SyncError('tooLarge');
    if (sha256(raw) !== e.hash) throw new SyncError('badRemote');
    return { plain: raw, raw };
  }

  async function upload(drive: DriveClient, remote: Remote, key: string, payload: Buffer): Promise<string> {
    const existing = remote.manifest.items[key]?.fileId ?? remote.byName.get(itemFileName(key));
    if (existing) {
      try { return (await drive.update(existing, payload)).id; } catch (e) {
        if (!(e instanceof SyncError && e.code === 'notFound')) throw e;
      }
    }
    const f = await drive.create(itemFileName(key), payload);
    remote.byName.set(itemFileName(key), f.id);
    return f.id;
  }

  function hashLocal(key: string, it: LocalItem | null | undefined, hmacKey: Buffer | null): string | null {
    if (!it) return null;
    return key === 'apikeys' ? changeHash(hmacKey!, it.content) : sha256(it.content);
  }

  function apiKeysItem(st: SyncState): LocalItem | null {
    const plain = deps.local.apiKeysPlain();
    return plain ? { key: 'apikeys', category: 'apikeys', content: plain, mtime: st.localSeen.apikeys?.at ?? null } : null;
  }

  function idsPreview(plain: Buffer | null): string {
    if (!plain) return '';
    try {
      const ids = Object.keys((JSON.parse(plain.toString('utf8')) as { keys?: Record<string, string> }).keys ?? {});
      return ids.join(', ');
    } catch { return ''; }
  }

  function textOf(b: Buffer | null): string | null {
    return b ? b.toString('utf8') : null;
  }

  async function buildConflict(drive: DriveClient, st: SyncState, key: string, kind: ConflictRecord['view']['kind'],
    li: LocalItem | null, L: string | null, re: ManifestEntry | undefined, R: string | null,
    hmacKey: Buffer | null, pass?: string): Promise<ConflictRecord> {
    let remotePlain: Buffer | null = null;
    if (re && !re.deleted) {
      try { remotePlain = (await download(drive, key, re, hmacKey, pass)).plain; } catch (e) {
        if (e instanceof SyncError && FATAL.has(e.code)) throw e;
      }
    }
    const category = (parseItemKey(key)?.category ?? 'settings') as ItemCategory;
    const isKeys = key === 'apikeys';
    const lt = isKeys ? idsPreview(li?.content ?? null) : textOf(li?.content ?? null);
    const rt = isKeys ? idsPreview(remotePlain) : textOf(remotePlain);
    const view: ConflictView = {
      key, category, kind,
      local: {
        exists: !!li, deviceLabel: device(st).label, deviceHost: deps.hostName,
        modifiedTime: li ? (li.mtime ?? st.localSeen[key]?.at ?? null) : null,
        preview: snippet(lt)
      },
      remote: {
        exists: !!re && !re.deleted, deviceLabel: re?.device.label ?? '', deviceHost: re?.device.host ?? '',
        modifiedTime: re?.modifiedTime ?? null,
        preview: snippet(rt)
      },
      summary: diffSummary(lt, rt),
      detectedAt: now()
    };
    return { view, localHash: L, remoteHash: R };
  }

  async function runSync(opts: SyncOptions): Promise<SyncResultCounts> {
    const st = loadState(deps.statePath);
    const drive = deps.drive();
    const useKeys = st.apiKeySync && !!opts.passphrase;
    const hmacKey = useKeys ? hmacKeyFor(opts.passphrase!) : null;
    const counts: SyncResultCounts = { uploaded: 0, downloaded: 0, conflicts: 0, skipped: 0, unchanged: 0 };
    let itemError: SyncErrorCode | null = null;

    try {
      const remote = await fetchRemote(drive);
      const snap = deps.local.snapshot(st.categories);
      if (useKeys) {
        const k = apiKeysItem(st);
        if (k) snap.items.set('apikeys', k);
      }
      // Verify the passphrase against the remote copy BEFORE the API-key item takes
      // part: a wrong passphrase must never look like "local changed" and upload
      // keys re-encrypted under it.
      let keysOk = useKeys;
      const reKeys = remote.manifest.items.apikeys;
      if (useKeys && reKeys && !reKeys.deleted) {
        try { await download(drive, 'apikeys', reKeys, hmacKey, opts.passphrase); } catch (e) {
          const se = toSyncError(e);
          if (FATAL.has(se.code)) throw se;
          keysOk = false;
          snap.items.delete('apikeys');
          itemError = se.code === 'badRemote' ? 'badRemote' : 'wrongPassphrase';
        }
      }
      const inScope = (key: string): boolean => {
        const p = parseItemKey(key);
        if (!p) return false;
        if (p.category === 'apikeys') return keysOk;
        return st.categories[p.category];
      };
      const keys = new Set<string>();
      for (const k of snap.items.keys()) keys.add(k);
      for (const k of Object.keys(remote.manifest.items)) if (inScope(k)) keys.add(k);
      for (const k of Object.keys(st.base)) if (inScope(k)) keys.add(k);

      const changes = new Map<string, ManifestEntry>();
      const uploadBase = new Map<string, BaseRecord>();
      const otherBase = new Map<string, BaseRecord | null>();
      const conflicts: ConflictRecord[] = [];
      const dev = device(st);
      let bytes = 0;

      const processed = new Set<string>();
      let fatal: SyncError | null = null;
      for (const key of [...keys].sort()) {
        if (snap.skipped.has(key)) { counts.skipped++; continue; }
        processed.add(key);
        try {
          const li = snap.items.get(key) ?? null;
          const L = hashLocal(key, li, hmacKey);
          if (li && st.localSeen[key]?.hash !== L) st.localSeen[key] = { hash: L, at: li.mtime ?? now() };
          const re = remote.manifest.items[key];
          const R = re && !re.deleted ? re.hash : null;
          const d = decide({ local: L, remote: R, remoteDeleted: re?.deleted === true, base: st.base[key] });
          switch (d.action) {
            case 'noop':
              if (L === null && R === null) otherBase.set(key, null);
              counts.unchanged++;
              break;
            case 'in-sync':
              otherBase.set(key, { local: L, remote: R });
              counts.unchanged++;
              break;
            case 'upload': {
              const payload = key === 'apikeys' ? encryptWithPassphrase(li!.content, opts.passphrase!) : li!.content;
              if (payload.length > MAX_ITEM_BYTES * 2 || (bytes += payload.length) > MAX_TOTAL_BYTES) { counts.skipped++; itemError ??= 'tooLarge'; break; }
              const fileId = await upload(drive, remote, key, payload);
              changes.set(key, { fileId, hash: L, size: payload.length, modifiedTime: li!.mtime ?? st.localSeen[key]?.at ?? now(), device: dev });
              uploadBase.set(key, { local: L, remote: L });
              counts.uploaded++;
              break;
            }
            case 'download': {
              if (!deps.local.canWrite(key)) { counts.skipped++; break; }
              if ((bytes += re!.size) > MAX_TOTAL_BYTES) { counts.skipped++; itemError ??= 'tooLarge'; break; }
              const { plain } = await download(drive, key, re!, hmacKey, opts.passphrase);
              deps.local.write(key, plain);
              const after = key === 'apikeys' ? apiKeysItem(st) : deps.local.read(key);
              const L2 = hashLocal(key, after, hmacKey);
              st.localSeen[key] = { hash: L2, at: now() };
              otherBase.set(key, { local: L2, remote: R });
              counts.downloaded++;
              break;
            }
            case 'conflict':
              conflicts.push(await buildConflict(drive, st, key, d.kind, li, L, re, R, hmacKey, opts.passphrase));
              counts.conflicts++;
              break;
          }
        } catch (e) {
          const se = toSyncError(e);
          if (FATAL.has(se.code)) { fatal = se; break; }
          itemError ??= se.code;
          counts.skipped++;
        }
      }

      // Flush the manifest for completed uploads even after a fatal error, so the
      // uploaded files are not orphaned (best effort when already failing).
      let manifestOk = false;
      try { await writeManifest(drive, remote, changes); manifestOk = true; } catch (e) { fatal ??= toSyncError(e); }
      for (const [k, b] of otherBase) { if (b) st.base[k] = b; else delete st.base[k]; }
      if (manifestOk) for (const [k, b] of uploadBase) st.base[k] = b;
      // Replace conflicts only for keys examined in this run.
      st.conflicts = [...st.conflicts.filter((c) => !processed.has(c.view.key)), ...conflicts];
      if (fatal) {
        st.lastError = { code: fatal.code, at: now() };
        saveState(deps.statePath, st);
        throw fatal;
      }
      st.lastSyncAt = now();
      st.lastResult = counts;
      st.lastError = itemError ? { code: itemError, at: now() } : null;
      saveState(deps.statePath, st);
      return counts;
    } catch (e) {
      const se = toSyncError(e);
      const s2 = loadState(deps.statePath);
      s2.lastError = { code: se.code, at: now() };
      saveState(deps.statePath, s2);
      throw se;
    }
  }

  async function runResolve(key: string, choice: 'local' | 'remote', opts: SyncOptions): Promise<void> {
    const st = loadState(deps.statePath);
    const rec = st.conflicts.find((c) => c.view.key === key);
    if (!rec || (choice !== 'local' && choice !== 'remote')) throw new SyncError('invalidInput');
    const drive = deps.drive();
    const isKeys = key === 'apikeys';
    if (isKeys && !opts.passphrase) throw new SyncError('passphraseRequired');
    const hmacKey = isKeys ? hmacKeyFor(opts.passphrase!) : null;
    const remote = await fetchRemote(drive);
    const li = isKeys ? apiKeysItem(st) : deps.local.read(key);
    const L = hashLocal(key, li, hmacKey);
    const re = remote.manifest.items[key];
    const R = re && !re.deleted ? re.hash : null;
    if (L !== rec.localHash || R !== rec.remoteHash) {
      // Something changed since the chooser was shown; make the user look again.
      throw new SyncError('conflictChanged');
    }
    const dev = device(st);
    const changes = new Map<string, ManifestEntry>();
    if (choice === 'local') {
      if (re && !re.deleted) {
        const { plain, raw } = await download(drive, key, re, hmacKey, opts.passphrase);
        deps.local.backup(key, isKeys ? raw : plain, re.device.label || re.device.host, now());
      }
      if (li) {
        const payload = isKeys ? encryptWithPassphrase(li.content, opts.passphrase!) : li.content;
        const fileId = await upload(drive, remote, key, payload);
        changes.set(key, { fileId, hash: L, size: payload.length, modifiedTime: li.mtime ?? now(), device: dev });
      } else {
        // The user explicitly chose the deletion: tombstone + remove the remote copy.
        changes.set(key, { hash: null, size: 0, modifiedTime: now(), device: dev, deleted: true });
        if (re?.fileId) await drive.remove(re.fileId);
      }
      await writeManifest(drive, remote, changes);
      st.base[key] = { local: L, remote: L };
    } else {
      let L2: string | null = null;
      if (li) deps.local.backup(key, isKeys ? encryptWithPassphrase(li.content, opts.passphrase!) : li.content, dev.label, now());
      if (re && !re.deleted) {
        if (!deps.local.canWrite(key)) throw new SyncError('writeFailed');
        const { plain } = await download(drive, key, re, hmacKey, opts.passphrase);
        deps.local.write(key, plain);
        L2 = hashLocal(key, isKeys ? apiKeysItem(st) : deps.local.read(key), hmacKey);
      } else {
        deps.local.remove(key);
      }
      st.base[key] = { local: L2, remote: R };
      st.localSeen[key] = { hash: L2, at: now() };
    }
    st.conflicts = st.conflicts.filter((c) => c.view.key !== key);
    saveState(deps.statePath, st);
  }

  /** Serialise every remote-touching operation. */
  function exclusive<T>(fn: () => Promise<T>): Promise<T> {
    if (running) return Promise.reject(new SyncError('busy'));
    const p = fn().finally(() => { running = null; });
    running = p;
    return p;
  }

  return {
    sync: (opts: SyncOptions = {}) => exclusive(() => runSync(opts)),
    resolve: (key: string, choice: 'local' | 'remote', opts: SyncOptions = {}) => exclusive(() => runResolve(key, choice, opts)),
    async resolveAll(choice: 'local' | 'remote', opts: SyncOptions = {}): Promise<{ resolved: number; failed: number }> {
      let resolved = 0;
      let failed = 0;
      for (const c of loadState(deps.statePath).conflicts) {
        if (c.view.key === 'apikeys' && !opts.passphrase) { failed++; continue; }
        try { await exclusive(() => runResolve(c.view.key, choice, opts)); resolved++; } catch { failed++; }
      }
      return { resolved, failed };
    },
    get busy() { return running !== null; }
  };
}

export type SyncEngine = ReturnType<typeof createSyncEngine>;
