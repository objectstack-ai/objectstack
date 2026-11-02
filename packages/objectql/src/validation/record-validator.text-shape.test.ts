// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29133] A string-typed field (`BOUNDED_STRING_FIELD_TYPES`) refuses a plain
 * object or an array as its value.
 *
 * Measured on `origin/main` @ `fea2dbb7` before the change: `validateRecord`
 * admitted `{ nested: true }` and `['a', 'b']` on `text` and `textarea`, on
 * insert and on update, because the arm judged `String(value)` while the write
 * carried `value`; the driver then stored the JSON text. The arm now refuses
 * both shapes with the validator's existing `invalid_type` wire code and the
 * ADR-0104 `invalid_value_shape` sentence. Numbers, booleans and a missing
 * value are untouched.
 */

import { describe, it, expect } from 'vitest';
import { BOUNDED_STRING_FIELD_TYPES } from '@objectstack/spec/data';
import { validateRecord, validateRecordInScope, ValidationError } from './record-validator.js';
import { ObjectQL } from '../engine.js';

const STRING_TYPES = [...BOUNDED_STRING_FIELD_TYPES];

function errorsOf(
  schema: { fields: Record<string, any> },
  data: Record<string, unknown>,
  mode: 'insert' | 'update',
) {
  try {
    validateRecord(schema, data, mode);
  } catch (e) {
    if (e instanceof ValidationError) return e.fields;
    throw e;
  }
  return [];
}

describe('#29133 — a string-typed field refuses a plain object or an array', () => {
  it('reads the spec set, which still holds the twelve members this pin was written against', () => {
    // A member joining or leaving the spec set moves this door with it; the
    // count is pinned so a change is seen here, not inferred.
    expect(STRING_TYPES).toHaveLength(12);
    expect(STRING_TYPES).toContain('text');
    expect(STRING_TYPES).toContain('textarea');
  });

  for (const type of STRING_TYPES) {
    const schema = { fields: { f: { type, label: 'F' } } };
    for (const [shape, value, received] of [
      ['object', { nested: true }, 'an object'],
      ['array', ['a', 'b'], 'an array'],
      ['empty object', {}, 'an object'],
      ['empty array', [], 'an array'],
    ] as const) {
      for (const mode of ['insert', 'update'] as const) {
        it(`${type}: refuses ${shape} on ${mode} as invalid_type`, () => {
          const errs = errorsOf(schema, { f: value }, mode);
          expect(errs).toHaveLength(1);
          expect(errs[0].field).toBe('f');
          expect(errs[0].code).toBe('invalid_type');
          expect(errs[0].constraint).toMatchObject({
            type,
            detail: `expected a string, received ${received}`,
          });
        });
      }
    }
  }

  it('says what was wrong in the message: the field, the type and the received shape', () => {
    const errs = errorsOf({ fields: { title: { type: 'text', label: 'Title' } } }, { title: { nested: true } }, 'insert');
    expect(errs[0].message).toContain('Title');
    expect(errs[0].message).toContain('text');
    expect(errs[0].message).toContain('expected a string, received an object');
  });

  it('refuses the shape on a readonly field too (a shape arm, reached under the readonly scope)', () => {
    const schema = { fields: { stamp: { type: 'text', label: 'Stamp', readonly: true } } };
    let err: unknown = null;
    try {
      validateRecordInScope(schema, { stamp: ['x'] }, 'insert', 'include');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).fields.map((f) => [f.field, f.code])).toEqual([['stamp', 'invalid_type']]);
  });

  it('a filter-operator object keeps its own, earlier sentence', () => {
    const errs = errorsOf({ fields: { title: { type: 'text', label: 'Title' } } }, { title: { $in: ['a'] } }, 'update');
    expect(errs).toHaveLength(1);
    expect(errs[0].message).toContain('$in is a filter operator, not a value');
  });
});

describe('#29133 — what the rule leaves alone', () => {
  const schema = {
    fields: {
      title: { type: 'text', label: 'Title', maxLength: 5 },
      payload: { type: 'json', label: 'Payload' },
      mail: { type: 'email', label: 'Mail' },
    },
  };

  it('a string is admitted, and its bounds still bind', () => {
    expect(errorsOf(schema, { title: 'ok' }, 'insert')).toEqual([]);
    expect(errorsOf(schema, { title: 'too long' }, 'insert')[0].code).toBe('max_length');
  });

  it('a number and a boolean keep their string reading (out of this rule)', () => {
    expect(errorsOf(schema, { title: 42 }, 'insert')).toEqual([]);
    expect(errorsOf(schema, { title: true }, 'update')).toEqual([]);
  });

  it('null and undefined are unchanged', () => {
    expect(errorsOf(schema, { title: null }, 'update')).toEqual([]);
    expect(errorsOf(schema, { title: undefined }, 'insert')).toEqual([]);
  });

  it('a json field still holds any object', () => {
    expect(errorsOf(schema, { payload: { nested: true } }, 'insert')).toEqual([]);
  });

  it('a format type answers the shape refusal, not its format sentence', () => {
    const errs = errorsOf(schema, { mail: { address: 'a@b.co' } }, 'insert');
    expect(errs.map((e) => e.code)).toEqual(['invalid_type']);
  });
});

/**
 * The end-to-end half: the engine's create, update and multi-update doors
 * reach the rule, answer the VALIDATION_FAILED envelope, and the driver is
 * never written.
 */
describe('#29133 — write path end to end: no JSON text reaches the driver', () => {
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
      async bulkCreate() { return []; }, async bulkUpdate() { return []; }, async bulkDelete() {},
      async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
      async commit() {}, async rollback() {},
    } as any, true);
    await engine.init();
    engine.registry.registerObject({
      name: 'shape_task', label: 'Task',
      fields: {
        id: { name: 'id', label: 'ID', type: 'text', primaryKey: true },
        title: { name: 'title', label: 'Title', type: 'text' },
      },
    } as any);
    return { engine, writes, rows };
  }

  it('refuses on insert, update and multi-update, and the driver sees no write', async () => {
    const { engine, writes, rows } = await boot();
    for (const run of [
      () => engine.insert('shape_task', { title: { nested: true } } as any),
      () => engine.update('shape_task', { title: ['a', 'b'] } as any, { where: { id: 'rec_1' } } as any),
      () => engine.update('shape_task', { title: { nested: true } } as any, { multi: true } as any),
    ]) {
      const err = await run().then(() => null, (e: unknown) => e as ValidationError);
      expect(err).toBeInstanceOf(ValidationError);
      expect(err!.code).toBe('VALIDATION_FAILED');
      expect(err!.fields.map((f) => [f.field, f.code])).toEqual([['title', 'invalid_type']]);
    }
    expect(writes).toEqual([]);
    expect(rows.get('rec_1')).toEqual({ id: 'rec_1', title: 'orig' });
  });

  it('a string write on the same path still lands', async () => {
    const { engine, writes } = await boot();
    await engine.update('shape_task', { title: 'renamed' } as any, { where: { id: 'rec_1' } } as any);
    expect(writes).toEqual([expect.objectContaining({ title: 'renamed' })]);
  });
});
