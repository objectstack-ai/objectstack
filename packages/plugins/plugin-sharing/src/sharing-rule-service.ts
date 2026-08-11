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
    if (caps.includes('manage_sharing') || caps.includes('manage_platform_settings')) return;
    throw new Error(
      'PERMISSION_DENIED: sharing-rule administration requires the manage_sharing capability (ADR-0111 D6)',
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

    // [#7136] Only the `tenantId` half of this read lost its cast: `tenantId`
    // is a declared field of the envelope, `organizationId` is not a field of
    // it at ALL. That spelling has its own history (#5858 /
    // `check:org-identifier`) and was explicitly held out of this change
    // (#7070) — so it stays cast, and the asymmetry above is now the visible
    // marker of which of the two names the contract actually knows.
    const orgId = (context as any)?.organizationId ?? context?.tenantId ?? null;
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

  async listRules(
    filter: { object?: string; activeOnly?: boolean },
    context: ExecutionContext,
  ): Promise<SharingRuleRow[]> {
    this.assertCanManageRules(context); // [ADR-0111 D6]
    const where: any = {};
    if (filter.object) where.object_name = filter.object;
    if (filter.activeOnly) where.active = true;
    // `organizationId` is not on the envelope — see defineRule().
    const orgId = (context as any)?.organizationId ?? context?.tenantId;
    if (orgId) where.organization_id = orgId;
    const rows = await this.engine.find('sys_sharing_rule', {
      where,
      orderBy: [{ field: 'name', order: 'asc' }],
      limit: 1000,
      context: SYSTEM_CTX,
    });
    return Array.isArray(rows) ? rows.map(rowFromRule) : [];
  }

  async getRule(idOrName: string, context: ExecutionContext): Promise<SharingRuleRow | null> {
    this.assertCanManageRules(context); // [ADR-0111 D6]
    if (!idOrName) return null;
    // `organizationId` is not on the envelope — see defineRule().
    const orgId = (context as any)?.organizationId ?? context?.tenantId;
    const byId = await this.engine.find('sys_sharing_rule', {
      where: { id: idOrName },
      limit: 1,
      context: SYSTEM_CTX,
    });
    if (Array.isArray(byId) && byId[0]) return rowFromRule(byId[0]);
    const byName = await this.engine.find('sys_sharing_rule', {
      where: orgId ? { name: idOrName, organization_id: orgId } : { name: idOrName },
      limit: 1,
      context: SYSTEM_CTX,
    });
    if (Array.isArray(byName) && byName[0]) return rowFromRule(byName[0]);
    return null;
  }

  async deleteRule(idOrName: string, context: ExecutionContext): Promise<void> {
    this.assertCanManageRules(context); // [ADR-0111 D6]
    const row = await this.getRule(idOrName, context);
    if (!row) return;
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
      const dept = new BusinessUnitGraphService({
        engine: this.engine,
        organizationId: rule.organization_id ?? null,
        teamGraph: team,
      });
      return dept.expandUsers(rule.recipient_id);
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
