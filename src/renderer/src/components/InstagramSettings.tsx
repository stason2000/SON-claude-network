import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PixelButton } from './PixelButton';
import type { InstagramStatus, InstagramTranscribeMode } from '@shared/instagram';

const head = {
  fontFamily: 'var(--cth-font-display)', fontSize: 8, lineHeight: '12px',
  color: 'var(--cth-ink-500)', textTransform: 'uppercase', marginBottom: 2
} as const;
const small = { fontSize: 12, lineHeight: '16px', color: 'var(--cth-ink-700)' } as const;

/**
 * Settings → Connections → 인스타그램 (requirement #12): in-app browser login
 * (the user types their password into Instagram's own page — never into this
 * app), and the optional, default-OFF video transcription choice with its cost
 * and where the audio goes spelled out before it can be picked.
 */
export function InstagramSettings() {
  const { t } = useTranslation();
  const [st, setSt] = useState<InstagramStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const refresh = (): void => {
    window.cth.instagramStatus().then(setSt).catch((e) => setErr(String(e)));
  };
  useEffect(refresh, []);

  const choose = (mode: InstagramTranscribeMode): void => {
    window.cth.instagramSetTranscribe(mode).then(setSt).catch((e) => setErr(String(e)));
  };

  const engine = (id: 'groq' | 'local') => st?.engines.find((e) => e.id === id);
  const options: Array<{ id: InstagramTranscribeMode; label: string; detail: string; disabled: boolean; warn?: string }> = [
    { id: 'off', label: t('extra.instagram.settings.off'), detail: t('extra.instagram.settings.offDetail'), disabled: false },
    {
      id: 'local',
      label: t('extra.instagram.settings.local'),
      detail: engine('local')?.available ? t('extra.instagram.settings.localDetail') : `${t('extra.instagram.settings.notReady')}: ${engine('local')?.reason ?? ''}`,
      disabled: !engine('local')?.available
    },
    {
      id: 'groq',
      label: t('extra.instagram.settings.groq'),
      detail: engine('groq')?.available ? t('extra.instagram.settings.groqDetail') : `${t('extra.instagram.settings.notReady')}: ${engine('groq')?.reason ?? ''}`,
      disabled: !engine('groq')?.available,
      warn: t('extra.instagram.audioLeavesDevice')
    }
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={head}>{t('extra.instagram.settings.title')}</div>
      <span style={small}>{t('extra.instagram.settings.intro')}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={small}>
          {t('extra.instagram.settings.status')}:{' '}
          {st == null ? '…' : st.loggedIn ? t('extra.instagram.settings.loggedIn') : t('extra.instagram.settings.loggedOut')}
        </span>
        <span style={{ flex: 1 }} />
        <PixelButton variant="secondary" size="sm" onClick={() => { void window.cth.instagramOpenLogin().then(refresh); }}>
          {t('extra.instagram.openLogin')}
        </PixelButton>
        <PixelButton variant="secondary" size="sm" onClick={refresh}>{t('extra.instagram.settings.refresh')}</PixelButton>
        {st?.loggedIn && (
          <PixelButton variant="secondary" size="sm" onClick={() => { void window.cth.instagramLogout().then(refresh); }}>
            {t('extra.instagram.settings.logout')}
          </PixelButton>
        )}
      </div>
      <span style={{ ...small, color: 'var(--cth-ink-500)' }}>{t('extra.instagram.settings.passwordNote')}</span>

      <div style={head}>{t('extra.instagram.settings.transcribeTitle')}</div>
      <span style={small}>{t('extra.instagram.settings.transcribeIntro')}</span>
      <div role="radiogroup" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {options.map((o) => (
          <label key={o.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', opacity: o.disabled ? 0.6 : 1, cursor: o.disabled ? 'not-allowed' : 'pointer' }}>
            <input
              type="radio"
              name="ig-transcribe"
              checked={(st?.transcribe ?? 'off') === o.id}
              disabled={o.disabled || !st}
              onChange={() => choose(o.id)}
            />
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ ...small, color: 'var(--cth-ink-900)' }}>{o.label}</span>
              <span style={small}>{o.detail}</span>
              {o.warn && <span style={{ ...small, color: 'var(--cth-coral)' }}>{o.warn}</span>}
            </span>
          </label>
        ))}
      </div>
      <span style={{ ...small, color: 'var(--cth-ink-500)' }}>{t('extra.instagram.settings.limits')}</span>
      {err && <span style={{ ...small, color: 'var(--cth-coral)' }}>{err}</span>}
    </div>
  );
}
