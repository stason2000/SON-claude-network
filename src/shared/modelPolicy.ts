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
import type { CostTier } from './connectors';

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


// ── Cost routing: free first for light work, subscription for normal, best model for hard ──
export function costTierOf(connectorId: string): CostTier {
  const c = getConnector(connectorId);
  if (!c) return 'paid';
  return c.costTier ?? (c.kind === 'cli' ? 'subscription' : 'paid');
}

/** Order Michael tries inside one tier. Free routers first, then CLIs by strength of fit. */
const ROUTE_ORDER: Record<CostTier, string[]> = {
  free: ['freellmapi', 'openrouter'],
  subscription: ['claude', 'codex', 'gemini', 'grok', 'kimi', 'qwen', 'cursor', 'copilot', 'opencode', 'crush', 'pi', 'antigravity'],
  paid: ['openai', 'perplexity', 'higgsfield']
};

export interface RouteChoice extends ModelChoice {
  connectorId: string;
  tier: CostTier;
  /** true = metered spend: Michael must ask the user first (rules §5). */
  needsUserApproval: boolean;
  /** One step up if this answer is rejected or the free quota (429) runs out; null at the top. */
  escalateTo: string | null;
  routeReason: string;
}

/**
 * Pick WHO should do a task. Pure; `available` = connector ids the user has connected.
 *   단순 → free tier if connected (else subscription, small model)
 *   일반 → subscription (else free, with a note)
 *   어려움 / 최종 검토 → subscription's biggest model, NEVER free; metered API only with approval
 *   media / paid-only kinds → paid connector, always needs approval
 * Returns null when nothing usable is connected.
 */
export function pickRoute(input: { kind: TaskKind; difficulty?: Difficulty; available: string[] }): RouteChoice | null {
  const base = pickModelAndEffort({ kind: input.kind, difficulty: input.difficulty, connectorId: 'claude' });
  const difficulty = base.difficulty;
  const have = (tier: CostTier) => ROUTE_ORDER[tier].filter((id) => input.available.includes(id));
  let tier: CostTier | null = null;
  let note = '';
  if (input.kind === 'media') {
    tier = have('paid').length ? 'paid' : null;
  } else if (difficulty === 'simple') {
    tier = have('free').length ? 'free' : have('subscription').length ? 'subscription' : null;
  } else if (difficulty === 'normal') {
    tier = have('subscription').length ? 'subscription' : have('free').length ? 'free' : null;
    if (tier === 'free') note = ' (구독 AI가 없어 무료로 대신함)';
  } else {
    tier = have('subscription').length ? 'subscription' : have('paid').length ? 'paid' : null;
  }
  if (!tier) return null;
  const connectorId = have(tier)[0];
  const choice = pickModelAndEffort({ kind: input.kind, difficulty, connectorId });
  const order: CostTier[] = ['free', 'subscription', 'paid'];
  const up = difficulty === 'hard' ? null : order.slice(order.indexOf(tier) + 1).find((t) => have(t).length) ?? null;
  const escalateTo = up ? have(up)[0] : null;
  const TIER_KO: Record<CostTier, string> = { free: '무료', subscription: '구독', paid: '유료(종량제)' };
  return {
    ...choice,
    connectorId,
    tier,
    needsUserApproval: tier === 'paid',
    escalateTo,
    routeReason: `${DIFFICULTY_KO[difficulty]} 작업 → ${TIER_KO[tier]} 직원${note}`
  };
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
    '- 같은 일을 두 AI에게 동시에 맡기지 않는다.',
    '',
    '비용 기준으로 누구에게 맡길지 고른다 (무료 → 구독 → 유료 순으로 비싸다):',
    '- 단순한 일은 연결된 무료 AI(FreeLLMAPI, OpenRouter)에게 먼저 맡긴다. 없으면 구독 AI의 작은 모델.',
    '- 일반 일은 구독 AI(Claude, Codex 등)의 중간 모델에게 맡긴다.',
    '- 어려운 일과 최종 검토는 반드시 구독 AI의 가장 큰 모델과 강도 높음으로 한다. 무료 AI에게 맡기지 않는다.',
    '- 무료 AI의 결과가 부실하거나 한도(429)에 걸리면 한 단계 위(구독 AI)에게 딱 한 번만 다시 맡긴다. 반복하지 않는다.',
    '- 유료 API(OpenAI, Perplexity, Higgsfield)는 돈이 나가므로 쓰기 전에 사용자에게 먼저 묻는다.',
    '- 일을 넘길 때마다 [배정] 줄에 무료/구독/유료 중 어느 쪽이었는지와 이유를 적는다.'
  ].join('\n');
}
