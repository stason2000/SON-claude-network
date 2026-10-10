import type { ApiConnector } from './types';

/**
 * Higgsfield (image / video generation) — asynchronous queue API.
 * Verified 2026-10-10 against docs.higgsfield.ai (docs/quickstart, docs/authentication):
 *  - Submit: POST https://api.higgsfield.ai/<model path> with {"prompt": …},
 *    `Authorization: Key <KEY_ID>:<KEY_SECRET>`, optional `Idempotency-Key`.
 *    Response: {status:'queued', request_id, status_url, cancel_url}.
 *  - Poll status_url until a terminal status: completed | failed | nsfw | canceled.
 *    A completed image request returns images[].url.
 *  - Default model path is the one used in the official quickstart
 *    (higgsfield-ai/soul/v2/standard, text-to-image). Other model paths (video) can be
 *    passed with `son-api higgsfield --model <path>`; their request schemas are NOT
 *    verified (the docs say the model catalog is being redesigned).
 * The key is stored as ONE string "KEY_ID:KEY_SECRET". Not live-tested with real credentials.
 */
const higgsfield: ApiConnector = {
  id: 'higgsfield',
  label: 'Higgsfield',
  kind: 'api',
  needsKey: true,
  keyFormatHint: 'KEY_ID:KEY_SECRET',
  strengths: ['image', 'video'],
  docsUrl: 'https://docs.higgsfield.ai/docs/quickstart',
  verified: true,
  verifiedNote: 'Submit/poll REST flow, Key auth and the quickstart text-to-image model read from official docs 2026-10-10; per-model video schemas unverified; not live-tested.',
  api: {
    protocol: 'higgsfield-queue',
    endpoint: 'https://api.higgsfield.ai',
    model: 'higgsfield-ai/soul/v2/standard',
    modelParam: 'model',
    authScheme: 'key'
  }
};

export default higgsfield;
