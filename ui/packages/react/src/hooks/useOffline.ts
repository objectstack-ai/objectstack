/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {
  useCallback,
  useEffect,
  useInsertionEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

// ---------------------------------------------------------------------------
// The offline vocabulary used to be the spec's (`OfflineConfigSchema` and
// friends in `@objectstack/spec/ui`), and these were its bindings rather than
// hand copies (objectstack#4115). `@objectstack/spec` 17.0.0-rc.3 DELETED the
// whole `ui/offline` module (objectstack#4988, PR objectstack#5321): none of it
// had an authoring door — no metadata document could ever carry an offline
// block — so the platform stopped publishing vocabulary nothing could author.
//
// The declarations below are that vocabulary, moved here verbatim (same keys,
// same members, same optionality). This is the remediation the spec's own
// retirement ledger prescribes by name: "If you consumed the bare
// `ConflictResolution` from `@objectstack/spec/ui` as a TYPE for your own
// offline code, declare that union locally — it is your client's policy, not
// the platform's." This hook IS that client, and it is the only implementation
// of these semantics in the repo. Nothing about `useOffline`'s behaviour
// changes; only the provenance of its types (objectui#3363).
//
// Do NOT re-point any of these at a same-named spec export that survived:
// `@objectstack/spec/integration`'s `ConnectorConflictResolution` (connector
// sync) and `@objectstack/spec/api`'s `ConflictResolutionStrategy` (route merge
// policy) are DIFFERENT concepts with different members.
// ---------------------------------------------------------------------------

/** Offline strategy determines how data is fetched when connectivity is limited. */
export type OfflineStrategy =
  | 'cache_first'
  | 'network_first'
  | 'stale_while_revalidate'
  | 'network_only'
  | 'cache_only';

/**
 * Conflict resolution strategy for sync operations.
 *
 * Deliberately NOT named `ConflictResolutionStrategy` — that name belongs to a
 * different contract (`@objectstack/spec/api`: `error | priority | first-wins |
 * last-wins`, the metadata-merge policy), and the confusion between the two is
 * what objectui#3169 / objectstack#4115 cost.
 */
export type ConflictResolution = 'manual' | 'client_wins' | 'server_wins' | 'last_write_wins';

/** Persist storage backend. */
export type PersistStorageType = 'sqlite' | 'indexeddb' | 'localstorage';

/** Eviction policy for cache management. */
export type EvictionPolicyType = 'lru' | 'lfu' | 'fifo';

/** Sync state of the offline system. */
export type SyncState = 'idle' | 'syncing' | 'error' | 'offline';

/** A queued mutation waiting to be synced. */
export interface QueuedMutation {
  id: string;
  timestamp: number;
  operation: 'create' | 'update' | 'delete';
  resource: string;
  data?: Record<string, unknown>;
}

/**
 * Cache configuration.
 *
 * `persistStorage` and `evictionPolicy` used to carry schema `.default()`s, so
 * they stay optional to WRITE — this hook is handed what an app author wrote,
 * which is why every key here is optional (the former `SpecAuthoredInput` /
 * input-side reading of the retired schema).
 */
export interface OfflineCacheConfig {
  /** Maximum cache size. */
  maxSize?: number;
  /** Time-to-live for cached entries. */
  ttl?: number;
  /** Storage backend. Defaults to `indexeddb` when a cache is used. */
  persistStorage?: PersistStorageType;
  /** Eviction policy once `maxSize` is reached. Defaults to `lru`. */
  evictionPolicy?: EvictionPolicyType;
}

/** Sync configuration — controls how queued mutations reach the server. */
export interface OfflineSyncConfig {
  /** Fetch strategy for sync requests. */
  strategy?: OfflineStrategy;
  /** How to resolve a server/client conflict. */
  conflictResolution?: ConflictResolution;
  /** Delay between retry attempts, in ms. */
  retryInterval?: number;
  /** Maximum retry attempts before giving up. */
  maxRetries?: number;
  /** Mutations flushed per sync batch. */
  batchSize?: number;
}

/**
 * Top-level offline configuration.
 *
 * This name stays with `@object-ui/react` (objectui#3156 / objectui#3159): the
 * `OfflineConfig` that used to sit in `@object-ui/types` was a service-worker
 * ROUTE cache and has been renamed `PWAOfflineConfig`, so there is no
 * cross-package clash.
 *
 * Every key is optional, and that is load-bearing rather than incidental:
 * `useOffline(config: OfflineConfig = {})` defaults to the empty object, so a
 * shape that made `enabled` / `strategy` / `offlineIndicator` required — as the
 * retired schema's OUTPUT side did, once its `.default()`s had run — would
 * reject the hook's own default argument. {@link DEFAULTS} below applies the
 * same values the schema defaults used to.
 */
export interface OfflineConfig {
  /** Whether offline mode is active. Defaults to `true`. */
  enabled?: boolean;
  /** Fetch strategy. Defaults to `network_first`. */
  strategy?: OfflineStrategy;
  /** Client-side cache configuration. */
  cache?: OfflineCacheConfig;
  /** Sync behaviour for queued mutations. */
  sync?: OfflineSyncConfig;
  /** Whether to surface the offline indicator UI. Defaults to `true`. */
  offlineIndicator?: boolean;
  /** Message shown while offline. */
  offlineMessage?: string;
  /** Maximum queued mutations retained. Defaults to `100`. */
  queueMaxSize?: number;
}

/** Result returned by the useOffline hook. */
export interface OfflineResult {
  /** Whether the browser is currently online. */
  isOnline: boolean;
  /** Whether offline mode is enabled in config. */
  enabled: boolean;
  /** Current sync state. */
  syncState: SyncState;
  /** The active offline strategy. */
  strategy: OfflineStrategy;
  /** Number of pending mutations in the queue. */
  pendingCount: number;
  /** Queue a mutation for later sync. */
  queueMutation: (mutation: Omit<QueuedMutation, 'id' | 'timestamp'>) => void;
  /** Manually trigger a sync attempt. */
  sync: () => Promise<void>;
  /** Clear the mutation queue. */
  clearQueue: () => void;
  /** Whether to show the offline indicator UI. */
  showIndicator: boolean;
  /** The offline message to display. */
  offlineMessage: string;
}

// ---------------------------------------------------------------------------
// Online/offline external store (SSR-safe)
// ---------------------------------------------------------------------------

function subscribeOnline(callback: () => void) {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener('online', callback);
  window.addEventListener('offline', callback);
  return () => {
    window.removeEventListener('online', callback);
    window.removeEventListener('offline', callback);
  };
}

function getOnlineSnapshot(): boolean {
  return typeof navigator !== 'undefined' ? navigator.onLine : true;
}

function getServerSnapshot(): boolean {
  return true;
}

// ---------------------------------------------------------------------------
// Mutation queue storage helpers
// ---------------------------------------------------------------------------

const QUEUE_STORAGE_KEY = 'objectui-offline-queue';

function loadQueue(): QueuedMutation[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(QUEUE_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as QueuedMutation[]) : [];
  } catch {
    return [];
  }
}

function persistQueue(queue: QueuedMutation[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(queue));
  } catch {
    // localStorage full or unavailable — silently ignore
  }
}

let idCounter = 0;
function generateId(): string {
  idCounter += 1;
  return `mut_${Date.now()}_${idCounter}`;
}

// ---------------------------------------------------------------------------
// useOffline hook
// ---------------------------------------------------------------------------

const DEFAULTS: Required<
  Pick<OfflineConfig, 'enabled' | 'strategy' | 'offlineIndicator' | 'queueMaxSize'>
> & { offlineMessage: string } = {
  enabled: true,
  strategy: 'network_first',
  offlineIndicator: true,
  offlineMessage: 'You are currently offline. Changes will be synced when reconnected.',
  queueMaxSize: 100,
};

/**
 * Hook for offline mode detection and sync queue management. Its config types
 * are declared locally — see {@link OfflineConfig} for why they stopped being
 * the spec's.
 *
 * @example
 * ```tsx
 * function App() {
 *   const offline = useOffline({
 *     enabled: true,
 *     strategy: 'cache_first',
 *     sync: { conflictResolution: 'last_write_wins' },
 *   });
 *
 *   if (!offline.isOnline && offline.showIndicator) {
 *     return <Banner>{offline.offlineMessage}</Banner>;
 *   }
 *
 *   return <div>Pending mutations: {offline.pendingCount}</div>;
 * }
 * ```
 */
export function useOffline(config: OfflineConfig = {}): OfflineResult {
  const {
    enabled = DEFAULTS.enabled,
    strategy = DEFAULTS.strategy,
    offlineIndicator = DEFAULTS.offlineIndicator,
    offlineMessage = DEFAULTS.offlineMessage,
    queueMaxSize = DEFAULTS.queueMaxSize,
    sync: syncConfig,
  } = config;

  const isOnline = useSyncExternalStore(subscribeOnline, getOnlineSnapshot, getServerSnapshot);
  const [queue, setQueue] = useState<QueuedMutation[]>(loadQueue);
  const [syncState, setSyncState] = useState<SyncState>('idle');
  const syncConfigRef = useRef(syncConfig);
  // `sync` below is keyed on `[enabled, queue]`, so a config-only change keeps
  // the SAME `sync` closure alive — and the auto-sync effect deliberately
  // captures one and fires it 100ms later. The ref is how those retained
  // closures still read the newest `sync` config; putting `syncConfig` in
  // `sync`'s deps instead would rebuild `sync` (and the memoised result) on
  // every render, because callers pass `sync: { ... }` as an inline literal.
  // Only the write moves out of the render body: `useInsertionEffect` runs in
  // the mutation phase, ahead of every layout effect and paint, so no caller
  // that could legally reach `sync()` observes a different value than before.
  useInsertionEffect(() => {
    syncConfigRef.current = syncConfig;
  });
  // The queue reaches `sync` through the SAME commit-phase mirror the sync
  // config uses (objectui#6818). It used to come from `sync`'s own closure
  // while `batchSize` came from the ref above, so the two halves of one call
  // disagreed about how current they were: a retained `sync` — and the
  // auto-sync effect below deliberately retains one and fires it 100ms later —
  // batched a queue snapshot from an older render against the newest
  // `batchSize`. Mirroring the queue makes both halves the newest COMMITTED
  // value, and it is what takes `queue` out of `sync`'s dependency list, so
  // `sync` stops changing identity on every queued mutation.
  const queueRef = useRef(queue);
  useInsertionEffect(() => {
    queueRef.current = queue;
  });

  // Persist queue to localStorage whenever it changes
  useEffect(() => {
    persistQueue(queue);
  }, [queue]);

  // Update sync state based on online status
  useEffect(() => {
    if (!enabled) return;
    if (!isOnline) {
      setSyncState('offline');
    } else if (syncState === 'offline') {
      setSyncState('idle');
    }
  }, [isOnline, enabled, syncState]);

  const queueMutation = useCallback(
    (mutation: Omit<QueuedMutation, 'id' | 'timestamp'>) => {
      if (!enabled) return;
      setQueue((prev) => {
        const newEntry: QueuedMutation = {
          ...mutation,
          id: generateId(),
          timestamp: Date.now(),
        };
        const next = [...prev, newEntry];
        // Enforce max queue size (FIFO eviction)
        if (next.length > queueMaxSize) {
          return next.slice(next.length - queueMaxSize);
        }
        return next;
      });
    },
    [enabled, queueMaxSize],
  );

  const clearQueue = useCallback(() => {
    setQueue([]);
  }, []);

  const sync = useCallback(async () => {
    // Newest committed queue, not this closure's snapshot — see `queueRef`.
    const pending = queueRef.current;
    if (!enabled || pending.length === 0) return;
    setSyncState('syncing');
    try {
      // In a real implementation, this would batch-send mutations to the server.
      // For now, we simulate a successful sync by clearing the queue.
      const batchSize = syncConfigRef.current?.batchSize ?? pending.length;
      const batch = pending.slice(0, batchSize);

      // Simulate network round-trip
      await new Promise<void>((resolve) => setTimeout(resolve, 0));

      // Remove synced mutations from queue
      setQueue((prev) => prev.filter((m) => !batch.some((b) => b.id === m.id)));
      setSyncState('idle');
    } catch {
      setSyncState('error');
    }
  }, [enabled]);

  // Auto-sync while online and holding queued mutations (short stabilization
  // delay).
  //
  // The dependency list used to be `[isOnline, enabled]` with
  // `react-hooks/exhaustive-deps` suppressed, on the stated grounds that
  // re-running "on every queue change" would restart the 100ms timer once per
  // queued mutation. That reason is real and is preserved below — the
  // dependency is the BOOLEAN `hasPendingMutations`, never `queue` and never
  // `queue.length`, so queueing a second mutation while a timer is already
  // armed does not re-run this effect and does not restart the timer.
  //
  // What the suppression also did, and never justified, was evaluate the
  // emptiness guard against a queue snapshot from whenever `isOnline` or
  // `enabled` last changed. `queueMutation` accepts entries whenever the hook
  // is enabled — it has never been conditional on being offline — so anything
  // queued while ALREADY online found this effect asleep and had no auto-sync
  // path at all; only an explicit `sync()` drained it (objectui#6818). Keying
  // on the boolean re-evaluates the guard exactly when it can change answer.
  //
  // `sync` is now stable across queue changes (it reads the queue through
  // `queueRef`), so naming it here costs no extra timer restart and the array
  // is genuinely exhaustive — the suppression is gone rather than reworded.
  //
  // Known remaining edge, deliberately not widened here: a `batchSize` smaller
  // than the queue drains one batch and leaves `hasPendingMutations` true, so
  // the remainder waits for the next transition rather than chaining a second
  // batch. That is the pre-existing behaviour, not a regression. Whether one
  // auto-sync should drain the whole queue batch-by-batch is a semantics
  // question about `batchSize` rather than a bug in this guard, and it is
  // filed separately as objectui#6857.
  const hasPendingMutations = queue.length > 0;
  useEffect(() => {
    if (!enabled || !isOnline || !hasPendingMutations) return;
    const timer = setTimeout(() => {
      void sync();
    }, 100);
    return () => clearTimeout(timer);
  }, [isOnline, enabled, hasPendingMutations, sync]);

  return useMemo<OfflineResult>(
    () => ({
      isOnline,
      enabled,
      syncState,
      strategy,
      pendingCount: queue.length,
      queueMutation,
      sync,
      clearQueue,
      showIndicator: offlineIndicator && !isOnline,
      offlineMessage,
    }),
    [
      isOnline,
      enabled,
      syncState,
      strategy,
      queue.length,
      queueMutation,
      sync,
      clearQueue,
      offlineIndicator,
      offlineMessage,
    ],
  );
}
