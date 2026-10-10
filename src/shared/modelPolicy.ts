/**
 * Model / reasoning-effort policy for Michael's hand-offs (rules §2).
 *
 *   단순 (정리·이름 바꾸기·요약)            → 작은 모델, 추론 강도 낮음
 *   일반 (일반 구현·자료 조사)              → 중간 모델, 추론 강도 중간
 *   어려움 (설계 판단·어려운 버그·최종 검토) → 큰 모델, 추론 강도 높음
 *
 * `pickModelAndEffort` is PURE and only returns model ids that exist in the
 * baked catalog (modelCatalog.json) or, for Perplexity, the documented preset
 * names its connector already uses. When a provider's catalog carries no size
 * information, model is null (= CLI default) and the reason says so.
 *
 * ── WHAT THE APP CAN ACTUALLY ENFORCE (honest limitation) ────────────────────
 *  MODEL — only at SPAWN. Every CLI preset with `supportsModel` + `modelFlag`
 *    (claude, codex, gemini, grok, kimi, qwen, opencode, crush, pi, copilot,
 *    cursor, antigravity — see agentProvider.ts) takes `--model <id>` on its
 *    command line; Michael sets it through the `model` field of a spawn request
 *    (workerLaunch.ts appends `--model`). API agents take it via
 *    `son-api <id> --model <id>` (connectors/index.ts). An ALREADY RUNNING
 *    worker's model cannot be changed by the app.
 *  EFFORT — not enforceable by the app for any provider in this codebase. No
 *    preset has an effort spawn flag. Claude Code has an in-session `/effort
 *    low|medium|high|xhigh|max` slash command (claudeCommands.ts), which only the
 *    session's own user can type — the app does not send it. Perplexity's preset
 *    name (fast/medium/high) doubles as its effort tier, and some Cursor /
 *    Antigravity catalog ids embed an effort suffix, so for those effort rides on
 *    the model id. Everywhere else effort is written into the hand-off instruction
 *    only (instruction-only, not enforced).
 * ──────────────────────────────────────────────────────────────────────────────
 */
import catalog from './modelCatalog.json';
import { getConnector } from './connectors';

export type TaskKind =
  | 'summary' | 'rename' | 'cleanup'       // 단순
  | 'implement' | 'research' | 'media'      // 일반
  | 'design' | 'debug' | 'final-review';    // 어려움

export type Difficulty = 'simple' | 'normal' | 'hard';
export type Effort = 'low' | 'medium' | 'high';

const KIND_DEFAULT: Record<TaskKind, Difficulty> = {
  summary: 'simple', rename: 'simple', cleanup: 'simple',
  implement: 'normal', research: 'normal', media: 'normal',
  design: 'hard', debug: 'hard', 'final-review': 'hard'
};

const EFFORT_FOR: Record<Difficulty, Effort> = { simple: 'low', normal: 'medium', hard: 'high' };

export const DIFFICULTY_KO: Record<Difficulty, string> = { simple: '단순', normal: '일반', hard: '어려움' };
export const EFFORT_KO: Record<Effort, string> = { low: '낮음', medium: '중간', high: '높음' };
const SIZE_KO: Record<Difficulty, string> = { simple: '작은', normal: '중간', hard: '큰' };

/** small / medium / large model per connector. Ids must exist in the catalog
 *  (checked at lookup). `guess` marks a size order inferred from names only. */
const TIERS: Record<string, { ids: [string, string, string]; guess?: boolean; fromCatalog: boolean }> = {
  claude: { ids: ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'], fromCatalog: true },
  gemini: { ids: ['flash-lite', 'flash', 'pro'], fromCatalog: true },
  // Luna < Terra < Sol inferred from the names (no size data in the catalog).
  codex: { ids: ['gpt-6-luna', 'gpt-6-terra', 'gpt-6-sol'], guess: true, fromCatalog: true },
  // Documented Agent API preset tiers (connectors/perplexity.ts).
  perplexity: { ids: ['fast', 'medium', 'high'], fromCatalog: false }
};

function inCatalog(connectorId: string, id: string): boolean {
  const c = getConnector(connectorId);
  const provider = c && c.kind === 'cli' ? c.provider : connectorId;
  const rows = (catalog as { providers: Record<string, Array<{ id?: string }>> }).providers[provider] ?? [];
  return rows.some((r) => r.id === id);
}

export type EffortVia = 'claude-slash' | 'model-id' | 'instruction-only';

export interface ModelChoice {
  difficulty: Difficulty;
  /** null = CLI / API default (no --model). */
  model: string | null;
  effort: Effort;
  /** How effort can reach the worker (see header). Never 'enforced'. */
  effortVia: EffortVia;
  /** Model can be set at spawn (true for CLI presets with --model and API agents). */
  modelAtSpawn: boolean;
  /** One short Korean reason. */
  reason: string;
}

export function pickModelAndEffort(input: {
  kind: TaskKind;
  difficulty?: Difficulty;
  connectorId: string;
}): ModelChoice {
  // Final review is always "어려움" (rules §2/§3) regardless of the given difficulty.
  const difficulty: Difficulty = input.kind === 'final-review' ? 'hard' : input.difficulty ?? KIND_DEFAULT[input.kind] ?? 'normal';
  const effort = EFFORT_FOR[difficulty];
  const idx = difficulty === 'simple' ? 0 : difficulty === 'normal' ? 1 : 2;
  const conn = getConnector(input.connectorId);
  const tier = TIERS[input.connectorId];
  let model: string | null = null;
  let note = '';
  if (tier) {
    const id = tier.ids[idx];
    if (!tier.fromCatalog || inCatalog(input.connectorId, id)) {
      model = id;
      if (tier.guess) note = ' (크기 순서는 이름으로 추정)';
    } else {
      note = ' (카탈로그에 해당 모델 없음 → 기본값)';
    }
  } else {
    note = ' (모델 크기 정보 없음 → 기본 모델)';
  }
  const effortVia: EffortVia =
    input.connectorId === 'claude' ? 'claude-slash' : input.connectorId === 'perplexity' ? 'model-id' : 'instruction-only';
  const modelAtSpawn = !!conn && conn.kind !== 'unavailable';
  const reason = `${DIFFICULTY_KO[difficulty]} 작업 → ${SIZE_KO[difficulty]} 모델·강도 ${EFFORT_KO[effort]}${note}`;
  return { difficulty, model, effort, effortVia, modelAtSpawn, reason };
}

/** The one-line hand-off log, e.g.
 *  `[배정] 코딩 → Claude Code · 모델 claude-sonnet-5-5 · 강도 중간 · 이유: 일반 구현` */
export function formatHandoffLine(input: {
  department: string;
  connectorId: string;
  model: string | null;
  effort: Effort;
  reason: string;
  agentName?: string;
}): string {
  const label = getConnector(input.connectorId)?.label ?? input.connectorId;
  const who = input.agentName ? `${input.agentName}(${label})` : label;
  const reason = input.reason.replace(/\s+/g, ' ').trim();
  return `[배정] ${input.department} → ${who} · 모델 ${input.model ?? '기본값'} · 강도 ${EFFORT_KO[input.effort]} · 이유: ${reason}`;
}

/** Policy text for Michael's seed (Korean). */
export function modelPolicySeedText(): string {
  const ex = pickModelAndEffort({ kind: 'implement', connectorId: 'claude' });
  return [
    '작업을 넘길 때 모델과 추론 강도를 이렇게 고른다:',
    '- 단순(정리, 이름 바꾸기, 요약): 작은 모델, 강도 낮음 — 예: Claude는 claude-haiku-5-5',
    '- 일반(구현, 자료 조사): 중간 모델, 강도 중간 — 예: Claude는 claude-sonnet-5-5',
    '- 어려움(설계 판단, 어려운 버그, 최종 검토): 큰 모델, 강도 높음 — 예: Claude는 claude-opus-5-5',
    '- 모델은 새 작업자를 만들 때만 정할 수 있다(spawn 요청의 "model" 필드). 이미 일하는 작업자의 모델은 바꿀 수 없다.',
    '- 추론 강도는 앱이 강제하지 못한다. 지시문에 "추론 강도: 낮음/중간/높음"이라고 적어서 전달한다.',
    '- 일을 넘길 때마다 tasks.json 카드 설명과 board.md에 다음 형식의 한 줄을 남긴다:',
    `  ${formatHandoffLine({ department: '코딩', connectorId: 'claude', model: ex.model, effort: ex.effort, reason: '일반 구현' })}`,
    '- 같은 일을 두 AI에게 동시에 맡기지 않는다.'
  ].join('\n');
}
