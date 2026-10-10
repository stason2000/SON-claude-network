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
import { parseApiAgentCommand, type ApiConnector } from '../shared/connectors';

export interface ApiAgentSpawn {
  command: string;
  args: string[];
  env: Record<string, string>;
  connector: ApiConnector;
}

export function prepareApiAgentSpawn(
  command: string,
  args: readonly string[] | undefined,
  deps: { execPath: string; scriptPath: string; getKey: (connectorId: string) => string | undefined }
): null | { error: string } | ApiAgentSpawn {
  const parsed = parseApiAgentCommand(command, args ?? []);
  if (!parsed || 'error' in parsed) return parsed;
  const { connector, model } = parsed;
  const key = deps.getKey(connector.id);
  const config = { id: connector.id, label: connector.label, ...connector.api };
  const env: Record<string, string> = {
    ELECTRON_RUN_AS_NODE: '1',
    SON_API_CONNECTOR: JSON.stringify(config),
    // Neutralize any inherited override so a real key can only go to the
    // connector's own documented endpoint.
    SON_API_BASE_URL: ''
  };
  if (key) env.SON_API_KEY = key;
  return {
    command: deps.execPath,
    args: [deps.scriptPath, '--connector', connector.id, ...(model ? ['--model', model] : [])],
    env,
    connector
  };
}
