import { NavLink, Route, Routes } from 'react-router-dom';
import { api } from './api';
import { Soon } from './components/ui';
import { useAsync } from './hooks';
import { Command } from './pages/Command';
import { Dashboard } from './pages/Dashboard';
import { DepartmentPage } from './pages/Department';
import { History } from './pages/History';
import { ProjectDetail } from './pages/ProjectDetail';
import { Projects } from './pages/Projects';
import { Settings } from './pages/Settings';
import { TaskDetailPage } from './pages/TaskDetailPage';
import type { SystemInfo } from '../shared/types.js';

const NAV: { group: string; items: { to: string; label: string; soon?: boolean; end?: boolean }[] }[] = [
  {
    group: '업무',
    items: [
      { to: '/', label: '메인 대시보드', end: true },
      { to: '/command', label: 'AI 총괄 관리실' },
      { to: '/dev', label: '개발 부서', soon: true },
      { to: '/research', label: '연구·분석 부서', soon: true },
      { to: '/trading', label: '자동매매 부서', soon: true },
    ],
  },
  {
    group: '관리',
    items: [
      { to: '/projects', label: '프로젝트 관리' },
      { to: '/history', label: '작업 기록' },
      { to: '/settings', label: 'API 및 시스템 설정' },
    ],
  },
];

export function App() {
  const sys = useAsync(() => api.get<SystemInfo>('/api/system'), [], 10000);
  const online = !!sys.data && !sys.error;

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">AI</span> OFFICE
        </div>
        <nav>
          {NAV.map((g) => (
            <div key={g.group} className="nav-group">
              <div className="nav-title">{g.group}</div>
              {g.items.map((i) => (
                <NavLink key={i.to} to={i.to} end={i.end} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                  {i.label}
                  {i.soon && <span className="nav-tag">준비 중</span>}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">
          <span className={`dot ${online ? 'on' : 'off'}`} />
          {online ? '서버 연결됨' : '서버 연결 끊김'}
          <div className="muted small">v{sys.data?.version ?? '—'} · 개발 {sys.data?.stage ?? 1}단계</div>
        </div>
      </aside>

      <div className="main">
        <div className="topbar">
          <span className="muted">개인용 · 로컬 실행</span>
          <span className="spacer" />
          <span className="muted small">AI 연결</span> <Soon stage={2} />
        </div>
        <main className="content">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/command" element={<Command />} />
            <Route path="/dev" element={<DepartmentPage department="dev" />} />
            <Route path="/research" element={<DepartmentPage department="research" />} />
            <Route path="/trading" element={<DepartmentPage department="trading" />} />
            <Route path="/projects" element={<Projects />} />
            <Route path="/projects/:id" element={<ProjectDetail />} />
            <Route path="/tasks/:id" element={<TaskDetailPage />} />
            <Route path="/history" element={<History />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<p className="muted">존재하지 않는 페이지입니다.</p>} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
