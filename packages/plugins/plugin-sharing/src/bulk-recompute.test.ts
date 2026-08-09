// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#4779] Sharing-rule recompute for predicate (`multi: true`) writes.
 *
 * The hooks used to open with `if (!id) return`, and `ObjectQL.update()` only
 * populates `input.id` for a scalar `where.id`. So a bulk write recomputed
 * nothing: records bulk-updated OUT of a sharing rule's criteria kept every
 * `sys_record_share` row the rule had issued, and the recipients kept read and
 * edit access the rules no longer implied — a fail-open on the authorization
 * side (same family as #4757 / #4778).
 *
 * Maintainer ruling (2026-08-04), implemented here as option C:
 *
 *  - bounded row set (≤ `RULE_RECOMPUTE_ROW_CAP`) → per-row recompute,
 *    synchronous, both directions;
 *  - unbounded row set → synchronous set-based revoke of the object's rule
 *    grants + asynchronous re-grant. The write is never refused.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { assertEngineDeleteDispatch } from '@objectstack/objectql';
import { SharingService } from './sharing-service.js';
import { SharingRuleService } from './sharing-rule-service.js';
import {
  bindRuleHooks,
  unbindAllRuleHooks,
  ruleRegrantQueue,
  SHARING_RULE_HOOK_PACKAGE,
} from './rule-hooks.js';
import {
  RULE_RECOMPUTE_ROW_CAP,
  RuleRegrantQueue,
  resolveAffectedRows,
  idsFromHookInput,
} from './bulk-recompute.js';

interface Row { [k: string]: any }

const SYS = { isSystem: true, positions: [], permissions: [] } as any;
/** A non-system session — the hooks deliberately skip `isSystem` writes. */
const ADMIN_SESSION = { isSystem: false, userId: 'admin' };

type HookEntry = { event: string; handler: (ctx: any) => any; options: Row };

/**
 * A fake ObjectQL engine that also reproduces the part of the write pipeline
 * this fix depends on: `before*` and `after*` hooks of one write share ONE
 * `HookContext` instance (the real engine mutates `ctx.event` in place rather
 * than building a second context), and a predicate update leaves `input.id`
 * undefined.
 */
function makeEngine() {
  const tables: Record<string, Row[]> = {};
  const hooks: HookEntry[] = [];
  const ensure = (n: string) => (tables[n] ??= []);
  /** Every `delete` call this engine saw, for asserting set-based revokes. */
  const deleteCalls: Array<{ object: string; options: any }> = [];

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
      if (rv !== v) return false;
    }
    return true;
  }

  const engine = {
    _tables: tables,
    _deleteCalls: deleteCalls,
    /** Set to make the predicate resolve throw (the 'resolve-failed' branch). */
    failFindOn: null as string | null,
    getSchema() { return undefined; },
    async find(o: string, opts?: any) {
      if (engine.failFindOn === o) throw new Error(`boom: ${o} unavailable`);
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
      // Pinned to `ObjectQLEngine.delete`'s own dispatch predicate (#4434,
      // #4550): a predicate-shaped delete without `multi: true` is the one
      // shape a real server answers 500 to. The set-based revokes this issue
      // adds are exactly that shape, so a fake that accepted them would prove
      // nothing about production.
      assertEngineDeleteDispatch(opts);
      deleteCalls.push({ object: o, options: opts });
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

    /**
     * A predicate update, run the way the engine runs one: seed a hook context
     * with NO `input.id` (the #4779 precondition), fire `beforeUpdate`, mutate
     * the matched rows, then fire `afterUpdate` on the SAME context object.
     */
    async simulateBulkUpdate(object: string, where: any, data: Row, session: any = ADMIN_SESSION) {
      const ctx: any = {
        object,
        event: 'beforeUpdate',
        input: { id: undefined, data, options: { where, multi: true } },
        session,
      };
      await engine.fire('beforeUpdate', object, ctx);
      const t = ensure(object);
      let affected = 0;
      for (let i = 0; i < t.length; i++) {
        if (where != null && !matches(t[i], where)) continue;
        t[i] = { ...t[i], ...data };
        affected++;
      }
      ctx.event = 'afterUpdate';
      ctx.result = affected;
      await engine.fire('afterUpdate', object, ctx);
      return affected;
    },

    /** A single-id update — `input.id` is populated, as the engine does. */
    async simulateUpdateById(object: string, id: string, data: Row, session: any = ADMIN_SESSION) {
      const ctx: any = {
        object,
        event: 'beforeUpdate',
        input: { id, data, options: { where: { id } } },
        session,
      };
      await engine.fire('beforeUpdate', object, ctx);
      const t = ensure(object);
      const i = t.findIndex((r) => r.id === id);
      if (i >= 0) t[i] = { ...t[i], ...data };
      ctx.event = 'afterUpdate';
      ctx.result = t[i];
      await engine.fire('afterUpdate', object, ctx);
    },

    async simulateBulkDelete(object: string, where: any, session: any = ADMIN_SESSION) {
      const ctx: any = {
        object,
        event: 'beforeDelete',
        input: { id: undefined, options: { where, multi: true } },
        session,
      };
      await engine.fire('beforeDelete', object, ctx);
      const t = ensure(object);
      for (let i = t.length - 1; i >= 0; i--) if (matches(t[i], where)) t.splice(i, 1);
      ctx.event = 'afterDelete';
      await engine.fire('afterDelete', object, ctx);
    },

    /**
     * [#6966] A predicate update run the way the engine ACTUALLY runs one
     * today, which `simulateBulkUpdate` above no longer describes: since
     * #5038/#5574 BOTH phases dispatch once per matched row, each on a freshly
     * built single-record-shaped context carrying that row's `input.id` and the
     * `dispatch` marker, with ONE `scope` object shared by all of them.
     *
     * The distinction is this section's whole point. `simulateBulkUpdate`
     * models the pre-#5574 batch dispatch (one context, no `input.id`), so
     * assertions written against it are silent about what the engine does now.
     * It is kept rather than replaced because the same "one context across the
     * pair" shape is exactly what the single-id path still does.
     */
    async simulatePerRowUpdate(object: string, where: any, data: Row, session: any = ADMIN_SESSION) {
      const t = ensure(object);
      const matched = t.filter((r) => where == null || matches(r, where)).map((r) => ({ ...r }));
      const scope: Record<string, unknown> = {};
      const rowCtx = (event: string, row: Row, index: number) => ({
        object,
        event,
        input: { id: row.id, data, options: { where, multi: true } },
        previous: { ...row },
        dispatch: { mode: 'per-row' as const, index, scope },
        session,
      });
      for (let i = 0; i < matched.length; i++) {
        await engine.fire('beforeUpdate', object, rowCtx('beforeUpdate', matched[i], i));
      }
      for (let i = 0; i < t.length; i++) {
        if (where != null && !matches(t[i], where)) continue;
        t[i] = { ...t[i], ...data };
      }
      for (let i = 0; i < matched.length; i++) {
        await engine.fire('afterUpdate', object, rowCtx('afterUpdate', matched[i], i));
      }
      return matched.length;
    },

    /** [#6966] The delete twin of `simulatePerRowUpdate`. */
    async simulatePerRowDelete(object: string, where: any, session: any = ADMIN_SESSION) {
      const t = ensure(object);
      const doomed = t.filter((r) => matches(r, where)).map((r) => ({ ...r }));
      const scope: Record<string, unknown> = {};
      const rowCtx = (event: string, row: Row, index: number) => ({
        object,
        event,
        input: { id: row.id, options: { where, multi: true } },
        previous: { ...row },
        dispatch: { mode: 'per-row' as const, index, scope },
        session,
      });
      for (let i = 0; i < doomed.length; i++) {
        await engine.fire('beforeDelete', object, rowCtx('beforeDelete', doomed[i], i));
      }
      for (let i = t.length - 1; i >= 0; i--) if (matches(t[i], where)) t.splice(i, 1);
      for (let i = 0; i < doomed.length; i++) {
        await engine.fire('afterDelete', object, rowCtx('afterDelete', doomed[i], i));
      }
      return doomed.length;
    },
  };
  return engine;
}

type Engine = ReturnType<typeof makeEngine>;

/** `sys_record_share` rows this rule has materialised, by record. */
function ruleShares(engine: Engine): Array<{ record_id: string; recipient_id: string }> {
  return (engine._tables.sys_record_share ?? [])
    .filter((r) => r.source === 'rule')
    .map((r) => ({ record_id: String(r.record_id), recipient_id: String(r.recipient_id) }));
}

function makeStack(engine: Engine, logger: any) {
  const sharing = new SharingService({ engine: engine as any });
  const rules = new SharingRuleService({ engine: engine as any, sharing, logger });
  return { sharing, rules };
}

describe('#4779 predicate (multi) writes recompute sharing rules', () => {
  let engine: Engine;
  let rules: SharingRuleService;
  let logger: any;

  /** Seed `count` opportunity rows in `region`, all owned by `boss`. */
  const seed = (count: number, region: string, from = 0) => {
    for (let i = from; i < from + count; i++) {
      engine._tables.opportunity.push({ id: `opp${i}`, region, owner_id: 'boss', stage: 'open' });
    }
  };

  beforeEach(async () => {
    logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    engine = makeEngine();
    engine._tables.opportunity = [];
    engine._tables.sys_record_share = [];
    engine._tables.sys_sharing_rule = [{
      id: 'srule_east',
      name: 'east_to_alice',
      label: 'East → Alice',
      object_name: 'opportunity',
      criteria_json: JSON.stringify({ region: 'east' }),
      recipient_type: 'user',
      recipient_id: 'alice',
      access_level: 'edit',
      active: true,
    }];
    ({ rules } = makeStack(engine, logger));
    const ruleRows = await rules.listRules({ activeOnly: true }, SYS);
    bindRuleHooks(engine as any, rules, ruleRows, logger);
  });

  it('binds the before/after pair a row-set recompute needs', () => {
    const bound = engine.boundFor(SHARING_RULE_HOOK_PACKAGE).map((h) => h.event).sort();
    expect(bound).toEqual([
      'afterDelete', 'afterInsert', 'afterUpdate', 'beforeDelete', 'beforeUpdate',
    ]);
  });

  /**
   * THE REPRO. Revert-proof: with `if (!id) return` restored, `evaluateAllForRecord`
   * is never called for a predicate write, so the two grants survive and the
   * final expectation reads `2`, not `0`.
   */
  it('revokes grants when a bulk update moves records OUT of the criteria', async () => {
    seed(2, 'east');
    await rules.evaluateRule('srule_east', SYS);
    expect(ruleShares(engine)).toHaveLength(2);

    await engine.simulateBulkUpdate('opportunity', { region: 'east' }, { region: 'west' });

    expect(ruleShares(engine)).toEqual([]);
  });

  it('grants when a bulk update moves records INTO the criteria (the reverse direction)', async () => {
    seed(3, 'west');
    await rules.evaluateRule('srule_east', SYS);
    expect(ruleShares(engine)).toEqual([]);

    await engine.simulateBulkUpdate('opportunity', { region: 'west' }, { region: 'east' });

    expect(ruleShares(engine).map((s) => s.record_id).sort()).toEqual(['opp0', 'opp1', 'opp2']);
    expect(new Set(ruleShares(engine).map((s) => s.recipient_id))).toEqual(new Set(['alice']));
  });

  it('still recomputes a single-id update (no regression on the path that worked)', async () => {
    seed(1, 'east');
    await rules.evaluateRule('srule_east', SYS);
    expect(ruleShares(engine)).toHaveLength(1);

    await engine.simulateUpdateById('opportunity', 'opp0', { region: 'west' });

    expect(ruleShares(engine)).toEqual([]);
  });

  it('leaves system-context bulk writes to the boot backfill, as before', async () => {
    seed(2, 'east');
    await rules.evaluateRule('srule_east', SYS);

    await engine.simulateBulkUpdate(
      'opportunity', { region: 'east' }, { region: 'west' }, { isSystem: true },
    );

    // Untouched by the hooks — `kernel:bootstrapped`'s backfill owns seeds.
    expect(ruleShares(engine)).toHaveLength(2);
  });

  it('does not touch manual shares — only rule-materialised ones', async () => {
    seed(1, 'east');
    await rules.evaluateRule('srule_east', SYS);
    engine._tables.sys_record_share.push({
      id: 'shr_manual', object_name: 'opportunity', record_id: 'opp0',
      recipient_type: 'user', recipient_id: 'carol', access_level: 'read', source: 'manual',
    });

    await engine.simulateBulkUpdate('opportunity', { region: 'east' }, { region: 'west' });

    const remaining = engine._tables.sys_record_share;
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe('shr_manual');
  });

  describe('unbounded row sets — synchronous revoke, asynchronous re-grant', () => {
    it('over the cap: revokes set-based before the write returns, then re-grants', async () => {
      // 1001 rows match the WRITE's predicate (stage), which is over the cap;
      // only two of them match the RULE's criteria (region).
      seed(RULE_RECOMPUTE_ROW_CAP + 1, 'west');
      engine._tables.opportunity[0].region = 'east';
      engine._tables.opportunity[1].region = 'east';
      await rules.evaluateRule('srule_east', SYS);
      expect(ruleShares(engine)).toHaveLength(2);

      await engine.simulateBulkUpdate('opportunity', { stage: 'open' }, { stage: 'won' });

      // Synchronous half: the grants are gone the moment the write returns,
      // and they went in ONE set-based statement rather than 1001.
      expect(ruleShares(engine)).toEqual([]);
      const revokes = engine._deleteCalls.filter((c) => c.object === 'sys_record_share');
      expect(revokes).toHaveLength(1);
      expect(revokes[0].options).toMatchObject({
        where: { source: 'rule', object_name: 'opportunity' },
        multi: true,
      });

      // Asynchronous half: the two rows still in `east` get their grant back.
      await ruleRegrantQueue.whenIdle();
      expect(ruleShares(engine).map((s) => s.record_id).sort()).toEqual(['opp0', 'opp1']);
    });

    it('over the cap: the write is NOT refused (option A was the fallback, not the ruling)', async () => {
      seed(RULE_RECOMPUTE_ROW_CAP + 1, 'east');
      await expect(
        engine.simulateBulkUpdate('opportunity', { stage: 'open' }, { stage: 'won' }),
      ).resolves.toBe(RULE_RECOMPUTE_ROW_CAP + 1);
      expect(engine._tables.opportunity.every((r) => r.stage === 'won')).toBe(true);
      await ruleRegrantQueue.whenIdle();
    });

    it('an unscoped multi write (no predicate at all) takes the unbounded path', async () => {
      seed(2, 'east');
      await rules.evaluateRule('srule_east', SYS);
      expect(ruleShares(engine)).toHaveLength(2);

      await engine.simulateBulkUpdate('opportunity', null, { stage: 'won' });

      expect(ruleShares(engine)).toEqual([]);
      await ruleRegrantQueue.whenIdle();
      // Still `east` — the re-grant restores what is still deserved.
      expect(ruleShares(engine)).toHaveLength(2);
    });

    it('a failed resolve revokes rather than silently recomputing nothing', async () => {
      seed(2, 'east');
      await rules.evaluateRule('srule_east', SYS);
      engine.failFindOn = 'opportunity';

      await engine.simulateBulkUpdate('opportunity', { region: 'east' }, { region: 'west' });

      // "The query failed" must never be read as "no rows matched" (#4757).
      expect(ruleShares(engine)).toEqual([]);
      engine.failFindOn = null;
      await ruleRegrantQueue.whenIdle();
    });

    it('warns loudly about the availability trade it just made', async () => {
      seed(RULE_RECOMPUTE_ROW_CAP + 1, 'east');
      await engine.simulateBulkUpdate('opportunity', { stage: 'open' }, { stage: 'won' });
      await ruleRegrantQueue.whenIdle();

      const warned = logger.warn.mock.calls.map((c: any[]) => String(c[0])).join('\n');
      expect(warned).toContain('re-granted in the background');
      expect(logger.warn.mock.calls.some((c: any[]) => c[1]?.reason === 'over-cap')).toBe(true);
    });
  });

  /**
   * [#6966] The same contract, over the dispatch the engine actually performs.
   *
   * Everything above drives `simulateBulkUpdate`, which models the pre-#5574
   * batch dispatch: ONE context, no `input.id`, reused across the pair. Since
   * #5574 a predicate write dispatches `before*` per matched row on a FRESHLY
   * BUILT context, so the stash `stashAffectedRows` wrote never reached the
   * `after` phase. `readAffectedRows` then answered `resolve-failed` and every
   * bulk write took the unbounded branch — a full revoke plus a queued
   * re-grant, once per matched row. Safe, but not what any of these tests say.
   *
   * Revert-proof: park the stash back on the context (or read it from there)
   * and the bounded cases below fall into the unbounded branch — `_deleteCalls`
   * grows a set-based revoke per row where these expect none.
   */
  describe('[#6966] the real per-row dispatch takes the same bounded path', () => {
    it('a per-row bulk update revokes exactly the rows that left the criteria', async () => {
      seed(2, 'east');
      await rules.evaluateRule('srule_east', SYS);
      expect(ruleShares(engine)).toHaveLength(2);

      await engine.simulatePerRowUpdate('opportunity', { region: 'east' }, { region: 'west' });

      expect(ruleShares(engine)).toEqual([]);
      // BOUNDED: the row set was known, so no object-wide revoke was needed.
      // Before this fix there was one per matched row.
      expect(engine._deleteCalls.filter((c) => c.object === 'sys_record_share' && c.options?.multi))
        .toHaveLength(0);
    });

    it('a per-row bulk update INTO the criteria grants every matched row, not just the first', async () => {
      // The failure this guards against is subtler than "no stash": resolving
      // once and reusing the answer would freeze the batch to row 0's id,
      // because `resolveAffectedRows` short-circuits on a bound `input.id`.
      seed(3, 'west');
      await rules.evaluateRule('srule_east', SYS);
      expect(ruleShares(engine)).toEqual([]);

      await engine.simulatePerRowUpdate('opportunity', { region: 'west' }, { region: 'east' });

      expect(ruleShares(engine).map((s) => s.record_id).sort()).toEqual(['opp0', 'opp1', 'opp2']);
    });

    it('a per-row bulk delete revokes every deleted row\'s grants', async () => {
      seed(3, 'east');
      await rules.evaluateRule('srule_east', SYS);
      expect(ruleShares(engine)).toHaveLength(3);

      engine._deleteCalls.length = 0;
      await engine.simulatePerRowDelete('opportunity', { region: 'east' });

      expect(ruleShares(engine)).toEqual([]);
      // ONE revoke for the write, scoped to the deleted ids — not one per row,
      // and not the object-wide `unbounded` revoke the missing stash produced.
      const revokes = engine._deleteCalls.filter((c) => c.object === 'sys_record_share');
      expect(revokes).toHaveLength(1);
      expect(revokes[0].options).toMatchObject({
        where: { source: 'rule', object_name: 'opportunity', record_id: { $in: ['opp0', 'opp1', 'opp2'] } },
        multi: true,
      });
    });

    it('the union is still capped — over the cap falls back to the unbounded branch', async () => {
      // The engine's own per-row ceiling is higher than this module's, so a
      // batch it lets through can still be more than a per-row recompute will
      // take. That verdict must stay `over-cap`, not become "N rows, fine".
      seed(RULE_RECOMPUTE_ROW_CAP + 1, 'east');
      await engine.simulatePerRowUpdate('opportunity', { region: 'east' }, { stage: 'won' });

      const revokes = engine._deleteCalls.filter((c) => c.object === 'sys_record_share');
      expect(revokes).toHaveLength(1);
      expect(revokes[0].options).toMatchObject({
        where: { source: 'rule', object_name: 'opportunity' },
        multi: true,
      });
      await ruleRegrantQueue.whenIdle();
    });
  });

  describe('afterDelete — the orphaned-grant tail of the issue', () => {
    it('revokes the deleted records grants (nothing can ever reconcile them)', async () => {
      seed(3, 'east');
      await rules.evaluateRule('srule_east', SYS);
      expect(ruleShares(engine)).toHaveLength(3);

      await engine.simulateBulkDelete('opportunity', { id: { $in: ['opp0', 'opp1'] } });

      expect(ruleShares(engine).map((s) => s.record_id)).toEqual(['opp2']);
    });

    it('revokes via a set-based, multi-declared delete', async () => {
      seed(1, 'east');
      await rules.evaluateRule('srule_east', SYS);
      engine._deleteCalls.length = 0;

      await engine.simulateBulkDelete('opportunity', { region: 'east' });

      const revokes = engine._deleteCalls.filter((c) => c.object === 'sys_record_share');
      expect(revokes).toHaveLength(1);
      expect(revokes[0].options).toMatchObject({
        where: { source: 'rule', object_name: 'opportunity', record_id: { $in: ['opp0'] } },
        multi: true,
      });
    });
  });

  it('unbindAllRuleHooks removes the whole enlarged set', () => {
    expect(unbindAllRuleHooks(engine as any)).toBe(5);
    expect(engine.boundFor(SHARING_RULE_HOOK_PACKAGE)).toHaveLength(0);
  });
});

describe('resolveAffectedRows', () => {
  let engine: Engine;
  beforeEach(() => {
    engine = makeEngine();
    engine._tables.opportunity = [
      { id: 'a', region: 'east' }, { id: 'b', region: 'east' }, { id: 'c', region: 'west' },
    ];
  });

  it('takes a scalar input.id without querying', async () => {
    const spy = vi.spyOn(engine, 'find');
    const out = await resolveAffectedRows(engine, 'opportunity', { input: { id: 'a' } });
    expect(out).toEqual({ kind: 'rows', ids: ['a'] });
    expect(spy).not.toHaveBeenCalled();
  });

  it('resolves a predicate into its row set', async () => {
    const out = await resolveAffectedRows(engine, 'opportunity', {
      input: { options: { where: { region: 'east' }, multi: true } },
    });
    expect(out).toEqual({ kind: 'rows', ids: ['a', 'b'] });
  });

  it('reports a predicate matching nothing as an EMPTY row set, not as unbounded', async () => {
    const out = await resolveAffectedRows(engine, 'opportunity', {
      input: { options: { where: { region: 'north' }, multi: true } },
    });
    expect(out).toEqual({ kind: 'rows', ids: [] });
  });

  it('reports a missing predicate as unbounded (the AST would cover the table)', async () => {
    const out = await resolveAffectedRows(engine, 'opportunity', {
      input: { options: { multi: true } },
    });
    expect(out).toEqual({ kind: 'unbounded', reason: 'no-predicate' });
  });

  it('reports over-cap without paying for the full scan', async () => {
    engine._tables.opportunity = Array.from(
      { length: RULE_RECOMPUTE_ROW_CAP + 5 },
      (_, i) => ({ id: `r${i}`, region: 'east' }),
    );
    const spy = vi.spyOn(engine, 'find');
    const out = await resolveAffectedRows(engine, 'opportunity', {
      input: { options: { where: { region: 'east' }, multi: true } },
    });
    expect(out).toEqual({ kind: 'unbounded', reason: 'over-cap' });
    expect(spy.mock.calls[0][1].limit).toBe(RULE_RECOMPUTE_ROW_CAP + 1);
  });

  it('reports a failed resolve as unbounded, never as an empty set', async () => {
    engine.failFindOn = 'opportunity';
    const out = await resolveAffectedRows(engine, 'opportunity', {
      input: { options: { where: { region: 'east' }, multi: true } },
    });
    expect(out).toMatchObject({ kind: 'unbounded', reason: 'resolve-failed' });
  });
});

describe('idsFromHookInput', () => {
  it('accepts the shapes that name primary keys', () => {
    expect(idsFromHookInput('a')).toEqual(['a']);
    expect(idsFromHookInput(7)).toEqual(['7']);
    expect(idsFromHookInput({ $in: ['a', 'b'] })).toEqual(['a', 'b']);
    expect(idsFromHookInput(['a', 'b'])).toEqual(['a', 'b']);
  });

  it('rejects predicates that merely look like ids', () => {
    expect(idsFromHookInput(undefined)).toBeNull();
    expect(idsFromHookInput(null)).toBeNull();
    expect(idsFromHookInput({ $ne: 'a' })).toBeNull();
    expect(idsFromHookInput({ $in: [] })).toBeNull();
  });
});

describe('RuleRegrantQueue', () => {
  it('serializes tasks — a bulk write never fans out concurrent reconciles', async () => {
    const q = new RuleRegrantQueue();
    const order: string[] = [];
    const slow = (tag: string, ms: number) => async () => {
      order.push(`${tag}:start`);
      await new Promise((r) => setTimeout(r, ms));
      order.push(`${tag}:end`);
    };
    q.enqueue(slow('a', 12));
    q.enqueue(slow('b', 1));
    await q.whenIdle();
    expect(order).toEqual(['a:start', 'a:end', 'b:start', 'b:end']);
    expect(q.pending).toBe(0);
  });

  it('absorbs a failing task — a detached rejection must not reach the host', async () => {
    const q = new RuleRegrantQueue();
    const onError = vi.fn();
    q.enqueue(async () => { throw new Error('regrant exploded'); }, onError);
    q.enqueue(async () => { /* the chain survives */ });
    await expect(q.whenIdle()).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledOnce();
    expect((onError.mock.calls[0][0] as Error).message).toBe('regrant exploded');
  });
});
