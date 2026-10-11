/**
 * "AI 연결" window logic: which AIs still need connecting.
 *
 * Connected means:
 *  - 'api' connector  → an encrypted key is stored (main's `has`, a boolean).
 *  - 'cli' connector  → there is no generic way to read a CLI's login, so:
 *       1. a documented read-only status command said so (cliCheck 'connected'),
 *          and its "signed out" answer ('not-connected') also wins over the flag;
 *       2. otherwise the person pressed "연결했어요" (cliConnected[id] === true,
 *          a non-secret per-machine flag in HarnessConfig.cliConnected);
 *       a CLI that is not installed is never connected.
 *  - 'unavailable'    → never listed.
 *
 * Shared + dependency-free so it is unit-testable under plain node.
 */
import type { Connector } from './types';

/** Main's answer for a CLI: what the status command / binary lookup found. */
export type CliCheckState = 'connected' | 'not-connected' | 'unknown' | 'not-installed';

export interface CliCheckResult {
  state: CliCheckState;
  /** true = a documented status command was actually run (auto-detection). */
  auto: boolean;
}

export interface ConnectionInputs {
  hasKey: Readonly<Record<string, boolean | undefined>>;
  cliConnected: Readonly<Record<string, boolean | undefined>>;
  cliCheck: Readonly<Record<string, CliCheckResult | undefined>>;
}

/** Only CLI and API connectors can be connected from the window. */
export function isConnectable(c: Connector): boolean {
  return c.kind === 'cli' || c.kind === 'api';
}

export function isConnectorConnected(c: Connector, inputs: ConnectionInputs): boolean {
  if (c.kind === 'api') return inputs.hasKey[c.id] === true;
  if (c.kind !== 'cli') return false;
  const check = inputs.cliCheck[c.id];
  if (check?.state === 'connected') return true;
  if (check?.state === 'not-connected' || check?.state === 'not-installed') return false;
  return inputs.cliConnected[c.id] === true;
}

/** How the connected state was decided (for the read-only "연결된 AI" list). */
export type ConnectedVia = 'key' | 'auto' | 'manual';
export function connectedVia(c: Connector, inputs: ConnectionInputs): ConnectedVia | null {
  if (!isConnectorConnected(c, inputs)) return null;
  if (c.kind === 'api') return 'key';
  return inputs.cliCheck[c.id]?.state === 'connected' ? 'auto' : 'manual';
}

/** Split the connectable connectors into still-to-connect and connected, keeping registry order. */
export function splitConnections(
  connectors: readonly Connector[],
  inputs: ConnectionInputs
): { pending: Connector[]; connected: Connector[] } {
  const pending: Connector[] = [];
  const connected: Connector[] = [];
  for (const c of connectors) {
    if (!isConnectable(c)) continue;
    (isConnectorConnected(c, inputs) ? connected : pending).push(c);
  }
  return { pending, connected };
}

export function pendingConnectionCount(connectors: readonly Connector[], inputs: ConnectionInputs): number {
  return splitConnections(connectors, inputs).pending.length;
}

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** Keep only `{cliConnectorId: true}` pairs for registered CLI connectors. */
export function sanitizeCliConnected(
  input: unknown,
  isCliConnector: (id: string) => boolean
): Record<string, true> {
  const out: Record<string, true> = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
  for (const [id, v] of Object.entries(input as Record<string, unknown>)) {
    if (v === true && ID_RE.test(id) && isCliConnector(id)) out[id] = true;
  }
  return out;
}
