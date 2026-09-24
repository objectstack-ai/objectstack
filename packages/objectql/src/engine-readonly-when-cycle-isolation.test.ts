// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #19929 — a `readonlyWhen` cycle no longer over-locks the rest of the update.
//
// One update touches the #19927 chain (`c` locked by `previous.c == 'L'`, `x`
// by `record.c == 'open'`, `y` by `record.x == 'xv'`, on a row with `c: 'L'`)
// and a two-lock cycle (`a` locked by `record.b == 'x'`, `b` by `record.a ==
// 'old_a'`, on a row `{ a: 'old_a', b: 'y' }`) that has no drop set agreeing
// with the row. On its own the chain settles at `{c, y}` and `x` lands. The
// settlement (`settleReadonlyWhenDrops`) searched ONE drop set for the whole
// update, and when the cycle kept that search from settling it fell back to
// the fixpoint's larger set for every field, so all five dropped: `x` too,
// although it is in no cycle and its lock is FALSE on the row the write
// stores. The same happened beside a cycle with two agreeing sets.
//
// The locks are now judged in the order they read each other: a lock after
// the locks whose fields it reads, and the locks that read each other in a
// cycle together, with the fixpoint, the release rounds and the fail-safe
// fallback confined to that cycle. So a field is dropped while its lock is
// FALSE on the stored row only when the field is in such a cycle.
//
// Every expected row below was checked against a brute-force enumeration of
// the drop sets that agree with the row, per group of locks that read each
// other. #19911's and #19927's suites
// (`engine-readonly-when-interdependent-locks.test.ts`,
// `engine-readonly-when-exact-drop-set.test.ts`) are unchanged.
//
// Real engine, the #19911 suite's in-memory driver shape; by-id and bulk.

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectQL } from './engine.js';
import { stripReadonlyWhenFields, stripReadonlyWhenFieldsMulti } from './validation/rule-validator.js';

function makeDriver() {
  const stores = new Map<string, Map<string, any>>();
  const storeFor = (o: string) => {
    let s = stores.get(o);
    if (!s) { s = new Map(); stores.set(o, s); }
    return s;
  };
  const checkOp = (value: any, cond: any): boolean => {
    if (cond === null || typeof cond !== 'object' || Array.isArray(cond) || cond instanceof Date) {
      return value === cond;
    }
    return Object.entries(cond).every(([op, target]: [string, any]) => {
      switch (op) {
        case '$eq': return value === target;
        case '$ne': return value !== target;
        case '$in': return Array.isArray(target) && target.includes(value);
        default: return true;
      }
    });
  };
  const matches = (row: any, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    return Object.entries(where).every(([k, v]: [string, any]) => {
      if (k === '$and') return (v as any[]).every((w) => matches(row, w));
      if (k === '$or') return (v as any[]).some((w) => matches(row, w));
      if (k === '$not') return !matches(row, v);
      return checkOp(row?.[k], v);
    });
  };
  let n = 0;
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find(object: string, ast: any) {
      const rows = Array.from(storeFor(object).values()).filter((r) => matches(r, ast?.where));
      return typeof ast?.limit === 'number' ? rows.slice(0, ast.limit) : rows;
    },
    async findOne(object: string, ast: any) {
      for (const r of storeFor(object).values()) if (matches(r, ast?.where)) return r;
      return null;
    },
    async create(object: string, data: Record<string, unknown>) {
      n += 1;
      const id = (data.id as string) ?? `r_${n}`;
      const row = { ...data, id };
      storeFor(object).set(id, row);
      return row;
    },
    async update(object: string, id: string, data: Record<string, unknown>) {
      const s = storeFor(object);
      const row = { ...s.get(id), ...data, id };
      s.set(id, row);
      return row;
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

// The #19927 chain, and the two cycles #19927's suite pins on their own.
const CHAIN = {
  c: { type: 'text', readonlyWhen: "previous.c == 'L'" },
  x: { type: 'text', readonlyWhen: "record.c == 'open'" },
  y: { type: 'text', readonlyWhen: "record.x == 'xv'" },
};
const CYCLE_NONE = {
  a: { type: 'text', readonlyWhen: "record.b == 'x'" },
  b: { type: 'text', readonlyWhen: "record.a == 'old_a'" },
};
const CYCLE_TWO = {
  a: { type: 'text', readonlyWhen: "record.b == 'new_b'" },
  b: { type: 'text', readonlyWhen: "record.a == 'new_a'" },
};
const CHAIN_ROW = { c: 'L', x: 'old', y: 'old' };
const CHAIN_WRITE = { c: 'open', x: 'xv', y: 'yv' };
const NONE_ROW = { a: 'old_a', b: 'y' };
const NONE_WRITE = { a: 'new_a', b: 'x' };

describe('a readonlyWhen cycle no longer over-locks the rest of the update (#19929)', () => {
  let engine: ObjectQL;
  let storeFor: ReturnType<typeof makeDriver>['storeFor'];
  let warns: string[];

  beforeEach(async () => {
    warns = [];
    const logger: any = {
      warn: (m: string) => warns.push(String(m)),
      debug() {}, info() {}, error() {}, trace() {}, fatal() {},
      child() { return logger; },
    };
    engine = new ObjectQL({ logger });
    const d = makeDriver();
    storeFor = d.storeFor;
    engine.registerDriver(d.driver, true);
    await engine.init();
    // THE CARD: the chain beside a cycle with no agreeing drop set.
    engine.registry.registerObject({
      name: 'beside_none',
      fields: { ...CHAIN, ...CYCLE_NONE, tag: { type: 'text' } },
    } as any);
    // THE CARD's second shape: beside a cycle with two agreeing sets, {a}
    // and {b}, which the release rounds reach neither of.
    engine.registry.registerObject({
      name: 'beside_two',
      fields: { ...CHAIN, ...CYCLE_TWO, tag: { type: 'text' } },
    } as any);
    // Declaration-order control: the cycle declared ahead of the chain.
    engine.registry.registerObject({
      name: 'beside_none_first',
      fields: { ...CYCLE_NONE, ...CHAIN, tag: { type: 'text' } },
    } as any);
    // The cycle READS the chain: `a` also needs `x == 'xv'`. The five locks
    // are now one connected group, and `x` is still in no cycle: it is judged
    // before the cycle, whose own locks then read the `x` the row takes.
    engine.registry.registerObject({
      name: 'into_cycle',
      fields: {
        ...CHAIN,
        a: { type: 'text', readonlyWhen: "record.b == 'x' && record.x == 'xv'" },
        b: { type: 'text', readonlyWhen: "record.a == 'old_a'" },
        tag: { type: 'text' },
      },
    } as any);
    // Locks that READ the cycle: judged after it, against the values its
    // fail-safe drops keep on the row. `z` is unlocked there and lands; `w`
    // is locked there and drops.
    engine.registry.registerObject({
      name: 'out_of_cycle',
      fields: {
        ...CYCLE_NONE,
        z: { type: 'text', readonlyWhen: "record.a == 'new_a'" },
        w: { type: 'text', readonlyWhen: "record.a == 'old_a'" },
        tag: { type: 'text' },
      },
    } as any);
    // The same two locks read through an index, not a field select. What a
    // lock reads is decided from its predicate's source, and a read the
    // source does not spell as `record.<field>` counts as reading every
    // field: `w` must still be judged after the cycle, or it would land
    // against the `a` the row does not keep.
    engine.registry.registerObject({
      name: 'index_read',
      fields: {
        ...CYCLE_NONE,
        z: { type: 'text', readonlyWhen: "record['a'] == 'new_a'" },
        w: { type: 'text', readonlyWhen: "record['a'] == 'old_a'" },
        tag: { type: 'text' },
      },
    } as any);
    // #19927's master-detail cascade, beside the cycle: the FK's own lock
    // is settled with the chain, not given up with the cycle.
    engine.registry.registerObject({ name: 'hdr', fields: { status: { type: 'text' } } } as any);
    engine.registry.registerObject({
      name: 'line_beside',
      fields: {
        c: { type: 'text', readonlyWhen: "previous.c == 'L'" },
        invoice: { type: 'master_detail', reference: 'hdr', readonlyWhen: "record.c == 'open'" },
        y: { type: 'text', readonlyWhen: "record.invoice == 'h_open'" },
        amt: { type: 'text', readonlyWhen: "parent.status == 'paid'" },
        ...CYCLE_NONE,
        tag: { type: 'text' },
      },
    } as any);

    for (const id of ['n1', 'n2']) {
      storeFor('beside_none').set(id, { id, ...CHAIN_ROW, ...NONE_ROW, tag: 't' });
      storeFor('beside_none_first').set(id, { id, ...CHAIN_ROW, ...NONE_ROW, tag: 't' });
      storeFor('into_cycle').set(id, { id, ...CHAIN_ROW, ...NONE_ROW, tag: 't' });
      storeFor('out_of_cycle').set(id, { id, ...NONE_ROW, z: 'old', w: 'old', tag: 't' });
      storeFor('index_read').set(id, { id, ...NONE_ROW, z: 'old', w: 'old', tag: 't' });
    }
    storeFor('beside_two').set('w1', { id: 'w1', ...CHAIN_ROW, a: 'old', b: 'old', tag: 't' });
    storeFor('beside_two').set('w2', { id: 'w2', ...CHAIN_ROW, a: 'old', b: 'old', tag: 't' });
    storeFor('hdr').set('h_paid', { id: 'h_paid', status: 'paid' });
    storeFor('hdr').set('h_open', { id: 'h_open', status: 'open' });
    for (const id of ['l1', 'l2']) {
      storeFor('line_beside').set(id, { id, c: 'L', invoice: 'h_paid', y: 'old', amt: 'a0', ...NONE_ROW, tag: 't' });
    }
  });

  const row = (object: string, id: string) => storeFor(object).get(id);
  const bulk = (extra: Record<string, unknown> = {}) => ({ where: { tag: 't' }, multi: true, ...extra } as any);

  async function rejection(p: Promise<unknown>): Promise<any> {
    try {
      await p;
    } catch (err) {
      return err;
    }
    throw new Error('expected the write to be refused, but it resolved');
  }

  function dropEvents(): { events: any[]; options: any } {
    const events: any[] = [];
    return { events, options: { onFieldsDropped: (e: any) => events.push(e) } };
  }

  /** Every header id the write reads, in order (single-id and batched reads). */
  function recordHeaderReads(): unknown[] {
    const reads: unknown[] = [];
    const findOne = (engine as any).findOne.bind(engine);
    (engine as any).findOne = async (name: string, q: any, o?: any) => {
      if (name === 'hdr') reads.push(q?.where?.id);
      return findOne(name, q, o);
    };
    return reads;
  }

  // ── The card ──────────────────────────────────────────────────────────

  it('THE CARD: beside a cycle with no agreeing set, x lands; c and y drop, and the cycle holds (fail-safe)', async () => {
    const { events, options } = dropEvents();
    await engine.update('beside_none', { id: 'n1', ...CHAIN_WRITE, ...NONE_WRITE }, options);
    expect(row('beside_none', 'n1')).toMatchObject({ c: 'L', x: 'xv', y: 'old', a: 'old_a', b: 'y' });
    expect(events).toEqual([{ object: 'beside_none', fields: ['c', 'y', 'a', 'b'], reason: 'readonly_when' }]);
    expect(warns.filter((w) => w.includes('is read-only (readonlyWhen)'))).toEqual([
      "Field 'c' is read-only (readonlyWhen) — ignoring incoming change",
      "Field 'y' is read-only (readonlyWhen) — ignoring incoming change",
      "Field 'a' is read-only (readonlyWhen) — ignoring incoming change",
      "Field 'b' is read-only (readonlyWhen) — ignoring incoming change",
    ]);
  });

  it('THE CARD in BULK: every matched row takes x, and keeps c, y and the cycle', async () => {
    const { events, options } = dropEvents();
    await engine.update('beside_none', { ...CHAIN_WRITE, ...NONE_WRITE }, bulk(options));
    for (const id of ['n1', 'n2']) {
      expect(row('beside_none', id)).toMatchObject({ c: 'L', x: 'xv', y: 'old', a: 'old_a', b: 'y' });
    }
    expect(events).toEqual([{ object: 'beside_none', fields: ['c', 'y', 'a', 'b'], reason: 'readonly_when' }]);
  });

  it('THE CARD under strictReadonlyWrites: refused, naming the four locked fields and not x, and nothing lands', async () => {
    const err = await rejection(
      engine.update('beside_none', { id: 'n1', ...CHAIN_WRITE, ...NONE_WRITE }, { strictReadonlyWrites: true } as any),
    );
    expect(err.code).toBe('ERR_READONLY_FIELD_REJECTED');
    expect(err.fields).toEqual(['c', 'y', 'a', 'b']);
    expect(row('beside_none', 'n1')).toMatchObject({ ...CHAIN_ROW, ...NONE_ROW });
  });

  it('THE CARD for an isSystem caller: the locks bind it the same way', async () => {
    await engine.update('beside_none', { id: 'n1', ...CHAIN_WRITE, ...NONE_WRITE }, { context: { isSystem: true } } as any);
    expect(row('beside_none', 'n1')).toMatchObject({ c: 'L', x: 'xv', y: 'old', a: 'old_a', b: 'y' });
  });

  it('THE CARD beside a cycle with two agreeing sets, {a} and {b}: x lands, and the cycle holds (fail-safe)', async () => {
    const { events, options } = dropEvents();
    await engine.update('beside_two', { id: 'w1', ...CHAIN_WRITE, a: 'new_a', b: 'new_b' }, options);
    expect(row('beside_two', 'w1')).toMatchObject({ c: 'L', x: 'xv', y: 'old', a: 'old', b: 'old' });
    expect(events).toEqual([{ object: 'beside_two', fields: ['c', 'y', 'a', 'b'], reason: 'readonly_when' }]);
  });

  it('THE CARD beside two agreeing sets, in BULK', async () => {
    await engine.update('beside_two', { ...CHAIN_WRITE, a: 'new_a', b: 'new_b' }, bulk());
    for (const id of ['w1', 'w2']) {
      expect(row('beside_two', id)).toMatchObject({ c: 'L', x: 'xv', y: 'old', a: 'old', b: 'old' });
    }
  });

  it('no order matters: the cycle declared first, and the payload keys reversed, give the same row', async () => {
    const { events, options } = dropEvents();
    const payload = Object.fromEntries(Object.entries({ ...CHAIN_WRITE, ...NONE_WRITE }).reverse());
    await engine.update('beside_none_first', { id: 'n1', ...payload }, options);
    expect(row('beside_none_first', 'n1')).toMatchObject({ c: 'L', x: 'xv', y: 'old', a: 'old_a', b: 'y' });
    // The same four drops, listed in the payload's key order, as the event
    // always has (`reportDroppedFields` walks the payload).
    expect(events).toEqual([{ object: 'beside_none_first', fields: ['b', 'a', 'y', 'c'], reason: 'readonly_when' }]);
  });

  // ── One connected group: a cycle that reads the chain, locks that read the cycle

  it('a cycle that READS x: x is in no cycle, so it still lands, and the cycle judges the x the row takes', async () => {
    const { events, options } = dropEvents();
    await engine.update('into_cycle', { id: 'n1', ...CHAIN_WRITE, ...NONE_WRITE }, options);
    expect(row('into_cycle', 'n1')).toMatchObject({ c: 'L', x: 'xv', y: 'old', a: 'old_a', b: 'y' });
    expect(events).toEqual([{ object: 'into_cycle', fields: ['c', 'y', 'a', 'b'], reason: 'readonly_when' }]);
  });

  it('a cycle that READS x, in BULK', async () => {
    await engine.update('into_cycle', { ...CHAIN_WRITE, ...NONE_WRITE }, bulk());
    for (const id of ['n1', 'n2']) {
      expect(row('into_cycle', id)).toMatchObject({ c: 'L', x: 'xv', y: 'old', a: 'old_a', b: 'y' });
    }
  });

  it('locks that READ the cycle are judged against the a it keeps: z (unlocked there) lands, w (locked there) drops', async () => {
    const { events, options } = dropEvents();
    await engine.update('out_of_cycle', { id: 'n1', ...NONE_WRITE, z: 'zv', w: 'wv' }, options);
    expect(row('out_of_cycle', 'n1')).toMatchObject({ a: 'old_a', b: 'y', z: 'zv', w: 'old' });
    expect(events).toEqual([{ object: 'out_of_cycle', fields: ['a', 'b', 'w'], reason: 'readonly_when' }]);
  });

  it('locks that READ the cycle, in BULK', async () => {
    await engine.update('out_of_cycle', { ...NONE_WRITE, z: 'zv', w: 'wv' }, bulk());
    for (const id of ['n1', 'n2']) {
      expect(row('out_of_cycle', id)).toMatchObject({ a: 'old_a', b: 'y', z: 'zv', w: 'old' });
    }
  });

  it('a lock reading the cycle through an INDEX is judged after it too: w drops, z lands', async () => {
    const { events, options } = dropEvents();
    await engine.update('index_read', { id: 'n1', ...NONE_WRITE, z: 'zv', w: 'wv' }, options);
    expect(row('index_read', 'n1')).toMatchObject({ a: 'old_a', b: 'y', z: 'zv', w: 'old' });
    expect(events).toEqual([{ object: 'index_read', fields: ['a', 'b', 'w'], reason: 'readonly_when' }]);
  });

  it('a lock reading the cycle through an INDEX, in BULK', async () => {
    await engine.update('index_read', { ...NONE_WRITE, z: 'zv', w: 'wv' }, bulk());
    for (const id of ['n1', 'n2']) {
      expect(row('index_read', id)).toMatchObject({ a: 'old_a', b: 'y', z: 'zv', w: 'old' });
    }
  });

  // ── #19853's settlement, beside the cycle ─────────────────────────────

  it('SETTLEMENT: the repoint lands, y drops, amt is judged under the header it lands on, and the cycle holds', async () => {
    const { events, options } = dropEvents();
    const reads = recordHeaderReads();
    await engine.update('line_beside', { id: 'l1', c: 'open', invoice: 'h_open', y: 'yv', amt: 'a1', ...NONE_WRITE }, options);
    expect(row('line_beside', 'l1')).toMatchObject({ c: 'L', invoice: 'h_open', y: 'old', amt: 'a1', a: 'old_a', b: 'y' });
    expect(events).toEqual([{ object: 'line_beside', fields: ['c', 'y', 'a', 'b'], reason: 'readonly_when' }]);
    // The header the update names, then the repoint's reference check on it.
    expect(reads).toEqual(['h_open', 'h_open']);
  });

  it('SETTLEMENT in BULK: every matched line lands on the named header', async () => {
    const { events, options } = dropEvents();
    await engine.update('line_beside', { c: 'open', invoice: 'h_open', y: 'yv', amt: 'a1', ...NONE_WRITE }, bulk(options));
    for (const id of ['l1', 'l2']) {
      expect(row('line_beside', id)).toMatchObject({ c: 'L', invoice: 'h_open', y: 'old', amt: 'a1', a: 'old_a', b: 'y' });
    }
    expect(events).toEqual([{ object: 'line_beside', fields: ['c', 'y', 'a', 'b'], reason: 'readonly_when' }]);
  });
});

describe('the strips judge each field over the locks it reads, and no others (#19929)', () => {
  const schema = { fields: { ...CHAIN, ...CYCLE_NONE } } as any;
  const prior = { ...CHAIN_ROW, ...NONE_ROW };

  it('the chain is settled as it is alone, beside the cycle', () => {
    const alone = stripReadonlyWhenFields({ fields: CHAIN } as any, { ...CHAIN_WRITE }, CHAIN_ROW);
    expect(alone).toEqual({ x: 'xv' });
    expect(stripReadonlyWhenFields(schema, { ...CHAIN_WRITE, ...NONE_WRITE }, prior)).toEqual({ x: 'xv' });
  });

  it('bulk: the same, over every matched row', () => {
    const rows = [prior, { ...prior }];
    expect(stripReadonlyWhenFieldsMulti(schema, { ...CHAIN_WRITE, ...NONE_WRITE }, rows)).toEqual({ x: 'xv' });
  });

  it('`only: x` leaves the payload whole beside the cycle: x is not taken', () => {
    const data = { ...CHAIN_WRITE, ...NONE_WRITE };
    expect(stripReadonlyWhenFields(schema, data, prior, undefined, undefined, { only: 'x' })).toBe(data);
  });
});
