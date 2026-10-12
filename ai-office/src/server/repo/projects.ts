import { randomUUID } from 'node:crypto';
import type { Db } from '../db.js';
import { conflict, notFound } from '../errors.js';
import { OPEN_STATUSES } from '../../shared/taskStateMachine.js';
import type { Project, ProjectStatus, ProjectWithStats } from '../../shared/types.js';

interface ProjectRow {
  id: string;
  name: string;
  description: string;
  workspace_path: string | null;
  status: ProjectStatus;
  created_at: string;
  updated_at: string;
  task_count?: number;
  open_task_count?: number;
}

const toProject = (r: ProjectRow): Project => ({
  id: r.id,
  name: r.name,
  description: r.description,
  workspacePath: r.workspace_path,
  status: r.status,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const openList = OPEN_STATUSES.map((s) => `'${s}'`).join(',');

export function listProjects(db: Db, status?: ProjectStatus): ProjectWithStats[] {
  const rows = db
    .prepare(
      `SELECT p.*,
              COUNT(t.id) AS task_count,
              COALESCE(SUM(CASE WHEN t.status IN (${openList}) THEN 1 ELSE 0 END), 0) AS open_task_count
         FROM projects p
         LEFT JOIN tasks t ON t.project_id = p.id
        WHERE (? IS NULL OR p.status = ?)
        GROUP BY p.id
        ORDER BY p.status ASC, p.created_at DESC`,
    )
    .all(status ?? null, status ?? null) as unknown as ProjectRow[];
  return rows.map((r) => ({ ...toProject(r), taskCount: r.task_count ?? 0, openTaskCount: r.open_task_count ?? 0 }));
}

export function getProject(db: Db, id: string): Project {
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as unknown as ProjectRow | undefined;
  if (!row) throw notFound('프로젝트');
  return toProject(row);
}

export interface CreateProjectInput {
  name: string;
  description?: string;
  workspacePath?: string | null;
}

function assertNameFree(db: Db, name: string, exceptId?: string): void {
  const dup = db
    .prepare('SELECT id FROM projects WHERE name = ? COLLATE NOCASE AND id != ?')
    .get(name, exceptId ?? '') as { id: string } | undefined;
  if (dup) throw conflict(`같은 이름의 프로젝트가 이미 있습니다: ${name}`);
}

export function createProject(db: Db, input: CreateProjectInput): Project {
  const name = input.name.trim();
  assertNameFree(db, name);
  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO projects (id, name, description, workspace_path, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'active', ?, ?)`,
  ).run(id, name, input.description?.trim() ?? '', input.workspacePath?.trim() || null, now, now);
  return getProject(db, id);
}

export interface UpdateProjectInput {
  name?: string;
  description?: string;
  workspacePath?: string | null;
  status?: ProjectStatus;
}

export function updateProject(db: Db, id: string, input: UpdateProjectInput): Project {
  const current = getProject(db, id);
  const name = input.name !== undefined ? input.name.trim() : current.name;
  if (name !== current.name) assertNameFree(db, name, id);
  const description = input.description !== undefined ? input.description.trim() : current.description;
  const workspacePath =
    input.workspacePath !== undefined ? input.workspacePath?.trim() || null : current.workspacePath;
  const status = input.status ?? current.status;
  db.prepare(
    `UPDATE projects SET name = ?, description = ?, workspace_path = ?, status = ?, updated_at = ? WHERE id = ?`,
  ).run(name, description, workspacePath, status, new Date().toISOString(), id);
  return getProject(db, id);
}

export function countActiveProjects(db: Db): number {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM projects WHERE status = 'active'`).get() as { n: number };
  return row.n;
}
