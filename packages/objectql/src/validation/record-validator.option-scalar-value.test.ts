// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29562] An option-family field (`select` / `radio`, `multiselect` /
 * `checkboxes` / `tags`, and a `multiple: true` select / radio) stores an
 * option code: a string, or an array of them (the spec's `valueSchemaFor`).
 *
 * Measured on `origin/main` @ `d3175d59` before the change, on driver-memory
 * and on SQLite, through the engine (insert, update by id, update by
 * predicate) and REST `POST` / `PATCH`:
 *
 *   field · value                          base memory   base SQLite        head (both)
 *   free select · 3                        3             "3.0"              "3"
 *   free select · true                     true          "1.0"              "true"
 *   select, code "3" · 3                   3             "3.0"              "3"
 *   select, codes a/b · 3                  invalid_option invalid_option    invalid_option
 *   multiselect / checkboxes / tags · [3]  [3]           [3] (JSON)         ["3"]
 *   free select · new Date(…)              the Date      its epoch, as TEXT invalid_type
 *   free select · new Map(), a class inst. as sent       "{}", its JSON     invalid_type
 *   multiselect · [new Date(…)]            its ISO text  its ISO text       invalid_type
 *   multiselect · [new Map()]              [{}]          [{}]               invalid_type
 *
 * The option arms judged a number or a boolean by `String(value)` while the
 * write carried the raw scalar; the door now writes that string
 * (`normalizeNumericStringValues`, the #29241 text-family half's sibling), on
 * insert, insertMany, update by id and update by predicate. The arms refuse
 * any object, not only a plain one (`isPlainObjectValue` is prototype-strict,
 * so a `Date`, a `Map` or a class instance fell through to membership).
 *
 * A number or boolean write is admitted or refused exactly as before. What
 * moves (Clause-② yes, narrowing): a `unique` option field's key compares the
 * string, so `3` after `"3"` collides (pinned at the driver door below and
 * against SQLite in `rest-data-option-scalar-value.test.ts`), and an object
 * that is not plain is refused.
 */

import { describe, it, expect } from 'vitest';
import { SINGLE_OPTION_TYPES, MULTI_OPTION_TYPES } from '@objectstack/spec/data';
import { normalizeNumericStringValues, validateRecord, validateRecordInScope, ValidationError } from './record-validator.js';
import { ObjectQL } from '../engine.js';

const SCALARS: ReadonlyArray<readonly [unknown, string]> = [
  [3, '3'],
  [0, '0'],
  [-1.5, '-1.5'],
  [true, 'true'],
  [false, 'false'],
];

class Widget {
  k = 1;
}

const NON_PLAIN: ReadonlyArray<readonly [string, () => unknown]> = [
  ['a Date', () => new Date('2026-01-02T00:00:00Z')],
  ['a Map', () => new Map([['a', 1]])],
  ['a Set', () => new Set(['a'])],
  ['a class instance', () => new Widget()],
];

const schema = {
  fields: {
    free: { type: 'select', label: 'Free' },
    free_radio: { type: 'radio', label: 'Free radio' },
    decl3: { type: 'select', label: 'Score', options: [{ value: '3' }, { value: 'true' }, { value: 'a' }] },
    declx: { type: 'select', label: 'Stage', options: [{ value: 'a' }, { value: 'b' }] },
    free_multi: { type: 'select', label: 'Free multi', multiple: true },
    ms: { type: 'multiselect', label: 'MS' },
    msd: { type: 'multiselect', label: 'Scores', options: [{ value: '3' }, { value: 'true' }] },
    tags: { type: 'tags', label: 'Tags' },
    boxes: { type: 'checkboxes', label: 'Boxes' },
  },
} as const;

function errorsOf(data: Record<string, unknown>, mode: 'insert' | 'update' = 'insert') {
  try {
    validateRecord(schema as any, data, mode);
  } catch (e) {
    if (e instanceof ValidationError) return e.fields;
    throw e;
  }
  return [];
}

describe('#29562 — the door writes the string an option arm judged', () => {
  it('reads the spec sets, which still hold the five types this pin was written against', () => {
    expect([...SINGLE_OPTION_TYPES, ...MULTI_OPTION_TYPES].sort()).toEqual(
      ['checkboxes', 'multiselect', 'radio', 'select', 'tags'],
    );
  });

  for (const type of SINGLE_OPTION_TYPES) {
    for (const [input, stored] of SCALARS) {
      it(`${type}: ${JSON.stringify(input)} is written as ${JSON.stringify(stored)}`, () => {
        const out = normalizeNumericStringValues({ fields: { f: { type } } }, { f: input });
        expect(out.f).toBe(stored);
      });
    }
  }

  for (const def of [
    ...[...MULTI_OPTION_TYPES].map((type) => ({ type })),
    { type: 'select', multiple: true },
    { type: 'radio', multiple: true },
  ]) {
    const label = def.type + ('multiple' in def ? ' multiple' : '');
    it(`${label}: each number or boolean element is written as its string`, () => {
      const input = [3, 'a', true, null, -1.5, false];
      const out = normalizeNumericStringValues({ fields: { f: def } }, { f: input });
      expect(out.f).toEqual(['3', 'a', 'true', null, '-1.5', 'false']);
      expect(input).toEqual([3, 'a', true, null, -1.5, false]);
    });
    it(`${label}: a lone number is written as its string (the engine wraps it)`, () => {
      expect(normalizeNumericStringValues({ fields: { f: def } }, { f: 3 }).f).toBe('3');
    });
  }

  it('membership is judged on that string: a declared code "3" admits 3, and codes a/b still refuse it', () => {
    const row = normalizeNumericStringValues(schema as any, { decl3: 3, msd: [3, true] });
    expect(row).toEqual({ decl3: '3', msd: ['3', 'true'] });
    expect(errorsOf(row)).toEqual([]);
    const refused = errorsOf(normalizeNumericStringValues(schema as any, { declx: 3 }));
    expect(refused.map((e) => [e.field, e.code])).toEqual([['declx', 'invalid_option']]);
  });

  it('a readonly option field is written too: its value is judged on every write', () => {
    const ro = { fields: { kind: { type: 'select', readonly: true }, kinds: { type: 'tags', readonly: true } } };
    expect(normalizeNumericStringValues(ro, { kind: 7, kinds: [7] })).toEqual({ kind: '7', kinds: ['7'] });
  });
});

describe('#29562 — what the door leaves alone on an option field', () => {
  it('a string, null, a missing key, an object and an array on a single select: the same row back', () => {
    for (const row of [{ free: '3' }, { free: null }, { free: undefined }, {}, { free: { a: 1 } }, { free: [3] }, { free: new Date(0) }]) {
      expect(normalizeNumericStringValues(schema as any, row), String(row.free)).toBe(row);
    }
  });

  it('an array of strings on a multi-value option field: the same row, and the same array, back', () => {
    const row = { ms: ['a', 'b'], tags: [] };
    expect(normalizeNumericStringValues(schema as any, row)).toBe(row);
  });

  it('an array on a multi-value lookup is not an option field: left as sent', () => {
    const own = { fields: { owners: { type: 'lookup', reference: 'user', multiple: true } } };
    const row = { owners: [3] };
    expect(normalizeNumericStringValues(own, row)).toBe(row);
  });

  it('a field outside the option and text sets keeps its number: json, number, boolean', () => {
    const own = { fields: { payload: { type: 'json' }, amount: { type: 'number' }, done: { type: 'boolean' } } };
    const row = { payload: [3], amount: 3, done: true };
    expect(normalizeNumericStringValues(own, row)).toBe(row);
  });
});

describe('#29562 — an option arm refuses any object, not only a plain one', () => {
  for (const field of ['free', 'free_radio', 'decl3', 'declx'] as const) {
    for (const [shape, make] of NON_PLAIN) {
      for (const mode of ['insert', 'update'] as const) {
        it(`${field}: refuses ${shape} on ${mode} as invalid_type`, () => {
          const errs = errorsOf({ [field]: make() }, mode);
          expect(errs.map((e) => [e.field, e.code])).toEqual([[field, 'invalid_type']]);
          expect(errs[0].constraint).toMatchObject({
            type: schema.fields[field].type,
            detail: 'expected one option value, received an object',
          });
        });
      }
    }
  }

  for (const field of ['free_multi', 'ms', 'msd', 'tags', 'boxes'] as const) {
    for (const [shape, make] of NON_PLAIN) {
      it(`${field}: refuses an element that is ${shape} as invalid_type`, () => {
        const errs = errorsOf({ [field]: ['3', make()] });
        expect(errs.map((e) => [e.field, e.code])).toEqual([[field, 'invalid_type']]);
        expect(errs[0].constraint).toMatchObject({
          detail: 'expected an array of option values, received an element that is an object',
        });
      });
    }
  }

  it('says the field and the received shape in the message', () => {
    const errs = errorsOf({ free: new Date(0) });
    expect(errs[0].message).toContain('Free');
    expect(errs[0].message).toContain('expected one option value, received an object');
  });

  it('refuses it on a readonly select too (a shape arm, reached under the readonly scope)', () => {
    const ro = { fields: { kind: { type: 'select', label: 'Kind', readonly: true } } };
    let err: unknown = null;
    try {
      validateRecordInScope(ro, { kind: new Date(0) }, 'insert', 'include');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).fields.map((f) => [f.field, f.code])).toEqual([['kind', 'invalid_type']]);
  });
});

/** The driver-facing half: what each engine door hands the driver. */
describe('#29562 — write path end to end: the driver receives the judged string', () => {
  async function boot() {
    const engine = new ObjectQL();
    const writes: Record<string, unknown>[] = [];
    const rows = new Map<string, Record<string, unknown>>([['rec_1', { id: 'rec_1', stage: 'orig' }]]);
    engine.registerDriver({
      name: 'recording', version: '0.0.0', supports: {},
      async connect() {}, async disconnect() {}, async checkHealth() { return true; },
      async execute() { return null; },
      async find() { return Array.from(rows.values()); },
      async findOne(_o: string, ast: any) { return rows.get(ast?.where?.id) ?? null; },
      async create(_o: string, data: Record<string, unknown>) { writes.push(data); return { ...data, id: 'x' }; },
      async update(_o: string, id: string, data: Record<string, unknown>) { writes.push(data); return { ...data, id }; },
      async updateMany(_o: unknown, _a: unknown, data: Record<string, unknown>) { writes.push(data); return 0; },
      async delete() { return true; }, async count() { return rows.size; },
      async bulkCreate(_o: string, data: Record<string, unknown>[]) { writes.push(...data); return data.map((d, i) => ({ ...d, id: `b${i}` })); },
      async bulkUpdate() { return []; }, async bulkDelete() {},
      async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
      async commit() {}, async rollback() {},
    } as any, true);
    await engine.init();
    engine.registry.registerObject({
      name: 'option_scalar', label: 'Option scalar',
      fields: {
        id: { name: 'id', label: 'ID', type: 'text', primaryKey: true },
        stage: { name: 'stage', label: 'Stage', type: 'select' },
        mood: { name: 'mood', label: 'Mood', type: 'radio' },
        labels: { name: 'labels', label: 'Labels', type: 'multiselect' },
        picks: { name: 'picks', label: 'Picks', type: 'select', multiple: true },
        code: { name: 'code', label: 'Code', type: 'select', unique: true },
      },
    } as any);
    return { engine, writes, rows };
  }

  it('insert, insertMany, update by id and update by predicate', async () => {
    const { engine, writes } = await boot();
    await engine.insert('option_scalar', { stage: 3, mood: true, labels: [3, 'x'], picks: 7 } as any);
    await engine.insert('option_scalar', [{ stage: false }, { stage: 'kept' }] as any);
    await engine.update('option_scalar', { stage: 1.5, labels: [false] } as any, { where: { id: 'rec_1' } } as any);
    await engine.update('option_scalar', { stage: 0, picks: [true, 2] } as any, { multi: true } as any);
    expect(writes.map((w) => w.stage)).toEqual(['3', 'false', 'kept', '1.5', '0']);
    expect(writes[0]).toEqual(expect.objectContaining({ mood: 'true', labels: ['3', 'x'], picks: ['7'] }));
    expect(writes[3]).toEqual(expect.objectContaining({ labels: ['false'] }));
    expect(writes[4]).toEqual(expect.objectContaining({ picks: ['true', '2'] }));
  });

  it('a non-plain object is refused on insert, update and multi-update, and the driver sees no write', async () => {
    const { engine, writes, rows } = await boot();
    for (const [field, run] of [
      ['stage', () => engine.insert('option_scalar', { stage: new Date(0) } as any)],
      ['stage', () => engine.update('option_scalar', { stage: new Map() } as any, { where: { id: 'rec_1' } } as any)],
      ['stage', () => engine.update('option_scalar', { stage: new Widget() } as any, { multi: true } as any)],
      ['labels', () => engine.insert('option_scalar', { labels: [new Date(0)] } as any)],
      ['picks', () => engine.update('option_scalar', { picks: ['a', new Map()] } as any, { where: { id: 'rec_1' } } as any)],
    ] as const) {
      const err = await run().then(() => null, (e: unknown) => e as ValidationError);
      expect(err).toBeInstanceOf(ValidationError);
      expect(err!.code).toBe('VALIDATION_FAILED');
      expect(err!.fields.map((f) => [f.field, f.code])).toEqual([[field, 'invalid_type']]);
    }
    expect(writes).toEqual([]);
    expect(rows.get('rec_1')).toEqual({ id: 'rec_1', stage: 'orig' });
  });

  it('a unique select: 3 and "3" reach the driver as one value, so its unique key sees one value', async () => {
    // What any driver's unique check compares (driver-memory keys on the stored
    // value): base handed it 3 and "3", two keys; now one.
    const { engine, writes } = await boot();
    await engine.insert('option_scalar', { code: 3 } as any);
    await engine.insert('option_scalar', { code: '3' } as any);
    expect(writes.map((w) => w.code)).toEqual(['3', '3']);
  });
});
