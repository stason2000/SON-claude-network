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
 *                        poll status_url until a terminal state; print result URLs.
 *  - 'openai-chat'       POST {endpoint}/chat/completions with {model, messages[], stream:true};
 *                        SSE `data: {choices:[{delta:{content}}]}` frames ending in `data: [DONE]`.
 *                        `endpoint` is the OpenAI-compatible BASE URL (…/v1). Used by
 *                        self-hosted routers such as FreeLLMAPI. */
export type ApiProtocol = 'openai-responses' | 'higgsfield-queue' | 'openai-chat';

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
  /** true = the user may replace `endpoint` (a self-hosted server whose address
   *  only they know). The override is validated by validateConnectorEndpoint()
   *  and stored as plain, NON-secret config (HarnessConfig.connectorEndpoints). */
  editableEndpoint?: boolean;
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

/** How a person signs in to a CLI agent. The app never sees the credentials: it
 *  only opens a separate terminal window running the CLI's OWN official login
 *  flow; the CLI stores its login where it always does, so agents spawned
 *  afterwards are already signed in.
 *  - 'command'   the CLI has a dedicated login subcommand (`args`), e.g. `codex login`.
 *  - 'first-run' no separate command: the CLI itself asks you to sign in when it
 *                starts (optionally via a slash command named in `inside`).
 *  Only shapes read in the CLI's official docs (`sourceUrl`) are recorded here;
 *  a CLI without a verified spec has no `login` and the UI opens its docs instead. */
export interface CliLoginSpec {
  mode: 'command' | 'first-run';
  /** Executable names to try, in order (the first one found on PATH is used). */
  bins: string[];
  /** Arguments after the binary (empty for 'first-run'). Trusted constants. */
  args: string[];
  /** Slash command to type inside the CLI, when its docs name one (e.g. '/login'). */
  inside?: string;
  /** Official page the login shape was read from. */
  sourceUrl: string;
  /** Date (YYYY-MM-DD) the source was read. */
  checked: string;
  /** A READ-ONLY "am I signed in?" command, only when the CLI's official docs
   *  name one AND document its exit code. Main runs it with a short timeout,
   *  stdio ignored (output is never read), nothing opened. Exit 0 = signed in;
   *  an exit code in `loggedOutCodes` = signed out (only codes the docs state);
   *  anything else (old CLI, timeout, error) = unknown → the manual "연결했어요"
   *  button. Absent = no documented status command → manual button only. */
  status?: CliStatusSpec;
}

export interface CliStatusSpec {
  /** Arguments after the binary, e.g. ['auth', 'status']. Trusted constants. */
  args: string[];
  /** Exit codes the docs say mean "not signed in" (may be empty). */
  loggedOutCodes: number[];
  /** Official page the command and its exit codes were read from. */
  sourceUrl: string;
  /** Date (YYYY-MM-DD) the source was read. */
  checked: string;
}

export interface CliConnector extends ConnectorBase {
  kind: 'cli';
  /** The agentProvider preset this connector wraps. */
  provider: AgentProvider;
  needsKey: false;
  /** Verified sign-in flow; absent = not verified (UI falls back to docsUrl). */
  login?: CliLoginSpec;
}

export interface ApiConnector extends ConnectorBase {
  kind: 'api';
  needsKey: true;
  /** Placeholder shown in the write-only key field (format hint, not a secret). */
  keyFormatHint: string;
  /** Official https page where a person creates this service's API key. Only set
   *  when read from the service's own docs; otherwise the UI links docsUrl. */
  keyUrl?: string;
  /** 'models' = the settings card offers a "연결 테스트" that GETs {endpoint}/models. */
  connectionTest?: 'models';
  api: ApiConnectorConfig;
}

export interface UnavailableConnector extends ConnectorBase {
  kind: 'unavailable';
  needsKey: false;
  /** Why it can't be connected — shown in the UI as "연결 불가, 이유: …". */
  reason: { ko: string; en: string };
}

export type Connector = CliConnector | ApiConnector | UnavailableConnector;
