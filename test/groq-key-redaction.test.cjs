// The Groq API key must never be sent to the renderer: config replies carry a mask,
// and saving the mask back must not overwrite the real key.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'src/main/index.ts'), 'utf8');

test('config:get, config:update, token-cap and config:changed all go through redactConfig', () => {
  assert.match(src, /ipcMain\.handle\('config:get', \(\): HarnessConfig => redactConfig\(readConfig\(\)\)\)/);
  assert.match(src, /redactConfig\(setAgentTokenCap\(agentId, tokenCap\)\)/);
  assert.match(src, /webContents\.send\('config:changed', redactConfig\(config\)\)/);
  assert.match(src, /return redactConfig\(next\);/);
});

test('saving the mask back leaves the stored key untouched', () => {
  assert.match(src, /p\.apiKey !== GROQ_KEY_MASK/);
});

test('redactConfig masks a present key and leaves absent keys absent', () => {
  const MASK = '••••••••••••';
  const redact = (c) => (c.groqApiKey ? { ...c, groqApiKey: MASK } : c);
  assert.equal(redact({ groqApiKey: 'gsk_secret', a: 1 }).groqApiKey, MASK);
  assert.equal(JSON.stringify(redact({ groqApiKey: 'gsk_secret' })).includes('gsk_secret'), false);
  assert.equal('groqApiKey' in redact({ a: 1 }), false);
});
