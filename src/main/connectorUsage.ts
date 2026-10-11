/**
 * "사용량·한도" main side (see src/shared/connectorUsage.ts for the pure logic).
 *
 *  - connectorUsage:openrouter — GET https://openrouter.ai/api/v1/key with the
 *    stored key (official, openrouter.ai/docs/api_reference/limits). The key is
 *    read main-side, sent only to that fixed https URL (redirects refused, 8 s
 *    timeout), never logged, never returned. Only parsed numbers cross IPC.
 *  - connectorUsage:local — today / last-7-days request counts per API connector
 *    from the local log api-agent.cjs appends to (userData/api-usage.jsonl). The
 *    file is trimmed to the last USAGE_LOG_MAX_LINES lines when it grows.
 *
 * Electron-free (fetch, key lookup, path and ipc injected) so it is unit-testable.
 */
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import {
  OPENROUTER_KEY_URL,
  USAGE_LOG_MAX_LINES,
  aggregateUsage,
  openRouterErrorFor,
  parseOpenRouterKey,
  parseUsageLog,
  trimUsageLog,
  type ConnectorUsageSummary,
  type OpenRouterUsageResult
} from '../shared/connectorUsage';

export interface OpenRouterUsageDeps {
  getKey: () => string | undefined;
  fetch: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
}

export async function fetchOpenRouterUsage(deps: OpenRouterUsageDeps): Promise<OpenRouterUsageResult> {
  const key = deps.getKey();
  if (!key) return { ok: false, error: 'no-key' };
  // Fixed constant; asserted anyway so a future edit can't send the key over http.
  if (!OPENROUTER_KEY_URL.startsWith('https://')) return { ok: false, error: 'later' };
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), deps.timeoutMs ?? 8000);
  try {
    const res = await deps.fetch(OPENROUTER_KEY_URL, {
      method: 'GET',
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
      redirect: 'error',
      signal: ac.signal
    });
    if (!res.ok) return { ok: false, error: openRouterErrorFor(res.status) };
    let body: unknown;
    try { body = await res.json(); } catch { return { ok: false, error: 'later' }; }
    const view = parseOpenRouterKey(body);
    if (!view) return { ok: false, error: 'later' };
    return { ok: true, view, fetchedAt: (deps.now ?? Date.now)() };
  } catch (e) {
    const err = e as { name?: string };
    return { ok: false, error: err?.name === 'AbortError' ? 'later' : 'offline' };
  } finally {
    clearTimeout(timer);
  }
}

/** Rewrite the log with only its last `max` lines once it holds clearly more.
 *  Cheap size pre-check so the common case never reads the file twice. */
export function trimUsageLogFile(path: string, max = USAGE_LOG_MAX_LINES): void {
  try {
    if (!existsSync(path)) return;
    // ~100 bytes per line: under max*60 bytes it can't be over the cap.
    if (statSync(path).size < max * 60) return;
    const text = readFileSync(path, 'utf8');
    const count = text.split('\n').length - 1;
    if (count <= max) return;
    writeFileSync(path, trimUsageLog(text, max), { encoding: 'utf8', mode: 0o600 });
  } catch { /* a usage log is best-effort */ }
}

export function readLocalUsage(path: string, now: number): { now: number; byConnector: Record<string, ConnectorUsageSummary> } {
  trimUsageLogFile(path);
  let text = '';
  try { if (existsSync(path)) text = readFileSync(path, 'utf8'); } catch { /* empty */ }
  return { now, byConnector: aggregateUsage(parseUsageLog(text), now) };
}

interface IpcLike {
  handle: (channel: string, fn: (...args: unknown[]) => unknown) => void;
}

export function registerConnectorUsageIpc(
  ipc: IpcLike,
  deps: { getOpenRouterKey: () => string | undefined; logPath: () => string; fetch: typeof fetch }
): void {
  ipc.handle('connectorUsage:openrouter', () => fetchOpenRouterUsage({ getKey: deps.getOpenRouterKey, fetch: deps.fetch }));
  ipc.handle('connectorUsage:local', () => readLocalUsage(deps.logPath(), Date.now()));
}
