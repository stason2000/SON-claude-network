import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, errorMessage } from '../api';
import { Card, ErrorBox, Notice, PageHeader } from '../components/ui';
import { TaskForm } from '../components/TaskForm';
import { TaskTable } from '../components/TaskTable';
import { fmtDateTime } from '../format';
import { useAsync } from '../hooks';
import type { Project, Task } from '../../shared/types.js';

type ProjectFull = Project & { tasks: Task[] };

export function ProjectDetail() {
  const { id = '' } = useParams();
  const { data: project, error, reload } = useAsync(() => api.get<ProjectFull>(`/api/projects/${id}`), [id], 5000);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [workspacePath, setWorkspacePath] = useState('');
  const [msg, setMsg] = useState<{ kind: 'info' | 'error'; text: string }>();
  const [loadedId, setLoadedId] = useState<string>();

  // 처음 불러왔을 때만 폼을 채웁니다. (자동 갱신이 입력 중인 내용을 덮어쓰지 않도록)
  useEffect(() => {
    if (project && loadedId !== project.id) {
      setName(project.name);
      setDescription(project.description);
      setWorkspacePath(project.workspacePath ?? '');
      setLoadedId(project.id);
    }
  }, [project, loadedId]);

  async function save(e: FormEvent) {
    e.preventDefault();
    try {
      await api.patch(`/api/projects/${id}`, { name, description, workspacePath: workspacePath || null });
      setMsg({ kind: 'info', text: '저장했습니다.' });
      reload();
    } catch (err) {
      setMsg({ kind: 'error', text: errorMessage(err) });
    }
  }

  if (error && !project) return <><PageHeader title="프로젝트" /><ErrorBox message={error} /><Link to="/projects">← 목록으로</Link></>;
  if (!project) return <p className="muted">불러오는 중…</p>;

  return (
    <>
      <PageHeader title={project.name} subtitle={`생성 ${fmtDateTime(project.createdAt)} · ${project.status === 'active' ? '활성' : '보관됨'}`} actions={<Link to="/projects">← 목록</Link>} />
      <div className="grid-2">
        <Card title="프로젝트 정보">
          <form className="form" onSubmit={save}>
            <label>이름<input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required /></label>
            <label>작업 폴더<input value={workspacePath} onChange={(e) => setWorkspacePath(e.target.value)} maxLength={500} /></label>
            <label>설명<textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={2000} /></label>
            {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
            <div><button className="btn primary" disabled={!name.trim()}>저장</button></div>
          </form>
        </Card>
        {project.status === 'active' ? (
          <Card title="이 프로젝트에 작업 등록">
            <TaskForm defaultProjectId={project.id} onCreated={reload} />
          </Card>
        ) : (
          <Card title="보관된 프로젝트"><p className="muted">보관된 프로젝트에는 새 작업을 만들 수 없습니다. 목록에서 복원하세요.</p></Card>
        )}
      </div>
      <Card title="작업 목록">
        <TaskTable tasks={project.tasks} emptyText="이 프로젝트의 작업이 없습니다." />
      </Card>
    </>
  );
}
