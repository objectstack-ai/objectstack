// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #20309 — on every engine write door, an array, boolean or object on a number
 * field is refused before the driver sees it.
 *
 * The arm used to judge `Number(value)` while the write carried `value`, so
 * `[500]`, `[]` and `true` passed and reached the driver as sent. Measured on
 * `origin/main` c74de10a94: memory stored each verbatim (the array, the
 * boolean), and SQLite stored `'[500]'` / `'[]'` as TEXT and `true` as `1`.
 *
 * This file pins the DRIVER-FACING half on each door: a refused value never
 * reaches the driver (no `create`, `bulkCreate`, `update` or `updateMany`
 * call carries it), and an accepted number arrives as the same number
 * (`Object.is`), so for a number what the arm judged is what the driver
 * receives. Memory and MongoDB store exactly this payload. The SQL physical
 * column is pinned in `packages/rest/src/rest-data-number-value.test.ts`.
 *
 * The string half (#20309, second part): a string the spec's numeric grammar
 * reads (`parseNumericString`) reaches the driver as the NUMBER it denotes on
 * every door, and every stage between the door and the driver (a `before*`
 * hook, the dry run) sees that number. Measured on `origin/main` 851af0c27
 * before it: memory stored `'12'` as the string `'12'` and read it back as a
 * string, and `'0x10'` / `' 12 '` / `'+5'` were accepted and stored as sent. A
 * string the grammar does not read is refused and never reaches the driver.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { COMPUTED_VALUE_TYPES, NUMERIC_STRING_GRAMMAR_CASES, NUMERIC_VALUE_TYPES } from '@objectstack/spec/data';
import { ObjectQL } from './engine.js';
import { ValidationError } from './validation/record-validator.js';

const JUDGED = [...NUMERIC_VALUE_TYPES].filter((t) => !COMPUTED_VALUE_TYPES.has(t));
const f = (t: string) => `f_${t}`;

/** The card's table and the non-string coercions it named: all refused. */
const REFUSED: ReadonlyArray<readonly [string, unknown]> = [
  ['[500]', [500]],
  ['[5, 7]', [5, 7]],
  ['[]', []],
  ['true', true],
  ['false', false],
  ['{}', {}],
];

interface Call { fn: string; rows: Record<string, unknown>[] }

function makeStubDriver() {
  const calls: Call[] = [];
  const rows = new Map<string, Record<string, unknown>>();
  let n = 0;
  const put = (data: Record<string, unknown>) => {
    const row = { ...data, id: (data.id as string) ?? `r${++n}` };
    rows.set(row.id as string, row);
    return row;
  };
  const driver: any = {
    name: 'stub', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find() { return [...rows.values()]; },
    async findOne(_o: string, q: any) {
      const id = (q?.where ?? q?.filter ?? q)?.id;
      return (typeof id === 'string' ? rows.get(id) : rows.values().next().value) ?? null;
    },
    async count() { return rows.size; },
    async create(_o: string, data: Record<string, unknown>) {
      calls.push({ fn: 'create', rows: [{ ...data }] });
      return put(data);
    },
    async bulkCreate(_o: string, list: Record<string, unknown>[]) {
      calls.push({ fn: 'bulkCreate', rows: list.map((r) => ({ ...r })) });
      return list.map(put);
    },
    async update(_o: string, id: string, data: Record<string, unknown>) {
      calls.push({ fn: 'update', rows: [{ ...data }] });
      return put({ ...(rows.get(id) ?? {}), ...data, id });
    },
    async updateMany(_o: string, _ast: unknown, data: Record<string, unknown>) {
      calls.push({ fn: 'updateMany', rows: [{ ...data }] });
      return rows.size;
    },
    async upsert(o: string, data: Record<string, unknown>) { return this.create(o, data); },
    async delete() { return true; },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, calls };
}

const OBJ = {
  name: 'num_door',
  label: 'Number door',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    ...Object.fromEntries(JUDGED.map((t) => [f(t), { name: f(t), type: t }])),
  },
};

async function refusal(fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ValidationError);
    return { code: (e as ValidationError).code, fields: (e as ValidationError).fields.map((x) => [x.field, x.code]) };
  }
  return null;
}

describe('engine write doors: the number arm judges what the driver receives (#20309)', () => {
  let engine: ObjectQL;
  let stub: ReturnType<typeof makeStubDriver>;

  beforeEach(async () => {
    stub = makeStubDriver();
    engine = new ObjectQL();
    engine.registerDriver(stub.driver, true);
    await engine.init();
    engine.registry.registerObject(OBJ as any);
  });

  /** Every value any driver write call carried for `field`. */
  const written = (field: string) =>
    stub.calls.flatMap((c) => c.rows).filter((r) => field in r).map((r) => r[field]);

  describe.each(JUDGED)('%s', (type) => {
    it.each(REFUSED)('%s is refused on insert, insert([...]), update by id and update by predicate, and never reaches the driver', async (_l, value) => {
      await engine.insert('num_door', { id: 'seed', [f(type)]: 1 });
      stub.calls.length = 0;
      const expected = { code: 'VALIDATION_FAILED', fields: [[f(type), 'invalid_number']] };

      expect(await refusal(() => engine.insert('num_door', { id: 'a', [f(type)]: structuredClone(value) }))).toEqual(expected);
      expect(await refusal(() => engine.insert('num_door', [{ id: 'b', [f(type)]: structuredClone(value) }]))).toEqual(expected);
      expect(await refusal(() => engine.update('num_door', { id: 'seed', [f(type)]: structuredClone(value) }))).toEqual(expected);
      expect(await refusal(() => engine.update('num_door', { [f(type)]: structuredClone(value) }, { where: { id: { $in: ['seed'] } }, multi: true } as any))).toEqual(expected);

      const outcomes = await engine.insertMany('num_door', [{ id: 'm', [f(type)]: structuredClone(value) }]);
      expect(outcomes.map((o) => o.ok)).toEqual([false]);

      expect(written(f(type))).toEqual([]);
    });
  });

  it('the dry run agrees with the write', async () => {
    const refused = await engine.validate('num_door', { id: 'p1', f_number: [500] });
    expect(refused.valid).toBe(false);
    expect(refused.results?.[0]?.errors.map((e: any) => [e.field, e.code])).toEqual([['f_number', 'invalid_number']]);
    expect((await engine.validate('num_door', { id: 'p2', f_number: 500 })).valid).toBe(true);
  });

  it('CONTROL: a finite number reaches the driver as the same number, on insert and update', async () => {
    const VALID = [500, 12.5, 0, -3];
    for (const type of JUDGED) {
      for (const v of VALID) {
        stub.calls.length = 0;
        await engine.insert('num_door', { id: `v_${type}_${v}`, [f(type)]: v });
        await engine.update('num_door', { id: `v_${type}_${v}`, [f(type)]: v });
        const got = written(f(type));
        expect(got, `${type} ${v}`).toHaveLength(2);
        for (const g of got) expect(Object.is(g, v), `${type} ${v}`).toBe(true);
      }
    }
  });
});

/** The spec grammar's own verdicts (#20336): admitted strings with their number, and refused non-blank strings. */
const ADMITTED = NUMERIC_STRING_GRAMMAR_CASES.flatMap((c) => (c.numeric ? [[JSON.stringify(c.input), c.input, c.value] as const] : []));
const REFUSED_STRINGS = NUMERIC_STRING_GRAMMAR_CASES.flatMap((c) => (!c.numeric && c.form !== 'empty' ? [[JSON.stringify(c.input), c.input] as const] : []));

describe('engine write doors: a numeric string reaches the driver as its number (#20309, the string half)', () => {
  let engine: ObjectQL;
  let stub: ReturnType<typeof makeStubDriver>;

  beforeEach(async () => {
    stub = makeStubDriver();
    engine = new ObjectQL();
    engine.registerDriver(stub.driver, true);
    await engine.init();
    engine.registry.registerObject(OBJ as any);
  });

  const written = (field: string) =>
    stub.calls.flatMap((c) => c.rows).filter((r) => field in r).map((r) => r[field]);

  it('CONTROL: the grammar table has both halves', () => {
    expect(ADMITTED.length).toBeGreaterThanOrEqual(10);
    expect(REFUSED_STRINGS.length).toBeGreaterThanOrEqual(20);
  });

  describe.each(JUDGED)('%s', (type) => {
    it.each(ADMITTED)('%s arrives as the number on insert, insert([...]), insertMany, update by id and update by predicate', async (_l, input, value) => {
      await engine.insert('num_door', { id: 'seed', [f(type)]: 1 });
      stub.calls.length = 0;
      const caller = { id: 'a', [f(type)]: input };
      await engine.insert('num_door', caller);
      await engine.insert('num_door', [{ id: 'b', [f(type)]: input }]);
      const outcomes = await engine.insertMany('num_door', [{ id: 'm', [f(type)]: input }]);
      expect(outcomes.map((o) => o.ok)).toEqual([true]);
      await engine.update('num_door', { id: 'seed', [f(type)]: input });
      await engine.update('num_door', { [f(type)]: input }, { where: { id: { $in: ['seed'] } }, multi: true } as any);

      const got = written(f(type));
      expect(got).toHaveLength(5);
      for (const g of got) expect(Object.is(g, value), `${JSON.stringify(input)} -> ${String(g)}`).toBe(true);
      // The rewrite is copy-on-write: the caller's object still holds its string.
      expect(caller[f(type)]).toBe(input);
    });

    it.each(REFUSED_STRINGS)('%s is refused on every door and never reaches the driver', async (_l, input) => {
      await engine.insert('num_door', { id: 'seed', [f(type)]: 1 });
      stub.calls.length = 0;
      const expected = { code: 'VALIDATION_FAILED', fields: [[f(type), 'invalid_number']] };

      expect(await refusal(() => engine.insert('num_door', { id: 'a', [f(type)]: input }))).toEqual(expected);
      expect(await refusal(() => engine.insert('num_door', [{ id: 'b', [f(type)]: input }]))).toEqual(expected);
      expect(await refusal(() => engine.update('num_door', { id: 'seed', [f(type)]: input }))).toEqual(expected);
      expect(await refusal(() => engine.update('num_door', { [f(type)]: input }, { where: { id: { $in: ['seed'] } }, multi: true } as any))).toEqual(expected);
      const outcomes = await engine.insertMany('num_door', [{ id: 'm', [f(type)]: input }]);
      expect(outcomes.map((o) => o.ok)).toEqual([false]);

      expect(written(f(type))).toEqual([]);
    });
  });

  it('a before-hook sees the number, on insert and on update: every stage after the door reads one image', async () => {
    const seen: Array<[string, unknown]> = [];
    engine.registerHook('beforeInsert', async (ctx: any) => { seen.push(['insert', ctx.input.data.f_number]); }, { object: 'num_door' });
    engine.registerHook('beforeUpdate', async (ctx: any) => { seen.push(['update', ctx.input.data.f_number]); }, { object: 'num_door' });
    await engine.insert('num_door', { id: 'h1', f_number: '12.5' });
    await engine.update('num_door', { id: 'h1', f_number: '-3' });
    expect(seen).toEqual([['insert', 12.5], ['update', -3]]);
  });

  it('the dry run agrees with the write on a string', async () => {
    const refused = await engine.validate('num_door', { id: 'p1', f_number: '0x10' });
    expect(refused.valid).toBe(false);
    expect(refused.results?.[0]?.errors.map((e: any) => [e.field, e.code])).toEqual([['f_number', 'invalid_number']]);
    expect((await engine.validate('num_door', { id: 'p2', f_number: '12' })).valid).toBe(true);
    expect((await engine.validate('num_door', { id: 'p3', f_number: ' 12 ' })).valid).toBe(false);
  });
});
