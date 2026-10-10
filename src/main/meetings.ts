/**
 * Meeting transcription (#6) — session + transcript file owner (MAIN process).
 *
 * OFF by default: nothing starts until the user has accepted the disclosure
 * (`meetingsConsent`) and a Groq key is present. The renderer records ONLY the
 * user's own microphone in ~30 s segments and hands each segment's bytes over
 * IPC; this module transcribes them in order via the existing Groq Whisper path
 * (./freeflow.ts) and appends timestamped lines to
 *   <harnessHome>/meetings/<YYYY-MM-DD>-<HHmm>-<title>.md
 *
 * Guarantees:
 *  - The Groq key is read from main config and passed only to transcribeWithGroq.
 *    It is never returned, logged or written; failure reasons are scrubbed of it.
 *  - The file path is built from a sanitized title, confined to <home>/meetings
 *    (no traversal, no symlinked folder/file) and created exclusively ('wx').
 *  - Each segment is ONE append call on an O_APPEND file, and segments are
 *    serialized, so lines never interleave and stay in recording order.
 *  - A segment that fails is written as `[전사 실패: 구간 mm:ss–mm:ss]`; a hole in
 *    the timeline is written as `[녹음 누락: …]`. Nothing is dropped silently.
 *  - Raw audio is written to disk only when the user ticked "keep audio";
 *    otherwise it exists only in memory until its transcription returns.
 *  - Meeting length (3 h), chunk size and chunk count are capped.
 *
 * Deliberately free of `electron` imports so node:test can load it.
 */
import { appendFileSync, lstatSync, mkdirSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { transcribeWithGroq, DEFAULT_GROQ_MODEL, type TranscribeOptions, type TranscribeResult } from './freeflow';
import { LOCAL_UNAVAILABLE_REASON } from './transcribe';
import {
  MEETING_GAP_TOLERANCE_MS,
  MEETING_MAX_CHUNK_BYTES,
  MEETING_MAX_CHUNKS,
  MEETING_MAX_MS,
  formatFooter,
  formatHeader,
  formatSegment,
  isMeetingFileName,
  meetingFileName,
  sanitizeMeetingTitle,
  scrubSecret,
  type MeetingActiveInfo,
  type MeetingFileInfo,
  type MeetingStatus,
  type SegmentResult
} from '../shared/meetings';

export interface MeetingConfig {
  harnessHome?: string | null;
  groqApiKey?: string;
  freeflowModel?: string;
  meetingsConsent?: boolean;
  meetingsKeepAudio?: boolean;
}

export interface MeetingDeps {
  readConfig: () => MeetingConfig;
  writeConfig?: (patch: { meetingsConsent?: boolean; meetingsKeepAudio?: boolean }) => unknown;
  transcribe?: (opts: TranscribeOptions) => Promise<TranscribeResult>;
  now?: () => number;
}

type Reply<T = object> = ({ ok: true } & T) | { ok: false; error: string };

interface Session {
  id: string;
  title: string;
  fileName: string;
  filePath: string;
  audioDir: string | null;
  startedAt: number;
  keepAudio: boolean;
  lastSeq: number;
  lastEndMs: number;
  chunks: number;
  segments: number;
  failed: number;
  gaps: number;
  pending: Map<number, { startMs: number; endMs: number }>;
  preview: string[];
  queue: Promise<void>;
  stopping: boolean;
}

const PREVIEW_LINES = 40;
const MAX_SEGMENT_SPAN_MS = 5 * 60 * 1000;

/** `<home>/meetings`, confined to `home`. Creates it when `create` is set.
 *  Throws on a relative home, a symlinked meetings folder, or any escape. */
export function resolveMeetingsDir(home: string | null | undefined, create = true): string {
  if (typeof home !== 'string' || !home.trim() || !isAbsolute(home)) {
    throw new Error('작업 공간 폴더가 정해지지 않았습니다');
  }
  const root = resolve(home);
  const dir = join(root, 'meetings');
  if (create) mkdirSync(dir, { recursive: true });
  const st = lstatSync(dir);
  if (st.isSymbolicLink() || !st.isDirectory()) throw new Error('meetings 폴더가 일반 폴더가 아닙니다');
  const realRoot = realpathSync(root);
  const realDir = realpathSync(dir);
  if (realDir !== join(realRoot, 'meetings')) throw new Error('meetings 폴더가 작업 공간 밖을 가리킵니다');
  return dir;
}

/** Join a bare transcript file name onto the meetings folder; refuse anything
 *  that is not exactly one file directly inside it. */
export function confinedMeetingPath(dir: string, name: string): string {
  if (!isMeetingFileName(name) || basename(name) !== name) throw new Error('잘못된 회의 파일 이름');
  const p = resolve(dir, name);
  if (dirname(p) !== resolve(dir) || !p.startsWith(resolve(dir) + sep)) throw new Error('회의 폴더 밖 경로');
  return p;
}

function ensurePlainFile(p: string): void {
  const st = lstatSync(p);
  if (st.isSymbolicLink() || !st.isFile()) throw new Error('녹취 파일이 일반 파일이 아닙니다');
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function createMeetingManager(deps: MeetingDeps) {
  const transcribe = deps.transcribe ?? transcribeWithGroq;
  const now = deps.now ?? (() => Date.now());
  let session: Session | null = null;
  let seq = 0;

  /** Every error string that leaves this module goes through here. */
  const safe = (msg: string): string => scrubSecret(msg, deps.readConfig().groqApiKey);
  const fail = (msg: string): { ok: false; error: string } => ({ ok: false, error: safe(msg) });

  function append(s: Session, text: string): void {
    ensurePlainFile(s.filePath);
    appendFileSync(s.filePath, text, { encoding: 'utf8', flag: 'a' });
  }

  function record(s: Session, seg: SegmentResult): void {
    const line = formatSegment(seg);
    append(s, line);
    if (seg.kind === 'failed') s.failed += 1;
    else if (seg.kind === 'gap') s.gaps += 1;
    s.segments += seg.kind === 'gap' ? 0 : 1;
    s.preview.push(line.trim());
    if (s.preview.length > PREVIEW_LINES) s.preview.splice(0, s.preview.length - PREVIEW_LINES);
  }

  function activeInfo(s: Session): MeetingActiveInfo {
    return {
      id: s.id,
      title: s.title,
      fileName: s.fileName,
      filePath: s.filePath,
      startedAt: s.startedAt,
      elapsedMs: Math.max(0, now() - s.startedAt),
      segments: s.segments,
      failed: s.failed,
      gaps: s.gaps,
      pending: s.pending.size,
      keepAudio: s.keepAudio,
      preview: [...s.preview]
    };
  }

  function status(): MeetingStatus {
    const cfg = deps.readConfig();
    let meetingsDir: string | null = null;
    try { meetingsDir = resolveMeetingsDir(cfg.harnessHome, false); } catch { meetingsDir = null; }
    const hasGroqKey = !!cfg.groqApiKey;
    return {
      consent: cfg.meetingsConsent === true,
      keepAudio: cfg.meetingsKeepAudio === true,
      hasGroqKey,
      engines: [
        { id: 'local', available: false, external: false, reason: LOCAL_UNAVAILABLE_REASON },
        hasGroqKey
          ? { id: 'groq', available: true, external: true }
          : { id: 'groq', available: false, external: true, reason: 'Groq API 키가 없습니다(설정 → 음성에서 입력).' }
      ],
      meetingsDir,
      maxMs: MEETING_MAX_MS,
      active: session ? activeInfo(session) : null
    };
  }

  function setPrefs(patch: unknown): MeetingStatus {
    const p = (patch ?? {}) as { consent?: unknown; keepAudio?: unknown };
    const next: { meetingsConsent?: boolean; meetingsKeepAudio?: boolean } = {};
    if (typeof p.consent === 'boolean') next.meetingsConsent = p.consent;
    // The keep-audio choice is fixed for a running meeting (it is in the header).
    if (typeof p.keepAudio === 'boolean' && !session) next.meetingsKeepAudio = p.keepAudio;
    if (Object.keys(next).length) deps.writeConfig?.(next);
    return status();
  }

  function start(arg: unknown): Reply<{ id: string; fileName: string; filePath: string; startedAt: number }> {
    const cfg = deps.readConfig();
    if (cfg.meetingsConsent !== true) return fail('먼저 안내를 읽고 동의해 주세요');
    if (!cfg.groqApiKey) return fail('Groq API 키가 없습니다(설정 → 음성에서 입력)');
    if (session) return fail('이미 녹음 중인 회의가 있습니다');
    const a = (arg ?? {}) as { title?: unknown };
    const title = sanitizeMeetingTitle(a.title);
    let dir: string;
    try { dir = resolveMeetingsDir(cfg.harnessHome, true); } catch (e) { return fail(errMsg(e)); }

    const startedAt = now();
    const keepAudio = cfg.meetingsKeepAudio === true;
    const displayTitle = typeof a.title === 'string' && a.title.trim() ? a.title.trim().slice(0, 120).replace(/\s+/g, ' ') : title;
    let fileName = '';
    let filePath = '';
    for (let n = 1; n <= 50; n += 1) {
      fileName = meetingFileName(new Date(startedAt), title, n);
      try {
        filePath = confinedMeetingPath(dir, fileName);
        writeFileSync(filePath, formatHeader({ title: displayTitle, startedAt: new Date(startedAt), engine: `Groq Whisper (${cfg.freeflowModel || DEFAULT_GROQ_MODEL})`, keepAudio }), { encoding: 'utf8', flag: 'wx' });
        break;
      } catch (e) {
        filePath = '';
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') return fail(`녹취 파일을 만들지 못했습니다: ${errMsg(e)}`);
      }
    }
    if (!filePath) return fail('같은 이름의 녹취 파일이 너무 많습니다');

    let audioDir: string | null = null;
    if (keepAudio) {
      audioDir = filePath.replace(/\.md$/, '-audio');
      try { mkdirSync(audioDir); } catch (e) { return fail(`오디오 폴더를 만들지 못했습니다: ${errMsg(e)}`); }
    }
    seq += 1;
    session = {
      id: `m${startedAt.toString(36)}${seq}`,
      title: displayTitle,
      fileName,
      filePath,
      audioDir,
      startedAt,
      keepAudio,
      lastSeq: -1,
      lastEndMs: 0,
      chunks: 0,
      segments: 0,
      failed: 0,
      gaps: 0,
      pending: new Map(),
      preview: [],
      queue: Promise.resolve(),
      stopping: false
    };
    return { ok: true, id: session.id, fileName, filePath, startedAt };
  }

  async function processChunk(s: Session, seqNo: number, startMs: number, endMs: number, audio: Uint8Array, mimeType: string): Promise<void> {
    const cfg = deps.readConfig();
    try {
      if (startMs > s.lastEndMs + MEETING_GAP_TOLERANCE_MS) {
        record(s, { kind: 'gap', startMs: s.lastEndMs, endMs: startMs });
      }
      s.lastEndMs = Math.max(s.lastEndMs, endMs);
      if (s.audioDir && audio.byteLength > 0) {
        try {
          const ext = mimeType.includes('ogg') ? 'ogg' : 'webm';
          writeFileSync(join(s.audioDir, `${String(seqNo).padStart(4, '0')}.${ext}`), audio, { flag: 'wx' });
        } catch { /* keeping audio is best-effort; the transcript is the record */ }
      }
      let seg: SegmentResult;
      if (audio.byteLength === 0) {
        seg = { kind: 'failed', startMs, endMs, reason: '녹음된 오디오가 비어 있음' };
      } else if (!cfg.groqApiKey) {
        seg = { kind: 'failed', startMs, endMs, reason: 'Groq API 키 없음' };
      } else {
        let r: TranscribeResult;
        try {
          r = await transcribe({
            apiKey: cfg.groqApiKey,
            audio,
            mimeType,
            filename: `meeting-${seqNo}.${mimeType.includes('ogg') ? 'ogg' : 'webm'}`,
            model: cfg.freeflowModel || DEFAULT_GROQ_MODEL
          });
        } catch (e) {
          r = { ok: false, error: errMsg(e) };
        }
        if (r.ok && r.text) seg = { kind: 'text', startMs, endMs, text: r.text };
        else if (r.error === 'no speech detected') seg = { kind: 'silence', startMs, endMs };
        else seg = { kind: 'failed', startMs, endMs, reason: safe(r.error || '알 수 없는 오류') };
      }
      record(s, seg);
    } catch (e) {
      // Even the append failed (disk full, file removed). Keep the count honest;
      // the reply and status carry it to the UI.
      s.failed += 1;
      s.preview.push(`[전사 실패: 기록 오류] ${safe(errMsg(e))}`);
    } finally {
      s.pending.delete(seqNo);
    }
  }

  async function chunk(arg: unknown): Promise<Reply<{ preview: string[]; capped: boolean }>> {
    const s = session;
    const a = (arg ?? {}) as { id?: unknown; seq?: unknown; startMs?: unknown; endMs?: unknown; audio?: unknown; mimeType?: unknown };
    if (!s || a.id !== s.id) return fail('녹음 중인 회의가 아닙니다');
    if (s.stopping) return fail('회의가 끝나는 중입니다');
    const seqNo = typeof a.seq === 'number' && Number.isInteger(a.seq) ? a.seq : NaN;
    if (!(seqNo > s.lastSeq)) return fail('구간 번호가 올바르지 않습니다');
    let startMs = typeof a.startMs === 'number' && Number.isFinite(a.startMs) ? Math.max(0, a.startMs) : NaN;
    let endMs = typeof a.endMs === 'number' && Number.isFinite(a.endMs) ? a.endMs : NaN;
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs || endMs - startMs > MAX_SEGMENT_SPAN_MS) {
      return fail('구간 시간이 올바르지 않습니다');
    }
    let audio: Uint8Array;
    if (a.audio instanceof Uint8Array) audio = a.audio;
    else if (a.audio instanceof ArrayBuffer) audio = new Uint8Array(a.audio);
    else if (a.audio === undefined || a.audio === null) audio = new Uint8Array(0);
    else return fail('오디오 형식이 올바르지 않습니다');
    s.lastSeq = seqNo;
    s.chunks += 1;

    let capped = false;
    if (startMs >= MEETING_MAX_MS || s.chunks > MEETING_MAX_CHUNKS) {
      capped = true;
      await stop({ id: s.id, reason: '최대 녹음 길이(3시간)에 도달해 자동으로 멈췄습니다' });
      return { ok: true, preview: [], capped };
    }
    if (endMs > MEETING_MAX_MS) { endMs = MEETING_MAX_MS; capped = true; }
    startMs = Math.min(startMs, endMs);

    s.pending.set(seqNo, { startMs, endMs });
    const mimeType = typeof a.mimeType === 'string' && /^audio\/[a-z0-9.+-]+(;.*)?$/i.test(a.mimeType) ? a.mimeType : 'audio/webm';
    let job: Promise<void>;
    if (audio.byteLength > MEETING_MAX_CHUNK_BYTES) {
      const big = audio.byteLength;
      audio = new Uint8Array(0);
      job = s.queue.then(() => {
        try { record(s, { kind: 'failed', startMs, endMs, reason: `구간이 너무 큼(${Math.round(big / 1024 / 1024)}MB)` }); } catch { s.failed += 1; }
        s.lastEndMs = Math.max(s.lastEndMs, endMs);
        s.pending.delete(seqNo);
      });
    } else {
      job = s.queue.then(() => processChunk(s, seqNo, startMs, endMs, audio, mimeType));
    }
    s.queue = job;
    await job;
    if (capped) await stop({ id: s.id, reason: '최대 녹음 길이(3시간)에 도달해 자동으로 멈췄습니다' });
    return { ok: true, preview: [...s.preview], capped };
  }

  async function stop(arg: unknown): Promise<Reply<{ fileName: string; filePath: string; durationMs: number; failed: number; gaps: number }>> {
    const s = session;
    const a = (arg ?? {}) as { id?: unknown; reason?: unknown; endMs?: unknown };
    if (!s || a.id !== s.id) return fail('녹음 중인 회의가 아닙니다');
    if (s.stopping) {
      await s.queue;
      return { ok: true, fileName: s.fileName, filePath: s.filePath, durationMs: s.lastEndMs, failed: s.failed, gaps: s.gaps };
    }
    s.stopping = true;
    await s.queue;
    const durationMs = Math.min(MEETING_MAX_MS, Math.max(s.lastEndMs, typeof a.endMs === 'number' && Number.isFinite(a.endMs) ? a.endMs : 0));
    try {
      if (durationMs > s.lastEndMs + MEETING_GAP_TOLERANCE_MS) record(s, { kind: 'gap', startMs: s.lastEndMs, endMs: durationMs });
      append(s, formatFooter({
        durationMs,
        segments: s.segments,
        failed: s.failed,
        gaps: s.gaps,
        reason: typeof a.reason === 'string' ? safe(a.reason) : undefined
      }));
    } catch { /* the file may be gone; the reply still reports */ }
    if (session === s) session = null;
    return { ok: true, fileName: s.fileName, filePath: s.filePath, durationMs, failed: s.failed, gaps: s.gaps };
  }

  /** App quit: write still-pending segments as failures and close the file,
   *  synchronously. */
  function shutdown(): void {
    const s = session;
    if (!s) return;
    session = null;
    try {
      for (const [, r] of s.pending) record(s, { kind: 'failed', startMs: r.startMs, endMs: r.endMs, reason: '앱 종료로 전사가 끝나지 않음' });
      append(s, formatFooter({ durationMs: s.lastEndMs, segments: s.segments, failed: s.failed, gaps: s.gaps, reason: '앱이 종료되어 녹음이 멈췄습니다' }));
    } catch { /* best effort at quit */ }
  }

  function list(): Reply<{ files: MeetingFileInfo[]; dir: string }> {
    const cfg = deps.readConfig();
    let dir: string;
    try { dir = resolveMeetingsDir(cfg.harnessHome, false); } catch { return { ok: true, files: [], dir: '' }; }
    const files: MeetingFileInfo[] = [];
    for (const name of readdirSync(dir)) {
      if (!isMeetingFileName(name)) continue;
      try {
        const p = confinedMeetingPath(dir, name);
        const st = lstatSync(p);
        if (!st.isFile()) continue;
        files.push({ name, path: p, size: st.size, mtimeMs: st.mtimeMs });
      } catch { /* skip */ }
    }
    files.sort((x, y) => y.name.localeCompare(x.name));
    return { ok: true, files: files.slice(0, 100), dir };
  }

  /** Validated absolute path for a listed transcript (for open/summarize). */
  function pathFor(name: unknown): Reply<{ path: string }> {
    const cfg = deps.readConfig();
    try {
      const dir = resolveMeetingsDir(cfg.harnessHome, false);
      const p = confinedMeetingPath(dir, String(name));
      if (!statSync(p).isFile()) return fail('파일이 없습니다');
      ensurePlainFile(p);
      return { ok: true, path: p };
    } catch (e) {
      return fail(errMsg(e));
    }
  }

  /** True while a meeting is recording — the mic permission gate reads this. */
  function micArmed(): boolean {
    return !!session && !session.stopping;
  }

  return { status, setPrefs, start, chunk, stop, shutdown, list, pathFor, micArmed };
}

export type MeetingManager = ReturnType<typeof createMeetingManager>;
