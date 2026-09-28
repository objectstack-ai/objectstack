// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach } from 'vitest';
import { validateRecord, ValidationError } from './record-validator.js';
import { ObjectQL } from '../engine.js';

/**
 * #20386 — a `progress` field's declared `min` / `max` are ENFORCED at the
 * write seam, with the `number` field's codes (`min_value` / `max_value`).
 *
 * Before this, the number arm returned for `progress` right after the finite
 * check, above the bounds. Measured through the REST create route on
 * `origin/main` dc0ab6a2e: `150` into `max: 100` and `-5` into `min: 0` both
 * answered 201 and were stored, on memory and on SQLite, while a `number` field
 * with the same bounds refused both. `FieldSchema.min` / `max` declare the
 * check 「Checked on the WRITTEN value only」 with no type exclusion, and
 * triage 5865053231 ruled ENFORCE.
 *
 * ⛔ Only the bounds: `scale` and `precision` name their own type sets, and
 * `progress` is in neither, so both stay unread on it. The pins below hold
 * that line from both sides — the same declaration on `slider` refuses.
 *
 * The REST physical-column half (SQLite) is
 * `packages/rest/src/rest-data-progress-bounds.test.ts`. Memory and MongoDB
 * store exactly the payload the engine hands them, which the stub driver in the
 * last block records.
 */

const fieldsOf = (
  schema: Parameters<typeof validateRecord>[0],
  data: Record<string, unknown>,
  mode: 'insert' | 'update' = 'insert',
) => {
  try {
    validateRecord(schema, data, mode);
  } catch (e) {
    expect(e).toBeInstanceOf(ValidationError);
    expect((e as ValidationError).code).toBe('VALIDATION_FAILED');
    return (e as ValidationError).fields;
  }
  return null;
};

const BOUNDED = (type: string, extra: Record<string, unknown> = {}) => ({
  fields: { v: { type, label: 'Done', min: 0, max: 100, ...extra } },
});

describe('validateRecord — a `progress` field\'s `min` / `max` are enforced (#20386): the triage pins', () => {
  it('`progress` `max: 100` refuses 150 with `max_value`, the `number` field\'s code', () => {
    const errs = fieldsOf(BOUNDED('progress'), { v: 150 });
    expect(errs).toHaveLength(1);
    expect(errs![0]).toMatchObject({ field: 'v', code: 'max_value', constraint: { max: 100 } });
    // The template is interpolated: the bound reaches the sentence.
    expect(errs![0].message).toContain('100');
    expect(errs![0].message).not.toContain('{{');
  });

  it('`progress` `min: 0` refuses -5 with `min_value`, the `number` field\'s code', () => {
    const errs = fieldsOf(BOUNDED('progress'), { v: -5 });
    expect(errs).toHaveLength(1);
    expect(errs![0]).toMatchObject({ field: 'v', code: 'min_value', constraint: { min: 0 } });
  });

  it('a value inside the bounds is accepted, and both bounds are inclusive', () => {
    for (const v of [50, 0, 100, 33.5]) {
      expect(fieldsOf(BOUNDED('progress'), { v }), String(v)).toBeNull();
    }
  });

  it('the refusal is the `number` field\'s refusal, envelope for envelope', () => {
    for (const v of [150, -5]) {
      const strip = (errs: ReturnType<typeof fieldsOf>) => errs?.map(({ field, code, constraint }) => ({ field, code, constraint }));
      expect(strip(fieldsOf(BOUNDED('progress'), { v })), String(v)).toEqual(strip(fieldsOf(BOUNDED('number'), { v })));
    }
  });

  it('one bound declared alone binds alone', () => {
    const maxOnly = { fields: { v: { type: 'progress', label: 'Done', max: 100 } } };
    expect(fieldsOf(maxOnly, { v: 101 })?.[0]).toMatchObject({ field: 'v', code: 'max_value' });
    expect(fieldsOf(maxOnly, { v: -1000 })).toBeNull();
    const minOnly = { fields: { v: { type: 'progress', label: 'Done', min: 0 } } };
    expect(fieldsOf(minOnly, { v: -0.5 })?.[0]).toMatchObject({ field: 'v', code: 'min_value' });
    expect(fieldsOf(minOnly, { v: 1e6 })).toBeNull();
    // No bound declared: nothing is invented for the type (no implicit 0..100).
    const unbounded = { fields: { v: { type: 'progress', label: 'Done' } } };
    expect(fieldsOf(unbounded, { v: 150 })).toBeNull();
    expect(fieldsOf(unbounded, { v: -5 })).toBeNull();
  });

  it('refuses on update too, judges a string-carried number after coercion, and never re-reads an omitted field', () => {
    expect(fieldsOf(BOUNDED('progress'), { v: 150 }, 'update')?.[0]).toMatchObject({ field: 'v', code: 'max_value' });
    expect(fieldsOf(BOUNDED('progress'), { v: '150' })?.[0]).toMatchObject({ field: 'v', code: 'max_value' });
    expect(fieldsOf(BOUNDED('progress'), { v: '-5' })?.[0]).toMatchObject({ field: 'v', code: 'min_value' });
    expect(fieldsOf(BOUNDED('progress'), { v: '50' })).toBeNull();
    // The WRITTEN value only: an update that does not carry the field is not judged.
    expect(fieldsOf(BOUNDED('progress'), { other: 1 }, 'update')).toBeNull();
  });
});

describe('validateRecord — ⛔ `progress` takes the bounds only, never `scale` or `precision` (#20386)', () => {
  it('`scale: 0` is not read on `progress` — the same declaration on `slider` refuses', () => {
    expect(fieldsOf(BOUNDED('progress', { scale: 0 }), { v: 33.5 })).toBeNull();
    expect(fieldsOf(BOUNDED('slider', { scale: 0 }), { v: 33.5 })?.[0]).toMatchObject({ field: 'v', code: 'max_scale' });
  });

  it('`precision: 2` is not read on `progress` — the same declaration on `slider` refuses', () => {
    expect(fieldsOf(BOUNDED('progress', { precision: 2 }), { v: 99.5 })).toBeNull();
    expect(fieldsOf(BOUNDED('slider', { precision: 2 }), { v: 99.5 })?.[0]).toMatchObject({ field: 'v', code: 'max_precision' });
  });

  it('a bound still answers first when `scale` / `precision` are declared beside it', () => {
    expect(fieldsOf(BOUNDED('progress', { scale: 0, precision: 2 }), { v: 150.5 })?.[0]).toMatchObject({ field: 'v', code: 'max_value' });
  });
});

// ---------------------------------------------------------------------------
// Every engine write door reaches the refusal, the bulk doors included (AGENTS.md
// Prime Directive #10: "check every call site, bulk paths included"). The stub
// driver records what it is handed, so a refused write is shown to reach
// nothing, and an accepted one to arrive as the same number.
// ---------------------------------------------------------------------------

function makeStubDriver() {
  const calls: Array<{ fn: string; data: unknown }> = [];
  const rows = new Map<string, Record<string, unknown>>();
  let n = 0;
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
      calls.push({ fn: 'create', data: { ...data } });
      const row = { ...data, id: (data.id as string) ?? `r${++n}` };
      rows.set(row.id as string, row);
      return row;
    },
    async bulkCreate(_o: string, list: Record<string, unknown>[]) {
      calls.push({ fn: 'bulkCreate', data: list.map((r) => ({ ...r })) });
      return list.map((r) => {
        const row = { ...r, id: (r.id as string) ?? `r${++n}` };
        rows.set(row.id as string, row);
        return row;
      });
    },
    async update(_o: string, id: string, data: Record<string, unknown>) {
      calls.push({ fn: 'update', data: { ...data } });
      const row = { ...(rows.get(id) ?? {}), ...data, id };
      rows.set(id, row);
      return row;
    },
    async updateMany(_o: string, _ast: unknown, data: Record<string, unknown>) {
      calls.push({ fn: 'updateMany', data: { ...data } });
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

const TASK = {
  name: 'progress_task',
  label: 'Task',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    done: { name: 'done', type: 'progress' as const, label: 'Done', min: 0, max: 100 },
  },
};

describe('engine write doors — a `progress` bound is refused on every door, bulk included (#20386)', () => {
  let engine: ObjectQL;
  let stub: ReturnType<typeof makeStubDriver>;

  beforeEach(async () => {
    stub = makeStubDriver();
    engine = new ObjectQL();
    engine.registerDriver(stub.driver, true);
    await engine.init();
    engine.registry.registerObject(TASK as any);
  });

  const refusal = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      return { code: (e as ValidationError).code, fields: (e as ValidationError).fields.map((f) => [f.field, f.code]) };
    }
    return null;
  };
  const OVER = { code: 'VALIDATION_FAILED', fields: [['done', 'max_value']] };
  const UNDER = { code: 'VALIDATION_FAILED', fields: [['done', 'min_value']] };
  const writes = () => stub.calls.filter((c) => c.fn !== 'find');
  /** Every value any driver write call carried for `done`. */
  const written = () =>
    writes()
      .flatMap((c) => (Array.isArray(c.data) ? c.data : [c.data]) as Record<string, unknown>[])
      .filter((r) => 'done' in r)
      .map((r) => r.done);

  it('insert of one row, and of an array of rows — the whole batch is refused and nothing reaches the driver', async () => {
    expect(await refusal(() => engine.insert('progress_task', { id: 'a', done: 150 }))).toEqual(OVER);
    expect(await refusal(() => engine.insert('progress_task', { id: 'b', done: -5 }))).toEqual(UNDER);
    expect(
      await refusal(() => engine.insert('progress_task', [{ id: 'c1', done: 50 }, { id: 'c2', done: 150 }])),
    ).toEqual(OVER);
    expect(writes()).toEqual([]);
  });

  it('insertMany (partial success): the out-of-bound row fails alone, the fitting row is written', async () => {
    const outcomes = await engine.insertMany('progress_task', [{ id: 'm1', done: 50 }, { id: 'm2', done: 150 }]);
    expect(outcomes.map((o) => o.ok)).toEqual([true, false]);
    const failed = outcomes[1] as { ok: false; error: unknown };
    expect(failed.error).toBeInstanceOf(ValidationError);
    expect((failed.error as ValidationError).fields.map((f) => [f.field, f.code])).toEqual([['done', 'max_value']]);
    expect(written()).toEqual([50]);
  });

  it('update by id and update by predicate (multi) — refused before the driver', async () => {
    await engine.insert('progress_task', { id: 'u1', done: 10 });
    stub.calls.length = 0;
    expect(await refusal(() => engine.update('progress_task', { id: 'u1', done: 150 }))).toEqual(OVER);
    expect(
      await refusal(() => engine.update('progress_task', { done: -5 }, { where: { id: { $in: ['u1'] } }, multi: true } as any)),
    ).toEqual(UNDER);
    expect(writes().filter((c) => c.fn === 'update' || c.fn === 'updateMany')).toEqual([]);
  });

  it('the dry run (`validate`) predicts the same refusal', async () => {
    const refused = await engine.validate('progress_task', { id: 'p1', done: 150 });
    expect(refused.valid).toBe(false);
    expect(refused.results?.[0]?.errors.map((e: any) => [e.field, e.code])).toEqual([['done', 'max_value']]);
    expect((await engine.validate('progress_task', { id: 'p2', done: 100 })).valid).toBe(true);
  });

  it('CONTROL — a value inside the bounds reaches the driver as the same number on every door', async () => {
    await engine.insert('progress_task', { id: 'k1', done: 100 });
    await engine.insert('progress_task', [{ id: 'k2', done: 0 }]);
    await engine.update('progress_task', { id: 'k1', done: 45.5 });
    await engine.update('progress_task', { done: 60 }, { where: { id: { $in: ['k1'] } }, multi: true } as any);
    const got = written();
    expect(got).toEqual([100, 0, 45.5, 60]);
  });
});
