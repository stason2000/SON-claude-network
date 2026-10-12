import type { Db } from '../db.js';
import { DEFAULT_SAFETY_LIMITS, type SafetyLimits } from '../../shared/types.js';

const LIMITS_KEY = 'safetyLimits';

export function getSafetyLimits(db: Db): SafetyLimits {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(LIMITS_KEY) as
    | { value: string }
    | undefined;
  if (!row) return { ...DEFAULT_SAFETY_LIMITS };
  try {
    return { ...DEFAULT_SAFETY_LIMITS, ...(JSON.parse(row.value) as Partial<SafetyLimits>) };
  } catch {
    return { ...DEFAULT_SAFETY_LIMITS };
  }
}

export function saveSafetyLimits(db: Db, limits: SafetyLimits): SafetyLimits {
  db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(LIMITS_KEY, JSON.stringify(limits), new Date().toISOString());
  return limits;
}
