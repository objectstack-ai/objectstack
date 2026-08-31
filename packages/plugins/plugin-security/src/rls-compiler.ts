// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { RowLevelSecurityPolicy } from '@objectstack/spec/security';
import type { ExecutionContext } from '@objectstack/spec/kernel';
// [ADR-0056 D4 / ADR-0058 D1] `isSupportedRlsExpression` and `sqlPredicateToCel`
// used to be DEFINED in this file. #4983 hoisted them into `@objectstack/formula`
// — verbatim, behaviour-preserving — because `@objectstack/lint` must ask the
// SAME question at authoring time and may never import a runtime. This file is
// now a consumer of that one definition, exactly as the lint gate is; there is
// no second copy for the `=` / `IN` bridge to drift against.
import { compileCelToFilter, isSupportedRlsExpression, sqlPredicateToCel } from '@objectstack/formula';

/**
 * RLS User Context
 * Variables available for RLS expression evaluation.
 */
interface RLSUserContext {
  id?: string;
  /**
   * Active organization id for the request. RLS expressions reference
   * this as `current_user.organization_id`. Sourced from
   * `ExecutionContext.tenantId` (the runtime keeps the abstract
   * "tenant" name, but at the data/RLS layer the canonical column is
   * `organization_id` — see better-auth's organization plugin).
   */
  organization_id?: string;
  positions?: string[];
  /**
   * IDs of all users that share the active organization with the
   * current user (incl. self). Pre-resolved by the runtime so RLS can
   * scope identity tables like `sys_user` via
   * `id IN (current_user.org_user_ids)` without needing subquery
   * support in the compiler. This is the one well-known membership set;
   * arbitrary §7.3.1 sets arrive via `ExecutionContext.rlsMembership`
   * and are merged in under their own keys (see {@link RLSCompiler.compileFilter}).
   */
  org_user_ids?: string[];
  /**
   * The caller's unique, auth-enforced email. RLS expressions reference it as
   * `current_user.email` for human-readable, *seedable* owner scoping
   * (`owner = current_user.email`). Email is exposed because it is UNIQUE; the
   * user's display `name` is deliberately NOT exposed — names collide, and a
   * collision on an ownership predicate is an access-control leak.
   */
  email?: string;
  [key: string]: unknown;
}

/**
 * Sentinel filter used when applicable RLS policies exist but none can
 * be compiled against the current execution context (typically because a
 * required `current_user.*` variable is missing — e.g. the user has no
 * active organization). The filter compares `id` against a non-printable
 * UUID-shaped string that no real record will ever carry, so the upstream
 * SQL layer naturally returns zero rows without raising an error. This
 * gives us **fail-closed** semantics for select/update/delete on tables
 * that the user is not entitled to see, without forcing every caller to
 * handle a thrown `PermissionDeniedError` for what is conceptually an
 * empty result set.
 *
 * Exposed for the SecurityPlugin's optional short-circuit path and for
 * tests; see {@link RLSCompiler.compileFilter}.
 */
export const RLS_DENY_FILTER: Record<string, unknown> = Object.freeze({
  id: '__rls_deny__:00000000-0000-0000-0000-000000000000',
});

/**
 * Is this field constraint an emptied membership, and what CONSTANT does it
 * evaluate to? `{ $in: [] }` is constant FALSE on every backend ("IN ()
 * matches nothing"); `{ $nin: [] }` is constant TRUE ("NOT IN () excludes
 * nothing"). Returns that constant, or `null` when the spec is not an emptied
 * membership. The CEL pushdown compiler only ever emits `$in` (negation wraps
 * in `$not` — cel-to-filter.ts), but this guard's contract is over the
 * FilterCondition shape, so the intrinsically-negated `$nin` spelling is
 * recognised too rather than left to fail open should a future lowering emit it.
 */
function emptyMembershipConstantTruth(spec: unknown): boolean | null {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return null;
  const rec = spec as Record<string, unknown>;
  if (Object.keys(rec).length !== 1) return null;
  if (Array.isArray(rec.$in) && (rec.$in as unknown[]).length === 0) return false;
  if (Array.isArray(rec.$nin) && (rec.$nin as unknown[]).length === 0) return true;
  return null;
}

/**
 * Does this compiled filter LEAN ON an emptied membership in a way that must
 * drop the policy (→ the deny sentinel upstream)? Preserves the legacy "empty
 * pre-resolved set drops the policy" semantics so the single-policy path fails
 * closed via the deny sentinel rather than an always-false `$in: []`.
 *
 * [#13552] POLARITY-AWARE. "An emptied membership is safe because `$in: []`
 * matches nothing" is a polarity-DEPENDENT claim, and the pushdown subset
 * contains negation (`not in` is first-class: `!(x in y)` → `$not` wrapping
 * `$in`). The pre-#13552 guard shape-matched the bare positive form only, so
 * `{ $not: { f: { $in: [] } } }` — constant TRUE for every row — flowed
 * through and compiled to ALLOW-ALL on the read scope. Two rules now hold:
 *
 * 1. An emptied membership whose EFFECTIVE polarity is inverted (odd number of
 *    enclosing `$not`s for `$in: []`; zero/even for `$nin: []`) is a
 *    constant-TRUE clause. Anywhere in the tree — wrapping directly, as an arm
 *    of `$or`/`$and` (nested to any depth), inside a multi-key implicit AND,
 *    or under multi-level `$not` — it means the membership restriction the
 *    author wrote has evaporated: as an `$or` arm the whole filter is
 *    allow-all; as an `$and` arm the restriction silently vanishes. Either way
 *    the policy is degenerate → drop it (fail closed), exactly as the emptied
 *    POSITIVE single-policy case already does.
 * 2. The legacy positive case, generalised through double negation: a filter
 *    that consists solely of an emptied `$in` membership under an even
 *    (incl. zero) number of `$not` wrappers is constant FALSE as a whole —
 *    prefer the deny sentinel over an always-false filter (same zero rows,
 *    one recognisable shape).
 *
 * What deliberately does NOT fire, in both cases matching pre-#13552
 * behaviour: a NON-empty membership under `$not` (the working `not in`
 * feature), and an emptied POSITIVE membership nested in a composite — as an
 * `$or` arm it is inert (`owner in <empty> || owner == me` must keep granting
 * own rows), as an `$and` arm the filter is already constant FALSE (denies by
 * itself). A deliberate allow-all stays authorable as literal `true` (compiles
 * to `{}`), which never involves a membership set.
 */
export function isEmptyMembershipFilter(filter: Record<string, unknown>): boolean {
  // (Exported for direct shape tests — rls-empty-membership-polarity.test.ts;
  // not part of the package surface: index.ts deliberately does not re-export it.)
  return containsTautologicalEmptyMembership(filter, false) || isSolelyEmptyMembership(filter);
}

/** Rule 1 above: an emptied membership that is constant TRUE in effective polarity. */
function containsTautologicalEmptyMembership(node: unknown, negated: boolean): boolean {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return false;
  const rec = node as Record<string, unknown>;
  // A BARE operator object (an emptied membership with no field key) is not a
  // shape the CEL lowering emits, but the evaluator answers it fail-closed
  // (constant FALSE — unknown top-level operator), which a wrapping `$not`
  // inverts to constant TRUE. The pre-#13552 guard already fired on
  // `{ $not: { $in: [] } }`; never be weaker than the predecessor on any shape.
  if (emptyMembershipConstantTruth(rec) !== null) return negated;
  for (const [key, value] of Object.entries(rec)) {
    if (key === '$not') {
      if (containsTautologicalEmptyMembership(value, !negated)) return true;
    } else if (key === '$and' || key === '$or') {
      if (Array.isArray(value) && value.some((arm) => containsTautologicalEmptyMembership(arm, negated))) return true;
    } else if (!key.startsWith('$')) {
      const truth = emptyMembershipConstantTruth(value);
      if (truth !== null && (negated ? !truth : truth)) return true;
    }
  }
  return false;
}

/** Rule 2 above: solely an emptied `$in` membership under even (incl. zero) `$not`s. */
function isSolelyEmptyMembership(filter: Record<string, unknown>): boolean {
  let node: Record<string, unknown> = filter;
  let negations = 0;
  for (;;) {
    const keys = Object.keys(node);
    if (keys.length !== 1 || keys[0] !== '$not') break;
    const inner = node.$not;
    if (!inner || typeof inner !== 'object' || Array.isArray(inner)) return false;
    node = inner as Record<string, unknown>;
    negations++;
  }
  if (negations % 2 !== 0) return false; // odd polarity → rule 1's walk owns it
  const keys = Object.keys(node);
  if (keys.length !== 1 || keys[0].startsWith('$')) return false;
  return emptyMembershipConstantTruth(node[keys[0]]) === false;
}

/**
 * [#8059] Does this policy actually DECLARE the given clause?
 *
 * The two clauses answer different questions and are not interchangeable
 * (ADR-0058 D4): `using` is the ROW-SCOPE predicate — which EXISTING rows a
 * read or a write may target — while `check` is POST-IMAGE validation of the
 * new/changed row. A policy may declare either, or both.
 *
 * This is the single definition of "declares a clause", and it is deliberately
 * the same test {@link RLSCompiler.compileFilter} applies per policy when it
 * skips a policy carrying no predicate for the clause being compiled. Callers
 * that need to reason about a policy's shape BEFORE compiling — "is any row
 * scope actually being enforced for this write class?" — must ask here rather
 * than re-deriving it, because a second, drifting answer to that question is
 * exactly what #8059 measured: a `check`-only policy was counted as an
 * applicable write-class policy, the #7665 write-scope derivation was
 * suppressed on that basis, and the write class then compiled to no row filter
 * at all — a caller who could not READ a record could PATCH it by id.
 */
export function policyDeclaresClause(
  policy: RowLevelSecurityPolicy,
  clause: 'using' | 'check',
): boolean {
  const predicate = (policy as { using?: string; check?: string })[clause];
  return typeof predicate === 'string' && predicate.trim() !== '';
}

/**
 * RLSCompiler
 *
 * Compiles Row-Level Security policy expressions into query filters.
 * Converts `using` / `check` expressions into ObjectQL-compatible filter conditions.
 */
export class RLSCompiler {
  /** Optional logger so a SILENTLY-dropped (uncompilable-shape) policy is observable (ADR-0056 D4). */
  private logger?: { warn?: (message: string, meta?: Record<string, unknown>) => void };
  setLogger(logger: { warn?: (message: string, meta?: Record<string, unknown>) => void } | undefined): void {
    this.logger = logger;
  }

  /**
   * Compile RLS policies into a query filter for the given user context.
   * Multiple policies for the same object/operation are OR-combined (any match allows access).
   *
   * Return-value semantics:
   * - `null`   → no policies applicable → caller applies no RLS filter.
   * - non-null → caller AND's it onto the existing where clause.
   * - {@link RLS_DENY_FILTER} → policies were defined but none could be
   *   compiled (e.g. wildcard `tenant_isolation` against a user with no
   *   active organization). The caller must treat this as "deny by
   *   default" — its `id` comparison naturally yields zero rows on
   *   select/update/delete, which is the safe fail-closed answer.
   */
  compileFilter(
    policies: RowLevelSecurityPolicy[],
    executionContext?: ExecutionContext,
    clause: 'using' | 'check' = 'using',
  ): Record<string, unknown> | null {
    if (policies.length === 0) return null;

    const userCtx: RLSUserContext = {
      id: executionContext?.userId,
      organization_id: executionContext?.tenantId,
      positions: executionContext?.positions,
      org_user_ids: (executionContext as any)?.org_user_ids,
      // Unique identifier — safe for ownership predicates (see RLSUserContext).
      email: (executionContext as any)?.email,
    };

    // §7.3.1 dynamic membership: the runtime pre-resolves arbitrary
    // set-membership (team members, territory accounts, shared records)
    // into `ExecutionContext.rlsMembership`. Merge each set under its key
    // so `field IN (current_user.<key>)` resolves without subquery support.
    // Arrays only; a missing/empty set still fails closed downstream.
    // We never let a membership key clobber the named fields above.
    const membership = (executionContext as any)?.rlsMembership;
    if (membership && typeof membership === 'object') {
      for (const [key, value] of Object.entries(membership)) {
        if (Array.isArray(value) && userCtx[key] === undefined) {
          userCtx[key] = value;
        }
      }
    }

    const filters: Record<string, unknown>[] = [];
    let applicable = 0;

    for (const policy of policies) {
      // [ADR-0058 D4] On a WRITE (check) pass, the post-image is validated against
      // the `check` clause, defaulting to `using` when omitted. Reads use `using`.
      const predicate = clause === 'check'
        ? ((policy as { check?: string }).check ?? policy.using)
        : policy.using;
      // A policy that carries no predicate for THIS clause (e.g. a check-only
      // policy on the `using` read pass) is not applicable here — skip it
      // WITHOUT counting it toward the fail-closed deny below.
      if (!predicate) continue;
      applicable++;
      const filter = this.compileExpression(predicate, userCtx);
      if (filter) {
        filters.push(filter);
      } else if (!isSupportedRlsExpression(predicate)) {
        // ADR-0056 D4: an UNSUPPORTED-SHAPE predicate (e.g. arithmetic, functions,
        // subqueries) compiles to nothing and would silently vanish, leaving the
        // object unprotected. Surface it instead of dropping in silence. (A
        // SUPPORTED shape that returned null is the intentional "context var
        // absent" path — it fails closed downstream and is not warned here.)
        this.logger?.warn?.(
          `[RLS] policy '${(policy as { name?: string }).name ?? '(unnamed)'}' on '${(policy as { object?: string }).object ?? '?'}' ` +
            `has an uncompilable predicate (${clause} clause) and was DROPPED (no enforcement): ${predicate}`,
        );
      }
    }

    // No policy carried a predicate for this clause → nothing to apply (NOT a
    // deny). e.g. a check-only policy seen on the `using` read pass.
    if (applicable === 0) return null;

    if (filters.length === 0) {
      // Policies *were* applicable but every one of them depended on a
      // `current_user.*` variable that wasn't populated (or used an
      // expression we couldn't compile). Fail closed — return a sentinel
      // filter that matches no rows. This prevents the "user without an
      // active org sees every tenant's data" class of bug.
      return RLS_DENY_FILTER;
    }
    if (filters.length === 1) return filters[0];

    // Multiple policies: OR-combine (any policy allows access)
    return { $or: filters };
  }

  /**
   * Compile a single RLS predicate into a query filter (ADR-0058 D1/D2).
   *
   * Delegates to the ONE canonical CEL → FilterCondition pushdown compiler in
   * `@objectstack/formula`, after bridging the legacy SQL-ish subset to CEL
   * ({@link sqlPredicateToCel}). `current_user.*` references resolve against the
   * pre-resolved {@link RLSUserContext} (incl. §7.3.1 membership sets). The
   * supported subset is now broader than the historical four forms — `==`/`!=`,
   * comparisons, `in`, `&&`/`||`/`!`, null checks and string ops all lower — but
   * the security contract is unchanged:
   *   - a non-pushdownable shape (subquery, arithmetic, cross-object, SQL `AND`)
   *     → `null` → {@link compileFilter} fails closed;
   *   - an unresolved/absent `current_user.*` variable → `null` → fail closed
   *     (the "no active organization" path);
   *   - an empty pre-resolved membership set → `null` so the single-policy case
   *     yields the deny sentinel upstream rather than a permissive `$in: []` —
   *     in EITHER polarity ([#13552]): under a supported `not in` the emptied
   *     set would otherwise compile to a constant-TRUE `$not`/`$in: []` clause,
   *     i.e. allow-all, the exact fail-open this guard exists to prevent.
   */
  compileExpression(
    expression: string,
    userCtx: RLSUserContext
  ): Record<string, unknown> | null {
    if (!expression) return null;
    // [ADR-0058 D1] CEL is canonical. The legacy SQL-ish form still compiles via
    // the transitional bridge, but we surface it so authored policies migrate to
    // CEL — the bridge will be removed once no stored predicate needs it.
    const cel = sqlPredicateToCel(expression);
    if (cel !== expression) {
      this.logger?.warn?.(
        `[RLS] DEPRECATED SQL-style predicate "${expression}" — author RLS using/check in ` +
          `canonical CEL (\`==\`, \`in\`). The SQL compatibility bridge is transitional.`,
      );
    }
    const result = compileCelToFilter(cel, {
      variables: { current_user: userCtx as Record<string, unknown> },
    });
    // Any fault — unsupported shape, parse error, or an unresolved/null
    // `current_user.*` variable — drops the policy. With a single applicable
    // policy this surfaces as RLS_DENY_FILTER upstream (fail closed).
    if (!result.ok) return null;
    // Parity: an empty pre-resolved membership (`field in current_user.<empty>`)
    // compiles to `{ field: { $in: [] } }`. The legacy compiler dropped the
    // policy in this case; preserve that so the deny sentinel (not a literal
    // empty-IN) is what the single-policy path returns. [#13552] The guard is
    // polarity-aware: the same emptied set under a supported `not in`
    // (`$not` wrapping, at any composition depth) is dropped too — otherwise
    // it inverts to a constant-TRUE clause and the policy compiles ALLOW-ALL.
    if (isEmptyMembershipFilter(result.filter as Record<string, unknown>)) return null;
    return result.filter as Record<string, unknown>;
  }

  /**
   * Get applicable RLS policies for a given object and operation.
   */
  getApplicablePolicies(
    objectName: string,
    operation: string,
    allPolicies: RowLevelSecurityPolicy[],
    /** [ADR-0090 P2] Caller's held positions — enforces the policy `positions` applicability domain (formerly an unenforced property; ADR-0049 enforce-or-remove). */
    heldPositions?: string[],
  ): RowLevelSecurityPolicy[] {
    // Map engine operation to RLS operation type
    const rlsOp = this.mapOperationToRLS(operation);

    return allPolicies.filter(policy => {
      // A policy switched off is not evaluated — the schema's exact promise
      // ("Disabled policies are not evaluated", RowLevelSecurityPolicySchema).
      // Formerly unread ANYWHERE: because applicable policies OR-combine (any
      // match allows access), a disabled policy kept contributing its grant —
      // an admin who switched off a too-permissive policy kept sharing the
      // rows. Same enforce-or-remove shape as `positions` below (ADR-0049).
      // Exact `=== false` on purpose: the schema defaults `enabled` to true,
      // and rows round-tripped through sys_permission_set may omit the key —
      // absent means active, only an explicit false disables.
      if ((policy as { enabled?: boolean }).enabled === false) return false;

      // Check object match
      if (policy.object !== objectName && policy.object !== '*') return false;

      // [ADR-0090 P2] Applicability domain: a policy that declares
      // `positions` applies only to callers holding one of them. With the
      // `everyone` anchor making the baseline set resolve for ALL
      // authenticated principals, this domain is what keeps a
      // members-only restriction (e.g. owner-scoped writes, #1985) from
      // handcuffing admins who resolve the baseline additively.
      const domain = (policy as { positions?: string[] }).positions;
      if (Array.isArray(domain) && domain.length > 0) {
        const held = heldPositions ?? [];
        if (!domain.some((d) => held.includes(d))) return false;
      }

      // Check operation match
      if (policy.operation === 'all') return true;
      if (policy.operation === rlsOp) return true;

      return false;
    });
  }

  private mapOperationToRLS(operation: string): string {
    switch (operation) {
      case 'find':
      case 'findOne':
      case 'count':
      case 'aggregate':
        return 'select';
      case 'insert':
        return 'insert';
      case 'update':
        return 'update';
      case 'delete':
        return 'delete';
      default:
        return 'select';
    }
  }
}
