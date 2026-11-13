// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #33100 — a formula that reads another formula field reads that formula's
 * value, on every path that computes formulas.
 *
 * ## The defect, as measured
 *
 * `f_total = record.f_sibling * 2`, where `f_sibling` is itself a formula
 * (`record.quantity * record.unit_price`), read `null` with "No such key:
 * f_sibling" whenever `f_total` was evaluated before `f_sibling`: when it was
 * declared first, and on every projection naming `f_total` without
 * `f_sibling` (the plan held only the formulas the projection named). The
 * publish gate, `validate_expression` and the Studio editor all accept the
 * expression, so the authoring doors gave a green the runtime did not keep.
 *
 * ## What is pinned
 *
 *  - the card's case reads 20 (2 × 5 × 2), in either declaration order, on
 *    the write response, `find`, `findOne`, a projection naming only the
 *    reader (the formula it reads is computed and cut back off the answer),
 *    the hook helper `evaluateFormulaField` and `serveFormulaField`;
 *  - a chain of three formulas, declared last-reader-first, reads through;
 *  - a cycle (a formula reading itself, or two reading each other) reads
 *    `null` with a fault that names the cycle, the read returns, and a
 *    formula off the cycle still evaluates.
 */
import { describe, expect, it } from 'vitest';
import { formulaCycleMessage } from '@objectstack/formula';
import { ObjectQL, evaluateFormulaField } from './engine.js';

type Rec = Record<string, unknown>;

/** A logger that records `warn` — the level the engine reports a formula fault at. */
function makeRecordingLogger() {
  const warns: Array<{ message: string; meta: Rec | undefined }> = [];
  const l: any = {
    trace() {}, debug() {}, info() {}, error() {}, fatal() {},
    warn(message: string, meta?: Rec) { warns.push({ message: String(message), meta }); },
    child() { return l; },
  };
  return { logger: l, warns };
}

/** Rows keyed by object; shallow COPIES out, so a read cannot write into the store. */
function makeStubDriver() {
  const stores = new Map<string, Map<string, Rec>>();
  const storeFor = (obj: string) => {
    let s = stores.get(obj);
    if (!s) { s = new Map(); stores.set(obj, s); }
    return s;
  };
  let nextId = 0;
  const matches = (row: Rec, where: unknown): boolean => {
    if (!where || typeof where !== 'object') return true;
    for (const [k, v] of Object.entries(where as Rec)) {
      if (k.startsWith('$')) continue;
      const expected = (v && typeof v === 'object' && '$eq' in (v as Rec)) ? (v as Rec).$eq : v;
      if ((row[k] ?? null) !== (expected ?? null)) return false;
    }
    return true;
  };
  const driver = {
    name: 'memory', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    // The caller's bound, applied AFTER the filter and by PRESENCE: a double that
    // ignores `limit` answers more rows than a real driver would.
    async find(object: string, ast: { where?: unknown; limit?: number }) {
      const rows = Array.from(storeFor(object).values()).filter((r) => matches(r, ast?.where));
      const page = typeof ast?.limit === 'number' ? rows.slice(0, ast.limit) : rows;
      return page.map((r) => ({ ...r }));
    },
    async findOne(object: string, ast: { where?: unknown }) {
      for (const r of storeFor(object).values()) if (matches(r, ast?.where)) return { ...r };
      return null;
    },
    async create(object: string, data: Rec) {
      nextId += 1;
      const id = (data.id as string) ?? `r_${nextId}`;
      const row: Rec = { ...data, id };
      storeFor(object).set(id, row);
      return { ...row };
    },
    async update(object: string, id: string, data: Rec) {
      const s = storeFor(object);
      const cur = s.get(id);
      if (!cur) return null;
      const updated = { ...cur, ...data, id };
      s.set(id, updated);
      return { ...updated };
    },
    async updateMany() { return 0; },
    async upsert(object: string, data: Rec) { return this.create(object, data); },
    async delete(object: string, id: string) { return storeFor(object).delete(id); },
    async count(object: string, ast: { where?: unknown }) { return (await this.find(object, ast)).length; },
    async bulkCreate(object: string, rows: Rec[]) { return Promise.all(rows.map((r) => this.create(object, r))); },
    async bulkUpdate() { return []; },
    async bulkDelete() {},
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {},
    async rollback() {},
  };
  return { driver, storeFor };
}


const num = (label: string) => ({ name: label, label, type: 'number' as const });
const formula = (name: string, source: string) =>
  ({ name, label: name, type: 'formula' as const, expression: source, returnType: 'number' });

/** The card's object, with its two formulas in the order given. */
function cardObject(name: string, order: 'reader-last' | 'reader-first') {
  const sibling = formula('f_sibling', 'record.quantity * record.unit_price');
  const total = formula('f_total', 'record.f_sibling * 2');
  return {
    name,
    label: name,
    fields: {
      id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
      quantity: num('quantity'),
      unit_price: num('unit_price'),
      ...(order === 'reader-last' ? { f_sibling: sibling, f_total: total } : { f_total: total, f_sibling: sibling }),
    },
  };
}

async function makeRig(objects: unknown[]) {
  const { logger, warns } = makeRecordingLogger();
  const engine = new ObjectQL({ logger });
  const { driver } = makeStubDriver();
  engine.registerDriver(driver as never, true);
  await engine.init();
  for (const obj of objects) engine.registry.registerObject(obj as never, 'test');
  const faults = (object: string, field?: string) =>
    warns.filter((w) => w.meta?.object === object && (field === undefined || w.meta?.field === field));
  return { engine, faults };
}

describe('#33100 — a formula over a formula reads the computed value', () => {
  for (const order of ['reader-last', 'reader-first'] as const) {
    it(`the card's 2 × 5 case reads 20 on the write response, find and findOne (${order})`, async () => {
      const name = `x_job_${order.replace('-', '_')}`;
      const { engine, faults } = await makeRig([cardObject(name, order)]);

      const created = await engine.insert(name, { quantity: 2, unit_price: 5 }) as Rec;
      const [listed] = await engine.find(name, {} as never) as Rec[];
      const one = await engine.findOne(name, { where: { id: created.id } } as never) as Rec;

      for (const row of [created, listed!, one]) {
        expect(row.f_sibling).toBe(10);
        expect(row.f_total).toBe(20);
      }
      expect(faults(name), 'no formula faulted').toEqual([]);
    });
  }

  it('a projection naming only the reader computes the formula it reads and cuts it off the answer', async () => {
    const { engine, faults } = await makeRig([cardObject('x_job', 'reader-last')]);
    await engine.insert('x_job', { quantity: 2, unit_price: 5 });

    const rows = await engine.find('x_job', { fields: ['f_total'] } as never) as Rec[];

    expect(rows).toEqual([{ f_total: 20 }]);
    expect(faults('x_job')).toEqual([]);
  });

  it('the hook helper and serveFormulaField read through the formula they read', async () => {
    const { engine } = await makeRig([cardObject('x_job', 'reader-first')]);
    const schema = engine.getSchema('x_job');
    const row = { id: 'r_x', quantity: 2, unit_price: 5 };

    expect(evaluateFormulaField(schema, row, 'f_total')).toBe(20);
    expect(await engine.serveFormulaField('x_job', row, 'f_total')).toBe(20);
    // The record handed in is not written to.
    expect(row).toEqual({ id: 'r_x', quantity: 2, unit_price: 5 });
  });

  it('a chain of three formulas, declared last-reader-first, reads through', async () => {
    const chain = {
      name: 'x_chain',
      label: 'Chain',
      fields: {
        id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
        f_c: formula('f_c', 'record.f_b + 1'),
        f_b: formula('f_b', 'record.f_a * 2'),
        quantity: num('quantity'),
        unit_price: num('unit_price'),
        f_a: formula('f_a', 'record.quantity * record.unit_price'),
      },
    };
    const { engine, faults } = await makeRig([chain]);

    const created = await engine.insert('x_chain', { quantity: 2, unit_price: 5 }) as Rec;
    expect([created.f_a, created.f_b, created.f_c]).toEqual([10, 20, 21]);
    const [listed] = await engine.find('x_chain', {} as never) as Rec[];
    expect([listed!.f_a, listed!.f_b, listed!.f_c]).toEqual([10, 20, 21]);
    expect(await engine.find('x_chain', { fields: ['quantity', 'f_c'] } as never)).toEqual([{ quantity: 2, f_c: 21 }]);
    expect(faults('x_chain')).toEqual([]);
  });
});

describe('#33100 — a cycle of formulas reads null, names the cycle, and does not loop', () => {
  const cyclic = {
    name: 'x_cycle',
    label: 'Cycle',
    fields: {
      id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
      quantity: num('quantity'),
      f_self: formula('f_self', 'record.f_self * 2'),
      f_x: formula('f_x', 'record.f_y + 1'),
      f_y: formula('f_y', 'record.f_x + 1'),
      f_reads_cycle: formula('f_reads_cycle', 'record.f_x == null ? -1 : record.f_x'),
      f_plain: formula('f_plain', 'record.quantity * 3'),
    },
  };

  it('every formula on a cycle reads null with a fault naming it; the rest evaluates', async () => {
    const { engine, faults } = await makeRig([cyclic]);

    const created = await engine.insert('x_cycle', { quantity: 2 }) as Rec;
    const [listed] = await engine.find('x_cycle', {} as never) as Rec[];

    for (const row of [created, listed!]) {
      expect(row.f_self).toBeNull();
      expect(row.f_x).toBeNull();
      expect(row.f_y).toBeNull();
      // Off the cycle: reads the null the cycle member reads, and evaluates.
      expect(row.f_reads_cycle).toBe(-1);
      expect(row.f_plain).toBe(6);
    }
    const said = (field: string) => faults('x_cycle', field).map((w) => String(w.meta?.error));
    expect(said('f_self')).toHaveLength(1);
    // The sentence the authoring lint refuses the same formula with.
    expect(said('f_self')[0]).toContain(formulaCycleMessage('f_self', ['f_self']));
    expect(said('f_self')[0]).toContain("('f_self' reads 'f_self')");
    expect(said('f_x')[0]).toContain(formulaCycleMessage('f_x', ['f_x', 'f_y']));
    expect(said('f_x')[0]).toContain("('f_x' reads 'f_y', 'f_y' reads 'f_x')");
    expect(said('f_y')).toHaveLength(1);
    expect(said('f_y')[0]).toContain(formulaCycleMessage('f_y', ['f_x', 'f_y']));
    expect(said('f_reads_cycle')).toEqual([]);
    expect(said('f_plain')).toEqual([]);
  });

  it('a projection naming a reader of the cycle answers too', async () => {
    const { engine } = await makeRig([cyclic]);
    await engine.insert('x_cycle', { quantity: 2 });

    expect(await engine.find('x_cycle', { fields: ['f_reads_cycle'] } as never)).toEqual([{ f_reads_cycle: -1 }]);
  });
});
