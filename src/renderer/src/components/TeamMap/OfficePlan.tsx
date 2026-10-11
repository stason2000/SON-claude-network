import { memo, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Agent } from '@/store/store';
import { BRAND_LOGOS } from '@/scene/office/brandLogos';
import { MASCOTS, type MascotName } from '@/scene/office/aiMascotArt';
import type { LineState, MapDepartmentId } from '@shared/departmentMap';
import {
  BOSS_DESK, CORRIDOR, HALL, LOUNGE, OUTER, PLAN_H, PLAN_W, ROOMS, SLOT_W, BAND_BOTTOM,
  deskSlots, fitText, labelAnchor, leaderPath, slotGrid, splitOverflow, textWidth,
  type DoorSpec, type RoomSpec
} from '@shared/floorPlan';
import { ACCENT, AgentCardNode, LIVE, cardPropsFor, describeAgent, mascotOf, onAgentKey, openAgent, selectAgent, statusLabel } from './parts';

/**
 * The smooth top-down office (one inline <svg>, viewBox 1000×700, scaled with
 * preserveAspectRatio meet). Rooms/doors/furniture are flat vector shapes coloured
 * through CSS variables (teamMap.css: light + dark). Animations are CSS only.
 */

// ─── small vector pieces ─────────────────────────────────────────────────────

function Plant({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`} aria-hidden="true">
      <ellipse className="fp-shadow" cx="1.5" cy="9" rx="10" ry="3.5" />
      <ellipse className="fp-leaf-2" cx="-6" cy="-6" rx="4" ry="10" transform="rotate(-35 -6 -6)" />
      <ellipse className="fp-leaf-2" cx="6" cy="-6" rx="4" ry="10" transform="rotate(35 6 -6)" />
      <ellipse className="fp-leaf" cx="0" cy="-9" rx="4.2" ry="11" />
      <ellipse className="fp-leaf" cx="-9" cy="-1" rx="3.5" ry="8" transform="rotate(-70 -9 -1)" />
      <ellipse className="fp-leaf" cx="9" cy="-1" rx="3.5" ry="8" transform="rotate(70 9 -1)" />
      <path className="fp-pot" d="M-7.5 1 h15 l-2 9.5 a2 2 0 0 1 -2 1.5 h-7 a2 2 0 0 1 -2 -1.5 z" />
    </g>
  );
}

function Pill({ cx, cy, text, h = 24, cls = 'fp-pill-text', pad = 14 }: { cx: number; cy: number; text: string; h?: number; cls?: string; pad?: number }) {
  const w = textWidth(text, 14) + pad * 2;
  return (
    <g aria-hidden="true">
      <rect className="fp-pill" x={cx - w / 2} y={cy - h / 2} width={w} height={h} rx={h / 2} />
      <text className={cls} x={cx} y={cy + 5} textAnchor="middle">{text}</text>
    </g>
  );
}

/** The AI's mark inside a white disc: brand logo path, or a tiny mascot face. */
const SvgLogo = memo(function SvgLogo({ mascot, cx, cy, r }: { mascot: MascotName; cx: number; cy: number; r: number }) {
  const brand = BRAND_LOGOS[mascot];
  const g = r * 1.25; // glyph edge
  if (brand) {
    const black = brand.hex.toLowerCase() === '#000000';
    return (
      <g aria-hidden="true">
        <circle cx={cx} cy={cy} r={r} style={{ fill: '#ffffff', stroke: 'var(--fp-robot-edge)', strokeWidth: 1 }} />
        <g transform={`translate(${cx - g / 2} ${cy - g / 2}) scale(${g / 24})`}>
          <path d={brand.path} fillRule={brand.evenodd ? 'evenodd' : 'nonzero'} style={{ fill: black ? '#1d2028' : brand.hex }} />
        </g>
      </g>
    );
  }
  const m = MASCOTS[mascot] ?? MASCOTS['ai-custom'];
  const hex = '#' + m.base.map((v) => v.toString(16).padStart(2, '0')).join('');
  return (
    <g aria-hidden="true">
      <circle cx={cx} cy={cy} r={r} style={{ fill: hex, stroke: 'rgba(0,0,0,0.2)', strokeWidth: 1 }} />
      <circle cx={cx - r * 0.35} cy={cy - r * 0.1} r={r * 0.22} fill="#fff" />
      <circle cx={cx + r * 0.35} cy={cy - r * 0.1} r={r * 0.22} fill="#fff" />
    </g>
  );
});

/** A round white AI robot, head centred on (0,0); scale with the parent transform. */
function Robot({ status, mascot, antenna }: { status: string; mascot: MascotName; antenna?: string }) {
  const sc = `var(--cth-status-${status}, var(--cth-status-idle))`;
  const busy = LIVE.has(status);
  const alert = status === 'blocked';
  return (
    <g aria-hidden="true">
      <ellipse className="fp-shadow" cx="0" cy="25" rx="15" ry="4" />
      <ellipse className="fp-robot-body" cx="0" cy="17" rx="12.5" ry="8.5" />
      <line x1="0" y1="-12" x2="0" y2="-18" style={{ stroke: 'var(--fp-robot-edge)', strokeWidth: 1.6 }} />
      <circle cx="0" cy="-19.5" r="2.8" style={{ fill: antenna ?? sc }} />
      <circle className="fp-robot-body" r="12.5" />
      {status !== 'idle' && <circle className="fp-ring" r="15.5" style={{ stroke: sc }} />}
      <rect className="fp-visor" x="-8.5" y="-5" width="17" height="9" rx="4.5" />
      {busy ? (
        <>
          <rect className="fp-eye" x="-5.6" y="-1.4" width="3.8" height="1.8" rx="0.9" />
          <rect className="fp-eye" x="1.8" y="-1.4" width="3.8" height="1.8" rx="0.9" />
        </>
      ) : (
        <>
          <circle className="fp-eye" cx="-3.6" cy="-0.5" r={alert ? 2.4 : 1.9} style={alert ? { fill: 'var(--fp-alert)' } : undefined} />
          <circle className="fp-eye" cx="3.6" cy="-0.5" r={alert ? 2.4 : 1.9} style={alert ? { fill: 'var(--fp-alert)' } : undefined} />
        </>
      )}
      <SvgLogo mascot={mascot} cx={0} cy={17.5} r={7.8} />
    </g>
  );
}

function Desk({ x, y }: { x: number; y: number }) {
  return (
    <g aria-hidden="true">
      <rect className="fp-shadow" x={x + 7} y={y + 4} width={58} height={20} rx={3} />
      <rect className="fp-desk" x={x + 6} y={y + 2} width={58} height={20} rx={3} />
      <rect className="fp-paper" x={x + 10} y={y + 6} width={8} height={11} rx={1} />
      <rect className="fp-monitor" x={x + 23} y={y + 4} width={26} height={10} rx={2} />
      <rect className="fp-monitor" x={x + 34} y={y + 14} width={4} height={3} />
      <rect className="fp-metal" x={x + 26} y={y + 17} width={20} height={3} rx={1} />
    </g>
  );
}

function Door({ door, glow }: { door: DoorSpec; glow?: boolean }) {
  const horiz = door.wall === 'top' || door.wall === 'bottom';
  const t = horiz ? { x: 1, y: 0 } : { x: 0, y: 1 };
  const n = door.wall === 'top' ? { x: 0, y: -1 } : door.wall === 'bottom' ? { x: 0, y: 1 } : door.wall === 'left' ? { x: -1, y: 0 } : { x: 1, y: 0 };
  const s = door.size;
  const hinge = { x: door.at.x - (t.x * s) / 2, y: door.at.y - (t.y * s) / 2 };
  const a0 = { x: hinge.x + t.x * s, y: hinge.y + t.y * s };
  const leaf = { x: hinge.x + n.x * s, y: hinge.y + n.y * s };
  const sweep = t.x * n.y - t.y * n.x > 0 ? 1 : 0;
  const gap = horiz
    ? { x: door.at.x - s / 2, y: door.at.y - 5, w: s, h: 10 }
    : { x: door.at.x - 5, y: door.at.y - s / 2, w: 10, h: s };
  return (
    <g aria-hidden="true">
      <rect className="fp-door-gap" x={gap.x} y={gap.y} width={gap.w} height={gap.h} />
      {glow && <rect className="fp-door-glow" x={gap.x} y={gap.y} width={gap.w} height={gap.h} rx={2} />}
      <path className="fp-door" d={`M${a0.x} ${a0.y} A${s} ${s} 0 0 ${sweep} ${leaf.x} ${leaf.y}`} />
      <line className="fp-door-leaf" x1={hinge.x} y1={hinge.y} x2={leaf.x} y2={leaf.y} />
    </g>
  );
}

function Bell({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`} aria-hidden="true">
      <circle className="fp-bell-bg" r="12" />
      <path className="fp-bell" d="M0 -7 c3.6 0 5.4 2.6 5.4 5.6 v3.2 l1.8 2.2 h-14.4 l1.8 -2.2 v-3.2 c0 -3 1.8 -5.6 5.4 -5.6 z M-2.2 5.2 a2.2 2.2 0 0 0 4.4 0 z" />
    </g>
  );
}

// ─── static decor (rendered once) ────────────────────────────────────────────

const ROOM_FILL: Record<RoomSpec['id'], string> = {
  coding: 'fp-room-coding', research: 'fp-room-research', media: 'fp-room-media', review: 'fp-room-review',
  other: 'fp-room-other', meeting: 'fp-room-meeting', storage: 'fp-room-storage', pantry: 'fp-room-pantry'
};

const Floors = memo(function Floors() {
  return (
    <g aria-hidden="true">
      <rect className="fp-hall" x={OUTER.x} y={OUTER.y} width={OUTER.w} height={OUTER.h} rx={6} />
      <rect className="fp-band" x={OUTER.x} y={OUTER.y} width={OUTER.w} height={BAND_BOTTOM - OUTER.y} />
      <rect className="fp-lounge" x={LOUNGE.x + 8} y={LOUNGE.y + 10} width={LOUNGE.w - 16} height={LOUNGE.h - 22} rx={10} />
      <rect className="fp-band" x={CORRIDOR.x} y={CORRIDOR.y} width={CORRIDOR.w} height={CORRIDOR.h} />
      {Array.from({ length: 9 }, (_, i) => (
        <line key={i} className="fp-stroke" x1={CORRIDOR.x + 3} x2={CORRIDOR.x + CORRIDOR.w - 3} y1={CORRIDOR.y + 18 + i * 20} y2={CORRIDOR.y + 18 + i * 20} style={{ strokeWidth: 1, opacity: 0.25 }} />
      ))}
      {ROOMS.map((r) => <rect key={r.id} className={ROOM_FILL[r.id]} x={r.box.x} y={r.box.y} width={r.box.w} height={r.box.h} />)}
      {/* faint floor grid in the hall */}
      <rect x={HALL.x + 120} y={HALL.y + 10} width={HALL.w - 240} height={HALL.h - 20} rx={8} style={{ fill: 'none', stroke: 'var(--fp-path-idle)', strokeWidth: 1.2 }} />
    </g>
  );
});

const Walls = memo(function Walls() {
  return (
    <g aria-hidden="true" style={{ fill: 'none' }}>
      {ROOMS.map((r) => <rect key={r.id} className="fp-wall" x={r.box.x} y={r.box.y} width={r.box.w} height={r.box.h} style={{ strokeWidth: 7, fill: 'none' }} />)}
      <line className="fp-wall" x1={OUTER.x} x2={OUTER.x + OUTER.w} y1={BAND_BOTTOM} y2={BAND_BOTTOM} style={{ strokeWidth: 7 }} />
      <rect className="fp-wall" x={OUTER.x} y={OUTER.y} width={OUTER.w} height={OUTER.h} rx={6} style={{ strokeWidth: 12, fill: 'none' }} />
    </g>
  );
});

const Decor = memo(function Decor() {
  return (
    <g aria-hidden="true">
      {/* top band: clock, windows, calendar, water cooler */}
      <circle cx="44" cy="36" r="13" className="fp-paper" style={{ stroke: 'var(--fp-wall)', strokeWidth: 2 }} />
      <path d="M44 28 V36 H50" className="fp-stroke" style={{ strokeWidth: 2, strokeLinecap: 'round' }} />
      {[100, 560, 830].map((x) => (
        <g key={x}>
          <rect className="fp-glass" x={x} y={24} width={74} height={22} rx={2} />
          <line className="fp-stroke" x1={x + 37} x2={x + 37} y1={24} y2={46} style={{ strokeWidth: 2 }} />
        </g>
      ))}
      <rect className="fp-paper" x="200" y="18" width="32" height="32" rx="3" style={{ stroke: 'var(--fp-desk-edge)', strokeWidth: 1 }} />
      <rect x="200" y="18" width="32" height="9" rx="2" style={{ fill: '#e0605a' }} />
      {Array.from({ length: 9 }, (_, i) => <rect key={i} x={204 + (i % 3) * 9} y={31 + Math.floor(i / 3) * 6} width="6" height="3.5" rx="1" style={{ fill: i === 4 ? '#e0605a' : 'var(--fp-desk-edge)' }} />)}
      <Plant x={282} y={40} s={0.8} />
      <rect className="fp-metal" x="944" y="34" width="26" height="22" rx="3" />
      <circle cx="957" cy="27" r="10" style={{ fill: 'var(--fp-glass)', stroke: 'var(--fp-wall)', strokeWidth: 1.5 }} />
      <rect className="fp-metal" x="914" y="38" width="18" height="18" rx="4" />

      {/* meeting room */}
      <rect className="fp-wood" x="316" y="118" width="130" height="52" rx="7" />
      {[328, 368, 408].map((x) => <rect key={`t${x}`} className="fp-chair" x={x} y="100" width="26" height="14" rx="5" />)}
      {[328, 368, 408].map((x) => <rect key={`b${x}`} className="fp-chair" x={x} y="174" width="26" height="14" rx="5" />)}
      <rect className="fp-monitor" x="455" y="110" width="7" height="68" rx="2" />
      <Plant x={306} y={86} s={0.85} />

      {/* hall furniture along the top wall */}
      <rect className="fp-metal" x="296" y="280" width="28" height="22" rx="2" />
      <rect className="fp-metal" x="326" y="280" width="28" height="22" rx="2" />
      <rect className="fp-wood" x="452" y="279" width="96" height="20" rx="2" />
      {['#5aa36a', '#4a7ec2', '#3f5ea8', '#5aa36a', '#4a7ec2', '#e0605a'].map((c, i) => (
        <rect key={i} x={458 + i * 8} y={282} width={6} height={14} rx={1} style={{ fill: c }} />
      ))}
      <rect className="fp-metal" x="626" y="279" width="34" height="24" rx="2" />
      <rect className="fp-metal" x="662" y="279" width="34" height="24" rx="2" />
      <Plant x={402} y={398} s={1.25} />
      <Plant x={598} y={398} s={1.25} />

      {/* lounge: round table + chairs, sofa + coffee table */}
      <circle cx="388" cy="588" r="27" className="fp-paper" style={{ stroke: 'var(--fp-desk-edge)', strokeWidth: 1.2 }} />
      {[[-34, -30], [34, -30], [-34, 30], [34, 30]].map(([dx, dy], i) => (
        <circle key={i} cx={388 + dx} cy={588 + dy} r="12" className="fp-chair" />
      ))}
      <rect className="fp-sofa" x="500" y="532" width="26" height="110" rx="7" />
      <rect className="fp-sofa" x="514" y="540" width="22" height="94" rx="5" style={{ opacity: 0.75 }} />
      <rect className="fp-wood" x="570" y="566" width="58" height="34" rx="4" />
      <Plant x={598} y={580} s={0.6} />
      <Plant x={470} y={640} s={0.95} />
      <Plant x={676} y={652} s={0.95} />

      {/* 자료실: shelves, boxes, cabinets */}
      {[500, 540, 580].map((y, j) => (
        <g key={y}>
          <rect className="fp-wood" x="28" y={y} width="130" height="18" rx="2" />
          {Array.from({ length: 12 }, (_, i) => <rect key={i} x={32 + i * 10.4} y={y + 3} width="7" height="12" rx="1" style={{ fill: ['#4a7ec2', '#5aa36a', '#d9a441', '#e0605a'][(i + j) % 4], opacity: 0.85 }} />)}
        </g>
      ))}
      <rect className="fp-wood" x="182" y="504" width="34" height="26" rx="2" />
      <rect className="fp-wood" x="186" y="534" width="30" height="24" rx="2" />
      <rect className="fp-metal" x="236" y="510" width="40" height="48" rx="3" />
      <line className="fp-stroke" x1="236" x2="276" y1="534" y2="534" style={{ strokeWidth: 1, opacity: 0.4 }} />
      <Plant x={34} y={656} s={0.95} />

      {/* 탕비실: counter, sink, coffee machine, fridge, table */}
      <rect className="fp-desk" x="720" y="494" width="170" height="24" rx="3" />
      <rect className="fp-metal" x="744" y="498" width="34" height="16" rx="5" />
      <rect className="fp-monitor" x="800" y="496" width="22" height="20" rx="3" />
      <rect className="fp-metal" x="906" y="494" width="40" height="52" rx="4" />
      <line className="fp-stroke" x1="910" x2="942" y1="514" y2="514" style={{ strokeWidth: 1, opacity: 0.4 }} />
      <circle cx="812" cy="598" r="20" className="fp-paper" style={{ stroke: 'var(--fp-desk-edge)', strokeWidth: 1.2 }} />
      <circle cx="782" cy="598" r="10" className="fp-chair" />
      <circle cx="842" cy="598" r="10" className="fp-chair" />
      <rect className="fp-metal" x="944" y="580" width="24" height="22" rx="3" />
      <circle cx="956" cy="573" r="9" style={{ fill: 'var(--fp-glass)', stroke: 'var(--fp-wall)', strokeWidth: 1.5 }} />
      <Plant x={966} y={656} s={0.95} />
    </g>
  );
});

// ─── the plan ────────────────────────────────────────────────────────────────

export interface OfficePlanProps {
  groups: Record<MapDepartmentId, Agent[]>;
  lineStates: Record<MapDepartmentId, LineState>;
  god: Agent | undefined;
  bossName: string;
  bossChip: string;
  bossStatusKey: string;
  selectedId: string | null;
  meetingActive: boolean;
  deptLabel: (id: MapDepartmentId) => string;
  emptyCta?: React.ReactNode;
}

const DEPT_ROOMS = ROOMS.filter((r) => r.kind === 'dept') as Array<RoomSpec & { id: MapDepartmentId }>;

export function OfficePlan(p: OfficePlanProps) {
  const { t } = useTranslation();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [pop, setPop] = useState<MapDepartmentId | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setBox((b) => (b.w === el.clientWidth && b.h === el.clientHeight ? b : { w: el.clientWidth, h: el.clientHeight }));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!pop) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPop(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pop]);

  // viewBox → px (preserveAspectRatio meet, centred)
  const scale = box.w > 0 ? Math.min(box.w / PLAN_W, box.h / PLAN_H) : 1;
  const offX = (box.w - PLAN_W * scale) / 2, offY = (box.h - PLAN_H * scale) / 2;

  const god = p.god;
  const godLine = god ? describeAgent(t, god) : null;
  const godBusy = !!god && LIVE.has(god.status);

  const bubbles: Array<{ key: string; x: number; y: number; text: string; full: string; accent: string; w: number }> = [];

  return (
    <div ref={wrapRef} className="fp-wrap">
      <svg className="fp-svg" viewBox={`0 0 ${PLAN_W} ${PLAN_H}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={t('extra.teamMap.planAria')}>
        <Floors />
        <Decor />
        <Walls />
        {ROOMS.map((r) => <Door key={r.id} door={r.door} glow={r.kind === 'dept' && p.lineStates[r.id as MapDepartmentId] === 'alert'} />)}

        {/* leader → room paths */}
        {DEPT_ROOMS.map((r) => {
          const st = p.lineStates[r.id];
          const lp = leaderPath(r.door);
          return (
            <g key={r.id} style={{ ['--tm-accent' as string]: ACCENT[r.id] }} aria-hidden="true">
              <path className="fp-path-under" data-state={st} d={lp.d} />
              <path className="fp-path" data-state={st} d={lp.d} />
            </g>
          );
        })}

        {/* department rooms: desks, robots, labels */}
        {DEPT_ROOMS.map((r) => {
          const list = p.groups[r.id];
          const { shown, hidden } = splitOverflow(r.box, list);
          const slots = deskSlots(r.box, Math.max(2, shown.length));
          const label = p.deptLabel(r.id);
          const la = labelAnchor(r.box);
          const pillW = textWidth(label, 14) + 28;
          const accent = ACCENT[r.id];
          return (
            <g key={r.id} role="group" aria-label={t('extra.teamMap.panelAria', { dept: label, count: list.length })} style={{ ['--tm-accent' as string]: accent }}>
              {slots.map((s, i) => <Desk key={`d${i}`} x={s.x} y={s.y} />)}
              {r.id !== 'other' && <Plant x={r.box.x + 22} y={r.box.y + r.box.h - 24} s={0.8} />}
              {shown.map((a, i) => {
                const s = slots[i];
                const cx = s.x + SLOT_W / 2, cy = s.y + 33;
                const sl = statusLabel(t, a.status);
                const d = describeAgent(t, a);
                const name = fitText(a.name, SLOT_W - 12, 13);
                const nw = Math.min(SLOT_W - 2, textWidth(name, 13) + 14);
                if (LIVE.has(a.status) && d.live) {
                  // Room for a long bubble only when the desks beside it have none.
                  const cols = slotGrid(r.box).cols;
                  const nb = (j: number) => j >= 0 && j < shown.length && Math.floor(j / cols) === Math.floor(i / cols) && LIVE.has(shown[j].status);
                  const text = fitText(d.live, nb(i - 1) || nb(i + 1) ? SLOT_W - 18 : 112, 12.5);
                  const w = textWidth(text, 12.5) + 14;
                  const x = Math.max(r.box.x + 6 + w / 2, Math.min(r.box.x + r.box.w - 6 - w / 2, cx));
                  bubbles.push({ key: a.id, x, y: s.y, text, full: d.live, accent, w });
                }
                return (
                  <g
                    key={a.id}
                    className="fp-agent"
                    role="button"
                    tabIndex={0}
                    aria-label={t('extra.teamMap.cardAria', { name: a.name, dept: label, status: sl, action: d.line || '-' })}
                    aria-pressed={a.id === p.selectedId}
                    data-selected={a.id === p.selectedId}
                    onClick={() => selectAgent(a.id)}
                    onDoubleClick={() => openAgent(a.id)}
                    onKeyDown={(e) => onAgentKey(e, a.id)}
                  >
                    <title>{`${a.name} · ${sl}${d.line ? ` · ${d.line}` : ''}`}</title>
                    <rect className="fp-hover" x={s.x + 1} y={s.y + 18} width={SLOT_W - 2} height={58} rx={10} />
                    <circle className="fp-focus" cx={cx} cy={cy + 2} r={23} />
                    <g transform={`translate(${cx} ${cy}) scale(1.12)`}><Robot status={a.status} mascot={mascotOf(a)} /></g>
                    <rect className="fp-pill" x={cx - nw / 2} y={s.y + 59} width={nw} height={17} rx={8.5} />
                    <text className="fp-name-text" x={cx} y={s.y + 72} textAnchor="middle">{name}</text>
                  </g>
                );
              })}
              <rect className="fp-pill" x={la.x - pillW / 2} y={la.y - 13} width={pillW} height={26} rx={13} />
              <text className="fp-pill-text" x={la.x} y={la.y + 5} textAnchor="middle">{label}</text>
              {list.length > 0 && (
                <g aria-hidden="true">
                  <circle cx={la.x + pillW / 2 + 15} cy={la.y} r={12} style={{ fill: accent }} />
                  <text className="fp-chip-text" x={la.x + pillW / 2 + 15} y={la.y + 4.5} textAnchor="middle" style={{ fill: '#1b1e25' }}>{list.length}</text>
                </g>
              )}
              {hidden > 0 && (
                <g
                  className="fp-overflow"
                  role="button"
                  tabIndex={0}
                  aria-label={t('extra.teamMap.moreAria', { dept: label, count: hidden })}
                  aria-expanded={pop === r.id}
                  onClick={() => setPop(pop === r.id ? null : r.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPop(pop === r.id ? null : r.id); } }}
                >
                  <rect className="fp-overflow-bg" x={la.x - pillW / 2 - 52} y={la.y - 12} width={44} height={24} rx={12} />
                  <text className="fp-overflow-text" x={la.x - pillW / 2 - 30} y={la.y + 4.5} textAnchor="middle">+{hidden}</text>
                </g>
              )}
              {p.lineStates[r.id] === 'alert' && (() => {
                const dn = r.door.wall === 'bottom' ? { x: 0, y: 1 } : r.door.wall === 'left' ? { x: -1, y: 0 } : r.door.wall === 'right' ? { x: 1, y: 0 } : { x: 0, y: -1 };
                const off = r.door.wall === 'bottom' ? { x: 26, y: 0 } : { x: 0, y: -26 };
                return <Bell x={r.door.at.x + dn.x * 16 + off.x} y={r.door.at.y + dn.y * 16 + off.y} />;
              })()}
            </g>
          );
        })}

        {/* decor room labels */}
        {ROOMS.filter((r) => r.kind !== 'dept').map((r) => {
          const la = labelAnchor(r.box);
          const label = t(`extra.teamMap.room.${r.id}`);
          return (
            <g key={r.id}>
              <Pill cx={la.x} cy={la.y} text={label} h={26} />
              {r.id === 'meeting' && p.meetingActive && (
                <g aria-label={t('extra.teamMap.meetingNow')} role="status">
                  <rect x={la.x - 34} y={la.y - 44} width={68} height={22} rx={11} style={{ fill: 'var(--cth-status-blocked)' }} />
                  <text className="fp-chip-text" x={la.x} y={la.y - 28.5} textAnchor="middle" style={{ fill: '#fff' }}>{t('extra.teamMap.meetingNow')}</text>
                </g>
              )}
            </g>
          );
        })}

        {/* the 팀장 desk */}
        <g
          className="fp-boss"
          role="button"
          tabIndex={0}
          data-selected={!!god && god.id === p.selectedId}
          aria-label={t('extra.teamMap.bossAria', { name: p.bossName, status: p.bossChip, action: godLine?.line || '-' })}
          onClick={() => { if (god) selectAgent(god.id); }}
          onDoubleClick={() => { if (god) openAgent(god.id); }}
          onKeyDown={(e) => { if (god) onAgentKey(e, god.id); }}
        >
          <rect className="fp-focus" x={BOSS_DESK.x - 14} y={BOSS_DESK.y - 52} width={BOSS_DESK.w + 28} height={BOSS_DESK.h + 112} rx={18} />
          <g transform={`translate(500 ${BOSS_DESK.y - 16}) scale(1.45)`}>
            <Robot status={god?.status ?? 'idle'} mascot={god ? mascotOf(god) : 'ai-claude'} antenna="var(--cth-lemon)" />
          </g>
          <rect className="fp-shadow" x={BOSS_DESK.x + 2} y={BOSS_DESK.y + 4} width={BOSS_DESK.w} height={BOSS_DESK.h} rx={5} />
          <rect className="fp-wood" x={BOSS_DESK.x} y={BOSS_DESK.y} width={BOSS_DESK.w} height={BOSS_DESK.h} rx={5} />
          <rect className="fp-monitor" x={482} y={BOSS_DESK.y + 4} width={36} height={13} rx={2} />
          <rect className="fp-paper" x={BOSS_DESK.x + 98} y={BOSS_DESK.y + 8} width={14} height={18} rx={1.5} />
          <rect className="fp-metal" x={486} y={BOSS_DESK.y + 22} width={28} height={4} rx={1.5} />
          <SvgLogo mascot={god ? mascotOf(god) : 'ai-claude'} cx={BOSS_DESK.x + 22} cy={BOSS_DESK.y + 20} r={12} />
          {(() => {
            const title = `${t('extra.teamMap.leader')} · ${p.bossName}`;
            const w = textWidth(title, 14) + 30;
            const cw = textWidth(p.bossChip, 13) + 30;
            const y = BOSS_DESK.y + BOSS_DESK.h + 8;
            const sc = `var(--cth-status-${p.bossStatusKey}, var(--cth-status-idle))`;
            return (
              <>
                <rect className="fp-pill" x={500 - w / 2} y={y} width={w} height={26} rx={13} />
                <text className="fp-pill-text" x={500} y={y + 18} textAnchor="middle">{title}</text>
                <rect x={500 - cw / 2} y={y + 31} width={cw} height={22} rx={11} style={{ fill: 'var(--fp-bubble)', stroke: sc, strokeWidth: 1.6 }} />
                <circle cx={500 - cw / 2 + 12} cy={y + 42} r={4} style={{ fill: sc }} />
                <text className="fp-chip-text" x={500 + 6} y={y + 46.5} textAnchor="middle" style={{ fill: 'var(--fp-bubble-text)' }}>{p.bossChip}</text>
              </>
            );
          })()}
        </g>

        {/* "what I'm doing" bubbles, on top of everything */}
        {godBusy && godLine?.live && (() => {
          const text = fitText(godLine.live, 180, 13);
          const w = textWidth(text, 13) + 18;
          const y = BOSS_DESK.y - 84;
          return (
            <g aria-hidden="true" style={{ ['--tm-accent' as string]: 'var(--cth-lemon)' }}>
              <rect className="fp-bubble" x={500 - w / 2} y={y} width={w} height={22} rx={11} />
              <text className="fp-bubble-text" x={500} y={y + 15.5} textAnchor="middle" style={{ fontSize: 13 }}>{text}</text>
            </g>
          );
        })()}
        {bubbles.map((b) => (
          <g key={b.key} aria-hidden="true" style={{ ['--tm-accent' as string]: b.accent }}>
            <rect className="fp-bubble" x={b.x - b.w / 2} y={b.y} width={b.w} height={18} rx={9} />
            <text className="fp-bubble-text" x={b.x} y={b.y + 13} textAnchor="middle">{b.text}</text>
          </g>
        ))}
      </svg>

      {p.emptyCta && box.w > 0 && (
        <div
          className="fp-cta"
          style={{ position: 'absolute', left: offX + 500 * scale, top: offY + (BOSS_DESK.y + 120) * scale, transform: 'translateX(-50%)' }}
        >{p.emptyCta}</div>
      )}

      {pop && box.w > 0 && (() => {
        const r = DEPT_ROOMS.find((x) => x.id === pop)!;
        const label = p.deptLabel(r.id);
        const cx = offX + (r.box.x + r.box.w / 2) * scale;
        const left = Math.max(8, Math.min(box.w - 288, cx - 140));
        const below = r.box.y < 300;
        const top = below ? offY + (r.box.y + r.box.h) * scale + 6 : undefined;
        const bottom = below ? undefined : box.h - (offY + r.box.y * scale) + 6;
        return (
          <>
            <div style={{ position: 'absolute', inset: 0, zIndex: 7 }} onClick={() => setPop(null)} />
            <div className="fp-pop" role="dialog" aria-label={t('extra.teamMap.panelAria', { dept: label, count: p.groups[r.id].length })} style={{ left, top, bottom, ['--tm-accent' as string]: ACCENT[r.id] }}>
              <header className="tm-panel-head" style={{ height: 48 }}>
                <span className="tm-panel-title">{label}</span>
                <span className="tm-panel-count">{p.groups[r.id].length}</span>
              </header>
              <div className="tm-panel-body">
                {p.groups[r.id].map((a) => <AgentCardNode key={a.id} {...cardPropsFor(t, a, label, p.selectedId)} />)}
              </div>
            </div>
          </>
        );
      })()}
    </div>
  );
}
