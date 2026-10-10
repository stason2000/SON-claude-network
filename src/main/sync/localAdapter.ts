/**
 * The local side of sync (#10): turns this device's settings and files into
 * items, and applies (sanitized) remote items back. Electron-free — the config
 * reader/writer, the workspace home and the user's home are injected, so tests
 * can run two "devices" with different workspace folders in one process.
 *
 * Write safety:
 *   - a key is re-validated with parseItemKey before any path is built;
 *   - the path is joined under a FIXED root (workspace home or ~), re-checked to
 *     stay inside it, and every existing component below the root must be a real
 *     directory (no symlink can redirect a write elsewhere);
 *   - writes are tmp + rename, files get mode 0644 (never executable);
 *   - memory is only written into an agent folder that already exists here, so
 *     sync never conjures a ghost agent;
 *   - config items go through the whitelist sanitizers, then writeConfig (which
 *     re-sanitizes departments).
 */
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';
import {
  AGENT_ID_RE, CONFLICTS_DIR, I18N_OVERRIDES_FILE, MAX_ITEM_BYTES, MAX_ITEMS, MAX_SKILL_DEPTH, RULES_FILE, SKILL_EXT_RE,
  backupBaseName, deviceSlug, isSafeSegment, memoryKey, parseItemKey, skillKey,
  type CategoryToggles, type ItemCategory, type ParsedKey
} from '../../shared/sync/items';
import {
  canonicalJson, extractDepartments, extractPortableSettings, extractTriggers,
  sanitizePortableSettings, sanitizeRemoteDepartments, sanitizeTriggers, triggersPatch
} from '../../shared/sync/whitelist';
import { SyncError } from './errors';

type Json = Record<string, unknown>;

export interface LocalItem {
  key: string;
  category: ItemCategory;
  content: Buffer;
  /** File mtime (ms) when the item is a file; null for config-derived items. */
  mtime: number | null;
}

export interface ApiKeyBridge {
  /** id → plaintext key. ids look like "connector:openai" / "provider:groq". */
  exportAll(): Record<string, string>;
  importAll(keys: Record<string, string>): void;
}

export interface LocalAdapterDeps {
  getWorkspace(): string | null;
  userHome(): string;
  readConfig(): Json;
  writeConfig(patch: Json): void;
  apiKeys?: ApiKeyBridge;
  /** Directory used for conflict backups when there is no workspace. */
  fallbackBackupDir: string;
  /** Called after a config category was applied (e.g. re-arm the mission scheduler). */
  onApplied?(category: ItemCategory): void;
}

export interface LocalAdapter {
  snapshot(categories: CategoryToggles): { items: Map<string, LocalItem>; skipped: Set<string> };
  read(key: string): LocalItem | null;
  /** May a remote version be written here? (workspace present, agent exists…) */
  canWrite(key: string): boolean;
  write(key: string, content: Buffer): void;
  remove(key: string): void;
  backup(key: string, content: Buffer, deviceLabel: string, now: number): string;
  apiKeysPlain(): Buffer | null;
  applyApiKeys(plain: Buffer): void;
}

const API_KEY_ID_RE = /^(connector|provider):[a-z0-9][a-z0-9_-]{0,63}$/;
const API_KEY_RE = /^[\x21-\x7e]{8,4096}$/;

export function createLocalAdapter(deps: LocalAdapterDeps): LocalAdapter {
  const wsRoot = (): string | null => {
    const w = deps.getWorkspace();
    if (typeof w !== 'string' || !w || !isAbsolute(w)) return null;
    try { return statSync(w).isDirectory() ? resolve(w) : null; } catch { return null; }
  };
  const homeRoot = (): string => resolve(deps.userHome());
  const rootFor = (p: ParsedKey): string | null => (p.root === 'ws' ? wsRoot() : p.root === 'home' ? homeRoot() : null);

  /** Resolve a file key under its root, refusing escapes and symlinked components. */
  function pathFor(p: ParsedKey): string | null {
    if (p.root === 'config') return null;
    const root = rootFor(p);
    if (!root) return null;
    const target = resolve(root, ...p.segments);
    const rel = relative(root, target);
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null;
    let cur = root;
    for (const seg of p.segments) {
      cur = join(cur, seg);
      try {
        const st = lstatSync(cur);
        if (st.isSymbolicLink()) return null;
        if (cur !== target && !st.isDirectory()) return null;
        if (cur === target && !st.isFile()) return null;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') break; // rest does not exist yet
        return null;
      }
    }
    return target;
  }

  function readFileItem(p: ParsedKey): LocalItem | null | 'skip' {
    const fp = pathFor(p);
    if (!fp) return 'skip';
    try {
      const st = lstatSync(fp);
      if (!st.isFile()) return 'skip';
      if (st.size > MAX_ITEM_BYTES) return 'skip';
      return { key: p.key, category: p.category, content: readFileSync(fp), mtime: Math.round(st.mtimeMs) };
    } catch (e) {
      return (e as NodeJS.ErrnoException).code === 'ENOENT' ? null : 'skip';
    }
  }

  function configItem(key: 'settings' | 'departments' | 'triggers'): LocalItem {
    const cfg = deps.readConfig();
    const value = key === 'settings' ? extractPortableSettings(cfg) : key === 'departments' ? extractDepartments(cfg) : extractTriggers(cfg);
    return { key, category: key, content: Buffer.from(canonicalJson(value), 'utf8'), mtime: null };
  }

  function readItem(key: string): LocalItem | null | 'skip' {
    const p = parseItemKey(key);
    if (!p) return 'skip';
    if (p.root === 'config') {
      if (p.category === 'apikeys') return 'skip'; // handled via apiKeysPlain()
      return configItem(p.category);
    }
    return readFileItem(p);
  }

  function scanSkills(root: string, which: 'ws' | 'home', out: string[]): void {
    const base = join(root, '.claude', 'skills');
    try { if (!lstatSync(join(root, '.claude')).isDirectory() || !lstatSync(base).isDirectory()) return; } catch { return; }
    const walk = (dir: string, rel: string[]): void => {
      if (rel.length >= MAX_SKILL_DEPTH || out.length >= MAX_ITEMS) return;
      let entries;
      try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (!isSafeSegment(e.name) || e.name === 'node_modules') continue;
        if (e.isSymbolicLink()) continue;
        const segs = [...rel, e.name];
        if (e.isDirectory()) walk(join(dir, e.name), segs);
        else if (e.isFile() && SKILL_EXT_RE.test(e.name) && segs.length >= 2) {
          const k = skillKey(which, segs);
          if (k) out.push(k);
        }
      }
    };
    walk(base, []);
  }

  function listKeys(categories: CategoryToggles): string[] {
    const keys: string[] = [];
    if (categories.settings) keys.push('settings');
    if (categories.departments) keys.push('departments');
    if (categories.triggers) keys.push('triggers');
    const ws = wsRoot();
    if (ws) {
      if (categories.rules) keys.push('rules');
      if (categories.i18n) keys.push('i18n');
      if (categories.memory) {
        const agents = join(ws, 'hive', 'agents');
        try {
          for (const e of readdirSync(agents, { withFileTypes: true })) {
            if (e.isDirectory() && AGENT_ID_RE.test(e.name) && isSafeSegment(e.name)) {
              const k = memoryKey(e.name);
              if (k) keys.push(k);
            }
          }
        } catch { /* no hive yet */ }
      }
    }
    if (categories.skills) {
      const home = homeRoot();
      if (ws && ws !== home) scanSkills(ws, 'ws', keys);
      scanSkills(home, 'home', keys);
    }
    return keys.slice(0, MAX_ITEMS);
  }

  function atomicWrite(fp: string, content: Buffer): void {
    const dir = resolve(fp, '..');
    mkdirSync(dir, { recursive: true });
    const tmp = `${fp}.sync-tmp-${Math.random().toString(36).slice(2, 10)}`;
    try {
      writeFileSync(tmp, content, { mode: 0o644 });
      renameSync(tmp, fp);
    } catch {
      try { rmSync(tmp, { force: true }); } catch { /* disposable */ }
      throw new SyncError('writeFailed');
    }
  }

  function parseJson(content: Buffer): unknown {
    try { return JSON.parse(content.toString('utf8')); } catch { throw new SyncError('badRemote'); }
  }

  const adapter: LocalAdapter = {
    snapshot(categories) {
      const items = new Map<string, LocalItem>();
      const skipped = new Set<string>();
      for (const k of listKeys(categories)) {
        const it = readItem(k);
        if (it === 'skip') skipped.add(k);
        else if (it) items.set(k, it);
      }
      return { items, skipped };
    },
    read(key) {
      const it = readItem(key);
      return it === 'skip' ? null : it;
    },
    canWrite(key) {
      const p = parseItemKey(key);
      if (!p) return false;
      if (p.root === 'config') return p.category !== 'apikeys' || !!deps.apiKeys;
      if (!pathFor(p)) return false;
      if (p.category === 'memory') {
        const ws = wsRoot();
        try { return !!ws && lstatSync(join(ws, 'hive', 'agents', p.agentId)).isDirectory(); } catch { return false; }
      }
      return true;
    },
    write(key, content) {
      const p = parseItemKey(key);
      if (!p) throw new SyncError('badRemote');
      if (content.length > MAX_ITEM_BYTES) throw new SyncError('tooLarge');
      if (p.root === 'config') {
        if (p.category === 'apikeys') { adapter.applyApiKeys(content); return; }
        const raw = parseJson(content);
        if (p.category === 'settings') {
          const patch = sanitizePortableSettings(raw);
          if (!patch) throw new SyncError('badRemote');
          deps.writeConfig(patch);
        } else if (p.category === 'departments') {
          const d = sanitizeRemoteDepartments(raw);
          if (!d) throw new SyncError('badRemote');
          deps.writeConfig({ departments: d });
        } else {
          const t = sanitizeTriggers(raw);
          if (!t) throw new SyncError('badRemote');
          deps.writeConfig(triggersPatch(deps.readConfig(), t));
        }
        deps.onApplied?.(p.category);
        return;
      }
      if (!adapter.canWrite(key)) throw new SyncError(wsRoot() ? 'writeFailed' : 'noWorkspace');
      const fp = pathFor(p);
      if (!fp) throw new SyncError('writeFailed');
      if (p.category === 'i18n') parseJson(content); // must at least be JSON
      atomicWrite(fp, content);
      deps.onApplied?.(p.category);
    },
    remove(key) {
      const p = parseItemKey(key);
      if (!p || p.root === 'config') return; // config items are never deleted
      const fp = pathFor(p);
      if (!fp) throw new SyncError('writeFailed');
      try { rmSync(fp, { force: true }); } catch { throw new SyncError('writeFailed'); }
    },
    backup(key, content, deviceLabel, now) {
      const ws = wsRoot();
      const dir = ws ? join(ws, CONFLICTS_DIR) : deps.fallbackBackupDir;
      try { if (lstatSync(dir).isSymbolicLink()) throw new SyncError('writeFailed'); } catch (e) {
        if (e instanceof SyncError) throw e;
      }
      mkdirSync(dir, { recursive: true });
      const p = parseItemKey(key);
      const ext = key === 'apikeys' ? '.enc.json' : p && p.root === 'config' ? '.json'
        : p && 'segments' in p ? (extname(p.segments[p.segments.length - 1]) || '.txt') : '.txt';
      const stamp = new Date(now).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
      let name = `${backupBaseName(key)}-${deviceSlug(deviceLabel)}-${stamp}${ext}`;
      let i = 1;
      while (existsSync(join(dir, name))) name = `${backupBaseName(key)}-${deviceSlug(deviceLabel)}-${stamp}-${i++}${ext}`;
      const fp = join(dir, name);
      writeFileSync(fp, content, { mode: 0o600, flag: 'wx' });
      return fp;
    },
    apiKeysPlain() {
      if (!deps.apiKeys) return null;
      const all = deps.apiKeys.exportAll();
      const keys: Record<string, string> = {};
      for (const [id, v] of Object.entries(all)) if (API_KEY_ID_RE.test(id) && API_KEY_RE.test(v)) keys[id] = v;
      // No keys here = "absent", so a fresh device simply receives them.
      if (Object.keys(keys).length === 0) return null;
      return Buffer.from(canonicalJson({ keys }), 'utf8');
    },
    applyApiKeys(plain) {
      if (!deps.apiKeys) throw new SyncError('writeFailed');
      const raw = parseJson(plain) as { keys?: unknown };
      if (!raw || typeof raw.keys !== 'object' || !raw.keys || Array.isArray(raw.keys)) throw new SyncError('badRemote');
      const keys: Record<string, string> = {};
      for (const [id, v] of Object.entries(raw.keys as Json)) {
        if (API_KEY_ID_RE.test(id) && typeof v === 'string' && API_KEY_RE.test(v)) keys[id] = v;
      }
      deps.apiKeys.importAll(keys);
    }
  };
  return adapter;
}

/** Exposed for tests / the i18n override reader. */
export const LOCAL_FILES = { RULES_FILE, I18N_OVERRIDES_FILE };
