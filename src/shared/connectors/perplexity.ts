import type { ApiConnector } from './types';

/**
 * Perplexity Agent API (web-grounded answers with citations).
 * Verified 2026-10-10 against docs.perplexity.ai:
 *  - POST https://api.perplexity.ai/v1/agent, `Authorization: Bearer <key>`
 *    (docs/agent-api/quickstart). Body takes `input` (role/content items) and either
 *    `model` or a managed `preset`; presets are tier-named (fast, low, medium, high,
 *    xhigh — docs/agent-api/presets). We default to preset `fast`.
 *  - `stream: true` → events `response.output_text.delta` / `response.completed`
 *    (docs/agent-api/output-control) — the same shape as OpenAI's Responses API.
 *  - Multi-turn = replay the transcript in `input` (docs/agent-api/conversation-state).
 *  - The older Sonar chat-completions API is being migrated to this Agent API
 *    (docs/agent-api/migrate-from-sonar), so Sonar is intentionally not used.
 * Not live-tested with a real key.
 */
const perplexity: ApiConnector = {
  id: 'perplexity',
  label: 'Perplexity API',
  kind: 'api',
  needsKey: true,
  keyFormatHint: 'pplx-…',
  strengths: ['research', 'writing'],
  docsUrl: 'https://docs.perplexity.ai/docs/agent-api/quickstart',
  verified: true,
  verifiedNote: 'Agent API endpoint, Bearer auth, preset names and streaming events read from official docs 2026-10-10; not live-tested with a real key.',
  api: {
    protocol: 'openai-responses',
    endpoint: 'https://api.perplexity.ai/v1/agent',
    model: 'fast',
    modelParam: 'preset',
    authScheme: 'bearer'
  }
};

export default perplexity;
