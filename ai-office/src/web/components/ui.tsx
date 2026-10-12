import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  DEPARTMENT_LABELS,
  PRIORITY_LABELS,
  TASK_STATUS_LABELS,
  type Department,
  type Priority,
  type TaskStatus,
} from '../../shared/types.js';

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

export function Card({ title, right, children, className }: { title?: string; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className ?? ''}`}>
      {(title || right) && (
        <div className="card-head">
          {title && <h2>{title}</h2>}
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

export function StatusBadge({ status }: { status: TaskStatus }) {
  return <span className={`badge status-${status}`}>{TASK_STATUS_LABELS[status]}</span>;
}

export function PriorityBadge({ priority }: { priority: Priority }) {
  return <span className={`badge prio-${priority}`}>{PRIORITY_LABELS[priority]}</span>;
}

/** 아직 만들지 않은 기능에 붙이는 표시. 정상 기능처럼 보이지 않게 하기 위함입니다. */
export function Soon({ stage, label }: { stage: number; label?: string }) {
  return <span className="badge soon">{label ?? '미구현'} · {stage}단계</span>;
}

export function Notice({ kind = 'info', children }: { kind?: 'info' | 'warn' | 'error'; children: ReactNode }) {
  return <div className={`notice notice-${kind}`} role={kind === 'error' ? 'alert' : undefined}>{children}</div>;
}

export function ErrorBox({ message }: { message: string | undefined }) {
  return message ? <Notice kind="error">{message}</Notice> : null;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Stat({ label, value, to, tone }: { label: string; value: ReactNode; to?: string; tone?: 'danger' | 'accent' }) {
  const body = (
    <>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </>
  );
  const cls = `stat ${tone ? `stat-${tone}` : ''}`;
  return to ? <Link className={cls} to={to}>{body}</Link> : <div className={cls}>{body}</div>;
}

export const departmentLabel = (d: Department) => DEPARTMENT_LABELS[d];
