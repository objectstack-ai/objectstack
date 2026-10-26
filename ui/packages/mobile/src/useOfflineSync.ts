/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * React hook that subscribes to an `OfflineDataSource`, exposing the current
 * online/offline status and the pending queue for status-bar / banner UIs.
 */

import { useEffect, useState, useCallback } from 'react';
import type { OfflineDataSource } from './createOfflineDataSource.js';
import type { OfflineOperation } from './offlineQueue.js';

export interface OfflineSyncState {
  /** True if the browser reports `navigator.onLine`. */
  isOnline: boolean;
  /** Pending ops, oldest first. */
  pending: OfflineOperation[];
  /** True while a replay is in-flight. */
  isReplaying: boolean;
  /** Manually trigger a replay. */
  replay: () => Promise<void>;
  /** Drop a queued op without replaying it. */
  drop: (opId: string) => Promise<void>;
  /** Drop everything. */
  clear: () => Promise<void>;
}

/**
 * Subscribe to a wrapped offline DataSource. Auto-replays the queue
 * whenever the browser fires `online`.
 */
export function useOfflineSync(source: OfflineDataSource): OfflineSyncState {
  const [pending, setPending] = useState<OfflineOperation[]>([]);
  const [isOnline, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine !== false,
  );
  const [isReplaying, setReplaying] = useState(false);

  const refresh = useCallback(async () => {
    try { setPending(await source.pending()); } catch { setPending([]); }
  }, [source]);

  const replay = useCallback(async () => {
    setReplaying(true);
    try { await source.replay(); } finally {
      setReplaying(false);
      await refresh();
    }
  }, [source, refresh]);

  const drop = useCallback(async (opId: string) => {
    await source.drop(opId);
    await refresh();
  }, [source, refresh]);

  const clear = useCallback(async () => {
    await source.clear();
    await refresh();
  }, [source, refresh]);

  // Initial load + listen for online/offline transitions.
  useEffect(() => {
    refresh();
    if (typeof window === 'undefined') return;
    const onOnline = () => {
      setOnline(true);
      void replay();
    };
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [refresh, replay]);

  return { isOnline, pending, isReplaying, replay, drop, clear };
}
