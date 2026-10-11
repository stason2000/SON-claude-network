/**
 * "연결 테스트" for API connectors that declare `connectionTest: 'models'`
 * (FreeLLMAPI): GET {endpoint}/models with the stored key and report a status
 * code only. The key is read main-side, sent only to the validated endpoint
 * (validateConnectorEndpoint → http://localhost or https), never logged and
 * never part of the reply. Redirects are refused so the key can't be bounced to
 * another host. Electron-free (fetch + key/endpoint lookups injected).
 */
import { effectiveEndpoint, getApiConnector } from '../shared/connectors';

export type ConnectorTestError = 'unknown-connector' | 'no-test' | 'auth' | 'refused' | 'timeout' | 'http' | 'network';

export type ConnectorTestResult =
  | { ok: true; models?: number }
  | { ok: false; error: ConnectorTestError; status?: number };

export interface ConnectorTestDeps {
  getKey: (id: string) => string | undefined;
  getEndpoint: (id: string) => string | undefined;
  fetch: typeof fetch;
  timeoutMs?: number;
}

export async function testApiConnector(id: unknown, deps: ConnectorTestDeps): Promise<ConnectorTestResult> {
  const c = getApiConnector(id);
  if (!c) return { ok: false, error: 'unknown-connector' };
  if (c.connectionTest !== 'models') return { ok: false, error: 'no-test' };
  const base = effectiveEndpoint(c, deps.getEndpoint(c.id)).replace(/\/+$/, '');
  const key = deps.getKey(c.id);
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (key) headers.Authorization = c.api.authScheme === 'key' ? `Key ${key}` : `Bearer ${key}`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), deps.timeoutMs ?? 8000);
  try {
    const res = await deps.fetch(`${base}/models`, { method: 'GET', headers, redirect: 'error', signal: ac.signal });
    if (res.status === 401 || res.status === 403) return { ok: false, error: 'auth', status: res.status };
    if (!res.ok) return { ok: false, error: 'http', status: res.status };
    let models: number | undefined;
    try {
      const j = (await res.json()) as { data?: unknown };
      if (j && Array.isArray(j.data)) models = j.data.length;
    } catch { /* a non-JSON 200 still means the server answered */ }
    return models === undefined ? { ok: true } : { ok: true, models };
  } catch (e) {
    const err = e as { name?: string; cause?: { code?: string } };
    if (err?.name === 'AbortError') return { ok: false, error: 'timeout' };
    if (err?.cause?.code === 'ECONNREFUSED') return { ok: false, error: 'refused' };
    return { ok: false, error: 'network' };
  } finally {
    clearTimeout(timer);
  }
}
