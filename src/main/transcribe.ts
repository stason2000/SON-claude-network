/**
 * Optional speech-to-text for Instagram videos (requirement #12). OFF by default.
 *
 * Engines:
 *  - 'groq'  — Groq Whisper via the existing ./freeflow.ts upload. The audio LEAVES
 *              the device. Uses the same `groqApiKey` the Free Flow feature stores in
 *              main config; the key is passed straight to freeflow.ts for the
 *              Authorization header and is NEVER logged or returned to the renderer.
 *  - 'local' — NOT IMPLEMENTED. This app bundles no speech model (whisper.cpp etc.),
 *              so it honestly reports `available: false` instead of faking a result.
 *
 * Free of `electron` imports so it can be loaded by node:test.
 */
import { transcribeWithGroq, DEFAULT_GROQ_MODEL } from './freeflow';
import type { InstagramTranscribeMode } from '../shared/instagram';

export interface TranscribeEngineInfo {
  id: 'groq' | 'local';
  available: boolean;
  /** Why it is unavailable (Korean-first, shown in Settings). */
  reason?: string;
  /** True when audio is sent off the device. */
  external: boolean;
}

export interface EngineContext {
  /** Presence only is used for availability; the value is used only in transcribeAudio. */
  groqApiKey?: string;
  groqModel?: string;
}

export const LOCAL_UNAVAILABLE_REASON =
  '준비 안 됨: 이 앱에는 PC에서 돌아가는 음성 인식 모델이 들어 있지 않습니다(설치·용량 문제로 아직 미구현).';

export function engineInfo(id: 'groq' | 'local', ctx: EngineContext): TranscribeEngineInfo {
  if (id === 'local') return { id, available: false, reason: LOCAL_UNAVAILABLE_REASON, external: false };
  return ctx.groqApiKey
    ? { id, available: true, external: true }
    : { id, available: false, reason: 'Groq API 키가 없습니다(설정 → 음성에서 입력).', external: true };
}

export function listEngines(ctx: EngineContext): TranscribeEngineInfo[] {
  return [engineInfo('local', ctx), engineInfo('groq', ctx)];
}

export async function transcribeAudio(
  mode: InstagramTranscribeMode,
  audio: Uint8Array,
  mimeType: string,
  ctx: EngineContext
): Promise<{ ok: boolean; text?: string; error?: string }> {
  if (mode === 'off') return { ok: false, error: '음성 받아쓰기 꺼짐' };
  const info = engineInfo(mode, ctx);
  if (!info.available) return { ok: false, error: info.reason ?? 'engine unavailable' };
  if (mode === 'groq') {
    const r = await transcribeWithGroq({
      apiKey: ctx.groqApiKey!,
      audio,
      mimeType,
      filename: 'instagram-audio.webm',
      model: ctx.groqModel || DEFAULT_GROQ_MODEL
    });
    return r.ok ? { ok: true, text: r.text } : { ok: false, error: r.error };
  }
  return { ok: false, error: LOCAL_UNAVAILABLE_REASON };
}
