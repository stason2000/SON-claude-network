import { api } from '../api';
import { Card, ErrorBox, Notice, PageHeader, Soon } from '../components/ui';
import { TaskForm } from '../components/TaskForm';
import { TaskTable } from '../components/TaskTable';
import { DEPARTMENT_INFO } from '../departments';
import { useAsync } from '../hooks';
import { DEPARTMENT_LABELS, type Department as Dept, type Page, type Task } from '../../shared/types.js';

export function DepartmentPage({ department }: { department: Exclude<Dept, 'general'> }) {
  const info = DEPARTMENT_INFO[department];
  const tasks = useAsync(() => api.get<Page<Task>>(`/api/tasks?department=${department}&limit=50`), [department], 5000);

  return (
    <>
      <PageHeader title={DEPARTMENT_LABELS[department]} subtitle={info.summary} />
      {info.warning && <Notice kind="error"><strong>실거래 기능 없음:</strong> {info.warning}</Notice>}
      <Notice kind="warn">이 부서의 AI 기능은 아직 구현되지 않았습니다. 아래 작업은 등록·기록만 되며 실행되지 않습니다.</Notice>

      <div className="grid-2">
        <Card title="예정 기능">
          <ul className="checklist">
            {info.capabilities.map((c) => (
              <li key={c.name}>
                <span>{c.name}</span>
                <Soon stage={c.stage} />
              </li>
            ))}
          </ul>
        </Card>
        <Card title="이 부서에 작업 등록">
          <TaskForm lockedDepartment={department} onCreated={tasks.reload} />
        </Card>
      </div>

      <Card title="부서 작업 목록" right={<span className="muted">{tasks.data?.total ?? 0}건</span>}>
        <ErrorBox message={tasks.error} />
        <TaskTable tasks={tasks.data?.items ?? []} emptyText="이 부서에 등록된 작업이 없습니다." />
      </Card>
    </>
  );
}
