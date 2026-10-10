import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { getConnector, listConnectors } from '@shared/connectors';
import {
  DEPARTMENTS, connectorFitsDepartment, preferredFor, resolveDepartment,
  type AvailabilityMap, type DepartmentId, type DepartmentsConfig
} from '@shared/departments';
import { RULES_SEED_MAX_CHARS } from '@shared/michaelSeed';
import type { HarnessConfig } from '@/store/config';
import { PixelButton } from './PixelButton';
import { loadConnectorAvailability } from '../hooks/michaelSeedText';

/**
 * Settings → "마이클 운영 규칙" (the workspace's michael-rules.md, saved directly
 * — it is a file, not a config field) and "부서별 AI" (department → connector,
 * STAGED through the modal's single Save like every other config setting).
 */

const headStyle: CSSProperties = {
  fontFamily: 'var(--cth-font-display)', fontSize: 8, lineHeight: '12px',
  color: 'var(--cth-ink-500)', textTransform: 'uppercase', marginBottom: 2
};
const descStyle: CSSProperties = { fontSize: 12, color: 'var(--cth-ink-700)', lineHeight: '18px' };
const chipBase: CSSProperties = { padding: '1px 6px 0', fontSize: 11, lineHeight: '16px', whiteSpace: 'nowrap' };
const selectStyle: CSSProperties = {
  minWidth: 0, padding: '2px 4px', background: 'var(--cth-paper-100)', border: 'none',
  boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)', fontFamily: 'var(--cth-font-ui)', fontSize: 12,
  color: 'var(--cth-ink-900)'
};

export function MichaelRulesSettings() {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [saved, setSaved] = useState('');
  const [path, setPath] = useState('');
  const [note, setNote] = useState('');
  const [loaded, setLoaded] = useState<'loading' | 'ok' | 'failed'>('loading');

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const r = await window.cth.michaelRulesGet();
        if (!alive) return;
        if (r.ok) {
          setText(r.text); setSaved(r.text); setPath(r.path); setLoaded('ok');
          if (r.createdFromDefault) setNote(t('extra.rules.createdFromDefault'));
        } else { setLoaded('failed'); setNote(`${t('extra.rules.loadFailed')} ${r.error}`); }
      } catch { if (alive) { setLoaded('failed'); setNote(t('extra.rules.loadFailed')); } }
    })();
    return () => { alive = false; };
  }, [t]);

  const save = async () => {
    try {
      const r = await window.cth.michaelRulesSet(text);
      if (r.ok) { setSaved(r.text); setNote(t('extra.rules.saved')); }
      else setNote(`${t('extra.rules.saveFailed')} ${r.error}`);
    } catch { setNote(t('extra.rules.saveFailed')); }
  };
  const reset = async () => {
    if (!window.confirm(t('extra.rules.resetConfirm'))) return;
    try {
      const r = await window.cth.michaelRulesReset();
      if (r.ok) { setText(r.text); setSaved(r.text); setNote(t('extra.rules.resetDone')); }
      else setNote(`${t('extra.rules.saveFailed')} ${r.error}`);
    } catch { setNote(t('extra.rules.saveFailed')); }
  };
  const dirty = text !== saved;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div>
        <div style={headStyle}>{t('extra.rules.title')}</div>
        <div style={descStyle}>{t('extra.rules.desc')}</div>
        {path && <div style={{ ...descStyle, fontFamily: 'var(--cth-font-mono)', fontSize: 11, color: 'var(--cth-ink-500)' }}>{t('extra.rules.path', { path })}</div>}
      </div>
      {loaded === 'loading' ? (
        <div style={descStyle}>{t('extra.rules.loading')}</div>
      ) : (
        <textarea
          value={text}
          disabled={loaded !== 'ok'}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          rows={12}
          style={{
            width: '100%', boxSizing: 'border-box', resize: 'vertical', padding: '6px 8px',
            background: 'var(--cth-paper-100)', border: 'none', boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)',
            fontFamily: 'var(--cth-font-mono)', fontSize: 12, lineHeight: '17px', color: 'var(--cth-ink-900)', outline: 'none'
          }}
        />
      )}
      {text.length > RULES_SEED_MAX_CHARS && (
        <div style={{ ...descStyle, color: 'var(--cth-ink-900)' }}>{t('extra.rules.tooLong', { max: RULES_SEED_MAX_CHARS.toLocaleString() })}</div>
      )}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <PixelButton size="sm" onClick={() => void save()} disabled={loaded !== 'ok' || !dirty}>{t('extra.rules.save')}</PixelButton>
        <PixelButton size="sm" onClick={() => void reset()} disabled={loaded === 'loading'}>{t('extra.rules.reset')}</PixelButton>
        {dirty && <span style={{ fontSize: 11, color: 'var(--cth-ink-500)' }}>{t('extra.rules.unsaved')}</span>}
        {note && <span style={{ fontSize: 11, color: 'var(--cth-ink-700)' }}>{note}</span>}
      </div>
      <div style={{ fontSize: 11, color: 'var(--cth-ink-500)', lineHeight: '16px' }}>{t('extra.rules.appliesNote')}</div>
    </div>
  );
}

export function DepartmentsSettings({ config, stage }: { config: HarnessConfig; stage: (patch: Partial<HarnessConfig>) => void }) {
  const { t } = useTranslation();
  const [avail, setAvail] = useState<AvailabilityMap | null>(null);
  const [cfg, setCfg] = useState<DepartmentsConfig>(() => (config.departments ?? {}) as DepartmentsConfig);

  useEffect(() => {
    let alive = true;
    void loadConnectorAvailability().then((a) => { if (alive) setAvail(a); }).catch(() => { if (alive) setAvail({}); });
    return () => { alive = false; };
  }, []);

  const connectors = useMemo(() => listConnectors(), []);
  const setSlot = (id: DepartmentId, slot: 0 | 1, connectorId: string) => {
    const dept = DEPARTMENTS.find((d) => d.id === id)!;
    const cur = preferredFor(dept, cfg);
    const next = [...cur];
    if (connectorId) next[slot] = connectorId; else next.splice(slot, 1);
    // Keep order, drop duplicates (the other slot may already hold this id).
    const dedup = next.filter((v, i) => v && next.indexOf(v) === i);
    const nextCfg = { ...cfg, [id]: dedup };
    setCfg(nextCfg);
    stage({ departments: nextCfg } as Partial<HarnessConfig>);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div>
        <div style={headStyle}>{t('extra.departments.title')}</div>
        <div style={descStyle}>{t('extra.departments.desc')}</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(70px, auto) 1fr 1fr auto', gap: '4px 8px', alignItems: 'center' }}>
        <span style={headStyle}>{t('extra.departments.dept')}</span>
        <span style={headStyle}>{t('extra.departments.primary')}</span>
        <span style={headStyle}>{t('extra.departments.fallback')}</span>
        <span style={headStyle}>{t('extra.departments.status')}</span>
        {DEPARTMENTS.map((dept) => {
          const prefs = preferredFor(dept, cfg);
          const options = connectors.filter((c) => connectorFitsDepartment(c, dept));
          const res = avail ? resolveDepartment(dept, avail, cfg) : null;
          const ok = res?.status === 'ok';
          const chip: CSSProperties = {
            ...chipBase,
            background: !res ? 'var(--cth-cream-100)' : ok ? 'var(--cth-sky-light)' : 'var(--cth-cream-100)',
            boxShadow: ok ? 'inset 0 0 0 1px var(--cth-ink-300)' : 'inset 0 0 0 1.5px var(--cth-ink-500)',
            color: 'var(--cth-ink-900)'
          };
          const slot = (i: 0 | 1) => (
            <select
              value={prefs[i] ?? ''}
              onChange={(e) => setSlot(dept.id, i, e.target.value)}
              style={selectStyle}
              aria-label={`${t(`extra.departments.name.${dept.id}`)} ${t(i === 0 ? 'extra.departments.primary' : 'extra.departments.fallback')}`}
            >
              {i === 1 && <option value="">{t('extra.departments.none')}</option>}
              {options.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}{c.kind === 'unavailable' ? ` (${t('extra.departments.notConnectable')})` : ''}
                </option>
              ))}
            </select>
          );
          return (
            <div key={dept.id} style={{ display: 'contents' }}>
              <span style={{ fontSize: 13, color: 'var(--cth-ink-900)' }}>{t(`extra.departments.name.${dept.id}`)}</span>
              {slot(0)}
              {slot(1)}
              <span
                style={chip}
                title={res ? `${res.connectorId ? getConnector(res.connectorId)?.label ?? '' : ''} ${res.reason}`.trim() : ''}
              >
                {!res ? t('extra.departments.checking') : ok ? t('extra.departments.statusOk') : t('extra.departments.statusNeeded')}
              </span>
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: 11, color: 'var(--cth-ink-500)', lineHeight: '16px' }}>{t('extra.departments.honestyNote')}</div>
    </div>
  );
}
