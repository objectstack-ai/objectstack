/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * useReadRateReading — the console's data hook for the tenant runtime's
 * read-rate reading (objectui#9954, cloud#2333).
 *
 * Reads `GET {apiBase}/usage/storage` and exposes ONE key of that response: the
 * optional nested `readRate`. The flat storage half of the same payload is
 * `useStorageUsageReading`'s (objectui#10439), and ⛔ is not modelled here.
 * Both hooks read the one response through `readStorageUsage`
 * (`./storageUsageEndpoint`), so the two banners cost one request.
 *
 * ## Why the three "no banner" answers stay three values
 *
 * A banner renders only on `state: 'anomalous'`, so silence, `'ok'` and an
 * unreachable endpoint all render nothing. They are NOT the same fact, and
 * collapsing them in the code is the defect this hook exists to prevent:
 *
 *   - `'unmeasured'` — the endpoint answered and carried NO `readRate`. The
 *     control plane reported no reading. It does NOT mean "measured and under
 *     the line"; "why does my environment show no banner" has two answers and
 *     this is the one that says *nobody has measured it*.
 *   - `'measured'` + `state: 'ok'` — measured, and under the line.
 *   - `'unavailable'` — nothing trustworthy came back at all (network, non-2xx,
 *     or a `readRate` that does not match the contract). Deliberately NOT folded
 *     into `'unmeasured'`: that status is a positive claim about what the
 *     control plane said, and a failed read gives no basis to make it.
 *
 * ## Contract-first parsing (AGENTS.md #0.1)
 *
 * An off-contract `readRate` — an unknown `state`, a missing/!numeric
 * `ratioThreshold` — is reported as `'unavailable'`, never coerced into a
 * reading. The one shape that IS accepted in two spellings is an ABSENT
 * `readsPerWrite`: `undefined` and JSON `null` are the two ways a serializer
 * spells an omitted optional, and that value's absence is load-bearing — it is
 * the environment having made no writes at all, the worst reading there is. A
 * strict reading of `null` as off-contract would HIDE that case, which is
 * exactly the failure the card forbids. Any OTHER non-numeric value is
 * off-contract and is refused.
 *
 * ## No refetch loop
 *
 * Unlike the AI usage meter beside it, this reading is a slow control-plane
 * aggregate over the environment's whole read history — nothing a user does in
 * the console moves it within a session. So the hook fetches once per mount /
 * apiBase change and exposes `refetch` for a caller that wants another look;
 * there is no visibility or event-driven refresh to spend requests on.
 *
 * Fail-soft throughout: every failure path lands on a status the caller can
 * read, never a throw.
 *
 * @module
 */
import * as React from 'react';
import { readStorageUsage, resolveRuntimeApiBase } from './storageUsageEndpoint.js';

// The base resolver moved to the shared reader with objectui#10439; this module
// keeps exporting it because the hooks barrel and this hook's tests import it
// from here.
export { resolveRuntimeApiBase };

/**
 * The tenant runtime's read-rate reading, as `GET /api/v1/usage/storage`
 * declares it. Mirrors the cloud runtime's `ReadRateBannerReading`.
 */
export interface ReadRateBannerReading {
  /** `'anomalous'` = over the line (render the banner); `'ok'` = measured and under it. */
  state: 'ok' | 'anomalous';
  /**
   * `rowsRead / rowsWritten`. ABSENT means the environment made no writes at
   * all — an unbounded ratio, and the most severe reading there is. It is never
   * "a number we failed to get".
   */
  readsPerWrite?: number;
  /**
   * The line `state` was taken against. Carried as DATA on purpose so this side
   * holds no second copy of a number that moves.
   */
  ratioThreshold: number;
}

/** What the hook knows right now. See the module header for why these are distinct. */
export type ReadRateReadingStatus =
  /** Inert — the caller gated the hook off (e.g. the viewer is not an admin). */
  | 'idle'
  /** A request is in flight and nothing is known yet. */
  | 'loading'
  /** No trustworthy reading could be obtained (network, non-2xx, off-contract payload). */
  | 'unavailable'
  /** The endpoint answered and carried NO reading — the control plane measured nothing. */
  | 'unmeasured'
  /** The endpoint answered with a reading that matches the contract. */
  | 'measured';

/** A reading is present exactly when the status is `'measured'`. */
export type ReadRateSnapshot =
  | { status: Exclude<ReadRateReadingStatus, 'measured'>; reading: null }
  | { status: 'measured'; reading: ReadRateBannerReading };

/**
 * The rendering case a snapshot resolves to. One value per distinct fact, so a
 * consumer cannot accidentally treat "nobody measured" as "measured and fine".
 */
export type ReadRateBannerCase =
  /** Nothing known yet (inert or in flight). */
  | 'pending'
  /** No trustworthy reading could be obtained. */
  | 'unavailable'
  /** The control plane reported no reading. */
  | 'unmeasured'
  /** Measured, and under the line. */
  | 'ok'
  /** Over the line, with NO writes at all — unbounded, the most severe reading. */
  | 'anomalous-no-writes'
  /** Over the line, with a finite reads-per-write ratio. */
  | 'anomalous-ratio';

/**
 * Resolve a snapshot to its rendering case.
 *
 * `state` is the control plane's verdict and is READ, never re-derived: nothing
 * here compares `readsPerWrite` against `ratioThreshold`. The only thing the
 * anomalous branch decides is WHICH WORDS the reading deserves, which is a
 * rendering question the verdict does not answer.
 */
export function classifyReadRate(snapshot: ReadRateSnapshot): ReadRateBannerCase {
  if (snapshot.status !== 'measured') {
    if (snapshot.status === 'unavailable') return 'unavailable';
    if (snapshot.status === 'unmeasured') return 'unmeasured';
    return 'pending'; // 'idle' | 'loading'
  }
  if (snapshot.reading.state === 'ok') return 'ok';
  return snapshot.reading.readsPerWrite === undefined ? 'anomalous-no-writes' : 'anomalous-ratio';
}

export interface UseReadRateReadingOptions {
  /** Override the resolved tenant runtime base (e.g. `/api/v1`). */
  apiBase?: string;
  /** Gate the whole hook. Default true; `false` keeps it inert and issues no request. */
  enabled?: boolean;
}

/** The snapshot itself, so `reading` narrows with `status`, plus an explicit refetch. */
export type UseReadRateReadingReturn = ReadRateSnapshot & { refetch: () => void };

const UNMEASURED = Symbol('no readRate on the response');

/**
 * Parse the endpoint's payload into a reading.
 *
 * Returns {@link UNMEASURED} when the response carried no `readRate`, `null`
 * when what it carried does not match the contract, and the reading otherwise.
 */
function parseReading(payload: unknown): ReadRateBannerReading | typeof UNMEASURED | null {
  if (!payload || typeof payload !== 'object') return null;
  const raw = (payload as { readRate?: unknown }).readRate;
  if (raw === undefined || raw === null) return UNMEASURED;
  if (typeof raw !== 'object') return null;

  const { state, readsPerWrite, ratioThreshold } = raw as {
    state?: unknown;
    readsPerWrite?: unknown;
    ratioThreshold?: unknown;
  };
  if (state !== 'ok' && state !== 'anomalous') return null;
  if (typeof ratioThreshold !== 'number' || !Number.isFinite(ratioThreshold)) return null;

  // Absent (either spelling) = no writes at all. See the module header.
  if (readsPerWrite === undefined || readsPerWrite === null) return { state, ratioThreshold };
  if (typeof readsPerWrite !== 'number' || !Number.isFinite(readsPerWrite) || readsPerWrite < 0) {
    return null;
  }
  return { state, readsPerWrite, ratioThreshold };
}

/**
 * Load this environment's read-rate reading. See the module header for the
 * status model, the parsing contract and the refetch policy.
 */
export function useReadRateReading(options: UseReadRateReadingOptions = {}): UseReadRateReadingReturn {
  const { apiBase, enabled = true } = options;
  const [snapshot, setSnapshot] = React.useState<ReadRateSnapshot>({ status: 'idle', reading: null });
  const [reloadToken, setReloadToken] = React.useState(0);

  const refetch = React.useCallback(() => setReloadToken((n) => n + 1), []);

  const base = React.useMemo(() => resolveRuntimeApiBase(apiBase), [apiBase]);

  React.useEffect(() => {
    if (!enabled) return; // inert — the idle snapshot is DERIVED below, not written
    if (typeof fetch !== 'function') return; // non-browser env → stay inert (fail-soft)
    let cancelled = false;
    setSnapshot({ status: 'loading', reading: null });
    // The shared reader: the storage-capacity banner mounted beside this report
    // asks for the same response in the same commit, and gets this request.
    readStorageUsage(base)
      .then((payload) => {
        if (cancelled) return;
        const parsed = parseReading(payload);
        if (parsed === UNMEASURED) setSnapshot({ status: 'unmeasured', reading: null });
        else if (parsed === null) setSnapshot({ status: 'unavailable', reading: null });
        else setSnapshot({ status: 'measured', reading: parsed });
      })
      .catch(() => {
        if (cancelled) return;
        // Fail-soft, and deliberately NOT 'unmeasured' — see the module header.
        setSnapshot({ status: 'unavailable', reading: null });
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, base, reloadToken]);

  // A disabled hook HAS no reading, so `idle` is DERIVED here rather than
  // written back from the effect: state React can compute is not state an
  // effect should set, and deriving it also means a hook toggled off cannot
  // keep serving the answer it happened to hold.
  const effective: ReadRateSnapshot = enabled ? snapshot : { status: 'idle', reading: null };
  // Rebuilt rather than spread so the discriminated union survives into the
  // caller and `reading` narrows on `status` without a cast.
  if (effective.status === 'measured') return { status: 'measured', reading: effective.reading, refetch };
  return { status: effective.status, reading: null, refetch };
}
