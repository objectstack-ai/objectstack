// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#6783] "Configured but inert" stops being silent.
 *
 * Demand 3 of #4707, maintainer-ruled 2026-08-06. An `isSystem` write batch —
 * a seed run, a package install, an internal importer — lands rows on an
 * object an ACTIVE sharing rule covers, and the record-write hooks skip it, so
 * ZERO `sys_record_share` rows are materialised. That skip is correct: the
 * `kernel:bootstrapped` backfill reconciles every rule and `evaluateRule` is
 * idempotent. What was wrong is that nothing said so. hotcrm#640: a fresh
 * install with 9 active rules, 9 matching accounts, and an empty
 * `sys_record_share` — every visible layer said "configured", and the only way
 * to learn otherwise was to query the table and go read `rule-hooks.ts`.
 *
 * What this file pins, in both directions:
 *
 *  - ONE line per batch, not per row. That boundary is the whole shape of the
 *    fix — the defect is silence, and a per-row flood would trade it for
 *    noise, which is the same defect with a different symptom.
 *  - INFO, never warn/error: the behaviour is correct and self-healing.
 *  - The maintainer's wording, verbatim, as a contract.
 *  - The negative faces: a non-system write (which materialises normally),
 *    an active rule whose criteria the written row does not satisfy (zero
 *    grants, but legitimately so), an object whose only rule is inactive, and
 *    an `isSystem` DELETE — deliberately silent, because the remedy the line
 *    names cannot repair a grant whose record is gone.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/objectql';
import { SharingService } from './sharing-service.js';
import { SharingRuleService } from './sharing-rule-service.js';
import {
  bindRuleHooks,
  unbindAllRuleHooks,
  SHARING_RULE_HOOK_PACKAGE,
  SYSTEM_WRITE_SKIP_NOTICE,
} from './rule-hooks.js';

interface Row { [k: string]: any }

const SYS = { isSystem: true, positions: [], permissions: [] } as any;
/** What a seed run / package install / internal importer sends. */
const SYSTEM_SESSION = { isSystem: true };
/** What an interactive admin sends — the path that DOES materialise. */
const ADMIN_SESSION = { isSystem: false, userId: 'admin' };

type HookEntry = { event: string; handler: (ctx: any) => any; options: Row };

/**
 * A fake ObjectQL engine, pinned to the real engine's write dispatch on both
 * destructive verbs (#4550 / #5480) so a double looser than the thing it
 * replaces cannot turn this suite green on calls production refuses.
 */
function makeEngine() {
  const tables: Record<string, Row[]> = {};
  const hooks: HookEntry[] = [];
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
      if (rv !== v) return false;
    }
    return true;
  }

  const engine = {
    _tables: tables,
    getSchema() { return undefined; },
    async find(o: string, opts?: any) {
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

/** The #6783 notices this logger saw — by message, not by call count. */
const notices = (logger: any) =>
  logger.info.mock.calls.filter((c: any[]) => c[0] === SYSTEM_WRITE_SKIP_NOTICE);

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

describe('#6783 isSystem writes that materialise zero grants say so, once', () => {
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

  // ── the positive face ────────────────────────────────────────────────

  it('reports the skip, naming the behaviour, the remedy, the object and the rules', async () => {
    await engine.simulateInsert('opportunity', { id: 'opp0', region: 'east', owner_id: 'boss' }, SYSTEM_SESSION);

    expect(notices(logger)).toHaveLength(1);
    const [message, meta] = notices(logger)[0];
    // The maintainer's wording is the contract, not a paraphrase of it.
    expect(message).toContain(
      'sharing materialisation skipped for isSystem writes; re-evaluate rules or restart to backfill',
    );
    expect(meta).toEqual({ object: 'opportunity', rules: ['east_to_alice'] });
    // …and the line is only true because nothing WAS materialised.
    expect(ruleShares(engine)).toEqual([]);
  });

  it('emits ONE line for a batch of many rows — the boundary this card is about', async () => {
    await engine.simulateInsertBatch('opportunity', [
      { id: 'opp0', region: 'east', owner_id: 'boss' },
      { id: 'opp1', region: 'east', owner_id: 'boss' },
      { id: 'opp2', region: 'east', owner_id: 'boss' },
      { id: 'opp3', region: 'east', owner_id: 'boss' },
      { id: 'opp4', region: 'east', owner_id: 'boss' },
    ]);

    expect(engine._tables.opportunity).toHaveLength(5);
    expect(notices(logger)).toHaveLength(1);
    expect(ruleShares(engine)).toEqual([]);
  });

  it('counts an isSystem UPDATE as the same skip — insert + update on one object is still one line', async () => {
    await engine.simulateInsertBatch('opportunity', [
      { id: 'opp0', region: 'west', owner_id: 'boss' },
      { id: 'opp1', region: 'west', owner_id: 'boss' },
    ]);
    await engine.simulateBulkUpdate('opportunity', { region: 'west' }, { region: 'east' }, SYSTEM_SESSION);

    // The update moved both rows INTO the criteria and still granted nothing.
    expect(ruleShares(engine)).toEqual([]);
    expect(notices(logger)).toHaveLength(1);
  });

  it('is INFO — never warn, never error', async () => {
    await engine.simulateInsert('opportunity', { id: 'opp0', region: 'east' }, SYSTEM_SESSION);

    expect(notices(logger)).toHaveLength(1);
    for (const level of ['warn', 'error'] as const) {
      expect(
        logger[level].mock.calls.filter((c: any[]) => String(c[0]).includes('materialisation skipped')),
      ).toEqual([]);
    }
  });

  it('reports each covered object separately — the latch is per object, not global', async () => {
    engine._tables.opportunity = [];
    engine._tables.contract = [];
    engine._tables.sys_sharing_rule.push(
      rule({ id: 'srule_contract', name: 'contract_to_alice', object_name: 'contract' }),
    );
    await bind();

    await engine.simulateInsertBatch('opportunity', [{ id: 'opp0', region: 'east' }, { id: 'opp1', region: 'east' }]);
    await engine.simulateInsertBatch('contract', [{ id: 'con0', region: 'east' }, { id: 'con1', region: 'east' }]);

    expect(notices(logger).map((c: any[]) => c[1].object).sort()).toEqual(['contract', 'opportunity']);
  });

  it('re-arms on rebind: a rule change gets its own notice instead of inheriting the old silence', async () => {
    await engine.simulateInsert('opportunity', { id: 'opp0', region: 'east' }, SYSTEM_SESSION);
    expect(notices(logger)).toHaveLength(1);

    // What `bindRuleRebindTriggers` does on every `sys_sharing_rule` write.
    await bind();
    await engine.simulateInsert('opportunity', { id: 'opp1', region: 'east' }, SYSTEM_SESSION);

    expect(notices(logger)).toHaveLength(2);
  });

  it('never fails the write, even when the logger itself throws', async () => {
    // A log sink that is down must not turn an observability line into a
    // failed seed row: the notice runs ahead of the hook's own `try`.
    const angry = {
      info: vi.fn((msg: string) => {
        if (msg === SYSTEM_WRITE_SKIP_NOTICE) throw new Error('log sink down');
      }),
      warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
    };
    const ruleRows = await rules.listRules({ activeOnly: true }, SYS);
    unbindAllRuleHooks(engine as any);
    bindRuleHooks(engine as any, rules, ruleRows, angry as any);

    await expect(
      engine.simulateInsert('opportunity', { id: 'opp0', region: 'east' }, SYSTEM_SESSION),
    ).resolves.toBeUndefined();

    // It tried exactly once, and the latch closed even though the log failed —
    // a broken sink must not become one throw per row.
    expect(angry.info.mock.calls.filter((c: any[]) => c[0] === SYSTEM_WRITE_SKIP_NOTICE)).toHaveLength(1);
    await engine.simulateInsert('opportunity', { id: 'opp1', region: 'east' }, SYSTEM_SESSION);
    expect(angry.info.mock.calls.filter((c: any[]) => c[0] === SYSTEM_WRITE_SKIP_NOTICE)).toHaveLength(1);
  });

  // ── the negative faces: silence when nothing is wrong ────────────────

  it('stays silent for a non-system write — which materialises normally', async () => {
    await engine.simulateInsert('opportunity', { id: 'opp0', region: 'east', owner_id: 'boss' }, ADMIN_SESSION);

    expect(notices(logger)).toEqual([]);
    expect(ruleShares(engine).map((r) => r.record_id)).toEqual(['opp0']);
  });

  it('stays silent when an active rule legitimately matches nothing', async () => {
    // Rule active, row written, ZERO grants materialised — and correctly so:
    // `west` is outside the criteria. Nothing is inert, so nothing is said.
    await engine.simulateInsert('opportunity', { id: 'opp0', region: 'west', owner_id: 'boss' }, ADMIN_SESSION);

    expect(ruleShares(engine)).toEqual([]);
    expect(notices(logger)).toEqual([]);
  });

  it("stays silent when the object's only rule is inactive — no active rule, no hooks, no line", async () => {
    engine._tables.sys_sharing_rule = [rule({ active: false })];
    await bind();

    expect(engine.boundFor(SHARING_RULE_HOOK_PACKAGE)).toEqual([]);
    await engine.simulateInsert('opportunity', { id: 'opp0', region: 'east' }, SYSTEM_SESSION);

    expect(notices(logger)).toEqual([]);
  });

  it("stays silent on an isSystem DELETE — the line's remedy cannot repair that class", async () => {
    // A delete skips REVOCATION, not materialisation, and `evaluateRule`
    // iterates records that still exist — so neither re-evaluating nor
    // restarting can reach a grant whose record is gone (#4779's orphan).
    // `record-share-cascade.ts` and the boot orphan sweep own it instead.
    await engine.simulateInsert('opportunity', { id: 'opp0', region: 'east', owner_id: 'boss' }, ADMIN_SESSION);
    expect(ruleShares(engine)).toHaveLength(1);
    logger.info.mockClear();

    await engine.simulateBulkDelete('opportunity', { region: 'east' }, SYSTEM_SESSION);

    expect(notices(logger)).toEqual([]);
  });

  it('stays silent on an object no active rule covers', async () => {
    engine._tables.invoice = [];
    await engine.simulateInsert('invoice', { id: 'inv0', region: 'east' }, SYSTEM_SESSION);

    expect(notices(logger)).toEqual([]);
  });
});

describe("#6783 the notice text is the maintainer's ruling, verbatim", () => {
  it('carries the ruled wording and the package tag every sharing line uses', () => {
    expect(SYSTEM_WRITE_SKIP_NOTICE).toBe(
      '[sharing-rule] sharing materialisation skipped for isSystem writes; ' +
      're-evaluate rules or restart to backfill',
    );
  });

  it('names BOTH remedies — re-evaluation and restart', () => {
    expect(SYSTEM_WRITE_SKIP_NOTICE).toContain('re-evaluate rules');
    expect(SYSTEM_WRITE_SKIP_NOTICE).toContain('restart to backfill');
  });
});
