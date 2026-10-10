/**
 * Three-way sync decision (#10). Pure.
 *
 * For one item we know:
 *   local  — this device's current content hash, or null when absent;
 *   remote — the manifest entry's hash, null when absent, plus `deleted` when
 *            the manifest carries a tombstone (another device chose deletion);
 *   base   — what both sides looked like at the LAST successful sync of this
 *            item on this device ({ local, remote } hashes, kept separately
 *            because applying remote settings can normalise them), or undefined
 *            when this device never synced the item.
 *
 * Rules:
 *   - same content on both sides            → in-sync (refresh base)
 *   - only local changed                    → upload
 *   - only remote changed                   → download
 *   - both changed and differ               → conflict  (never overwrite either)
 *   - any DELETION (local file gone, or a remote tombstone) against content
 *     that still exists on the other side   → conflict  (deletes are never
 *     propagated automatically in either direction; the user decides)
 */

export interface BaseRecord {
  local: string | null;
  remote: string | null;
}

export interface DecideInput {
  local: string | null;
  remote: string | null;
  remoteDeleted?: boolean;
  base?: BaseRecord;
}

export type ConflictKind =
  | 'both-modified' // both sides changed since the base
  | 'both-added' // never synced here, exists on both sides with different content
  | 'local-deleted' // removed here, remote still has it
  | 'remote-deleted' // remote tombstone, this device still has it
  | 'delete-vs-modify'; // one side deleted, the other modified

export type Decision =
  | { action: 'noop' }
  | { action: 'in-sync' }
  | { action: 'upload' }
  | { action: 'download' }
  | { action: 'conflict'; kind: ConflictKind };

export function decide(input: DecideInput): Decision {
  const L = input.local ?? null;
  const R = input.remoteDeleted ? null : (input.remote ?? null);
  const base = input.base;

  if (L === R) return L === null ? { action: 'noop' } : { action: 'in-sync' };

  if (!base) {
    if (L === null) return { action: 'download' }; // R !== null here
    if (R === null) return input.remoteDeleted ? { action: 'conflict', kind: 'remote-deleted' } : { action: 'upload' };
    return { action: 'conflict', kind: 'both-added' };
  }

  const lChanged = L !== base.local;
  const rChanged = R !== base.remote;

  if (!lChanged && !rChanged) {
    // Both sides equal their base yet differ from each other: the base itself
    // recorded a divergence (e.g. a normalised apply). Treat remote as truth only
    // if it exists; never resurrect or delete silently.
    if (R === null) return { action: 'conflict', kind: 'remote-deleted' };
    if (L === null) return { action: 'conflict', kind: 'local-deleted' };
    return { action: 'noop' };
  }
  if (lChanged && !rChanged) {
    return L === null ? { action: 'conflict', kind: 'local-deleted' } : { action: 'upload' };
  }
  if (!lChanged && rChanged) {
    return R === null ? { action: 'conflict', kind: 'remote-deleted' } : { action: 'download' };
  }
  // Both changed, and L !== R.
  if (L === null || R === null) return { action: 'conflict', kind: 'delete-vs-modify' };
  return { action: 'conflict', kind: 'both-modified' };
}
