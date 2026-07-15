// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type {
  ISharingRuleService,
  DefineSharingRuleInput,
  SharingRuleRow,
  SharingRuleEvaluationResult,
  SharingExecutionContext,
  ShareAccessLevel,
  SharingRuleRecipientType,
} from '@objectstack/spec/contracts';
import type { SharingEngine } from './sharing-service.js';
import type { SharingService } from './sharing-service.js';
import { TeamGraphService } from './team-graph.js';
import { PositionGraphService } from './position-graph.js';
import { BusinessUnitGraphService } from './business-unit-graph.js';

const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] } as const;

function uid(prefix: string): string {
  const g: any = globalThis as any;
  if (g.crypto?.randomUUID) return `${prefix}_${g.crypto.randomUUID()}`;
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function parseCriteria(raw: unknown): unknown | undefined {
  if (raw == null || raw === '') return undefined;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return undefined;
    try {
      return JSON.parse(trimmed);
    } catch {
      // Treat unparsable strings as opaque — most likely a CEL source
      // that v1's evaluator doesn't grok yet; rule will match nothing.
      return undefined;
    }
  }
  return raw;
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
    access_level: row.access_level as ShareAccessLevel,
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

  constructor(opts: SharingRuleServiceOptions) {
    this.engine = opts.engine;
    this.sharing = opts.sharing;
    this.logger = opts.logger;
  }

  async defineRule(input: DefineSharingRuleInput, context: SharingExecutionContext): Promise<SharingRuleRow> {
    if (!input.name) throw new Error('VALIDATION_FAILED: name is required');
    if (!input.label) throw new Error('VALIDATION_FAILED: label is required');
    if (!input.object) throw new Error('VALIDATION_FAILED: object is required');
    if (!input.recipientType) throw new Error('VALIDATION_FAILED: recipientType is required');
    if (!input.recipientId) throw new Error('VALIDATION_FAILED: recipientId is required');

    const orgId = (context as any)?.organizationId ?? (context as any)?.tenantId ?? null;
    const now = new Date().toISOString();
    const accessLevel: ShareAccessLevel = input.accessLevel ?? 'read';
    const active = input.active !== false;
    const criteriaJson = input.criteria == null
      ? null
      : (typeof input.criteria === 'string' ? input.criteria : JSON.stringify(input.criteria));

    const existing = await this.engine.find('sys_sharing_rule', {
      filter: orgId ? { name: input.name, organization_id: orgId } : { name: input.name },
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
    context: SharingExecutionContext,
  ): Promise<SharingRuleRow[]> {
    const where: any = {};
    if (filter.object) where.object_name = filter.object;
    if (filter.activeOnly) where.active = true;
    const orgId = (context as any)?.organizationId ?? (context as any)?.tenantId;
    if (orgId) where.organization_id = orgId;
    const rows = await this.engine.find('sys_sharing_rule', {
      filter: where,
      orderBy: [{ field: 'name', order: 'asc' }],
      limit: 1000,
      context: SYSTEM_CTX,
    });
    return Array.isArray(rows) ? rows.map(rowFromRule) : [];
  }

  async getRule(idOrName: string, context: SharingExecutionContext): Promise<SharingRuleRow | null> {
    if (!idOrName) return null;
    const orgId = (context as any)?.organizationId ?? (context as any)?.tenantId;
    const byId = await this.engine.find('sys_sharing_rule', {
      filter: { id: idOrName },
      limit: 1,
      context: SYSTEM_CTX,
    });
    if (Array.isArray(byId) && byId[0]) return rowFromRule(byId[0]);
    const byName = await this.engine.find('sys_sharing_rule', {
      filter: orgId ? { name: idOrName, organization_id: orgId } : { name: idOrName },
      limit: 1,
      context: SYSTEM_CTX,
    });
    if (Array.isArray(byName) && byName[0]) return rowFromRule(byName[0]);
    return null;
  }

  async deleteRule(idOrName: string, context: SharingExecutionContext): Promise<void> {
    const row = await this.getRule(idOrName, context);
    if (!row) return;
    // Drop materialised grants first so we don't orphan them.
    await this.engine.delete('sys_record_share', {
      where: { source: 'rule', source_id: row.id },
      context: SYSTEM_CTX,
    } as any);
    await this.engine.delete('sys_sharing_rule', {
      where: { id: row.id },
      context: SYSTEM_CTX,
    } as any);
  }

  async evaluateRule(idOrName: string, context: SharingExecutionContext): Promise<SharingRuleEvaluationResult> {
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

  async evaluateAllForRecord(
    object: string,
    recordId: string,
    context: SharingExecutionContext,
  ): Promise<SharingRuleEvaluationResult[]> {
    const rules = await this.listRules({ object, activeOnly: true }, context);
    if (rules.length === 0) return [];
    const results: SharingRuleEvaluationResult[] = [];
    for (const rule of rules) {
      const match = await this.recordMatches(rule, recordId);
      const users = match ? await this.expandRecipient(rule) : [];
      results.push(await this.reconcileForRecord(rule, recordId, match, users));
    }
    return results;
  }

  // ── internals ─────────────────────────────────────────────────────

  private async findMatchingRecords(rule: SharingRuleRow): Promise<string[]> {
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
      filter: { source: 'rule', source_id: rule.id },
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
            SYSTEM_CTX as any,
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
          SYSTEM_CTX as any,
        );
        created += 1;
      }
    }
    // Revoke stale.
    for (const [, stale] of existingMap.entries()) {
      await this.sharing.revoke(stale.id, SYSTEM_CTX as any);
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
      filter: { source: 'rule', source_id: rule.id, record_id: recordId },
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
              SYSTEM_CTX as any,
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
            SYSTEM_CTX as any,
          );
          created += 1;
        }
      }
    }
    // Anything still in existingMap is stale (either match=false or
    // user no longer in expanded set).
    for (const [, stale] of existingMap.entries()) {
      await this.sharing.revoke(stale.id, SYSTEM_CTX as any);
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
      filter: { source: 'rule', source_id: ruleId },
      fields: ['id'],
      limit: 100000,
      context: SYSTEM_CTX,
    });
    let revoked = 0;
    for (const row of (existing ?? [])) {
      await this.sharing.revoke((row as any).id, SYSTEM_CTX as any);
      revoked += 1;
    }
    return revoked;
  }
}
