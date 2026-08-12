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
 *   array is a real answer and means the opposite: nothing is readable. Its
 *   metadata-plane sibling {@link ISecurityService.getMetadataReadableFields}
 *   (ADR-0106 D7) reads the same two empty answers the same way.
 * - **Verdicts fail to ABSTENTION.** {@link ISecurityService.checkAuthoredRowWrite}
 *   answers a question a composing caller may use to WIDEN, so its failure mode
 *   is the one that changes nothing: `abstain`. It never reports `admit` for a
 *   reason it did not measure, and it never throws outward.
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
import type { PermissionSet } from '../security/permission.zod.js';

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
 * [#5493 / ADR-0105 D3] The two-state answer of
 * {@link ISecurityService.checkAuthoredRowWrite}.
 *
 * - `admit` — at least one **applicable, app-authored** row-level security
 *   policy matches this row for this operation. A positive, measured fact.
 * - `abstain` — everything else: no authored policy applies, none of the
 *   applicable ones matches the row, the probe could not be resolved, or the
 *   implementation declines to answer. **Never** a statement that the write is
 *   refused — this surface has no `deny` because it is not a gate.
 *
 * **Why only two states, and why the missing one is not `deny`.** Its sibling
 * `SharingWriteVerdict` (`./sharing-service.js`) is a *gate's* verdict, so it
 * needs `deny` to end a decision. This one is an *evidence*
 * probe: the caller already holds a refusal and is asking whether a declared,
 * app-authored widener speaks for this row before it fires. "No evidence" and
 * "evidence against" are the same instruction to that caller — keep your
 * refusal — so collapsing them removes a state nobody could act on differently.
 *
 * **`abstain` is the FAIL-CLOSED direction here, and that is the inverse of
 * `SharingWriteVerdict`'s.** There, a failed lookup must be `deny` because
 * `abstain` hands the decision on. Here the caller uses `admit` to WIDEN, so
 * the answer that changes nothing is `abstain`: a deployment whose security
 * service omits {@link ISecurityService.checkAuthoredRowWrite} entirely, or
 * whose probe throws, behaves byte-for-byte as one that never asked. Read
 * either verdict's fail direction off *what the caller does with it*, never off
 * the state's name.
 *
 * @see ISecurityService.checkAuthoredRowWrite
 */
export type AuthoredRowWriteVerdict = 'admit' | 'abstain';

/**
 * The row-level WRITE operations {@link ISecurityService.checkAuthoredRowWrite}
 * answers for — the RLS write vocabulary, not the engine's verb list.
 *
 * A caller holding a destructive lifecycle verb maps it onto its nearest write
 * class itself (`purge` destroys like `delete`; `transfer` / `restore` mutate
 * like `update`), which is the same mapping the engine's own by-id write
 * pre-image gate applies before it collects policies. Keeping the mapping on
 * the caller's side is deliberate: this contract then names exactly the two
 * classes an RLS policy can declare, and a new lifecycle verb cannot silently
 * acquire a widening path here by being spelled into a wider union.
 */
export type AuthoredRowWriteOperation = 'update' | 'delete';

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
   * [ADR-0106 D7] The METADATA-PLANE variant of {@link getReadableFields}:
   * which field names may be DISCLOSED to `context` when an object SCHEMA is
   * served, as opposed to which columns of a row it may read.
   *
   * Identical to {@link getReadableFields} in every respect but one — a caller
   * that resolves to **zero** permission sets goes through the same baseline
   * resolution `/auth/me/permissions` uses (`security.baselinePermissionSets`:
   * the app-declared baseline COMPOSED with the platform `member_default`,
   * #7555) instead of falling open to the full field set.
   *
   * **Why the two differ rather than converge.** `getReadableFields` mirrors the
   * engine middleware, which skips its whole field gate for a caller with no
   * permission sets; on the DATA plane, reporting a narrowing the enforcement
   * path would not apply is its own kind of drift, so falling open is the
   * correct, drift-free answer there. The metadata plane has no such symmetry to
   * preserve — the question is disclosure, and D7 rules that a public/guest
   * deployment's schema exposure must be a deliberate permission-set decision
   * rather than an accidental everything-default. It still falls open when the
   * fallback set itself resolves to nothing (no `member_default` in the
   * deployment at all): that is the "no FLS posture here" tier, not a restricted
   * caller.
   *
   * **Fails SOFT, with the same two distinct empty answers as
   * {@link getReadableFields}:** `undefined` is "no answer — use your own
   * fallback" (e.g. the object schema could not be resolved); `[]` is the real
   * answer that this caller may see NO field. A system context bypasses and
   * yields the full field set.
   *
   * **OPTIONAL, and absence is a defined state — not a bug.** A security service
   * that predates ADR-0106, or one that cannot honour the fallback resolution,
   * omits it; consumers feature-detect
   * (`typeof svc.getMetadataReadableFields === 'function'`) and fall back to
   * {@link getReadableFields}, which is the pre-ADR-0106 behaviour and never a
   * *narrower* answer. Declaring it optional is what makes that degradation a
   * property of the type rather than a promise in prose: the unguarded call does
   * not compile, so a consumer cannot skip the fallback by accident.
   *
   * The masking itself is gated separately by the deployment's D8 opt-outs
   * (`metadata.maskObjectFields: false`, `OS_ALLOW_UNMASKED_OBJECT_METADATA`);
   * this method only answers the projection question when a mask applies.
   */
  getMetadataReadableFields?(object: string, context?: SecurityContext): Promise<string[] | undefined>;

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
   * [#7616] The effective permission SETS for `context` — the same resolution
   * {@link resolvePermissionSetNames} reports the names of, returned WHOLE:
   * each set's `objects`, `fields`, `systemPermissions` and `tabPermissions`,
   * in resolution order.
   *
   * **Why a second method rather than a wider return on the first.** The names
   * are the primitive for an audience check ("does this caller hold
   * `sales_manager`?"); the sets are the primitive for a MERGE. A consumer that
   * must fold the caller's grants into one answer — the object/field access map
   * `/auth/me/permissions` serves, the capability + tab surface `/me/apps`
   * filters its app list with — cannot do it from names, so it re-implements
   * set resolution locally instead. That local copy is the drift this method
   * exists to end: the same rule has now diverged from the enforcement path
   * three times, each divergence found only after it reached a user (#7608 —
   * a member's first grant took them from 2 apps to 1; #7555 — an app-declared
   * `isDefault` displaced `member_default`; #6334 — grant aggregation missed
   * `sys_user_position` entirely).
   *
   * Implementations MUST return the sets their own enforcement path resolved —
   * positions expanded, the ADR-0090 D5 baseline applied ADDITIVELY (never as a
   * `resolved.length === 0` cliff), and the ADR-0090 D10 agent-principal rule
   * honoured — not a re-derivation. Widening this to "the sets, roughly" would
   * reintroduce the very drift the method removes.
   *
   * The merge semantics stay with the CALLER, deliberately: most-permissive for
   * `objects`/`fields`, union for `systemPermissions`, highest-rank-wins for
   * `tabPermissions`. Two consumers legitimately project different subsets of
   * the same sets, and folding a merge in here would make this method the
   * fourth copy of a rule instead of the one source of its input.
   *
   * **Throws** on resolution failure, exactly as {@link resolvePermissionSetNames}
   * does; callers must fail CLOSED on a throw rather than reading it as "no sets".
   *
   * **OPTIONAL, and absence is a defined state — not a bug.** A security service
   * that predates this method omits it, and a consumer resolving the service as
   * `Partial<ISecurityService>` (the availability rule at the top of this file)
   * must keep its own resolution as the fallback until a floor version carrying
   * the method can be assumed. Declaring it optional is what makes that
   * degradation a property of the type rather than a promise in prose: the
   * unguarded call does not compile, so a consumer cannot skip the fallback by
   * accident.
   */
  resolvePermissionSetsForContext?(context?: SecurityContext): Promise<PermissionSet[]>;

  /**
   * [#3544] Whether `context` may EXPORT `object` — the user-level export axis
   * (`ObjectPermissionSchema.allowExport`).
   *
   * Export is a READ-DERIVED operation (`export ⊆ list` in the spec's
   * `API_METHOD_DERIVATION`), so it reaches the engine middleware as an ordinary
   * `find` and is gated by `allowRead` alone. That makes the export axis
   * invisible to the middleware: without this method a caller holding
   * `allowExport: false` still streams the whole table out of the REST export
   * route, and the bit only ever hid a button. Bulk-egress doors must ask this
   * BEFORE they read.
   *
   * The answer folds the tri-state bit across the caller's resolved sets exactly
   * as the `/me/permissions` merge does — `true` beats `false` beats unset, and
   * unset inherits read — so the button the client hides and the request the
   * server refuses are the same decision.
   *
   * **Fails CLOSED.** This is an access-narrowing answer: implementations return
   * `false` (and callers must treat a throw as `false`) rather than degrading to
   * "allowed". A system context bypasses and returns `true`; so does a caller
   * with no resolved permission sets, mirroring the middleware, whose CRUD gate
   * is skipped entirely when set resolution comes back empty.
   */
  canExport(object: string, context?: SecurityContext): Promise<boolean>;

  /**
   * [ADR-0111 D2] Whether `context` holds the super-user WRITE bypass
   * (`modifyAllRecords`, "Modify All Data") for `object` — the EXPLICIT bit
   * only, resolved from the caller's permission sets exactly as the CRUD
   * middleware resolves them.
   *
   * The probe behind the sharing layer's management-authority gate
   * (`ISharingService.canManageShares`): a non-owner may manage shares on a
   * record only with this bypass. It deliberately does NOT reuse the effective
   * write SCOPE — `getEffectiveScope` returns `'org'` for the
   * "no permission set mentions this object" case (a compatibility fail-open on
   * the read path), which as a management gate would be a fresh hole.
   *
   * **Fails CLOSED.** A resolution failure, a principal-less context, or an
   * on-behalf-of context (the D10 delegator intersection is not computed on
   * this path) returns `false`. A system context returns `true`.
   */
  hasWriteBypass(object: string, context?: SecurityContext): Promise<boolean>;

  /**
   * [ADR-0111 D1 DEPTH] The caller's effective WRITE scope on `object` —
   * `own` / `own_and_reports` / `unit` / `unit_and_below` / `org` — resolved
   * from their permission sets exactly as the CRUD middleware's write path
   * resolves it (`getEffectiveScope('write', …)`).
   *
   * The sharing layer's management gate (`ISharingService.canManageShares`)
   * uses this to let a HIERARCHY MANAGER manage shares on records within their
   * DEPTH. Note the two meanings of `org`: a genuine `modifyAllRecords` holder,
   * AND the fail-OPEN "no permission set mentions this object" default — so a
   * caller of this method must treat `org` as authoritative ONLY when paired
   * with an explicit {@link hasWriteBypass} check, never on its own.
   *
   * **Fails CLOSED** to `own` (the narrowest scope) on a resolution error, a
   * principal-less context, or an on-behalf-of context (no D10 delegator
   * intersection on this path). A system context resolves to `org`.
   */
  resolveWriteScope(
    object: string,
    context?: SecurityContext,
  ): Promise<'own' | 'own_and_reports' | 'unit' | 'unit_and_below' | 'org'>;

  /**
   * [#5493 / ADR-0105 D3] Does an **app-authored** row-level security policy
   * admit `recordId` for `operation` — by declaration, on its own, without the
   * platform's ownership floor?
   *
   * The primitive a composing caller needs before it lets a *declared* widener
   * defer a hard refusal. `getReadFilter` cannot answer it and neither can any
   * composition of the other methods here, because every one of them reports
   * the **composed** RLS verdict, and sitting inside that composition is the
   * platform's own wildcard write floor (`created_by == current_user.id`,
   * shipped on the `member_default` baseline every authenticated member
   * resolves additively). Deferring to "the composed RLS admits this row" is
   * therefore not a cheaper spelling of this question — it is a measurably
   * different one, and the difference is a security hole:
   *
   * > #5493's probe E-A measured a **creator who is no longer the owner** —
   * > a record transferred away from them — being admitted by the platform
   * > floor while an authored policy said nothing about the row at all. A
   * > deferral keyed on the composed answer hands transferred records back to
   * > their former creators.
   *
   * Separating the two needs policy PROVENANCE (which policies the platform
   * shipped vs. which the app declared), and provenance is deliberately private
   * to the implementation — an authorable "this is a floor" flag would hand
   * authors a switch that turns their own policy off. Hence this method, and
   * hence it lives on the service rather than being re-derived by consumers.
   *
   * **`admit` iff** at least one applicable, **non-floor** policy matches the
   * row for this operation. `abstain` in **every** other case, including:
   * the caller holds no authored policy for `(object, operation)`; the
   * authored policies apply but none matches this row; the row is absent, or
   * in another tenant; the context carries no principal; the context
   * is on-behalf-of (ADR-0090 D10 — the delegator intersection is not computed
   * on this path, so an answer here would be resolved against the wrong
   * identity); or any internal probe fails.
   *
   * **[#7281] The caller's READ scope is not one of those cases**, and the
   * omission is the maintainer's 2026-08-10 ruling rather than an oversight.
   * The question is "does the declaration admit this row", which is about the
   * row and the policy; an implementation that resolves it through the
   * caller's own visibility folds a READ decision into a WRITE question and
   * silently answers `abstain` for every cross-owner row on a `private`-OWD
   * object — the posture the widener surface exists for (measured: two objects
   * identical but for their OWD, same widener, same principal, same row shape;
   * `public_read` → `admit`, `private` → `abstain`). Implementations therefore
   * resolve the row under a scope that can SEE it, with the tenant wall and
   * the authored predicate carried in the query rather than in the scope.
   * This does not widen anything: `admit` remains evidence and never
   * authorization (see below), so a caller who may not read a row still may
   * not write it — that refusal belongs to the write gate, which makes it on
   * its own terms.
   *
   * **Fail-closed by construction, in both halves.** The method itself never
   * throws outward — an internal failure becomes `abstain`. And the method is
   * OPTIONAL: a deployment whose security service predates it, or omits it,
   * behaves byte-for-byte as today, because a caller that cannot find it must
   * read the absence as `abstain` too. Callers therefore feature-detect
   * (`typeof svc.checkAuthoredRowWrite === 'function'`) and treat every
   * non-`admit` outcome identically.
   *
   * **This is evidence, not authorization.** `admit` says a declared policy
   * speaks for this row; it does NOT say the write is permitted — object-level
   * CRUD, the tenant wall, sharing, and the post-image `check` clause all still
   * apply, and the caller composes this answer with them rather than replacing
   * them. Nothing here may be used to *narrow*: `abstain` is "no evidence",
   * never "denied".
   */
  checkAuthoredRowWrite?(
    object: string,
    recordId: string,
    operation: AuthoredRowWriteOperation,
    context?: SecurityContext,
  ): Promise<AuthoredRowWriteVerdict>;

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
