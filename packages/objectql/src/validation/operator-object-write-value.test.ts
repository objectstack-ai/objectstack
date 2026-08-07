// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5922] A filter operator object is never a scalar field's VALUE.
 *
 * ## The asymmetry this closes
 *
 * Measured on `origin/main` @ `70f132c15` with a recording driver behind the
 * real engine, writing one and the same `{ $in: ['a','b'] }` into fifteen
 * declared field types:
 *
 * | type | before | after |
 * |:--|:--|:--|
 * | `text` / `textarea` | **ADMIT** — `driver.update` got `{"title":{"$in":["a","b"]}}` | refuse |
 * | `select` with NO `options` | **ADMIT** | refuse |
 * | `lookup` (and the reference class) | **ADMIT** + an ADR-0104 warn | refuse |
 * | `number` / `percent` | refuse (`invalid_number`) | refuse |
 * | `boolean` | refuse (`invalid_boolean`) | refuse |
 * | `date` / `datetime` / `time` | refuse (`invalid_date` / …) | refuse |
 * | `select` WITH `options`, `url`, `email`, `phone` | refuse — but only because `String({…})` is `"[object Object]"` | refuse |
 * | `json` (structured-JSON class) | admit | **admit — by design** |
 *
 * The four "refuse" cells in the second-to-last row are the reason this rule
 * had to be a rule rather than a patch on `text`: they were never deciding
 * anything about operator objects, they were failing a regex on a stringified
 * object. Eleven of fifteen types disagreed with the other four for no reason
 * an author could predict from the metadata.
 *
 * ## What is deliberately NOT here
 *
 * - **`json` and the structured-JSON class** keep admitting. `{ "$in": [...] }`
 *   in a `json` column is a user's data; nothing distinguishes it from a
 *   mis-written filter and nothing should try.
 * - **`data.id`.** Post-#5748/#5919 a non-scalar `data.id` is no longer bound
 *   as a primary key and rides into `driver.updateMany`'s SET payload instead —
 *   but `ENGINE_UPDATE_DISPATCH_CASES` rules that exact call ("operator object
 *   in data.id WITH multi:true — the declared bulk intent is honoured") and
 *   `engine-update-dispatch.test.ts` drives it against the real engine. That is
 *   a dispatch-axis contract; refusing it here would be a second answer to a
 *   question that module exists to answer once. Reported, filed, not patched.
 */

import { describe, it, expect } from 'vitest';
import { validateRecord, ValidationError } from './record-validator.js';
import { ObjectQL } from '../engine.js';

const OP = { $in: ['a', 'b'] };

/** One field of each declared type the rule now closes. */
const schema = {
  fields: {
    title: { type: 'text', label: 'Title' },
    note: { type: 'textarea', label: 'Note' },
    stage: { type: 'select', label: 'Stage', options: [{ value: 'a' }, { value: 'b' }] },
    stage_free: { type: 'select', label: 'Free stage' },
    due: { type: 'date', label: 'Due' },
    done: { type: 'boolean', label: 'Done' },
    owner: { type: 'lookup', label: 'Owner', reference: 'task' },
    n: { type: 'number', label: 'N' },
    payload: { type: 'json', label: 'Payload' },
    tags: { type: 'select', label: 'Tags', multiple: true, options: [{ value: 'a' }] },
  },
};

function errorsOf(data: Record<string, unknown>, mode: 'insert' | 'update' = 'update') {
  try {
    validateRecord(schema, data, mode);
  } catch (e) {
    if (e instanceof ValidationError) return e.fields;
    throw e;
  }
  return [];
}

describe('#5922 — an operator object is refused on every scalar-valued field', () => {
  // The dispatch's four-type survey, plus the two string types the issue
  // reported and the reference class the ADR-0104 branch used to wave through.
  for (const field of ['title', 'note', 'stage', 'stage_free', 'due', 'done', 'owner', 'n'] as const) {
    it(`refuses { ${field}: { $in: [...] } } and NAMES the operator`, () => {
      const errs = errorsOf({ [field]: OP });
      expect(errs).toHaveLength(1);
      expect(errs[0].field).toBe(field);
      // The wire code stays ADR-0114's `invalid_type` — this is a shape
      // refusal, not a new vocabulary entry.
      expect(errs[0].code).toBe('invalid_type');
      // The message must name the FIELD, the offending OPERATOR and the
      // DECLARED TYPE — the three facts `invalid_number` gives for its half of
      // the same mistake, which is what makes the two answers one family.
      expect(errs[0].message).toContain(schema.fields[field].label);
      expect(errs[0].message).toContain('$in');
      expect(errs[0].message).toContain(schema.fields[field].type);
      expect(errs[0].message).toMatch(/filter/i);
      // …and the discrete constraint carries the same facts machine-readably.
      expect(errs[0].constraint).toMatchObject({ type: schema.fields[field].type });
    });
  }

  it('names EVERY operator when the payload carries a compound filter', () => {
    const errs = errorsOf({ title: { $gte: 1, $lte: 9 } });
    expect(errs).toHaveLength(1);
    expect(errs[0].message).toContain('$gte');
    expect(errs[0].message).toContain('$lte');
    expect(errs[0].message).toContain('are filter operators');
  });

  it('refuses a LOGICAL combinator too, not only field operators', () => {
    // `$and`/`$or`/`$not` reach the same payload by the same accident.
    expect(errorsOf({ title: { $or: [{ a: 1 }] } })).toHaveLength(1);
  });

  it('refuses a RETIRED operator — a filter spelled `$regex` is still a filter', () => {
    // `$regex` is retired from the protocol but `plugin-auth` still emits it,
    // so the shape is live. `RETIRED_FILTER_OPERATORS` is folded into the
    // lookup set for exactly this.
    expect(errorsOf({ title: { $regex: '^a' } })).toHaveLength(1);
  });

  it('applies on INSERT, not only on UPDATE', () => {
    const errs = errorsOf({ title: OP }, 'insert');
    expect(errs.map((e) => e.field)).toContain('title');
  });
});

describe('#5922 — what the rule deliberately leaves alone', () => {
  it('admits an operator-shaped object in a `json` column (it is data, not a filter)', () => {
    expect(() => validateRecord(schema, { payload: OP }, 'update')).not.toThrow();
  });

  it('leaves a multi-value field on its existing `invalid_type_array` refusal', () => {
    const errs = errorsOf({ tags: OP });
    expect(errs).toHaveLength(1);
    expect(errs[0].message).toMatch(/array/i);
  });

  it('admits an UNDECLARED $-spelling — not a filter any backend executes', () => {
    // The rule is derived from the spec's operator vocabulary, not from the
    // `$` sigil. `{ $inn: … }` is out of scope by construction; judging every
    // plain object on a scalar field is #5922's option A, which this is not.
    expect(() => validateRecord(schema, { title: { $inn: ['a'] } }, 'update')).not.toThrow();
  });

  it('admits a plain non-operator object (same reason)', () => {
    expect(() => validateRecord(schema, { title: { a: 1 } }, 'update')).not.toThrow();
  });
});

describe('#5922 — legal scalars still pass, and the pre-existing refusals still refuse', () => {
  it('accepts a legal scalar for every closed type', () => {
    expect(() =>
      validateRecord(
        schema,
        {
          title: 'Ship it', note: 'a longer note', stage: 'a', stage_free: 'anything',
          due: '2026-08-07', done: true, owner: 'rec_1', n: 42, payload: { any: 'shape' },
          tags: ['a'],
        },
        'insert',
      ),
    ).not.toThrow();
  });

  it('a Date is a comparand, not an operator object', () => {
    expect(() => validateRecord(schema, { due: new Date('2026-08-07') }, 'update')).not.toThrow();
  });

  it('`number` keeps its own `invalid_number` refusal for a non-numeric SCALAR', () => {
    // The regression pin the issue's premise rests on: the new rule sits in
    // front of the type branches, so this asserts it did not swallow them.
    const errs = errorsOf({ n: 'abc' });
    expect(errs).toHaveLength(1);
    expect(errs[0].code).toBe('invalid_number');
    expect(errs[0].message).toBe('N must be a number');
  });

  it('`boolean` and `select` keep their own refusals for non-operator garbage', () => {
    expect(errorsOf({ done: 'perhaps' })[0].code).toBe('invalid_boolean');
    expect(errorsOf({ stage: 'zzz' })[0].code).toBe('invalid_option');
  });
});

/**
 * The end-to-end half: the issue's PROBE, run against the real engine.
 * A unit test over `validateRecord` proves the rule; only this proves the rule
 * is REACHED on the write path and that nothing dirty reaches storage.
 */
describe('#5922 — write path end to end: no dirty row reaches the driver', () => {
  function recordingDriver() {
    const rows = new Map<string, Record<string, unknown>>();
    const writes: Array<{ fn: string; data: unknown }> = [];
    const driver: any = {
      name: 'recording', version: '0.0.0', supports: {},
      async connect() {}, async disconnect() {}, async checkHealth() { return true; },
      async execute() { return null; },
      async find() { return Array.from(rows.values()); },
      async findOne(_o: string, ast: any) { return rows.get(ast?.where?.id) ?? null; },
      async create(_o: string, data: Record<string, unknown>) {
        writes.push({ fn: 'create', data });
        const id = (data.id as string) ?? `rec_${rows.size + 1}`;
        const row = { ...data, id };
        rows.set(id, row);
        return row;
      },
      async update(_o: string, id: string, data: Record<string, unknown>) {
        writes.push({ fn: 'update', data });
        const next = { ...(rows.get(id) ?? { id }), ...data, id };
        rows.set(id, next);
        return next;
      },
      async updateMany(_o: unknown, _ast: unknown, data: Record<string, unknown>) {
        writes.push({ fn: 'updateMany', data });
        return rows.size;
      },
      async upsert(o: string, data: any) { return this.create(o, data); },
      async delete(_o: string, id: string) { return rows.delete(id); },
      async count() { return rows.size; },
      async bulkCreate(o: string, r: any[]) { return Promise.all(r.map((x) => this.create(o, x))); },
      async bulkUpdate() { return []; }, async bulkDelete() {},
      async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
      async commit() {}, async rollback() {},
    };
    return { driver, rows, writes };
  }

  async function boot() {
    const engine = new ObjectQL();
    const stub = recordingDriver();
    engine.registerDriver(stub.driver, true);
    await engine.init();
    engine.registry.registerObject({
      name: 'op_task',
      label: 'Task',
      fields: {
        id: { name: 'id', label: 'ID', type: 'text', primaryKey: true },
        title: { name: 'title', label: 'Title', type: 'text' },
        n: { name: 'n', label: 'N', type: 'number' },
      },
    } as any);
    return { engine, ...stub };
  }

  it('refuses the issue’s exact update PROBE, and the driver is never touched', async () => {
    const { engine, rows, writes } = await boot();
    rows.set('rec_1', { id: 'rec_1', title: 'orig' });
    writes.length = 0;

    await expect(
      engine.update('op_task', { title: { $in: ['a', 'b'] } } as any, { where: { id: 'rec_1' } } as any),
    ).rejects.toThrow(/filter operator/i);

    // The two halves of "no dirty data": the driver saw no write at all…
    expect(writes).toEqual([]);
    // …and the stored row still holds the value it had before the attempt.
    expect(rows.get('rec_1')).toEqual({ id: 'rec_1', title: 'orig' });
  });

  it('refuses it on insert too, and stores nothing', async () => {
    const { engine, rows, writes } = await boot();
    await expect(
      engine.insert('op_task', { title: { $in: ['a', 'b'] } } as any),
    ).rejects.toThrow(/filter operator/i);
    expect(writes).toEqual([]);
    expect(rows.size).toBe(0);
  });

  it('refuses it on the MULTI update path (the second validateRecord call site)', async () => {
    const { engine, rows, writes } = await boot();
    rows.set('rec_1', { id: 'rec_1', title: 'orig' });
    writes.length = 0;
    await expect(
      engine.update('op_task', { title: { $in: ['a', 'b'] } } as any, { multi: true } as any),
    ).rejects.toThrow(/filter operator/i);
    expect(writes).toEqual([]);
  });

  it('a legal write on the same path still lands', async () => {
    const { engine, rows } = await boot();
    rows.set('rec_1', { id: 'rec_1', title: 'orig' });
    await engine.update('op_task', { title: 'renamed', n: 7 } as any, { where: { id: 'rec_1' } } as any);
    expect(rows.get('rec_1')).toMatchObject({ title: 'renamed', n: 7 });
  });
});
