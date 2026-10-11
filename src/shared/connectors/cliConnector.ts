/**
 * Helper for 'cli' connectors: a CLI connector is a thin metadata wrapper around
 * an EXISTING preset in ../agentProvider.ts, looked up by id. The preset keeps
 * owning every spawn detail (binary, flags, hooks, resume); the connector only adds
 * strengths + verified docs. To add a brand-new CLI: add its preset to
 * agentProvider.ts (spawn behavior), then one connector file calling this.
 */
import { providerPreset, type AgentProvider } from '../agentProvider';
import type { CliConnector, CliLoginSpec, ConnectorStrength } from './types';

export function cliConnector(
  provider: AgentProvider,
  meta: {
    id?: string; strengths: ConnectorStrength[]; docsUrl?: string; verified: boolean; verifiedNote?: string; label?: string;
    login?: CliLoginSpec;
  }
): CliConnector {
  const preset = providerPreset(provider);
  return {
    id: meta.id ?? provider,
    label: meta.label ?? preset.label,
    kind: 'cli',
    provider,
    needsKey: false,
    strengths: meta.strengths,
    docsUrl: meta.docsUrl ?? preset.docsUrl,
    verified: meta.verified,
    verifiedNote: meta.verifiedNote,
    ...(meta.login ? { login: meta.login } : {})
  };
}
