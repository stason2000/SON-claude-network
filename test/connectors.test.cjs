'use strict';
/**
 * Connector layer tests: registry shape, the write-only encrypted key store, the
 * main-side API-agent spawn rewrite, and resources/api-agent.cjs end to end
 * against a LOCAL mock HTTP server (no network, no real key).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const loadTs = require('./load-ts.cjs');

const conn = loadTs('src/shared/connectors/index.ts');
const { AGENT_PROVIDER_PRESETS } = loadTs('src/shared/agentProvider.ts');
const keys = loadTs('src/main/apiKeys.ts');
const { prepareApiAgentSpawn } = loadTs('src/main/apiAgent.ts');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'resources', 'api-agent.cjs');
const FAKE_KEY = 'sk-test-SECRET-0123456789abcdefXYZ';

// ── registry ───────────────────────────────────────────────────────────────────
test('registry ids are unique and every connector is well-formed', () => {
  const ids = conn.CONNECTORS.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, `duplicate ids: ${ids}`);
  for (const c of conn.CONNECTORS) {
    assert.ok(['cli', 'api', 'unavailable'].includes(c.kind), c.id);
    assert.ok(c.strengths.length > 0, `${c.id} declares no strengths`);
    for (const s of c.strengths) assert.ok(conn.CONNECTOR_STRENGTHS.includes(s), `${c.id}: bad strength ${s}`);
    assert.equal(typeof c.verified, 'boolean', c.id);
    assert.equal(c.needsKey, c.kind === 'api', c.id);
  }
});

test('every api connector has an https endpoint, a model and an auth scheme', () => {
  const apis = conn.connectorsByKind('api');
  assert.ok(apis.length >= 2);
  for (const c of apis) {
    assert.match(c.api.endpoint, /^https:\/\//, c.id);
    assert.ok(c.api.model && typeof c.api.model === 'string', `${c.id} has no model`);
    assert.ok(['openai-responses', 'higgsfield-queue'].includes(c.api.protocol), c.id);
    assert.ok(['bearer', 'key'].includes(c.api.authScheme), c.id);
  }
});

test('every cli connector wraps an existing provider preset; every preset but custom is exposed', () => {
  const presetIds = new Set(AGENT_PROVIDER_PRESETS.map((p) => p.id));
  for (const c of conn.connectorsByKind('cli')) assert.ok(presetIds.has(c.provider), c.id);
  for (const p of AGENT_PROVIDER_PRESETS) {
    if (p.id === 'custom') continue;
    assert.ok(conn.cliConnectorForProvider(p.id), `preset ${p.id} has no connector`);
  }
});

test('unavailable connectors carry a Korean and English reason; CapCut is one', () => {
  for (const c of conn.connectorsByKind('unavailable')) {
    assert.ok(c.reason.ko.length > 10 && c.reason.en.length > 10, c.id);
  }
  assert.equal(conn.getConnector('capcut').kind, 'unavailable');
});

test('son-api sentinel parsing', () => {
  assert.equal(conn.parseApiAgentCommand('claude', ['--model', 'x']), null);
  assert.deepEqual(Object.keys(conn.parseApiAgentCommand('son-api', ['nope'])), ['error']);
  assert.ok('error' in conn.parseApiAgentCommand('son-api', ['claude']), 'a cli id is not an api connector');
  const p = conn.parseApiAgentCommand('son-api', ['openai', '--model', 'gpt-6-luna']);
  assert.equal(p.connector.id, 'openai');
  assert.equal(p.model, 'gpt-6-luna');
  assert.ok('error' in conn.parseApiAgentCommand('son-api', ['openai', '--model', 'a b;rm']));
  assert.equal(conn.apiAgentCommand('perplexity'), 'son-api perplexity');
});

// ── key store ──────────────────────────────────────────────────────────────────
function fakeCrypto(available = true) {
  // Reversible but NOT identity, so plaintext must never appear in the file.
  return {
    isAvailable: () => available,
    encrypt: (s) => Buffer.from(Buffer.from(s, 'utf8').map((b) => b ^ 0x5a)),
    decrypt: (b) => Buffer.from(b.map((x) => x ^ 0x5a)).toString('utf8')
  };
}
function tmpFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'son-keys-')), 'connector-keys.json');
}

test('key store encrypts at rest and never returns plaintext over the renderer surface', () => {
  const file = tmpFile();
  const store = keys.createApiKeyStore({ filePath: () => file, crypto: fakeCrypto() });
  const handlers = new Map();
  keys.registerApiKeyIpc({ handle: (ch, fn) => handlers.set(ch, fn) }, store, (id) => !!conn.getApiConnector(id));

  // The renderer surface is exactly set/has/clear — no get.
  assert.deepEqual([...handlers.keys()].sort(), ['connectorKey:clear', 'connectorKey:has', 'connectorKey:set']);

  const replies = [];
  replies.push(handlers.get('connectorKey:has')(null, 'openai'));
  replies.push(handlers.get('connectorKey:set')(null, { id: 'openai', key: FAKE_KEY }));
  replies.push(handlers.get('connectorKey:has')(null, 'openai'));
  replies.push(handlers.get('connectorKey:set')(null, { id: 'claude', key: FAKE_KEY })); // not an api connector
  replies.push(handlers.get('connectorKey:set')(null, { id: 'openai', key: 'bad key\nwith newline' }));
  assert.deepEqual(replies.slice(0, 3), [false, { ok: true }, true]);
  assert.equal(replies[3].ok, false);
  assert.equal(replies[4].ok, false);
  for (const r of replies) assert.ok(!JSON.stringify(r).includes(FAKE_KEY), 'reply leaked the key');

  const onDisk = fs.readFileSync(file, 'utf8');
  assert.ok(!onDisk.includes(FAKE_KEY), 'plaintext key on disk');
  assert.ok(!onDisk.includes('SECRET'), 'key fragment on disk');
  assert.equal(store.getKeyForSpawn('openai'), FAKE_KEY, 'main-internal decrypt round-trips');

  assert.deepEqual(handlers.get('connectorKey:clear')(null, 'openai'), { ok: true });
  assert.equal(handlers.get('connectorKey:has')(null, 'openai'), false);
  assert.equal(fs.existsSync(file), false, 'empty store removes the file');
});

test('key store fails closed when OS encryption is unavailable', () => {
  const file = tmpFile();
  const store = keys.createApiKeyStore({ filePath: () => file, crypto: fakeCrypto(false) });
  const r = store.setKey('openai', FAKE_KEY);
  assert.equal(r.ok, false);
  assert.ok(!JSON.stringify(r).includes(FAKE_KEY));
  assert.equal(fs.existsSync(file), false, 'nothing written');
});

test('preload exposes only set/has/clear for connector keys', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/preload/index.ts'), 'utf8');
  const channels = [...src.matchAll(/'connectorKey:([a-zA-Z]+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(channels, ['clear', 'has', 'set']);
  assert.ok(!/connectorKeyGet|getKeyForSpawn/.test(src));
});

test('spawn rewrite puts the key only in env, never in argv', () => {
  const s = prepareApiAgentSpawn('son-api', ['openai'], {
    execPath: '/x/electron', scriptPath: '/r/api-agent.cjs', getKey: () => FAKE_KEY
  });
  assert.equal(s.command, '/x/electron');
  assert.deepEqual(s.args, ['/r/api-agent.cjs', '--connector', 'openai']);
  assert.equal(s.env.SON_API_KEY, FAKE_KEY);
  assert.equal(s.env.ELECTRON_RUN_AS_NODE, '1');
  assert.equal(s.env.SON_API_BASE_URL, '');
  assert.ok(!s.args.join(' ').includes(FAKE_KEY));
  assert.ok(!s.env.SON_API_CONNECTOR.includes(FAKE_KEY));
  assert.equal(prepareApiAgentSpawn('codex', [], { execPath: '', scriptPath: '', getKey: () => FAKE_KEY }), null);
});

// ── api-agent.cjs against a local mock server ─────────────────────────────────
function startMock(handler) {
  return new Promise((resolve) => {
    const seen = [];
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        seen.push({ method: req.method, url: req.url, headers: req.headers, body });
        handler(req, res, body, seen);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, seen, base: `http://127.0.0.1:${server.address().port}` }));
  });
}

function runAgent(connectorId, base, lines, extraEnv = {}) {
  const c = conn.getApiConnector(connectorId);
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT, '--connector', connectorId], {
      env: {
        PATH: process.env.PATH,
        SON_API_CONNECTOR: JSON.stringify({ id: c.id, label: c.label, ...c.api }),
        SON_API_KEY: FAKE_KEY,
        SON_API_BASE_URL: base,
        SON_API_POLL_MS: '20',
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

function sse(res, events) {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const e of events) res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
  res.end();
}

test('api-agent streams a reply, keeps history, and never echoes the key', async () => {
  let n = 0;
  const { server, seen, base } = await startMock((req, res) => {
    n++;
    sse(res, [
      { type: 'response.created' },
      { type: 'response.output_text.delta', delta: `Hello ` },
      { type: 'response.output_text.delta', delta: `world #${n}` },
      { type: 'response.completed' }
    ]);
  });
  try {
    const { out, code } = await runAgent('openai', base, ['hi there', 'second question']);
    assert.equal(code, 0);
    assert.match(out, /Hello world #1/);
    assert.match(out, /Hello world #2/);
    assert.ok(!out.includes(FAKE_KEY), 'stdout leaked the key');
    assert.equal(seen.length, 2);
    assert.equal(seen[0].url, '/v1/responses');
    assert.equal(seen[0].headers.authorization, `Bearer ${FAKE_KEY}`);
    const b2 = JSON.parse(seen[1].body);
    assert.equal(b2.stream, true);
    assert.equal(b2.model, 'gpt-6.1-sol');
    assert.deepEqual(b2.input.map((m) => m.role), ['user', 'assistant', 'user'], 'history replayed');
    assert.equal(b2.input[1].content, 'Hello world #1');
  } finally {
    server.close();
  }
});

test('perplexity sends its preset under `preset`, not `model`', async () => {
  const { server, seen, base } = await startMock((req, res) =>
    sse(res, [{ type: 'response.output_text.delta', delta: 'cited answer' }, { type: 'response.completed' }]));
  try {
    const { out } = await runAgent('perplexity', base, ['q']);
    assert.match(out, /cited answer/);
    assert.equal(seen[0].url, '/v1/agent');
    const b = JSON.parse(seen[0].body);
    assert.equal(b.preset, 'fast');
    assert.equal(b.model, undefined);
  } finally {
    server.close();
  }
});

test('a 401 response prints a fixed auth message and never the key (even when the body echoes it)', async () => {
  const masked = `${FAKE_KEY.slice(0, 8)}********${FAKE_KEY.slice(-4)}`;
  const { server, base } = await startMock((req, res) => {
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: `Incorrect API key provided: ${masked} / ${FAKE_KEY}` } }));
  });
  try {
    const { out } = await runAgent('openai', base, ['hello']);
    assert.match(out, /401/);
    assert.match(out, /인증 실패|authentication failed/);
    assert.ok(!out.includes(FAKE_KEY), 'leaked full key');
    assert.ok(!out.includes(masked), 'leaked masked key');
    assert.ok(!out.includes('SECRET'), 'leaked a key fragment');
  } finally {
    server.close();
  }
});

test('a 500 whose body contains the key is redacted', async () => {
  const { server, base } = await startMock((req, res) => {
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: `upstream exploded near ${FAKE_KEY}` } }));
  });
  try {
    const { out } = await runAgent('openai', base, ['hello']);
    assert.match(out, /HTTP 500: upstream exploded near \[REDACTED\]/);
    assert.ok(!out.includes(FAKE_KEY));
  } finally {
    server.close();
  }
});

test('no key → a clear bilingual hint, no request is made', async () => {
  const { server, seen, base } = await startMock((req, res) => res.end());
  try {
    const { out } = await runAgent('openai', base, ['hello'], { SON_API_KEY: '' });
    assert.match(out, /API 키가 없습니다/);
    assert.match(out, /No API key stored/);
    assert.equal(seen.length, 0);
  } finally {
    server.close();
  }
});

test('higgsfield: submit → poll → prints result URL; refuses an off-origin status_url', async () => {
  let polls = 0;
  const { server, seen, base } = await startMock((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    if (req.method === 'POST') {
      return res.end(JSON.stringify({ status: 'queued', request_id: 'r1', status_url: `${base}/requests/r1/status` }));
    }
    polls++;
    res.end(JSON.stringify(polls < 2
      ? { status: 'in_progress', request_id: 'r1' }
      : { status: 'completed', request_id: 'r1', images: [{ url: 'https://cdn.example.com/img.jpg' }] }));
  });
  try {
    const { out } = await runAgent('higgsfield', base, ['a lake at sunrise']);
    assert.match(out, /https:\/\/cdn\.example\.com\/img\.jpg/);
    assert.equal(seen[0].url, '/higgsfield-ai/soul/v2/standard');
    assert.equal(seen[0].headers.authorization, `Key ${FAKE_KEY}`);
    assert.ok(seen[0].headers['idempotency-key']);
    assert.ok(!out.includes(FAKE_KEY));
  } finally {
    server.close();
  }

  const evil = await startMock((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'queued', request_id: 'r2', status_url: 'http://attacker.invalid/steal' }));
  });
  try {
    const { out } = await runAgent('higgsfield', evil.base, ['x']);
    assert.match(out, /off-origin/);
    assert.equal(evil.seen.length, 1, 'only the submit request was made');
  } finally {
    evil.server.close();
  }
});
