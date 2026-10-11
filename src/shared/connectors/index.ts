/**
 * Connector registry — every AI this app can talk to, in one list.
 *
 * ── ADDING A NEW AI = ONE FILE + ONE LINE ──────────────────────────────────────
 *   1. Create `src/shared/connectors/<id>.ts` that default-exports a Connector:
 *        - CLI agent:   `export default cliConnector('<preset id>', { strengths, docsUrl, verified })`
 *                       (a brand-new CLI also needs its spawn preset in ../agentProvider.ts).
 *        - API service: an `ApiConnector` with `api: { protocol, endpoint, model, authScheme }`.
 *                       No main/renderer change: the key field, the encrypted key store,
 *                       and `son-api <id>` hiring all key off this registry.
 *        - GUI-only:    an `UnavailableConnector` with a Korean + English `reason`.
 *   2. Import it below and add it to CONNECTORS.
 *   Set `verified: true` ONLY after reading the service's official docs.
 * ───────────────────────────────────────────────────────────────────────────────
 *
 * Shared between main and renderer; dependency-free (no electron, no node APIs).
 */
import type { AgentProvider } from '../agentProvider';
import type { ApiConnector, Connector, ConnectorKind, ConnectorStrength } from './types';
import { validateConnectorEndpoint } from './endpoint';

import claude from './claude';
import codex from './codex';
import gemini from './gemini';
import grok from './grok';
import cursor from './cursor';
import qwen from './qwen';
import opencode from './opencode';
import antigravity from './antigravity';
import kimi from './kimi';
import crush from './crush';
import pi from './pi';
import copilot from './copilot';
import openai from './openai';
import perplexity from './perplexity';
import higgsfield from './higgsfield';
import freellmapi from './freellmapi';
import openrouter from './openrouter';
import capcut from './capcut';

export * from './types';
export { cliConnector } from './cliConnector';
export * from './endpoint';

export const CONNECTORS: readonly Connector[] = [
  // CLI terminal agents (wrap the agentProvider presets)
  claude,
  codex,
  gemini,
  grok,
  cursor,
  qwen,
  opencode,
  antigravity,
  kimi,
  crush,
  pi,
  copilot,
  // API connectors (key stored encrypted in main; runs via resources/api-agent.cjs)
  openai,
  perplexity,
  higgsfield,
  freellmapi,
  openrouter,
  // Not connectable (no official automatic invocation)
  capcut
];

export function listConnectors(): readonly Connector[] {
  return CONNECTORS;
}

export function getConnector(id: string): Connector | undefined {
  return CONNECTORS.find((c) => c.id === id);
}

export function connectorsByKind<K extends ConnectorKind>(kind: K): Extract<Connector, { kind: K }>[] {
  return CONNECTORS.filter((c): c is Extract<Connector, { kind: K }> => c.kind === kind);
}

export function connectorsWithStrength(strength: ConnectorStrength): Connector[] {
  return CONNECTORS.filter((c) => c.strengths.includes(strength));
}

/** The API connector with this id, or undefined (unknown id / not an API connector). */
export function getApiConnector(id: unknown): ApiConnector | undefined {
  if (typeof id !== 'string') return undefined;
  const c = getConnector(id);
  return c && c.kind === 'api' ? c : undefined;
}

/** The API connector an agent command runs (`son-api <id> …`), or undefined. */
export function apiConnectorIdForCommand(command: string | undefined | null): string | undefined {
  if (typeof command !== 'string') return undefined;
  const parsed = parseApiAgentCommand(command);
  return parsed && !('error' in parsed) ? parsed.connector.id : undefined;
}

/** The runtime endpoint of an API connector: the user's override when the
 *  connector allows one AND it passes validateConnectorEndpoint, else the default. */
export function effectiveEndpoint(connector: ApiConnector, override: unknown): string {
  if (!connector.api.editableEndpoint || override === undefined || override === null || override === '') return connector.api.endpoint;
  const v = validateConnectorEndpoint(override);
  return v.ok ? v.url : connector.api.endpoint;
}

/** Keep only {connectorId: url} pairs for connectors that allow an endpoint
 *  override and whose url validates (normalized). Anything else is dropped. */
export function sanitizeConnectorEndpoints(input: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
  for (const [id, raw] of Object.entries(input as Record<string, unknown>)) {
    const c = getApiConnector(id);
    if (!c || !c.api.editableEndpoint) continue;
    const v = validateConnectorEndpoint(raw);
    if (v.ok) out[id] = v.url;
  }
  return out;
}

/** How a person connects this AI: log in inside its own CLI, paste an API key, or not at all. */
export type ConnectionMethod = 'login' | 'apiKey' | 'unavailable';
export function connectionMethod(c: Connector): ConnectionMethod {
  return c.kind === 'cli' ? 'login' : c.kind === 'api' ? 'apiKey' : 'unavailable';
}

/** The CLI connector wrapping an agentProvider preset, if one is registered. */
export function cliConnectorForProvider(provider: AgentProvider): Connector | undefined {
  return CONNECTORS.find((c) => c.kind === 'cli' && c.provider === provider);
}

// ── API agent hiring ────────────────────────────────────────────────────────────
// An API agent is hired as a 'custom' provider whose command is the sentinel
// `son-api <connectorId> [--model <id>]`. The main process recognizes the sentinel
// before spawning and swaps in `<electron as node> resources/api-agent.cjs
// --connector <id>`, injecting the stored key via env. The sentinel is a plain
// string, so it survives the existing hire/restore/team-recipe flows unchanged.

export const API_AGENT_COMMAND = 'son-api';

export function apiAgentCommand(connectorId: string, model?: string): string {
  return model ? `${API_AGENT_COMMAND} ${connectorId} --model ${model}` : `${API_AGENT_COMMAND} ${connectorId}`;
}

/** Parse a tokenized spawn command. Returns null when it isn't an API-agent
 *  sentinel; `{ error }` when it is but names no known API connector. */
export function parseApiAgentCommand(
  command: string,
  args: readonly string[] = []
): null | { error: string } | { connector: ApiConnector; model?: string } {
  const tokens = command.trim().split(/\s+/).filter(Boolean).concat(args);
  if (tokens[0] !== API_AGENT_COMMAND) return null;
  const id = tokens[1];
  const connector = getApiConnector(id);
  if (!connector) return { error: `unknown API connector: ${String(id ?? '')}` };
  const mi = tokens.indexOf('--model');
  const model = mi > 0 ? tokens[mi + 1] : undefined;
  // A model id is a short identifier/path — reject anything else so argv can't
  // smuggle odd input into the request body.
  if (model !== undefined && !/^[A-Za-z0-9._:/-]{1,128}$/.test(model)) return { error: 'invalid --model value' };
  return { connector, ...(model ? { model } : {}) };
}
