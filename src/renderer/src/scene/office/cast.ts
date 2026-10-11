// The Office cast — roster metadata + sprite frames.
//
// Both the static portraits (cards / picker) and the in-scene walking sprites are
// now fully custom-drawn from the same per-character recipes in portraitArt.ts:
// the scene sprite reuses the portrait's exact head/face/clothing and adds legs,
// so an agent on the office floor looks identical to its card. The LimeZu base
// sheets are no longer used for the cast. See assets/ATTRIBUTION.md.

import { Texture } from 'pixi.js';
import { inferAgentProvider } from '@shared/agentProvider';
import { paintPortrait, sceneFrameBufs, SCENE_W, SCENE_H } from './portraitArt';
import { MASCOTS, MASCOT_NAMES, isMascotName, mascotForAgent, mascotSceneFrames, paintMascotPortrait, type MascotName } from './aiMascotArt';

export type OfficeCharacterName =
  | MascotName
  | 'michael' | 'jim' | 'pam' | 'dwight' | 'kevin' | 'angela'
  | 'oscar' | 'stanley' | 'phyllis' | 'andy' | 'kelly' | 'ryan'
  | 'toby' | 'creed' | 'meredith';

export interface CastMember {
  name: OfficeCharacterName;
  displayName: string;
  /** Signature accent color (hex) — used for the in-scene selection glow. */
  shirt: string;
  /** Blurb shown when this character is picked / has no description yet. */
  blurb: string;
}

/** Selectable roster, in display order. */
/** The Office cast — no longer offered in pickers (kept only so old saved agents resolve). */
const HUMAN_CAST: CastMember[] = [
  { name: 'michael',  displayName: 'Michael',  shirt: '#5a6b8c', blurb: "World's best boss" },
  { name: 'jim',      displayName: 'Jim',      shirt: '#6fa8dc', blurb: 'Salesman, prankster' },
  { name: 'pam',      displayName: 'Pam',      shirt: '#9caf88', blurb: 'Receptionist, artist' },
  { name: 'dwight',   displayName: 'Dwight',   shirt: '#b89b3e', blurb: 'Assistant (to the) RM' },
  { name: 'kevin',    displayName: 'Kevin',    shirt: '#4a7ab5', blurb: 'Accounting' },
  { name: 'angela',   displayName: 'Angela',   shirt: '#8a86a6', blurb: 'Head of accounting' },
  { name: 'oscar',    displayName: 'Oscar',    shirt: '#7a4b6b', blurb: 'Accountant' },
  { name: 'stanley',  displayName: 'Stanley',  shirt: '#8c5a4b', blurb: 'Sales, crossword' },
  { name: 'phyllis',  displayName: 'Phyllis',  shirt: '#b08bbf', blurb: 'Sales' },
  { name: 'andy',     displayName: 'Andy',     shirt: '#6fae6f', blurb: 'Cornell, a cappella' },
  { name: 'kelly',    displayName: 'Kelly',    shirt: '#d16ba5', blurb: 'Customer service' },
  { name: 'ryan',     displayName: 'Ryan',     shirt: '#3a3a44', blurb: 'The temp' },
  { name: 'toby',     displayName: 'Toby',     shirt: '#9a8c5a', blurb: 'Human resources' },
  { name: 'creed',    displayName: 'Creed',    shirt: '#6b7a4b', blurb: 'Quality assurance' },
  { name: 'meredith', displayName: 'Meredith', shirt: '#b5544a', blurb: 'Supplier relations' },
];

/** AI mascots (one per provider) — the characters the floor actually shows. */
const MASCOT_CAST: CastMember[] = MASCOT_NAMES.map((name) => {
  const m = MASCOTS[name];
  const hex = '#' + m.base.map((v) => v.toString(16).padStart(2, '0')).join('');
  return { name, displayName: m.label, shirt: hex, blurb: m.blurb };
});
/** Characters offered in the agent pickers: one per AI provider. */
export const OFFICE_CAST: CastMember[] = [...MASCOT_CAST];

/**
 * The character an agent is drawn as. Every agent is shown as the mascot of the
 * AI that runs it (eyes-only; the eyes change with its state), not as one of the
 * human cast. The stored `character` field is kept for compatibility.
 */
export function visualCharacter(agent: { provider?: string | null; command?: string | null }): OfficeCharacterName {
  // Same resolution the rest of the app uses: the saved provider, else inferred from the
  // command binary (legacy agents, hand-typed commands), else Claude.
  // An API agent (`son-api freellmapi`) shows its connector's own mascot.
  return mascotForAgent(inferAgentProvider(agent.command ?? undefined, agent.provider), agent.command);
}

export const CAST_BY_NAME: Record<OfficeCharacterName, CastMember> =
  Object.fromEntries([...MASCOT_CAST, ...HUMAN_CAST].map((c) => [c.name, c])) as Record<OfficeCharacterName, CastMember>;

export const DEFAULT_CHARACTER: OfficeCharacterName = 'ai-claude';

export function hexToNumber(hex: string): number {
  return parseInt(hex.replace('#', ''), 16);
}

// ─── scene frames ────────────────────────────────────────────────────────────
const frameCache = new Map<OfficeCharacterName, Texture[][]>();

function bufToTexture(buf: Uint8ClampedArray): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = SCENE_W; canvas.height = SCENE_H;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(SCENE_W, SCENE_H);
  img.data.set(buf);
  ctx.putImageData(img, 0, 0);
  const tex = Texture.from(canvas);
  tex.source.scaleMode = 'nearest';
  return tex;
}

/**
 * Frame grid CharacterSprite expects: 3 rows (down, up, right) × 7 frames
 * [walk1, walk2, walk3, type1, type2, read1, read2]. We provide a front view
 * (down — and reused for the side row, so left/right walkers still show a face)
 * and a back view (up — agents seated facing their desk show their back). The
 * three walk frames are stand / step-left / step-right.
 */
export async function getCastFrames(name: OfficeCharacterName): Promise<Texture[][]> {
  const cached = frameCache.get(name);
  if (cached) return cached;
  if (isMascotName(name)) {
    // Columns: [walk1, walk2, walk3, type1, type2, read1, read2, blocked].
    const { front, back } = mascotSceneFrames(name);
    const f = front.map(bufToTexture);
    const b = back.map(bufToTexture);
    const backRow = [b[0], b[1], b[2], b[0], b[0], b[0], b[0], b[0]];
    const mascotFrames: Texture[][] = [f, backRow, f]; // down, up, right
    frameCache.set(name, mascotFrames);
    return mascotFrames;
  }
  const { front, back } = sceneFrameBufs(name);
  const toRow = (bufs: Uint8ClampedArray[]): Texture[] => {
    const [stand, stepL, stepR] = bufs.map(bufToTexture);
    return [stand, stepL, stepR, stand, stand, stand, stand];
  };
  const frontRow = toRow(front);
  const frames: Texture[][] = [frontRow, toRow(back), frontRow]; // down, up, right
  frameCache.set(name, frames);
  return frames;
}

/**
 * Paint a character's static portrait for cards / the picker (delegates to the
 * custom procedural composer in portraitArt.ts).
 */
export async function paintCastPortrait(
  ctx: CanvasRenderingContext2D,
  name: OfficeCharacterName,
  scale = 2,
): Promise<void> {
  if (isMascotName(name)) { paintMascotPortrait(ctx, name, scale); return; }
  paintPortrait(ctx, name, scale);
}
