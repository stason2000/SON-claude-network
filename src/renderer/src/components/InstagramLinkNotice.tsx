import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PixelButton } from './PixelButton';
import {
  findInstagramUrls,
  buildInstagramMessage,
  buildManualCaptionMessage,
  type IgReadResult,
  type InstagramTranscribeMode
} from '@shared/instagram';

/**
 * Inline notice under the queue composer when the draft contains an Instagram
 * post/reel link (requirement #12). NOTHING is read until the user clicks
 * [읽기]; the result (or a pasted caption) becomes the queued message to the
 * agent, with an explicit "summarize + list what was NOT read" instruction.
 */
export function InstagramLinkNotice({ text, onQueue }: { text: string; onQueue: (body: string) => void }) {
  const { t } = useTranslation();
  const links = useMemo(() => findInstagramUrls(text, 5), [text]);
  const url = links[0]?.url;
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [phase, setPhase] = useState<'idle' | 'reading' | 'failed' | 'manual'>('idle');
  const [result, setResult] = useState<IgReadResult | null>(null);
  const [manual, setManual] = useState('');
  const [mode, setMode] = useState<InstagramTranscribeMode>('off');

  // New link → fresh notice.
  useEffect(() => { setPhase('idle'); setResult(null); setManual(''); }, [url]);
  // Only to show the audio disclosure; status never carries secrets.
  useEffect(() => {
    if (!url) return;
    let alive = true;
    window.cth.instagramStatus().then((s) => { if (alive) setMode(s.transcribe); }).catch(() => {});
    return () => { alive = false; };
  }, [url]);

  if (!url || dismissed === url) return null;

  const read = async (): Promise<void> => {
    setPhase('reading');
    let r: IgReadResult;
    try {
      r = await window.cth.instagramRead(url);
    } catch (e) {
      r = { ok: false, status: 'error', url, notRead: ['게시물 전체'], message: String(e) };
    }
    setResult(r);
    if (r.ok) {
      onQueue(buildInstagramMessage(text, r));
      setPhase('idle');
    } else {
      setPhase('failed');
    }
  };

  const queueManual = (): void => {
    if (!manual.trim()) return;
    onQueue(buildManualCaptionMessage(text, url, manual));
  };

  const small = { fontSize: 12, lineHeight: '16px', color: 'var(--cth-ink-700)' } as const;
  const link = {
    border: 'none', background: 'transparent', cursor: 'pointer', padding: 0,
    fontFamily: 'var(--cth-font-ui)', fontSize: 12, color: 'var(--cth-ink-900)', textDecoration: 'underline'
  } as const;

  return (
    <div
      role="status"
      style={{
        display: 'flex', flexDirection: 'column', gap: 6, padding: '6px 8px',
        background: 'var(--cth-paper-100)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ ...small, flex: 1, minWidth: 140 }}>
          {phase === 'reading' ? t('extra.instagram.reading') : t('extra.instagram.detected')}
          {links.length > 1 && ` ${t('extra.instagram.firstOnly', { count: links.length })}`}
        </span>
        {phase !== 'reading' && (
          <>
            <PixelButton variant="primary" size="sm" onClick={() => { void read(); }}>{t('extra.instagram.read')}</PixelButton>
            <PixelButton variant="secondary" size="sm" onClick={() => setPhase('manual')}>{t('extra.instagram.pasteCaption')}</PixelButton>
            <button style={link} onClick={() => setDismissed(url)}>{t('extra.instagram.dismiss')}</button>
          </>
        )}
      </div>
      {mode === 'groq' && phase !== 'manual' && (
        <span style={{ ...small, color: 'var(--cth-coral)' }}>{t('extra.instagram.audioLeavesDevice')}</span>
      )}
      {phase === 'failed' && result && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ ...small, color: 'var(--cth-coral)' }}>
            {t(`extra.instagram.status.${result.status}`)} — {result.message}
          </span>
          <span style={{ display: 'flex', gap: 10 }}>
            {result.status === 'login-required' && (
              <button style={link} onClick={() => { void window.cth.instagramOpenLogin(); }}>{t('extra.instagram.openLogin')}</button>
            )}
            <button style={link} onClick={() => setPhase('manual')}>{t('extra.instagram.fallbackHint')}</button>
          </span>
        </div>
      )}
      {phase === 'manual' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={small}>{t('extra.instagram.manualHint')}</span>
          <textarea
            className="cth-input"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            rows={4}
            placeholder={t('extra.instagram.manualPlaceholder')}
            style={{
              width: '100%', resize: 'vertical', padding: '6px 8px', boxSizing: 'border-box',
              background: 'var(--cth-paper-100)', border: 'none', outline: 'none',
              fontFamily: 'var(--cth-font-mono)', fontSize: 12, color: 'var(--cth-ink-900)'
            }}
          />
          <span style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            <PixelButton variant="secondary" size="sm" onClick={() => setPhase('idle')}>{t('extra.instagram.cancel')}</PixelButton>
            <PixelButton variant="primary" size="sm" onClick={queueManual} disabled={!manual.trim()}>
              {t('extra.instagram.sendCaption')}
            </PixelButton>
          </span>
        </div>
      )}
    </div>
  );
}
