import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/server/app.js';
import { openDb, schemaVersion, type Db } from '../src/server/db.js';
import { MIGRATIONS } from '../src/server/migrations.js';
import type { Task, TaskDetail } from '../src/shared/types.js';

let db: Db;
let app: FastifyInstance;

beforeEach(async () => {
  db = openDb(':memory:');
  app = await buildApp({ db, host: '127.0.0.1', port: 4100, dataDir: '/tmp/x', dbPath: ':memory:' });
});
afterEach(async () => {
  await app.close();
  db.close();
});

const post = (url: string, payload: unknown, headers: Record<string, string> = {}) =>
  app.inject({ method: 'POST', url, payload: payload as object, headers });

async function newTask(extra: Record<string, unknown> = {}): Promise<TaskDetail> {
  const res = await post('/api/tasks', { goal: '로그인 기능 개발', department: 'dev', ...extra });
  expect(res.statusCode).toBe(201);
  return res.json();
}
const go = async (id: string, to: string) => post(`/api/tasks/${id}/transition`, { to });

describe('DB', () => {
  it('마이그레이션이 적용되고 스키마 버전이 기록된다', () => {
    expect(schemaVersion(db)).toBe(MIGRATIONS.length);
  });
});

describe('시스템', () => {
  it('/api/system 이 버전과 단계를 돌려준다', async () => {
    const res = await app.inject({ url: '/api/system' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ name: 'AI OFFICE', stage: 1, schemaVersion: MIGRATIONS.length });
  });

  it('로컬이 아닌 Host 헤더는 거부한다 (DNS rebinding 방어)', async () => {
    const res = await app.inject({ url: '/api/system', headers: { host: 'evil.example.com' } });
    expect(res.statusCode).toBe(403);
  });

  it('다른 사이트의 Origin 으로 온 쓰기 요청은 거부한다 (CSRF 방어)', async () => {
    const res = await post('/api/projects', { name: 'x' }, { origin: 'https://evil.example.com' });
    expect(res.statusCode).toBe(403);
    expect((await app.inject({ url: '/api/projects' })).json().items).toHaveLength(0);
  });

  it('같은 호스트의 Origin 은 허용한다', async () => {
    const res = await post('/api/projects', { name: 'ok' }, { host: 'localhost:5173', origin: 'http://localhost:5173' });
    expect(res.statusCode).toBe(201);
  });

  it('존재하지 않는 API 는 JSON 404 를 돌려준다', async () => {
    const res = await app.inject({ url: '/api/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('not_found');
  });
});

describe('프로젝트', () => {
  it('생성·조회·수정·보관', async () => {
    const created = await post('/api/projects', { name: '쇼핑몰', description: '설명', workspacePath: 'C:\\work\\shop' });
    expect(created.statusCode).toBe(201);
    const p = created.json();
    expect(p).toMatchObject({ name: '쇼핑몰', status: 'active', workspacePath: 'C:\\work\\shop' });

    const patched = await app.inject({ method: 'PATCH', url: `/api/projects/${p.id}`, payload: { status: 'archived' } });
    expect(patched.json().status).toBe('archived');

    const got = await app.inject({ url: `/api/projects/${p.id}` });
    expect(got.json()).toMatchObject({ id: p.id, tasks: [] });
  });

  it('이름 중복(대소문자 무시)은 409', async () => {
    await post('/api/projects', { name: 'Alpha' });
    const dup = await post('/api/projects', { name: 'alpha' });
    expect(dup.statusCode).toBe(409);
  });

  it('빈 이름·알 수 없는 필드는 400', async () => {
    expect((await post('/api/projects', { name: '' })).statusCode).toBe(400);
    expect((await post('/api/projects', { name: 'a', hack: 1 })).statusCode).toBe(400);
  });

  it('없는 프로젝트는 404', async () => {
    expect((await app.inject({ url: '/api/projects/nope' })).statusCode).toBe(404);
  });

  it('보관된 프로젝트에는 작업을 만들 수 없다', async () => {
    const p = (await post('/api/projects', { name: 'old' })).json();
    await app.inject({ method: 'PATCH', url: `/api/projects/${p.id}`, payload: { status: 'archived' } });
    const res = await post('/api/tasks', { goal: 'x', department: 'dev', projectId: p.id });
    expect(res.statusCode).toBe(400);
  });

  it('프로젝트 목록이 작업 수를 집계한다', async () => {
    const p = (await post('/api/projects', { name: 'P' })).json();
    const t = await newTask({ projectId: p.id });
    await newTask({ projectId: p.id });
    await go(t.id, 'cancelled');
    const list = (await app.inject({ url: '/api/projects' })).json().items;
    expect(list[0]).toMatchObject({ taskCount: 2, openTaskCount: 1 });
  });
});

describe('작업', () => {
  it('생성하면 대기 상태이고 created 이벤트가 남는다', async () => {
    const t = await newTask();
    expect(t).toMatchObject({ status: 'queued', attempts: 0, maxAttempts: 3, priority: 'normal', department: 'dev' });
    expect(t.title).toBe('로그인 기능 개발');
    expect(t.events).toHaveLength(1);
    expect(t.events[0]).toMatchObject({ type: 'created', toStatus: 'queued' });
  });

  it('제목이 없으면 목표의 첫 줄로 만든다', async () => {
    const t = await newTask({ goal: `${'가'.repeat(100)}\n두 번째 줄` });
    expect(t.title.length).toBeLessThanOrEqual(80);
    expect(t.title.endsWith('...')).toBe(true);
  });

  it('잘못된 입력은 400', async () => {
    expect((await post('/api/tasks', { goal: '', department: 'dev' })).statusCode).toBe(400);
    expect((await post('/api/tasks', { goal: 'x', department: 'cooking' })).statusCode).toBe(400);
    expect((await post('/api/tasks', { goal: '   ', department: 'dev' })).statusCode).toBe(400);
    expect((await post('/api/tasks', { goal: 'x', department: 'dev', projectId: 'missing' })).statusCode).toBe(404);
  });

  it('정상 흐름: 대기→계획→승인대기→실행→검증→완료, 이벤트가 모두 기록된다', async () => {
    const t = await newTask();
    for (const to of ['planning', 'awaiting_approval', 'running', 'verifying', 'succeeded']) {
      const res = await go(t.id, to);
      expect(res.statusCode).toBe(200);
    }
    const done: TaskDetail = (await app.inject({ url: `/api/tasks/${t.id}` })).json();
    expect(done.status).toBe('succeeded');
    expect(done.attempts).toBe(1);
    expect(done.startedAt).not.toBeNull();
    expect(done.finishedAt).not.toBeNull();
    expect(done.events.map((e) => e.toStatus)).toEqual([
      'queued', 'planning', 'awaiting_approval', 'running', 'verifying', 'succeeded',
    ]);
  });

  it('규칙에 없는 전이는 409 이고 상태가 바뀌지 않는다', async () => {
    const t = await newTask();
    const res = await go(t.id, 'succeeded');
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('invalid_transition');
    const after: TaskDetail = (await app.inject({ url: `/api/tasks/${t.id}` })).json();
    expect(after.status).toBe('queued');
    expect(after.events).toHaveLength(1);
  });

  it('종료된 작업은 더 이상 바꿀 수 없다', async () => {
    const t = await newTask();
    await go(t.id, 'cancelled');
    expect((await go(t.id, 'queued')).statusCode).toBe(409);
  });

  it('실패한 작업은 최대 시도 횟수까지만 재시도할 수 있다', async () => {
    const t = await newTask({});
    // maxAttempts 기본 3: 실행→실패를 3번 반복하면 4번째 재시도는 막혀야 한다
    for (let i = 1; i <= 3; i++) {
      for (const to of ['planning', 'awaiting_approval', 'running', 'failed']) {
        expect((await go(t.id, to)).statusCode).toBe(200);
      }
      const retry = await go(t.id, 'queued');
      if (i < 3) expect(retry.statusCode).toBe(200);
      else {
        expect(retry.statusCode).toBe(409);
        expect(retry.json().error.code).toBe('retry_limit');
      }
    }
    const final: TaskDetail = (await app.inject({ url: `/api/tasks/${t.id}` })).json();
    expect(final.status).toBe('failed');
    expect(final.attempts).toBe(3);
  });

  it('필터와 페이지네이션이 동작한다', async () => {
    const a = await newTask({ department: 'dev' });
    await newTask({ department: 'research' });
    await newTask({ department: 'research' });
    await go(a.id, 'cancelled');

    const research = (await app.inject({ url: '/api/tasks?department=research' })).json();
    expect(research.total).toBe(2);
    const cancelled = (await app.inject({ url: '/api/tasks?status=cancelled' })).json();
    expect(cancelled.items.map((t: Task) => t.id)).toEqual([a.id]);
    const page = (await app.inject({ url: '/api/tasks?limit=2&offset=0' })).json();
    expect(page.items).toHaveLength(2);
    expect(page.total).toBe(3);
    expect((await app.inject({ url: '/api/tasks?status=bogus' })).statusCode).toBe(400);
  });

  it('메모를 남길 수 있다', async () => {
    const t = await newTask();
    const res = await post(`/api/tasks/${t.id}/notes`, { message: '확인 필요' });
    expect(res.statusCode).toBe(201);
    expect(res.json().events.at(-1)).toMatchObject({ type: 'note', message: '확인 필요' });
  });
});

describe('대시보드 / 작업 기록', () => {
  it('상태별 집계와 최근 이벤트를 돌려준다', async () => {
    await post('/api/projects', { name: 'P1' });
    const a = await newTask();
    await newTask();
    await go(a.id, 'planning');
    const d = (await app.inject({ url: '/api/dashboard' })).json();
    expect(d.taskCounts).toMatchObject({ queued: 1, planning: 1, running: 0 });
    expect(d.totalTasks).toBe(2);
    expect(d.activeProjects).toBe(1);
    expect(d.recentTasks).toHaveLength(2);
    expect(d.recentEvents[0]).toMatchObject({ toStatus: 'planning', taskTitle: '로그인 기능 개발' });
    const ev = (await app.inject({ url: '/api/events?limit=2' })).json();
    expect(ev.items).toHaveLength(2);
    expect(ev.total).toBe(3);
  });
});

describe('안전 한도 설정', () => {
  it('기본값을 돌려주고 저장할 수 있다', async () => {
    const def = (await app.inject({ url: '/api/settings/limits' })).json();
    expect(def).toEqual({ maxTaskMinutes: 30, maxIterations: 5, maxCostUsdPerTask: 1, maxCostUsdPerDay: 5 });
    const saved = await app.inject({
      method: 'PUT', url: '/api/settings/limits',
      payload: { maxTaskMinutes: 60, maxIterations: 10, maxCostUsdPerTask: 2.5, maxCostUsdPerDay: 10 },
    });
    expect(saved.statusCode).toBe(200);
    expect((await app.inject({ url: '/api/settings/limits' })).json().maxTaskMinutes).toBe(60);
  });

  it('범위를 벗어난 값은 400', async () => {
    const res = await app.inject({
      method: 'PUT', url: '/api/settings/limits',
      payload: { maxTaskMinutes: 0, maxIterations: 10, maxCostUsdPerTask: 2, maxCostUsdPerDay: 10 },
    });
    expect(res.statusCode).toBe(400);
  });
});
