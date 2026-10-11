/**
 * 작업 공간 (workspace) view (#6) — an alternative layout to the classic office
 * floor, built only from panels that already exist:
 *
 *   sidebar  : office sections (할 일 / 알림함 / 자동화 / 기억 / 도우미 기능 / 회의 녹취)
 *              then every live agent with a status dot + status word
 *   main     : the chosen section, or the selected agent's "room"
 *              - the orchestrator's room is the existing CommandCenterPanel
 *                (terminal + queue, floor/budget, board, routing log, triggers…)
 *              - any other agent's room: conversation + queue composer on one
 *                side, its live terminal (the pooled PtyTerminalView) on the other
 *
 * Opt-in: the classic view stays the default; the title-bar toggle switches.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PixelPanel } from '../PixelPanel';
import { PixelBadge } from '../PixelBadge';
import { PixelButton } from '../PixelButton';
import { Icon, type IconName } from '../Icon';
import { SpritePortrait } from '../SpritePortrait';
import { PtyTerminalView } from '../PtyTerminalView';
import { MessageQueueComposer } from '../MessageQueueComposer';
import { CommandCenterPanel, MemoryTab } from '../CommandCenterPanel';
import { TasksKanban } from '../TasksKanban';
import { AskMeTab } from '../AskMeTab';
import { TriggersTab } from '../triggers/TriggersTab';
import { SkillsTab } from '../SkillsTab';
import { ThreadsPanel } from '../ThreadsPanel';
import { RecentText } from '../RecentText';
import { AgentControlStrip } from '../AgentControlStrip';
import { terminalInstanceKey } from '../terminalRecovery';
import { MeetingPanel } from './MeetingPanel';
import { visualCharacter } from '@/scene/office/cast';
import { useStore, type Agent } from '@/store/store';
import { usePtyParser } from '@/hooks/usePtyParser';
import { useRestoreTeam } from '@/hooks/useRestoreTeam';
import type { HarnessConfig } from '@/store/config';
import {
  countNeedsYou,
  orderWorkspaceAgents,
  workspaceStatusColor,
  workspaceStatusLive,
  workspaceStatusWord
} from '@shared/workspace';

type Section = 'tasks' | 'inbox' | 'automations' | 'memory' | 'skills' | 'meetings';
type View = { kind: 'section'; section: Section } | { kind: 'agent'; id: string };

const SECTIONS: { key: Section; icon: IconName }[] = [
  { key: 'tasks', icon: 'check' },
  { key: 'inbox', icon: 'bell' },
  { key: 'automations', icon: 'clock' },
  { key: 'memory', icon: 'sparkle' },
  { key: 'skills', icon: 'mcp' },
  { key: 'meetings', icon: 'mic' }
];

const LS_VIEW = 'cth.workspaceView';

function loadView(): View {
  try {
    const raw = window.localStorage.getItem(LS_VIEW);
    if (raw && SECTIONS.some((s) => s.key === raw)) return { kind: 'section', section: raw as Section };
  } catch { /* noop */ }
  return { kind: 'agent', id: '' };
}

export function WorkspaceView({ config }: { config: HarnessConfig | null }) {
  const { t } = useTranslation();
  // The boot-time team restore lives in this hook; the classic agent strip is not
  // mounted in this view, so the workspace must run it too (shared module state —
  // it still runs only once).
  const { restoring, autoRestoring, restoreTeam } = useRestoreTeam(config);
  const restorableCount = useStore((s) => s.restorableAgents.length);
  const agents = useStore((s) => s.agents);
  const selectedId = useStore((s) => s.selectedId);
  const select = useStore((s) => s.select);
  const setAddAgentOpen = useStore((s) => s.setAddAgentOpen);
  const [view, setView] = useState<View>(loadView);

  const ordered = orderWorkspaceAgents(agents);
  const god = ordered.find((a) => a.isGod);
  const needsYou = countNeedsYou(agents);

  // An agent view follows the shared selection (so hold-Alt dictation and the
  // fullscreen button target the agent on screen, exactly as in classic).
  const roomAgent = view.kind === 'agent'
    ? (ordered.find((a) => a.id === (view.id || selectedId)) ?? god ?? ordered[0])
    : undefined;

  const openSection = (section: Section) => {
    setView({ kind: 'section', section });
    try { window.localStorage.setItem(LS_VIEW, section); } catch { /* noop */ }
  };
  const openAgent = (id: string) => {
    select(id);
    setView({ kind: 'agent', id });
    try { window.localStorage.setItem(LS_VIEW, 'agent'); } catch { /* noop */ }
  };

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 12, padding: 12 }}>
      <style>{'@keyframes cth-ws-pulse { 0%,100% { opacity: 1 } 50% { opacity: .35 } }'}</style>
      <PixelPanel variant="default" noPadding style={{ width: 232, flexShrink: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <nav aria-label={t('extra.workspace.navAria')} style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <GroupLabel>{t('extra.workspace.office')}</GroupLabel>
          {SECTIONS.map((s) => (
            <NavRow
              key={s.key}
              active={view.kind === 'section' && view.section === s.key}
              onClick={() => openSection(s.key)}
            >
              <Icon name={s.icon} />
              <span style={{ flex: 1, minWidth: 0 }}>{t(`extra.workspace.nav.${s.key}`)}</span>
              {s.key === 'inbox' && needsYou > 0 && (
                <span aria-label={t('extra.workspace.needsYouCount', { count: needsYou })} style={{
                  minWidth: 18, padding: '0 5px', fontSize: 11, lineHeight: '16px', textAlign: 'center',
                  background: 'var(--cth-status-blocked)', color: 'var(--cth-on-accent)'
                }}>{needsYou}</span>
              )}
            </NavRow>
          ))}

          <GroupLabel>{t('extra.workspace.team')}</GroupLabel>
          {ordered.length === 0 && <p style={{ margin: '2px 8px', fontSize: 12, color: 'var(--cth-ink-500)' }}>{t('extra.workspace.noAgents')}</p>}
          {ordered.map((a) => {
            const word = workspaceStatusWord(a);
            return (
              <NavRow key={a.id} active={view.kind === 'agent' && roomAgent?.id === a.id} onClick={() => openAgent(a.id)}>
                <span aria-hidden style={{
                  width: 8, height: 8, borderRadius: 4, flexShrink: 0, background: workspaceStatusColor(word),
                  animation: workspaceStatusLive(word) ? 'cth-ws-pulse 1.4s ease-in-out infinite' : undefined
                }} />
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {a.name}{a.isGod ? ` · ${t('extra.workspace.orchestrator')}` : ''}
                </span>
                <span style={{ fontSize: 11, color: word === 'needsYou' ? 'var(--cth-status-blocked)' : 'var(--cth-ink-500)', whiteSpace: 'nowrap' }}>
                  {t(`extra.workspace.status.${word}`)}
                </span>
              </NavRow>
            );
          })}
        </nav>
        <div style={{ padding: 8, borderTop: '1px solid var(--cth-ink-300)', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {(restorableCount > 0 || restoring || autoRestoring) && (
            <PixelButton variant="secondary" size="sm" fullWidth disabled={restoring || autoRestoring} onClick={() => { void restoreTeam(); }}>
              <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                <Icon name="play" /> {restoring || autoRestoring ? t('agentStrip.restoringTeam') : t('agentStrip.restoreTeam', { count: restorableCount })}
              </span>
            </PixelButton>
          )}
          <PixelButton variant="secondary" size="sm" fullWidth onClick={() => setAddAgentOpen(true)}>
            <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><Icon name="plus" /> {t('extra.app.addAgent')}</span>
          </PixelButton>
        </div>
      </PixelPanel>

      <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {view.kind === 'section' ? (
          <SectionBody section={view.section} god={god} />
        ) : roomAgent ? (
          roomAgent.isGod ? <CommandCenterPanel key={roomAgent.id} agent={roomAgent} /> : <AgentRoom key={roomAgent.id} agent={roomAgent} />
        ) : (
          <Frame title={t('extra.workspace.noAgents')}><Empty>{t('extra.app.emptyFloorBody')}</Empty></Frame>
        )}
      </div>
    </div>
  );
}

function SectionBody({ section, god }: { section: Section; god?: Agent }) {
  const { t } = useTranslation();
  if (section === 'meetings') return <MeetingPanel />;
  const title = t(`extra.workspace.nav.${section}`);
  return (
    <Frame title={title}>
      {section === 'tasks' && <TasksKanban />}
      {section === 'inbox' && <AskMeTab />}
      {section === 'automations' && <TriggersTab />}
      {section === 'memory' && (god ? <MemoryTab godId={god.id} /> : <Empty>{t('extra.workspace.needsGod')}</Empty>)}
      {section === 'skills' && <SkillsTab agentCwd={god?.cwd} />}
    </Frame>
  );
}

/** A worker's room: conversation (threads + latest reply + queue composer) on one
 *  side, its live terminal on the other. */
function AgentRoom({ agent }: { agent: Agent }) {
  const { t } = useTranslation();
  const updateAgent = useStore((s) => s.updateAgent);
  const setFullscreen = useStore((s) => s.setFullscreen);
  const fullscreenAgentId = useStore((s) => s.fullscreenAgentId);
  const onPtyStream = usePtyParser(agent.id);
  const word = workspaceStatusWord(agent);
  // The fullscreen overlay owns the pty while it shows this agent; two xterms on
  // one pty fight over its size (same rule as AgentDetailPanel).
  const fullscreenHere = fullscreenAgentId === agent.id;

  useEffect(() => {
    if (useStore.getState().selectedId !== agent.id) useStore.getState().select(agent.id);
  }, [agent.id]);

  return (
    <PixelPanel variant="default" noPadding style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
        background: 'var(--cth-cream-100)', borderBottom: '1px solid var(--cth-ink-700)', flexShrink: 0
      }}>
        <div style={{
          width: 32, height: 32, background: `var(--cth-${agent.accent}-light)`, boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)',
          display: 'flex', alignItems: 'flex-end', justifyContent: 'center', overflow: 'hidden', flexShrink: 0
        }}>
          <SpritePortrait character={visualCharacter(agent)} scale={1} />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontFamily: 'var(--cth-font-display)', fontSize: 10, lineHeight: '14px' }}>{agent.name.toUpperCase()}</div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 1, minWidth: 0 }}>
            <PixelBadge status={agent.status} label={t(`extra.workspace.status.${word}`)} />
            <span style={{ fontSize: 12, color: 'var(--cth-ink-500)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{agent.project}</span>
          </div>
        </div>
        <PixelButton variant="secondary" size="sm" onClick={() => useStore.getState().setIdeOpen(true, agent.id)}>
          <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><Icon name="code" /> {t('agentDetail.ide')}</span>
        </PixelButton>
        {agent.ptyId && (
          <PixelButton variant="secondary" size="sm" onClick={() => setFullscreen(agent.id)}>
            <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><Icon name="expand" /> {t('extra.workspace.focus')}</span>
          </PixelButton>
        )}
      </div>
      {agent.ptyId && <AgentControlStrip agentId={agent.id} />}

      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        {/* Conversation side */}
        <div style={{ width: '38%', minWidth: 280, maxWidth: 520, display: 'flex', flexDirection: 'column', borderInlineEnd: '1px solid var(--cth-ink-300)', minHeight: 0 }}>
          <SubTitle>{t('extra.workspace.conversation')}</SubTitle>
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
              <ThreadsPanel agentId={agent.id} />
            </div>
            {agent.recentAssistantText && (
              <div style={{ maxHeight: 180, overflowY: 'auto', flexShrink: 0 }}>
                <RecentText accent={agent.accent} text={agent.recentAssistantText} seed={agent.recentTextTs} />
              </div>
            )}
          </div>
          {agent.ptyId && <MessageQueueComposer agent={agent} />}
        </div>
        {/* Terminal side */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <SubTitle>{t('extra.workspace.terminal')}</SubTitle>
          <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
            {!agent.ptyId ? (
              <Empty>{t('agentDetail.noPtyDesc')}</Empty>
            ) : fullscreenHere ? (
              <Empty>{t('agentDetail.fullscreenDesc')}</Empty>
            ) : (
              <PtyTerminalView
                key={terminalInstanceKey(agent.ptyId, agent.terminalGeneration)}
                ptyId={agent.ptyId}
                onStreamData={onPtyStream}
                onUserPrompt={(text) => {
                  updateAgent(agent.id, { lastPrompt: text });
                  if (text.trim().toLowerCase() === '/clear') {
                    updateAgent(agent.id, { contextTokens: 0, contextLimit: undefined, progress: 0 });
                  }
                  void window.cth.historyAdd({ agentId: agent.id, cwd: agent.cwd, text });
                }}
                onToggleFullscreen={() => setFullscreen(agent.id)}
                fullscreen={false}
                embedded
              />
            )}
          </div>
        </div>
      </div>
    </PixelPanel>
  );
}

function Frame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <PixelPanel variant="default" noPadding style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{
        padding: '8px 12px', borderBottom: '1px solid var(--cth-ink-700)', background: 'var(--cth-cream-100)',
        fontFamily: 'var(--cth-font-display)', fontSize: 10, lineHeight: '14px', color: 'var(--cth-ink-900)', flexShrink: 0
      }}>{title}</div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>{children}</div>
    </PixelPanel>
  );
}

function NavRow({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '5px 8px',
        border: 'none', cursor: 'pointer', textAlign: 'start',
        background: active ? 'var(--cth-cream-300)' : 'transparent',
        boxShadow: active ? 'inset 0 0 0 1px var(--cth-ink-300)' : 'none',
        color: 'var(--cth-ink-900)', fontFamily: 'var(--cth-font-ui)', fontSize: 13
      }}
    >{children}</button>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      margin: '8px 8px 4px', fontFamily: 'var(--cth-font-display)', fontSize: 8, lineHeight: '12px',
      color: 'var(--cth-ink-500)', letterSpacing: 0.5
    }}>{children}</div>
  );
}

function SubTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      padding: '4px 10px', fontSize: 12, color: 'var(--cth-ink-500)', background: 'var(--cth-cream-200)',
      borderBottom: '1px solid var(--cth-ink-100)', flexShrink: 0
    }}>{children}</div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, textAlign: 'center', fontSize: 13, color: 'var(--cth-ink-700)' }}>
      {children}
    </div>
  );
}
