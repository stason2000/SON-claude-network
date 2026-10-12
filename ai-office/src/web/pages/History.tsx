import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { Card, Empty, ErrorBox, PageHeader, StatusBadge } from '../components/ui';
import { TaskTable } from '../components/TaskTable';
import { fmtDateTime } from '../format';
import { useAsync } from '../hooks';
import {
  DEPARTMENTS,
  DEPARTMENT_LABELS,
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  type Page,
  type ProjectWithStats,
  type Task,
  type TaskEvent,
} from '../../shared/types.js';

const PAGE = 30;

export function History() {
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<'tasks' | 'events'>('tasks');
  const [offset, setOffset] = useState(0);
  const status = params.get('status') ?? '';
  const department = params.get('department') ?? '';
  const projectId = params.get('projectId') ?? '';

  const projects = useAsync(() => api.get<{ items: ProjectWithStats[] }>('/api/projects'), []);
  const qs = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
  if (status) qs.set('status', status);
  if (department) qs.set('department', department);
  if (projectId) qs.set('projectId', projectId);
  const tasks = useAsync(() => api.get<Page<Task>>(`/api/tasks?${qs}`), [qs.toString()], 5000);
  const events = useAsync(
    () => (tab === 'events' ? api.get<Page<TaskEvent>>(`/api/events?limit=${PAGE}&offset=${offset}`) : Promise.resolve(undefined)),
    [tab, offset],
    5000,
  );

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next);
    setOffset(0);
  };
  const page = tab === 'tasks' ? tasks.data : events.data;
  const total = page?.total ?? 0;

  return (
    <>
      <PageHeader title="작업 기록" subtitle="모든 작업과 상태 변경 이력을 확인합니다. 기록은 삭제되지 않습니다." />
      <div className="tabs">
        <button className={tab === 'tasks' ? 'active' : ''} onClick={() => { setTab('tasks'); setOffset(0); }}>작업 목록</button>
        <button className={tab === 'events' ? 'active' : ''} onClick={() => { setTab('events'); setOffset(0); }}>이벤트 로그</button>
      </div>

      {tab === 'tasks' && (
        <div className="filters">
          <label>상태
            <select value={status} onChange={(e) => setFilter('status', e.target.value)}>
              <option value="">전체</option>
              {TASK_STATUSES.map((s) => <option key={s} value={s}>{TASK_STATUS_LABELS[s]}</option>)}
            </select>
          </label>
          <label>부서
            <select value={department} onChange={(e) => setFilter('department', e.target.value)}>
              <option value="">전체</option>
              {DEPARTMENTS.map((d) => <option key={d} value={d}>{DEPARTMENT_LABELS[d]}</option>)}
            </select>
          </label>
          <label>프로젝트
            <select value={projectId} onChange={(e) => setFilter('projectId', e.target.value)}>
              <option value="">전체</option>
              {projects.data?.items.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
        </div>
      )}

      <Card right={<span className="muted">총 {total}건</span>}>
        <ErrorBox message={tab === 'tasks' ? tasks.error : events.error} />
        {tab === 'tasks' ? (
          <TaskTable tasks={tasks.data?.items ?? []} emptyText="조건에 맞는 작업이 없습니다." />
        ) : events.data && events.data.items.length === 0 ? (
          <Empty>기록이 없습니다.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>시각</th><th>작업</th><th>변경</th><th>메시지</th></tr></thead>
              <tbody>
                {events.data?.items.map((e) => (
                  <tr key={e.id}>
                    <td className="nowrap muted">{fmtDateTime(e.at)}</td>
                    <td className="cell-title"><Link to={`/tasks/${e.taskId}`}>{e.taskTitle}</Link></td>
                    <td>{e.toStatus ? <StatusBadge status={e.toStatus} /> : <span className="badge">메모</span>}</td>
                    <td>{e.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {total > PAGE && (
          <div className="pager">
            <button className="btn small" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>이전</button>
            <span className="muted">{offset + 1}–{Math.min(offset + PAGE, total)} / {total}</span>
            <button className="btn small" disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)}>다음</button>
          </div>
        )}
      </Card>
    </>
  );
}
