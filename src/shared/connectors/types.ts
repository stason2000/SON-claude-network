/**
 * Connector layer — the single description of "how this app talks to an AI".
 *
 * Three kinds:
 *  - 'cli'         a terminal agent CLI. Wraps an existing preset in
 *                  ../agentProvider.ts BY ID (the preset stays the source of truth
 *                  for spawn flags; the connector adds strengths/docs metadata).
 *  - 'api'         an HTTP API called with a user-supplied key. Runs as a PTY child
 *                  (resources/api-agent.cjs) that main spawns with the key injected
 *                  ONLY through a child-process env var. The key is never sent to
 *                  the renderer.
 *  - 'unavailable' a service with no stable, official automatic invocation (GUI-only
 *                  apps). Registered so the UI can say so honestly — never faked.
 *
 * Shared between main and renderer; keep it dependency-free (types only + data).
 */
import type { AgentProvider } from '../agentProvider';

export type ConnectorKind = 'cli' | 'api' | 'unavailable';

/** What a connector is good at — used later for department assignment. */
export type ConnectorStrength = 'coding' | 'research' | 'image' | 'video' | 'writing' | 'review' | 'general';

export const CONNECTOR_STRENGTHS: readonly ConnectorStrength[] = [
  'coding',
  'research',
  'image',
  'video',
  'writing',
  'review',
  'general'
];

/** Wire protocol resources/api-agent.cjs speaks for an 'api' connector.
 *  - 'openai-responses'  POST {endpoint} with {model|preset, input[], stream:true};
 *                        SSE events `response.output_text.delta` / `response.completed`.
 *                        OpenAI Responses API and Perplexity Agent API both use it.
 *  - 'higgsfield-queue'  POST {endpoint}/{model} with {prompt} → request_id + status_url;
 *                        poll status_url until a terminal state; print result URLs. */
export type ApiProtocol = 'openai-responses' | 'higgsfield-queue';

/** Non-secret runtime config for an API connector. This exact object (never the
 *  key) is serialized into the api-agent's SON_API_CONNECTOR env var. */
export interface ApiConnectorConfig {
  protocol: ApiProtocol;
  /** Full request URL ('openai-responses') or API origin ('higgsfield-queue'). */
  endpoint: string;
  /** Default model id (or preset / model path — see modelParam). */
  model: string;
  /** Request-body field the model is sent under. Default 'model'. Perplexity's
   *  Agent API takes a managed `preset` name instead. */
  modelParam?: 'model' | 'preset';
  /** How the key is presented: `Authorization: Bearer <key>` or `Authorization: Key <key>`. */
  authScheme: 'bearer' | 'key';
}

interface ConnectorBase {
  /** Stable id — unique across the registry. */
  id: string;
  /** Display name (product name; not translated). */
  label: string;
  kind: ConnectorKind;
  strengths: ConnectorStrength[];
  /** Official documentation page that was checked for this connector. */
  docsUrl?: string;
  /** true ONLY when the official docs above were actually read and confirm the
   *  integration shape used here. Anything not confirmed stays false. */
  verified: boolean;
  /** Short English note on what was / was not verified (developer-facing). */
  verifiedNote?: string;
}

export interface CliConnector extends ConnectorBase {
  kind: 'cli';
  /** The agentProvider preset this connector wraps. */
  provider: AgentProvider;
  needsKey: false;
}

export interface ApiConnector extends ConnectorBase {
  kind: 'api';
  needsKey: true;
  /** Placeholder shown in the write-only key field (format hint, not a secret). */
  keyFormatHint: string;
  api: ApiConnectorConfig;
}

export interface UnavailableConnector extends ConnectorBase {
  kind: 'unavailable';
  needsKey: false;
  /** Why it can't be connected — shown in the UI as "연결 불가, 이유: …". */
  reason: { ko: string; en: string };
}

export type Connector = CliConnector | ApiConnector | UnavailableConnector;
