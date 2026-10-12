import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../api';
import { Card, Empty, ErrorBox, PageHeader } from '../components/ui';
import { fmtDateTime } from '../format';
import { useAsync } from '../hooks';
import type { Project, ProjectWithStats } from '../../shared/types.js';

export function Projects() {
  const [showArchived, setShowArchived] = useState(false);
  const list = useAsync(() => api.get<{ items: ProjectWithStats[] }>('/api/projects'), []);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [workspacePath, setWorkspacePath] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await api.post<Project>('/api/projects', { name, description, workspacePath: workspacePath || null });
      setName('');
      setDescription('');
      setWorkspacePath('');
      list.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(p: Project, status: 'active' | 'archived') {
    try {
      await api.patch(`/api/projects/${p.id}`, { status });
      list.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const items = (list.data?.items ?? []).filter((p) => showArchived || p.status === 'active');

  return (
    <>
      <PageHeader title="프로젝트 관리" subtitle="작업을 묶어서 관리하는 단위입니다. 삭제 대신 보관(archive)합니다." />

      <Card title="새 프로젝트">
        <form className="form" onSubmit={create}>
          <div className="form-row">
            <label>
              이름
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
            </label>
            <label>
              작업 폴더 (선택)
              <input value={workspacePath} onChange={(e) => setWorkspacePath(e.target.value)} maxLength={500} placeholder="예: C:\work\my-app" />
              <span className="hint">AI가 파일을 다룰 허가된 폴더입니다. 3단계에서 사용되며 지금은 저장만 합니다.</span>
            </label>
          </div>
          <label>
            설명 (선택)
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={2000} />
          </label>
          <ErrorBox message={error} />
          <div><button className="btn primary" disabled={busy || !name.trim()}>프로젝트 만들기</button></div>
        </form>
      </Card>

      <Card
        title="프로젝트 목록"
        right={
          <label className="inline">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> 보관된 항목 표시
          </label>
        }
      >
        <ErrorBox message={list.error} />
        {items.length === 0 ? (
          <Empty>프로젝트가 없습니다.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>이름</th><th>작업 폴더</th><th>진행/전체</th><th>상태</th><th>생성</th><th /></tr>
              </thead>
              <tbody>
                {items.map((p) => (
                  <tr key={p.id}>
                    <td className="cell-title"><Link to={`/projects/${p.id}`}>{p.name}</Link></td>
                    <td className="mono">{p.workspacePath ?? <span className="muted">—</span>}</td>
                    <td>{p.openTaskCount} / {p.taskCount}</td>
                    <td><span className={`badge ${p.status === 'active' ? 'status-running' : ''}`}>{p.status === 'active' ? '활성' : '보관됨'}</span></td>
                    <td className="nowrap muted">{fmtDateTime(p.createdAt)}</td>
                    <td>
                      {p.status === 'active'
                        ? <button className="btn small" onClick={() => void setStatus(p, 'archived')}>보관</button>
                        : <button className="btn small" onClick={() => void setStatus(p, 'active')}>복원</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
