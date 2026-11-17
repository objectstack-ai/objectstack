// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#34672] A roll-up `summary` field is read-only on UPDATE whether or not the
 * author declared `readonly: true`.
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
 * Kept as before, each pinned here:
 *  - the roll-up recompute's own write (`isSystem`), and any other `isSystem`
 *    write of the column;
 *  - a caller's initial value on INSERT (seed data, a historical import), the
 *    boundary the `summary` note on `RUNTIME_OWNED_FIELD_TYPES` draws.
 *
 * The import door, end to end over HTTP and SQLite:
 * `packages/rest/src/import-summary-update-lock-34672.test.ts`.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { DroppedFieldsEvent } from '@objectstack/spec/data';
import { ObjectQL } from './engine.js';
import { summaryFieldsLockedOnUpdate } from './engine-top-level.js';
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

  it('INSERT is not narrowed: a caller\'s initial value is kept (seed data, a historical import)', async () => {
    const events: DroppedFieldsEvent[] = [];
    await engine.insert(
      'acct', { id: 'a3', name: 'C', order_total: 7 },
      { context: PERSON, onFieldsDropped: (e: DroppedFieldsEvent) => events.push(e) } as any,
    );
    expect(events).toEqual([]);
    expect(acct('a3')).toMatchObject({ order_total: 7 });
  });
});

describe('[#34672] summaryFieldsLockedOnUpdate', () => {
  it('names each summary field not declared readonly, and nothing else', () => {
    expect(summaryFieldsLockedOnUpdate(ACCOUNT)).toEqual(['order_total']);
    expect(summaryFieldsLockedOnUpdate(ORDER)).toEqual([]);
  });

  it('answers empty for a schema with no field map', () => {
    expect(summaryFieldsLockedOnUpdate(undefined)).toEqual([]);
    expect(summaryFieldsLockedOnUpdate({ fields: [] })).toEqual([]);
  });
});
