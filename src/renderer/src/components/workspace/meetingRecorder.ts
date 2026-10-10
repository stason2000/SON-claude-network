/**
 * Meeting recorder (#6) — renderer side. ONE meeting at a time, app-wide singleton
 * (it keeps recording if the user switches back to the classic view, and the
 * title-bar indicator stays visible while it does).
 *
 * Captures ONLY the default microphone (getUserMedia audio, no video, no
 * display/system audio). Every MEETING_CHUNK_MS the MediaRecorder is rotated:
 * a fresh recorder starts on the same stream BEFORE the old one stops, so each
 * segment is a complete, separately decodable webm file and the seam is tiny.
 * Segments are sent to main strictly in order. If a send fails, main sees the
 * hole in the timeline and writes `[녹음 누락: …]` — nothing vanishes silently.
 */
import { useSyncExternalStore } from 'react';
import { MEETING_CHUNK_MS, MEETING_MAX_MS } from '@shared/meetings';

export type MeetingRecStatus = 'idle' | 'starting' | 'recording' | 'stopping';

export interface MeetingRecState {
  status: MeetingRecStatus;
  id: string | null;
  title: string;
  fileName: string | null;
  /** performance.now() at the start of recording (for the elapsed clock). */
  t0: number | null;
  preview: string[];
  error: string | null;
  /** Set after a meeting is stopped — what was saved. */
  lastSaved: { fileName: string; filePath: string; failed: number; gaps: number } | null;
}

let state: MeetingRecState = {
  status: 'idle', id: null, title: '', fileName: null, t0: null, preview: [], error: null, lastSaved: null
};
const listeners = new Set<() => void>();
function setState(patch: Partial<MeetingRecState>): void {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

let stream: MediaStream | null = null;
let current: MediaRecorder | null = null;
let rotateTimer: ReturnType<typeof setTimeout> | null = null;
let capTimer: ReturnType<typeof setTimeout> | null = null;
let seq = 0;
/** Serializes sends so main receives segments in recording order. */
let sendChain: Promise<void> = Promise.resolve();
let stopping = false;

function pickMimeType(): string {
  for (const c of ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']) {
    try { if (MediaRecorder.isTypeSupported(c)) return c; } catch { /* ignore */ }
  }
  return '';
}

function elapsed(): number {
  return state.t0 === null ? 0 : performance.now() - state.t0;
}

function teardown(): void {
  if (rotateTimer) { clearTimeout(rotateTimer); rotateTimer = null; }
  if (capTimer) { clearTimeout(capTimer); capTimer = null; }
  try { stream?.getTracks().forEach((t) => t.stop()); } catch { /* noop */ }
  stream = null;
  current = null;
}

/** Start one segment recorder; resolves its blob when it stops. */
function startSegment(mimeType: string): void {
  if (!stream) return;
  const id = state.id;
  const rec = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
  const parts: Blob[] = [];
  const segStart = elapsed();
  const mySeq = seq++;
  rec.ondataavailable = (e) => { if (e.data && e.data.size > 0) parts.push(e.data); };
  rec.onstop = () => {
    const segEnd = elapsed();
    const type = rec.mimeType || mimeType || 'audio/webm';
    const blob = new Blob(parts, { type });
    sendChain = sendChain.then(async () => {
      if (!id) return;
      try {
        const buf = blob.size > 0 ? await blob.arrayBuffer() : null;
        const r = await window.cth.meetingsChunk({ id, seq: mySeq, startMs: segStart, endMs: segEnd, audio: buf, mimeType: type });
        if (r.ok) {
          if (state.id === id) setState({ preview: r.preview });
          if (r.capped && state.id === id) void stopMeeting();
        } else if (state.id === id) {
          setState({ error: r.error });
        }
      } catch (e) {
        if (state.id === id) setState({ error: e instanceof Error ? e.message : String(e) });
      }
    });
  };
  rec.start();
  current = rec;
  rotateTimer = setTimeout(() => {
    rotateTimer = null;
    if (stopping || current !== rec) return;
    startSegment(mimeType); // new recorder first, so the seam is as small as possible
    try { rec.stop(); } catch { /* already stopped */ }
  }, MEETING_CHUNK_MS);
}

export async function startMeeting(title: string): Promise<void> {
  if (state.status !== 'idle') return;
  stopping = false;
  setState({ status: 'starting', error: null, preview: [], lastSaved: null, title });
  const r = await window.cth.meetingsStart({ title });
  if (!r.ok) { setState({ status: 'idle', error: r.error }); return; }
  setState({ id: r.id, fileName: r.fileName });
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
      video: false
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await window.cth.meetingsStop({ id: r.id, endMs: 0, reason: `마이크를 열지 못했습니다: ${msg}` });
    teardown();
    setState({ status: 'idle', id: null, t0: null, error: `마이크를 열지 못했습니다: ${msg}` });
    return;
  }
  // A mic that disappears mid-meeting (unplugged, permission revoked) ends it.
  for (const tr of stream.getAudioTracks()) {
    tr.addEventListener('ended', () => { void stopMeeting('마이크 연결이 끊겨 녹음이 멈췄습니다'); });
  }
  seq = 0;
  sendChain = Promise.resolve();
  setState({ status: 'recording', t0: performance.now() });
  startSegment(pickMimeType());
  capTimer = setTimeout(() => { void stopMeeting('최대 녹음 길이(3시간)에 도달해 자동으로 멈췄습니다'); }, MEETING_MAX_MS);
}

export async function stopMeeting(reason?: string): Promise<void> {
  const id = state.id;
  if (!id || stopping) return;
  stopping = true;
  setState({ status: 'stopping' });
  if (rotateTimer) { clearTimeout(rotateTimer); rotateTimer = null; }
  const rec = current;
  const endMs = elapsed();
  if (rec && rec.state !== 'inactive') {
    await new Promise<void>((resolve) => {
      rec.addEventListener('stop', () => resolve(), { once: true });
      try { rec.stop(); } catch { resolve(); }
    });
  }
  // onstop queued the final send on sendChain; wait for every send to land.
  await sendChain;
  teardown();
  const r = await window.cth.meetingsStop({ id, endMs, reason });
  setState({
    status: 'idle', id: null, t0: null, fileName: null,
    lastSaved: r.ok ? { fileName: r.fileName, filePath: r.filePath, failed: r.failed, gaps: r.gaps } : null,
    error: r.ok ? state.error : r.error
  });
  stopping = false;
}

export function meetingElapsedMs(): number {
  return state.status === 'recording' || state.status === 'stopping' ? elapsed() : 0;
}

export function useMeetingRecorder(): MeetingRecState {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    () => state,
    () => state
  );
}
