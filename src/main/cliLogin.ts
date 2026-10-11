/**
 * "로그인" for CLI agents: open a SEPARATE terminal window that runs the CLI's own
 * official sign-in flow (src/shared/connectors/<id>.ts → `login`).
 *
 * Security / privacy shape:
 *  - The renderer sends only a connector id. The binary names and arguments are
 *    trusted constants from the registry; nothing the renderer types reaches a shell.
 *  - The app never reads, receives or stores the credentials. The CLI writes its
 *    login where it always does (e.g. ~/.codex/auth.json, the OS keyring), so an
 *    agent started afterwards is already signed in.
 *  - Nothing is installed: a missing CLI returns 'not-installed' and the UI shows
 *    the official install docs link.
 *
 * Electron-free (spawn / resolve / platform injected) so it is unit-testable.
 */
import { getConnector, type CliConnector } from '../shared/connectors';

export type LoginLaunchError = 'unknown-connector' | 'no-login' | 'not-installed' | 'no-terminal' | 'spawn-failed';

export type LoginLaunchResult =
  | { ok: true; mode: 'command' | 'first-run'; command: string; inside?: string }
  | { ok: false; error: LoginLaunchError; docsUrl?: string };

export interface TerminalLaunch {
  command: string;
  args: string[];
  windowsVerbatimArguments?: boolean;
}

const WIN_TITLE = 'SON AI Office login';
/** Characters that would change meaning inside cmd.exe or a POSIX/AppleScript
 *  string. A resolved path containing any of them is not used verbatim; the bare
 *  (trusted) binary name is used instead and PATH resolves it. */
const UNSAFE_PATH = /["'`$&|<>^%!;\r\n]/;
const SAFE_BIN = /^[A-Za-z0-9._-]+$/;

export function safeExecutable(resolved: string | null | undefined, bin: string, platform: NodeJS.Platform = process.platform): string {
  if (!SAFE_BIN.test(bin)) throw new Error('unsafe binary name');
  if (!resolved || UNSAFE_PATH.test(resolved)) return bin;
  // `where claude` can list npm's extensionless POSIX shim first; cmd.exe cannot
  // run that, so on Windows only a real .exe/.cmd/.bat path is used verbatim.
  if (platform === 'win32' && !/\.(exe|cmd|bat)$/i.test(resolved)) return bin;
  return resolved;
}

/** POSIX single-quote one word. */
const shq = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

/** Linux terminal emulators we know how to drive, in preference order. */
export const LINUX_TERMINALS: readonly { bin: string; pre: string[] }[] = [
  { bin: 'x-terminal-emulator', pre: ['-e'] },
  { bin: 'gnome-terminal', pre: ['--'] },
  { bin: 'konsole', pre: ['-e'] },
  { bin: 'xfce4-terminal', pre: ['-x'] },
  { bin: 'xterm', pre: ['-e'] }
];

/**
 * The OS command that opens a NEW terminal window running `exe args…`, leaving
 * the window open afterwards so the person can read the result.
 * `linuxTerminal` = the first LINUX_TERMINALS entry found (null → cannot open).
 */
export function buildLoginTerminalLaunch(
  platform: NodeJS.Platform,
  exe: string,
  args: readonly string[],
  linuxTerminal?: { bin: string; pre: string[] } | null
): TerminalLaunch | null {
  for (const a of args) if (!SAFE_BIN.test(a)) throw new Error('unsafe login argument');
  if (platform === 'win32') {
    // cmd.exe /d /s /c start "<title>" cmd.exe /k ""<exe>" <args>"
    // The inner /k keeps the window open. Passed verbatim (Node must not re-quote).
    const inner = `""${exe}"${args.length ? ` ${args.join(' ')}` : ''}"`;
    return {
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', `start "${WIN_TITLE}" cmd.exe /k ${inner}`],
      windowsVerbatimArguments: true
    };
  }
  const line = [shq(exe), ...args].join(' ');
  if (platform === 'darwin') {
    const as = line.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return {
      command: 'osascript',
      args: ['-e', `tell application "Terminal" to do script "${as}"`, '-e', 'tell application "Terminal" to activate']
    };
  }
  if (!linuxTerminal) return null;
  const script = `${line}; echo; printf '%s' 'Enter: close / 엔터: 닫기 '; read _`;
  return { command: linuxTerminal.bin, args: [...linuxTerminal.pre, 'sh', '-c', script] };
}

export interface LoginDeps {
  platform: NodeJS.Platform;
  /** Absolute path of `bin` on this machine, or null when it is not installed. */
  resolve: (bin: string) => string | null;
  /** Start the terminal process detached. Resolves false if it failed to start. */
  start: (launch: TerminalLaunch) => Promise<boolean>;
}

export function cliLoginSpecFor(connectorId: unknown): CliConnector | undefined {
  if (typeof connectorId !== 'string') return undefined;
  const c = getConnector(connectorId);
  return c && c.kind === 'cli' ? c : undefined;
}

export async function launchCliLogin(connectorId: unknown, deps: LoginDeps): Promise<LoginLaunchResult> {
  const c = cliLoginSpecFor(connectorId);
  if (!c) return { ok: false, error: 'unknown-connector' };
  const login = c.login;
  if (!login) return { ok: false, error: 'no-login', docsUrl: c.docsUrl };
  let bin: string | undefined;
  let resolved: string | null = null;
  for (const b of login.bins) {
    const r = deps.resolve(b);
    if (r) { bin = b; resolved = r; break; }
  }
  if (!bin) return { ok: false, error: 'not-installed', docsUrl: c.docsUrl };
  let launch: TerminalLaunch | null;
  try {
    const exe = safeExecutable(resolved, bin, deps.platform);
    let term: { bin: string; pre: string[] } | null = null;
    if (deps.platform !== 'win32' && deps.platform !== 'darwin') {
      term = LINUX_TERMINALS.find((t) => !!deps.resolve(t.bin)) ?? null;
    }
    launch = buildLoginTerminalLaunch(deps.platform, exe, login.args, term);
  } catch {
    return { ok: false, error: 'spawn-failed', docsUrl: c.docsUrl };
  }
  if (!launch) return { ok: false, error: 'no-terminal', docsUrl: c.docsUrl };
  const started = await deps.start(launch);
  if (!started) return { ok: false, error: 'spawn-failed', docsUrl: c.docsUrl };
  return {
    ok: true,
    mode: login.mode,
    command: [bin, ...login.args].join(' '),
    ...(login.inside ? { inside: login.inside } : {})
  };
}
