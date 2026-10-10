/**
 * The remote manifest (`manifest.json` in the Drive appDataFolder) and its
 * schema check. Everything read from Drive is untrusted: `parseManifest`
 * accepts only well-formed entries whose key passes `parseItemKey`; anything
 * else is dropped and counted. Pure.
 */
import { MAX_ITEM_BYTES, MAX_ITEMS, parseItemKey } from './items';

export const MANIFEST_NAME = 'manifest.json';
export const MANIFEST_VERSION = 1;
export const MAX_MANIFEST_BYTES = 2_000_000;

export interface DeviceInfo {
  /** User-editable label ("PC", "노트북"). */
  label: string;
  /** os.hostname() of the device. */
  host: string;
}

export interface ManifestEntry {
  /** Drive file id holding the content (absent for a tombstone). */
  fileId?: string;
  /** sha256 (hex) of the content; for the encrypted API-key item an HMAC. null for a tombstone. */
  hash: string | null;
  size: number;
  /** ms epoch on the uploading device's clock. */
  modifiedTime: number;
  device: DeviceInfo;
  deleted?: boolean;
}

export interface Manifest {
  version: number;
  updatedAt: number;
  items: Record<string, ManifestEntry>;
}

export function emptyManifest(): Manifest {
  return { version: MANIFEST_VERSION, updatedAt: 0, items: {} };
}

const FILE_ID_RE = /^[A-Za-z0-9_-]{1,200}$/;
const HASH_RE = /^[0-9a-f]{64}$/;

function str(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const s = v.replace(/[\x00-\x1f\x7f]/g, '').slice(0, max);
  return s;
}

export function parseManifest(raw: unknown): { manifest: Manifest; dropped: number } | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r.version !== MANIFEST_VERSION) return null;
  const items: Record<string, ManifestEntry> = Object.create(null);
  let dropped = 0;
  const src = r.items;
  if (!src || typeof src !== 'object' || Array.isArray(src)) return null;
  let n = 0;
  for (const [key, e] of Object.entries(src as Record<string, unknown>)) {
    if (++n > MAX_ITEMS) { dropped++; continue; }
    if (!parseItemKey(key) || !e || typeof e !== 'object' || Array.isArray(e)) { dropped++; continue; }
    const x = e as Record<string, unknown>;
    const deleted = x.deleted === true;
    const dev = (x.device ?? {}) as Record<string, unknown>;
    const label = str(dev.label, 40);
    const host = str(dev.host, 64);
    const modifiedTime = typeof x.modifiedTime === 'number' && Number.isFinite(x.modifiedTime) && x.modifiedTime >= 0 ? x.modifiedTime : null;
    if (label === null || host === null || modifiedTime === null) { dropped++; continue; }
    if (deleted) {
      items[key] = { hash: null, size: 0, modifiedTime, device: { label, host }, deleted: true };
      continue;
    }
    const size = x.size;
    if (typeof x.fileId !== 'string' || !FILE_ID_RE.test(x.fileId)
      || typeof x.hash !== 'string' || !HASH_RE.test(x.hash)
      || typeof size !== 'number' || !Number.isInteger(size) || size < 0 || size > MAX_ITEM_BYTES * 2) {
      dropped++;
      continue;
    }
    items[key] = { fileId: x.fileId, hash: x.hash, size, modifiedTime, device: { label, host } };
  }
  const updatedAt = typeof r.updatedAt === 'number' && Number.isFinite(r.updatedAt) ? r.updatedAt : 0;
  return { manifest: { version: MANIFEST_VERSION, updatedAt, items: { ...items } }, dropped };
}
