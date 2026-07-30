// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#2926 ③] Boot backfill of sharing-rule grants.
 *
 * Rule grants are materialized by write hooks, which deliberately skip
 * `isSystem` writes (rule-hooks.ts) — so records created by the boot-time
 * seed loader (always `isSystem`) never produced `sys_record_share` rows:
 * demo data shipping with matching sharing rules was broken out of the box
 * until an admin "touched" each record at runtime. `backfillRuleGrants`
 * reconciles every active rule once per boot, idempotently.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SharingService } from './sharing-service.js';
import { SharingRuleService } from './sharing-rule-service.js';
import { backfillRuleGrants, backfillRetiredAccessLevels } from './sharing-plugin.js';

interface Row { [k: string]: any }

const SYS = { isSystem: true } as any;

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
      return ensure(o).filter((r) => matches(r, f)).slice(0, opts?.limit ?? 10000);
    },
    async insert(o: string, data: any) { const row = { ...data }; ensure(o).push(row); return row; },
    async update(o: string, idOrData: any, dataOrOpts?: any) {
      const data = typeof idOrData === 'object' ? idOrData : dataOrOpts;
      const id = typeof idOrData === 'object' ? idOrData.id : idOrData;
      const t = ensure(o); const i = t.findIndex((r) => r.id === id);
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

describe('backfillRuleGrants (#2926 ③ — seed rows materialize at boot)', () => {
  let engine: ReturnType<typeof makeEngine>;
  let sharing: SharingService;
  let rules: SharingRuleService;

  beforeEach(async () => {
    engine = makeEngine();
    sharing = new SharingService({ engine: engine as any });
    rules = new SharingRuleService({ engine: engine as any, sharing });
    // Seed-loader analog: records written directly (isSystem path) — the
    // write hooks never ran, so sys_record_share is empty.
    engine._tables.showcase_inquiry = [
      { id: 'inq_new', status: 'new', owner_id: 'priya' },
      { id: 'inq_won', status: 'won', owner_id: 'priya' },
    ];
    await rules.defineRule({
      name: 'new_inquiries_to_wes', label: 'New inquiries → wes', object: 'showcase_inquiry',
      criteria: { status: 'new' },
      recipientType: 'user', recipientId: 'wes', accessLevel: 'read',
    }, SYS);
  });

  it('materializes grants for seed records that match an active rule', async () => {
    expect(engine._tables.sys_record_share ?? []).toHaveLength(0);
    const active = await rules.listRules({ activeOnly: true }, SYS);
    const reconciled = await backfillRuleGrants(rules, active);
    expect(reconciled).toBe(1);
    const shares = engine._tables.sys_record_share ?? [];
    expect(shares).toHaveLength(1);
    expect(shares[0]).toMatchObject({ record_id: 'inq_new', recipient_id: 'wes' });
  });

  it('is idempotent across repeated boots (no duplicate grants)', async () => {
    const active = await rules.listRules({ activeOnly: true }, SYS);
    await backfillRuleGrants(rules, active);
    await backfillRuleGrants(rules, active);
    expect(engine._tables.sys_record_share ?? []).toHaveLength(1);
  });

  it('one broken rule does not block the others (best-effort per rule)', async () => {
    await rules.defineRule({
      name: 'zzz_broken', label: 'Broken', object: 'showcase_inquiry',
      criteria: { status: 'new' },
      recipientType: 'user', recipientId: 'someone', accessLevel: 'read',
    }, SYS);
    const active = await rules.listRules({ activeOnly: true }, SYS);
    // Blow up evaluation of the broken rule only.
    const realEvaluate = rules.evaluateRule.bind(rules);
    vi.spyOn(rules, 'evaluateRule').mockImplementation(async (idOrName: string, context: any) => {
      const rule = await rules.getRule(idOrName, context);
      if (rule?.name === 'zzz_broken') throw new Error('boom');
      return realEvaluate(idOrName, context);
    });
    const warn = vi.fn();
    const reconciled = await backfillRuleGrants(rules, active, { warn });
    expect(reconciled).toBe(1);
    expect(warn).toHaveBeenCalledOnce();
    // The healthy rule still materialized.
    expect((engine._tables.sys_record_share ?? []).some((s) => s.record_id === 'inq_new')).toBe(true);
  });
});

describe("backfillRetiredAccessLevels (#3865 — stored 'full' normalises to 'edit')", () => {
  let engine: ReturnType<typeof makeEngine>;

  beforeEach(() => {
    engine = makeEngine();
  });

  it("rewrites 'full' to 'edit' on both sharing rules and record shares", async () => {
    engine._tables.sys_sharing_rule = [
      { id: 'rule_full', name: 'legacy', access_level: 'full', managed_by: 'package' },
      { id: 'rule_read', name: 'keep', access_level: 'read' },
    ];
    engine._tables.sys_record_share = [
      { id: 'shr_full', object_name: 'account', record_id: 'a1', access_level: 'full' },
      { id: 'shr_edit', object_name: 'account', record_id: 'a2', access_level: 'edit' },
    ];

    const counts = await backfillRetiredAccessLevels(engine as any);

    expect(counts).toEqual({ rules: 1, shares: 1 });
    expect(engine._tables.sys_sharing_rule.map((r) => r.access_level).sort()).toEqual(['edit', 'read']);
    expect(engine._tables.sys_record_share.map((r) => r.access_level)).toEqual(['edit', 'edit']);
  });

  it('leaves the provenance columns alone (a package rule must not become customized)', async () => {
    // The provenance stamp hook skips isSystem writes, and this backfill uses
    // one — if a seeded rule came out `customized: true`, the seeder would stop
    // updating it forever (#2909 T1).
    engine._tables.sys_sharing_rule = [
      { id: 'rule_full', name: 'legacy', access_level: 'full', managed_by: 'package', customized: false },
    ];
    await backfillRetiredAccessLevels(engine as any);
    expect(engine._tables.sys_sharing_rule[0]).toMatchObject({
      access_level: 'edit',
      managed_by: 'package',
      customized: false,
    });
  });

  it('is idempotent — a second boot finds nothing to do', async () => {
    engine._tables.sys_record_share = [
      { id: 'shr_full', object_name: 'account', record_id: 'a1', access_level: 'full' },
    ];
    expect(await backfillRetiredAccessLevels(engine as any)).toEqual({ rules: 0, shares: 1 });
    expect(await backfillRetiredAccessLevels(engine as any)).toEqual({ rules: 0, shares: 0 });
  });

  it('is a no-op on a clean database', async () => {
    expect(await backfillRetiredAccessLevels(engine as any)).toEqual({ rules: 0, shares: 0 });
  });

  it('never blocks boot when the tables are missing or the driver refuses', async () => {
    const broken = {
      ...engine,
      async find() { throw new Error('no such table: sys_sharing_rule'); },
    };
    const warn = vi.fn();
    await expect(backfillRetiredAccessLevels(broken as any, { warn })).resolves.toEqual({ rules: 0, shares: 0 });
    expect(warn).toHaveBeenCalled();
  });

  it('stops instead of spinning when updates silently fail to stick', async () => {
    // Guards the re-query loop: it selects on the very column it mutates, so an
    // update that does not persist would otherwise re-select the same batch
    // forever and hang boot.
    engine._tables.sys_record_share = [
      { id: 'shr_full', object_name: 'account', record_id: 'a1', access_level: 'full' },
    ];
    const stuck = {
      ...engine,
      find: engine.find,
      async update() { throw new Error('read-only replica'); },
    };
    const warn = vi.fn();
    await expect(backfillRetiredAccessLevels(stuck as any, { warn })).resolves.toEqual({ rules: 0, shares: 0 });
    expect(warn).toHaveBeenCalled();
    expect(engine._tables.sys_record_share[0].access_level).toBe('full');
  });
});

describe('#3929 follow-up — inert-rule warn dedup + boot aggregate', () => {
  it('warns ONCE per inert rule per process, and the boot pass emits one aggregate', async () => {
    const engine = makeEngine();
    const sharing = new SharingService({ engine: engine as any });
    const warn = vi.fn();
    const rules = new SharingRuleService({ engine: engine as any, sharing, logger: { warn } as any });

    engine._tables.sys_sharing_rule = [
      { id: 'r_legacy', name: 'legacy_match_all', object_name: 'showcase_inquiry', criteria: null, recipient_type: 'position', recipient_id: 'p1', access_level: 'read', active: true },
      { id: 'r_legacy2', name: 'legacy_match_all_2', object_name: 'showcase_inquiry', criteria: {}, recipient_type: 'position', recipient_id: 'p1', access_level: 'read', active: true },
    ];
    engine._tables.showcase_inquiry = [{ id: 'inq_1', status: 'new' }];

    // Repeated evaluations — the pre-dedup behavior warned on every one.
    await rules.evaluateRule('r_legacy', SYS);
    await rules.evaluateRule('r_legacy', SYS);
    await rules.evaluateRule('r_legacy2', SYS);
    await rules.evaluateRule('r_legacy', SYS);

    const perRule = warn.mock.calls.filter(([msg]) => String(msg).includes('no usable criteria'));
    expect(perRule).toHaveLength(2); // once per DISTINCT rule, not per pass
    expect(perRule.map(([, meta]) => (meta as any).rule).sort()).toEqual(['legacy_match_all', 'legacy_match_all_2']);

    // Enforcement unchanged on every pass: nothing granted, ever.
    expect(engine._tables.sys_record_share ?? []).toHaveLength(0);

    // The boot backfill walks the same rules and adds ONE aggregate line.
    const bootWarn = vi.fn();
    await backfillRuleGrants(rules, engine._tables.sys_sharing_rule, { warn: bootWarn });
    const agg = bootWarn.mock.calls.filter(([msg]) => String(msg).includes('matching NO records'));
    expect(agg).toHaveLength(1);
    expect((agg[0][1] as any).count).toBe(2);
    expect((agg[0][1] as any).rules.sort()).toEqual(['r_legacy', 'r_legacy2']);
    // …and the per-rule warns did NOT repeat during the backfill pass.
    expect(warn.mock.calls.filter(([msg]) => String(msg).includes('no usable criteria'))).toHaveLength(2);
  });
});
