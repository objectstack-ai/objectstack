// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ── Leg B of #11633: the cross-request grants cache (#11971) ────────────────
 *
 * Caches the `UserAuthzGrants` envelope `resolveUserAuthzGrants` produces —
 * the answer to "what may this user do", resolved on every authenticated
 * request. Ruled shape (maintainer acceptance on #11633, 2026-08-25, verbatim
 * 「接受你的建议，继续」), none of it re-litigable here:
 *
 *  - **Fork 4 — default OFF.** `OS_AUTHZ_GRANTS_CACHE_TTL_MS` defaults to `0`
 *    and `0` is a REAL path: nothing is wired, nothing subscribes, nothing is
 *    stored, and the query pattern is byte-identical to the uncached one.
 *    A deployment that turns it on accepts the staleness window explicitly.
 *  - **Fork 1 → A — coarse invalidation.** Any write to a watched object
 *    retires EVERY entry for that engine. The seam cannot say whose entry a
 *    `where`-shaped update touches without reading the row back (#11633
 *    §2.2), and `org_user_ids` depends on OTHER users' rows — a `sys_member`
 *    write must retire the organization's entries, not the writer's, which
 *    coarse invalidation gets right by construction. Keyed invalidation is
 *    ⛔ not a scheduled follow-up; it first needs a write-heavy-tenant
 *    measurement.
 *  - **Expiry-boundary rule.** An entry expires at `min(ttl, nextBoundary)`:
 *    ADR-0091 validity windows flip with **no write at the boundary**, so
 *    write-invalidation is structurally blind there and the timer is the only
 *    mechanism for that class (`nextGrantValidityBoundary`).
 *  - **The TTL is the correctness contract; every invalidation signal only
 *    narrows the typical window.** `authz-invalidation-channel.ts` carries
 *    the full statement: no shipped cluster driver delivers better than
 *    at-most-once, so a missed cross-node hint is EXPECTED and the entry's
 *    expiry is what bounds the staleness it leaves behind.
 *
 * ## What invalidates, and through which seam
 *
 *  1. **Local writes — the engine middleware seam, filtered to the watched
 *     set.** The engine's write epoch advances on EVERY write to ANY object
 *     (`objectql/src/engine.ts`), and consuming it raw would revive the
 *     measured keying trap the ruling names: `sys_session.last_activity_at`
 *     is written on a once-a-minute cadence per active session
 *     (`enforceSessionControls`), and a watched object with a background
 *     write cadence silently converts a cache into a non-cache. `sys_session`
 *     does not feed the grants envelope, so this cache registers its own
 *     engine middleware and retires entries only on writes to
 *     {@link GRANTS_CACHE_WATCHED_OBJECTS} — the tables the resolver reads,
 *     plus `sys_user` (`ai_access`, and the #11663 config-anchor email).
 *     The bump lands AFTER the write completes (settings-seam discipline:
 *     `emitChange` below `upsertRow`), so a resolution in flight across a
 *     write stamps a pre-write generation and is dead on arrival — the safe
 *     direction.
 *  2. **Everything the middleware cannot see — the epoch's non-`write`
 *     reasons, wholesale.** `'metadata'` (a permission set can be DECLARED,
 *     so a Studio edit is a permission change with no row written —
 *     plugin-security bumps the engine epoch for it), `'remote'` (a peer's
 *     `authz.invalidated` hint, which carries no object and whose only
 *     correct reading is "retire everything"), and `'manual'`. Local
 *     `'write'` bumps are deliberately ignored HERE because seam 1 already
 *     handled them with object precision.
 *
 * ## Caching requires the seams — a `ql` without them declines
 *
 * Same load-bearing rule as leg C (`resolve-authz-context.ts`): a `ql` that
 * exposes no write epoch or no `registerMiddleware` is a `ql` whose writes
 * this cache cannot observe, and the acceptance criterion — a grant/revoke is
 * observed by the NEXT request on the writing node, by invalidation and not
 * by TTL — is unmeetable against it. Rather than degrade to the TTL-only
 * shape, the cache declines and every such caller keeps its exact uncached
 * behaviour. Every existing test double takes this path.
 *
 * ## Keying — seeds are part of the answer, so seeds are part of the key
 *
 * One entry per `(userId, tenantId, seedEmail, seedPermissions)`. #11633 §4
 * B.2 sketches the alternative — cache the seedless envelope, re-apply seeds
 * outside — and conditions it on seeding being "a pure prepend, which must be
 * *pinned*, not assumed". Measured here before implementing: it is NOT a pure
 * prepend. Seeds flow into derivations, not just into the array — a seed
 * named in `ORGANIZATION_ADMIN_GRANTS` moves the ADR-0095 posture rung, and
 * seeded `email`/`ai_seat` suppress the `sys_user` read (`needsUserRow`), so
 * a seedless resolution issues a query the seeded path must not issue (the
 * multiset half of pin 5). Re-deriving those outside the resolver would be a
 * second copy of authorization logic — the drift shape #10348 exists to end.
 * Keying on the seeds keeps every cached answer bit-identical to its own
 * uncached resolution by construction, at the cost of one entry per key-scope
 * combination — bounded by active principals, and retired wholesale anyway.
 *
 * `nowMs` is deliberately NOT in the key: time is not identity. A caller's
 * clock participates through entry expiry (`expiresAt` is compared against
 * the RESOLVING call's clock), which is what makes the validity-boundary pin
 * testable with an injected clock.
 *
 * ## Served values are clones
 *
 * `resolveAuthzContext` assigns the envelope's arrays into the request
 * context, and downstream enforcement is free to mutate what it was handed.
 * Entries therefore store a private `structuredClone` and every hit serves a
 * fresh one — a caller's mutation can never corrupt the cached answer.
 */

import type {
  ResolveUserAuthzGrantsOptions,
  UserAuthzGrants,
} from './resolve-authz-context.js';
import { readAuthzGrantsCacheTtlMs } from './authz-cache-posture.js';

/**
 * The watched set — the objects whose rows feed the grants envelope, derived
 * in #11633 §4 (leg B) by reading the resolver, and ruled with two measured
 * keying traps attached:
 *
 * ⛔ `sys_session` stays OUT. It does not feed the envelope, and its
 * `last_activity_at` is written once a minute per active session — watching
 * it would retire the whole cache on that cadence (the "background write
 * cadence converts a cache into a non-cache" trap).
 *
 * `metadata.changed` is the eighth trigger and is not an object: it arrives
 * as an epoch bump with reason `'metadata'` (see the module doc).
 */
export const GRANTS_CACHE_WATCHED_OBJECTS: ReadonlySet<string> = new Set([
  'sys_member',
  'sys_user_position',
  'sys_user_permission_set',
  'sys_position',
  'sys_position_permission_set',
  'sys_permission_set',
  'sys_user',
]);

interface GrantsCacheEntry {
  /** A private clone of the resolved envelope. Never handed out directly. */
  value: UserAuthzGrants;
  /** The generation this value was resolved AT (read before the reads). */
  gen: number;
  /** `min(resolvedAt + ttl, nextValidityBoundary)` on the resolving clock. */
  expiresAt: number;
}

interface GrantsCacheState {
  /**
   * Coarse retirement counter. An entry is live only while this has not
   * moved since the entry's resolution began. Advanced by seam 1 (watched
   * writes, post-completion) and seam 2 (non-`write` epoch reasons).
   */
  gen: number;
  entries: Map<string, GrantsCacheEntry>;
}

/**
 * Per-engine state. WeakMap-keyed on the `ql` instance for the same reason as
 * leg C: two environments/tenant engines sharing a process must never see each
 * other's entries, and a dropped engine takes its cache with it.
 *
 * `null` records a `ql` whose wiring FAILED partway — poisoned, never cached,
 * so a half-attached invalidation seam can never stand behind an entry.
 */
const grantsCacheStates = new WeakMap<object, GrantsCacheState | null>();

/** Structural mirror of `WriteEpochLike` — see `readWriteEpoch` in leg C for
 * why the import direction is unavailable (`@objectstack/objectql` depends on
 * this package). The WHOLE surface is checked so a bare `{ current }` on some
 * unrelated double cannot license caching against a counter nothing bumps. */
interface EpochSeam {
  readonly current: number;
  bump(reason: string): unknown;
  subscribe(listener: (epoch: number, reason: string) => void): unknown;
}

interface MiddlewareSeamQl {
  writeEpoch?: unknown;
  registerMiddleware?: unknown;
  find?: unknown;
}

const WRITE_OPERATIONS = new Set(['insert', 'update', 'delete']);

/**
 * Fetch — and on first sight of an engine, wire — the invalidation state.
 * Returns `undefined` for a `ql` without both seams (declines, uncached path)
 * and for one whose wiring threw (poisoned; see {@link grantsCacheStates}).
 *
 * ⚠️ Only ever called with a non-zero TTL in hand: with the cache OFF this
 * module must leave NO footprint on the engine — no middleware, no epoch
 * subscription — so that `0` stays a real path, not a degenerate TTL
 * (#11633 §7 pin 7).
 */
function grantsCacheState(ql: object): GrantsCacheState | undefined {
  const existing = grantsCacheStates.get(ql);
  if (existing !== undefined) return existing ?? undefined;

  const seamQl = ql as MiddlewareSeamQl;
  const epoch = seamQl.writeEpoch as Partial<EpochSeam> | null | undefined;
  const hasEpoch =
    !!epoch &&
    typeof epoch === 'object' &&
    typeof epoch.current === 'number' &&
    typeof epoch.bump === 'function' &&
    typeof epoch.subscribe === 'function';
  if (!hasEpoch || typeof seamQl.registerMiddleware !== 'function') {
    // Not memoized: probing is cheap and a double's shape is static anyway.
    return undefined;
  }

  const state: GrantsCacheState = { gen: 0, entries: new Map() };
  try {
    // Seam 1 — watched writes, object-filtered, bumped AFTER the write
    // completes (and on a throw: a partial write is a write; over-invalidation
    // is the safe direction and costs one re-read).
    (seamQl.registerMiddleware as (
      fn: (
        ctx: { object?: unknown; operation?: unknown },
        next: () => Promise<void>,
      ) => Promise<void>,
    ) => void)(async (ctx, next) => {
      if (
        typeof ctx?.operation !== 'string' ||
        !WRITE_OPERATIONS.has(ctx.operation) ||
        typeof ctx?.object !== 'string' ||
        !GRANTS_CACHE_WATCHED_OBJECTS.has(ctx.object)
      ) {
        return next();
      }
      try {
        await next();
      } finally {
        state.gen += 1;
      }
    });

    // Seam 2 — everything object-less: 'metadata' (declared permission sets),
    // 'remote' (peer hints carry no object; wholesale is the only correct
    // response), 'manual'. Local 'write' bumps are seam 1's job, already done
    // with object precision — retiring on them here would re-import the
    // sys_session trap this module exists to keep out. Never disposed, like
    // leg C's settings subscription: it holds one integer per engine and the
    // engine outlives this module's interest in it.
    (epoch as EpochSeam).subscribe((_epoch, reason) => {
      if (reason !== 'write') state.gen += 1;
    });
  } catch {
    // Wiring failed partway — poison this ql rather than cache behind a seam
    // that may be half-attached. Entries never existed, so nothing to drop.
    grantsCacheStates.set(ql, null);
    return undefined;
  }

  grantsCacheStates.set(ql, state);
  return state;
}

/** Seeds and identity in, collision-free key out. JSON, not delimiters — a
 * seed permission is caller-supplied text and must not be able to alias
 * another caller's key by containing a separator. */
function grantsCacheKey(userId: string, opts: ResolveUserAuthzGrantsOptions): string {
  return JSON.stringify([
    userId,
    opts.tenantId ?? null,
    opts.seedEmail ?? null,
    Array.isArray(opts.seedPermissions) ? opts.seedPermissions : [],
  ]);
}

const cloneGrants = (grants: UserAuthzGrants): UserAuthzGrants => structuredClone(grants);

/**
 * One attempted cache interaction, opened at the top of
 * `resolveUserAuthzGrants` and committed (on a miss) with the resolved
 * envelope. The generation and clock are snapshotted at OPEN — before any
 * read is issued — so a write landing while the resolution is in flight
 * moves `state.gen` past what `commit` stamps and the entry is dead on
 * arrival (leg C's clear-then-repopulate discipline, #11633 §7 pin 2).
 */
export interface GrantsCacheAttempt {
  /** A live entry's envelope, already cloned for the caller. */
  hit?: UserAuthzGrants;
  /**
   * Store a freshly resolved envelope. `nextBoundaryMs` is the earliest
   * upcoming ADR-0091 validity boundary among the rows consulted
   * (`nextGrantValidityBoundary`, computed by the resolver), capping the expiry
   * below the TTL — the expiry-boundary rule.
   */
  commit(grants: UserAuthzGrants, nextBoundaryMs: number | undefined): void;
}

/**
 * Open the grants cache for one resolution. Returns `undefined` — the fully
 * uncached path, zero side effects — when any of these holds:
 *
 *  - the caller is on the ruled bypass list (`bypassGrantsCache`);
 *  - `OS_AUTHZ_GRANTS_CACHE_TTL_MS` is unset, `0`, or malformed (Fork 4:
 *    OFF is the default and a real path);
 *  - `ql` is not an engine-shaped object, or lacks the write-epoch /
 *    middleware seams the invalidation contract requires (declines — see
 *    the module doc).
 */
export function openUserGrantsCache(
  ql: unknown,
  userId: string,
  opts: ResolveUserAuthzGrantsOptions,
): GrantsCacheAttempt | undefined {
  if (opts.bypassGrantsCache) return undefined;
  const { ttlMs } = readAuthzGrantsCacheTtlMs();
  if (ttlMs <= 0) return undefined;
  if (!ql || typeof ql !== 'object' || typeof (ql as MiddlewareSeamQl).find !== 'function') {
    return undefined;
  }
  const state = grantsCacheState(ql);
  if (!state) return undefined;

  const key = grantsCacheKey(userId, opts);
  const now = opts.nowMs ?? Date.now();
  const genAtOpen = state.gen;

  const existing = state.entries.get(key);
  if (existing) {
    if (existing.gen === state.gen && existing.expiresAt > now) {
      return { hit: cloneGrants(existing.value), commit: () => {} };
    }
    // Dead entry (retired or expired) — drop it now rather than letting it
    // shadow the fresh value if the commit below never stores (e.g. a
    // boundary already inside this instant).
    state.entries.delete(key);
  }

  return {
    commit(grants, nextBoundaryMs) {
      const expiresAt = Math.min(now + ttlMs, nextBoundaryMs ?? Number.POSITIVE_INFINITY);
      if (expiresAt <= now) return;
      state.entries.set(key, { value: cloneGrants(grants), gen: genAtOpen, expiresAt });
    },
  };
}
