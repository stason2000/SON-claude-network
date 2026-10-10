/**
 * 회의 녹취 panel (#6) — disclosure gate, start/stop, live preview, saved files,
 * and "ask Michael to summarize" (queues the FILE PATH, not the text).
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PixelButton } from '../PixelButton';
import { PixelPanel } from '../PixelPanel';
import { Icon } from '../Icon';
import { useStore } from '@/store/store';
import { buildSummaryRequest, formatElapsed, type MeetingFileInfo, type MeetingStatus } from '@shared/meetings';
import { meetingElapsedMs, startMeeting, stopMeeting, useMeetingRecorder } from './meetingRecorder';

export function useMeetingElapsed(active: boolean): number {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const h = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(h);
  }, [active]);
  return meetingElapsedMs();
}

/** Small red "recording" pill — shown in the title bar on every view while a
 *  meeting is being recorded, so recording is never invisible. */
export function MeetingRecordingBadge() {
  const { t } = useTranslation();
  const rec = useMeetingRecorder();
  const active = rec.status === 'recording' || rec.status === 'stopping';
  const ms = useMeetingElapsed(active);
  if (!active) return null;
  return (
    <span
      className="cth-titlebar-nodrag"
      role="status"
      aria-live="polite"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '2px 8px', fontSize: 12, fontFamily: 'var(--cth-font-ui)',
        background: 'var(--cth-coral-light)', color: 'var(--cth-ink-900)',
        boxShadow: 'inset 0 0 0 1px var(--cth-coral)'
      }}
    >
      <span style={{ width: 8, height: 8, borderRadius: 4, background: 'var(--cth-coral)', animation: 'cth-ws-pulse 1.2s ease-in-out infinite' }} />
      {t('extra.workspace.meetings.recordingBadge', { time: formatElapsed(ms) })}
    </span>
  );
}

export function MeetingPanel() {
  const { t } = useTranslation();
  const rec = useMeetingRecorder();
  const [status, setStatus] = useState<MeetingStatus | null>(null);
  const [files, setFiles] = useState<MeetingFileInfo[]>([]);
  const [title, setTitle] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const recording = rec.status === 'recording' || rec.status === 'stopping';
  const ms = useMeetingElapsed(recording);
  const agents = useStore((s) => s.agents);
  const god = agents.find((a) => a.isGod && !a.archived);
  const enqueueMessage = useStore((s) => s.enqueueMessage);

  const refresh = useCallback(async () => {
    try { setStatus(await window.cth.meetingsStatus()); } catch { /* ignore */ }
    try {
      const r = await window.cth.meetingsList();
      if (r.ok) setFiles(r.files);
    } catch { /* ignore */ }
  }, []);
  useEffect(() => { void refresh(); }, [refresh, rec.status]);

  const setPrefs = async (patch: { consent?: boolean; keepAudio?: boolean }) => {
    setStatus(await window.cth.meetingsSetPrefs(patch));
  };

  const askSummary = async (name: string) => {
    setNote(null);
    if (!god) { setNote(t('extra.workspace.meetings.noGod')); return; }
    const r = await window.cth.meetingsPathFor(name);
    if (!r.ok) { setNote(r.error); return; }
    enqueueMessage(god.id, buildSummaryRequest(r.path));
    setNote(t('extra.workspace.meetings.summaryQueued', { name: god.name }));
  };

  if (!status) return <PanelShell title={t('extra.workspace.nav.meetings')}><p style={muted}>{t('extra.workspace.loading')}</p></PanelShell>;

  const groq = status.engines.find((e) => e.id === 'groq');
  const local = status.engines.find((e) => e.id === 'local');

  // ── Disclosure gate (before first use, and whenever consent is withdrawn) ──
  if (!status.consent) {
    return (
      <PanelShell title={t('extra.workspace.meetings.disclosureTitle')}>
        <ul style={{ margin: 0, paddingInlineStart: 18, fontSize: 13, lineHeight: '21px', color: 'var(--cth-ink-900)' }}>
          <li>{t('extra.workspace.meetings.d1')}</li>
          <li>{t('extra.workspace.meetings.d2')}</li>
          <li>{t('extra.workspace.meetings.d3')}</li>
          <li>{t('extra.workspace.meetings.d4')}</li>
          <li><b>{t('extra.workspace.meetings.d5')}</b></li>
          <li>{t('extra.workspace.meetings.d6')}</li>
          <li>{t('extra.workspace.meetings.d7')}</li>
        </ul>
        <EngineRows groq={groq} local={local} />
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <PixelButton variant="primary" size="md" onClick={() => { void setPrefs({ consent: true }); }}>
            {t('extra.workspace.meetings.accept')}
          </PixelButton>
        </div>
        <p style={{ ...muted, marginTop: 8 }}>{t('extra.workspace.meetings.offByDefault')}</p>
      </PanelShell>
    );
  }

  const canStart = rec.status === 'idle' && !!groq?.available;
  return (
    <PanelShell title={t('extra.workspace.nav.meetings')}>
      <EngineRows groq={groq} local={local} />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: 10 }}>
        <input
          value={recording ? rec.title : title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={rec.status !== 'idle'}
          placeholder={t('extra.workspace.meetings.titlePlaceholder')}
          maxLength={120}
          style={{
            flex: '1 1 200px', minWidth: 0, height: 32, padding: '0 8px',
            fontSize: 13, fontFamily: 'var(--cth-font-ui)',
            background: 'var(--cth-paper-100)', color: 'var(--cth-ink-900)',
            border: 'none', boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)'
          }}
        />
        {recording ? (
          <PixelButton variant="destructive" size="md" onClick={() => { void stopMeeting(); }} disabled={rec.status === 'stopping'}>
            <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
              <Icon name="pause" /> {rec.status === 'stopping' ? t('extra.workspace.meetings.stopping') : t('extra.workspace.meetings.stop')}
            </span>
          </PixelButton>
        ) : (
          <PixelButton variant="primary" size="md" disabled={!canStart} onClick={() => { void startMeeting(title); }}>
            <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
              <Icon name="mic" /> {rec.status === 'starting' ? t('extra.workspace.meetings.starting') : t('extra.workspace.meetings.start')}
            </span>
          </PixelButton>
        )}
      </div>

      <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, marginTop: 8, color: 'var(--cth-ink-900)' }}>
        <input
          type="checkbox"
          checked={status.keepAudio}
          disabled={rec.status !== 'idle'}
          onChange={(e) => { void setPrefs({ keepAudio: e.target.checked }); }}
        />
        {t('extra.workspace.meetings.keepAudio')}
      </label>
      <p style={{ ...muted, marginTop: 2 }}>{t('extra.workspace.meetings.keepAudioHint')}</p>

      {recording && (
        <div style={{
          marginTop: 10, padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 8,
          background: 'var(--cth-coral-light)', boxShadow: 'inset 0 0 0 1px var(--cth-coral)', fontSize: 13
        }}>
          <span style={{ width: 10, height: 10, borderRadius: 5, background: 'var(--cth-coral)', animation: 'cth-ws-pulse 1.2s ease-in-out infinite' }} />
          <b>{t('extra.workspace.meetings.recordingNow')}</b>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatElapsed(ms)} / {formatElapsed(status.maxMs)}</span>
          <span style={{ marginInlineStart: 'auto', color: 'var(--cth-ink-700)' }}>{t('extra.workspace.meetings.tellParticipants')}</span>
        </div>
      )}
      {!recording && <p style={{ ...muted, marginTop: 8 }}>{t('extra.workspace.meetings.tellParticipantsBefore')}</p>}
      {rec.error && <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--cth-coral)' }}>{rec.error}</p>}
      {rec.lastSaved && (
        <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--cth-ink-900)' }}>
          {t('extra.workspace.meetings.saved', { name: rec.lastSaved.fileName, failed: rec.lastSaved.failed, gaps: rec.lastSaved.gaps })}
        </p>
      )}

      {(recording || rec.preview.length > 0) && (
        <>
          <SectionTitle>{t('extra.workspace.meetings.preview')}</SectionTitle>
          <div style={{
            maxHeight: 220, overflowY: 'auto', padding: 8, fontSize: 13, lineHeight: '20px',
            background: 'var(--cth-paper-100)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)', whiteSpace: 'pre-wrap'
          }}>
            {rec.preview.length === 0
              ? <span style={muted}>{t('extra.workspace.meetings.previewEmpty')}</span>
              : rec.preview.map((l, i) => <div key={i}>{l.replace(/\*\*/g, '')}</div>)}
          </div>
        </>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14 }}>
        <SectionTitle>{t('extra.workspace.meetings.savedFiles')}</SectionTitle>
        <span style={{ marginInlineStart: 'auto' }} />
        <PixelButton variant="secondary" size="sm" onClick={() => { void window.cth.meetingsOpenFolder().then((r) => { if (!r.ok) setNote(r.error ?? ''); }); }}>
          <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><Icon name="folder" /> {t('extra.workspace.meetings.openFolder')}</span>
        </PixelButton>
      </div>
      {note && <p style={{ margin: '4px 0', fontSize: 13, color: 'var(--cth-ink-700)' }}>{note}</p>}
      {files.length === 0 ? (
        <p style={muted}>{t('extra.workspace.meetings.noFiles')}</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {files.map((f) => (
            <div key={f.name} style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '4px 6px', fontSize: 13,
              background: 'var(--cth-cream-50)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)'
            }}>
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={f.path}>{f.name}</span>
              <span style={{ color: 'var(--cth-ink-500)', fontSize: 12 }}>{Math.max(1, Math.round(f.size / 1024))}KB</span>
              <PixelButton variant="secondary" size="sm" onClick={() => { void window.cth.meetingsOpenFile(f.name); }}>
                {t('extra.workspace.meetings.open')}
              </PixelButton>
              <PixelButton
                variant="secondary"
                size="sm"
                disabled={recording && rec.fileName === f.name}
                onClick={() => { void askSummary(f.name); }}
              >
                {t('extra.workspace.meetings.askSummary', { name: god?.name ?? '' })}
              </PixelButton>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <PixelButton variant="ghost" size="sm" disabled={rec.status !== 'idle'} onClick={() => { void setPrefs({ consent: false }); }}>
          {t('extra.workspace.meetings.withdraw')}
        </PixelButton>
      </div>
    </PanelShell>
  );
}

function EngineRows({ groq, local }: { groq?: MeetingStatus['engines'][number]; local?: MeetingStatus['engines'][number] }) {
  const { t } = useTranslation();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 10, fontSize: 13 }}>
      <div>
        <b>{t('extra.workspace.meetings.engineGroq')}</b>{' '}
        {groq?.available ? t('extra.workspace.meetings.engineReady') : (groq?.reason ?? t('extra.workspace.meetings.engineNotReady'))}
      </div>
      <div style={{ color: 'var(--cth-ink-500)' }}>
        <b>{t('extra.workspace.meetings.engineLocal')}</b>{' '}
        {local?.available ? t('extra.workspace.meetings.engineReady') : t('extra.workspace.meetings.engineNotReady')}
      </div>
    </div>
  );
}

function PanelShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <PixelPanel variant="default" noPadding style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{
        padding: '8px 12px', borderBottom: '1px solid var(--cth-ink-700)', background: 'var(--cth-cream-100)',
        fontFamily: 'var(--cth-font-display)', fontSize: 10, lineHeight: '14px', color: 'var(--cth-ink-900)'
      }}>{title}</div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 12, maxWidth: 820 }}>{children}</div>
    </PixelPanel>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div style={{ marginTop: 12, marginBottom: 4, fontSize: 12, fontWeight: 600, color: 'var(--cth-ink-700)' }}>{children}</div>;
}

const muted: React.CSSProperties = { margin: 0, fontSize: 12, lineHeight: '18px', color: 'var(--cth-ink-500)' };
