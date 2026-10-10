import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { SYNC_CATEGORIES, type SyncCategory } from '@shared/sync/items';
import type { ConflictView, SyncReply, SyncStatus } from '@shared/sync/status';
import { PixelButton } from './PixelButton';

/**
 * Settings → 동기화 (#10). Google-Drive appDataFolder sync of this device's
 * settings. Credentials are WRITE-ONLY here: the client id / secret fields are
 * cleared after saving and only a "saved" state is ever shown; no token or key
 * reaches this component (see src/main/sync). Matches docs/GOOGLE_SETUP.md.
 */

const head: CSSProperties = {
  fontFamily: 'var(--cth-font-display)', fontSize: 8, lineHeight: '12px',
  color: 'var(--cth-ink-500)', textTransform: 'uppercase', marginBottom: 4
};
const desc: CSSProperties = { fontSize: 12, color: 'var(--cth-ink-700)', lineHeight: '18px' };
const small: CSSProperties = { fontSize: 11, color: 'var(--cth-ink-500)', lineHeight: '16px' };
const input: CSSProperties = {
  flex: 1, minWidth: 0, padding: '4px 8px 2px', background: 'var(--cth-paper-100)', border: 'none',
  boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)', fontFamily: 'var(--cth-font-mono)', fontSize: 12,
  color: 'var(--cth-ink-900)', outline: 'none'
};
const box: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 10px', boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)' };
const chip: CSSProperties = {
  padding: '1px 6px 0', fontSize: 11, lineHeight: '16px',
  background: 'var(--cth-cream-100)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)', color: 'var(--cth-ink-700)'
};
const row: CSSProperties = { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' };

export function SyncSettings() {
  const { t, i18n } = useTranslation();
  const [st, setSt] = useState<SyncStatus | null>(null);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [label, setLabel] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const fmt = useCallback((ms: number | null | undefined) => {
    if (!ms) return t('extra.sync.run.never');
    try { return new Date(ms).toLocaleString(i18n.language || 'ko'); } catch { return new Date(ms).toISOString(); }
  }, [i18n.language, t]);

  useEffect(() => {
    let alive = true;
    void window.cth.syncStatus().then((s) => { if (alive) { setSt(s); setLabel(s.deviceLabel); } }).catch(() => { /* noop */ });
    const off = window.cth.onSyncChanged((s) => { if (alive) setSt(s); });
    return () => { alive = false; off(); };
  }, []);

  const run = async (fn: () => Promise<SyncReply>, okNote?: string) => {
    setBusy(true);
    setNote('');
    try {
      const r = await fn();
      setSt(r.status);
      setNote(r.ok ? (okNote ?? '') : t(`extra.sync.err.${r.code}`));
    } catch {
      setNote(t('extra.sync.err.unknown'));
    } finally {
      setBusy(false);
    }
  };

  const saveCreds = () => {
    const req: { clientId?: string; clientSecret?: string } = {};
    if (clientId.trim()) req.clientId = clientId.trim();
    if (clientSecret.trim()) req.clientSecret = clientSecret.trim();
    // Never keep the plaintext in React state longer than needed.
    setClientId('');
    setClientSecret('');
    if (!req.clientId && !req.clientSecret) return;
    void run(() => window.cth.syncSetCredentials(req), t('extra.sync.cred.savedNote'));
  };

  const pass = () => (st?.apiKeySync && passphrase ? passphrase : undefined);

  if (!st) return <div style={desc}>{t('extra.sync.loading')}</div>;

  const catLabel = (c: string) => t(`extra.sync.cats.${c}`);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div>
        <div style={head}>{t('extra.sync.title')}</div>
        <div style={desc}>{t('extra.sync.desc')}</div>
        <div style={small}>{t('extra.sync.guideHint')}</div>
      </div>

      {/* 1. Google login credentials (write-only) */}
      <div style={box}>
        <div style={head}>{t('extra.sync.cred.title')}</div>
        <div style={row}>
          <span style={{ fontSize: 12, width: 130 }}>{t('extra.sync.cred.clientId')}</span>
          <input style={input} value={clientId} autoComplete="off" spellCheck={false}
            placeholder={t('extra.sync.cred.idPlaceholder')} onChange={(e) => setClientId(e.target.value)} />
          <span style={chip}>{st.hasClientId ? t('extra.sync.cred.saved') : t('extra.sync.cred.notSaved')}</span>
        </div>
        <div style={row}>
          <span style={{ fontSize: 12, width: 130 }}>{t('extra.sync.cred.clientSecret')}</span>
          <input style={input} type="password" value={clientSecret} autoComplete="off" spellCheck={false}
            placeholder={t('extra.sync.cred.secretPlaceholder')} onChange={(e) => setClientSecret(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') saveCreds(); }} />
          <span style={chip}>{st.hasClientSecret ? t('extra.sync.cred.saved') : t('extra.sync.cred.notSaved')}</span>
        </div>
        <div style={row}>
          <PixelButton size="sm" onClick={saveCreds} disabled={busy || (!clientId.trim() && !clientSecret.trim())}>{t('extra.sync.cred.save')}</PixelButton>
          <PixelButton size="sm" variant="ghost" onClick={() => void run(() => window.cth.syncClearCredentials())}
            disabled={busy || (!st.hasClientId && !st.hasClientSecret)}>{t('extra.sync.cred.clear')}</PixelButton>
          <span style={small}>{t('extra.sync.cred.writeOnly')}</span>
        </div>
      </div>

      {/* 2. Account */}
      <div style={box}>
        <div style={head}>{t('extra.sync.account.title')}</div>
        <div style={row}>
          <span style={{ ...chip, background: st.loggedIn ? 'var(--cth-sky-light)' : 'var(--cth-cream-100)' }}>
            {st.loginInProgress ? t('extra.sync.account.loggingIn') : st.loggedIn ? t('extra.sync.account.loggedIn') : t('extra.sync.account.loggedOut')}
          </span>
          {!st.loggedIn && !st.loginInProgress && (
            <PixelButton size="sm" onClick={() => void run(() => window.cth.syncLogin(), t('extra.sync.account.loginDone'))}
              disabled={busy || !st.hasClientId}>{t('extra.sync.account.login')}</PixelButton>
          )}
          {st.loginInProgress && (
            <PixelButton size="sm" variant="ghost" onClick={() => void window.cth.syncCancelLogin().then(setSt)}>{t('extra.sync.account.cancel')}</PixelButton>
          )}
          {st.loggedIn && (
            <PixelButton size="sm" variant="ghost" onClick={() => void run(() => window.cth.syncLogout())} disabled={busy}>{t('extra.sync.account.logout')}</PixelButton>
          )}
        </div>
        <div style={small}>{st.loginInProgress ? t('extra.sync.account.browserHint') : t('extra.sync.account.scopeNote')}</div>
      </div>

      {/* 3. Sync now / status */}
      <div style={box}>
        <div style={head}>{t('extra.sync.run.title')}</div>
        <div style={row}>
          <PixelButton size="sm" onClick={() => void run(() => window.cth.syncNow({ passphrase: pass() }), t('extra.sync.run.done'))}
            disabled={busy || st.syncing || !st.loggedIn}>{st.syncing ? t('extra.sync.run.syncing') : t('extra.sync.run.now')}</PixelButton>
          <span style={{ fontSize: 12 }}>{t('extra.sync.run.lastSync', { time: fmt(st.lastSyncAt) })}</span>
        </div>
        {st.lastResult && (
          <div style={small}>{t('extra.sync.run.result', st.lastResult as unknown as Record<string, number>)}</div>
        )}
        <div style={{ fontSize: 12, color: st.lastError ? 'var(--cth-red-500, #b33)' : 'var(--cth-ink-500)' }}>
          {st.lastError
            ? t('extra.sync.run.lastError', { reason: t(`extra.sync.err.${st.lastError.code}`), time: fmt(st.lastError.at) })
            : t('extra.sync.run.noError')}
        </div>
        {note && <div style={{ fontSize: 12, color: 'var(--cth-ink-700)' }}>{note}</div>}
        <label style={{ ...row, fontSize: 12, cursor: 'pointer' }}>
          <input type="checkbox" checked={st.autoSync} disabled={busy}
            onChange={(e) => void run(() => window.cth.syncSetOptions({ autoSync: e.target.checked }))} />
          {t('extra.sync.auto.label')}
        </label>
        <div style={small}>{t('extra.sync.auto.desc')}</div>
      </div>

      {/* 4. This device */}
      <div style={box}>
        <div style={head}>{t('extra.sync.device.title')}</div>
        <div style={row}>
          <input style={input} value={label} maxLength={40} onChange={(e) => setLabel(e.target.value)}
            placeholder={t('extra.sync.device.placeholder')} />
          <PixelButton size="sm" onClick={() => void run(() => window.cth.syncSetOptions({ deviceLabel: label }), t('extra.sync.device.saved'))}
            disabled={busy || !label.trim() || label.trim() === st.deviceLabel}>{t('extra.sync.device.save')}</PixelButton>
        </div>
        <div style={small}>{t('extra.sync.device.host', { host: st.hostName })}</div>
      </div>

      {/* 5. What to sync */}
      <div style={box}>
        <div style={head}>{t('extra.sync.cats.title')}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 4 }}>
          {SYNC_CATEGORIES.map((c: SyncCategory) => (
            <label key={c} style={{ ...row, fontSize: 12, cursor: 'pointer' }}>
              <input type="checkbox" checked={st.categories[c]} disabled={busy}
                onChange={(e) => void run(() => window.cth.syncSetOptions({ categories: { [c]: e.target.checked } }))} />
              {catLabel(c)}
            </label>
          ))}
        </div>
        <div style={small}>{t('extra.sync.cats.notSynced')}</div>
      </div>

      {/* 6. Opt-in encrypted API-key sync */}
      <div style={box}>
        <div style={head}>{t('extra.sync.keys.title')}</div>
        <label style={{ ...row, fontSize: 12, cursor: 'pointer' }}>
          <input type="checkbox" checked={st.apiKeySync} disabled={busy}
            onChange={(e) => void run(() => window.cth.syncSetOptions({ apiKeySync: e.target.checked }))} />
          {t('extra.sync.keys.optIn')}
        </label>
        <div style={small}>{t('extra.sync.keys.desc')}</div>
        {st.apiKeySync && (
          <>
            <div style={row}>
              <span style={{ fontSize: 12, width: 130 }}>{t('extra.sync.keys.passphrase')}</span>
              <input style={input} type="password" value={passphrase} autoComplete="new-password" spellCheck={false}
                onChange={(e) => setPassphrase(e.target.value)} placeholder={t('extra.sync.keys.passphrasePlaceholder')} />
            </div>
            <div style={small}>{t('extra.sync.keys.passphraseHint')}</div>
          </>
        )}
      </div>

      {/* 7. Conflicts */}
      <div style={box}>
        <div style={head}>{t('extra.sync.conflicts.title', { count: st.conflicts.length })}</div>
        {st.conflicts.length === 0 && <div style={small}>{t('extra.sync.conflicts.none')}</div>}
        {st.conflicts.length > 1 && (
          <div style={row}>
            <PixelButton size="sm" variant="secondary" disabled={busy}
              onClick={() => void run(() => window.cth.syncResolveAll({ choice: 'local', passphrase: pass() }))}>
              {t('extra.sync.conflicts.useAll', { device: st.deviceLabel })}
            </PixelButton>
            <PixelButton size="sm" variant="secondary" disabled={busy}
              onClick={() => void run(() => window.cth.syncResolveAll({ choice: 'remote', passphrase: pass() }))}>
              {t('extra.sync.conflicts.useAllRemote')}
            </PixelButton>
          </div>
        )}
        {st.conflicts.map((c) => (
          <ConflictCard key={c.key} c={c} fmt={fmt} busy={busy}
            onPick={(choice) => void run(() => window.cth.syncResolve({ key: c.key, choice, passphrase: pass() }), t('extra.sync.conflicts.resolved'))} />
        ))}
        {st.conflicts.length > 0 && <div style={small}>{t('extra.sync.conflicts.backupNote')}</div>}
      </div>
    </div>
  );
}

function ConflictCard({ c, fmt, busy, onPick }: {
  c: ConflictView; fmt: (ms: number | null) => string; busy: boolean; onPick: (choice: 'local' | 'remote') => void;
}) {
  const { t } = useTranslation();
  const name = c.key.includes('/') ? `${t(`extra.sync.cats.${c.category}`)} · ${c.key.split('/').slice(-2).join('/')}` : t(`extra.sync.cats.${c.category}`);
  const summary = c.summary.changedKeys
    ? t('extra.sync.conflicts.changedKeys', { keys: c.summary.changedKeys.join(', ') || '-' })
    : t('extra.sync.conflicts.lines', { local: c.summary.onlyLocal ?? 0, remote: c.summary.onlyRemote ?? 0 });
  const side = (which: 'local' | 'remote') => {
    const s = which === 'local' ? c.local : c.remote;
    const who = s.deviceLabel || s.deviceHost || t('extra.sync.conflicts.otherDevice');
    return (
      <div style={{ flex: 1, minWidth: 180, display: 'flex', flexDirection: 'column', gap: 4, padding: 6, background: 'var(--cth-paper-100)' }}>
        <div style={{ fontSize: 12, fontWeight: 600 }}>
          {which === 'local' ? t('extra.sync.conflicts.thisDevice', { device: who }) : t('extra.sync.conflicts.thatDevice', { device: who })}
        </div>
        <div style={{ fontSize: 11, color: 'var(--cth-ink-500)' }}>
          {s.exists ? t('extra.sync.conflicts.modified', { time: fmt(s.modifiedTime) }) : t('extra.sync.conflicts.missing')}
        </div>
        {s.exists && s.preview && (
          <pre style={{ margin: 0, fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 90, overflow: 'auto', fontFamily: 'var(--cth-font-mono)' }}>{s.preview}</pre>
        )}
        <PixelButton size="sm" disabled={busy} onClick={() => onPick(which)}>
          {s.exists ? t('extra.sync.conflicts.useThis', { device: who }) : t('extra.sync.conflicts.useDeletion', { device: who })}
        </PixelButton>
      </div>
    );
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: 6, boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)' }}>
      <div style={{ fontSize: 12, fontWeight: 600 }}>{name}</div>
      <div style={{ fontSize: 11, color: 'var(--cth-ink-700)' }}>{t(`extra.sync.conflicts.kind.${c.kind}`)} · {summary}</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {side('local')}
        {side('remote')}
      </div>
    </div>
  );
}
