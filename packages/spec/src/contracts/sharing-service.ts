// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @objectstack/spec/contracts/sharing-service
 *
 * Cross-package contract for record-level sharing enforcement.
 *
 * Two concerns live behind this interface:
 *
 *   1. **Filter contribution** — `buildReadFilter()` returns a
 *      `FilterCondition` (or `null` for "no restriction") that the
 *      engine middleware AND-s into every read query. Callers must
 *      treat `null` as "object is public, do not filter".
 *
 *   2. **Per-record gating** — two SEPARATE gates, one per write verb.
 *      `canEdit()` answers the access question for `update`: ownership
 *      (widened by write DEPTH), a write-level (`edit`) share, or the
 *      `modifyAllRecords` super-user bypass. `canDelete()` answers it
 *      for `delete` and is deliberately NARROWER (ADR-0111 D3) — a
 *      share widens which ROWS a principal reaches, never which VERBS
 *      they may use, so an `edit` share does NOT confer delete:
 *      ownership or the bypass only.
 *
 *      [#6428] Each gate has TWO forms, and the difference matters to
 *      anyone COMPOSING this answer with another authority's.
 *      `checkEdit()` / `checkDelete()` are the primary form and answer a
 *      tri-state {@link SharingWriteVerdict} — `allow` (a positive basis
 *      to permit), `abstain` (this service does not enforce on this row
 *      at all), `deny` (refused). `canEdit()` / `canDelete()` are the
 *      two-state PROJECTION every pre-existing caller already reads:
 *      `true` for anything that is not a `deny`, so their truth table is
 *      byte-for-byte what it has always been. Read the tri-state whenever
 *      an `abstain` must NOT be mistaken for permission — see
 *      {@link SharingWriteVerdict} for the measured fail-open that
 *      collapsing the two into one `true` produced (#5492 E2).
 *
 *   3. **Enforcement runs on the FULL envelope.** Every method on both
 *      interfaces below adjudicates access, so each takes a complete
 *      {@link ExecutionContext} — the whole `resolveAuthzContext` result,
 *      threaded through unchanged — rather than a per-site subset (#6523,
 *      applying the #6206 ruling). The six-field shape those parameters used
 *      to name (`SharingExecutionContext`, exported from here until #7218
 *      retired it) omitted `accessible_org_ids` (under the `group` tenancy
 *      posture this IS the Layer 0 wall, ADR-0105 D2), `org_user_ids`,
 *      `posture` (ADR-0095 D2) and `tabPermissions` — so an implementation
 *      could not READ what it had been handed without casting out of its own
 *      contract (the measured specimen: `const posture = (context as
 *      any).posture` in `plugin-approvals`' privileged-override gate).
 *
 *      ⛔ **tsc cannot police this, and no pin should pretend otherwise.**
 *      Structural subtyping makes a six-field context assignable to
 *      {@link ExecutionContext} — every field exists there with a compatible
 *      type and nothing in the wider type is required — so re-narrowing a
 *      parameter still COMPILES, and an `@ts-expect-error` asserting the
 *      reverse would be unsatisfied and fail the build. What holds the line is
 *      the declared parameter type here (any narrowing becomes visible AT THE
 *      CALL SITE) plus the type-identity pins in
 *      `sharing-service.test.ts` and the three `exec-context-annotation.pin.ts`
 *      files in `plugin-sharing` / `plugin-approvals` / `plugin-reports`.
 *
 * Manual share CRUD is exposed via `grant()`, `revoke()`, and
 * `listShares()`. The REST layer wires these to
 * `/data/:object/:id/shares`.
 *
 * The default implementation lives in `@objectstack/plugin-sharing`.
 */

// Type-only: `HierarchyScopeContext.posture` names the ADR-0105 D1 vocabulary
// rather than restating it, so the contract and the wall it defers to cannot
// drift apart (#6139). Erased at compile time, so this module stays the pure
// type-declaration surface it has always been — no runtime coupling added.
import type { TenancyPosture } from '../security/tenancy-posture';
// Type-only: the full `resolveAuthzContext` envelope. Every enforcement method
// on {@link ISharingService} and {@link ISharingRuleService} declares its
// context parameter as this type (#6523, applying the #6206 ruling default —
// no per-site subset contracts). See item 3 of the module doc above for the
// boundary that draws and why.
import type { ExecutionContext } from '../kernel/execution-context.zod.js';

/**
 * Recipient categories a `sys_record_share` ROW may carry — mirrors the
 * `recipient_type` select on `SysRecordShare`
 * (`@objectstack/plugin-sharing`), which is the storage-side gate on what a
 * row can actually contain. Only `user` is enforced (and written) today:
 * {@link ISharingService.grant} refuses every other value rather than
 * persisting it inert (ADR-0078), and the rule evaluator materialises grants
 * as expanded `user` rows. The remaining members are persisted-for-forward-
 * compatibility vocabulary, kept in lockstep with the select.
 *
 * NOT the sharing-RULE recipient vocabulary — that is
 * {@link SharingRuleRecipientType} here, whose authorable subset is
 * `ShareRecipientType` in `spec/security` (a different concept that shares
 * no declaration with this one).
 */
export type RecordShareRecipientType =
  | 'user'
  | 'group'
  | 'position'
  | 'unit_and_subordinates'
  | 'guest';

/**
 * Access level on a single record — the authorable subset, mirroring
 * `SharingLevel` in spec/security.
 *
 * `full` ("Full Access (Transfer, Share, Delete)") was REMOVED: no code path
 * ever granted transfer / re-share / delete because of it, so it was
 * byte-equivalent to `edit` while telling admins otherwise (ADR-0078; #3865).
 * Stored `'full'` rows are normalised to `'edit'` by the sharing plugin
 * (grant-time + a boot backfill) and remain honoured by the read/write gates
 * meanwhile, so widening this type back is never needed for compatibility.
 */
export type ShareAccessLevel = 'read' | 'edit';

/** Why a share row exists (used by the rule evaluator to reconcile). */
export type ShareSource = 'manual' | 'rule' | 'team' | 'inherited';

/** Single row from `sys_record_share` projected for cross-package callers. */
export interface RecordShare {
  id: string;
  object_name: string;
  record_id: string;
  recipient_type: RecordShareRecipientType;
  recipient_id: string;
  access_level: ShareAccessLevel;
  source: ShareSource;
  source_id?: string;
  granted_by?: string;
  reason?: string;
  created_at?: string;
  updated_at?: string;
}

/** Input for `ISharingService.grant`. */
export interface GrantShareInput {
  object: string;
  recordId: string;
  recipientType?: RecordShareRecipientType;
  recipientId: string;
  accessLevel?: ShareAccessLevel;
  source?: ShareSource;
  sourceId?: string;
  reason?: string;
}

/**
 * [#6428] The verdict a per-record WRITE gate returns. THREE states, because
 * two cannot say what this service actually knows:
 *
 * - **`allow`** — a POSITIVE basis to permit the write exists: ownership
 *   (widened by write DEPTH), an `edit`-level `sys_record_share` row (update
 *   only — ADR-0111 D3), the `modifyAllRecords` super-user bypass, or a system
 *   context.
 * - **`abstain`** — this service has NO OPINION about this row, because record
 *   sharing does not enforce on it at all: a `public` sharing model, an object
 *   with no owner field, a bypass-listed platform internal, an object this
 *   engine has no schema for. **Not a permission.** Whatever other authority
 *   guards the row still decides, and a caller that has no other authority to
 *   consult may treat it as "nothing here stops you" — which is exactly what
 *   {@link ISharingService.canEdit}'s `true` has always meant.
 * - **`deny`** — this service REFUSES: the object IS sharing-enforced and the
 *   principal has no ownership, no write-level share and no bypass — or the
 *   answer could not be resolved at all.
 *
 * **Why the third state exists (measured, not theoretical).** Collapsing
 * `allow` and `abstain` into one `true` is safe for a caller that only ADDS a
 * gate (the sharing middleware reads `true` as "I do not stop you") and unsafe
 * for a caller that lets this verdict OVERRIDE another authority's floor.
 * #5492's experiment E2 delegated a pre-image write gate to `canEdit()` and an
 * ordinary member's cross-creator UPDATE became `ok: true` on objects with **no
 * `owner_id` column** — where `main` answers 403 — because the platform's
 * `created_by` ownership floor is the only row-level write gate such objects
 * have, and an abstaining `true` overrode it.
 *
 * **A resolution failure is `deny`, never `abstain`.** The two are opposite
 * instructions to a composing caller: `abstain` hands the decision on, `deny`
 * ends it. Reading a failed lookup as "no opinion" is precisely the confusion
 * that produced that fail-open, so an implementation that cannot answer must
 * refuse rather than step aside.
 */
export type SharingWriteVerdict = 'allow' | 'abstain' | 'deny';

/**
 * Public contract.
 *
 * Implementations should treat `context.isSystem === true` as a
 * complete bypass (no filter, every write gate answers `allow` / `true`) so
 * that platform-internal writers (audit, migrations, the sharing plugin
 * itself) cannot deadlock on their own enforcement.
 *
 * ## The context every method takes (#6523, #6206 ruling)
 *
 * `context` is the complete {@link ExecutionContext} — the caller's whole
 * `resolveAuthzContext` envelope, passed through unchanged. Callers MUST NOT
 * rebuild a subset of it, and implementations may read ALL of it:
 * `accessible_org_ids` (the `group`-posture Layer 0 wall, ADR-0105 D2),
 * `org_user_ids`, `systemPermissions`, `posture` (ADR-0095 D2) and
 * `tabPermissions` included. Which of those a deployment makes load-bearing
 * depends on its tenancy posture, which the caller cannot know.
 *
 * ## Write DEPTH is an input the CALLER supplies — absent means `own` (#7144)
 *
 * The write gates below widen ownership "by write DEPTH" (ADR-0057 D1: `own` /
 * `own_and_reports` / `unit` / `unit_and_below` / `org`). That depth is NOT a
 * field of {@link ExecutionContext}, and this service never derives it: the
 * CRUD middleware resolves it for the object of the operation IN FLIGHT and
 * stamps it on the operation context as an operation-private (`__`-prefixed)
 * key, which the default implementation's owner-match reads. A caller that is
 * not that middleware hands over no depth, and the owner-match then runs at its
 * NARROWEST — owner-only, i.e. `own`.
 *
 * **For the PARENT-record gates that is deliberate, not an oversight.** The
 * `sys_comment` gates (`@objectstack/plugin-audit`) and the `sys_attachment`
 * kit (`@objectstack/service-storage`) ask this service about the PARENT
 * record's object while the operation in flight is on the CHILD, so the stamped
 * depth was resolved for a different object and is dropped rather than carried
 * across. Stated as behaviour: a caller whose write depth on the parent object
 * is `unit` / `unit_and_below` / `org` can edit that parent directly through
 * the CRUD path, and is REFUSED when editing or deleting a comment or
 * attachment on it. The divergence runs in the RESTRICTIVE direction —
 * refusals, never a leak — and the maintainer ruling of 2026-08-10 (#7144,
 * split from #7141 / PR #7143) is that these gates STAY at `own`.
 *
 * **Why the obvious "fix" is off the table** — recorded here so the next reader
 * can tell "deliberately tighter" from "nobody got round to it". Making these
 * gates inherit the parent's real edit authority means resolving the parent's
 * depth through the only tool a package outside `plugin-security` has,
 * `ISecurityService.resolveWriteScope` — and that fails OPEN on one input:
 * `getEffectiveScope` returns `'org'` when NO permission set mentions the
 * object at all (`plugin-security/src/permission-evaluator.ts` —
 * `if (!matched) return 'org'`), which is byte-identical to what a genuine
 * `modifyAllRecords` holder gets. That is why the method's own doc block calls
 * `'org'` authoritative ONLY when paired with an explicit
 * `ISecurityService.hasWriteBypass` check. Handed to a write gate as the depth
 * it becomes fully authoritative on its own, and the owner-match short-exits
 * `true` for EVERY owned row of an unmatched object — a real widening, not a
 * theoretical one. So inheriting the parent's depth starts with a depth
 * primitive that can tell "org depth" from "nothing matched", never with these
 * gates.
 */
export interface ISharingService {
  /**
   * Return a filter condition that restricts a `find` to rows the
   * principal in `context` can see for `object`. Return `null` when no
   * restriction applies (public object, system context, no userId).
   */
  buildReadFilter(
    object: string,
    context: ExecutionContext,
  ): Promise<unknown | null>;

  /**
   * [#6428] The UPDATE gate, in its primary tri-state form: may the principal
   * in `context` UPDATE the record `(object, recordId)`, and does this service
   * have an opinion at all?
   *
   * - `allow` — ownership (widened by write DEPTH), a write-level
   *   ({@link ShareAccessLevel} `edit`) share, [#4647] the `modifyAllRecords`
   *   super-user bypass, or a system context.
   * - `abstain` — record sharing does not enforce on this row: a `public`
   *   object, an object with **no owner field**, a bypass-listed platform
   *   internal, or an object with no resolvable schema. The answer belongs to
   *   whatever else guards the row (see {@link SharingWriteVerdict}).
   * - `deny` — a sharing-enforced object where the principal has none of the
   *   above, a principal-less context, or an unresolvable answer.
   *
   * The bypass is the same `ISecurityService.hasWriteBypass` predicate
   * {@link canDelete} and {@link canManageShares} consult, so the three write
   * gates cannot drift from each other or from what `security/explain`
   * reports. It is asked LAST — after ownership and shares — so an ordinary
   * write costs no extra resolution, and it **fails CLOSED** (ADR-0111 D2):
   * no security service, a throwing probe, or a principal-less /
   * on-behalf-of context leaves the answer at owner-plus-share only.
   *
   * **Fail-closed, restated because the tri-state is where it gets confused:**
   * a lookup that throws is a `deny`, never an `abstain`.
   */
  checkEdit(
    object: string,
    recordId: string,
    context: ExecutionContext,
  ): Promise<SharingWriteVerdict>;

  /**
   * Return `true` when the principal in `context` may UPDATE the record
   * `(object, recordId)`. Ownership (widened by write DEPTH), a write-level
   * ({@link ShareAccessLevel} `edit`) share, OR — [#4647] — the
   * `modifyAllRecords` super-user bypass. Always true for system context,
   * `public` objects, and objects with no owner field.
   *
   * [#7144] The write DEPTH in that first sentence is an INPUT this service is
   * handed, never one it resolves — so a caller outside the CRUD middleware
   * (the `sys_comment` and `sys_attachment` PARENT-record gates, which both
   * reach this service through this method) matches ownership at `own`. That is
   * the ruled shape, and the fail-open that blocks widening it is written up
   * once in "Write DEPTH is an input the CALLER supplies" on this interface.
   *
   * [#6428] The two-state PROJECTION of {@link checkEdit}: `true` for every
   * verdict that is not `deny`, i.e. `allow` and `abstain` alike. That
   * collapse is the historical semantics, kept byte-for-byte so existing
   * callers do not drift — it is correct for a caller that only ADDS this gate
   * to whatever else already guards the row (the sharing middleware, the
   * `sys_attachment` parent gate, the ADR-0055 master check), and WRONG for a
   * caller that would let this answer override another authority's floor. The
   * latter must read {@link checkEdit}.
   */
  canEdit(
    object: string,
    recordId: string,
    context: ExecutionContext,
  ): Promise<boolean>;

  /**
   * [#6428 / ADR-0111 D3] The DELETE gate, in its primary tri-state form.
   *
   * The verb boundary is inherited, not restated: a share widens *which rows*
   * a principal reaches, never *which verbs* they may use, so an `edit` share
   * that makes {@link checkEdit} answer `allow` leaves this one at `deny`
   * (Salesforce Read/Write cannot delete; Dataverse `Delete` is a distinct
   * privilege; Odoo splits `write`/`unlink`). `allow` is ownership (widened by
   * write DEPTH), the `modifyAllRecords` super-user bypass, or system context
   * ONLY; `abstain` covers exactly the rows {@link checkEdit} abstains on, so
   * the two gates agree about which objects sharing enforces on and disagree
   * only about the verb.
   */
  checkDelete(
    object: string,
    recordId: string,
    context: ExecutionContext,
  ): Promise<SharingWriteVerdict>;

  /**
   * [ADR-0111 D3] Return `true` when the principal in `context` may DELETE the
   * record `(object, recordId)`.
   *
   * The verb boundary: a share widens *which rows* a principal reaches, never
   * *which verbs* they may use — so delete is **ownership (widened by write
   * DEPTH) or the `modifyAllRecords` super-user bypass ONLY**, and an `edit`
   * share does NOT confer it (Salesforce Read/Write cannot delete; Dataverse
   * `Delete` is a distinct privilege; Odoo splits `write`/`unlink`). Always
   * true for system context, `public` objects, and objects with no owner
   * field, matching {@link canEdit}. A per-record delete grant, if ever added,
   * is a capability mask AND-ed with object CRUD — not a share level.
   *
   * [#6428] The two-state PROJECTION of {@link checkDelete}, on the same rule
   * as {@link canEdit}: `true` for everything that is not a `deny`.
   */
  canDelete(
    object: string,
    recordId: string,
    context: ExecutionContext,
  ): Promise<boolean>;

  /**
   * [ADR-0111 D1] May the principal in `context` MANAGE shares (grant / revoke
   * / list) on `(object, recordId)`? True for system context, the record's
   * owner, and holders of the super-user write bypass (`modifyAllRecords`,
   * probed via the late-bound security service). **Fails closed**: no security
   * service → owner-only; unknown record / principal-less context → `false`.
   *
   * This is the single gate every manual share-management operation consults —
   * enforcement lives in the SERVICE, so every caller (REST or otherwise) is
   * covered. The DEPTH extension (hierarchy managers) is a named ADR-0111
   * direction, not implemented here.
   */
  canManageShares(
    object: string,
    recordId: string,
    context: ExecutionContext,
  ): Promise<boolean>;

  /**
   * Create or upsert a manual share row.
   *
   * [ADR-0111 D1/D7] For non-system callers: requires {@link canManageShares}
   * (`PERMISSION_DENIED`), an existing record VISIBLE to the caller
   * (`NOT_FOUND` — missing and invisible are indistinguishable), a `user`
   * recipient (`VALIDATION_FAILED` — other recipient types are not enforced by
   * any gate and are refused rather than persisted inert, ADR-0078), and an
   * object in an enforcing sharing posture (`SHARING_NOT_ENABLED` — a share on
   * a public / bypass / owner-less / `controlled_by_parent` object enforces
   * nothing). Upserts match on `(object, record, recipient, source)` so a
   * manual grant never clobbers a rule-materialised row (D7).
   */
  grant(input: GrantShareInput, context: ExecutionContext): Promise<RecordShare>;

  /**
   * Remove a share row by id.
   *
   * [ADR-0111 D4] For non-system callers: the row must exist and — when
   * `scope` is provided (REST passes the URL's object/record) — belong to that
   * record (`NOT_FOUND` otherwise), the caller must hold
   * {@link canManageShares} on the record (`PERMISSION_DENIED` — revoke is
   * symmetric with grant, no granter exception), and only `source: 'manual'`
   * rows are revocable (`CONFLICT` — rule-derived grants are reconciled back
   * by the evaluator; deactivate the rule instead). System context keeps the
   * historical delete-by-id no-op-when-missing behaviour (the rule evaluator's
   * reconciliation path).
   */
  revoke(
    shareId: string,
    context: ExecutionContext,
    scope?: { object: string; recordId: string },
  ): Promise<void>;

  /**
   * List all share rows attached to `(object, recordId)`.
   *
   * [ADR-0111 D5] For non-system callers this is MANAGEMENT-gated: an
   * invisible/missing record throws `NOT_FOUND`, a visible record without
   * {@link canManageShares} throws `PERMISSION_DENIED`. "What is shared with
   * me / by me" is served by the self-scoped `sys_record_share` read surface,
   * not by this method.
   */
  listShares(
    object: string,
    recordId: string,
    context: ExecutionContext,
  ): Promise<RecordShare[]>;
}

// ─────────────────────────────────────────────────────────────────────
// SharingRuleService — declarative criteria-based sharing
// (Salesforce-style "any record matching X is shared with team Y").
// ─────────────────────────────────────────────────────────────────────

/**
 * Kinds of principals a rule can target.
 *
 * - `user`       — a specific user id (no expansion)
 * - `team`       — a flat collaboration team (`sys_team` + `sys_team_member`)
 * - `department` — an org-skeleton node (`sys_business_unit` + descendants via
 *                  `parent_business_unit_id` + members from `sys_business_unit_member`)
 * - `role`       — tenant role on `sys_member.role`
 * - `queue`      — opaque queue identifier (resolution left to caller / app)
 */
export type SharingRuleRecipientType = 'user' | 'team' | 'business_unit' | 'position' | 'unit_and_subordinates' | 'queue';

/**
 * Stored shape of a sharing rule. Maps 1-to-1 to `sys_sharing_rule`
 * with `criteria` lifted out of the JSON column.
 */
export interface SharingRuleRow {
  id: string;
  organization_id?: string | null;
  name: string;
  label: string;
  description?: string | null;
  object_name: string;
  /**
   * Engine-compatible FilterCondition. `undefined`/`null` matches every
   * row of `object_name` (use with care — typically scoped via teams).
   */
  criteria?: unknown;
  recipient_type: SharingRuleRecipientType;
  recipient_id: string;
  access_level: ShareAccessLevel;
  active: boolean;
  /**
   * [#2909 P0] Record provenance — unified A4 tri-state
   * (`platform` / `package` / `admin`). Package/platform rows are boot-seeded
   * and become seed-not-clobber once `customized` is set; admin rows are
   * tenant-authored and never touched by the seeder.
   */
  managed_by?: 'platform' | 'package' | 'admin' | null;
  /**
   * [#2909 T1] Stamped when an admin edits a package/platform-seeded rule;
   * the boot seeder then stops overwriting the row (an admin's
   * `active: false` survives redeploys instead of being resurrected).
   */
  customized?: boolean | null;
  created_at?: string;
  updated_at?: string;
}

/** Input to {@link ISharingRuleService.defineRule}. */
export interface DefineSharingRuleInput {
  name: string;
  label: string;
  description?: string;
  object: string;
  criteria?: unknown;
  recipientType: SharingRuleRecipientType;
  recipientId: string;
  accessLevel?: ShareAccessLevel;
  active?: boolean;
  /**
   * [#2909 P0] Provenance to stamp on the row. Passing `package` or
   * `platform` puts defineRule in SEED mode: existing rows that an admin
   * authored (managed_by `admin`) or customized are left untouched;
   * pristine seeded rows keep receiving declared updates. Omitted /
   * `admin` = programmatic/tenant authoring (existing clobber semantics).
   */
  managedBy?: 'platform' | 'package' | 'admin';
}

/** Result of a rule evaluation pass. */
export interface SharingRuleEvaluationResult {
  ruleId: string;
  matchedRecords: number;
  expandedUsers: number;
  grantsCreated: number;
  grantsUpdated: number;
  grantsRevoked: number;
}

/**
 * Declarative sharing rules. The evaluator materialises grants into
 * `sys_record_share` with `source='rule'` and `source_id=rule.id` so
 * stale grants from a rule update can be reconciled without touching
 * manual or team-derived shares.
 *
 * Rule management is capability-gated and rule EVALUATION writes grants that
 * decide other principals' visibility, so every method here takes the full
 * {@link ExecutionContext} on the same terms as {@link ISharingService}
 * (#6523).
 */
export interface ISharingRuleService {
  defineRule(input: DefineSharingRuleInput, context: ExecutionContext): Promise<SharingRuleRow>;
  listRules(filter: { object?: string; activeOnly?: boolean }, context: ExecutionContext): Promise<SharingRuleRow[]>;
  getRule(idOrName: string, context: ExecutionContext): Promise<SharingRuleRow | null>;
  deleteRule(idOrName: string, context: ExecutionContext): Promise<void>;

  /**
   * Re-evaluate a rule across every record of its object_name and
   * reconcile the resulting `sys_record_share` rows. Admin-initiated;
   * use after rule edits or for backfill.
   */
  evaluateRule(idOrName: string, context: ExecutionContext): Promise<SharingRuleEvaluationResult>;

  /**
   * Incremental evaluation triggered by the lifecycle hook — re-checks
   * every active rule for `object` against this single record and
   * upserts/reconciles only that record's share rows.
   */
  evaluateAllForRecord(object: string, recordId: string, context: ExecutionContext): Promise<SharingRuleEvaluationResult[]>;
}

// ─────────────────────────────────────────────────────────────────────
// Team graph helpers (lives behind ISharingRuleService implementations
// but is exported so the approval engine can expand `team:` / `role:`
// approver references without depending on the plugin directly).
// ─────────────────────────────────────────────────────────────────────

/**
 * Flat collaboration team graph (better-auth's `sys_team` semantics).
 *
 * Teams in this model are *not* hierarchical — they are ad-hoc groupings.
 * For the enterprise org-chart hierarchy, see {@link IBusinessUnitGraphService}.
 */
export interface ITeamGraphService {
  /** Return all user ids that are members of `teamId`. */
  expandUsers(teamId: string): Promise<string[]>;
  /** Return all user ids that hold a role of `roleName` in `organizationId`. */
  expandRoleUsers(roleName: string, organizationId?: string): Promise<string[]>;
  /** Return the manager id for a user (best-effort; null when none). */
  managerOf(userId: string, organizationId?: string): Promise<string | null>;
}

/**
 * Hierarchical department graph (`sys_business_unit` org skeleton).
 *
 * Walks `parent_business_unit_id` to expand a department into the union of
 * its members and all descendant members. Drives:
 *   - `recipient_type='unit_and_subordinates'` sharing rules (this subtree
 *     walk); `business_unit` expands only the one named unit's members
 *   - `bu:` approver prefix in the approval engine
 *   - report rollups, manager chains, and similar org-aware logic
 */
export interface IBusinessUnitGraphService {
  /** Return all descendant business unit ids (BFS, includes the seed). */
  descendants(businessUnitId: string): Promise<string[]>;
  /** Return all user ids in `businessUnitId` or any descendant business unit. */
  expandUsers(businessUnitId: string): Promise<string[]>;
  /** Return the department head (manager_user_id) — best-effort, null when none. */
  headOf(businessUnitId: string): Promise<string | null>;
  /** Return the manager id for a user — proxy to {@link ITeamGraphService.managerOf}. */
  managerOf(userId: string, organizationId?: string): Promise<string | null>;
}


/**
 * [ADR-0057] HIERARCHY access scopes (the Dataverse-style "see records by where
 * you sit in the org"). `own`/`org` are resolved by the open sharing layer
 * itself; these three require a pluggable resolver.
 */
export type HierarchyScope = 'unit' | 'unit_and_below' | 'own_and_reports';

/**
 * Caller identity a {@link IHierarchyScopeResolver} resolves a
 * {@link HierarchyScope} against.
 *
 * **`organizationId` is the AUTHORITATIVE tenancy field** — the one a resolver
 * scopes its owner-set query by. It is REQUIRED (`string | null`, never
 * omitted) so a producer that forgets to supply it fails to compile instead of
 * silently handing every resolver an `undefined` org: two sides can each look
 * contract-compliant while the pair leaks across organizations (#5852/#5858).
 * The name follows the repo-wide convention: #3280 made `organizationId` the
 * blessed developer-facing name for the caller's active org (matching the
 * `organization_id` column and `current_user.organizationId` in RLS) and #3290
 * removed the `session.tenantId` alias in v11; `scripts/check-org-identifier.mjs`
 * keeps it that way.
 */
export interface HierarchyScopeContext {
  userId: string;
  /**
   * AUTHORITATIVE. Active organization ID of the caller (`null` =
   * platform/unscoped) — same meaning as `EvalUser.organizationId`. A resolver
   * MUST scope its owner set by this field; see
   * {@link IHierarchyScopeResolver.resolveOwnerIds} for the `null` obligation.
   */
  organizationId: string | null;
  /**
   * REQUIRED. The deployment's tenancy posture (ADR-0105 D1) — the fact that
   * says what a `null` {@link HierarchyScopeContext.organizationId} MEANS.
   *
   * Without it the two `null`s are indistinguishable, and they demand opposite
   * answers (#6139):
   *
   *  - `single` — there is no organization dimension at all, so `null` is the
   *    ONE implicit tenant, not an absent constraint. A resolver MUST proceed
   *    and resolve DEPTH normally; refusing here retires hierarchy scoping for
   *    every org-less deployment, which the ADR-0057 D1 proofs boot on purpose.
   *  - `group` / `isolated` — a wall is in force, so `null` is a MISSING
   *    constraint. The fail-closed obligation applies in full force; that is
   *    the half which closed the #5852 cross-organization leak, and nothing on
   *    this interface relaxes it.
   *
   * Required — never optional, never omitted — for the same reason
   * {@link HierarchyScopeContext.organizationId} is: a producer that forgets it
   * must fail to COMPILE rather than hand every resolver an `undefined` to
   * guess about, when either guess is a defect (one leaks across
   * organizations, the other silently kills enterprise DEPTH). Producers
   * already hold the value — the open sharing layer resolves the posture to
   * decide whether to consult a resolver at all — so supplying it is a
   * pass-through, not new plumbing.
   *
   * A producer that cannot resolve the posture MUST report the strictest
   * WALLED posture rather than `single`: an unknown posture is not evidence of
   * `single`, and reading it as such would restore the widening on precisely
   * the deployments whose configuration is already suspect.
   */
  posture: TenancyPosture;
  /**
   * Generic driver-layer tenancy knob, carried through for kernels that key
   * isolation off something other than the organization (database-per-tenant
   * deployments legitimately put an *environment* id here).
   *
   * @deprecated Not the authority for hierarchy scoping — a resolver MUST NOT
   * depend on it alone, and MUST NOT treat it as a substitute for a `null`
   * {@link HierarchyScopeContext.organizationId}. Read `organizationId`.
   * Retained for compatibility only; removal goes through the retirement flow.
   */
  tenantId?: string | null;
}

/**
 * Pluggable resolver for {@link HierarchyScope}s. The OPEN edition ships no
 * implementation; the ENTERPRISE package `@objectstack/security-enterprise`
 * registers one under the `hierarchy-scope-resolver` kernel service. When
 * absent, the sharing layer fails CLOSED to owner-only (a hierarchy scope never
 * widens without the resolver).
 *
 * [ADR-0090 Addendum — assignment-level BU anchor] When resolving `unit` /
 * `unit_and_below`, an implementation MUST prefer the caller's ANCHORED
 * business units — the non-null `sys_user_position.business_unit_id` values on
 * their position assignments — over their full `sys_business_unit_member`
 * membership: a 华东 sales manager anchored to 华东 gets manager depth in 华东
 * only, not in an unrelated project unit they also happen to belong to. Only
 * when the caller has NO anchored assignment does the resolver fall back to
 * membership-derived units. (Capability bits are never BU-scoped; the anchor
 * narrows DEPTH, it never grants.)
 */
export interface IHierarchyScopeResolver {
  /**
   * Owner ids whose records the caller may see under `scope` (must include the
   * caller). Empty/throw → caller falls back to owner-only.
   *
   * **Fail CLOSED on a missing organization — under a WALLED posture.** When
   * {@link HierarchyScopeContext.posture} is `group` or `isolated` and the
   * authoritative {@link HierarchyScopeContext.organizationId} is `null`, an
   * implementation MUST NOT build the owner set as though no tenancy
   * constraint applied — "no org" is not "every org". Return owner-only (or
   * throw, which the sharing layer treats the same way); never widen. Falling
   * back to {@link HierarchyScopeContext.tenantId} instead is not fail-closed
   * either. This obligation is STRICT and unconditional within those two
   * postures: it is the half that closed #5852.
   *
   * **Under `single`, a `null` organization is NOT missing information** and
   * MUST NOT be refused (#6139). That posture has no organization dimension at
   * all, so `null` names the one implicit tenant; the resolver resolves DEPTH
   * normally, exactly as it would for a non-null org elsewhere. Refusing here
   * is not a conservative choice — it retires hierarchy scoping for every
   * org-less deployment, including the single-posture enterprise installs
   * ADR-0057 D1's proofs boot deliberately.
   *
   * Read the two fields TOGETHER; neither alone carries the verdict. `null` +
   * `single` is legitimate and widens; `null` + `group`/`isolated` fails
   * closed. An implementation that keys only on `organizationId` is not
   * conformant — it is the shape this contract used to require, and it kills
   * single-posture DEPTH.
   */
  resolveOwnerIds(context: HierarchyScopeContext, scope: HierarchyScope): Promise<string[]>;
}
