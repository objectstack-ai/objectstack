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
import { ExpressionEngine } from '@objectstack/formula';
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

/**
 * An unparseable `date()` input is a fault, not a silent null.
 *
 * `date()` / `datetime()` coerce their argument with the stdlib's `toDate`,
 * which answers an INVALID Date for text it cannot parse, and the evaluator
 * reports that as `ok: true`. Predicates rely on that on purpose: a comparison
 * over an invalid Date stays `false`. A formula FIELD has no such use for it:
 * the invalid Date serializes to `null`, the same bytes an empty source gives,
 * and nothing was said. Pinned here:
 *
 *  - the answer is still `null` — the bytes a read returns do not move;
 *  - the field gets the one line per (object, field) any other fault gets, and
 *    the line names `date()` and how to guard the operand;
 *  - controls: ISO text still reads its instant with no line, an EMPTY source
 *    logs nothing (a null operand is not a fault), and the same expression as a
 *    predicate answers exactly as before.
 */
const FX_DATE = {
  name: 'fx_date',
  label: 'Date Formula Probe',
  fields: {
    id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
    first: { name: 'first', label: 'First', type: 'text' as const },
    f_date: { name: 'f_date', label: 'F Date', type: 'formula' as const, expression: { dialect: 'cel', source: 'date(record.first)' } },
    f_next: { name: 'f_next', label: 'F Next', type: 'formula' as const, expression: { dialect: 'cel', source: 'addDays(date(record.first), 1)' } },
  },
};

async function makeDateRig(rows: Rec[]) {
  const { logger, warns } = makeRecordingLogger();
  const engine = new ObjectQL({ logger });
  const { driver, storeFor } = makeStubDriver();
  engine.registerDriver(driver as never, true);
  await engine.init();
  engine.registry.registerObject(FX_DATE as never, 'test');
  for (const row of rows) storeFor('fx_date').set(String(row.id), row);
  const faultLines = (field?: string) =>
    warns.filter((w) => w.meta?.object === 'fx_date' && (field === undefined || w.meta?.field === field));
  return { engine, warns, faultLines };
}

describe('an unparseable date() input in a formula field is a reported fault, and the answer stays null', () => {
  it('text date() cannot parse: the field reads null, and the fault is said once per field', async () => {
    const rig = await makeDateRig([{ id: 'r_g', first: 'grace' }, { id: 'r_h', first: 'hopper' }]);
    const rows = await rig.engine.find('fx_date', {} as never) as Rec[];
    await rig.engine.findOne('fx_date', { where: { id: 'r_g' } } as never);

    const lines = rig.faultLines('f_date');
    expect(lines, JSON.stringify(rig.warns)).toHaveLength(1);
    // The served bytes are the ones the invalid Date serialized to before; the
    // in-process value is the `null` every other fault reads.
    expect(JSON.stringify(rows[0])).toContain('"f_date":null');
    expect(rows.map((r) => r.f_date)).toEqual([null, null]);
    expect(lines[0]!.message).toContain("formula field 'f_date' on 'fx_date'");
    expect(lines[0]!.meta).toMatchObject({ object: 'fx_date', field: 'f_date', kind: 'runtime' });
    expect(String(lines[0]!.meta?.error)).toContain('date()');
    // A date function over the invalid Date is the same fault, on its own field.
    expect(rows.map((r) => r.f_next)).toEqual([null, null]);
    expect(rig.faultLines('f_next')).toHaveLength(1);
    expect(rig.faultLines()).toHaveLength(2);
  });

  it('the write response reads null for it and says it there', async () => {
    const rig = await makeDateRig([]);
    const created = await rig.engine.insert('fx_date', { first: 'grace' }) as Rec;

    expect(rig.faultLines('f_date')).toHaveLength(1);
    expect(created.f_date).toBeNull();
  });

  it('control: ISO text still reads its instant, with no line', async () => {
    const rig = await makeDateRig([{ id: 'r_iso', first: '2026-03-04' }]);
    const [row] = await rig.engine.find('fx_date', {} as never) as Rec[];

    expect(row!.f_date).toBeInstanceOf(Date);
    expect((row!.f_date as Date).toISOString()).toBe('2026-03-04T00:00:00.000Z');
    expect((row!.f_next as Date).toISOString()).toBe('2026-03-05T00:00:00.000Z');
    expect(rig.faultLines()).toEqual([]);
  });

  it('control: an EMPTY source is not a fault — nothing is logged for it', async () => {
    const rig = await makeDateRig([{ id: 'r_null', first: null }, { id: 'r_blank', first: '' }]);
    const rows = await rig.engine.find('fx_date', {} as never) as Rec[];

    expect(rows).toHaveLength(2);
    // Read in-process as an invalid Date, served as `null`: the bytes this
    // card does not move for an empty source either.
    expect(JSON.parse(JSON.stringify(rows)).map((r: Rec) => r.f_date)).toEqual([null, null]);
    expect(rig.faultLines()).toEqual([]);
  });

  it('control: the same date() as a predicate answers as before — false, no fault', () => {
    const r = ExpressionEngine.evaluate(
      { dialect: 'cel', source: 'date(record.first) == today()' },
      { record: { first: 'grace' } },
    );
    expect(r).toEqual({ ok: true, value: false });
  });
});
