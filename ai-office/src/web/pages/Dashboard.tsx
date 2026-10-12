import { Link } from 'react-router-dom';
import { api } from '../api';
import { Card, Empty, ErrorBox, PageHeader, Soon, Stat, StatusBadge } from '../components/ui';
import { TaskTable } from '../components/TaskTable';
import { fmtDateTime } from '../format';
import { useAsync } from '../hooks';
import { ACTIVE_STATUSES } from '../../shared/taskStateMachine.js';
import { DEPARTMENT_LABELS, type DashboardData } from '../../shared/types.js';

export function Dashboard() {
  const { data, error } = useAsync(() => api.get<DashboardData>('/api/dashboard'), [], 5000);
  const c = data?.taskCounts;
  const active = c ? ACTIVE_STATUSES.reduce((n, s) => n + c[s], 0) : 0;

  return (
    <>
      <PageHeader title="메인 대시보드" subtitle="전체 업무 현황 (5초마다 자동 갱신)" />
      <ErrorBox message={error} />

      <div className="stats">
        <Stat label="진행 중" value={c ? active : '…'} to="/history?status=running" tone="accent" />
        <Stat label="대기" value={c?.queued ?? '…'} to="/history?status=queued" />
        <Stat label="승인 대기" value={c?.awaiting_approval ?? '…'} to="/command" />
        <Stat label="완료" value={c?.succeeded ?? '…'} to="/history?status=succeeded" />
        <Stat label="실패" value={c?.failed ?? '…'} to="/history?status=failed" tone={c && c.failed > 0 ? 'danger' : undefined} />
        <Stat label="활성 프로젝트" value={data?.activeProjects ?? '…'} to="/projects" />
      </div>

      <div className="grid-2">
        <Card title="최근 작업" right={<Link to="/history">전체 보기</Link>}>
          <TaskTable compact tasks={data?.recentTasks ?? []} emptyText="아직 등록된 작업이 없습니다. 'AI 총괄 관리실'에서 첫 작업을 등록해 보세요." />
        </Card>

        <div className="stack">
          <Card title="API 사용량 · 비용" right={<Soon stage={2} />}>
            <p className="muted">AI 제공자가 연결되면 오늘/이번 달 사용량과 예상 비용이 여기에 표시됩니다. 현재는 AI 호출이 없으므로 비용도 발생하지 않습니다.</p>
          </Card>
          <Card title="AI 작업 실행" right={<Soon stage={3} />}>
            <p className="muted">
              현재 1단계에서는 작업을 <strong>등록·관리</strong>할 수만 있고, AI가 실제로 실행하지는 않습니다.
              등록한 작업은 '대기' 상태로 남습니다.
            </p>
          </Card>
          <Card title="최근 활동">
            {data && data.recentEvents.length === 0 && <Empty>기록이 없습니다.</Empty>}
            <ul className="timeline">
              {data?.recentEvents.map((e) => (
                <li key={e.id}>
                  <span className="muted nowrap">{fmtDateTime(e.at)}</span>
                  <Link to={`/tasks/${e.taskId}`}>{e.taskTitle}</Link>
                  {e.toStatus ? <StatusBadge status={e.toStatus} /> : <span className="badge">메모</span>}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      <Card title="부서별 작업 수">
        <DeptCounts />
      </Card>
    </>
  );
}

function DeptCounts() {
  const { data } = useAsync(async () => {
    const entries = await Promise.all(
      (Object.keys(DEPARTMENT_LABELS) as (keyof typeof DEPARTMENT_LABELS)[]).map(async (d) => {
        const r = await api.get<{ total: number }>(`/api/tasks?department=${d}&limit=1`);
        return [d, r.total] as const;
      }),
    );
    return entries;
  }, [], 10000);
  return (
    <div className="stats">
      {data?.map(([d, n]) => <Stat key={d} label={DEPARTMENT_LABELS[d]} value={n} to={d === 'general' ? '/command' : `/${d}`} />)}
    </div>
  );
}
