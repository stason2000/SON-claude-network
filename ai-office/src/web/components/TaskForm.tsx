import { useState, type FormEvent } from 'react';
import { api, errorMessage } from '../api';
import { useAsync } from '../hooks';
import {
  DEPARTMENTS,
  DEPARTMENT_LABELS,
  PRIORITIES,
  PRIORITY_LABELS,
  type Department,
  type Priority,
  type ProjectWithStats,
  type TaskDetail,
} from '../../shared/types.js';
import { ErrorBox } from './ui';

interface Props {
  /** 지정하면 부서 선택을 고정합니다. */
  lockedDepartment?: Department;
  defaultProjectId?: string;
  onCreated: (task: TaskDetail) => void;
}

export function TaskForm({ lockedDepartment, defaultProjectId, onCreated }: Props) {
  const projects = useAsync(() => api.get<{ items: ProjectWithStats[] }>('/api/projects?status=active'), []);
  const [goal, setGoal] = useState('');
  const [title, setTitle] = useState('');
  const [department, setDepartment] = useState<Department>(lockedDepartment ?? 'general');
  const [projectId, setProjectId] = useState(defaultProjectId ?? '');
  const [priority, setPriority] = useState<Priority>('normal');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const task = await api.post<TaskDetail>('/api/tasks', {
        goal,
        ...(title.trim() ? { title: title.trim() } : {}),
        department: lockedDepartment ?? department,
        projectId: projectId || null,
        priority,
      });
      setGoal('');
      setTitle('');
      onCreated(task);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form" onSubmit={submit}>
      <label>
        작업 목표
        <textarea
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          rows={4}
          maxLength={8000}
          required
          placeholder="예: 간단한 할 일 관리 웹앱을 만들고 테스트한 뒤 결과를 보고해."
        />
      </label>
      <div className="form-row">
        <label>
          제목 (선택)
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="비우면 목표의 첫 줄을 사용" />
        </label>
        {!lockedDepartment && (
          <label>
            담당 부서
            <select value={department} onChange={(e) => setDepartment(e.target.value as Department)}>
              {DEPARTMENTS.map((d) => <option key={d} value={d}>{DEPARTMENT_LABELS[d]}</option>)}
            </select>
          </label>
        )}
        <label>
          프로젝트
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">(없음)</option>
            {projects.data?.items.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label>
          우선순위
          <select value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
            {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
          </select>
        </label>
      </div>
      <ErrorBox message={error} />
      <div>
        <button className="btn primary" type="submit" disabled={busy || !goal.trim()}>
          {busy ? '등록 중…' : '작업 등록'}
        </button>
      </div>
    </form>
  );
}
