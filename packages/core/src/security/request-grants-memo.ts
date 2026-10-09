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
 * nothing and stores nothing. No envelope survives the request — ⛔ this is not
 * a cache and must not become one; the cross-request cache is
 * `resolve-user-grants-cache.ts`, behind its own ruled default-off switch. The
 * only module-level state is the per-engine write observer below: two
 * counters per engine, no grant data.
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
 *  - **No write has landed, or is landing, since the resolution opened.** Two
 *    signals, both read when the resolution OPENS (before its first read) and
 *    again when the entry is looked up:
 *      1. The engine's write epoch. The engine bumps it when a write STARTS,
 *         ahead of its middleware chain (and for non-write reasons: a declared
 *         permission set, a peer's hint). It says nothing about when a write
 *         LANDS, so on its own it would serve an entry read while a write that
 *         had already bumped was still in flight, after that write landed.
 *      2. The engine write observer: a middleware this module registers on
 *         first sight of an engine, counting every write that enters it and,
 *         in a `finally` around `next()`, every write whose driver step has
 *         settled. The driver step runs INSIDE that `next()`, so a write cannot
 *         land without first moving `started` and cannot finish without moving
 *         `completed`.
 *    An entry is served only when the epoch, `started` and `completed` all read
 *    what they read at the open AND no write is inside the observer
 *    (`started === completed`). So a write that started before the open and
 *    lands after it, one that starts after it, and one still in flight at the
 *    lookup all make step 2 read afresh. A `ql` without the epoch seam or
 *    without `registerMiddleware` declines entirely: an answer whose staleness
 *    cannot be observed is not served, not even for milliseconds.
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
 * ⚠️ What the observer cannot see, stated exactly. The engine snapshots its
 * middleware list when a write starts, so a write that STARTED before the
 * observer was registered on that engine never passes it. The observer is
 * registered at the entry of the first `resolveAuthzContext` call that names
 * the engine (and on first sight of any other engine a resolution reads), and
 * the scope that registers it stores nothing for that engine — that request
 * reads twice. What stays open is narrower: a write that began before that
 * first call and is still in flight when a LATER request's resolution opens,
 * landing between that resolution and its step 2. It is invisible to the
 * epoch (it bumped before) and to the observer (it never enters it). Writes
 * from another process are invisible here too: their rows are read as of the
 * first resolution, a few milliseconds earlier than the second used to read
 * them — the same answer a write committing just after the second read always
 * got.
 *
 * The cost: on an engine with a concurrent write, step 2 reads afresh. That
 * includes a session read that writes inside the request (the first request on
 * a fresh auth instance generates its signing key; `enforceSessionControls`
 * stamps `sys_session.last_activity_at` about once a minute per session when an
 * idle timeout is configured) — the safe direction, with no saving on that
 * request.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

import type { ResolveUserAuthzGrantsOptions, UserAuthzGrants } from './resolve-authz-context.js';

// ── The engine write observer ────────────────────────────────────────────────

/**
 * Per-engine write counters, advanced by {@link observeEngineWrites}'s
 * middleware. `started - completed` is the number of writes inside the
 * observer right now.
 */
interface EngineWriteObserver {
  started: number;
  completed: number;
}

/**
 * Keyed on the engine instance: two engines in one process never share
 * counters, and a dropped engine takes its counters with it. `null` records an
 * engine whose middleware registration THREW — poisoned, never memoised
 * behind, as the grants cache poisons a half-wired seam.
 */
const engineWriteObservers = new WeakMap<object, EngineWriteObserver | null>();

/**
 * The engine operations that read. Everything else the chain runs is counted
 * as a write — including an operation this list has never heard of, so a new
 * write verb is observed by default (the safe direction: a new READ verb would
 * only cost a declined memo while one is in flight). The engine's own epoch
 * advances for `insert` / `update` / `delete`.
 */
const READ_OPERATIONS: ReadonlySet<string> = new Set(['find', 'findOne', 'count', 'aggregate']);

interface MiddlewareSeam {
  registerMiddleware?: unknown;
}

/**
 * Fetch — and on first sight of an engine, register — the write observer.
 * Returns `{ observer, attachedNow }`, or `undefined` for an engine without
 * `registerMiddleware` and for one whose registration threw.
 */
function observeEngineWrites(ql: object): { observer: EngineWriteObserver; attachedNow: boolean } | undefined {
  const existing = engineWriteObservers.get(ql);
  if (existing !== undefined) return existing ? { observer: existing, attachedNow: false } : undefined;

  const register = (ql as MiddlewareSeam).registerMiddleware;
  if (typeof register !== 'function') return undefined;

  const observer: EngineWriteObserver = { started: 0, completed: 0 };
  try {
    (register as (
      fn: (ctx: { operation?: unknown }, next: () => Promise<void>) => Promise<void>,
    ) => void).call(ql, async (ctx, next) => {
      const operation = ctx?.operation;
      if (typeof operation === 'string' && READ_OPERATIONS.has(operation)) return next();
      observer.started += 1;
      try {
        await next();
      } finally {
        observer.completed += 1;
      }
    });
  } catch {
    engineWriteObservers.set(ql, null);
    return undefined;
  }
  engineWriteObservers.set(ql, observer);
  return { observer, attachedNow: true };
}

// ── The request scope ────────────────────────────────────────────────────────

interface RequestGrantsMemoEntry {
  /** A private clone of the resolved envelope. Never handed out directly. */
  value: UserAuthzGrants;
  /** The engine write epoch read when the resolution opened, before any read. */
  epochAtOpen: number;
  /** The observer's `started` when the resolution opened. */
  startedAtOpen: number;
  /** The observer's `completed` when the resolution opened. */
  completedAtOpen: number;
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
  /**
   * Engines whose observer THIS scope registered. A write already in flight at
   * registration never passes the observer, so this scope stores nothing for
   * them.
   */
  attachedHere: WeakSet<object>;
}

const scopeStorage = new AsyncLocalStorage<RequestGrantsMemoScope>();

/**
 * Run `fn` — one `resolveAuthzContext` body — inside a fresh memo scope, and
 * close the scope when it settles. Nested calls each get their own scope.
 * `ql` is the engine the body resolves against (`undefined` when it carries no
 * write epoch, so the memo can never serve there); its write observer is
 * registered here, before any read, when this is the first call to name it.
 */
export async function withRequestGrantsMemo<T>(ql: unknown, fn: () => Promise<T>): Promise<T> {
  const scope: RequestGrantsMemoScope = { open: true, entries: new WeakMap(), attachedHere: new WeakSet() };
  if (ql && typeof ql === 'object' && observeEngineWrites(ql)?.attachedNow) scope.attachedHere.add(ql);
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
 * path, no side effects beyond registering the engine's write observer — outside
 * a `resolveAuthzContext` scope or after it closed, for a `bypassGrantsCache`
 * caller, and for a `ql` that is not an object, carries no write epoch
 * (`epochNow` undefined) or cannot register a middleware.
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
  const observed = observeEngineWrites(ql);
  if (!observed) return undefined;
  if (observed.attachedNow) scope.attachedHere.add(ql);
  const { observer } = observed;

  const key = memoKey(userId, opts);
  const now = opts.nowMs ?? Date.now();
  const existing = scope.entries.get(ql)?.get(key);
  if (
    existing
    && existing.epochAtOpen === epochNow
    && existing.startedAtOpen === observer.started
    && existing.completedAtOpen === observer.completed
    && observer.started === observer.completed
    && existing.resolvedAtMs <= now
    && (existing.nextBoundaryMs === undefined || now < existing.nextBoundaryMs)
  ) {
    return { hit: structuredClone(existing.value), commit: () => {} };
  }

  const startedAtOpen = observer.started;
  const completedAtOpen = observer.completed;
  return {
    commit(grants, resolvedAtMs, nextBoundaryMs) {
      if (!scope.open || scope.attachedHere.has(ql)) return;
      let perEngine = scope.entries.get(ql);
      if (!perEngine) {
        perEngine = new Map();
        scope.entries.set(ql, perEngine);
      }
      perEngine.set(key, {
        value: structuredClone(grants),
        epochAtOpen: epochNow,
        startedAtOpen,
        completedAtOpen,
        resolvedAtMs,
        nextBoundaryMs,
      });
    },
  };
}
