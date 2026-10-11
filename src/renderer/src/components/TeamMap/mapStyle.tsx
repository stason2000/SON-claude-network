import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import './teamMap.css';

/** Which picture the main area shows: the smooth 팀 지도 (default) or the old pixel office. */
export type MapStyle = 'smooth' | 'pixel';

const LS_KEY = 'son.mapStyle';
const subs = new Set<() => void>();

function read(): MapStyle {
  try { return window.localStorage.getItem(LS_KEY) === 'pixel' ? 'pixel' : 'smooth'; } catch { return 'smooth'; }
}
let current: MapStyle = read();

export function setMapStyle(next: MapStyle): void {
  current = next;
  try { window.localStorage.setItem(LS_KEY, next); } catch { /* storage blocked — keep it for this session */ }
  subs.forEach((f) => f());
}

export function useMapStyle(): MapStyle {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => { subs.delete(cb); }; }, () => current);
}

/** "지도 모양: 부드럽게 / 도트" — a small pill in the corner of the main view. */
export function MapStyleToggle() {
  const { t } = useTranslation();
  const style = useMapStyle();
  return (
    <div className="tm-style-toggle cth-titlebar-nodrag" role="group" aria-label={t('extra.teamMap.styleLabel')}>
      <span>{t('extra.teamMap.styleLabel')}</span>
      <button type="button" aria-pressed={style === 'smooth'} onClick={() => setMapStyle('smooth')}>{t('extra.teamMap.styleSmooth')}</button>
      <button type="button" aria-pressed={style === 'pixel'} onClick={() => setMapStyle('pixel')}>{t('extra.teamMap.stylePixel')}</button>
    </div>
  );
}
