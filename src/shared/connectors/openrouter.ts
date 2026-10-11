import type { ApiConnector } from './types';

/**
 * OpenRouter — one hosted key that reaches many models, including a free router.
 * Checked 2026-10-11 against openrouter.ai:
 *  - OpenAI-compatible base `https://openrouter.ai/api/v1` (the docs' key endpoint is
 *    `GET https://openrouter.ai/api/v1/key`), chat completions + SSE streaming
 *    including mid-stream error frames (docs: api_reference/limits).
 *  - `openrouter/free` is the "Free Models Router" (openrouter.ai/openrouter/free,
 *    released 2026-02-01, up to 200k context).
 *  - Free-model requests are capped per minute and per day, and the daily cap rises
 *    once the account has bought credits. The docs page rendered the numbers blank
 *    when fetched, so they are NOT hard-coded here; third-party pages report 20
 *    requests/minute and 50/day (1,000/day after a $10 purchase) — re-check the
 *    official limits page before relying on them.
 * Not live-tested with a real key.
 */
const openrouter: ApiConnector = {
  id: 'openrouter',
  label: 'OpenRouter (무료 모델)',
  kind: 'api',
  needsKey: true,
  keyFormatHint: 'sk-or-…',
  keyUrl: 'https://openrouter.ai/settings/keys',
  strengths: ['general', 'writing'],
  docsUrl: 'https://openrouter.ai/docs/api_reference/limits',
  verified: false,
  verifiedNote: 'Base URL, free router id and 429/402 behaviour read from openrouter.ai docs 2026-10-11; the key page URL and the free-tier numbers were not confirmed on the official site; not live-tested with a real key.',
  api: {
    protocol: 'openai-chat',
    endpoint: 'https://openrouter.ai/api/v1',
    model: 'openrouter/free',
    modelParam: 'model',
    authScheme: 'bearer'
  }
};

export default openrouter;
