// Original pixel-art mascots, one per AI provider, with eyes only.
//
// Each mascot is a simple, hand-authored silhouette (NOT a copy of any vendor
// logo) that is recognisable by shape + colour. The only facial feature is a
// pair of small eyes; the eyes carry the agent's state:
//   idle    → round open eyes
//   working → narrowed eyes that blink          (type frames)
//   reading → eyes glance left / right          (read frames)
//   blocked → wide, startled eyes               (frame 7, shown while blocked)
//
// Output matches what cast.ts/CharacterSprite expect: an 18×32 scene frame grid
// [stand, stepL, stepR, type1, type2, read1, read2, blocked] for front and back.

import { BRAND_LOGOS, type BrandLogo } from './brandLogos';

type RGB = [number, number, number];
type Buf = Uint8ClampedArray;

export const MASCOT_W = 18;
export const MASCOT_H = 32;
const OUTLINE: RGB = [38, 34, 46];
const EYE_WHITE: RGB = [250, 248, 240];
const EYE_PUPIL: RGB = [30, 28, 40];
const FOOT: RGB = [48, 44, 60];

export type MascotName =
  | 'ai-claude' | 'ai-codex' | 'ai-gemini' | 'ai-grok' | 'ai-kimi' | 'ai-antigravity'
  | 'ai-qwen' | 'ai-opencode' | 'ai-crush' | 'ai-pi' | 'ai-copilot' | 'ai-cursor' | 'ai-custom';

interface Mascot {
  label: string;
  /** Short note shown in the character picker. */
  blurb: string;
  base: RGB;
  /** 14 columns × 14 rows. '#' body, 'l' light, 'd' dark, '.' empty. */
  mask: string[];
  /** Left-eye top-left cell (x,y) inside the mask grid; right eye is mirrored by `gap`. */
  eye: { x: number; y: number; gap: number };
}

const M = (rows: string[]): string[] => rows.map((r) => r.padEnd(14, '.').slice(0, 14));

export const MASCOTS: Record<MascotName, Mascot> = {
  // Warm orange blob with stubby side arms.
  'ai-claude': {
    label: 'Claude', blurb: 'Orange blob with arms', base: [217, 119, 87],
    mask: M([
      '..............',
      '..############',
      '..############',
      '.l############',
      '##############',
      '##############',
      '.l############',
      '..############',
      '..############',
      '..dddddddddd..',
      '..............',
      '..............',
      '..............',
      '..............',
    ]).map((r) => r.slice(0, 14)),
    eye: { x: 4, y: 3, gap: 4 },
  },
  // Rounded cloud-like shape, teal.
  'ai-codex': {
    label: 'Codex', blurb: 'Teal cloud', base: [32, 163, 128],
    mask: M([
      '....######....',
      '..##########..',
      '.############.',
      '.############.',
      '##############',
      '##############',
      '##############',
      '.############.',
      '.############.',
      '..dddddddddd..',
      '..............',
      '..............',
      '..............',
      '..............',
    ]),
    eye: { x: 4, y: 4, gap: 4 },
  },
  // Four-point sparkle, blue-violet.
  'ai-gemini': {
    label: 'Gemini', blurb: 'Four-point star', base: [110, 128, 240],
    mask: M([
      '......##......',
      '......##......',
      '.....####.....',
      '....######....',
      '##############',
      '##############',
      '##############',
      '##############',
      '....######....',
      '.....####.....',
      '......##......',
      '......##......',
      '..............',
      '..............',
    ]),
    eye: { x: 4, y: 4, gap: 4 },
  },
  // Dark circle with a diagonal cut.
  'ai-grok': {
    label: 'Grok', blurb: 'Dark disc, diagonal cut', base: [70, 72, 84],
    mask: M([
      '....######....',
      '..##########..',
      '.##########l..',
      '.#########l#..',
      '########l#####',
      '#######l######',
      '######l#######',
      '.#####l######.',
      '.####l#######.',
      '..dddddddddd..',
      '..............',
      '..............',
      '..............',
      '..............',
    ]),
    eye: { x: 3, y: 4, gap: 5 },
  },
  // Blue rounded square.
  'ai-kimi': {
    label: 'Kimi', blurb: 'Blue block', base: [60, 140, 250],
    mask: M([
      '.############.',
      '##############',
      '##############',
      '##############',
      '##############',
      '##############',
      '##############',
      '##############',
      '.############.',
      '..dddddddddd..',
      '..............',
      '..............',
      '..............',
      '..............',
    ]),
    eye: { x: 4, y: 3, gap: 4 },
  },
  // Mountain / triangle, purple.
  'ai-antigravity': {
    label: 'Antigravity', blurb: 'Purple peak', base: [150, 100, 230],
    mask: M([
      '......##......',
      '.....####.....',
      '.....####.....',
      '....######....',
      '....######....',
      '...########...',
      '...########...',
      '..##########..',
      '..##########..',
      '.dddddddddddd.',
      '..............',
      '..............',
      '..............',
      '..............',
    ]),
    eye: { x: 4, y: 5, gap: 3 },
  },
  // Hexagon with a hat tip, indigo.
  'ai-qwen': {
    label: 'Qwen', blurb: 'Indigo hexagon', base: [97, 92, 237],
    mask: M([
      '......##......',
      '....######....',
      '..##########..',
      '.############.',
      '##############',
      '##############',
      '##############',
      '.############.',
      '..##########..',
      '...dddddddd...',
      '..............',
      '..............',
      '..............',
      '..............',
    ]),
    eye: { x: 4, y: 4, gap: 4 },
  },
  // Dark square with bracket corners.
  'ai-opencode': {
    label: 'OpenCode', blurb: 'Bracketed block', base: [90, 96, 110],
    mask: M([
      '##..........##',
      '#.##########.#',
      '..##########..',
      '..##########..',
      '..##########..',
      '..##########..',
      '..##########..',
      '..##########..',
      '#.##########.#',
      '##dddddddddd##',
      '..............',
      '..............',
      '..............',
      '..............',
    ]),
    eye: { x: 4, y: 3, gap: 4 },
  },
  // Pink spiky blob.
  'ai-crush': {
    label: 'Crush', blurb: 'Pink spiky blob', base: [240, 100, 175],
    mask: M([
      '#..#..##..#..#',
      '.############.',
      '##############',
      '##############',
      '##############',
      '##############',
      '##############',
      '.############.',
      '.############.',
      '..dddddddddd..',
      '..............',
      '..............',
      '..............',
      '..............',
    ]),
    eye: { x: 4, y: 3, gap: 4 },
  },
  // A pi-shaped body: wide bar on top, two legs.
  'ai-pi': {
    label: 'Pi', blurb: 'Pi-shaped body', base: [235, 200, 90],
    mask: M([
      '..............',
      '##############',
      '##############',
      '##############',
      '.############.',
      '..##......##..',
      '..##......##..',
      '..##......##..',
      '..##......##..',
      '..dd......dd..',
      '..............',
      '..............',
      '..............',
      '..............',
    ]),
    eye: { x: 3, y: 1, gap: 6 },
  },
  // Goggles / visor with ears, cyan.
  'ai-copilot': {
    label: 'Copilot', blurb: 'Visor with ears', base: [70, 190, 220],
    mask: M([
      '..............',
      '#..########..#',
      '##############',
      '##############',
      '##############',
      '##############',
      '.############.',
      '..##########..',
      '..##########..',
      '...dddddddd...',
      '..............',
      '..............',
      '..............',
      '..............',
    ]),
    eye: { x: 3, y: 3, gap: 5 },
  },
  // Isometric cube, light grey.
  'ai-cursor': {
    label: 'Cursor', blurb: 'Grey cube', base: [190, 192, 200],
    mask: M([
      '......##......',
      '....######....',
      '..##########..',
      '##############',
      '##############',
      '##############',
      '##############',
      '.############.',
      '..##########..',
      '....dddddd....',
      '..............',
      '..............',
      '..............',
      '..............',
    ]),
    eye: { x: 4, y: 4, gap: 4 },
  },
  // Plain terminal-ish block for custom CLIs.
  'ai-custom': {
    label: 'Custom', blurb: 'Plain grey block', base: [130, 140, 150],
    mask: M([
      '..............',
      '.############.',
      '.############.',
      '.############.',
      '.############.',
      '.############.',
      '.############.',
      '.############.',
      '.############.',
      '..dddddddddd..',
      '..............',
      '..............',
      '..............',
      '..............',
    ]),
    eye: { x: 4, y: 3, gap: 4 },
  },
};

export const MASCOT_NAMES = Object.keys(MASCOTS) as MascotName[];

export function isMascotName(n: string | undefined | null): n is MascotName {
  return !!n && n in MASCOTS;
}

/** Which mascot represents a CLI provider (see shared/agentProvider.ts). */
export function mascotForProvider(provider: string | undefined | null): MascotName {
  const key = `ai-${provider ?? 'custom'}`;
  return isMascotName(key) ? key : 'ai-custom';
}

/** The provider id behind a mascot ('ai-codex' → 'codex'); undefined for non-mascot names. */
export function providerForMascot(name: string): string | undefined {
  return isMascotName(name) ? name.slice(3) : undefined;
}

// ─── drawing primitives ──────────────────────────────────────────────────────
const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
const lighten = (c: RGB): RGB => [clamp(c[0] * 1.2 + 8), clamp(c[1] * 1.2 + 8), clamp(c[2] * 1.2 + 8)];
const darken = (c: RGB): RGB => [clamp(c[0] * 0.68), clamp(c[1] * 0.68), clamp(c[2] * 0.68)];

function set(buf: Buf, w: number, h: number, x: number, y: number, c: RGB): void {
  if (x < 0 || x >= w || y < 0 || y >= h) return;
  const i = (y * w + x) * 4;
  buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2]; buf[i + 3] = 255;
}
const alpha = (buf: Buf, w: number, h: number, x: number, y: number) =>
  x < 0 || x >= w || y < 0 || y >= h ? 0 : buf[(y * w + x) * 4 + 3];

function outline(buf: Buf, w: number, h: number): void {
  const pts: [number, number][] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (alpha(buf, w, h, x, y) !== 0) continue;
    if (alpha(buf, w, h, x + 1, y) === 255 || alpha(buf, w, h, x - 1, y) === 255 ||
        alpha(buf, w, h, x, y + 1) === 255 || alpha(buf, w, h, x, y - 1) === 255) pts.push([x, y]);
  }
  for (const [x, y] of pts) set(buf, w, h, x, y, OUTLINE);
}

export type EyeState = 'open' | 'narrow' | 'blink' | 'lookL' | 'lookR' | 'wide';

function drawEye(buf: Buf, w: number, h: number, ex: number, ey: number, st: EyeState): void {
  // ex,ey = top-left of a 2-wide eye cell; the eye occupies up to 3 rows.
  const px = (dx: number, dy: number, c: RGB) => set(buf, w, h, ex + dx, ey + dy, c);
  switch (st) {
    case 'open':
      for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 2; dx++) px(dx, dy, EYE_WHITE);
      px(1, 2, EYE_PUPIL); px(1, 1, EYE_PUPIL); break;
    case 'narrow':
      for (let dx = 0; dx < 2; dx++) { px(dx, 1, EYE_WHITE); px(dx, 2, EYE_WHITE); }
      px(1, 2, EYE_PUPIL); break;
    case 'blink':
      px(0, 2, EYE_PUPIL); px(1, 2, EYE_PUPIL); break;
    case 'lookL':
      for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 2; dx++) px(dx, dy, EYE_WHITE);
      px(0, 1, EYE_PUPIL); px(0, 2, EYE_PUPIL); break;
    case 'lookR':
      for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 2; dx++) px(dx, dy, EYE_WHITE);
      px(1, 1, EYE_PUPIL); px(1, 2, EYE_PUPIL); break;
    case 'wide':
      for (let dy = -1; dy < 3; dy++) for (let dx = 0; dx < 2; dx++) px(dx, dy, EYE_WHITE);
      px(0, 1, EYE_PUPIL); // tiny startled pupil
      break;
  }
}

/** Draw one mascot frame. `phase` 0 stand / 1 step-L / 2 step-R; `eyes` null = back view. */
function drawFrame(name: MascotName, phase: number, eyes: EyeState | null, w: number, h: number, bodyTop: number, withFeet: boolean): Buf {
  const m = MASCOTS[name];
  const buf = new Uint8ClampedArray(w * h * 4);
  const light = lighten(m.base), dark = darken(m.base);
  const bob = phase === 0 ? 0 : -1; // body lifts a pixel mid-step
  const ox = Math.floor((w - 14) / 2);
  const back = eyes === null;
  for (let y = 0; y < 14; y++) {
    for (let x = 0; x < 14; x++) {
      const ch = m.mask[y][x];
      if (ch === '.') continue;
      const c = ch === 'l' ? light : ch === 'd' ? dark : m.base;
      set(buf, w, h, ox + x, bodyTop + y + bob, back && ch === '#' ? darken([c[0], c[1], c[2]] as RGB) : c);
    }
  }
  if (withFeet) {
    const fy = bodyTop + 9 + 1; // just under the shaded base row
    const lift = (side: 'L' | 'R') => (phase === 1 && side === 'L') || (phase === 2 && side === 'R') ? 1 : 0;
    for (let dy = 0; dy < 3; dy++) {
      for (let dx = 0; dx < 2; dx++) {
        set(buf, w, h, ox + 3 + dx, fy + dy - lift('L'), FOOT);
        set(buf, w, h, ox + 9 + dx, fy + dy - lift('R'), FOOT);
      }
    }
  }
  if (eyes) {
    const ex = ox + m.eye.x, ey = bodyTop + m.eye.y + bob;
    drawEye(buf, w, h, ex, ey, eyes);
    drawEye(buf, w, h, ex + m.eye.gap, ey, eyes);
  }
  outline(buf, w, h);
  return buf;
}

export interface MascotSceneFrames { front: Buf[]; back: Buf[]; }
const sceneCache = new Map<MascotName, MascotSceneFrames>();

/**
 * front: [stand, stepL, stepR, type1, type2, read1, read2, blocked]
 * back:  [stand, stepL, stepR] (agents seated at their desk face away)
 */
export function mascotSceneFrames(name: MascotName): MascotSceneFrames {
  let f = sceneCache.get(name);
  if (!f) {
    // Body top at row 12 so the sprite stands on the floor like the human cast did.
    const T = 12, W = MASCOT_W, H = MASCOT_H;
    const front = [
      drawFrame(name, 0, 'open', W, H, T, true),
      drawFrame(name, 1, 'open', W, H, T, true),
      drawFrame(name, 2, 'open', W, H, T, true),
      drawFrame(name, 0, 'narrow', W, H, T, true),
      drawFrame(name, 0, 'blink', W, H, T, true),
      drawFrame(name, 0, 'lookL', W, H, T, true),
      drawFrame(name, 0, 'lookR', W, H, T, true),
      drawFrame(name, 0, 'wide', W, H, T, true),
    ];
    const back = [0, 1, 2].map((p) => drawFrame(name, p, null, W, H, T, true));
    f = { front, back };
    sceneCache.set(name, f);
  }
  return f;
}

const PORTRAIT_W = 18, PORTRAIT_H = 28;
const portraitCache = new Map<MascotName, Buf>();

export function paintMascotPortrait(ctx: CanvasRenderingContext2D, name: MascotName, scale = 2): void {
  const brand = BRAND_LOGOS[name];
  if (brand) { paintBrandLogo(ctx, brand, scale); return; }
  let buf = portraitCache.get(name);
  if (!buf) {
    buf = drawFrame(name, 0, 'open', PORTRAIT_W, PORTRAIT_H, 8, false);
    portraitCache.set(name, buf);
  }
  const stage = document.createElement('canvas');
  stage.width = PORTRAIT_W; stage.height = PORTRAIT_H;
  const sctx = stage.getContext('2d')!;
  const img = sctx.createImageData(PORTRAIT_W, PORTRAIT_H);
  img.data.set(buf);
  sctx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, PORTRAIT_W * scale, PORTRAIT_H * scale);
  ctx.drawImage(stage, 0, 0, PORTRAIT_W, PORTRAIT_H, 0, 0, PORTRAIT_W * scale, PORTRAIT_H * scale);
}

/** The provider's logo on a light rounded tile (so dark logos stay visible in dark mode). */
function paintBrandLogo(ctx: CanvasRenderingContext2D, brand: BrandLogo, scale: number): void {
  // Clean look: just the company logo, as large as the portrait box allows, on a
  // transparent background (no inner tile / outline).
  const w = PORTRAIT_W * scale, h = PORTRAIT_H * scale;
  ctx.clearRect(0, 0, w, h);
  // Cards show only the top 46/56 of the portrait (the tile is shorter than the
  // canvas and anchors the top), so centre the logo in THAT visible area.
  const visibleH = h * (46 / 56);
  const side = Math.min(w, visibleH) * 0.86;
  ctx.save();
  ctx.translate((w - side) / 2, (visibleH - side) / 2);
  ctx.scale(side / 24, side / 24);
  ctx.fillStyle = brand.hex;
  ctx.fill(new Path2D(brand.path));
  ctx.restore();
}
