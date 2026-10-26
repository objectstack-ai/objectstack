/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * useStorageUsageReading — the console's data hook for the environment's
 * storage-capacity verdict (objectui#10439, cloud#2135).
 *
 * Reads the FLAT half of the tenant runtime's `GET {apiBase}/usage/storage` —
 * `state`, `warn`, `blocked`, `usedMb`, `limitMb` — through `readStorageUsage`
 * (`./storageUsageEndpoint`), the reader `useReadRateReading` shares, so the
 * storage banner and the read-rate report cost one request between them.
 *
 * ## The verdict is read, never re-derived
 *
 * The tenant runtime answers with the SAME verdict its upload / bulk-import
 * guardrail refuses with — both run cloud's `evaluateStorageQuota`. `blocked`
 * decides the "storage is full" banner and `warn` the 80% one, and that is all
 * that decides them. ⛔ Nothing here compares `usedMb / limitMb`, or the served
 * `fraction`, with `warnFraction` or with any literal line: a local copy of the
 * rule would drift from the enforcement point the first time the rule moves,
 * silently, and in the direction users notice last. So `fraction` and
 * `warnFraction` are not modelled at all.
 *
 * ## Contract-first parsing (AGENTS.md #0.1)
 *
 * `state` must be one of the five values the producer declares, and `warn` and
 * `blocked` must be booleans. `usedMb` / `limitMb` are optional on the wire; when
 * present they must be finite, non-negative numbers. A banner verdict (`warn` or
 * `blocked`) that arrives WITHOUT both numbers is off-contract as well: the
 * producer raises either flag only after both numbers are known, and the
 * banner's copy IS those two numbers. Anything off-contract is `'unavailable'` —
 * never coerced, and never rendered with a stand-in number.
 *
 * ## No refetch loop
 *
 * The usage figure is a control-plane sweep, not something a console session
 * moves. The hook fetches once per mount / apiBase change and exposes `refetch`
 * for a caller that wants another look.
 *
 * Fail-soft throughout: every failure path lands on a status the caller can
 * read, never a throw.
 *
 * @module
 */
import * as React from 'react';
import { readStorageUsage, resolveRuntimeApiBase } from './storageUsageEndpoint.js';

/**
 * The storage verdict's `state`, as the tenant runtime declares it (cloud
 * `StorageQuotaState`).
 */
export type StorageUsageState = 'ok' | 'warning' | 'exhausted' | 'unlimited' | 'unknown';

const STORAGE_USAGE_STATES: ReadonlySet<unknown> = new Set<StorageUsageState>([
  'ok',
  'warning',
  'exhausted',
  'unlimited',
  'unknown',
]);

function isStorageUsageState(value: unknown): value is StorageUsageState {
  return STORAGE_USAGE_STATES.has(value);
}

/** The flat storage half of `GET /api/v1/usage/storage`, as far as this side reads it. */
export interface StorageUsageReading {
  /** The served verdict's name. Carried so "why is there no banner" stays answerable. */
  state: StorageUsageState;
  /** Show the capacity banner (the producer raises it at 80% and up). */
  warn: boolean;
  /** Uploads and bulk imports are currently refused. */
  blocked: boolean;
  /** Last metered usage in MB; absent when never metered. */
  usedMb?: number;
  /** Effective limit in MB; `0` = unlimited, absent = unknown. */
  limitMb?: number;
}

/** What the hook knows right now. */
export type StorageUsageReadingStatus =
  /** Inert — the caller gated the hook off (e.g. the viewer is not an admin). */
  | 'idle'
  /** A request is in flight and nothing is known yet. */
  | 'loading'
  /** No trustworthy reading could be obtained (network, non-2xx, off-contract payload). */
  | 'unavailable'
  /** The endpoint answered with a storage half that matches the contract. */
  | 'answered';

/** A reading is present exactly when the status is `'answered'`. */
export type StorageUsageSnapshot =
  | { status: Exclude<StorageUsageReadingStatus, 'answered'>; reading: null }
  | { status: 'answered'; reading: StorageUsageReading };

/**
 * What a snapshot renders as. The two banner cases carry the two numbers their
 * copy needs, so a renderer never holds a reading it would have to fill in.
 */
export type StorageUsageBannerView =
  /** Nothing known yet (inert or in flight). */
  | { case: 'pending' }
  /** No trustworthy reading could be obtained. */
  | { case: 'unavailable' }
  /** Answered, and the verdict raises no banner (`ok`, `unknown` and `unlimited` all land here). */
  | { case: 'none'; state: StorageUsageState }
  /** `warn` — at or over the producer's warning line, uploads still pass. */
  | { case: 'warning'; usedMb: number; limitMb: number }
  /** `blocked` — uploads and bulk imports are refused. */
  | { case: 'blocked'; usedMb: number; limitMb: number };

/**
 * Resolve a snapshot to what it renders as.
 *
 * `blocked` and `warn` are the producer's verdict and are READ: nothing here
 * compares the two numbers with each other or with a line. `blocked` is taken
 * first because it is the stronger of the two answers.
 */
export function classifyStorageUsage(snapshot: StorageUsageSnapshot): StorageUsageBannerView {
  if (snapshot.status !== 'answered') {
    return snapshot.status === 'unavailable' ? { case: 'unavailable' } : { case: 'pending' };
  }
  const { state, warn, blocked, usedMb, limitMb } = snapshot.reading;
  if (!blocked && !warn) return { case: 'none', state };
  // The parser already refuses a banner verdict without both numbers; this
  // narrows the type so the copy is only ever written from real ones.
  if (usedMb === undefined || limitMb === undefined) return { case: 'unavailable' };
  return blocked ? { case: 'blocked', usedMb, limitMb } : { case: 'warning', usedMb, limitMb };
}

export interface UseStorageUsageReadingOptions {
  /** Override the resolved tenant runtime base (e.g. `/api/v1`). */
  apiBase?: string;
  /** Gate the whole hook. Default true; `false` keeps it inert and issues no request. */
  enabled?: boolean;
}

/** The snapshot itself, so `reading` narrows with `status`, plus an explicit refetch. */
export type UseStorageUsageReadingReturn = StorageUsageSnapshot & { refetch: () => void };

/** A megabyte figure as the wire may carry it: absent, or a finite non-negative number. */
const OFF_CONTRACT = Symbol('off-contract megabyte figure');

function parseMegabytes(value: unknown): number | undefined | typeof OFF_CONTRACT {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return OFF_CONTRACT;
  return value;
}

/**
 * Parse the storage half of the endpoint's payload.
 *
 * Returns `null` when it does not match the contract (see the module header).
 */
function parseStorageUsage(payload: unknown): StorageUsageReading | null {
  if (!payload || typeof payload !== 'object') return null;
  const { state, warn, blocked, usedMb, limitMb } = payload as {
    state?: unknown;
    warn?: unknown;
    blocked?: unknown;
    usedMb?: unknown;
    limitMb?: unknown;
  };
  if (!isStorageUsageState(state)) return null;
  if (typeof warn !== 'boolean' || typeof blocked !== 'boolean') return null;

  const used = parseMegabytes(usedMb);
  const limit = parseMegabytes(limitMb);
  if (used === OFF_CONTRACT || limit === OFF_CONTRACT) return null;
  // A banner verdict without the two numbers it is made of — see the module header.
  if ((warn || blocked) && (used === undefined || limit === undefined)) return null;

  return {
    state,
    warn,
    blocked,
    ...(used === undefined ? {} : { usedMb: used }),
    ...(limit === undefined ? {} : { limitMb: limit }),
  };
}

/**
 * Load this environment's storage-capacity verdict. See the module header for
 * the verdict rule, the parsing contract and the refetch policy.
 */
export function useStorageUsageReading(
  options: UseStorageUsageReadingOptions = {},
): UseStorageUsageReadingReturn {
  const { apiBase, enabled = true } = options;
  const [snapshot, setSnapshot] = React.useState<StorageUsageSnapshot>({ status: 'idle', reading: null });
  const [reloadToken, setReloadToken] = React.useState(0);

  const refetch = React.useCallback(() => setReloadToken((n) => n + 1), []);

  const base = React.useMemo(() => resolveRuntimeApiBase(apiBase), [apiBase]);

  React.useEffect(() => {
    if (!enabled) return; // inert — the idle snapshot is DERIVED below, not written
    if (typeof fetch !== 'function') return; // non-browser env → stay inert (fail-soft)
    let cancelled = false;
    setSnapshot({ status: 'loading', reading: null });
    readStorageUsage(base)
      .then((payload) => {
        if (cancelled) return;
        const reading = parseStorageUsage(payload);
        setSnapshot(reading ? { status: 'answered', reading } : { status: 'unavailable', reading: null });
      })
      .catch(() => {
        if (cancelled) return;
        setSnapshot({ status: 'unavailable', reading: null });
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, base, reloadToken]);

  // A disabled hook HAS no reading, so `idle` is derived rather than written
  // back from the effect — and a hook toggled off cannot keep serving the
  // answer it happened to hold.
  const effective: StorageUsageSnapshot = enabled ? snapshot : { status: 'idle', reading: null };
  // Rebuilt rather than spread so the discriminated union survives into the
  // caller and `reading` narrows on `status` without a cast.
  if (effective.status === 'answered') return { status: 'answered', reading: effective.reading, refetch };
  return { status: effective.status, reading: null, refetch };
}
