/**
 * Workspace view (#6) — pure helpers: which status word and dot an agent gets,
 * and the order agents are listed in the workspace sidebar.
 *
 * Structural types only (no store/react import) so node:test can load it.
 */

/** The status words the workspace shows. Keys under `extra.workspace.status.*`. */
export type WorkspaceStatusWord =
  | 'working' | 'thinking' | 'needsYou' | 'waiting' | 'compacting' | 'looping'
  | 'idle' | 'done' | 'offline';

export interface WorkspaceAgentLike {
  id: string;
  status: string;
  ptyId?: string;
  isGod?: boolean;
  isAssistant?: boolean;
  archived?: boolean;
}

/**
 * Map an agent's live status to one workspace status word. An agent without a
 * running terminal is `offline` whatever its last status said — a dot must
 * never claim work that isn't happening.
 */
export function workspaceStatusWord(a: Pick<WorkspaceAgentLike, 'status' | 'ptyId'>): WorkspaceStatusWord {
  if (!a.ptyId) return 'offline';
  switch (a.status) {
    case 'working': return 'working';
    case 'thinking': return 'thinking';
    case 'blocked': return 'needsYou';
    case 'waiting': return 'waiting';
    case 'compacting': return 'compacting';
    case 'looping': return 'looping';
    case 'success': return 'done';
    case 'ghost': return 'offline';
    // 'typing' is the USER's draft holding the queue; the agent itself is idle.
    default: return 'idle';
  }
}

/** CSS colour token for the status dot (reuses the badge palette). */
export function workspaceStatusColor(w: WorkspaceStatusWord): string {
  switch (w) {
    case 'working': return 'var(--cth-status-working)';
    case 'thinking': return 'var(--cth-status-thinking)';
    case 'needsYou': return 'var(--cth-status-blocked)';
    case 'waiting': return 'var(--cth-status-waiting)';
    case 'compacting': return 'var(--cth-status-compacting)';
    case 'looping': return 'var(--cth-status-looping)';
    case 'done': return 'var(--cth-status-success)';
    case 'offline': return 'var(--cth-status-ghost)';
    default: return 'var(--cth-status-idle)';
  }
}

/** True for words that should pulse (the agent is actively doing something). */
export function workspaceStatusLive(w: WorkspaceStatusWord): boolean {
  return w === 'working' || w === 'thinking' || w === 'compacting';
}

/**
 * Sidebar order: the orchestrator first, its assistant next, then everyone else
 * in the user's own roster order (drag order from the agent strip). Archived
 * agents are left out. Deliberately NOT sorted by status: rows that jump around
 * every time an agent starts or stops working are impossible to click.
 */
export function orderWorkspaceAgents<T extends WorkspaceAgentLike>(agents: readonly T[]): T[] {
  const live = agents.filter((a) => !a.archived);
  const rank = (a: T): number => (a.isGod ? 0 : a.isAssistant ? 1 : 2);
  return live
    .map((a, i) => ({ a, i }))
    .sort((x, y) => rank(x.a) - rank(y.a) || x.i - y.i)
    .map((x) => x.a);
}

/** How many agents are waiting on the user (drives the inbox badge). */
export function countNeedsYou(agents: readonly WorkspaceAgentLike[]): number {
  return agents.filter((a) => !a.archived && workspaceStatusWord(a) === 'needsYou').length;
}

export type WorkspaceLayout = 'classic' | 'workspace';

export function parseWorkspaceLayout(v: unknown): WorkspaceLayout {
  return v === 'workspace' ? 'workspace' : 'classic';
}
