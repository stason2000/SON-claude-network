'use strict';
/**
 * "사용량·한도": shared pure logic (src/shared/connectorUsage.ts), the main-side
 * OpenRouter GET /api/v1/key call with a fake fetch (no real network call — no key
 * exists in CI), the local usage log written by resources/api-agent.cjs against a
 * mock server, and i18n parity for extra.usage.*.
 *
 * OPENROUTER_SAMPLE is assembled from the response type and JSON excerpt on
 * https://openrouter.ai/docs/api_reference/limits (read 2026-10-11); it was not
 * recorded from a live account.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const loadTs = require('./load-ts.cjs');

const u = loadTs('src/shared/connectorUsage.ts');
const mainUsage = loadTs('src/main/connectorUsage.ts');
const { prepareApiAgentSpawn } = loadTs('src/main/apiAgent.ts');
const conn = loadTs('src/shared/connectors/index.ts');
const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'resources', 'api-agent.cjs');
const FAKE_KEY = 'sk-or-v1-TESTKEY0123456789abcdef';
const PROMPT = 'my secret business plan prompt';

const OPENROUTER_SAMPLE = {
  data: {
    label: 'sk-or-v1-0e6...1c96',
    limit: null,
    limit_reset: null,
    limit_remaining: null,
    include_byok_in_limit: false,
    budgets: [],
    effective_budget: null,
    usage: 0.5123,
    usage_daily: 0.0021,
    usage_weekly: 0.1,
    usage_monthly: 0.3,
    byok_usage: 0,
    byok_usage_daily: 0,
    byok_usage_weekly: 0,
    byok_usage_monthly: 0,
    is_free_tier: true,
    free_model_daily_requests: { used: 12, limit: 50, remaining: 38 },
    rate_limit: { requests: -1, interval: '10s' }
  }
};

// ── OpenRouter parsing ─────────────────────────────────────────────────────────
test('parseOpenRouterKey: documented sample → numbers-only view, label dropped', () => {
  const v = u.parseOpenRouterKey(OPENROUTER_SAMPLE);
  assert.deepEqual(v, {
    freeDaily: { used: 12, limit: 50, remaining: 38, percent: 24 },
    creditsToday: 0.0021,
    creditsTotal: 0.5123,
    keyLimit: null,
    keyLimitRemaining: null,
    isFreeTier: true
  });
  assert.ok(!JSON.stringify(v).includes('sk-or'), 'masked key label must not cross IPC');
});

test('parseOpenRouterKey: missing / wrong-typed fields are null, never invented', () => {
  assert.equal(u.parseOpenRouterKey(null), null);
  assert.equal(u.parseOpenRouterKey({}), null);
  assert.equal(u.parseOpenRouterKey({ data: [] }), null);
  const v = u.parseOpenRouterKey({ data: { usage: 'lots', is_free_tier: 'yes', free_model_daily_requests: { used: 3 } } });
  assert.deepEqual(v, { freeDaily: null, creditsToday: null, creditsTotal: null, keyLimit: null, keyLimitRemaining: null, isFreeTier: null });
  // remaining missing → derived; over the cap → clamped to 100 %
  const w = u.parseOpenRouterKey({ data: { free_model_daily_requests: { used: 1200, limit: 1000 }, limit: 10, limit_remaining: 4.5, is_free_tier: false } });
  assert.deepEqual(w.freeDaily, { used: 1200, limit: 1000, remaining: 0, percent: 100 });
  assert.equal(w.keyLimit, 10);
  assert.equal(w.keyLimitRemaining, 4.5);
  assert.equal(w.isFreeTier, false);
  assert.equal(u.parseOpenRouterKey({ data: { free_model_daily_requests: { used: -1, limit: 50 } } }).freeDaily, null);
});

test('fetchOpenRouterUsage: fixed https URL, Bearer key, no redirects, error mapping', async () => {
  const calls = [];
  const ok = await mainUsage.fetchOpenRouterUsage({
    getKey: () => FAKE_KEY,
    now: () => 1234,
    fetch: async (url, init) => { calls.push({ url, init }); return new Response(JSON.stringify(OPENROUTER_SAMPLE), { status: 200 }); }
  });
  assert.equal(calls[0].url, 'https://openrouter.ai/api/v1/key');
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${FAKE_KEY}`);
  assert.equal(calls[0].init.redirect, 'error');
  assert.ok(calls[0].init.signal);
  assert.equal(ok.ok, true);
  assert.equal(ok.fetchedAt, 1234);
  assert.ok(!JSON.stringify(ok).includes(FAKE_KEY));
  assert.ok(!JSON.stringify(ok).includes('sk-or'));

  const run = (fetch, getKey = () => FAKE_KEY) => mainUsage.fetchOpenRouterUsage({ getKey, fetch, timeoutMs: 50 });
  let fetched = false;
  assert.deepEqual(await run(async () => { fetched = true; }, () => undefined), { ok: false, error: 'no-key' });
  assert.equal(fetched, false, 'no key → no request');
  assert.deepEqual(await run(async () => new Response('{}', { status: 401 })), { ok: false, error: 'bad-key' });
  assert.deepEqual(await run(async () => new Response('{}', { status: 403 })), { ok: false, error: 'bad-key' });
  assert.deepEqual(await run(async () => new Response('{}', { status: 429 })), { ok: false, error: 'later' });
  assert.deepEqual(await run(async () => new Response('{}', { status: 502 })), { ok: false, error: 'later' });
  assert.deepEqual(await run(async () => new Response('not json', { status: 200 })), { ok: false, error: 'later' });
  assert.deepEqual(await run(async () => { throw new TypeError('fetch failed'); }), { ok: false, error: 'offline' });
  // timeout: the fake waits for the abort signal
  const slow = (url, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  assert.deepEqual(await run(slow), { ok: false, error: 'later' });
});

test('main source: usage module never logs and only one https URL', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/main/connectorUsage.ts'), 'utf8');
  assert.ok(!/console\.|log\.(info|warn|error|debug)/.test(src), 'no logging in connectorUsage.ts');
  const shared = fs.readFileSync(path.join(ROOT, 'src/shared/connectorUsage.ts'), 'utf8');
  assert.deepEqual([...shared.matchAll(/https?:\/\/[^'"\s]+/g)].map((m) => m[0]).filter((x) => x.includes('/api/')), ['https://openrouter.ai/api/v1/key']);
  const preload = fs.readFileSync(path.join(ROOT, 'src/preload/index.ts'), 'utf8');
  assert.match(preload, /'connectorUsage:openrouter'/);
  assert.match(preload, /'connectorUsage:local'/);
});

// ── log lines ─────────────────────────────────────────────────────────────────
test('sanitizeUsageLine keeps exactly {ts, connector, ok, status}', () => {
  const l = u.sanitizeUsageLine({ ts: 1700000000000.7, connector: 'openai', ok: false, status: 429, prompt: PROMPT, key: FAKE_KEY, reply: 'x' });
  assert.deepEqual(l, { ts: 1700000000000, connector: 'openai', ok: false, status: 429 });
  assert.deepEqual(Object.keys(l).sort(), ['connector', 'ok', 'status', 'ts']);
  const s = u.formatUsageLine({ ts: 5, connector: 'perplexity', ok: true, status: 200, prompt: PROMPT, apiKey: FAKE_KEY });
  assert.ok(!s.includes(PROMPT) && !s.includes(FAKE_KEY));
  assert.equal(u.sanitizeUsageLine({ ts: 5, connector: 'BAD id', ok: true, status: 200 }), null);
  assert.equal(u.sanitizeUsageLine({ ts: 5, connector: FAKE_KEY, ok: true, status: 200 }), null, 'a key is not a connector id');
  assert.equal(u.sanitizeUsageLine({ ts: 'x', connector: 'openai', ok: true }), null);
  assert.equal(u.sanitizeUsageLine({ ts: 5, connector: 'openai', ok: 'yes' }), null);
  assert.equal(u.sanitizeUsageLine({ ts: 5, connector: 'openai', ok: false, status: 'boom' }).status, null);
  assert.equal(u.formatUsageLine([]), '');
});

test('parseUsageLog skips junk; trimUsageLog keeps the last N lines sanitized', () => {
  const text = [
    JSON.stringify({ ts: 1, connector: 'openai', ok: true, status: 200 }),
    'garbage',
    JSON.stringify({ ts: 2, connector: 'openai', ok: true, status: 200, prompt: PROMPT }),
    '',
    JSON.stringify({ ts: 3, connector: 'openrouter', ok: false, status: 429 })
  ].join('\n');
  assert.equal(u.parseUsageLog(text).length, 3);
  const trimmed = u.trimUsageLog(text, 2);
  assert.equal(trimmed.trim().split('\n').length, 2);
  assert.ok(!trimmed.includes(PROMPT));
  assert.match(trimmed, /"ts":3/);
  assert.equal(u.USAGE_LOG_MAX_LINES, 5000);
});

test('trimUsageLogFile caps the file at the last 5000 lines', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-'));
  const file = path.join(dir, 'api-usage.jsonl');
  const lines = [];
  for (let i = 1; i <= 6200; i++) lines.push(JSON.stringify({ ts: i, connector: 'openai', ok: true, status: 200 }));
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
  mainUsage.trimUsageLogFile(file);
  const kept = fs.readFileSync(file, 'utf8').trim().split('\n');
  assert.equal(kept.length, 5000);
  assert.equal(JSON.parse(kept[0]).ts, 1201);
  assert.equal(JSON.parse(kept[4999]).ts, 6200);
  // missing file is fine
  mainUsage.trimUsageLogFile(path.join(dir, 'nope.jsonl'));
  assert.deepEqual(mainUsage.readLocalUsage(path.join(dir, 'nope.jsonl'), Date.now()).byConnector, {});
  fs.rmSync(dir, { recursive: true, force: true });
});

// ── aggregation ───────────────────────────────────────────────────────────────
test('aggregateUsage: local-day boundaries for today and last 7 days', () => {
  const now = new Date(2026, 9, 11, 14, 30).getTime();
  const at = (d, h, m = 0) => new Date(2026, 9, d, h, m).getTime();
  const L = (ts, connector = 'openai', ok = true, status = 200) => ({ ts, connector, ok, status });
  const lines = [
    L(at(11, 0, 0)), // today, exactly midnight
    L(at(11, 14, 0)),
    L(at(10, 23, 59)), // yesterday
    L(at(5, 0, 0)), // 6 days back at midnight → inside the 7-day window
    L(at(4, 23, 59)), // 7 days back → outside
    L(at(12, 0, 1)), // future (clock skew) → not counted
    L(at(11, 9), 'openrouter', false, 429)
  ];
  const agg = u.aggregateUsage(lines, now);
  assert.equal(agg.openai.today, 2);
  assert.equal(agg.openai.last7, 4);
  assert.equal(agg.openai.lastError, null);
  assert.equal(agg.openai.hint, null);
  assert.equal(agg.openrouter.today, 1);
  assert.deepEqual(agg.openrouter.lastError, { ts: at(11, 9), status: 429, kind: 'rateLimit' });
  assert.equal(agg.openrouter.hint, 'rateLimit');
  assert.equal(u.localDayStart(now), at(11, 0));
  assert.equal(u.localDayStart(now, 6), at(5, 0));
});

test('429 / 402 hint only while the LAST result is that failure', () => {
  const now = Date.now();
  const L = (ts, ok, status, connector = 'openai') => ({ ts, connector, ok, status });
  let agg = u.aggregateUsage([L(now - 3000, true, 200), L(now - 2000, false, 402)], now);
  assert.equal(agg.openai.hint, 'credits');
  assert.equal(agg.openai.lastError.kind, 'credits');
  agg = u.aggregateUsage([L(now - 3000, false, 429), L(now - 1000, true, 200)], now);
  assert.equal(agg.openai.hint, null, 'recovered → no red hint');
  assert.equal(agg.openai.lastError.status, 429, 'but the last error is still shown');
  agg = u.aggregateUsage([L(now - 1000, false, 500)], now);
  assert.equal(agg.openai.hint, null);
  assert.equal(agg.openai.lastError.kind, 'server');
  assert.equal(u.usageErrorKind(null), 'network');
  assert.equal(u.usageErrorKind(401), 'auth');
  assert.equal(u.limitHint({ ok: false, status: 429 }), 'rateLimit');
  assert.equal(u.limitHint({ ok: true, status: 429 }), null);
  assert.equal(u.limitHint(null), null);
});

test('formatting helpers', () => {
  assert.equal(u.msUntilUtcMidnight(Date.UTC(2026, 9, 11, 23, 0)), 3600_000);
  assert.equal(u.msUntilUtcMidnight(Date.UTC(2026, 9, 11, 0, 0)), 86400_000);
  assert.deepEqual(u.splitDuration(3600_000 + 30 * 60_000), { h: 1, m: 30 });
  assert.deepEqual(u.splitDuration(61_000), { h: 0, m: 2 });
  assert.deepEqual(u.splitDuration(-5), { h: 0, m: 0 });
  assert.equal(u.formatCredits(0), '$0.00');
  assert.equal(u.formatCredits(0.0021), '$0.0021');
  assert.equal(u.formatCredits(12.5), '$12.50');
  const now = new Date(2026, 9, 11, 14, 30).getTime();
  assert.equal(u.formatWhen(new Date(2026, 9, 11, 9, 5).getTime(), now), '09:05');
  assert.equal(u.formatWhen(new Date(2026, 9, 9, 21, 0).getTime(), now), '10/9 21:00');
});

// ── api-agent.cjs writes the log (mock server, no real API) ───────────────────
test('spawn rewrite passes an absolute usage-log path only', () => {
  const base = { execPath: '/x/electron', scriptPath: '/r/api-agent.cjs', getKey: () => FAKE_KEY };
  assert.equal(prepareApiAgentSpawn('son-api', ['openai'], { ...base, usageLogPath: '/data/api-usage.jsonl' }).env.SON_API_USAGE_LOG, '/data/api-usage.jsonl');
  assert.equal(prepareApiAgentSpawn('son-api', ['openai'], { ...base, usageLogPath: 'rel/x.jsonl' }).env.SON_API_USAGE_LOG, undefined);
  assert.equal(prepareApiAgentSpawn('son-api', ['openai'], base).env.SON_API_USAGE_LOG, undefined);
});

function runAgent(connectorId, base, lines, logPath) {
  const c = conn.getApiConnector(connectorId);
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT, '--connector', connectorId], {
      env: {
        PATH: process.env.PATH,
        SON_API_CONNECTOR: JSON.stringify({ id: c.id, label: c.label, ...c.api }),
        SON_API_KEY: FAKE_KEY,
        SON_API_BASE_URL: base,
        SON_API_USAGE_LOG: logPath
      },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
    child.on('exit', (code) => { clearTimeout(timer); resolve({ out, code }); });
    for (const l of lines) child.stdin.write(`${l}\n`);
    child.stdin.end();
  });
}

test('api-agent appends one {ts,connector,ok,status} line per request — no prompt, reply or key', async () => {
  let n = 0;
  const server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      n++;
      if (n === 2) {
        res.writeHead(429, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: `Rate limit exceeded for ${FAKE_KEY}` } }));
        return;
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'SECRET-REPLY-TEXT' } }] })}\n\n`);
      res.end('data: [DONE]\n\n');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-agent-'));
  const logPath = path.join(dir, 'api-usage.jsonl');
  try {
    const { code } = await runAgent('openrouter', `http://127.0.0.1:${server.address().port}`, [PROMPT, `${PROMPT} 2`, '/clear', `${PROMPT} 3`], logPath);
    assert.equal(code, 0);
    const raw = fs.readFileSync(logPath, 'utf8');
    assert.ok(!raw.includes(PROMPT), 'prompt leaked into usage log');
    assert.ok(!raw.includes('SECRET-REPLY-TEXT'), 'reply leaked into usage log');
    assert.ok(!raw.includes(FAKE_KEY) && !raw.includes('TESTKEY'), 'key leaked into usage log');
    const rows = raw.trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(rows.length, 3, '/clear is not a request');
    for (const r of rows) assert.deepEqual(Object.keys(r).sort(), ['connector', 'ok', 'status', 'ts']);
    assert.deepEqual(rows.map((r) => [r.connector, r.ok, r.status]), [['openrouter', true, 200], ['openrouter', false, 429], ['openrouter', true, 200]]);
    const sum = mainUsage.readLocalUsage(logPath, Date.now()).byConnector.openrouter;
    assert.equal(sum.today, 3);
    assert.equal(sum.lastError.status, 429);
    assert.equal(sum.hint, null);
  } finally {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('api-agent: connection refused is logged as ok:false, status:null', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-agent-'));
  const logPath = path.join(dir, 'api-usage.jsonl');
  const s = http.createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const port = s.address().port;
  await new Promise((r) => s.close(r));
  try {
    await runAgent('openai', `http://127.0.0.1:${port}`, [PROMPT], logPath);
    const rows = fs.readFileSync(logPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].connector, 'openai');
    assert.equal(rows[0].ok, false);
    assert.equal(rows[0].status, null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── i18n ─────────────────────────────────────────────────────────────────────
function flatten(o, pre = '', out = new Set()) {
  for (const [k, v] of Object.entries(o)) {
    if (v && typeof v === 'object') flatten(v, `${pre}${k}.`, out);
    else out.add(`${pre}${k}`);
  }
  return out;
}

test('extra.usage keys: ko/en parity, used keys exist, plain words, never in en.json', () => {
  const koAll = require('../src/renderer/src/i18n/locales/extra.ko.json');
  const enAll = require('../src/renderer/src/i18n/locales/extra.en.json');
  const ko = flatten(koAll.usage);
  assert.deepEqual([...ko].sort(), [...flatten(enAll.usage)].sort());
  const src = ['UsageLimitsTab.tsx', 'AiConnectModal.tsx'].map((f) => fs.readFileSync(path.join(ROOT, 'src/renderer/src/components', f), 'utf8')).join('\n');
  for (const m of src.matchAll(/'extra\.usage\.([a-zA-Z0-9.-]+)'/g)) assert.ok(ko.has(m[1]), `missing usage.${m[1]}`);
  // dynamic keys
  for (const e of ['no-key', 'bad-key', 'offline', 'later']) assert.ok(ko.has(`or.err.${e}`), e);
  for (const k of ['rateLimit', 'credits', 'auth', 'network', 'server', 'other']) assert.ok(ko.has(`kind.${k}`), k);
  for (const h of ['rateLimit', 'credits']) assert.ok(ko.has(`hint.${h}`), h);
  // placeholders match between languages
  const ph = (s) => [...String(s).matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort().join(',');
  const get = (o, k) => k.split('.').reduce((a, p) => a[p], o);
  for (const k of ko) assert.equal(ph(get(koAll.usage, k)), ph(get(enAll.usage, k)), k);
  assert.equal(koAll.usage.tabConnect, '연결');
  assert.equal(koAll.usage.tabUsage, '사용량·한도');
  assert.equal(koAll.usage.cli.line, '구독 AI의 남은 사용량은 앱에서 읽을 수 없어요. 각 서비스 화면에서 확인하세요.');
  const text = JSON.stringify(koAll.usage);
  assert.ok(!text.includes('에이전트') && !text.includes('확인 필요'), 'everyday words');
  assert.ok(!/\b(50|1000|1,000)\b/.test(text), 'free-tier numbers are not hard-coded');
  const en = JSON.stringify(require('../src/renderer/src/i18n/locales/en.json'));
  assert.ok(!en.includes('사용량') && !en.includes('tabUsage'));
});
