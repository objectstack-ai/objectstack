// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21613] The rows a write verb hands back — and the prior-read rows it binds
 * as `previous` — carry only the object's DECLARED fields plus the
 * platform-provisioned columns, whatever the driver returned. The write-side
 * half of #21571's default projection, decided in the same place: the engine,
 * on the rows as the driver returned them, with `declared-read-columns.ts`.
 *
 * ## The driver shape this pins against
 *
 * A SQL table's write verbs answer with every physical column: driver-sql
 * builds create's row from `returning('*')` and update's from a `select *`
 * readback. A column no metadata declares — a field retired in an upgrade,
 * whose column additive sync leaves in the table — therefore rode back on
 * every write: with its stored value on an update, as `null` on a new row.
 * The store driver below behaves exactly that way: `rq_contact`'s physical
 * columns include `mailing_street` / `mailing_city`, which the current
 * declaration retired.
 *
 * ## What each case measures
 *
 * Every write verb that returns a row, every carrier of a write result the
 * engine produces (the hooks' `result` and `previous`, the data event), the
 * protocol doors built on them, and the declared treatment that must not
 * move: an `internal: true` field stays WHOLE on the engine-level result (the
 * A-prime ruling — the door strips it, not the engine) and a formula is still
 * hydrated onto the result.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';

import { ObjectQL } from './engine.js';

type Row = Record<string, unknown>;

const CONTACT = 'rq_contact';
const RETIRED = ['mailing_street', 'mailing_city'] as const;

/** A SQL-shaped store: every write answers with the whole stored row. */
function makeSqlShapedStore() {
  const tables = new Map<string, Map<string, Row>>();
  const tableFor = (o: string): Map<string, Row> => {
    let t = tables.get(o);
    if (!t) { t = new Map<string, Row>(); tables.set(o, t); }
    return t;
  };
  /** The table's physical columns: the retired pair is still among them. */
  const physical = (o: string): string[] => (o === CONTACT ? [...RETIRED] : []);
  const matches = (row: Row, where: Row | undefined): boolean => {
    if (!where) return true;
    for (const [k, v] of Object.entries(where)) {
      if (k.startsWith('$')) continue;
      if (v !== null && typeof v === 'object' && '$in' in (v as Row)) {
        if (!((v as { $in: unknown[] }).$in).includes(row[k])) return false;
        continue;
      }
      if ((row[k] ?? null) !== (v ?? null)) return false;
    }
    return true;
  };
  const run = (o: string, ast?: { where?: Row; limit?: number }): Row[] => {
    const rows = Array.from(tableFor(o).values()).filter((r) => matches(r, ast?.where));
    // The caller's bound, after the filter, by presence.
    const page = typeof ast?.limit === 'number' ? rows.slice(0, ast.limit) : rows;
    return page.map((r) => ({ ...r }));
  };
  let seq = 0;
  const driver = {
    name: 'store-sql-shaped', version: '0.0.0', supports: {},
    async connect(): Promise<void> {},
    async disconnect(): Promise<void> {},
    async checkHealth(): Promise<boolean> { return true; },
    async execute(): Promise<null> { return null; },
    async find(o: string, ast?: { where?: Row; limit?: number }): Promise<Row[]> { return run(o, ast); },
    async findOne(o: string, ast?: { where?: Row; limit?: number }): Promise<Row | null> { return run(o, ast)[0] ?? null; },
    async create(o: string, data: Row): Promise<Row> {
      seq += 1;
      // `returning('*')`: every physical column, an unwritten one null.
      const row: Row = { ...Object.fromEntries(physical(o).map((c) => [c, null])), ...data, id: data.id ?? `new_${seq}` };
      tableFor(o).set(String(row.id), row);
      return { ...row };
    },
    async bulkCreate(o: string, rows: Row[]): Promise<Row[]> {
      const out: Row[] = [];
      for (const r of rows) out.push(await driver.create(o, r));
      return out;
    },
    async update(o: string, id: string, data: Row): Promise<Row | null> {
      const cur = tableFor(o).get(id);
      if (!cur) return null;
      const next: Row = { ...cur, ...data, id };
      tableFor(o).set(id, next);
      // The post-write readback: `select *`.
      return { ...next };
    },
    async updateMany(o: string, ast: { where?: Row }, data: Row): Promise<number> {
      const rows = run(o, ast);
      for (const r of rows) tableFor(o).set(String(r.id), { ...tableFor(o).get(String(r.id)), ...data });
      return rows.length;
    },
    async delete(o: string, id: string): Promise<boolean> { return tableFor(o).delete(id); },
    async deleteMany(o: string, ast: { where?: Row }): Promise<number> {
      const rows = run(o, ast);
      for (const r of rows) tableFor(o).delete(String(r.id));
      return rows.length;
    },
    async count(o: string, ast?: { where?: Row }): Promise<number> { return run(o, ast).length; },
  };
  return {
    driver,
    seed: (o: string, row: Row) => { tableFor(o).set(String(row.id), { ...row }); },
    stored: (o: string, id: string) => tableFor(o).get(id),
  };
}

async function boot() {
  const engine = new ObjectQL();
  const store = makeSqlShapedStore();
  engine.registerDriver(store.driver as never, true);
  await engine.init();
  engine.registry.registerObject({
    name: CONTACT,
    label: 'Contact',
    fields: {
      name: { type: 'text' },
      email: { type: 'text' },
      score: { type: 'number' },
      token: { type: 'text', internal: true },
      double_score: { type: 'formula', expression: { dialect: 'cel', source: 'record.score * 2' } },
    },
  } as never, 'test');
  for (const [id, email] of [['con_1', 'ada@x'], ['con_2', 'bulk@x'], ['con_3', 'bulk@x'], ['con_4', 'gone@x']] as const) {
    store.seed(CONTACT, {
      id, name: id, email, score: 21, token: `hash_${id}`,
      mailing_street: `${id} Retired Way`, mailing_city: 'Oldtown',
    });
  }
  const published: Array<{ type: string; payload: Row }> = [];
  engine.setRealtimeService({
    publish: async (e: { type: string; payload: Row }) => { published.push(e); },
    subscribe: async () => 'sub',
    unsubscribe: async () => undefined,
  } as never);
  const hooks: Array<{ event: string; id: unknown; previous: unknown; result: unknown }> = [];
  for (const event of ['beforeUpdate', 'afterUpdate', 'beforeDelete', 'afterDelete', 'afterInsert']) {
    engine.registerHook(event, async (ctx: any) => {
      hooks.push({ event, id: ctx.input?.id, previous: ctx.previous, result: ctx.result });
    }, { object: CONTACT });
  }
  return { engine, store, published, hooks, protocol: new ObjectStackProtocolImplementation(engine as never) };
}

function expectDeclaredOnly(row: unknown): void {
  expect(row).toBeTruthy();
  expect(typeof row).toBe('object');
  for (const retired of RETIRED) expect(Object.keys(row as Row)).not.toContain(retired);
}

describe('[#21613] a write\'s returned row serves the declared fields only', () => {
  let h: Awaited<ReturnType<typeof boot>>;
  beforeEach(async () => { h = await boot(); });

  it('the fixture is real: the driver answers a write with the retired columns', async () => {
    expect(await h.store.driver.update(CONTACT, 'con_1', { name: 'raw' })).toMatchObject({ mailing_street: 'con_1 Retired Way' });
    expect(await h.store.driver.create(CONTACT, { id: 'raw_new', name: 'raw' })).toMatchObject({ mailing_street: null });
  });

  it('verb: insert, one row', async () => {
    const row = await h.engine.insert(CONTACT, { id: 'n1', name: 'New', score: 1 });
    expect(row).toMatchObject({ id: 'n1', name: 'New' });
    expectDeclaredOnly(row);
  });

  it('verb: insert, a batch', async () => {
    const rows = await h.engine.insert(CONTACT, [{ id: 'n1', name: 'A' }, { id: 'n2', name: 'B' }]);
    expect(rows.map((r: Row) => r.id)).toEqual(['n1', 'n2']);
    for (const row of rows) expectDeclaredOnly(row);
  });

  it('verb: insertMany — each ok outcome\'s record', async () => {
    const outcomes = await h.engine.insertMany(CONTACT, [{ id: 'n1', name: 'A' }]);
    expect(outcomes[0]).toMatchObject({ ok: true, record: { id: 'n1', name: 'A' } });
    expectDeclaredOnly((outcomes[0] as { record: Row }).record);
  });

  it('verb: update by id — the readback', async () => {
    const row = await h.engine.update(CONTACT, { id: 'con_1', name: 'Ada 2' });
    expect(row).toMatchObject({ id: 'con_1', name: 'Ada 2', email: 'ada@x' });
    expectDeclaredOnly(row);
  });

  it('hooks: update by id binds a declared `previous` and `result`, both phases', async () => {
    await h.engine.update(CONTACT, { id: 'con_1', name: 'Ada 2' });
    const before = h.hooks.find((x) => x.event === 'beforeUpdate');
    const after = h.hooks.find((x) => x.event === 'afterUpdate');
    expect(before?.previous).toMatchObject({ id: 'con_1', name: 'con_1' });
    expectDeclaredOnly(before?.previous);
    expect(after?.previous).toMatchObject({ id: 'con_1', name: 'con_1' });
    expectDeclaredOnly(after?.previous);
    expect(after?.result).toMatchObject({ id: 'con_1', name: 'Ada 2' });
    expectDeclaredOnly(after?.result);
  });

  it('hooks: a predicate update\'s per-row `previous` and composed `result`', async () => {
    const count = await h.engine.update(CONTACT, { name: 'bulk' } as never, { where: { email: 'bulk@x' }, multi: true } as never);
    expect(count).toBe(2);
    const perRow = h.hooks.filter((x) => x.event === 'afterUpdate');
    expect(perRow.map((x) => x.id).sort()).toEqual(['con_2', 'con_3']);
    for (const x of perRow) {
      expect(x.result).toMatchObject({ name: 'bulk' });
      expectDeclaredOnly(x.previous);
      expectDeclaredOnly(x.result);
    }
  });

  it('hooks: delete by id and by predicate bind a declared `previous`', async () => {
    await h.engine.delete(CONTACT, { where: { id: 'con_4' } } as never);
    await h.engine.delete(CONTACT, { where: { email: 'bulk@x' }, multi: true } as never);
    const afterDelete = h.hooks.filter((x) => x.event === 'afterDelete');
    expect(afterDelete.map((x) => x.id).sort()).toEqual(['con_2', 'con_3', 'con_4']);
    for (const x of afterDelete) {
      expect(x.previous).toMatchObject({ email: expect.any(String) });
      expectDeclaredOnly(x.previous);
    }
  });

  it('events: data.record.created and data.record.updated carry the declared record as `after`', async () => {
    await h.engine.insert(CONTACT, { id: 'n1', name: 'New' });
    await h.engine.update(CONTACT, { id: 'con_1', name: 'Ada 2' });
    const created = h.published.find((e) => e.type === 'data.record.created');
    const updated = h.published.find((e) => e.type === 'data.record.updated');
    expect(created?.payload).toMatchObject({ recordId: 'n1', after: { id: 'n1', name: 'New' } });
    expectDeclaredOnly(created?.payload.after);
    expect(updated?.payload).toMatchObject({ recordId: 'con_1', after: { id: 'con_1', name: 'Ada 2' } });
    expectDeclaredOnly(updated?.payload.after);
  });

  it('doors: createData, updateData and cloneData answer the declared record', async () => {
    const created: any = await h.protocol.createData({ object: CONTACT, data: { id: 'n1', name: 'New' } });
    expect(created.record).toMatchObject({ id: 'n1', name: 'New' });
    expectDeclaredOnly(created.record);
    const updated: any = await h.protocol.updateData({ object: CONTACT, id: 'con_1', data: { name: 'Ada 2' } });
    expect(updated.record).toMatchObject({ id: 'con_1', name: 'Ada 2' });
    expectDeclaredOnly(updated.record);
    const cloned: any = await h.protocol.cloneData({ object: CONTACT, id: 'con_1', overrides: { name: 'Ada copy' } });
    expect(cloned.record).toMatchObject({ name: 'Ada copy' });
    expectDeclaredOnly(cloned.record);
  });

  it('declared fields keep their treatment: `internal` whole on the engine result, stripped at the door; formula hydrated', async () => {
    const engineRow = await h.engine.update(CONTACT, { id: 'con_1', name: 'Ada 2' });
    // A-prime: the privileged writer that just wrote the row gets it whole.
    expect(engineRow).toMatchObject({ token: 'hash_con_1', double_score: 42 });
    const doorRow: any = await h.protocol.updateData({ object: CONTACT, id: 'con_1', data: { name: 'Ada 3' } });
    expect(doorRow.record).toMatchObject({ id: 'con_1', name: 'Ada 3', double_score: 42 });
    expect(doorRow.record).not.toHaveProperty('token');
  });

  it('the driver\'s stored row is never mutated by the shaping', async () => {
    await h.engine.update(CONTACT, { id: 'con_1', name: 'Ada 2' });
    expect(h.store.stored(CONTACT, 'con_1')).toMatchObject({ name: 'Ada 2', mailing_street: 'con_1 Retired Way' });
  });
});
