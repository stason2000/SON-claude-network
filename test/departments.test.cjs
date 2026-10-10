'use strict';
/**
 * Departments (src/shared/departments.ts), Michael's rules seed
 * (src/shared/michaelSeed.ts) and the workspace rules file (src/main/michaelRules.ts).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const d = loadTs('src/shared/departments.ts');
const conn = loadTs('src/shared/connectors/index.ts');
const seed = loadTs('src/shared/michaelSeed.ts');
const rules = loadTs('src/main/michaelRules.ts');

const ROOT = path.join(__dirname, '..');
const DEFAULT_RULES = path.join(ROOT, 'resources', 'michael-rules.default.ko.md');
const dept = (id) => d.departmentSpec(id);

test('every default preferred id exists in the connector registry', () => {
  assert.deepEqual(d.DEPARTMENTS.map((x) => x.id), ['coding', 'research', 'media', 'review']);
  for (const x of d.DEPARTMENTS) {
    assert.ok(x.defaultPreferred.length >= 2, x.id);
    for (const id of x.defaultPreferred) assert.ok(conn.getConnector(id), `${x.id}: unknown ${id}`);
  }
  assert.deepEqual(dept('coding').defaultPreferred.slice(0, 2), ['claude', 'codex']);
  assert.deepEqual(dept('review').defaultPreferred.slice(0, 2), ['claude', 'codex']);
});

test('primary connected → ok with primary', () => {
  const r = d.resolveDepartment(dept('coding'), { claude: { installed: true }, codex: { installed: true } });
  assert.deepEqual(r, { connectorId: 'claude', status: 'ok', reason: '1순위 연결됨' });
});

test('primary missing → falls back and says why', () => {
  const r = d.resolveDepartment(dept('coding'), { claude: { installed: false }, codex: { installed: true } });
  assert.equal(r.connectorId, 'codex');
  assert.equal(r.status, 'ok');
  assert.match(r.reason, /Claude Code: 설치 안 됨/);
});

test('nothing connected → connect-needed, never a fake connector', () => {
  const r = d.resolveDepartment(dept('coding'), {});
  assert.equal(r.connectorId, null);
  assert.equal(r.status, 'connect-needed');
});

test('API connector needs a stored key; unavailable connector is never picked', () => {
  const media = dept('media');
  let r = d.resolveDepartment(media, { higgsfield: { apiKeyPresent: false } });
  assert.equal(r.status, 'connect-needed');
  assert.match(r.reason, /Higgsfield: API 키 없음/);
  assert.match(r.reason, /CapCut: 연결 불가/);
  // A CapCut-only config with everything "available" still cannot resolve.
  r = d.resolveDepartment(media, { capcut: { installed: true, apiKeyPresent: true } }, { media: ['capcut'] });
  assert.equal(r.status, 'connect-needed');
  r = d.resolveDepartment(media, { higgsfield: { apiKeyPresent: true } });
  assert.deepEqual([r.status, r.connectorId], ['ok', 'higgsfield']);
});

test('research: perplexity key works as a later fallback', () => {
  const r = d.resolveDepartment(dept('research'), { perplexity: { apiKeyPresent: true } });
  assert.equal(r.connectorId, 'perplexity');
  assert.equal(r.status, 'ok');
});

test('config override is honoured; installed-but-not-preferred CLI is not used', () => {
  const avail = { codex: { installed: true }, claude: { installed: true } };
  const r = d.resolveDepartment(dept('coding'), avail, { coding: ['codex'] });
  assert.equal(r.connectorId, 'codex');
});

test('sanitize drops unknown ids, misfits, duplicates and unknown departments', () => {
  const out = d.sanitizeDepartmentsConfig({
    coding: ['claude', 'claude', 'nope', 'higgsfield', 'codex'],
    media: ['claude', 'higgsfield'],
    bogus: ['claude']
  });
  assert.deepEqual(out, { coding: ['claude', 'codex'], media: ['higgsfield'] });
  assert.equal(d.sanitizeDepartmentsConfig('x'), undefined);
  assert.equal(d.sanitizeDepartmentsConfig(null), undefined);
  // Codex is listed for research by the user's rules even without a 'research' strength.
  assert.deepEqual(d.sanitizePreferred(dept('research'), ['codex']), ['codex']);
});

test('department table text marks connect-needed and tells Michael to report it', () => {
  const rows = d.resolveAllDepartments({ claude: { installed: true } });
  const text = d.formatDepartmentTable(rows);
  assert.match(text, /- 코딩: Claude Code \(연결됨\)/);
  assert.match(text, /- 이미지·영상: 연결 필요 — .*"연결 필요"라고 알려라/);
  assert.match(text, /- 검토: Claude Code \(연결됨\)/);
});

test('seed includes the rules body, the table and the policy; caps long rules', () => {
  const rows = d.resolveAllDepartments({});
  const s = seed.buildMichaelSeed({ rulesText: '# 내 규칙\n- 규칙 A', rulesPath: '/w/michael-rules.md', departments: rows });
  assert.match(s, /# 내 규칙/);
  assert.match(s, /코딩: 연결 필요/);
  assert.match(s, /\[배정\]/);
  assert.match(s, /결과:/);
  const long = 'ㄱ'.repeat(seed.RULES_SEED_MAX_CHARS + 500);
  const capped = seed.capRulesText(long);
  assert.equal(capped.truncated, true);
  assert.ok(capped.text.length < long.length);
  assert.match(capped.text, /잘렸습니다/);
  assert.equal(seed.capRulesText('짧음').truncated, false);
  const noRules = seed.buildMichaelSeed({ rulesText: null, departments: rows });
  assert.match(noRules, /규칙 파일을 읽지 못했다/);
});

test('the shipped default rules file exists and fits under the seed cap', () => {
  const text = fs.readFileSync(DEFAULT_RULES, 'utf8');
  assert.ok(text.length < seed.RULES_SEED_MAX_CHARS);
  assert.match(text, /보고 형식/);
});

// ── workspace rules file ──────────────────────────────────────────────────────
function tmpHome() { return fs.mkdtempSync(path.join(os.tmpdir(), 'son-rules-')); }

test('first read copies the default; an existing file is never overwritten', () => {
  const home = tmpHome();
  const r1 = rules.readRules(home, DEFAULT_RULES);
  assert.equal(r1.ok, true);
  assert.equal(r1.createdFromDefault, true);
  assert.equal(r1.path, path.join(home, 'michael-rules.md'));
  assert.equal(r1.text, fs.readFileSync(DEFAULT_RULES, 'utf8'));
  fs.writeFileSync(path.join(home, 'michael-rules.md'), 'MINE');
  assert.equal(rules.ensureRulesFile(home, DEFAULT_RULES), false);
  const r2 = rules.readRules(home, DEFAULT_RULES);
  assert.equal(r2.text, 'MINE');
  assert.equal(r2.createdFromDefault, undefined);
});

test('write + reset round trip', () => {
  const home = tmpHome();
  assert.equal(rules.writeRules(home, '새 규칙').ok, true);
  assert.equal(fs.readFileSync(path.join(home, 'michael-rules.md'), 'utf8'), '새 규칙');
  const r = rules.resetRules(home, DEFAULT_RULES);
  assert.equal(r.ok, true);
  assert.equal(fs.readFileSync(path.join(home, 'michael-rules.md'), 'utf8'), fs.readFileSync(DEFAULT_RULES, 'utf8'));
  assert.equal(rules.writeRules(home, 42).ok, false);
  assert.equal(rules.writeRules(home, 'x'.repeat(rules.RULES_MAX_BYTES + 1)).ok, false);
});

test('path confinement: no home, relative home, traversal names and symlinks are refused', () => {
  assert.equal(rules.rulesPathIn(null), null);
  assert.equal(rules.rulesPathIn(''), null);
  assert.equal(rules.rulesPathIn('relative/dir'), null);
  const home = tmpHome();
  assert.equal(rules.rulesPathIn(home, '../evil.md'), null);
  assert.equal(rules.rulesPathIn(home, 'sub/evil.md'), null);
  assert.equal(rules.rulesPathIn(home), path.join(home, 'michael-rules.md'));
  const outside = path.join(tmpHome(), 'target.md');
  fs.writeFileSync(outside, 'secret');
  fs.symlinkSync(outside, path.join(home, 'michael-rules.md'));
  assert.equal(rules.rulesPathIn(home), null);
  assert.equal(rules.readRules(home, DEFAULT_RULES).ok, false);
  assert.equal(rules.writeRules(home, 'x').ok, false);
  assert.equal(fs.readFileSync(outside, 'utf8'), 'secret');
});

test('IPC registration exposes exactly get/set/reset and none takes a path', async () => {
  const handlers = {};
  const home = tmpHome();
  rules.registerMichaelRulesIpc({ handle: (ch, fn) => { handlers[ch] = fn; } }, () => home, () => DEFAULT_RULES);
  assert.deepEqual(Object.keys(handlers).sort(), ['michaelRules:get', 'michaelRules:reset', 'michaelRules:set']);
  assert.equal((await handlers['michaelRules:set']({}, 'abc')).ok, true);
  assert.equal((await handlers['michaelRules:get']({}, '/etc/passwd')).text, 'abc');
});
