import type { ApiConnector } from './types';

/**
 * FreeLLMAPI — a SELF-HOSTED, MIT-licensed OpenAI-compatible router
 * (https://github.com/tashfeenahmed/freellmapi) that stacks the free tiers of many
 * providers behind one `/v1` API. The user installs and runs it themselves (desktop
 * .exe/.dmg from Releases, or Docker); this app never bundles, downloads or starts it.
 *
 * Verified 2026-10-11 against docs/en/api/01-rest-api.md and README.md in that repo:
 *  - Base URL `http://localhost:3001/v1`, unified key from the dashboard's Keys page
 *    (desktop app: the tray popover), sent as `Authorization: Bearer freellmapi-…`.
 *  - POST /v1/chat/completions with `model: "auto"` (router picks) or `auto:fast`,
 *    `auto:smart`, …; `stream: true` is the standard OpenAI chat-completions stream.
 *  - GET /v1/models lists the catalog (used by the settings "연결 테스트").
 *  - /v1/responses exists, but its streaming event names are NOT documented, so the
 *    documented chat-completions stream ('openai-chat') is used instead.
 *  - README Disclaimer: "for personal experimentation and learning, not production";
 *    Limitations: no frontier models, variable latency, no SLA; each upstream
 *    provider's terms still apply. Premium (live catalog) is optional, $19/yr.
 * The endpoint is user-editable (another port / a https host they run). Not
 * live-tested against a running FreeLLMAPI (mock server only).
 */
const freellmapi: ApiConnector = {
  id: 'freellmapi',
  label: 'FreeLLMAPI',
  kind: 'api',
  costTier: 'free',
  needsKey: true,
  keyFormatHint: 'freellmapi-…',
  strengths: ['general', 'writing'],
  docsUrl: 'https://github.com/tashfeenahmed/freellmapi',
  // No hosted key page: the key comes from the user's OWN local dashboard, so the
  // "API 키 발급" button opens the official docs/README instead.
  connectionTest: 'models',
  verified: true,
  verifiedNote: 'Base URL, Bearer unified key, auto/auto:fast/auto:smart models, chat-completions streaming and GET /v1/models read from the official repo docs 2026-10-11; not live-tested against a running router.',
  api: {
    protocol: 'openai-chat',
    endpoint: 'http://localhost:3001/v1',
    model: 'auto',
    modelParam: 'model',
    authScheme: 'bearer',
    editableEndpoint: true
  }
};

export default freellmapi;
