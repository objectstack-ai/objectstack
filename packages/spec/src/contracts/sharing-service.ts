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

/** Access level on a single record. */
export type ShareAccessLevel = 'read' | 'edit' | 'full';

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
   * Return `true` when the principal in `context` may modify the
   * record `(object, recordId)`. Owner-only for `private` / `read`
   * objects; always true for `public` objects.
   */
  canEdit(
    object: string,
    recordId: string,
    context: SharingExecutionContext,
  ): Promise<boolean>;

  /** Create or upsert a manual share row. */
  grant(input: GrantShareInput, context: SharingExecutionContext): Promise<RecordShare>;

  /** Remove a share row by id. No-op when not found. */
  revoke(shareId: string, context: SharingExecutionContext): Promise<void>;

  /** List all share rows attached to `(object, recordId)`. */
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
