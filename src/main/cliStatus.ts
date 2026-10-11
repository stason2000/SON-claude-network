/**
 * "Is this CLI agent signed in?" for the AI 연결 window.
 *
 *  - Binary lookup only (is it on PATH?) for every CLI connector → 'not-installed'.
 *  - When — and only when — the connector's registry entry carries a `login.status`
 *    spec read from the CLI's official docs (claude `auth status`, codex `login
 *    status`), that READ-ONLY command is run with a short timeout, stdin/stdout/
 *    stderr ignored (the app never reads its output, so no account details or
 *    tokens reach it), nothing opened or installed. Only the exit code is used.
 *  - Everything else → 'unknown' and the UI falls back to the manual "연결했어요".
 *
 * Electron-free (resolve / run injected) so it is unit-testable.
 */
import type { CliCheckResult } from '../shared/connectors';
import { cliLoginSpecFor, safeExecutable } from './cliLogin';

export interface StatusLaunch {
  command: string;
  args: string[];
  windowsVerbatimArguments?: boolean;
}

export interface StatusRunResult {
  /** Exit code, or null when the process could not start / was killed. */
  code: number | null;
  timedOut?: boolean;
}

export interface CliStatusDeps {
  platform: NodeJS.Platform;
  resolve: (bin: string) => string | null;
  /** Run without a window, all stdio ignored, killed after timeoutMs. */
  run: (launch: StatusLaunch, timeoutMs: number) => Promise<StatusRunResult>;
  timeoutMs?: number;
}

const SAFE_ARG = /^[A-Za-z0-9._-]+$/;

/** The process to spawn for `exe args…`. Windows goes through cmd.exe because
 *  npm installs CLIs as .cmd shims, which Node cannot spawn directly. */
export function buildStatusLaunch(platform: NodeJS.Platform, exe: string, args: readonly string[]): StatusLaunch {
  for (const a of args) if (!SAFE_ARG.test(a)) throw new Error('unsafe status argument');
  if (platform === 'win32') {
    return {
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', `""${exe}"${args.length ? ` ${args.join(' ')}` : ''}"`],
      windowsVerbatimArguments: true
    };
  }
  return { command: exe, args: [...args] };
}

export async function checkCliConnection(connectorId: unknown, deps: CliStatusDeps): Promise<CliCheckResult> {
  const c = cliLoginSpecFor(connectorId);
  if (!c || !c.login) return { state: 'unknown', auto: false };
  let bin: string | undefined;
  let resolved: string | null = null;
  for (const b of c.login.bins) {
    const r = deps.resolve(b);
    if (r) { bin = b; resolved = r; break; }
  }
  if (!bin) return { state: 'not-installed', auto: false };
  const status = c.login.status;
  if (!status) return { state: 'unknown', auto: false };
  let launch: StatusLaunch;
  try {
    launch = buildStatusLaunch(deps.platform, safeExecutable(resolved, bin, deps.platform), status.args);
  } catch {
    return { state: 'unknown', auto: false };
  }
  let res: StatusRunResult;
  try {
    res = await deps.run(launch, deps.timeoutMs ?? 6000);
  } catch {
    return { state: 'unknown', auto: false };
  }
  if (res.timedOut || res.code === null) return { state: 'unknown', auto: false };
  if (res.code === 0) return { state: 'connected', auto: true };
  if (status.loggedOutCodes.includes(res.code)) return { state: 'not-connected', auto: true };
  return { state: 'unknown', auto: false };
}
