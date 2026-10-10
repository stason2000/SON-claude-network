'use strict';
/**
 * Meeting transcription (#6): title sanitizing, path confinement, transcript
 * assembly (timestamps, failure/gap markers), caps, and that no IPC reply ever
 * carries the Groq key. Uses a fake transcriber — no network, no microphone.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const shared = loadTs('src/shared/meetings.ts');
const { createMeetingManager, resolveMeetingsDir, confinedMeetingPath } = loadTs('src/main/meetings.ts');

const KEY = 'gsk_TEST_SECRET_KEY_0123456789abcdef';

function tmpHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'meet-'));
}

function makeManager(opts = {}) {
  const cfg = {
    harnessHome: opts.home ?? tmpHome(),
    groqApiKey: KEY,
    meetingsConsent: true,
    meetingsKeepAudio: false,
    ...opts.cfg
  };
  let t = opts.t0 ?? new Date(2026, 9, 10, 14, 5, 0).getTime();
  const calls = [];
  const m = createMeetingManager({
    readConfig: () => cfg,
    writeConfig: (p) => Object.assign(cfg, p),
    now: () => t,
    transcribe: opts.transcribe ?? (async (o) => {
      calls.push(o);
      return { ok: true, text: `chunk of ${o.audio.byteLength} bytes` };
    })
  });
  return { m, cfg, calls, advance: (ms) => { t += ms; } };
}

const audio = (n = 100) => new Uint8Array(n).fill(7).buffer;

// ── sanitizing ────────────────────────────────────────────────────────────────
test('sanitizeMeetingTitle strips separators, traversal, control and reserved chars', () => {
  const s = shared.sanitizeMeetingTitle;
  assert.equal(s('주간 회의'), '주간-회의');
  assert.equal(s('../../etc/passwd'), 'etc-passwd');
  assert.equal(s('a/b\\c:d*e?f"g<h>i|j'), 'a-b-c-d-e-f-g-h-i-j');
  assert.equal(s('bad\u0000name\nx'), 'bad-name-x');
  assert.equal(s(''), '회의');
  assert.equal(s('   '), '회의');
  assert.equal(s('...'), '회의');
  assert.equal(s(null), '회의');
  assert.equal(s('CON'), 'CON-회의');
  assert.ok(s('가'.repeat(200)).length <= shared.MEETING_TITLE_MAX);
  for (const evil of ['..', '../x', 'x/..', '.\\..\\y', '/abs/path']) {
    const out = s(evil);
    assert.ok(!out.includes('/') && !out.includes('\\') && !out.includes('..'), `${evil} → ${out}`);
  }
});

test('meetingFileName uses local date/time and passes the name check', () => {
  const d = new Date(2026, 0, 2, 3, 4, 5);
  const n = shared.meetingFileName(d, '킥오프 / 1차');
  assert.equal(n, '2026-01-02-0304-킥오프-1차.md');
  assert.ok(shared.isMeetingFileName(n));
  assert.equal(shared.meetingFileName(d, 'x', 2), '2026-01-02-0304-x-2.md');
  assert.equal(shared.isMeetingFileName('../2026-01-02-0304-x.md'), false);
  assert.equal(shared.isMeetingFileName('2026-01-02-0304-x.txt'), false);
  assert.equal(shared.isMeetingFileName('notes.md'), false);
});

test('formatElapsed', () => {
  assert.equal(shared.formatElapsed(0), '00:00');
  assert.equal(shared.formatElapsed(65_000), '01:05');
  assert.equal(shared.formatElapsed(3_600_000 + 61_000), '1:01:01');
  assert.equal(shared.formatElapsed(-5), '00:00');
  assert.equal(shared.formatElapsed(NaN), '00:00');
});

// ── confinement ───────────────────────────────────────────────────────────────
test('meetings dir is confined to the home; symlinked folder is refused', () => {
  const home = tmpHome();
  const dir = resolveMeetingsDir(home);
  assert.equal(dir, path.join(home, 'meetings'));
  assert.throws(() => resolveMeetingsDir('relative/home'));
  assert.throws(() => resolveMeetingsDir(null));
  assert.throws(() => confinedMeetingPath(dir, '../2026-01-02-0304-x.md'));
  assert.throws(() => confinedMeetingPath(dir, '2026-01-02-0304-../../x.md'));
  assert.throws(() => confinedMeetingPath(dir, '/etc/passwd'));

  const home2 = tmpHome();
  const outside = tmpHome();
  fs.symlinkSync(outside, path.join(home2, 'meetings'));
  assert.throws(() => resolveMeetingsDir(home2), /일반 폴더/);
});

test('pathFor refuses traversal and unknown files', async () => {
  const { m } = makeManager();
  assert.equal(m.pathFor('../../etc/passwd').ok, false);
  assert.equal(m.pathFor('2026-10-10-1405-none.md').ok, false);
  const s = m.start({ title: 'x' });
  assert.ok(s.ok);
  await m.stop({ id: s.id });
  const r = m.pathFor(s.fileName);
  assert.ok(r.ok);
  assert.equal(r.path, s.filePath);
});

// ── gating ────────────────────────────────────────────────────────────────────
test('start is refused without consent or key; only one meeting at a time', () => {
  assert.equal(makeManager({ cfg: { meetingsConsent: false } }).m.start({ title: 'a' }).ok, false);
  assert.equal(makeManager({ cfg: { groqApiKey: undefined } }).m.start({ title: 'a' }).ok, false);
  const { m } = makeManager();
  assert.ok(m.start({ title: 'a' }).ok);
  assert.equal(m.micArmed(), true);
  assert.equal(m.start({ title: 'b' }).ok, false);
});

test('exclusive create: same minute + title gets a -2 suffix, never overwrites', async () => {
  const home = tmpHome();
  const a = makeManager({ home });
  const s1 = a.m.start({ title: '같은 이름' });
  await a.m.stop({ id: s1.id });
  const before = fs.readFileSync(s1.filePath, 'utf8');
  const b = makeManager({ home });
  const s2 = b.m.start({ title: '같은 이름' });
  assert.ok(s2.ok);
  assert.notEqual(s2.filePath, s1.filePath);
  assert.match(s2.fileName, /-2\.md$/);
  assert.equal(fs.readFileSync(s1.filePath, 'utf8'), before);
  assert.equal(path.dirname(s2.filePath), path.join(home, 'meetings'));
});

// ── transcript assembly ───────────────────────────────────────────────────────
test('transcript has elapsed stamps, failure markers, gap markers and a footer', async () => {
  let n = 0;
  const { m, advance } = makeManager({
    transcribe: async () => {
      n += 1;
      if (n === 2) return { ok: false, error: 'Groq 500: boom' };
      if (n === 3) return { ok: false, error: 'no speech detected' };
      return { ok: true, text: `발언 ${n}` };
    }
  });
  const s = m.start({ title: '주간 회의' });
  assert.ok(s.ok);
  assert.equal(path.basename(s.filePath), '2026-10-10-1405-주간-회의.md');
  await m.chunk({ id: s.id, seq: 0, startMs: 0, endMs: 30_000, audio: audio(), mimeType: 'audio/webm' });
  await m.chunk({ id: s.id, seq: 1, startMs: 30_000, endMs: 60_000, audio: audio(), mimeType: 'audio/webm' });
  await m.chunk({ id: s.id, seq: 2, startMs: 60_000, endMs: 90_000, audio: audio(), mimeType: 'audio/webm' });
  // 30 s hole, then an empty chunk (recorder produced nothing)
  await m.chunk({ id: s.id, seq: 3, startMs: 120_000, endMs: 150_000, audio: null, mimeType: 'audio/webm' });
  const r4 = await m.chunk({ id: s.id, seq: 4, startMs: 150_000, endMs: 165_000, audio: audio(), mimeType: 'audio/webm' });
  assert.ok(r4.ok);
  assert.ok(r4.preview.length >= 5);
  advance(170_000);
  const st = await m.stop({ id: s.id, endMs: 165_000 });
  assert.ok(st.ok);
  assert.equal(st.failed, 2);
  assert.equal(st.gaps, 1);
  const md = fs.readFileSync(s.filePath, 'utf8');
  assert.match(md, /^# 주간 회의/);
  assert.match(md, /\*\*\[00:00\]\*\* 발언 1/);
  assert.match(md, /\[전사 실패: 구간 00:30–01:00\]\*\* — Groq 500: boom/);
  assert.match(md, /\*\*\[01:00\]\*\* _\(말소리 없음\)_/);
  assert.match(md, /\[녹음 누락: 구간 01:30–02:00\]/);
  assert.match(md, /\[전사 실패: 구간 02:00–02:30\]\*\* — 녹음된 오디오가 비어 있음/);
  assert.match(md, /\*\*\[02:30\]\*\* 발언 4/);
  assert.match(md, /총 02:45/);
  // order preserved
  assert.ok(md.indexOf('발언 1') < md.indexOf('00:30–01:00') && md.indexOf('01:30–02:00') < md.indexOf('발언 4'));
  assert.equal(m.micArmed(), false);
});

test('chunks are rejected for the wrong id, replayed seq or bad times', async () => {
  const { m } = makeManager();
  const s = m.start({ title: 't' });
  assert.equal((await m.chunk({ id: 'other', seq: 0, startMs: 0, endMs: 1, audio: audio() })).ok, false);
  assert.ok((await m.chunk({ id: s.id, seq: 0, startMs: 0, endMs: 30_000, audio: audio() })).ok);
  assert.equal((await m.chunk({ id: s.id, seq: 0, startMs: 30_000, endMs: 60_000, audio: audio() })).ok, false);
  assert.equal((await m.chunk({ id: s.id, seq: 1, startMs: 50, endMs: 10, audio: audio() })).ok, false);
  assert.equal((await m.chunk({ id: s.id, seq: 2, startMs: 0, endMs: 10 * 60_000, audio: audio() })).ok, false);
  assert.equal((await m.chunk({ id: s.id, seq: 3, startMs: 0, endMs: 1, audio: 'nope' })).ok, false);
});

// ── caps ──────────────────────────────────────────────────────────────────────
test('oversized chunk is marked as failed, not uploaded', async () => {
  const { m, calls } = makeManager();
  const s = m.start({ title: 'big' });
  const big = new Uint8Array(shared.MEETING_MAX_CHUNK_BYTES + 1).buffer;
  const r = await m.chunk({ id: s.id, seq: 0, startMs: 0, endMs: 30_000, audio: big });
  assert.ok(r.ok);
  assert.equal(calls.length, 0);
  await m.stop({ id: s.id });
  assert.match(fs.readFileSync(s.filePath, 'utf8'), /\[전사 실패: 구간 00:00–00:30\]\*\* — 구간이 너무 큼/);
});

test('meeting stops itself at the 3 hour cap', async () => {
  const { m } = makeManager();
  const s = m.start({ title: 'long' });
  const last = shared.MEETING_MAX_MS - 10_000;
  const r = await m.chunk({ id: s.id, seq: 0, startMs: last, endMs: last + 30_000, audio: audio() });
  assert.ok(r.ok);
  assert.equal(r.capped, true);
  assert.equal(m.status().active, null);
  const md = fs.readFileSync(s.filePath, 'utf8');
  assert.match(md, /최대 녹음 길이/);
  assert.match(md, /총 3:00:00/);
  // beyond the cap
  const s2 = m.start({ title: 'long2' });
  const r2 = await m.chunk({ id: s2.id, seq: 0, startMs: shared.MEETING_MAX_MS, endMs: shared.MEETING_MAX_MS + 1000, audio: audio() });
  assert.equal(r2.capped, true);
  assert.equal(m.status().active, null);
});

// ── audio retention ───────────────────────────────────────────────────────────
test('raw audio is written only when keepAudio is on', async () => {
  const off = makeManager();
  const s1 = off.m.start({ title: 'a' });
  await off.m.chunk({ id: s1.id, seq: 0, startMs: 0, endMs: 30_000, audio: audio() });
  await off.m.stop({ id: s1.id });
  assert.deepEqual(fs.readdirSync(path.dirname(s1.filePath)), [path.basename(s1.filePath)]);

  const on = makeManager({ cfg: { meetingsKeepAudio: true } });
  const s2 = on.m.start({ title: 'b' });
  await on.m.chunk({ id: s2.id, seq: 0, startMs: 0, endMs: 30_000, audio: audio(), mimeType: 'audio/webm;codecs=opus' });
  await on.m.stop({ id: s2.id });
  const adir = s2.filePath.replace(/\.md$/, '-audio');
  assert.deepEqual(fs.readdirSync(adir), ['0000.webm']);
  assert.match(fs.readFileSync(s2.filePath, 'utf8'), /원본 오디오 보관: 예/);
});

// ── secrets ───────────────────────────────────────────────────────────────────
test('no IPC reply or transcript contains the Groq key, even when an error echoes it', async () => {
  const { m, calls } = makeManager({
    transcribe: async (o) => { calls.push(o); return { ok: false, error: `401 bad key ${o.apiKey}` }; }
  });
  const replies = [];
  replies.push(m.status());
  const s = m.start({ title: 'secret' });
  replies.push(s);
  replies.push(await m.chunk({ id: s.id, seq: 0, startMs: 0, endMs: 30_000, audio: audio() }));
  replies.push(m.status());
  replies.push(await m.stop({ id: s.id }));
  replies.push(m.list());
  replies.push(m.pathFor(s.fileName));
  replies.push(m.setPrefs({ keepAudio: true }));
  replies.push(await m.chunk({ id: 'x' }));
  // the key DID reach the transcriber (that is its only use)
  assert.equal(calls[0].apiKey, KEY);
  for (const r of replies) assert.ok(!JSON.stringify(r).includes(KEY), JSON.stringify(r));
  const md = fs.readFileSync(s.filePath, 'utf8');
  assert.ok(!md.includes(KEY));
  assert.match(md, /\[삭제됨\]/);
  assert.equal(replies[0].hasGroqKey, true);
});

test('shutdown marks pending segments failed and closes the file', async () => {
  let release;
  const { m } = makeManager({ transcribe: () => new Promise((r) => { release = r; }) });
  const s = m.start({ title: 'quit' });
  const p = m.chunk({ id: s.id, seq: 0, startMs: 0, endMs: 30_000, audio: audio() });
  await new Promise((r) => setImmediate(r));
  m.shutdown();
  const md = fs.readFileSync(s.filePath, 'utf8');
  assert.match(md, /\[전사 실패: 구간 00:00–00:30\]\*\* — 앱 종료로/);
  assert.match(md, /앱이 종료되어/);
  release({ ok: true, text: 'late' });
  await p;
});

test('summary request carries the path, not the transcript', () => {
  const msg = shared.buildSummaryRequest('/h/meetings/2026-10-10-1405-x.md');
  assert.match(msg, /\/h\/meetings\/2026-10-10-1405-x\.md/);
  assert.match(msg, /결정/);
  assert.match(msg, /전사 실패/);
});

test('list returns only transcript files, newest first', async () => {
  const home = tmpHome();
  const { m } = makeManager({ home });
  const s = m.start({ title: 'one' });
  await m.stop({ id: s.id });
  fs.writeFileSync(path.join(home, 'meetings', 'random.txt'), 'x');
  const r = m.list();
  assert.ok(r.ok);
  assert.deepEqual(r.files.map((f) => f.name), [s.fileName]);
});
