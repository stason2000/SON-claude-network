import type { SyncErrorCode } from '../../shared/sync/status';

/**
 * The only error type that leaves the sync modules. Its message is the CODE
 * (never a server body, a URL with a query, or a token) so it is safe to log
 * and safe to send to the renderer, which translates the code to plain Korean.
 */
export class SyncError extends Error {
  readonly code: SyncErrorCode;
  readonly status?: number;
  constructor(code: SyncErrorCode, status?: number) {
    super(code);
    this.name = 'SyncError';
    this.code = code;
    this.status = status;
  }
}

export function toSyncError(e: unknown): SyncError {
  if (e instanceof SyncError) return e;
  return new SyncError('unknown');
}
