// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { assertEngineDeleteDispatch } from '@objectstack/objectql';
// [#7795] The platform's own code↔status pairing, so the delete-refusal tests
// assert an HTTP status they SOURCE rather than one they restate.
import { HttpStatusErrorCodeMap } from '@objectstack/spec/api';
import { SharingService } from './sharing-service.js';
import { SharingRuleService } from './sharing-rule-service.js';
import { TeamGraphService, expandPrincipal } from './team-graph.js';
import { BusinessUnitGraphService } from './business-unit-graph.js';
import { celToFilter } from './bootstrap-declared-sharing-rules.js';
import { isMatchAllCriteria } from './rule-criteria.js';
import { bindRuleCriteriaGuard } from './rule-hooks.js';

interface Row { [k: string]: any }

/** Stored criteria of a rule row, parsed back out of `criteria_json`. */
function rowCriteria(engine: { _tables: Record<string, Row[]> }, id: string): unknown {
  const row = (engine._tables.sys_sharing_rule ?? []).find((r) => r.id === id);
  return row?.criteria_json == null ? undefined : JSON.parse(row.criteria_json);
}

function makeEngine() {
  const tables: Record<string, Row[]> = {};
  const ensure = (n: string) => (tables[n] ??= []);
  function matches(row: Row, f: any): boolean {
    if (!f || typeof f !== 'object') return true;
    // [#7676] A combinator is CONJOINED with its sibling field keys, never a
    // short-circuit that returns before they are read. This used to
    // `return f.$or.some(...)`, silently DROPPING every sibling — so
    // `listRules`'s `{object_name, active, $or:[…org scope…]}` would have
    // matched the whole table here while the real drivers (driver-sql's
    // `applyFilterCondition`, driver-memory's mingo document) AND the two.
    // A fake looser than the contract it stands in for is how a green suite
    // ships a broken filter (the #4434 lesson, applied to reads).
    if (Array.isArray(f.$or) && !f.$or.some((x: any) => matches(row, x))) return false;
    if (Array.isArray(f.$and) && !f.$and.every((x: any) => matches(row, x))) return false;
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
      // Pinned to `ObjectQLEngine.delete`'s OWN dispatch predicate
      // (objectstack#4434, objectstack#4550).
      //
      // The real engine routes a delete by SCALAR `where.id` to `driver.delete`
      // and anything else to `driver.deleteMany` — but only when
      // `options.multi` is set; otherwise it throws. This fake used to accept
      // any `where`, so `deleteRule`'s predicate-shaped purge of
      // `sys_record_share` passed here while the running server answered 500 to
      // every `DELETE /sharing/rules/:idOrName`. A fake looser than the
      // contract it stands in for is how a green suite ships a dead route.
      //
      // #4434 closed that by MIRRORING the guard here. A mirror is a second
      // copy of the contract and drifts the moment either side is edited, so it
      // now calls the producer's exported decision instead — the same function
      // `ObjectQL.delete` dispatches on. `pnpm check:engine-double-contract`
      // holds every fake engine to this.
      assertEngineDeleteDispatch(opts);
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
    await rules.defineRule({ name: 'x', label: 'X', object: 'opportunity', criteria: { amount: 200000 }, recipientType: 'user', recipientId: 'a' }, SYS);
    await rules.defineRule({ name: 'x', label: 'X-renamed', object: 'opportunity', criteria: { amount: 200000 }, recipientType: 'user', recipientId: 'b' }, SYS);
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

  /**
   * objectstack#4434 — `DELETE /sharing/rules/:idOrName` answered 500 for BOTH
   * address forms. `deleteRule` purged `sys_record_share` with a
   * predicate-shaped `engine.delete` carrying neither a scalar id nor
   * `multi: true`, the one shape the engine's dispatch refuses, so it threw
   * before ever reaching the rule row. With #4433 also closing the
   * deactivation path, an over-granting rule had no withdrawal path left at
   * all — the reason both were RC-exit blockers.
   */
  it('deleteRule issues only engine-legal deletes — by NAME (#4434)', async () => {
    await rules.defineRule({
      name: 'rc1_rule_livetest', label: 'HV', object: 'opportunity',
      criteria: { amount: { $gte: 100000 } },
      recipientType: 'team', recipientId: 'sales',
    }, SYS);
    await rules.evaluateRule('rc1_rule_livetest', SYS);
    expect(engine._tables.sys_record_share.length).toBeGreaterThan(0);

    // The repro addressed the rule by name; the throw was unconditional.
    await expect(rules.deleteRule('rc1_rule_livetest', SYS)).resolves.toBeUndefined();
    expect(engine._tables.sys_sharing_rule).toHaveLength(0);
    expect(engine._tables.sys_record_share).toHaveLength(0);
  });

  it('deleteRule issues only engine-legal deletes — by ID (#4434)', async () => {
    const r = await rules.defineRule({
      name: 'rc1_rule_livetest', label: 'HV', object: 'opportunity',
      criteria: { amount: { $gte: 100000 } },
      recipientType: 'team', recipientId: 'sales',
    }, SYS);
    await rules.evaluateRule(r.id, SYS);
    await expect(rules.deleteRule(r.id, SYS)).resolves.toBeUndefined();
    expect(engine._tables.sys_sharing_rule).toHaveLength(0);
    expect(engine._tables.sys_record_share).toHaveLength(0);
  });

  it('deleteRule withdraws grants through the sharing service, not a bulk delete (#4434)', async () => {
    const r = await rules.defineRule({
      name: 'hv', label: 'HV', object: 'opportunity',
      criteria: { amount: { $gte: 100000 } },
      recipientType: 'team', recipientId: 'sales',
    }, SYS);
    await rules.evaluateRule(r.id, SYS);
    const granted = engine._tables.sys_record_share.length;
    expect(granted).toBeGreaterThan(0);

    // Every grant retires down the same path as every other withdrawal
    // (evaluateRule-on-inactive, revokeRuleGrants) — one revoke per row —
    // rather than a second, divergent bulk-delete path.
    const revoke = vi.spyOn(sharing, 'revoke');
    await rules.deleteRule(r.id, SYS);
    expect(revoke).toHaveBeenCalledTimes(granted);
    revoke.mockRestore();
  });

  /**
   * objectstack#4433 (record-touch half) — `evaluateAllForRecord` listed only
   * ACTIVE rules, so a deactivated rule was absent from the loop entirely and
   * the grants it had materialised were never even examined. Touching the
   * record — the very event that created the grant — walked past it, which is
   * step 6 of the issue's repro.
   */
  it('touching a record withdraws a deactivated rule\'s grants (#4433)', async () => {
    const r = await rules.defineRule({
      name: 'hv', label: 'HV', object: 'opportunity',
      criteria: { amount: { $gte: 100000 } },
      recipientType: 'team', recipientId: 'sales',
    }, SYS);
    await rules.evaluateRule(r.id, SYS);
    const before = engine._tables.sys_record_share.filter(s => s.record_id === 'opp1');
    expect(before.length).toBeGreaterThan(0);

    // Admin switches the rule OFF (no explicit evaluate), then the record is
    // touched — the afterUpdate hook's call.
    await rules.defineRule({
      name: 'hv', label: 'HV', object: 'opportunity',
      criteria: { amount: { $gte: 100000 } },
      recipientType: 'team', recipientId: 'sales', active: false,
    }, SYS);
    const res = await rules.evaluateAllForRecord('opportunity', 'opp1', SYS);

    expect(res[0].grantsRevoked).toBe(before.length);
    expect(engine._tables.sys_record_share.filter(s => s.record_id === 'opp1')).toHaveLength(0);
  });

  it('an inactive rule never re-grants on touch (#4433)', async () => {
    const r = await rules.defineRule({
      name: 'hv', label: 'HV', object: 'opportunity',
      criteria: { amount: { $gte: 100000 } },
      recipientType: 'team', recipientId: 'sales', active: false,
    }, SYS);
    await rules.evaluateAllForRecord('opportunity', 'opp1', SYS);
    expect(engine._tables.sys_record_share ?? []).toHaveLength(0);
    expect(r.active).toBe(false);
  });

  /**
   * objectstack#4433 — a grant whose rule row is GONE cannot be reached by
   * reconciling rules (there is no rule left to iterate), so it needs its own
   * sweep. These are the rows left by every path that removes a rule without
   * `deleteRule`: a data-API delete while the hook was unbound, a migration, a
   * crash between `deleteRule`'s two writes.
   */
  it('sweepOrphanedRuleGrants revokes grants whose rule row is gone (#4433)', async () => {
    const r = await rules.defineRule({
      name: 'hv', label: 'HV', object: 'opportunity',
      criteria: { amount: { $gte: 100000 } },
      recipientType: 'team', recipientId: 'sales',
    }, SYS);
    await rules.evaluateRule(r.id, SYS);
    const granted = engine._tables.sys_record_share.length;
    expect(granted).toBeGreaterThan(0);

    // Rule row vanishes behind the service's back.
    engine._tables.sys_sharing_rule = [];

    expect(await rules.sweepOrphanedRuleGrants()).toBe(granted);
    expect(engine._tables.sys_record_share).toHaveLength(0);
  });

  it('sweepOrphanedRuleGrants leaves live rule grants and manual shares alone (#4433)', async () => {
    const r = await rules.defineRule({
      name: 'hv', label: 'HV', object: 'opportunity',
      criteria: { amount: { $gte: 100000 } },
      recipientType: 'team', recipientId: 'sales',
    }, SYS);
    await rules.evaluateRule(r.id, SYS);
    const ruleGrants = engine._tables.sys_record_share.length;
    // A hand-made share, plus a grant from a rule that no longer exists.
    engine._tables.sys_record_share.push(
      { id: 'manual1', object_name: 'opportunity', record_id: 'opp1', recipient_id: 'zoe', source: 'manual' },
      { id: 'orphan1', object_name: 'opportunity', record_id: 'opp1', recipient_id: 'zoe', source: 'rule', source_id: 'srule_gone' },
    );

    expect(await rules.sweepOrphanedRuleGrants()).toBe(1);
    expect(engine._tables.sys_record_share).toHaveLength(ruleGrants + 1);
    expect(engine._tables.sys_record_share.some(s => s.id === 'manual1')).toBe(true);
    expect(engine._tables.sys_record_share.some(s => s.id === 'orphan1')).toBe(false);
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
    const anyOpen = { stage: 'open' };
    await rules.defineRule({ name: 'a', label: 'A', object: 'opportunity', criteria: anyOpen, recipientType: 'user', recipientId: 'x' }, SYS);
    await rules.defineRule({ name: 'b', label: 'B', object: 'account',     criteria: anyOpen, recipientType: 'user', recipientId: 'y' }, SYS);
    await rules.defineRule({ name: 'c', label: 'C', object: 'opportunity', criteria: anyOpen, recipientType: 'user', recipientId: 'z', active: false }, SYS);
    const opps = await rules.listRules({ object: 'opportunity' }, SYS);
    expect(opps).toHaveLength(2);
    const active = await rules.listRules({ object: 'opportunity', activeOnly: true }, SYS);
    expect(active.map(r => r.name)).toEqual(['a']);
  });

  // [#7807] This pair replaces a single test that asserted
  // `recipientType=business_unit` expanded "alice (emea_sales) + bob
  // (emea_sales_uk descendant)" — i.e. it pinned the over-grant as if it were
  // the contract. `business_unit` is declared as exactly one unit's members
  // (no subtree); the subtree is `unit_and_subordinates`' own semantics
  // (ADR-0057 D5). Both widths are asserted here on the SAME anchor so a
  // change that collapsed them again fails as the width it broke.
  it('recipientType=business_unit expands EXACTLY ONE unit — no subtree (#7807)', async () => {
    const r = await rules.defineRule({
      name: 'dept_rule', label: 'Dept Rule', object: 'opportunity',
      criteria: { amount: { $gte: 100000 } },
      recipientType: 'business_unit', recipientId: 'emea_sales', accessLevel: 'read',
    }, SYS);
    const res = await rules.evaluateRule(r.id, SYS);
    expect(res.matchedRecords).toBe(2);          // opp1, opp2
    expect(res.expandedUsers).toBe(1);            // alice (emea_sales) — bob is a DESCENDANT
    expect(res.grantsCreated).toBe(2);
    expect(engine._tables.sys_record_share).toHaveLength(2);
    expect(new Set(engine._tables.sys_record_share.map(s => s.recipient_id))).toEqual(new Set(['alice']));
  });

  it('recipientType=unit_and_subordinates expands the whole subtree (the wider half)', async () => {
    const r = await rules.defineRule({
      name: 'dept_subtree_rule', label: 'Dept Subtree Rule', object: 'opportunity',
      criteria: { amount: { $gte: 100000 } },
      recipientType: 'unit_and_subordinates', recipientId: 'emea_sales', accessLevel: 'read',
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

// ---------------------------------------------------------------------------
// #3896 — a rule with no criteria must share NOTHING, never everything
//
// `SharingRuleSchema` requires `condition` and its doc is explicit: a
// predicate the compiler cannot lower is "skipped and logged — never seeded as
// a permissive match-all (ADR-0049)". The seed path honoured that; the two
// other ways to create a rule did not:
//
//   1. `defineRule` — which `POST {basePath}/sharing/rules` plucks its body
//      into without ever running the schema. A missing, null, or MISSPELLED
//      (`criterias`) key stored `criteria_json: null`, returned 201, and then
//      evaluated as `find(object, { filter: {}, context: SYSTEM_CTX })` —
//      every record of the object, granted to the recipient.
//   2. A direct `sys_sharing_rule` insert, which is what authoring a rule in
//      the Setup UI issues.
//
// Both are now refused, and the evaluator refuses to act on such a row
// regardless of how it got there — so rules stored before this gate existed
// under-share instead of over-sharing.
// ---------------------------------------------------------------------------
describe('#3896 — missing criteria never becomes "share every record" (ADR-0049)', () => {
  let engine: ReturnType<typeof makeEngine>;
  let sharing: SharingService;
  let rules: SharingRuleService;
  const SYS = { isSystem: true, organizationId: 'org1' } as any;
  const BASE = {
    name: 'won_deals', label: 'Won Deals', object: 'opportunity',
    recipientType: 'position' as const, recipientId: 'sales_rep', accessLevel: 'read' as const,
  };

  beforeEach(() => {
    engine = makeEngine();
    engine._tables.opportunity = [
      { id: 'opp1', stage: 'won',  amount: 200000 },
      { id: 'opp2', stage: 'lost', amount: 150000 },
      { id: 'opp3', stage: 'open', amount: 5000 },
    ];
    sharing = new SharingService({ engine: engine as any });
    rules = new SharingRuleService({ engine: engine as any, sharing });
  });

  describe('isMatchAllCriteria', () => {
    it('flags every shape that reaches the engine as an unconstrained filter', () => {
      for (const shape of [undefined, null, '', '   ', {}, [], '{}', '[]', true, 42,
                           { $and: [] }, { $or: [] }, { $and: [{}] }, { $or: [{ a: 1 }, {}] },
                           'record.stage == "won"' /* CEL, not JSON — engine ignores it */]) {
        expect(isMatchAllCriteria(shape), `${JSON.stringify(shape) ?? String(shape)} should be match-all`).toBe(true);
      }
    });

    it('passes anything that actually narrows the result set', () => {
      for (const shape of [{ stage: 'won' }, '{"stage":"won"}', { amount: { $gte: 1 } },
                           [{ stage: 'won' }], { $and: [{ stage: 'won' }] }, { $or: [{ a: 1 }, { b: 2 }] }]) {
        expect(isMatchAllCriteria(shape), `${JSON.stringify(shape)} should NOT be match-all`).toBe(false);
      }
    });
  });

  describe('defineRule (the REST + programmatic entry)', () => {
    it('rejects the reported typo — `criterias` instead of `criteria` — instead of sharing everything', async () => {
      // Verbatim from the issue: the author means "share won deals" and the
      // extra key is dropped by the REST pluck, leaving criteria undefined.
      await expect(
        rules.defineRule({ ...BASE, criterias: { stage: 'won' } } as any, SYS),
      ).rejects.toThrow(/VALIDATION_FAILED/);
      expect(engine._tables.sys_sharing_rule ?? []).toHaveLength(0);
    });

    it('rejects every match-all criteria shape, writing no row', async () => {
      for (const criteria of [undefined, null, '', {}, [], '{}', { $and: [] }, 'record.stage == "won"']) {
        await expect(
          rules.defineRule({ ...BASE, criteria } as any, SYS),
          `criteria=${JSON.stringify(criteria) ?? 'undefined'}`,
        ).rejects.toThrow(/VALIDATION_FAILED: criteria is required/);
      }
      expect(engine._tables.sys_sharing_rule ?? []).toHaveLength(0);
    });

    it('names the field and the misspelling risk so the 400 is actionable', async () => {
      await expect(rules.defineRule({ ...BASE } as any, SYS)).rejects.toThrow(/criterias/);
    });

    it('still accepts a real predicate (the guard is not a blanket refusal)', async () => {
      const r = await rules.defineRule({ ...BASE, criteria: { stage: 'won' } }, SYS);
      expect(r.criteria).toEqual({ stage: 'won' });
      const res = await rules.evaluateRule(r.id, SYS);
      expect(res.matchedRecords).toBe(1);
    });

    it('rejects an UPSERT that would widen an existing rule to match-all', async () => {
      const r = await rules.defineRule({ ...BASE, criteria: { stage: 'won' } }, SYS);
      await expect(rules.defineRule({ ...BASE, criteria: {} } as any, SYS)).rejects.toThrow(/VALIDATION_FAILED/);
      // The stored rule keeps its original narrow criteria.
      expect(rowCriteria(engine, r.id)).toEqual({ stage: 'won' });
    });
  });

  describe('evaluator backstop (rows that predate the gate / bypass defineRule)', () => {
    /** A row as the Setup UI's data-API insert would leave it: no criteria. */
    function seedRawRule(overrides: Record<string, any> = {}): string {
      const id = 'srule_legacy';
      (engine._tables.sys_sharing_rule ??= []).push({
        id, organization_id: 'org1', name: 'legacy_all', label: 'Legacy',
        object_name: 'opportunity', criteria_json: null,
        recipient_type: 'user', recipient_id: 'alice',
        access_level: 'read', active: true, ...overrides,
      });
      return id;
    }

    it('THE GATE: a rule with missing criteria produces NO sys_record_share row', async () => {
      const id = seedRawRule();
      const res = await rules.evaluateRule(id, SYS);
      expect(res.matchedRecords).toBe(0);
      expect(res.grantsCreated).toBe(0);
      expect(engine._tables.sys_record_share ?? []).toHaveLength(0);
    });

    it('revokes grants a match-all rule had already materialised', async () => {
      const id = seedRawRule();
      // Pretend a pre-fix boot had already shared the whole object.
      for (const recordId of ['opp1', 'opp2', 'opp3']) {
        await sharing.grant({
          object: 'opportunity', recordId, recipientType: 'user', recipientId: 'alice',
          accessLevel: 'read', source: 'rule', sourceId: id, reason: 'rule:legacy_all',
        } as any, SYS);
      }
      expect(engine._tables.sys_record_share).toHaveLength(3);
      const res = await rules.evaluateRule(id, SYS);
      expect(res.grantsRevoked).toBe(3);
      expect(engine._tables.sys_record_share).toHaveLength(0);
    });

    it('logs the refusal rather than failing silently', async () => {
      const warn = vi.fn();
      const svc = new SharingRuleService({ engine: engine as any, sharing, logger: { warn } });
      await svc.evaluateRule(seedRawRule(), SYS);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('ADR-0049'), expect.objectContaining({ rule: 'legacy_all' }));
    });

    it('the per-record path (write hooks) refuses too — recordMatches is not a second hole', async () => {
      seedRawRule();
      const res = await rules.evaluateAllForRecord('opportunity', 'opp1', SYS);
      expect(res[0].matchedRecords).toBe(0);
      expect(res[0].grantsCreated).toBe(0);
      expect(engine._tables.sys_record_share ?? []).toHaveLength(0);
    });

    it('an unparsable criteria_json (a CEL source typed into the textarea) is inert, not match-all', async () => {
      const id = seedRawRule({ criteria_json: 'record.stage == "won"' });
      const res = await rules.evaluateRule(id, SYS);
      expect(res.matchedRecords).toBe(0);
      expect(engine._tables.sys_record_share ?? []).toHaveLength(0);
    });
  });

  describe('bindRuleCriteriaGuard (the Setup UI data-API entry)', () => {
    function makeHookEngine() {
      const hooks: Array<{ event: string; handler: (ctx: any) => any; options: any }> = [];
      return {
        hooks,
        registerHook(event: string, handler: (ctx: any) => any, options: any = {}) { hooks.push({ event, handler, options }); },
        unregisterHooksByPackage(packageId: string) {
          let removed = 0;
          for (let i = hooks.length - 1; i >= 0; i--) if (hooks[i].options.packageId === packageId) { hooks.splice(i, 1); removed++; }
          return removed;
        },
        async fire(event: string, data: any, id?: string) {
          for (const h of hooks.filter((x) => x.event === event)) await h.handler({ input: { data, id } });
        },
      };
    }

    it('fails the INSERT of a rule with no criteria_json', async () => {
      const e = makeHookEngine();
      bindRuleCriteriaGuard(e as any);
      await expect(e.fire('beforeInsert', { name: 'all_opps', object_name: 'opportunity', recipient_id: 'alice' }))
        .rejects.toThrow(/criteria is required/);
      await expect(e.fire('beforeInsert', { name: 'all_opps', criteria_json: '{}' })).rejects.toThrow(/criteria is required/);
    });

    it('reports the failure as a field-level VALIDATION_FAILED (a 400, not a 500)', async () => {
      const e = makeHookEngine();
      bindRuleCriteriaGuard(e as any);
      const err = await e.fire('beforeInsert', { name: 'all_opps' }).catch((x: any) => x);
      expect(err.code).toBe('VALIDATION_FAILED');
      expect(err.fields).toEqual([expect.objectContaining({ field: 'criteria_json' })]);
    });

    it('allows an insert that carries a real predicate', async () => {
      const e = makeHookEngine();
      bindRuleCriteriaGuard(e as any);
      await expect(e.fire('beforeInsert', { name: 'won', criteria_json: '{"stage":"won"}' })).resolves.toBeUndefined();
    });

    it('lets an admin DEACTIVATE a legacy criteria-less rule (patch does not supply criteria_json)', async () => {
      const e = makeHookEngine();
      bindRuleCriteriaGuard(e as any);
      // The whole point of the update carve-out: switching off an over-broad
      // rule must not require first inventing a criteria for it.
      await expect(e.fire('beforeUpdate', { active: false }, 'srule_legacy')).resolves.toBeUndefined();
    });

    it('still rejects an update that BLANKS the criteria of a live rule', async () => {
      const e = makeHookEngine();
      bindRuleCriteriaGuard(e as any);
      await expect(e.fire('beforeUpdate', { criteria_json: '' }, 'srule_1')).rejects.toThrow(/criteria is required/);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────
// [ADR-0111 D6] Sharing-rule administration requires `manage_sharing`.
// The #3902 widened finding: every /sharing/rules verb ran under
// SYSTEM_CTX with no caller check, so any signed-in user could define a
// broad-criteria rule naming themself and evaluate it into org-wide
// grants. The gate lives in the SERVICE so every caller is covered.
// ─────────────────────────────────────────────────────────────────────

describe('[ADR-0111 D6] sharing-rule management gate', () => {
  let engine: ReturnType<typeof makeEngine>;
  let rules: SharingRuleService;
  const MALLORY = { userId: 'mallory', systemPermissions: [] } as any;
  /**
   * [#7795] `organizationId` added — this persona is a TENANT sharing admin,
   * and the REST layer never builds one without an org. Omitting it made
   * `defineRule` stamp `organization_id: null`, so the rule this block created
   * to exercise the CAPABILITY gate was incidentally a PLATFORM-GLOBAL row —
   * a shape no org admin can author through the API at all. That was invisible
   * while every verb shared one gate; it stops being invisible now that delete
   * judges the row's class too (see the #7795 block at the end of this file).
   * The subject here is unchanged: `manage_sharing` authorizes the full
   * surface for the caller's OWN organization.
   */
  const RULE_ADMIN = { userId: 'admin', organizationId: 'org1', systemPermissions: ['manage_sharing'] } as any;
  const LEGACY_ADMIN = { userId: 'admin', systemPermissions: ['manage_platform_settings'] } as any;

  const input = {
    name: 'self_grant',
    label: 'Self grant',
    object: 'opportunity',
    criteria: { amount: { $gt: 0 } },
    recipientType: 'user' as const,
    recipientId: 'mallory',
    accessLevel: 'edit' as const,
  };

  beforeEach(() => {
    engine = makeEngine();
    engine._tables.opportunity = [{ id: 'opp1', amount: 100, owner_id: 'someone' }];
    rules = new SharingRuleService({ engine: engine as any, sharing: new SharingService({ engine: engine as any }) });
  });

  it('an ordinary user can neither define, list, get, delete, nor evaluate rules', async () => {
    await expect(rules.defineRule(input, MALLORY)).rejects.toThrow(/PERMISSION_DENIED/);
    await expect(rules.listRules({}, MALLORY)).rejects.toThrow(/PERMISSION_DENIED/);
    await expect(rules.getRule('anything', MALLORY)).rejects.toThrow(/PERMISSION_DENIED/);
    await expect(rules.deleteRule('anything', MALLORY)).rejects.toThrow(/PERMISSION_DENIED/);
    await expect(rules.evaluateRule('anything', MALLORY)).rejects.toThrow(/PERMISSION_DENIED/);
    expect(engine._tables.sys_sharing_rule ?? []).toHaveLength(0);
  });

  it('manage_sharing authorizes the full surface', async () => {
    const r = await rules.defineRule(input, RULE_ADMIN);
    expect(r.id).toBeTruthy();
    expect((await rules.listRules({}, RULE_ADMIN)).length).toBe(1);
    await rules.deleteRule(r.id, RULE_ADMIN);
    expect((await rules.listRules({}, RULE_ADMIN)).length).toBe(0);
  });

  it('the legacy manage_platform_settings gate is honoured', async () => {
    const r = await rules.defineRule(input, LEGACY_ADMIN);
    expect(r.id).toBeTruthy();
  });

  it('system contexts (boot seeding, hooks, backfills) bypass the gate', async () => {
    const r = await rules.defineRule(input, { isSystem: true } as any);
    expect(r.id).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────
// [#7676] Package-seeded rules (`organization_id = null`) are visible and
// addressable BY NAME to an org-scoped admin.
//
// The QA run's finding: on a stock boot `GET /api/v1/sharing/rules` answered
// `{data: []}` over four active seeded rules, by-name GET/evaluate 404'd
// `RULE_NOT_FOUND`, and only the org-unfiltered by-id branch still worked —
// because the seeder defines under SYSTEM_CTX (`organization_id: null`) while
// an authenticated admin's context carries `organizationId: 'org_…'`, and a
// strict equality can never match. Enforcement was unaffected (boot reconcile
// reads under SYSTEM_CTX, no org filter), which is exactly why it stayed
// invisible: rules that grant access but cannot be listed or deactivated.
// ─────────────────────────────────────────────────────────────────────

describe('[#7676] admin visibility of package-seeded (org-null) sharing rules', () => {
  let engine: ReturnType<typeof makeEngine>;
  let rules: SharingRuleService;

  /** An authenticated org-scoped sharing admin — the shape the REST layer builds. */
  const ORG1_ADMIN = { userId: 'admin', organizationId: 'org1', systemPermissions: ['manage_sharing'] } as any;
  const SEEDED = 'share_red_projects_with_execs';
  /**
   * The seeder's own context — `bootstrapDeclaredSharingRules` defines under
   * plugin-sharing's `SYSTEM_CTX`, which carries NO organization, and that is
   * precisely what stamps `organization_id: null` on the row. Not this file's
   * older `SYS`, which is `{isSystem: true, organizationId: 'org1'}` — system
   * only bypasses the ADR-0111 D6 capability gate, never the org scope.
   */
  const BOOT = { isSystem: true, positions: [], permissions: [] } as any;

  beforeEach(async () => {
    engine = makeEngine();
    engine._tables.project = [
      { id: 'p_red', status: 'red', owner_id: 'someone' },
      { id: 'p_green', status: 'green', owner_id: 'someone' },
    ];
    rules = new SharingRuleService({ engine: engine as any, sharing: new SharingService({ engine: engine as any }) });

    // Package seed — defined under SYSTEM_CTX exactly as
    // `bootstrapDeclaredSharingRules` does, so `organization_id` lands null.
    await rules.defineRule({
      name: SEEDED, label: 'Red projects → execs', object: 'project',
      criteria: { status: 'red' }, recipientType: 'user', recipientId: 'exec',
      managedBy: 'package',
    } as any, BOOT);
    // A rule belonging to a DIFFERENT organization — the isolation pin.
    await rules.defineRule({
      name: 'other_org_rule', label: 'Other org', object: 'project',
      criteria: { status: 'green' }, recipientType: 'user', recipientId: 'mallory',
    } as any, { userId: 'other', organizationId: 'org2', systemPermissions: ['manage_sharing'] } as any);
    // An API-created rule stamped with THIS org — must keep working as today.
    await rules.defineRule({
      name: 'org1_rule', label: 'Org1 own', object: 'project',
      criteria: { status: 'red' }, recipientType: 'user', recipientId: 'alice',
    } as any, ORG1_ADMIN);
  });

  it('the fixture really does store a null organization_id on the seeded row', () => {
    const seeded = engine._tables.sys_sharing_rule.find((r) => r.name === SEEDED);
    expect(seeded?.organization_id).toBeNull();
    expect(seeded?.managed_by).toBe('package');
    // …and the org-stamped rows really are stamped, or the pins below prove nothing.
    expect(engine._tables.sys_sharing_rule.find((r) => r.name === 'org1_rule')?.organization_id).toBe('org1');
    expect(engine._tables.sys_sharing_rule.find((r) => r.name === 'other_org_rule')?.organization_id).toBe('org2');
  });

  // ── visibility (the defect) ──────────────────────────────────────────

  it('listRules shows the seeded rule to an org-scoped admin', async () => {
    const names = (await rules.listRules({}, ORG1_ADMIN)).map((r) => r.name);
    expect(names).toContain(SEEDED);
    // Exact set — "this org ∪ platform-global", and nothing else. Kept HERE
    // rather than on the isolation pins below so that each test has ONE
    // predicted direction under the ablation: this one flips red, they do not.
    expect(names.sort()).toEqual([SEEDED, 'org1_rule'].sort());
  });

  it('getRule resolves the seeded rule BY NAME for an org-scoped admin', async () => {
    const row = await rules.getRule(SEEDED, ORG1_ADMIN);
    expect(row?.name).toBe(SEEDED);
    expect(row?.organization_id).toBeNull();
  });

  it('evaluateRule works BY NAME for the seeded rule (no RULE_NOT_FOUND)', async () => {
    const res = await rules.evaluateRule(SEEDED, ORG1_ADMIN);
    expect(res.matchedRecords).toBe(1);
    expect(res.grantsCreated).toBe(1);
    // The control the QA run used: by-id already worked, and must still agree.
    const byId = await rules.getRule(SEEDED, ORG1_ADMIN);
    expect((await rules.evaluateRule(byId!.id, ORG1_ADMIN)).ruleId).toBe(byId!.id);
  });

  // ── isolation pins (must stay green under the ablation) ──────────────

  it('another organization’s rule stays invisible — list', async () => {
    const names = (await rules.listRules({}, ORG1_ADMIN)).map((r) => r.name);
    expect(names).not.toContain('other_org_rule');
    // Positive half, so this cannot pass by listing nothing at all — and it is
    // the org's OWN row deliberately, which survives the ablation.
    expect(names).toContain('org1_rule');
  });

  it('another organization’s rule stays unresolvable — by name', async () => {
    expect(await rules.getRule('other_org_rule', ORG1_ADMIN)).toBeNull();
    await expect(rules.evaluateRule('other_org_rule', ORG1_ADMIN)).rejects.toThrow(/RULE_NOT_FOUND/);
  });

  it('the org scope is CONJOINED with the object/activeOnly filters, not substituted for them', async () => {
    await rules.defineRule({
      name: 'seeded_other_object', label: 'Other object', object: 'account',
      criteria: { tier: 'gold' }, recipientType: 'user', recipientId: 'exec',
      managedBy: 'package',
    } as any, BOOT);
    await rules.defineRule({
      name: 'seeded_inactive', label: 'Inactive seed', object: 'project',
      criteria: { status: 'red' }, recipientType: 'user', recipientId: 'exec',
      managedBy: 'package', active: false,
    } as any, BOOT);

    // Both halves assert on the org's OWN row for the positive side, so this
    // test stays GREEN under the ablation and goes red only for its own cause:
    // an org scope that SUBSTITUTED for the object/activeOnly predicates
    // instead of being conjoined with them (the exact way a top-level `$or`
    // fails when a filter evaluator short-circuits on the combinator).
    const projects = (await rules.listRules({ object: 'project' }, ORG1_ADMIN)).map((r) => r.name);
    expect(projects).not.toContain('seeded_other_object');
    expect(projects).toContain('org1_rule');
    const active = (await rules.listRules({ object: 'project', activeOnly: true }, ORG1_ADMIN)).map((r) => r.name);
    expect(active).not.toContain('seeded_inactive');
    expect(active).toContain('org1_rule');
  });

  // ── unchanged behaviour ──────────────────────────────────────────────

  it('an API-created org-stamped rule is still listed and gettable by name', async () => {
    expect((await rules.getRule('org1_rule', ORG1_ADMIN))?.organization_id).toBe('org1');
    expect((await rules.listRules({}, ORG1_ADMIN)).map((r) => r.name)).toContain('org1_rule');
  });

  it('a no-org (SYSTEM_CTX / boot) context still sees every rule, unfiltered', async () => {
    const names = (await rules.listRules({}, BOOT)).map((r) => r.name).sort();
    expect(names).toEqual([SEEDED, 'org1_rule', 'other_org_rule'].sort());
    expect((await rules.getRule('other_org_rule', BOOT))?.organization_id).toBe('org2');
  });

  it('when both a platform-global and an own-org row share a name, by-name resolves the OWN row', async () => {
    // `defineRule` is deliberately NOT widened, so a same-named POST from an
    // org admin creates its own row instead of overwriting the shared seed.
    const own = await rules.defineRule({
      name: SEEDED, label: 'Org1 override', object: 'project',
      criteria: { status: 'red' }, recipientType: 'user', recipientId: 'alice',
    } as any, ORG1_ADMIN);
    expect(engine._tables.sys_sharing_rule.filter((r) => r.name === SEEDED)).toHaveLength(2);
    expect(engine._tables.sys_sharing_rule.find((r) => r.organization_id === null)?.label)
      .toBe('Red projects → execs'); // the seed row is untouched
    const resolved = await rules.getRule(SEEDED, ORG1_ADMIN);
    expect(resolved?.id).toBe(own.id);
    expect(resolved?.organization_id).toBe('org1');
  });
});

// ─────────────────────────────────────────────────────────────────────
// [#7761] `getRule`'s BY-ID branch is scoped to the caller's organization.
//
// The by-name path has been scoped since #7676; the by-id branch was a bare
// `{id: idOrName}` resolved under SYSTEM_CTX, so nothing re-scoped it
// downstream. An org-scoped sharing admin holding another organization's
// opaque `srule_…` id could read that org's rule, `evaluate` it, and — because
// `deleteRule` resolves through `getRule` — DELETE it along with every
// `sys_record_share` grant it had materialised: silently revoking another
// tenant's record access. `manage_sharing` is an org-level capability
// (`scope: 'org'`) and an id is not a tenant boundary — ids leak through logs,
// exports, support tickets and the evaluate response's `{ruleId}`.
//
// The delete assertions pin the ROW **and its grants**, because grant purging
// is the actual harm: a fix that kept the row but still purged the grants
// would satisfy a row-only assertion while leaving the damage intact.
//
// Ablation (predicted in advance): restore `where: {id: idOrName}` and the
// three "unreachable by id" tests flip red, while the platform-global,
// own-org and BOOT pins below stay green.
// ─────────────────────────────────────────────────────────────────────

describe('[#7761] getRule by-id is scoped to the caller organization', () => {
  let engine: ReturnType<typeof makeEngine>;
  let rules: SharingRuleService;

  /** Authenticated org-scoped sharing admins — the shape the REST layer builds. */
  const ORG1_ADMIN = { userId: 'admin', organizationId: 'org1', systemPermissions: ['manage_sharing'] } as any;
  const ORG2_ADMIN = { userId: 'other', organizationId: 'org2', systemPermissions: ['manage_sharing'] } as any;
  /**
   * The seeder's / boot context — carries NO organization, which is what
   * stamps `organization_id: null`. Deliberately not this file's older `SYS`
   * (`{isSystem: true, organizationId: 'org1'}`): `isSystem` bypasses the
   * ADR-0111 D6 capability gate, never the org scope, so `SYS` would silently
   * defeat every fixture below.
   */
  const BOOT = { isSystem: true, positions: [], permissions: [] } as any;

  const SEEDED = 'share_red_projects_with_execs';
  let seededId = '';
  let otherOrgRuleId = '';
  let org1RuleId = '';

  /** The `sys_record_share` rows a given rule materialised. */
  const grantsOf = (ruleId: string): Row[] =>
    (engine._tables.sys_record_share ?? []).filter((g) => g.source === 'rule' && g.source_id === ruleId);

  beforeEach(async () => {
    engine = makeEngine();
    engine._tables.project = [
      { id: 'p_red', status: 'red', owner_id: 'someone' },
      { id: 'p_green', status: 'green', owner_id: 'someone' },
    ];
    rules = new SharingRuleService({ engine: engine as any, sharing: new SharingService({ engine: engine as any }) });

    // Platform-global package seed — defined with no org, as the boot seeder does.
    seededId = (await rules.defineRule({
      name: SEEDED, label: 'Red projects → execs', object: 'project',
      criteria: { status: 'red' }, recipientType: 'user', recipientId: 'exec',
      managedBy: 'package',
    } as any, BOOT)).id;
    // The victim: a rule owned by a DIFFERENT organization.
    otherOrgRuleId = (await rules.defineRule({
      name: 'other_org_rule', label: 'Other org', object: 'project',
      criteria: { status: 'green' }, recipientType: 'user', recipientId: 'mallory',
    } as any, ORG2_ADMIN)).id;
    // The caller's own rule — the positive half.
    org1RuleId = (await rules.defineRule({
      name: 'org1_rule', label: 'Org1 own', object: 'project',
      criteria: { status: 'red' }, recipientType: 'user', recipientId: 'alice',
    } as any, ORG1_ADMIN)).id;

    // Materialise org2's grants under BOOT, so the fixture does not depend on
    // the very scoping decision these tests are measuring.
    await rules.evaluateRule(otherOrgRuleId, BOOT);
  });

  it('the fixture really does have three distinct rows and live grants on the victim', () => {
    const rows = engine._tables.sys_sharing_rule;
    expect(rows.find((r) => r.id === seededId)?.organization_id).toBeNull();
    expect(rows.find((r) => r.id === otherOrgRuleId)?.organization_id).toBe('org2');
    expect(rows.find((r) => r.id === org1RuleId)?.organization_id).toBe('org1');
    expect(new Set([seededId, otherOrgRuleId, org1RuleId]).size).toBe(3);
    // Without this, the delete pin below could "pass" over a rule that never
    // had any grants to lose.
    expect(grantsOf(otherOrgRuleId)).toHaveLength(1);
  });

  // ── the defect: another organization's row, addressed by id ──────────

  it('another organization’s rule is unreachable BY ID — read', async () => {
    expect(await rules.getRule(otherOrgRuleId, ORG1_ADMIN)).toBeNull();
  });

  it('another organization’s rule is unreachable BY ID — evaluate', async () => {
    await expect(rules.evaluateRule(otherOrgRuleId, ORG1_ADMIN)).rejects.toThrow(/RULE_NOT_FOUND/);
    // Evaluate is a WRITE (it reconciles grants), so the refusal has to leave
    // the victim's grants exactly as they were, not merely return an error.
    expect(grantsOf(otherOrgRuleId)).toHaveLength(1);
  });

  it('another organization’s rule is unreachable BY ID — delete leaves the row AND its grants intact', async () => {
    await rules.deleteRule(otherOrgRuleId, ORG1_ADMIN);
    expect(engine._tables.sys_sharing_rule.find((r) => r.id === otherOrgRuleId)).toBeTruthy();
    // The harm in this defect is grant purging — `deleteRule` revokes every
    // `sys_record_share` row the rule materialised — so the grants are the
    // assertion that matters, not just the surviving rule row.
    expect(grantsOf(otherOrgRuleId)).toHaveLength(1);
  });

  // ── platform-global stays reachable (what #7760 enabled by name) ─────

  it('a platform-global (organization_id = null) rule stays reachable BY ID — read', async () => {
    const row = await rules.getRule(seededId, ORG1_ADMIN);
    expect(row?.name).toBe(SEEDED);
    expect(row?.organization_id).toBeNull();
  });

  it('a platform-global rule stays reachable BY ID — evaluate', async () => {
    const res = await rules.evaluateRule(seededId, ORG1_ADMIN);
    expect(res.ruleId).toBe(seededId);
    expect(res.matchedRecords).toBe(1);
    expect(res.grantsCreated).toBe(1);
  });

  // ── unchanged behaviour ──────────────────────────────────────────────

  it('the caller’s OWN org rule is still fully addressable by id', async () => {
    expect((await rules.getRule(org1RuleId, ORG1_ADMIN))?.organization_id).toBe('org1');
    expect((await rules.evaluateRule(org1RuleId, ORG1_ADMIN)).ruleId).toBe(org1RuleId);
    // Delete works on the caller's own row — the control proving the refusal
    // above comes from the org scope and not from a delete path that stopped
    // working for everyone.
    await rules.deleteRule(org1RuleId, ORG1_ADMIN);
    expect(engine._tables.sys_sharing_rule.find((r) => r.id === org1RuleId)).toBeUndefined();
  });

  it('a no-org (SYSTEM_CTX / boot) context still resolves ANY row by id', async () => {
    expect((await rules.getRule(otherOrgRuleId, BOOT))?.organization_id).toBe('org2');
    expect((await rules.getRule(seededId, BOOT))?.organization_id).toBeNull();
    expect((await rules.getRule(org1RuleId, BOOT))?.organization_id).toBe('org1');
  });
});

// ─────────────────────────────────────────────────────────────────────
// [#7795] DELETING a platform-global (`organization_id = null`) rule requires
// PLATFORM authority. Maintainer ruling 2026-08-12, 方向 B — quoted verbatim
// and untranslated in `sharing-rule-service.ts`'s
// `assertCanDeletePlatformGlobalRule` docblock, which is the authority on the
// decision; this file measures it.
//
// The split, in one line: read/list/evaluate stay OPEN (that is what #7760
// deliberately unlocked), delete alone closes to org-scoped callers.
//
// ## The persona is the whole test
//
// Every refusal below is driven as an ORG-LEVEL admin **holding
// `manage_sharing`** — the exact caller the ruling refuses, and the only one
// that can fail against the pre-fix build. Written as an unprivileged user it
// would pass before AND after the fix (the ADR-0111 D6 gate refuses that
// caller several lines earlier) and would prove nothing at all. The
// `ORG1_ADMIN` fixture therefore carries `manage_sharing` on purpose, and
// `the ADR-0111 D6 gate still fires FIRST` below pins that the two refusals
// stay distinguishable.
//
// ## Why `code` and `status` are asserted separately
//
// The harm this closes and the harm a 404 would cause are different bugs, so a
// loose `.toThrow()` — or even `/PERMISSION_DENIED/` as a substring — cannot
// tell them apart. `refusalCodeOf` parses the ADR-0112 code TOKEN (the prefix
// `rest-server.ts`'s sharing-rule `handleError` dispatches on to pick the HTTP
// status) and the assertions pair it against the spec's own
// `HttpStatusErrorCodeMap`: it must be the code the platform pairs with **403**
// and must not be either 404-shaped code. A regression that answered 404 fails
// as a NAMED, different assertion rather than sliding through.
//
// And the 404 is not merely a worse status, it is a false statement — which is
// why `the 404 a stricter reading would have chosen would be a LIE` asserts
// that the very same refused caller can still READ the row it may not delete.
//
// ## Ablation (predicted in advance, then measured)
//
// Remove the `assertCanDeletePlatformGlobalRule` call from `deleteRule` and:
// the four refusal tests flip RED; every permitted-side and #7760 read-surface
// pin below stays GREEN. Plain red, not "more diagnostics" and not inverted —
// the guard is a new refusal on a path that previously succeeded, and the pins
// sit on the refusal itself.
// ─────────────────────────────────────────────────────────────────────

describe('[#7795] deleting a platform-global rule requires platform authority', () => {
  let engine: ReturnType<typeof makeEngine>;
  let rules: SharingRuleService;

  /**
   * THE REFUSED PERSONA: an org-scoped sharing admin. Holds `manage_sharing`
   * (so it clears the ADR-0111 D6 gate and reaches the new one) and carries an
   * `organizationId` (so it is org-scoped, not platform). This is the shape the
   * REST layer builds for a tenant admin.
   */
  const ORG1_ADMIN = { userId: 'admin', organizationId: 'org1', systemPermissions: ['manage_sharing'] } as any;
  /** Platform authority, spelling 1: the `scope: 'platform'` CAPABILITY. */
  const PLATFORM_SETTINGS_ADMIN = {
    userId: 'ops', organizationId: 'org1',
    systemPermissions: ['manage_sharing', 'manage_platform_settings'],
  } as any;
  /** Platform authority, spelling 2: the built-in POSITION (ADR-0068 D2). */
  const PLATFORM_ADMIN_POSITION = {
    userId: 'root', organizationId: 'org1',
    systemPermissions: ['manage_sharing'], positions: ['platform_admin'],
  } as any;
  /** No `manage_sharing` at all — must still be refused by the OLDER gate. */
  const MALLORY = { userId: 'mallory', organizationId: 'org1', systemPermissions: [] } as any;
  /** The seeder's / boot context — carries no org, which is what stamps `organization_id: null`. */
  const BOOT = { isSystem: true, positions: [], permissions: [] } as any;

  const SEEDED = 'share_red_projects_with_execs';
  let seededId = '';
  let org1RuleId = '';

  const grantsOf = (ruleId: string): Row[] =>
    (engine._tables.sys_record_share ?? []).filter((g) => g.source === 'rule' && g.source_id === ruleId);

  /**
   * The ADR-0112 code TOKEN carried by a refused call, or a failure if the call
   * was not refused at all. Deliberately the leading token rather than a
   * substring match: `PERMISSION_DENIED` and `RULE_NOT_FOUND` must be
   * distinguishable, because they are the two different bugs this card sits
   * between.
   */
  const refusalCodeOf = async (call: Promise<unknown>): Promise<string> => {
    try {
      await call;
    } catch (err: any) {
      return String(err?.message ?? err ?? '').split(':')[0].trim();
    }
    throw new Error('expected the call to be REFUSED, but it resolved successfully');
  };

  beforeEach(async () => {
    engine = makeEngine();
    engine._tables.project = [
      { id: 'p_red', status: 'red', owner_id: 'someone' },
      { id: 'p_green', status: 'green', owner_id: 'someone' },
    ];
    rules = new SharingRuleService({ engine: engine as any, sharing: new SharingService({ engine: engine as any }) });

    // The platform-global package seed — defined with no org, exactly as
    // `bootstrapDeclaredSharingRules` does on every boot.
    seededId = (await rules.defineRule({
      name: SEEDED, label: 'Red projects → execs', object: 'project',
      criteria: { status: 'red' }, recipientType: 'user', recipientId: 'exec',
      managedBy: 'package',
    } as any, BOOT)).id;
    // The caller's OWN org rule — the control that proves a refusal below comes
    // from the row's platform-global class and not from delete breaking wholesale.
    org1RuleId = (await rules.defineRule({
      name: 'org1_rule', label: 'Org1 own', object: 'project',
      criteria: { status: 'red' }, recipientType: 'user', recipientId: 'alice',
    } as any, ORG1_ADMIN)).id;

    // Materialise both rules' grants under BOOT, so the fixture never depends
    // on the very gate these tests measure.
    await rules.evaluateRule(seededId, BOOT);
    await rules.evaluateRule(org1RuleId, BOOT);
  });

  it('the fixture really is platform-global, org-stamped, and carrying live grants', () => {
    const rows = engine._tables.sys_sharing_rule;
    expect(rows.find((r) => r.id === seededId)?.organization_id).toBeNull();
    expect(rows.find((r) => r.id === seededId)?.managed_by).toBe('package');
    expect(rows.find((r) => r.id === org1RuleId)?.organization_id).toBe('org1');
    // Without live grants the "grants survive" assertions below could pass over
    // a rule that never had any to lose.
    expect(grantsOf(seededId)).toHaveLength(1);
    expect(grantsOf(org1RuleId)).toHaveLength(1);
    // And the refused persona really does clear the OLDER gate, or the refusal
    // under test would be indistinguishable from ADR-0111 D6's.
    expect(ORG1_ADMIN.systemPermissions).toContain('manage_sharing');
  });

  // ── the refusal ──────────────────────────────────────────────────────

  it('an org admin holding manage_sharing is refused — 403 PERMISSION_DENIED, by id', async () => {
    const code = await refusalCodeOf(rules.deleteRule(seededId, ORG1_ADMIN));
    // `code`: the exact ADR-0112 token, not a substring.
    expect(code).toBe('PERMISSION_DENIED');
    // `status`: sourced from the platform's own code↔status pairing rather than
    // restated, so this cannot agree with itself.
    expect(HttpStatusErrorCodeMap[403]).toBe(code);
    // …and distinctly NOT 404-shaped, in either of that status's spellings —
    // the standard catalog's, and this route's own `RULE_NOT_FOUND`.
    expect(code).not.toBe(HttpStatusErrorCodeMap[404]);
    expect(code).not.toBe('RULE_NOT_FOUND');
  });

  it('an org admin holding manage_sharing is refused — by NAME as well as by id', async () => {
    const code = await refusalCodeOf(rules.deleteRule(SEEDED, ORG1_ADMIN));
    expect(code).toBe('PERMISSION_DENIED');
    expect(HttpStatusErrorCodeMap[403]).toBe(code);
    expect(code).not.toBe('RULE_NOT_FOUND');
  });

  it('the refusal leaves the rule row AND every tenant’s grants intact', async () => {
    await expect(rules.deleteRule(seededId, ORG1_ADMIN)).rejects.toThrow();
    expect(engine._tables.sys_sharing_rule.find((r) => r.id === seededId)).toBeTruthy();
    // The grants are the assertion that matters: the harm in this defect is the
    // cross-tenant grant purge, so a "fix" that threw but still purged — or
    // that purged before throwing — would satisfy a row-only check while
    // leaving the damage done.
    expect(grantsOf(seededId)).toHaveLength(1);
  });

  it('the 404 a stricter reading would have chosen would be a LIE — the caller can still READ the row', async () => {
    // This is the ruling's stated reason for 403 over 404, made executable:
    // the row is DELIBERATELY visible (#7760), so answering "no such rule" to
    // the very caller that can list and read it one call earlier would be the
    // platform contradicting itself.
    const readable = await rules.getRule(seededId, ORG1_ADMIN);
    expect(readable?.id).toBe(seededId);
    expect(readable?.organization_id).toBeNull();
    expect(await refusalCodeOf(rules.deleteRule(seededId, ORG1_ADMIN))).toBe('PERMISSION_DENIED');
  });

  it('the ADR-0111 D6 gate still fires FIRST for a caller without manage_sharing', async () => {
    // Ordering pin: the new guard resolves the row before judging it, so it
    // must not have displaced the capability gate that runs before any read.
    // Both refusals are PERMISSION_DENIED; the messages keep them apart.
    await expect(rules.deleteRule(seededId, MALLORY)).rejects.toThrow(/manage_sharing capability/);
    expect(engine._tables.sys_sharing_rule.find((r) => r.id === seededId)).toBeTruthy();
  });

  // ── the permitted side ───────────────────────────────────────────────

  it('the manage_platform_settings capability authorizes the delete', async () => {
    await expect(rules.deleteRule(seededId, PLATFORM_SETTINGS_ADMIN)).resolves.toBeUndefined();
    expect(engine._tables.sys_sharing_rule.find((r) => r.id === seededId)).toBeUndefined();
    expect(grantsOf(seededId)).toHaveLength(0);
  });

  it('the platform_admin position authorizes the delete', async () => {
    await expect(rules.deleteRule(seededId, PLATFORM_ADMIN_POSITION)).resolves.toBeUndefined();
    expect(engine._tables.sys_sharing_rule.find((r) => r.id === seededId)).toBeUndefined();
    expect(grantsOf(seededId)).toHaveLength(0);
  });

  it('a system context (boot seeding, hooks, backfills) still deletes', async () => {
    await expect(rules.deleteRule(seededId, BOOT)).resolves.toBeUndefined();
    expect(engine._tables.sys_sharing_rule.find((r) => r.id === seededId)).toBeUndefined();
  });

  it('the org admin can still delete its OWN organization’s rule', async () => {
    // The control: delete did not simply stop working for org admins.
    await expect(rules.deleteRule(org1RuleId, ORG1_ADMIN)).resolves.toBeUndefined();
    expect(engine._tables.sys_sharing_rule.find((r) => r.id === org1RuleId)).toBeUndefined();
    expect(grantsOf(org1RuleId)).toHaveLength(0);
  });

  // ── #7760's read/evaluate surface is a REGRESSION surface, not collateral ──

  it('#7760 stays whole: the org admin can still LIST the platform-global rule', async () => {
    const names = (await rules.listRules({}, ORG1_ADMIN)).map((r) => r.name);
    expect(names).toContain(SEEDED);
    expect(names).toContain('org1_rule');
  });

  it('#7760 stays whole: the org admin can still GET it, by id and by name', async () => {
    expect((await rules.getRule(seededId, ORG1_ADMIN))?.name).toBe(SEEDED);
    expect((await rules.getRule(SEEDED, ORG1_ADMIN))?.id).toBe(seededId);
  });

  it('#7760 stays whole: the org admin can still EVALUATE it — grants reconcile', async () => {
    const res = await rules.evaluateRule(seededId, ORG1_ADMIN);
    expect(res.ruleId).toBe(seededId);
    expect(res.matchedRecords).toBe(1);
    // Evaluate is a WRITE. It must still reach the grant table, not merely
    // return a shape — a gate applied to the whole null-org class instead of
    // to `delete` alone would show up right here.
    expect(grantsOf(seededId)).toHaveLength(1);
    expect(res.grantsRevoked).toBe(0);
  });
});
