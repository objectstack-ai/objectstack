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
 *   2. **Per-record gating** — `canEdit()` answers the access question
 *      for `update` / `delete` operations. Returns `true` when the
 *      caller may modify the record, `false` otherwise.
 *
 * Manual share CRUD is exposed via `grant()`, `revoke()`, and
 * `listShares()`. The REST layer wires these to
 * `/data/:object/:id/shares`.
 *
 * The default implementation lives in `@objectstack/plugin-sharing`.
 */

/** Recipient categories — mirrors `ShareRecipientType` in spec/security. */
export type ShareRecipientType =
  | 'user'
  | 'group'
  | 'role'
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
  recipient_type: ShareRecipientType;
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
  recipientType?: ShareRecipientType;
  recipientId: string;
  accessLevel?: ShareAccessLevel;
  source?: ShareSource;
  sourceId?: string;
  reason?: string;
}

/** Minimal execution-context shape the service needs from callers. */
export interface SharingExecutionContext {
  userId?: string;
  tenantId?: string;
  positions?: string[];
  permissions?: string[];
  /**
   * [ADR-0111] Capability names the caller holds (`manage_sharing`, …) —
   * resolved by `resolveAuthzContext` alongside `permissions` (which carries
   * permission-set NAMES, not capabilities). Consulted by the sharing-rule
   * management gate; absent → the caller holds no capabilities (fail closed).
   */
  systemPermissions?: string[];
  isSystem?: boolean;
}

/**
 * Public contract.
 *
 * Implementations should treat `context.isSystem === true` as a
 * complete bypass (no filter, every `canEdit` returns `true`) so that
 * platform-internal writers (audit, migrations, the sharing plugin
 * itself) cannot deadlock on their own enforcement.
 */
export interface ISharingService {
  /**
   * Return a filter condition that restricts a `find` to rows the
   * principal in `context` can see for `object`. Return `null` when no
   * restriction applies (public object, system context, no userId).
   */
  buildReadFilter(
    object: string,
    context: SharingExecutionContext,
  ): Promise<unknown | null>;

  /**
   * Return `true` when the principal in `context` may UPDATE the record
   * `(object, recordId)`. Ownership (widened by write DEPTH) OR a write-level
   * ({@link ShareAccessLevel} `edit`) share. Always true for system context,
   * `public` objects, and objects with no owner field.
   */
  canEdit(
    object: string,
    recordId: string,
    context: SharingExecutionContext,
  ): Promise<boolean>;

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
   */
  canDelete(
    object: string,
    recordId: string,
    context: SharingExecutionContext,
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
    context: SharingExecutionContext,
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
  grant(input: GrantShareInput, context: SharingExecutionContext): Promise<RecordShare>;

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
    context: SharingExecutionContext,
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
    context: SharingExecutionContext,
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
 */
export interface ISharingRuleService {
  defineRule(input: DefineSharingRuleInput, context: SharingExecutionContext): Promise<SharingRuleRow>;
  listRules(filter: { object?: string; activeOnly?: boolean }, context: SharingExecutionContext): Promise<SharingRuleRow[]>;
  getRule(idOrName: string, context: SharingExecutionContext): Promise<SharingRuleRow | null>;
  deleteRule(idOrName: string, context: SharingExecutionContext): Promise<void>;

  /**
   * Re-evaluate a rule across every record of its object_name and
   * reconcile the resulting `sys_record_share` rows. Admin-initiated;
   * use after rule edits or for backfill.
   */
  evaluateRule(idOrName: string, context: SharingExecutionContext): Promise<SharingRuleEvaluationResult>;

  /**
   * Incremental evaluation triggered by the lifecycle hook — re-checks
   * every active rule for `object` against this single record and
   * upserts/reconciles only that record's share rows.
   */
  evaluateAllForRecord(object: string, recordId: string, context: SharingExecutionContext): Promise<SharingRuleEvaluationResult[]>;
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
 *   - `recipient_type='business_unit'` sharing rules
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

export interface HierarchyScopeContext {
  userId: string;
  organizationId?: string | null;
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
   */
  resolveOwnerIds(context: HierarchyScopeContext, scope: HierarchyScope): Promise<string[]>;
}
