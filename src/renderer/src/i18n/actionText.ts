import i18n from './index';

const KNOWN = new Set([
  'idle', 'awaiting', 'waiting on you', 'waiting on god', 'thinking', 'starting up',
  'running the floor', 'revived after sleep', 'resumed', 'recreating terminal…',
  'reconnecting…', 'reading inbox', 'heading back to desk', 'continuing…',
  'compacting context', 'archived'
]);

/**
 * Display text for an agent's live status phrase. The phrases are produced by
 * the event code in English; only the exact known ones are translated, anything
 * else (tool names, file names, commands) is shown as it came.
 */
export function actionText(action: string | undefined | null): string {
  const a = (action ?? '').trim();
  return KNOWN.has(a) ? i18n.t(`extra.actions.${a}`) : a;
}
