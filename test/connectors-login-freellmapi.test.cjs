'use strict';
/**
 * Connection-type clarity, CLI login launcher, API key pages, and the FreeLLMAPI
 * connector (registry, endpoint validation, openai-chat protocol end to end
 * against a LOCAL mock server, connection test, mascot mapping, i18n parity).
 * No network, no real key, no real terminal is opened.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const loadTs = require('./load-ts.cjs');

const conn = loadTs('src/shared/connectors/index.ts');
const { prepareApiAgentSpawn } = loadTs('src/main/apiAgent.ts');
const login = loadTs('src/main/cliLogin.ts');
const { testApiConnector } = loadTs('src/main/connectorTest.ts');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'resources', 'api-agent.cjs');
const FAKE_KEY = 'freellmapi-SECRET-0123456789abcdefXYZ';

// ── registry ─────────────────────────────────────────────────────────────────
test('freellmapi is registered as an api connector with an editable local endpoint', () => {
  const c = conn.getConnector('freellmapi');
  assert.ok(c, 'freellmapi missing');
  assert.equal(c.kind, 'api');
  assert.equal(c.needsKey, true);
  assert.equal(conn.connectionMethod(c), 'apiKey');
  assert.equal(c.api.protocol, 'openai-chat');
  assert.equal(c.api.endpoint, 'http://localhost:3001/v1');
  assert.equal(c.api.model, 'auto');
  assert.equal(c.api.authScheme, 'bearer');
  assert.equal(c.api.editableEndpoint, true);
  assert.equal(c.connectionTest, 'models');
  assert.match(c.docsUrl, /^https:\/\/github\.com\/tashfeenahmed\/freellmapi/);
  assert.ok(conn.getApiConnector('freellmapi'));
  assert.equal(conn.apiAgentCommand('freellmapi'), 'son-api freellmapi');
});

test('only freellmapi allows an endpoint override; hosted APIs keep their fixed https endpoint', () => {
  for (const c of conn.connectorsByKind('api')) {
    if (c.id === 'freellmapi') continue;
    assert.notEqual(c.api.editableEndpoint, true, c.id);
    assert.equal(conn.effectiveEndpoint(c, 'https://evil.example/v1'), c.api.endpoint, `${c.id} accepted an override`);
  }
});

test('connection method badge: every connector maps to login / apiKey / unavailable', () => {
  for (const c of conn.CONNECTORS) {
    const m = conn.connectionMethod(c);
    assert.equal(m, c.kind === 'cli' ? 'login' : c.kind === 'api' ? 'apiKey' : 'unavailable', c.id);
  }
  assert.equal(conn.connectionMethod(conn.getConnector('capcut')), 'unavailable');
});

test('api connectors: keyUrl, when present, is https; the hosted three have a verified key page', () => {
  for (const c of conn.connectorsByKind('api')) {
    if (c.keyUrl !== undefined) assert.match(c.keyUrl, /^https:\/\/[a-z0-9.-]+(\/|$)/, c.id);
    assert.match(c.docsUrl, /^https:\/\//, `${c.id} needs an https docs fallback`);
  }
  assert.equal(conn.getConnector('openai').keyUrl, 'https://platform.openai.com/api-keys');
  assert.equal(conn.getConnector('perplexity').keyUrl, 'https://console.perplexity.ai/project/keys');
  assert.equal(conn.getConnector('higgsfield').keyUrl, 'https://console.higgsfield.ai');
  assert.equal(conn.getConnector('freellmapi').keyUrl, undefined, 'self-hosted: no hosted key page, docs are used');
});

test('no secrets in connector config', () => {
  const blob = JSON.stringify(conn.CONNECTORS);
  assert.ok(!/\bsk-[A-Za-z0-9]{8,}/.test(blob), 'OpenAI-style key in registry');
  assert.ok(!/\bpplx-[A-Za-z0-9]{8,}/.test(blob), 'Perplexity-style key in registry');
  assert.ok(!/\bfreellmapi-[A-Za-z0-9]{6,}/.test(blob), 'FreeLLMAPI key in registry');
  assert.ok(!/(api[_-]?key|secret|token|password)"\s*:/i.test(blob), 'secret-shaped field in registry');
  const s = prepareApiAgentSpawn('son-api', ['freellmapi'], {
    execPath: '/x/electron', scriptPath: '/r/api-agent.cjs', getKey: () => FAKE_KEY,
    getEndpoint: () => 'http://127.0.0.1:4000/v1/'
  });
  assert.ok(!s.env.SON_API_CONNECTOR.includes(FAKE_KEY));
  assert.ok(!s.args.join(' ').includes(FAKE_KEY));
  assert.equal(JSON.parse(s.env.SON_API_CONNECTOR).endpoint, 'http://127.0.0.1:4000/v1', 'valid override is used, normalized');
  const bad = prepareApiAgentSpawn('son-api', ['freellmapi'], {
    execPath: '/x/electron', scriptPath: '/r/api-agent.cjs', getKey: () => FAKE_KEY,
    getEndpoint: () => 'http://attacker.example/v1'
  });
  assert.equal(JSON.parse(bad.env.SON_API_CONNECTOR).endpoint, 'http://localhost:3001/v1', 'invalid override falls back to default');
});

// ── endpoint validation ──────────────────────────────────────────────────────
test('validateConnectorEndpoint: only http loopback or https, no other schemes/credentials/query', () => {
  const ok = (u, want) => {
    const r = conn.validateConnectorEndpoint(u);
    assert.ok(r.ok, `${u} should be ok (${r.error})`);
    if (want) assert.equal(r.url, want);
  };
  const bad = (u, code) => {
    const r = conn.validateConnectorEndpoint(u);
    assert.equal(r.ok, false, `${u} should be refused`);
    if (code) assert.equal(r.error, code, u);
  };
  ok('http://localhost:3001/v1', 'http://localhost:3001/v1');
  ok('http://localhost:3001/v1/', 'http://localhost:3001/v1');
  ok('  http://127.0.0.1:8080/v1 ', 'http://127.0.0.1:8080/v1');
  ok('http://[::1]:3001/v1');
  ok('HTTP://LOCALHOST:3001/v1');
  ok('https://router.example.com/v1');
  bad('', 'empty');
  bad(undefined, 'empty');
  bad(42, 'empty');
  bad('file:///etc/passwd', 'scheme');
  bad('javascript:alert(1)', 'scheme');
  bad('ftp://localhost/v1', 'scheme');
  bad('ws://localhost:3001', 'scheme');
  bad('http://192.168.0.10:3001/v1', 'http-remote');
  bad('http://example.com/v1', 'http-remote');
  bad('http://localhost.evil.com/v1', 'http-remote');
  bad('http://127.0.0.1.nip.io/v1', 'http-remote');
  bad('https://user:pw@example.com/v1', 'credentials');
  bad('http://localhost:3001/v1?x=1', 'query');
  bad('http://localhost:3001/v1#frag', 'query');
  bad('not a url', 'invalid');
  bad(`https://example.com/${'a'.repeat(600)}`, 'too-long');
});

test('sanitizeConnectorEndpoints keeps only valid urls for editable connectors', () => {
  assert.deepEqual(
    conn.sanitizeConnectorEndpoints({
      freellmapi: 'http://localhost:3002/v1/',
      openai: 'http://localhost:1/v1',
      claude: 'https://x.example',
      nope: 'https://x.example'
    }),
    { freellmapi: 'http://localhost:3002/v1' }
  );
  assert.deepEqual(conn.sanitizeConnectorEndpoints({ freellmapi: 'file:///x' }), {});
  assert.deepEqual(conn.sanitizeConnectorEndpoints(null), {});
  assert.deepEqual(conn.sanitizeConnectorEndpoints(['x']), {});
});

// ── CLI login specs + launcher ───────────────────────────────────────────────
test('every cli connector has a docs-verified login spec with safe constant argv', () => {
  for (const c of conn.connectorsByKind('cli')) {
    const l = c.login;
    assert.ok(l, `${c.id} has no login spec`);
    assert.ok(['command', 'first-run'].includes(l.mode), c.id);
    assert.ok(l.bins.length > 0, c.id);
    for (const b of l.bins) assert.match(b, /^[A-Za-z0-9._-]+$/, c.id);
    for (const a of l.args) assert.match(a, /^[A-Za-z0-9._-]+$/, c.id);
    assert.equal(l.mode === 'command', l.args.length > 0, `${c.id}: command mode ⇔ has args`);
    assert.match(l.sourceUrl, /^https:\/\//, c.id);
    assert.match(l.checked, /^\d{4}-\d{2}-\d{2}$/, c.id);
    if (l.inside) assert.match(l.inside, /^\/[a-z]+$/, c.id);
  }
  const cmd = (id) => [conn.getConnector(id).login.bins[0], ...conn.getConnector(id).login.args].join(' ');
  assert.equal(cmd('claude'), 'claude auth login');
  assert.equal(cmd('codex'), 'codex login');
  assert.equal(cmd('grok'), 'grok login');
  assert.equal(cmd('cursor'), 'agent login');
  assert.equal(cmd('opencode'), 'opencode auth login');
  assert.equal(cmd('copilot'), 'copilot login');
  assert.equal(conn.getConnector('gemini').login.mode, 'first-run');
  assert.equal(conn.getConnector('qwen').login.inside, '/auth');
});

function fakeDeps(platform, found, started = true) {
  const launches = [];
  return {
    launches,
    deps: {
      platform,
      resolve: (bin) => (found[bin] ?? null),
      start: async (l) => { launches.push(l); return started; }
    }
  };
}

test('launchCliLogin: unknown / api / missing CLI never start anything', async () => {
  const { launches, deps } = fakeDeps('linux', {});
  assert.deepEqual(await login.launchCliLogin('nope', deps), { ok: false, error: 'unknown-connector' });
  assert.deepEqual(await login.launchCliLogin('openai', deps), { ok: false, error: 'unknown-connector' });
  assert.deepEqual(await login.launchCliLogin({ id: 'claude' }, deps), { ok: false, error: 'unknown-connector' });
  const r = await login.launchCliLogin('codex', deps);
  assert.equal(r.ok, false);
  assert.equal(r.error, 'not-installed');
  assert.match(r.docsUrl, /^https:\/\//);
  assert.equal(launches.length, 0);
});

test('launchCliLogin: windows opens a new cmd window running the official login command', async () => {
  const { launches, deps } = fakeDeps('win32', { claude: 'C:\\Users\\Kim Lee\\AppData\\Roaming\\npm\\claude.cmd' });
  const r = await login.launchCliLogin('claude', deps);
  assert.deepEqual(r, { ok: true, mode: 'command', command: 'claude auth login' });
  assert.equal(launches.length, 1);
  const l = launches[0];
  assert.equal(l.command, 'cmd.exe');
  assert.equal(l.windowsVerbatimArguments, true);
  assert.deepEqual(l.args.slice(0, 3), ['/d', '/s', '/c']);
  assert.equal(l.args[3], 'start "SON AI Office login" cmd.exe /k ""C:\\Users\\Kim Lee\\AppData\\Roaming\\npm\\claude.cmd" auth login"');
});

test('launchCliLogin: windows falls back to the bare name for an extensionless shim or metacharacters', async () => {
  let { launches, deps } = fakeDeps('win32', { codex: 'C:\\npm\\codex' });
  await login.launchCliLogin('codex', deps);
  assert.match(launches[0].args[3], /cmd\.exe \/k ""codex" login"$/);
  ({ launches, deps } = fakeDeps('win32', { codex: 'C:\\A&B\\codex.cmd' }));
  await login.launchCliLogin('codex', deps);
  assert.match(launches[0].args[3], /""codex" login"$/);
  assert.ok(!launches[0].args[3].includes('&'));
});

test('launchCliLogin: first-run CLIs launch the CLI itself and report the slash command', async () => {
  const { launches, deps } = fakeDeps('darwin', { qwen: '/usr/local/bin/qwen' });
  const r = await login.launchCliLogin('qwen', deps);
  assert.deepEqual(r, { ok: true, mode: 'first-run', command: 'qwen', inside: '/auth' });
  assert.equal(launches[0].command, 'osascript');
  assert.equal(launches[0].args[1], `tell application "Terminal" to do script "'/usr/local/bin/qwen'"`);
});

test('launchCliLogin: cursor tries the documented `agent` first, then legacy `cursor-agent`', async () => {
  const { launches, deps } = fakeDeps('linux', { 'cursor-agent': '/home/u/.local/bin/cursor-agent', xterm: '/usr/bin/xterm' });
  const r = await login.launchCliLogin('cursor', deps);
  assert.equal(r.ok, true);
  assert.equal(r.command, 'cursor-agent login');
  assert.equal(launches[0].command, 'xterm');
  assert.deepEqual(launches[0].args.slice(0, 3), ['-e', 'sh', '-c']);
  assert.match(launches[0].args[3], /^'\/home\/u\/\.local\/bin\/cursor-agent' login; /);
});

test('launchCliLogin: linux without a terminal emulator / failed spawn report errors', async () => {
  let { launches, deps } = fakeDeps('linux', { codex: '/usr/bin/codex' });
  assert.equal((await login.launchCliLogin('codex', deps)).error, 'no-terminal');
  assert.equal(launches.length, 0);
  ({ deps } = fakeDeps('win32', { codex: 'C:\\npm\\codex.cmd' }, false));
  assert.equal((await login.launchCliLogin('codex', deps)).error, 'spawn-failed');
});

test('buildLoginTerminalLaunch refuses unsafe argv', () => {
  assert.throws(() => login.buildLoginTerminalLaunch('win32', 'claude', ['auth', 'login&calc']));
  assert.throws(() => login.safeExecutable('/x', 'rm -rf'));
});

// ── api-agent.cjs openai-chat against a local mock ───────────────────────────
function startMock(handler) {
  return new Promise((resolve) => {
    const seen = [];
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => { seen.push({ method: req.method, url: req.url, headers: req.headers, body }); handler(req, res, body); });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, seen, base: `http://127.0.0.1:${server.address().port}` }));
  });
}

function runAgent(base, lines, extraEnv = {}) {
  const c = conn.getApiConnector('freellmapi');
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT, '--connector', 'freellmapi'], {
      env: {
        PATH: process.env.PATH,
        SON_API_CONNECTOR: JSON.stringify({ id: c.id, label: c.label, ...c.api }),
        SON_API_KEY: FAKE_KEY,
        SON_API_BASE_URL: base,
        ...extraEnv
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

test('openai-chat: streams chat-completions deltas, replays history, never echoes the key', async () => {
  let n = 0;
  const { server, seen, base } = await startMock((req, res) => {
    n++;
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { role: 'assistant' } }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Free ' } }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: `answer #${n}` } }] })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  });
  try {
    const { out, code } = await runAgent(base, ['hello', 'again']);
    assert.equal(code, 0);
    assert.match(out, /Free answer #1/);
    assert.match(out, /Free answer #2/);
    assert.ok(!out.includes(FAKE_KEY));
    assert.equal(seen[0].url, '/v1/chat/completions');
    assert.equal(seen[0].headers.authorization, `Bearer ${FAKE_KEY}`);
    const b = JSON.parse(seen[1].body);
    assert.equal(b.model, 'auto');
    assert.equal(b.stream, true);
    assert.deepEqual(b.messages.map((m) => m.role), ['user', 'assistant', 'user']);
    assert.equal(b.messages[1].content, 'Free answer #1');
  } finally {
    server.close();
  }
});

test('openai-chat: a refused connection prints a Korean "is it running?" hint', async () => {
  const { server, base } = await startMock(() => {});
  await new Promise((r) => server.close(r));
  const { out } = await runAgent(base, ['hello']);
  assert.match(out, /서버에 연결할 수 없습니다/);
  assert.ok(!out.includes(FAKE_KEY));
});

// ── connection test (main) ───────────────────────────────────────────────────
test('connection test: GET {endpoint}/models with the key; status only in the reply', async () => {
  const calls = [];
  const mkFetch = (status, body) => async (url, init) => {
    calls.push({ url, init });
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  const deps = (f, ep) => ({ getKey: () => FAKE_KEY, getEndpoint: () => ep, fetch: f });
  const r = await testApiConnector('freellmapi', deps(mkFetch(200, { data: [{}, {}, {}] }), 'http://127.0.0.1:3005/v1'));
  assert.deepEqual(r, { ok: true, models: 3 });
  assert.equal(calls[0].url, 'http://127.0.0.1:3005/v1/models');
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${FAKE_KEY}`);
  assert.equal(calls[0].init.redirect, 'error');
  assert.deepEqual(await testApiConnector('freellmapi', deps(mkFetch(401, {}), undefined)), { ok: false, error: 'auth', status: 401 });
  assert.equal(calls[1].url, 'http://localhost:3001/v1/models', 'default endpoint');
  assert.deepEqual(await testApiConnector('freellmapi', deps(mkFetch(500, {}), 'file:///x')), { ok: false, error: 'http', status: 500 });
  assert.equal(calls[2].url, 'http://localhost:3001/v1/models', 'invalid override ignored');
  const refused = async () => { const e = new TypeError('fetch failed'); e.cause = { code: 'ECONNREFUSED' }; throw e; };
  assert.deepEqual(await testApiConnector('freellmapi', deps(refused)), { ok: false, error: 'refused' });
  assert.deepEqual(await testApiConnector('openai', deps(mkFetch(200, {}))), { ok: false, error: 'no-test' });
  assert.deepEqual(await testApiConnector('claude', deps(mkFetch(200, {}))), { ok: false, error: 'unknown-connector' });
  for (const x of calls) assert.ok(!String(x.url).includes(FAKE_KEY));
});

// ── mascot mapping ───────────────────────────────────────────────────────────
test('FreeLLMAPI mascot: picker entry, picture ⇄ engine mapping', () => {
  const art = loadTs('src/renderer/src/scene/office/aiMascotArt.ts');
  assert.ok(art.isMascotName('ai-freellmapi'));
  assert.ok(art.MASCOT_NAMES.includes('ai-freellmapi'));
  const m = art.MASCOTS['ai-freellmapi'];
  assert.equal(m.label, 'FreeLLMAPI');
  assert.match(m.blurb, /[가-힣]/, 'Korean blurb');
  assert.equal(m.mask.length, 14);
  for (const row of m.mask) assert.equal(row.length, 14);
  assert.equal(art.providerForMascot('ai-freellmapi'), 'custom');
  assert.equal(art.apiConnectorForMascot('ai-freellmapi'), 'freellmapi');
  assert.equal(art.apiConnectorForMascot('ai-codex'), undefined);
  assert.equal(art.providerForMascot('ai-codex'), 'codex');
  assert.equal(art.mascotForAgent('custom', 'son-api freellmapi'), 'ai-freellmapi');
  assert.equal(art.mascotForAgent('custom', 'son-api freellmapi --model auto:fast'), 'ai-freellmapi');
  assert.equal(art.mascotForAgent('custom', 'son-api openai'), 'ai-custom', 'connectors without a mascot keep the custom one');
  assert.equal(art.mascotForAgent('custom', 'my-cli'), 'ai-custom');
  assert.equal(art.mascotForAgent('codex', 'codex'), 'ai-codex');
});

// ── i18n ─────────────────────────────────────────────────────────────────────
function flatten(o, pre = '', out = new Set()) {
  for (const [k, v] of Object.entries(o)) {
    if (v && typeof v === 'object') flatten(v, `${pre}${k}.`, out);
    else out.add(`${pre}${k}`);
  }
  return out;
}

test('extra.connectors key trees are identical in ko/en and cover the keys the UI uses', () => {
  const ko = require('../src/renderer/src/i18n/locales/extra.ko.json').connectors;
  const en = require('../src/renderer/src/i18n/locales/extra.en.json').connectors;
  const fk = flatten(ko);
  const fe = flatten(en);
  assert.deepEqual([...fk].sort(), [...fe].sort());
  for (const k of fk) assert.ok(String(ko[k] ?? '') !== undefined);
  const files = ['ConnectorsSettings.tsx', 'ConnectorBits.tsx', 'AddAgentModal.tsx']
    .map((f) => fs.readFileSync(path.join(ROOT, 'src/renderer/src/components', f), 'utf8'))
    .join('\n');
  for (const m of files.matchAll(/'extra\.connectors\.([a-zA-Z0-9.-]+)'/g)) assert.ok(fk.has(m[1]), `missing key ${m[1]}`);
  for (const meth of ['login', 'apiKey', 'unavailable']) {
    assert.ok(fk.has(`method.${meth}`) && fk.has(`methodHint.${meth}`), meth);
  }
  assert.equal(ko.method.login, '로그인 방식');
  assert.equal(ko.method.apiKey, 'API 키 방식');
  assert.equal(ko.method.unavailable, '연결 불가');
  assert.equal(ko.keyUrl, 'API 키 발급 페이지 열기');
  for (const code of ['empty', 'too-long', 'invalid', 'scheme', 'http-remote', 'credentials', 'query']) assert.ok(fk.has(`endpoint.err.${code}`), code);
  for (const code of ['auth', 'refused', 'timeout', 'http', 'network', 'no-test', 'unknown-connector']) assert.ok(fk.has(`test.err.${code}`), code);
  // Korean UI text really is Korean.
  for (const k of ['login.button', 'freellmapi.warn1', 'freellmapi.step1', 'test.button']) {
    const v = k.split('.').reduce((o, p) => o[p], ko);
    assert.match(v, /[가-힣]/, k);
  }
});

test('en.json was not touched with connector keys', () => {
  const en = require('../src/renderer/src/i18n/locales/en.json');
  assert.ok(!JSON.stringify(en).includes('FreeLLMAPI'));
});
