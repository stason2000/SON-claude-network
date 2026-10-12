import { Link } from 'react-router-dom';
import { fmtDateTime } from '../format';
import { DEPARTMENT_LABELS, type Task } from '../../shared/types.js';
import { Empty, PriorityBadge, StatusBadge } from './ui';

/** compact: 좁은 칸용 간단 보기 (작업·상태·등록만 표시) */
export function TaskTable({ tasks, emptyText = '작업이 없습니다.', compact = false }: { tasks: Task[]; emptyText?: string; compact?: boolean }) {
  if (tasks.length === 0) return <Empty>{emptyText}</Empty>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>작업</th>
            {!compact && <th>부서</th>}
            {!compact && <th>프로젝트</th>}
            {!compact && <th>우선순위</th>}
            <th>상태</th>
            <th>등록</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((t) => (
            <tr key={t.id}>
              <td className="cell-title"><Link to={`/tasks/${t.id}`}>{t.title}</Link></td>
              {!compact && <td>{DEPARTMENT_LABELS[t.department]}</td>}
              {!compact && <td>{t.projectId ? <Link to={`/projects/${t.projectId}`}>{t.projectName}</Link> : <span className="muted">—</span>}</td>}
              {!compact && <td><PriorityBadge priority={t.priority} /></td>}
              <td><StatusBadge status={t.status} /></td>
              <td className="nowrap muted">{fmtDateTime(t.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
