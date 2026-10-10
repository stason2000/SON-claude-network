/**
 * A short, human-readable summary of how two versions of an item differ, for
 * the conflict chooser. Pure; bounded output.
 */
export interface DiffSummary {
  /** Lines only in "this device" / only in "other device" (text items). */
  onlyLocal?: number;
  onlyRemote?: number;
  /** Top-level JSON keys whose values differ (JSON items). */
  changedKeys?: string[];
}

export function snippet(text: string | null, max = 160): string {
  if (text === null) return '';
  const s = text.replace(/\r\n/g, '\n').trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function tryJson(s: string | null): Record<string, unknown> | null {
  if (s === null) return null;
  try {
    const v = JSON.parse(s);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch { return null; }
}

export function diffSummary(local: string | null, remote: string | null): DiffSummary {
  const lj = tryJson(local);
  const rj = tryJson(remote);
  if (lj && rj) {
    const keys = new Set([...Object.keys(lj), ...Object.keys(rj)]);
    const changed: string[] = [];
    for (const k of keys) if (JSON.stringify(lj[k]) !== JSON.stringify(rj[k])) changed.push(k);
    return { changedKeys: changed.sort().slice(0, 20) };
  }
  const count = (s: string | null): Map<string, number> => {
    const m = new Map<string, number>();
    if (s === null) return m;
    for (const line of s.replace(/\r\n/g, '\n').split('\n')) m.set(line, (m.get(line) ?? 0) + 1);
    return m;
  };
  const a = count(local);
  const b = count(remote);
  let onlyLocal = 0;
  let onlyRemote = 0;
  for (const [line, n] of a) onlyLocal += Math.max(0, n - (b.get(line) ?? 0));
  for (const [line, n] of b) onlyRemote += Math.max(0, n - (a.get(line) ?? 0));
  return { onlyLocal, onlyRemote };
}
