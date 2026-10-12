import { useCallback, useEffect, useState } from 'react';
import { errorMessage } from './api';

interface AsyncState<T> {
  data: T | undefined;
  error: string | undefined;
  loading: boolean;
}

/** 데이터를 불러오고(선택: 주기적으로 갱신) 로딩/오류 상태를 제공하는 최소한의 훅. */
export function useAsync<T>(fn: () => Promise<T>, deps: readonly unknown[], pollMs?: number) {
  const [state, setState] = useState<AsyncState<T>>({ data: undefined, error: undefined, loading: true });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const data = await fn();
        if (!cancelled) setState({ data, error: undefined, loading: false });
      } catch (e) {
        if (!cancelled) setState((s) => ({ data: s.data, error: errorMessage(e), loading: false }));
      }
    };
    void run();
    const id = pollMs ? setInterval(() => void run(), pollMs) : undefined;
    return () => {
      cancelled = true;
      if (id) clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick, pollMs]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}
