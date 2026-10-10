/**
 * Instagram link reader — the Electron half (requirement #12).
 *
 * The user pastes a post/reel link in the queue composer and clicks [읽기]. This
 * module opens THAT ONE link in a dedicated in-app browser window and reads only
 * what that browser legitimately renders: page metadata (caption), the visible
 * post text, image alt text, video presence/duration, and up to MAX_FRAMES
 * screenshots of the (muted) video. Optional audio transcription is OFF by default.
 *
 * Privacy / safety, and where each is enforced:
 *  - No password ever touches the app: the user logs in THEMSELVES inside the
 *    window (instagram:openLogin). Only cookie PRESENCE is ever checked.
 *  - Own persistent partition `persist:instagram`; nodeIntegration off,
 *    contextIsolation on, sandbox on, NO preload — the page can't reach app APIs.
 *  - Every request of that session is filtered by `isAllowedRequestUrl`
 *    (instagram.com / cdninstagram.com / fbcdn.net only); top-level navigation by
 *    `isAllowedNavigationUrl`; popups denied; downloads cancelled; every
 *    permission request (camera, mic, notifications…) denied.
 *  - Read-only: our scripts run in an ISOLATED world and only read the DOM (and,
 *    for frames, pause/seek the video). Nothing is clicked, typed, liked, posted.
 *  - One link at a time (`busy` lock) and a minimum gap between reads; every step
 *    is bounded by a timeout. No video file is downloaded; frames are screenshots
 *    of the rendered page, saved under the workspace temp dir and pruned.
 */
import { app, BrowserWindow, ipcMain, session, type Session, type WebContents } from 'electron';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import {
  parseInstagramUrl,
  isAllowedNavigationUrl,
  isAllowedRequestUrl,
  interpretSnapshot,
  frameOffsets,
  finalizeNotRead,
  normalizeTranscribeMode,
  type IgPageSnapshot,
  type IgReadResult,
  type InstagramStatus,
  type InstagramTranscribeMode
} from '../shared/instagram';
import { listEngines, transcribeAudio } from './transcribe';

export { parseInstagramUrl } from '../shared/instagram';

export const IG_PARTITION = 'persist:instagram';
const LOGIN_URL = 'https://www.instagram.com/accounts/login/';
const ISOLATED_WORLD = 1207;
const LOAD_TIMEOUT_MS = 25_000;
const RENDER_POLL_MS = 10_000;
const STEP_TIMEOUT_MS = 6_000;
const MAX_FRAMES = 4;
/** Audio is recorded in real time while the video plays; cap the wait. */
const MAX_AUDIO_SEC = 90;
const MAX_AUDIO_BYTES = 24 * 1024 * 1024;
const MIN_GAP_MS = 5_000;
const KEEP_READ_DIRS = 5;

export interface InstagramDeps {
  readConfig: () => { harnessHome?: string | null; groqApiKey?: string; freeflowModel?: string; instagramTranscribe?: InstagramTranscribeMode };
  writeConfig: (patch: { instagramTranscribe?: InstagramTranscribeMode }) => unknown;
  /** The app's main window — the in-app browser closes with it. */
  getMainWindow: () => BrowserWindow | null;
}

let igWin: BrowserWindow | null = null;
let hardened = false;
let busy = false;
let lastReadAt = 0;

function igSession(): Session {
  const s = session.fromPartition(IG_PARTITION);
  if (!hardened) {
    hardened = true;
    s.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
    s.setPermissionCheckHandler(() => false);
    s.on('will-download', (e) => e.preventDefault());
    s.webRequest.onBeforeRequest((details, cb) => cb({ cancel: !isAllowedRequestUrl(details.url) }));
    // Present as the Chromium it is: drop the Electron/app tokens from the UA.
    // (No other fingerprint changes; nothing about Instagram's checks is evaded.)
    s.setUserAgent(s.getUserAgent().replace(/\s(?:Electron|son-ai-office|SON AI Office)\/\S+/gi, ''));
  }
  return s;
}

function ensureWindow(deps: InstagramDeps): BrowserWindow {
  if (igWin && !igWin.isDestroyed()) return igWin;
  const win = new BrowserWindow({
    width: 480,
    height: 860,
    show: false,
    title: 'Instagram — 인앱 브라우저 (SON AI Office)',
    autoHideMenuBar: true,
    webPreferences: {
      session: igSession(),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      spellcheck: false,
      // Frames are captured while the window may be behind the app.
      backgroundThrottling: false
    }
  });
  const wc = win.webContents;
  wc.setAudioMuted(true);
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  const guard = (e: { preventDefault: () => void }, url: string): void => {
    if (!isAllowedNavigationUrl(url)) e.preventDefault();
  };
  wc.on('will-navigate', guard);
  wc.on('will-redirect', guard);
  wc.on('will-attach-webview', (e) => e.preventDefault());
  win.on('page-title-updated', (e) => e.preventDefault());
  win.on('closed', () => { if (igWin === win) igWin = null; });
  const main = deps.getMainWindow();
  if (main && !main.isDestroyed()) {
    main.once('closed', () => { if (!win.isDestroyed()) win.destroy(); });
  }
  igWin = win;
  return win;
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((res, rej) => {
    const t = setTimeout(() => rej(new Error(`${label} timed out`)), ms);
    p.then((v) => { clearTimeout(t); res(v); }, (e) => { clearTimeout(t); rej(e); });
  });
}

function runIsolated<T>(wc: WebContents, code: string, ms = STEP_TIMEOUT_MS): Promise<T> {
  return withTimeout(
    wc.executeJavaScriptInIsolatedWorld(ISOLATED_WORLD, [{ code }], true) as Promise<T>,
    ms,
    'page script'
  );
}

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Read-only DOM snapshot. Runs in an isolated world (page JS can't see it). */
const SNAPSHOT_JS = `(() => {
  const cap = (s, n) => String(s || '').slice(0, n);
  const root = document.querySelector('article') || document.querySelector('main[role="main"]') || document.querySelector('main');
  const scope = root || document;
  const videos = Array.from(scope.querySelectorAll('video')).slice(0, 5).map((v) => ({
    duration: Number.isFinite(v.duration) && v.duration > 0 ? v.duration : null
  }));
  const imageAlts = Array.from(scope.querySelectorAll('img[alt]'))
    .map((i) => cap(i.getAttribute('alt'), 500)).filter((a) => a.trim()).slice(0, 20);
  return {
    finalUrl: location.href,
    title: cap(document.title, 300),
    headHtml: cap(document.head ? document.head.outerHTML : '', 300000),
    articleText: cap(root ? root.innerText : '', 8000),
    bodyTextSample: cap(document.body ? document.body.innerText : '', 3000),
    hasPasswordField: !!document.querySelector('input[type="password"],input[name="password"]'),
    videos,
    imageAlts
  };
})()`;

/** Pause + seek the first video to t, return its on-screen rect. */
const seekJs = (t: number): string => `(async () => {
  const v = document.querySelector('article video') || document.querySelector('video');
  if (!v) return null;
  v.muted = true;
  v.scrollIntoView({ block: 'center' });
  try { v.pause(); } catch (e) {}
  const t = ${JSON.stringify(t)};
  if (Math.abs(v.currentTime - t) > 0.2) {
    await new Promise((r) => { const done = () => r(); v.addEventListener('seeked', done, { once: true }); setTimeout(done, 3000); try { v.currentTime = t; } catch (e) { r(); } });
  }
  await new Promise((r) => setTimeout(r, 400));
  const b = v.getBoundingClientRect();
  return { x: b.x, y: b.y, width: b.width, height: b.height, duration: Number.isFinite(v.duration) ? v.duration : null };
})()`;

/**
 * Record the first video's audio via the standard captureStream() + MediaRecorder
 * APIs, in real time, while the WebContents itself stays muted (nothing plays out
 * of the speakers). If the browser refuses (cross-origin media, no audio track,
 * unsupported) we report the reason — no workaround is attempted.
 */
const audioJs = (maxSec: number, maxBytes: number): string => `(async () => {
  const v = document.querySelector('article video') || document.querySelector('video');
  if (!v) return { ok: false, reason: '영상 요소 없음' };
  if (typeof v.captureStream !== 'function') return { ok: false, reason: '브라우저가 오디오 캡처를 지원하지 않음' };
  let stream;
  try { stream = v.captureStream(); } catch (e) { return { ok: false, reason: '페이지가 오디오 캡처를 허용하지 않음 (' + (e && e.name) + ')' }; }
  try { v.currentTime = 0; } catch (e) {}
  v.muted = false;
  try { await v.play(); } catch (e) { return { ok: false, reason: '영상 재생 불가 (' + (e && e.name) + ')' }; }
  await new Promise((r) => setTimeout(r, 500));
  const tracks = stream.getAudioTracks();
  if (!tracks.length) { v.muted = true; return { ok: false, reason: '오디오 트랙 없음(무음 영상이거나 캡처 불가)' }; }
  const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
  let rec;
  try { rec = new MediaRecorder(new MediaStream(tracks), { mimeType: mime }); } catch (e) { v.muted = true; return { ok: false, reason: '녹음기 생성 실패 (' + (e && e.name) + ')' }; }
  const chunks = []; let size = 0;
  rec.ondataavailable = (e) => { if (e.data && e.data.size) { chunks.push(e.data); size += e.data.size; if (size > ${maxBytes}) rec.stop(); } };
  const dur = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : ${maxSec};
  const sec = Math.min(dur, ${maxSec});
  const stopped = new Promise((r) => { rec.onstop = () => r(); });
  rec.start(1000);
  await Promise.race([new Promise((r) => setTimeout(r, sec * 1000 + 300)), new Promise((r) => v.addEventListener('ended', r, { once: true }))]);
  if (rec.state !== 'inactive') rec.stop();
  await stopped;
  v.muted = true; try { v.pause(); } catch (e) {}
  const blob = new Blob(chunks, { type: 'audio/webm' });
  if (!blob.size) return { ok: false, reason: '녹음된 소리 없음' };
  if (blob.size > ${maxBytes}) return { ok: false, reason: '오디오가 너무 큼' };
  const b64 = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(String(fr.result).split(',')[1] || ''); fr.onerror = () => r(''); fr.readAsDataURL(blob); });
  return { ok: true, b64, recordedSec: Math.round(sec), partial: dur > ${maxSec} };
})()`;

function framesBaseDir(deps: InstagramDeps): string {
  const home = deps.readConfig().harnessHome;
  const root = typeof home === 'string' && home.trim() ? home : app.getPath('userData');
  return resolve(root, '.son-tmp', 'instagram');
}

function newReadDir(deps: InstagramDeps, shortcode: string): string {
  const base = framesBaseDir(deps);
  const safe = shortcode.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) || 'post';
  const dir = resolve(base, `${Date.now()}-${safe}`);
  if (!dir.startsWith(base + sep)) throw new Error('frame dir escaped workspace temp');
  mkdirSync(dir, { recursive: true });
  // Prune old reads: keep only the newest few.
  try {
    const olds = readdirSync(base).filter((n) => /^\d+-[A-Za-z0-9_-]+$/.test(n)).sort().reverse().slice(KEEP_READ_DIRS);
    for (const n of olds) rmSync(join(base, n), { recursive: true, force: true });
  } catch { /* best effort */ }
  return dir;
}

async function captureFrames(wc: WebContents, dir: string, durationSec: number | undefined): Promise<string[]> {
  const out: string[] = [];
  const offsets = frameOffsets(durationSec, MAX_FRAMES);
  for (let i = 0; i < offsets.length; i++) {
    try {
      const rect = await runIsolated<{ x: number; y: number; width: number; height: number } | null>(wc, seekJs(offsets[i]));
      if (!rect || rect.width < 10 || rect.height < 10) continue;
      const x = Math.max(0, Math.floor(rect.x));
      const y = Math.max(0, Math.floor(rect.y));
      const img = await withTimeout(
        wc.capturePage({ x, y, width: Math.floor(rect.width), height: Math.floor(rect.height) }),
        STEP_TIMEOUT_MS,
        'capture'
      );
      if (img.isEmpty()) continue;
      const file = join(dir, `frame-${i + 1}.png`);
      writeFileSync(file, img.toPNG());
      out.push(file);
    } catch { /* one failed frame is reported via the count */ }
  }
  return out;
}

async function loggedIn(): Promise<boolean> {
  try {
    const c = await igSession().cookies.get({ name: 'sessionid' });
    return c.some((k) => /(^|\.)instagram\.com$/i.test(k.domain ?? ''));
  } catch { return false; }
}

export async function instagramStatus(deps: InstagramDeps): Promise<InstagramStatus> {
  const cfg = deps.readConfig();
  return {
    loggedIn: await loggedIn(),
    windowOpen: !!igWin && !igWin.isDestroyed(),
    reading: busy,
    transcribe: normalizeTranscribeMode(cfg.instagramTranscribe),
    // Presence of the key only — the value never leaves main.
    engines: listEngines({ groqApiKey: cfg.groqApiKey }).map((e) => ({ id: e.id, available: e.available, reason: e.reason, external: e.external }))
  };
}

export async function openInstagramLogin(deps: InstagramDeps): Promise<{ ok: boolean; error?: string }> {
  try {
    const win = ensureWindow(deps);
    win.show();
    win.focus();
    await withTimeout(win.webContents.loadURL(LOGIN_URL), LOAD_TIMEOUT_MS, 'load').catch(() => { /* SPA redirects abort loadURL; the window is still usable */ });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function readInstagram(deps: InstagramDeps, rawUrl: unknown): Promise<IgReadResult> {
  const p = parseInstagramUrl(rawUrl);
  if (!p.ok) return { ok: false, status: 'error', notRead: ['게시물 전체'], message: `인스타그램 게시물/릴스 링크가 아닙니다 (${p.reason}).` };
  if (busy) return { ok: false, status: 'error', url: p.url, notRead: ['게시물 전체'], message: '이미 다른 링크를 읽는 중입니다. 끝난 뒤 다시 시도하세요.' };
  const wait = lastReadAt + MIN_GAP_MS - Date.now();
  if (wait > 0) return { ok: false, status: 'error', url: p.url, notRead: ['게시물 전체'], message: `너무 빠릅니다. ${Math.ceil(wait / 1000)}초 뒤에 다시 시도하세요.` };
  busy = true;
  lastReadAt = Date.now();
  try {
    const win = ensureWindow(deps);
    const wc = win.webContents;
    // Visible (but not focus-stealing): the user can see exactly what is read.
    win.showInactive();
    let httpStatus: number | undefined;
    const onNav = (_e: unknown, _url: string, code: number): void => { httpStatus = code; };
    wc.on('did-navigate', onNav);
    try {
      await withTimeout(wc.loadURL(p.url), LOAD_TIMEOUT_MS, 'load').catch(() => { /* aborted by SPA redirect or slow — snapshot decides */ });
    } finally {
      wc.removeListener('did-navigate', onNav);
    }
    // The page is a client-rendered SPA: poll until a post, a login wall or an
    // error is visible, bounded.
    let snap: IgPageSnapshot | null = null;
    const until = Date.now() + RENDER_POLL_MS;
    while (Date.now() < until) {
      await delay(1000);
      try {
        snap = await runIsolated<IgPageSnapshot>(wc, SNAPSHOT_JS);
      } catch { snap = null; }
      if (snap && (snap.videos.length || snap.articleText.trim() || snap.hasPasswordField || /og:description/i.test(snap.headHtml))) {
        // One more beat so lazy video metadata (duration) can arrive.
        await delay(800);
        try { snap = await runIsolated<IgPageSnapshot>(wc, SNAPSHOT_JS); } catch { /* keep previous */ }
        break;
      }
    }
    if (!snap) {
      return { ok: false, status: 'error', url: p.url, notRead: ['게시물 전체'], message: '페이지를 읽지 못했습니다(시간 초과). 캡션을 직접 붙여 넣어 주세요.' };
    }
    snap.httpStatus = httpStatus;
    let result: IgReadResult = interpretSnapshot(snap, p.url);
    if (!result.ok) {
      // Leave the window open on a login wall so the user can sign in right there.
      if (result.status === 'login-required') { win.show(); win.focus(); }
      return result;
    }
    let framesGot = 0;
    const audio: { done: boolean; reason?: string; partialUntilSec?: number } = { done: false };
    if (result.hasVideo) {
      const dir = newReadDir(deps, p.shortcode);
      const frames = await captureFrames(wc, dir, result.durationSec);
      framesGot = frames.length;
      if (frames.length) result = { ...result, framePaths: frames };
      const cfg = deps.readConfig();
      const mode = normalizeTranscribeMode(cfg.instagramTranscribe);
      if (mode === 'off') {
        audio.reason = '음성 받아쓰기 꺼짐 — 설정 → 인스타그램에서 켤 수 있음';
      } else {
        const engine = listEngines({ groqApiKey: cfg.groqApiKey }).find((e) => e.id === mode);
        if (!engine?.available) {
          audio.reason = engine?.reason ?? '선택한 받아쓰기 방식을 쓸 수 없음';
        } else {
          try {
            const rec = await runIsolated<{ ok: boolean; reason?: string; b64?: string; recordedSec?: number; partial?: boolean }>(
              wc, audioJs(MAX_AUDIO_SEC, MAX_AUDIO_BYTES), (MAX_AUDIO_SEC + 20) * 1000
            );
            if (!rec.ok || !rec.b64) {
              audio.reason = rec.reason ?? '오디오를 캡처하지 못함';
            } else {
              const bytes = new Uint8Array(Buffer.from(rec.b64, 'base64'));
              const tr = await transcribeAudio(mode, bytes, 'audio/webm', { groqApiKey: cfg.groqApiKey, groqModel: cfg.freeflowModel });
              if (tr.ok && tr.text) {
                audio.done = true;
                if (rec.partial) audio.partialUntilSec = rec.recordedSec;
                result = { ...result, transcript: tr.text.slice(0, 8000), transcriptEngine: mode };
              } else {
                audio.reason = `받아쓰기 실패: ${tr.error ?? '알 수 없음'}`;
              }
            }
          } catch (e) {
            audio.reason = `오디오 캡처 시간 초과/실패 (${e instanceof Error ? e.message : String(e)})`;
          }
        }
      }
    }
    return finalizeNotRead(result, { framesWanted: MAX_FRAMES, framesGot, audio });
  } catch (e) {
    return { ok: false, status: 'error', url: p.url, notRead: ['게시물 전체'], message: `읽기 실패: ${e instanceof Error ? e.message : String(e)}` };
  } finally {
    busy = false;
  }
}

/** Register the instagram:* IPC channels. One line in index.ts. */
export function registerInstagramIpc(deps: InstagramDeps): void {
  ipcMain.handle('instagram:read', (_e, url: unknown) => readInstagram(deps, url));
  ipcMain.handle('instagram:openLogin', () => openInstagramLogin(deps));
  ipcMain.handle('instagram:status', () => instagramStatus(deps));
  ipcMain.handle('instagram:setTranscribe', (_e, mode: unknown) => {
    // Only an explicit known value is stored; anything else is OFF.
    deps.writeConfig({ instagramTranscribe: normalizeTranscribeMode(mode) });
    return instagramStatus(deps);
  });
  ipcMain.handle('instagram:logout', async () => {
    // Forget the in-app browser's Instagram login (cookies/storage of that partition only).
    try {
      if (igWin && !igWin.isDestroyed()) igWin.destroy();
      await igSession().clearStorageData();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
}
