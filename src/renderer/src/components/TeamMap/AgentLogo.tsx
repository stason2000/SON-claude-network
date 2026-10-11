import { memo } from 'react';
import { BRAND_LOGOS } from '@/scene/office/brandLogos';
import { MASCOTS, type MascotName } from '@/scene/office/aiMascotArt';

/**
 * The AI's mark as smooth SVG: the provider's brand logo path (brandLogos.ts),
 * or — for AIs without a verified mark (Crush, Pi, FreeLLMAPI, Custom) — a soft
 * vector version of the mascot: a rounded body in its colour with two eyes that
 * follow the state (narrow while working, wide when it needs the user).
 */
export const AgentLogo = memo(function AgentLogo({ mascot, size, status }: { mascot: MascotName; size: number; status?: string }) {
  const brand = BRAND_LOGOS[mascot];
  if (brand) {
    const dark = brand.hex.toLowerCase() === '#000000';
    const ink = dark ? 'var(--cth-ink-900)' : brand.hex;
    const glyph = Math.round(size * 0.56);
    return (
      <span
        className="tm-logo"
        aria-hidden="true"
        style={{
          width: size, height: size,
          background: dark
            ? 'color-mix(in srgb, var(--cth-ink-300) 16%, transparent)'
            : `color-mix(in srgb, ${brand.hex} 14%, transparent)`,
          boxShadow: `inset 0 0 0 1px ${dark ? 'color-mix(in srgb, var(--cth-ink-300) 30%, transparent)' : `color-mix(in srgb, ${brand.hex} 28%, transparent)`}`
        }}
      >
        <svg width={glyph} height={glyph} viewBox="0 0 24 24" style={{ display: 'block' }}>
          <path d={brand.path} style={{ fill: ink }} fillRule={brand.evenodd ? 'evenodd' : 'nonzero'} />
        </svg>
      </span>
    );
  }
  const m = MASCOTS[mascot] ?? MASCOTS['ai-custom'];
  const hex = '#' + m.base.map((v) => v.toString(16).padStart(2, '0')).join('');
  const wide = status === 'blocked';
  const narrow = status === 'working' || status === 'thinking';
  const eyeRy = wide ? 3.1 : narrow ? 1.1 : 2.4;
  return (
    <span
      className="tm-logo"
      aria-hidden="true"
      style={{
        width: size, height: size,
        background: `color-mix(in srgb, ${hex} 14%, transparent)`,
        boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${hex} 28%, transparent)`
      }}
    >
      <svg width={Math.round(size * 0.7)} height={Math.round(size * 0.7)} viewBox="0 0 24 24" style={{ display: 'block' }}>
        <defs>
          <linearGradient id={`tm-mascot-${mascot}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={hex} stopOpacity="0.95" />
            <stop offset="1" stopColor={hex} />
          </linearGradient>
        </defs>
        <rect x="3" y="4" width="18" height="16" rx="7" fill={`url(#tm-mascot-${mascot})`} />
        <rect x="3" y="4" width="18" height="16" rx="7" fill="none" stroke="rgba(0,0,0,0.18)" strokeWidth="1" />
        <ellipse cx="9" cy="11.5" rx="2.2" ry={eyeRy + 0.4} fill="#FAF8F0" />
        <ellipse cx="15" cy="11.5" rx="2.2" ry={eyeRy + 0.4} fill="#FAF8F0" />
        <ellipse cx="9.3" cy="11.8" rx="1.1" ry={Math.max(0.7, eyeRy - 0.6)} fill="#1E1C28" />
        <ellipse cx="15.3" cy="11.8" rx="1.1" ry={Math.max(0.7, eyeRy - 0.6)} fill="#1E1C28" />
      </svg>
    </span>
  );
});
