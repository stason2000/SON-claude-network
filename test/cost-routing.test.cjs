'use strict';
/** Cost routing (modelPolicy.pickRoute): free for light work, subscription for normal, never free for hard. */
const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');
const mp = loadTs('src/shared/modelPolicy.ts');

const ALL = ['claude', 'codex', 'openrouter', 'freellmapi', 'openai'];

test('cost tiers: free routers, subscription CLIs, metered APIs', () => {
  assert.equal(mp.costTierOf('openrouter'), 'free');
  assert.equal(mp.costTierOf('freellmapi'), 'free');
  assert.equal(mp.costTierOf('claude'), 'subscription');
  assert.equal(mp.costTierOf('openai'), 'paid');
  assert.equal(mp.costTierOf('perplexity'), 'paid');
});

test('simple work goes to a free AI first, and may escalate to subscription', () => {
  const r = mp.pickRoute({ kind: 'summary', available: ALL });
  assert.equal(r.tier, 'free');
  assert.equal(r.connectorId, 'freellmapi');
  assert.equal(r.needsUserApproval, false);
  assert.equal(r.escalateTo, 'claude');
});

test('simple work falls back to a subscription small model when no free AI is connected', () => {
  const r = mp.pickRoute({ kind: 'rename', available: ['claude'] });
  assert.equal(r.tier, 'subscription');
  assert.equal(r.model, 'claude-haiku-5-5');
});

test('normal work uses a subscription AI, medium model', () => {
  const r = mp.pickRoute({ kind: 'implement', available: ALL });
  assert.equal(r.tier, 'subscription');
  assert.equal(r.model, 'claude-sonnet-5-5');
  assert.equal(r.effort, 'medium');
});

test('hard work and final review are never free: biggest subscription model, high effort', () => {
  for (const kind of ['design', 'debug', 'final-review']) {
    const r = mp.pickRoute({ kind, available: ALL });
    assert.equal(r.tier, 'subscription', kind);
    assert.equal(r.model, 'claude-opus-5-5', kind);
    assert.equal(r.effort, 'high', kind);
    assert.equal(r.escalateTo, null);
  }
  // Even a "simple" difficulty claim cannot push a final review onto a free AI.
  const f = mp.pickRoute({ kind: 'final-review', difficulty: 'simple', available: ['openrouter', 'claude'] });
  assert.equal(f.tier, 'subscription');
});

test('hard work with only free AIs connected returns null instead of using a free AI', () => {
  assert.equal(mp.pickRoute({ kind: 'design', available: ['openrouter', 'freellmapi'] }), null);
});

test('hard work with only a metered API needs the user\'s approval', () => {
  const r = mp.pickRoute({ kind: 'design', available: ['openai'] });
  assert.equal(r.tier, 'paid');
  assert.equal(r.needsUserApproval, true);
});

test('media goes to a paid connector and always needs approval; null if none connected', () => {
  assert.equal(mp.pickRoute({ kind: 'media', available: ['claude', 'openrouter'] }), null);
  const r = mp.pickRoute({ kind: 'media', available: ['higgsfield', 'claude'] });
  assert.equal(r.connectorId, 'higgsfield');
  assert.equal(r.needsUserApproval, true);
});

test('seed text states the cost rules in Korean', () => {
  const t = mp.modelPolicySeedText();
  for (const s of ['무료', '구독', '유료', '최종 검토', '딱 한 번만']) assert.ok(t.includes(s), s);
});
