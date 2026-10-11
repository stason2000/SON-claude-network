import { useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { connectionMethod, type Connector, type CliConnector, type ApiConnector } from '@shared/connectors';
import { PixelButton } from './PixelButton';

/**
 * Small shared pieces for "how do I connect this AI?":
 *  - MethodBadge      로그인 방식 / API 키 방식 / 연결 불가
 *  - CliLoginButton   opens the CLI's official login flow in a NEW terminal window
 *                     (main: connector:login — id only; the app never sees credentials)
 *  - KeyPageButton    opens the verified API-key page (or the docs) via app:openExternal (https only)
 */

const METHOD_BG: Record<string, string> = {
  login: 'var(--cth-mint-light, var(--cth-cream-100))',
  apiKey: 'var(--cth-lemon-light, var(--cth-cream-100))',
  unavailable: 'var(--cth-coral-light, var(--cth-cream-100))'
};

export function MethodBadge({ connector, style }: { connector: Connector; style?: CSSProperties }) {
  const { t } = useTranslation();
  const m = connectionMethod(connector);
  return (
    <span
      title={t(`extra.connectors.methodHint.${m}`)}
      style={{
        padding: '1px 6px 0', fontSize: 11, lineHeight: '16px', whiteSpace: 'nowrap',
        background: METHOD_BG[m], boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)',
        color: 'var(--cth-ink-900)', fontWeight: 600,
        ...style
      }}
    >{t(`extra.connectors.method.${m}`)}</span>
  );
}

const linkStyle: CSSProperties = { fontSize: 11, color: 'var(--cth-ink-700)', textDecoration: 'underline', cursor: 'pointer' };

function ExtLink({ url, label }: { url: string; label: string }) {
  return (
    <a href={url} onClick={(e) => { e.preventDefault(); void window.cth.openExternal(url); }} style={linkStyle}>{label}</a>
  );
}

type LoginReply = Awaited<ReturnType<typeof window.cth.connectorLogin>>;

export function CliLoginButton({ connector }: { connector: CliConnector }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<LoginReply | null>(null);

  const run = async () => {
    setBusy(true);
    setReply(null);
    try {
      setReply(await window.cth.connectorLogin(connector.id));
    } catch {
      setReply({ ok: false, error: 'spawn-failed', docsUrl: connector.docsUrl });
    } finally {
      setBusy(false);
    }
  };

  let message: string | null = null;
  let docs: { url: string; label: string } | null = null;
  if (reply && reply.ok) {
    message = reply.mode === 'command'
      ? t('extra.connectors.login.openedCommand', { command: reply.command })
      : reply.inside
        ? t('extra.connectors.login.openedFirstRunInside', { command: reply.command, inside: reply.inside })
        : t('extra.connectors.login.openedFirstRun', { command: reply.command });
  } else if (reply && !reply.ok) {
    const url = reply.docsUrl ?? connector.docsUrl;
    if (reply.error === 'not-installed') {
      message = t('extra.connectors.login.notInstalled', { label: connector.label });
      if (url) docs = { url, label: t('extra.connectors.login.installDocs') };
    } else {
      message = t(reply.error === 'no-login' ? 'extra.connectors.login.noLogin'
        : reply.error === 'no-terminal' ? 'extra.connectors.login.noTerminal'
          : 'extra.connectors.login.failed');
      if (url) docs = { url, label: t('extra.connectors.login.openDocs') };
    }
  }

  // No verified login flow → never guess a command: the button opens the docs.
  if (!connector.login) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 12, color: 'var(--cth-ink-700)' }}>{t('extra.connectors.login.noLogin')}</span>
        {connector.docsUrl && <ExtLink url={connector.docsUrl} label={t('extra.connectors.login.openDocs')} />}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <PixelButton size="sm" onClick={() => void run()} disabled={busy}>
          {busy ? t('extra.connectors.login.opening') : t('extra.connectors.login.button')}
        </PixelButton>
        <ExtLink url={connector.login.sourceUrl} label={t('extra.connectors.login.source')} />
      </div>
      {message && (
        <span style={{ fontSize: 12, lineHeight: '16px', color: reply?.ok ? 'var(--cth-ink-900)' : 'var(--cth-coral-dark, var(--cth-ink-900))' }}>
          {message}
        </span>
      )}
      {docs && <ExtLink url={docs.url} label={docs.label} />}
    </div>
  );
}

export function KeyPageButton({ connector }: { connector: ApiConnector }) {
  const { t } = useTranslation();
  const url = connector.keyUrl ?? connector.docsUrl;
  if (!url || !url.startsWith('https://')) return null;
  return (
    <PixelButton size="sm" variant="ghost" onClick={() => void window.cth.openExternal(url)}>
      {connector.keyUrl ? t('extra.connectors.keyUrl') : t('extra.connectors.keyUrlDocs')}
    </PixelButton>
  );
}
