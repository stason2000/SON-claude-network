// 서버와 웹이 함께 쓰는 공통 데이터 구조. 여기가 AI OFFICE의 "단일 진실 공급원"입니다.

export const DEPARTMENTS = ['general', 'dev', 'research', 'trading'] as const;
export type Department = (typeof DEPARTMENTS)[number];

export const DEPARTMENT_LABELS: Record<Department, string> = {
  general: 'AI 총괄 관리실',
  dev: '개발 부서',
  research: '연구·분석 부서',
  trading: '자동매매 부서',
};

export const TASK_STATUSES = [
  'queued',
  'planning',
  'awaiting_approval',
  'running',
  'verifying',
  'succeeded',
  'failed',
  'cancelled',
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  queued: '대기',
  planning: '계획 수립 중',
  awaiting_approval: '승인 대기',
  running: '실행 중',
  verifying: '결과 검증 중',
  succeeded: '완료',
  failed: '실패',
  cancelled: '취소됨',
};

export const PRIORITIES = ['low', 'normal', 'high'] as const;
export type Priority = (typeof PRIORITIES)[number];
export const PRIORITY_LABELS: Record<Priority, string> = { low: '낮음', normal: '보통', high: '높음' };

export const PROJECT_STATUSES = ['active', 'archived'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const EVENT_TYPES = ['created', 'status_changed', 'note'] as const;
export type TaskEventType = (typeof EVENT_TYPES)[number];

export interface Project {
  id: string;
  name: string;
  description: string;
  /** AI가 작업할 수 있는 허가된 작업 폴더. 1단계에서는 저장만 하고 사용하지 않습니다. */
  workspacePath: string | null;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectWithStats extends Project {
  taskCount: number;
  openTaskCount: number;
}

export interface Task {
  id: string;
  projectId: string | null;
  projectName: string | null;
  department: Department;
  title: string;
  goal: string;
  priority: Priority;
  status: TaskStatus;
  /** 실행 단계(running)에 진입한 횟수. maxAttempts 이상이면 재시도할 수 없습니다. */
  attempts: number;
  maxAttempts: number;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface TaskEvent {
  id: number;
  taskId: string;
  taskTitle?: string;
  at: string;
  type: TaskEventType;
  fromStatus: TaskStatus | null;
  toStatus: TaskStatus | null;
  message: string;
}

export interface TaskDetail extends Task {
  events: TaskEvent[];
}

export interface Page<T> {
  items: T[];
  total: number;
}

/** 자율 실행 안전 한도. 1단계에서는 저장·표시만 하며 실행 엔진이 생기는 3~4단계부터 강제됩니다. */
export interface SafetyLimits {
  maxTaskMinutes: number;
  maxIterations: number;
  maxCostUsdPerTask: number;
  maxCostUsdPerDay: number;
}

export const DEFAULT_SAFETY_LIMITS: SafetyLimits = {
  maxTaskMinutes: 30,
  maxIterations: 5,
  maxCostUsdPerTask: 1,
  maxCostUsdPerDay: 5,
};

export interface SystemInfo {
  name: string;
  version: string;
  stage: number;
  nodeVersion: string;
  platform: string;
  startedAt: string;
  uptimeSec: number;
  host: string;
  port: number;
  dataDir: string;
  dbPath: string;
  schemaVersion: number;
}

export interface DashboardData {
  taskCounts: Record<TaskStatus, number>;
  totalTasks: number;
  activeProjects: number;
  recentTasks: Task[];
  recentEvents: TaskEvent[];
}

export interface ApiErrorBody {
  error: { code: string; message: string };
}
