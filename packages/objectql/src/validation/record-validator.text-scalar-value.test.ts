// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29241] A number or a boolean written to a string-typed field
 * (`BOUNDED_STRING_FIELD_TYPES`) is stored as the string the record
 * validator's string arm judged it by.
 *
 * Measured on `origin/main` @ `a19759ac` before the change: the arm judged
 * `String(value)` (`42` as `'42'`, `true` as `'true'`) while the write carried
 * the raw scalar, so the driver's `create()` / `update()` received the number
 * or the boolean as sent. The door now writes the judged string into the
 * payload (`normalizeNumericStringValues`, beside the number arm's #20309
 * rewrite), on every engine door: insert, insertMany, update by id and update
 * by predicate. (The `validate()` dry run calls the same function at the same
 * point; its answer carries no values, so the arm's verdict there is unchanged.)
 *
 * A single write is admitted or refused exactly as before. The unique-key
 * answer does move (Clause-② yes, narrowing): `42` after `"42"` on a `unique`
 * text field now collides, pinned below at the driver door and against SQLite
 * in `rest-data-text-scalar-value.test.ts`. Untouched, and pinned
 * here: a string, `null`, a missing key, a plain object or an array (refused,
 * #29133), a `json` field, a number field, a boolean field, and a declared
 * field the validator never judges.
 */

import { describe, it, expect } from 'vitest';
import { BOUNDED_STRING_FIELD_TYPES } from '@objectstack/spec/data';
import { normalizeNumericStringValues, validateRecord, ValidationError } from './record-validator.js';
import { ObjectQL } from '../engine.js';

const STRING_TYPES = [...BOUNDED_STRING_FIELD_TYPES];

const SCALARS: ReadonlyArray<readonly [unknown, string]> = [
  [42, '42'],
  [0, '0'],
  [-1.5, '-1.5'],
  [true, 'true'],
  [false, 'false'],
];

describe('#29241 — the door writes the string the arm judged', () => {
  it('reads the spec set, which still holds the twelve members this pin was written against', () => {
    expect(STRING_TYPES).toHaveLength(12);
  });

  for (const type of STRING_TYPES) {
    for (const [input, stored] of SCALARS) {
      it(`${type}: ${JSON.stringify(input)} is written as ${JSON.stringify(stored)}`, () => {
        const out = normalizeNumericStringValues({ fields: { f: { type } } }, { f: input });
        expect(out.f).toBe(stored);
      });
    }
  }

  it('the written string is the one the arm judges: a bound reads its length', () => {
    const schema = { fields: { code: { type: 'text', label: 'Code', maxLength: 2 } } };
    const row = normalizeNumericStringValues(schema, { code: 123 });
    expect(row).toEqual({ code: '123' });
    let err: unknown = null;
    try {
      validateRecord(schema, row, 'insert');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).fields.map((f) => [f.field, f.code])).toEqual([['code', 'max_length']]);
  });

  it('a readonly field is written too: its value is judged on every write', () => {
    const schema = { fields: { stamp: { type: 'text', readonly: true } } };
    expect(normalizeNumericStringValues(schema, { stamp: 7 })).toEqual({ stamp: '7' });
  });

  it('a batch is rewritten per row, and the caller objects are never mutated', () => {
    const schema = { fields: { title: { type: 'text' } } };
    const a = { title: 1 };
    const b = { title: 'two' };
    const list = [a, b];
    const out = normalizeNumericStringValues(schema, list);
    expect(out).not.toBe(list);
    expect(out[0]).toEqual({ title: '1' });
    expect(out[1]).toBe(b);
    expect(a).toEqual({ title: 1 });
  });
});

describe('#29241 — what the door leaves alone', () => {
  const schema = {
    fields: {
      title: { type: 'text' },
      payload: { type: 'json' },
      amount: { type: 'number' },
      done: { type: 'boolean' },
    },
  };

  it('a string, null, a missing key, an object and an array on a text field: the same row back', () => {
    for (const row of [{ title: '42' }, { title: null }, { title: undefined }, {}, { title: { a: 1 } }, { title: ['a'] }]) {
      expect(normalizeNumericStringValues(schema, row), JSON.stringify(row)).toBe(row);
    }
  });

  it('a json, number or boolean field keeps its number or boolean', () => {
    const row = { payload: 42, amount: 42, done: true };
    expect(normalizeNumericStringValues(schema, row)).toBe(row);
    const flags = { payload: false, amount: 0, done: false };
    expect(normalizeNumericStringValues(schema, flags)).toBe(flags);
  });

  it('a declared field the validator never judges is not rewritten (a SKIP_FIELDS name, a system field)', () => {
    const own = { fields: { id: { type: 'text' }, tenant_tag: { type: 'text', system: true } } };
    const row = { id: 42, tenant_tag: 7 };
    expect(normalizeNumericStringValues(own, row)).toBe(row);
  });

  it('an undeclared key is not rewritten', () => {
    const row = { nope: 42 };
    expect(normalizeNumericStringValues(schema, row)).toBe(row);
  });
});

/** The driver-facing half: what each engine door hands the driver. */
describe('#29241 — write path end to end: the driver receives the judged string', () => {
  async function boot() {
    const engine = new ObjectQL();
    const writes: unknown[] = [];
    const rows = new Map<string, Record<string, unknown>>([['rec_1', { id: 'rec_1', title: 'orig' }]]);
    engine.registerDriver({
      name: 'recording', version: '0.0.0', supports: {},
      async connect() {}, async disconnect() {}, async checkHealth() { return true; },
      async execute() { return null; },
      async find() { return Array.from(rows.values()); },
      async findOne(_o: string, ast: any) { return rows.get(ast?.where?.id) ?? null; },
      async create(_o: string, data: Record<string, unknown>) { writes.push(data); return { ...data, id: 'x' }; },
      async update(_o: string, id: string, data: Record<string, unknown>) { writes.push(data); return { ...data, id }; },
      async updateMany(_o: unknown, _a: unknown, data: unknown) { writes.push(data); return 0; },
      async delete() { return true; }, async count() { return rows.size; },
      async bulkCreate(_o: string, data: Record<string, unknown>[]) { writes.push(...data); return data.map((d, i) => ({ ...d, id: `b${i}` })); },
      async bulkUpdate() { return []; }, async bulkDelete() {},
      async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
      async commit() {}, async rollback() {},
    } as any, true);
    await engine.init();
    engine.registry.registerObject({
      name: 'scalar_task', label: 'Task',
      fields: {
        id: { name: 'id', label: 'ID', type: 'text', primaryKey: true },
        title: { name: 'title', label: 'Title', type: 'text' },
        mail: { name: 'mail', label: 'Mail', type: 'phone' },
        amount: { name: 'amount', label: 'Amount', type: 'number' },
        code: { name: 'code', label: 'Code', type: 'text', unique: true },
      },
    } as any);
    return { engine, writes };
  }

  const titles = (writes: unknown[]) => writes.map((w) => (w as Record<string, unknown>).title);

  it('insert, insertMany, update by id and update by predicate', async () => {
    const { engine, writes } = await boot();
    await engine.insert('scalar_task', { title: 42, mail: 5551234, amount: 7 } as any);
    await engine.insert('scalar_task', [{ title: true }, { title: 'kept' }] as any);
    await engine.update('scalar_task', { title: false } as any, { where: { id: 'rec_1' } } as any);
    await engine.update('scalar_task', { title: 0 } as any, { multi: true } as any);
    expect(titles(writes)).toEqual(['42', 'true', 'kept', 'false', '0']);
    for (const w of writes) {
      const title = (w as Record<string, unknown>).title;
      expect(typeof title, JSON.stringify(w)).toBe('string');
    }
    // A text-family format type is written the same way; a number field keeps its number.
    expect(writes[0]).toEqual(expect.objectContaining({ mail: '5551234', amount: 7 }));
  });

  it('a unique text field: 42 and "42" reach the driver as one value, so its unique key sees one value', async () => {
    // What any driver's unique check compares (driver-memory keys on the stored
    // value): base handed it 42 and "42", two keys; now one.
    const { engine, writes } = await boot();
    await engine.insert('scalar_task', { code: 42 } as any);
    await engine.insert('scalar_task', { code: '42' } as any);
    expect(writes.map((w) => (w as Record<string, unknown>).code)).toEqual(['42', '42']);
  });
});
