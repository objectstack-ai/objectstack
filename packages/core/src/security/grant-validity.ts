// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Grant validity windows (ADR-0091 D1/D2).
 *
 * `sys_user_position` and `sys_user_permission_set` rows carry optional
 * `valid_from` / `valid_until` columns. A row outside its window MUST NOT
 * resolve — anywhere, symmetrically: `resolveAuthzContext`, the explain
 * engine's `buildContextForUser`, plugin-sharing's `expandPositionUsers`,
 * and (transitively) the delegated-admin gate's held-scope resolution.
 *
 * Correctness lives HERE, at resolution time — never in a cleanup job
 * (ADR-0049: no unenforced security properties). The window is half-open
 * `[from, until)` in UTC: a grant is inactive before `valid_from` and
 * inactive AT and AFTER `valid_until`. Null/absent bounds mean unbounded,
 * so pre-ADR-0091 rows behave exactly as before.
 *
 * Fail-closed: a bound that is PRESENT but unparseable disables the grant
 * (unlike API-key `isExpired`, which tolerates garbage — an API key is a
 * single credential, a grant row is standing authority).
 */

/**
 * Coerce a stored timestamp to epoch milliseconds.
 * Returns `undefined` for absent (null/undefined/'') values — "no bound" —
 * and `NaN` for present-but-unparseable values, which callers treat as
 * out-of-window (fail closed).
 */
function toEpochMs(value: unknown): number | undefined {
  if (value == null || value === '') return undefined;
  if (typeof value === 'number') {
    // Heuristic: seconds vs milliseconds epoch (same rule as api-key.ts).
    return value < 1e12 ? value * 1000 : value;
  }
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') return Date.parse(value);
  return Number.NaN;
}

/** The validity-window shape shared by both user-grant tables (ADR-0091 D1). */
export interface GrantValidityWindow {
  valid_from?: unknown;
  valid_until?: unknown;
}

/**
 * True when a grant row is inside its validity window at `nowMs`.
 * The single predicate every resolver uses (ADR-0091 D2):
 * `(valid_from is null or valid_from <= now) and (valid_until is null or valid_until > now)`.
 */
export function isGrantActive(row: GrantValidityWindow | null | undefined, nowMs: number): boolean {
  if (!row) return false;
  const from = toEpochMs((row as any).valid_from ?? (row as any).validFrom);
  // NaN comparisons are always false, so an unparseable bound fails closed.
  if (from !== undefined && !(nowMs >= from)) return false;
  const until = toEpochMs((row as any).valid_until ?? (row as any).validUntil);
  if (until !== undefined && !(nowMs < until)) return false;
  return true;
}

/**
 * The earliest FUTURE validity boundary among `rows`, in epoch ms — or
 * `undefined` when no consulted row can change its `isGrantActive` verdict by
 * clock movement alone.
 *
 * [#11971, #11633 §4 leg B constraint B.1] A cached grants envelope freezes a
 * validity decision: a grant whose `valid_until` passes DURING the cache TTL
 * keeps resolving until the entry expires, and a `valid_from` that arrives
 * during it stays unresolved. **No write occurs at either boundary**, so
 * write-invalidation is structurally blind to this class and the entry's
 * expiry timer is the only mechanism that can catch it. The grants cache
 * therefore expires an entry at `min(ttl, nextBoundary)` — this function is
 * the `nextBoundary` half, computed with the same parser `isGrantActive`
 * reads bounds with, so the two can never disagree about when a row flips.
 *
 * Both directions of flip count: a future `valid_until` (active → expired)
 * AND a future `valid_from` (not-yet-active → active). Bounds that are
 * absent, already past, or present-but-unparseable contribute nothing — an
 * unparseable bound fails the row closed *permanently* (see `isGrantActive`),
 * so there is no future instant at which its verdict changes.
 */
export function nextGrantValidityBoundary(
  rows: Iterable<GrantValidityWindow | null | undefined>,
  nowMs: number,
): number | undefined {
  let next: number | undefined;
  for (const row of rows) {
    if (!row) continue;
    const from = toEpochMs((row as any).valid_from ?? (row as any).validFrom);
    const until = toEpochMs((row as any).valid_until ?? (row as any).validUntil);
    for (const bound of [from, until]) {
      // NaN (unparseable) fails both comparisons and is skipped — fail-closed
      // rows never flip, so they never set a boundary.
      if (bound !== undefined && bound > nowMs && (next === undefined || bound < next)) {
        next = bound;
      }
    }
  }
  return next;
}

/**
 * True when a grant row carries a `valid_until` that has already passed —
 * i.e. it WAS active and expired (not merely not-yet-active). The explain
 * engine uses this to report the dedicated "held until … — expired"
 * contributor state (ADR-0091 D2).
 */
export function isGrantExpired(row: GrantValidityWindow | null | undefined, nowMs: number): boolean {
  if (!row) return false;
  const until = toEpochMs((row as any).valid_until ?? (row as any).validUntil);
  if (until === undefined) return false;
  return !(nowMs < until);
}
