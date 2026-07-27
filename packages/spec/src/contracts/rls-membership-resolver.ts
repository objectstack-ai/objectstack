// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0105 D11] `rls-membership-resolver` — the extension point that fills
 * {@link ExecutionContextSchema.rlsMembership}.
 *
 * ## Why this contract exists
 *
 * The RLS compiler implements a deliberately subquery-free grammar (ADR-0056):
 * set-membership that would otherwise need a subquery is PRE-RESOLVED by the
 * runtime into `ExecutionContext.rlsMembership` under a stable key, and a policy
 * references it as `field IN (current_user.<key>)`. The compiler has merged that
 * bag since day one — but nothing in production ever populated it. A declared
 * capability with no producer is the ADR-0049 defect ("declared but
 * unenforced"), and ADR-0105 D11 resolves it the enforce-or-remove way: keep the
 * seam, and give it a real contract so plugins and apps can fill it.
 *
 * ## Contract
 *
 * A resolver DECLARES the keys it owns and RESOLVES them for one request. The
 * declaration is what makes the seam auditable: an authoring lint can tell a
 * policy referencing an unowned key from a typo, and an operator can see which
 * plugin supplies which key.
 *
 * ## Fail-closed by construction
 *
 * A resolver that throws, omits a key, or returns an empty array makes every
 * policy referencing that key DROP OUT — and a policy that drops out narrows
 * access (fail closed), never widens it. Callers must therefore never treat a
 * resolution failure as "no restriction": the compiler's existing
 * missing-variable path already yields zero rows, which is the safe answer.
 *
 * ## What does NOT belong here
 *
 * `accessible_org_ids` (ADR-0105 D2) is CORE-resolved, not an app resolver: it
 * is the `group` posture's Layer 0 wall, and a wall an app could redefine would
 * not be a wall. The same goes for `org_user_ids` — the one well-known
 * membership set, resolved by `resolveAuthzContext`. This seam is for
 * app-shaped sets: the accounts in a rep's territories, the records a case team
 * can touch, the cost centres a controller reviews.
 */

/** Kernel service name a membership resolver registers under. */
export const RLS_MEMBERSHIP_RESOLVER_SERVICE = 'rls-membership-resolver';

/** The request facts a resolver may key off. A subset of `ExecutionContext`. */
export interface RlsMembershipContext {
  /** The acting principal. Absent for an anonymous request (resolvers should return `{}`). */
  userId?: string;
  /** Active organization id (`ExecutionContext.tenantId`). */
  tenantId?: string;
  /** Organizations the caller holds a valid membership in (ADR-0105 D2). */
  accessible_org_ids?: string[];
  /** Positions held for this request. */
  positions?: string[];
  /** Permission-set names resolved for this request. */
  permissions?: string[];
}

/**
 * Resolves pre-computed membership sets for RLS `IN (current_user.<key>)`
 * predicates. Registered under {@link RLS_MEMBERSHIP_RESOLVER_SERVICE}.
 */
export interface IRlsMembershipResolver {
  /**
   * The `current_user.*` keys this resolver owns. Declared up front so the seam
   * is auditable and a policy referencing an unowned key is distinguishable
   * from a typo. Keys are `snake_case` and must not collide with the named
   * context fields (`id`, `organization_id`, `positions`, `org_user_ids`,
   * `accessible_org_ids`, `email`) — the compiler never lets a membership key
   * clobber those.
   */
  readonly keys: readonly string[];

  /**
   * Resolve this request's sets. Returning a subset of {@link keys} is fine —
   * an unresolved key simply makes its policies drop out (fail closed).
   *
   * MUST NOT throw for an ordinary miss; a throw is treated as "resolved
   * nothing", with the same fail-closed outcome.
   */
  resolve(context: RlsMembershipContext): Promise<Record<string, string[]>>;
}

/**
 * Context keys a membership resolver may never supply — they are resolved by
 * the kernel and carry authorization meaning an app must not be able to redefine.
 */
export const RESERVED_RLS_MEMBERSHIP_KEYS: readonly string[] = [
  'id',
  'organization_id',
  'positions',
  'org_user_ids',
  'accessible_org_ids',
  'email',
] as const;
