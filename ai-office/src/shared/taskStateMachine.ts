import type { TaskStatus } from './types.js';

/**
 * 작업 상태 전이 규칙.
 *
 *   queued ─▶ planning ─▶ awaiting_approval ─▶ running ─▶ verifying ─▶ succeeded
 *      │          │  ▲            │                │           │
 *      │          │  └────────────┘ (반려→재계획)   │           │
 *      ▼          ▼                                ▼           ▼
 *   cancelled   failed ◀───────────────────────────┴───────────┘
 *                  │
 *                  └─▶ queued (재시도, attempts < maxAttempts 일 때만)
 *
 * 'succeeded'는 반드시 'verifying'을 거쳐야 합니다.
 * AI가 "다 했다"고 말하는 것과 결과물이 실제로 검증된 것을 구분하기 위한 설계입니다.
 */
export const TASK_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  queued: ['planning', 'cancelled'],
  planning: ['awaiting_approval', 'failed', 'cancelled'],
  awaiting_approval: ['running', 'planning', 'cancelled'],
  running: ['verifying', 'failed', 'cancelled'],
  verifying: ['succeeded', 'failed', 'cancelled'],
  failed: ['queued', 'cancelled'],
  succeeded: [],
  cancelled: [],
};

export const TERMINAL_STATUSES: readonly TaskStatus[] = ['succeeded', 'cancelled'];
/** 지금 실행 자원을 쓰고 있는 상태 */
export const ACTIVE_STATUSES: readonly TaskStatus[] = ['planning', 'running', 'verifying'];
/** 아직 끝나지 않은 모든 상태 (실패는 재시도 가능하므로 포함하지 않음) */
export const OPEN_STATUSES: readonly TaskStatus[] = ['queued', 'planning', 'awaiting_approval', 'running', 'verifying'];

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return TASK_TRANSITIONS[from].includes(to);
}

export function allowedTransitions(from: TaskStatus): readonly TaskStatus[] {
  return TASK_TRANSITIONS[from];
}

/** 재시도(failed → queued)가 허용되는지. 무한 반복 방지를 위한 규칙입니다. */
export function canRetry(attempts: number, maxAttempts: number): boolean {
  return attempts < maxAttempts;
}
