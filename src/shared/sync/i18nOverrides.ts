/**
 * Korean text overrides: `<workspace>/i18n-overrides.ko.json`, flat
 * (`{"settings.title": "설정"}`) or nested (`{"settings": {"title": "설정"}}`),
 * merged over the bundled ko strings at startup. Pure sanitizer: only string
 * leaves, safe key segments, bounded sizes; prototype keys are refused. The
 * values are rendered as React text (escaped), never as HTML.
 */
export const I18N_OVERRIDES_MAX_BYTES = 256_000;
const MAX_ENTRIES = 5_000;
const MAX_VALUE = 2_000;
const MAX_DEPTH = 8;
const KEY_SEG_RE = /^[A-Za-z0-9_-]{1,80}$/;
const FORBIDDEN = new Set(['__proto__', 'prototype', 'constructor']);

export type NestedStrings = { [k: string]: string | NestedStrings };

export function sanitizeI18nOverrides(raw: unknown): { tree: NestedStrings; count: number } {
  const tree: NestedStrings = Object.create(null);
  let count = 0;
  const put = (path: string[], value: string): void => {
    if (count >= MAX_ENTRIES || path.length === 0 || path.length > MAX_DEPTH) return;
    if (!path.every((s) => KEY_SEG_RE.test(s) && !FORBIDDEN.has(s))) return;
    if (value.length > MAX_VALUE) return;
    let node: NestedStrings = tree;
    for (let i = 0; i < path.length - 1; i++) {
      const cur = node[path[i]];
      if (typeof cur === 'string') return; // leaf/branch clash: first one wins
      if (!cur) node[path[i]] = Object.create(null);
      node = node[path[i]] as NestedStrings;
    }
    const last = path[path.length - 1];
    if (node[last] && typeof node[last] !== 'string') return;
    node[last] = value;
    count++;
  };
  const walk = (v: unknown, prefix: string[], depth: number): void => {
    if (depth > MAX_DEPTH || !v || typeof v !== 'object' || Array.isArray(v)) return;
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      const segs = [...prefix, ...k.split('.')];
      if (typeof val === 'string') put(segs, val);
      else walk(val, segs, depth + 1);
    }
  };
  walk(raw, [], 0);
  return { tree: JSON.parse(JSON.stringify(tree)) as NestedStrings, count };
}
