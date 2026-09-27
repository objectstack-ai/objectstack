// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #20308 — a BLANK on a non-string-typed column reaches the driver as `null`,
 * on every engine write door.
 *
 * ## The defect
 *
 * `validateOne` reads `''` (and whitespace) as missing and returns before its
 * type checks, and nothing rewrote the value, so the driver received it as
 * sent. Measured on `origin/main` de091b50e6 through the real engine: memory
 * and SQLite stored `''` in number, currency, percent, rating, slider,
 * progress, summary, boolean, toggle, date, datetime and time columns on every
 * door (insert, insert[], insertMany, update by id, update by predicate), and
 * PostgreSQL refused the statement (`22P02` / `22007`; `500 DATABASE_ERROR` at
 * REST). One clear, three outcomes.
 *
 * ## What this file pins
 *
 * What the DRIVER receives, on each door — the one thing every backend then
 * stores (memory and MongoDB store it verbatim; the SQL physical column is
 * `packages/rest/src/rest-data-blank-typed-value.test.ts`). And the four
 * interactions the door's placement decides:
 *
 *  - `required` refuses a blank exactly as it refuses `null` (same code);
 *  - on insert a blank takes a declared `defaultValue` exactly as `null` does
 *    (#2706) — the door runs BEFORE the defaults;
 *  - a `readonlyWhen` lock still holds against a caller's blank — the door
 *    runs BEFORE the caller-value snapshot the lock judges against;
 *  - the dry run (`validate()`) agrees with the write.
 *
 * The string-stored controls (`text`, `lookup`, `select`) keep their `''` —
 * the spec's `str_empty` side of the line.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { NON_TEXT_STORED_VALUE_TYPES } from '@objectstack/spec/data';
import { ObjectQL } from './engine.js';
import { ValidationError } from './validation/record-validator.js';

const TYPED = [...NON_TEXT_STORED_VALUE_TYPES];
const f = (t: string) => `f_${t}`;

interface Call { fn: string; data: Record<string, unknown> }

function makeStubDriver() {
  const calls: Call[] = [];
  const rows = new Map<string, Record<string, unknown>>();
  const idOf = (q: any): string | undefined => {
    const w = q?.where ?? q?.filter ?? q;
    const id = w?.id;
    return typeof id === 'string' ? id : undefined;
  };
  let n = 0;
  const driver: any = {
    name: 'stub', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find(_o: string, q: any) {
      const id = idOf(q);
      const inIds = q?.where?.id?.$in as string[] | undefined;
      const all = [...rows.values()];
      if (id) return all.filter((r) => r.id === id);
      if (inIds) return all.filter((r) => inIds.includes(r.id as string));
      return all;
    },
    async findOne(_o: string, q: any) {
      const id = idOf(q);
      return (id ? rows.get(id) : rows.values().next().value) ?? null;
    },
    async count() { return rows.size; },
    async create(_o: string, data: Record<string, unknown>) {
      calls.push({ fn: 'create', data: { ...data } });
      const row = { ...data, id: (data.id as string) ?? `r${++n}` };
      rows.set(row.id as string, row);
      return row;
    },
    async bulkCreate(_o: string, list: Record<string, unknown>[]) {
      calls.push({ fn: 'bulkCreate', data: { rows: list.map((r) => ({ ...r })) } });
      const out: Record<string, unknown>[] = [];
      for (const r of list) {
        const row = { ...r, id: (r.id as string) ?? `r${++n}` };
        rows.set(row.id as string, row);
        out.push(row);
      }
      return out;
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
  return { driver, calls, rows };
}

const OBJ = {
  name: 'blank_door',
  label: 'Blank door',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    c_text: { name: 'c_text', type: 'text' as const },
    c_lookup: { name: 'c_lookup', type: 'lookup' as const, reference: 'blank_door' },
    c_select: { name: 'c_select', type: 'select' as const, options: [{ value: 'a', label: 'A' }] },
    ...Object.fromEntries(TYPED.map((t) => [f(t), { name: f(t), type: t }])),
  },
};

const REQ = {
  name: 'blank_req',
  label: 'Blank required',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    status: { name: 'status', type: 'text' as const },
    r_number: { name: 'r_number', type: 'number' as const, required: true },
    rd_number: { name: 'rd_number', type: 'number' as const, required: true, defaultValue: 5 },
    od_date: { name: 'od_date', type: 'date' as const, defaultValue: '2020-01-01' },
    locked_amount: { name: 'locked_amount', type: 'number' as const, readonlyWhen: "record.status == 'closed'" },
  },
};

const VALID: Record<string, unknown> = {
  f_number: 0, f_currency: 9.5, f_percent: 0.25, f_rating: 3, f_slider: 10, f_progress: 50, f_summary: 7,
  f_boolean: false, f_toggle: true, f_date: '2026-09-27', f_datetime: '2026-09-27T10:00:00.000Z', f_time: '14:30:00',
};

const blankTyped = (v: string) => Object.fromEntries(TYPED.map((t) => [f(t), v]));
const STR_BLANK = { c_text: '', c_lookup: '', c_select: '' };

function expectTypedNull(data: Record<string, unknown>) {
  for (const t of TYPED) expect(data[f(t)], t).toBeNull();
}

describe('engine write doors: a blank on a non-string-typed column reaches the driver as null (#20308)', () => {
  let engine: ObjectQL;
  let stub: ReturnType<typeof makeStubDriver>;

  beforeEach(async () => {
    stub = makeStubDriver();
    engine = new ObjectQL();
    engine.registerDriver(stub.driver, true);
    await engine.init();
    engine.registry.registerObject(OBJ as any);
    engine.registry.registerObject(REQ as any);
  });

  const last = (fn: string) => [...stub.calls].reverse().find((c) => c.fn === fn)!.data;

  it.each([[''], ['  ']])('insert, one row: %j → null; the string-stored controls keep their blank', async (blank) => {
    const payload: Record<string, unknown> = { id: 'a', ...blankTyped(blank), ...STR_BLANK };
    await engine.insert('blank_door', payload);
    const sent = last('create');
    expectTypedNull(sent);
    expect([sent.c_text, sent.c_lookup, sent.c_select]).toEqual(['', '', '']);
    // The caller's own object is never rewritten.
    expect(payload.f_number).toBe(blank);
  });

  it('insert, an array of rows and insertMany: every row', async () => {
    await engine.insert('blank_door', [{ id: 'b1', ...blankTyped('') }, { id: 'b2', ...blankTyped('') }]);
    const sent = [...stub.calls].filter((c) => c.fn === 'create' || c.fn === 'bulkCreate');
    const written = sent.flatMap((c) => (c.fn === 'bulkCreate' ? (c.data.rows as Record<string, unknown>[]) : [c.data]));
    expect(written.map((r) => r.id)).toEqual(['b1', 'b2']);
    for (const r of written) expectTypedNull(r);

    stub.calls.length = 0;
    const outcomes = await engine.insertMany('blank_door', [{ id: 'm1', ...blankTyped('') }]);
    expect(outcomes.map((o) => o.ok)).toEqual([true]);
    const many = [...stub.calls].filter((c) => c.fn === 'create' || c.fn === 'bulkCreate')
      .flatMap((c) => (c.fn === 'bulkCreate' ? (c.data.rows as Record<string, unknown>[]) : [c.data]));
    expect(many).toHaveLength(1);
    expectTypedNull(many[0]!);
  });

  it('update by id and update by predicate', async () => {
    await engine.insert('blank_door', { id: 'u1', ...VALID });
    await engine.update('blank_door', { id: 'u1', ...blankTyped(''), ...STR_BLANK });
    const byId = last('update');
    expectTypedNull(byId);
    expect([byId.c_text, byId.c_lookup, byId.c_select]).toEqual(['', '', '']);

    await engine.update('blank_door', blankTyped(''), { where: { id: { $in: ['u1'] } }, multi: true } as any);
    expectTypedNull(last('updateMany'));
  });

  it('a valid value on every typed column — falsy ones included — is unchanged', async () => {
    await engine.insert('blank_door', { id: 'v1', ...VALID });
    const sent = last('create');
    for (const [k, v] of Object.entries(VALID)) expect(sent[k], k).toStrictEqual(v);
  });

  it('required refuses a blank exactly as it refuses null — insert and update', async () => {
    const codes = async (fn: () => Promise<unknown>) => {
      try { await fn(); return null; } catch (e) {
        expect(e).toBeInstanceOf(ValidationError);
        return { code: (e as ValidationError).code, fields: (e as ValidationError).fields.map((x) => [x.field, x.code]) };
      }
    };
    const blank = await codes(() => engine.insert('blank_req', { id: 'q1', r_number: '' }));
    const nul = await codes(() => engine.insert('blank_req', { id: 'q2', r_number: null }));
    expect(blank).toEqual({ code: 'VALIDATION_FAILED', fields: [['r_number', 'required']] });
    expect(blank).toEqual(nul);

    await engine.insert('blank_req', { id: 'q3', r_number: 1 });
    const cleared = await codes(() => engine.update('blank_req', { id: 'q3', r_number: '' }));
    expect(cleared).toEqual({ code: 'VALIDATION_FAILED', fields: [['r_number', 'required']] });
  });

  it('on insert a blank takes the declared defaultValue exactly as null does — required or not', async () => {
    await engine.insert('blank_req', { id: 'd1', r_number: 1, rd_number: '', od_date: '' });
    const blank = last('create');
    await engine.insert('blank_req', { id: 'd2', r_number: 1, rd_number: null, od_date: null });
    const nul = last('create');
    expect([blank.rd_number, blank.od_date]).toEqual([5, '2020-01-01']);
    expect([nul.rd_number, nul.od_date]).toEqual([5, '2020-01-01']);
  });

  it('the dry run agrees with the write on the same blank', async () => {
    const preview = await engine.validate('blank_req', { id: 'p1', r_number: 1, rd_number: '' });
    expect(preview.valid).toBe(true);
    const refused = await engine.validate('blank_req', { id: 'p2', r_number: '' });
    expect(refused.valid).toBe(false);
    expect(refused.results?.[0]?.errors.map((e: any) => [e.field, e.code])).toEqual([['r_number', 'required']]);
  });

  it('a readonlyWhen lock still holds against a caller blank — the snapshot it judges is the normalised one', async () => {
    await engine.insert('blank_req', { id: 'l1', r_number: 1, status: 'closed', locked_amount: 10 });
    await engine.update('blank_req', { id: 'l1', locked_amount: '' });
    const sent = last('update');
    expect('locked_amount' in sent).toBe(false);
    expect(stub.rows.get('l1')?.locked_amount).toBe(10);

    // Unlocked, the same blank clears the column to null.
    await engine.insert('blank_req', { id: 'l2', r_number: 1, status: 'open', locked_amount: 10 });
    await engine.update('blank_req', { id: 'l2', locked_amount: '' });
    expect(last('update').locked_amount).toBeNull();
  });
});
