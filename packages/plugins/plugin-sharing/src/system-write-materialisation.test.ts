// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#13533] A system write materialises sharing grants, exactly as a user write
 * does.
 *
 * ## This file is the REVERSAL of `system-write-skip-notice.test.ts` (#6783)
 *
 * It is renamed rather than deleted, and every expectation the old file held is
 * registered below with its new counterpart, because the old file was not
 * wrong: it pinned a real, maintainer-ruled behaviour (#4707 demand 3,
 * 2026-08-06 — an `isSystem` write batch that materialises zero grants says so,
 * once). A later ruling reversed the behaviour it pinned, so its pins invert;
 * silently dropping them would leave no record that the reversal happened.
 *
 * Maintainer ruling 2026-08-31 (verbatim, untranslated):
 *
 *   裁定:系统写参与逐记录共享物化 —— 删除 `plugin-sharing` 两个钩子里的
 *   `isSystem` 跳过,⛔ 不加声明式开关、不以文档代修。
 *
 * ### The reversal register — old pin, new pin
 *
 * | #6783 expectation (was) | #13533 expectation (is) |
 * |---|---|
 * | a system INSERT into the criteria grants nothing, and logs the notice once | it materialises the grant; there is no notice, and no notice constant to import |
 * | a batch of N system inserts grants nothing, one line for the batch | every row that matches is materialised |
 * | a system UPDATE into the criteria grants nothing, same one line | it materialises — this is the approval write-back, the specimen of the card |
 * | the notice is INFO, never warn/error | no line at any level is owed for a materialising write |
 * | the latch is per object, and re-arms on rebind | retired with the latch |
 * | the notice survives a throwing log sink | retired with the notice |
 * | a NON-system write materialises normally | UNCHANGED — kept below as the control that this change widened the population without moving the user path |
 * | an active rule that legitimately matches nothing grants nothing | UNCHANGED — kept below as the over-materialisation control, now driven by a SYSTEM write |
 * | an object whose only rule is inactive binds no hooks | UNCHANGED |
 * | an `isSystem` DELETE is silent, because the notice's remedy cannot repair it | UNCHANGED in behaviour: `afterDelete` still skips system writes, on the separate ground that `record-share-cascade.ts` owns that payload |
 * | the notice text is the maintainer's wording, verbatim | retired with the notice |
 *
 * ## What acceptance looks like, and why a grant row alone is not it
 *
 * The card's reproduction constraint is binding (triage, 2026-08-31): the defect
 * is observable ONLY to a principal WITHOUT `viewAllRecords` who depends on the
 * sharing rule. A manager or admin reads through the profile path, never through
 * the rule, and sees the record either way — "the manager sees it" is true and
 * is NOT a counter-proof. So the acceptance pins here end at
 * `SharingService.buildReadFilter` for a plain member context, and then run that
 * filter against the table: the assertion is that the teammate can now SEE the
 * record, not merely that a row appeared in `sys_record_share`.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/objectql';
import { SharingService } from './sharing-service.js';
import { SharingRuleService } from './sharing-rule-service.js';
import {
  bindRuleHooks,
  unbindAllRuleHooks,
  SHARING_RULE_HOOK_PACKAGE,
} from './rule-hooks.js';

interface Row { [k: string]: any }

const SYS = { isSystem: true, positions: [], permissions: [] } as any;
/** What a seed run / package install / internal importer sends. */
const SYSTEM_SESSION = { isSystem: true };
/** What an interactive admin sends. */
const ADMIN_SESSION = { isSystem: false, userId: 'admin' };
/**
 * What the approval write-back sends. `plugin-approvals`
 * (`approval-service.ts` `mirrorStatusField`) writes the decision onto the
 * subject record as `{ ...SYSTEM_CTX, userId: actorId }` — elevated, because a
 * `lockRecord: true` node means only a platform write can land while the record
 * is locked, but still carrying WHO decided so downstream cascades keep an
 * identity. Both halves matter here: it is a system write, and it is a
 * single-id write.
 */
const APPROVAL_WRITEBACK_SESSION = { isSystem: true, userId: 'manager' };

type HookEntry = { event: string; handler: (ctx: any) => any; options: Row };

/**
 * A fake ObjectQL engine, pinned to the real engine's write dispatch on both
 * destructive verbs (#4550 / #5480) so a double looser than the thing it
 * replaces cannot turn this suite green on calls production refuses.
 */
function makeEngine() {
  const tables: Record<string, Row[]> = {};
  const schemas: Record<string, Row> = {};
  const hooks: HookEntry[] = [];
  const ensure = (n: string) => (tables[n] ??= []);
  /** Every `find` this suite drove, so the census pin can count reads. */
  const finds: string[] = [];

  function matches(row: Row, f: any): boolean {
    if (!f || typeof f !== 'object') return true;
    // `$or` / `$and` are conjoined WITH their sibling keys, the way a real
    // driver ANDs them — a short-circuiting `return` here would discard every
    // sibling equality key in the same object. See #7620.
    if (Array.isArray(f.$or) && !f.$or.some((x: any) => matches(row, x))) return false;
    if (Array.isArray(f.$and) && !f.$and.every((x: any) => matches(row, x))) return false;
    for (const [k, v] of Object.entries(f)) {
      if (k === '$or' || k === '$and') continue;
      const rv = row[k];
      if (v != null && typeof v === 'object' && '$in' in (v as any)) {
        if (!(v as any).$in.includes(rv)) return false;
        continue;
      }
      if (rv !== v) return false;
    }
    return true;
  }

  const engine = {
    _tables: tables,
    _schemas: schemas,
    _finds: finds,
    getSchema(name: string) { return schemas[name]; },
    async find(o: string, opts?: any) {
      finds.push(o);
      const f = opts?.filter ?? opts?.where;
      return ensure(o).filter((r) => matches(r, f)).slice(0, opts?.limit ?? 10000);
    },
    async insert(o: string, data: any) { const row = { ...data }; ensure(o).push(row); return row; },
    async update(o: string, data: any, options?: any) {
      // Pinned to `ObjectQL.update`'s dispatch (#5480): a scalar `data.id`
      // outranks `where`/`multi`, and a predicate update without `multi` is
      // the shape a real server refuses.
      assertEngineUpdateDispatch(data, options);
      const t = ensure(o); const i = t.findIndex((r) => r.id === data?.id);
      if (i >= 0) t[i] = { ...t[i], ...data };
      return t[i];
    },
    async delete(o: string, opts?: any) {
      // Pinned to `ObjectQL.delete`'s dispatch (#4434 / #4550).
      assertEngineDeleteDispatch(opts);
      const t = ensure(o); const where = opts?.where ?? {};
      for (let i = t.length - 1; i >= 0; i--) if (matches(t[i], where)) t.splice(i, 1);
      return { ok: true };
    },
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
    boundFor(packageId: string) { return hooks.filter((h) => h.options.packageId === packageId); },

    async fire(event: string, object: string, ctx: any) {
      for (const h of [...hooks]) {
        if (h.event === event && h.options.object === object) await h.handler(ctx);
      }
    },

    /** One row insert, fired the way the engine fires `afterInsert`. */
    async simulateInsert(object: string, row: Row, session: any = ADMIN_SESSION) {
      ensure(object).push({ ...row });
      await engine.fire('afterInsert', object, {
        object, event: 'afterInsert', input: { data: row }, result: row, session,
      });
    },

    /** `count` rows in one pass — a seed batch, one hook fire per row. */
    async simulateInsertBatch(object: string, rows: Row[], session: any = SYSTEM_SESSION) {
      for (const row of rows) await engine.simulateInsert(object, row, session);
    },

    /**
     * A SINGLE-ID update — the approval write-back's shape, and the shape the
     * `before` stash resolves without querying (`resolveAffectedRows` step 1).
     */
    async simulateUpdate(object: string, id: string, data: Row, session: any = ADMIN_SESSION) {
      const ctx: any = {
        object, event: 'beforeUpdate',
        input: { id, data: { ...data, id }, options: {} },
        session,
      };
      await engine.fire('beforeUpdate', object, ctx);
      const t = ensure(object);
      const i = t.findIndex((r) => r.id === id);
      if (i >= 0) t[i] = { ...t[i], ...data };
      ctx.event = 'afterUpdate';
      await engine.fire('afterUpdate', object, ctx);
    },

    /** A predicate update: no `input.id`, one shared ctx across before/after. */
    async simulateBulkUpdate(object: string, where: any, data: Row, session: any = ADMIN_SESSION) {
      const ctx: any = {
        object, event: 'beforeUpdate',
        input: { id: undefined, data, options: { where, multi: true } },
        session,
      };
      await engine.fire('beforeUpdate', object, ctx);
      const t = ensure(object);
      for (let i = 0; i < t.length; i++) {
        if (where != null && !matches(t[i], where)) continue;
        t[i] = { ...t[i], ...data };
      }
      ctx.event = 'afterUpdate';
      await engine.fire('afterUpdate', object, ctx);
    },

    async simulateBulkDelete(object: string, where: any, session: any = ADMIN_SESSION) {
      const ctx: any = {
        object, event: 'beforeDelete',
        input: { id: undefined, options: { where, multi: true } },
        session,
      };
      await engine.fire('beforeDelete', object, ctx);
      const t = ensure(object);
      for (let i = t.length - 1; i >= 0; i--) if (matches(t[i], where)) t.splice(i, 1);
      ctx.event = 'afterDelete';
      await engine.fire('afterDelete', object, ctx);
    },
  };
  return engine;
}

type Engine = ReturnType<typeof makeEngine>;

/** Every `sys_record_share` row a rule materialised. */
const ruleShares = (engine: Engine) =>
  (engine._tables.sys_record_share ?? []).filter((r) => r.source === 'rule');

const rule = (over: Row = {}): Row => ({
  id: 'srule_east',
  name: 'east_to_alice',
  label: 'East → Alice',
  object_name: 'opportunity',
  criteria_json: JSON.stringify({ region: 'east' }),
  recipient_type: 'user',
  recipient_id: 'alice',
  access_level: 'edit',
  active: true,
  ...over,
});

describe('#13533 a system write materialises sharing grants', () => {
  let engine: Engine;
  let rules: SharingRuleService;
  let logger: any;

  /** Bind the hooks against whatever is currently in `sys_sharing_rule`. */
  const bind = async () => {
    const ruleRows = await rules.listRules({ activeOnly: true }, SYS);
    unbindAllRuleHooks(engine as any);
    bindRuleHooks(engine as any, rules, ruleRows, logger);
  };

  beforeEach(async () => {
    logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    engine = makeEngine();
    engine._tables.opportunity = [];
    engine._tables.sys_record_share = [];
    engine._tables.sys_sharing_rule = [rule()];
    const sharing = new SharingService({ engine: engine as any });
    rules = new SharingRuleService({ engine: engine as any, sharing, logger });
    await bind();
  });

  // ── the reversal: what the #6783 pins asserted, inverted ──────────────

  it('a system INSERT into the criteria materialises the grant (was: skipped, and logged once)', async () => {
    await engine.simulateInsert('opportunity', { id: 'opp0', region: 'east', owner_id: 'boss' }, SYSTEM_SESSION);

    expect(ruleShares(engine).map((r) => r.record_id)).toEqual(['opp0']);
    expect(ruleShares(engine).map((r) => r.recipient_id)).toEqual(['alice']);
  });

  it('a BATCH of system inserts materialises every matching row (was: zero grants, one line)', async () => {
    await engine.simulateInsertBatch('opportunity', [
      { id: 'opp0', region: 'east', owner_id: 'boss' },
      { id: 'opp1', region: 'east', owner_id: 'boss' },
      { id: 'opp2', region: 'west', owner_id: 'boss' },
      { id: 'opp3', region: 'east', owner_id: 'boss' },
    ]);

    expect(engine._tables.opportunity).toHaveLength(4);
    // `opp2` is `west`: outside the criteria, so it is correctly ungranted.
    expect(ruleShares(engine).map((r) => r.record_id).sort()).toEqual(['opp0', 'opp1', 'opp3']);
  });

  it('a system bulk UPDATE into the criteria materialises (was: skipped, same one line)', async () => {
    await engine.simulateInsertBatch('opportunity', [
      { id: 'opp0', region: 'west', owner_id: 'boss' },
      { id: 'opp1', region: 'west', owner_id: 'boss' },
    ]);
    expect(ruleShares(engine)).toEqual([]);

    await engine.simulateBulkUpdate('opportunity', { region: 'west' }, { region: 'east' }, SYSTEM_SESSION);

    expect(ruleShares(engine).map((r) => r.record_id).sort()).toEqual(['opp0', 'opp1']);
  });

  it('a system bulk update OUT of the criteria revokes — the diff runs in both directions', async () => {
    await engine.simulateInsert('opportunity', { id: 'opp0', region: 'east', owner_id: 'boss' }, SYSTEM_SESSION);
    expect(ruleShares(engine)).toHaveLength(1);

    await engine.simulateBulkUpdate('opportunity', { region: 'east' }, { region: 'west' }, SYSTEM_SESSION);

    expect(ruleShares(engine)).toEqual([]);
  });

  it('says nothing at any level about a materialising system write (was: one INFO notice)', async () => {
    await engine.simulateInsert('opportunity', { id: 'opp0', region: 'east', owner_id: 'boss' }, SYSTEM_SESSION);

    for (const level of ['info', 'warn', 'error'] as const) {
      expect(
        logger[level].mock.calls.filter((c: any[]) => String(c[0]).includes('materialisation skipped')),
      ).toEqual([]);
    }
    // …and specifically not the retired wording, whichever sink it reached.
    for (const level of ['info', 'warn', 'error'] as const) {
      expect(
        logger[level].mock.calls.filter((c: any[]) => String(c[0]).includes('restart to backfill')),
      ).toEqual([]);
    }
  });

  // ── the acceptance anchor: the card's own reproduction, in a unit ─────

  describe('the approval write-back, observed from a member WITHOUT viewAllRecords', () => {
    /**
     * The card's minimal path: an object whose `status` an approval node
     * mirrors, a criteria rule `status == "approved"` naming a teammate, and a
     * record owned by somebody else.
     */
    const REP2 = { userId: 'rep2' } as any;
    let sharing: SharingService;

    beforeEach(async () => {
      engine._tables.crm_leave_request = [];
      engine._schemas.crm_leave_request = {
        name: 'crm_leave_request',
        sharingModel: 'private',
        fields: { owner_id: {}, status: {} },
      };
      engine._tables.sys_sharing_rule = [rule({
        id: 'srule_leave_approved',
        name: 'leave_request_approved_team_sharing_sales_rep',
        object_name: 'crm_leave_request',
        criteria_json: JSON.stringify({ status: 'approved' }),
        recipient_type: 'user',
        recipient_id: 'rep2',
        access_level: 'read',
      })];
      sharing = new SharingService({ engine: engine as any });
      rules = new SharingRuleService({ engine: engine as any, sharing, logger });
      await bind();

      // rep1 submits; the record starts `pending` and is owned by rep1.
      await engine.simulateInsert(
        'crm_leave_request',
        { id: 'lr1', status: 'pending', owner_id: 'rep1' },
        { isSystem: false, userId: 'rep1' },
      );
    });

    /** Does rep2's OWN read path admit `lr1`? */
    const rep2CanSee = async (): Promise<boolean> => {
      const filter = await sharing.buildReadFilter('crm_leave_request', REP2);
      // A member context must never bypass — if it did, this whole assertion
      // would be vacuous and would pass with the defect still present.
      expect(filter).not.toBeNull();
      const visible = await engine.find('crm_leave_request', { where: filter });
      return visible.some((r: any) => r.id === 'lr1');
    };

    it('cannot see a teammate PENDING record — the baseline the defect hid behind', async () => {
      expect(await rep2CanSee()).toBe(false);
      // Not because sharing is off: rep2 is simply not the owner and the rule's
      // criteria is not satisfied yet.
      expect(await sharing.buildReadFilter('crm_leave_request', REP2)).toEqual({ owner_id: 'rep2' });
    });

    it('SEES it the moment the approval write-back lands — no evaluate, no restart', async () => {
      await engine.simulateUpdate(
        'crm_leave_request', 'lr1', { status: 'approved' }, APPROVAL_WRITEBACK_SESSION,
      );

      expect(ruleShares(engine).map((r) => [r.record_id, r.recipient_id])).toEqual([['lr1', 'rep2']]);
      expect(await rep2CanSee()).toBe(true);
      // The grant is what widened the filter — the owner match is still there,
      // so this is additive access, not a scope escalation.
      expect(await sharing.buildReadFilter('crm_leave_request', REP2)).toEqual({
        $or: [{ owner_id: 'rep2' }, { id: { $in: ['lr1'] } }],
      });
    });

    it('the approver keeps seeing it either way — a manager view CANNOT observe this defect', async () => {
      // Triage's binding note, pinned so a future reader cannot re-derive the
      // wrong acceptance: a principal that bypasses sharing reads the record
      // before AND after the write-back, so verifying the fix from a manager or
      // admin perspective proves nothing at all.
      const MANAGER = { isSystem: false, userId: 'manager', __readScope: 'org' } as any;
      expect(await sharing.buildReadFilter('crm_leave_request', MANAGER)).toBeNull();

      await engine.simulateUpdate(
        'crm_leave_request', 'lr1', { status: 'approved' }, APPROVAL_WRITEBACK_SESSION,
      );

      expect(await sharing.buildReadFilter('crm_leave_request', MANAGER)).toBeNull();
    });

    it('a system write that does NOT satisfy the criteria grants nothing (over-materialisation control)', async () => {
      await engine.simulateUpdate(
        'crm_leave_request', 'lr1', { status: 'rejected' }, APPROVAL_WRITEBACK_SESSION,
      );

      expect(ruleShares(engine)).toEqual([]);
      expect(await rep2CanSee()).toBe(false);
    });

    it('a later system write out of the criteria revokes again — a recall takes the access back', async () => {
      await engine.simulateUpdate(
        'crm_leave_request', 'lr1', { status: 'approved' }, APPROVAL_WRITEBACK_SESSION,
      );
      expect(await rep2CanSee()).toBe(true);

      await engine.simulateUpdate(
        'crm_leave_request', 'lr1', { status: 'recalled' }, APPROVAL_WRITEBACK_SESSION,
      );

      expect(ruleShares(engine)).toEqual([]);
      expect(await rep2CanSee()).toBe(false);
    });

    it('takes the BOUNDED per-record branch, never the object-wide revoke', async () => {
      // The `before*` stash skip (`rule-hooks.ts`, removed with the other two)
      // was load-bearing here: with no stash, `readAffectedRows` answers
      // `unbounded`, and a single approval would have revoked every rule grant
      // on the object and re-granted asynchronously. That branch announces
      // itself with a `warn`; this pin is that the warn never fires.
      await engine.simulateUpdate(
        'crm_leave_request', 'lr1', { status: 'approved' }, APPROVAL_WRITEBACK_SESSION,
      );

      expect(
        logger.warn.mock.calls.filter((c: any[]) => String(c[0]).includes('more rows than can be recomputed')),
      ).toEqual([]);
    });
  });

  // ── the controls the #6783 file already carried, kept unchanged ───────

  it('a NON-system write still materialises — the user path did not move', async () => {
    await engine.simulateInsert('opportunity', { id: 'opp0', region: 'east', owner_id: 'boss' }, ADMIN_SESSION);

    expect(ruleShares(engine).map((r) => r.record_id)).toEqual(['opp0']);
  });

  it('an active rule that legitimately matches nothing still grants nothing', async () => {
    // `west` is outside the criteria. Driven by a SYSTEM write now, which is
    // the half that used to be untestable: the skip made every system write
    // look identical to a legitimate non-match.
    await engine.simulateInsert('opportunity', { id: 'opp0', region: 'west', owner_id: 'boss' }, SYSTEM_SESSION);

    expect(ruleShares(engine)).toEqual([]);
  });

  it("an object whose only rule is inactive binds no hooks, so a system write is a no-op", async () => {
    engine._tables.sys_sharing_rule = [rule({ active: false })];
    await bind();

    expect(engine.boundFor(SHARING_RULE_HOOK_PACKAGE)).toEqual([]);
    await engine.simulateInsert('opportunity', { id: 'opp0', region: 'east' }, SYSTEM_SESSION);

    expect(ruleShares(engine)).toEqual([]);
  });

  it('a system write on an object NO active rule covers is a no-op', async () => {
    engine._tables.invoice = [];
    await engine.simulateInsert('invoice', { id: 'inv0', region: 'east' }, SYSTEM_SESSION);

    expect(ruleShares(engine)).toEqual([]);
  });

  it('an isSystem DELETE is still skipped here — that payload belongs to the cascade', async () => {
    // UNCHANGED by #13533, and deliberately so. What a delete skips is
    // REVOCATION, which `record-share-cascade.ts` delivers on every
    // sharing-capable object (stashing for system writes on its own account,
    // #5103) with the boot orphan sweep behind it. Removing this skip would
    // double-revoke and would let the rule-only "revoke the object, re-grant
    // later" trade run on a payload the cascade must never make it on.
    await engine.simulateInsert('opportunity', { id: 'opp0', region: 'east', owner_id: 'boss' }, ADMIN_SESSION);
    expect(ruleShares(engine)).toHaveLength(1);

    await engine.simulateBulkDelete('opportunity', { region: 'east' }, SYSTEM_SESSION);

    // Still one rule grant: this subscriber did nothing, exactly as before.
    expect(ruleShares(engine)).toHaveLength(1);
  });
});

/**
 * [#13533] The bulk-path census, as an executable measurement.
 *
 * The ruling required the bulk paths to be measured before disposal, and
 * forbade keeping the skip on unmeasured performance fear. What the removal
 * costs a bulk system write is the same per-record pass a bulk USER write has
 * always paid, so the number this pins is a comparison, not an absolute: the
 * two populations do the same work per row. A future change that makes system
 * writes cheaper OR more expensive than user writes moves this pin.
 */
describe('#13533 census: a system write costs exactly what the same user write costs', () => {
  let engine: Engine;
  let rules: SharingRuleService;

  const rows = (n: number): Row[] =>
    Array.from({ length: n }, (_, i) => ({ id: `opp${i}`, region: 'east', owner_id: 'boss' }));

  const seedCost = async (session: any, n: number): Promise<number> => {
    engine = makeEngine();
    engine._tables.opportunity = [];
    engine._tables.sys_record_share = [];
    engine._tables.sys_sharing_rule = [rule()];
    const sharing = new SharingService({ engine: engine as any });
    rules = new SharingRuleService({ engine: engine as any, sharing, logger: undefined });
    const ruleRows = await rules.listRules({ activeOnly: true }, SYS);
    unbindAllRuleHooks(engine as any);
    bindRuleHooks(engine as any, rules, ruleRows, { warn: () => {} } as any);
    engine._finds.length = 0;
    await engine.simulateInsertBatch('opportunity', rows(n), session);
    return engine._finds.length;
  };

  it('a 25-row system insert batch reads exactly what a 25-row admin batch reads', async () => {
    const asSystem = await seedCost(SYSTEM_SESSION, 25);
    const asAdmin = await seedCost(ADMIN_SESSION, 25);

    expect(asSystem).toBe(asAdmin);
    // And it is per-record, linear in the batch — the shape the ruling asked to
    // be measured. (Before the fix the system number was 0 and the grants were
    // 0 with it, which is the defect, not a saving.)
    const asSystemHalf = await seedCost(SYSTEM_SESSION, 5);
    expect(asSystem).toBeGreaterThan(asSystemHalf);
  });
});
