/**
 * Google-Drive settings sync (#10) — item keys, categories and path validation.
 *
 * Every synced thing is one ITEM with a stable, device-independent key. A key
 * never contains an absolute path: the main process maps it onto THIS device's
 * roots (workspace home, the user's home for ~/.claude/skills, or the config
 * file), so the PC and the laptop can use different workspace folders.
 *
 * Keys come back from the remote manifest, which is UNTRUSTED. `parseItemKey`
 * is the single gate: anything that is not one of the shapes below — or that
 * has a `..`, an absolute path, a backslash, a drive letter, a Windows-reserved
 * name, a dot-first segment, non-ASCII, or an extension outside the allowlist —
 * is refused before any path is built from it.
 *
 * Pure (no node imports): shared by main, renderer and tests.
 */

export const SYNC_CATEGORIES = ['settings', 'departments', 'rules', 'skills', 'triggers', 'i18n', 'memory'] as const;
export type SyncCategory = (typeof SYNC_CATEGORIES)[number];
/** The opt-in encrypted API-key item is its own pseudo-category, never on by default. */
export type ItemCategory = SyncCategory | 'apikeys';

export type CategoryToggles = Record<SyncCategory, boolean>;
export const DEFAULT_CATEGORIES: CategoryToggles = {
  settings: true, departments: true, rules: true, skills: true, triggers: true, i18n: true, memory: true
};

/** Single-file items: key → category. */
export const SINGLE_ITEMS = {
  settings: 'settings',
  departments: 'departments',
  triggers: 'triggers',
  rules: 'rules',
  i18n: 'i18n',
  apikeys: 'apikeys'
} as const satisfies Record<string, ItemCategory>;

/** File names inside the workspace home. */
export const RULES_FILE = 'michael-rules.md';
export const I18N_OVERRIDES_FILE = 'i18n-overrides.ko.json';
export const CONFLICTS_DIR = 'sync-conflicts';

/** Size caps (bytes). Remote content over a cap is never downloaded or applied. */
export const MAX_ITEM_BYTES = 1_000_000;
export const MAX_TOTAL_BYTES = 25_000_000;
export const MAX_ITEMS = 2_000;
export const MAX_SKILL_DEPTH = 6;

/** Text-only skill files. Scripts (.sh/.py/.js…) are deliberately NOT synced: a
 *  synced file must never be something the machine would execute. */
export const SKILL_EXT_RE = /\.(md|markdown|txt|json|ya?ml|toml|csv)$/i;

const SEGMENT_RE = /^[A-Za-z0-9_][A-Za-z0-9 ._-]{0,99}$/;
const WIN_RESERVED_RE = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
export const AGENT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** One path segment: ASCII, no leading dot, no trailing dot/space, not reserved. */
export function isSafeSegment(seg: unknown): seg is string {
  if (typeof seg !== 'string' || !SEGMENT_RE.test(seg)) return false;
  if (seg.endsWith('.') || seg.endsWith(' ')) return false;
  if (WIN_RESERVED_RE.test(seg)) return false;
  return true;
}

export type ParsedKey =
  | { key: string; category: 'settings' | 'departments' | 'triggers' | 'apikeys'; root: 'config' }
  | { key: string; category: 'rules' | 'i18n'; root: 'ws'; segments: string[] }
  | { key: string; category: 'memory'; root: 'ws'; agentId: string; segments: string[] }
  | { key: string; category: 'skills'; root: 'ws' | 'home'; segments: string[] };

/** Validate an item key (from local scan OR the remote manifest). null = refuse. */
export function parseItemKey(key: unknown): ParsedKey | null {
  if (typeof key !== 'string' || key.length === 0 || key.length > 400) return null;
  if (!/^[\x20-\x7e]+$/.test(key)) return null;
  if (key.includes('\\') || key.includes(':') || key.startsWith('/') || key.includes('//')) return null;
  switch (key) {
    case 'settings':
    case 'departments':
    case 'triggers':
    case 'apikeys':
      return { key, category: key, root: 'config' };
    case 'rules':
      return { key, category: 'rules', root: 'ws', segments: [RULES_FILE] };
    case 'i18n':
      return { key, category: 'i18n', root: 'ws', segments: [I18N_OVERRIDES_FILE] };
  }
  const parts = key.split('/');
  if (parts[0] === 'memory' && parts.length === 2 && AGENT_ID_RE.test(parts[1]) && isSafeSegment(parts[1])) {
    return { key, category: 'memory', root: 'ws', agentId: parts[1], segments: ['hive', 'agents', parts[1], 'memory.md'] };
  }
  if (parts[0] === 'skills' && (parts[1] === 'ws' || parts[1] === 'home')) {
    const rel = parts.slice(2);
    if (rel.length < 2 || rel.length > MAX_SKILL_DEPTH) return null; // <skill>/<file> at least
    if (!rel.every(isSafeSegment)) return null;
    if (!SKILL_EXT_RE.test(rel[rel.length - 1])) return null;
    return { key, category: 'skills', root: parts[1], segments: ['.claude', 'skills', ...rel] };
  }
  return null;
}

/** Build the key for a skill file found locally (segments relative to …/.claude/skills). */
export function skillKey(root: 'ws' | 'home', relSegments: string[]): string | null {
  const key = ['skills', root, ...relSegments].join('/');
  return parseItemKey(key) ? key : null;
}

export function memoryKey(agentId: string): string | null {
  const key = `memory/${agentId}`;
  return parseItemKey(key) ? key : null;
}

export function categoryOfKey(key: string): ItemCategory | null {
  return parseItemKey(key)?.category ?? null;
}

/** A filesystem-safe flat name for a key, used for conflict backups. */
export function backupBaseName(key: string): string {
  return key.replace(/\//g, '__').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120);
}

/** A filesystem-safe slug for a device label (backup file names). */
export function deviceSlug(label: string): string {
  const s = String(label ?? '').normalize('NFKC').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return s || 'device';
}

/** Device labels are user-typed; keep them short, one line, no control chars. */
export function sanitizeDeviceLabel(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 40);
  return s || null;
}
