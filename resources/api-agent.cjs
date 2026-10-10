#!/usr/bin/env node
'use strict';
/**
 * api-agent.cjs — a tiny terminal chat agent for an 'api' connector
 * (src/shared/connectors). Spawned by the main process in a PTY like any other
 * agent CLI:
 *
 *   <electron, ELECTRON_RUN_AS_NODE=1> api-agent.cjs --connector <id> [--model <id>]
 *
 * Inputs (env, set by main at spawn time only):
 *   SON_API_CONNECTOR  JSON of the connector's NON-secret config
 *                      {id,label,protocol,endpoint,model,modelParam,authScheme}
 *   SON_API_KEY        the decrypted API key. Read once, then deleted from
 *                      process.env. Never printed: every byte this script writes
 *                      goes through redact(), and auth failures print a fixed
 *                      message instead of the server's body (some providers echo
 *                      a partially-masked key back in 401 bodies).
 *   SON_API_BASE_URL   optional origin override (tests / local mock servers).
 *                      Main sets it to '' so an inherited value can't redirect a
 *                      real key elsewhere.
 *
 * Reads one prompt per line from stdin, streams the reply to stdout, and keeps
 * the conversation history in memory. `/clear` resets history, `/exit` quits.
 * Dependency-free: Node >= 18 global fetch only.
 */

const readline = require('node:readline');
const { randomUUID } = require('node:crypto');

// ── args / config ────────────────────────────────────────────────────────────
function argValue(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const KEY = typeof process.env.SON_API_KEY === 'string' ? process.env.SON_API_KEY.trim() : '';
delete process.env.SON_API_KEY;

/** Strings that must never reach the terminal: the key and, for "id:secret"
 *  keys, each half. */
const SECRETS = [KEY, ...(KEY.includes(':') ? KEY.split(':') : [])].filter((s) => s.length >= 4);
const KEYLIKE = /\b(sk|pplx|key|hf)[-_][A-Za-z0-9*_\-.]{4,}/gi;

function redact(text) {
  let s = String(text);
  for (const secret of SECRETS) s = s.split(secret).join('[REDACTED]');
  return s;
}
/** Error text additionally loses anything shaped like an API key (e.g. a masked
 *  "sk-abc***xyz" a server echoed back). Not applied to model replies, where a
 *  phrase like "key-value" is ordinary prose. */
const redactError = (text) => redact(text).replace(KEYLIKE, '[REDACTED]');
const out = (s) => process.stdout.write(redact(s));
const errOut = (s) => process.stdout.write(`\x1b[31m${redactError(s)}\x1b[0m\n`);

let cfg;
try {
  cfg = JSON.parse(process.env.SON_API_CONNECTOR || 'null');
} catch {
  cfg = null;
}
const connectorId = argValue('--connector') || (cfg && cfg.id) || '?';
if (!cfg || typeof cfg.endpoint !== 'string' || typeof cfg.model !== 'string' || typeof cfg.protocol !== 'string') {
  errOut(`[api-agent] 연결부 설정이 없습니다 / connector config missing for "${connectorId}"`);
  process.exit(2);
}
const label = cfg.label || connectorId;
const model = argValue('--model') || cfg.model;
const system = argValue('--system');

function resolveEndpoint(endpoint) {
  const override = (process.env.SON_API_BASE_URL || '').trim();
  if (!override) return endpoint;
  const u = new URL(endpoint);
  const o = new URL(override);
  u.protocol = o.protocol;
  u.host = o.host;
  return u.toString().replace(/\/$/, '');
}
const ENDPOINT = resolveEndpoint(cfg.endpoint);
const ORIGIN = new URL(ENDPOINT).origin;

function authHeader() {
  return cfg.authScheme === 'key' ? `Key ${KEY}` : `Bearer ${KEY}`;
}

const NO_KEY_MSG =
  `[${label}] API 키가 없습니다. 설정 → 연결부에서 키를 저장한 뒤 이 직원을 다시 시작하세요.\n` +
  `[${label}] No API key stored. Save one in Settings → Connectors, then restart this agent.`;

// ── HTTP helpers ─────────────────────────────────────────────────────────────
async function failureMessage(res) {
  if (res.status === 401 || res.status === 403) {
    return `HTTP ${res.status}: 인증 실패 — API 키를 확인하세요 / authentication failed — check the API key`;
  }
  let detail = '';
  try {
    const text = (await res.text()).slice(0, 2000);
    try {
      const j = JSON.parse(text);
      detail = (j && j.error && (j.error.message || j.error)) || j.detail || j.message || text;
      if (typeof detail !== 'string') detail = JSON.stringify(detail);
    } catch {
      detail = text;
    }
  } catch {
    /* ignore */
  }
  return `HTTP ${res.status}${detail ? `: ${detail.slice(0, 500)}` : ''}`;
}

function networkMessage(e) {
  if (e && e.name === 'AbortError') return '시간 초과 / request timed out';
  const cause = e && e.cause && (e.cause.code || e.cause.message);
  return `${(e && e.message) || String(e)}${cause ? ` (${cause})` : ''}`;
}

// ── protocol: openai-responses (OpenAI Responses API, Perplexity Agent API) ───
const history = [];

async function* sseEvents(body) {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).replace(/\r$/, '');
      buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      try {
        yield JSON.parse(data);
      } catch {
        /* skip a malformed frame */
      }
    }
  }
}

function outputTextOf(json) {
  if (!json || typeof json !== 'object') return '';
  if (typeof json.output_text === 'string') return json.output_text;
  const parts = [];
  for (const item of Array.isArray(json.output) ? json.output : []) {
    for (const c of Array.isArray(item && item.content) ? item.content : []) {
      if (c && typeof c.text === 'string') parts.push(c.text);
    }
  }
  return parts.join('');
}

async function askResponses(prompt) {
  history.push({ type: 'message', role: 'user', content: prompt });
  const body = { input: history, stream: true };
  body[cfg.modelParam === 'preset' ? 'preset' : 'model'] = model;
  if (system) body.instructions = system;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 180_000);
  let reply = '';
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: authHeader(), 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify(body),
      redirect: 'error',
      signal: ac.signal
    });
    if (!res.ok) {
      history.pop();
      errOut(`[${label}] ${await failureMessage(res)}`);
      return;
    }
    const ctype = res.headers.get('content-type') || '';
    if (!ctype.includes('text/event-stream')) {
      reply = outputTextOf(await res.json());
      out(reply);
    } else {
      for await (const ev of sseEvents(res.body)) {
        if (ev.type === 'response.output_text.delta' && typeof ev.delta === 'string') {
          reply += ev.delta;
          out(ev.delta);
        } else if (ev.type === 'error' || ev.type === 'response.failed') {
          const m = (ev.error && ev.error.message) || (ev.response && ev.response.error && ev.response.error.message) || ev.message || 'stream error';
          errOut(`\n[${label}] ${m}`);
        } else if (ev.choices && ev.choices[0] && ev.choices[0].delta && typeof ev.choices[0].delta.content === 'string') {
          // tolerate a chat-completions-shaped stream from an OpenAI-compatible server
          reply += ev.choices[0].delta.content;
          out(ev.choices[0].delta.content);
        }
      }
    }
    out('\n');
    if (reply) history.push({ type: 'message', role: 'assistant', content: reply });
    else history.pop();
  } catch (e) {
    history.pop();
    errOut(`[${label}] ${networkMessage(e)}`);
  } finally {
    clearTimeout(timer);
  }
}

// ── protocol: higgsfield-queue (submit → poll) ────────────────────────────────
const TERMINAL = new Set(['completed', 'failed', 'nsfw', 'canceled', 'cancelled']);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function collectUrls(node, acc = []) {
  if (!node || typeof node !== 'object') return acc;
  if (Array.isArray(node)) {
    for (const n of node) collectUrls(n, acc);
    return acc;
  }
  for (const [k, v] of Object.entries(node)) {
    if (k === 'url' && typeof v === 'string') acc.push(v);
    else if (k !== 'status_url' && k !== 'cancel_url') collectUrls(v, acc);
  }
  return acc;
}

async function askHiggsfield(prompt) {
  const headers = { Authorization: authHeader(), 'Content-Type': 'application/json' };
  try {
    const submitUrl = `${ENDPOINT.replace(/\/$/, '')}/${String(model).replace(/^\//, '')}`;
    const res = await fetch(submitUrl, {
      method: 'POST',
      headers: { ...headers, 'Idempotency-Key': randomUUID() },
      body: JSON.stringify({ prompt }),
      redirect: 'error'
    });
    if (!res.ok) return errOut(`[${label}] ${await failureMessage(res)}`);
    const job = await res.json();
    let statusUrl = typeof job.status_url === 'string' ? job.status_url : `${ORIGIN}/requests/${job.request_id}/status`;
    // Never send the key to a host other than the connector's own API origin.
    if (new URL(statusUrl, ORIGIN).origin !== ORIGIN) return errOut(`[${label}] status_url points off-origin; refusing to poll`);
    statusUrl = new URL(statusUrl, ORIGIN).toString();
    out(`[${label}] 요청 접수 / queued (${job.request_id || '?'})\n`);
    let last = job.status;
    const deadline = Date.now() + 15 * 60_000;
    while (Date.now() < deadline) {
      await sleep(Number(process.env.SON_API_POLL_MS) || 3000);
      const r = await fetch(statusUrl, { headers, redirect: 'error' });
      if (!r.ok) return errOut(`[${label}] ${await failureMessage(r)}`);
      const st = await r.json();
      if (st.status !== last) {
        out(`[${label}] ${st.status}\n`);
        last = st.status;
      }
      if (TERMINAL.has(st.status)) {
        if (st.status === 'completed') {
          const urls = collectUrls(st);
          out(urls.length ? `${urls.join('\n')}\n` : `[${label}] 완료 (결과 URL 없음) / completed (no result URL)\n`);
        }
        return;
      }
    }
    errOut(`[${label}] 시간 초과 / timed out waiting for the result`);
  } catch (e) {
    errOut(`[${label}] ${networkMessage(e)}`);
  }
}

// ── REPL ─────────────────────────────────────────────────────────────────────
const ask = cfg.protocol === 'higgsfield-queue' ? askHiggsfield : askResponses;
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY });
const PROMPT = '\x1b[1m> \x1b[0m';
const queue = [];
let busy = false;

function showPrompt() {
  if (process.stdin.isTTY) process.stdout.write(PROMPT);
}

async function drain() {
  if (busy) return;
  busy = true;
  while (queue.length) {
    const line = queue.shift();
    if (line === '/exit' || line === '/quit') {
      process.exit(0);
    }
    if (line === '/clear') {
      history.length = 0;
      out(`[${label}] 대화 기록을 지웠습니다 / history cleared\n`);
      continue;
    }
    if (!KEY) {
      out(`${NO_KEY_MSG}\n`);
      continue;
    }
    await ask(line);
  }
  busy = false;
  showPrompt();
  if (stdinClosed) process.exit(0);
}

let stdinClosed = false;
rl.on('line', (raw) => {
  const line = raw.trim();
  if (!line) return showPrompt();
  queue.push(line);
  void drain();
});
rl.on('close', () => {
  stdinClosed = true;
  if (!busy && !queue.length) process.exit(0);
});

out(`[${label}] API 연결부 · model ${model}\n`);
if (!KEY) out(`${NO_KEY_MSG}\n`);
else out(`[${label}] 질문을 입력하고 Enter / type a prompt and press Enter  (/clear, /exit)\n`);
showPrompt();
