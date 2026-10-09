// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The request-scoped grants memo — one {@link resolveAuthzContext} call
 * resolves a principal's grants ONCE, however many readers inside it ask.
 *
 * ## Why a resolution is asked for twice inside one request
 *
 * `resolveAuthzContext` learns WHO the caller is by calling the transport's
 * `getSession`. Against `@objectstack/plugin-auth` that call runs better-auth's
 * `getSession` endpoint, whose `customSession` hook builds the session
 * payload's `positions[]` / `isPlatformAdmin` by asking
 * `resolveUserAuthzGrants` — the one authority, on purpose (a second
 * derivation there is the drift `resolve-authz-context.ts` exists to end).
 * `resolveAuthzContext` then resolves the same principal's grants AGAIN, with
 * the same arguments, to build the request's envelope. Nothing is written
 * between the two on a healthy request, so the second resolution re-issues
 * every grant read of the first and gets the same rows back. Measured
 * downstream on a hosted composition: 16 of the 23 serial tenant-DB round
 * trips an authenticated request makes before its handler were these two
 * resolutions, eight each.
 *
 * ## The scope — one `resolveAuthzContext` call, never longer
 *
 * `resolveAuthzContext` opens a scope ({@link withRequestGrantsMemo}) around its
 * whole body, the `getSession` call included, so the hook's resolution and the
 * resolver's own run inside the SAME scope; `resolveUserAuthzGrants` consults
 * it ({@link openRequestGrantsMemo}). The scope is an `AsyncLocalStorage`
 * store, so two requests interleaving across their awaits each see only their
 * own, and it is CLOSED when `resolveAuthzContext` settles: a continuation that
 * outlives the resolution (a background task the session read started) reads
 * nothing and stores nothing. There is no module-level state and nothing
 * survives the request — ⛔ this is not a cache and must not become one; the
 * cross-request cache is `resolve-user-grants-cache.ts`, behind its own ruled
 * default-off switch.
 *
 * A host whose async context does not propagate (WebContainer's
 * `node:async_hooks`) simply finds no scope, and every resolution is fresh —
 * the behaviour before this module existed.
 *
 * ## What an entry answers for — it is served only when a fresh read would agree
 *
 *  - **Same call.** The key is the `resolveUserAuthzGrants` arguments that
 *    shape the answer — user, tenant, seed email, seed permissions — spelled as
 *    the cross-request cache spells them, so a different organization (the
 *    session arm's claim-drop re-resolution), a different seed or a different
 *    user is a different entry, and the engine (`ql`) is the outer key. Seeds
 *    are part of the key because they are part of the answer (see
 *    `resolve-user-grants-cache.ts`, "Keying").
 *  - **No write in between.** The engine's write epoch is read when the
 *    resolution OPENS, before its first read, and an entry is served only while
 *    that epoch has not moved — so a write through this engine that starts
 *    while the first resolution is reading, or between the two, makes the
 *    second one read afresh. A `ql` without the epoch seam declines entirely:
 *    an answer whose staleness cannot be observed is not served, not even for
 *    milliseconds.
 *  - **No validity boundary in between.** An ADR-0091 window flips with no
 *    write at all, so an entry is served only to a call whose clock lies in
 *    `[resolvedAt, nextBoundary)` — the interval on which every `isGrantActive`
 *    verdict the resolution made is unchanged.
 *  - **Bypass is bypass.** A `bypassGrantsCache` caller reads nothing from the
 *    memo and writes nothing into it, exactly as it treats the grants cache.
 *  - **Failures are not remembered.** Only a resolution that completed is
 *    stored; a read that threw (`AuthzStoreUnavailableError`) leaves the next
 *    caller to issue its own reads, as before.
 *
 * Served values are clones — the hook puts its `positions` array into the
 * session payload and the resolver puts its own into the request context, and
 * downstream code may mutate either; the two must never alias.
 *
 * ⚠️ What remains different from issuing every read twice, by design: the
 * request's grants are read at the FIRST resolution, a few milliseconds
 * earlier than the second used to read them. A write from another process —
 * invisible to this engine's epoch — that commits inside those milliseconds is
 * seen by the next request instead of this one, the same answer a write
 * committing just after the second read always got.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

import type { ResolveUserAuthzGrantsOptions, UserAuthzGrants } from './resolve-authz-context.js';

interface RequestGrantsMemoEntry {
  /** A private clone of the resolved envelope. Never handed out directly. */
  value: UserAuthzGrants;
  /** The engine write epoch read when the resolution opened, before any read. */
  epochAtOpen: number;
  /** The clock every `isGrantActive` verdict of the resolution was taken at. */
  resolvedAtMs: number;
  /** The earliest validity boundary after `resolvedAtMs`, if any row has one. */
  nextBoundaryMs: number | undefined;
}

interface RequestGrantsMemoScope {
  /** False once the owning `resolveAuthzContext` call has settled. */
  open: boolean;
  /** Outer key: the engine. Inner key: {@link memoKey}. */
  entries: WeakMap<object, Map<string, RequestGrantsMemoEntry>>;
}

const scopeStorage = new AsyncLocalStorage<RequestGrantsMemoScope>();

/**
 * Run `fn` — one `resolveAuthzContext` body — inside a fresh memo scope, and
 * close the scope when it settles. Nested calls each get their own scope.
 */
export async function withRequestGrantsMemo<T>(fn: () => Promise<T>): Promise<T> {
  const scope: RequestGrantsMemoScope = { open: true, entries: new WeakMap() };
  try {
    return await scopeStorage.run(scope, fn);
  } finally {
    scope.open = false;
    scope.entries = new WeakMap();
  }
}

/**
 * JSON, not delimiters — a seed permission is caller-supplied text and must not
 * be able to alias another key by containing a separator. The spelling is the
 * grants cache's (`grantsCacheKey`): `null` and `undefined` collapse, which is
 * behaviour-preserving because the resolver only ever tests the tenant and the
 * seed email for truthiness, and an absent seed list resolves exactly as `[]`.
 */
function memoKey(userId: string, opts: ResolveUserAuthzGrantsOptions): string {
  return JSON.stringify([
    userId,
    opts.tenantId ?? null,
    opts.seedEmail ?? null,
    Array.isArray(opts.seedPermissions) ? opts.seedPermissions : [],
  ]);
}

/** One resolution's interaction with the memo, opened at the top of `resolveUserAuthzGrants`. */
export interface RequestGrantsMemoAttempt {
  /** The envelope an earlier resolution in this request produced, cloned for the caller. */
  hit?: UserAuthzGrants;
  /**
   * Store a freshly resolved envelope. `resolvedAtMs` is the clock the
   * resolution's validity verdicts were taken at; `nextBoundaryMs` is
   * `nextGrantValidityBoundary` over the rows those verdicts were taken on.
   */
  commit(grants: UserAuthzGrants, resolvedAtMs: number, nextBoundaryMs: number | undefined): void;
}

/**
 * Open the memo for one resolution. Returns `undefined` — the plain fresh
 * path, no side effects — outside a `resolveAuthzContext` scope or after it
 * closed, for a `bypassGrantsCache` caller, and for a `ql` that is not an
 * object or carries no write epoch (`epochNow` undefined).
 *
 * `epochNow` is the engine's write epoch as `resolveUserAuthzGrants` reads it
 * (`readWriteEpoch`), passed in rather than re-derived so that the one
 * structural check of that seam stays where it is.
 */
export function openRequestGrantsMemo(
  ql: unknown,
  userId: string,
  opts: ResolveUserAuthzGrantsOptions,
  epochNow: number | undefined,
): RequestGrantsMemoAttempt | undefined {
  if (opts.bypassGrantsCache) return undefined;
  const scope = scopeStorage.getStore();
  if (!scope || !scope.open) return undefined;
  if (!ql || typeof ql !== 'object' || epochNow === undefined) return undefined;

  const key = memoKey(userId, opts);
  const now = opts.nowMs ?? Date.now();
  const existing = scope.entries.get(ql)?.get(key);
  if (
    existing
    && existing.epochAtOpen === epochNow
    && existing.resolvedAtMs <= now
    && (existing.nextBoundaryMs === undefined || now < existing.nextBoundaryMs)
  ) {
    return { hit: structuredClone(existing.value), commit: () => {} };
  }

  return {
    commit(grants, resolvedAtMs, nextBoundaryMs) {
      if (!scope.open) return;
      let perEngine = scope.entries.get(ql);
      if (!perEngine) {
        perEngine = new Map();
        scope.entries.set(ql, perEngine);
      }
      perEngine.set(key, {
        value: structuredClone(grants),
        epochAtOpen: epochNow,
        resolvedAtMs,
        nextBoundaryMs,
      });
    },
  };
}
