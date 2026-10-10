import { useEffect, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { listConnectors, apiAgentCommand, type Connector } from '@shared/connectors';
import { PixelButton } from './PixelButton';

/**
 * ConnectorsSettings — the read-only "연결부" list: every registered connector
 * with its kind, strengths and key status. API connectors get a WRITE-ONLY key
 * field (password input, save / clear). The renderer can only set, clear and ask
 * `has` — the key is never read back (src/main/apiKeys.ts).
 */

const headStyle: CSSProperties = {
  fontFamily: 'var(--cth-font-display)', fontSize: 8, lineHeight: '12px',
  color: 'var(--cth-ink-500)', textTransform: 'uppercase', marginBottom: 2
};
const chip: CSSProperties = {
  padding: '1px 6px 0', fontSize: 11, lineHeight: '16px',
  background: 'var(--cth-cream-100)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)',
  color: 'var(--cth-ink-700)'
};
const inputStyle: CSSProperties = {
  flex: 1, minWidth: 0, padding: '4px 8px 2px', background: 'var(--cth-paper-100)', border: 'none',
  boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)', fontFamily: 'var(--cth-font-mono)', fontSize: 12,
  color: 'var(--cth-ink-900)', outline: 'none'
};

export function ConnectorsSettings() {
  const { t, i18n } = useTranslation();
  const connectors = listConnectors();
  const [hasKey, setHasKey] = useState<Record<string, boolean>>({});
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [note, setNote] = useState<Record<string, string>>({});
  const ko = (i18n.language || '').startsWith('ko');

  useEffect(() => {
    let alive = true;
    (async () => {
      const out: Record<string, boolean> = {};
      for (const c of connectors) {
        if (c.kind !== 'api') continue;
        try { out[c.id] = await window.cth.connectorKeyHas(c.id); } catch { out[c.id] = false; }
      }
      if (alive) setHasKey(out);
    })();
    return () => { alive = false; };
  }, [connectors]);

  const save = async (id: string) => {
    const key = (draft[id] ?? '').trim();
    if (!key) return;
    // Clear the field immediately — the plaintext should not linger in React state.
    setDraft((s) => ({ ...s, [id]: '' }));
    try {
      const r = await window.cth.connectorKeySet({ id, key });
      if (r.ok) setHasKey((s) => ({ ...s, [id]: true }));
      setNote((s) => ({ ...s, [id]: r.ok ? t('extra.connectors.saved') : `${t('extra.connectors.failed')} ${r.error ?? ''}` }));
    } catch {
      setNote((s) => ({ ...s, [id]: t('extra.connectors.failed') }));
    }
  };
  const clear = async (id: string) => {
    try {
      const r = await window.cth.connectorKeyClear(id);
      if (r.ok) setHasKey((s) => ({ ...s, [id]: false }));
      setNote((s) => ({ ...s, [id]: r.ok ? t('extra.connectors.cleared') : t('extra.connectors.failed') }));
    } catch { /* noop */ }
  };

  const status = (c: Connector): string => {
    if (c.kind === 'cli') return t('extra.connectors.keyNotNeeded');
    if (c.kind === 'unavailable') return t('extra.connectors.unavailable', { reason: ko ? c.reason.ko : c.reason.en });
    return hasKey[c.id] ? t('extra.connectors.keySet') : t('extra.connectors.keyMissing');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div>
        <div style={headStyle}>{t('extra.connectors.title')}</div>
        <div style={{ fontSize: 12, color: 'var(--cth-ink-700)', lineHeight: '18px' }}>{t('extra.connectors.desc')}</div>
      </div>
      {connectors.map((c) => (
        <div
          key={c.id}
          style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '6px 8px', boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, color: 'var(--cth-ink-900)', fontWeight: 600 }}>{c.label}</span>
            <span style={{ ...chip, background: 'var(--cth-sky-light)' }}>{t(`extra.connectors.kind.${c.kind}`)}</span>
            {c.strengths.map((s) => (
              <span key={s} style={chip}>{t(`extra.connectors.strength.${s}`)}</span>
            ))}
            {!c.verified && <span style={{ ...chip, color: 'var(--cth-ink-500)' }}>{t('extra.connectors.unverified')}</span>}
            {c.docsUrl && (
              <a
                href={c.docsUrl}
                onClick={(e) => { e.preventDefault(); void window.cth.openExternal(c.docsUrl!); }}
                style={{ fontSize: 11, color: 'var(--cth-ink-700)', textDecoration: 'underline', marginLeft: 'auto' }}
              >{t('extra.connectors.docs')}</a>
            )}
          </div>
          <div style={{ fontSize: 12, color: c.kind === 'unavailable' ? 'var(--cth-ink-700)' : 'var(--cth-ink-500)', lineHeight: '16px' }}>
            {status(c)}
          </div>
          {c.kind === 'api' && (
            <>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={draft[c.id] ?? ''}
                  onChange={(e) => setDraft((s) => ({ ...s, [c.id]: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === 'Enter') void save(c.id); }}
                  placeholder={t('extra.connectors.keyPlaceholder', { hint: c.keyFormatHint })}
                  style={inputStyle}
                />
                <PixelButton size="sm" onClick={() => void save(c.id)} disabled={!(draft[c.id] ?? '').trim()}>
                  {t('extra.connectors.save')}
                </PixelButton>
                <PixelButton size="sm" variant="ghost" onClick={() => void clear(c.id)} disabled={!hasKey[c.id]}>
                  {t('extra.connectors.clear')}
                </PixelButton>
              </div>
              <div style={{ fontSize: 11, color: 'var(--cth-ink-500)' }}>
                {note[c.id] ? `${note[c.id]} · ` : ''}
                {t('extra.connectors.hireHint', { command: apiAgentCommand(c.id) })}
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
