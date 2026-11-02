// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #29176 — an empty string on an OPTIONAL text-like column that a unique
 * constraint covers reaches the driver as `null`, on every engine write door.
 *
 * ## The defect
 *
 * A cleared text input is sent as `''`, and the write path stored it verbatim.
 * Every unique constraint the drivers build is NULL-distinct (driver-sql's
 * `(organization_id, field)` index, the memory driver's key model), so `null`
 * never collides — but `''` is a value, and the second record cleared, or
 * created with `''`, was refused `409 UNIQUE_VIOLATION` although neither
 * record holds a value.
 *
 * ## What this file pins
 *
 * What the DRIVER receives, door by door (the physical column on SQLite, and
 * the 409 that no longer fires, are `packages/rest/src/rest-data-optional-unique-blank.test.ts`):
 *
 *  - the rewrite, on both unique surfaces: a field's own `unique`, and a member
 *    of a declared `indexes[]` entry carrying `unique`;
 *  - its edges, each a control: a column no unique constraint covers keeps
 *    `''` (the spec's `str_empty` side of the line); whitespace is a value, as
 *    the `$empty` operator's ruled table reads it; a non-blank value is
 *    untouched. (A unique `select` / `lookup` `''` is `null` too since #29277,
 *    on every optional column, unique or not: `pick` / `ref` below.)
 *  - `required` is unchanged: a required unique field's `''` is refused
 *    `required` exactly as before — including when the field declares a
 *    `defaultValue`, which a blank rewritten to `null` would have taken;
 *  - the credential ruling is unchanged: `''` on a `password` field is still
 *    refused, never rewritten into a clear.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectQL } from './engine.js';
import { ValidationError } from './validation/record-validator.js';
import { EmptyCredentialWriteError, EMPTY_CREDENTIAL_REFUSAL_CODE, EMPTY_CREDENTIAL_REFUSAL_STATUS } from './secret-fields.js';

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
    // Not a query-honouring `find`: nothing here reads rows back through it
    // (the by-id prior read is `findOne`), so it answers the whole store.
    async find() { return [...rows.values()]; },
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
  name: 'uniq_blank',
  label: 'Unique blank',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    sku: { name: 'sku', type: 'text' as const, unique: true },
    tax_id: { name: 'tax_id', type: 'text' as const, unique: 'global' as const },
    email: { name: 'email', type: 'email' as const, unique: 'organization' as const },
    grp: { name: 'grp', type: 'text' as const },
    code: { name: 'code', type: 'text' as const },
    note: { name: 'note', type: 'text' as const },
    plain_idx: { name: 'plain_idx', type: 'text' as const },
    off: { name: 'off', type: 'text' as const, unique: false },
    pick: { name: 'pick', type: 'select' as const, unique: true, options: [{ value: 'a', label: 'A' }] },
    ref: { name: 'ref', type: 'lookup' as const, unique: true, reference: 'uniq_blank' },
  },
  indexes: [
    { name: 'idx_uniq_blank_grp_code', fields: ['grp', 'code'], unique: 'global' as const },
    { name: 'idx_uniq_blank_plain', fields: ['plain_idx'] },
  ],
};

const REQ = {
  name: 'uniq_blank_req',
  label: 'Unique blank required',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    sku: { name: 'sku', type: 'text' as const, unique: true, required: true },
    skud: { name: 'skud', type: 'text' as const, unique: true, required: true, defaultValue: 'D-1' },
    opt_d: { name: 'opt_d', type: 'text' as const, unique: true, defaultValue: 'O-1' },
  },
};

const CRED = {
  name: 'uniq_blank_cred',
  label: 'Unique blank credential',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    pin: { name: 'pin', type: 'password' as const, unique: true },
  },
};

/** The covered columns of {@link OBJ}: both unique surfaces, three scopes; and [#29277] the single-value select / lookup. */
const COVERED_NAMES = ['sku', 'tax_id', 'email', 'code', 'pick', 'ref'];
/** The text columns that keep their `''`: no unique constraint. */
const KEPT_NAMES = ['note', 'plain_idx', 'off'];
const blanksOf = (names: readonly string[]) => Object.fromEntries(names.map((n) => [n, '']));
const COVERED = blanksOf(COVERED_NAMES);
const KEPT = blanksOf(KEPT_NAMES);

function expectCoveredNull(data: Record<string, unknown>) {
  for (const k of COVERED_NAMES) expect(data[k], k).toBeNull();
}
function expectKeptBlank(data: Record<string, unknown>) {
  for (const k of KEPT_NAMES) expect(data[k], k).toBe('');
}

async function refusal(fn: () => Promise<unknown>) {
  try { await fn(); return null; } catch (e) {
    return {
      name: (e as Error).name,
      code: (e as { code?: unknown }).code,
      fields: e instanceof ValidationError ? e.fields.map((x) => [x.field, x.code]) : undefined,
    };
  }
}

describe('engine write doors: an optional unique text-like column stores "" as null (#29176)', () => {
  let engine: ObjectQL;
  let stub: ReturnType<typeof makeStubDriver>;

  beforeEach(async () => {
    stub = makeStubDriver();
    engine = new ObjectQL();
    engine.registerDriver(stub.driver, true);
    await engine.init();
    engine.registry.registerObject(OBJ as any);
    engine.registry.registerObject(REQ as any);
    engine.registry.registerObject(CRED as any);
  });

  const last = (fn: string) => [...stub.calls].reverse().find((c) => c.fn === fn)!.data;
  const written = () => stub.calls
    .filter((c) => c.fn === 'create' || c.fn === 'bulkCreate')
    .flatMap((c) => (c.fn === 'bulkCreate' ? (c.data.rows as Record<string, unknown>[]) : [c.data]));

  it('insert, one row: every covered column is null; the controls keep ""', async () => {
    const payload: Record<string, unknown> = { id: 'a', grp: 'g1', ...COVERED, ...KEPT };
    await engine.insert('uniq_blank', payload);
    const sent = last('create');
    expectCoveredNull(sent);
    expectKeptBlank(sent);
    // The caller's own object is never rewritten.
    expect(payload.sku).toBe('');
  });

  it('insert, an array of rows and insertMany: every row', async () => {
    await engine.insert('uniq_blank', [{ id: 'b1', ...COVERED }, { id: 'b2', ...COVERED }]);
    const rows = written();
    expect(rows.map((r) => r.id)).toEqual(['b1', 'b2']);
    for (const r of rows) expectCoveredNull(r);

    stub.calls.length = 0;
    const outcomes = await engine.insertMany('uniq_blank', [{ id: 'm1', ...COVERED }]);
    expect(outcomes.map((o) => o.ok)).toEqual([true]);
    const many = written();
    expect(many).toHaveLength(1);
    expectCoveredNull(many[0]!);
  });

  it('update by id and update by predicate', async () => {
    await engine.insert('uniq_blank', { id: 'u1', sku: 'S1', tax_id: 'T1', email: 'a@b.co', grp: 'g', code: 'C1' });
    await engine.update('uniq_blank', { id: 'u1', ...COVERED, ...KEPT });
    const byId = last('update');
    expectCoveredNull(byId);
    expectKeptBlank(byId);

    await engine.update('uniq_blank', { ...COVERED }, { where: { id: { $in: ['u1'] } }, multi: true } as any);
    expectCoveredNull(last('updateMany'));
  });

  it('whitespace and every non-blank value pass through untouched', async () => {
    await engine.insert('uniq_blank', { id: 'w1', sku: '  ', tax_id: ' x ', email: 'a@b.co', code: '0' });
    const sent = last('create');
    expect([sent.sku, sent.tax_id, sent.email, sent.code]).toEqual(['  ', ' x ', 'a@b.co', '0']);
  });

  it('an optional covered field with a defaultValue: a blank takes it on insert, exactly as null does', async () => {
    await engine.insert('uniq_blank_req', { id: 'd1', sku: 'S1', skud: 'K1', opt_d: '' });
    const blank = last('create');
    await engine.insert('uniq_blank_req', { id: 'd2', sku: 'S2', skud: 'K2', opt_d: null });
    const nul = last('create');
    expect([blank.opt_d, nul.opt_d]).toEqual(['O-1', 'O-1']);
  });

  it('required is unchanged: a required unique field refuses "" as `required` — insert, update and the dry run', async () => {
    const expected = { name: 'ValidationError', code: 'VALIDATION_FAILED', fields: [['sku', 'required']] };
    expect(await refusal(() => engine.insert('uniq_blank_req', { id: 'q1', sku: '', skud: 'K1' }))).toEqual(expected);

    await engine.insert('uniq_blank_req', { id: 'q2', sku: 'S2', skud: 'K2' });
    expect(await refusal(() => engine.update('uniq_blank_req', { id: 'q2', sku: '' }))).toEqual(expected);

    const preview = await engine.validate('uniq_blank_req', { id: 'q3', sku: '', skud: 'K3' });
    expect(preview.valid).toBe(false);
    expect(preview.results?.[0]?.errors.map((e: any) => [e.field, e.code])).toEqual([['sku', 'required']]);
  });

  it('required is unchanged: a required unique field with a defaultValue refuses "" — it is NOT defaulted', async () => {
    // `applyFieldDefaults` reads `''` as a real value, so the default never
    // fills it and `required` refuses it. Rewriting the blank to `null` here
    // would let the default fill it and the write land.
    expect(await refusal(() => engine.insert('uniq_blank_req', { id: 'r1', sku: 'S1', skud: '' })))
      .toEqual({ name: 'ValidationError', code: 'VALIDATION_FAILED', fields: [['skud', 'required']] });
    expect(written().some((r) => r.id === 'r1')).toBe(false);
  });

  it('the credential ruling is unchanged: "" on a unique password field is refused, never cleared', async () => {
    let thrown: unknown;
    try { await engine.insert('uniq_blank_cred', { id: 'p1', pin: '' }); } catch (e) { thrown = e; }
    expect(thrown).toBeInstanceOf(EmptyCredentialWriteError);
    expect(thrown).toMatchObject({ code: EMPTY_CREDENTIAL_REFUSAL_CODE, status: EMPTY_CREDENTIAL_REFUSAL_STATUS, field: 'pin' });
    expect(written().some((r) => r.id === 'p1')).toBe(false);
  });
});
