/**
 * Google OAuth 2.0 for installed (desktop) apps — main process only.
 *
 * Follows https://developers.google.com/identity/protocols/oauth2/native-app :
 *   1. PKCE: a random code_verifier (43–128 chars of [A-Za-z0-9-._~]) and
 *      code_challenge = BASE64URL(SHA256(verifier)), method S256.
 *   2. Open https://accounts.google.com/o/oauth2/v2/auth in the SYSTEM browser
 *      with client_id, redirect_uri, response_type=code, scope, code_challenge,
 *      code_challenge_method=S256 and a random `state`.
 *   3. Loopback redirect: listen on http://127.0.0.1:<random port>/<path>.
 *      Only GET on the exact path counts; a wrong/missing `state` is answered 400
 *      and IGNORED (the flow keeps waiting for the real callback); the listener
 *      closes right after the real callback and times out after 3 minutes.
 *   4. POST https://oauth2.googleapis.com/token with code, client_id,
 *      client_secret, code_verifier, grant_type=authorization_code, redirect_uri.
 *   5. Refresh: POST the same endpoint with grant_type=refresh_token.
 *   6. Logout: POST https://oauth2.googleapis.com/revoke (best effort).
 *
 * The ONLY scope ever requested is drive.appdata. If the user's grant does not
 * include it (granular consent), login fails with `scopeDenied`.
 *
 * Nothing in here logs, and no thrown error carries a token or server body.
 */
import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { SyncError } from './errors';

export const DRIVE_APPDATA_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
export const LOGIN_TIMEOUT_MS = 3 * 60_000;
export const CALLBACK_PATH = '/oauth2callback';

export type FetchLike = (url: string, init?: {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  signal?: AbortSignal;
}) => Promise<{ ok: boolean; status: number; text(): Promise<string>; arrayBuffer(): Promise<ArrayBuffer> }>;

const b64url = (b: Buffer): string => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** 64 chars of base64url = 48 random bytes; within RFC 7636's 43..128 and charset. */
export function generateVerifier(): string {
  return b64url(randomBytes(48));
}

export function challengeS256(verifier: string): string {
  return b64url(createHash('sha256').update(verifier, 'ascii').digest());
}

export function generateState(): string {
  return b64url(randomBytes(24));
}

export function buildAuthUrl(p: {
  clientId: string; redirectUri: string; challenge: string; state: string; authUrl?: string;
}): string {
  const u = new URL(p.authUrl ?? GOOGLE_AUTH_URL);
  u.searchParams.set('client_id', p.clientId);
  u.searchParams.set('redirect_uri', p.redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', DRIVE_APPDATA_SCOPE);
  u.searchParams.set('code_challenge', p.challenge);
  u.searchParams.set('code_challenge_method', 'S256');
  u.searchParams.set('state', p.state);
  return u.toString();
}

const PAGE = (title: string, body: string): string =>
  `<!doctype html><html lang="ko"><meta charset="utf-8"><title>${title}</title>` +
  `<body style="font-family:sans-serif;padding:40px;text-align:center"><h2>${title}</h2><p>${body}</p></body></html>`;

export interface LoopbackHandle {
  redirectUri: string;
  /** Resolves with the authorization code; rejects with SyncError. */
  code: Promise<string>;
  close(): void;
}

/** Start the one-shot loopback listener on 127.0.0.1 (random port). */
export function startLoopback(opts: { expectedState: string; timeoutMs?: number; host?: string }): Promise<LoopbackHandle> {
  const host = opts.host ?? '127.0.0.1';
  return new Promise((resolveStart, rejectStart) => {
    let settle!: { resolve: (c: string) => void; reject: (e: SyncError) => void };
    const code = new Promise<string>((resolve, reject) => { settle = { resolve, reject }; });
    code.catch(() => { /* observed by the caller; avoid unhandled rejection */ });
    let done = false;
    let timer: NodeJS.Timeout | undefined;
    const server: Server = createServer((req, res) => {
      if (done) { res.writeHead(410).end(); return; }
      let url: URL;
      try { url = new URL(req.url ?? '/', `http://${host}`); } catch { res.writeHead(400).end(); return; }
      if (req.method !== 'GET' || url.pathname !== CALLBACK_PATH) { res.writeHead(404).end(); return; }
      const state = url.searchParams.get('state');
      if (state !== opts.expectedState) {
        // Not our callback (or forged). Refuse it but keep waiting for the real one.
        res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' })
          .end(PAGE('잘못된 요청', '이 창을 닫고 앱에서 다시 시도해 주세요.'));
        return;
      }
      const err = url.searchParams.get('error');
      const c = url.searchParams.get('code');
      finish();
      if (err || !c) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
          .end(PAGE('로그인이 취소되었습니다', '이 창을 닫고 앱으로 돌아가세요.'));
        settle.reject(new SyncError('loginDenied'));
      } else {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
          .end(PAGE('로그인 완료', '이 창을 닫고 SON AI Office 앱으로 돌아가세요.'));
        settle.resolve(c);
      }
    });
    const finish = (): void => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      server.close();
      // Drop keep-alive sockets so the port is released immediately.
      (server as Server & { closeAllConnections?: () => void }).closeAllConnections?.();
    };
    server.on('error', (e) => { if (!done) { finish(); rejectStart(new SyncError('loginFailed')); } void e; });
    server.listen(0, host, () => {
      const port = (server.address() as AddressInfo).port;
      timer = setTimeout(() => { finish(); settle.reject(new SyncError('loginTimeout')); }, opts.timeoutMs ?? LOGIN_TIMEOUT_MS);
      resolveStart({
        redirectUri: `http://${host}:${port}${CALLBACK_PATH}`,
        code,
        close: () => { if (!done) { finish(); settle.reject(new SyncError('loginDenied')); } }
      });
    });
  });
}

export interface TokenResponse {
  accessToken: string;
  expiresAt: number;
  refreshToken?: string;
}

async function postForm(fetchFn: FetchLike, url: string, form: Record<string, string>): Promise<{ status: number; json: Record<string, unknown> | null }> {
  let r;
  try {
    r = await fetchFn(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString()
    });
  } catch {
    throw new SyncError('network');
  }
  let json: Record<string, unknown> | null = null;
  try { json = JSON.parse(await r.text()); } catch { json = null; }
  return { status: r.status, json };
}

function parseToken(json: Record<string, unknown> | null, now: number): TokenResponse {
  const at = json?.access_token;
  const exp = json?.expires_in;
  if (typeof at !== 'string' || !at) throw new SyncError('loginFailed');
  return {
    accessToken: at,
    expiresAt: now + (typeof exp === 'number' && exp > 0 ? exp : 3600) * 1000,
    refreshToken: typeof json?.refresh_token === 'string' ? json.refresh_token : undefined
  };
}

export async function exchangeCode(p: {
  fetch: FetchLike; tokenUrl?: string; clientId: string; clientSecret?: string;
  code: string; verifier: string; redirectUri: string; now?: () => number;
}): Promise<TokenResponse> {
  const form: Record<string, string> = {
    code: p.code,
    client_id: p.clientId,
    code_verifier: p.verifier,
    grant_type: 'authorization_code',
    redirect_uri: p.redirectUri
  };
  if (p.clientSecret) form.client_secret = p.clientSecret;
  const { status, json } = await postForm(p.fetch, p.tokenUrl ?? GOOGLE_TOKEN_URL, form);
  if (status !== 200) throw new SyncError(status >= 500 ? 'server' : 'loginFailed', status);
  // Granular consent: the user may untick the one permission we asked for.
  const scope = typeof json?.scope === 'string' ? json.scope.split(/\s+/) : [DRIVE_APPDATA_SCOPE];
  if (!scope.includes(DRIVE_APPDATA_SCOPE)) throw new SyncError('scopeDenied');
  return parseToken(json, (p.now ?? Date.now)());
}

export async function refreshAccessToken(p: {
  fetch: FetchLike; tokenUrl?: string; clientId: string; clientSecret?: string; refreshToken: string; now?: () => number;
}): Promise<TokenResponse> {
  const form: Record<string, string> = {
    client_id: p.clientId,
    refresh_token: p.refreshToken,
    grant_type: 'refresh_token'
  };
  if (p.clientSecret) form.client_secret = p.clientSecret;
  const { status, json } = await postForm(p.fetch, p.tokenUrl ?? GOOGLE_TOKEN_URL, form);
  if (status === 400 || status === 401) {
    // invalid_grant: revoked, expired (e.g. 7-day limit of a "Testing" app) → log in again.
    throw new SyncError('authExpired', status);
  }
  if (status !== 200) throw new SyncError(status >= 500 ? 'server' : 'authExpired', status);
  return parseToken(json, (p.now ?? Date.now)());
}

export async function revokeToken(p: { fetch: FetchLike; revokeUrl?: string; token: string }): Promise<void> {
  try { await postForm(p.fetch, p.revokeUrl ?? GOOGLE_REVOKE_URL, { token: p.token }); } catch { /* best effort */ }
}

/** Client id shape for a Google OAuth client ("…apps.googleusercontent.com"). */
export function validateClientId(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return /^[A-Za-z0-9._-]{8,200}\.apps\.googleusercontent\.com$/.test(s) ? s : null;
}

export function validateClientSecret(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return /^[\x21-\x7e]{8,200}$/.test(s) ? s : null;
}
