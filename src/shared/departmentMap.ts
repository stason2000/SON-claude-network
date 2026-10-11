/**
 * Team map ("팀 지도") — pure helpers behind the smooth org-chart view that
 * replaced the pixel office as the default main view.
 *
 *   departmentForAgent   which department panel an AI 직원 sits in
 *   groupAgentsByDepartment
 *   lineStateFor         how the leader→room path / door looks (idle · active · alert)
 *   (room geometry lives in ./floorPlan.ts)
 *
 * Department rule (first match wins — documented for the user in STATUS.md):
 *   0. the god (Michael) is never in a panel; his prep assistant (isAssistant) → 기타.
 *   1. ROLE words in the agent's description/name ("검토", "리서치", "이미지",
 *      "코딩", English equivalents …) — what the user hired it FOR beats its engine.
 *      Checked in the order 검토 → 이미지·영상 → 리서치·자료 → 코딩 so "코드 검토"
 *      lands in 검토.
 *   2. The connector (CLI provider, or the API connector of a `son-api <id>`
 *      command) appears in a department's preference list (user's config, else
 *      departments.ts defaults): the department where it ranks highest; ties go to
 *      the first in DEPARTMENTS order (코딩, 리서치·자료, 이미지·영상, 검토).
 *      e.g. Claude/Codex → 코딩, Gemini/Grok/Perplexity → 리서치·자료, Higgsfield → 이미지·영상.
 *   3. The connector's strengths (connectors/*.ts) fit a department → the first one.
 *   4. Otherwise → 'other' (기타): Custom commands, general-purpose routers
 *      (FreeLLMAPI, OpenRouter) …
 *
 * Dependency-free apart from the shared registries, so node --test can load it.
 */
import { inferAgentProvider } from './agentProvider';
import { apiConnectorIdForCommand, getConnector } from './connectors';
import { DEPARTMENTS, preferredFor, type DepartmentId, type DepartmentsConfig } from './departments';

export type MapDepartmentId = DepartmentId | 'other';

export const MAP_DEPARTMENT_IDS: readonly MapDepartmentId[] = [...DEPARTMENTS.map((d) => d.id), 'other'];

export interface MapAgentLike {
  id: string;
  name?: string;
  description?: string;
  provider?: string | null;
  command?: string | null;
  status?: string;
  isGod?: boolean;
  isAssistant?: boolean;
}

/** The connector id that runs this agent: `son-api <id>` → that API connector,
 *  else the CLI provider (inferred from the command for legacy agents). */
export function connectorIdForAgent(a: Pick<MapAgentLike, 'provider' | 'command'>): string {
  const api = apiConnectorIdForCommand(a.command ?? undefined);
  if (api) return api;
  return inferAgentProvider(a.command ?? undefined, a.provider ?? undefined);
}

/** Role words per department, checked in this order. Lower-case; Korean has no case. */
const ROLE_WORDS: ReadonlyArray<[DepartmentId, readonly string[]]> = [
  ['review', ['검토', '리뷰', '감수', '검수', 'review', 'reviewer', 'qa', 'audit']],
  ['media', ['이미지', '영상', '사진', '그림', '디자인', '썸네일', '동영상', 'image', 'video', 'photo', 'design', 'thumbnail']],
  ['research', ['리서치', '조사', '자료', '검색', '분석', 'research', 'search', 'analyst', 'analysis']],
  ['coding', ['코딩', '개발', '프로그래', '코드', 'coding', 'coder', 'developer', 'engineer', 'code']]
];

function roleDepartment(text: string): DepartmentId | null {
  const s = text.toLowerCase();
  if (!s.trim()) return null;
  for (const [id, words] of ROLE_WORDS) {
    for (const w of words) {
      // ASCII words must stand alone ("qa" must not match "aqua"); Korean stems match inside words.
      if (/^[a-z]+$/.test(w)) {
        if (new RegExp(`(^|[^a-z])${w}([^a-z]|$)`).test(s)) return id;
      } else if (s.includes(w)) return id;
    }
  }
  return null;
}

/** Which panel an agent belongs in. Pure — see the rule in the header. */
export function departmentForAgent(a: MapAgentLike, cfg?: DepartmentsConfig): MapDepartmentId {
  if (a.isAssistant) return 'other';
  const byRole = roleDepartment(`${a.description ?? ''} ${a.name ?? ''}`);
  if (byRole) return byRole;
  const cid = connectorIdForAgent(a);
  let best: DepartmentId | null = null;
  let bestRank = Infinity;
  for (const d of DEPARTMENTS) {
    const rank = preferredFor(d, cfg).indexOf(cid);
    if (rank >= 0 && rank < bestRank) { best = d.id; bestRank = rank; }
  }
  if (best) return best;
  const c = getConnector(cid);
  if (c) {
    for (const d of DEPARTMENTS) if (c.strengths.some((s) => d.strengths.includes(s))) return d.id;
  }
  return 'other';
}

/** Non-god agents grouped by panel, keeping roster order. Every id is present. */
export function groupAgentsByDepartment<A extends MapAgentLike>(agents: readonly A[], cfg?: DepartmentsConfig): Record<MapDepartmentId, A[]> {
  const out = Object.fromEntries(MAP_DEPARTMENT_IDS.map((id) => [id, [] as A[]])) as unknown as Record<MapDepartmentId, A[]>;
  for (const a of agents) {
    if (a.isGod) continue;
    out[departmentForAgent(a, cfg)].push(a);
  }
  return out;
}

export type LineState = 'idle' | 'active' | 'alert';

/** Statuses that mean "busy right now" (the line animates). */
const ACTIVE = new Set(['working', 'thinking', 'compacting', 'looping']);

/** alert = someone in the department needs the user (status 'blocked', shown as "알림");
 *  active = someone is working; else idle. */
export function lineStateFor(statuses: readonly (string | undefined)[]): LineState {
  let active = false;
  for (const s of statuses) {
    if (s === 'blocked') return 'alert';
    if (s && ACTIVE.has(s)) active = true;
  }
  return active ? 'active' : 'idle';
}
