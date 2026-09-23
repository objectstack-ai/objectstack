// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #19927 — a chain of `readonlyWhen` locks settles on the drop set that agrees
// with the row the write stores, not the fixpoint's larger one.
//
// `c` locked by `previous.c == 'L'`, `x` by `record.c == 'open'`, `y` by
// `record.x == 'xv'`; row `{ c: 'L', x: 'old', y: 'old' }`; `update({ c:
// 'open', x: 'xv', y: 'yv' })`. `c` is locked, so the row keeps `c: 'L'`; on
// that row `x`'s lock is FALSE, so `x: 'xv'` lands; `y`'s lock then reads
// `'xv'` and is TRUE. The only drop set that agrees with the stored row is
// `{c, y}`. The settlement (`settleReadonlyWhenDrops`) released once and gave
// up when that one step did not settle, so it dropped `{c, x, y}`: a write
// whose own lock was FALSE was ignored, and a `strictReadonlyWrites` refusal
// named `x`. The release now repeats until a set gives back itself.
//
// Every expected row below was checked against a brute-force enumeration of
// the drop sets that agree with the row. A cycle with no such set keeps the
// fail-safe drop; a cycle with several gets the one the iteration reaches, or
// the fail-safe drop when it reaches none.
//
// #19911's suite (`engine-readonly-when-interdependent-locks.test.ts`) pins
// the fixpoint and the one-step release this extends; it is unchanged.
//
// Real engine, the #19911 suite's in-memory driver shape; by-id and bulk.

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectQL } from './engine.js';
import { stripReadonlyWhenFields } from './validation/rule-validator.js';

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

describe('a chain of readonlyWhen locks settles on the drop set the stored row agrees with (#19927)', () => {
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
    // The card's cascade: exact set {c, y}.
    engine.registry.registerObject({
      name: 'cascade',
      fields: {
        c: { type: 'text', readonlyWhen: "previous.c == 'L'" },
        x: { type: 'text', readonlyWhen: "record.c == 'open'" },
        y: { type: 'text', readonlyWhen: "record.x == 'xv'" },
        tag: { type: 'text' },
      },
    } as any);
    // A six-lock cascade: each release moves the next lock's verdict, so the
    // set settles only after several rounds. Exact set {c, x2, x4}.
    engine.registry.registerObject({
      name: 'cascade_six',
      fields: {
        c: { type: 'text', readonlyWhen: "previous.c == 'L'" },
        x1: { type: 'text', readonlyWhen: "record.c == 'open'" },
        x2: { type: 'text', readonlyWhen: "record.x1 == 'v'" },
        x3: { type: 'text', readonlyWhen: "record.x2 == 'v'" },
        x4: { type: 'text', readonlyWhen: "record.x3 == 'v'" },
        x5: { type: 'text', readonlyWhen: "record.x4 == 'v'" },
      },
    } as any);
    // No cycle, and the exact set is not inside the fixpoint's: releasing `j2`
    // locks `k`, which the fixpoint kept. Exact set {p, j1, m, k}.
    engine.registry.registerObject({
      name: 'knock_on',
      fields: {
        p: { type: 'text', readonlyWhen: "previous.p == 'L'" },
        j1: { type: 'text', readonlyWhen: "previous.j1 == 'L'" },
        m: { type: 'text', readonlyWhen: "record.p == 'L'" },
        j2: { type: 'text', readonlyWhen: "record.m == 'new'" },
        k: { type: 'text', readonlyWhen: "record.j1 == 'L' && record.j2 == 'new'" },
      },
    } as any);
    // A cycle with NO exact set.
    engine.registry.registerObject({
      name: 'cycle_none',
      fields: {
        a: { type: 'text', readonlyWhen: "record.b == 'x'" },
        b: { type: 'text', readonlyWhen: "record.a == 'old_a'" },
        tag: { type: 'text' },
      },
    } as any);
    // A cycle with TWO exact sets, {a} and {b}: the iteration reaches neither.
    engine.registry.registerObject({
      name: 'cycle_two',
      fields: {
        a: { type: 'text', readonlyWhen: "record.b == 'new_b'" },
        b: { type: 'text', readonlyWhen: "record.a == 'new_a'" },
        tag: { type: 'text' },
      },
    } as any);
    // A cycle with TWO exact sets, {} and {a, b}: the fixpoint's first pass
    // locks nothing, so {} is the answer.
    engine.registry.registerObject({
      name: 'cycle_empty',
      fields: {
        a: { type: 'text', readonlyWhen: "record.b == 'old'" },
        b: { type: 'text', readonlyWhen: "record.a == 'old'" },
      },
    } as any);
    // The cascade through #19853's settlement: the FK's own lock reads a value
    // a `previous`-locked field keeps, a third lock reads the FK, and a
    // `parent`-scoped lock makes the settlement run.
    engine.registry.registerObject({ name: 'hdr', fields: { status: { type: 'text' } } } as any);
    engine.registry.registerObject({
      name: 'line_cascade',
      fields: {
        c: { type: 'text', readonlyWhen: "previous.c == 'L'" },
        invoice: { type: 'master_detail', reference: 'hdr', readonlyWhen: "record.c == 'open'" },
        y: { type: 'text', readonlyWhen: "record.invoice == 'h_open'" },
        amt: { type: 'text', readonlyWhen: "parent.status == 'paid'" },
        tag: { type: 'text' },
      },
    } as any);

    storeFor('cascade').set('r1', { id: 'r1', c: 'L', x: 'old', y: 'old', tag: 't' });
    storeFor('cascade').set('r2', { id: 'r2', c: 'L', x: 'old', y: 'old', tag: 't' });
    storeFor('cascade_six').set('s1', { id: 's1', c: 'L', x1: 'o', x2: 'o', x3: 'o', x4: 'o', x5: 'o' });
    storeFor('knock_on').set('k1', { id: 'k1', p: 'L', j1: 'L', m: 'old', j2: 'old', k: 'old' });
    storeFor('cycle_none').set('n1', { id: 'n1', a: 'old_a', b: 'y', tag: 't' });
    storeFor('cycle_none').set('n2', { id: 'n2', a: 'old_a', b: 'y', tag: 't' });
    storeFor('cycle_two').set('w1', { id: 'w1', a: 'old', b: 'old', tag: 't' });
    storeFor('cycle_empty').set('e1', { id: 'e1', a: 'old', b: 'old' });
    storeFor('hdr').set('h_paid', { id: 'h_paid', status: 'paid' });
    storeFor('hdr').set('h_open', { id: 'h_open', status: 'open' });
    storeFor('line_cascade').set('l1', { id: 'l1', c: 'L', invoice: 'h_paid', y: 'old', amt: 'a0', tag: 't' });
    storeFor('line_cascade').set('l2', { id: 'l2', c: 'L', invoice: 'h_paid', y: 'old', amt: 'a0', tag: 't' });
  });

  const row = (object: string, id: string) => storeFor(object).get(id);

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

  it('THE CARD: x, unlocked on the row the write stores, lands; c and y drop', async () => {
    const { events, options } = dropEvents();
    await engine.update('cascade', { id: 'r1', c: 'open', x: 'xv', y: 'yv' }, options);
    expect(row('cascade', 'r1')).toMatchObject({ c: 'L', x: 'xv', y: 'old' });
    expect(events).toEqual([{ object: 'cascade', fields: ['c', 'y'], reason: 'readonly_when' }]);
    expect(warns.filter((w) => w.includes('is read-only (readonlyWhen)'))).toEqual([
      "Field 'c' is read-only (readonlyWhen) — ignoring incoming change",
      "Field 'y' is read-only (readonlyWhen) — ignoring incoming change",
    ]);
  });

  it('THE CARD in BULK: every matched row takes x and keeps c and y', async () => {
    const { events, options } = dropEvents();
    await engine.update('cascade', { c: 'open', x: 'xv', y: 'yv' }, { ...options, where: { tag: 't' }, multi: true } as any);
    expect(row('cascade', 'r1')).toMatchObject({ c: 'L', x: 'xv', y: 'old' });
    expect(row('cascade', 'r2')).toMatchObject({ c: 'L', x: 'xv', y: 'old' });
    expect(events).toEqual([{ object: 'cascade', fields: ['c', 'y'], reason: 'readonly_when' }]);
  });

  it('THE CARD under strictReadonlyWrites: refused, naming only the locked c and y, and nothing lands', async () => {
    const err = await rejection(engine.update('cascade', { id: 'r1', c: 'open', x: 'xv', y: 'yv' }, { strictReadonlyWrites: true } as any));
    expect(err.code).toBe('ERR_READONLY_FIELD_REJECTED');
    expect(err.fields).toEqual(['c', 'y']);
    expect(err.drops).toEqual([{ object: 'cascade', fields: ['c', 'y'], reason: 'readonly_when' }]);
    expect(row('cascade', 'r1')).toMatchObject({ c: 'L', x: 'old', y: 'old' });
  });

  it('THE CARD in BULK under strictReadonlyWrites: refused, naming only c and y, and no row moves', async () => {
    const err = await rejection(engine.update('cascade', { c: 'open', x: 'xv', y: 'yv' }, { where: { tag: 't' }, multi: true, strictReadonlyWrites: true } as any));
    expect(err.code).toBe('ERR_READONLY_FIELD_REJECTED');
    expect(err.fields).toEqual(['c', 'y']);
    expect(row('cascade', 'r1')).toMatchObject({ c: 'L', x: 'old', y: 'old' });
    expect(row('cascade', 'r2')).toMatchObject({ c: 'L', x: 'old', y: 'old' });
  });

  it('THE CARD for an isSystem caller: the locks bind it the same way', async () => {
    await engine.update('cascade', { id: 'r1', c: 'open', x: 'xv', y: 'yv' }, { context: { isSystem: true } } as any);
    expect(row('cascade', 'r1')).toMatchObject({ c: 'L', x: 'xv', y: 'old' });
  });

  it('a six-lock cascade settles after several rounds on the one set the row agrees with', async () => {
    const { events, options } = dropEvents();
    await engine.update('cascade_six', { id: 's1', c: 'open', x1: 'v', x2: 'v', x3: 'v', x4: 'v', x5: 'v' }, options);
    expect(row('cascade_six', 's1')).toMatchObject({ c: 'L', x1: 'v', x2: 'o', x3: 'v', x4: 'o', x5: 'v' });
    expect(events).toEqual([{ object: 'cascade_six', fields: ['c', 'x2', 'x4'], reason: 'readonly_when' }]);
  });

  it('KNOCK-ON: releasing j2 locks k, which the fixpoint had let through, so k drops and j2 lands', async () => {
    const { events, options } = dropEvents();
    await engine.update('knock_on', { id: 'k1', p: 'new', j1: 'new', m: 'new', j2: 'new', k: 'new' }, options);
    expect(row('knock_on', 'k1')).toMatchObject({ p: 'L', j1: 'L', m: 'old', j2: 'new', k: 'old' });
    expect(events).toEqual([{ object: 'knock_on', fields: ['p', 'j1', 'm', 'k'], reason: 'readonly_when' }]);
  });

  // ── Cycles ────────────────────────────────────────────────────────────

  it('CYCLE with no exact set: both locks hold (fail-safe), by id', async () => {
    const { events, options } = dropEvents();
    await engine.update('cycle_none', { id: 'n1', a: 'new_a', b: 'x' }, options);
    expect(row('cycle_none', 'n1')).toMatchObject({ a: 'old_a', b: 'y' });
    expect(events).toEqual([{ object: 'cycle_none', fields: ['a', 'b'], reason: 'readonly_when' }]);
  });

  it('CYCLE with no exact set in BULK: both locks hold in every row (fail-safe)', async () => {
    await engine.update('cycle_none', { a: 'new_a', b: 'x' }, { where: { tag: 't' }, multi: true } as any);
    expect(row('cycle_none', 'n1')).toMatchObject({ a: 'old_a', b: 'y' });
    expect(row('cycle_none', 'n2')).toMatchObject({ a: 'old_a', b: 'y' });
  });

  it('CYCLE with two exact sets, {a} and {b}: the iteration reaches neither, and both locks hold (fail-safe)', async () => {
    const { events, options } = dropEvents();
    await engine.update('cycle_two', { id: 'w1', a: 'new_a', b: 'new_b' }, options);
    expect(row('cycle_two', 'w1')).toMatchObject({ a: 'old', b: 'old' });
    expect(events).toEqual([{ object: 'cycle_two', fields: ['a', 'b'], reason: 'readonly_when' }]);
  });

  it('CYCLE with two exact sets, {} and {a, b}: nothing locks on the first pass, so both land', async () => {
    const { events, options } = dropEvents();
    await engine.update('cycle_empty', { id: 'e1', a: 'new_a', b: 'new_b' }, options);
    expect(row('cycle_empty', 'e1')).toMatchObject({ a: 'new_a', b: 'new_b' });
    expect(events).toEqual([]);
  });

  // ── The same search inside #19853's settlement ────────────────────────

  it('SETTLEMENT: the repoint the cascade used to hold now lands, y drops, and amt is judged under the header it lands on', async () => {
    const { events, options } = dropEvents();
    const reads = recordHeaderReads();
    await engine.update('line_cascade', { id: 'l1', c: 'open', invoice: 'h_open', y: 'yv', amt: 'a1' }, options);
    expect(row('line_cascade', 'l1')).toMatchObject({ c: 'L', invoice: 'h_open', y: 'old', amt: 'a1' });
    expect(events).toEqual([{ object: 'line_cascade', fields: ['c', 'y'], reason: 'readonly_when' }]);
    // The header the update names, then the repoint's reference check on it.
    expect(reads).toEqual(['h_open', 'h_open']);
  });

  it('SETTLEMENT in BULK: every matched line lands on the named header, and every y drops', async () => {
    const { events, options } = dropEvents();
    await engine.update('line_cascade', { c: 'open', invoice: 'h_open', y: 'yv', amt: 'a1' }, { ...options, where: { tag: 't' }, multi: true } as any);
    expect(row('line_cascade', 'l1')).toMatchObject({ c: 'L', invoice: 'h_open', y: 'old', amt: 'a1' });
    expect(row('line_cascade', 'l2')).toMatchObject({ c: 'L', invoice: 'h_open', y: 'old', amt: 'a1' });
    expect(events).toEqual([{ object: 'line_cascade', fields: ['c', 'y'], reason: 'readonly_when' }]);
  });

  it('SETTLEMENT under strictReadonlyWrites: refused, naming c and y, and the line stays where it was', async () => {
    const err = await rejection(engine.update('line_cascade', { id: 'l1', c: 'open', invoice: 'h_open', y: 'yv', amt: 'a1' }, { strictReadonlyWrites: true } as any));
    expect(err.code).toBe('ERR_READONLY_FIELD_REJECTED');
    expect(err.fields).toEqual(['c', 'y']);
    expect(row('line_cascade', 'l1')).toMatchObject({ c: 'L', invoice: 'h_paid', y: 'old', amt: 'a0' });
  });
});

describe('stripReadonlyWhenFields settles the cascade (#19927)', () => {
  const schema = {
    fields: {
      c: { type: 'text', readonlyWhen: "previous.c == 'L'" },
      x: { type: 'text', readonlyWhen: "record.c == 'open'" },
      y: { type: 'text', readonlyWhen: "record.x == 'xv'" },
    },
  } as any;
  const prior = { c: 'L', x: 'old', y: 'old' };

  it('takes c and y, and leaves x', () => {
    expect(stripReadonlyWhenFields(schema, { c: 'open', x: 'xv', y: 'yv' }, prior)).toEqual({ x: 'xv' });
  });

  it('`only: x` leaves the payload whole: x is not taken, and nothing is said', () => {
    const warned: string[] = [];
    const data = { c: 'open', x: 'xv', y: 'yv' };
    const out = stripReadonlyWhenFields(schema, data, prior, { warn: (m: string) => warned.push(m) }, undefined, { only: 'x' });
    expect(out).toBe(data);
    expect(warned).toEqual([]);
  });

  it('`only: y` takes y alone, judged over the settled drops of the others', () => {
    const out = stripReadonlyWhenFields(schema, { c: 'open', x: 'xv', y: 'yv' }, prior, undefined, undefined, { only: 'y' });
    expect(out).toEqual({ c: 'open', x: 'xv' });
  });
});
