import type { ApiConnector } from './types';

/**
 * OpenAI API (the models behind ChatGPT) via the Responses API.
 * Verified 2026-10-10 against developers.openai.com:
 *  - POST https://api.openai.com/v1/responses, `Authorization: Bearer <key>`
 *    (api/reference/overview), `stream: true` → SSE semantic events
 *    `response.output_text.delta` / `response.completed` / `error`
 *    (api/docs/guides/streaming-responses).
 *  - Model ids from api/docs/models: GPT-6 Astra (flagship), GPT-6.1 Sol (balanced
 *    cost — our default), GPT-6 Luna (cheap). The model is user-overridable with
 *    `son-api openai --model <id>`.
 * Not live-tested with a real key (no key available in the build environment).
 */
const openai: ApiConnector = {
  id: 'openai',
  label: 'OpenAI API (ChatGPT)',
  kind: 'api',
  needsKey: true,
  keyFormatHint: 'sk-…',
  strengths: ['general', 'writing', 'coding', 'review'],
  docsUrl: 'https://developers.openai.com/api/docs/guides/streaming-responses',
  verified: true,
  verifiedNote: 'Endpoint, Bearer auth, SSE event names and model ids read from official docs 2026-10-10; not live-tested with a real key.',
  api: {
    protocol: 'openai-responses',
    endpoint: 'https://api.openai.com/v1/responses',
    model: 'gpt-6.1-sol',
    modelParam: 'model',
    authScheme: 'bearer'
  }
};

export default openai;
