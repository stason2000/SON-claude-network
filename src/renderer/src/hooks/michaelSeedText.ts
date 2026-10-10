/**
 * Renderer glue for Michael's rules seed: probe what is really connected
 * (CLI binaries via the same `tools:status` probe onboarding uses, API keys via
 * the write-only `has` channel), resolve the departments, read the user's
 * rules file, and build the text (all logic lives in src/shared, pure).
 */
import { listConnectors } from '@shared/connectors';
import { classifyEngineAvailability } from '@shared/engineAvailability';
import { resolveAllDepartments, type AvailabilityMap, type DepartmentsConfig } from '@shared/departments';
import { buildMichaelSeed } from '@shared/michaelSeed';

export async function loadConnectorAvailability(): Promise<AvailabilityMap> {
  const out: AvailabilityMap = {};
  let statuses: Awaited<ReturnType<typeof window.cth.toolsStatus>> | undefined;
  try { statuses = await window.cth.toolsStatus(); } catch { statuses = undefined; }
  for (const c of listConnectors()) {
    if (c.kind === 'cli') {
      out[c.id] = { installed: classifyEngineAvailability(statuses, c.provider).state === 'installed' };
    } else if (c.kind === 'api') {
      let has = false;
      try { has = await window.cth.connectorKeyHas(c.id); } catch { has = false; }
      out[c.id] = { apiKeyPresent: has };
    }
  }
  return out;
}

/** Never throws: on any failure Michael still gets the department table. */
export async function buildMichaelSeedText(departments: DepartmentsConfig | undefined): Promise<string> {
  const availability = await loadConnectorAvailability();
  let rulesText: string | null = null;
  let rulesPath: string | undefined;
  try {
    const r = await window.cth.michaelRulesGet();
    if (r.ok) { rulesText = r.text; rulesPath = r.path; }
  } catch { /* seed without the rules body */ }
  return buildMichaelSeed({ rulesText, rulesPath, departments: resolveAllDepartments(availability, departments) });
}
