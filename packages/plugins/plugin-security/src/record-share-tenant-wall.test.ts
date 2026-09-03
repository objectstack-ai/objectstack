// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#14484] A tenant-scoped read of `sys_record_share` under plugin-security's
 * Layer 0 returns the same grants the bare-context reads return for that
 * organization — the cliff the card named, closed and pinned.
 *
 * ## Why this file lives in plugin-SECURITY
 *
 * The writer under test is `@objectstack/plugin-sharing`'s `SharingService`
 * (its `grant` now stamps `organization_id` on every `sys_record_share`
 * insert and update, ruled 2026-09-02), but the VERDICT that made the cliff a
 * cliff is computed here: `computeTenantLayer0Filter` composes a STRICT
 * `organization_id = <active org>` over every tenant read, which wins over the
 * driver's NULL-tolerant arm — so an organization-less grant is not refused,
 * it is simply absent, indistinguishable from "never granted". Proving the
 * repair therefore needs both packages in one process, and this is the one
 * that owns the wall — plugin-security already depends on plugin-sharing for
 * the same reason (`share-link-tenant-wall.test.ts`), never the other way.
 *
 * ## What is real here and what is a double
 *
 * REAL: `SharingService` (the production writer, its authorization pre-flight
 * included) and the tenant wall — `computeTenantLayer0Filter` is called with
 * the caller's context exactly as `security-plugin.ts` calls it on a read.
 *
 * DOUBLE: storage. The engine below is an in-memory table set that applies the
 * wall the same way the security middleware does — AND-composed first, on a
 * non-system context — so `RLS_DENY_FILTER` denies by being an unmatchable
 * predicate rather than by a special case, which is how it denies in
 * production.
 *
 * The backfill half of the repair (legacy rows) is pinned beside the writer in
 * plugin-sharing (`backfill-sys-record-share-organizations.test.ts`, which
 * composes the same strict wall shape); the control case below shows the
 * cliff those rows fall off, for the reader who wants to see it.
 */

import { describe, it, expect } from 'vitest';
// The producer's OWN dispatch predicate for the double's `update`, from
// `@objectstack/metadata-core` (where it lives since #5619) — this package
// does not depend on `@objectstack/objectql`.
import { assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import type { TenancyPosture } from '@objectstack/spec/security';
import { SharingService } from '@objectstack/plugin-sharing';
import { computeTenantLayer0Filter } from './tenant-layer.js';

const OBJECT = 'crm_deal';
const SHARE = 'sys_record_share';
const ORG_A = 'org_plant_a';
const ORG_B = 'org_plant_b';

const SCHEMAS: Record<string, any> = {
  [OBJECT]: {
    name: OBJECT,
    sharingModel: 'private',
    fields: { id: {}, name: {}, owner_id: {}, organization_id: {} },
  },
  [SHARE]: {
    name: SHARE,
    isSystem: true,
    fields: { id: {}, object_name: {}, record_id: {}, recipient_type: {}, recipient_id: {}, access_level: {}, source: {}, organization_id: {} },
  },
};

/** Objects that carry `organization_id` — the wall's "is this a tenant object?" input. */
const TENANT_OBJECTS = new Set(Object.keys(SCHEMAS));

function matches(row: any, where: Record<string, any>): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (k === '$and') return (v as any[]).every((w) => matches(row, w));
    if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
    if (v === null) return row[k] == null;
    if (v && typeof v === 'object' && '$in' in v) return (v as any).$in.includes(row[k]);
    return row[k] === v;
  });
}

/**
 * An engine that enforces Layer 0 exactly as the security middleware does: the
 * REAL `computeTenantLayer0Filter`, fed the caller's context, AND-composed onto
 * the query's own predicate. A system context bypasses it, as it does in
 * production.
 */
function makeEngine(tables: Record<string, any[]>, posture: TenancyPosture) {
  return {
    _tables: tables,
    getSchema(object: string) { return SCHEMAS[object]; },
    async find(object: string, opts: any) {
      const ctx = opts?.context ?? {};
      let rows = tables[object] ?? [];
      if (!ctx.isSystem && TENANT_OBJECTS.has(object)) {
        const layer0 = computeTenantLayer0Filter({
          tenancyPosture: posture,
          organizationId: ctx.tenantId,
          accessibleOrgIds: ctx.accessible_org_ids,
          objectHasOrgIdField: true,
          tenancyDisabled: false,
          posturePermitsCrossTenant: false,
          isPlatformAdmin: false,
        });
        if (layer0) rows = rows.filter((r) => matches(r, layer0));
      }
      rows = rows.filter((r) => matches(r, opts?.where ?? {}));
      return rows.slice(0, typeof opts?.limit === 'number' ? opts.limit : rows.length).map((r) => ({ ...r }));
    },
    async insert(object: string, row: any) {
      (tables[object] ??= []).push({ ...row });
      return row;
    },
    async update(object: string, data: any, options?: any) {
      const dispatch = assertEngineUpdateDispatch(data, options);
      const rows = tables[object] ?? [];
      if (dispatch.kind === 'by-id') {
        const i = rows.findIndex((r) => r.id === dispatch.id);
        if (i >= 0) rows[i] = { ...rows[i], ...data };
        return data;
      }
      const matched = rows.filter((r) => matches(r, options?.where ?? {}));
      for (const r of matched) Object.assign(r, data);
      return matched.length;
    },
  };
}

function boot(posture: TenancyPosture = 'isolated') {
  const tables: Record<string, any[]> = {
    [OBJECT]: [
      { id: 'deal_a1', name: 'Plant A deal', owner_id: 'u_a', organization_id: ORG_A },
      { id: 'deal_a2', name: 'Plant A other', owner_id: 'u_a', organization_id: ORG_A },
      { id: 'deal_b1', name: 'Plant B deal', owner_id: 'u_b', organization_id: ORG_B },
    ],
    [SHARE]: [],
  };
  const engine = makeEngine(tables, posture);
  const sharing = new SharingService({ engine: engine as never });
  const ids = (rows: unknown[]) => (rows as Array<{ id: string }>).map((r) => r.id).sort();
  /** The bare-context read the service itself performs (`listShares` under SYSTEM_CTX). */
  const bare = async () => ids(await engine.find(SHARE, { where: { object_name: OBJECT }, context: { isSystem: true } }));
  /** A tenant-scoped read of the table, under plugin-security's Layer 0. */
  const tenant = async (org: string) =>
    ids(await engine.find(SHARE, { where: { object_name: OBJECT }, context: { userId: 'reader', tenantId: org } }));
  const bareFor = async (org: string) =>
    ids((await engine.find(SHARE, { where: { object_name: OBJECT }, context: { isSystem: true } }))
      .filter((r: any) => r.organization_id === org));
  return { engine, sharing, tables, bare, tenant, bareFor };
}

describe('[#14484] tenant-scoped reads of sys_record_share under Layer 0 agree with the bare reads', () => {
  it("a DIRECT grant written by a plant-A owner is returned by plant A's tenant read, and equals the bare read for plant A", async () => {
    const { sharing, tenant, bareFor, tables } = boot();
    const r = await sharing.grant(
      { object: OBJECT, recordId: 'deal_a1', recipientId: 'u_x' },
      { userId: 'u_a', tenantId: ORG_A } as never,
    );
    expect(tables[SHARE][0]).toMatchObject({ id: r.id, organization_id: ORG_A });
    expect(await tenant(ORG_A)).toEqual(await bareFor(ORG_A));
    expect(await tenant(ORG_A)).toEqual([r.id]);
    // The wall is live, not bypassed: plant B sees none of plant A's grants.
    expect(await tenant(ORG_B)).toEqual([]);
  });

  it("a RULE-materialised grant (system context carrying the rule's organization) agrees the same way", async () => {
    const { sharing, tenant, bareFor } = boot();
    // What `SharingRuleService.reconcile` hands `grant`: the rule's own
    // `criteriaContext` — elevation plus the rule's organization.
    const r = await sharing.grant(
      { object: OBJECT, recordId: 'deal_a2', recipientId: 'u_y', source: 'rule', sourceId: 'rule_a' },
      { isSystem: true, tenantId: ORG_A } as never,
    );
    expect(await tenant(ORG_A)).toEqual(await bareFor(ORG_A));
    expect(await tenant(ORG_A)).toEqual([r.id]);
    expect(await tenant(ORG_B)).toEqual([]);
  });

  it('with grants in BOTH organizations, every tenant read equals the bare read for its organization, and the two are disjoint', async () => {
    const { sharing, bare, tenant, bareFor } = boot();
    const a = await sharing.grant({ object: OBJECT, recordId: 'deal_a1', recipientId: 'u_x' }, { userId: 'u_a', tenantId: ORG_A } as never);
    const b = await sharing.grant({ object: OBJECT, recordId: 'deal_b1', recipientId: 'u_x' }, { userId: 'u_b', tenantId: ORG_B } as never);
    const g = await sharing.grant(
      { object: OBJECT, recordId: 'deal_a2', recipientId: 'u_z', source: 'rule', sourceId: 'rule_a' },
      { isSystem: true, tenantId: ORG_A } as never,
    );
    expect(await bare()).toEqual([a.id, b.id, g.id].sort());
    expect(await tenant(ORG_A)).toEqual(await bareFor(ORG_A));
    expect(await tenant(ORG_B)).toEqual(await bareFor(ORG_B));
    expect(await tenant(ORG_A)).toEqual([a.id, g.id].sort());
    expect(await tenant(ORG_B)).toEqual([b.id]);
  });

  it('the `group` posture composes the union wall the same way — a member of both plants sees both', async () => {
    const { sharing, engine } = boot('group');
    const a = await sharing.grant(
      { object: OBJECT, recordId: 'deal_a1', recipientId: 'u_x', source: 'rule', sourceId: 'rule_a' },
      { isSystem: true, tenantId: ORG_A } as never,
    );
    const b = await sharing.grant(
      { object: OBJECT, recordId: 'deal_b1', recipientId: 'u_x', source: 'rule', sourceId: 'rule_b' },
      { isSystem: true, tenantId: ORG_B } as never,
    );
    const both = await engine.find(SHARE, {
      where: { object_name: OBJECT },
      context: { userId: 'reader', tenantId: ORG_A, accessible_org_ids: [ORG_A, ORG_B] },
    });
    expect((both as any[]).map((r) => r.id).sort()).toEqual([a.id, b.id].sort());
    const onlyA = await engine.find(SHARE, {
      where: { object_name: OBJECT },
      context: { userId: 'reader', tenantId: ORG_A, accessible_org_ids: [ORG_A] },
    });
    expect((onlyA as any[]).map((r) => r.id)).toEqual([a.id]);
  });

  it('CONTROL — the cliff itself: an organization-less legacy row is on the bare read and on NO tenant read', async () => {
    // The pre-repair row shape, exactly as every deployment has it today. This
    // is what the plugin-sharing backfill repairs; it is here so the reader can
    // see the failure the pins above close.
    const { tables, bare, tenant } = boot();
    tables[SHARE].push({
      id: 'shr_legacy', object_name: OBJECT, record_id: 'deal_a1', recipient_type: 'user', recipient_id: 'u_x',
      access_level: 'read', source: 'manual', organization_id: null,
    });
    expect(await bare()).toEqual(['shr_legacy']);
    expect(await tenant(ORG_A)).toEqual([]);   // not refused — absent, "never granted"
    expect(await tenant(ORG_B)).toEqual([]);
  });
});
