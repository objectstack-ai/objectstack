// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { assertEngineDeleteDispatch } from '@objectstack/objectql';
// [#7795] The platform's own code↔status pairing, so the delete-refusal tests
// assert an HTTP status they SOURCE rather than one they restate.
import { HttpStatusErrorCodeMap } from '@objectstack/spec/api';
import { SharingService } from './sharing-service.js';
import { SharingRuleService, isDeclaredSharingRule, bindDeclaredRuleNameGuard } from './sharing-rule-service.js';
import { TeamGraphService, expandPrincipal } from './team-graph.js';
import { BusinessUnitGraphService } from './business-unit-graph.js';
// [commit 04d03c3a0] The ADDRESSING primitive, imported so the negative half of the
// ruling can be pinned in the same suite as the positive half: the filter
// belongs to the sharing CALL SITE, never to the expansion helper.
import { PositionGraphService } from './position-graph.js';
import { celToFilter, celToFilterOutcome, createDeclaredSharingRuleSource } from './declared-sharing-rules.js';
import { isMatchAllCriteria } from './rule-criteria.js';
import { bindRuleCriteriaGuard } from './rule-hooks.js';
import { resolveDeclaredRuleScopes, SharingServicePlugin } from './sharing-plugin.js';

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
      if (v != null && typeof v === 'object' && '$gt' in (v as any)) {
        if (!(rv > (v as any).$gt)) return false;
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
    // [#14547] The membership rows carry the tenant too. They used to be
    // org-less here and still expanded, because the member read carried no
    // organization predicate at all — the gap #14547 closed. These units are
    // org1's, created by org1's API calls, so their memberships are org1's:
    // the fixture is becoming faithful, not the assertions being relaxed.
    engine._tables.sys_business_unit_member = [
      { id: 'dm1', business_unit_id: 'emea_sales_uk',  user_id: 'alice', organization_id: 'org1' },
      { id: 'dm2', business_unit_id: 'emea_sales',     user_id: 'bob',   organization_id: 'org1' },
      { id: 'dm3', business_unit_id: 'emea_marketing', user_id: 'carol', organization_id: 'org1' },
      { id: 'dm4', business_unit_id: 'emea_legacy',    user_id: 'ghost', organization_id: 'org1' },
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
    // [#14547] Org-stamped for the same reason as the fixture above.
    engine._tables.sys_business_unit_member = [
      { id: 'dm1', business_unit_id: 'emea_sales',    user_id: 'alice', organization_id: 'org1' },
      { id: 'dm2', business_unit_id: 'emea_sales_uk', user_id: 'bob',   organization_id: 'org1' },
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
// #13943 — the declared-rule skip WARN carries the compiler's reason AND detail
//
// `compileCelToFilter` returns `{ ok: false, reason, detail }` on every
// refusal; `celToFilter` used to collapse the whole thing to `null` one line
// before the only WARN that could surface it, so the operator learned THAT
// the condition did not translate but never WHY. `celToFilterOutcome` is the
// sibling that keeps the cause (`compileExpressionOutcome` in
// plugin-security's rls-compiler, #13942, is the same shape one seam over);
// `celToFilter` stays exactly as published (`Record | null`) and delegates.
// The skip DECISION is unchanged either way — an unlowerable condition is
// never seeded as a permissive match-all (ADR-0049).
// ---------------------------------------------------------------------------
describe('#13943 — a declared rule that is not served names the compiler’s reason and detail', () => {
  const SKIP_WARN =
    '[sharing-rule] declared rule not served (missing or untranslatable CEL condition — never served as match-all) [experimental]';

  /** Registry-backed source harness: declared rules in, served rules + log lines out. */
  function sourceHarness(declared: any[]) {
    const engine = { registry: { listItems: (type: string) => (type === 'sharing_rule' ? declared : []) } };
    const warns: Array<{ msg: string; meta: any }> = [];
    const logger = {
      warn: (msg: string, meta?: any) => { warns.push({ msg, meta }); },
      info: () => {},
    };
    return { source: createDeclaredSharingRuleSource({ engine, logger }), warns };
  }

  const RULE_BASE = {
    object: 'opportunity',
    sharedWith: { type: 'user', value: 'alice' },
    accessLevel: 'read',
  };

  it('celToFilterOutcome carries the compiler’s { reason, detail } instead of collapsing to null', () => {
    // Refusal: a function call is not pushdown-able — the cause survives.
    const refused = celToFilterOutcome('size(record.tags) > 0');
    expect(refused.filter).toBeNull();
    expect(refused.cause?.reason).toBe('unsupported');
    expect(refused.cause?.detail).toEqual(expect.any(String));
    expect(refused.cause?.detail.length).toBeGreaterThan(0);
    // Missing / empty condition: the compiler's own empty-expression refusal.
    const missing = celToFilterOutcome(undefined);
    expect(missing).toEqual({ filter: null, cause: { reason: 'parse-error', detail: 'empty expression' } });
    // Success: same filter celToFilter returns, and no cause at all.
    const ok = celToFilterOutcome('record.amount >= 100000');
    expect(ok.filter).toEqual({ amount: { $gte: 100000 } });
    expect(ok.cause).toBeUndefined();
    // The published wrapper delegates: byte-identical answers on both paths.
    expect(celToFilter('size(record.tags) > 0')).toBeNull();
    expect(celToFilter('record.amount >= 100000')).toEqual(ok.filter);
  });

  it('an untranslatable condition is not served, WITH the why: reason + detail land in the WARN meta', async () => {
    const { source, warns } = sourceHarness([
      { ...RULE_BASE, name: 'r_unsupported', condition: 'size(record.tags) > 0' },
    ]);
    expect(await source.list()).toEqual([]);
    const skips = warns.filter((w) => w.msg === SKIP_WARN);
    expect(skips).toHaveLength(1);
    // The fact (rule, condition) is still there; the why (reason, detail) now is too.
    expect(skips[0].meta).toMatchObject({
      rule: 'r_unsupported',
      condition: 'size(record.tags) > 0',
      reason: 'unsupported',
    });
    expect(skips[0].meta.detail).toEqual(expect.any(String));
    expect(skips[0].meta.detail.length).toBeGreaterThan(0);
  });

  it('the WARN is once per rule per process, not once per read of the rule set', async () => {
    const { source, warns } = sourceHarness([
      { ...RULE_BASE, name: 'r_unsupported', condition: 'size(record.tags) > 0' },
    ]);
    await source.list();
    await source.list();
    await source.list();
    expect(warns.filter((w) => w.msg === SKIP_WARN)).toHaveLength(1);
  });

  it('NEGATIVE: a rule whose condition lowers cleanly emits no skip line and is served in the runtime shape', async () => {
    const { source, warns } = sourceHarness([
      { ...RULE_BASE, name: 'r_clean', condition: 'record.amount >= 100000' },
    ]);
    const served = await source.list();
    // No log line of any kind on the clean path — not just "no skip WARN".
    expect(warns).toHaveLength(0);
    expect(served).toEqual([{
      name: 'r_clean', label: 'r_clean', description: null, object: 'opportunity',
      criteria: { amount: { $gte: 100000 } }, recipientType: 'user', recipientId: 'alice',
      accessLevel: 'read', active: true,
    }]);
  });

  it('NEGATIVE: a MISSING condition is refused through the same WARN, never served', async () => {
    const { source, warns } = sourceHarness([
      { ...RULE_BASE, name: 'r_missing' /* no condition at all */ },
    ]);
    expect(await source.list()).toEqual([]);
    const skips = warns.filter((w) => w.msg === SKIP_WARN);
    expect(skips).toHaveLength(1);
    // The cause names the compiler's own empty-expression refusal rather than being absent.
    expect(skips[0].meta).toMatchObject({
      rule: 'r_missing',
      reason: 'parse-error',
      detail: 'empty expression',
    });
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
  /**
   * Platform authority, spelling 2: the ADR-0095 posture RUNG.
   *
   * [#15981] This fixture used to spell the second channel as the built-in
   * POSITION NAME alone, on the reading that the name is only ever projected
   * from the unscoped `admin_full_access` grant. `positions[]` is now the
   * security axis and also carries ADR-0057 D4 `sys_user_position` names, so
   * the name no longer implies the grant — the rung does. A genuine operator's
   * resolved context carries BOTH (the projection is still emitted), which is
   * why this keeps `positions` as well: dropping it would make the fixture
   * unrepresentative in the opposite direction.
   */
  const PLATFORM_ADMIN_RUNG = {
    userId: 'root', organizationId: 'org1',
    systemPermissions: ['manage_sharing'], positions: ['platform_admin'],
    posture: 'PLATFORM_ADMIN',
  } as any;
  /**
   * [#15981] The ESCALATION shape: the same name with no rung behind it — what
   * a tenant can mint through the `apiEnabled` `sys_user_position` surface.
   * Refused. Driven end-to-end through the real resolver in
   * `sharing-rule-positions-name-authority.test.ts`; this arm keeps the
   * boundary visible in the suite that owns the gate.
   */
  const PLATFORM_ADMIN_NAME_ONLY = {
    userId: 'impostor', organizationId: 'org1',
    systemPermissions: ['manage_sharing'], positions: ['platform_admin'],
    posture: 'MEMBER',
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

  it('the PLATFORM_ADMIN posture rung authorizes the delete', async () => {
    await expect(rules.deleteRule(seededId, PLATFORM_ADMIN_RUNG)).resolves.toBeUndefined();
    expect(engine._tables.sys_sharing_rule.find((r) => r.id === seededId)).toBeUndefined();
    expect(grantsOf(seededId)).toHaveLength(0);
  });

  it('[#15981] the built-in position NAME without the rung does NOT', async () => {
    expect(await refusalCodeOf(rules.deleteRule(seededId, PLATFORM_ADMIN_NAME_ONLY)))
      .toBe('PERMISSION_DENIED');
    // The row survives: a refusal that still destroyed the rule would be none.
    expect(engine._tables.sys_sharing_rule.find((r) => r.id === seededId)).toBeTruthy();
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

// ─────────────────────────────────────────────────────────────────────
// [#8158] An authenticated `manage_sharing` holder whose session resolves NO
// organization is REFUSED — it used to get the system read scope.
//
// `adminOrgScope`, `getRule` and `findRuleRowByName` each opened with the same
// `if (!orgId)` shape, answering unfiltered. That branch exists for
// `SYSTEM_CTX` (boot seeding, hooks, backfills) but was reached on the ABSENCE
// OF AN ORG ID rather than on system-ness, while the ADR-0111 D6 gate admits
// any caller holding the org-scoped `manage_sharing` capability. So an
// authenticated, non-system caller with neither `organizationId` nor
// `tenantId` read EVERY tenant's rules, resolved any of them by id or name,
// and — through `evaluateRule`, which reconciles `sys_record_share` — wrote
// across tenants.
//
// ## Anti-vacuity
//
// The fixture seeds TWO organizations, each with its own rule, plus the
// platform-global seed. A single-tenant fixture would pass on the BROKEN build
// (nothing else to leak), so every refusal below is paired with a positive
// half naming the OTHER tenant's row, and the two org-bound personas assert
// their EXACT visible set.
//
// ## Ablation (predicted in advance, before running it)
//
// Restore `if (!orgId) return where` / `if (!orgId) return first({name})` and
// drop the scope assertion, and:
//   - every `ORG_LESS_*` refusal test flips red — the calls resolve instead of
//     throwing (and the leak assertions show org2's row in the answer);
//   - the SYSTEM and PLATFORM tests stay GREEN — they take the unfiltered
//     branch either way, which is what makes them the boot-seeding /
//     platform-operator regression guard rather than restatements of the fix;
//   - the ORG-BOUND exact-set tests stay GREEN — they were never routed
//     through the fall-open branch.
// ─────────────────────────────────────────────────────────────────────

describe('[#8158] a non-system caller with NO organization does not get the system read scope', () => {
  let engine: ReturnType<typeof makeEngine>;
  let rules: SharingRuleService;

  /**
   * THE EXPOSED PERSONA: authenticated, holds the org-scoped `manage_sharing`
   * capability (so it clears the ADR-0111 D6 gate and reaches the scope
   * decision), and carries NEITHER `organizationId` NOR `tenantId` — the shape
   * `resolveAuthzContext` produces for a session with no `activeOrganizationId`
   * whose permission-set grant resolved anyway.
   */
  const ORG_LESS_SHARING_ADMIN = { userId: 'mallory', systemPermissions: ['manage_sharing'] } as any;
  /** The same session shape with an explicitly null org — a hand-built context. */
  const ORG_LESS_NULL_ORG = {
    userId: 'mallory', organizationId: null, tenantId: null,
    systemPermissions: ['manage_sharing'], positions: [],
  } as any;
  /** Org-bound, `organizationId` spelling (what the older fixtures build). */
  const ORG1_ADMIN = { userId: 'a1', organizationId: 'org1', systemPermissions: ['manage_sharing'] } as any;
  /**
   * Org-bound, `tenantId` spelling — what `resolveAuthzContext` ACTUALLY
   * stamps over HTTP (`ctx.tenantId = session.activeOrganizationId`). Both
   * spellings must resolve, or the guard would refuse every real REST caller.
   */
  const ORG2_ADMIN = { userId: 'a2', tenantId: 'org2', systemPermissions: ['manage_sharing'] } as any;
  /** Boot seeding / hooks / backfills: no org, but SYSTEM. Unfiltered, as always. */
  const BOOT = { isSystem: true, positions: [], permissions: [] } as any;
  /** Platform authority with no active org, spelling 1: the `scope: 'platform'` capability. */
  const ORG_LESS_PLATFORM_CAP = {
    userId: 'ops', systemPermissions: ['manage_sharing', 'manage_platform_settings'],
  } as any;
  /**
   * Platform authority with no active org, spelling 2: the ADR-0095 rung.
   * [#15981] Was the built-in position NAME alone — see the migration note on
   * `PLATFORM_ADMIN_RUNG` above for why a name is no longer that evidence.
   */
  const ORG_LESS_PLATFORM_RUNG = {
    userId: 'root', systemPermissions: ['manage_sharing'], positions: ['platform_admin'],
    posture: 'PLATFORM_ADMIN',
  } as any;
  /** [#15981] The escalation shape: the minted name, no rung. Refused. */
  const ORG_LESS_NAME_ONLY = {
    userId: 'impostor', systemPermissions: ['manage_sharing'], positions: ['platform_admin'],
    posture: 'MEMBER',
  } as any;
  /** No capability at all — the OLDER gate must still fire first. */
  const ORG_LESS_NOBODY = { userId: 'nobody', systemPermissions: [] } as any;

  const SEEDED = 'share_red_projects_with_execs';
  let seededId = '';
  let org1RuleId = '';
  let org2RuleId = '';

  const grantsOf = (ruleId: string): Row[] =>
    (engine._tables.sys_record_share ?? []).filter((g) => g.source === 'rule' && g.source_id === ruleId);
  const namesOf = (rows: { name: string }[]): string[] => rows.map((r) => r.name).sort();

  /** The leading ADR-0112 token of a refusal — see the #7795 block's copy. */
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

    seededId = (await rules.defineRule({
      name: SEEDED, label: 'Red projects → execs', object: 'project',
      criteria: { status: 'red' }, recipientType: 'user', recipientId: 'exec',
      managedBy: 'package',
    } as any, BOOT)).id;
    org1RuleId = (await rules.defineRule({
      name: 'org1_rule', label: 'Org1 own', object: 'project',
      criteria: { status: 'red' }, recipientType: 'user', recipientId: 'alice',
    } as any, ORG1_ADMIN)).id;
    org2RuleId = (await rules.defineRule({
      name: 'org2_rule', label: 'Org2 own', object: 'project',
      criteria: { status: 'green' }, recipientType: 'user', recipientId: 'bob',
    } as any, ORG2_ADMIN)).id;
    // Live grants on the OTHER tenant's rule, materialised under BOOT so the
    // fixture never leans on the gate it measures. Without them, "the refusal
    // wrote nothing" could pass over a rule that had nothing to disturb.
    await rules.evaluateRule(org2RuleId, BOOT);
  });

  it('PRECONDITION: two organizations, two rules, one platform-global row, live grants', () => {
    const rows = engine._tables.sys_sharing_rule;
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.id === seededId)?.organization_id).toBeNull();
    expect(rows.find((r) => r.id === org1RuleId)?.organization_id).toBe('org1');
    // The `tenantId`-spelled persona stamps its org just like the other
    // spelling — if this were null the whole two-tenant premise would be gone.
    expect(rows.find((r) => r.id === org2RuleId)?.organization_id).toBe('org2');
    expect(grantsOf(org2RuleId)).toHaveLength(1);
    // The exposed persona really does clear the ADR-0111 D6 gate, or every
    // refusal below would be measuring the OLDER guard.
    expect(ORG_LESS_SHARING_ADMIN.systemPermissions).toContain('manage_sharing');
    expect(ORG_LESS_SHARING_ADMIN.organizationId).toBeUndefined();
    expect(ORG_LESS_SHARING_ADMIN.tenantId).toBeUndefined();
    expect(ORG_LESS_SHARING_ADMIN.isSystem).toBeUndefined();
  });

  // ── the refusal (each paired with the row it used to leak) ───────────

  it('listRules is refused — it used to return BOTH tenants’ rules', async () => {
    const code = await refusalCodeOf(rules.listRules({}, ORG_LESS_SHARING_ADMIN));
    expect(code).toBe('PERMISSION_DENIED');
    // Sourced from the platform's own pairing rather than restated (#7795).
    expect(HttpStatusErrorCodeMap[403]).toBe(code);
    expect(code).not.toBe('RULE_NOT_FOUND');
    // The rows it used to answer with are really there to be leaked — this is
    // what a single-tenant fixture could not say.
    expect(namesOf(await rules.listRules({}, BOOT))).toEqual(['org1_rule', 'org2_rule', SEEDED].sort());
  });

  it('the message names the missing organization, not the missing capability', async () => {
    // The two refusals on this surface are both PERMISSION_DENIED; only the
    // message tells an operator which one they hit, and therefore what to fix.
    await expect(rules.listRules({}, ORG_LESS_SHARING_ADMIN)).rejects.toThrow(/active organization/);
  });

  it('an explicitly NULL org is the same case as an absent one', async () => {
    expect(await refusalCodeOf(rules.listRules({}, ORG_LESS_NULL_ORG))).toBe('PERMISSION_DENIED');
  });

  it('getRule is refused BY ID — the other tenant’s row stays unreachable', async () => {
    expect(await refusalCodeOf(rules.getRule(org2RuleId, ORG_LESS_SHARING_ADMIN))).toBe('PERMISSION_DENIED');
    // …and the id really does resolve for someone, so this is a refusal and
    // not a miss.
    expect((await rules.getRule(org2RuleId, BOOT))?.organization_id).toBe('org2');
  });

  it('getRule is refused BY NAME — findRuleRowByName is the third door', async () => {
    // The by-name path is a separate `if (!orgId)` site: a fix confined to
    // `adminOrgScope` leaves this one open, and `getRule` falls through to it
    // whenever the by-id query misses — which is what a by-name request is.
    expect(await refusalCodeOf(rules.getRule('org2_rule', ORG_LESS_SHARING_ADMIN))).toBe('PERMISSION_DENIED');
    expect((await rules.getRule('org2_rule', BOOT))?.id).toBe(org2RuleId);
  });

  it('evaluateRule is refused — the cross-tenant WRITE never runs', async () => {
    const before = JSON.stringify(engine._tables.sys_record_share ?? []);
    expect(await refusalCodeOf(rules.evaluateRule(org2RuleId, ORG_LESS_SHARING_ADMIN))).toBe('PERMISSION_DENIED');
    expect(await refusalCodeOf(rules.evaluateRule('org2_rule', ORG_LESS_SHARING_ADMIN))).toBe('PERMISSION_DENIED');
    // The harm in this defect is the grant reconciliation, so the assertion is
    // on the grant TABLE, not on the thrown shape.
    expect(JSON.stringify(engine._tables.sys_record_share ?? [])).toBe(before);
  });

  it('deleteRule is refused — the other tenant’s rule AND its grants survive', async () => {
    expect(await refusalCodeOf(rules.deleteRule(org2RuleId, ORG_LESS_SHARING_ADMIN))).toBe('PERMISSION_DENIED');
    expect(engine._tables.sys_sharing_rule.find((r) => r.id === org2RuleId)).toBeTruthy();
    expect(grantsOf(org2RuleId)).toHaveLength(1);
  });

  it('defineRule is refused — no accidental platform-global rule', async () => {
    // An org-less caller stamps `organization_id: null`, i.e. a rule whose
    // grants reach EVERY tenant and which #7795 then forbids them to delete.
    expect(await refusalCodeOf(rules.defineRule({
      name: 'mallory_rule', label: 'Mallory', object: 'project',
      criteria: { status: 'red' }, recipientType: 'user', recipientId: 'mallory',
    } as any, ORG_LESS_SHARING_ADMIN))).toBe('PERMISSION_DENIED');
    expect(engine._tables.sys_sharing_rule).toHaveLength(3);
  });

  it('the ADR-0111 D6 capability gate still fires FIRST', async () => {
    // Ordering pin: an org-less caller with no capability must hear about the
    // capability, not about the organization — both are PERMISSION_DENIED and
    // the messages are what keep them apart.
    await expect(rules.listRules({}, ORG_LESS_NOBODY)).rejects.toThrow(/manage_sharing capability/);
  });

  // ── the permitted side: system + platform keep the unfiltered read ───

  it('a SYSTEM context still reads every tenant, unfiltered — list, by id, by name', async () => {
    expect(namesOf(await rules.listRules({}, BOOT))).toEqual(['org1_rule', 'org2_rule', SEEDED].sort());
    expect((await rules.getRule(org2RuleId, BOOT))?.name).toBe('org2_rule');
    expect((await rules.getRule('org1_rule', BOOT))?.id).toBe(org1RuleId);
  });

  it('a SYSTEM context still SEEDS platform-global rows (boot seeding unbroken)', async () => {
    // `bootstrapDeclaredSharingRules` runs on every boot with exactly this
    // context; a guard that refused it would take the deployment down rather
    // than leak anything.
    const row = await rules.defineRule({
      name: 'seeded_on_boot', label: 'Seeded', object: 'project',
      criteria: { status: 'red' }, recipientType: 'user', recipientId: 'exec',
      managedBy: 'package',
    } as any, BOOT);
    expect(row.organization_id).toBeNull();
    expect(await rules.evaluateRule('seeded_on_boot', BOOT)).toMatchObject({ matchedRecords: 1 });
  });

  it('a PLATFORM operator with no active org still reads every tenant — both spellings', async () => {
    // The card's own reading: a platform operator on this path is harmless,
    // they hold platform authority whether or not an org is selected. This is
    // also the shape a single-tenant deployment has BEFORE its default org is
    // bootstrapped, so refusing it would be a functional regression.
    expect(namesOf(await rules.listRules({}, ORG_LESS_PLATFORM_CAP)))
      .toEqual(['org1_rule', 'org2_rule', SEEDED].sort());
    expect(namesOf(await rules.listRules({}, ORG_LESS_PLATFORM_RUNG)))
      .toEqual(['org1_rule', 'org2_rule', SEEDED].sort());
    expect((await rules.getRule(org2RuleId, ORG_LESS_PLATFORM_CAP))?.name).toBe('org2_rule');
    expect((await rules.getRule('org2_rule', ORG_LESS_PLATFORM_RUNG))?.id).toBe(org2RuleId);
  });

  it('[#15981] an org-less caller holding only the minted NAME reads nothing', async () => {
    // The whole point of the #8158 gate: `manage_sharing` is ORG-scoped, so an
    // org-less holder of it must not answer unscoped. The name-read was the
    // bypass — this is the arm that keeps it closed.
    await expect(rules.listRules({}, ORG_LESS_NAME_ONLY)).rejects.toThrow(/PERMISSION_DENIED/);
    await expect(rules.getRule(org2RuleId, ORG_LESS_NAME_ONLY)).rejects.toThrow(/PERMISSION_DENIED/);
  });

  // ── the anti-vacuity control: scoped ≠ single-tenant ─────────────────

  it('each org-bound admin sees EXACTLY its own org ∪ platform-global', async () => {
    // The pair that distinguishes "scoped correctly" from "there was only one
    // tenant's data anyway": two personas, two disjoint answers, one shared
    // platform-global row, over the same three-row table.
    expect(namesOf(await rules.listRules({}, ORG1_ADMIN))).toEqual(['org1_rule', SEEDED].sort());
    expect(namesOf(await rules.listRules({}, ORG2_ADMIN))).toEqual(['org2_rule', SEEDED].sort());
    expect(await rules.getRule('org2_rule', ORG1_ADMIN)).toBeNull();
    expect(await rules.getRule(org1RuleId, ORG2_ADMIN)).toBeNull();
  });

  it('the tenantId spelling is honoured — the org-bound REST caller is not refused', async () => {
    // `resolveAuthzContext` stamps `tenantId`, never `organizationId`. If the
    // guard read only the latter, every real HTTP caller would hit the new
    // refusal and this whole surface would 403 in production.
    await expect(rules.listRules({}, ORG2_ADMIN)).resolves.toBeTruthy();
    expect((await rules.getRule(org2RuleId, ORG2_ADMIN))?.name).toBe('org2_rule');
    expect((await rules.evaluateRule(org2RuleId, ORG2_ADMIN)).ruleId).toBe(org2RuleId);
  });
});

// ---------------------------------------------------------------------------
// commit 04d03c3a0 — a DEACTIVATED position confers no sharing-rule shares
//
// Maintainer ruling, 2026-08-15, the recitable line:
//
//   > Access-conferring paths filter deactivated positions; addressing paths
//   > do not.
//
// The authorization DERIVATION seam drops a deactivated position from what it
// grants. A sharing rule reaches users by a second road that never passes that
// seam — `expandRecipient` → `PositionGraphService` — so the call site drops a
// deactivated position itself. [ADR-0131 D3, ADR-0126 §4] Deactivation lives in
// the activation ledger (`sys_metadata_activation`, one row per
// `(metadata_type, name)`, deployment-wide), read as the resolver reads it; the
// `sys_position` row's `active` switches nothing.
//
// The tests below pin BOTH directions the ruling names, because the boundary
// is the part most easily lost in a later refactor:
//
//   ① access-conferring — the sharing call site drops a deactivated position;
//   ② addressing — `PositionGraphService.expandPositionUsers` stays a RAW
//     directory read. Approval ROUTING (plugin-approvals' own expansion) and
//     the write gates / blast-radius reads in plugin-security are the
//     addressing consumers the ruling deliberately leaves unfiltered:
//     filtering an approval step is fail-OPEN (it routes to nobody) and
//     filtering a write gate is access-WIDENING (a refused binding becomes
//     permitted). Moving this filter down into the helper would take those
//     with it — which is exactly what the pin in ② fails on.
// ---------------------------------------------------------------------------
describe('#8710 — a deactivated position confers no sharing-rule shares', () => {
  let engine: ReturnType<typeof makeEngine>;
  let sharing: SharingService;
  let rules: SharingRuleService;
  const SYS = { isSystem: true, organizationId: 'org1' } as any;

  const RULE = {
    name: 'cfo_won_deals', label: 'CFO — won deals', object: 'opportunity',
    criteria: { stage: 'won' },
    recipientType: 'position' as const, recipientId: 'cfo', accessLevel: 'read' as const,
  };

  /** Who currently holds a rule-materialised share, sorted. */
  const shareRecipients = () =>
    (engine._tables.sys_record_share ?? []).map((r: Row) => String(r.recipient_id)).sort();

  /** Switch `cfo` in the activation ledger — the flag under test. */
  const switchCfo = (active: unknown, metadataType = 'position') => {
    engine._tables.sys_metadata_activation = [
      { id: `act_${metadataType}_cfo`, metadata_type: metadataType, name: 'cfo', package_id: '', active },
    ];
  };

  beforeEach(() => {
    engine = makeEngine();
    engine._tables.opportunity = [
      { id: 'opp1', stage: 'won' },
      { id: 'opp2', stage: 'lost' },
    ];
    // Holders come from the platform assignment table (ADR-0057 D4).
    engine._tables.sys_user_position = [
      { id: 'up1', position: 'cfo', user_id: 'u_cfo', organization_id: 'org1' },
    ];
    engine._tables.sys_member = [];
    engine._tables.sys_position = [
      { id: 'pos_cfo', name: 'cfo', organization_id: 'org1', active: true },
    ];
    engine._tables.sys_metadata_activation = [];
    sharing = new SharingService({ engine: engine as any });
    rules = new SharingRuleService({ engine: engine as any, sharing });
  });

  // ── ① the change: an access-conferring path stops at a switched-off position ──

  it('shares nothing once the position is switched off in the ledger', async () => {
    switchCfo(false);
    const rule = await rules.defineRule(RULE, SYS);
    const res = await rules.evaluateRule(rule.id, SYS);
    expect(res.expandedUsers).toBe(0);
    expect(res.grantsCreated).toBe(0);
    expect(shareRecipients()).toEqual([]);
  });

  it('REVOKES the shares it already materialised when the position is switched off', async () => {
    // Deactivation has to retract, not merely stop granting: the admin's
    // mental model is "the position stops granting permissions", and a share
    // that survives until the next authoring edit is the leak in slow motion.
    const rule = await rules.defineRule(RULE, SYS);
    expect((await rules.evaluateRule(rule.id, SYS)).grantsCreated).toBe(1);
    expect(shareRecipients()).toEqual(['u_cfo']);

    switchCfo(false);
    const res = await rules.evaluateRule(rule.id, SYS);
    expect(res.grantsRevoked).toBe(1);
    expect(shareRecipients()).toEqual([]);
  });

  it('retires the recipient on the synchronous withdrawal path too', async () => {
    // `revokeRuleGrantsForRetiredRecipients` (#7729) is the recipient-axis
    // revoke the write path runs synchronously — it expands the recipient
    // through the same seam, so the deactivation must land there as well.
    const rule = await rules.defineRule(RULE, SYS);
    await rules.evaluateRule(rule.id, SYS);
    expect(shareRecipients()).toEqual(['u_cfo']);

    switchCfo(false);
    expect(await rules.revokeRuleGrantsForRetiredRecipients(await rules.getRule(rule.id, SYS) as any)).toBe(1);
    expect(shareRecipients()).toEqual([]);
  });

  it('reads the ledger as the resolver does — a driver 0 is off, so is false', async () => {
    // SQLite/libsql round-trip booleans as 0/1; a `=== false` test alone would
    // read a switched-off position as on. The resolver's reading is
    // `active === false || active === 0`, and the two readers must agree.
    for (const stored of [false, 0]) {
      engine._tables.sys_record_share = [];
      engine._tables.sys_sharing_rule = [];
      switchCfo(stored);
      const rule = await rules.defineRule(RULE, SYS);
      expect(await rules.evaluateRule(rule.id, SYS), `active=${JSON.stringify(stored)}`)
        .toMatchObject({ expandedUsers: 0, grantsCreated: 0 });
      expect(shareRecipients(), `active=${JSON.stringify(stored)}`).toEqual([]);
    }
  });

  // ── ② the anti-vacuity + fail-open controls: what must NOT change ──────

  it('an ACTIVE position shares exactly as before — a ledger row switched ON included', async () => {
    switchCfo(true);
    const rule = await rules.defineRule(RULE, SYS);
    expect(await rules.evaluateRule(rule.id, SYS)).toMatchObject({ expandedUsers: 1, grantsCreated: 1 });
    expect(shareRecipients()).toEqual(['u_cfo']);
  });

  it('the sys_position row\'s active switches nothing — only the ledger does', async () => {
    // [ADR-0131 D3] The resolver reads no catalog row, so a row flag is not a
    // deactivation; reading it here would make the two readers disagree.
    (engine._tables.sys_position[0] as Row).active = false;
    const rule = await rules.defineRule(RULE, SYS);
    expect(await rules.evaluateRule(rule.id, SYS)).toMatchObject({ expandedUsers: 1, grantsCreated: 1 });
    expect(shareRecipients()).toEqual(['u_cfo']);
  });

  it('a name with NO ledger row still grants — absent means active, never a mass revocation', async () => {
    // The membership-derived names (`sys_member.role`, ADR-0057 D4's
    // transition source) are in no catalog and carry no ledger row; they are
    // left untouched, as the resolver leaves them.
    engine._tables.sys_position = [];
    engine._tables.sys_member = [{ id: 'm1', organization_id: 'org1', user_id: 'u_role', role: 'cfo' }];
    const rule = await rules.defineRule(RULE, SYS);
    expect(await rules.evaluateRule(rule.id, SYS)).toMatchObject({ grantsCreated: 2 });
    expect(shareRecipients()).toEqual(['u_cfo', 'u_role']);
  });

  it('another TYPE switched off under the same name does not stop the position', async () => {
    // The ledger is shared by every activation type; only a `position` row
    // speaks for a position (a permission set is commonly named like one).
    switchCfo(false, 'permission');
    const rule = await rules.defineRule(RULE, SYS);
    expect(await rules.evaluateRule(rule.id, SYS)).toMatchObject({ expandedUsers: 1, grantsCreated: 1 });
    expect(shareRecipients()).toEqual(['u_cfo']);
  });

  it('a ledger read that fails still grants — never a mass revocation', async () => {
    const find = engine.find.bind(engine);
    (engine as any).find = async (object: string, opts?: any) => {
      if (object === 'sys_metadata_activation') throw new Error('ledger unreachable');
      return find(object, opts);
    };
    const rule = await rules.defineRule(RULE, SYS);
    expect(await rules.evaluateRule(rule.id, SYS)).toMatchObject({ expandedUsers: 1, grantsCreated: 1 });
  });

  it('a composition that registers no ledger object issues no ledger read, and the position still shares', async () => {
    const find = engine.find.bind(engine);
    let ledgerReads = 0;
    (engine as any).find = async (object: string, opts?: any) => {
      if (object === 'sys_metadata_activation') ledgerReads += 1;
      return find(object, opts);
    };
    (engine as any).registry = { getObject: (name: string) => (name === 'sys_metadata_activation' ? undefined : { name }) };
    switchCfo(false); // a row the composition does not serve
    const rule = await rules.defineRule(RULE, SYS);
    expect(await rules.evaluateRule(rule.id, SYS)).toMatchObject({ expandedUsers: 1, grantsCreated: 1 });
    expect(ledgerReads).toBe(0);
  });

  it('the ADDRESSING primitive stays a RAW directory read — the filter is the call site\'s', async () => {
    // ⛔ The load-bearing negative pin. `PositionGraphService` answers "who
    // holds position P" for every consumer of the graph; approval ROUTING and
    // the plugin-security write gates read that answer and MUST keep seeing
    // the deactivated position's holders (filtering there is fail-open /
    // access-widening respectively, reaffirmed by the 2026-08-15 ruling). An
    // ablation that moves this filter down into `expandPositionUsers` turns
    // this red.
    switchCfo(false);
    const graph = new PositionGraphService({ engine: engine as any, organizationId: 'org1' });
    expect(await graph.expandPositionUsers('cfo')).toEqual(['u_cfo']);
  });

  // ── the cache: one read per position per pass, and never one pass longer ──

  it('reads the ledger once per position per evaluator pass, and re-reads on the next', async () => {
    // The ruling accepts the extra read but asks for it cached per evaluator
    // pass. Both halves are the assertion: within one pass two rules naming
    // the same position pay one read; ACROSS passes the verdict is re-read, or
    // a deactivation would take effect late — its own defect.
    const find = engine.find.bind(engine);
    let ledgerReads = 0;
    (engine as any).find = async (object: string, opts?: any) => {
      if (object === 'sys_metadata_activation') ledgerReads += 1;
      return find(object, opts);
    };
    await rules.defineRule(RULE, SYS);
    await rules.defineRule({ ...RULE, name: 'cfo_won_deals_2', label: 'CFO — won deals (2)' }, SYS);

    await rules.evaluateAllForRecord('opportunity', 'opp1', SYS);
    expect(ledgerReads).toBe(1);
    // One share row, not two: `grant` upserts per (record, recipient), so the
    // second rule re-grants the row the first one created.
    expect(shareRecipients()).toEqual(['u_cfo']);

    switchCfo(false);
    await rules.evaluateAllForRecord('opportunity', 'opp1', SYS);
    expect(ledgerReads).toBe(2);
    expect(shareRecipients()).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────
// [ADR-0131 D2] Declared sharing rules are READ from the registry — the seeder
// that copied them into `sys_sharing_rule` is retired. A declared rule writes
// no row, still grants, and stops granting when its declaration goes; an
// organization-authored rule keeps working through its row; under a wall the
// declaration is served once per organization, exactly the passes the seeder
// made, and one organization's reconcile never touches another's grants.
// ─────────────────────────────────────────────────────────────────────

describe('[ADR-0131 D2] declared sharing rules are read from the registry, never written', () => {
  const BOOT = { isSystem: true, positions: [], permissions: [] } as any;
  const DECLARED = {
    name: 'share_red_projects',
    label: 'Red projects → exec',
    object: 'project',
    condition: 'record.status == "red"',
    sharedWith: { type: 'user', value: 'exec' },
    accessLevel: 'read',
  };

  /**
   * The file's fake engine, its `project` reads given the driver's tenant
   * scope (`organization_id = :tenant OR IS NULL`) so a projection's criteria
   * sweep stays inside its organization, as `SqlDriver.applyTenantScope` keeps
   * it — and a `registry` holding the declarations.
   */
  function harness(declared: any[], records: Row[]) {
    const engine: any = makeEngine();
    engine._tables.project = records;
    const find = engine.find.bind(engine);
    engine.find = async (o: string, opts?: any) => {
      const rows = await find(o, opts);
      const tenant = opts?.context?.tenantId;
      if (o !== 'project' || !tenant) return rows;
      return rows.filter((r: Row) => r.organization_id == null || r.organization_id === tenant);
    };
    engine.registry = { listItems: (type: string) => (type === 'sharing_rule' ? declared : []) };
    const rules = new SharingRuleService({
      engine,
      sharing: new SharingService({ engine }),
      declaredRules: createDeclaredSharingRuleSource({ engine }),
    });
    const grants = (): Row[] => engine._tables.sys_record_share ?? [];
    return { engine, rules, grants };
  }

  describe('`single`: one organization-less projection', () => {
    let h: ReturnType<typeof harness>;
    beforeEach(() => {
      h = harness([DECLARED], [
        { id: 'p_red', status: 'red', organization_id: 'org_default' },
        { id: 'p_green', status: 'green', organization_id: 'org_default' },
      ]);
    });

    it('a declared rule is listed and enforces — and no `sys_sharing_rule` row is written for it', async () => {
      const listed = await h.rules.listRules({}, BOOT);
      expect(listed).toEqual([expect.objectContaining({
        id: DECLARED.name, name: DECLARED.name, organization_id: null, object_name: 'project',
        criteria: { status: 'red' }, recipient_type: 'user', recipient_id: 'exec', access_level: 'read',
        active: true, managed_by: 'package', customized: false,
      })]);
      expect(isDeclaredSharingRule(listed[0])).toBe(true);

      const pass = await h.rules.evaluateRule(DECLARED.name, BOOT);
      expect(pass).toMatchObject({ ruleId: DECLARED.name, matchedRecords: 1, grantsCreated: 1 });
      expect(h.grants()).toEqual([expect.objectContaining({
        record_id: 'p_red', recipient_id: 'exec', source: 'rule', source_id: DECLARED.name,
      })]);
      expect(h.engine._tables.sys_sharing_rule ?? []).toEqual([]);
    });

    it('the per-record pass the write hooks run grants through the declaration too', async () => {
      await h.rules.evaluateAllForRecord('project', 'p_red', BOOT);
      expect(h.grants().map((g) => [g.record_id, g.recipient_id, g.source_id])).toEqual([['p_red', 'exec', DECLARED.name]]);
    });

    it('POSITIVE CONTROL: remove the declaration and the grant stops (the boot sweep revokes it)', async () => {
      await h.rules.evaluateRule(DECLARED.name, BOOT);
      expect(h.grants()).toHaveLength(1);
      // The declaration leaves the registry — a redeploy without it.
      h.engine.registry = { listItems: () => [] };
      expect(await h.rules.listRules({}, BOOT)).toEqual([]);
      await expect(h.rules.evaluateRule(DECLARED.name, BOOT)).rejects.toThrow('RULE_NOT_FOUND');
      expect(await h.rules.sweepOrphanedRuleGrants()).toBe(1);
      expect(h.grants()).toEqual([]);
    });

    it('NEGATIVE: the sweep leaves a served declaration’s grants standing', async () => {
      await h.rules.evaluateRule(DECLARED.name, BOOT);
      expect(await h.rules.sweepOrphanedRuleGrants()).toBe(0);
      expect(h.grants()).toHaveLength(1);
    });

    it('an organization-authored rule keeps working through its row, with its row id as the grant source', async () => {
      const row = await h.rules.defineRule({
        name: 'green_to_alice', label: 'Green → alice', object: 'project',
        criteria: { status: 'green' }, recipientType: 'user', recipientId: 'alice',
      } as any, { ...BOOT, tenantId: 'org_default' });
      expect(row.id).not.toBe(row.name);
      await h.rules.evaluateRule(row.id, BOOT);
      expect(h.grants().find((g) => g.recipient_id === 'alice')).toMatchObject({ record_id: 'p_green', source_id: row.id });
      expect((await h.rules.listRules({}, BOOT)).map((r) => r.name)).toEqual(['green_to_alice', DECLARED.name]);
    });

    it('a row holding the declared name answers for it, and the declaration is not served beside it', async () => {
      // A seeded copy an administrator customized (deactivated) — the row the
      // seeder would never overwrite, and the one the ceremony keeps.
      h.engine._tables.sys_sharing_rule = [{
        id: 'srule_customized', organization_id: 'org_default', name: DECLARED.name, label: 'customized',
        object_name: 'project', criteria_json: JSON.stringify({ status: 'red' }), recipient_type: 'user',
        recipient_id: 'exec', access_level: 'read', active: false, managed_by: 'package', customized: true,
      }];
      const listed = await h.rules.listRules({}, BOOT);
      expect(listed.map((r) => r.id)).toEqual(['srule_customized']);
      expect(await h.rules.evaluateRule(DECLARED.name, BOOT)).toMatchObject({ ruleId: 'srule_customized', grantsCreated: 0 });
      expect(h.grants()).toEqual([]);
    });

    /** The refusal's ADR-0112 code TOKEN — the prefix the REST door maps — never a substring of the message. */
    const refusalCodeOf = async (call: Promise<unknown>): Promise<string> => {
      try {
        await call;
      } catch (err: any) {
        return String(err?.message ?? err ?? '').split(':')[0].trim();
      }
      throw new Error('expected the call to be REFUSED, but it resolved successfully');
    };

    it.each([
      ['an org-scoped sharing admin', { userId: 'admin', organizationId: 'org_default', systemPermissions: ['manage_sharing'] }],
      ['a system context', BOOT],
    ])('%s reads the declared rule but cannot delete it — 403 PERMISSION_DENIED, its grants left standing', async (_who, ctx) => {
      await h.rules.evaluateRule(DECLARED.name, BOOT);
      const before = h.grants().map((g) => g.id).sort();
      expect(before).toHaveLength(1);
      expect((await h.rules.getRule(DECLARED.name, ctx as any))?.id).toBe(DECLARED.name);

      const code = await refusalCodeOf(h.rules.deleteRule(DECLARED.name, ctx as any));
      // `code`: the exact ADR-0112 token the sharing-rule routes map, not a substring.
      expect(code).toBe('PERMISSION_DENIED');
      // `status`: sourced from the platform's own code↔status pairing, not restated.
      expect(HttpStatusErrorCodeMap[403]).toBe(code);
      // …and not 404-shaped, in either spelling: the rule exists, the same caller just read it.
      expect(code).not.toBe(HttpStatusErrorCodeMap[404]);
      expect(code).not.toBe('RULE_NOT_FOUND');
      // The refusal precedes every write: the declaration's grants still stand, and it still serves.
      expect(h.grants().map((g) => g.id).sort()).toEqual(before);
      expect((await h.rules.listRules({}, BOOT)).map((r) => r.id)).toEqual([DECLARED.name]);
    });
  });

  describe('walled: one projection per organization, each organization’s grants its own', () => {
    let h: ReturnType<typeof harness>;
    beforeEach(() => {
      h = harness([DECLARED], [
        { id: 'a_red', status: 'red', organization_id: 'org_a' },
        { id: 'b_red', status: 'red', organization_id: 'org_b' },
      ]);
      h.rules.setDeclaredRuleScopes(['org_a', 'org_b']);
    });

    it('lists one projection per organization, each sweeping only its organization’s records', async () => {
      const listed = await h.rules.listRules({}, BOOT);
      expect(listed.map((r) => [r.id, r.organization_id])).toEqual([[DECLARED.name, 'org_a'], [DECLARED.name, 'org_b']]);
      const pass = await h.rules.evaluateRule(DECLARED.name, BOOT);
      expect(pass).toMatchObject({ ruleId: DECLARED.name, matchedRecords: 2, grantsCreated: 2 });
      expect(h.grants().map((g) => [g.record_id, g.organization_id, g.source_id]).sort()).toEqual([
        ['a_red', 'org_a', DECLARED.name],
        ['b_red', 'org_b', DECLARED.name],
      ]);
      expect(h.engine._tables.sys_sharing_rule ?? []).toEqual([]);
    });

    it('one organization’s reconcile leaves the other organization’s grants of the same rule standing', async () => {
      await h.rules.evaluateRule(DECLARED.name, BOOT);
      const admin = { userId: 'admin', organizationId: 'org_a', systemPermissions: ['manage_sharing'] } as any;
      // org_a's own evaluation — the projection it reads is its own.
      expect((await h.rules.listRules({}, admin)).map((r) => r.organization_id)).toEqual(['org_a']);
      expect(await h.rules.evaluateRule(DECLARED.name, admin)).toMatchObject({ matchedRecords: 1, grantsRevoked: 0 });
      expect(h.grants()).toHaveLength(2);
      // The per-record pass over org_b's record does not revoke org_a's grant.
      await h.rules.evaluateAllForRecord('project', 'b_red', BOOT);
      expect(h.grants().map((g) => g.record_id).sort()).toEqual(['a_red', 'b_red']);
    });

    it('a row of the declared name answers in ITS organization only', async () => {
      h.engine._tables.sys_sharing_rule = [{
        id: 'srule_a', organization_id: 'org_a', name: DECLARED.name, label: 'org_a own',
        object_name: 'project', criteria_json: JSON.stringify({ status: 'red' }), recipient_type: 'user',
        recipient_id: 'exec', access_level: 'read', active: false, managed_by: 'admin', customized: false,
      }];
      const listed = await h.rules.listRules({}, BOOT);
      expect(listed.map((r) => [r.id, r.organization_id])).toEqual([['srule_a', 'org_a'], [DECLARED.name, 'org_b']]);
    });

    it('the sweep keeps each organization’s served grants and revokes a grant in an organization no projection serves', async () => {
      await h.rules.evaluateRule(DECLARED.name, BOOT);
      h.rules.setDeclaredRuleScopes(['org_a']);
      expect(await h.rules.sweepOrphanedRuleGrants()).toBe(1);
      expect(h.grants().map((g) => g.organization_id)).toEqual(['org_a']);
    });

    it('UNKNOWN scopes (a failed organization enumeration) serve no declared rule and revoke none of its grants', async () => {
      await h.rules.evaluateRule(DECLARED.name, BOOT);
      expect(h.grants()).toHaveLength(2);
      // A true orphan beside them — a grant whose rule ROW is gone — is still swept.
      h.engine._tables.sys_record_share.push({
        id: 'share_orphan', organization_id: 'org_a', object_name: 'project', record_id: 'a_red',
        recipient_type: 'user', recipient_id: 'ghost', access_level: 'read', source: 'rule', source_id: 'srule_deleted',
      });
      const warns: Array<[string, unknown]> = [];
      (h.rules as any).logger = { warn: (m: string, meta?: unknown) => warns.push([m, meta]) };
      h.rules.setDeclaredRuleScopesUnknown();
      // Unknown, not "none": one organization created meanwhile does not make the set known.
      h.rules.addDeclaredRuleScope('org_c');

      expect(await h.rules.listRules({}, BOOT)).toEqual([]);
      expect(await h.rules.sweepOrphanedRuleGrants()).toBe(1);
      expect(h.grants().map((g) => g.id).sort()).not.toContain('share_orphan');
      expect(h.grants().filter((g) => g.source_id === DECLARED.name).map((g) => g.organization_id).sort()).toEqual(['org_a', 'org_b']);
      expect(warns.filter(([m]) => m.includes('could not be enumerated'))).toHaveLength(1);
      // Said once per process, not on every sweep.
      await h.rules.sweepOrphanedRuleGrants();
      expect(warns.filter(([m]) => m.includes('could not be enumerated'))).toHaveLength(1);
    });

    it('CONTROL: KNOWN scopes that leave an organization out do revoke its declared grants — the sweep is live', async () => {
      await h.rules.evaluateRule(DECLARED.name, BOOT);
      h.rules.setDeclaredRuleScopes(['org_a']);
      expect(await h.rules.sweepOrphanedRuleGrants()).toBe(1);
    });

    it('an organization created after boot is served from its creation on; unknown organizations serve nothing', async () => {
      h.rules.setDeclaredRuleScopes([]);
      expect(await h.rules.listRules({}, BOOT)).toEqual([]);
      h.rules.addDeclaredRuleScope('org_b');
      expect((await h.rules.listRules({}, BOOT)).map((r) => r.organization_id)).toEqual(['org_b']);
    });
  });

  // ───────────────────────────────────────────────────────────────────
  // [ADR-0131 D6 regime O, guarded — ruling B′] A row of a declared rule's
  // name replaces the declaration in its scope. Only the EDIT of the
  // projection (saved back under its id, the rule's name) may create that
  // row; a new rule, or a rename, taking the name is refused 409. And the
  // write that creates, switches or removes the row reconciles the
  // declaration's grants in that scope at once — not at the next boot's sweep.
  // ───────────────────────────────────────────────────────────────────
  describe('regime O, guarded: the declared name is taken; the edit is the overlay', () => {
    const adminOf = (org: string) =>
      ({ userId: 'admin', tenantId: org, organizationId: org, systemPermissions: ['manage_sharing'] }) as any;
    const RULE_INPUT = {
      name: DECLARED.name, label: 'Red projects → exec (ours)', object: 'project',
      criteria: { status: 'red' }, recipientType: 'user', recipientId: 'exec', accessLevel: 'read',
    } as const;

    /** The refusal's declared envelope — `code` + `status`, never the sentence. */
    const refusalOf = async (call: Promise<unknown>): Promise<{ code: unknown; status: unknown; rule: unknown }> => {
      try {
        await call;
      } catch (err: any) {
        return { code: err?.code, status: err?.status, rule: err?.rule };
      }
      throw new Error('expected the write to be REFUSED, but it resolved successfully');
    };

    /**
     * The plugin's `sys_sharing_rule` write trigger, bound over this harness's
     * engine with the real rule service — the seam every door's write reaches.
     */
    function wireTrigger(h: ReturnType<typeof harness>) {
      const hooks: Array<{ event: string; handler: (ctx: any) => any; options: Record<string, any> }> = [];
      h.engine.registerHook = (event: string, handler: (ctx: any) => any, options: Record<string, any> = {}) => {
        hooks.push({ event, handler, options });
      };
      h.engine.unregisterHooksByPackage = (pkg: string) => {
        let removed = 0;
        for (let i = hooks.length - 1; i >= 0; i--) if (hooks[i].options.packageId === pkg) { hooks.splice(i, 1); removed++; }
        return removed;
      };
      const plugin = new SharingServicePlugin();
      (plugin as any).ruleService = h.rules;
      (plugin as any).ruleGrantsBootReconciled = true;
      const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
      (plugin as any).bindRuleRebindTriggers(h.engine, { logger });
      bindDeclaredRuleNameGuard(h.engine, h.rules);
      const fire = async (event: string, ctx: Record<string, any>) => {
        for (const x of hooks.filter((y) => y.event === event && y.options.object === 'sys_sharing_rule')) await x.handler(ctx);
      };
      return { fire, logger };
    }
    const storedRow = (h: ReturnType<typeof harness>, id: string): Row =>
      (h.engine._tables.sys_sharing_rule ?? []).find((r: Row) => r.id === id);

    describe('`single`', () => {
      let h: ReturnType<typeof harness>;
      beforeEach(async () => {
        h = harness([DECLARED], [
          { id: 'p_red', status: 'red', organization_id: 'org_default' },
          { id: 'p_red_2', status: 'red', organization_id: 'org_other' },
        ]);
        await h.rules.evaluateRule(DECLARED.name, BOOT);
      });

      it.each([
        ['an org-scoped sharing admin', adminOf('org_default')],
        ['a system context', BOOT],
      ])('%s: a NEW rule taking the declared name is refused 409 RESOURCE_CONFLICT, naming the vendor rule, and nothing lands', async (_who, ctx) => {
        const before = h.grants().map((g) => g.id).sort();
        const refusal = await refusalOf(h.rules.defineRule({ ...RULE_INPUT } as any, ctx));
        expect(refusal).toEqual({ code: 'RESOURCE_CONFLICT', status: 409, rule: DECLARED.name });
        // The catalogue's own code for the status, not a restated pair.
        expect(HttpStatusErrorCodeMap[409]).toBe(refusal.code);
        expect(h.engine._tables.sys_sharing_rule ?? []).toEqual([]);
        expect(h.grants().map((g) => g.id).sort()).toEqual(before);
        expect((await h.rules.listRules({}, BOOT)).map((r) => r.id)).toEqual([DECLARED.name]);
      });

      it('an id that is not the projection’s is a new rule too — refused', async () => {
        const refusal = await refusalOf(h.rules.defineRule({ ...RULE_INPUT, id: 'srule_elsewhere' } as any, adminOf('org_default')));
        expect(refusal.code).toBe('RESOURCE_CONFLICT');
        expect(h.engine._tables.sys_sharing_rule ?? []).toEqual([]);
      });

      it('CONTROL: a name no declaration holds is created as before, with no id', async () => {
        const row = await h.rules.defineRule({ ...RULE_INPUT, name: 'red_to_exec_too' } as any, adminOf('org_default'));
        expect(row.id).toMatch(/^srule_/);
      });

      it('the EDIT of the projection (saved back under its id) stores the customised copy, which answers for the name', async () => {
        const copy = await h.rules.defineRule({ ...RULE_INPUT, id: DECLARED.name, active: false } as any, adminOf('org_default'));
        expect(copy).toMatchObject({ name: DECLARED.name, organization_id: 'org_default', active: false });
        expect(copy.id).not.toBe(DECLARED.name);
        expect((await h.rules.listRules({}, BOOT)).map((r) => r.id)).toEqual([copy.id]);
        // The copy is a stored row now: saving it again is the upsert, no id needed.
        const again = await h.rules.defineRule({ ...RULE_INPUT, active: true } as any, adminOf('org_default'));
        expect(again.id).toBe(copy.id);
      });

      it('the copy’s creation revokes the declaration’s grants EVERYWHERE in the same write — before any boot sweep', async () => {
        const { fire } = wireTrigger(h);
        expect(h.grants().filter((g) => g.source_id === DECLARED.name)).toHaveLength(2);
        const copy = await h.rules.defineRule({ ...RULE_INPUT, id: DECLARED.name, active: false } as any, adminOf('org_default'));
        await fire('afterInsert', { result: storedRow(h, copy.id) });
        // Under `single` the one overlay answers everywhere: both organizations' grants go.
        expect(h.grants()).toEqual([]);
        // Nothing was left for the sweep.
        expect(await h.rules.sweepOrphanedRuleGrants()).toBe(0);
      });

      it('an `active` change on the copy reconciles the declaration’s grants again — a stale one goes', async () => {
        const { fire } = wireTrigger(h);
        const copy = await h.rules.defineRule({ ...RULE_INPUT, id: DECLARED.name } as any, adminOf('org_default'));
        await fire('afterInsert', { result: storedRow(h, copy.id) });
        // The copy grants under its own id (an organization's row sweeps its own
        // organization's records); the declaration grants nothing.
        expect(h.grants().map((g) => [g.record_id, g.source_id])).toEqual([['p_red', copy.id]]);
        // A declaration grant left standing (a write that failed half-way, say).
        h.engine._tables.sys_record_share.push({
          id: 'share_stale', organization_id: 'org_default', object_name: 'project', record_id: 'p_red',
          recipient_type: 'user', recipient_id: 'exec', access_level: 'read', source: 'rule', source_id: DECLARED.name,
        });
        // The admin switches the copy off through the `/data` door.
        const previous = { ...storedRow(h, copy.id) };
        Object.assign(storedRow(h, copy.id), { active: false });
        await fire('afterUpdate', { previous, input: { id: copy.id, data: { active: false } }, result: storedRow(h, copy.id) });
        expect(h.grants()).toEqual([]);
      });

      it('a reconcile failure stops before the copy’s own pass: the two are never both in force', async () => {
        const { fire, logger } = wireTrigger(h);
        const copy = await h.rules.defineRule({ ...RULE_INPUT, id: DECLARED.name } as any, adminOf('org_default'));
        const evaluate = vi.spyOn(h.rules, 'evaluateRule');
        vi.spyOn(h.rules, 'reconcileDeclaredRuleName').mockRejectedValueOnce(new Error('driver down'));
        await fire('afterInsert', { result: storedRow(h, copy.id) });
        expect(evaluate).not.toHaveBeenCalled();
        expect(h.grants().every((g) => g.source_id === DECLARED.name)).toBe(true);
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('grant reconcile failed'), expect.anything());
      });

      it('removing the copy serves the declaration again, its grants re-derived in the same write', async () => {
        const { fire } = wireTrigger(h);
        const copy = await h.rules.defineRule({ ...RULE_INPUT, id: DECLARED.name, active: false } as any, adminOf('org_default'));
        await fire('afterInsert', { result: storedRow(h, copy.id) });
        expect(h.grants()).toEqual([]);
        const previous = { ...storedRow(h, copy.id) };
        h.engine._tables.sys_sharing_rule = [];
        await fire('afterDelete', { previous, input: { id: copy.id } });
        expect(h.grants().map((g) => [g.record_id, g.source_id]).sort()).toEqual([
          ['p_red', DECLARED.name], ['p_red_2', DECLARED.name],
        ]);
      });

      describe('the `/data` door (Setup’s New and edit form)', () => {
        it('an INSERT of the declared name is refused 409 before it lands; a system write passes', async () => {
          const { fire } = wireTrigger(h);
          const session = { userId: 'admin', isSystem: false };
          const refusal = await refusalOf(fire('beforeInsert', { session, input: { data: { name: DECLARED.name } } }));
          expect(refusal).toEqual({ code: 'RESOURCE_CONFLICT', status: 409, rule: DECLARED.name });
          await expect(fire('beforeInsert', { session: { isSystem: true }, input: { data: { name: DECLARED.name } } })).resolves.toBeUndefined();
          await expect(fire('beforeInsert', { session, input: { data: { name: 'another_rule' } } })).resolves.toBeUndefined();
        });

        it('a RENAME onto the declared name is refused; a save that keeps the copy’s name, or renames away, passes', async () => {
          const { fire } = wireTrigger(h);
          const session = { userId: 'admin', isSystem: false };
          const other = { id: 'srule_other', name: 'another_rule' };
          const refusal = await refusalOf(fire('beforeUpdate', { session, previous: other, input: { id: other.id, data: { name: DECLARED.name } } }));
          expect(refusal.code).toBe('RESOURCE_CONFLICT');
          const copy = { id: 'srule_copy', name: DECLARED.name };
          await expect(fire('beforeUpdate', { session, previous: copy, input: { id: copy.id, data: { name: DECLARED.name, active: false } } })).resolves.toBeUndefined();
          await expect(fire('beforeUpdate', { session, previous: copy, input: { id: copy.id, data: { name: 'renamed_away' } } })).resolves.toBeUndefined();
        });
      });
    });

    describe('walled: an organization’s overlay is its own', () => {
      let h: ReturnType<typeof harness>;
      beforeEach(async () => {
        h = harness([DECLARED], [
          { id: 'a_red', status: 'red', organization_id: 'org_a' },
          { id: 'b_red', status: 'red', organization_id: 'org_b' },
        ]);
        h.rules.setDeclaredRuleScopes(['org_a', 'org_b']);
        await h.rules.evaluateRule(DECLARED.name, BOOT);
      });

      it('a NEW rule of the declared name is refused in an organization too', async () => {
        expect((await refusalOf(h.rules.defineRule({ ...RULE_INPUT } as any, adminOf('org_a')))).code).toBe('RESOURCE_CONFLICT');
      });

      it('org_a’s copy revokes org_a’s declared grants at once; org_b keeps the declaration and its grants', async () => {
        const { fire } = wireTrigger(h);
        const copy = await h.rules.defineRule({ ...RULE_INPUT, id: DECLARED.name, active: false } as any, adminOf('org_a'));
        await fire('afterInsert', { result: storedRow(h, copy.id) });
        expect(h.grants().map((g) => [g.record_id, g.organization_id, g.source_id])).toEqual([['b_red', 'org_b', DECLARED.name]]);
        expect((await h.rules.listRules({}, BOOT)).map((r) => [r.id, r.organization_id])).toEqual([
          [copy.id, 'org_a'], [DECLARED.name, 'org_b'],
        ]);
        expect(await h.rules.sweepOrphanedRuleGrants()).toBe(0);
      });
    });
  });
});

// ─────────────────────────────────────────────────────────────────────
// [ADR-0131 D2] The boot's organization enumeration for declared-rule scopes
// reads EVERY organization (a keyset walk, no cap), and a read that fails at
// any page is UNKNOWN — never a partial list, because the scopes decide which
// name-keyed grants the boot sweep keeps.
// ─────────────────────────────────────────────────────────────────────

describe('[ADR-0131 D2] resolveDeclaredRuleScopes', () => {
  /**
   * `sys_organization` on the file's engine fake (rows inserted in `id` order,
   * so its insertion order IS the walk's `id` order), its reads counted, the
   * `orderBy` each page asked for recorded, and one call failing on demand.
   */
  function organizations(count: number, failOnCall?: number) {
    const engine: any = makeEngine();
    engine._tables.sys_organization = Array.from({ length: count }, (_, i) => ({ id: `org_${String(i + 1).padStart(4, '0')}` }));
    const base = engine.find.bind(engine);
    let calls = 0;
    const orders: unknown[] = [];
    engine.find = async (o: string, opts?: any) => {
      calls += 1;
      if (calls === failOnCall) throw new Error('connection reset');
      orders.push(opts?.orderBy);
      return base(o, opts);
    };
    return Object.assign(engine, { calls: () => calls, orders });
  }

  it('reads every organization past the former 500-row cap, in pages', async () => {
    const engine = organizations(1201);
    const scopes = await resolveDeclaredRuleScopes(engine, 'isolated');
    expect(scopes).toHaveLength(1201);
    expect(scopes?.at(-1)).toBe('org_1201');
    expect(engine.calls()).toBe(3);
    // Seek pagination needs the id order on every page.
    expect(engine.orders).toEqual(Array(3).fill([{ field: 'id', order: 'asc' }]));
  });

  it('a page boundary that lands exactly on the last organization still ends the walk', async () => {
    const engine = organizations(1000);
    expect(await resolveDeclaredRuleScopes(engine, 'isolated')).toHaveLength(1000);
    expect(engine.calls()).toBe(3);
  });

  it('a read that fails on a LATER page answers unknown (null), never the partial list, and says so', async () => {
    const warns: string[] = [];
    const scopes = await resolveDeclaredRuleScopes(organizations(1201, 2), 'isolated', { warn: (m) => warns.push(m) });
    expect(scopes).toBeNull();
    expect(warns).toEqual([expect.stringMatching(/could not enumerate organizations — .*no declared rule's grant is revoked/)]);
  });

  it('`single` reads nothing and serves the one organization-less scope', async () => {
    const engine = organizations(3);
    expect(await resolveDeclaredRuleScopes(engine, 'single')).toEqual([null]);
    expect(engine.calls()).toBe(0);
  });

  it('an organization past the former cap keeps its declared rule\'s grant through the boot sweep', async () => {
    const engine: any = makeEngine();
    const orgs = organizations(600);
    const ids = (await resolveDeclaredRuleScopes(orgs, 'isolated'))!;
    engine._tables.project = [{ id: 'p_late', status: 'red', organization_id: 'org_0600' }];
    // The driver's tenant scope on the record read, as the harness above gives it.
    const find = engine.find.bind(engine);
    engine.find = async (o: string, opts?: any) => {
      const rows = await find(o, opts);
      const tenant = opts?.context?.tenantId;
      return o === 'project' && tenant ? rows.filter((r: Row) => r.organization_id == null || r.organization_id === tenant) : rows;
    };
    engine.registry = {
      listItems: (type: string) => (type === 'sharing_rule'
        ? [{ name: 'share_red', object: 'project', condition: 'record.status == "red"', sharedWith: { type: 'user', value: 'exec' } }]
        : []),
    };
    const rules = new SharingRuleService({
      engine,
      sharing: new SharingService({ engine }),
      declaredRules: createDeclaredSharingRuleSource({ engine }),
    });
    rules.setDeclaredRuleScopes(ids);
    await rules.evaluateAllForRecord('project', 'p_late', BOOT_CTX);
    expect((engine._tables.sys_record_share ?? []).map((g: Row) => [g.record_id, g.source_id, g.organization_id]))
      .toContainEqual(['p_late', 'share_red', 'org_0600']);
    expect(await rules.sweepOrphanedRuleGrants()).toBe(0);
    expect((engine._tables.sys_record_share ?? []).filter((g: Row) => g.organization_id === 'org_0600')).toHaveLength(1);
  });
});

const BOOT_CTX = { isSystem: true, positions: [], permissions: [] } as any;
