import { memo, type KeyboardEvent } from 'react';
import type { TFunction } from 'i18next';
import { useStore, type Agent } from '@/store/store';
import { actionText } from '@/i18n/actionText';
import { mascotForAgent, type MascotName } from '@/scene/office/aiMascotArt';
import { inferAgentProvider } from '@shared/agentProvider';
import type { MapDepartmentId } from '@shared/departmentMap';
import { AgentLogo } from './AgentLogo';

/** Shared bits of the 팀 지도: the floor plan (OfficePlan) and the narrow list view. */

export const ACCENT: Record<MapDepartmentId, string> = {
  coding: 'var(--cth-sky)',
  research: 'var(--cth-coral)',
  media: 'var(--cth-lilac)',
  review: 'var(--cth-lemon)',
  other: 'var(--cth-mint)'
};

/** Statuses that read as "busy right now". */
export const LIVE = new Set(['working', 'thinking', 'compacting', 'looping']);

export function DeptIcon({ id }: { id: MapDepartmentId }) {
  const p = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      {id === 'coding' && <><path {...p} d="M8.5 7 3.5 12l5 5" /><path {...p} d="m15.5 7 5 5-5 5" /><path {...p} d="m13.5 4.5-3 15" /></>}
      {id === 'research' && <><circle {...p} cx="10.5" cy="10.5" r="6" /><path {...p} d="m15 15 5.5 5.5" /></>}
      {id === 'media' && <><rect {...p} x="3.5" y="5" width="17" height="14" rx="3" /><circle {...p} cx="9" cy="10" r="1.6" /><path {...p} d="m20.5 16-5-5-8.5 8" /></>}
      {id === 'review' && <><path {...p} d="M12 3.5 19 6.5v5c0 4.3-3 7.6-7 9-4-1.4-7-4.7-7-9v-5z" /><path {...p} d="m8.8 12 2.2 2.2 4.4-4.4" /></>}
      {id === 'other' && <><circle cx="6" cy="12" r="1.7" fill="currentColor" /><circle cx="12" cy="12" r="1.7" fill="currentColor" /><circle cx="18" cy="12" r="1.7" fill="currentColor" /></>}
    </svg>
  );
}

/** First few words of the last prompt (same fallback the old floor's bubbles used). */
function firstWords(prompt: string | undefined, maxWords = 6, maxChars = 42): string {
  if (!prompt) return '';
  const words = prompt.trim().split(/\s+/);
  let out = words.slice(0, maxWords).join(' ');
  if (out.length > maxChars) out = out.slice(0, maxChars).trimEnd() + '…';
  else if (words.length > maxWords) out += '…';
  return out;
}

export const statusLabel = (t: TFunction, s: string): string => t(`badge.${s}`, { defaultValue: s });

/** The short "what is it doing" line: live action → last prompt → (blocked) the question → role. */
export function describeAgent(t: TFunction, a: Agent): { line: string; muted: boolean; live: string } {
  const live = actionText(a.action) || firstWords(a.lastPrompt);
  if (a.status === 'blocked') return { line: a.blockReason?.summary || live || t('extra.teamMap.needsYou'), muted: false, live };
  if (live && live !== statusLabel(t, a.status)) return { line: live, muted: false, live };
  return { line: a.description || '', muted: true, live: '' };
}

export const mascotOf = (a: Pick<Agent, 'command' | 'provider'>): MascotName =>
  mascotForAgent(inferAgentProvider(a.command, a.provider), a.command);

export function selectAgent(id: string): void { useStore.getState().select(id); }
/** "Open" = what the title-bar focus button does: the agent's terminal full-size. */
export function openAgent(id: string): void {
  const st = useStore.getState();
  st.select(id);
  if (st.agents.find((a) => a.id === id)?.ptyId) st.setFullscreen(id);
}
export function onAgentKey(e: KeyboardEvent, id: string): void {
  if (e.key === 'Enter') { e.preventDefault(); openAgent(id); }
  else if (e.key === ' ') { e.preventDefault(); selectAgent(id); }
}

export function StatusChip({ status, label }: { status: string; label: string }) {
  return (
    <span className="tm-chip" data-live={LIVE.has(status)} style={{ ['--tm-chip' as string]: `var(--cth-status-${status}, var(--cth-status-idle))` }}>
      <span className="tm-chip-dot" />{label}
    </span>
  );
}

export interface CardProps {
  id: string; name: string; status: string; statusLabel: string;
  line: string; muted: boolean; mascot: MascotName; selected: boolean; ariaLabel: string;
}

/** HTML agent card (list view + the "+N" popover). */
export const AgentCardNode = memo(function AgentCardNode(p: CardProps) {
  return (
    <div
      className="tm-card"
      role="button"
      tabIndex={0}
      aria-label={p.ariaLabel}
      aria-pressed={p.selected}
      data-selected={p.selected}
      data-status={p.status}
      onClick={() => selectAgent(p.id)}
      onDoubleClick={() => openAgent(p.id)}
      onKeyDown={(e) => onAgentKey(e, p.id)}
    >
      <AgentLogo mascot={p.mascot} size={38} status={p.status} />
      <div className="tm-card-main">
        <div className="tm-card-top">
          <span className="tm-card-name">{p.name}</span>
          <StatusChip status={p.status} label={p.statusLabel} />
        </div>
        {p.line && <div className="tm-card-action" data-muted={p.muted} title={p.line}>{p.line}</div>}
      </div>
    </div>
  );
});

/** Build card props for one agent. */
export function cardPropsFor(t: TFunction, a: Agent, deptLabel: string, selectedId: string | null): CardProps {
  const d = describeAgent(t, a);
  const sl = statusLabel(t, a.status);
  return {
    id: a.id, name: a.name, status: a.status, statusLabel: sl, line: d.line, muted: d.muted,
    mascot: mascotOf(a), selected: a.id === selectedId,
    ariaLabel: t('extra.teamMap.cardAria', { name: a.name, dept: deptLabel, status: sl, action: d.line || '-' })
  };
}
