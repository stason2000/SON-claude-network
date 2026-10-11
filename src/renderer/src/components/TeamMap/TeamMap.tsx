import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore, type Agent } from '@/store/store';
import { DEPARTMENTS, preferredFor, type DepartmentsConfig } from '@shared/departments';
import { getConnector } from '@shared/connectors';
import { MAP_DEPARTMENT_IDS, groupAgentsByDepartment, lineStateFor, type LineState, type MapDepartmentId } from '@shared/departmentMap';
import { LIST_BREAKPOINT } from '@shared/floorPlan';
import { useResolvedGodName } from '@/hooks/useResolvedGodName';
import { useMeetingRecorder } from '@/components/workspace/meetingRecorder';
import { AgentLogo } from './AgentLogo';
import { MapStyleToggle } from './mapStyle';
import { OfficePlan } from './OfficePlan';
import { ACCENT, AgentCardNode, DeptIcon, LIVE, StatusChip, cardPropsFor, describeAgent, mascotOf, onAgentKey, openAgent, selectAgent, statusLabel } from './parts';
import './teamMap.css';

/**
 * 팀 지도 — the smooth replacement for the pixel office floor: a flat top-down
 * office plan (OfficePlan) with 팀장 Michael's desk in the centre of the hall and
 * one coloured room per department. Below LIST_BREAKPOINT px it becomes a plain
 * list of department cards so text never drops under 13px.
 * Pure React + inline SVG/CSS: no canvas, no WebGL, no per-frame JS.
 */
export function TeamMap({ departments }: { departments?: DepartmentsConfig }) {
  const { t } = useTranslation();
  const agents = useStore((s) => s.agents);
  const selectedId = useStore((s) => s.selectedId);
  const godStatus = useStore((s) => s.godStatus);
  const godName = useResolvedGodName();
  const meeting = useMeetingRecorder();
  const meetingActive = meeting.status === 'recording' || meeting.status === 'stopping';
  const bodyRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const god = agents.find((a) => a.isGod);
  const groups = useMemo(() => groupAgentsByDepartment(agents, departments), [agents, departments]);
  const lineStates = useMemo(() => {
    const out = {} as Record<MapDepartmentId, LineState>;
    for (const id of MAP_DEPARTMENT_IDS) out[id] = lineStateFor(groups[id].map((a) => a.status));
    return out;
  }, [groups]);

  const workers = agents.filter((a) => !a.isGod);
  const liveCount = workers.filter((a) => LIVE.has(a.status)).length;
  const alertCount = workers.filter((a) => a.status === 'blocked').length;
  const empty = workers.length === 0;

  const deptLabel = (id: MapDepartmentId) => (id === 'other' ? t('extra.teamMap.other') : t(`extra.departments.name.${id}`));
  const bossStatusKey = god ? god.status : godStatus === 'failed' ? 'blocked' : 'thinking';
  const bossChip = god ? statusLabel(t, god.status) : t(godStatus === 'failed' ? 'extra.teamMap.godFailed' : 'extra.teamMap.godBooting');
  const bossName = god?.name ?? godName;

  /** "Claude Code, Codex 같은 AI 직원이 여기에 들어와요" — the department's usable AIs. */
  const emptyHints = useMemo(() => {
    const out: Partial<Record<MapDepartmentId, string>> = {};
    for (const d of DEPARTMENTS) {
      out[d.id] = preferredFor(d, departments)
        .map((id) => getConnector(id))
        .filter((c) => c && c.kind !== 'unavailable')
        .slice(0, 2)
        .map((c) => c!.label)
        .join(', ');
    }
    return out;
  }, [departments]);

  const cta = empty ? (
    <div className="tm-empty">
      <span className="tm-empty-text">{t('extra.teamMap.emptyLine')}</span>
      <button type="button" className="tm-add" onClick={() => useStore.getState().setAddAgentOpen(true)}>
        <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" /></svg>
        {t('extra.app.addAgent')}
      </button>
    </div>
  ) : null;

  const listMode = width > 0 && width < LIST_BREAKPOINT;

  return (
    <div className="tm-root" aria-label={t('extra.teamMap.title')} role="region">
      <div className="tm-header">
        <span className="tm-header-title">{t('extra.teamMap.title')}</span>
        <span className="tm-header-sum">{t('extra.teamMap.summary', { count: workers.length })}
          {liveCount > 0 && <> · <b>{t('extra.teamMap.workingCount', { count: liveCount })}</b></>}
          {alertCount > 0 && <> · <b style={{ color: 'var(--cth-status-blocked)' }}>{t('extra.teamMap.alertCount', { count: alertCount })}</b></>}
        </span>
        <MapStyleToggle />
      </div>
      <div ref={bodyRef} className={listMode ? 'tm-scroll' : 'tm-scroll fp-root'}>
        {width > 0 && !listMode && (
          <OfficePlan
            groups={groups}
            lineStates={lineStates}
            god={god}
            bossName={bossName}
            bossChip={bossChip}
            bossStatusKey={bossStatusKey}
            selectedId={selectedId}
            meetingActive={meetingActive}
            deptLabel={deptLabel}
            emptyCta={cta}
          />
        )}
        {listMode && (
          <TeamList
            groups={groups}
            lineStates={lineStates}
            god={god}
            bossName={bossName}
            bossChip={bossChip}
            bossStatusKey={bossStatusKey}
            selectedId={selectedId}
            deptLabel={deptLabel}
            emptyHints={emptyHints}
            cta={cta}
          />
        )}
      </div>
    </div>
  );
}

/** Narrow fallback: 팀장 card on top, then one card per department (always readable). */
function TeamList(p: {
  groups: Record<MapDepartmentId, Agent[]>;
  lineStates: Record<MapDepartmentId, LineState>;
  god: Agent | undefined;
  bossName: string; bossChip: string; bossStatusKey: string;
  selectedId: string | null;
  deptLabel: (id: MapDepartmentId) => string;
  emptyHints: Partial<Record<MapDepartmentId, string>>;
  cta: React.ReactNode;
}) {
  const { t } = useTranslation();
  const god = p.god;
  const godLine = god ? describeAgent(t, god) : null;
  const ids = MAP_DEPARTMENT_IDS.filter((id) => id !== 'other' || p.groups.other.length > 0);
  return (
    <div className="tm-list">
      <div
        className="tm-boss tm-list-boss"
        role="button"
        tabIndex={0}
        data-selected={!!god && god.id === p.selectedId}
        aria-label={t('extra.teamMap.bossAria', { name: p.bossName, status: p.bossChip, action: godLine?.line || '-' })}
        onClick={() => { if (god) selectAgent(god.id); }}
        onDoubleClick={() => { if (god) openAgent(god.id); }}
        onKeyDown={(e) => { if (god) onAgentKey(e, god.id); }}
      >
        <AgentLogo mascot={god ? mascotOf(god) : 'ai-claude'} size={48} status={god?.status} />
        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
          <span className="tm-boss-eyebrow">{t('extra.teamMap.leader')}</span>
          <div className="tm-boss-row">
            <span className="tm-boss-name">{p.bossName}</span>
            <StatusChip status={p.bossStatusKey} label={p.bossChip} />
          </div>
          {godLine?.line && <div className="tm-boss-action">{godLine.line}</div>}
        </div>
      </div>
      {p.cta}
      {ids.map((id) => {
        const list = p.groups[id];
        const label = p.deptLabel(id);
        const working = list.filter((a) => LIVE.has(a.status)).length;
        const alerts = list.filter((a) => a.status === 'blocked').length;
        const sub = alerts > 0
          ? t('extra.teamMap.alertCount', { count: alerts })
          : working > 0 ? t('extra.teamMap.workingCount', { count: working }) : list.length > 0 ? t('extra.teamMap.allIdle') : t('extra.teamMap.noneYet');
        return (
          <section
            key={id}
            className="tm-panel"
            data-state={p.lineStates[id]}
            aria-label={t('extra.teamMap.panelAria', { dept: label, count: list.length })}
            style={{ ['--tm-accent' as string]: ACCENT[id] }}
          >
            <header className="tm-panel-head">
              <span className="tm-panel-icon"><DeptIcon id={id} /></span>
              <div style={{ minWidth: 0 }}>
                <div className="tm-panel-title">{label}</div>
                <div className="tm-panel-sub" style={alerts > 0 ? { color: 'var(--cth-status-blocked)' } : undefined}>{sub}</div>
              </div>
              <span className="tm-panel-count" aria-hidden="true">{list.length}</span>
            </header>
            <div className="tm-panel-body">
              {list.length === 0 ? (
                <div className="tm-panel-empty">
                  {id === 'other' || !p.emptyHints[id] ? t('extra.teamMap.panelEmptyOther') : t('extra.teamMap.panelEmpty', { ais: p.emptyHints[id] })}
                </div>
              ) : list.map((a) => <AgentCardNode key={a.id} {...cardPropsFor(t, a, label, p.selectedId)} />)}
            </div>
          </section>
        );
      })}
    </div>
  );
}
