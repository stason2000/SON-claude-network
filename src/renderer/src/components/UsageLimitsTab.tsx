import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { ApiConnector, CliConnector } from '@shared/connectors';
import {
  formatClock,
  formatCredits,
  formatWhen,
  msUntilUtcMidnight,
  splitDuration,
  type ConnectorUsageSummary,
  type OpenRouterUsageResult
} from '@shared/connectorUsage';
import { PixelButton } from './PixelButton';
import { useAiConnections } from './aiConnections';

/**
 * "사용량·한도" tab of the AI 연결 window.
 *  - OpenRouter: live numbers from its official GET /api/v1/key, fetched MAIN-side
 *    (the key never reaches this renderer; only parsed numbers do).
 *  - Every connected API AI: requests this app sent (local log; no prompt/key).
 *  - Subscription (login) AIs: one honest line — their remaining quota can't be read.
 * Loads when the tab opens and on "새로고침"; no polling loop.
 */

const card: CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 12px',
  background: 'var(--cth-paper-100)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)'
};
const small: CSSProperties = { fontSize: 12, lineHeight: '17px', color: 'var(--cth-ink-700)' };
const body: CSSProperties = { fontSize: 13, lineHeight: '19px', color: 'var(--cth-ink-900)' };
/** Red-ish alert: deep text on the coral-light fill reads on both themes
 *  (light: #1A1320 on #F3D3CD; dark: #DEDBD6 on #3B2724). */
const alertBox: CSSProperties = {
  ...small, color: 'var(--cth-ink-900)', padding: '6px 10px', fontWeight: 600,
  background: 'var(--cth-coral-light)', boxShadow: 'inset 3px 0 0 var(--cth-coral), inset 0 0 0 1px var(--cth-coral)'
};
const sectionTitle: CSSProperties = { fontSize: 13, fontWeight: 700, color: 'var(--cth-ink-900)', marginTop: 4 };

type LocalUsage = { now: number; byConnector: Record<string, ConnectorUsageSummary> };

export function UsageLimitsTab({ onGoConnect }: { onGoConnect: () => void }) {
  const { t } = useTranslation();
  const s = useAiConnections();
  const apis = s.connected.filter((c): c is ApiConnector => c.kind === 'api');
  const clis = s.connected.filter((c): c is CliConnector => c.kind === 'cli');
  const hasOpenRouter = apis.some((c) => c.id === 'openrouter');

  const [local, setLocal] = useState<LocalUsage | null>(null);
  const [or, setOr] = useState<OpenRouterUsageResult | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (withOpenRouter: boolean): Promise<void> => {
    setBusy(true);
    try {
      const [l, o] = await Promise.all([
        window.cth.connectorUsageLocal().catch(() => null),
        withOpenRouter
          ? window.cth.connectorUsageOpenRouter().catch((): OpenRouterUsageResult => ({ ok: false, error: 'later' }))
          : Promise.resolve(null)
      ]);
      setLocal(l);
      setOr(o);
    } finally {
      setBusy(false);
    }
  }, []);

  // Once when the tab opens (and again if OpenRouter gets connected/disconnected).
  useEffect(() => { if (s.loaded) void load(hasOpenRouter); }, [s.loaded, hasOpenRouter, load]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ ...body, flex: 1, minWidth: 200 }}>{t('extra.usage.intro')}</div>
        <PixelButton size="sm" variant="ghost" onClick={() => void load(hasOpenRouter)} disabled={busy}>
          {busy ? t('extra.usage.refreshing') : t('extra.usage.refresh')}
        </PixelButton>
      </div>

      {s.loaded && apis.length === 0 && (
        <div style={{ ...card, alignItems: 'center', textAlign: 'center', padding: '20px 12px' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--cth-ink-900)' }}>{t('extra.usage.empty.title')}</div>
          <div style={small}>{t('extra.usage.empty.hint')}</div>
          <PixelButton size="sm" onClick={onGoConnect}>{t('extra.usage.empty.go')}</PixelButton>
        </div>
      )}

      {apis.length > 0 && <div style={sectionTitle}>{t('extra.usage.apiTitle')}</div>}
      {apis.map((c) => (
        <div key={c.id} style={card}>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--cth-ink-900)' }}>{c.label}</span>
          {c.id === 'openrouter' && <OpenRouterLive result={or} busy={busy} />}
          <LocalLine summary={local?.byConnector[c.id]} now={local?.now ?? Date.now()} loaded={!!local} />
        </div>
      ))}
      {apis.length > 0 && <div style={{ ...small, fontSize: 11 }}>{t('extra.usage.local.note')}</div>}

      {clis.length > 0 && (
        <>
          <div style={sectionTitle}>{t('extra.usage.cli.title')}</div>
          <div style={card}>
            <span style={body}>{t('extra.usage.cli.line')}</span>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {clis.filter((c) => c.docsUrl?.startsWith('https://')).map((c) => (
                <a
                  key={c.id}
                  href={c.docsUrl}
                  onClick={(e) => { e.preventDefault(); void window.cth.openExternal(c.docsUrl!); }}
                  style={{ ...small, textDecoration: 'underline' }}
                >
                  {t('extra.usage.cli.docs', { label: c.label })}
                </a>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function OpenRouterLive({ result, busy }: { result: OpenRouterUsageResult | null; busy: boolean }) {
  const { t } = useTranslation();
  if (!result) return <span style={small}>{busy ? t('extra.usage.refreshing') : ''}</span>;
  if (!result.ok) return <div role="alert" style={alertBox}>{t(`extra.usage.or.err.${result.error}`)}</div>;
  const v = result.view;
  const f = v.freeDaily;
  const reset = splitDuration(msUntilUtcMidnight(result.fetchedAt));
  const resetClock = formatClock(result.fetchedAt + msUntilUtcMidnight(result.fetchedAt));
  const high = f ? f.percent >= 80 : false;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <span style={{ ...small, fontSize: 11 }}>{t('extra.usage.or.live', { time: formatClock(result.fetchedAt) })}</span>
      {f ? (
        <>
          <span style={body}>{t('extra.usage.or.freeDaily', { used: f.used, limit: f.limit, remaining: f.remaining })}</span>
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={f.limit}
            aria-valuenow={f.used}
            aria-label={t('extra.usage.or.freeDaily', { used: f.used, limit: f.limit, remaining: f.remaining })}
            style={{ height: 10, background: 'var(--cth-ink-100)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)' }}
          >
            <div style={{ width: `${f.percent}%`, height: '100%', background: high ? 'var(--cth-coral)' : 'var(--cth-mint)' }} />
          </div>
          <span style={small}>{t('extra.usage.or.resetIn', { h: reset.h, m: reset.m, clock: resetClock })}</span>
          {f.remaining === 0 && <div role="alert" style={alertBox}>{t('extra.usage.or.usedUp')}</div>}
        </>
      ) : (
        <span style={small}>{t('extra.usage.or.freeDailyMissing')}</span>
      )}
      {(v.creditsToday !== null || v.creditsTotal !== null) && (
        <span style={small}>
          {t('extra.usage.or.credits', {
            today: v.creditsToday === null ? '-' : formatCredits(v.creditsToday),
            total: v.creditsTotal === null ? '-' : formatCredits(v.creditsTotal)
          })}
        </span>
      )}
      {v.keyLimit !== null && v.keyLimitRemaining !== null && (
        <span style={small}>{t('extra.usage.or.keyLimit', { limit: formatCredits(v.keyLimit), remaining: formatCredits(v.keyLimitRemaining) })}</span>
      )}
      {v.isFreeTier === true && <span style={{ ...small, color: 'var(--cth-ink-900)' }}>{t('extra.usage.or.freeTierNote')}</span>}
    </div>
  );
}

function LocalLine({ summary, now, loaded }: { summary: ConnectorUsageSummary | undefined; now: number; loaded: boolean }) {
  const { t } = useTranslation();
  if (!loaded) return null;
  if (!summary) return <span style={small}>{t('extra.usage.local.none')}</span>;
  const err = summary.lastError;
  const kind = err ? t(`extra.usage.kind.${err.kind}`) : '';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={small}>
        {t('extra.usage.local.line', { today: summary.today, week: summary.last7 })}
        {err && ` · ${t('extra.usage.local.lastError', {
          kind: err.status ? `${kind}(${err.status})` : kind,
          when: formatWhen(err.ts, now)
        })}`}
      </span>
      {summary.hint && <div role="alert" style={alertBox}>{t(`extra.usage.hint.${summary.hint}`)}</div>}
    </div>
  );
}
