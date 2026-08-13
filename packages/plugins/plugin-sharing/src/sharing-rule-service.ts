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
// has declared for every one of these context parameters since #6523 (the
// #6206 ruling: no per-site subset contracts).
import type { ExecutionContext } from '@objectstack/spec/kernel';
// [#7795] The built-in platform-operator position (ADR-0068 D2) — one of the
// two spellings of platform authority the ruling names; see
// {@link SharingRuleService.assertCanDeletePlatformGlobalRule}.
import { BUILTIN_IDENTITY_PLATFORM_ADMIN } from '@objectstack/spec/identity';
import type { SharingEngine } from './sharing-service.js';
import type { SharingService } from './sharing-service.js';
import { normalizeAccessLevel, normalizeStoredAccessLevel } from './access-level.js';
import { parseCriteria, isMatchAllCriteria, MATCH_ALL_CRITERIA_MESSAGE } from './rule-criteria.js';
import { TeamGraphService } from './team-graph.js';
import { PositionGraphService } from './position-graph.js';
import { BusinessUnitGraphService } from './business-unit-graph.js';

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

export interface SharingRuleServiceOptions {
  engine: SharingEngine;
  sharing: SharingService;
  logger?: { info?: Function; warn?: Function; error?: Function; debug?: Function };
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

  constructor(opts: SharingRuleServiceOptions) {
    this.engine = opts.engine;
    this.sharing = opts.sharing;
    this.logger = opts.logger;
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
   * Extracted from {@link assertCanDeletePlatformGlobalRule} (#7795), whose
   * doc block is the authority on WHY both spellings are accepted and why
   * accepting either is the fail-safe reading: they are two independent
   * channels by which the same unscoped `admin_full_access` grant reaches an
   * `ExecutionContext` (a `scope: 'platform'` capability on
   * `systemPermissions`; the ADR-0068 D2 built-in position on `positions`),
   * and a hand-built context may carry only one.
   *
   * It is asked TWICE now — once to authorize destroying a platform-global
   * rule, once to decide whether an org-less caller may read across tenants —
   * so it is one predicate rather than two spellings that can drift apart.
   */
  private hasPlatformAuthority(context: ExecutionContext): boolean {
    const caps = Array.isArray(context?.systemPermissions) ? context.systemPermissions : [];
    if (caps.includes('manage_platform_settings')) return true;
    const positions = Array.isArray(context?.positions) ? context.positions : [];
    return positions.includes(BUILTIN_IDENTITY_PLATFORM_ADMIN);
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
   * longer mint an `organization_id: null` rule (a platform-global one, whose
   * grants reach every tenant and which #7795 then forbids them to delete).
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
        'unscoped would expose every tenant’s rules (#8158). Select an active organization and ' +
        'retry. Platform operators (manage_platform_settings or the platform_admin position) and ' +
        'system contexts are unaffected.',
    );
  }

  /**
   * [#7795] DELETING a platform-global (`organization_id = null`) rule requires
   * PLATFORM authority. Org-scoped `manage_sharing` does not authorize it.
   *
   * Maintainer ruling, 2026-08-12 (方向 B), quoted verbatim and untranslated:
   *
   * > **裁定:方向 B —— read/evaluate 保持开放,delete 需要平台级权限。**
   * >
   * > - `deleteRule` 对 `organization_id = null` 的行,要求调用者持有平台级权限
   * >   (`manage_platform_settings` 或 `platform_admin` 位置);仅持 org 级
   * >   `manage_sharing` 者拒绝。
   * > - 错误面用 **403 `PERMISSION_DENIED`**,不是 404 —— 该行是有意可见的,
   * >   404 会撒谎。
   * > - #7760 开放的能力(列出、查看、评估种子规则)全部保持不动。
   *
   * ## Why only DELETE, and only this row class
   *
   * `manage_sharing` is declared `scope: 'org'` in the spec's capability
   * registry, but a null-org rule belongs to no organization: its criteria
   * query runs unscoped under {@link SYSTEM_CTX}, so {@link deleteRule}'s
   * grant purge revokes EVERY tenant's `sys_record_share` rows, not just the
   * caller's. That is the one act on this surface an org-level capability
   * should not reach, and the two measurements the ruling rests on say why —
   * both re-verified against this build before the guard was written:
   *
   * 1. **The delete is a revocation wearing removal's clothes.**
   *    `bootstrapDeclaredSharingRules` re-seeds declared rules on every boot,
   *    and {@link defineRule}'s existence lookup under a null org is `{name}` —
   *    which matches nothing once the row is deleted, so the insert branch
   *    mints a fresh `uid('srule')`. Measured: the rule returns after a
   *    restart under a DIFFERENT id, with its grants re-materialised. The
   *    profile of an outage, not of an administrative change.
   * 2. **The safe lever is unavailable while the destructive one is not.**
   *    An org admin cannot deactivate this row: `defineRule`'s existence
   *    lookup is deliberately strict (`{name, organization_id: orgId}`, held
   *    that way by #7676 so one org cannot upsert over a row other orgs read),
   *    so `active: false` from an org admin creates a SECOND, org-stamped row
   *    and leaves the shared one running. Measured: two rows, the null-org one
   *    still `active: true`. Scoped + reversible refused, cross-tenant +
   *    irreversible-until-reboot permitted — the inverse of the safe
   *    arrangement, and closing the destructive lever is the structural fix.
   *
   * ## Two spellings of platform authority, and why BOTH are accepted
   *
   * They are not synonyms — they are two independent channels by which the
   * SAME underlying grant (an unscoped `admin_full_access`) reaches an
   * `ExecutionContext`:
   *
   * - `manage_platform_settings` — a `scope: 'platform'` CAPABILITY, arriving
   *   on `context.systemPermissions`. `admin_full_access` carries it;
   *   `organization_admin` deliberately withholds it (it gets only
   *   `manage_org_users` / `setup.access` / `setup.write`), which is exactly
   *   what makes it a discriminator between a platform operator and a tenant
   *   admin — the same reasoning plugin-security's
   *   `PLATFORM_ADMIN_ONLY_CAPABILITIES` probe encodes.
   * - `platform_admin` — a built-in POSITION (ADR-0068 D2), arriving on
   *   `context.positions`, DERIVED by the shared resolver from the unscoped
   *   `admin_full_access` user grant (never a stored boolean).
   *
   * A context built by the shared authz resolver carries both. A HAND-BUILT
   * context — the population ADR-0096 D3 is still eliminating, and which
   * plugin-security's probe comment names the sharing service as part of —
   * may carry only one. Accepting either is therefore the fail-safe reading of
   * a ruling that names both, and refusing on the absence of both cannot
   * silently over-refuse a genuine platform operator.
   *
   * ## The error surface is 403 `PERMISSION_DENIED`, deliberately not 404
   *
   * The row is DELIBERATELY visible: #7760 opened listing, reading and
   * evaluating seeded rules to org admins on purpose, and this guard leaves
   * all three untouched. A 404 here would be the platform lying about a row
   * the caller could list and read one call earlier. The message prefix is
   * what `rest-server.ts`'s sharing-rule `handleError` maps to HTTP 403 +
   * `{code: 'PERMISSION_DENIED'}`, which is also the pairing the spec's own
   * `HttpStatusErrorCodeMap[403]` records. ⛔ Do not "harden" this into a 404
   * or a silent no-op — both re-open the lie this shape exists to avoid.
   *
   * Placed AFTER {@link getRule} resolves, so a row the caller cannot see at
   * all keeps its existing silent-no-op behaviour rather than gaining a new
   * refusal that would disclose the row's existence.
   *
   * ⚠️ Recorded consequence, accepted by the ruling: with delete closed, an org
   * admin has NO lever at all over a platform-global rule. The ruling
   * explicitly declines to pre-build a per-org suppression mechanism
   * (「⛔ 不做 D」) absent measured demand — do not add one here.
   */
  private assertCanDeletePlatformGlobalRule(row: SharingRuleRow, context: ExecutionContext): void {
    // Only the platform-global class is gated — an org's own rows are
    // untouched, and so is every read verb.
    if (row.organization_id != null) return;
    // Boot seeding, hooks, backfills and the plugin machinery, as everywhere else.
    if (context?.isSystem) return;
    // [#8158] Both spellings, now through the shared predicate — see
    // {@link hasPlatformAuthority}, which carries this block's reasoning.
    if (this.hasPlatformAuthority(context)) return;
    throw new Error(
      'PERMISSION_DENIED: deleting a platform-global sharing rule requires platform authority — ' +
        'the manage_platform_settings capability or the platform_admin position. Org-scoped ' +
        'manage_sharing does not authorize it, because this rule belongs to no organization and ' +
        'deleting it revokes every tenant’s grants under it (#7795). It remains listable, ' +
        'readable and evaluable.',
    );
  }

  async defineRule(input: DefineSharingRuleInput, context: ExecutionContext): Promise<SharingRuleRow> {
    this.assertCanManageRules(context);
    if (!input.name) throw new Error('VALIDATION_FAILED: name is required');
    if (!input.label) throw new Error('VALIDATION_FAILED: label is required');
    if (!input.object) throw new Error('VALIDATION_FAILED: object is required');
    if (!input.recipientType) throw new Error('VALIDATION_FAILED: recipientType is required');
    if (!input.recipientId) throw new Error('VALIDATION_FAILED: recipientId is required');
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
    // {@link callerOrgId}. `null` (not `undefined`) is what a null-org row is
    // STAMPED with, and only a system context or a platform operator reaches
    // this line without an org id (`assertCanManageRules` above refuses the
    // authenticated org-less caller, so a `manage_sharing` holder can no
    // longer mint a platform-global rule by accident).
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
    // as the boot seeder (bootstrapDeclaredSharingRules) rather than an
    // admin/programmatic authoring path. sys_sharing_rule is
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
   * [#7676] Tenant scope for a sharing-rule ADMIN read: "this org ∪
   * platform-global".
   *
   * `organization_id = null` on `sys_sharing_rule` means "owned by no
   * organization" — a row written by the package/app seeder
   * (`bootstrapDeclaredSharingRules`, which defines under `SYSTEM_CTX` and so
   * stamps `organization_id: null`) before any org id exists. A strict
   * `organization_id = <request org>` equality made every such row invisible to
   * the admin API while enforcement kept reading them under `SYSTEM_CTX`: on a
   * stock boot `GET /api/v1/sharing/rules` answered `{data: []}` over four
   * active seeded rules, by-name GET and evaluate 404'd `RULE_NOT_FOUND`, and
   * only the org-unfiltered by-id branch of {@link getRule} still worked. Rules
   * that grant access but cannot be listed, inspected or deactivated are the
   * worst half of both properties.
   *
   * Widening the READ leaks nothing across tenants: another org's row still
   * fails the match, and a null-org row is platform-global by construction —
   * every org already receives the grants it materialises. This is the same
   * predicate, for the same reason, that `sys_business_unit` approver expansion
   * settled on in #3807 and that `sys_metadata`'s pending-draft listing uses.
   *
   * ⚠️ It is deliberately NOT applied to {@link defineRule}'s existence lookup.
   * That lookup decides UPSERT-or-insert, so widening it would let one org's
   * admin overwrite the label, criteria, recipient and access level of a row
   * every OTHER org reads — a cross-tenant WRITE, which is a different act from
   * a cross-tenant read of a platform-global row. A same-named POST therefore
   * still creates an org-stamped row of the tenant's own, and
   * {@link findRuleRowByName} prefers it.
   *
   * [#7761] It IS applied to {@link getRule}'s by-**id** branch, which the
   * second paragraph above records as the one read that still worked while
   * everything else was over-scoped. That was never a feature: unfiltered
   * meant an org admin could resolve — and, through {@link deleteRule},
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
    return { ...where, $or: [{ organization_id: orgId }, { organization_id: null }] };
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
    return Array.isArray(rows) ? rows.map(rowFromRule) : [];
  }

  async getRule(idOrName: string, context: ExecutionContext): Promise<SharingRuleRow | null> {
    this.assertCanManageRules(context); // [ADR-0111 D6]
    if (!idOrName) return null;
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
    // A platform-global (`organization_id = null`) row stays reachable, for
    // symmetry with the by-name path — see {@link adminOrgScope}.
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
   * [#7676] Resolve a rule by NAME for an admin read: this org first, the
   * platform-global (`organization_id IS NULL`) row second.
   *
   * Two sequenced lookups rather than one `$or` with `limit: 1`, because when
   * BOTH rows exist the answer must be the caller's own: a single disjunctive
   * query with a row cap picks whichever row the driver happened to reach
   * first, so an org that had authored its own `share_red_projects_with_execs`
   * could get the platform row back on one dialect and its own on another.
   * Preference is a decision, so it is written as one.
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
    return (await first({ name, organization_id: orgId })) ?? (await first({ name, organization_id: null }));
  }

  async deleteRule(idOrName: string, context: ExecutionContext): Promise<void> {
    this.assertCanManageRules(context); // [ADR-0111 D6]
    const row = await this.getRule(idOrName, context);
    if (!row) return;
    // [#7795] A platform-global row is visible to an org admin by design
    // (#7760) but is NOT theirs to destroy — 403, never 404.
    this.assertCanDeletePlatformGlobalRule(row, context);
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
    // The fix routes through {@link purgeRuleGrants} rather than adding
    // `multi: true` to the bulk call: it is the same revoke path every other
    // withdrawal already uses (`evaluateRule` on an inactive rule,
    // `revokeRuleGrants` after a data-API delete), so a rule's grants are
    // retired exactly one way — through `SharingService.revoke`, one row at a
    // time by scalar id — instead of two divergent ones. Adding `multi` here
    // would have fixed the 500 while keeping delete as the only withdrawal
    // that bypasses the sharing service (AGENTS.md PD #5).
    await this.purgeRuleGrants(row.id);
    await this.engine.delete('sys_sharing_rule', {
      where: { id: row.id },
      context: SYSTEM_CTX,
    } as any);
  }

  async evaluateRule(idOrName: string, context: ExecutionContext): Promise<SharingRuleEvaluationResult> {
    this.assertCanManageRules(context); // [ADR-0111 D6]
    const rule = await this.getRule(idOrName, context);
    if (!rule) throw new Error('RULE_NOT_FOUND');
    if (!rule.active) {
      // Inactive — purge any leftover grants and report revoke count.
      const revoked = await this.purgeRuleGrants(rule.id);
      return { ruleId: rule.id, matchedRecords: 0, expandedUsers: 0, grantsCreated: 0, grantsUpdated: 0, grantsRevoked: revoked };
    }
    const matches = await this.findMatchingRecords(rule);
    const users = await this.expandRecipient(rule);
    return this.reconcile(rule, matches, users);
  }

  /**
   * Revoke every grant this rule materialised, without needing the rule row to
   * still exist. `evaluateRule` throws `RULE_NOT_FOUND` once the row is gone,
   * so a rule DELETED through the plain data API (which is what the Setup UI's
   * delete action issues — it never reaches {@link deleteRule}) would otherwise
   * leave its grants behind forever (objectstack#3821).
   */
  async revokeRuleGrants(ruleId: string): Promise<number> {
    return this.purgeRuleGrants(ruleId);
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

    const grants = await this.engine.find('sys_record_share', {
      where: { source: 'rule' },
      fields: ['id', 'source_id'],
      limit: 100000,
      context: SYSTEM_CTX,
    });
    let revoked = 0;
    for (const g of (grants ?? [])) {
      const sourceId = (g as any).source_id;
      // A `source: 'rule'` row with no `source_id` names no rule that could
      // ever re-grant it — equally unreachable, equally void.
      if (sourceId != null && live.has(String(sourceId))) continue;
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
  ): Promise<SharingRuleEvaluationResult[]> {
    const rules = await this.listRules({ object }, context);
    if (rules.length === 0) return [];
    const results: SharingRuleEvaluationResult[] = [];
    for (const rule of rules) {
      // An inactive rule desires nothing; skip the criteria query entirely.
      const match = rule.active ? await this.recordMatches(rule, recordId) : false;
      const users = match ? await this.expandRecipient(rule) : [];
      results.push(await this.reconcileForRecord(rule, recordId, match, users));
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
        await this.evaluateRule(rule.id, SYSTEM_CTX);
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
    const existing = await this.engine.find('sys_record_share', {
      where: { source: 'rule', source_id: rule.id },
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
          source: 'rule',
          source_id: rule.id,
          recipient_id: { $in: stale.slice(i, i + CHUNK) },
        },
        multi: true,
        context: SYSTEM_CTX,
      } as any);
    }
    return stale.length;
  }

  // ── internals ─────────────────────────────────────────────────────

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

  private async findMatchingRecords(rule: SharingRuleRow): Promise<string[]> {
    if (this.isInertMatchAll(rule)) return [];
    const filter = (rule.criteria ?? {}) as any;
    try {
      const rows = await this.engine.find(rule.object_name, {
        filter,
        fields: ['id'],
        limit: 5000,
        context: SYSTEM_CTX,
      });
      return Array.isArray(rows) ? rows.map((r: any) => String(r.id)).filter(Boolean) : [];
    } catch (err: any) {
      this.logger?.warn?.('[sharing-rule] criteria query failed', { rule: rule.name, error: err?.message });
      return [];
    }
  }

  private async recordMatches(rule: SharingRuleRow, recordId: string): Promise<boolean> {
    if (this.isInertMatchAll(rule)) return false;
    const filter = { ...((rule.criteria ?? {}) as any), id: recordId };
    try {
      const rows = await this.engine.find(rule.object_name, {
        filter,
        fields: ['id'],
        limit: 1,
        context: SYSTEM_CTX,
      });
      return Array.isArray(rows) && rows.length > 0;
    } catch {
      return false;
    }
  }

  private async expandRecipient(rule: SharingRuleRow): Promise<string[]> {
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
      return dept.expandUnitMembers(rule.recipient_id);
    }
    if (rule.recipient_type === 'position') {
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
      return dept.expandUsers(rule.recipient_id);
    }
    // queue — v1 stores literal; treat as no-op until queue impl lands.
    return [];
  }

  private async reconcile(
    rule: SharingRuleRow,
    matchedIds: string[],
    users: string[],
  ): Promise<SharingRuleEvaluationResult> {
    const existing = await this.engine.find('sys_record_share', {
      where: { source: 'rule', source_id: rule.id },
      fields: ['id', 'record_id', 'recipient_id', 'access_level'],
      limit: 100000,
      context: SYSTEM_CTX,
    });
    const desired = new Map<string, { record_id: string; recipient_id: string }>();
    for (const rid of matchedIds) {
      for (const uId of users) desired.set(`${rid}::${uId}`, { record_id: rid, recipient_id: uId });
    }
    const existingMap = new Map<string, any>();
    for (const row of (existing ?? [])) existingMap.set(`${row.record_id}::${row.recipient_id}`, row);

    let created = 0;
    let updated = 0;
    let revoked = 0;

    // Upsert desired.
    for (const [k, want] of desired.entries()) {
      const cur = existingMap.get(k);
      if (cur) {
        if (cur.access_level !== rule.access_level) {
          await this.sharing.grant(
            {
              object: rule.object_name,
              recordId: want.record_id,
              recipientType: 'user',
              recipientId: want.recipient_id,
              accessLevel: rule.access_level,
              source: 'rule',
              sourceId: rule.id,
              reason: `rule:${rule.name}`,
            } as any,
            SYSTEM_CTX,
          );
          updated += 1;
        }
        existingMap.delete(k);
      } else {
        await this.sharing.grant(
          {
            object: rule.object_name,
            recordId: want.record_id,
            recipientType: 'user',
            recipientId: want.recipient_id,
            accessLevel: rule.access_level,
            source: 'rule',
            sourceId: rule.id,
            reason: `rule:${rule.name}`,
          } as any,
          SYSTEM_CTX,
        );
        created += 1;
      }
    }
    // Revoke stale.
    for (const [, stale] of existingMap.entries()) {
      await this.sharing.revoke(stale.id, SYSTEM_CTX);
      revoked += 1;
    }

    return {
      ruleId: rule.id,
      matchedRecords: matchedIds.length,
      expandedUsers: users.length,
      grantsCreated: created,
      grantsUpdated: updated,
      grantsRevoked: revoked,
    };
  }

  private async reconcileForRecord(
    rule: SharingRuleRow,
    recordId: string,
    match: boolean,
    users: string[],
  ): Promise<SharingRuleEvaluationResult> {
    const existing = await this.engine.find('sys_record_share', {
      where: { source: 'rule', source_id: rule.id, record_id: recordId },
      fields: ['id', 'record_id', 'recipient_id', 'access_level'],
      limit: 1000,
      context: SYSTEM_CTX,
    });
    const existingMap = new Map<string, any>();
    for (const row of (existing ?? [])) existingMap.set(String(row.recipient_id), row);

    let created = 0;
    let updated = 0;
    let revoked = 0;

    if (match) {
      for (const userId of users) {
        const cur = existingMap.get(userId);
        if (cur) {
          if (cur.access_level !== rule.access_level) {
            await this.sharing.grant(
              {
                object: rule.object_name,
                recordId,
                recipientType: 'user',
                recipientId: userId,
                accessLevel: rule.access_level,
                source: 'rule',
                sourceId: rule.id,
                reason: `rule:${rule.name}`,
              } as any,
              SYSTEM_CTX,
            );
            updated += 1;
          }
          existingMap.delete(userId);
        } else {
          await this.sharing.grant(
            {
              object: rule.object_name,
              recordId,
              recipientType: 'user',
              recipientId: userId,
              accessLevel: rule.access_level,
              source: 'rule',
              sourceId: rule.id,
              reason: `rule:${rule.name}`,
            } as any,
            SYSTEM_CTX,
          );
          created += 1;
        }
      }
    }
    // Anything still in existingMap is stale (either match=false or
    // user no longer in expanded set).
    for (const [, stale] of existingMap.entries()) {
      await this.sharing.revoke(stale.id, SYSTEM_CTX);
      revoked += 1;
    }

    return {
      ruleId: rule.id,
      matchedRecords: match ? 1 : 0,
      expandedUsers: users.length,
      grantsCreated: created,
      grantsUpdated: updated,
      grantsRevoked: revoked,
    };
  }

  private async purgeRuleGrants(ruleId: string): Promise<number> {
    const existing = await this.engine.find('sys_record_share', {
      where: { source: 'rule', source_id: ruleId },
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
