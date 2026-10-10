/**
 * <workspace home>/michael-rules.md — the user's editable operating rules for
 * Michael. Seeded from resources/michael-rules.default.ko.md the first time it is
 * read (NEVER overwrites an existing file). Read/written only through the small
 * IPC surface below; the renderer never passes a path, and the resolved path is
 * re-checked to sit directly inside the workspace home (a symlinked file or home
 * pointing elsewhere is refused).
 *
 * Electron-free so node --test can drive it; index.ts supplies the paths.
 */
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join, relative, resolve, isAbsolute } from 'node:path';
import { RULES_FILE_NAME } from '../shared/michaelSeed';

/** Hard cap on what the editor may save (the seed itself caps at 12k chars). */
export const RULES_MAX_BYTES = 200_000;

export type RulesResult = { ok: true; text: string; path: string; createdFromDefault?: boolean } | { ok: false; error: string };

/** Absolute path of the rules file inside `home`, or null if it would escape. */
export function rulesPathIn(home: string | null | undefined, name = RULES_FILE_NAME): string | null {
  if (typeof home !== 'string' || !home.trim() || !isAbsolute(home)) return null;
  if (name.includes('/') || name.includes('\\') || name.includes('..')) return null;
  const base = resolve(home);
  const p = resolve(base, name);
  const rel = relative(base, p);
  if (!rel || rel.startsWith('..') || isAbsolute(rel) || rel.includes('/') || rel.includes('\\')) return null;
  // Symlink guard: the real home must contain the real file (when it exists).
  try {
    if (existsSync(p)) {
      if (lstatSync(p).isSymbolicLink()) return null;
      const realRel = relative(realpathSync(base), realpathSync(p));
      if (realRel.startsWith('..') || isAbsolute(realRel)) return null;
    }
  } catch { return null; }
  return p;
}

/** Copy the default into place if the file is absent. Returns true when it copied. */
export function ensureRulesFile(home: string | null | undefined, defaultPath: string): boolean {
  const p = rulesPathIn(home);
  if (!p || existsSync(p)) return false;
  if (!existsSync(defaultPath)) return false;
  mkdirSync(dirname(p), { recursive: true });
  // COPYFILE_EXCL: never clobber a file that appeared between the check and the copy.
  try { copyFileSync(defaultPath, p, 1 /* fs.constants.COPYFILE_EXCL */); return true; } catch { return false; }
}

export function readRules(home: string | null | undefined, defaultPath: string): RulesResult {
  const p = rulesPathIn(home);
  if (!p) return { ok: false, error: 'no workspace home' };
  const created = ensureRulesFile(home, defaultPath);
  if (!existsSync(p)) return { ok: false, error: 'rules file missing and default not found' };
  try {
    return { ok: true, text: readFileSync(p, 'utf8'), path: p, ...(created ? { createdFromDefault: true } : {}) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function writeRules(home: string | null | undefined, text: unknown): RulesResult {
  const p = rulesPathIn(home);
  if (!p) return { ok: false, error: 'no workspace home' };
  if (typeof text !== 'string') return { ok: false, error: 'text required' };
  if (Buffer.byteLength(text, 'utf8') > RULES_MAX_BYTES) return { ok: false, error: 'rules too large' };
  const tmp = `${p}.tmp-${Math.random().toString(36).slice(2, 10)}`;
  try {
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(tmp, text, 'utf8');
    renameSync(tmp, p);
    return { ok: true, text, path: p };
  } catch (e) {
    try { rmSync(tmp, { force: true }); } catch { /* disposable */ }
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Overwrite with the shipped default (the renderer confirms with the user first). */
export function resetRules(home: string | null | undefined, defaultPath: string): RulesResult {
  if (!existsSync(defaultPath)) return { ok: false, error: 'default rules not found' };
  return writeRules(home, readFileSync(defaultPath, 'utf8'));
}

type IpcLike = { handle(channel: string, fn: (evt: unknown, ...args: unknown[]) => unknown): void };

export const RULES_CHANNELS = { get: 'michaelRules:get', set: 'michaelRules:set', reset: 'michaelRules:reset' } as const;

/** Register the three handlers. No channel accepts a path. */
export function registerMichaelRulesIpc(ipc: IpcLike, getHome: () => string | null, defaultPath: () => string): void {
  ipc.handle(RULES_CHANNELS.get, () => readRules(getHome(), defaultPath()));
  ipc.handle(RULES_CHANNELS.set, (_evt, text) => writeRules(getHome(), text));
  ipc.handle(RULES_CHANNELS.reset, () => resetRules(getHome(), defaultPath()));
}

/** Default file location: packaged = extraResources root; dev = repo resources/. */
export function defaultRulesPath(opts: { packaged: boolean; resourcesPath: string; appPath: string }): string {
  return opts.packaged
    ? join(opts.resourcesPath, 'michael-rules.default.ko.md')
    : join(opts.appPath, 'resources', 'michael-rules.default.ko.md');
}
