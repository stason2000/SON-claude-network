'use strict';
/**
 * 팀 지도 (smooth office plan): agent → department mapping, door/path state,
 * and the floor-plan geometry (src/shared/departmentMap.ts, src/shared/floorPlan.ts).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const m = loadTs('src/shared/departmentMap.ts');
const fp = loadTs('src/shared/floorPlan.ts');

const dept = (a, cfg) => m.departmentForAgent({ id: 'x', ...a }, cfg);

test('engine decides the department when the role says nothing', () => {
  assert.equal(dept({ provider: 'claude' }), 'coding');
  assert.equal(dept({ provider: 'codex' }), 'coding');
  assert.equal(dept({ provider: 'gemini' }), 'research');
  assert.equal(dept({ provider: 'grok' }), 'research');
  assert.equal(dept({ provider: 'cursor' }), 'coding'); // strengths: coding
  assert.equal(dept({ provider: 'custom', command: 'son-api higgsfield' }), 'media');
  assert.equal(dept({ provider: 'custom', command: 'son-api perplexity' }), 'research');
  assert.equal(dept({ provider: 'custom', command: 'son-api freellmapi' }), 'other');
  assert.equal(dept({ provider: 'custom', command: 'my-tool --x' }), 'other');
  // Legacy agent: no provider, the command binary tells.
  assert.equal(dept({ command: 'gemini' }), 'research');
});

test('role words beat the engine; 검토 wins over 코드', () => {
  assert.equal(dept({ provider: 'claude', description: '코드 검토 담당' }), 'review');
  assert.equal(dept({ provider: 'claude', description: '시장 조사' }), 'research');
  assert.equal(dept({ provider: 'gemini', description: '썸네일 이미지 만들기' }), 'media');
  assert.equal(dept({ provider: 'custom', command: 'son-api freellmapi', description: 'Code reviewer' }), 'review');
  assert.equal(dept({ provider: 'claude', name: 'QA bot' }), 'review');
  // ASCII words must stand alone: "aqua" is not "qa".
  assert.equal(dept({ provider: 'claude', description: 'aqua theme' }), 'coding');
});

test('user department config changes which room an engine lands in', () => {
  // codex ranks first in research once the user puts it there; coding still lists it 2nd.
  assert.equal(dept({ provider: 'codex' }, { research: ['codex', 'gemini'] }), 'research');
});

test('god is never in a room, assistant goes to 기타, roster order kept', () => {
  const g = m.groupAgentsByDepartment([
    { id: 'god', isGod: true, provider: 'claude' },
    { id: 'a', provider: 'claude' },
    { id: 'helper', isAssistant: true, provider: 'claude' },
    { id: 'b', provider: 'claude' }
  ]);
  assert.deepEqual(Object.keys(g).sort(), ['coding', 'media', 'other', 'research', 'review']);
  assert.deepEqual(g.coding.map((a) => a.id), ['a', 'b']);
  assert.deepEqual(g.other.map((a) => a.id), ['helper']);
});

test('door/path state: alert beats active beats idle', () => {
  assert.equal(m.lineStateFor([]), 'idle');
  assert.equal(m.lineStateFor(['idle', 'waiting', 'success']), 'idle');
  for (const s of ['working', 'thinking', 'compacting', 'looping']) assert.equal(m.lineStateFor(['idle', s]), 'active');
  assert.equal(m.lineStateFor(['working', 'blocked']), 'alert');
});

test('plan: rooms sit inside the outer wall and never overlap', () => {
  const inside = (b) => b.x >= fp.OUTER.x && b.y >= fp.OUTER.y && b.x + b.w <= fp.OUTER.x + fp.OUTER.w && b.y + b.h <= fp.OUTER.y + fp.OUTER.h;
  for (const r of fp.ROOMS) assert.ok(inside(r.box), r.id);
  for (let i = 0; i < fp.ROOMS.length; i++) for (let j = i + 1; j < fp.ROOMS.length; j++) {
    const a = fp.ROOMS[i].box, b = fp.ROOMS[j].box;
    const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    assert.ok(!overlap, `${fp.ROOMS[i].id} overlaps ${fp.ROOMS[j].id}`);
  }
  // exactly the four real departments + 기타 hold people; no invented teams
  assert.deepEqual(fp.ROOMS.filter((r) => r.kind === 'dept').map((r) => r.id).sort(), ['coding', 'media', 'other', 'research', 'review']);
});

test('plan: 팀장 desk is at the centre of the plan and inside the hall', () => {
  assert.equal(fp.BOSS_CENTER.x, fp.PLAN_W / 2);
  const d = fp.BOSS_DESK, h = fp.HALL;
  assert.equal(d.x + d.w / 2, fp.PLAN_W / 2);
  assert.ok(d.x > h.x && d.x + d.w < h.x + h.w && d.y > h.y && d.y + d.h < h.y + h.h);
});

test('plan: every door is on its room wall and opens into the hall', () => {
  for (const r of fp.ROOMS) {
    const { at, wall, size } = r.door, b = r.box;
    const onWall = { top: at.y === b.y, bottom: at.y === b.y + b.h, left: at.x === b.x, right: at.x === b.x + b.w }[wall];
    assert.ok(onWall, `${r.id} door not on its ${wall} wall`);
    const horiz = wall === 'top' || wall === 'bottom';
    const lo = horiz ? at.x - size / 2 : at.y - size / 2, hi = horiz ? at.x + size / 2 : at.y + size / 2;
    assert.ok(lo >= (horiz ? b.x : b.y) && hi <= (horiz ? b.x + b.w : b.y + b.h), `${r.id} door wider than its wall`);
    // The hall side of the door must be hall floor (not another room).
    const n = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0] }[wall];
    const p = { x: at.x + n[0] * 8, y: at.y + n[1] * 8 };
    const inHall = (q, h) => q.x >= h.x && q.x <= h.x + h.w && q.y >= h.y && q.y <= h.y + h.h;
    assert.ok(inHall(p, fp.HALL), `${r.id} door does not open into the hall`);
  }
});

test('plan: leader paths start at the desk and end at each department door', () => {
  for (const r of fp.ROOMS.filter((x) => x.kind === 'dept')) {
    const lp = fp.leaderPath(r.door);
    assert.match(lp.d, /^M[\d.]+ [\d.]+ C[\d. ]+$/);
    const d = fp.BOSS_DESK;
    const onDesk = lp.start.x >= d.x - 0.01 && lp.start.x <= d.x + d.w + 0.01 && lp.start.y >= d.y - 0.01 && lp.start.y <= d.y + d.h + 0.01;
    assert.ok(onDesk, `${r.id} path does not leave from the desk`);
    assert.ok(Math.hypot(lp.end.x - r.door.at.x, lp.end.y - r.door.at.y) <= 5, `${r.id} path misses its door`);
  }
});

test('plan: desks fit inside rooms; capacity, centring and +N overflow', () => {
  for (const r of fp.ROOMS.filter((x) => x.kind === 'dept')) {
    const g = fp.slotGrid(r.box);
    assert.ok(g.capacity >= 4, `${r.id} holds only ${g.capacity}`);
    const slots = fp.deskSlots(r.box, 99);
    assert.equal(slots.length, g.capacity);
    for (const s of slots) {
      assert.ok(s.x >= r.box.x && s.x + fp.SLOT_W <= r.box.x + r.box.w, `${r.id} slot spills sideways`);
      assert.ok(s.y >= r.box.y && s.y + fp.SLOT_H <= r.box.y + r.box.h, `${r.id} slot spills down`);
    }
    // a single agent is centred horizontally
    const [one] = fp.deskSlots(r.box, 1);
    assert.ok(Math.abs(one.x + fp.SLOT_W / 2 - (r.box.x + r.box.w / 2)) <= 1);
    const list = Array.from({ length: g.capacity + 3 }, (_, i) => i);
    const sp = fp.splitOverflow(r.box, list);
    assert.equal(sp.shown.length, g.capacity);
    assert.equal(sp.hidden, 3);
  }
  assert.deepEqual(fp.deskSlots(fp.ROOMS[0].box, 0), []);
});

test('text fitting keeps labels inside their pill', () => {
  assert.equal(fp.fitText('지민', 60, 13), '지민');
  const cut = fp.fitText('아주아주긴이름입니다', 58, 13);
  assert.ok(cut.endsWith('…'));
  assert.ok(fp.textWidth(cut, 13) <= 58);
  assert.ok(fp.textWidth('abc', 13) < fp.textWidth('가나다', 13));
});

test('i18n: teamMap strings exist in both languages with the same keys', () => {
  const dir = path.join(__dirname, '..', 'src', 'renderer', 'src', 'i18n', 'locales');
  const ko = JSON.parse(fs.readFileSync(path.join(dir, 'extra.ko.json'), 'utf8')).teamMap;
  const en = JSON.parse(fs.readFileSync(path.join(dir, 'extra.en.json'), 'utf8')).teamMap;
  const keys = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? keys(v, `${p}${k}.`) : [`${p}${k}`])).sort();
  assert.deepEqual(keys(ko), keys(en));
  assert.equal(ko.styleSmooth, '부드럽게');
  assert.equal(ko.stylePixel, '도트');
  assert.equal(ko.emptyLine, 'AI 직원을 추가하면 여기에 나타나요');
});
