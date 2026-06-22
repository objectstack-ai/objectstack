// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach } from 'vitest';
import { SharingService } from './sharing-service.js';
import { SharingRuleService } from './sharing-rule-service.js';
import { TeamGraphService, expandPrincipal } from './team-graph.js';
import { BusinessUnitGraphService } from './business-unit-graph.js';
import { celToFilter } from './bootstrap-declared-sharing-rules.js';

interface Row { [k: string]: any }

function makeEngine() {
  const tables: Record<string, Row[]> = {};
  const ensure = (n: string) => (tables[n] ??= []);
  function matches(row: Row, f: any): boolean {
    if (!f || typeof f !== 'object') return true;
    if (Array.isArray(f.$or)) return f.$or.some((x: any) => matches(row, x));
    if (Array.isArray(f.$and)) return f.$and.every((x: any) => matches(row, x));
    for (const [k, v] of Object.entries(f)) {
      if (k === '$or' || k === '$and') continue;
      const rv = row[k];
      if (v != null && typeof v === 'object' && '$in' in (v as any)) {
        if (!(v as any).$in.includes(rv)) return false;
        continue;
      }
      if (v != null && typeof v === 'object' && '$ne' in (v as any)) {
        if (rv === (v as any).$ne) return false;
        continue;
      }
      if (v != null && typeof v === 'object' && '$gte' in (v as any)) {
        if (!(rv >= (v as any).$gte)) return false;
        continue;
      }
      if (rv !== v) return false;
    }
    return true;
  }
  return {
    _tables: tables,
    getSchema() { return undefined; },
    async find(o: string, opts?: any) {
      const f = opts?.filter ?? opts?.where;
      return ensure(o).filter(r => matches(r, f)).slice(0, opts?.limit ?? 10000);
    },
    async insert(o: string, data: any) { const row = { ...data }; ensure(o).push(row); return row; },
    async update(o: string, idOrData: any, dataOrOpts?: any) {
      const data = typeof idOrData === 'object' ? idOrData : dataOrOpts;
      const id = typeof idOrData === 'object' ? idOrData.id : idOrData;
      const t = ensure(o); const i = t.findIndex(r => r.id === id);
      if (i >= 0) t[i] = { ...t[i], ...data };
      return t[i];
    },
    async delete(o: string, opts?: any) {
      const t = ensure(o); const where = opts?.where ?? {};
      for (let i = t.length - 1; i >= 0; i--) if (matches(t[i], where)) t.splice(i, 1);
      return { ok: true };
    },
  };
}

describe('TeamGraphService (flat — better-auth sys_team)', () => {
  let engine: ReturnType<typeof makeEngine>;
  beforeEach(() => {
    engine = makeEngine();
    // FLAT teams — no parent_team_id; cross-org leak guard
    engine._tables.sys_team = [
      { id: 'eu_sales', name: 'eu_sales', organization_id: 'org1' },
      { id: 'us_sales', name: 'us_sales', organization_id: 'org1' },
      { id: 'foreign',  name: 'foreign',  organization_id: 'org2' },
    ];
    engine._tables.sys_team_member = [
      { id: 'tm1', team_id: 'eu_sales', user_id: 'alice' },
      { id: 'tm2', team_id: 'eu_sales', user_id: 'bob' },
      { id: 'tm3', team_id: 'us_sales', user_id: 'carol' },
    ];
    engine._tables.sys_member = [
      { id: 'm1', organization_id: 'org1', user_id: 'alice', role: 'sales_manager' },
      { id: 'm2', organization_id: 'org1', user_id: 'bob',   role: 'sales_rep' },
      { id: 'm3', organization_id: 'org2', user_id: 'eve',   role: 'sales_manager' },
    ];
    engine._tables.sys_user = [
      { id: 'alice', manager_id: 'bob' },
      { id: 'bob',   manager_id: 'carol' },
      { id: 'carol', manager_id: null },
    ];
  });

  it('expandUsers returns flat members (no hierarchy walk)', async () => {
    const g = new TeamGraphService({ engine: engine as any, organizationId: 'org1' });
    expect((await g.expandUsers('eu_sales')).sort()).toEqual(['alice', 'bob']);
    expect(await g.expandUsers('us_sales')).toEqual(['carol']);
  });

  it('expandRoleUsers scopes by organization', async () => {
    const g = new TeamGraphService({ engine: engine as any, organizationId: 'org1' });
    expect((await g.expandRoleUsers('sales_manager')).sort()).toEqual(['alice']);
  });

  it('managerOf walks chain', async () => {
    const g = new TeamGraphService({ engine: engine as any, organizationId: 'org1' });
    expect(await g.managerOf('alice')).toEqual('bob');
    expect(await g.managerOf('carol')).toBeNull();
  });

  it('expandPrincipal helper dispatches correctly', async () => {
    const t = new TeamGraphService({ engine: engine as any, organizationId: 'org1' });
    expect(await expandPrincipal({ type: 'user', value: 'x' }, { team: t, organizationId: 'org1' })).toEqual(['x']);
    expect((await expandPrincipal({ type: 'team', value: 'eu_sales' }, { team: t, organizationId: 'org1' })).sort()).toEqual(['alice', 'bob']);
    expect((await expandPrincipal({ type: 'role', value: 'sales_manager' }, { team: t, organizationId: 'org1' })).sort()).toEqual(['alice']);
    expect(await expandPrincipal({ type: 'manager', value: 'owner_id', record: { owner_id: 'alice' } }, { team: t, organizationId: 'org1' })).toEqual(['bob']);
    expect(await expandPrincipal({ type: 'queue', value: 'q1' }, { team: t, organizationId: 'org1' })).toEqual(['queue:q1']);
    // business_unit without a graph instance falls back to literal
    expect(await expandPrincipal({ type: 'business_unit', value: 'emea' }, { team: t, organizationId: 'org1' })).toEqual(['business_unit:emea']);
  });
});

describe('BusinessUnitGraphService (recursive sys_business_unit)', () => {
  let engine: ReturnType<typeof makeEngine>;
  beforeEach(() => {
    engine = makeEngine();
    // Hierarchy: emea → emea_sales → emea_sales_uk ; emea_marketing
    engine._tables.sys_business_unit = [
      { id: 'emea',           name: 'EMEA',           parent_business_unit_id: null,           organization_id: 'org1', active: true },
      { id: 'emea_sales',     name: 'EMEA Sales',     parent_business_unit_id: 'emea',         organization_id: 'org1', active: true },
      { id: 'emea_sales_uk',  name: 'EMEA Sales UK',  parent_business_unit_id: 'emea_sales',   organization_id: 'org1', active: true },
      { id: 'emea_marketing', name: 'EMEA Marketing', parent_business_unit_id: 'emea',         organization_id: 'org1', active: true },
      // Inactive subtree — must not contribute
      { id: 'emea_legacy',    name: 'EMEA Legacy',    parent_business_unit_id: 'emea',         organization_id: 'org1', active: false },
      // Foreign tenant — must not leak
      { id: 'foreign',        name: 'Foreign',        parent_business_unit_id: 'emea',         organization_id: 'org2', active: true },
    ];
    engine._tables.sys_business_unit_member = [
      { id: 'dm1', business_unit_id: 'emea_sales_uk',  user_id: 'alice' },
      { id: 'dm2', business_unit_id: 'emea_sales',     user_id: 'bob' },
      { id: 'dm3', business_unit_id: 'emea_marketing', user_id: 'carol' },
      { id: 'dm4', business_unit_id: 'emea_legacy',    user_id: 'ghost' },
    ];
  });

  it('descendants walks the active hierarchy', async () => {
    const d = new BusinessUnitGraphService({ engine: engine as any, organizationId: 'org1' });
    expect((await d.descendants('emea')).sort()).toEqual(['emea', 'emea_marketing', 'emea_sales', 'emea_sales_uk']);
  });

  it('expandUsers returns members of all descendant business units', async () => {
    const d = new BusinessUnitGraphService({ engine: engine as any, organizationId: 'org1' });
    expect((await d.expandUsers('emea')).sort()).toEqual(['alice', 'bob', 'carol']);
  });

  it('expandUsers of leaf returns just leaf members', async () => {
    const d = new BusinessUnitGraphService({ engine: engine as any, organizationId: 'org1' });
    expect(await d.expandUsers('emea_sales_uk')).toEqual(['alice']);
  });

  it('inactive subtree contributes no members', async () => {
    const d = new BusinessUnitGraphService({ engine: engine as any, organizationId: 'org1' });
    expect(await d.expandUsers('emea_legacy')).toEqual([]);
  });

  it('cross-tenant lookup is blocked by org scope', async () => {
    const d = new BusinessUnitGraphService({ engine: engine as any, organizationId: 'org1' });
    // 'foreign' is in org2 — descendants from emea should not include it
    const desc = await d.descendants('emea');
    expect(desc).not.toContain('foreign');
  });

  it('headOf returns manager_user_id (when set)', async () => {
    engine._tables.sys_business_unit[1].manager_user_id = 'alice';
    const d = new BusinessUnitGraphService({ engine: engine as any, organizationId: 'org1' });
    expect(await d.headOf('emea_sales')).toEqual('alice');
    expect(await d.headOf('emea_marketing')).toBeNull();
  });

  it('headOf is org-scoped — does not leak a manager across organizations', async () => {
    // 'foreign' is in org2; an org1-scoped service must not read its head.
    const foreign = engine._tables.sys_business_unit.find((r: any) => r.id === 'foreign');
    foreign.manager_user_id = 'mallory';
    const d = new BusinessUnitGraphService({ engine: engine as any, organizationId: 'org1' });
    expect(await d.headOf('foreign')).toBeNull();
  });
});

describe('SharingRuleService', () => {
  let engine: ReturnType<typeof makeEngine>;
  let sharing: SharingService;
  let rules: SharingRuleService;
  const SYS = { isSystem: true, organizationId: 'org1' } as any;

  beforeEach(() => {
    engine = makeEngine();
    // Seed: 3 opportunities — 2 high-value, 1 low.
    engine._tables.opportunity = [
      { id: 'opp1', name: 'Big1', amount: 200000, owner_id: 'someone' },
      { id: 'opp2', name: 'Big2', amount: 150000, owner_id: 'someone' },
      { id: 'opp3', name: 'Small', amount: 5000, owner_id: 'someone' },
    ];
    engine._tables.sys_team = [
      { id: 'sales', name: 'sales', organization_id: 'org1' },
    ];
    engine._tables.sys_team_member = [
      { id: 'tm1', team_id: 'sales', user_id: 'alice' },
      { id: 'tm2', team_id: 'sales', user_id: 'bob' },
    ];
    // Department hierarchy: emea_sales (Alice) → emea_sales_uk (Bob)
    engine._tables.sys_business_unit = [
      { id: 'emea_sales',    name: 'EMEA Sales',    parent_business_unit_id: null,         organization_id: 'org1', active: true },
      { id: 'emea_sales_uk', name: 'EMEA Sales UK', parent_business_unit_id: 'emea_sales', organization_id: 'org1', active: true },
    ];
    engine._tables.sys_business_unit_member = [
      { id: 'dm1', business_unit_id: 'emea_sales',    user_id: 'alice' },
      { id: 'dm2', business_unit_id: 'emea_sales_uk', user_id: 'bob' },
    ];
    sharing = new SharingService({ engine: engine as any });
    rules = new SharingRuleService({ engine: engine as any, sharing });
  });

  it('defineRule creates a new rule', async () => {
    const r = await rules.defineRule({
      name: 'high_value', label: 'High value', object: 'opportunity',
      criteria: { amount: { $gte: 100000 } },
      recipientType: 'team', recipientId: 'sales', accessLevel: 'read',
    }, SYS);
    expect(r.id).toBeDefined();
    expect(r.criteria).toEqual({ amount: { $gte: 100000 } });
    expect(engine._tables.sys_sharing_rule).toHaveLength(1);
  });

  it('defineRule upserts on duplicate name within org', async () => {
    await rules.defineRule({ name: 'x', label: 'X', object: 'opportunity', recipientType: 'user', recipientId: 'a' }, SYS);
    await rules.defineRule({ name: 'x', label: 'X-renamed', object: 'opportunity', recipientType: 'user', recipientId: 'b' }, SYS);
    expect(engine._tables.sys_sharing_rule).toHaveLength(1);
    expect(engine._tables.sys_sharing_rule[0].label).toBe('X-renamed');
    expect(engine._tables.sys_sharing_rule[0].recipient_id).toBe('b');
  });

  it('evaluateRule materialises grants for matching records × expanded users', async () => {
    const r = await rules.defineRule({
      name: 'hv', label: 'High value', object: 'opportunity',
      criteria: { amount: { $gte: 100000 } },
      recipientType: 'team', recipientId: 'sales', accessLevel: 'read',
    }, SYS);
    const res = await rules.evaluateRule(r.id, SYS);
    expect(res.matchedRecords).toBe(2);
    expect(res.expandedUsers).toBe(2);
    expect(res.grantsCreated).toBe(4); // 2 records × 2 users
    expect(engine._tables.sys_record_share).toHaveLength(4);
    // Verify shape
    const shares = engine._tables.sys_record_share;
    expect(new Set(shares.map(s => s.record_id))).toEqual(new Set(['opp1', 'opp2']));
    expect(new Set(shares.map(s => s.recipient_id))).toEqual(new Set(['alice', 'bob']));
    expect(shares.every(s => s.source === 'rule' && s.source_id === r.id && s.access_level === 'read')).toBe(true);
  });

  it('evaluateRule reconciles — re-running with a narrower criteria revokes stale grants', async () => {
    const r = await rules.defineRule({
      name: 'hv', label: 'HV', object: 'opportunity',
      criteria: { amount: { $gte: 100000 } },
      recipientType: 'team', recipientId: 'sales',
    }, SYS);
    await rules.evaluateRule(r.id, SYS);
    expect(engine._tables.sys_record_share).toHaveLength(4);

    // Tighten criteria — now only opp1 (200k) qualifies.
    await rules.defineRule({
      name: 'hv', label: 'HV', object: 'opportunity',
      criteria: { amount: { $gte: 175000 } },
      recipientType: 'team', recipientId: 'sales',
    }, SYS);
    const res = await rules.evaluateRule(r.id, SYS);
    expect(res.matchedRecords).toBe(1);
    expect(res.grantsRevoked).toBe(2);
    expect(engine._tables.sys_record_share).toHaveLength(2);
    expect(engine._tables.sys_record_share.every(s => s.record_id === 'opp1')).toBe(true);
  });

  it('evaluateAllForRecord upserts when record newly matches', async () => {
    const r = await rules.defineRule({
      name: 'hv', label: 'HV', object: 'opportunity',
      criteria: { amount: { $gte: 100000 } },
      recipientType: 'team', recipientId: 'sales',
    }, SYS);
    const res = await rules.evaluateAllForRecord('opportunity', 'opp1', SYS);
    expect(res[0].matchedRecords).toBe(1);
    expect(res[0].grantsCreated).toBe(2);
    expect(engine._tables.sys_record_share).toHaveLength(2);
  });

  it('evaluateAllForRecord revokes when record no longer matches', async () => {
    const r = await rules.defineRule({
      name: 'hv', label: 'HV', object: 'opportunity',
      criteria: { amount: { $gte: 100000 } },
      recipientType: 'team', recipientId: 'sales',
    }, SYS);
    await rules.evaluateRule(r.id, SYS);
    // Drop opp1 below threshold
    engine._tables.opportunity[0].amount = 5;
    const res = await rules.evaluateAllForRecord('opportunity', 'opp1', SYS);
    expect(res[0].grantsRevoked).toBe(2);
    // Only opp2 grants remain
    expect(engine._tables.sys_record_share.every(s => s.record_id === 'opp2')).toBe(true);
  });

  it('deleteRule drops rule + all its grants', async () => {
    const r = await rules.defineRule({
      name: 'hv', label: 'HV', object: 'opportunity',
      criteria: { amount: { $gte: 100000 } },
      recipientType: 'team', recipientId: 'sales',
    }, SYS);
    await rules.evaluateRule(r.id, SYS);
    expect(engine._tables.sys_record_share.length).toBeGreaterThan(0);
    await rules.deleteRule(r.id, SYS);
    expect(engine._tables.sys_sharing_rule).toHaveLength(0);
    expect(engine._tables.sys_record_share).toHaveLength(0);
  });

  it('inactive rule purges grants on evaluate', async () => {
    const r = await rules.defineRule({
      name: 'hv', label: 'HV', object: 'opportunity',
      criteria: { amount: { $gte: 100000 } },
      recipientType: 'team', recipientId: 'sales',
    }, SYS);
    await rules.evaluateRule(r.id, SYS);
    expect(engine._tables.sys_record_share).toHaveLength(4);
    await rules.defineRule({
      name: 'hv', label: 'HV', object: 'opportunity',
      criteria: { amount: { $gte: 100000 } },
      recipientType: 'team', recipientId: 'sales', active: false,
    }, SYS);
    const res = await rules.evaluateRule(r.id, SYS);
    expect(res.grantsRevoked).toBe(4);
    expect(engine._tables.sys_record_share).toHaveLength(0);
  });

  it('listRules filters by object + activeOnly', async () => {
    await rules.defineRule({ name: 'a', label: 'A', object: 'opportunity', recipientType: 'user', recipientId: 'x' }, SYS);
    await rules.defineRule({ name: 'b', label: 'B', object: 'account',     recipientType: 'user', recipientId: 'y' }, SYS);
    await rules.defineRule({ name: 'c', label: 'C', object: 'opportunity', recipientType: 'user', recipientId: 'z', active: false }, SYS);
    const opps = await rules.listRules({ object: 'opportunity' }, SYS);
    expect(opps).toHaveLength(2);
    const active = await rules.listRules({ object: 'opportunity', activeOnly: true }, SYS);
    expect(active.map(r => r.name)).toEqual(['a']);
  });

  it('recipientType=business_unit expands via the BU graph (BFS)', async () => {
    const r = await rules.defineRule({
      name: 'dept_rule', label: 'Dept Rule', object: 'opportunity',
      criteria: { amount: { $gte: 100000 } },
      recipientType: 'business_unit', recipientId: 'emea_sales', accessLevel: 'read',
    }, SYS);
    const res = await rules.evaluateRule(r.id, SYS);
    expect(res.matchedRecords).toBe(2);          // opp1, opp2
    expect(res.expandedUsers).toBe(2);            // alice (emea_sales) + bob (emea_sales_uk descendant)
    expect(res.grantsCreated).toBe(4);
    expect(engine._tables.sys_record_share).toHaveLength(4);
    expect(new Set(engine._tables.sys_record_share.map(s => s.recipient_id))).toEqual(new Set(['alice', 'bob']));
  });
});

// ---------------------------------------------------------------------------
// #1887 — sharing CEL `condition` compiled & ENFORCED end-to-end (ADR-0058 D3)
//
// Before P2, a compound CEL condition returned null from celToFilter and the
// rule was SKIPPED (decorative metadata, #1887). Now the canonical compiler
// lowers it to a compound `criteria_json` that the runtime matching honours, so
// exactly the records satisfying the full predicate materialise grants.
// ---------------------------------------------------------------------------
describe('#1887 — compound sharing condition compiled + enforced (ADR-0058 D3)', () => {
  let engine: ReturnType<typeof makeEngine>;
  let sharing: SharingService;
  let rules: SharingRuleService;
  const SYS = { isSystem: true, organizationId: 'org1' } as any;

  beforeEach(() => {
    engine = makeEngine();
    engine._tables.opportunity = [
      { id: 'opp1', name: 'Big1', amount: 200000 }, // matches amount>=100k AND name=Big1
      { id: 'opp2', name: 'Big2', amount: 150000 }, // amount ok but wrong name
      { id: 'opp3', name: 'Small', amount: 5000 },  // neither
    ];
    sharing = new SharingService({ engine: engine as any });
    rules = new SharingRuleService({ engine: engine as any, sharing });
  });

  it('celToFilter lowers a COMPOUND CEL condition to a compound FilterCondition', () => {
    expect(celToFilter('record.amount >= 100000 && record.name == "Big1"'))
      .toEqual({ $and: [{ amount: { $gte: 100000 } }, { name: 'Big1' }] });
    // accepts the { dialect, source } authoring shape
    expect(celToFilter({ dialect: 'cel', source: 'record.amount >= 100000' }))
      .toEqual({ amount: { $gte: 100000 } });
    // null-check & disjunction lower too (no longer field-equality-only)
    expect(celToFilter('record.region == null || record.tier == "gold"')).toEqual({
      $or: [{ region: { $null: true } }, { tier: 'gold' }],
    });
    // non-pushdownable → null → caller skips (never a permissive match-all)
    expect(celToFilter('size(record.tags) > 0')).toBeNull();
  });

  it('shares ONLY the records satisfying the full AND (not just one conjunct)', async () => {
    const r = await rules.defineRule({
      name: 'big1_hv', label: 'Big1 high-value', object: 'opportunity',
      criteria: celToFilter('record.amount >= 100000 && record.name == "Big1"'),
      recipientType: 'user', recipientId: 'alice', accessLevel: 'read',
    }, SYS);
    // The CEL condition persisted as a COMPOUND criteria_json (not skipped).
    expect(JSON.parse(engine._tables.sys_sharing_rule[0].criteria_json))
      .toEqual({ $and: [{ amount: { $gte: 100000 } }, { name: 'Big1' }] });

    const res = await rules.evaluateRule(r.id, SYS);
    expect(res.matchedRecords).toBe(1); // only opp1 — opp2 fails the name conjunct
    const shared = (engine._tables.sys_record_share ?? [])
      .filter((sh: any) => sh.recipient_id === 'alice')
      .map((sh: any) => sh.record_id);
    expect(shared).toEqual(['opp1']);
  });
});
