/**
 * The sync service (#10): credentials, Google login session, options, and the
 * renderer-facing operations. Electron-free (all I/O injected) so the whole
 * surface — including "no token or secret ever leaves" — is testable.
 *
 * Secrets (client id, client secret, refresh token) live in an ApiKeyStore —
 * the same safeStorage-encrypted, mode-0600, write-only store pattern as the
 * connector keys (src/main/apiKeys.ts), in its own file. The access token is
 * kept in memory only. Every reply is a SyncReply: booleans, times, codes and
 * conflict previews — never a credential.
 */
import type { ApiKeyStore } from '../apiKeys';
import { DEFAULT_CATEGORIES, SYNC_CATEGORIES, sanitizeDeviceLabel, type CategoryToggles } from '../../shared/sync/items';
import type { SyncErrorCode, SyncReply, SyncStatus } from '../../shared/sync/status';
import { createDriveClient } from './driveClient';
import { SyncError, toSyncError } from './errors';
import {
  GOOGLE_AUTH_URL, GOOGLE_REVOKE_URL, GOOGLE_TOKEN_URL, LOGIN_TIMEOUT_MS, buildAuthUrl, challengeS256, exchangeCode,
  generateState, generateVerifier, refreshAccessToken, revokeToken, startLoopback, validateClientId, validateClientSecret,
  type FetchLike
} from './googleAuth';
import type { LocalAdapter } from './localAdapter';
import { createSyncEngine, loadState, saveState } from './syncEngine';

export const SECRET_IDS = {
  clientId: 'google-client-id',
  clientSecret: 'google-client-secret',
  refreshToken: 'google-refresh-token'
} as const;

export interface SyncServiceDeps {
  secrets: ApiKeyStore;
  fetch: FetchLike;
  openExternal(url: string): Promise<unknown> | unknown;
  local: LocalAdapter;
  statePath: string;
  hostName: string;
  urls?: { auth?: string; token?: string; revoke?: string; api?: string };
  loginTimeoutMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Called whenever the status may have changed (push to windows). */
  onStatus?(status: SyncStatus): void;
}

export function createSyncService(deps: SyncServiceDeps) {
  const now = deps.now ?? Date.now;
  let access: { token: string; expiresAt: number } | null = null;
  let loginInProgress = false;
  let pendingLoginClose: (() => void) | null = null;

  const secret = (id: string): string | undefined => deps.secrets.getKeyForSpawn(id);

  async function getAccessToken(force: boolean): Promise<string> {
    if (!force && access && access.expiresAt - 60_000 > now()) return access.token;
    const clientId = secret(SECRET_IDS.clientId);
    const refreshToken = secret(SECRET_IDS.refreshToken);
    if (!clientId) throw new SyncError('noCredentials');
    if (!refreshToken) throw new SyncError('notLoggedIn');
    try {
      const t = await refreshAccessToken({
        fetch: deps.fetch, tokenUrl: deps.urls?.token ?? GOOGLE_TOKEN_URL, clientId,
        clientSecret: secret(SECRET_IDS.clientSecret), refreshToken, now
      });
      access = { token: t.accessToken, expiresAt: t.expiresAt };
      if (t.refreshToken) deps.secrets.setKey(SECRET_IDS.refreshToken, t.refreshToken);
      return t.accessToken;
    } catch (e) {
      const se = toSyncError(e);
      if (se.code === 'authExpired') {
        // The grant is gone (revoked / 7-day testing expiry): forget it so the UI asks to log in.
        access = null;
        deps.secrets.clearKey(SECRET_IDS.refreshToken);
      }
      throw se;
    }
  }

  const drive = createDriveClient({ fetch: deps.fetch, apiBase: deps.urls?.api, getAccessToken, sleep: deps.sleep });
  const engine = createSyncEngine({ statePath: deps.statePath, hostName: deps.hostName, local: deps.local, drive: () => drive, now });

  function status(): SyncStatus {
    const st = loadState(deps.statePath);
    return {
      hasClientId: deps.secrets.hasKey(SECRET_IDS.clientId),
      hasClientSecret: deps.secrets.hasKey(SECRET_IDS.clientSecret),
      loggedIn: deps.secrets.hasKey(SECRET_IDS.refreshToken),
      loginInProgress,
      syncing: engine.busy,
      lastSyncAt: st.lastSyncAt,
      lastError: st.lastError ? { code: st.lastError.code, at: st.lastError.at } : null,
      lastResult: st.lastResult,
      autoSync: st.autoSync,
      categories: { ...st.categories },
      deviceLabel: st.deviceLabel ?? deps.hostName,
      hostName: deps.hostName,
      apiKeySync: st.apiKeySync,
      conflicts: st.conflicts.map((c) => c.view)
    };
  }

  function push(): void {
    try { deps.onStatus?.(status()); } catch { /* a window going away is not an error */ }
  }

  async function reply(fn: () => Promise<unknown> | unknown): Promise<SyncReply> {
    try {
      await fn();
      push();
      return { ok: true, status: status() };
    } catch (e) {
      const se = toSyncError(e);
      push();
      return { ok: false, code: se.code, status: status() };
    }
  }

  function recordError(code: SyncErrorCode): void {
    const st = loadState(deps.statePath);
    st.lastError = { code, at: now() };
    saveState(deps.statePath, st);
  }

  async function login(): Promise<void> {
    if (loginInProgress) throw new SyncError('loginInProgress');
    const clientId = secret(SECRET_IDS.clientId);
    if (!clientId) throw new SyncError('noCredentials');
    loginInProgress = true;
    push();
    try {
      const verifier = generateVerifier();
      const state = generateState();
      const lb = await startLoopback({ expectedState: state, timeoutMs: deps.loginTimeoutMs ?? LOGIN_TIMEOUT_MS });
      pendingLoginClose = lb.close;
      try {
        const url = buildAuthUrl({ clientId, redirectUri: lb.redirectUri, challenge: challengeS256(verifier), state, authUrl: deps.urls?.auth ?? GOOGLE_AUTH_URL });
        await deps.openExternal(url);
        const code = await lb.code;
        const t = await exchangeCode({
          fetch: deps.fetch, tokenUrl: deps.urls?.token ?? GOOGLE_TOKEN_URL, clientId,
          clientSecret: secret(SECRET_IDS.clientSecret), code, verifier, redirectUri: lb.redirectUri, now
        });
        if (!t.refreshToken) throw new SyncError('loginFailed');
        const r = deps.secrets.setKey(SECRET_IDS.refreshToken, t.refreshToken);
        if (!r.ok) throw new SyncError('encryptionUnavailable');
        access = { token: t.accessToken, expiresAt: t.expiresAt };
        const st = loadState(deps.statePath);
        if (st.lastError && ['authExpired', 'notLoggedIn', 'noCredentials'].includes(st.lastError.code)) {
          st.lastError = null;
          saveState(deps.statePath, st);
        }
      } finally {
        lb.close();
        pendingLoginClose = null;
      }
    } catch (e) {
      const se = toSyncError(e);
      recordError(se.code);
      throw se;
    } finally {
      loginInProgress = false;
    }
  }

  return {
    status,
    async setCredentials(payload: unknown): Promise<SyncReply> {
      return reply(() => {
        const p = (payload ?? {}) as { clientId?: unknown; clientSecret?: unknown };
        if (p.clientId === undefined && p.clientSecret === undefined) throw new SyncError('invalidInput');
        const id = p.clientId === undefined ? undefined : validateClientId(p.clientId);
        const sec = p.clientSecret === undefined ? undefined : validateClientSecret(p.clientSecret);
        if (id === null || sec === null) throw new SyncError('invalidInput');
        for (const [k, v] of [[SECRET_IDS.clientId, id], [SECRET_IDS.clientSecret, sec]] as const) {
          if (v === undefined) continue;
          const r = deps.secrets.setKey(k, v);
          if (!r.ok) throw new SyncError('encryptionUnavailable');
        }
        // New client = old grant is meaningless.
        if (id !== undefined) { access = null; deps.secrets.clearKey(SECRET_IDS.refreshToken); }
      });
    },
    async clearCredentials(): Promise<SyncReply> {
      return reply(() => {
        access = null;
        for (const k of Object.values(SECRET_IDS)) deps.secrets.clearKey(k);
      });
    },
    login: (): Promise<SyncReply> => reply(login),
    cancelLogin(): void { pendingLoginClose?.(); },
    async logout(): Promise<SyncReply> {
      return reply(async () => {
        const rt = secret(SECRET_IDS.refreshToken);
        access = null;
        deps.secrets.clearKey(SECRET_IDS.refreshToken);
        if (rt) await revokeToken({ fetch: deps.fetch, revokeUrl: deps.urls?.revoke ?? GOOGLE_REVOKE_URL, token: rt });
        // Another account may log in next: start the three-way base over.
        const st = loadState(deps.statePath);
        st.base = {};
        st.conflicts = [];
        st.lastError = null;
        saveState(deps.statePath, st);
      });
    },
    async syncNow(payload?: unknown): Promise<SyncReply> {
      return reply(async () => {
        const p = (payload ?? {}) as { passphrase?: unknown };
        if (!secret(SECRET_IDS.clientId)) throw new SyncError('noCredentials');
        if (!deps.secrets.hasKey(SECRET_IDS.refreshToken)) throw new SyncError('notLoggedIn');
        const passphrase = typeof p.passphrase === 'string' && p.passphrase ? p.passphrase : undefined;
        await engine.sync({ passphrase });
      });
    },
    async setOptions(payload: unknown): Promise<SyncReply> {
      return reply(() => {
        const p = (payload ?? {}) as { autoSync?: unknown; apiKeySync?: unknown; deviceLabel?: unknown; categories?: unknown };
        const st = loadState(deps.statePath);
        if (typeof p.autoSync === 'boolean') st.autoSync = p.autoSync;
        if (typeof p.apiKeySync === 'boolean') st.apiKeySync = p.apiKeySync;
        if (p.deviceLabel !== undefined) {
          const l = sanitizeDeviceLabel(p.deviceLabel);
          if (!l) throw new SyncError('invalidInput');
          st.deviceLabel = l;
        }
        if (p.categories && typeof p.categories === 'object') {
          const next: CategoryToggles = { ...DEFAULT_CATEGORIES, ...st.categories };
          for (const c of SYNC_CATEGORIES) {
            const v = (p.categories as Record<string, unknown>)[c];
            if (typeof v === 'boolean') next[c] = v;
          }
          st.categories = next;
        }
        saveState(deps.statePath, st);
      });
    },
    async resolve(payload: unknown): Promise<SyncReply> {
      return reply(async () => {
        const p = (payload ?? {}) as { key?: unknown; choice?: unknown; passphrase?: unknown };
        if (typeof p.key !== 'string' || (p.choice !== 'local' && p.choice !== 'remote')) throw new SyncError('invalidInput');
        await engine.resolve(p.key, p.choice, { passphrase: typeof p.passphrase === 'string' && p.passphrase ? p.passphrase : undefined });
      });
    },
    async resolveAll(payload: unknown): Promise<SyncReply> {
      return reply(async () => {
        const p = (payload ?? {}) as { choice?: unknown; passphrase?: unknown };
        if (p.choice !== 'local' && p.choice !== 'remote') throw new SyncError('invalidInput');
        const r = await engine.resolveAll(p.choice, { passphrase: typeof p.passphrase === 'string' && p.passphrase ? p.passphrase : undefined });
        if (r.failed > 0) throw new SyncError('conflictChanged');
      });
    },
    /** Timer entry point: silent, never throws. API keys are skipped (no passphrase). */
    async autoTick(): Promise<void> {
      const st = loadState(deps.statePath);
      if (!st.autoSync || engine.busy || loginInProgress) return;
      if (!deps.secrets.hasKey(SECRET_IDS.clientId) || !deps.secrets.hasKey(SECRET_IDS.refreshToken)) return;
      try { await engine.sync({}); } catch { /* recorded in state.lastError */ }
      push();
    }
  };
}

export type SyncService = ReturnType<typeof createSyncService>;
