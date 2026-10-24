// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type {
  ISharingRuleService,
  DefineSharingRuleInput,
  SharingRuleRow,
  SharingRuleEvaluationResult,
  ShareAccessLevel,
  SharingRuleRecipientType,
} from '@objectstack/spec/contracts';
// [#7136] The full `resolveAuthzContext` envelope — what `ISharingRuleService`
// has declared for every one of these context parameters since commit aa4b90d9a (the
// full-envelope ruling: no per-site subset contracts).
import type { ExecutionContext } from '@objectstack/spec/kernel';
// [#15981] The built-in platform-operator position NAME is deliberately NOT
// imported here any more. It used to spell the second half of
// {@link SharingRuleService.hasPlatformAuthority}, and reading it as authority
// became an escalation channel once `positions[]` started carrying ADR-0057 D4
// `sys_user_position` names; that predicate now reads the ADR-0095 rung.
// [ADR-0131 D3, ADR-0126 §4] The activation ledger a position's deactivation is
// read from — the table the authorization resolver reads it from, by name.
import { METADATA_ACTIVATION_TABLE } from '@objectstack/core';
// [#14754] The engine's organization refusal for a system write on a
// tenant-scoped object (#8844). The runtime check is a `code` compare, which is
// the convention that refusal itself documents ("a caller that catches it
// identifies it by `code`") so the check survives the package boundary where
// two copies of that module can exist — `instanceof` is unsound across the dual
// build and fails SILENTLY, as a catch that never fires.
//
// [#14936] The recognizer and the code are taken FROM the engine rather than
// re-spelled here. The engine publishes both precisely so a consumer can
// perform the compare without authoring the string itself: a local literal is a
// second spelling that can drift from what the engine throws, and it acquires a
// `check:error-code-provenance` stamp site in this package for a code this
// package only ever RECOGNISES.
import {
  isSystemWriteOrganizationRequiredError,
  SYSTEM_WRITE_ORGANIZATION_REQUIRED_CODE,
} from '@objectstack/objectql';
import type { SharingEngine } from './sharing-service.js';
import type { SharingService } from './sharing-service.js';
import { isInternalRecipientRefusal } from './sharing-service.js';
import { normalizeAccessLevel, normalizeStoredAccessLevel } from './access-level.js';
import { parseCriteria, isMatchAllCriteria, MATCH_ALL_CRITERIA_MESSAGE } from './rule-criteria.js';
import { TeamGraphService, teamHasMember } from './team-graph.js';
import { PositionGraphService } from './position-graph.js';
import { BusinessUnitGraphService } from './business-unit-graph.js';
import type { DeclaredSharingRule, DeclaredSharingRuleSource } from './declared-sharing-rules.js';

/**
 * System-elevated context for the rule evaluator's own reconcile writes.
 *
 * [#7136] Typed as the full envelope so it is passed AS ITSELF. It used to be
 * declared `as const` and forced through an `as any` at all 10 of its context
 * call sites — an erasure on an enforcement input, which switches checking off
 * for the whole argument, not just for the readonly-array mismatch that
 * provoked it.
 */
const SYSTEM_CTX: ExecutionContext = { isSystem: true, positions: [], permissions: [] };

/** The organization object, whose registration tells a lean embedding from a deployment with organizations. */
const ORGANIZATION_OBJECT = 'sys_organization';

/**
 * [ADR-0131 D6 regime C] The `sys_metadata_activation.metadata_type` a declared
 * sharing rule's switch is recorded under — its registry type.
 */
export const SHARING_RULE_ACTIVATION_TYPE = 'sharing_rule';

/**
 * [#15072] The `FieldSchema.name` machine-name grammar, as `packages/spec`
 * spells it inline (`data/field.zod.ts`; `shared/identifiers.zod.ts` records
 * that object and field names are bound there and by no exported schema). A
 * `field` recipient's `recipient_id` is a field NAME and is held to it at the
 * authoring seams that never run the spec parse — see
 * {@link SharingRuleService.defineRule}.
 */
export const FIELD_NAME_GRAMMAR = /^[a-z_][a-z0-9_]*$/;

/**
 * [#15072] The user ids a record's user-typed column names.
 *
 * Exactly the stored shapes a user-valued field has: one id (a scalar) or,
 * with `multiple: true`, an array of ids — the drivers hydrate a multi-value
 * column back to an array before a row reaches an `engine.find` caller, so a
 * string here is one id, never JSON to be parsed (a driver handing back an
 * unhydrated column would be the driver's defect, and a parse here would
 * fossilise it into a second contract — AGENTS.md PD #12). Everything else —
 * `null`, an empty string, an empty array, an object — names NOBODY: fail-
 * closed, executor-contract point 3 (never a match-all principal, never a
 * fallback to the owner). Duplicates collapse: a column naming one user twice
 * grants once.
 */
function usersNamedBy(raw: unknown): string[] {
  const out = new Set<string>();
  const add = (v: unknown): void => {
    if (typeof v !== 'string' && typeof v !== 'number') return;
    const id = String(v).trim();
    if (id) out.add(id);
  };
  if (Array.isArray(raw)) for (const v of raw) add(v);
  else add(raw);
  return [...out];
}

/**
 * [#15072] Does this declared field hold USERS? The two spellings the spec
 * has for a user-valued column: the `user` type (its target is fixed to
 * `sys_user` by the type — `Field.user()` takes no target), and a `lookup` /
 * `master_detail` whose `reference` is `sys_user` (the same pair
 * `defaultValue: 'current_user'` is accepted on, `data/field.zod.ts`).
 */
function fieldHoldsUsers(def: unknown): boolean {
  if (!def || typeof def !== 'object') return false;
  const d = def as { type?: unknown; reference?: unknown };
  if (d.type === 'user') return true;
  return (d.type === 'lookup' || d.type === 'master_detail') && d.reference === 'sys_user';
}

function uid(prefix: string): string {
  const g: any = globalThis as any;
  if (g.crypto?.randomUUID) return `${prefix}_${g.crypto.randomUUID()}`;
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function rowFromRule(row: any): SharingRuleRow {
  return {
    id: row.id,
    organization_id: row.organization_id ?? null,
    name: row.name,
    label: row.label,
    description: row.description ?? null,
    object_name: row.object_name,
    criteria: parseCriteria(row.criteria_json),
    recipient_type: row.recipient_type as SharingRuleRecipientType,
    recipient_id: row.recipient_id,
    // Projected through the normaliser, not cast: a rule row stored before
    // `full` was retired (#3865) must report the level it actually enforces.
    // This also makes reconciliation self-healing — a `full` rule now differs
    // from its `full` share rows, so the next pass re-grants them as `edit`.
    access_level: normalizeStoredAccessLevel(row.access_level),
    active: row.active !== false,
    managed_by: row.managed_by ?? null,
    customized: row.customized === true,
    created_at: row.created_at ?? undefined,
    updated_at: row.updated_at ?? undefined,
  };
}

/**
 * [ADR-0131 D2/D8] The one scope a declared rule is served in under `single`:
 * the deployment. A typed marker, never an organization id and never NULL —
 * "no organization" is not a state (D1), and no layer has a NULL arm (D8).
 */
const DEPLOYMENT_WIDE_SCOPE: unique symbol = Symbol('sharing-rule.deployment-wide');

/** [ADR-0131 D2] Where a declared rule is served: the deployment, or one organization. */
type DeclaredRuleScope = string | typeof DEPLOYMENT_WIDE_SCOPE;

/**
 * [ADR-0131 D2] A declared rule's projection that sweeps the deployment — the
 * typed marker that replaced the organization-less (`organization_id: null`)
 * projection, in the shape of the declared webhooks' `deploymentWide` (the
 * epic's ruling A on the walled shape of a declared webhook, record
 * 6278609968). It carries no `organization_id` at all. The marker itself is
 * declared on the spec contract (`SharingRuleRow.deploymentWide`); this type
 * narrows it to present.
 */
export interface DeploymentWideSharingRule extends SharingRuleRow {
  readonly deploymentWide: true;
}

/**
 * Does `rule` sweep the whole deployment? Only a declared rule's `single`
 * projection does ({@link projectDeclaredRule}); a stored row is never one,
 * because {@link rowFromRule} builds its fields one by one and the marker is
 * not a column.
 */
export function isDeploymentWideSharingRule(rule: SharingRuleRow): rule is DeploymentWideSharingRule {
  return (rule as Partial<DeploymentWideSharingRule>).deploymentWide === true && isDeclaredSharingRule(rule);
}

/**
 * [ADR-0131 D2] A DECLARED rule as the rule set serves it: the declaration
 * (read from the registry, {@link DeclaredSharingRuleSource}) projected into
 * the runtime row shape for ONE scope. It is not a row: nothing is written for
 * it.
 *
 * A declaration is deployment-wide under every posture — every organization
 * runs the same code (D2). How it is SERVED follows the wall:
 *
 * - under `single`, ONE projection marked {@link DeploymentWideSharingRule}:
 *   its criteria sweep carries no tenant, which is the predicate D8 computes
 *   there (none), and each grant is stamped with its record's organization;
 * - under a wall, one projection PER ORGANIZATION, stamped with it: the sweep
 *   runs inside that organization's one predicate, recipients expand inside
 *   it, and its grants carry it. A deployment-wide sweep under a wall would
 *   be a second predicate beside Layer 0's, which D8 forbids.
 *
 * Its `id` is its NAME. That is what its grants carry as
 * `sys_record_share.source_id` (ruling β item 5 (c) on the C3 epic: the
 * ownership ceremony rewrites a declared-rule mirror's grants from the mirror
 * row's id to the rule's name before it deletes the mirror), so every
 * reconcile below reads and writes a declared rule's grants by name with no
 * second code path. An organization-authored rule keeps its row id.
 */
function projectDeclaredRule(rule: DeclaredSharingRule, scope: DeclaredRuleScope): SharingRuleRow {
  return {
    id: rule.name,
    ...(scope === DEPLOYMENT_WIDE_SCOPE ? { deploymentWide: true } : { organization_id: scope }),
    name: rule.name,
    label: rule.label,
    description: rule.description,
    object_name: rule.object,
    criteria: rule.criteria,
    recipient_type: rule.recipientType,
    recipient_id: rule.recipientId,
    access_level: normalizeStoredAccessLevel(rule.accessLevel),
    active: rule.active,
    managed_by: 'package',
    customized: false,
  };
}

/**
 * Is `rule` a declared rule's projection ({@link projectDeclaredRule}) rather
 * than a `sys_sharing_rule` row? A row's id is minted (`srule_…`, or the data
 * API's), never its name, and `managed_by` is readonly to every non-system
 * writer — so the pair cannot be forged by an author.
 */
export function isDeclaredSharingRule(rule: Pick<SharingRuleRow, 'id' | 'name' | 'managed_by'>): boolean {
  return rule.managed_by === 'package' && rule.id === rule.name;
}

/**
 * [ADR-0131 D6 regime C — ruling A on the declared sharing rules] A
 * `sys_sharing_rule` row — new, or renamed — that would take a declared rule's
 * name.
 *
 * A declared sharing rule is read-only and clonable: it is customised by a
 * CLONE under a new name, with the declared rule switched off through the
 * activation ledger ({@link SharingRuleService.reconcileDeclaredRuleActivation}).
 * Same-name shadowing is retired, so no write may take a declared rule's name
 * — Setup's New, a script, an AI tool, `POST /api/v1/sharing/rules` — and every
 * such write is refused before it lands.
 *
 * `code` + `status` are the declared envelope the `/data` door and the
 * sharing-rule routes answer at its own status (409 `RESOURCE_CONFLICT`, the
 * catalogue's code for a 409 — `HttpStatusErrorCodeMap`): the name is taken by
 * an existing rule, which is a conflict, not a missing capability.
 */
export class DeclaredSharingRuleNameConflictError extends Error {
  readonly code = 'RESOURCE_CONFLICT';
  readonly status = 409;
  /** The declared (vendor) rule whose name the write would take. */
  readonly rule: string;
  constructor(rule: Pick<DeclaredSharingRule, 'name' | 'object'>, write: 'create' | 'rename') {
    super(
      `sharing rule '${rule.name}' is declared by the application (on object '${rule.object}'), so ` +
        (write === 'create' ? 'a new rule cannot take its name' : 'no rule can be renamed to it') +
        `. Declared rules are read-only: to customise '${rule.name}', create your own rule under another name and ` +
        `switch the declared one off (POST /api/v1/security/_activation/sharing_rule/${rule.name} with ` +
        '{ "enabled": false }).',
    );
    this.name = 'DeclaredSharingRuleNameConflictError';
    this.rule = rule.name;
  }
}

/** Package id of {@link bindDeclaredRuleNameGuard}'s hooks. */
export const DECLARED_RULE_NAME_GUARD_PACKAGE = 'plugin-sharing:declared-rule-name-guard';

/**
 * [ADR-0131 D6 regime C] Bind the guard above on `sys_sharing_rule` writes that do not
 * come through {@link SharingRuleService.defineRule}: the `/data` door Setup's
 * New and its edit form write through, scripts, imports. An insert of a
 * declared name is refused, and so is an update that CHANGES `name` onto one;
 * an update that leaves the name alone (a customised copy's `active` switch)
 * passes.
 *
 * System writes pass: `defineRule` writes under the system context after making
 * the same check itself, and the remaining system writers are the platform's
 * own machinery (the ownership ceremony, migrations).
 */
export function bindDeclaredRuleNameGuard(
  engine: {
    registerHook(event: string, handler: (ctx: any) => any, options?: Record<string, any>): void;
    unregisterHooksByPackage?(packageId: string): number;
  },
  rules: Pick<SharingRuleService, 'declaredRuleNamed'>,
): void {
  engine.unregisterHooksByPackage?.(DECLARED_RULE_NAME_GUARD_PACKAGE);
  const guard = (insert: boolean) => async (ctx: any) => {
    if ((ctx?.session as any)?.isSystem) return;
    const data = ctx?.input?.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return;
    if (typeof data.name !== 'string') return;
    // An update is a rename only against its pre-image (`ctx.previous`, the
    // `HookContext` contract both update shapes bind before `beforeUpdate`): a
    // full-form save re-sends the name it already has.
    if (!insert) {
      const previous = ctx?.previous as Record<string, unknown> | undefined;
      if (!previous || typeof previous !== 'object' || data.name === previous.name) return;
    }
    const declared = await rules.declaredRuleNamed(data.name);
    if (declared) throw new DeclaredSharingRuleNameConflictError(declared, insert ? 'create' : 'rename');
  };
  const opts = { object: 'sys_sharing_rule', packageId: DECLARED_RULE_NAME_GUARD_PACKAGE, priority: 100 };
  engine.registerHook('beforeInsert', guard(true), opts);
  engine.registerHook('beforeUpdate', guard(false), opts);
}

/** Package id of {@link bindSharingRuleActivationReconcile}'s hooks. */
export const SHARING_RULE_ACTIVATION_RECONCILE_PACKAGE = 'plugin-sharing:sharing-rule-activation-reconcile';

/**
 * [ADR-0131 D6 regime C] Reconcile a declared rule's grants when its
 * activation-ledger row is written: the `sys_metadata_activation` write the
 * activation door (`POST /security/_activation/sharing_rule/:name`) makes is
 * followed, in the same request, by
 * {@link SharingRuleService.reconcileDeclaredRuleActivation} — off revokes
 * every grant carrying the rule's name, on re-derives them. A failure is the
 * write's failure: it reaches the door, which answers it, rather than leaving a
 * switched-off rule's grants standing behind a successful flip.
 */
export function bindSharingRuleActivationReconcile(
  engine: {
    registerHook(event: string, handler: (ctx: any) => any, options?: Record<string, any>): void;
    unregisterHooksByPackage?(packageId: string): number;
  },
  rules: Pick<SharingRuleService, 'reconcileDeclaredRuleActivation'>,
): void {
  engine.unregisterHooksByPackage?.(SHARING_RULE_ACTIVATION_RECONCILE_PACKAGE);
  const handler = async (ctx: any) => {
    // The update patch carries `{ id, active, package_id }`; type and name come
    // from the pre-image (`ctx.previous`), an insert's from the row itself.
    const row = { ...(ctx?.previous ?? {}), ...(ctx?.result ?? ctx?.input?.data ?? {}) };
    if (row.metadata_type !== SHARING_RULE_ACTIVATION_TYPE || typeof row.name !== 'string' || !row.name) return;
    await rules.reconcileDeclaredRuleActivation(row.name);
  };
  for (const event of ['afterInsert', 'afterUpdate', 'afterDelete']) {
    engine.registerHook(event, handler, {
      object: METADATA_ACTIVATION_TABLE,
      packageId: SHARING_RULE_ACTIVATION_RECONCILE_PACKAGE,
      priority: 200,
    });
  }
}

/**
 * The `sys_record_share` rows a rule's grants are: `source: 'rule'` plus the
 * rule's id. A declared rule served under a wall is one projection per
 * organization, all carrying the rule's name, so its grants are told apart by
 * the organization each one is stamped with — the rule's own, which the grant
 * write threads ({@link SharingRuleService.criteriaContext}). Without it one
 * organization's reconcile would read every other organization's grants of
 * the same rule as its own stale rows, and revoke them.
 */
function ruleGrantScope(rule: SharingRuleRow): Record<string, unknown> {
  const where: Record<string, unknown> = { source: 'rule', source_id: rule.id };
  if (isDeclaredSharingRule(rule) && !isDeploymentWideSharingRule(rule)) where.organization_id = rule.organization_id;
  return where;
}

/** Name order, as `listRules` has always answered. */
function byName(a: SharingRuleRow, b: SharingRuleRow): number {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

/**
 * [#14754] What one reconcile pass did, plus the grants the engine's
 * organization rule REFUSED in it.
 *
 * [#14969] The NARROWING is the point, not a lag. `@objectstack/spec` declares
 * `grantsRefused?: number` on {@link SharingRuleEvaluationResult} itself, and
 * declares it OPTIONAL on purpose: an `ISharingRuleService` implementation that
 * does not count refusals leaves the key ABSENT, and absent is not `0`. This
 * implementation always counts them, so it REQUIRES the key — a legal covariant
 * narrowing, and the reason a caller holding this type never has to decide
 * whether an unset key means "no grant was refused" or "this implementation
 * does not report refusals". Consumers typed against the spec contract are
 * unaffected; for them the key stays optional. The required form is what this
 * package's own pins assert and what the evaluate route puts on the wire — it
 * answers this service's return value unfiltered.
 *
 * ⛔ `grantsRefused > 0` is NOT "the pass failed". It is the pass reporting that
 * it met a record it cannot grant on (an organization-less record under a
 * walled posture) and CONTINUED — which is the whole point: the remaining
 * grants and, above all, the stale-row revocations still ran.
 */
export interface SharingRuleReconcilePassResult extends SharingRuleEvaluationResult {
  /** Grants the engine's organization rule refused; each one is also logged. */
  grantsRefused: number;
  /**
   * [#25549] One line, present only when the pass skipped recipients: the rule
   * is anchored on a public object, where a share reaches an `external` member
   * of the record's organization only, so no row was written for the internal
   * recipients it expands to. The count is in the pass's log line.
   */
  note?: string;
}

/** What one attempted grant of a pass came to. */
type RuleGrantOutcome = 'granted' | 'refused' | 'internal';

/** [#25549] The pass's one-line note when it skipped internal recipients. */
function internalHalfNote(object: string): string {
  return `"${object}" has a public sharing model: rows were written for external recipients only; `
    + 'the internal recipients this rule expands to already reach its records, so none was written for them';
}

export interface SharingRuleServiceOptions {
  engine: SharingEngine;
  sharing: SharingService;
  /**
   * [ADR-0131 D2] Where DECLARED rules are read — the registry
   * (`createDeclaredSharingRuleSource`). Absent, the rule set is the
   * `sys_sharing_rule` rows alone.
   */
  declaredRules?: DeclaredSharingRuleSource;
  logger?: {
    info?: (msg: any, ...rest: any[]) => void;
    /**
     * The GUARANTEED fallback channel (#9754, ruled on #10556). `error` stays
     * optional — hosts do inject reduced sinks — so `warn` is where a
     * durability report lands when `error` is absent, and a fallback that may
     * itself be missing is not a fallback. Call sites keep the
     * `logger?.warn?.(…)` spelling as the backstop for hosts the TYPE cannot
     * reach; `SweepLogger` in plugin-email's `outbox-sweep.ts` carries the full
     * reasoning and the measurement.
     *
     * ⚠️ This member is REQUIRED, and `SharingRuleServiceOptions` is PUBLICLY EXPORTED
     * from this package's `index.ts` — so a host passing `{ info, error }`
     * compiled before this landed and does not after. That break is declared,
     * shipped `minor`, and named in the changeset (maintainer ruling
     * 2026-08-24, #10556 limb (c)).
     */
    warn: (msg: any, ...rest: any[]) => void;
    error?: (msg: any, ...rest: any[]) => void;
    debug?: (msg: any, ...rest: any[]) => void;
  };
}

/**
 * [commit 04d03c3a0] Memo for the catalogue reads a recipient expansion adds, scoped to
 * ONE evaluator pass.
 *
 * The lifetime is the whole design. It is the same lifetime the graph services
 * already document for their own `cache` option ("shared cache across one
 * evaluator pass"), and it is deliberately NOT a field on the service: this
 * service instance lives as long as the plugin, so a memo hung there would
 * outlive the pass and make a deactivation take effect late — a second defect
 * in the shape of a fix for the first. Created at the public entry, threaded
 * down, discarded with the pass.
 */
type RuleEvaluationPass = {
  /** Position activation verdicts (the activation ledger), keyed by position name. */
  positionActive?: Map<string, boolean>;
};

/** [#15072] One grant a rule DESIRES on a whole-rule pass: a (record, user) pair. */
interface DesiredGrant {
  record_id: string;
  recipient_id: string;
}

/**
 * [#15072] Everything a whole-rule pass wants to exist, keyed
 * `${record_id}::${recipient_id}`, plus the two counts the evaluation result
 * reports. Built per recipient kind by {@link SharingRuleService.desiredGrantsForRule}
 * so that `reconcile` diffs pairs without knowing whether the recipient was
 * resolved once per rule or once per record.
 */
interface DesiredGrantSet {
  desired: Map<string, DesiredGrant>;
  matchedRecords: number;
  expandedUsers: number;
}

/**
 * Default {@link ISharingRuleService} implementation.
 *
 * Stores rule definitions in `sys_sharing_rule` and materialises grants
 * as `sys_record_share` rows with `source='rule'` and `source_id={ruleId}`
 * so reconcile can diff old grants vs fresh evaluation results without
 * touching manual / team-derived shares.
 */
export class SharingRuleService implements ISharingRuleService {
  private readonly engine: SharingEngine;
  private readonly sharing: SharingService;
  private readonly logger?: SharingRuleServiceOptions['logger'];
  /**
   * [#3929 follow-up] Inert (criteria-less) rules seen this process, for
   * once-per-rule warn dedup + the boot aggregate. Pre-dedup the evaluator
   * warned on EVERY pass — findMatchingRecords per evaluation AND
   * recordMatches per reconciled write — so one legacy row could dominate a
   * deployment's log. The enforcement is unchanged (such a rule still
   * matches NOTHING); only the repetition is gone.
   */
  private readonly inertRuleSeen = new Set<string>();
  /**
   * [#14547] Business-unit rules seen expanding to NOBODY this process — the
   * same once-per-rule dedup {@link inertRuleSeen} carries, for the same
   * reason: the reconcilers call {@link expandRecipient} on every matched
   * write, so an undeduped warn would let one misconfigured rule dominate a
   * deployment's log.
   */
  private readonly emptyUnitExpansionSeen = new Set<string>();
  /**
   * [#15072] `field` rules already warned about this process, keyed by cause
   * — the same once-per-rule dedup {@link inertRuleSeen} and
   * {@link emptyUnitExpansionSeen} carry, for the same reason: the per-record
   * path runs on every write of the shared object.
   */
  private readonly fieldRuleWarned = new Set<string>();

  /** [ADR-0131 D2] Where declared rules are read. */
  private readonly declaredSource?: DeclaredSharingRuleSource;
  /**
   * [ADR-0131 D2] The scopes a declared rule is served in: the deployment
   * under `single` (one {@link DeploymentWideSharingRule} projection), every
   * organization under a wall. Set by the plugin from the posture
   * ({@link setDeclaredRuleScopes}).
   *
   * `null` is UNKNOWN — the organizations could not be read
   * ({@link setDeclaredRuleScopesUnknown}). It is a state of its own, never an
   * empty list: an empty list would read as "no organization serves this
   * rule", and the orphaned-grant sweep would revoke every declared rule's
   * grants on that reading. Unknown serves no declared rule and revokes none.
   */
  private declaredScopes: ReadonlyArray<DeclaredRuleScope> | null = [DEPLOYMENT_WIDE_SCOPE];
  /** [ADR-0131 D2] The held-back sweep under unknown scopes says so once per process. */
  private unknownScopesSweepWarned = false;
  /** [ADR-0131 D6 regime C] The declaration-over-row conflicts already reported, `name::scope`. */
  private readonly declarationOverRowReported = new Set<string>();
  /** [ADR-0131 D1/D8] Stored rules refused for carrying no organization, reported once each. */
  private readonly organizationlessRuleReported = new Set<string>();

  constructor(opts: SharingRuleServiceOptions) {
    this.engine = opts.engine;
    this.sharing = opts.sharing;
    this.logger = opts.logger;
    this.declaredSource = opts.declaredRules;
  }

  /**
   * [ADR-0131 D2] Serve declared rules in these scopes — the deployment under
   * `single`, the organizations under a wall. The same passes the retired
   * seeder made, as reads instead of rows: one deployment-wide pass under
   * `single`, one per organization under a wall (#10103).
   *
   * `null` is how the plugin's posture read (`resolveDeclaredRuleScopes`)
   * spells `single`. It is translated here, at the one door, into the
   * deployment-wide scope, so no NULL travels past this line.
   */
  setDeclaredRuleScopes(scopes: ReadonlyArray<string | null>): void {
    this.declaredScopes = [...new Set(scopes.map((s): DeclaredRuleScope => (s === null ? DEPLOYMENT_WIDE_SCOPE : s)))];
  }

  /**
   * [ADR-0131 D2] The scopes are UNKNOWN — the organizations could not be
   * enumerated. No declared rule is served anywhere (an incomplete scope set
   * would grant in some organizations and not others), and
   * {@link sweepOrphanedRuleGrants} revokes no declared rule's grant: a read
   * that failed is never a revocation. The next boot that reads the
   * organizations serves them again.
   */
  setDeclaredRuleScopesUnknown(): void {
    this.declaredScopes = null;
  }

  /**
   * [ADR-0131 D2] An organization created after boot is served from its
   * creation on. Under unknown scopes it stays unknown: one organization known
   * is not the set.
   */
  addDeclaredRuleScope(organizationId: string): void {
    const scopes = this.declaredScopes;
    if (!organizationId || scopes === null || scopes.includes(DEPLOYMENT_WIDE_SCOPE) || scopes.includes(organizationId)) {
      return;
    }
    this.declaredScopes = [...scopes, organizationId];
  }

  /**
   * [ADR-0111 D6] The sharing-rule surface is tenant-wide sharing
   * ADMINISTRATION — a rule is an org-wide grant generator, and `evaluate`
   * triggers materialisation, so every verb (list/get included) requires the
   * `manage_sharing` capability. Enforced HERE, not at the route, so every
   * caller is covered (#3902's widened finding: any signed-in user could
   * define a broad-criteria rule naming themself and evaluate it into
   * org-wide `sys_record_share` grants). `manage_platform_settings` is
   * honoured as the legacy gate the Setup sharing pages used before
   * `manage_sharing` existed. System contexts (boot seeding, hooks, backfills,
   * the REST-independent plugin machinery) bypass.
   */
  private assertCanManageRules(context: ExecutionContext): void {
    if (context?.isSystem) return;
    const caps = Array.isArray(context?.systemPermissions) ? context.systemPermissions : [];
    if (!caps.includes('manage_sharing') && !caps.includes('manage_platform_settings')) {
      throw new Error(
        'PERMISSION_DENIED: sharing-rule administration requires the manage_sharing capability (ADR-0111 D6)',
      );
    }
    // [#8158] Holding the capability is not enough: an org-scoped capability
    // needs an organization to be scoped BY. See
    // {@link assertResolvableAdminScope}.
    this.assertResolvableAdminScope(context);
  }

  /**
   * The organization this caller operates in — the ONE spelling of that read.
   *
   * [#7136] Only the `tenantId` half is a declared field of the envelope;
   * `organizationId` is not a field of `ExecutionContext` at all (its history
   * is #5858 / `check:org-identifier`, and #7070 explicitly held it out of the
   * envelope work), so it stays cast. The asymmetry is the visible marker of
   * which of the two names the contract actually knows.
   *
   * [#8158] Was open-coded at three call sites (`listRules`, `getRule`,
   * `defineRule`), with `findRuleRowByName` taking `getRule`'s result as a
   * parameter. Three copies of a security-relevant read is how the fall-open
   * below stayed invisible: each site could see "no org id", none could see
   * whether that meant "system" or "authenticated caller who never selected
   * one".
   */
  private callerOrgId(context: ExecutionContext): string | undefined {
    return ((context as any)?.organizationId ?? context?.tenantId) || undefined;
  }

  /**
   * [#8158] PLATFORM authority — the two spellings, one predicate.
   *
   * Both spellings are accepted because they are two independent channels by
   * which the same unscoped `admin_full_access` grant reaches an
   * `ExecutionContext` (a `scope: 'platform'` capability on
   * `systemPermissions`; the ADR-0095 posture RUNG): a context built by the
   * shared authz resolver carries both, a hand-built one may carry only one,
   * so accepting either is the fail-safe reading.
   *
   * It decides whether an org-less caller may read across tenants. Its other
   * question — may this caller DELETE a platform-global (`organization_id =
   * null`) rule (#7795) — retired with that rule class (ADR-0131 D1/D2): a
   * stored rule belongs to the organization that authored it, and a declared
   * rule is code, which no caller deletes.
   *
   * ⛔ [#15981] The second spelling is the RUNG, never
   * `positions.includes(BUILTIN_IDENTITY_PLATFORM_ADMIN)`. The two stopped
   * being the same channel when `positions[]` became the security axis: it
   * carries ADR-0057 D4 `sys_user_position` names, that table is `apiEnabled`
   * with unconstrained `position` values, and `resolveUserAuthzGrants` §4
   * pushes a minted row's name straight onto the array. `resolve-authz-context.ts`
   * states the rule at `hasPlatformAdminStanding`, and
   * `grants.posture === 'PLATFORM_ADMIN'` is byte-for-byte what that predicate
   * returns — the unscoped `admin_full_access` evidence, which is what this
   * doc block meant by the built-in position all along.
   *
   * Driven, not argued: with the minted row present and only the ORG-scoped
   * `manage_sharing` capability held, the old read admitted an org-less caller
   * to every tenant's rules through {@link listRules}. See
   * `sharing-rule-positions-name-authority.test.ts`.
   */
  private hasPlatformAuthority(context: ExecutionContext): boolean {
    const caps = Array.isArray(context?.systemPermissions) ? context.systemPermissions : [];
    if (caps.includes('manage_platform_settings')) return true;
    return context?.posture === 'PLATFORM_ADMIN';
  }

  /**
   * [#8158] Refuse an authenticated, non-platform caller whose session
   * resolves NO organization — the sharing-rule surface's fall-open.
   *
   * ## The defect
   *
   * {@link adminOrgScope} used to answer the unfiltered `where` for any caller
   * with no org id (`if (!orgId) return where`). That branch exists for
   * {@link SYSTEM_CTX} — boot seeding, hooks, backfills — which legitimately
   * reads every tenant's rows. But it was reached on the ABSENCE OF AN ORG ID,
   * never on system-ness, and {@link assertCanManageRules} admits any caller
   * holding the org-scoped `manage_sharing` capability. So an authenticated,
   * non-system caller arriving with neither `organizationId` nor `tenantId`
   * got the system read scope: {@link listRules} returned EVERY organization's
   * rules, {@link getRule} resolved any of them by id or name, and
   * {@link evaluateRule} reached those rows too — a cross-tenant WRITE, since
   * it reconciles `sys_record_share` grants. Same class #7761 closed for the
   * by-id branch, through a different door: there the filter was missing, here
   * it was skipped.
   *
   * ## That context is reachable (measured, not inferred)
   *
   * `resolveAuthzContext` derives the tenant from the session's active
   * organization and stamps it only when truthy, and
   * `resolveUserAuthzGrants` resolves an org-SCOPED permission-set grant
   * whenever the caller has no active org to compare it against
   * (`!(org && tenantId && org !== tenantId)`). A user holding an org-scoped
   * `manage_sharing` grant with no `sys_member` row — a multi-org deployment
   * (the membership reconciler binds nobody there), an `invite-only`
   * deployment, a user removed from their org, an SSO JIT user pending
   * placement — therefore logs in, resolves the capability, and carries no
   * tenant. Driven end to end over HTTP in
   * `packages/qa/dogfood/test/sharing-rule-org-less-caller.dogfood.test.ts`:
   * before this guard that session listed both tenants' rules.
   *
   * ## Refuse, rather than answer empty
   *
   * Both are fail-closed; the difference is what the caller is told. An empty
   * list is the #7676 shape — `{data: []}` over rules that exist and are
   * actively granting access, which reads as "this deployment has no sharing
   * rules" and sends the operator to look for the wrong bug. A 403 states the
   * actual condition and its remedy. `manage_sharing` is declared
   * `scope: 'org'` in the spec's capability registry: with no organization
   * resolved there is no scope in which it grants anything, so the honest
   * answer is a refusal, not an answer.
   *
   * Asserted in {@link assertCanManageRules}, which every verb already calls
   * first — so `defineRule` is covered too, and an org-less caller can no
   * longer write a rule with no organization of its own (the engine stamps or
   * refuses such a write, ADR-0131 D9).
   *
   * ## Two classes keep the unfiltered read, deliberately
   *
   * - **System contexts** (`isSystem`) — the branch's original and only
   *   intended reason: boot seeding, the reconcile hooks, the backfills.
   * - **Platform operators** — `manage_platform_settings` or the
   *   `platform_admin` position ({@link hasPlatformAuthority}). Their
   *   cross-tenant read is what the Setup sharing pages are (the capability
   *   is `scope: 'platform'`, and those pages are documented platform-only in
   *   plugin-security's default permission sets), and they hold platform
   *   authority whether or not an organization is selected. Refusing them
   *   would be a functional regression dressed as a security fix — a
   *   single-tenant deployment before its default org is bootstrapped, or one
   *   running `autoDefaultOrganization: false`, has a platform admin with no
   *   active organization and nothing else wrong with it.
   */
  private assertResolvableAdminScope(context: ExecutionContext): void {
    if (this.callerOrgId(context)) return;
    if (this.hasPlatformAuthority(context)) return;
    throw new Error(
      'PERMISSION_DENIED: sharing-rule administration requires an active organization — this ' +
        'session carries none. manage_sharing is an ORG-scoped capability (ADR-0111 D6), so with ' +
        'no organization resolved there is no tenant whose rules it authorizes, and answering ' +
        'unscoped would expose every tenant’s rules. Select an active organization and ' +
        'retry. Platform operators (manage_platform_settings or the platform_admin position) and ' +
        'system contexts are unaffected.',
    );
  }

  async defineRule(input: DefineSharingRuleInput, context: ExecutionContext): Promise<SharingRuleRow> {
    this.assertCanManageRules(context);
    if (!input.name) throw new Error('VALIDATION_FAILED: name is required');
    if (!input.label) throw new Error('VALIDATION_FAILED: label is required');
    if (!input.object) throw new Error('VALIDATION_FAILED: object is required');
    if (!input.recipientType) throw new Error('VALIDATION_FAILED: recipientType is required');
    if (!input.recipientId) throw new Error('VALIDATION_FAILED: recipientId is required');
    // [#15072] A `field` recipient's `recipientId` is a FIELD NAME, not a
    // principal id, and is held to the grammar `sharedWith.value` meets at
    // parse (`ShareRecipientType` `field`, `sharing.zod.ts`): the
    // `FieldSchema.name` machine-name shape. Refused HERE as well because this
    // entry — the REST `POST /sharing/rules` body and programmatic authoring —
    // never runs the spec schema, so without it a dotted path
    // (`owner.manager_id`: a graph walk spelled as a value, the shape the
    // ruling's ⛔ on a `manager` member refuses) would reach the executor and
    // share with nobody in silence.
    if (input.recipientType === 'field' && !FIELD_NAME_GRAMMAR.test(String(input.recipientId))) {
      throw new Error(
        "VALIDATION_FAILED: recipientId must name a user-typed field on the object when recipientType is 'field' " +
          `(got ${JSON.stringify(input.recipientId)}) — a snake_case field name, not a principal id and not a dotted path`,
      );
    }
    // [#3896] `criteria` is as required as the fields above — and for a
    // sharper reason. Omitting `recipientId` yields a rule that shares with
    // nobody; omitting `criteria` used to yield one that shares EVERYTHING
    // (stored as `criteria_json: null`, evaluated as the empty filter `{}`
    // against SYSTEM_CTX). `SharingRuleSchema` has always forbidden that
    // shape — "never seeded as a permissive match-all (ADR-0049)" — but this
    // entry, which `POST {basePath}/sharing/rules` plucks its body into, never
    // ran the schema, so a missing / null / misspelled (`criterias`) key
    // sailed through with a 201 and no warning.
    if (isMatchAllCriteria(input.criteria)) {
      throw new Error(`VALIDATION_FAILED: ${MATCH_ALL_CRITERIA_MESSAGE}`);
    }

    // [#7136 / #8158] One spelling of this read for the whole service — see
    // {@link callerOrgId}. Only a system context or a platform operator
    // reaches this line without an org id (`assertCanManageRules` above
    // refuses the authenticated org-less caller). Their insert carries no
    // organization, and the engine stamps it with the derivable one under
    // `single` or refuses it under a wall (ADR-0131 D9) — it never lands NULL.
    const orgId = this.callerOrgId(context) ?? null;
    const now = new Date().toISOString();
    // Authoring path — `full` normalises to `edit`, anything unrecognised is a
    // loud VALIDATION_FAILED alongside the required-field checks above (#3865).
    const accessLevel: ShareAccessLevel = normalizeAccessLevel(input.accessLevel, 'read');
    const active = input.active !== false;
    const criteriaJson = input.criteria == null
      ? null
      : (typeof input.criteria === 'string' ? input.criteria : JSON.stringify(input.criteria));

    const existing = await this.engine.find('sys_sharing_rule', {
      where: orgId ? { name: input.name, organization_id: orgId } : { name: input.name },
      limit: 1,
      context: SYSTEM_CTX,
    });
    // [#2909 P0/T1] Seed mode: a package/platform managedBy marks this call
    // as a seed rather than an admin/programmatic authoring path. Its one
    // caller here was the boot seeder, retired by ADR-0131 D2 — declared rules
    // are read from the registry now ({@link declaredRules}); the contract's
    // `managedBy` input keeps its meaning for any other caller. sys_sharing_rule is
    // RECORD-AUTHORITATIVE (ADR-0094 addendum): the declared metadata is a
    // seed, not a live override, so the seeder must never clobber a row the
    // admin owns or has customized — most importantly an admin's
    // `active: false` on an over-sharing rule must survive redeploys.
    const seedMode = input.managedBy === 'package' || input.managedBy === 'platform';

    if (Array.isArray(existing) && existing[0]) {
      const row: any = existing[0];
      if (seedMode) {
        if (row.managed_by === 'admin') {
          // Name collision with a tenant-authored rule — the admin's row wins.
          this.logger?.warn?.('[sharing-rule] declared rule name collides with an admin-authored rule — seed skipped', {
            rule: input.name,
          });
          return rowFromRule(row);
        }
        if (row.customized === true) {
          // Admin edited/deactivated this seeded rule — never resurrect it.
          return rowFromRule(row);
        }
      }
      const patch: any = {
        id: row.id,
        label: input.label,
        description: input.description ?? null,
        object_name: input.object,
        criteria_json: criteriaJson,
        recipient_type: input.recipientType,
        recipient_id: input.recipientId,
        access_level: accessLevel,
        active,
        updated_at: now,
        // Seed mode adopts pristine/legacy (pre-provenance) rows so future
        // boots recognize them; non-seed calls never touch provenance.
        ...(seedMode ? { managed_by: input.managedBy } : {}),
      };
      await this.engine.update('sys_sharing_rule', patch, { context: SYSTEM_CTX });
      return rowFromRule({ ...row, ...patch });
    }

    // [ADR-0131 D6 regime C] No row holds this name in the caller's scope, so
    // the write creates one — and no row may take a declared rule's name.
    const declared = await this.declaredRuleNamed(input.name);
    if (declared) throw new DeclaredSharingRuleNameConflictError(declared, 'create');

    const newRow: any = {
      id: uid('srule'),
      organization_id: orgId,
      name: input.name,
      label: input.label,
      description: input.description ?? null,
      object_name: input.object,
      criteria_json: criteriaJson,
      recipient_type: input.recipientType,
      recipient_id: input.recipientId,
      access_level: accessLevel,
      active,
      managed_by: input.managedBy ?? 'admin',
      customized: false,
      created_at: now,
      updated_at: now,
    };
    await this.engine.insert('sys_sharing_rule', newRow, { context: SYSTEM_CTX });
    return rowFromRule(newRow);
  }

  /**
   * Tenant scope for a sharing-rule ADMIN read: the caller's OWN organization.
   *
   * [ADR-0131 D1/D8] This was "this org ∪ platform-global" (#7676): a
   * `$or` with an `organization_id = null` arm, because the retired boot
   * seeder (`bootstrapDeclaredSharingRules`) defined declared rules under the
   * system context and so stamped them with no organization, and a strict
   * equality made those rows invisible to the admin API while enforcement
   * kept reading them. Both halves of that reason are gone: declared rules are
   * read from the registry and never written (D2, {@link declaredRules}, which
   * serves them beside the rows below), and the organization-ownership
   * ceremony attributes every stored row before the deployment is certified
   * (D10), after which a write with no organization is stamped or refused
   * (D9). No layer keeps a NULL arm (D8), so this one is an equality.
   *
   * ⚠️ {@link defineRule}'s existence lookup is the same equality, and must
   * stay one: it decides UPSERT-or-insert, so a wider lookup would let one
   * organization's admin overwrite a row another organization reads.
   *
   * [#7761] It IS applied to {@link getRule}'s by-**id** branch. Unfiltered,
   * that branch let an org admin resolve — and, through {@link deleteRule},
   * destroy — another organization's rule from its id alone.
   *
   * [#8158] Takes the CONTEXT, not a bare org id. The unfiltered branch is
   * for a system context (and, since #8158, a platform operator) — a fact
   * only the context carries. Handed an org id alone, this function could not
   * tell "boot seeding" from "an authenticated caller who never selected an
   * organization" and answered unfiltered to both;
   * {@link assertResolvableAdminScope} is where that distinction now lives,
   * and this signature is what stops a future call site from re-conflating
   * them.
   */
  private adminOrgScope(where: Record<string, unknown>, context: ExecutionContext): Record<string, unknown> {
    const orgId = this.callerOrgId(context);
    if (!orgId) return where; // system context / platform operator — asserted upstream
    return { ...where, organization_id: orgId };
  }

  async listRules(
    filter: { object?: string; activeOnly?: boolean },
    context: ExecutionContext,
  ): Promise<SharingRuleRow[]> {
    this.assertCanManageRules(context); // [ADR-0111 D6]
    const where: any = {};
    if (filter.object) where.object_name = filter.object;
    if (filter.activeOnly) where.active = true;
    const rows = await this.engine.find('sys_sharing_rule', {
      where: this.adminOrgScope(where, context),
      orderBy: [{ field: 'name', order: 'asc' }],
      limit: 1000,
      context: SYSTEM_CTX,
    });
    const stored = Array.isArray(rows) ? rows.map(rowFromRule) : [];
    // [ADR-0131 D2] The declared rules, read from the registry — every
    // enforcement path (the record hooks, the object and boot reconciles, the
    // business-unit recompute, the rebind) lists through here.
    const declared = await this.declaredRules(context, filter);
    return declared.length === 0 ? stored : [...stored, ...declared].sort(byName);
  }

  /**
   * [ADR-0131 D2] The declared rules this caller's scope serves, projected
   * ({@link projectDeclaredRule}) — the retired seeder's passes, read instead
   * of written.
   *
   * A declaration is NOT served in a scope where a `sys_sharing_rule` row
   * holds its name — the row the seeder's upsert would have found there: under
   * `single` a row of that name in any organization, under a wall that
   * organization's row of that name. Such a row is an organization's own rule
   * of that name, a seeded copy an administrator customized, or a seeded copy
   * the ownership ceremony has not deleted yet; it answers for the name, as it
   * did while the seeder ran (an admin-authored or customized row was never
   * overwritten), and the declaration does not ALSO grant beside it.
   */
  private async declaredRules(
    context: ExecutionContext,
    filter: { object?: string; activeOnly?: boolean; name?: string },
  ): Promise<SharingRuleRow[]> {
    if (!this.declaredSource) return [];
    let rules = await this.declaredSource.list();
    if (filter.object) rules = rules.filter((r) => r.object === filter.object);
    if (filter.activeOnly) rules = rules.filter((r) => r.active);
    if (filter.name !== undefined) rules = rules.filter((r) => r.name === filter.name);
    const scopes = this.declaredScopesFor(context);
    if (rules.length === 0 || scopes.length === 0) return [];
    // [ADR-0131 D6 regime C] A declared rule the activation ledger switches off
    // is served nowhere: the row is deployment-level, so it covers every scope.
    const off = await this.readSwitchedOffDeclaredRules();
    if (off.size > 0) rules = rules.filter((r) => !off.has(r.name));
    if (rules.length === 0) return [];

    const single = this.declaredScopes?.includes(DEPLOYMENT_WIDE_SCOPE) === true;
    const holders = await this.engine.find('sys_sharing_rule', {
      where: { name: { $in: rules.map((r) => r.name) } },
      fields: ['name', 'organization_id'],
      limit: 100000,
      context: SYSTEM_CTX,
    });
    const held = new Set<string>();
    for (const row of (Array.isArray(holders) ? holders : []) as any[]) {
      held.add(single ? String(row.name) : `${String(row.name)}::${String(row.organization_id)}`);
    }
    const out: SharingRuleRow[] = [];
    for (const scope of scopes) {
      for (const rule of rules) {
        if (held.has(single ? rule.name : `${rule.name}::${String(scope)}`)) {
          this.reportDeclarationOverAuthoredRow(rule, scope);
          continue;
        }
        out.push(projectDeclaredRule(rule, scope));
      }
    }
    return out;
  }

  /**
   * [ADR-0131 D6 regime C] A declaration whose name a `sys_sharing_rule` row
   * already holds in a scope — a package upgrade that ships a rule an
   * organization authored under the same name, or a copy customised before
   * same-name shadowing was retired. The row is never made an overlay of the
   * declaration: it is that organization's own rule and answers as itself. The
   * declaration is NOT served in that scope beside it — serving both would
   * re-grant what a customised copy switched off — and that is said loudly,
   * once per name and scope per process, with the remedy.
   */
  private reportDeclarationOverAuthoredRow(rule: DeclaredSharingRule, scope: DeclaredRuleScope): void {
    const organization = scope === DEPLOYMENT_WIDE_SCOPE ? undefined : scope;
    const key = `${rule.name}::${organization ?? ''}`;
    if (this.declarationOverRowReported.has(key)) return;
    this.declarationOverRowReported.add(key);
    const message =
      `[sharing-rule] declared sharing rule '${rule.name}' arrives over a stored sys_sharing_rule row of the same ` +
      `name${organization ? ` in organization '${organization}'` : ''}, so the declared rule is NOT in force there and grants nothing ` +
      'while the row keeps answering as its own rule. Remedy: rename the stored rule, which makes it a clone of its ' +
      `own, and switch the declared rule off (POST /api/v1/security/_activation/sharing_rule/${rule.name} with ` +
      '{ "enabled": false }) if it must not grant.';
    const meta = organization ? { rule: rule.name, organization } : { rule: rule.name, deploymentWide: true };
    if (this.logger?.error) this.logger.error(message, meta);
    else this.logger?.warn?.(message, meta);
  }

  /**
   * [ADR-0131 D6 regime C] The declared rules the activation ledger
   * (`sys_metadata_activation`, type `sharing_rule`) switches off. No row means
   * the declared default — on. Read as {@link readPositionActive} reads the same
   * ledger: a composition with no ledger object issues no read, and a read that
   * fails switches nothing off for this pass, never a mass revocation.
   */
  private async readSwitchedOffDeclaredRules(): Promise<Set<string>> {
    const off = new Set<string>();
    const registry = (this.engine as { registry?: { getObject?: (name: string) => unknown } }).registry;
    if (typeof registry?.getObject === 'function' && !registry.getObject(METADATA_ACTIVATION_TABLE)) return off;
    try {
      const rows = await this.engine.find(METADATA_ACTIVATION_TABLE, {
        filter: { metadata_type: SHARING_RULE_ACTIVATION_TYPE },
        fields: ['metadata_type', 'name', 'active'],
        limit: 100000,
        context: SYSTEM_CTX,
      });
      for (const row of (Array.isArray(rows) ? rows : []) as Array<{ name?: unknown; active?: unknown }>) {
        if (row.active === false || row.active === 0) off.add(String(row.name));
      }
    } catch (err: any) {
      this.logger?.warn?.(
        `[sharing-rule] ${METADATA_ACTIVATION_TABLE} read failed — declared sharing rules treated as ACTIVE for this pass`,
        { error: err?.message },
      );
    }
    return off;
  }

  /**
   * [ADR-0131 D2] Which scopes a caller reads declared rules in: the
   * deployment under `single` (every organization reads the one
   * deployment-wide projection); under a wall, the caller's own organization,
   * or every organization for a system context or a platform operator.
   */
  private declaredScopesFor(context: ExecutionContext): ReadonlyArray<DeclaredRuleScope> {
    const scopes = this.declaredScopes;
    if (scopes === null) return []; // unknown: served nowhere
    if (scopes.includes(DEPLOYMENT_WIDE_SCOPE)) return [DEPLOYMENT_WIDE_SCOPE];
    const orgId = this.callerOrgId(context);
    if (!orgId) return scopes;
    return scopes.includes(orgId) ? [orgId] : [];
  }

  /**
   * [ADR-0131 D6 regime C] The declared rule named `name`, or `null` — whatever
   * scope it is served in, and whether or not the activation ledger has it
   * switched off: a declaration is the application's in every organization, so
   * its name is taken in every one ({@link DeclaredSharingRuleNameConflictError}).
   */
  async declaredRuleNamed(name: string): Promise<DeclaredSharingRule | null> {
    if (!this.declaredSource || !name) return null;
    return (await this.declaredSource.list()).find((r) => r.name === name) ?? null;
  }

  /**
   * [ADR-0126 §6 wall 3] Every declared rule the registry holds at this boot,
   * each with the package that ships it, whatever its activation-ledger row
   * says. `null` when this service reads no declarations at all — a
   * composition with no registry source, which is no answer about any name.
   * The access-upgrade boot report (plugin-security) compares the ledger's
   * `sharing_rule` rows against this list.
   */
  async listDeclaredRules(): Promise<DeclaredSharingRule[] | null> {
    if (!this.declaredSource) return null;
    return this.declaredSource.list();
  }

  /**
   * [ADR-0131 D6 regime C] Reconcile a declared rule's name-keyed grants with
   * its activation-ledger row, in the request that wrote the row
   * ({@link bindSharingRuleActivationReconcile}) — not at the next boot's
   * {@link sweepOrphanedRuleGrants}.
   *
   * The ledger row is deployment-level (it carries no organization), so the
   * switch covers every scope the declaration is served in. Switched off, it is
   * served nowhere ({@link declaredRules}) and every grant carrying its name is
   * revoked; switched on, each projection's one-rule pass re-derives its grants.
   * An organization's own rules keep their row ids, so no grant of theirs is
   * touched.
   */
  async reconcileDeclaredRuleActivation(name: string): Promise<void> {
    // Unknown scopes serve nothing and judge nothing — the boot sweep's rule for
    // them (hold every declared grant) applies here too.
    if (this.declaredScopes === null || !(await this.declaredRuleNamed(name))) return;
    const served = await this.declaredRules(SYSTEM_CTX, { name });
    if (served.length === 0) {
      await this.purgeGrants({ source: 'rule', source_id: name });
      return;
    }
    for (const projection of served) await this.evaluateResolvedRule(projection);
  }


  async getRule(idOrName: string, context: ExecutionContext): Promise<SharingRuleRow | null> {
    this.assertCanManageRules(context); // [ADR-0111 D6]
    if (!idOrName) return null;
    const row = await this.findRuleRow(idOrName, context);
    if (row) return row;
    // [ADR-0131 D2] A declared rule: its id is its name.
    return (await this.declaredRules(context, { name: idOrName }))[0] ?? null;
  }

  /**
   * Every rule `idOrName` addresses for this caller: the one row, or the
   * declared rule's projections — one per scope the caller reads, so a system
   * context evaluating a declared rule under a wall reaches every
   * organization's projection of it.
   */
  private async resolveRules(idOrName: string, context: ExecutionContext): Promise<SharingRuleRow[]> {
    if (!idOrName) return [];
    const row = await this.findRuleRow(idOrName, context);
    if (row) return [row];
    return this.declaredRules(context, { name: idOrName });
  }

  /** The `sys_sharing_rule` row `idOrName` addresses for this caller — by id, then by name. */
  private async findRuleRow(idOrName: string, context: ExecutionContext): Promise<SharingRuleRow | null> {
    // [#7761] The by-id branch carries the SAME tenant scope as the by-name
    // path — it used to be a bare `{id: idOrName}`, resolved under SYSTEM_CTX
    // so nothing downstream re-scoped it. An org-scoped sharing admin holding
    // another organization's opaque `srule_…` id could therefore read that
    // org's rule, `evaluate` it, and — because {@link deleteRule} resolves
    // through here — DELETE it along with every `sys_record_share` grant it
    // had materialised, i.e. silently revoke another tenant's record access.
    // `manage_sharing` is an org-level capability (`scope: 'org'` in the spec's
    // capability registry) and an id is not a tenant boundary: ids leak through
    // logs, exports, support tickets and the evaluate response's `{ruleId}`.
    // Own organization only, like the by-name path — see {@link adminOrgScope}.
    const byId = await this.engine.find('sys_sharing_rule', {
      where: this.adminOrgScope({ id: idOrName }, context),
      limit: 1,
      context: SYSTEM_CTX,
    });
    if (Array.isArray(byId) && byId[0]) return rowFromRule(byId[0]);
    const byName = await this.findRuleRowByName(idOrName, context);
    if (byName) return rowFromRule(byName);
    return null;
  }

  /**
   * Resolve a rule by NAME for an admin read: the caller's own organization's
   * row of that name.
   *
   * [ADR-0131 D1/D8] It used to fall back to the platform-global
   * (`organization_id IS NULL`) row of that name (#7676) — the seeded copy of
   * a declared rule. Declared rules are read from the registry now
   * ({@link getRule} resolves them by name after this lookup misses), and a
   * certified deployment holds no organization-less row, so the fallback is
   * gone: the one row this caller can name is its organization's.
   *
   * No `orgId` (SYSTEM_CTX — boot seeding, hooks, backfills) keeps the
   * unfiltered by-name lookup it has always had.
   *
   * [#8158] Third site of the same `if (!orgId)` shape, and takes the CONTEXT
   * for the same reason {@link adminOrgScope} does: an authenticated caller
   * with no organization used to resolve ANY tenant's rule by name here — the
   * door a fix confined to `adminOrgScope` would have left open, since
   * {@link getRule} falls through to this lookup whenever the by-id query
   * misses (which is exactly what a by-NAME request does).
   */
  private async findRuleRowByName(name: string, context: ExecutionContext): Promise<any | null> {
    const orgId = this.callerOrgId(context);
    const first = async (where: Record<string, unknown>): Promise<any | null> => {
      const rows = await this.engine.find('sys_sharing_rule', { where, limit: 1, context: SYSTEM_CTX });
      return Array.isArray(rows) && rows[0] ? rows[0] : null;
    };
    if (!orgId) return first({ name }); // system context / platform operator — asserted upstream
    return first({ name, organization_id: orgId });
  }

  async deleteRule(idOrName: string, context: ExecutionContext): Promise<void> {
    this.assertCanManageRules(context); // [ADR-0111 D6]
    if (!idOrName) return;
    const row = await this.findRuleRow(idOrName, context);
    if (!row) {
      // [ADR-0131 D2] A declared rule is code: there is no row to delete, and
      // its grants follow the declaration. 403, never a silent no-op that
      // reads as success while the rule keeps granting.
      // [ADR-0131 D6 regime C] Switched off or not: its name is the declaration's.
      if (await this.declaredRuleNamed(idOrName)) {
        throw new Error(
          `PERMISSION_DENIED: sharing rule '${idOrName}' is declared in the application's code, not stored — ` +
            'it is changed or removed in that declaration, and its grants follow it. To stop it granting here, ' +
            'switch it off through the activation ledger.',
        );
      }
      return;
    }
    // Drop materialised grants first so we don't orphan them.
    //
    // [#4434] This used to be a predicate-shaped `engine.delete` on
    // `sys_record_share` (`where: { source, source_id }`) with neither a
    // scalar id nor `multi: true` — the one shape the engine's dispatch
    // refuses, so EVERY `DELETE /sharing/rules/:idOrName` threw
    // 'Delete requires an ID or options.multi=true' and answered 500 before
    // it ever reached the rule row. Both address forms died on it, which left
    // an over-granting rule unrecoverable from the API surface once #4433 had
    // also closed the deactivation path.
    //
    // The fix routes through {@link purgeGrants} rather than adding
    // `multi: true` to the bulk call: it is the same revoke path every other
    // withdrawal already uses (`evaluateRule` on an inactive rule,
    // `revokeRuleGrants` after a data-API delete), so a rule's grants are
    // retired exactly one way — through `SharingService.revoke`, one row at a
    // time by scalar id — instead of two divergent ones. Adding `multi` here
    // would have fixed the 500 while keeping delete as the only withdrawal
    // that bypasses the sharing service (AGENTS.md PD #5).
    await this.purgeGrants(ruleGrantScope(row));
    await this.engine.delete('sys_sharing_rule', {
      where: { id: row.id },
      context: SYSTEM_CTX,
    } as any);
  }

  async evaluateRule(idOrName: string, context: ExecutionContext): Promise<SharingRuleReconcilePassResult> {
    this.assertCanManageRules(context); // [ADR-0111 D6]
    const rules = await this.resolveRules(idOrName, context);
    if (rules.length === 0) throw new Error('RULE_NOT_FOUND');
    if (rules.length === 1) return this.evaluateResolvedRule(rules[0]);
    // [ADR-0131 D2] A declared rule under a wall: one pass per organization's
    // projection, reported as the one rule it is.
    const total: SharingRuleReconcilePassResult = {
      ruleId: rules[0].id, matchedRecords: 0, expandedUsers: 0,
      grantsCreated: 0, grantsUpdated: 0, grantsRevoked: 0, grantsRefused: 0,
    };
    for (const rule of rules) {
      const pass = await this.evaluateResolvedRule(rule);
      total.matchedRecords += pass.matchedRecords;
      total.expandedUsers += pass.expandedUsers;
      total.grantsCreated += pass.grantsCreated;
      total.grantsUpdated += pass.grantsUpdated;
      total.grantsRevoked += pass.grantsRevoked;
      total.grantsRefused += pass.grantsRefused;
      if (pass.note) total.note = pass.note;
    }
    return total;
  }

  /** One rule's whole pass, the rule already resolved. */
  private async evaluateResolvedRule(rule: SharingRuleRow): Promise<SharingRuleReconcilePassResult> {
    if (!rule.active) {
      // Inactive — purge any leftover grants and report revoke count.
      const revoked = await this.purgeGrants(ruleGrantScope(rule));
      // [#14754] An inactive rule attempts no grant, so it can refuse none.
      return { ruleId: rule.id, matchedRecords: 0, expandedUsers: 0, grantsCreated: 0, grantsUpdated: 0, grantsRevoked: revoked, grantsRefused: 0 };
    }
    // [#15072] One whole-rule pass whatever the recipient kind: the desired
    // set is derived per kind ({@link desiredGrantsForRule}) and the diff is
    // shared. This is the primitive behind the background re-grant
    // (`rule-hooks.ts` `revokeThenQueueRegrant` → `evaluateAllRulesForObject`),
    // the `kernel:bootstrapped` backfill and the REST evaluate endpoint — so a
    // `field` rule is either right here or wrong after every unbounded bulk
    // write and every restart.
    return this.reconcile(rule, await this.desiredGrantsForRule(rule));
  }

  /**
   * Revoke every grant this rule materialised, without needing the rule row to
   * still exist. `evaluateRule` throws `RULE_NOT_FOUND` once the row is gone,
   * so a rule DELETED through the plain data API (which is what the Setup UI's
   * delete action issues — it never reaches {@link deleteRule}) would otherwise
   * leave its grants behind forever (objectstack#3821).
   */
  async revokeRuleGrants(ruleId: string): Promise<number> {
    return this.purgeGrants({ source: 'rule', source_id: ruleId });
  }

  /**
   * [#4433] Revoke every `source: 'rule'` grant whose `source_id` no longer
   * resolves to a rule row at all, and report how many went.
   *
   * Reconciling the rules themselves — which the boot backfill now does for
   * inactive rules too — can only reach grants some surviving rule still
   * claims. A grant whose rule row is GONE is unreachable that way: there is
   * nothing left to iterate. Those orphans are exactly the rows #4433 found
   * still answering after a restart, and they arise from every path that
   * removes a rule without going through {@link deleteRule} — a data-API
   * delete while the reconcile hook was unbound, a row dropped by a migration
   * or by hand, a crash between the two writes in `deleteRule`. Sweeping at
   * boot is what makes "the rule is gone" and "its access is gone" the same
   * statement no matter which path removed it.
   *
   * Reads the rule ids first and diffs in memory: the grant table is the big
   * one, and a per-grant existence probe would be one query per row.
   */
  async sweepOrphanedRuleGrants(): Promise<number> {
    const ruleRows = await this.engine.find('sys_sharing_rule', {
      fields: ['id'],
      limit: 100000,
      context: SYSTEM_CTX,
    });
    const live = new Set<string>();
    for (const r of (ruleRows ?? [])) live.add(String((r as any).id));
    // [ADR-0131 D2] A declared rule's grants carry its NAME, and they are live
    // exactly where it is served: deployment-wide (every organization's
    // records — {@link DeploymentWideSharingRule}) under `single`, its
    // organization's own grants under a wall. A declaration removed from the
    // code, or answered in an organization by a row of its name, leaves grants
    // no projection claims — swept here.
    const liveDeclared = new Set<string>();
    for (const rule of await this.declaredRules(SYSTEM_CTX, {})) {
      if (isDeploymentWideSharingRule(rule)) live.add(rule.id);
      else liveDeclared.add(`${rule.id}::${rule.organization_id}`);
    }
    // Unknown scopes: where a declared rule is served is not known, so none of
    // its name-keyed grants can be judged orphaned — every declared name is
    // held live. A grant revoked on a failed read is lost access; one held back
    // is re-judged by the next boot that reads the organizations.
    if (this.declaredScopes === null && this.declaredSource) {
      const declaredNames = (await this.declaredSource.list()).map((r) => r.name);
      for (const name of declaredNames) live.add(name);
      if (declaredNames.length > 0 && !this.unknownScopesSweepWarned) {
        this.unknownScopesSweepWarned = true;
        this.logger?.warn?.(
          '[sharing-rule] the organizations could not be enumerated, so no declared sharing rule is served and ' +
            'none of their grants is revoked by the orphaned-grant sweep; the standing grants keep answering. ' +
            'Remedy: restore read access to sys_organization and restart.',
          { declaredRules: declaredNames.length },
        );
      }
    }

    const grants = await this.engine.find('sys_record_share', {
      where: { source: 'rule' },
      fields: ['id', 'source_id', 'organization_id'],
      limit: 100000,
      context: SYSTEM_CTX,
    });
    let revoked = 0;
    for (const g of (grants ?? [])) {
      const sourceId = (g as any).source_id;
      // A `source: 'rule'` row with no `source_id` names no rule that could
      // ever re-grant it — equally unreachable, equally void.
      if (sourceId != null && live.has(String(sourceId))) continue;
      if (sourceId != null && liveDeclared.has(`${String(sourceId)}::${String((g as any).organization_id)}`)) continue;
      await this.sharing.revoke(String((g as any).id), SYSTEM_CTX);
      revoked += 1;
    }
    if (revoked > 0) {
      this.logger?.warn?.(
        '[sharing-rule] revoked rule grants whose rule row no longer exists',
        { grants: revoked },
      );
    }
    return revoked;
  }

  /**
   * Reconcile every rule on `object` against ONE record — the per-record pass
   * the afterInsert/afterUpdate hooks run.
   *
   * [#4433] Deliberately lists ALL rules, not just active ones. Filtering to
   * `activeOnly` here meant a deactivated rule was simply absent from the
   * loop, so the grants it had already materialised were never even looked
   * at: touching the record — the very event that created the grant — walked
   * straight past it. An inactive rule is not "no rule", it is a rule whose
   * desired grant set is EMPTY, and only by reconciling it can the stale rows
   * be revoked. `match: false` for an inactive rule sends `reconcileForRecord`
   * down its existing revoke-the-remainder branch, so nothing new is needed to
   * withdraw them.
   */
  async evaluateAllForRecord(
    object: string,
    recordId: string,
    context: ExecutionContext,
  ): Promise<SharingRuleReconcilePassResult[]> {
    const rules = await this.listRules({ object }, context);
    if (rules.length === 0) return [];
    const results: SharingRuleReconcilePassResult[] = [];
    // [commit 04d03c3a0] ONE pass, so N rules naming the same position pay ONE catalogue
    // read — and the memo dies with this call, so the next pass re-reads and a
    // deactivation is honoured immediately.
    const pass: RuleEvaluationPass = {};
    for (const rule of rules) {
      // An inactive rule desires nothing; skip the criteria query entirely.
      // [#15072] The match read answers with the ROW, not a boolean: for a
      // `field` rule the recipients are on it, read by the per-record switch.
      const matched = rule.active ? await this.matchRecord(rule, recordId) : null;
      const users = matched ? await this.expandRecipientForRecord(rule, matched, pass) : [];
      results.push(await this.reconcileForRecord(rule, recordId, matched !== null, users));
    }
    return results;
  }

  /**
   * [#4779] Reconcile EVERY rule bound to `object` — the object-scoped twin of
   * the `kernel:bootstrapped` backfill.
   *
   * This is the re-grant half of the ruling's option C: after a bulk write
   * whose row set could not be bounded has had its grants revoked set-based,
   * this pass puts back the grants that are still deserved. Per RULE rather
   * than per row, deliberately — `evaluateRule` already diffs the whole
   * matched set against the whole existing grant set in one pass, which is
   * both cheaper than N per-row reconciles and the exact primitive the boot
   * backfill uses, so the asynchronous repair and the restart repair are the
   * same code path rather than two that must be kept agreeing.
   *
   * Inactive rules are included: `evaluateRule` purges their grants (#4433),
   * so excluding them would leave withdrawal to the next restart. Best-effort
   * per rule — one broken rule must not stop its siblings being restored.
   */
  async evaluateAllRulesForObject(object: string): Promise<number> {
    if (!object) return 0;
    const rules = await this.listRules({ object }, SYSTEM_CTX);
    let reconciled = 0;
    for (const rule of rules) {
      try {
        // The listed rule itself, not its id: a declared rule under a wall is
        // one projection per organization, all carrying one id.
        await this.evaluateResolvedRule(rule);
        reconciled += 1;
      } catch (err: any) {
        this.logger?.warn?.('[sharing-rule] object reconcile failed for rule', {
          object,
          rule: rule.name ?? rule.id,
          error: err?.message,
        });
      }
    }
    return reconciled;
  }

  /**
   * [#4779] Revoke every rule-materialised grant on `object`, set-based.
   *
   * The cheap, uncapped half of the ruling: one predicate delete over
   * `sys_record_share`, whose cost does not grow with the number of records
   * the triggering write touched. It is what lets a bulk write proceed
   * without the recompute bound leaking out as a limit on how many rows an
   * admin may change — the write lands, every grant that may have gone stale
   * is gone before it returns, and {@link evaluateAllRulesForObject} puts
   * back the deserved ones asynchronously.
   *
   * `multi: true` is required, not decorative: `ObjectQL.delete` refuses a
   * predicate-shaped call that does not declare bulk intent
   * (`resolveEngineDeleteDispatch`), which is precisely the shape that made
   * every `DELETE /sharing/rules/:id` answer 500 in #4434.
   *
   * Only `source: 'rule'` rows are touched. A manual grant is a human's
   * decision about one record and no rule evaluation would ever re-create it,
   * so sweeping it here would destroy data this subsystem does not own.
   */
  async revokeRuleGrantsForObject(object: string): Promise<void> {
    if (!object) return;
    await this.engine.delete('sys_record_share', {
      where: { source: 'rule', object_name: object },
      multi: true,
      context: SYSTEM_CTX,
    } as any);
  }

  /**
   * [#4779] Revoke the rule-materialised grants of a NAMED set of records —
   * the delete path's revoke, where the rows are gone and no reconcile can
   * ever reach them again.
   *
   * Chunked because the id set rides in an `$in`, and a single statement
   * binding a thousand parameters is a portability trap (SQLite's default
   * `SQLITE_MAX_VARIABLE_NUMBER` is 999 on older builds). Chunking keeps this
   * O(ids/CHUNK) statements instead of O(ids), which is still set-based in
   * the sense that matters.
   */
  async revokeRuleGrantsForRecords(object: string, recordIds: readonly string[]): Promise<void> {
    if (!object || recordIds.length === 0) return;
    const CHUNK = 200;
    for (let i = 0; i < recordIds.length; i += CHUNK) {
      const batch = recordIds.slice(i, i + CHUNK);
      await this.engine.delete('sys_record_share', {
        where: { source: 'rule', object_name: object, record_id: { $in: batch } },
        multi: true,
        context: SYSTEM_CTX,
      } as any);
    }
  }

  /**
   * [#7729] Revoke this rule's grants whose RECIPIENT the rule no longer
   * expands to — the recipient-axis twin of
   * {@link revokeRuleGrantsForRecords}.
   *
   * ## Why a third revoke, and why on this axis
   *
   * The two revokes above are both scoped by RECORD, because the writes that
   * drove them were writes to records. A business-unit re-parent or a
   * membership edit touches no record at all: what changes is who
   * {@link expandRecipient} resolves to, and therefore which of the rule's
   * already-materialised grants have gone stale. Scoping that withdrawal by
   * record would mean enumerating every record the rule matches — the very
   * scan {@link RULE_RECOMPUTE_ROW_CAP} exists because we cannot afford on a
   * write path. Scoping it by recipient needs no record scan at all: one query
   * for the rule's granted recipients, one recipient expansion, and a
   * chunked set-based delete of the difference.
   *
   * ## Cheap enough to be the SYNCHRONOUS half
   *
   * This is the safety half of the same split the #4779 ruling settled
   * (over-granting is a security incident, under-granting is an availability
   * wobble): complete and synchronous on the write path, with the expensive
   * re-grant deferred to {@link evaluateRule} on the shared re-grant queue.
   * A BU moved OUT of a shared subtree therefore loses its members' access
   * before the write returns, rather than at the shared record's next write —
   * which was unbounded in time, and is what #7729 was filed for.
   *
   * The `granted.size === 0` short-circuit is load-bearing, not an
   * optimisation: it is what keeps boot-time BU seeding (thousands of member
   * inserts against an empty `sys_record_share`) from paying a subtree walk
   * per row.
   *
   * An INACTIVE rule expands to nobody, so every grant it still holds is
   * stale — the same verdict {@link evaluateRule} reaches by a longer road
   * (#4433), reached here without one.
   *
   * Deletes set-based rather than through `SharingService.revoke`, following
   * {@link revokeRuleGrantsForObject} / {@link revokeRuleGrantsForRecords}:
   * under a system context `revoke` is itself a scalar-id delete with no
   * event and no audit trail, so per-row revocation would buy nothing and
   * cost one statement per grant on a path whose whole justification is that
   * it stays cheap. Chunked at 200 for the same `$in` portability reason.
   *
   * @returns how many RECIPIENTS were retired (not how many rows went).
   */
  async revokeRuleGrantsForRetiredRecipients(rule: SharingRuleRow): Promise<number> {
    if (!rule?.id) return 0;
    // [#15072] A `field` rule has NO rule-wide recipient set to diff against:
    // its recipients live on each matched record and are re-derived by that
    // record's own write ({@link evaluateAllForRecord}) and by the whole-rule
    // pass ({@link evaluateRule} → {@link desiredGrantsForRule}). Expanding it
    // "rule-wide" would answer nobody, and this method would then delete every
    // grant the rule still deserves — a mass revocation, on the recipient
    // axis, of grants that are all still correct. Its one production caller
    // (`bu-tree-recompute.ts`) filters on `BU_TREE_RECIPIENT_TYPES` and never
    // hands a `field` rule in; this guard is what makes that a contract rather
    // than a coincidence, and `field-recipient.test.ts` pins both halves.
    if (rule.recipient_type === 'field') return 0;
    const existing = await this.engine.find('sys_record_share', {
      where: ruleGrantScope(rule),
      fields: ['id', 'recipient_id'],
      limit: 100000,
      context: SYSTEM_CTX,
    });
    const granted = new Set<string>();
    for (const row of (existing ?? [])) {
      const rid = (row as any).recipient_id;
      if (rid != null && rid !== '') granted.add(String(rid));
    }
    if (granted.size === 0) return 0;

    const desired = rule.active ? new Set(await this.expandRecipient(rule)) : new Set<string>();
    const stale = [...granted].filter((recipientId) => !desired.has(recipientId));
    if (stale.length === 0) return 0;

    const CHUNK = 200;
    for (let i = 0; i < stale.length; i += CHUNK) {
      await this.engine.delete('sys_record_share', {
        where: {
          ...ruleGrantScope(rule),
          recipient_id: { $in: stale.slice(i, i + CHUNK) },
        },
        multi: true,
        context: SYSTEM_CTX,
      } as any);
    }
    return stale.length;
  }

  /**
   * Reconcile ONE rule's grants for ONE user — the user-scoped pass a
   * recipient-membership write runs (`recipient-membership-recompute.ts`): a
   * position assignment, a membership role, or a team membership row naming
   * `userId` was inserted, changed or removed.
   *
   * ## What it guarantees
   *
   * The outcome equals the whole-rule pass ({@link evaluateRule}) restricted to
   * `userId`. When the rule reaches the user, the user's grants of this rule
   * become exactly one per matched record at the rule's access level; when it
   * does not — the rule is inactive, its position is switched off, or the user
   * no longer holds its recipient — the user keeps none. A new holder gains the
   * rule's grants and a former holder loses them in the write that changed the
   * holding, with nobody re-evaluating the rule by hand. Every other user's
   * grants of the rule are untouched.
   *
   * ## Why per user, and why that is cheap enough to be synchronous
   *
   * The `bu-tree-recompute.ts` design refuses to recompute every rule on every
   * graph write, and queues its grant half, because a BU write can move many
   * recipients at once and the re-grant fans out to (matched records × moved
   * members). A membership row moves exactly ONE user. Scoped to that user the
   * pass costs one recipient check ({@link ruleReachesUser} — an indexed lookup
   * per source, never the recipient's whole member list), one read of that
   * user's grants of the rule, and — only when the rule reaches the user — one
   * criteria read plus a write per grant the user lacks. Nothing in it grows
   * with how many OTHER users hold the recipient, so a bulk import of N rows
   * costs N user-scoped passes, never N whole-rule passes.
   *
   * Withdrawal goes through `SharingService.revoke`, one grant at a time, as
   * the whole-rule pass's own withdrawal does ({@link reconcile}); a user holds
   * at most one grant per matched record, so the count is bounded by the
   * rule's matched set.
   *
   * A `field` rule has no rule-wide recipient to check a user against; its
   * recipients live on each record and are re-derived by that record's write
   * ({@link evaluateAllForRecord}), so it is declined here, as it is at
   * {@link revokeRuleGrantsForRetiredRecipients}' door.
   */
  async reconcileRuleForUser(rule: SharingRuleRow, userId: string): Promise<SharingRuleReconcilePassResult> {
    const pass: SharingRuleReconcilePassResult = {
      ruleId: rule?.id,
      matchedRecords: 0,
      expandedUsers: 0,
      grantsCreated: 0,
      grantsUpdated: 0,
      grantsRevoked: 0,
      grantsRefused: 0,
    };
    if (!rule?.id || !userId || rule.recipient_type === 'field') return pass;

    const scope = { ...ruleGrantScope(rule), recipient_id: userId };
    const existing = await this.engine.find('sys_record_share', {
      where: scope,
      fields: ['id', 'record_id', 'access_level'],
      limit: 100000,
      context: SYSTEM_CTX,
    });
    const held = new Map<string, any>();
    for (const row of (existing ?? [])) held.set(String((row as any).record_id), row);

    if (!(await this.ruleReachesUser(rule, userId, {}))) {
      for (const [, row] of held.entries()) {
        await this.sharing.revoke(String(row.id), SYSTEM_CTX);
        pass.grantsRevoked += 1;
      }
      return pass;
    }

    pass.expandedUsers = 1;
    const matchedIds = await this.findMatchingRecords(rule);
    pass.matchedRecords = matchedIds.length;
    let skipped = 0;
    for (const recordId of matchedIds) {
      const cur = held.get(recordId);
      if (cur) {
        // Out of the stale set BEFORE the attempt — the twin of the note in
        // {@link reconcile}: a refused level update leaves the desired row.
        held.delete(recordId);
        if (cur.access_level === rule.access_level) continue;
        const outcome = await this.grantOrAbsorbOrganizationRefusal(rule, recordId, userId);
        if (outcome === 'granted') pass.grantsUpdated += 1;
        else if (outcome === 'refused') pass.grantsRefused += 1;
        else skipped += 1;
      } else {
        const outcome = await this.grantOrAbsorbOrganizationRefusal(rule, recordId, userId);
        if (outcome === 'granted') pass.grantsCreated += 1;
        else if (outcome === 'refused') pass.grantsRefused += 1;
        else skipped += 1;
      }
    }
    // The user's grants on records the rule no longer matches — what the
    // whole-rule pass would revoke for this user too.
    for (const [, stale] of held.entries()) {
      await this.sharing.revoke(String(stale.id), SYSTEM_CTX);
      pass.grantsRevoked += 1;
    }
    return this.withInternalHalfNote(rule, pass, skipped);
  }

  // ── internals ─────────────────────────────────────────────────────

  /**
   * Is `userId` among the users `rule` expands to? The user-scoped twin of
   * {@link expandRecipient}, used by {@link reconcileRuleForUser}.
   *
   * `position` and `team` — the two kinds a membership write moves — are
   * answered by the graph services' user-scoped checks
   * (`PositionGraphService.holdsPosition`, `teamHasMember`), which read the
   * same rows the expansion reads, narrowed to one user. A `position` passes
   * the same activation gate first ({@link positionConfersAccess}): a
   * switched-off position reaches nobody. Every other kind is answered from the
   * rule-wide expansion itself.
   */
  private async ruleReachesUser(rule: SharingRuleRow, userId: string, pass: RuleEvaluationPass): Promise<boolean> {
    if (!rule.active) return false;
    if (rule.recipient_type === 'position') {
      if (!(await this.positionConfersAccess(rule.recipient_id, pass))) return false;
      const positionGraph = new PositionGraphService({
        engine: this.engine,
        organizationId: rule.organization_id ?? null,
      });
      return positionGraph.holdsPosition(userId, rule.recipient_id, rule.organization_id ?? undefined);
    }
    if (rule.recipient_type === 'team') return teamHasMember(this.engine, rule.recipient_id, userId);
    return (await this.expandRecipient(rule, pass)).includes(userId);
  }

  /**
   * [#3896] ADR-0049 backstop, evaluated on EVERY pass rather than only at
   * authoring time: `defineRule` now rejects a match-all criteria, but rows
   * predating that gate — or written straight to `sys_sharing_rule` through
   * the data API (what the Setup UI's create action issues) — are already in
   * the table. Such a rule matches NOTHING and says so in the log, so the
   * next reconcile revokes whatever it had granted instead of re-granting the
   * whole object. Under-sharing loudly beats over-sharing silently.
   */
  private isInertMatchAll(rule: SharingRuleRow): boolean {
    if (!isMatchAllCriteria(rule.criteria)) return false;
    const key = String(rule.id ?? rule.name);
    if (!this.inertRuleSeen.has(key)) {
      this.inertRuleSeen.add(key);
      this.logger?.warn?.(
        '[sharing-rule] rule has no usable criteria — matching NO records instead of every record ' +
          '(ADR-0049; logged once per rule per process — fix the criteria or set active: false)',
        { rule: rule.name, object: rule.object_name },
      );
    }
    return true;
  }

  /** Names of inert (criteria-less) rules seen so far — the boot aggregate reads this. */
  get inertRuleNames(): readonly string[] {
    return [...this.inertRuleSeen];
  }

  /**
   * [#10119] The context the rule's CRITERIA query runs under — system
   * elevation, plus the rule's OWN organization when it has one; `null` when
   * the rule may sweep nowhere.
   *
   * ## What was wrong
   *
   * Both criteria reads used a bare {@link SYSTEM_CTX}, which carries no
   * tenant, for EVERY rule. The recipient half is already org-aware —
   * {@link expandRecipient} threads `rule.organization_id` into
   * `TeamGraphService` / `BusinessUnitGraphService` / `PositionGraphService` —
   * so an org-stamped rule expanded recipients inside its own organization and
   * then swept every OTHER organization's records for matches. `reconcile`
   * materialised the cross product: `sys_record_share` rows granting one org's
   * users access to another org's records.
   *
   * Those rows are inert under a walled posture (Layer 0 AND-composes over
   * sharing's Layer-1 widening), which is why this was found by reading the
   * materialised table rather than by a read crossing the wall. What they cost
   * is `sys_record_share` bloat — every org-stamped rule scanning the whole
   * table at `limit: 5000` — and a population that is wrong at rest, which any
   * consumer reading `sys_record_share` directly would inherit.
   *
   * ## Why `tenantId` and not a `filter` clause
   *
   * `tenantId` is the platform's ONE spelling of tenant scope on a read: the
   * engine threads it to `DriverOptions.tenantId` and the driver's own
   * chokepoint (`SqlDriver.applyTenantScope`) applies the posture's one
   * predicate (ADR-0131 D8). Open-coding an `organization_id` equality into
   * `filter` would be a second, worse copy — it would collide with a rule
   * whose criteria already name that column, and it would not know the
   * object's declared tenant field.
   *
   * ## [ADR-0131 D2/D8] Deployment-wide is a typed marker, never a NULL
   *
   * The organization-less branch that answered "no organization ⇒ unscoped
   * sweep" is retired. What it served is now one of three named cases:
   *
   * - **The rule has an organization** — an organization-authored row, or a
   *   declared rule's projection under a wall: the sweep runs inside that
   *   organization's one predicate.
   * - **A {@link DeploymentWideSharingRule}** — a declared rule under
   *   `single`: no tenant, which is exactly the predicate D8 computes under
   *   `single` (none), so Layer 0 is not widened by a single row. Under a wall
   *   no projection carries the marker ({@link projectDeclaredRule}).
   * - **A composition with no organization object** (a lean embedding,
   *   `resolveSystemWriteOrganization`'s `no-organization-object`): there are
   *   no organizations to scope by, so every rule is the deployment's.
   *
   * Anything else is a STORED row with no organization in a deployment that
   * has organizations. Certification leaves none and the engine stamps or
   * refuses every new one (D9/D10), so it is invalid state: `null` here, and
   * the caller sweeps nothing and grants nothing ({@link sweepContextOrReport}
   * says so once). ⛔ Never default it to the deployment-wide sweep — that is
   * the NULL arm this replaced, and it is how one row came to grant across
   * every organization.
   *
   * `isSystem` is retained either way. The elevation and the tenant are
   * different axes (`ObjectQLEngine.buildDriverOptions` reads them separately):
   * the evaluator must still see rows no individual recipient could, it must
   * just stop seeing rows the RULE has no business in.
   *
   * ## [commit 3f64fe6c6] The same context is what the grant is WRITTEN under
   *
   * `reconcile` / `reconcileForRecord` hand this context to
   * `SharingService.grant`, which stamps `sys_record_share.organization_id`
   * from it (ruled 2026-09-02: a rule-materialised grant carries the rule's
   * organization). One context for the sweep and for the write is what keeps
   * the two agreeing — the grant lands in the organization whose records the
   * rule was allowed to sweep. A deployment-wide rule threads none, and its
   * grants belong where each record does; `grant` derives that from the record.
   *
   * Both postures of a declared rule, and the refused row, are pinned in
   * `rule-criteria-org-scope.test.ts`.
   */
  private criteriaContext(rule: SharingRuleRow): ExecutionContext | null {
    const orgId = rule.organization_id;
    if (typeof orgId === 'string' && orgId !== '') return { ...SYSTEM_CTX, tenantId: orgId };
    if (isDeploymentWideSharingRule(rule) || !this.organizationsComposed()) return SYSTEM_CTX;
    return null;
  }

  /**
   * Does this composition register the organization object? Read from the
   * engine's schema registry — the same fact `resolveSystemWriteOrganization`
   * separates `no-organization-object` by. An engine that cannot answer is
   * read as composing organizations: the reading that refuses, never the one
   * that sweeps every organization.
   */
  private organizationsComposed(): boolean {
    if (typeof this.engine.getSchema !== 'function') return true;
    return !!this.engine.getSchema(ORGANIZATION_OBJECT);
  }

  /**
   * {@link criteriaContext}, or `null` with the refusal reported — once per
   * rule per process, at `error`: the rule looks configured and grants
   * nothing, which is the degradation an operator cannot see otherwise.
   */
  private sweepContextOrReport(rule: SharingRuleRow): ExecutionContext | null {
    const ctx = this.criteriaContext(rule);
    if (ctx) return ctx;
    const key = String(rule.id ?? rule.name);
    if (!this.organizationlessRuleReported.has(key)) {
      this.organizationlessRuleReported.add(key);
      const message =
        `[sharing-rule] sharing rule '${rule.name ?? rule.id}' is a stored row with no organization, so its ` +
        'criteria are not swept and it grants nothing: a stored rule belongs to the organization that authored ' +
        'it, and only a rule declared in the application is deployment-wide. Remedy: run the organization-' +
        'ownership upgrade ceremony, which attributes the row to its organization, or delete the row and ' +
        'author the rule in its organization.';
      const meta = { rule: rule.name ?? rule.id, id: rule.id, object: rule.object_name };
      if (this.logger?.error) this.logger.error(message, meta);
      else this.logger?.warn?.(message, meta);
    }
    return null;
  }

  private async findMatchingRecords(rule: SharingRuleRow): Promise<string[]> {
    const rows = await this.findMatchingRows(rule, ['id']);
    return rows.map((r: any) => String(r.id)).filter(Boolean);
  }

  /**
   * [#15072] The rule's matched ROWS with `fields` projected — `['id']` for
   * every rule-wide recipient, `['id', <the user column>]` for a `field`
   * rule, whose recipients are read off these very rows
   * ({@link desiredGrantsForRule}).
   */
  private async findMatchingRows(rule: SharingRuleRow, fields: string[]): Promise<Record<string, unknown>[]> {
    if (this.isInertMatchAll(rule)) return [];
    // [#10119] The rule's own organization, when it has one — and nowhere
    // when it may sweep nowhere (ADR-0131 D8, {@link criteriaContext}).
    const context = this.sweepContextOrReport(rule);
    if (!context) return [];
    const filter = (rule.criteria ?? {}) as any;
    try {
      const rows = await this.engine.find(rule.object_name, {
        filter,
        fields,
        limit: 5000,
        context,
      });
      return Array.isArray(rows) ? rows : [];
    } catch (err: any) {
      this.logger?.warn?.('[sharing-rule] criteria query failed', { rule: rule.name, error: err?.message });
      return [];
    }
  }

  /**
   * The per-record half of the criteria read: the matched ROW, or `null`.
   *
   * [#15072] Was `recordMatches(): boolean`. It answers with the row because
   * a `field` rule's recipients are ON it — the match read projects that
   * column beside `id`, so one query answers "does this record match" and
   * "whom does it name" together and the two can never be read from two
   * versions of the row. Every other kind still projects `id` alone.
   */
  private async matchRecord(rule: SharingRuleRow, recordId: string): Promise<Record<string, unknown> | null> {
    if (this.isInertMatchAll(rule)) return null;
    const context = this.sweepContextOrReport(rule);
    if (!context) return null;
    const filter = { ...((rule.criteria ?? {}) as any), id: recordId };
    const fields = rule.recipient_type === 'field' ? ['id', rule.recipient_id] : ['id'];
    try {
      const rows = await this.engine.find(rule.object_name, {
        filter,
        fields,
        limit: 1,
        // [#10119] Same scope as the whole-rule sweep — see
        // {@link criteriaContext}. A per-record hook pass that stayed
        // unscoped would re-mint, one write at a time, exactly the cross-org
        // rows the sweep no longer creates.
        context,
      });
      return Array.isArray(rows) && rows[0] ? (rows[0] as Record<string, unknown>) : null;
    } catch (err: any) {
      // [#15072] For a `field` rule the read carries the recipient column, so
      // a failure here is most likely the rule naming a column the object
      // does not have (`INVALID_FIELD`) — an authoring defect that must be
      // loud (ADR-0078), once per rule. The verdict stays fail-closed: no
      // match, no grant, and the record's stale grants are revoked.
      if (rule.recipient_type === 'field') this.warnFieldRuleOnce(rule, 'read-failed', err?.message);
      return null;
    }
  }

  /**
   * [#15072] The recipients of ONE matched record — the per-record switch.
   *
   * `field` is the only member expanded here (maintainer ruling 2026-09-02 on
   * #14103, B: "`expandRecipient` becomes per-record for that member only"):
   * the user or users the row's named column holds. Every other member is the
   * rule-wide expansion, memoised across the pass exactly as before
   * ({@link expandRecipient}).
   */
  private async expandRecipientForRecord(
    rule: SharingRuleRow,
    row: Record<string, unknown>,
    pass: RuleEvaluationPass,
  ): Promise<string[]> {
    if (rule.recipient_type !== 'field') return this.expandRecipient(rule, pass);
    return this.recipientsNamedOnRecord(rule, row);
  }

  /**
   * [#15072] Whom `row`'s recipient column names, fail-closed
   * ({@link usersNamedBy}) — once the column has been judged usable
   * ({@link fieldRecipientColumnIsUsable}).
   */
  private recipientsNamedOnRecord(rule: SharingRuleRow, row: Record<string, unknown>): string[] {
    if (!this.fieldRecipientColumnIsUsable(rule)) return [];
    return usersNamedBy(row[rule.recipient_id]);
  }

  /**
   * [#15072] Does the object DECLARE the column a `field` rule names as one
   * that holds users? Judged from the registry on every call — a metadata
   * reload may add the column, and a verdict cached at boot would outlive it
   * (AGENTS.md "Startup registry reads") — and warned about once per rule.
   *
   * Three answers:
   *  - the engine cannot say (no `getSchema`, or an object it does not
   *    resolve) → the column is READ. Absence of a schema is absence of
   *    evidence, and the declared semantics are the column's value.
   *  - declared, and user-typed ({@link fieldHoldsUsers}) → read.
   *  - declared but absent, or of another type → NOBODY, and one warn naming
   *    the rule and the column. A rule that grants nobody in silence is the
   *    authoring trap ADR-0078 names, and a `text` column read as user ids
   *    would grant to whatever strings the records happen to hold.
   */
  private fieldRecipientColumnIsUsable(rule: SharingRuleRow): boolean {
    if (typeof this.engine.getSchema !== 'function') return true;
    const schema = this.engine.getSchema(rule.object_name);
    const fields = schema?.fields;
    if (!fields || typeof fields !== 'object') return true;
    const def = (fields as Record<string, unknown>)[rule.recipient_id];
    if (fieldHoldsUsers(def)) return true;
    this.warnFieldRuleOnce(rule, def ? 'not-user-typed' : 'no-such-field');
    return false;
  }

  /**
   * [#15072] An active `field` rule whose recipient column cannot be read as
   * users says so — once per rule per cause ({@link fieldRuleWarned}). An
   * EMPTY column is deliberately not a cause: an unassigned record sharing
   * with nobody is the declared semantics, not a misconfiguration.
   */
  private warnFieldRuleOnce(
    rule: SharingRuleRow,
    cause: 'no-such-field' | 'not-user-typed' | 'read-failed',
    detail?: string,
  ): void {
    const key = `${String(rule.id ?? rule.name)}::${cause}`;
    if (this.fieldRuleWarned.has(key)) return;
    this.fieldRuleWarned.add(key);
    this.logger?.warn?.(
      '[sharing-rule] active field-recipient rule grants NOBODY — its recipient column cannot be read as ' +
        'users (logged once per rule per process). The rule must name a field of the shared object that ' +
        'exists and holds users (a user field, or a lookup to sys_user); fix the field name or set active: false',
      {
        rule: rule.name ?? rule.id,
        object: rule.object_name,
        recipientType: rule.recipient_type,
        field: rule.recipient_id,
        cause,
        ...(detail ? { error: detail } : {}),
      },
    );
  }

  /**
   * [#15072] Every grant a whole-rule pass wants to exist, derived per
   * recipient kind — the one place the rule-wide and the per-record members
   * meet, so {@link reconcile} never has to know which it is diffing.
   *
   * Rule-wide members: the matched ids × ONE recipient expansion — the
   * cartesian product `evaluateRule` always materialised, and a `position`
   * recipient still expands exactly once per rule here (the ruling's explicit
   * pin). `field`: the matched ROWS, each contributing a (record, user) pair
   * for every user its own column names — no product, because there is no
   * rule-wide recipient list to multiply by. `expandedUsers` for that kind is
   * the number of DISTINCT users across the matched records.
   */
  private async desiredGrantsForRule(rule: SharingRuleRow): Promise<DesiredGrantSet> {
    const desired = new Map<string, DesiredGrant>();
    if (rule.recipient_type === 'field') {
      const rows = (await this.findMatchingRows(rule, ['id', rule.recipient_id]))
        .filter((r) => r.id != null && String(r.id) !== '');
      const users = new Set<string>();
      for (const row of rows) {
        const recordId = String(row.id);
        for (const userId of this.recipientsNamedOnRecord(rule, row)) {
          desired.set(`${recordId}::${userId}`, { record_id: recordId, recipient_id: userId });
          users.add(userId);
        }
      }
      return { desired, matchedRecords: rows.length, expandedUsers: users.size };
    }
    const matchedIds = await this.findMatchingRecords(rule);
    const users = await this.expandRecipient(rule);
    for (const recordId of matchedIds) {
      for (const userId of users) desired.set(`${recordId}::${userId}`, { record_id: recordId, recipient_id: userId });
    }
    return { desired, matchedRecords: matchedIds.length, expandedUsers: users.length };
  }

  /**
   * The RULE-WIDE recipient expansion — "the one switch that decides"
   * (`bu-tree-recompute.ts`), answered once per rule per pass.
   *
   * [#15072] `field` is deliberately NOT a case here, and asking for it is an
   * error rather than an empty answer. A `field` recipient (maintainer ruling
   * 2026-09-02 on #14103, B) is the user or users a column on EACH MATCHED
   * RECORD names, so it has no rule-wide expansion at all — and answering `[]`
   * (what the `queue` fallthrough below would have done) is precisely how a
   * rule-wide caller turns "per record" into "nobody": `reconcile` would then
   * revoke every grant, and `revokeRuleGrantsForRetiredRecipients` would
   * retire every recipient. The three callers each decide explicitly: a
   * caller with a record in hand goes through {@link expandRecipientForRecord};
   * the whole-rule pass derives per-record pairs in {@link desiredGrantsForRule};
   * the recipient-axis revoke declines `field` at its door. Reaching this
   * throw is a programming error, and it is loud so that it stays one.
   */
  private async expandRecipient(rule: SharingRuleRow, pass: RuleEvaluationPass = {}): Promise<string[]> {
    if (rule.recipient_type === 'field') {
      // The card: #15072. Kept out of the string — a runtime message reaches
      // readers who cannot resolve a tracker id (check:doc-authoring).
      throw new Error(
        `[sharing-rule] rule '${rule.name ?? rule.id}' has a field recipient, which expands per RECORD — ` +
          'there is no rule-wide expansion to answer',
      );
    }
    const team = new TeamGraphService({
      engine: this.engine,
      organizationId: rule.organization_id ?? null,
    });
    if (rule.recipient_type === 'user') return [rule.recipient_id];
    if (rule.recipient_type === 'team') return team.expandUsers(rule.recipient_id);
    if (rule.recipient_type === 'business_unit') {
      // [#7807] EXACTLY ONE unit's members — no subtree descent. The spec
      // (`ShareRecipientType`), the lint red-line table and ADR-0057 D5 all
      // declare this kind as "exactly one business unit's members (no
      // subtree)"; this branch used to call `expandUsers`, the SAME subtree
      // walk `unit_and_subordinates` below uses, so the two kinds differed
      // only in their comments and a rule anchored at a division silently
      // reached every department and office beneath it.
      //
      // ⛔ Do not "simplify" this back into a shared call with the branch
      // below. The two widths are the contract: `unit_and_subordinates` is
      // the strictly WIDER grant of the pair, and it is only wider while this
      // one stays narrow.
      const dept = new BusinessUnitGraphService({
        engine: this.engine,
        organizationId: rule.organization_id ?? null,
        teamGraph: team,
      });
      const members = await dept.expandUnitMembers(rule.recipient_id);
      this.warnOnEmptyUnitExpansion(rule, members);
      return members;
    }
    if (rule.recipient_type === 'position') {
      // [commit 04d03c3a0] A DEACTIVATED position confers NOTHING — checked before the
      // expansion, not after it, so the rule's desired grant set is empty and
      // the reconcilers' existing revoke-the-remainder branches retract what it
      // already materialised. See {@link positionConfersAccess}.
      if (!(await this.positionConfersAccess(rule.recipient_id, pass))) {
        return [];
      }
      // ADR-0090 D3 — positions are flat; expand holders via the platform
      // assignment table (source of truth, ADR-0057 D4) ∪ the better-auth
      // membership string (transition window).
      const positionGraph = new PositionGraphService({
        engine: this.engine,
        organizationId: rule.organization_id ?? null,
        teamGraph: team,
      });
      return positionGraph.expandPositionUsers(rule.recipient_id, rule.organization_id ?? undefined);
    }
    if (rule.recipient_type === 'unit_and_subordinates') {
      // ADR-0057 D5 (finalized by ADR-0090 D3) — hierarchy widening is
      // re-homed onto the BUSINESS-UNIT subtree: the unit named by
      // `recipient_id` plus every descendant unit's members. The former
      // position-tree walk queried a `parent` column that never existed.
      //
      // This is the WIDE half of the pair (#7807) and keeps the subtree walk
      // unchanged — `expandUsers` is the contract's descendant expansion.
      const dept = new BusinessUnitGraphService({
        engine: this.engine,
        organizationId: rule.organization_id ?? null,
        teamGraph: team,
      });
      const members = await dept.expandUsers(rule.recipient_id);
      this.warnOnEmptyUnitExpansion(rule, members);
      return members;
    }
    // queue — v1 stores literal; treat as no-op until queue impl lands.
    return [];
  }

  /**
   * [#14547] An ACTIVE business-unit rule that expands to NOBODY says so.
   *
   * This is the half of #14547 that is independent of any screen. The reported
   * failure was not merely that the expansion was empty — it was that nothing
   * anywhere recorded it: the rule was accepted (201), stayed `active: true`,
   * materialised zero `sys_record_share` rows and logged nothing, so the only
   * observable was "the right people cannot see the record", arbitrarily far
   * from the cause and indistinguishable from a criteria mistake, a
   * permission-set mistake or a UI bug.
   *
   * It also covers the case the screens deliberately leave empty: a rule
   * stamped with an organization whose unit AND membership rows were both
   * seeded expands to nobody, because an org-less membership row is of unknown
   * tenancy and is not a member of an org-scoped rule
   * ({@link BusinessUnitGraphService} → `memberScope`). Failing closed is the
   * right answer; failing closed in silence is not.
   *
   * Both business-unit recipient kinds route here, and only they: a `user`
   * recipient cannot be empty, and `team` / `position` / `queue` have their own
   * reasons for an empty set that this issue did not measure. ⛔ Do not widen
   * this into "warn whenever any recipient expands to zero" without measuring
   * those — `queue` expands to `[]` by construction today, so a blanket warn
   * would fire on every pass of every queue rule, and a `field` rule's empty
   * column is a legitimate state (an unassigned record shares with nobody,
   * #15072), not a misconfiguration.
   *
   * Named completely: the rule, the object, the recipient kind, the unit, the
   * organization, and the two causes worth checking first. Once per rule per
   * process ({@link emptyUnitExpansionSeen}).
   */
  private warnOnEmptyUnitExpansion(rule: SharingRuleRow, users: readonly string[]): void {
    if (users.length > 0) return;
    if (rule.active === false) return;
    const key = `${String(rule.id ?? rule.name)}::${String(rule.recipient_id ?? '')}`;
    if (this.emptyUnitExpansionSeen.has(key)) return;
    this.emptyUnitExpansionSeen.add(key);
    this.logger?.warn?.(
      '[sharing-rule] active business-unit rule expands to NO recipients — it grants nobody and ' +
        'will materialise no shares (logged once per rule per process). Check that the business ' +
        'unit exists and is active, and that its `sys_business_unit_member` rows carry the same ' +
        'organization_id as the rule — membership rows written by seed replay or by an elevated ' +
        'system write are not organization-stamped, and are not members of an org-scoped rule',
      {
        rule: rule.name ?? rule.id,
        object: rule.object_name,
        recipientType: rule.recipient_type,
        businessUnit: rule.recipient_id,
        organization: rule.organization_id ?? null,
      },
    );
  }

  /**
   * [commit 04d03c3a0] Does `positionName` still CONFER access? Memoised for
   * the pass; the extra read is accepted.
   *
   * Maintainer ruling, 2026-08-15, verbatim:
   *
   * > Access-conferring paths filter deactivated positions; addressing paths
   * > do not.
   *
   * A sharing rule is an access-conferring path. The grant is authored on the
   * RULE, which is why the position here reads like a directory selector — but
   * what the rule produces is a `sys_record_share`, and a record share is
   * access. The `deactivate_position` dialog promises, unqualified, that "users
   * keep their assignment but the position stops granting permissions until
   * re-activated"; #8613 made that true at the authorization DERIVATION seam
   * (`resolveAuthzContext`), and a sharing rule reaches users by a second road
   * that never passes it.
   *
   * ⛔ The filter lives HERE, at the call site, and must never move down into
   * `PositionGraphService.expandPositionUsers`. That helper answers "who holds
   * position P" — an ADDRESSING question, whose other consumers the same ruling
   * deliberately leaves unfiltered: approval ROUTING, where dropping the
   * holders is fail-OPEN (a step routing to nobody), and plugin-security's
   * write gates / blast-radius reads, where dropping a deactivated row makes a
   * refused binding permitted and narrows a delegate's boundary — access
   * WIDENING, the opposite of this change. Both are #8613 carve-outs.
   */
  private async positionConfersAccess(
    positionName: string,
    pass: RuleEvaluationPass,
  ): Promise<boolean> {
    if (!positionName) return true; // nothing to read; the expansion answers [] anyway
    const memo = (pass.positionActive ??= new Map<string, boolean>());
    const seen = memo.get(positionName);
    if (seen !== undefined) return seen;
    const verdict = await this.readPositionActive(positionName);
    memo.set(positionName, verdict);
    return verdict;
  }

  /**
   * [ADR-0131 D3, ADR-0126 §4] Whether the activation ledger leaves
   * `positionName` switched on — the one place a position's deactivation lives
   * (ADR-0126 §3 regime C, as ADR-0131 D6 amends it), read exactly as the
   * authorization resolver reads it (`readDisabledCatalogNames`,
   * `@objectstack/core`): a `position` row of that name whose `active` reads
   * false (a driver `0` included) switches it off; no row means ACTIVE. The
   * `sys_position` row's `active` is not read — the resolver reads no catalog
   * row, so a flag there switches nothing.
   *
   *  1. **A name with no ledger row is untouched.** Position names reach a
   *     rule through `sys_member.role` too (ADR-0057 D4's transition source),
   *     and a name no catalog holds has nothing to switch off — the same names
   *     the resolver leaves alone. Only a row that really reads off revokes.
   *  2. **The verdict is deployment-wide.** The ledger carries no tenant
   *     column, so a switched-off position is off in every organization, as it
   *     is for the resolver; the rule's organization does not choose a row.
   *  3. **A failed read still grants.** A composition that registers no ledger
   *     object is not read at all; on one whose ledger table was never
   *     provisioned a query failure is indistinguishable from that here. Revoking every position share because a read threw is
   *     the mass revocation "absence means active" exists to avoid.
   */
  private async readPositionActive(positionName: string): Promise<boolean> {
    // A composition that registers no ledger object holds no row: the read is
    // not issued, as the resolver's own `ledgerUnregistered` check decides.
    const registry = (this.engine as { registry?: { getObject?: (name: string) => unknown } }).registry;
    if (typeof registry?.getObject === 'function' && !registry.getObject(METADATA_ACTIVATION_TABLE)) return true;
    try {
      const rows = await this.engine.find(METADATA_ACTIVATION_TABLE, {
        filter: { metadata_type: 'position', name: positionName },
        fields: ['metadata_type', 'name', 'active'],
        limit: 1,
        context: SYSTEM_CTX,
      });
      const row = Array.isArray(rows) ? (rows[0] as { active?: unknown } | undefined) : undefined;
      return !(row !== undefined && (row.active === false || row.active === 0));
    } catch (err: any) {
      this.logger?.warn?.(
        `[sharing-rule] ${METADATA_ACTIVATION_TABLE} read failed — position treated as ACTIVE for this pass`,
        { position: positionName, error: err?.message },
      );
      return true;
    }
  }

  /**
   * [#14754] Materialise ONE rule grant, absorbing the engine's organization
   * refusal so the pass survives it.
   *
   * ## The defect this closes, and which half of it is the security half
   *
   * `sys_record_share` is tenant-scoped in the #13491 ledger (commit 3f64fe6c6), so on a
   * walled install an organization-less system insert on it is refused loudly
   * with {@link SYSTEM_WRITE_ORGANIZATION_REQUIRED_CODE}. `SharingService.grant`
   * resolves the organization on every path that can; a rule whose sweep
   * carries no tenant (a {@link DeploymentWideSharingRule}) materialising
   * onto an organization-less record resolves none, and meets the refusal.
   *
   * Without this catch the refusal propagated out of the reconcile loop and
   * that rule's pass ABORTED mid-loop. The grants already written stayed; the
   * remaining grants — and **the stale-row revocations of that pass** — did
   * not happen. The revocation half is the security-relevant one: a stale
   * over-grant of that rule persisted across every pass that met the same
   * record, and that record kept aborting the pass until it was repaired.
   *
   * ## Why the catch is narrow, and must stay narrow
   *
   * ONLY the engine's organization refusal is absorbed — recognised through
   * the engine's own {@link isSystemWriteOrganizationRequiredError}; everything
   * else rethrows unchanged. Two reasons, and the second is measured:
   *
   * - A catch-all would swallow real defects — a driver outage, a criteria
   *   bug, a permission failure — and report a pass that "completed" having
   *   written nothing, which is the silence #6783 spent a card removing.
   * - `record-share-organization-stamp.test.ts` DELIBERATELY pins the abort on
   *   the OTHER error a reconcile pass can meet here: the scoped update half
   *   answering `RECORD_NOT_FOUND` (404) for a row stamped with a different
   *   organization. That shape was reviewed on 2026-09-02 and left standing
   *   ("loud beats a wrong count"). Widening this catch to any error would
   *   retire that decision as a side effect, and its three pins are what
   *   notices.
   *
   * Returns `'granted'` when the grant landed, `'refused'` when it was refused —
   * never throws for the refusal, and the caller counts what it is told.
   *
   * [#25549] …and `'internal'` for the one other refusal a pass absorbs: on a
   * public object the grant service admits an `external` member of the
   * record's organization only ({@link isInternalRecipientRefusal}). That
   * recipient is skipped, not counted as refused — the row would never be
   * consulted for it — and the pass reports the skipped half in one line
   * ({@link withInternalHalfNote}). Every other D7 refusal (bypass, owner-less,
   * `controlled_by_parent`, phantom anchor) still aborts the rule's pass.
   */
  private async grantOrAbsorbOrganizationRefusal(
    rule: SharingRuleRow,
    recordId: string,
    recipientId: string,
  ): Promise<RuleGrantOutcome> {
    // A rule that may sweep nowhere matched nothing, so it never asks for a
    // grant; refused here too, so no caller can write one around the sweep.
    const context = this.sweepContextOrReport(rule);
    if (!context) return 'refused';
    try {
      await this.sharing.grant(
        {
          object: rule.object_name,
          recordId,
          recipientType: 'user',
          recipientId,
          accessLevel: rule.access_level,
          source: 'rule',
          sourceId: rule.id,
          reason: `rule:${rule.name}`,
        } as any,
        context,
      );
      return 'granted';
    } catch (err: any) {
      if (isInternalRecipientRefusal(err)) return 'internal';
      if (!isSystemWriteOrganizationRequiredError(err)) throw err;
      this.logger?.warn?.(
        '[sharing-rule] grant refused by the engine organization rule — counted, pass continues',
        {
          rule: rule.name ?? rule.id,
          object: rule.object_name,
          record: recordId,
          recipient: recipientId,
          code: SYSTEM_WRITE_ORGANIZATION_REQUIRED_CODE,
        },
      );
      return 'refused';
    }
  }

  /**
   * [#25549] Put the one-line note on a pass that skipped internal recipients,
   * and log the count once per pass — never once per skipped grant, which on a
   * rule over N records and M staff would be N×M lines of the same fact.
   */
  private withInternalHalfNote(
    rule: SharingRuleRow,
    pass: SharingRuleReconcilePassResult,
    skipped: number,
  ): SharingRuleReconcilePassResult {
    if (skipped === 0) return pass;
    this.logger?.info?.('[sharing-rule] internal recipients skipped on a public object — external recipients only', {
      rule: rule.name ?? rule.id,
      object: rule.object_name,
      skipped,
    });
    return { ...pass, note: internalHalfNote(rule.object_name) };
  }

  /**
   * Diff a whole-rule pass's desired pairs against the rule's materialised
   * grants: upsert what is wanted, revoke the remainder.
   *
   * [#15072] Takes the pairs ({@link DesiredGrantSet}) rather than
   * `(matchedIds, users)`: the product of those two is what a rule-wide
   * recipient wants, and it is built in {@link desiredGrantsForRule} — where
   * a `field` rule builds its per-record pairs instead. The diff below is
   * unchanged, and since #14754 it attempts each grant individually
   * ({@link grantOrAbsorbOrganizationRefusal}) — a refused grant is counted
   * in `grantsRefused` and the pass, including its stale-row revocations,
   * continues.
   */
  private async reconcile(rule: SharingRuleRow, desiredSet: DesiredGrantSet): Promise<SharingRuleReconcilePassResult> {
    const existing = await this.engine.find('sys_record_share', {
      where: ruleGrantScope(rule),
      fields: ['id', 'record_id', 'recipient_id', 'access_level'],
      limit: 100000,
      context: SYSTEM_CTX,
    });
    const desired = desiredSet.desired;
    const existingMap = new Map<string, any>();
    for (const row of (existing ?? [])) existingMap.set(`${row.record_id}::${row.recipient_id}`, row);

    let created = 0;
    let updated = 0;
    let revoked = 0;
    let refused = 0;
    let skipped = 0;

    // Upsert desired. [#14754] Per grant, not per pass: a refusal is counted
    // and the loop goes on, so the revoke loop below is REACHED.
    for (const [k, want] of desired.entries()) {
      const cur = existingMap.get(k);
      if (cur) {
        // [#14754] Taken out of the stale set BEFORE the grant is attempted.
        // The row is DESIRED; a refused level update must leave it standing.
        // Deleting it only on success would drop it through to the revoke loop
        // and retract a grant the rule still wants — this card's defect
        // inverted, and strictly worse than the abort it replaces.
        existingMap.delete(k);
        if (cur.access_level !== rule.access_level) {
          const outcome = await this.grantOrAbsorbOrganizationRefusal(rule, want.record_id, want.recipient_id);
          if (outcome === 'granted') updated += 1;
          else if (outcome === 'refused') refused += 1;
          else skipped += 1;
        }
      } else {
        const outcome = await this.grantOrAbsorbOrganizationRefusal(rule, want.record_id, want.recipient_id);
        if (outcome === 'granted') created += 1;
        else if (outcome === 'refused') refused += 1;
        else skipped += 1;
      }
    }
    // Revoke stale.
    for (const [, stale] of existingMap.entries()) {
      await this.sharing.revoke(stale.id, SYSTEM_CTX);
      revoked += 1;
    }

    return this.withInternalHalfNote(rule, {
      ruleId: rule.id,
      matchedRecords: desiredSet.matchedRecords,
      expandedUsers: desiredSet.expandedUsers,
      grantsCreated: created,
      grantsUpdated: updated,
      grantsRevoked: revoked,
      grantsRefused: refused,
    }, skipped);
  }

  private async reconcileForRecord(
    rule: SharingRuleRow,
    recordId: string,
    match: boolean,
    users: string[],
  ): Promise<SharingRuleReconcilePassResult> {
    const existing = await this.engine.find('sys_record_share', {
      where: { ...ruleGrantScope(rule), record_id: recordId },
      fields: ['id', 'record_id', 'recipient_id', 'access_level'],
      limit: 1000,
      context: SYSTEM_CTX,
    });
    const existingMap = new Map<string, any>();
    for (const row of (existing ?? [])) existingMap.set(String(row.recipient_id), row);

    let created = 0;
    let updated = 0;
    let revoked = 0;
    let refused = 0;
    let skipped = 0;

    if (match) {
      // [#14754] Per grant, exactly as in {@link reconcile}: one recipient the
      // engine's organization rule refuses no longer takes the rest of this
      // record's pass — nor its revoke loop — with it.
      for (const userId of users) {
        const cur = existingMap.get(userId);
        if (cur) {
          // [#14754] Out of the stale set BEFORE the attempt — see the twin
          // comment in {@link reconcile}: a refused level update must leave the
          // desired row standing, never fall through to the revoke loop.
          existingMap.delete(userId);
          if (cur.access_level !== rule.access_level) {
            const outcome = await this.grantOrAbsorbOrganizationRefusal(rule, recordId, userId);
            if (outcome === 'granted') updated += 1;
            else if (outcome === 'refused') refused += 1;
            else skipped += 1;
          }
        } else {
          const outcome = await this.grantOrAbsorbOrganizationRefusal(rule, recordId, userId);
          if (outcome === 'granted') created += 1;
          else if (outcome === 'refused') refused += 1;
          else skipped += 1;
        }
      }
    }
    // Anything still in existingMap is stale (either match=false or
    // user no longer in expanded set).
    for (const [, stale] of existingMap.entries()) {
      await this.sharing.revoke(stale.id, SYSTEM_CTX);
      revoked += 1;
    }

    return this.withInternalHalfNote(rule, {
      ruleId: rule.id,
      matchedRecords: match ? 1 : 0,
      expandedUsers: users.length,
      grantsCreated: created,
      grantsUpdated: updated,
      grantsRevoked: revoked,
      grantsRefused: refused,
    }, skipped);
  }

  /** Revoke every grant `scope` names ({@link ruleGrantScope}), one row at a time through the sharing service. */
  private async purgeGrants(scope: Record<string, unknown>): Promise<number> {
    const existing = await this.engine.find('sys_record_share', {
      where: scope,
      fields: ['id'],
      limit: 100000,
      context: SYSTEM_CTX,
    });
    let revoked = 0;
    for (const row of (existing ?? [])) {
      await this.sharing.revoke((row as any).id, SYSTEM_CTX);
      revoked += 1;
    }
    return revoked;
  }
}
