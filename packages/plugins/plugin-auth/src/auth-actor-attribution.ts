// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#4586] The better-auth actor seam — carry the real human into the write
 * context for ATTRIBUTION, never for authorization.
 *
 * ## The gap this closes
 *
 * better-auth is the identity authority: every write to `sys_member`,
 * `sys_user`, `sys_invitation` … goes through its routes, and the ObjectQL
 * adapter runs them `isSystem: true` **on purpose** (see `withSystemContext`
 * in `objectql-adapter.ts` — the route already authorized the action under
 * better-auth's own ACL, and ADR-0092 D2 refuses user-context writes to those
 * tables outright). `sys_member` is `trackHistory: true`, so its role
 * transitions were already recorded — but with "system" as the actor, because
 * the human who clicked *make admin* was known exactly once, in the hook layer
 * where the session exists, and discarded before the write reached ObjectQL.
 *
 * This module is that one hop. It is deliberately GENERAL: it attributes every
 * better-auth-originated write, not `sys_member` alone, so the next
 * better-auth-managed table inherits the fix instead of re-filing the bug.
 *
 * ## The invariant, and it is the whole point
 *
 * The threaded actor is **attribution only**. It travels as
 * `ExecutionContext.attributedUserId`, which no security middleware reads, and
 * it never becomes `ExecutionContext.userId` — the subject the engine
 * authorizes AS. Promoting it would re-adjudicate, under the platform's RBAC,
 * a decision better-auth already made under its own — the second adjudication
 * track ADR-0095 D3 closed. `isSystem: true` stays exactly where it is.
 *
 * ## Shape
 *
 * A request-scoped {@link AsyncLocalStorage} store, opened once at the auth
 * request boundary (`AuthManager.handleRequest`) and filled LAZILY:
 *
 *  1. `runWithAuthActorScope` opens an empty scope around the whole request —
 *     O(1), no I/O, no session lookup;
 *  2. better-auth's global `hooks.before` (which runs for EVERY endpoint,
 *     `matcher: () => true`, including the organization plugin's) hands the
 *     scope a RESOLVER over its own endpoint ctx — still no I/O;
 *  3. a write that actually needs attribution awaits
 *     {@link resolveAttributedUserId}, which runs the resolver at most once
 *     per request and memoizes it.
 *
 * So a read-only auth request pays nothing, and a writing request pays one
 * session resolution — the same one better-auth's own `sessionMiddleware`
 * memoizes on `ctx.context.session`.
 *
 * No scope (a programmatic `auth.api.*` call, a boot-time sync, a scheduled
 * job) resolves to `undefined`, which records as `null` — the platform's one
 * representation for "the system did this" (ADR-0118 D1). Absence is never
 * upgraded into a caller.
 *
 * WebContainer caveat: its `node:async_hooks` does not propagate a store
 * across `await` (the same defect `auth-manager.ts` polyfills for better-auth's
 * request state). There, attribution degrades to absent — i.e. to today's
 * behaviour — which is the safe direction: a lost actor records as the system,
 * it never mis-attributes one write to another request's user.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Resolves the acting user id for the current auth request, or `null` when no
 * session can be established. Supplied by the hook layer, which is the only
 * place the session actor exists.
 */
export type AuthActorResolver = () => Promise<string | null | undefined>;

interface AuthActorScope {
  /** Set by the before-hook; run at most once, on first demand. */
  resolver?: AuthActorResolver;
  /** Memoized resolution for this request (shared by concurrent writes). */
  pending?: Promise<string | undefined>;
  /**
   * True only INSIDE the resolver's own async subtree. Session resolution goes
   * back through better-auth and can itself write (session refresh); that write
   * must not await the resolution producing it. A concurrent SIBLING write is
   * unaffected — it sees the outer scope and simply awaits `pending`.
   */
  suspended?: boolean;
}

const scopeStore = new AsyncLocalStorage<AuthActorScope>();

/**
 * Open an attribution scope for one auth request. Everything the request does
 * — hooks, endpoint handler, adapter writes — runs inside it.
 */
export function runWithAuthActorScope<T>(fn: () => Promise<T>): Promise<T> {
  return scopeStore.run({}, fn);
}

/**
 * Open an attribution scope for an actor that is ALREADY known — the shape a
 * framework route takes when it authorized the caller itself and then drives
 * better-auth programmatically (`/auth/admin/create-user`,
 * `/auth/admin/import-users`: `gateAdmin` resolves the platform admin, then
 * `auth.api.createUser` runs server-side, bypassing `handleRequest`).
 *
 * Without this, those paths would write identity rows — and fire the membership
 * reconciler — with no actor at all, recording an admin's deliberate action as
 * the system. Same attribution-only semantics: the write still authorizes as
 * the system, and this route's own authorization already happened, above.
 */
export function runAttributedToUser<T>(
  userId: string | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  return runWithAuthActorScope(async () => {
    if (userId) setAuthActorResolver(async () => userId);
    return fn();
  });
}

/**
 * Hand the current scope a way to resolve the acting user. Cheap and
 * idempotent: the resolver is stored, not run. Called from better-auth's
 * global before-hook, which has the endpoint ctx the session hangs off.
 *
 * A no-op outside a scope (programmatic `auth.api.*` calls), and after the
 * resolution has already started — every dispatch inside one request resolves
 * the same user, so the first resolver wins and re-registration cannot flip
 * an in-flight attribution.
 */
export function setAuthActorResolver(resolver: AuthActorResolver): void {
  const scope = scopeStore.getStore();
  if (!scope || scope.suspended || scope.pending || scope.resolver) return;
  scope.resolver = resolver;
}

/**
 * The acting user id for the current auth request, or `undefined` when there
 * is none (no scope, no resolver, no session, or a failed lookup).
 *
 * Never throws: attribution is observability, and a failure to name the actor
 * must never fail the write it was describing.
 */
export async function resolveAttributedUserId(): Promise<string | undefined> {
  const scope = scopeStore.getStore();
  if (!scope || scope.suspended) return undefined;
  if (!scope.pending) {
    const resolver = scope.resolver;
    if (!resolver) return undefined;
    scope.pending = scopeStore.run({ suspended: true }, async () => {
      try {
        const resolved = await resolver();
        return typeof resolved === 'string' && resolved.length > 0 ? resolved : undefined;
      } catch {
        return undefined;
      }
    });
  }
  return scope.pending;
}

/**
 * The execution context for a better-auth-owned write: system authorization
 * plus — when one is in scope — the human it is attributed to.
 *
 * `isSystem: true` is the AUTHORIZATION half and is unconditional;
 * `attributedUserId` is the ATTRIBUTION half and is purely additive. Use this
 * anywhere plugin-auth writes an identity table on better-auth's behalf, so
 * the two halves are constructed together and neither can drift into the other.
 */
export async function authSystemWriteContext(): Promise<{
  isSystem: true;
  attributedUserId?: string;
}> {
  const attributedUserId = await resolveAttributedUserId();
  return attributedUserId ? { isSystem: true, attributedUserId } : { isSystem: true };
}
