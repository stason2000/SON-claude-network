'use strict';
/**
 * Model / effort policy (src/shared/modelPolicy.ts) and the boss report format
 * check (src/shared/reportFormat.ts). Pure functions only.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const mp = loadTs('src/shared/modelPolicy.ts');
const rf = loadTs('src/shared/reportFormat.ts');
const catalog = require('../src/shared/modelCatalog.json');
const claudeCmds = loadTs('src/shared/claudeCommands.ts');

const ids = (p) => catalog.providers[p].map((m) => m.id).filter(Boolean);

test('claude tiers: simple → haiku/low, normal → sonnet/medium, hard → opus/high', () => {
  const s = mp.pickModelAndEffort({ kind: 'summary', connectorId: 'claude' });
  const n = mp.pickModelAndEffort({ kind: 'implement', connectorId: 'claude' });
  const h = mp.pickModelAndEffort({ kind: 'design', connectorId: 'claude' });
  assert.deepEqual([s.model, s.effort, s.difficulty], ['claude-haiku-5-5', 'low', 'simple']);
  assert.deepEqual([n.model, n.effort, n.difficulty], ['claude-sonnet-5-5', 'medium', 'normal']);
  assert.deepEqual([h.model, h.effort, h.difficulty], ['claude-opus-5-5', 'high', 'hard']);
  for (const c of [s, n, h]) assert.ok(ids('claude').includes(c.model), c.model);
  assert.equal(s.effortVia, 'claude-slash');
});

test('every model the policy returns exists in the baked catalog (CLI providers)', () => {
  for (const connectorId of ['claude', 'codex', 'gemini']) {
    for (const difficulty of ['simple', 'normal', 'hard']) {
      const c = mp.pickModelAndEffort({ kind: 'implement', difficulty, connectorId });
      assert.ok(c.model && ids(connectorId).includes(c.model), `${connectorId}/${difficulty}: ${c.model}`);
    }
  }
});

test('the effort values used are ones Claude Code /effort accepts in this repo', () => {
  const effortCmd = claudeCmds.COMMAND_GROUPS.flatMap((g) => g.items).find((c) => c.cmd === '/effort');
  assert.ok(effortCmd, '/effort missing from claudeCommands');
  for (const e of ['low', 'medium', 'high']) assert.match(effortCmd.desc, new RegExp(`\\b${e}\\b`));
});

test('final review is always hard / high, whatever difficulty is passed', () => {
  const c = mp.pickModelAndEffort({ kind: 'final-review', difficulty: 'simple', connectorId: 'claude' });
  assert.deepEqual([c.difficulty, c.effort, c.model], ['hard', 'high', 'claude-opus-5-5']);
});

test('explicit difficulty overrides the kind default', () => {
  const c = mp.pickModelAndEffort({ kind: 'implement', difficulty: 'hard', connectorId: 'gemini' });
  assert.deepEqual([c.model, c.effort], ['pro', 'high']);
});

test('provider without size data → CLI default model, effort instruction-only, reason says so', () => {
  const c = mp.pickModelAndEffort({ kind: 'implement', connectorId: 'kimi' });
  assert.equal(c.model, null);
  assert.equal(c.effort, 'medium');
  assert.equal(c.effortVia, 'instruction-only');
  assert.match(c.reason, /기본 모델/);
});

test('codex size order is flagged as a guess; perplexity uses its preset tiers', () => {
  assert.match(mp.pickModelAndEffort({ kind: 'implement', connectorId: 'codex' }).reason, /추정/);
  const p = mp.pickModelAndEffort({ kind: 'research', connectorId: 'perplexity' });
  assert.deepEqual([p.model, p.effortVia], ['medium', 'model-id']);
  assert.equal(mp.pickModelAndEffort({ kind: 'summary', connectorId: 'perplexity' }).model, 'fast');
});

test('unavailable connector cannot take a model at spawn', () => {
  assert.equal(mp.pickModelAndEffort({ kind: 'media', connectorId: 'capcut' }).modelAtSpawn, false);
  assert.equal(mp.pickModelAndEffort({ kind: 'implement', connectorId: 'claude' }).modelAtSpawn, true);
});

test('formatHandoffLine is one Korean line with AI, model, effort and reason', () => {
  const line = mp.formatHandoffLine({ department: '코딩', connectorId: 'claude', model: 'claude-sonnet-5-5', effort: 'medium', reason: '일반\n구현' });
  assert.equal(line, '[배정] 코딩 → Claude Code · 모델 claude-sonnet-5-5 · 강도 중간 · 이유: 일반 구현');
  assert.ok(!line.includes('\n'));
  const l2 = mp.formatHandoffLine({ department: '리서치·자료', connectorId: 'gemini', model: null, effort: 'low', reason: '요약', agentName: 'Pam' });
  assert.match(l2, /Pam\(Gemini/);
  assert.match(l2, /모델 기본값/);
  assert.match(mp.modelPolicySeedText(), /\[배정\] 코딩 → Claude Code/);
});

// ── report format ───────────────────────────────────────────────────────────
test('a minimal report with only 결과 passes', () => {
  const r = rf.checkReportFormat('- 결과: 로그인 화면 완성, src/login.tsx');
  assert.equal(r.ok, true, r.errors.join('; '));
  assert.equal(r.sections['결과'], '로그인 화면 완성, src/login.tsx');
});

test('all four sections, bold labels and continuation lines pass', () => {
  const r = rf.checkReportFormat([
    '**결과**: 보고서 완성 (docs/report.md)',
    '- 고친 것: 표 숫자 오류 수정',
    '  두 번째 줄 설명',
    '- **내 결정 필요:** 공개 여부',
    '못 한 것: 이미지 — Higgsfield 연결 필요'
  ].join('\n'));
  assert.equal(r.ok, true, r.errors.join('; '));
  assert.match(r.sections['고친 것'], /두 번째 줄/);
});

test('missing 결과, unknown sections, narration and duplicates are flagged', () => {
  assert.ok(rf.checkReportFormat('- 고친 것: 오타').errors.includes('결과 줄이 없음'));
  const r = rf.checkReportFormat('- 결과: 완료\n- 과정: 먼저 파일을 열었고…');
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.startsWith('허용되지 않은 항목: 과정')));
  const n = rf.checkReportFormat('먼저 리서치를 했습니다.\n- 결과: 완료');
  assert.ok(n.errors.some((e) => e.startsWith('형식 밖 문장')));
  assert.equal(n.errors.includes('결과가 맨 앞이 아님'), false); // 결과 is still the first SECTION
  const dup = rf.checkReportFormat('- 결과: a\n- 결과: b');
  assert.ok(dup.errors.includes('중복된 항목: 결과'));
  const empty = rf.checkReportFormat('- 결과: a\n- 못 한 것:');
  assert.ok(empty.errors.some((e) => e.startsWith('비어 있는 항목: 못 한 것')));
  assert.ok(rf.checkReportFormat('- 고친 것: x\n- 결과: a').errors.includes('결과가 맨 앞이 아님'));
});
