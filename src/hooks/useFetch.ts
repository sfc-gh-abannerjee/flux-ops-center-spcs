import { useState, useCallback, useRef, useEffect } from 'react';
import { logger } from '../utils/logger';

/**
 * Generic async data fetching state
 */
export interface FetchState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
}

/**
 * Options for useFetch hook
 */
export interface UseFetchOptions {
  /** Whether to fetch immediately on mount */
  immediate?: boolean;
  /** Retry count on failure */
  retries?: number;
  /** Base delay for exponential backoff (ms) */
  retryDelay?: number;
  /** Request timeout (ms) */
  timeout?: number;
  /** Cache key - if provided, result will be cached */
  cacheKey?: string;
  /** Cache TTL in ms */
  cacheTTL?: number;
}

// Simple in-memory cache
const fetchCache = new Map<string, { data: unknown; timestamp: number }>();

/**
 * Custom hook for data fetching with retry logic, caching, and loading states
 * 
 * @param url - URL to fetch from
 * @param options - Fetch options
 * @returns Fetch state and refetch function
 */
export function useFetch<T>(
  url: string,
  options: UseFetchOptions = {}
): FetchState<T> & { refetch: () => Promise<void> } {
  const {
    immediate = true,
    retries = 3,
    retryDelay = 500,
    timeout = 30000,
    cacheKey,
    cacheTTL = 60000,
  } = options;

  const [state, setState] = useState<FetchState<T>>({
    data: null,
    loading: immediate,
    error: null,
  });

  const abortControllerRef = useRef<AbortController | null>(null);

  const fetchData = useCallback(async () => {
    // Check cache first
    if (cacheKey) {
      const cached = fetchCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < cacheTTL) {
        setState({ data: cached.data as T, loading: false, error: null });
        return;
      }
    }

    // Abort any in-flight request
    abortControllerRef.current?.abort();
    abortControllerRef.current = new AbortController();

    setState(prev => ({ ...prev, loading: true, error: null }));

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const timeoutId = setTimeout(() => {
          abortControllerRef.current?.abort();
        }, timeout);

        const response = await fetch(url, {
          signal: abortControllerRef.current.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();

        // Update cache
        if (cacheKey) {
          fetchCache.set(cacheKey, { data, timestamp: Date.now() });
        }

        setState({ data, loading: false, error: null });
        return;
      } catch (error) {
        const isAbort = error instanceof Error && error.name === 'AbortError';
        if (isAbort) {
          return; // Don't retry on abort
        }

        const isLastAttempt = attempt === retries;
        if (isLastAttempt) {
          logger.error(`Fetch failed after ${retries} attempts:`, url, error);
          setState({
            data: null,
            loading: false,
            error: error instanceof Error ? error : new Error(String(error)),
          });
        } else {
          const delay = retryDelay * Math.pow(2, attempt - 1);
          logger.warn(`Fetch attempt ${attempt} failed, retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
  }, [url, retries, retryDelay, timeout, cacheKey, cacheTTL]);

  // Fetch on mount if immediate
  useEffect(() => {
    if (immediate) {
      fetchData();
    }

    return () => {
      abortControllerRef.current?.abort();
    };
  }, [immediate, fetchData]);

  return { ...state, refetch: fetchData };
}

/**
 * Hook for fetching data that depends on a condition
 * Only fetches when condition is true
 */
export function useConditionalFetch<T>(
  url: string,
  condition: boolean,
  options: UseFetchOptions = {}
): FetchState<T> & { refetch: () => Promise<void> } {
  const result = useFetch<T>(url, { ...options, immediate: false });

  useEffect(() => {
    if (condition) {
      result.refetch();
    }
  }, [condition]); // eslint-disable-line react-hooks/exhaustive-deps

  return result;
}

/**
 * Hook for parallel fetching of multiple URLs
 * Returns array of results in same order as URLs
 */
export function useParallelFetch<T>(
  urls: string[],
  options: UseFetchOptions = {}
): {
  data: (T | null)[];
  loading: boolean;
  errors: (Error | null)[];
  refetchAll: () => Promise<void>;
} {
  const [data, setData] = useState<(T | null)[]>(urls.map(() => null));
  const [loading, setLoading] = useState(options.immediate !== false);
  const [errors, setErrors] = useState<(Error | null)[]>(urls.map(() => null));

  const fetchAll = useCallback(async () => {
    setLoading(true);

    const results = await Promise.allSettled(
      urls.map(url =>
        fetch(url).then(r => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json() as Promise<T>;
        })
      )
    );

    setData(
      results.map(r => (r.status === 'fulfilled' ? r.value : null))
    );
    setErrors(
      results.map(r =>
        r.status === 'rejected' ? (r.reason instanceof Error ? r.reason : new Error(String(r.reason))) : null
      )
    );
    setLoading(false);
  }, [urls]);

  useEffect(() => {
    if (options.immediate !== false) {
      fetchAll();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { data, loading, errors, refetchAll: fetchAll };
}

/**
 * Hook for posting data with loading/error states
 */
export function usePost<TRequest, TResponse>(): {
  post: (url: string, data: TRequest) => Promise<TResponse | null>;
  loading: boolean;
  error: Error | null;
} {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const post = useCallback(async (url: string, data: TRequest): Promise<TResponse | null> => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      setLoading(false);
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      setLoading(false);
      logger.error('POST request failed:', url, error);
      return null;
    }
  }, []);

  return { post, loading, error };
}

/**
 * Clear the fetch cache (useful after mutations)
 */
export function clearFetchCache(keyPattern?: string): void {
  if (keyPattern) {
    for (const key of fetchCache.keys()) {
      if (key.includes(keyPattern)) {
        fetchCache.delete(key);
      }
    }
  } else {
    fetchCache.clear();
  }
}
