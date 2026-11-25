// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#34672] A roll-up `summary` field is read-only on UPDATE and on CREATE
 * whether or not the author declared `readonly: true`.
 *
 * The engine computes a roll-up from its child rows and writes it through
 * `update()` under an `isSystem` context. Before this card the update's static
 * `readonly` strip read only the declared flag, so a person's `PATCH`, an
 * import with `writeMode: 'update'` or a predicate update stored the typed
 * value, and it was read downstream until the next child write recomputed it.
 * Now the update's schema view (`updateStaticReadonlySubject`) reads every
 * `summary` field as `readonly: true`. So the write is taken and reported as
 * `readonly`, and refused under `strictReadonlyWrites`, exactly as for a
 * roll-up the author did declare read-only (the control below).
 *
 * The create side (second describe) reads the same lock through the insert
 * view (`insertStaticReadonlySubject`): a person's or an import's starting
 * value is taken, reported as `readonly`, and the column is re-seeded as for an
 * empty child list (`staticReadonlyCreateStrip`), so it lands `0` for a `sum`,
 * never the typed value and never `null`. The re-seed also fixes the declared
 * `readonly: true` roll-up, which used to land `null` on such a create.
 *
 * Kept, each pinned here: the roll-up recompute's own write (`isSystem`), and
 * any other `isSystem` write of the column, on update and on create (historical
 * imports write as the system principal). A seed load never sends a roll-up
 * value: the seed loader takes it out first (#35655,
 * `seed-summary-never-stored.test.ts`).
 *
 * The REST and import doors, end to end over HTTP and SQLite:
 * `packages/rest/src/import-summary-update-lock-34672.test.ts`.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { DroppedFieldsEvent } from '@objectstack/spec/data';
import { ObjectQL } from './engine.js';
import { summaryFieldsLockedOnWrite } from './engine-top-level.js';
import { READONLY_FIELD_REJECTED_CODE } from './readonly-strict-errors.js';

function makeDriver() {
  const stores = new Map<string, Map<string, any>>();
  const storeFor = (o: string) => {
    let s = stores.get(o);
    if (!s) { s = new Map(); stores.set(o, s); }
    return s;
  };
  // Flat equality, `$and` and a field's `$in`: the shapes the roll-up
  // aggregate and the predicate update below send. Any other operator throws.
  const matches = (row: any, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    return Object.entries(where).every(([k, v]) => {
      if (k === '$and') return (v as any[]).every((sub) => matches(row, sub));
      if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        const ops = Object.keys(v);
        if (ops.length === 1 && ops[0] === '$in' && Array.isArray((v as any).$in)) return (v as any).$in.includes(row?.[k]);
        throw new Error(`fake driver: unsupported condition on ${k}: ${JSON.stringify(v)}`);
      }
      return row?.[k] === v;
    });
  };
  let n = 0;
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find(object: string, ast: any) {
      const rows = Array.from(storeFor(object).values()).filter((r) => matches(r, ast?.where));
      const page = typeof ast?.limit === 'number' ? rows.slice(0, ast.limit) : rows;
      return page.map((r) => ({ ...r }));
    },
    async findOne(object: string, ast: any) {
      for (const r of storeFor(object).values()) if (matches(r, ast?.where)) return { ...r };
      return null;
    },
    async create(object: string, data: Record<string, unknown>) {
      n += 1;
      const id = (data.id as string) ?? `r_${n}`;
      const row = { ...data, id };
      storeFor(object).set(id, row);
      return { ...row };
    },
    async update(object: string, id: string, data: Record<string, unknown>) {
      const s = storeFor(object);
      const row = { ...s.get(id), ...data, id };
      s.set(id, row);
      return { ...row };
    },
    async updateMany(object: string, ast: any, data: Record<string, unknown>) {
      const s = storeFor(object);
      let count = 0;
      for (const row of [...s.values()]) {
        if (!matches(row, ast?.where)) continue;
        s.set(row.id, { ...row, ...data, id: row.id });
        count += 1;
      }
      return count;
    },
    async delete(object: string, id: string) { return storeFor(object).delete(id); },
    async count() { return 0; },
    async bulkCreate(object: string, rows: Record<string, unknown>[]) {
      return Promise.all(rows.map((r) => this.create(object, r, undefined)));
    },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() { return { __trx: true, commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, storeFor };
}

const silentLogger: any = (() => {
  const l: any = { debug() {}, info() {}, error() {}, trace() {}, fatal() {}, warn() {}, child() { return l; } };
  return l;
})();

/** A signed-in person: not the system principal. */
const PERSON = { userId: 'u_rep' } as any;

async function rejection(p: Promise<unknown>): Promise<any> {
  try {
    await p;
  } catch (err) {
    return err;
  }
  throw new Error('expected the write to be refused, but it resolved');
}

const ACCOUNT = {
  name: 'acct',
  fields: {
    name: { type: 'text' },
    note: { type: 'text' },
    // The card's shape: a roll-up with no `readonly`.
    order_total: { type: 'summary', summaryOperations: { object: 'ord', field: 'amount', function: 'sum' } },
    // The control: the same roll-up, declared read-only by its author.
    order_total_ro: { type: 'summary', readonly: true, summaryOperations: { object: 'ord', field: 'amount', function: 'sum' } },
  },
};

const ORDER = {
  name: 'ord',
  fields: {
    amount: { type: 'number' },
    acct: { type: 'master_detail', reference: 'acct' },
  },
};

const ROLL_UP: DroppedFieldsEvent = { object: 'acct', fields: ['order_total'], reason: 'readonly' };

describe('[#34672] a roll-up summary without readonly: true is read-only on update', () => {
  let engine: ObjectQL;
  let storeFor: ReturnType<typeof makeDriver>['storeFor'];

  beforeEach(async () => {
    engine = new ObjectQL({ logger: silentLogger });
    const d = makeDriver();
    storeFor = d.storeFor;
    engine.registerDriver(d.driver, true);
    await engine.init();
    engine.registry.registerObject(ACCOUNT as any);
    engine.registry.registerObject(ORDER as any);
    const a = await engine.insert('acct', { id: 'a1', name: 'A' }, { context: PERSON } as any);
    const b = await engine.insert('acct', { id: 'a2', name: 'B' }, { context: PERSON } as any);
    await engine.insert('ord', { acct: a.id, amount: 10 }, { context: PERSON } as any);
    await engine.insert('ord', { acct: a.id, amount: 32 }, { context: PERSON } as any);
    await engine.insert('ord', { acct: b.id, amount: 5 }, { context: PERSON } as any);
  });

  const acct = (id: string) => storeFor('acct').get(id);

  it('the seeded roll-ups are the engine\'s (the baseline every case reads)', () => {
    expect(acct('a1')).toMatchObject({ order_total: 42, order_total_ro: 42 });
    expect(acct('a2')).toMatchObject({ order_total: 5, order_total_ro: 5 });
  });

  it('a by-id update (REST PATCH): the roll-up value is dropped and reported as readonly, the rest is written', async () => {
    const events: DroppedFieldsEvent[] = [];
    await engine.update(
      'acct',
      { id: 'a1', note: 'typed', order_total: 90 },
      { context: PERSON, onFieldsDropped: (e: DroppedFieldsEvent) => events.push(e) } as any,
    );
    expect(events).toEqual([ROLL_UP]);
    expect(acct('a1')).toMatchObject({ note: 'typed', order_total: 42 });
  });

  it('a predicate update (multi): the roll-up value is dropped from every matched row and reported once', async () => {
    const events: DroppedFieldsEvent[] = [];
    await engine.update(
      'acct',
      { note: 'bulk', order_total: 2 },
      { where: { id: { $in: ['a1', 'a2'] } }, multi: true, context: PERSON, onFieldsDropped: (e: DroppedFieldsEvent) => events.push(e) } as any,
    );
    expect(events).toEqual([ROLL_UP]);
    expect(acct('a1')).toMatchObject({ note: 'bulk', order_total: 42 });
    expect(acct('a2')).toMatchObject({ note: 'bulk', order_total: 5 });
  });

  it('under strictReadonlyWrites the update is refused and writes nothing, on both branches', async () => {
    const byId = await rejection(engine.update(
      'acct', { id: 'a1', note: 'typed', order_total: 90 },
      { context: PERSON, strictReadonlyWrites: true } as any,
    ));
    expect(byId.code).toBe(READONLY_FIELD_REJECTED_CODE);
    expect(byId.fields).toEqual(['order_total']);
    expect(byId.drops).toEqual([ROLL_UP]);
    expect(byId.operation).toBe('update');

    const multi = await rejection(engine.update(
      'acct', { note: 'bulk', order_total: 2 },
      { where: { id: { $in: ['a1', 'a2'] } }, multi: true, context: PERSON, strictReadonlyWrites: true } as any,
    ));
    expect(multi.code).toBe(READONLY_FIELD_REJECTED_CODE);
    expect(multi.fields).toEqual(['order_total']);

    expect(acct('a1')).toMatchObject({ order_total: 42 });
    expect(acct('a2')).toMatchObject({ order_total: 5 });
    expect([acct('a1').note, acct('a2').note]).toEqual([undefined, undefined]);
  });

  it('the update-mode preview (validate) reports the same drop the write makes', async () => {
    const events: DroppedFieldsEvent[] = [];
    const preview = await engine.validate(
      'acct', { id: 'a1', note: 'typed', order_total: 90 },
      { mode: 'update', context: PERSON, onFieldsDropped: (e: DroppedFieldsEvent) => events.push(e) },
    );
    expect(events).toEqual([ROLL_UP]);
    expect(preview.results[0]).toMatchObject({ valid: true, droppedFields: [ROLL_UP] });
  });

  it('the roll-up still recomputes after a refused write: the next child write lands the engine\'s value', async () => {
    await engine.update('acct', { id: 'a1', order_total: 90 }, { context: PERSON } as any);
    await engine.insert('ord', { acct: 'a1', amount: 8 }, { context: PERSON } as any);
    expect(acct('a1')).toMatchObject({ order_total: 50, order_total_ro: 50 });
  });

  it('an isSystem write of the column is kept, as for a declared readonly column (the recompute\'s exemption)', async () => {
    const events: DroppedFieldsEvent[] = [];
    await engine.update(
      'acct', { id: 'a1', order_total: 7 },
      { context: { isSystem: true }, onFieldsDropped: (e: DroppedFieldsEvent) => events.push(e) } as any,
    );
    expect(events).toEqual([]);
    expect(acct('a1')).toMatchObject({ order_total: 7 });
  });

  it('CONTROL: a roll-up declared readonly: true answers the same, and one payload naming both reports both once', async () => {
    const events: DroppedFieldsEvent[] = [];
    await engine.update(
      'acct', { id: 'a1', order_total: 1, order_total_ro: 1 },
      { context: PERSON, onFieldsDropped: (e: DroppedFieldsEvent) => events.push(e) } as any,
    );
    expect(events).toEqual([{ object: 'acct', fields: ['order_total', 'order_total_ro'], reason: 'readonly' }]);
    expect(acct('a1')).toMatchObject({ order_total: 42, order_total_ro: 42 });
  });

  // [#34672, insert half] This case pinned the opposite until the create side
  // was narrowed: a person's create kept `order_total: 7`. It now pins the
  // narrowed answer; the create side's own cases are in the describe below.
  it('INSERT is narrowed too: a person\'s starting value is dropped, reported, and the column seeded 0', async () => {
    const events: DroppedFieldsEvent[] = [];
    await engine.insert(
      'acct', { id: 'a3', name: 'C', order_total: 7 },
      { context: PERSON, onFieldsDropped: (e: DroppedFieldsEvent) => events.push(e) } as any,
    );
    expect(events).toEqual([ROLL_UP]);
    expect(acct('a3')).toMatchObject({ name: 'C', order_total: 0 });
  });
});

describe('[#34672] a roll-up summary is read-only on create: dropped, reported, seeded as for an empty child list', () => {
  let engine: ObjectQL;
  let storeFor: ReturnType<typeof makeDriver>['storeFor'];
  let creates: Array<Record<string, unknown>>;

  /** A sibling account whose roll-ups have no empty-set value (`max`). */
  const ACCOUNT_MAX = {
    name: 'acct_max',
    fields: {
      name: { type: 'text' },
      biggest: { type: 'summary', summaryOperations: { object: 'ord_max', field: 'amount', function: 'max' } },
    },
  };
  const ORDER_MAX = {
    name: 'ord_max',
    fields: { amount: { type: 'number' }, acct: { type: 'master_detail', reference: 'acct_max' } },
  };
  const BOTH: DroppedFieldsEvent = { object: 'acct', fields: ['order_total', 'order_total_ro'], reason: 'readonly' };

  beforeEach(async () => {
    engine = new ObjectQL({ logger: silentLogger });
    const d = makeDriver();
    storeFor = d.storeFor;
    creates = [];
    const create = d.driver.create.bind(d.driver);
    d.driver.create = async (object: string, data: Record<string, unknown>) => {
      if (object === 'acct' || object === 'acct_max') creates.push({ ...data });
      return create(object, data);
    };
    engine.registerDriver(d.driver, true);
    await engine.init();
    for (const o of [ACCOUNT, ORDER, ACCOUNT_MAX, ORDER_MAX]) engine.registry.registerObject(o as any);
  });

  const acct = (id: string) => storeFor('acct').get(id);
  const dropsOf = (events: DroppedFieldsEvent[]) => ({ context: PERSON, onFieldsDropped: (e: DroppedFieldsEvent) => events.push(e) }) as any;

  it('baseline: a person\'s create that names neither roll-up stores the seed, reports nothing', async () => {
    const events: DroppedFieldsEvent[] = [];
    await engine.insert('acct', { id: 'a1', name: 'A' }, dropsOf(events));
    expect(events).toEqual([]);
    expect(acct('a1')).toMatchObject({ order_total: 0, order_total_ro: 0 });
  });

  it('a person\'s create (REST POST): both values are dropped and reported, both columns land 0, the rest is stored', async () => {
    const events: DroppedFieldsEvent[] = [];
    const created = await engine.insert('acct', { id: 'a1', name: 'A', order_total: 90, order_total_ro: 90 }, dropsOf(events));
    expect(events).toEqual([BOTH]);
    expect(acct('a1')).toEqual({ id: 'a1', name: 'A', order_total: 0, order_total_ro: 0 });
    expect(created).toMatchObject({ order_total: 0, order_total_ro: 0 });
  });

  it('the declared readonly: true roll-up alone lands 0, not null (the re-seed after the strip)', async () => {
    // Before the re-seed the strip re-ran only `applyFieldDefaults`, so the
    // taken value left this column absent (null) while the write succeeded.
    const events: DroppedFieldsEvent[] = [];
    await engine.insert('acct', { id: 'a1', name: 'A', order_total_ro: 90 }, dropsOf(events));
    expect(events).toEqual([{ object: 'acct', fields: ['order_total_ro'], reason: 'readonly' }]);
    expect(creates).toEqual([{ id: 'a1', name: 'A', order_total: 0, order_total_ro: 0 }]);
  });

  it('a blank or null starting value is taken the same way and still lands 0', async () => {
    const events: DroppedFieldsEvent[] = [];
    await engine.insert('acct', { id: 'a1', name: 'A', order_total: null }, dropsOf(events));
    expect(events).toEqual([ROLL_UP]);
    expect(acct('a1')).toMatchObject({ order_total: 0, order_total_ro: 0 });
  });

  it('a batch create (array): every row\'s value is dropped and seeded, the union reported once', async () => {
    const events: DroppedFieldsEvent[] = [];
    await engine.insert('acct', [
      { id: 'a1', name: 'A', order_total: 90 },
      { id: 'a2', name: 'B' },
      { id: 'a3', name: 'C', order_total: 2 },
    ], dropsOf(events));
    expect(events).toEqual([ROLL_UP]);
    expect(['a1', 'a2', 'a3'].map((id) => acct(id)?.order_total)).toEqual([0, 0, 0]);
  });

  it('insertMany (the import commit): the row that sent a value carries droppedFields, the column lands 0', async () => {
    const outcomes = await engine.insertMany('acct', [
      { id: 'a1', name: 'A', order_total: 90 },
      { id: 'a2', name: 'B' },
    ], { context: PERSON } as any);
    expect(outcomes.map((o) => o.ok)).toEqual([true, true]);
    expect((outcomes[0] as any).droppedFields).toEqual([ROLL_UP]);
    expect((outcomes[1] as any).droppedFields ?? []).toEqual([]);
    expect([acct('a1')?.order_total, acct('a2')?.order_total]).toEqual([0, 0]);
  });

  it('under strictReadonlyWrites the create is refused and nothing is written', async () => {
    const err = await rejection(engine.insert(
      'acct', { id: 'a1', name: 'A', order_total: 90 },
      { context: PERSON, strictReadonlyWrites: true } as any,
    ));
    expect(err.code).toBe(READONLY_FIELD_REJECTED_CODE);
    expect(err.fields).toEqual(['order_total']);
    expect(err.drops).toEqual([ROLL_UP]);
    expect(err.operation).toBe('insert');
    expect(creates).toEqual([]);
  });

  it('the insert-mode preview (validate) reports the same drop the write makes', async () => {
    const events: DroppedFieldsEvent[] = [];
    const preview = await engine.validate(
      'acct', { id: 'a1', name: 'A', order_total: 90 },
      { mode: 'insert', context: PERSON, onFieldsDropped: (e: DroppedFieldsEvent) => events.push(e) },
    );
    expect(events).toEqual([ROLL_UP]);
    expect(preview.results[0]).toMatchObject({ valid: true, droppedFields: [ROLL_UP] });
    expect(creates).toEqual([]);
  });

  it('a beforeInsert hook is shown the seed, not the caller\'s value', async () => {
    const seen: unknown[] = [];
    engine.registerHook('beforeInsert', async (ctx: any) => {
      if (ctx.object === 'acct') seen.push(ctx.input.data.order_total);
    });
    await engine.insert('acct', { id: 'a1', name: 'A', order_total: 90 }, { context: PERSON } as any);
    expect(seen).toEqual([0]);
    expect(acct('a1')).toMatchObject({ order_total: 0 });
  });

  it('children already stored: the create lands the seed (0), not the typed value; the next child write recomputes', async () => {
    // Rows naming the parent before it exists (caller-chosen ids, as an
    // import keyed on an external id can produce), put straight in the store:
    // a child write through the engine would recompute a parent that is not
    // there yet. The true sum is 42.
    storeFor('ord').set('o1', { id: 'o1', acct: 'a9', amount: 10 });
    storeFor('ord').set('o2', { id: 'o2', acct: 'a9', amount: 32 });
    const events: DroppedFieldsEvent[] = [];
    await engine.insert('acct', { id: 'a9', name: 'Z', order_total: 90 }, dropsOf(events));
    expect(events).toEqual([ROLL_UP]);
    expect(acct('a9')).toMatchObject({ order_total: 0, order_total_ro: 0 });
    await engine.insert('ord', { acct: 'a9', amount: 8 }, { context: PERSON } as any);
    expect(acct('a9')).toMatchObject({ order_total: 50, order_total_ro: 50 });
  });

  it('an isSystem create keeps its value (historical imports; a seed load strips the key before the engine, #35655)', async () => {
    const events: DroppedFieldsEvent[] = [];
    await engine.insert(
      'acct', { id: 'a1', name: 'A', order_total: 90, order_total_ro: 90 },
      { context: { isSystem: true }, onFieldsDropped: (e: DroppedFieldsEvent) => events.push(e) } as any,
    );
    expect(events).toEqual([]);
    expect(acct('a1')).toMatchObject({ order_total: 90, order_total_ro: 90 });
  });

  it('preserveAudit on a non-system create is no exemption: dropped and seeded', async () => {
    const events: DroppedFieldsEvent[] = [];
    await engine.insert(
      'acct', { id: 'a1', name: 'A', order_total: 90 },
      { context: { ...PERSON, preserveAudit: true }, onFieldsDropped: (e: DroppedFieldsEvent) => events.push(e) } as any,
    );
    expect(events).toEqual([ROLL_UP]);
    expect(acct('a1')).toMatchObject({ order_total: 0 });
  });

  it('a roll-up with no empty-set value (max) is dropped and stays empty, as on any create', async () => {
    const events: DroppedFieldsEvent[] = [];
    await engine.insert('acct_max', { id: 'm1', name: 'M', biggest: 77 }, dropsOf(events));
    expect(events).toEqual([{ object: 'acct_max', fields: ['biggest'], reason: 'readonly' }]);
    expect(storeFor('acct_max').get('m1')?.biggest ?? null).toBeNull();
  });

  it('a sys_ object is outside the create lock, as it is outside the insert strip', async () => {
    engine.registry.registerObject({
      name: 'sys_tally',
      fields: { total: { type: 'summary', summaryOperations: { object: 'ord', field: 'amount', function: 'sum' } } },
    } as any);
    const events: DroppedFieldsEvent[] = [];
    await engine.insert('sys_tally', { id: 's1', total: 5 }, dropsOf(events));
    expect(events).toEqual([]);
    expect(storeFor('sys_tally').get('s1')).toMatchObject({ total: 5 });
  });
});

describe('[#34672] summaryFieldsLockedOnWrite', () => {
  it('names each summary field not declared readonly, and nothing else', () => {
    expect(summaryFieldsLockedOnWrite(ACCOUNT)).toEqual(['order_total']);
    expect(summaryFieldsLockedOnWrite(ORDER)).toEqual([]);
  });

  it('answers empty for a schema with no field map', () => {
    expect(summaryFieldsLockedOnWrite(undefined)).toEqual([]);
    expect(summaryFieldsLockedOnWrite({ fields: [] })).toEqual([]);
  });
});
