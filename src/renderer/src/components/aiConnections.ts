import { useSyncExternalStore } from 'react';
import {
  listConnectors,
  splitConnections,
  type CliCheckResult,
  type ConnectionInputs
} from '@shared/connectors';

/**
 * Renderer-side state for the "AI 연결" window and its top-bar badge: which API
 * connectors have a stored key (`has` only — keys never reach the renderer),
 * which CLIs were marked "연결했어요" (config), and what main's read-only status
 * check found per CLI. One tiny module store so the badge and the window agree.
 */

interface State extends ConnectionInputs {
  loaded: boolean;
  checking: boolean;
}

let state: State = { loaded: false, checking: false, hasKey: {}, cliConnected: {}, cliCheck: {} };
const listeners = new Set<() => void>();
const set = (patch: Partial<State>): void => {
  state = { ...state, ...patch };
  for (const l of listeners) l();
};

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

let inflight: Promise<void> | null = null;

/** Reload key presence + manual flags; with `cli`, also re-run main's CLI checks. */
export function refreshAiConnections(opts: { cli?: boolean } = {}): Promise<void> {
  if (inflight) return inflight;
  inflight = (async () => {
    const connectors = listConnectors();
    const hasKey: Record<string, boolean> = {};
    for (const c of connectors) {
      if (c.kind !== 'api') continue;
      try { hasKey[c.id] = await window.cth.connectorKeyHas(c.id); } catch { hasKey[c.id] = false; }
    }
    let cliConnected: Record<string, boolean> = {};
    try { cliConnected = { ...((await window.cth.getConfig()).cliConnected ?? {}) }; } catch { /* keep empty */ }
    set({ hasKey, cliConnected, loaded: true });
    if (opts.cli || Object.keys(state.cliCheck).length === 0) {
      set({ checking: true });
      const cliCheck: Record<string, CliCheckResult | undefined> = { ...state.cliCheck };
      for (const c of connectors) {
        if (c.kind !== 'cli') continue;
        try { cliCheck[c.id] = await window.cth.connectorCliCheck(c.id); } catch { cliCheck[c.id] = { state: 'unknown', auto: false }; }
        set({ cliCheck: { ...cliCheck } });
      }
      set({ checking: false });
    }
  })().finally(() => { inflight = null; });
  return inflight;
}

/** Re-check one CLI (after its login window was used). */
export async function recheckCli(id: string): Promise<void> {
  try {
    const r = await window.cth.connectorCliCheck(id);
    set({ cliCheck: { ...state.cliCheck, [id]: r } });
  } catch { /* keep the last answer */ }
}

export async function setCliConnected(id: string, connected: boolean): Promise<void> {
  try {
    const r = await window.cth.connectorCliSetConnected({ id, connected });
    if (r.ok) set({ cliConnected: { ...r.cliConnected } });
  } catch { /* noop */ }
}

export function setHasKey(id: string, has: boolean): void {
  set({ hasKey: { ...state.hasKey, [id]: has } });
}

export function useAiConnections() {
  const s = useSyncExternalStore(subscribe, () => state);
  const split = splitConnections(listConnectors(), s);
  return { ...s, ...split };
}
