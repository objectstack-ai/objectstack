// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #22019 — the read path no longer swallows a formula fault in silence.
 *
 * ## The defect, as measured
 *
 * A formula field `sqrt(record.amount)` (`sqrt` is not a registered stdlib
 * function) read `null` on every row — on `find`, on `findOne` and on the
 * write response — and nothing anywhere said why: `applyFormulaPlan` mapped
 * the failed evaluation to `null` (`r.ok ? … : null`) and dropped the error.
 * ADR-0032's rule for call sites, restated in `formulas.mdx`: they "must not
 * silently swallow that".
 *
 * ## What is pinned
 *
 *  - the ANSWER is unchanged: the field still reads `null` (a read's answer is
 *    protocol; this card changes what is said, not what is returned);
 *  - a row stored BEFORE the save-door gate — its object registered straight
 *    into the registry and the row written straight to the store, the shape a
 *    tenant's pre-gate `sys_metadata` body takes — keeps reading;
 *  - the engine's logger gets ONE attributed line per (object, field) per
 *    engine instance, however many rows and reads: it names the object, the
 *    field and the evaluator's error;
 *  - a second faulting field on the same object gets its own line, and a
 *    formula that evaluates logs nothing.
 *
 * The save-door half (the same expression is now refused at publish) lives in
 * `@objectstack/metadata-protocol`'s `protocol.runtime-authoring-gate.test.ts`
 * (its #22019 block).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { ObjectQL } from './engine.js';

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

/**
 * The card's object as a pre-gate body: `score` calls an unregistered
 * function, `ratio` faults on its own (a second pair), `floored` is a
 * registered call that evaluates (the control).
 */
const FX_SQRT = {
  name: 'fx_sqrt',
  label: 'Formula Probe',
  fields: {
    id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
    amount: { name: 'amount', label: 'Amount', type: 'number' as const },
    score: { name: 'score', label: 'Score', type: 'formula' as const, expression: { dialect: 'cel', source: 'sqrt(record.amount)' } },
    ratio: { name: 'ratio', label: 'Ratio', type: 'formula' as const, expression: { dialect: 'cel', source: 'cbrt(record.amount)' } },
    floored: { name: 'floored', label: 'Floored', type: 'formula' as const, expression: { dialect: 'cel', source: 'floor(record.amount)' } },
  },
};

async function makeRig() {
  const { logger, warns } = makeRecordingLogger();
  const engine = new ObjectQL({ logger });
  const { driver, storeFor } = makeStubDriver();
  engine.registerDriver(driver as never, true);
  await engine.init();
  // Registered straight into the registry — no save door on this path, which
  // is how a body stored before the gate reaches a running engine.
  engine.registry.registerObject(FX_SQRT as never, 'test');
  // And its rows written straight to the store, never through `insert`.
  storeFor('fx_sqrt').set('r_a', { id: 'r_a', amount: 16.5 });
  storeFor('fx_sqrt').set('r_b', { id: 'r_b', amount: 9 });
  const faultLines = (field?: string) =>
    warns.filter((w) => w.meta?.object === 'fx_sqrt' && (field === undefined || w.meta?.field === field));
  return { engine, warns, faultLines };
}

type Rig = Awaited<ReturnType<typeof makeRig>>;

describe('#22019 — a formula fault on the read path is said once per (object, field), and the answer stays null', () => {
  let rig: Rig;
  beforeEach(async () => { rig = await makeRig(); });

  it('a row stored before the gate still reads: the faulting field reads null, the control evaluates', async () => {
    const rows = await rig.engine.find('fx_sqrt', {} as never) as Rec[];

    expect(rows).toHaveLength(2);
    const a = rows.find((r) => r.id === 'r_a')!;
    expect(a.score).toBeNull();
    expect(a.ratio).toBeNull();
    expect(a.floored).toBe(16);
  });

  it('the log names the object and the field, ONCE, across rows and repeated reads', async () => {
    await rig.engine.find('fx_sqrt', {} as never);
    await rig.engine.find('fx_sqrt', {} as never);
    await rig.engine.findOne('fx_sqrt', { where: { id: 'r_b' } } as never);

    const score = rig.faultLines('score');
    expect(score, JSON.stringify(rig.warns)).toHaveLength(1);
    expect(score[0]!.message).toContain("formula field 'score' on 'fx_sqrt'");
    expect(score[0]!.message).toContain('reads null');
    // The evaluator's own error rides along — the line says WHY, not only that.
    expect(score[0]!.meta).toMatchObject({ object: 'fx_sqrt', field: 'score' });
    expect(String(score[0]!.meta?.error)).toContain('sqrt');
  });

  it('each faulting field is its own pair; a field that evaluates logs nothing', async () => {
    await rig.engine.find('fx_sqrt', {} as never);

    expect(rig.faultLines('ratio')).toHaveLength(1);
    expect(String(rig.faultLines('ratio')[0]!.meta?.error)).toContain('cbrt');
    expect(rig.faultLines('floored')).toEqual([]);
    expect(rig.faultLines()).toHaveLength(2);
  });

  it('the write response reads null for the same field and does not repeat a pair already said', async () => {
    await rig.engine.find('fx_sqrt', {} as never);
    const created = await rig.engine.insert('fx_sqrt', { amount: 4 }) as Rec;

    expect(created.score).toBeNull();
    expect(created.floored).toBe(4);
    expect(rig.faultLines('score')).toHaveLength(1);
  });

  it('the write response is a site of its own: a fault first met there is said there', async () => {
    const created = await rig.engine.insert('fx_sqrt', { amount: 4 }) as Rec;

    expect(created.score).toBeNull();
    expect(rig.faultLines('score')).toHaveLength(1);
  });

  it('once per engine INSTANCE: a second engine says it again', async () => {
    await rig.engine.find('fx_sqrt', {} as never);
    const other = await makeRig();
    await other.engine.find('fx_sqrt', {} as never);

    expect(rig.faultLines('score')).toHaveLength(1);
    expect(other.faultLines('score')).toHaveLength(1);
  });
});
