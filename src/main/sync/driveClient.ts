/**
 * Minimal Google Drive v3 client for the appDataFolder ONLY (#10).
 *
 * Every call is scoped to the hidden app-data space:
 *   list    GET  {api}/drive/v3/files?spaces=appDataFolder&fields=nextPageToken,files(id,name,modifiedTime,size)&pageToken=…
 *   get     GET  {api}/drive/v3/files/{id}?alt=media
 *   create  POST {api}/upload/drive/v3/files?uploadType=multipart   metadata {name, parents:['appDataFolder']}
 *   update  PATCH {api}/upload/drive/v3/files/{id}?uploadType=media
 *   delete  DELETE {api}/drive/v3/files/{id}
 *
 * `fetch` and the base URL are injectable so tests run against a local mock.
 * 401 → force-refresh the access token and retry ONCE. 429/5xx → one delayed
 * retry. Errors become SyncError codes; server bodies are inspected only for a
 * reason code and never copied into a message.
 */
import { SyncError } from './errors';
import type { FetchLike } from './googleAuth';

export const DRIVE_API_BASE = 'https://www.googleapis.com';
const FILE_ID_RE = /^[A-Za-z0-9_-]{1,200}$/;

export interface DriveFile {
  id: string;
  name: string;
  modifiedTime?: string;
  size?: number;
}

export interface DriveClient {
  list(): Promise<DriveFile[]>;
  download(id: string, maxBytes: number): Promise<Buffer>;
  create(name: string, content: Buffer, mimeType?: string): Promise<DriveFile>;
  update(id: string, content: Buffer, mimeType?: string): Promise<DriveFile>;
  remove(id: string): Promise<void>;
}

export interface DriveDeps {
  fetch: FetchLike;
  apiBase?: string;
  /** force=true after a 401: refresh even if the cached token looks valid. */
  getAccessToken(force: boolean): Promise<string>;
  sleep?: (ms: number) => Promise<void>;
  maxPages?: number;
}

function reasonOf(body: string): string {
  try {
    const j = JSON.parse(body);
    const e = j?.error;
    const r = e?.errors?.[0]?.reason ?? e?.status ?? '';
    const details = Array.isArray(e?.details) ? e.details.map((d: { reason?: string }) => d?.reason ?? '').join(' ') : '';
    return `${r} ${details}`;
  } catch { return ''; }
}

function mapError(status: number, body: string): SyncError {
  const reason = reasonOf(body);
  if (status === 401) return new SyncError('authExpired', status);
  if (status === 403) {
    if (/accessNotConfigured|SERVICE_DISABLED/i.test(reason)) return new SyncError('apiDisabled', status);
    if (/storageQuotaExceeded|quotaExceeded/i.test(reason)) return new SyncError('quota', status);
    if (/rateLimitExceeded|userRateLimitExceeded/i.test(reason)) return new SyncError('rateLimit', status);
    if (/insufficientPermissions|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(reason)) return new SyncError('scopeDenied', status);
    return new SyncError('forbidden', status);
  }
  if (status === 404) return new SyncError('notFound', status);
  if (status === 429) return new SyncError('rateLimit', status);
  if (status >= 500) return new SyncError('server', status);
  return new SyncError('unknown', status);
}

export function createDriveClient(deps: DriveDeps): DriveClient {
  const api = (deps.apiBase ?? DRIVE_API_BASE).replace(/\/+$/, '');
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  async function call(method: string, url: string, body?: Buffer | string, headers: Record<string, string> = {}) {
    let forced = false;
    let retried = false;
    for (;;) {
      const token = await deps.getAccessToken(forced);
      let r;
      try {
        r = await deps.fetch(url, {
          method,
          headers: { ...headers, authorization: `Bearer ${token}` },
          body: body === undefined ? undefined : (typeof body === 'string' ? body : new Uint8Array(body))
        });
      } catch {
        if (!retried) { retried = true; await sleep(1000); continue; }
        throw new SyncError('network');
      }
      if (r.ok) return r;
      const text = await r.text().catch(() => '');
      if (r.status === 401 && !forced) { forced = true; continue; }
      if ((r.status === 429 || r.status >= 500) && !retried) { retried = true; await sleep(1500); continue; }
      throw mapError(r.status, text);
    }
  }

  const fileOf = (j: Record<string, unknown>): DriveFile => {
    if (typeof j.id !== 'string' || !FILE_ID_RE.test(j.id)) throw new SyncError('badRemote');
    return {
      id: j.id,
      name: typeof j.name === 'string' ? j.name : '',
      modifiedTime: typeof j.modifiedTime === 'string' ? j.modifiedTime : undefined,
      size: typeof j.size === 'string' || typeof j.size === 'number' ? Number(j.size) : undefined
    };
  };
  const json = async (r: { text(): Promise<string> }): Promise<Record<string, unknown>> => {
    try { return JSON.parse(await r.text()); } catch { throw new SyncError('badRemote'); }
  };
  const checkId = (id: string): string => {
    if (!FILE_ID_RE.test(id)) throw new SyncError('badRemote');
    return encodeURIComponent(id);
  };

  return {
    async list() {
      const out: DriveFile[] = [];
      let pageToken: string | undefined;
      const maxPages = deps.maxPages ?? 100;
      for (let page = 0; page < maxPages; page++) {
        const u = new URL(`${api}/drive/v3/files`);
        u.searchParams.set('spaces', 'appDataFolder');
        u.searchParams.set('fields', 'nextPageToken,files(id,name,modifiedTime,size)');
        u.searchParams.set('pageSize', '1000');
        if (pageToken) u.searchParams.set('pageToken', pageToken);
        const j = await json(await call('GET', u.toString()));
        const files = Array.isArray(j.files) ? j.files : [];
        for (const f of files) {
          try { out.push(fileOf(f as Record<string, unknown>)); } catch { /* skip malformed */ }
        }
        pageToken = typeof j.nextPageToken === 'string' && j.nextPageToken ? j.nextPageToken : undefined;
        if (!pageToken) return out;
      }
      throw new SyncError('badRemote');
    },
    async download(id, maxBytes) {
      const r = await call('GET', `${api}/drive/v3/files/${checkId(id)}?alt=media`);
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > maxBytes) throw new SyncError('tooLarge');
      return buf;
    },
    async create(name, content, mimeType = 'application/octet-stream') {
      const boundary = `son-sync-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
      const meta = JSON.stringify({ name, parents: ['appDataFolder'] });
      const body = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`, 'utf8'),
        content,
        Buffer.from(`\r\n--${boundary}--`, 'utf8')
      ]);
      const r = await call('POST', `${api}/upload/drive/v3/files?uploadType=multipart&fields=id,name,modifiedTime,size`, body,
        { 'content-type': `multipart/related; boundary=${boundary}` });
      return fileOf(await json(r));
    },
    async update(id, content, mimeType = 'application/octet-stream') {
      const r = await call('PATCH', `${api}/upload/drive/v3/files/${checkId(id)}?uploadType=media&fields=id,name,modifiedTime,size`, content,
        { 'content-type': mimeType });
      return fileOf(await json(r));
    },
    async remove(id) {
      try {
        await call('DELETE', `${api}/drive/v3/files/${checkId(id)}`);
      } catch (e) {
        if (e instanceof SyncError && e.code === 'notFound') return; // already gone
        throw e;
      }
    }
  };
}
