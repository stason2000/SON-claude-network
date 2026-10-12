import { randomUUID } from 'node:crypto';
import { withTransaction, type Db } from '../db.js';
import { AppError, badRequest, notFound } from '../errors.js';
import { canRetry, canTransition, TERMINAL_STATUSES } from '../../shared/taskStateMachine.js';
import {
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  type Department,
  type Priority,
  type Task,
  type TaskDetail,
  type TaskEvent,
  type TaskEventType,
  type TaskStatus,
} from '../../shared/types.js';

interface TaskRow {
  id: string;
  project_id: string | null;
  project_name: string | null;
  department: Department;
  title: string;
  goal: string;
  priority: Priority;
  status: TaskStatus;
  attempts: number;
  max_attempts: number;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
}

interface EventRow {
  id: number;
  task_id: string;
  task_title?: string;
  at: string;
  type: TaskEventType;
  from_status: TaskStatus | null;
  to_status: TaskStatus | null;
  message: string;
}

const toTask = (r: TaskRow): Task => ({
  id: r.id,
  projectId: r.project_id,
  projectName: r.project_name,
  department: r.department,
  title: r.title,
  goal: r.goal,
  priority: r.priority,
  status: r.status,
  attempts: r.attempts,
  maxAttempts: r.max_attempts,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  startedAt: r.started_at,
  finishedAt: r.finished_at,
});

const toEvent = (r: EventRow): TaskEvent => ({
  id: r.id,
  taskId: r.task_id,
  ...(r.task_title !== undefined ? { taskTitle: r.task_title } : {}),
  at: r.at,
  type: r.type,
  fromStatus: r.from_status,
  toStatus: r.to_status,
  message: r.message,
});

const SELECT_TASK = `SELECT t.*, p.name AS project_name FROM tasks t LEFT JOIN projects p ON p.id = t.project_id`;

function addEvent(
  db: Db,
  taskId: string,
  type: TaskEventType,
  fromStatus: TaskStatus | null,
  toStatus: TaskStatus | null,
  message: string,
): void {
  db.prepare(
    `INSERT INTO task_events (task_id, at, type, from_status, to_status, message) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(taskId, new Date().toISOString(), type, fromStatus, toStatus, message);
}

export interface TaskFilter {
  status?: TaskStatus;
  department?: Department;
  projectId?: string;
  limit: number;
  offset: number;
}

export function listTasks(db: Db, f: TaskFilter): { items: Task[]; total: number } {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (f.status) (where.push('t.status = ?'), params.push(f.status));
  if (f.department) (where.push('t.department = ?'), params.push(f.department));
  if (f.projectId) (where.push('t.project_id = ?'), params.push(f.projectId));
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM tasks t ${clause}`).get(...params) as { n: number }).n;
  const rows = db
    .prepare(`${SELECT_TASK} ${clause} ORDER BY t.created_at DESC, t.rowid DESC LIMIT ? OFFSET ?`)
    .all(...params, f.limit, f.offset) as unknown as TaskRow[];
  return { items: rows.map(toTask), total };
}

function getTaskRow(db: Db, id: string): TaskRow {
  const row = db.prepare(`${SELECT_TASK} WHERE t.id = ?`).get(id) as unknown as TaskRow | undefined;
  if (!row) throw notFound('작업');
  return row;
}

export function getTask(db: Db, id: string): TaskDetail {
  const task = toTask(getTaskRow(db, id));
  const events = db
    .prepare('SELECT * FROM task_events WHERE task_id = ? ORDER BY id ASC')
    .all(id) as unknown as EventRow[];
  return { ...task, events: events.map(toEvent) };
}

export interface CreateTaskInput {
  title?: string;
  goal: string;
  department: Department;
  projectId?: string | null;
  priority?: Priority;
  maxAttempts?: number;
}

const deriveTitle = (goal: string) => {
  const line = goal.trim().split(/\r?\n/)[0] ?? '';
  return line.length > 80 ? `${line.slice(0, 77)}...` : line;
};

export function createTask(db: Db, input: CreateTaskInput): TaskDetail {
  return withTransaction(db, () => {
    const goal = input.goal.trim();
    if (!goal) throw badRequest('작업 목표를 입력하세요.');
    if (input.projectId) {
      const p = db.prepare('SELECT status FROM projects WHERE id = ?').get(input.projectId) as
        | { status: string }
        | undefined;
      if (!p) throw notFound('프로젝트');
      if (p.status === 'archived') throw badRequest('보관된 프로젝트에는 새 작업을 만들 수 없습니다.');
    }
    const now = new Date().toISOString();
    const id = randomUUID();
    db.prepare(
      `INSERT INTO tasks (id, project_id, department, title, goal, priority, status, attempts, max_attempts, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'queued', 0, ?, ?, ?)`,
    ).run(
      id,
      input.projectId ?? null,
      input.department,
      input.title?.trim() || deriveTitle(goal),
      goal,
      input.priority ?? 'normal',
      input.maxAttempts ?? 3,
      now,
      now,
    );
    addEvent(db, id, 'created', null, 'queued', '작업이 등록되었습니다.');
    return getTask(db, id);
  });
}

/**
 * 작업 상태를 전이합니다. 규칙은 shared/taskStateMachine.ts 에 있고, 여기서는
 * 규칙 검증 + 부수효과(시각·시도 횟수 기록) + 이벤트 기록을 하나의 트랜잭션으로 처리합니다.
 */
export function transitionTask(db: Db, id: string, to: TaskStatus, message = ''): TaskDetail {
  if (!TASK_STATUSES.includes(to)) throw badRequest(`알 수 없는 상태입니다: ${to}`);
  return withTransaction(db, () => {
    const row = getTaskRow(db, id);
    const from = row.status;
    if (!canTransition(from, to)) {
      throw new AppError(
        409,
        'invalid_transition',
        `'${TASK_STATUS_LABELS[from]}' 상태에서 '${TASK_STATUS_LABELS[to]}' 상태로 바꿀 수 없습니다.`,
      );
    }
    if (from === 'failed' && to === 'queued' && !canRetry(row.attempts, row.max_attempts)) {
      throw new AppError(
        409,
        'retry_limit',
        `최대 시도 횟수(${row.max_attempts}회)에 도달해 더 이상 재시도할 수 없습니다.`,
      );
    }
    const now = new Date().toISOString();
    const attempts = to === 'running' ? row.attempts + 1 : row.attempts;
    const startedAt = to === 'running' && !row.started_at ? now : row.started_at;
    const finishedAt = TERMINAL_STATUSES.includes(to) || to === 'failed' ? now : to === 'queued' ? null : row.finished_at;
    db.prepare(
      `UPDATE tasks SET status = ?, attempts = ?, started_at = ?, finished_at = ?, updated_at = ? WHERE id = ?`,
    ).run(to, attempts, startedAt, finishedAt, now, id);
    addEvent(db, id, 'status_changed', from, to, message);
    return getTask(db, id);
  });
}

export function addTaskNote(db: Db, id: string, message: string): TaskDetail {
  return withTransaction(db, () => {
    getTaskRow(db, id);
    addEvent(db, id, 'note', null, null, message);
    db.prepare('UPDATE tasks SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), id);
    return getTask(db, id);
  });
}

export function listEvents(db: Db, limit: number, offset: number): { items: TaskEvent[]; total: number } {
  const total = (db.prepare('SELECT COUNT(*) AS n FROM task_events').get() as { n: number }).n;
  const rows = db
    .prepare(
      `SELECT e.*, t.title AS task_title FROM task_events e JOIN tasks t ON t.id = e.task_id
        ORDER BY e.id DESC LIMIT ? OFFSET ?`,
    )
    .all(limit, offset) as unknown as EventRow[];
  return { items: rows.map(toEvent), total };
}

export function countByStatus(db: Db): Record<TaskStatus, number> {
  const counts = Object.fromEntries(TASK_STATUSES.map((s) => [s, 0])) as Record<TaskStatus, number>;
  const rows = db.prepare('SELECT status, COUNT(*) AS n FROM tasks GROUP BY status').all() as unknown as {
    status: TaskStatus;
    n: number;
  }[];
  for (const r of rows) if (r.status in counts) counts[r.status] = r.n;
  return counts;
}
