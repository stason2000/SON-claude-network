/**
 * What the renderer may see about sync. Deliberately contains NO token, NO
 * client secret, NO client id value and NO API key — only booleans, times,
 * error CODES (translated in the UI) and conflict previews of the user's own
 * synced text.
 */
import type { CategoryToggles, ItemCategory } from './items';
import type { ConflictKind } from './decide';
import type { DiffSummary } from './preview';

export const SYNC_ERROR_CODES = [
  'noCredentials', 'notLoggedIn', 'loginInProgress', 'loginTimeout', 'loginDenied', 'loginFailed',
  'scopeDenied', 'authExpired', 'apiDisabled', 'forbidden', 'quota', 'rateLimit', 'notFound',
  'server', 'network', 'badRemote', 'tooLarge', 'wrongPassphrase', 'passphraseRequired',
  'passphraseTooShort', 'encryptionUnavailable', 'noWorkspace', 'busy', 'invalidInput',
  'conflictChanged', 'writeFailed', 'unknown'
] as const;
export type SyncErrorCode = (typeof SYNC_ERROR_CODES)[number];

export interface ConflictSide {
  exists: boolean;
  deviceLabel: string;
  deviceHost: string;
  modifiedTime: number | null;
  preview: string;
}

export interface ConflictView {
  key: string;
  category: ItemCategory;
  kind: ConflictKind;
  local: ConflictSide;
  remote: ConflictSide;
  summary: DiffSummary;
  detectedAt: number;
}

export interface SyncResultCounts {
  uploaded: number;
  downloaded: number;
  conflicts: number;
  skipped: number;
  unchanged: number;
}

export interface SyncStatus {
  hasClientId: boolean;
  hasClientSecret: boolean;
  loggedIn: boolean;
  loginInProgress: boolean;
  syncing: boolean;
  lastSyncAt: number | null;
  lastError: { code: SyncErrorCode; at: number; detail?: string } | null;
  lastResult: SyncResultCounts | null;
  autoSync: boolean;
  categories: CategoryToggles;
  deviceLabel: string;
  hostName: string;
  apiKeySync: boolean;
  conflicts: ConflictView[];
}

export type SyncReply = { ok: true; status: SyncStatus } | { ok: false; code: SyncErrorCode; status: SyncStatus };
