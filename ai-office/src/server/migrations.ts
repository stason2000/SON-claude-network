/**
 * DB 마이그레이션 목록. 순서대로 적용되며 PRAGMA user_version 에 적용된 개수가 기록됩니다.
 * 한 번 배포한 항목은 수정하지 말고, 변경은 항상 새 항목을 뒤에 추가하세요.
 *
 * status / department 같은 열거값은 의도적으로 CHECK 제약을 두지 않고 앱 계층에서 검증합니다.
 * (SQLite는 CHECK 변경 시 테이블 재생성이 필요해, 단계별로 상태가 늘어나는 이 프로젝트에는 부담이 큼)
 */
export const MIGRATIONS: readonly string[] = [
  // 1: 프로젝트 / 작업 / 작업 이벤트 / 설정
  `
  CREATE TABLE projects (
    id             TEXT PRIMARY KEY,
    name           TEXT NOT NULL,
    description    TEXT NOT NULL DEFAULT '',
    workspace_path TEXT,
    status         TEXT NOT NULL DEFAULT 'active',
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL
  );
  CREATE UNIQUE INDEX idx_projects_name ON projects (name COLLATE NOCASE);

  CREATE TABLE tasks (
    id           TEXT PRIMARY KEY,
    project_id   TEXT REFERENCES projects (id),
    department   TEXT NOT NULL,
    title        TEXT NOT NULL,
    goal         TEXT NOT NULL,
    priority     TEXT NOT NULL DEFAULT 'normal',
    status       TEXT NOT NULL DEFAULT 'queued',
    attempts     INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    started_at   TEXT,
    finished_at  TEXT
  );
  CREATE INDEX idx_tasks_status     ON tasks (status);
  CREATE INDEX idx_tasks_project    ON tasks (project_id);
  CREATE INDEX idx_tasks_department ON tasks (department);
  CREATE INDEX idx_tasks_created    ON tasks (created_at);

  CREATE TABLE task_events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id     TEXT NOT NULL REFERENCES tasks (id),
    at          TEXT NOT NULL,
    type        TEXT NOT NULL,
    from_status TEXT,
    to_status   TEXT,
    message     TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX idx_task_events_task ON task_events (task_id, id);

  CREATE TABLE settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  `,
];
