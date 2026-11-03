// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29244] A select's value is an option code: one for a single-value
 * `select` / `radio`, an array of them for a multi-value one. A plain object or
 * an array is refused as the single value, and as an element of the array.
 *
 * Measured on `origin/main` @ `04e0c2c0` before the change, with a recording
 * driver behind the real engine, on insert, update by id and update by
 * predicate alike:
 *
 *   field                                   value        before                       after
 *   select, no options                      { a: 1 }     ADMIT, driver got { a: 1 }   invalid_type
 *   select, no options (and radio)          ['x']        ADMIT, driver got ['x']      invalid_type
 *   select, options a/b                     ['a']        ADMIT, driver got ['a']      invalid_type
 *   select, options a/b                     { a: 1 }     invalid_option               invalid_type
 *   select multiple, no options             [{ a: 1 }]   ADMIT                        invalid_type
 *   select multiple, no options             [['x']]      ADMIT                        invalid_type
 *   select multiple, options a/b            [['a']]      ADMIT, driver got [['a']]    invalid_type
 *   multiselect / tags / checkboxes, free   [{ a: 1 }]   ADMIT                        invalid_type
 *
 * A string, a number, an array of scalars on a multi-value field, and option
 * membership are unchanged.
 */

import { describe, it, expect } from 'vitest';
import { validateRecord, validateRecordInScope, normalizeNumericStringValues, ValidationError } from './record-validator.js';
import { ObjectQL } from '../engine.js';

const schema = {
  fields: {
    free: { type: 'select', label: 'Free' },
    free_radio: { type: 'radio', label: 'Free radio' },
    decl: { type: 'select', label: 'Stage', options: [{ value: 'a' }, { value: 'b' }] },
    free_multi: { type: 'select', label: 'Free multi', multiple: true },
    decl_multi: { type: 'select', label: 'Stages', multiple: true, options: [{ value: 'a' }, { value: 'b' }] },
    ms: { type: 'multiselect', label: 'MS' },
    tags: { type: 'tags', label: 'Tags' },
    boxes: { type: 'checkboxes', label: 'Boxes' },
  },
};

function errorsOf(data: Record<string, unknown>, mode: 'insert' | 'update' = 'insert') {
  try {
    validateRecord(schema, data, mode);
  } catch (e) {
    if (e instanceof ValidationError) return e.fields;
    throw e;
  }
  return [];
}

describe('#29244 — a single-value select refuses a plain object or an array', () => {
  for (const field of ['free', 'free_radio', 'decl'] as const) {
    for (const [shape, value, received] of [
      ['object', { a: 1 }, 'an object'],
      ['empty object', {}, 'an object'],
      ['array', ['a'], 'an array'],
      ['empty array', [], 'an array'],
    ] as const) {
      for (const mode of ['insert', 'update'] as const) {
        it(`${field}: refuses ${shape} on ${mode} as invalid_type`, () => {
          const errs = errorsOf({ [field]: value }, mode);
          expect(errs.map((e) => [e.field, e.code])).toEqual([[field, 'invalid_type']]);
          expect(errs[0].constraint).toMatchObject({
            type: schema.fields[field].type,
            detail: `expected one option value, received ${received}`,
          });
        });
      }
    }
  }

  it('says the field, the type and the received shape in the message', () => {
    const errs = errorsOf({ free: { a: 1 } });
    expect(errs[0].message).toContain('Free');
    expect(errs[0].message).toContain('select');
    expect(errs[0].message).toContain('expected one option value, received an object');
  });

  it('refuses the shape on a readonly select too (a shape arm, reached under the readonly scope)', () => {
    const ro = { fields: { kind: { type: 'select', label: 'Kind', readonly: true } } };
    let err: unknown = null;
    try {
      validateRecordInScope(ro, { kind: ['x'] }, 'insert', 'include');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).fields.map((f) => [f.field, f.code])).toEqual([['kind', 'invalid_type']]);
  });

  it('a filter-operator object keeps its own, earlier sentence', () => {
    const errs = errorsOf({ free: { $in: ['a'] } }, 'update');
    expect(errs).toHaveLength(1);
    expect(errs[0].message).toContain('$in is a filter operator, not a value');
  });
});

describe('#29244 — a multi-value option field refuses an element that is a plain object or an array', () => {
  for (const field of ['free_multi', 'decl_multi', 'ms', 'tags', 'boxes'] as const) {
    for (const [shape, value, received] of [
      ['object element', ['a', { a: 1 }], 'an object'],
      ['array element', [['a']], 'an array'],
    ] as const) {
      it(`${field}: refuses an ${shape} as invalid_type`, () => {
        const errs = errorsOf({ [field]: value });
        expect(errs.map((e) => [e.field, e.code])).toEqual([[field, 'invalid_type']]);
        expect(errs[0].constraint).toMatchObject({
          detail: `expected an array of option values, received an element that is ${received}`,
        });
      });
    }
  }
});

describe('#29244 — what the rule leaves alone', () => {
  it('a scalar on a single-value select is judged as before', () => {
    expect(errorsOf({ free: 'anything', free_radio: 'x', decl: 'a' })).toEqual([]);
    // [#29562] A number is judged by its string reading, and the write door
    // stores that string: `3` is admitted on a free select as the code `"3"`
    // (the door half is pinned in `record-validator.option-scalar-value.test.ts`).
    expect(errorsOf({ free: 3 })).toEqual([]);
    expect(normalizeNumericStringValues(schema, { free: 3 })).toEqual({ free: '3' });
    expect(errorsOf({ decl: 'z' }).map((e) => e.code)).toEqual(['invalid_option']);
  });

  it('an array of scalars on a multi-value field is judged as before', () => {
    expect(errorsOf({ free_multi: ['x', 'y'], decl_multi: ['a', 'b'], ms: ['x'], tags: ['t'], boxes: [] })).toEqual([]);
    expect(errorsOf({ decl_multi: ['z'] }).map((e) => e.code)).toEqual(['invalid_option']);
  });

  it('a value that is not an array on a multi-value select keeps its existing invalid_type_array sentence', () => {
    // (The engine wraps a lone scalar before this validator runs; the write
    // path test below lands one.)
    for (const value of ['x', { a: 1 }]) {
      const errs = errorsOf({ free_multi: value });
      expect(errs.map((e) => e.code)).toEqual(['invalid_type']);
      expect(errs[0].message).toMatch(/must be an array/i);
      expect(errs[0].message).not.toContain('option values');
    }
  });

  it('null and undefined are unchanged', () => {
    expect(errorsOf({ free: null, free_multi: null }, 'update')).toEqual([]);
    expect(errorsOf({ free: undefined }, 'insert')).toEqual([]);
  });
});

/**
 * The end-to-end half: the engine's create, update-by-id and update-by-predicate
 * doors reach the rule, answer the VALIDATION_FAILED envelope, and the driver
 * is never written.
 */
describe('#29244 — write path end to end: no object or array reaches the driver', () => {
  async function boot() {
    const engine = new ObjectQL();
    const writes: unknown[] = [];
    const rows = new Map<string, Record<string, unknown>>([['rec_1', { id: 'rec_1', stage: 'orig' }]]);
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
      name: 'shape_deal', label: 'Deal',
      fields: {
        id: { name: 'id', label: 'ID', type: 'text', primaryKey: true },
        stage: { name: 'stage', label: 'Stage', type: 'select' },
        labels: { name: 'labels', label: 'Labels', type: 'select', multiple: true },
      },
    } as any);
    return { engine, writes, rows };
  }

  it('refuses on insert, update and multi-update, and the driver sees no write', async () => {
    const { engine, writes, rows } = await boot();
    for (const [field, run] of [
      ['stage', () => engine.insert('shape_deal', { stage: { a: 1 } } as any)],
      ['stage', () => engine.update('shape_deal', { stage: ['x'] } as any, { where: { id: 'rec_1' } } as any)],
      ['stage', () => engine.update('shape_deal', { stage: { a: 1 } } as any, { multi: true } as any)],
      ['labels', () => engine.insert('shape_deal', { labels: [{ a: 1 }] } as any)],
      ['labels', () => engine.update('shape_deal', { labels: [['x']] } as any, { where: { id: 'rec_1' } } as any)],
    ] as const) {
      const err = await run().then(() => null, (e: unknown) => e as ValidationError);
      expect(err).toBeInstanceOf(ValidationError);
      expect(err!.code).toBe('VALIDATION_FAILED');
      expect(err!.fields.map((f) => [f.field, f.code])).toEqual([[field, 'invalid_type']]);
    }
    expect(writes).toEqual([]);
    expect(rows.get('rec_1')).toEqual({ id: 'rec_1', stage: 'orig' });
  });

  it('a scalar, an array of scalars and a lone scalar (wrapped) on the same path still land', async () => {
    const { engine, writes } = await boot();
    await engine.update('shape_deal', { stage: 'won', labels: ['x', 'y'] } as any, { where: { id: 'rec_1' } } as any);
    await engine.insert('shape_deal', { stage: 'open', labels: 'x' } as any);
    expect(writes).toEqual([
      expect.objectContaining({ stage: 'won', labels: ['x', 'y'] }),
      expect.objectContaining({ stage: 'open', labels: ['x'] }),
    ]);
  });
});
