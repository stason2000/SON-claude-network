/**
 * API-connector key store (main process only).
 *
 * Keys for 'api' connectors (src/shared/connectors) are ENCRYPTED AT REST with
 * Electron `safeStorage` and kept as base64 ciphertext in
 * `<userData>/connector-keys.json` (mode 0600). Plaintext is never written to
 * disk: if OS encryption is unavailable, setKey FAILS CLOSED.
 *
 * Exposure rules:
 *   - The renderer surface (registerApiKeyIpc → preload) is set / has / clear ONLY.
 *     Every reply is `{ ok, error? }` or a boolean; no channel returns key bytes.
 *   - getKeyForSpawn() is main-internal: called only when spawning an API agent,
 *     whose key rides a child-process env var (see apiAgent.ts).
 *   - Nothing here logs a key, and error strings never include one.
 *
 * The store itself is electron-free (crypto + file path injected) so it is
 * unit-testable under plain node; electronApiKeyStore() binds the real safeStorage.
 */
import { app, safeStorage } from 'electron';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface KeyCrypto {
  isAvailable(): boolean;
  encrypt(plaintext: string): Buffer;
  decrypt(cipher: Buffer): string;
}

export interface ApiKeyStore {
  setKey(connectorId: string, key: string): { ok: boolean; error?: string };
  hasKey(connectorId: string): boolean;
  clearKey(connectorId: string): { ok: boolean; error?: string };
  /** MAIN-INTERNAL. Decrypted key for a spawn, or undefined. Never expose over IPC. */
  getKeyForSpawn(connectorId: string): string | undefined;
}

/** A key is a single line of printable ASCII (header-safe), 8..4096 chars. */
export function validateKeyShape(key: unknown): string | null {
  if (typeof key !== 'string') return 'key required';
  const k = key.trim();
  if (k.length < 8) return 'key too short';
  if (k.length > 4096) return 'key too long';
  if (!/^[\x21-\x7e]+$/.test(k)) return 'key must be one line of printable ASCII (no spaces)';
  return null;
}

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export function createApiKeyStore(deps: { filePath: () => string; crypto: KeyCrypto }): ApiKeyStore {
  const read = (): Record<string, string> => {
    const p = deps.filePath();
    if (!existsSync(p)) return {};
    try {
      const parsed = JSON.parse(readFileSync(p, 'utf8'));
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, string>) : {};
    } catch {
      return {};
    }
  };
  const write = (blob: Record<string, string>): void => {
    const p = deps.filePath();
    if (Object.keys(blob).length === 0) {
      rmSync(p, { force: true });
      return;
    }
    mkdirSync(dirname(p), { recursive: true });
    const tmp = `${p}.tmp`;
    writeFileSync(tmp, JSON.stringify(blob, null, 2), { encoding: 'utf8', mode: 0o600 });
    renameSync(tmp, p);
  };

  return {
    setKey(connectorId, key) {
      if (!ID_RE.test(connectorId)) return { ok: false, error: 'invalid connector id' };
      const bad = validateKeyShape(key);
      if (bad) return { ok: false, error: bad };
      try {
        if (!deps.crypto.isAvailable()) {
          return { ok: false, error: 'OS secret encryption is unavailable; refusing to store the key in plaintext' };
        }
        const cipher = deps.crypto.encrypt(key.trim()).toString('base64');
        const blob = read();
        blob[connectorId] = cipher;
        write(blob);
        return { ok: true };
      } catch {
        // Deliberately generic: an exception message could quote its input.
        return { ok: false, error: 'failed to store the key' };
      }
    },
    hasKey(connectorId) {
      return ID_RE.test(connectorId) && typeof read()[connectorId] === 'string';
    },
    clearKey(connectorId) {
      if (!ID_RE.test(connectorId)) return { ok: false, error: 'invalid connector id' };
      try {
        const blob = read();
        if (connectorId in blob) {
          delete blob[connectorId];
          write(blob);
        }
        return { ok: true };
      } catch {
        return { ok: false, error: 'failed to clear the key' };
      }
    },
    getKeyForSpawn(connectorId) {
      const cipher = ID_RE.test(connectorId) ? read()[connectorId] : undefined;
      if (!cipher) return undefined;
      try {
        if (!deps.crypto.isAvailable()) return undefined;
        return deps.crypto.decrypt(Buffer.from(cipher, 'base64'));
      } catch {
        return undefined;
      }
    }
  };
}

/** The production store: Electron safeStorage + a file under userData. */
export function electronApiKeyStore(): ApiKeyStore {
  return createApiKeyStore({
    filePath: () => join(app.getPath('userData'), 'connector-keys.json'),
    crypto: {
      isAvailable: () => safeStorage.isEncryptionAvailable(),
      encrypt: (s) => safeStorage.encryptString(s),
      decrypt: (b) => safeStorage.decryptString(b)
    }
  });
}

/** IPC channel names — the COMPLETE renderer surface. There is no get channel. */
export const API_KEY_CHANNELS = {
  set: 'connectorKey:set',
  has: 'connectorKey:has',
  clear: 'connectorKey:clear'
} as const;

/** The renderer-facing handlers (what IPC exposes). Returns only booleans / status. */
export function rendererKeyApi(store: ApiKeyStore, isApiConnector: (id: string) => boolean) {
  return {
    set(payload: unknown): { ok: boolean; error?: string } {
      const p = (payload ?? {}) as { id?: unknown; key?: unknown };
      if (typeof p.id !== 'string' || !isApiConnector(p.id)) return { ok: false, error: 'unknown API connector' };
      const r = store.setKey(p.id, typeof p.key === 'string' ? p.key : '');
      return r.ok ? { ok: true } : { ok: false, error: r.error };
    },
    has(id: unknown): boolean {
      return typeof id === 'string' && isApiConnector(id) && store.hasKey(id);
    },
    clear(id: unknown): { ok: boolean; error?: string } {
      if (typeof id !== 'string' || !isApiConnector(id)) return { ok: false, error: 'unknown API connector' };
      const r = store.clearKey(id);
      return r.ok ? { ok: true } : { ok: false, error: r.error };
    }
  };
}

type IpcLike = { handle(channel: string, fn: (evt: unknown, ...args: unknown[]) => unknown): void };

export function registerApiKeyIpc(ipc: IpcLike, store: ApiKeyStore, isApiConnector: (id: string) => boolean): void {
  const api = rendererKeyApi(store, isApiConnector);
  ipc.handle(API_KEY_CHANNELS.set, (_evt, payload) => api.set(payload));
  ipc.handle(API_KEY_CHANNELS.has, (_evt, id) => api.has(id));
  ipc.handle(API_KEY_CHANNELS.clear, (_evt, id) => api.clear(id));
}
