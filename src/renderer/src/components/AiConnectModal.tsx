import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { connectedVia, type ApiConnector, type CliConnector, type Connector } from '@shared/connectors';
import { PixelPanel } from './PixelPanel';
import { PixelButton } from './PixelButton';
import { CliLoginButton, KeyPageButton, MethodBadge } from './ConnectorBits';
import { ConnectionTestButton, EndpointEditor, FreeLlmApiGuide } from './ConnectorsSettings';
import { UsageLimitsTab } from './UsageLimitsTab';
import { recheckCli, refreshAiConnections, setCliConnected, setHasKey, useAiConnections } from './aiConnections';

/**
 * "AI 연결" — a standalone window listing ONLY the AIs that still need connecting.
 * An AI leaves the list the moment it is connected (API: key stored; CLI: a
 * documented status command says so, or the person pressed "연결했어요").
 * Settings → 연결부 stays the full power-user view.
 */

const card: CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 12px',
  background: 'var(--cth-paper-100)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)'
};
const small: CSSProperties = { fontSize: 12, lineHeight: '17px', color: 'var(--cth-ink-700)' };
const inputStyle: CSSProperties = {
  flex: 1, minWidth: 0, padding: '4px 8px 2px', background: 'var(--cth-paper-100)', border: 'none',
  boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)', fontFamily: 'var(--cth-font-mono)', fontSize: 12,
  color: 'var(--cth-ink-900)', outline: 'none'
};
const linkBtn: CSSProperties = {
  background: 'none', border: 'none', padding: 0, cursor: 'pointer',
  fontSize: 12, color: 'var(--cth-ink-700)', textDecoration: 'underline', fontFamily: 'inherit'
};

export function AiConnectModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const s = useAiConnections();
  const [showConnected, setShowConnected] = useState(false);
  const [notice, setNotice] = useState('');
  const [tab, setTab] = useState<'connect' | 'usage'>('connect');
  const lastFocusCheck = useRef(0);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    void refreshAiConnections({ cli: true });
    // Coming back from a login window / browser: re-check (at most every 10 s).
    const onFocus = (): void => {
      const now = Date.now();
      if (now - lastFocusCheck.current < 10_000) return;
      lastFocusCheck.current = now;
      void refreshAiConnections({ cli: true });
    };
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') closeRef.current(); };
    window.addEventListener('focus', onFocus);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('focus', onFocus); window.removeEventListener('keydown', onKey); };
  }, []);

  // Things the person can do right now first; "please install it first" cards last.
  const pending = [...s.pending].sort((a, b) =>
    Number(s.cliCheck[a.id]?.state === 'not-installed') - Number(s.cliCheck[b.id]?.state === 'not-installed'));

  const announce = (c: Connector): void => setNotice(t('extra.aiConnect.justConnected', { label: c.label }));

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(26, 19, 32, 0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300
      }}
    >
      <div
        className="cth-readable"
        role="dialog"
        aria-label={t('extra.aiConnect.title')}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 640, maxWidth: 'calc(92vw / 1.2)', maxHeight: 'calc(88vh / 1.2)',
          display: 'flex', flexDirection: 'column',
          filter: 'drop-shadow(4px 4px 0 rgba(26, 19, 32, 0.25))'
        }}
      >
        <PixelPanel
          variant="dialog"
          title={t('extra.aiConnect.title')}
          noPadding
          style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', maxHeight: 'calc(88vh / 1.2)' }}
        >
          <div role="tablist" aria-label={t('extra.aiConnect.title')} style={{ display: 'flex', gap: 0, padding: '10px 16px 0', boxShadow: 'inset 0 -1px 0 var(--cth-ink-300)' }}>
            {(['connect', 'usage'] as const).map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                id={`ai-connect-tab-${id}`}
                aria-selected={tab === id}
                aria-controls={`ai-connect-panel-${id}`}
                onClick={() => setTab(id)}
                style={{
                  padding: '6px 14px 5px', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                  fontSize: 13, fontWeight: tab === id ? 700 : 500,
                  color: tab === id ? 'var(--cth-ink-900)' : 'var(--cth-ink-700)',
                  background: tab === id ? 'var(--cth-paper-100)' : 'transparent',
                  boxShadow: tab === id ? 'inset 0 0 0 1px var(--cth-ink-300), inset 0 -3px 0 var(--cth-sky)' : 'none'
                }}
              >
                {id === 'connect' ? t('extra.usage.tabConnect') : t('extra.usage.tabUsage')}
              </button>
            ))}
          </div>
          {tab === 'usage' && (
            <div role="tabpanel" id="ai-connect-panel-usage" aria-labelledby="ai-connect-tab-usage" style={{ padding: 16, overflowY: 'auto', minHeight: 0 }}>
              <UsageLimitsTab onGoConnect={() => setTab('connect')} />
            </div>
          )}
          {tab === 'connect' && (
          <div role="tabpanel" id="ai-connect-panel-connect" aria-labelledby="ai-connect-tab-connect" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto', minHeight: 0 }}>
            <div style={{ fontSize: 13, lineHeight: '19px', color: 'var(--cth-ink-900)' }}>{t('extra.aiConnect.intro')}</div>
            {notice && (
              <div role="status" style={{ ...small, color: 'var(--cth-ink-900)', padding: '6px 10px', background: 'var(--cth-mint-light, var(--cth-cream-100))', boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)' }}>
                {notice}
              </div>
            )}
            {s.checking && <div style={small}>{t('extra.aiConnect.checking')}</div>}

            {s.loaded && s.pending.length === 0 && !s.checking && (
              <div style={{ ...card, alignItems: 'center', textAlign: 'center', padding: '24px 12px' }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--cth-ink-900)' }}>{t('extra.aiConnect.allDone')}</div>
                <div style={small}>{t('extra.aiConnect.allDoneHint')}</div>
              </div>
            )}

            {pending.map((c) => (
              <div key={c.id} style={card}>
                <CardHead connector={c} />
                {c.kind === 'cli' && <CliConnectBody connector={c} onConnected={() => announce(c)} />}
                {c.kind === 'api' && <ApiConnectBody connector={c} onConnected={() => announce(c)} />}
              </div>
            ))}

            {s.connected.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
                <button type="button" style={{ ...linkBtn, alignSelf: 'flex-start' }} onClick={() => setShowConnected((v) => !v)} aria-expanded={showConnected}>
                  {showConnected ? t('extra.aiConnect.hideConnected') : t('extra.aiConnect.showConnected', { count: s.connected.length })}
                </button>
                {showConnected && s.connected.map((c) => (
                  <ConnectedRow key={c.id} connector={c} via={connectedVia(c, s) ?? 'manual'} />
                ))}
              </div>
            )}
          </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '10px 16px', boxShadow: 'inset 0 1px 0 var(--cth-ink-100)' }}>
            {tab === 'connect' && (
              <PixelButton size="sm" variant="ghost" onClick={() => void refreshAiConnections({ cli: true })} disabled={s.checking}>
                {t('extra.aiConnect.recheckAll')}
              </PixelButton>
            )}
            <PixelButton size="sm" onClick={onClose}>{t('extra.aiConnect.close')}</PixelButton>
          </div>
        </PixelPanel>
      </div>
    </div>
  );
}

function CardHead({ connector: c }: { connector: Connector }) {
  const { t } = useTranslation();
  const good = c.strengths.map((x) => t(`extra.connectors.strength.${x}`)).join(' · ');
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--cth-ink-900)' }}>{c.label}</span>
        <MethodBadge connector={c} />
      </div>
      {good && <div style={small}>{t('extra.aiConnect.goodAt', { list: good })}</div>}
    </>
  );
}

function CliConnectBody({ connector: c, onConnected }: { connector: CliConnector; onConnected: () => void }) {
  const { t } = useTranslation();
  const s = useAiConnections();
  const check = s.cliCheck[c.id];
  const hasStatus = !!c.login?.status;

  if (check?.state === 'not-installed') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ ...small, color: 'var(--cth-ink-900)' }}>{t('extra.connectors.login.notInstalled', { label: c.label })}</span>
        {c.docsUrl && (
          <a href={c.docsUrl} onClick={(e) => { e.preventDefault(); void window.cth.openExternal(c.docsUrl!); }} style={{ ...small, textDecoration: 'underline' }}>
            {t('extra.connectors.login.installDocs')}
          </a>
        )}
        <div>
          <PixelButton size="sm" variant="ghost" onClick={() => void recheckCli(c.id)}>{t('extra.aiConnect.recheck')}</PixelButton>
        </div>
      </div>
    );
  }

  // A documented status command ran and gave a clear answer → no manual button.
  const autoAnswered = !!check?.auto;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={small}>{t('extra.aiConnect.cliStep')}</span>
      <CliLoginButton connector={c} />
      {!check && <span style={small}>{t('extra.aiConnect.checking')}</span>}
      {check && autoAnswered && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={small}>{t('extra.aiConnect.autoHint')}</span>
          <PixelButton size="sm" variant="ghost" onClick={() => void recheckCli(c.id)}>{t('extra.aiConnect.recheck')}</PixelButton>
        </div>
      )}
      {check && !autoAnswered && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' }}>
          <span style={small}>{hasStatus ? t('extra.aiConnect.manualHintAutoFailed') : t('extra.aiConnect.manualHint')}</span>
          <PixelButton size="sm" onClick={() => { void setCliConnected(c.id, true).then(onConnected); }}>
            {t('extra.aiConnect.markDone')}
          </PixelButton>
        </div>
      )}
    </div>
  );
}

function ApiConnectBody({ connector: c, onConnected }: { connector: ApiConnector; onConnected: () => void }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState('');
  const save = async (): Promise<void> => {
    const key = draft.trim();
    if (!key) return;
    // Clear the field at once — the plaintext should not linger in React state.
    setDraft('');
    try {
      const r = await window.cth.connectorKeySet({ id: c.id, key });
      if (r.ok) { setHasKey(c.id, true); onConnected(); }
      else setNote(`${t('extra.connectors.failed')} ${r.error ?? ''}`);
    } catch {
      setNote(t('extra.connectors.failed'));
    }
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {c.id === 'freellmapi' && <FreeLlmApiGuide />}
      {c.api.editableEndpoint && <EndpointEditor connector={c} />}
      <span style={small}>{t('extra.aiConnect.apiStep')}</span>
      <div><KeyPageButton connector={c} /></div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={draft}
          aria-label={t('extra.aiConnect.keyLabel', { label: c.label })}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void save(); }}
          placeholder={t('extra.connectors.keyPlaceholder', { hint: c.keyFormatHint })}
          style={inputStyle}
        />
        <PixelButton size="sm" onClick={() => void save()} disabled={!draft.trim()}>{t('extra.connectors.save')}</PixelButton>
      </div>
      <span style={{ ...small, fontSize: 11 }}>{note ? `${note} · ` : ''}{t('extra.aiConnect.keySafe')}</span>
      {c.connectionTest === 'models' && <span style={{ ...small, fontSize: 11 }}>{t('extra.aiConnect.testAfterSave')}</span>}
    </div>
  );
}

function ConnectedRow({ connector: c, via }: { connector: Connector; via: 'key' | 'auto' | 'manual' }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const disconnect = async (): Promise<void> => {
    if (c.kind === 'api') {
      if (!window.confirm(t('extra.aiConnect.confirmClearKey', { label: c.label }))) return;
      setBusy(true);
      try {
        const r = await window.cth.connectorKeyClear(c.id);
        if (r.ok) setHasKey(c.id, false);
      } catch { /* noop */ } finally { setBusy(false); }
    } else if (c.kind === 'cli') {
      setBusy(true);
      await setCliConnected(c.id, false);
      setBusy(false);
    }
  };
  return (
    <div style={{ ...card, background: 'var(--cth-cream-100)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)', padding: '8px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--cth-ink-900)' }}>{c.label}</span>
        <MethodBadge connector={c} />
        <span style={small}>{t(`extra.aiConnect.via.${via}`)}</span>
        <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6 }}>
          {via === 'auto'
            ? <PixelButton size="sm" variant="ghost" onClick={() => void recheckCli(c.id)}>{t('extra.aiConnect.recheck')}</PixelButton>
            : <PixelButton size="sm" variant="ghost" onClick={() => void disconnect()} disabled={busy}>{t('extra.aiConnect.disconnect')}</PixelButton>}
        </span>
      </div>
      {via === 'auto' && <span style={{ ...small, fontSize: 11 }}>{t('extra.aiConnect.autoLogoutHint')}</span>}
      {via !== 'auto' && <span style={{ ...small, fontSize: 11 }}>{t('extra.aiConnect.disconnectHint')}</span>}
      {c.kind === 'api' && c.connectionTest === 'models' && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}><ConnectionTestButton connector={c} /></div>
      )}
    </div>
  );
}
