/**
 * "사용량·한도" — pure, dependency-free logic shared by main and the renderer.
 *
 *  1. Local request log. resources/api-agent.cjs appends ONE JSON line per request
 *     to a file main names via SON_API_USAGE_LOG (under userData, never the
 *     workspace repo): exactly {ts, connector, ok, status}. No prompt, no reply,
 *     no key — sanitizeUsageLine() is the single definition of what a line may
 *     hold, and the reader re-applies it so a tampered file can't smuggle more.
 *  2. Aggregation per connector per LOCAL day (today / last 7 days incl. today),
 *     plus the most recent failure and a hint when the LAST result was 429/402.
 *  3. OpenRouter `GET /api/v1/key` (official; openrouter.ai/docs/api_reference/limits)
 *     → a numbers-only view model. `label` is deliberately dropped (OpenRouter
 *     fills it with a masked key). Free-model daily counters are per UTC day.
 */

// ── local log lines ────────────────────────────────────────────────────────────
export interface UsageLogLine {
  /** Epoch ms. */
  ts: number;
  /** Connector id (registry id, e.g. 'openrouter'). */
  connector: string;
  ok: boolean;
  /** HTTP status, or null when no response arrived (network error / timeout). */
  status: number | null;
}

/** Max lines kept in the log file; older lines are dropped on trim. */
export const USAGE_LOG_MAX_LINES = 5000;

const CONNECTOR_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** The ONLY shape a usage line may have. Anything else (prompt, key, reply,
 *  extra fields) is dropped; an invalid line yields null. */
export function sanitizeUsageLine(input: unknown): UsageLogLine | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const o = input as Record<string, unknown>;
  const ts = o.ts;
  if (typeof ts !== 'number' || !Number.isFinite(ts) || ts <= 0) return null;
  if (typeof o.connector !== 'string' || !CONNECTOR_ID.test(o.connector)) return null;
  if (typeof o.ok !== 'boolean') return null;
  let status: number | null = null;
  if (typeof o.status === 'number' && Number.isInteger(o.status) && o.status >= 100 && o.status <= 599) status = o.status;
  return { ts: Math.floor(ts), connector: o.connector, ok: o.ok, status };
}

/** One serialized log line (with trailing newline), or '' when invalid. */
export function formatUsageLine(input: unknown): string {
  const l = sanitizeUsageLine(input);
  return l ? `${JSON.stringify(l)}\n` : '';
}

/** Parse the log file text; malformed lines are skipped. */
export function parseUsageLog(text: string): UsageLogLine[] {
  const out: UsageLogLine[] = [];
  for (const raw of String(text).split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    try {
      const l = sanitizeUsageLine(JSON.parse(line));
      if (l) out.push(l);
    } catch { /* skip */ }
  }
  return out;
}

/** The last `max` valid lines, re-serialized (sanitized). */
export function trimUsageLog(text: string, max = USAGE_LOG_MAX_LINES): string {
  const lines = parseUsageLog(text);
  return lines.slice(Math.max(0, lines.length - max)).map((l) => `${JSON.stringify(l)}\n`).join('');
}

// ── aggregation ────────────────────────────────────────────────────────────────
export type UsageErrorKind = 'rateLimit' | 'credits' | 'auth' | 'network' | 'server' | 'other';

export function usageErrorKind(status: number | null): UsageErrorKind {
  if (status === null) return 'network';
  if (status === 429) return 'rateLimit';
  if (status === 402) return 'credits';
  if (status === 401 || status === 403) return 'auth';
  if (status >= 500) return 'server';
  return 'other';
}

/** 'rateLimit' / 'credits' when the given (last) result means "blocked by a limit". */
export function limitHint(last: { ok: boolean; status: number | null } | null | undefined): 'rateLimit' | 'credits' | null {
  if (!last || last.ok) return null;
  return last.status === 429 ? 'rateLimit' : last.status === 402 ? 'credits' : null;
}

export interface ConnectorUsageSummary {
  today: number;
  last7: number;
  /** Most recent request outcome. */
  last: { ts: number; ok: boolean; status: number | null } | null;
  /** Most recent failed request. */
  lastError: { ts: number; status: number | null; kind: UsageErrorKind } | null;
  /** Set when the LAST result was 429 / 402. */
  hint: 'rateLimit' | 'credits' | null;
}

/** Local-midnight epoch ms of the day containing `now`, shifted by `daysBack`. */
export function localDayStart(now: number, daysBack = 0): number {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - daysBack).getTime();
}

export function aggregateUsage(lines: readonly UsageLogLine[], now: number): Record<string, ConnectorUsageSummary> {
  const todayStart = localDayStart(now);
  const weekStart = localDayStart(now, 6);
  const tomorrow = localDayStart(now, -1);
  const out: Record<string, ConnectorUsageSummary> = {};
  for (const l of lines) {
    const s = (out[l.connector] ??= { today: 0, last7: 0, last: null, lastError: null, hint: null });
    if (l.ts >= weekStart && l.ts < tomorrow) {
      s.last7++;
      if (l.ts >= todayStart) s.today++;
    }
    if (!s.last || l.ts >= s.last.ts) s.last = { ts: l.ts, ok: l.ok, status: l.status };
    if (!l.ok && (!s.lastError || l.ts >= s.lastError.ts)) s.lastError = { ts: l.ts, status: l.status, kind: usageErrorKind(l.status) };
  }
  for (const s of Object.values(out)) s.hint = limitHint(s.last);
  return out;
}

// ── OpenRouter GET /api/v1/key ─────────────────────────────────────────────────
export const OPENROUTER_KEY_URL = 'https://openrouter.ai/api/v1/key';

export interface OpenRouterUsageView {
  /** Free-model requests in the current UTC day; null when the API did not report it. */
  freeDaily: { used: number; limit: number; remaining: number; percent: number } | null;
  /** Credits (USD) used in the current UTC day / all time. */
  creditsToday: number | null;
  creditsTotal: number | null;
  /** The key's own credit cap; null = unlimited or not reported. */
  keyLimit: number | null;
  keyLimitRemaining: number | null;
  /** true = has not bought credits yet (docs: free tier). null = not reported. */
  isFreeTier: boolean | null;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);

/** Map the documented response body to numbers only. Returns null when the body
 *  has no `data` object at all. Never copies `label` or any string field. */
export function parseOpenRouterKey(body: unknown): OpenRouterUsageView | null {
  if (!body || typeof body !== 'object') return null;
  const data = (body as { data?: unknown }).data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const d = data as Record<string, unknown>;
  let freeDaily: OpenRouterUsageView['freeDaily'] = null;
  const f = d.free_model_daily_requests;
  if (f && typeof f === 'object' && !Array.isArray(f)) {
    const fr = f as Record<string, unknown>;
    const used = num(fr.used);
    const limit = num(fr.limit);
    if (used !== null && limit !== null) {
      const remaining = num(fr.remaining) ?? Math.max(0, limit - used);
      const percent = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : used > 0 ? 100 : 0;
      freeDaily = { used, limit, remaining, percent };
    }
  }
  return {
    freeDaily,
    creditsToday: num(d.usage_daily),
    creditsTotal: num(d.usage),
    keyLimit: num(d.limit),
    keyLimitRemaining: num(d.limit_remaining),
    isFreeTier: typeof d.is_free_tier === 'boolean' ? d.is_free_tier : null
  };
}

export type OpenRouterUsageError = 'no-key' | 'bad-key' | 'offline' | 'later';

export type OpenRouterUsageResult =
  | { ok: true; view: OpenRouterUsageView; fetchedAt: number }
  | { ok: false; error: OpenRouterUsageError };

/** HTTP status of a failed `GET /key` → the short reason the UI shows. */
export function openRouterErrorFor(status: number): OpenRouterUsageError {
  return status === 401 || status === 403 ? 'bad-key' : 'later';
}

// ── time / number formatting helpers ───────────────────────────────────────────
/** ms until the next 00:00 UTC (OpenRouter's free-model day boundary). */
export function msUntilUtcMidnight(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - now;
}

/** Split a duration into whole hours + minutes (minutes rounded up, so "0분"
 *  only appears when it really is due). */
export function splitDuration(ms: number): { h: number; m: number } {
  const totalMin = Math.max(0, Math.ceil(ms / 60_000));
  return { h: Math.floor(totalMin / 60), m: totalMin % 60 };
}

/** "$0.0123" style credits (USD); small amounts keep 4 decimals. */
export function formatCredits(n: number): string {
  if (!Number.isFinite(n)) return '-';
  return `$${n.toFixed(n !== 0 && Math.abs(n) < 1 ? 4 : 2)}`;
}

/** Local "HH:MM" for a timestamp (24h). */
export function formatClock(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Local "M/D HH:MM" for a timestamp; "HH:MM" alone when it is today. */
export function formatWhen(ts: number, now: number): string {
  const d = new Date(ts);
  return ts >= localDayStart(now) && ts < localDayStart(now, -1) ? formatClock(ts) : `${d.getMonth() + 1}/${d.getDate()} ${formatClock(ts)}`;
}
