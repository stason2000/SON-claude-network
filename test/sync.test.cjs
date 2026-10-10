'use strict';
/**
 * Google-Drive settings sync (#10): pure logic (decision table, key/path
 * validation, whitelist, passphrase crypto, PKCE, i18n overrides), the loopback
 * OAuth listener, and the full engine + service against a LOCAL mock Drive /
 * token server with two simulated devices using DIFFERENT workspace folders.
 * No real Google endpoint is contacted.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const loadTs = require('./load-ts.cjs');

const S = loadTs('src/shared/sync/index.ts');
const box = loadTs('src/main/sync/secretBox.ts');
const auth = loadTs('src/main/sync/googleAuth.ts');
const { createSyncService } = loadTs('src/main/sync/service.ts');
const { createLocalAdapter } = loadTs('src/main/sync/localAdapter.ts');
const { createApiKeyStore } = loadTs('src/main/apiKeys.ts');

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), `son-sync-${p}-`));

// ── three-way decision table ─────────────────────────────────────────────────
test('decide: full three-way table', () => {
  const d = (local, remote, base, remoteDeleted) => S.decide({ local, remote, base, remoteDeleted });
  const B = (l, r = l) => ({ local: l, remote: r });
  const cases = [
    // [local, remote, base, remoteDeleted] → expected
    [[null, null, undefined], { action: 'noop' }],
    [['a', 'a', undefined], { action: 'in-sync' }],
    [['a', null, undefined], { action: 'upload' }],
    [[null, 'a', undefined], { action: 'download' }],
    [['a', 'b', undefined], { action: 'conflict', kind: 'both-added' }],
    [['a', null, undefined, true], { action: 'conflict', kind: 'remote-deleted' }],
    [[null, null, undefined, true], { action: 'noop' }],
    [['a', 'a', B('a')], { action: 'in-sync' }],
    [['b', 'a', B('a')], { action: 'upload' }],
    [['a', 'b', B('a')], { action: 'download' }],
    [['b', 'c', B('a')], { action: 'conflict', kind: 'both-modified' }],
    [['b', 'b', B('a')], { action: 'in-sync' }],
    [[null, 'a', B('a')], { action: 'conflict', kind: 'local-deleted' }],
    [['a', null, B('a'), true], { action: 'conflict', kind: 'remote-deleted' }],
    [['a', null, B('a')], { action: 'conflict', kind: 'remote-deleted' }],
    [[null, 'b', B('a')], { action: 'conflict', kind: 'delete-vs-modify' }],
    [['b', null, B('a'), true], { action: 'conflict', kind: 'delete-vs-modify' }],
    [[null, null, B('a'), true], { action: 'noop' }],
    // normalised apply: base local ≠ base remote, nothing changed since
    [['x', 'a', B('x', 'a')], { action: 'noop' }],
    [['y', 'a', B('x', 'a')], { action: 'upload' }],
    [['x', 'b', B('x', 'a')], { action: 'download' }]
  ];
  for (const [args, want] of cases) assert.deepEqual(d(...args), want, JSON.stringify(args));
});

// ── item keys / path validation ─────────────────────────────────────────────
test('parseItemKey: accepts only the known shapes', () => {
  assert.equal(S.parseItemKey('settings').category, 'settings');
  assert.deepEqual(S.parseItemKey('rules').segments, ['michael-rules.md']);
  assert.deepEqual(S.parseItemKey('memory/god').segments, ['hive', 'agents', 'god', 'memory.md']);
  assert.deepEqual(S.parseItemKey('skills/ws/foo/SKILL.md').segments, ['.claude', 'skills', 'foo', 'SKILL.md']);
  assert.equal(S.parseItemKey('skills/home/a/b/c.yaml').root, 'home');
  const bad = [
    '', '/etc/passwd', '../x', 'memory/..', 'memory/../../x', 'memory/a/b', 'skills/ws/../x/a.md',
    'skills/ws/foo/../../a.md', 'skills/ws/.git/config.md', 'skills/ws/foo/.hidden.md', 'skills/ws/SKILL.md',
    'skills/ws/foo/run.sh', 'skills/ws/foo/x.py', 'skills/abs/foo/a.md', 'skills/ws/C:/a.md', 'skills/ws/foo\\a.md',
    'skills/ws/foo//a.md', 'skills/ws/con/a.md', 'skills/ws/foo/nul.md', 'skills/ws/foo /a.md', 'skills/ws/foo./a.md',
    'skills/ws/한글/a.md', 'skills/ws/a/b/c/d/e/f/g.md', 'Settings', 'secret', 'memory/', 'x'.repeat(500),
    'skills/ws/foo/a.md\u0000', 123, null
  ];
  for (const k of bad) assert.equal(S.parseItemKey(k), null, String(k));
});

test('device label + backup names are sanitized', () => {
  assert.equal(S.sanitizeDeviceLabel('  노트북\n'), '노트북');
  assert.equal(S.sanitizeDeviceLabel(''), null);
  assert.equal(S.deviceSlug('../../evil'), 'evil');
  assert.equal(S.deviceSlug('노트북'), 'device');
  assert.ok(!S.backupBaseName('skills/ws/a/b.md').includes('/'));
});

// ── whitelist ────────────────────────────────────────────────────────────────
test('whitelist: only portable, valid settings pass; secrets/machine paths never', () => {
  const cfg = {
    autoMode: false, defaultModel: 'claude-fable-5', godProvider: 'claude', terminalTheme: 'dark',
    harnessHome: '/home/a/ws', registeredRepos: ['/a'], recentHives: ['/b'], defaultCommand: 'rm -rf /',
    slackBotToken: 'xoxb-1', slackSigningSecret: 's', groqApiKey: 'gsk', webhookSecret: 'w',
    webhookTriggers: [{ id: 'x', secret: 's' }], orgTrigger: { apiKey: 'k' }, integrations: [{ id: 'i' }],
    mcpDefaults: { fs: { enabled: true } }, providerBaseUrls: { opencode: 'http://localhost' },
    knowledgeGraph: { enabled: true, rootPath: '/x' }, onboardingComplete: true, telemetryEnabled: true,
    maxConcurrentWorkers: 9999, officeTheme: 'evil', providerDefaultModels: { claude: 'm1', bogus: 'm2', codex: 'bad model' }
  };
  const out = S.extractPortableSettings(cfg);
  assert.deepEqual(out, {
    autoMode: false, defaultModel: 'claude-fable-5', godProvider: 'claude', terminalTheme: 'dark',
    knowledgeGraph: { enabled: true }, providerDefaultModels: { claude: 'm1' }
  });
  for (const k of Object.keys(out)) assert.ok(k in S.PORTABLE_SETTINGS);
  assert.equal(S.sanitizePortableSettings([1]), null);
  assert.deepEqual(S.sanitizePortableSettings({ __proto__: { autoMode: true }, autoMode: 'yes' }), {});
});

test('whitelist: triggers keep lastFiredAt / clear.message local and validate missions', () => {
  const remote = S.sanitizeTriggers({
    missions: [
      { id: 'ops-standup', label: 'L', intervalMs: 3600000, to: 'god', body: 'b', enabled: true, lastFiredAt: 5 },
      { id: '../x', label: 'L', intervalMs: 3600000, to: 'god', body: 'b', enabled: true },
      { id: 'tiny', label: 'L', intervalMs: 5, to: 'god', body: 'b', enabled: true }
    ],
    contextTrigger: { compact: { enabled: true, everyMs: 7200000, minContextPct: 60, minContextPctLargeWindow: 40, message: 'm' },
      clear: { enabled: true, everyMs: 7200000, minContextPct: 90, minContextPctLargeWindow: 80, message: 'rm -rf ~' } }
  });
  assert.equal(remote.missions.length, 1);
  assert.equal(remote.missions[0].lastFiredAt, undefined);
  assert.equal(remote.contextTrigger.clear.message, undefined);
  const patch = S.triggersPatch({ missions: [{ id: 'ops-standup', lastFiredAt: 42 }], contextTrigger: { clear: { message: '/clear' } } }, remote);
  assert.equal(patch.missions[0].lastFiredAt, 42);
  assert.equal(patch.contextTrigger.clear.message, '/clear');
});

test('manifest schema: malformed and unsafe entries are dropped', () => {
  const dev = { label: 'PC', host: 'h' };
  const h = 'a'.repeat(64);
  const r = S.parseManifest({
    version: 1, updatedAt: 1, items: {
      rules: { fileId: 'abc', hash: h, size: 3, modifiedTime: 1, device: dev },
      '../../etc/passwd': { fileId: 'abc', hash: h, size: 3, modifiedTime: 1, device: dev },
      'memory/god': { fileId: '../x', hash: h, size: 3, modifiedTime: 1, device: dev },
      settings: { fileId: 'abc', hash: 'nothex', size: 3, modifiedTime: 1, device: dev },
      i18n: { deleted: true, modifiedTime: 2, device: dev }
    }
  });
  assert.deepEqual(Object.keys(r.manifest.items).sort(), ['i18n', 'rules']);
  assert.equal(r.dropped, 3);
  assert.equal(S.parseManifest({ version: 2, items: {} }), null);
});

// ── passphrase crypto ────────────────────────────────────────────────────────
test('API-key box: round trip, wrong passphrase fails cleanly, tamper detected', () => {
  const plain = Buffer.from(JSON.stringify({ keys: { 'connector:openai': 'sk-SECRET-123456789' } }));
  const env = box.encryptWithPassphrase(plain, 'correct horse battery', 1 << 14);
  assert.ok(!env.toString().includes('sk-SECRET'));
  assert.deepEqual(box.decryptWithPassphrase(env, 'correct horse battery'), plain);
  assert.throws(() => box.decryptWithPassphrase(env, 'wrong passphrase!'), (e) => e.code === 'wrongPassphrase');
  const j = JSON.parse(env.toString());
  j.ct = Buffer.from(Buffer.from(j.ct, 'base64').map((b, i) => (i === 0 ? b ^ 1 : b))).toString('base64');
  assert.throws(() => box.decryptWithPassphrase(Buffer.from(JSON.stringify(j)), 'correct horse battery'), (e) => e.code === 'wrongPassphrase');
  j.N = 1 << 30; // DoS-sized KDF refused before running
  assert.throws(() => box.decryptWithPassphrase(Buffer.from(JSON.stringify(j)), 'correct horse battery'), (e) => e.code === 'badRemote');
  assert.throws(() => box.encryptWithPassphrase(plain, 'short'), (e) => e.code === 'passphraseTooShort');
  const k1 = box.hmacKeyFor('correct horse battery');
  assert.equal(box.changeHash(k1, plain), box.changeHash(box.hmacKeyFor('correct horse battery'), plain));
  assert.notEqual(box.changeHash(k1, plain), box.changeHash(box.hmacKeyFor('other passphrase'), plain));
});

// ── OAuth: PKCE + loopback ───────────────────────────────────────────────────
test('PKCE S256 matches the RFC 7636 Appendix B test vector', () => {
  assert.equal(auth.challengeS256('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  const v = auth.generateVerifier();
  assert.match(v, /^[A-Za-z0-9\-._~]{43,128}$/);
  const u = new URL(auth.buildAuthUrl({ clientId: 'c.apps.googleusercontent.com', redirectUri: 'http://127.0.0.1:5/oauth2callback', challenge: 'ch', state: 'st' }));
  assert.equal(u.origin + u.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(u.searchParams.get('scope'), 'https://www.googleapis.com/auth/drive.appdata');
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(u.searchParams.get('response_type'), 'code');
  assert.equal(u.searchParams.get('state'), 'st');
});

const get = (url) => new Promise((resolve, reject) => {
  http.get(url, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); }).on('error', reject);
});

test('loopback: wrong path 404, wrong state 400 and ignored, right state resolves and closes', async () => {
  const lb = await auth.startLoopback({ expectedState: 'good-state', timeoutMs: 5000 });
  assert.match(lb.redirectUri, /^http:\/\/127\.0\.0\.1:\d+\/oauth2callback$/);
  const base = lb.redirectUri.replace('/oauth2callback', '');
  assert.equal(await get(`${base}/other?code=x&state=good-state`), 404);
  assert.equal(await get(`${lb.redirectUri}?code=evil&state=bad-state`), 400);
  assert.equal(await get(`${lb.redirectUri}?code=evil`), 400);
  assert.equal(await get(`${lb.redirectUri}?code=real-code&state=good-state`), 200);
  assert.equal(await lb.code, 'real-code');
  await assert.rejects(get(`${lb.redirectUri}?code=again&state=good-state`)); // server closed
});

test('loopback: user denial and timeout reject with codes', async () => {
  const lb = await auth.startLoopback({ expectedState: 's', timeoutMs: 5000 });
  await get(`${lb.redirectUri}?error=access_denied&state=s`);
  await assert.rejects(lb.code, (e) => e.code === 'loginDenied');
  const lb2 = await auth.startLoopback({ expectedState: 's', timeoutMs: 50 });
  await assert.rejects(lb2.code, (e) => e.code === 'loginTimeout');
});

// ── i18n overrides + locale parity ───────────────────────────────────────────
test('i18n overrides: flat + nested merged, unsafe dropped', () => {
  const { tree, count } = S.sanitizeI18nOverrides({
    'settings.title': '설정!', extra: { sync: { nav: '동기화!' } }, bad: 5, '__proto__.x': 'p',
    'a b': 'space', deep: { 'constructor': 'x' }, long: 'x'.repeat(3000)
  });
  assert.equal(tree.settings.title, '설정!');
  assert.equal(tree.extra.sync.nav, '동기화!');
  assert.equal(count, 2);
  assert.equal({}.x, undefined);
});

test('extra.sync.* key trees are identical in ko/en and cover every error code', () => {
  const ko = require('../src/renderer/src/i18n/locales/extra.ko.json').sync;
  const en = require('../src/renderer/src/i18n/locales/extra.en.json').sync;
  const keys = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' ? keys(v, `${p}${k}.`) : [`${p}${k}`])).sort();
  assert.deepEqual(keys(ko), keys(en));
  for (const c of S.SYNC_ERROR_CODES) assert.ok(ko.err[c] && en.err[c], c);
  for (const c of [...S.SYNC_CATEGORIES, 'apikeys']) assert.ok(ko.cats[c], c);
  for (const k of ['both-modified', 'both-added', 'local-deleted', 'remote-deleted', 'delete-vs-modify']) assert.ok(ko.conflicts.kind[k], k);
});

// ── mock Google (token + Drive v3 appDataFolder) ────────────────────────────
function startMockGoogle() {
  const files = new Map(); // id → { name, content, modifiedTime }
  const valid = new Set();
  const stats = { list: 0, listPages: 0, unauthorized: 0, refresh: 0, codeExchanges: 0 };
  let n = 0;
  let challenge = null;
  const issue = () => { const t = `at-${++n}-ACCESSSECRET`; valid.add(t); return t; };
  const body = (req) => new Promise((r) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => r(Buffer.concat(c))); });
  const send = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
  const meta = (id) => ({ id, name: files.get(id).name, modifiedTime: files.get(id).modifiedTime, size: String(files.get(id).content.length) });
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    const buf = await body(req);
    if (u.pathname === '/token') {
      const f = new URLSearchParams(buf.toString());
      if (f.get('grant_type') === 'refresh_token') {
        stats.refresh++;
        if (!String(f.get('refresh_token')).startsWith('rt-')) return send(res, 400, { error: 'invalid_grant' });
        return send(res, 200, { access_token: issue(), expires_in: 3600, scope: auth.DRIVE_APPDATA_SCOPE });
      }
      stats.codeExchanges++;
      if (f.get('code') !== 'the-code' || auth.challengeS256(f.get('code_verifier') || '') !== challenge) return send(res, 400, { error: 'invalid_grant' });
      return send(res, 200, { access_token: issue(), expires_in: 3600, refresh_token: 'rt-LOGIN-REFRESHSECRET', scope: auth.DRIVE_APPDATA_SCOPE });
    }
    if (u.pathname === '/revoke') return send(res, 200, {});
    if (!valid.has((req.headers.authorization || '').replace(/^Bearer /, ''))) { stats.unauthorized++; return send(res, 401, { error: { code: 401 } }); }
    const now = new Date(Date.now() + n).toISOString();
    if (req.method === 'GET' && u.pathname === '/drive/v3/files') {
      if (u.searchParams.get('spaces') !== 'appDataFolder') return send(res, 400, {});
      stats.listPages++;
      if (!u.searchParams.get('pageToken')) stats.list++;
      const all = [...files.keys()];
      const off = Number(u.searchParams.get('pageToken') || 0);
      const page = all.slice(off, off + 2);
      return send(res, 200, { files: page.map(meta), ...(off + 2 < all.length ? { nextPageToken: String(off + 2) } : {}) });
    }
    const m = u.pathname.match(/^\/(upload\/)?drive\/v3\/files(?:\/([^/]+))?$/);
    if (!m) return send(res, 404, {});
    const id = m[2] ? decodeURIComponent(m[2]) : null;
    if (req.method === 'GET' && id && u.searchParams.get('alt') === 'media') {
      if (!files.has(id)) return send(res, 404, {});
      res.writeHead(200); return res.end(files.get(id).content);
    }
    if (req.method === 'POST' && m[1] && u.searchParams.get('uploadType') === 'multipart') {
      const b = /boundary=(.+)$/.exec(req.headers['content-type'])[1];
      const delim = Buffer.from(`--${b}\r\n`);
      const p1 = buf.indexOf(delim) + delim.length;
      const p1end = buf.indexOf(Buffer.from(`\r\n--${b}\r\n`), p1);
      const metaPart = buf.slice(p1, p1end).toString();
      const md = JSON.parse(metaPart.slice(metaPart.indexOf('\r\n\r\n') + 4));
      if (JSON.stringify(md.parents) !== '["appDataFolder"]') return send(res, 400, {});
      const p2 = buf.indexOf(Buffer.from('\r\n\r\n'), p1end + 4) + 4;
      const p2end = buf.lastIndexOf(Buffer.from(`\r\n--${b}--`));
      const nid = `f${files.size + 1}x${crypto.randomBytes(3).toString('hex')}`;
      files.set(nid, { name: md.name, content: buf.slice(p2, p2end), modifiedTime: now });
      return send(res, 200, meta(nid));
    }
    if (req.method === 'PATCH' && m[1] && id) {
      if (!files.has(id)) return send(res, 404, {});
      files.get(id).content = buf; files.get(id).modifiedTime = now;
      return send(res, 200, meta(id));
    }
    if (req.method === 'DELETE' && id) { files.delete(id); res.writeHead(204); return res.end(); }
    return send(res, 404, {});
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    const base = `http://127.0.0.1:${server.address().port}`;
    resolve({
      base, files, stats, server,
      setChallenge: (c) => { challenge = c; },
      expireAll: () => valid.clear(),
      manifest: () => {
        const f = [...files.values()].find((x) => x.name === 'manifest.json');
        return f ? JSON.parse(f.content.toString()) : null;
      },
      contentOf: (key) => {
        const mf = [...files.values()].find((x) => x.name === 'manifest.json');
        const e = JSON.parse(mf.content.toString()).items[key];
        return e && e.fileId && files.get(e.fileId) ? files.get(e.fileId).content : null;
      },
      allBytes: () => Buffer.concat([...files.values()].map((x) => x.content)).toString('utf8')
    });
  }));
}

const fakeCrypto = { isAvailable: () => true, encrypt: (s) => Buffer.from(`E:${Buffer.from(s).toString('base64')}`), decrypt: (b) => Buffer.from(b.toString().slice(2), 'base64').toString() };

function makeDevice(name, google, opts = {}) {
  const ws = tmp(`${name}-ws`);
  const home = tmp(`${name}-home`);
  const userData = tmp(`${name}-ud`);
  let config = { harnessHome: ws, registeredRepos: [`/${name}/repo`], autoMode: true, defaultModel: 'claude-fable-5', slackBotToken: `xoxb-${name}-SLACKSECRET`, missions: [], ...(opts.config || {}) };
  const apiKeys = { ...(opts.apiKeys || {}) };
  const secrets = createApiKeyStore({ filePath: () => path.join(userData, 'google-sync-secrets.json'), crypto: fakeCrypto });
  const replies = [];
  const local = createLocalAdapter({
    getWorkspace: () => ws,
    userHome: () => home,
    readConfig: () => config,
    writeConfig: (patch) => { config = { ...config, ...patch }; },
    apiKeys: { exportAll: () => ({ ...apiKeys }), importAll: (k) => Object.assign(apiKeys, k) },
    fallbackBackupDir: path.join(userData, 'sync-conflicts'),
    onApplied: () => {}
  });
  const service = createSyncService({
    secrets, fetch: (u, i) => fetch(u, i), openExternal: opts.openExternal || (() => {}), local,
    statePath: path.join(userData, 'sync-state.json'), hostName: `${name}-host`,
    urls: { auth: `${google.base}/auth`, token: `${google.base}/token`, revoke: `${google.base}/revoke`, api: google.base },
    sleep: async () => {}, loginTimeoutMs: 5000
  });
  const wrap = async (p) => { const r = await p; replies.push(r); return r; };
  return {
    ws, home, userData, secrets, service, apiKeys, replies,
    get config() { return config; },
    sync: (pass) => wrap(service.syncNow(pass ? { passphrase: pass } : {})),
    resolve: (key, choice, pass) => wrap(service.resolve({ key, choice, passphrase: pass })),
    opt: (o) => wrap(service.setOptions(o)),
    login: () => { secrets.setKey('google-client-id', '123456-abcdef.apps.googleusercontent.com'); secrets.setKey('google-client-secret', 'GOCSPX-CLIENTSECRET'); secrets.setKey('google-refresh-token', `rt-${name}-REFRESHSECRET`); }
  };
}

const write = (root, rel, text) => { const p = path.join(root, ...rel.split('/')); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); return p; };
const read = (root, rel) => fs.readFileSync(path.join(root, ...rel.split('/')), 'utf8');
const exists = (root, rel) => fs.existsSync(path.join(root, ...rel.split('/')));

test('sync engine: two devices, different workspaces — upload, download, conflict, 401 refresh, pagination, deletes, opt-in keys, no secret leaks', async (t) => {
  const google = await startMockGoogle();
  t.after(() => google.server.close());
  const logs = [];
  const orig = {};
  for (const k of ['log', 'warn', 'error', 'info', 'debug']) {
    orig[k] = console[k];
    console[k] = (...a) => { logs.push(a.map(String).join(' ')); };
  }
  t.after(() => { for (const k of Object.keys(orig)) console[k] = orig[k]; });

  // Unrelated files in appDataFolder force multi-page listing (mock pages by 2).
  for (let i = 0; i < 5; i++) google.files.set(`junk${i}`, { name: `junk-${i}.txt`, content: Buffer.from('x'), modifiedTime: new Date().toISOString() });

  const A = makeDevice('pc', google, {
    config: { autoMode: false, terminalTheme: 'dark', departments: { coding: ['codex', 'claude'] },
      missions: [{ id: 'ops-standup', label: 'Standup', intervalMs: 3600000, to: 'god', body: 'review', enabled: true, lastFiredAt: 111 }] },
    apiKeys: { 'connector:openai': 'sk-OPENAI-APIKEYSECRET-1' }
  });
  const B = makeDevice('laptop', google, { config: { missions: [{ id: 'ops-standup', label: 'Standup', intervalMs: 3600000, to: 'god', body: 'review', enabled: true, lastFiredAt: 999 }] } });
  A.login(); B.login();
  await A.opt({ deviceLabel: 'PC' });
  await B.opt({ deviceLabel: '노트북' });

  write(A.ws, 'michael-rules.md', '# 규칙 v1\n');
  write(A.ws, 'hive/agents/god/memory.md', '# Memory god\n- fact one\n');
  write(A.ws, '.claude/skills/writer/SKILL.md', '---\nname: writer\n---\n');
  write(A.ws, '.claude/skills/writer/run.sh', 'echo pwned');
  write(A.home, '.claude/skills/global/SKILL.md', '---\nname: global\n---\n');
  write(A.ws, 'i18n-overrides.ko.json', JSON.stringify({ 'settings.title': '내 설정' }));
  fs.mkdirSync(path.join(B.ws, 'hive', 'agents', 'god'), { recursive: true });

  // 1) First upload from the PC.
  let r = await A.sync();
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(r.status.lastResult.uploaded >= 7, JSON.stringify(r.status.lastResult));
  assert.ok(google.stats.listPages > google.stats.list, 'listing was paginated');
  const mf = google.manifest();
  assert.ok(mf.items.rules && mf.items['memory/god'] && mf.items['skills/ws/writer/SKILL.md'] && mf.items['skills/home/global/SKILL.md']);
  assert.ok(!Object.keys(mf.items).some((k) => k.endsWith('.sh')), 'scripts never synced');
  assert.equal(mf.items.apikeys, undefined, 'API keys are not synced by default');
  const remoteSettings = JSON.parse(google.contentOf('settings').toString());
  assert.equal(remoteSettings.autoMode, false);
  assert.equal(remoteSettings.harnessHome, undefined);
  const all = google.allBytes();
  for (const leak of [A.ws, 'xoxb-', 'SLACKSECRET', '/pc/repo', 'APIKEYSECRET', 'lastFiredAt']) assert.ok(!all.includes(leak), `remote contains ${leak}`);

  // 2) Laptop: first sync → downloads into ITS OWN workspace; differing settings = conflict, nothing overwritten.
  r = await B.sync();
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(read(B.ws, 'michael-rules.md'), '# 규칙 v1\n');
  assert.equal(read(B.ws, 'hive/agents/god/memory.md'), '# Memory god\n- fact one\n');
  assert.ok(exists(B.ws, '.claude/skills/writer/SKILL.md'));
  assert.ok(exists(B.home, '.claude/skills/global/SKILL.md'));
  assert.ok(!exists(B.ws, '.claude/skills/writer/run.sh'));
  assert.equal(B.config.autoMode, true, 'conflicting settings not overwritten');
  const conflictKeys = r.status.conflicts.map((c) => c.key).sort();
  assert.ok(conflictKeys.includes('settings'), conflictKeys.join());
  const sc = r.status.conflicts.find((c) => c.key === 'settings');
  assert.equal(sc.kind, 'both-added');
  assert.equal(sc.local.deviceLabel, '노트북');
  assert.equal(sc.remote.deviceLabel, 'PC');
  assert.ok(sc.summary.changedKeys.includes('autoMode'));

  // Resolve with the PC version: laptop gets PC settings, keeps its own paths/secrets and lastFiredAt; old version backed up.
  for (const c of r.status.conflicts) {
    const rr = await B.resolve(c.key, 'remote');
    assert.equal(rr.ok, true, `${c.key} ${JSON.stringify(rr)}`);
  }
  assert.equal(B.config.autoMode, false);
  assert.equal(B.config.terminalTheme, 'dark');
  assert.equal(B.config.harnessHome, B.ws);
  assert.deepEqual(B.config.registeredRepos, ['/laptop/repo']);
  assert.equal(B.config.slackBotToken, 'xoxb-laptop-SLACKSECRET');
  assert.deepEqual(B.config.departments, { coding: ['codex', 'claude'] });
  assert.equal(B.config.missions[0].lastFiredAt, 999);
  const backups = fs.readdirSync(path.join(B.ws, 'sync-conflicts'));
  assert.ok(backups.some((f) => /^settings-device-\d{8}T\d{6}Z\.json$/.test(f)), backups.join());

  r = await B.sync();
  assert.equal(r.ok, true);
  assert.equal(r.status.conflicts.length, 0, JSON.stringify(r.status.conflicts));
  assert.equal(r.status.lastResult.uploaded + r.status.lastResult.downloaded, 0, JSON.stringify(r.status.lastResult));

  // 3) Only local changed → upload; other side downloads.
  write(A.ws, 'michael-rules.md', '# 규칙 v2\n');
  r = await A.sync(); assert.equal(r.status.lastResult.uploaded, 1);
  r = await B.sync(); assert.equal(r.status.lastResult.downloaded, 1);
  assert.equal(read(B.ws, 'michael-rules.md'), '# 규칙 v2\n');

  // 4) Both changed → conflict, neither side overwritten; pick the laptop's; PC's kept as backup.
  write(A.ws, 'michael-rules.md', '# 규칙 PC 수정\n');
  write(B.ws, 'michael-rules.md', '# 규칙 노트북 수정\n');
  await A.sync();
  r = await B.sync();
  const rc = r.status.conflicts.find((c) => c.key === 'rules');
  assert.equal(rc.kind, 'both-modified');
  assert.match(rc.remote.preview, /PC 수정/);
  assert.equal(read(B.ws, 'michael-rules.md'), '# 규칙 노트북 수정\n');
  assert.equal(google.contentOf('rules').toString(), '# 규칙 PC 수정\n');
  r = await B.resolve('rules', 'local');
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(google.contentOf('rules').toString(), '# 규칙 노트북 수정\n');
  const rb = fs.readdirSync(path.join(B.ws, 'sync-conflicts')).find((f) => f.startsWith('rules-PC-'));
  assert.equal(fs.readFileSync(path.join(B.ws, 'sync-conflicts', rb), 'utf8'), '# 규칙 PC 수정\n');
  r = await A.sync();
  assert.equal(read(A.ws, 'michael-rules.md'), '# 규칙 노트북 수정\n');

  // 5) 401 → refresh once and retry.
  google.expireAll();
  const before = google.stats.refresh;
  write(A.ws, 'hive/agents/god/memory.md', '# Memory god\n- fact one\n- fact two\n');
  r = await A.sync();
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(google.stats.unauthorized >= 1);
  assert.ok(google.stats.refresh > before);
  r = await B.sync();
  assert.match(read(B.ws, 'hive/agents/god/memory.md'), /fact two/);

  // 6) Local delete is never propagated automatically.
  fs.rmSync(path.join(A.ws, '.claude', 'skills', 'writer', 'SKILL.md'));
  r = await A.sync();
  const dc = r.status.conflicts.find((c) => c.key === 'skills/ws/writer/SKILL.md');
  assert.equal(dc.kind, 'local-deleted');
  assert.ok(google.contentOf('skills/ws/writer/SKILL.md'));
  r = await A.resolve('skills/ws/writer/SKILL.md', 'local'); // user explicitly chooses the deletion
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(google.manifest().items['skills/ws/writer/SKILL.md'].deleted, true);
  r = await B.sync(); // laptop still has it → asks, does not delete
  assert.equal(r.status.conflicts.find((c) => c.key === 'skills/ws/writer/SKILL.md').kind, 'remote-deleted');
  assert.ok(exists(B.ws, '.claude/skills/writer/SKILL.md'));

  // 7) Hostile manifest entries are ignored; nothing is written outside the roots.
  const mfFile = [...google.files.values()].find((x) => x.name === 'manifest.json');
  const evil = JSON.parse(mfFile.content.toString());
  const someId = evil.items.rules.fileId;
  const dev = { label: 'X', host: 'x' };
  const h = crypto.createHash('sha256').update(google.files.get(someId).content).digest('hex');
  for (const k of ['../../escape.md', 'skills/ws/../../escape.md', 'memory/../../escape', 'skills/ws/a/b.sh']) {
    evil.items[k] = { fileId: someId, hash: h, size: 10, modifiedTime: 1, device: dev };
  }
  evil.items['memory/ghost'] = { fileId: someId, hash: h, size: 10, modifiedTime: 1, device: dev }; // no such agent here
  mfFile.content = Buffer.from(JSON.stringify(evil));
  r = await B.sync();
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(!fs.existsSync(path.join(path.dirname(B.ws), 'escape.md')));
  assert.ok(!exists(B.ws, 'hive/agents/ghost'), 'no ghost agent folder created');

  // 8) Tampered content (hash mismatch) is not applied.
  // Content swapped AND manifest says it changed, but the hash does not match the bytes.
  const mf2 = [...google.files.values()].find((x) => x.name === 'manifest.json');
  const m2 = JSON.parse(mf2.content.toString());
  google.files.get(m2.items['memory/god'].fileId).content = Buffer.from('tampered');
  m2.items['memory/god'].hash = 'b'.repeat(64);
  mf2.content = Buffer.from(JSON.stringify(m2));
  write(A.ws, 'michael-rules.md', '# 규칙 v3\n'); // something legit alongside
  await A.sync();
  r = await B.sync();
  assert.equal(r.status.lastError.code, 'badRemote');
  assert.match(read(B.ws, 'hive/agents/god/memory.md'), /fact two/);
  assert.equal(read(B.ws, 'michael-rules.md'), '# 규칙 v3\n');

  // 9) Opt-in encrypted API keys.
  await A.opt({ apiKeySync: true });
  r = await A.sync('correct horse battery');
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(google.manifest().items.apikeys);
  assert.ok(!google.allBytes().includes('APIKEYSECRET'));
  await B.opt({ apiKeySync: true });
  r = await B.sync('wrong passphrase!!');
  assert.equal(r.status.lastError.code, 'wrongPassphrase');
  assert.deepEqual(B.apiKeys, {});
  const encBefore = google.contentOf('apikeys').toString();
  r = await B.sync('correct horse battery');
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(B.apiKeys['connector:openai'], 'sk-OPENAI-APIKEYSECRET-1');
  assert.equal(google.contentOf('apikeys').toString(), encBefore, 'wrong passphrase never re-uploaded');
  r = await B.sync(); // no passphrase → key item skipped silently
  assert.equal(r.ok, true);

  // 10) Nothing secret in any reply or log line.
  const replies = JSON.stringify([...A.replies, ...B.replies, A.service.status(), B.service.status()]);
  for (const s of ['REFRESHSECRET', 'ACCESSSECRET', 'CLIENTSECRET', 'APIKEYSECRET', 'SLACKSECRET', 'correct horse']) {
    assert.ok(!replies.includes(s), `reply leaks ${s}`);
    assert.ok(!logs.join('\n').includes(s), `log leaks ${s}`);
  }
  // State file holds no secret either.
  for (const d of [A, B]) {
    const stText = fs.readFileSync(path.join(d.userData, 'sync-state.json'), 'utf8');
    for (const s of ['REFRESHSECRET', 'ACCESSSECRET', 'APIKEYSECRET', 'correct horse']) assert.ok(!stText.includes(s), s);
    assert.equal(fs.statSync(path.join(d.userData, 'sync-state.json')).mode & 0o077, 0);
  }
});

test('service login: PKCE + state against the mock token endpoint; secrets stay inside', async (t) => {
  const google = await startMockGoogle();
  t.after(() => google.server.close());
  let opened = null;
  const D = makeDevice('login', google, {
    openExternal: async (url) => {
      opened = new URL(url);
      google.setChallenge(opened.searchParams.get('code_challenge'));
      const redirect = opened.searchParams.get('redirect_uri');
      assert.equal(await get(`${redirect}?code=the-code&state=forged`), 400); // forged first: ignored
      await get(`${redirect}?code=the-code&state=${encodeURIComponent(opened.searchParams.get('state'))}`);
    }
  });
  let r = await D.service.login();
  assert.equal(r.ok, false);
  assert.equal(r.code, 'noCredentials');
  r = await D.service.setCredentials({ clientId: 'not-a-client-id' });
  assert.equal(r.code, 'invalidInput');
  r = await D.service.setCredentials({ clientId: '123456-abcdef.apps.googleusercontent.com', clientSecret: 'GOCSPX-CLIENTSECRET' });
  assert.equal(r.ok, true);
  assert.equal(r.status.hasClientId && r.status.hasClientSecret, true);
  r = await D.service.login();
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.status.loggedIn, true);
  assert.equal(opened.searchParams.get('scope'), auth.DRIVE_APPDATA_SCOPE);
  assert.equal(opened.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(google.stats.codeExchanges, 1);
  const stored = fs.readFileSync(path.join(D.userData, 'google-sync-secrets.json'), 'utf8');
  assert.ok(!stored.includes('REFRESHSECRET') && !stored.includes('CLIENTSECRET'), 'stored only as ciphertext');
  assert.equal(fs.statSync(path.join(D.userData, 'google-sync-secrets.json')).mode & 0o077, 0);
  r = await D.sync();
  assert.equal(r.ok, true, JSON.stringify(r));
  r = await D.service.logout();
  assert.equal(r.status.loggedIn, false);
  const txt = JSON.stringify(r);
  for (const s of ['REFRESHSECRET', 'ACCESSSECRET', 'CLIENTSECRET', 'the-code']) assert.ok(!txt.includes(s), s);
});

test('readKoOverrides: reads <workspace>/i18n-overrides.ko.json safely; symlink/oversize refused', () => {
  const { readKoOverrides } = loadTs('src/main/sync/index.ts');
  const ws = tmp('i18n');
  assert.deepEqual(readKoOverrides(ws), {});
  assert.deepEqual(readKoOverrides(null), {});
  fs.writeFileSync(path.join(ws, 'i18n-overrides.ko.json'), JSON.stringify({ 'extra.sync.nav': '싱크', bad: 1 }));
  assert.deepEqual(readKoOverrides(ws), { extra: { sync: { nav: '싱크' } } });
  fs.writeFileSync(path.join(ws, 'i18n-overrides.ko.json'), '{not json');
  assert.deepEqual(readKoOverrides(ws), {});
  const other = tmp('i18n-other');
  fs.writeFileSync(path.join(other, 'x.json'), JSON.stringify({ a: 'b' }));
  fs.rmSync(path.join(ws, 'i18n-overrides.ko.json'));
  fs.symlinkSync(path.join(other, 'x.json'), path.join(ws, 'i18n-overrides.ko.json'));
  assert.deepEqual(readKoOverrides(ws), {});
});
