/**
 * API-agent spawn rewrite (main process).
 *
 * An API agent is hired with the sentinel command `son-api <connectorId>
 * [--model <id>]` (see src/shared/connectors). spawnAgentCore calls
 * prepareApiAgentSpawn() before anything else touches the command; when the
 * sentinel matches, the spawn becomes
 *
 *   <process.execPath> <resources>/api-agent.cjs --connector <id> [--model <id>]
 *
 * with ELECTRON_RUN_AS_NODE=1, so no system Node install is needed. The decrypted
 * key is placed ONLY in the child's env (SON_API_KEY); it is not added to argv
 * (visible in process listings), not logged, and not returned to the renderer.
 * Electron-free apart from the injected paths, so it is unit-testable.
 */
import { isAbsolute } from 'node:path';
import { effectiveEndpoint, parseApiAgentCommand, type ApiConnector } from '../shared/connectors';

export interface ApiAgentSpawn {
  command: string;
  args: string[];
  env: Record<string, string>;
  connector: ApiConnector;
}

export function prepareApiAgentSpawn(
  command: string,
  args: readonly string[] | undefined,
  deps: {
    execPath: string;
    scriptPath: string;
    getKey: (connectorId: string) => string | undefined;
    /** The user's saved endpoint override (HarnessConfig.connectorEndpoints). Only
     *  honored for connectors with `editableEndpoint`, and only when it validates. */
    getEndpoint?: (connectorId: string) => string | undefined;
    /** Absolute path of the local usage log (userData/api-usage.jsonl). The child
     *  appends one {ts, connector, ok, status} line per request — never prompt,
     *  reply or key (see src/shared/connectorUsage.ts). */
    usageLogPath?: string;
  }
): null | { error: string } | ApiAgentSpawn {
  const parsed = parseApiAgentCommand(command, args ?? []);
  if (!parsed || 'error' in parsed) return parsed;
  const { connector, model } = parsed;
  const key = deps.getKey(connector.id);
  const endpoint = effectiveEndpoint(connector, deps.getEndpoint?.(connector.id));
  const config = { id: connector.id, label: connector.label, ...connector.api, endpoint };
  const env: Record<string, string> = {
    ELECTRON_RUN_AS_NODE: '1',
    SON_API_CONNECTOR: JSON.stringify(config),
    // Neutralize any inherited override so a real key can only go to the
    // connector's own documented endpoint.
    SON_API_BASE_URL: ''
  };
  if (key) env.SON_API_KEY = key;
  if (deps.usageLogPath && isAbsolute(deps.usageLogPath)) env.SON_API_USAGE_LOG = deps.usageLogPath;
  return {
    command: deps.execPath,
    args: [deps.scriptPath, '--connector', connector.id, ...(model ? ['--model', model] : [])],
    env,
    connector
  };
}
