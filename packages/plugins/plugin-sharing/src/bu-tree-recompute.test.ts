// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7729] Sharing-rule revocation on BUSINESS-UNIT GRAPH writes.
 *
 * The defect was timing, not resolution. Subtree expansion resolved correctly
 * through three levels and was symmetric on placement; what never happened was
 * the recompute. `bindRuleHooks` binds only on each rule's own `object_name`,
 * so the materialised `sys_record_share` grants moved only when the shared
 * RECORD was written. The QA matrix that filed this:
 *
 *   inSubtree=1, reparentedOut(no touch)=1, reparentedOut(touched)=0,
 *   restored(no touch)=0, restored(touched)=1
 *
 * The security column is `reparentedOut(no touch)=1` — after a business unit
 * is moved OUT of a shared subtree its members keep read access, indefinitely,
 * until somebody happens to write the shared record.
 *
 * These tests drive REAL `SharingService` / `SharingRuleService` instances over
 * an in-memory engine that dispatches hooks on write, so what is measured is
 * the whole path: BU write → hook → recipient re-expansion → grant diff. The
 * two `(no touch)` cells are asserted with a write log proving the shared
 * record was never touched.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/objectql';
import { SharingService } from './sharing-service.js';
import { SharingRuleService } from './sharing-rule-service.js';
import { ruleRegrantQueue } from './rule-hooks.js';
import {
  bindBusinessUnitTreeRecompute,
  unbindBusinessUnitTreeRecompute,
  writeCanChangeExpansion,
  BU_TREE_RECOMPUTE_PACKAGE,
  BU_TREE_RECIPIENT_TYPES,
  BU_GRAPH_OBJECTS,
} from './bu-tree-recompute.js';

interface Row { [k: string]: any }
type HookEntry = { event: string; handler: (ctx: any) => any; options: Row };

const SYS = { isSystem: true, positions: [], permissions: [] } as any;

/** The rule under test — the showcase geometry the QA run exercised. */
const RULE = 'share_new_inquiries_with_field_ops';

function matches(row: Row, f: any): boolean {
  if (!f || typeof f !== 'object') return true;
  // [#7676] A combinator is CONJOINED with its sibling field keys, never a
  // short-circuit that returns before they are read — the looseness #7760 had
  // to remove from `sharing-rule.test.ts`'s fake one commit before this one.
  // `listRules` composes `{object_name, active, $or:[…org scope…]}`, and a
  // matcher that returned on the `$or` alone would match the whole table here
  // while driver-sql and driver-memory conjoin the two.
  if (Array.isArray(f.$or) && !f.$or.some((x: any) => matches(row, x))) return false;
  if (Array.isArray(f.$and) && !f.$and.every((x: any) => matches(row, x))) return false;
  for (const [k, v] of Object.entries(f)) {
    if (k === '$or' || k === '$and') continue;
    const rv = row[k];
    if (v != null && typeof v === 'object' && !Array.isArray(v)) {
      const op: any = v;
      if ('$in' in op) { if (!op.$in.includes(rv)) return false; continue; }
      // `descendants()` filters children with `active: { $ne: false }`, so an
      // undefined `active` must PASS — the graph treats absent as active.
      if ('$ne' in op) { if (rv === op.$ne) return false; continue; }
      if ('$gte' in op) { if (!(rv >= op.$gte)) return false; continue; }
    }
    if (rv !== v) return false;
  }
  return true;
}

/**
 * In-memory engine that dispatches lifecycle hooks on every write, so the
 * hooks under test run exactly where they run in production.
 */
function makeEngine() {
  const tables: Record<string, Row[]> = {};
  const hooks: HookEntry[] = [];
  /** Every write, so a test can prove a record was NOT touched. */
  const writes: Array<{ op: string; object: string }> = [];
  const ensure = (n: string) => (tables[n] ??= []);

  async function dispatch(event: string, object: string, ctx: Row): Promise<void> {
    const applicable = hooks
      .filter((h) => {
        if (h.event !== event) return false;
        const o = h.options.object;
        return Array.isArray(o) ? o.includes(object) : o === object;
      })
      .sort((a, b) => (a.options.priority ?? 0) - (b.options.priority ?? 0));
    for (const h of applicable) await h.handler(ctx);
  }

  return {
    _tables: tables,
    _writes: writes,
    _hooks: hooks,
    getSchema() { return undefined; },
    registerHook(event: string, handler: (ctx: any) => any, options: Row = {}) {
      hooks.push({ event, handler, options });
    },
    unregisterHooksByPackage(packageId: string) {
      let removed = 0;
      for (let i = hooks.length - 1; i >= 0; i--) {
        if (hooks[i].options.packageId === packageId) { hooks.splice(i, 1); removed++; }
      }
      return removed;
    },
    boundFor(packageId: string) {
      return hooks.filter((h) => h.options.packageId === packageId);
    },
    /** Seed rows WITHOUT firing hooks — the boot-loader analog. */
    seed(object: string, rows: Row[]) { ensure(object).push(...rows.map((r) => ({ ...r }))); },
    async find(o: string, opts?: any) {
      const f = opts?.filter ?? opts?.where;
      return ensure(o).filter((r) => matches(r, f)).slice(0, opts?.limit ?? 10000);
    },
    async insert(o: string, data: any) {
      const row = { ...data };
      ensure(o).push(row);
      writes.push({ op: 'insert', object: o });
      await dispatch('afterInsert', o, { result: row, input: { data } });
      return row;
    },
    // Both write verbs open with the PRODUCER's own dispatch predicate
    // (#4550 / #5480 / #6277), never a hand-mirrored guard: a fixture that
    // drifts to a call shape `ObjectQL` would refuse fails loudly here instead
    // of collecting a green from gates that never ran.
    async update(o: string, data: any, options?: any) {
      const verdict = assertEngineUpdateDispatch(data, options);
      const t = ensure(o);
      const targets = verdict.kind === 'by-id'
        ? t.filter((r) => r.id === verdict.id)
        : t.filter((r) => matches(r, options?.where));
      for (const r of targets) Object.assign(r, data);
      writes.push({ op: 'update', object: o });
      for (const r of targets) {
        await dispatch('afterUpdate', o, { result: r, input: { id: r.id, data } });
      }
      return verdict.kind === 'by-id' ? (targets[0] ?? null) : targets.length;
    },
    async delete(o: string, opts?: any) {
      assertEngineDeleteDispatch(opts);
      const t = ensure(o);
      const where = opts?.where ?? {};
      for (let i = t.length - 1; i >= 0; i--) if (matches(t[i], where)) t.splice(i, 1);
      writes.push({ op: 'delete', object: o });
      await dispatch('afterDelete', o, { input: { id: opts?.id, options: opts } });
      return { ok: true };
    },
  };
}

describe('#7729 business-unit graph writes recompute BU-tree sharing rules', () => {
  let engine: ReturnType<typeof makeEngine>;
  let sharing: SharingService;
  let rules: SharingRuleService;

  /** How many `read` grants `userId` currently holds on `recordId`. */
  const grantsFor = (userId: string, recordId = 'inq_new'): number =>
    (engine._tables.sys_record_share ?? []).filter(
      (r) => r.recipient_id === userId && r.record_id === recordId && r.source === 'rule',
    ).length;

  /** Writes recorded against the SHARED RECORD's object — must stay at zero. */
  const sharedRecordWrites = (): number =>
    engine._writes.filter((w) => w.object === 'showcase_inquiry').length;

  beforeEach(async () => {
    engine = makeEngine();
    sharing = new SharingService({ engine: engine as any });
    rules = new SharingRuleService({ engine: engine as any, sharing });

    // Three-level BU tree, plus a sibling root to re-parent OUT into.
    engine.seed('sys_business_unit', [
      { id: 'bu_root', name: 'Root', parent_business_unit_id: null, active: true },
      { id: 'bu_field_ops', name: 'Field Ops', parent_business_unit_id: 'bu_root', active: true },
      { id: 'bu_west', name: 'West', parent_business_unit_id: 'bu_field_ops', active: true },
      { id: 'bu_outside', name: 'Outside', parent_business_unit_id: 'bu_root', active: true },
    ]);
    // The seed-data-thin trap #7729 records: a fresh boot seeds the tree and
    // ZERO member rows, so a fixture that does not place someone explicitly
    // measures nothing at all. `priya` sits at the THIRD level.
    engine.seed('sys_business_unit_member', [
      { id: 'bum_priya', business_unit_id: 'bu_west', user_id: 'priya', is_primary: true },
    ]);
    engine.seed('showcase_inquiry', [
      { id: 'inq_new', status: 'new', owner_id: 'wes' },
      { id: 'inq_won', status: 'won', owner_id: 'wes' },
    ]);
    engine.seed('sys_sharing_rule', [{
      id: 'srule_field_ops',
      organization_id: null,
      name: RULE,
      label: 'New inquiries → Field Ops subtree',
      object_name: 'showcase_inquiry',
      criteria_json: JSON.stringify({ status: 'new' }),
      recipient_type: 'unit_and_subordinates',
      recipient_id: 'bu_field_ops',
      access_level: 'read',
      active: true,
      managed_by: 'package',
    }]);

    bindBusinessUnitTreeRecompute(engine as any, rules, undefined);

    // Boot-backfill analog: materialise the rule once, the way
    // `kernel:bootstrapped` does. This is the matrix's `inSubtree` cell.
    await rules.evaluateRule(RULE, SYS);
    engine._writes.length = 0; // only writes AFTER setup are interesting
  });

  /**
   * Release for the queue gate the security pin installs.
   *
   * Held HERE rather than inside that test, because the queue is module-scoped
   * and shared by every test in this file: a gate left shut by a FAILING
   * assertion blocks the chain forever, and every later test then dies in
   * `whenIdle()` with a timeout. Measured during this fix's own ablation — the
   * one clear assertion failure arrived as 15 timeouts, most of them in tests
   * the ablation should not have touched at all. Releasing unconditionally
   * here keeps a real regression legible as the one test it actually is.
   */
  let releaseGate: (() => void) | null = null;

  afterEach(async () => {
    releaseGate?.();
    releaseGate = null;
    // The re-grant queue is module-scoped; never leak a pending pass.
    await ruleRegrantQueue.whenIdle();
  });

  it('inSubtree=1 — a member three levels down inside the shared subtree reads the record', () => {
    expect(grantsFor('priya')).toBe(1);
    expect(grantsFor('priya', 'inq_won')).toBe(0); // criteria still bounds it
  });

  it(
    'SECURITY PIN — a BU re-parented OUT loses its members access with NO write to the shared record, '
      + 'and before the write returns',
    async () => {
      // Block the asynchronous re-grant queue so nothing it does can be
      // mistaken for the synchronous revoke. If the grant is gone while this
      // gate is shut, the revocation happened on the write path.
      const gate = new Promise<void>((r) => { releaseGate = r; });
      ruleRegrantQueue.enqueue(() => gate);

      await engine.update('sys_business_unit', {
        id: 'bu_west',
        parent_business_unit_id: 'bu_outside',
      });

      expect(grantsFor('priya')).toBe(0);       // was 1 before this fix
      expect(sharedRecordWrites()).toBe(0);     // …and nobody touched the record

      releaseGate!();
      releaseGate = null;
      await ruleRegrantQueue.whenIdle();
      expect(grantsFor('priya')).toBe(0);       // still 0 once the queue drains
    },
  );

  it('restored(no touch)=1 — re-parenting the BU back IN re-grants without touching the record', async () => {
    await engine.update('sys_business_unit', { id: 'bu_west', parent_business_unit_id: 'bu_outside' });
    expect(grantsFor('priya')).toBe(0);

    await engine.update('sys_business_unit', { id: 'bu_west', parent_business_unit_id: 'bu_field_ops' });
    await ruleRegrantQueue.whenIdle();

    expect(grantsFor('priya')).toBe(1);         // was 0 before this fix
    expect(sharedRecordWrites()).toBe(0);
  });

  it('deactivating a BU in the middle of the subtree revokes the descendants below it', async () => {
    await engine.update('sys_business_unit', { id: 'bu_west', active: false });
    expect(grantsFor('priya')).toBe(0);
    expect(sharedRecordWrites()).toBe(0);

    await engine.update('sys_business_unit', { id: 'bu_west', active: true });
    await ruleRegrantQueue.whenIdle();
    expect(grantsFor('priya')).toBe(1);
  });

  it('deleting a BU out of the subtree revokes its members', async () => {
    await engine.delete('sys_business_unit', { where: { id: 'bu_west' }, multi: true });
    expect(grantsFor('priya')).toBe(0);
    expect(sharedRecordWrites()).toBe(0);
  });

  it('membership REMOVE revokes, membership ADD re-grants — both without touching the record', async () => {
    await engine.delete('sys_business_unit_member', { where: { id: 'bum_priya' }, multi: true });
    expect(grantsFor('priya')).toBe(0);
    expect(sharedRecordWrites()).toBe(0);

    await engine.insert('sys_business_unit_member', {
      id: 'bum_priya2', business_unit_id: 'bu_west', user_id: 'priya',
    });
    await ruleRegrantQueue.whenIdle();
    expect(grantsFor('priya')).toBe(1);
    expect(sharedRecordWrites()).toBe(0);
  });

  it('moving a member between units inside the same subtree keeps access', async () => {
    await engine.update('sys_business_unit_member', {
      id: 'bum_priya', business_unit_id: 'bu_field_ops',
    });
    await ruleRegrantQueue.whenIdle();
    expect(grantsFor('priya')).toBe(1);
  });

  it('moving a member OUT of the subtree entirely revokes, synchronously', async () => {
    await engine.update('sys_business_unit_member', {
      id: 'bum_priya', business_unit_id: 'bu_outside',
    });
    expect(grantsFor('priya')).toBe(0);
    await ruleRegrantQueue.whenIdle();
    expect(grantsFor('priya')).toBe(0);
  });

  it('covers `business_unit` recipients too — today they walk the same subtree resolver', async () => {
    engine._tables.sys_sharing_rule[0].recipient_type = 'business_unit';
    engine._tables.sys_sharing_rule[0].recipient_id = 'bu_west';
    await rules.evaluateRule(RULE, SYS);
    expect(grantsFor('priya')).toBe(1);

    await engine.update('sys_business_unit_member', { id: 'bum_priya', business_unit_id: 'bu_outside' });
    expect(grantsFor('priya')).toBe(0);
  });
});

describe('#7729 non-regression — rules that do not read the BU tree are left alone', () => {
  let engine: ReturnType<typeof makeEngine>;
  let rules: SharingRuleService;
  let revokeSpy: ReturnType<typeof vi.spyOn>;
  let evaluateSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    engine = makeEngine();
    const sharing = new SharingService({ engine: engine as any });
    rules = new SharingRuleService({ engine: engine as any, sharing });
    engine.seed('sys_business_unit', [
      { id: 'bu_root', name: 'Root', parent_business_unit_id: null, active: true },
      { id: 'bu_west', name: 'West', parent_business_unit_id: 'bu_root', active: true },
    ]);
    revokeSpy = vi.spyOn(rules, 'revokeRuleGrantsForRetiredRecipients');
    evaluateSpy = vi.spyOn(rules, 'evaluateRule');
    bindBusinessUnitTreeRecompute(engine as any, rules, undefined);
  });

  afterEach(async () => {
    await ruleRegrantQueue.whenIdle();
    vi.restoreAllMocks();
  });

  const seedRule = (id: string, recipient_type: string, recipient_id: string) => {
    engine.seed('sys_sharing_rule', [{
      id, organization_id: null, name: id, label: id,
      object_name: 'showcase_inquiry', criteria_json: JSON.stringify({ status: 'new' }),
      recipient_type, recipient_id, access_level: 'read', active: true,
    }]);
  };

  it('a `user` / `team` / `position` / `queue` rule is never recomputed by a BU write', async () => {
    seedRule('srule_user', 'user', 'priya');
    seedRule('srule_team', 'team', 'team_sales');
    seedRule('srule_position', 'position', 'sales_rep');
    seedRule('srule_queue', 'queue', 'q_triage');

    await engine.update('sys_business_unit', { id: 'bu_west', parent_business_unit_id: null });
    await ruleRegrantQueue.whenIdle();

    // Not "recomputed more cheaply" — not recomputed AT ALL. A fix that
    // reconciled everything on every BU write would pass the security pin
    // above and wreck the system.
    expect(revokeSpy).not.toHaveBeenCalled();
    expect(evaluateSpy).not.toHaveBeenCalled();
  });

  it('recomputes exactly the BU-tree rules when both kinds are present', async () => {
    seedRule('srule_user', 'user', 'priya');
    seedRule('srule_bu', 'unit_and_subordinates', 'bu_root');

    await engine.update('sys_business_unit', { id: 'bu_west', parent_business_unit_id: null });
    await ruleRegrantQueue.whenIdle();

    expect(revokeSpy.mock.calls.map((c) => (c[0] as any).id)).toEqual(['srule_bu']);
    expect(evaluateSpy.mock.calls.map((c) => c[0])).toEqual(['srule_bu']);
  });

  it('an INACTIVE BU-tree rule is not woken by a BU write (that axis is #4433s)', async () => {
    engine.seed('sys_sharing_rule', [{
      id: 'srule_off', organization_id: null, name: 'srule_off', label: 'off',
      object_name: 'showcase_inquiry', criteria_json: JSON.stringify({ status: 'new' }),
      recipient_type: 'unit_and_subordinates', recipient_id: 'bu_root',
      access_level: 'read', active: false,
    }]);
    await engine.update('sys_business_unit', { id: 'bu_west', parent_business_unit_id: null });
    await ruleRegrantQueue.whenIdle();
    expect(revokeSpy).not.toHaveBeenCalled();
  });

  it('a BU update that cannot move the expansion (a rename) skips the recompute entirely', async () => {
    seedRule('srule_bu', 'unit_and_subordinates', 'bu_root');
    await engine.update('sys_business_unit', { id: 'bu_west', name: 'Western Region' });
    await ruleRegrantQueue.whenIdle();
    expect(revokeSpy).not.toHaveBeenCalled();
    expect(evaluateSpy).not.toHaveBeenCalled();
  });

  it('an `is_primary` flip on a member row skips it too — that column drives the projection, not sharing', async () => {
    seedRule('srule_bu', 'unit_and_subordinates', 'bu_root');
    // The row must EXIST, or the hook never dispatches and this passes for the
    // wrong reason — a phantom check of the narrowing rather than a check.
    engine.seed('sys_business_unit_member', [
      { id: 'bum_x', business_unit_id: 'bu_west', user_id: 'priya', is_primary: true },
    ]);
    await engine.update('sys_business_unit_member', { id: 'bum_x', is_primary: false });
    await ruleRegrantQueue.whenIdle();
    expect(revokeSpy).not.toHaveBeenCalled();
  });
});

describe('#7729 binding + recipient-kind audit', () => {
  it('binds afterInsert/afterUpdate/afterDelete on BOTH business-unit tables', () => {
    const engine = makeEngine();
    bindBusinessUnitTreeRecompute(engine as any, {
      listRules: async () => [],
      revokeRuleGrantsForRetiredRecipients: async () => 0,
      evaluateRule: async () => undefined,
    }, undefined);

    const bound = engine.boundFor(BU_TREE_RECOMPUTE_PACKAGE);
    expect(bound).toHaveLength(6);
    for (const object of BU_GRAPH_OBJECTS) {
      expect(bound.filter((h) => h.options.object === object).map((h) => h.event).sort())
        .toEqual(['afterDelete', 'afterInsert', 'afterUpdate']);
    }
    expect(unbindBusinessUnitTreeRecompute(engine as any)).toBe(6);
    expect(engine.boundFor(BU_TREE_RECOMPUTE_PACKAGE)).toHaveLength(0);
  });

  it('binds under its OWN package id so a rule rebind cannot tear it down', () => {
    const engine = makeEngine();
    bindBusinessUnitTreeRecompute(engine as any, {
      listRules: async () => [],
      revokeRuleGrantsForRetiredRecipients: async () => 0,
      evaluateRule: async () => undefined,
    }, undefined);
    // What `unbindAllRuleHooks` removes.
    engine.unregisterHooksByPackage('plugin-sharing:rules');
    expect(engine.boundFor(BU_TREE_RECOMPUTE_PACKAGE)).toHaveLength(6);
  });

  it(
    'pins the audited recipient kinds — exactly the two whose expansion reads the BU graph',
    () => {
      // Measured against `SharingRuleService.expandRecipient`: `user` is a
      // literal id, `team` reads sys_team_member/sys_member/sys_user,
      // `position` reads sys_user_position/sys_member, `queue` returns [].
      expect([...BU_TREE_RECIPIENT_TYPES].sort()).toEqual(['business_unit', 'unit_and_subordinates']);
    },
  );

  it('treats an unreadable update payload as "might have changed" rather than "did not"', () => {
    expect(writeCanChangeExpansion('sys_business_unit', 'afterUpdate', {})).toBe(true);
    expect(writeCanChangeExpansion('sys_business_unit', 'afterUpdate', { input: { data: 'nope' } })).toBe(true);
    expect(writeCanChangeExpansion('sys_business_unit', 'afterInsert', { input: { data: { name: 'x' } } })).toBe(true);
    expect(writeCanChangeExpansion('sys_business_unit', 'afterDelete', { input: { data: { name: 'x' } } })).toBe(true);
    expect(writeCanChangeExpansion('sys_business_unit', 'afterUpdate', { input: { data: { name: 'x' } } })).toBe(false);
    expect(
      writeCanChangeExpansion('sys_business_unit', 'afterUpdate', { input: { data: { parent_business_unit_id: 'b' } } }),
    ).toBe(true);
    expect(
      writeCanChangeExpansion('sys_business_unit_member', 'afterUpdate', { input: { data: { user_id: 'u' } } }),
    ).toBe(true);
  });
});
