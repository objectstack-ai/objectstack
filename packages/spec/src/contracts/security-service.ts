// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @objectstack/spec/contracts/security-service
 *
 * Cross-package contract for the `security` service — the query surface that
 * lets code OUTSIDE the ObjectQL engine middleware ask the same questions the
 * middleware answers when it enforces access.
 *
 * The point of this surface is **non-drift**. Every method here is required to
 * be computed from the SAME resolution the enforcement path uses (permission-set
 * resolution → evaluator → RLS compiler / FieldMasker). A consumer that
 * re-derives any of these answers locally — by reading permission sets itself,
 * or by inferring them from already-enforced output — will drift the moment the
 * enforcement path changes. Ask this service instead.
 *
 * Registered under the service name `security` by `@objectstack/plugin-security`
 * (`ctx.registerService('security', …)`), which is also the reference
 * implementation. Related lower-level handles the same plugin registers —
 * `security.permissions`, `security.rls`, `security.fieldMasker` — are
 * implementation internals and deliberately NOT part of this contract.
 *
 * ## Two failure stances, and how to tell which applies
 *
 * The methods here do NOT share a single failure convention, because they do
 * not carry the same risk. Read each method's doc before choosing a fallback:
 *
 * - **Access-narrowing answers fail CLOSED.** {@link ISecurityService.getReadFilter}
 *   answers "which rows may this caller see"; a resolution failure returns a
 *   DENY filter (zero rows), never `undefined`. A consumer must never treat a
 *   thrown error or a deny filter as "no restriction".
 * - **Advisory projections fail SOFT, explicitly.** {@link ISecurityService.getReadableFields}
 *   answers "which columns may this caller see" for presentation purposes; when
 *   the object schema cannot be resolved it returns `undefined`, meaning
 *   "no answer — use your own fallback", NOT "no fields are readable". An empty
 *   array is a real answer and means the opposite: nothing is readable.
 *
 * That distinction is load-bearing: the field projection is only ever a
 * cosmetic narrowing on top of enforcement that already happened (the read path
 * has already deleted unreadable keys from the data), so degrading to a wider
 * column set cannot leak VALUES. A row filter has no such backstop.
 *
 * ## Availability
 *
 * The service is absent in deployments without `plugin-security`, and a kernel
 * may resolve it per environment. Consumers MUST tolerate absence — resolve it
 * defensively and keep a fallback path — rather than assume registration.
 */

import type { FilterCondition } from '../data/filter.zod.js';
import type { ExecutionContext } from '../kernel/execution-context.zod.js';
import type { ExplainDecision, ExplainOperation } from '../security/explain.zod.js';

/**
 * The context shape these methods accept.
 *
 * Callers routinely hold only part of a full {@link ExecutionContext} (a REST
 * route may have `{ userId, permissions }`; a platform-internal writer may have
 * only `{ isSystem: true }`), so every field is optional. Implementations read
 * `positions` / `permissions` for set resolution, `isSystem` as a full bypass,
 * `principalKind` to distinguish agent principals, and `onBehalfOf` for
 * delegated (on-behalf-of) access.
 */
export type SecurityContext = Partial<ExecutionContext>;

/**
 * [ADR-0090 D12 / ADR-0105 D8] One `adminScope` the caller holds, with its
 * business-unit subtree resolved to ids.
 */
export interface DelegableAdminScope {
  /** Permission set carrying the scope (for attribution in a UI). */
  setName: string;
  /** `sys_business_unit.name` of the delegation root. */
  businessUnit: string;
  includeSubtree: boolean;
  manageAssignments: boolean;
  manageBindings: boolean;
  authorEnvironmentSets: boolean;
  /** Permission-set names the delegate may hand out. */
  assignablePermissionSets: string[];
  /** Resolved subtree — root plus descendants when `includeSubtree`. */
  businessUnitIds: string[];
}

/** Return shape of {@link ISecurityService.describeDelegableScope}. */
export interface DelegableScope {
  /**
   * ADR-0066 superuser wildcard: the caller is unconstrained. The lists below
   * then enumerate everything, so a consumer renders ONE uniform picker
   * instead of special-casing tenant admins.
   */
  isTenantAdmin: boolean;
  /** Every held `adminScope`, resolved. Empty for a tenant admin (nothing narrows them). */
  scopes: DelegableAdminScope[];
  /** Union of subtrees where the caller may PLACE people (`manageAssignments`). */
  placeableBusinessUnitIds: string[];
  /** Positions the caller may assign — every set they distribute is allowlisted. */
  assignablePositions: string[];
}

/** Selector for {@link ISecurityService.explain}. */
export interface ExplainAccessRequest {
  /** Object API name to explain access for. */
  object: string;
  /** Operation being explained (`read`, `create`, `update`, `delete`, …). */
  operation: ExplainOperation | string;
  /**
   * Explain access for ANOTHER user. Omit to explain the caller's own access;
   * naming a different user is an administrative action and implementations are
   * expected to gate it (the reference implementation requires `manage_users`).
   */
  userId?: string;
  /** Narrow the explanation to a single record (adds record-level layers). */
  recordId?: string;
}

/** Filter accepted by the audience-binding suggestion list. */
export interface AudienceBindingSuggestionFilter {
  status?: 'pending' | 'confirmed' | 'dismissed';
  packageId?: string;
}

/**
 * Counters from the implicit re-sync the list call performs before reading.
 * Surfaced so an admin UI can report what changed underneath the list.
 */
export interface AudienceBindingSuggestionSync {
  created: number;
  confirmedObserved: number;
  pruned: number;
}

/**
 * A suggestion row as stored. The column set is owned by the implementation's
 * backing object rather than this contract, so it stays open — consumers should
 * read the fields they know (`id`, `status`, `package_id`) and pass the rest
 * through.
 */
export type AudienceBindingSuggestion = Record<string, unknown>;

/**
 * Public contract for the `security` service.
 *
 * Every method is expected to be derived from the same permission-set
 * resolution the enforcement path uses. Implementations that cannot honour a
 * method should omit it rather than answer approximately — consumers feature-
 * detect (`typeof svc.getReadableFields === 'function'`) precisely so a partial
 * implementation degrades instead of lying.
 */
export interface ISecurityService {
  /**
   * The row-level READ scope for `object` under `context` — the same filter the
   * engine middleware AND-s into every find, exposed for paths that bypass the
   * middleware (notably the analytics raw-SQL path, which must apply it to the
   * base object AND every joined object).
   *
   * **Fails CLOSED.** A resolution failure, or an on-behalf-of context on a path
   * that cannot compute the delegator intersection, returns a DENY filter that
   * matches zero rows — never `undefined`. `undefined` means one thing only:
   * this caller has no row restriction on this object.
   */
  getReadFilter(object: string, context?: SecurityContext): Promise<FilterCondition | undefined>;

  /**
   * The field names `context` may READ on `object` — the authoritative column
   * projection for anything that must present "the columns list shows", such as
   * a read-derived export header.
   *
   * Computed from schema + context, never from data rows: it is therefore immune
   * to an all-null column (which a driver may omit from every row) and to an
   * empty result set. The returned set is the exact complement of what the read
   * path's field mask deletes, so a header built from it cannot drift from the
   * values the same caller receives.
   *
   * **Fails SOFT, and the two empty answers are NOT the same:**
   * - `undefined` — no answer (e.g. the object schema could not be resolved).
   *   Fall back to your own projection.
   * - `[]` — a real answer: this caller may read NO field of this object.
   *
   * A system context bypasses field-level security and yields the full field set.
   */
  getReadableFields(object: string, context?: SecurityContext): Promise<string[] | undefined>;

  /**
   * The effective permission-set NAMES for `context` — positions expanded and
   * the additive baseline applied, i.e. the same set the middleware enforces
   * with. The primitive for evaluating a permission-set-gated audience without
   * re-implementing set resolution.
   *
   * **Throws** on resolution failure; callers must fail CLOSED on a throw rather
   * than treating it as "no sets".
   */
  resolvePermissionSetNames(context?: SecurityContext): Promise<string[]>;

  /**
   * Explain WHY access is granted or denied — the decision plus the layers that
   * produced it (permission sets, object permissions, RLS, sharing, field mask).
   *
   * Runs the same resolution/evaluator/compiler the enforcement path uses, so
   * the explanation matches enforcement by construction rather than by
   * maintenance.
   */
  explain(request: ExplainAccessRequest, callerContext?: SecurityContext): Promise<ExplainDecision>;

  /**
   * [ADR-0090 D12 / ADR-0105 D8] Describe what the CALLER may delegate: the
   * business units they may place people into and the positions they may
   * assign, derived from the `adminScope`s their permission sets carry.
   *
   * The read half of the delegated-administration gate, and shaped for a
   * picker: a scoped-invitation form narrows its options with this instead of
   * offering the whole tree and letting the user discover the boundary by
   * being refused. Computed by the same helpers the write gate enforces with,
   * so an option this reports is one the gate accepts — it NARROWS, it does
   * not decide.
   *
   * Strictly self-scoped: there is no target-user parameter, so it discloses
   * nothing beyond the authority the caller already holds. Fail-closed —
   * unresolvable scopes contribute nothing, and no delegated authority yields
   * empty lists.
   */
  describeDelegableScope(callerContext?: SecurityContext): Promise<DelegableScope>;

  /**
   * List install-time audience-binding suggestions (packages propose an
   * audience anchor; a tenant admin confirms or dismisses). Re-syncs before
   * reading and reports what that sync changed.
   *
   * Administrative: implementations gate this on tenant-admin and throw
   * otherwise.
   */
  listAudienceBindingSuggestions(
    callerContext?: SecurityContext,
    filter?: AudienceBindingSuggestionFilter,
  ): Promise<{ suggestions: AudienceBindingSuggestion[]; synced: AudienceBindingSuggestionSync }>;

  /**
   * Confirm a pending suggestion — writes the binding under the anchor and
   * delegated-admin gates. Throws when the suggestion is unknown or no longer
   * pending. `bindingCreated` is `false` when the binding already existed.
   */
  confirmAudienceBindingSuggestion(
    callerContext: SecurityContext,
    id: string,
  ): Promise<{ suggestion: AudienceBindingSuggestion; bindingCreated: boolean }>;

  /** Dismiss a pending suggestion. Throws when it is unknown or not pending. */
  dismissAudienceBindingSuggestion(
    callerContext: SecurityContext,
    id: string,
  ): Promise<{ suggestion: AudienceBindingSuggestion }>;
}
