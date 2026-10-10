/**
 * Electron wiring for Google-Drive settings sync (#10).
 *
 * Renderer surface (the COMPLETE list — see SYNC_CHANNELS): status, save
 * client id/secret (write-only), clear them, login / cancel login, logout,
 * sync now, options, resolve conflicts, and the read-only Korean text
 * overrides. No channel returns a token, the client secret or an API key.
 */
import { app, BrowserWindow, safeStorage, shell } from 'electron';
import { readFileSync, lstatSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { join } from 'node:path';
import { createApiKeyStore, type ApiKeyStore } from '../apiKeys';
import { readConfig, writeConfig } from '../config';
import { rulesPathIn } from '../michaelRules';
import { connectorsByKind } from '../../shared/connectors';
import { I18N_OVERRIDES_FILE } from '../../shared/sync/items';
import { I18N_OVERRIDES_MAX_BYTES, sanitizeI18nOverrides, type NestedStrings } from '../../shared/sync/i18nOverrides';
import type { HarnessConfig } from '../config';
import { createLocalAdapter, type ApiKeyBridge } from './localAdapter';
import { createSyncService, type SyncService } from './service';
import type { FetchLike } from './googleAuth';

export const SYNC_CHANNELS = {
  status: 'sync:status',
  setCredentials: 'sync:setCredentials',
  clearCredentials: 'sync:clearCredentials',
  login: 'sync:login',
  cancelLogin: 'sync:cancelLogin',
  logout: 'sync:logout',
  now: 'sync:now',
  setOptions: 'sync:setOptions',
  resolve: 'sync:resolve',
  resolveAll: 'sync:resolveAll',
  koOverrides: 'i18n:koOverrides',
  changed: 'sync:changed'
} as const;

const AUTO_SYNC_EVERY_MS = 15 * 60_000;
const AUTO_SYNC_FIRST_MS = 20_000;

type IpcLike = { handle(channel: string, fn: (evt: unknown, ...args: unknown[]) => unknown): void };

/** `<workspace>/i18n-overrides.ko.json`, sanitized; {} when absent/invalid. */
export function readKoOverrides(home: string | null | undefined): NestedStrings {
  const p = rulesPathIn(home, I18N_OVERRIDES_FILE);
  if (!p) return {};
  try {
    const st = lstatSync(p);
    if (!st.isFile() || st.size > I18N_OVERRIDES_MAX_BYTES) return {};
    return sanitizeI18nOverrides(JSON.parse(readFileSync(p, 'utf8'))).tree;
  } catch {
    return {};
  }
}

export interface InitSyncOptions {
  ipc: IpcLike;
  apiKeyStore: ApiKeyStore;
  /** BYOK provider keys held in the integrations broker (apikey:<backend>). */
  providerKeys: { backends: string[]; get(backend: string): string | undefined; set(backend: string, key: string): void };
  /** Re-arm whatever reads config.missions after remote triggers were applied. */
  onTriggersApplied(): void;
}

export function initSync(opts: InitSyncOptions): SyncService {
  const userData = app.getPath('userData');
  const secrets = createApiKeyStore({
    filePath: () => join(userData, 'google-sync-secrets.json'),
    crypto: {
      isAvailable: () => safeStorage.isEncryptionAvailable(),
      encrypt: (s) => safeStorage.encryptString(s),
      decrypt: (b) => safeStorage.decryptString(b)
    }
  });

  const apiKeys: ApiKeyBridge = {
    exportAll() {
      const out: Record<string, string> = {};
      for (const c of connectorsByKind('api')) {
        const k = opts.apiKeyStore.getKeyForSpawn(c.id);
        if (k) out[`connector:${c.id}`] = k;
      }
      for (const b of opts.providerKeys.backends) {
        const k = opts.providerKeys.get(b);
        if (k) out[`provider:${b}`] = k;
      }
      return out;
    },
    importAll(keys) {
      const api = new Set(connectorsByKind('api').map((c) => c.id));
      for (const [id, key] of Object.entries(keys)) {
        const [kind, name] = id.split(':');
        if (kind === 'connector' && api.has(name)) opts.apiKeyStore.setKey(name, key);
        else if (kind === 'provider' && opts.providerKeys.backends.includes(name)) opts.providerKeys.set(name, key);
      }
    }
  };

  const local = createLocalAdapter({
    getWorkspace: () => readConfig().harnessHome,
    userHome: () => homedir(),
    readConfig: () => readConfig() as unknown as Record<string, unknown>,
    writeConfig: (patch) => { writeConfig(patch as Partial<HarnessConfig>); },
    apiKeys,
    fallbackBackupDir: join(userData, 'sync-conflicts'),
    onApplied: (category) => {
      if (category === 'triggers') {
        try { opts.onTriggersApplied(); } catch { /* scheduler re-arm is best effort */ }
      }
    }
  });

  const broadcast = (status: unknown): void => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (w.isDestroyed() || w.webContents.isDestroyed()) continue;
      w.webContents.send(SYNC_CHANNELS.changed, status);
    }
  };

  const service = createSyncService({
    secrets,
    fetch: ((url, init) => fetch(url, init as RequestInit)) as FetchLike,
    // Only ever hand Google's own authorization page to the system browser.
    openExternal: (url) => (url.startsWith('https://accounts.google.com/') ? shell.openExternal(url) : undefined),
    local,
    statePath: join(userData, 'sync-state.json'),
    hostName: safeHostname(),
    onStatus: broadcast
  });

  const { ipc } = opts;
  ipc.handle(SYNC_CHANNELS.status, () => service.status());
  ipc.handle(SYNC_CHANNELS.setCredentials, (_e, p) => service.setCredentials(p));
  ipc.handle(SYNC_CHANNELS.clearCredentials, () => service.clearCredentials());
  ipc.handle(SYNC_CHANNELS.login, () => service.login());
  ipc.handle(SYNC_CHANNELS.cancelLogin, () => { service.cancelLogin(); return service.status(); });
  ipc.handle(SYNC_CHANNELS.logout, () => service.logout());
  ipc.handle(SYNC_CHANNELS.now, (_e, p) => service.syncNow(p));
  ipc.handle(SYNC_CHANNELS.setOptions, (_e, p) => service.setOptions(p));
  ipc.handle(SYNC_CHANNELS.resolve, (_e, p) => service.resolve(p));
  ipc.handle(SYNC_CHANNELS.resolveAll, (_e, p) => service.resolveAll(p));
  ipc.handle(SYNC_CHANNELS.koOverrides, () => readKoOverrides(readConfig().harnessHome));

  // Auto-sync (off by default): once shortly after start, then every 15 minutes.
  void app.whenReady().then(() => {
    setTimeout(() => { void service.autoTick(); }, AUTO_SYNC_FIRST_MS).unref?.();
    setInterval(() => { void service.autoTick(); }, AUTO_SYNC_EVERY_MS).unref?.();
  });

  return service;
}

function safeHostname(): string {
  try { return hostname().slice(0, 64) || 'device'; } catch { return 'device'; }
}
