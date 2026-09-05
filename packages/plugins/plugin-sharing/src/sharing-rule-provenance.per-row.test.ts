// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#15302] The `sys_sharing_rule` provenance stamp on a PREDICATE (`multi: true`)
 * update, pinned against the REAL engine.
 *
 * This hook used to carry two comments that were assertions about runtime
 * behaviour, and runtime measurement falsified both:
 *
 *  1. "multi-row updates (no single `input.id`) are not stamped" - false since
 *     #6966. Per-row `before*` dispatch binds `ctx.input.id` on EVERY context,
 *     so `if (!id) return` no longer detected a bulk write and the hook ran
 *     once per matched row regardless.
 *  2. "`previous` is not resolved before beforeUpdate hooks run" - false since
 *     #5574 / #5846. The engine binds `previous` before dispatching
 *     `beforeUpdate` on both write shapes, so the hook's own `engine.find` was
 *     a second read of a row the engine had just read - once PER MATCHED ROW
 *     on a predicate write.
 *
 * A comment cannot be pinned, so what is pinned here is the behaviour each
 * comment was wrong about. §3 is the read count, measured with a control that
 * fires rather than asserted.
 *
 * ⚠️ The engine half of this suite resolves through `@objectstack/objectql`'s
 * `exports` to `dist/` (this package aliases no objectql entry; the ledger in
 * `scripts/check-test-source-alias.mjs` records that), so a stale objectql
 * build makes these readings about the built artifact. The SUBJECT -
 * `./sharing-rule-provenance.js` - is a relative import read from source, which is what an
 * ablation of this file's fix mutates.
 */

import { describe, it, expect } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { bindRuleProvenanceStamp } from './sharing-rule-provenance.js';

const OBJECT = 'sys_sharing_rule';
const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };

/** Minimal in-memory driver. `findCalls` is the instrument §3 reads. */
function makeStubDriver(): any {
  const store = new Map<string, Record<string, unknown>>();
  const matches = (row: any, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    for (const [k, v] of Object.entries(where)) {
      if (k.startsWith('$')) continue;
      const e: any = v && typeof v === 'object' && '$in' in (v as any) ? undefined : v;
      if (v && typeof v === 'object' && '$in' in (v as any)) {
        if (!(v as any).$in.includes(row[k])) return false;
        continue;
      }
      const expected = e && typeof e === 'object' && '$eq' in (e as any) ? (e as any).$eq : e;
      if ((row[k] ?? null) !== (expected ?? null)) return false;
    }
    return true;
  };
  const d: any = {
    name: 'memory', version: '0.0.0', supports: {},
    store,
    /** Every `find` the engine (or a hook, through `engine.find`) issues. */
    findCalls: [] as unknown[],
    /** One entry per `updateMany` - the ONE `SET` clause N rows share (D3). */
    updateManyPayloads: [] as Record<string, unknown>[],
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    async execute() { return null; }, async syncSchema() {},
    async find(o: string, ast: any) {
      d.findCalls.push({ object: o, where: ast?.where });
      return [...store.values()].filter((r) => matches(r, ast?.where));
    },
    async findOne(o: string, ast: any) {
      for (const r of store.values()) if (matches(r, ast?.where)) return r;
      return null;
    },
    async create(_o: string, data: Record<string, unknown>) {
      const row = { ...data }; store.set(String(row.id), row); return row;
    },
    async update(_o: string, id: string, data: Record<string, unknown>) {
      const cur = store.get(id); if (!cur) return null;
      const u = { ...cur, ...data, id }; store.set(id, u); return u;
    },
    async upsert(o: string, data: any) { return this.create(o, data); },
    async delete(_o: string, id: string) { return store.delete(id); },
    async count(_o: string, ast: any) { return [...store.values()].filter((r) => matches(r, ast?.where)).length; },
    async bulkCreate(o: string, rows: any[]) { return Promise.all(rows.map((r) => this.create(o, r))); },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async updateMany(_o: string, ast: any, data: Record<string, unknown>) {
      d.updateManyPayloads.push({ ...data });
      const rows = [...store.values()].filter((r) => matches(r, ast?.where));
      for (const r of rows) store.set(String(r.id), { ...r, ...data, id: r.id });
      return rows.length;
    },
    async deleteMany() { return 0; },
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return d;
}

const text = (name: string) => ({ name, label: name, type: 'text' as const });

/**
 * @param extraHook registered on the SAME event/object/priority as the stamp,
 *   so the engine's own read pattern is identical across §3's three arms.
 */
async function boot(opts: { stamp: boolean; extraHook?: (engine: any) => void } = { stamp: true }) {
  const engine: any = new ObjectQL();
  const driver = makeStubDriver();
  engine.registerDriver(driver, true);
  await engine.init();
  engine.registry.registerObject({
    name: OBJECT, label: OBJECT,
    fields: {
      id: { ...text('id'), primaryKey: true },
      managed_by: text('managed_by'),
      customized: { name: 'customized', label: 'customized', type: 'boolean' as const },
      label: text('label'),
    },
  });
  if (opts.stamp) bindRuleProvenanceStamp(engine, silentLogger);
  opts.extraHook?.(engine);
  return { engine, driver };
}

const ROWS = (bManagedBy: string) => ([
  { id: 'a', managed_by: 'package', customized: false, label: 'l' },
  { id: 'b', managed_by: bManagedBy, customized: false, label: 'l' },
]);

const PAYLOAD = { label: 'edited' };
const WHERE = { multi: true, where: { id: { $in: ['a', 'b'] } } } as any;

/* ── 1. every matched row is stamped ───────────────────────────────────── */

describe('[#15302] a predicate update stamps EVERY matched row', () => {
  it('stamps both rows in ONE `SET` clause - the "no `input.id`" guard is gone', async () => {
    const { engine, driver } = await boot();
    await engine.insert(OBJECT, ROWS('package'));
    driver.updateManyPayloads.length = 0;

    await engine.update(OBJECT, { ...PAYLOAD }, WHERE);

    // Both matched rows carry the stamp: the documented "not stamped on
    // multi-row updates" boundary never existed on this engine.
    expect([...driver.store.values()].map((r: any) => [r.id, r.customized]))
      .toEqual([['a', true], ['b', true]]);
    // ADR-0058 Addendum II D3: N rows share ONE payload, hence one clause.
    expect(driver.updateManyPayloads).toEqual([{ ...PAYLOAD, customized: true }]);
  });

  it('does not stamp when the pre-image is not package/platform managed', async () => {
    // The control for the assertion above: the stamp is a decision about the
    // ROW, so a run where no matched row qualifies must write no `customized`.
    const { engine, driver } = await boot();
    await engine.insert(OBJECT, [
      { id: 'a', managed_by: 'admin', customized: false, label: 'l' },
      { id: 'b', managed_by: 'user', customized: false, label: 'l' },
    ]);
    driver.updateManyPayloads.length = 0;

    await engine.update(OBJECT, { ...PAYLOAD }, WHERE);

    expect(driver.updateManyPayloads).toEqual([{ ...PAYLOAD }]);
    expect([...driver.store.values()].map((r: any) => r.customized)).toEqual([false, false]);
  });

  it('does not stamp an isSystem write (the seeder door)', async () => {
    const { engine, driver } = await boot();
    await engine.insert(OBJECT, ROWS('package'));
    driver.updateManyPayloads.length = 0;

    await engine.update(OBJECT, { ...PAYLOAD }, {
      ...WHERE, context: { isSystem: true, positions: [], permissions: [] },
    });

    expect(driver.updateManyPayloads).toEqual([{ ...PAYLOAD }]);
  });
});

/* ── 2. divergent rows: the engine refuses, and nothing is written ─────── */

describe('[#15302] matched rows that disagree refuse the batch', () => {
  it('refuses with the ADR-0112 envelope and writes nothing', async () => {
    const { engine, driver } = await boot();
    await engine.insert(OBJECT, ROWS('user'));
    driver.updateManyPayloads.length = 0;

    const err: any = await engine.update(OBJECT, { ...PAYLOAD }, WHERE).then(
      () => { throw new Error('expected the batch to be refused'); },
      (e: any) => e,
    );

    // Read the envelope by FIELD (`code` + `status`, the minimum a rejection
    // case asserts): a bare `toThrow()` would stay green against any error.
    expect(err.code).toBe('MULTI_UPDATE_HOOK_KEY_DIVERGENCE');
    expect(err.status).toBe(400);
    expect(err.keys).toEqual(['customized']);
    expect(err.rows).toBe(2);
    // The refusal is the SAFE side: no `SET` clause reached the driver and
    // both rows are untouched.
    expect(driver.updateManyPayloads).toEqual([]);
    expect([...driver.store.values()].map((r: any) => [r.customized, r.label]))
      .toEqual([[false, 'l'], [false, 'l']]);
  });
});

/* ── 3. the read count, with a control that fires ─────────────────────── */

describe('[#15302] the stamp issues NO read of its own', () => {
  /** Finds the engine issued on OBJECT during one predicate update. */
  async function findsDuringUpdate(opts: Parameters<typeof boot>[0]): Promise<number> {
    const { engine, driver } = await boot(opts);
    await engine.insert(OBJECT, ROWS('package'));
    driver.findCalls.length = 0;
    await engine.update(OBJECT, { ...PAYLOAD }, WHERE);
    return driver.findCalls.filter((c: any) => c.object === OBJECT).length;
  }

  it('adds zero finds, while the pre-#15302 shape adds one PER MATCHED ROW', async () => {
    // Arm C - an inert hook, registered identically, so the engine's own reads
    // (D7's single matched-row read) are held constant across the arms.
    const inert = (engine: any) => engine.registerHook('beforeUpdate', async () => {},
      { object: OBJECT, packageId: 'pin:15302-inert', priority: 150 });
    const baseline = await findsDuringUpdate({ stamp: false, extraHook: inert });

    // Arm A - the shipped stamp.
    const shipped = await findsDuringUpdate({ stamp: true });

    // Arm B - the CONTROL, and the "before" reading: a replica of the read
    // this card deleted, one `engine.find` per dispatch keyed on the row's id.
    const rereading = (engine: any) => engine.registerHook('beforeUpdate',
      async (ctx: any) => {
        await engine.find(OBJECT, {
          where: { id: ctx?.input?.id },
          fields: ['id', 'managed_by', 'customized'],
          limit: 1,
          context: { isSystem: true, positions: [], permissions: [] },
        });
      }, { object: OBJECT, packageId: 'pin:15302-control', priority: 150 });
    const withControl = await findsDuringUpdate({ stamp: false, extraHook: rereading });

    // The control FIRES: the instrument can see a per-row re-read, and it
    // costs exactly one find per matched row (2 rows ⇒ +2).
    expect(withControl - baseline).toBe(2);
    // And the shipped stamp costs none of them.
    expect(shipped).toBe(baseline);
  });
});
