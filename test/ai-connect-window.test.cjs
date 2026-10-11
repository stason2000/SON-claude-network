'use strict';
/**
 * "AI 연결" window: which AIs still need connecting (shared/connectors/connectionList),
 * the read-only CLI status check (main/cliStatus.ts, fake resolve/run — no real CLI
 * is started), the cliConnected config sanitizer, and i18n coverage.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const conn = loadTs('src/shared/connectors/index.ts');
const status = loadTs('src/main/cliStatus.ts');
const ROOT = path.join(__dirname, '..');

const empty = () => ({ hasKey: {}, cliConnected: {}, cliCheck: {} });

test('nothing connected → every cli + api connector is pending, never unavailable ones', () => {
  const { pending, connected } = conn.splitConnections(conn.listConnectors(), empty());
  assert.equal(connected.length, 0);
  const kinds = new Set(pending.map((c) => c.kind));
  assert.deepEqual([...kinds].sort(), ['api', 'cli']);
  assert.ok(!pending.some((c) => c.id === 'capcut'));
  const expected = conn.listConnectors().filter((c) => c.kind !== 'unavailable').length;
  assert.equal(pending.length, expected);
  assert.equal(conn.pendingConnectionCount(conn.listConnectors(), empty()), expected);
});

test('api connector is connected exactly when a key is stored', () => {
  const openai = conn.getConnector('openai');
  assert.equal(conn.isConnectorConnected(openai, empty()), false);
  assert.equal(conn.isConnectorConnected(openai, { ...empty(), hasKey: { openai: true } }), true);
  assert.equal(conn.connectedVia(openai, { ...empty(), hasKey: { openai: true } }), 'key');
  // a manual CLI flag never connects an API connector
  assert.equal(conn.isConnectorConnected(openai, { ...empty(), cliConnected: { openai: true } }), false);
});

test('cli: auto check wins, manual flag is the fallback, not-installed is never connected', () => {
  const claude = conn.getConnector('claude');
  const i = (o) => ({ ...empty(), ...o });
  assert.equal(conn.isConnectorConnected(claude, i({})), false);
  assert.equal(conn.isConnectorConnected(claude, i({ cliConnected: { claude: true } })), true);
  assert.equal(conn.connectedVia(claude, i({ cliConnected: { claude: true } })), 'manual');
  assert.equal(conn.isConnectorConnected(claude, i({ cliCheck: { claude: { state: 'connected', auto: true } } })), true);
  assert.equal(conn.connectedVia(claude, i({ cliCheck: { claude: { state: 'connected', auto: true } } })), 'auto');
  assert.equal(conn.isConnectorConnected(claude, i({ cliConnected: { claude: true }, cliCheck: { claude: { state: 'not-connected', auto: true } } })), false);
  assert.equal(conn.isConnectorConnected(claude, i({ cliConnected: { claude: true }, cliCheck: { claude: { state: 'not-installed', auto: false } } })), false);
  assert.equal(conn.isConnectorConnected(claude, i({ cliConnected: { claude: true }, cliCheck: { claude: { state: 'unknown', auto: false } } })), true);
});

test('connected AIs leave the pending list and keep registry order', () => {
  const inputs = { hasKey: { openai: true }, cliConnected: { gemini: true }, cliCheck: { claude: { state: 'connected', auto: true } } };
  const { pending, connected } = conn.splitConnections(conn.listConnectors(), inputs);
  assert.deepEqual(connected.map((c) => c.id), ['claude', 'gemini', 'openai']);
  for (const id of ['claude', 'gemini', 'openai']) assert.ok(!pending.some((c) => c.id === id), id);
  const all = Object.fromEntries(conn.listConnectors().filter(conn.isConnectable).map((c) => [c.id, true]));
  const allDone = {
    hasKey: all,
    cliConnected: all,
    cliCheck: {}
  };
  assert.equal(conn.pendingConnectionCount(conn.listConnectors(), allDone), 0);
});

test('sanitizeCliConnected keeps only {cliId: true}', () => {
  const out = conn.sanitizeCliConnected(
    { claude: true, codex: false, openai: true, capcut: true, nope: true, 'BAD id': true, gemini: 'yes' },
    conn.isCliConnectorId
  );
  assert.deepEqual(out, { claude: true });
  assert.deepEqual(conn.sanitizeCliConnected(null, conn.isCliConnectorId), {});
  assert.deepEqual(conn.sanitizeCliConnected(['claude'], conn.isCliConnectorId), {});
});

test('only claude and codex carry a documented status command', () => {
  const withStatus = conn.listConnectors().filter((c) => c.kind === 'cli' && c.login && c.login.status).map((c) => c.id);
  assert.deepEqual(withStatus.sort(), ['claude', 'codex']);
  const cs = conn.getConnector('claude').login.status;
  assert.deepEqual(cs.args, ['auth', 'status']);
  assert.deepEqual(cs.loggedOutCodes, [1]);
  assert.match(cs.sourceUrl, /^https:\/\/code\.claude\.com\//);
  const xs = conn.getConnector('codex').login.status;
  assert.deepEqual(xs.args, ['login', 'status']);
  assert.deepEqual(xs.loggedOutCodes, []);
  assert.match(xs.sourceUrl, /^https:\/\/developers\.openai\.com\//);
});

// ── main: checkCliConnection with fakes ───────────────────────────────────────
function deps({ installed = {}, code = 0, timedOut = false, platform = 'linux', calls = [] } = {}) {
  return {
    platform,
    resolve: (bin) => installed[bin] ?? null,
    run: async (launch, timeoutMs) => { calls.push({ launch, timeoutMs }); return { code, timedOut }; }
  };
}

test('not installed → not-installed, nothing run', async () => {
  const calls = [];
  assert.deepEqual(await status.checkCliConnection('claude', deps({ calls })), { state: 'not-installed', auto: false });
  assert.equal(calls.length, 0);
});

test('claude: exit 0 → connected, exit 1 → not-connected, other → unknown; only `auth status` is run', async () => {
  const installed = { claude: '/usr/local/bin/claude' };
  const calls = [];
  assert.deepEqual(await status.checkCliConnection('claude', deps({ installed, code: 0, calls })), { state: 'connected', auto: true });
  assert.deepEqual(calls[0].launch, { command: '/usr/local/bin/claude', args: ['auth', 'status'] });
  assert.ok(calls[0].timeoutMs > 0 && calls[0].timeoutMs <= 10000);
  assert.deepEqual(await status.checkCliConnection('claude', deps({ installed, code: 1 })), { state: 'not-connected', auto: true });
  assert.deepEqual(await status.checkCliConnection('claude', deps({ installed, code: 2 })), { state: 'unknown', auto: false });
  assert.deepEqual(await status.checkCliConnection('claude', deps({ installed, code: null, timedOut: true })), { state: 'unknown', auto: false });
});

test('codex: only exit 0 is trusted (no documented logged-out code)', async () => {
  const installed = { codex: '/usr/bin/codex' };
  assert.deepEqual(await status.checkCliConnection('codex', deps({ installed, code: 0 })), { state: 'connected', auto: true });
  assert.deepEqual(await status.checkCliConnection('codex', deps({ installed, code: 1 })), { state: 'unknown', auto: false });
});

test('cli without a status command → unknown (manual button), installed check still works', async () => {
  const calls = [];
  assert.deepEqual(await status.checkCliConnection('gemini', deps({ installed: { gemini: '/usr/bin/gemini' }, calls })), { state: 'unknown', auto: false });
  assert.equal(calls.length, 0);
  assert.deepEqual(await status.checkCliConnection('gemini', deps()), { state: 'not-installed', auto: false });
});

test('unknown / non-cli ids are refused without running anything', async () => {
  const calls = [];
  for (const id of ['openai', 'capcut', 'nope', 42, null]) {
    assert.deepEqual(await status.checkCliConnection(id, deps({ installed: { claude: '/x' }, calls })), { state: 'unknown', auto: false });
  }
  assert.equal(calls.length, 0);
});

test('windows launch goes through cmd.exe verbatim; unsafe args are refused', async () => {
  const calls = [];
  await status.checkCliConnection('claude', deps({ platform: 'win32', installed: { claude: 'C:\\npm\\claude.cmd' }, calls }));
  assert.deepEqual(calls[0].launch, {
    command: 'cmd.exe', args: ['/d', '/s', '/c', '""C:\\npm\\claude.cmd" auth status"'], windowsVerbatimArguments: true
  });
  assert.throws(() => status.buildStatusLaunch('linux', 'claude', ['auth;rm']));
});

// ── i18n ─────────────────────────────────────────────────────────────────────
function flatten(o, pre = '', out = new Set()) {
  for (const [k, v] of Object.entries(o)) {
    if (v && typeof v === 'object') flatten(v, `${pre}${k}.`, out);
    else out.add(`${pre}${k}`);
  }
  return out;
}

test('extra.aiConnect keys: ko/en parity, every used key exists, plain Korean', () => {
  const koAll = require('../src/renderer/src/i18n/locales/extra.ko.json');
  const enAll = require('../src/renderer/src/i18n/locales/extra.en.json');
  const ko = flatten(koAll.aiConnect);
  assert.deepEqual([...ko].sort(), [...flatten(enAll.aiConnect)].sort());
  const src = ['AiConnectModal.tsx'].map((f) => fs.readFileSync(path.join(ROOT, 'src/renderer/src/components', f), 'utf8')).join('\n')
    + fs.readFileSync(path.join(ROOT, 'src/renderer/src/App.tsx'), 'utf8');
  for (const m of src.matchAll(/'extra\.aiConnect\.([a-zA-Z0-9.-]+)'/g)) assert.ok(ko.has(m[1]), `missing aiConnect.${m[1]}`);
  for (const via of ['key', 'auto', 'manual']) assert.ok(ko.has(`via.${via}`), via);
  const cn = flatten(koAll.connectors);
  for (const m of src.matchAll(/'extra\.connectors\.([a-zA-Z0-9.-]+)'/g)) assert.ok(cn.has(m[1]), `missing connectors.${m[1]}`);
  assert.equal(koAll.aiConnect.title, 'AI 연결');
  assert.equal(koAll.aiConnect.allDone, '모든 AI가 연결되어 있어요');
  assert.equal(koAll.aiConnect.showConnected.startsWith('연결된 AI 보기'), true);
  assert.equal(koAll.aiConnect.markDone, '연결했어요');
  const text = JSON.stringify(koAll.aiConnect) + koAll.connectors.aiConnectNote;
  assert.ok(!text.includes('에이전트') && !text.includes('확인 필요'), 'everyday words');
  assert.match(koAll.connectors.aiConnectNote, /AI 연결/);
});

test('en.json untouched by the AI 연결 window', () => {
  const en = JSON.stringify(require('../src/renderer/src/i18n/locales/en.json'));
  assert.ok(!en.includes('aiConnect'));
});
