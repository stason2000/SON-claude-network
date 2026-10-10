/**
 * Which HarnessConfig fields travel between devices (#10), and the strict
 * sanitizers that gate everything coming back from the remote. Pure.
 *
 * PORTABLE = a preference that means the same thing on any machine.
 * NEVER synced (not in any list below, so they cannot be read OR written):
 *   - machine-specific: harnessHome, recentHives, registeredRepos, defaultCommand
 *     (a command line run on spawn), providerBaseUrls (local servers),
 *     knowledgeGraph.rootPath, strongKeepalive (battery/AC), multiWindow
 *   - secrets / tokens: slack*, groqApiKey, webhook*, webhookTriggers (each has a
 *     secret), orgTrigger (apiKey), integrations (secret-broker refs)
 *   - per-device consent / privacy: mcpDefaults, autoUpdate, telemetryEnabled,
 *     realtimeVoiceEnabled (mic gate)
 *   - per-workspace runtime state & one-time guards: onboardingComplete,
 *     agentTokenCaps, autoDeliveryPausedAgents, *Seeded, triggersMigratedV1,
 *     costCapUsd (deprecated), missions[].lastFiredAt, contextTrigger.clear.message
 *     (a literal command typed into a terminal)
 *
 * A remote value that fails its validator is DROPPED (the local value stays).
 */
import { AGENT_PROVIDER_PRESETS } from '../agentProvider';
import { sanitizeDepartmentsConfig, type DepartmentsConfig } from '../departments';

type Json = Record<string, unknown>;
type Validator = (v: unknown) => { ok: true; value: unknown } | { ok: false };

const ok = (value: unknown) => ({ ok: true as const, value });
const bad = { ok: false as const };

const bool: Validator = (v) => (typeof v === 'boolean' ? ok(v) : bad);
const int = (min: number, max: number): Validator => (v) =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? ok(v) : bad;
const oneOf = (values: readonly string[]): Validator => (v) =>
  typeof v === 'string' && values.includes(v) ? ok(v) : bad;
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/@+\-[\]]{0,127}$/;
const modelId: Validator = (v) => (typeof v === 'string' && MODEL_RE.test(v) ? ok(v) : bad);
const text = (max: number): Validator => (v) =>
  typeof v === 'string' && v.length <= max && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v) ? ok(v) : bad;

const PROVIDERS: readonly string[] = AGENT_PROVIDER_PRESETS.map((p) => p.id);

function objectOf(spec: Record<string, Validator>): Validator {
  return (v) => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return bad;
    const out: Json = {};
    for (const [k, val] of Object.entries(spec)) {
      if (!(k in (v as Json))) continue;
      const r = val((v as Json)[k]);
      if (r.ok) out[k] = r.value;
    }
    return ok(out);
  };
}

function recordOf(keyOk: (k: string) => boolean, val: Validator, maxEntries = 64): Validator {
  return (v) => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return bad;
    const out: Json = {};
    let n = 0;
    for (const [k, raw] of Object.entries(v as Json)) {
      if (!keyOk(k)) continue;
      const r = val(raw);
      if (!r.ok) continue;
      out[k] = r.value;
      if (++n >= maxEntries) break;
    }
    return ok(out);
  };
}

/** The settings item: field → validator. Anything not listed never syncs. */
export const PORTABLE_SETTINGS: Record<string, Validator> = {
  audience: oneOf(['technical', 'non-technical']),
  autoMode: bool,
  orchestratorMaySpawn: bool,
  defaultModel: modelId,
  godProvider: oneOf(PROVIDERS),
  godModel: modelId,
  semanticMemory: bool,
  embeddingModel: oneOf(['minilm', 'embeddinggemma']),
  costCapTokens: int(1, 1e12),
  maxTurns: int(1, 100_000),
  maxConcurrentWorkers: int(1, 64),
  workerIdleTimeoutMinutes: int(1, 24 * 60),
  defaultWorkerTokenCap: int(0, 1e12),
  circuitBreaker: objectOf({
    enabled: bool,
    hardStop: bool,
    repeatedToolLimit: int(1, 10_000),
    errorStormLimit: int(1, 10_000),
    tokenVelocityPerMin: int(1, 1e9)
  }),
  knowledgeGraph: objectOf({ enabled: bool }),
  notifications: bool,
  terminalTheme: oneOf(['light', 'dark']),
  tvShowOffices: bool,
  officeTheme: oneOf(['office', 'friends', 'brooklyn99', 'siliconvalley', 'got', 'hogwarts']),
  providerDefaultModels: recordOf((k) => PROVIDERS.includes(k), modelId),
  freeflowEnabled: bool,
  freeflowModel: modelId,
  instagramTranscribe: oneOf(['off', 'groq', 'local']),
  realtimeIdleDisconnectMs: int(0, 24 * 3_600_000),
  reflectEnabled: bool,
  reflectIntervalMs: int(60_000, 7 * 24 * 3_600_000),
  reflectByteTriggerPct: int(1, 100),
  reflectSectionTrigger: int(1, 10_000),
  reflectRecentKeep: int(1, 1_000),
  reflectMinBytes: int(0, 10_000_000)
};

/** Strict sanitize of an untrusted settings object → only whitelisted, valid fields. */
export function sanitizePortableSettings(raw: unknown): Json | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out: Json = {};
  for (const [k, val] of Object.entries(PORTABLE_SETTINGS)) {
    if (!Object.prototype.hasOwnProperty.call(raw, k)) continue;
    const r = val((raw as Json)[k]);
    if (r.ok) out[k] = r.value;
  }
  return out;
}

/** What this device would upload for the settings item. */
export function extractPortableSettings(cfg: Json): Json {
  return sanitizePortableSettings(cfg) ?? {};
}

// ─── departments ─────────────────────────────────────────────────────────────
export function extractDepartments(cfg: Json): DepartmentsConfig {
  return sanitizeDepartmentsConfig(cfg.departments) ?? {};
}
export function sanitizeRemoteDepartments(raw: unknown): DepartmentsConfig | null {
  return sanitizeDepartmentsConfig(raw) ?? null;
}

// ─── triggers / schedules ────────────────────────────────────────────────────
const MISSION_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const rule = (withMessage: boolean): Validator => objectOf({
  enabled: bool,
  everyMs: int(60_000, 30 * 24 * 3_600_000),
  minContextPct: int(0, 100),
  minContextPctLargeWindow: int(0, 100),
  ...(withMessage ? { message: text(2_000) } : {})
});

const missionV: Validator = (v) => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return bad;
  const m = v as Json;
  if (typeof m.id !== 'string' || !MISSION_ID_RE.test(m.id)) return bad;
  const out = objectOf({
    id: text(64),
    label: text(200),
    intervalMs: int(60_000, 30 * 24 * 3_600_000),
    to: (x) => (typeof x === 'string' && (x === '' || MISSION_ID_RE.test(x)) ? ok(x) : bad),
    body: text(20_000),
    enabled: bool,
    autoCompact: bool,
    kind: oneOf(['dispatch', 'heartbeat', 'compact']),
    quietThresholdMs: int(10_000, 24 * 3_600_000),
    weekly: (w) => {
      if (!w || typeof w !== 'object' || Array.isArray(w)) return bad;
      const days = (w as Json).days;
      const minute = (w as Json).minute;
      if (!Array.isArray(days) || days.length > 7 || !days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) return bad;
      if (!Number.isInteger(minute) || (minute as number) < 0 || (minute as number) > 1439) return bad;
      return ok({ days: [...new Set(days as number[])].sort(), minute });
    }
  })(m);
  if (!out.ok) return bad;
  const val = out.value as Json;
  // Required fields for a usable mission.
  if (typeof val.label !== 'string' || typeof val.intervalMs !== 'number' || typeof val.to !== 'string'
    || typeof val.body !== 'string' || typeof val.enabled !== 'boolean') return bad;
  return ok(val);
};

export interface PortableTriggers {
  missions: Json[];
  contextTrigger?: { compact?: Json; clear?: Json };
}

/** Untrusted → portable triggers (no lastFiredAt, no clear.message). */
export function sanitizeTriggers(raw: unknown): PortableTriggers | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Json;
  const missions: Json[] = [];
  const seen = new Set<string>();
  if (Array.isArray(r.missions)) {
    for (const m of r.missions.slice(0, 200)) {
      const v = missionV(m);
      if (!v.ok) continue;
      const mm = v.value as Json;
      if (seen.has(mm.id as string)) continue;
      seen.add(mm.id as string);
      missions.push(mm);
    }
  }
  const out: PortableTriggers = { missions };
  const ct = r.contextTrigger;
  if (ct && typeof ct === 'object' && !Array.isArray(ct)) {
    const compact = rule(true)((ct as Json).compact);
    const clear = rule(false)((ct as Json).clear);
    out.contextTrigger = {
      ...(compact.ok ? { compact: compact.value as Json } : {}),
      ...(clear.ok ? { clear: clear.value as Json } : {})
    };
  }
  return out;
}

export function extractTriggers(cfg: Json): PortableTriggers {
  return sanitizeTriggers({ missions: cfg.missions, contextTrigger: cfg.contextTrigger }) ?? { missions: [] };
}

/** The config patch that applies remote triggers while keeping per-device
 *  state (lastFiredAt by mission id, the local clear.message). */
export function triggersPatch(local: Json, remote: PortableTriggers): Json {
  const prev = new Map<string, Json>();
  if (Array.isArray(local.missions)) {
    for (const m of local.missions as Json[]) if (m && typeof m.id === 'string') prev.set(m.id, m);
  }
  const missions = remote.missions.map((m) => {
    const lf = prev.get(m.id as string)?.lastFiredAt;
    return typeof lf === 'number' ? { ...m, lastFiredAt: lf } : { ...m };
  });
  const patch: Json = { missions };
  if (remote.contextTrigger) {
    const lct = (local.contextTrigger ?? {}) as { compact?: Json; clear?: Json };
    patch.contextTrigger = {
      compact: { ...(lct.compact ?? {}), ...(remote.contextTrigger.compact ?? {}) },
      clear: {
        ...(lct.clear ?? {}),
        ...(remote.contextTrigger.clear ?? {}),
        ...(typeof lct.clear?.message === 'string' ? { message: lct.clear.message } : {})
      }
    };
  }
  return patch;
}

// ─── canonical JSON (stable hash input) ─────────────────────────────────────
export function canonicalJson(value: unknown): string {
  const norm = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === 'object') {
      const out: Json = {};
      for (const k of Object.keys(v as Json).sort()) {
        const x = (v as Json)[k];
        if (x !== undefined) out[k] = norm(x);
      }
      return out;
    }
    return v;
  };
  return JSON.stringify(norm(value), null, 2);
}
