import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, errorMessage } from '../api';
import { Card, ErrorBox, PageHeader, PriorityBadge, Soon, StatusBadge } from '../components/ui';
import { fmtDateTime } from '../format';
import { useAsync } from '../hooks';
import { canRetry, canTransition } from '../../shared/taskStateMachine.js';
import { DEPARTMENT_LABELS, TASK_STATUS_LABELS, type TaskDetail } from '../../shared/types.js';

export function TaskDetailPage() {
  const { id = '' } = useParams();
  const { data: task, error, reload } = useAsync(() => api.get<TaskDetail>(`/api/tasks/${id}`), [id], 4000);
  const [actionError, setActionError] = useState<string>();
  const [note, setNote] = useState('');

  async function transition(to: 'cancelled' | 'queued', message: string) {
    setActionError(undefined);
    try {
      await api.post(`/api/tasks/${id}/transition`, { to, message });
      reload();
    } catch (e) {
      setActionError(errorMessage(e));
    }
  }

  async function addNote(e: FormEvent) {
    e.preventDefault();
    setActionError(undefined);
    try {
      await api.post(`/api/tasks/${id}/notes`, { message: note });
      setNote('');
      reload();
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  if (error && !task) return <><PageHeader title="작업" /><ErrorBox message={error} /><Link to="/history">← 작업 기록</Link></>;
  if (!task) return <p className="muted">불러오는 중…</p>;

  const cancellable = canTransition(task.status, 'cancelled');
  const retryable = task.status === 'failed';

  return (
    <>
      <PageHeader title={task.title} subtitle={`${DEPARTMENT_LABELS[task.department]}${task.projectName ? ` · ${task.projectName}` : ''}`} actions={<Link to="/history">← 작업 기록</Link>} />
      <ErrorBox message={actionError} />

      <div className="grid-2">
        <Card title="작업 정보">
          <dl className="kv">
            <dt>상태</dt><dd><StatusBadge status={task.status} /></dd>
            <dt>우선순위</dt><dd><PriorityBadge priority={task.priority} /></dd>
            <dt>시도 횟수</dt><dd>{task.attempts} / {task.maxAttempts}</dd>
            <dt>등록</dt><dd>{fmtDateTime(task.createdAt)}</dd>
            <dt>실행 시작</dt><dd>{fmtDateTime(task.startedAt)}</dd>
            <dt>종료</dt><dd>{fmtDateTime(task.finishedAt)}</dd>
          </dl>
          <h3>목표</h3>
          <p className="pre">{task.goal}</p>
        </Card>

        <div className="stack">
          <Card title="조작">
            <div className="btn-row">
              <button className="btn danger" disabled={!cancellable} onClick={() => { if (window.confirm('이 작업을 취소할까요?')) void transition('cancelled', '사용자가 취소했습니다.'); }}>
                작업 취소
              </button>
              <button className="btn" disabled={!retryable || !canRetry(task.attempts, task.maxAttempts)} onClick={() => void transition('queued', '사용자가 재시도를 요청했습니다.')}>
                재시도 (대기열로)
              </button>
            </div>
            {retryable && !canRetry(task.attempts, task.maxAttempts) && <p className="muted small">최대 시도 횟수에 도달해 재시도할 수 없습니다.</p>}
            <p className="muted small">
              계획·승인·실행·검증으로의 상태 변경은 실행 엔진이 담당합니다. <Soon stage={3} />
            </p>
          </Card>
          <Card title="메모 남기기">
            <form className="form" onSubmit={addNote}>
              <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder="작업 기록에 남길 메모" />
              <div><button className="btn" disabled={!note.trim()}>메모 추가</button></div>
            </form>
          </Card>
        </div>
      </div>

      <Card title="작업 기록">
        <ul className="timeline">
          {task.events.map((e) => (
            <li key={e.id}>
              <span className="muted nowrap">{fmtDateTime(e.at)}</span>
              {e.type === 'note' ? <span className="badge">메모</span> : (
                <span>
                  {e.fromStatus ? <>{TASK_STATUS_LABELS[e.fromStatus]} → </> : null}
                  {e.toStatus && <StatusBadge status={e.toStatus} />}
                </span>
              )}
              <span>{e.message}</span>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
