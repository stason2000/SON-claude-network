/**
 * Departments — which AI (connector) each of Michael's departments uses.
 *
 * Defaults come from the user's operating rules (resources/michael-rules.default.ko.md §1):
 *   코딩         Claude Code → Codex
 *   리서치·자료   Gemini CLI / Grok → Codex, Perplexity API
 *   이미지·영상   Higgsfield (API), CapCut (unavailable — no official automation)
 *   검토         Claude Code → Codex
 *
 * `resolveDepartment` is PURE: given what is actually connected on this machine
 * (CLI binary found on PATH, API key stored), it picks the first usable connector
 * in preference order, or reports 'connect-needed'. It never pretends: an
 * 'unavailable' connector is never selected, a CLI is only "ok" when its binary
 * was found, an API connector only when a key is stored.
 *
 * Caveat: "installed" means the binary resolves on PATH. Whether the user is
 * LOGGED IN to that CLI is not something the app can probe; the first run tells.
 *
 * Shared between main and renderer; dependency-free apart from the registry.
 */
import { getConnector, type Connector, type ConnectorStrength } from './connectors';

export type DepartmentId = 'coding' | 'research' | 'media' | 'review';

export const DEPARTMENT_IDS: readonly DepartmentId[] = ['coding', 'research', 'media', 'review'];

export interface DepartmentSpec {
  id: DepartmentId;
  /** Korean display name (also used in Michael's seed text). */
  labelKo: string;
  /** Connector strengths that fit this department (UI dropdown filter). */
  strengths: ConnectorStrength[];
  /** Default ordered preference (first = primary). */
  defaultPreferred: string[];
}

export const DEPARTMENTS: readonly DepartmentSpec[] = [
  { id: 'coding', labelKo: '코딩', strengths: ['coding'], defaultPreferred: ['claude', 'codex'] },
  { id: 'research', labelKo: '리서치·자료', strengths: ['research'], defaultPreferred: ['gemini', 'grok', 'codex', 'perplexity'] },
  { id: 'media', labelKo: '이미지·영상', strengths: ['image', 'video'], defaultPreferred: ['higgsfield', 'capcut'] },
  { id: 'review', labelKo: '검토', strengths: ['review'], defaultPreferred: ['claude', 'codex'] }
];

/** Persisted shape (HarnessConfig.departments): department id → ordered connector ids. */
export type DepartmentsConfig = Partial<Record<DepartmentId, string[]>>;

export function departmentSpec(id: DepartmentId): DepartmentSpec {
  return DEPARTMENTS.find((d) => d.id === id)!;
}

/** Connectors that may be chosen for a department: strengths fit, or the
 *  user's rules list them by default (e.g. Codex for research). */
export function connectorFitsDepartment(c: Connector, dept: DepartmentSpec): boolean {
  return c.strengths.some((s) => dept.strengths.includes(s)) || dept.defaultPreferred.includes(c.id);
}

/** Drop unknown ids, non-fitting connectors, duplicates; cap at 4. Pure. */
export function sanitizePreferred(dept: DepartmentSpec, ids: unknown): string[] {
  if (!Array.isArray(ids)) return [...dept.defaultPreferred];
  const out: string[] = [];
  for (const id of ids) {
    if (typeof id !== 'string' || out.includes(id)) continue;
    const c = getConnector(id);
    if (!c || !connectorFitsDepartment(c, dept)) continue;
    out.push(id);
    if (out.length >= 4) break;
  }
  return out;
}

/** Sanitize a whole departments config coming from the renderer. Unknown
 *  department keys are dropped. Returns undefined for a non-object. */
export function sanitizeDepartmentsConfig(raw: unknown): DepartmentsConfig | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: DepartmentsConfig = {};
  for (const d of DEPARTMENTS) {
    const v = (raw as Record<string, unknown>)[d.id];
    if (v !== undefined) out[d.id] = sanitizePreferred(d, v);
  }
  return out;
}

/** Effective preference list for a department (config override or default). */
export function preferredFor(dept: DepartmentSpec, cfg: DepartmentsConfig | undefined): string[] {
  const v = cfg?.[dept.id];
  return v && v.length ? sanitizePreferred(dept, v) : [...dept.defaultPreferred];
}

export interface ConnectorAvailability {
  /** CLI binary found on this machine. */
  installed?: boolean;
  /** API key stored for this connector. */
  apiKeyPresent?: boolean;
}

/** connector id → what is known about it on this machine. */
export type AvailabilityMap = Record<string, ConnectorAvailability | undefined>;

export interface DepartmentResolution {
  connectorId: string | null;
  status: 'ok' | 'connect-needed';
  /** Short Korean reason (shown in the UI and Michael's seed). */
  reason: string;
}

/** Is this one connector usable right now? Returns a Korean reason when not. */
export function connectorUsable(c: Connector, a: ConnectorAvailability | undefined): { ok: boolean; why: string } {
  if (c.kind === 'unavailable') return { ok: false, why: `${c.label}: 연결 불가(공식 자동 실행 방법 없음)` };
  if (c.kind === 'cli') return a?.installed ? { ok: true, why: '' } : { ok: false, why: `${c.label}: 설치 안 됨` };
  return a?.apiKeyPresent ? { ok: true, why: '' } : { ok: false, why: `${c.label}: API 키 없음` };
}

/** Pick the first usable connector for a department. Pure. */
export function resolveDepartment(
  dept: DepartmentSpec,
  availability: AvailabilityMap,
  cfg?: DepartmentsConfig
): DepartmentResolution {
  const prefs = preferredFor(dept, cfg);
  const missing: string[] = [];
  for (let i = 0; i < prefs.length; i++) {
    const c = getConnector(prefs[i]);
    if (!c) continue;
    const u = connectorUsable(c, availability[c.id]);
    if (u.ok) {
      const reason = i === 0 ? '1순위 연결됨' : `1순위 대신 대체 사용 (${missing.join(', ')})`;
      return { connectorId: c.id, status: 'ok', reason };
    }
    missing.push(u.why);
  }
  return {
    connectorId: null,
    status: 'connect-needed',
    reason: missing.length ? missing.join(', ') : '담당 AI가 지정되지 않음'
  };
}

export function resolveAllDepartments(
  availability: AvailabilityMap,
  cfg?: DepartmentsConfig
): Array<{ dept: DepartmentSpec; res: DepartmentResolution }> {
  return DEPARTMENTS.map((dept) => ({ dept, res: resolveDepartment(dept, availability, cfg) }));
}

/** The department table as Korean text for Michael's seed. One line per department. */
export function formatDepartmentTable(rows: Array<{ dept: DepartmentSpec; res: DepartmentResolution }>): string {
  return rows
    .map(({ dept, res }) => {
      if (res.status === 'ok') {
        const label = getConnector(res.connectorId!)?.label ?? res.connectorId;
        return `- ${dept.labelKo}: ${label} (연결됨${res.reason === '1순위 연결됨' ? '' : ` — ${res.reason}`})`;
      }
      return `- ${dept.labelKo}: 연결 필요 — ${res.reason}. 이 부서 일은 맡기지 말고 사용자에게 "연결 필요"라고 알려라.`;
    })
    .join('\n');
}
