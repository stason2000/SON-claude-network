/**
 * 팀 사무실 floor plan — pure geometry for the smooth top-down office scene
 * (renderer: components/TeamMap/OfficePlan.tsx). Everything is in viewBox units
 * of a fixed 1000×700 plan that the SVG scales to its container (meet).
 *
 * Layout (mirrors the user's reference picture):
 *
 *   ┌──────── top band: clock · windows · calendar · plant · water cooler ────────┐
 *   │ 코딩 (blue)   │ 회의실 │▒│ 리서치·자료 (pink) │ 이미지·영상 (lilac)          │
 *   ├──────┬────────┴────────┴─┴────────────────────┴──────────────────┬───────────┤
 *   │ 검토 │                  hall — 팀장 desk at the centre             │ 기타      │
 *   ├──────┴──────┬───────────────────────────────────────┬──────────────┴───────────┤
 *   │ 자료실       │  lounge (round table, sofa)            │ 탕비실                  │
 *   └─────────────┴───────────────────────────────────────┴──────────────────────────┘
 *
 * Only the real departments (departments.ts) + 기타 hold AI 직원; 회의실, 자료실,
 * 탕비실 and the lounge are decor, so no team is invented.
 */
import type { MapDepartmentId } from './departmentMap';

export const PLAN_W = 1000;
export const PLAN_H = 700;

export interface Pt { x: number; y: number }
export interface Box { x: number; y: number; w: number; h: number }

export type RoomKind = 'dept' | 'meeting' | 'storage' | 'pantry';

export interface DoorSpec {
  /** Which wall of the room the door is in. */
  wall: 'top' | 'bottom' | 'left' | 'right';
  /** Centre of the door gap (on the wall line). */
  at: Pt;
  /** Gap width. */
  size: number;
}

export interface RoomSpec {
  id: MapDepartmentId | 'meeting' | 'storage' | 'pantry';
  kind: RoomKind;
  box: Box;
  door: DoorSpec;
}

export const OUTER: Box = { x: 10, y: 10, w: 980, h: 680 };
/** Top band (decor strip) ends here. */
export const BAND_BOTTOM = 62;
/** The open hall where the 팀장 desk sits. */
export const HALL: Box = { x: 226, y: 268, w: 548, h: 210 };
/** Lounge (open, part of the hall) below it. */
export const LOUNGE: Box = { x: 300, y: 478, w: 400, h: 212 };
/** Corridor strip between 회의실 and 리서치·자료. */
export const CORRIDOR: Box = { x: 478, y: 62, w: 24, h: 206 };

export const ROOMS: readonly RoomSpec[] = [
  { id: 'coding', kind: 'dept', box: { x: 10, y: 62, w: 280, h: 206 }, door: { wall: 'bottom', at: { x: 257, y: 268 }, size: 34 } },
  { id: 'meeting', kind: 'meeting', box: { x: 290, y: 62, w: 188, h: 206 }, door: { wall: 'bottom', at: { x: 397, y: 268 }, size: 34 } },
  { id: 'research', kind: 'dept', box: { x: 502, y: 62, w: 230, h: 206 }, door: { wall: 'bottom', at: { x: 577, y: 268 }, size: 34 } },
  { id: 'media', kind: 'dept', box: { x: 732, y: 62, w: 258, h: 206 }, door: { wall: 'bottom', at: { x: 755, y: 268 }, size: 34 } },
  { id: 'review', kind: 'dept', box: { x: 10, y: 268, w: 216, h: 210 }, door: { wall: 'right', at: { x: 226, y: 347 }, size: 34 } },
  { id: 'other', kind: 'dept', box: { x: 774, y: 268, w: 216, h: 210 }, door: { wall: 'left', at: { x: 774, y: 347 }, size: 34 } },
  { id: 'storage', kind: 'storage', box: { x: 10, y: 478, w: 290, h: 212 }, door: { wall: 'top', at: { x: 267, y: 478 }, size: 34 } },
  { id: 'pantry', kind: 'pantry', box: { x: 700, y: 478, w: 290, h: 212 }, door: { wall: 'top', at: { x: 733, y: 478 }, size: 34 } }
];

export function roomById(id: RoomSpec['id']): RoomSpec {
  return ROOMS.find((r) => r.id === id)!;
}

/** The 팀장 desk (centre of the hall). */
export const BOSS_DESK: Box = { x: 436, y: 360, w: 128, h: 40 };
export const BOSS_CENTER: Pt = { x: 500, y: 373 };

/** One AI 직원 "workstation": desk on top, robot in front of it, name pill below. */
export const SLOT_W = 70;
export const SLOT_H = 76;
/** Room padding and the band at the bottom reserved for the room's name pill. */
const PAD_X = 8, PAD_TOP = 10, LABEL_BAND = 38;

export interface SlotGrid { cols: number; rows: number; capacity: number }

export function slotGrid(box: Box): SlotGrid {
  const cols = Math.max(1, Math.floor((box.w - 2 * PAD_X) / SLOT_W));
  const rows = Math.max(1, Math.floor((box.h - PAD_TOP - LABEL_BAND) / SLOT_H));
  return { cols, rows, capacity: cols * rows };
}

/** Top-left of each of the first `n` workstations (n is clamped to capacity), centred in the room. */
export function deskSlots(box: Box, n: number): Pt[] {
  const g = slotGrid(box);
  const count = Math.max(0, Math.min(n, g.capacity));
  if (count === 0) return [];
  const usedCols = Math.min(g.cols, count);
  const usedRows = Math.ceil(count / g.cols);
  const x0 = box.x + (box.w - usedCols * SLOT_W) / 2;
  const areaH = box.h - PAD_TOP - LABEL_BAND;
  const y0 = box.y + PAD_TOP + (areaH - usedRows * SLOT_H) / 2;
  const out: Pt[] = [];
  for (let i = 0; i < count; i++) {
    const c = i % g.cols, r = Math.floor(i / g.cols);
    // Centre a short last row.
    const inRow = r === usedRows - 1 ? count - r * g.cols : usedCols;
    const rowX = x0 + ((usedCols - inRow) * SLOT_W) / 2;
    out.push({ x: Math.round(rowX + c * SLOT_W), y: Math.round(y0 + r * SLOT_H) });
  }
  return out;
}

/** Shown / hidden split for a room: the first `capacity` agents sit at desks, the rest are "+N". */
export function splitOverflow<T>(box: Box, list: readonly T[]): { shown: T[]; hidden: number } {
  const cap = slotGrid(box).capacity;
  return { shown: list.slice(0, cap), hidden: Math.max(0, list.length - cap) };
}

/** Centre of a room's name pill. */
export function labelAnchor(box: Box): Pt {
  return { x: box.x + box.w / 2, y: box.y + box.h - LABEL_BAND / 2 - 2 };
}

const NORMAL: Record<DoorSpec['wall'], Pt> = {
  top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 }
};

/**
 * Path from the 팀장 desk through the hall to a room's door (cubic Bézier).
 * Leaves the desk from the side facing the door and arrives straight through it.
 */
export function leaderPath(door: DoorSpec): { d: string; start: Pt; end: Pt } {
  const n = NORMAL[door.wall];
  // `n` points out of the room into the hall (a top room's bottom door opens downward).
  const end = { x: door.at.x + n.x * 4, y: door.at.y + n.y * 4 };
  const dx = end.x - BOSS_CENTER.x, dy = end.y - BOSS_CENTER.y;
  let start: Pt;
  let out: Pt;
  if (Math.abs(dx) > Math.abs(dy) * 2.2) {
    // Mostly sideways → leave from the desk's left/right edge.
    const sx = dx < 0 ? BOSS_DESK.x : BOSS_DESK.x + BOSS_DESK.w;
    start = { x: sx, y: BOSS_CENTER.y };
    out = { x: Math.sign(dx), y: 0 };
  } else {
    // Mostly up/down → leave from the top (or bottom) edge, shifted toward the door.
    const sx = BOSS_CENTER.x + Math.max(-50, Math.min(50, dx * 0.25));
    const sy = dy < 0 ? BOSS_DESK.y : BOSS_DESK.y + BOSS_DESK.h;
    start = { x: sx, y: sy };
    out = { x: 0, y: Math.sign(dy) };
  }
  const dist = Math.hypot(dx, dy);
  const k1 = Math.min(90, dist * 0.4), k2 = Math.min(70, dist * 0.35);
  const c1 = { x: start.x + out.x * k1, y: start.y + out.y * k1 };
  const c2 = { x: end.x + n.x * k2, y: end.y + n.y * k2 };
  const f = (v: number) => Math.round(v * 10) / 10;
  return {
    d: `M${f(start.x)} ${f(start.y)} C${f(c1.x)} ${f(c1.y)} ${f(c2.x)} ${f(c2.y)} ${f(end.x)} ${f(end.y)}`,
    start,
    end
  };
}

/** Rough rendered width of a label at `fontPx` (CJK ≈ 1em, Latin ≈ 0.58em). Pure. */
export function textWidth(s: string, fontPx: number): number {
  let w = 0;
  for (const ch of s) w += /[ᄀ-ᇿ　-鿿가-힯＀-￯]/.test(ch) ? fontPx : /[A-Z0-9]/.test(ch) ? fontPx * 0.64 : fontPx * 0.56;
  return w;
}

/** `s` cut so it fits `maxW` at `fontPx`, with "…" when cut. */
export function fitText(s: string, maxW: number, fontPx: number): string {
  if (textWidth(s, fontPx) <= maxW) return s;
  let out = '';
  for (const ch of s) {
    if (textWidth(out + ch + '…', fontPx) > maxW) break;
    out += ch;
  }
  return out + '…';
}

/** Container width (px) below which the plan becomes a simple list (text would drop under 13px). */
export const LIST_BREAKPOINT = 700;
