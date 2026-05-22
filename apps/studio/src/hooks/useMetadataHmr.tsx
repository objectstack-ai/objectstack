// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * useMetadataHmr
 *
 * Opens a Server-Sent Events connection to /api/v1/dev/metadata-events and
 * exposes a monotonically-increasing `version` counter that components can
 * include in their effect deps to auto-refresh when metadata source files
 * change on disk.
 *
 * Architecture
 * ────────────
 *   [server]  chokidar → MetadataManager.notifyWatchers → SSE
 *                                                          ↓
 *   [studio]  EventSource → MetadataHmrProvider (this file) → useMetadataHmr()
 *                                                                       ↓
 *             components: include `version` in useEffect deps OR call
 *                         `subscribe(filter, cb)` for targeted invalidation.
 *
 * Usage
 *   const { version } = useMetadataHmr();
 *   useEffect(() => { fetch(...); }, [..., version]);
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export interface MetadataHmrEvent {
  type: 'added' | 'changed' | 'deleted';
  metadataType: string;
  name: string;
  path?: string;
  timestamp: number;
}

export type HmrConnectionState =
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'disabled'
  | 'error';

export interface MetadataHmrContextValue {
  /** Monotonic counter — bumps on every metadata change event. */
  version: number;
  /** The most recently observed change event, or null. */
  lastEvent: MetadataHmrEvent | null;
  /** SSE connection state. */
  state: HmrConnectionState;
  /** ISO timestamp (ms epoch) of the last event, or null. */
  lastEventAt: number | null;
  /** Subscribe to events. Returns an unsubscribe function. */
  subscribe: (listener: (event: MetadataHmrEvent) => void) => () => void;
}

const noopSubscribe = () => () => {};

const HmrContext = createContext<MetadataHmrContextValue>({
  version: 0,
  lastEvent: null,
  state: 'disabled',
  lastEventAt: null,
  subscribe: noopSubscribe,
});

export interface MetadataHmrProviderProps {
  /** Endpoint URL — defaults to the dev SSE route. */
  url?: string;
  /** Disable HMR entirely (e.g. in production builds). Defaults to `true` (enabled). */
  enabled?: boolean;
  /** Reconnect delay in ms when the connection drops. Defaults to 2000. */
  reconnectDelayMs?: number;
  children: ReactNode;
}

/**
 * MetadataHmrProvider — mount once near the root of the app tree.
 *
 * Listens to /api/v1/dev/metadata-events via EventSource. Each change event
 * bumps a global version counter; any descendant using `useMetadataHmr()`
 * (or its specialized helpers) will see the new version and can invalidate
 * cached state accordingly.
 */
export function MetadataHmrProvider({
  url = '/api/v1/dev/metadata-events',
  enabled = true,
  reconnectDelayMs = 2000,
  children,
}: MetadataHmrProviderProps) {
  const [version, setVersion] = useState(0);
  const [lastEvent, setLastEvent] = useState<MetadataHmrEvent | null>(null);
  const [state, setState] = useState<HmrConnectionState>(
    enabled ? 'connecting' : 'disabled',
  );
  const [lastEventAt, setLastEventAt] = useState<number | null>(null);

  // External listeners (subscribe API). Use a ref so adding/removing
  // listeners doesn't trigger re-renders or reconnects.
  const listenersRef = useRef<Set<(event: MetadataHmrEvent) => void>>(new Set());

  const subscribe = useCallback(
    (listener: (event: MetadataHmrEvent) => void) => {
      listenersRef.current.add(listener);
      return () => {
        listenersRef.current.delete(listener);
      };
    },
    [],
  );

  useEffect(() => {
    if (!enabled) {
      setState('disabled');
      return;
    }
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') {
      setState('disabled');
      return;
    }

    let es: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const handleChange = (event: MessageEvent<string>) => {
      try {
        const data = JSON.parse(event.data) as MetadataHmrEvent;
        setLastEvent(data);
        setLastEventAt(data.timestamp ?? Date.now());
        setVersion((v) => v + 1);
        for (const listener of listenersRef.current) {
          try { listener(data); } catch { /* noop */ }
        }
      } catch {
        // Ignore malformed events.
      }
    };

    const handleReady = () => {
      setState('connected');
    };

    const connect = () => {
      if (cancelled) return;
      try {
        es = new EventSource(url);
        setState('connecting');

        es.addEventListener('open', () => {
          if (cancelled) return;
          setState('connected');
        });

        es.addEventListener('ready', handleReady as EventListener);
        es.addEventListener('metadata-change', handleChange as EventListener);
        // Whole-artifact reload — emitted by the server when a watch-recompile
        // pipeline POSTs to /api/v1/dev/metadata-events after rebuilding.
        es.addEventListener('reload', ((event: MessageEvent<string>) => {
          let reason = 'reload';
          let timestamp = Date.now();
          try {
            const data = JSON.parse(event.data) as { reason?: string; timestamp?: number };
            reason = data.reason ?? reason;
            timestamp = data.timestamp ?? timestamp;
          } catch { /* tolerate malformed payloads */ }
          const synthetic: MetadataHmrEvent = {
            type: 'changed',
            metadataType: '*',
            name: reason,
            timestamp,
          };
          setLastEvent(synthetic);
          setLastEventAt(timestamp);
          setVersion((v) => v + 1);
          for (const listener of listenersRef.current) {
            try { listener(synthetic); } catch { /* noop */ }
          }
        }) as EventListener);

        es.addEventListener('error', () => {
          if (cancelled) return;
          // EventSource auto-reconnects, but if it stays in a CLOSED state
          // we manually retry after a delay.
          if (es?.readyState === EventSource.CLOSED) {
            setState('disconnected');
            es = null;
            retryTimer = setTimeout(connect, reconnectDelayMs);
          } else {
            setState('error');
          }
        });
      } catch {
        setState('error');
        retryTimer = setTimeout(connect, reconnectDelayMs);
      }
    };

    connect();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (es) {
        try { es.close(); } catch { /* noop */ }
      }
    };
  }, [enabled, url, reconnectDelayMs]);

  const value = useMemo<MetadataHmrContextValue>(
    () => ({ version, lastEvent, state, lastEventAt, subscribe }),
    [version, lastEvent, state, lastEventAt, subscribe],
  );

  return <HmrContext.Provider value={value}>{children}</HmrContext.Provider>;
}

/**
 * Read the current HMR state. The `version` returned bumps on every metadata
 * change — include it in `useEffect` deps to re-run fetches when source
 * files change in VS Code.
 */
export function useMetadataHmr(): MetadataHmrContextValue {
  return useContext(HmrContext);
}

/**
 * Specialized helper: returns a version counter that only bumps when an
 * event matching the predicate fires. Useful for components that only care
 * about a specific metadata type/name.
 */
export function useMetadataHmrFiltered(
  predicate: (event: MetadataHmrEvent) => boolean,
): number {
  const { subscribe } = useMetadataHmr();
  const [v, setV] = useState(0);
  // Keep predicate stable across renders without forcing callers to memoize.
  const predRef = useRef(predicate);
  predRef.current = predicate;

  useEffect(() => {
    return subscribe((event) => {
      try {
        if (predRef.current(event)) setV((n) => n + 1);
      } catch { /* noop */ }
    });
  }, [subscribe]);

  return v;
}
