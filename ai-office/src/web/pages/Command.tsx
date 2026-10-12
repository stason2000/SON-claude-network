import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { Card, ErrorBox, Notice, PageHeader, Soon } from '../components/ui';
import { TaskForm } from '../components/TaskForm';
import { TaskTable } from '../components/TaskTable';
import { useAsync } from '../hooks';
import type { Page, Task } from '../../shared/types.js';

const PIPELINE: { name: string; stage: number | null; note?: string }[] = [
  { name: '1. 사용자 명령 접수 및 저장', stage: null, note: '구현됨 (아래 폼)' },
  { name: '2. 작업 계획 수립 · 세부 작업 분할', stage: 3 },
  { name: '3. 담당 AI 모델·도구 지정', stage: 3 },
  { name: '4. 계획 승인', stage: 4 },
  { name: '5. 작업 실행', stage: 3 },
  { name: '6. 결과 검증 (완료 주장과 실제 결과물 구분)', stage: 3 },
  { name: '7. 제한적 재시도 · 안전한 종료', stage: 4, note: '상태 규칙(최대 시도 횟수)만 구현됨' },
  { name: '8. 결과물 저장 · 완료 보고', stage: 3 },
];

export function Command() {
  const nav = useNavigate();
  const approvals = useAsync(() => api.get<Page<Task>>('/api/tasks?status=awaiting_approval&limit=20'), [], 5000);
  const recent = useAsync(() => api.get<Page<Task>>('/api/tasks?limit=15'), [], 5000);

  return (
    <>
      <PageHeader title="AI 총괄 관리실" subtitle="업무 지시를 접수하고 작업 상태를 관리합니다." />
      <Notice kind="warn">
        <strong>1단계 안내:</strong> 지금은 작업을 등록하고 상태를 관리하는 기반만 구현되어 있습니다.
        AI가 계획을 세우거나 실행하지 않으므로, 등록한 작업은 '대기' 상태로 남습니다. (AI 연결 2단계, 실제 실행 3단계)
      </Notice>

      <div className="grid-2">
        <Card title="새 작업 등록">
          <TaskForm onCreated={(t) => nav(`/tasks/${t.id}`)} />
        </Card>
        <Card title="총괄 처리 흐름">
          <ul className="checklist">
            {PIPELINE.map((p) => (
              <li key={p.name}>
                <span>{p.name}</span>
                {p.stage === null ? <span className="badge status-succeeded">구현됨</span> : <Soon stage={p.stage} />}
                {p.note && p.stage !== null && <span className="muted small"> {p.note}</span>}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card title="승인 대기" right={<span className="muted">{approvals.data?.total ?? 0}건</span>}>
        <ErrorBox message={approvals.error} />
        <TaskTable tasks={approvals.data?.items ?? []} emptyText="승인을 기다리는 작업이 없습니다. (승인 시스템은 4단계에서 구현됩니다)" />
      </Card>

      <Card title="최근 작업">
        <ErrorBox message={recent.error} />
        <TaskTable tasks={recent.data?.items ?? []} emptyText="등록된 작업이 없습니다." />
      </Card>
    </>
  );
}
