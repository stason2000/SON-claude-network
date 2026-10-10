'use strict';
/** Workspace view (#6): status word mapping, sidebar order, layout parsing, i18n keys. */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const ws = loadTs('src/shared/workspace.ts');

test('status words: live statuses map 1:1, no terminal means offline', () => {
  const w = (status, ptyId = 'p1') => ws.workspaceStatusWord({ status, ptyId });
  assert.equal(w('working'), 'working');
  assert.equal(w('thinking'), 'thinking');
  assert.equal(w('blocked'), 'needsYou');
  assert.equal(w('waiting'), 'waiting');
  assert.equal(w('compacting'), 'compacting');
  assert.equal(w('looping'), 'looping');
  assert.equal(w('idle'), 'idle');
  assert.equal(w('typing'), 'idle');
  assert.equal(w('success'), 'done');
  assert.equal(w('ghost'), 'offline');
  assert.equal(w('something-new'), 'idle');
  assert.equal(ws.workspaceStatusWord({ status: 'working' }), 'offline');
  assert.equal(ws.workspaceStatusLive('working'), true);
  assert.equal(ws.workspaceStatusLive('idle'), false);
  assert.match(ws.workspaceStatusColor('needsYou'), /status-blocked/);
});

test('order: orchestrator, assistant, then roster order; archived dropped', () => {
  const agents = [
    { id: 'b', status: 'idle', ptyId: 'x' },
    { id: 'asst', status: 'idle', isAssistant: true, ptyId: 'x' },
    { id: 'a', status: 'blocked', ptyId: 'x' },
    { id: 'gone', status: 'idle', archived: true },
    { id: 'god', status: 'working', isGod: true, ptyId: 'x' },
    { id: 'c', status: 'working', ptyId: 'x' }
  ];
  assert.deepEqual(ws.orderWorkspaceAgents(agents).map((a) => a.id), ['god', 'asst', 'b', 'a', 'c']);
  assert.equal(ws.countNeedsYou(agents), 1);
  assert.equal(agents[0].id, 'b', 'input not mutated');
});

test('layout parsing defaults to classic', () => {
  assert.equal(ws.parseWorkspaceLayout('workspace'), 'workspace');
  assert.equal(ws.parseWorkspaceLayout('classic'), 'classic');
  assert.equal(ws.parseWorkspaceLayout(null), 'classic');
  assert.equal(ws.parseWorkspaceLayout('weird'), 'classic');
});

test('every workspace i18n key exists in ko and en', () => {
  const ko = require(path.join(__dirname, '../src/renderer/src/i18n/locales/extra.ko.json')).workspace;
  const en = require(path.join(__dirname, '../src/renderer/src/i18n/locales/extra.en.json')).workspace;
  const keys = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' ? keys(v, `${p}${k}.`) : [`${p}${k}`]));
  assert.deepEqual(keys(ko).sort(), keys(en).sort());
  for (const w of ['working', 'thinking', 'needsYou', 'waiting', 'compacting', 'looping', 'idle', 'done', 'offline']) {
    assert.ok(ko.status[w], w);
  }
  // Every key the components use is defined.
  const fs = require('node:fs');
  const dir = path.join(__dirname, '../src/renderer/src/components/workspace');
  const src = fs.readdirSync(dir).map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n')
    + fs.readFileSync(path.join(__dirname, '../src/renderer/src/App.tsx'), 'utf8');
  const flat = new Set(keys(ko));
  for (const m of src.matchAll(/'extra\.workspace\.([a-zA-Z.]+)'/g)) assert.ok(flat.has(m[1]), m[1]);
});
