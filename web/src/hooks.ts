import { useEffect, useRef, useState, useCallback } from 'react';
import { ApiError } from './api';

// Fetch com loading/erro/refetch + revalidação via SSE.
export function useApi<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const reload = useCallback(() => {
    setLoading(true);
    fnRef
      .current()
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e: Error) => setError(e))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => reload(), [reload]);
  return { data, error, loading, reload, isAuthError: error instanceof ApiError && error.status === 401 };
}

// Assina /api/stream e chama onUpdate quando o read-model é regravado.
export function useSse(onUpdate: () => void): void {
  const cb = useRef(onUpdate);
  cb.current = onUpdate;
  useEffect(() => {
    const es = new EventSource('/api/stream', { withCredentials: true });
    es.addEventListener('update', () => cb.current());
    es.onerror = () => {
      /* EventSource reconecta sozinho (retry); silencioso */
    };
    return () => es.close();
  }, []);
}
