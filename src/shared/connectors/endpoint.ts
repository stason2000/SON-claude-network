/**
 * User-editable endpoint rules for self-hosted API connectors (e.g. FreeLLMAPI).
 *
 * A key is sent to whatever address is stored here, so only two shapes are
 * accepted:
 *   - http://localhost / 127.0.0.1 / [::1]  (a server on THIS computer; plain
 *     http never leaves the machine)
 *   - https://<any host>                    (encrypted, user typed it on purpose)
 * Everything else — file:, javascript:, ftp:, plain http to another host,
 * embedded user:password, query strings, fragments — is refused.
 *
 * Shared + dependency-free (URL is a global in Node and the browser).
 */

export type EndpointError = 'empty' | 'too-long' | 'invalid' | 'scheme' | 'http-remote' | 'credentials' | 'query';

export const LOOPBACK_HOSTS: readonly string[] = ['localhost', '127.0.0.1', '[::1]'];

/** Normalized endpoint (no trailing slash) or an error code. */
export function validateConnectorEndpoint(raw: unknown): { ok: true; url: string } | { ok: false; error: EndpointError } {
  if (typeof raw !== 'string') return { ok: false, error: 'empty' };
  const s = raw.trim();
  if (!s) return { ok: false, error: 'empty' };
  if (s.length > 512) return { ok: false, error: 'too-long' };
  if (/[\s\\]/.test(s)) return { ok: false, error: 'invalid' };
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return { ok: false, error: 'invalid' };
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, error: 'scheme' };
  if (!u.hostname) return { ok: false, error: 'invalid' };
  if (u.username || u.password) return { ok: false, error: 'credentials' };
  if (u.search || u.hash || s.includes('?') || s.includes('#')) return { ok: false, error: 'query' };
  if (u.protocol === 'http:' && !LOOPBACK_HOSTS.includes(u.hostname.toLowerCase())) {
    return { ok: false, error: 'http-remote' };
  }
  return { ok: true, url: u.toString().replace(/\/+$/, '') };
}
