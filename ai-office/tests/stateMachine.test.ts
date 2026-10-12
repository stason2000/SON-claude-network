import { describe, expect, it } from 'vitest';
import { TASK_TRANSITIONS, canRetry, canTransition } from '../src/shared/taskStateMachine.js';
import { TASK_STATUSES } from '../src/shared/types.js';

describe('작업 상태 머신', () => {
  it('모든 상태가 전이 표에 정의되어 있고 대상 상태도 유효하다', () => {
    for (const s of TASK_STATUSES) {
      expect(TASK_TRANSITIONS[s]).toBeDefined();
      for (const to of TASK_TRANSITIONS[s]) expect(TASK_STATUSES).toContain(to);
    }
  });

  it('완료(succeeded)는 반드시 검증(verifying)을 거쳐야 한다', () => {
    for (const s of TASK_STATUSES) {
      if (s !== 'verifying') expect(canTransition(s, 'succeeded')).toBe(false);
    }
    expect(canTransition('verifying', 'succeeded')).toBe(true);
  });

  it('승인 없이 실행(running)으로 갈 수 없다', () => {
    for (const s of TASK_STATUSES) {
      if (s !== 'awaiting_approval') expect(canTransition(s, 'running')).toBe(false);
    }
  });

  it('완료·취소는 종료 상태이다', () => {
    expect(TASK_TRANSITIONS.succeeded).toHaveLength(0);
    expect(TASK_TRANSITIONS.cancelled).toHaveLength(0);
  });

  it('재시도는 최대 시도 횟수 미만일 때만 가능하다', () => {
    expect(canRetry(2, 3)).toBe(true);
    expect(canRetry(3, 3)).toBe(false);
  });
});
