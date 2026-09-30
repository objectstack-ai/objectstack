// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #20805 — a caller-supplied `formula` value is STRIPPED on every write path,
// in every context, and REPORTED under its own `computed` reason; and
// `engine.validate` runs the write's own doors.
//
// ## What was wrong (measured on `main` 5bed1f6caf, real drivers)
//
// A `formula` field is virtual — computed on read, no column on any driver —
// so a full read returns the key and a record written back carries it. The
// engine's one write-side field door judged UNDECLARED keys only, so the key
// reached the driver, and the driver decided:
//
//   door                            SQLite                         memory
//   protocol.createData             SqliteError, no status/field   stored, no droppedFields
//   REST create                     400 INVALID_FIELD (REST's      201
//                                   driver-string branch)
//   engine.update by id             SqliteError                    stored, no drop
//   engine.insert, isSystem         SqliteError                    stored
//   engine.validate (formula key)   valid: true                    valid: true
//   engine.validate (unknown key)   valid: true — while insert refuses it 400
//
// ## What this file pins, on a RECORDING driver (the payload IS the verdict)
//
// The strip, on `insert` (single, batch, `insertMany`), `update` (by id and
// multi) and in `isSystem`; the report (`computed`, never `readonly`); the
// strict refusal the derived coverage implies; the hooks' view; and
// `engine.validate` running the same doors. The memory and SQLite cells are
// `packages/runtime/src/sandbox/undeclared-field-write-driver-split.integration.test.ts`.

import { describe, it, expect } from 'vitest';
import { ObjectQL } from './engine.js';
import type { DroppedFieldsEvent } from '@objectstack/spec/data';

const silentLogger: any = (() => {
  const l: any = {
    trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {},
    child() { return l; },
  };
  return l;
})();

type RecordedCall = { fn: 'create' | 'update' | 'updateMany'; id?: string; data: Record<string, unknown> };

/** Records what reaches the driver — the payload is the verdict. */
function makeRecordingDriver() {
  const calls: RecordedCall[] = [];
  const rows = new Map<string, Record<string, unknown>>();
  let seq = 0;
  const driver: any = {
    name: 'recording', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find() { return [...rows.values()]; },
    async findOne() { return rows.values().next().value ?? null; },
    async create(_o: string, data: Record<string, unknown>) {
      calls.push({ fn: 'create', data: { ...data } });
      const id = (data.id as string | undefined) ?? `gen_${++seq}`;
      return { id, ...data };
    },
    async update(_o: string, id: string, data: Record<string, unknown>) {
      calls.push({ fn: 'update', id, data: { ...data } });
      return { id, ...data };
    },
    async updateMany(_o: string, _ast: unknown, data: Record<string, unknown>) {
      calls.push({ fn: 'updateMany', data: { ...data } });
      return 1;
    },
    async delete() { return true; },
    async deleteMany() { return 0; },
    async count() { return 0; },
    async bulkCreate(o: string, list: Record<string, unknown>[]) {
      return Promise.all(list.map((r) => driver.create(o, r)));
    },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() { return { __trx: true, commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  rows.set('rec_1', { id: 'rec_1', n: 1, title: 't0', note: null });
  return { driver, calls };
}

/**
 * `doubled` is the formula under test; `tripled_locked` is a formula ALSO
 * declared `readonly: true` (reported once, as `computed`); `note` is a static
 * `readonly` column — the control that its own strip and reason are unchanged;
 * `title` / `n` are the writable controls.
 */
async function makeEngine() {
  const engine = new ObjectQL({ logger: silentLogger });
  const { driver, calls } = makeRecordingDriver();
  engine.registerDriver(driver, true);
  await engine.init();
  engine.registry.registerObject({
    name: 'proj',
    fields: {
      n: { type: 'number' },
      title: { type: 'text' },
      doubled: { type: 'formula', expression: 'record.n * 2' },
      tripled_locked: { type: 'formula', expression: 'record.n * 3', readonly: true },
      note: { type: 'text', readonly: true },
    },
  } as any);
  return { engine, calls };
}

function listener() {
  const events: DroppedFieldsEvent[] = [];
  return { events, onFieldsDropped: (e: DroppedFieldsEvent) => { events.push(e); } };
}

async function rejection(p: Promise<unknown>): Promise<any> {
  try {
    await p;
  } catch (err) {
    return err;
  }
  throw new Error('expected the call to be refused, but it resolved');
}

const COMPUTED_DOUBLED: DroppedFieldsEvent = { object: 'proj', fields: ['doubled'], reason: 'computed' };

describe('[#20805] insert — a formula value is stripped, the write succeeds, the strip is reported as computed', () => {
  it('single row: the driver never sees the key, the writable fields land, one computed event', async () => {
    const { engine, calls } = await makeEngine();
    const l = listener();
    const created = await engine.insert('proj', { n: 1, title: 'a', doubled: 5 }, { onFieldsDropped: l.onFieldsDropped });

    expect(calls.filter((c) => c.fn === 'create')).toHaveLength(1);
    expect(calls[0]!.data).not.toHaveProperty('doubled');
    expect(calls[0]!.data).toMatchObject({ n: 1, title: 'a' });
    expect(l.events).toEqual([COMPUTED_DOUBLED]);
    // The write succeeded, and the read-side formula still answers from `n`.
    expect(created).toMatchObject({ n: 1, title: 'a', doubled: 2 });
  });

  it('isSystem: stripped and reported too — there is no column to land in for ANY caller', async () => {
    const { engine, calls } = await makeEngine();
    const l = listener();
    await engine.insert('proj', { n: 1, doubled: 5, note: 'seeded' }, { context: { isSystem: true }, onFieldsDropped: l.onFieldsDropped } as any);

    expect(calls[0]!.data).not.toHaveProperty('doubled');
    // Control: the static-`readonly` exemption for a system writer is unchanged.
    expect(calls[0]!.data).toMatchObject({ note: 'seeded' });
    expect(l.events).toEqual([COMPUTED_DOUBLED]);
  });

  it('batch: every row is stripped and the union is reported ONCE', async () => {
    const { engine, calls } = await makeEngine();
    const l = listener();
    await engine.insert('proj', [{ n: 1, doubled: 5 }, { n: 2 }, { n: 3, doubled: 9 }], { onFieldsDropped: l.onFieldsDropped });

    const created = calls.filter((c) => c.fn === 'create');
    expect(created).toHaveLength(3);
    for (const c of created) expect(c.data).not.toHaveProperty('doubled');
    expect(l.events).toEqual([COMPUTED_DOUBLED]);
  });

  it('insertMany: a row the declared-field door refuses counts toward nothing; the live row is stripped', async () => {
    const { engine, calls } = await makeEngine();
    const l = listener();
    const outcomes = await engine.insertMany(
      'proj',
      [{ n: 1, tripled_locked: 3, nope: 1 }, { n: 2, doubled: 4 }],
      { onFieldsDropped: l.onFieldsDropped },
    );

    expect(outcomes[0]).toMatchObject({ ok: false });
    expect((outcomes[0] as any).error).toMatchObject({ code: 'INVALID_FIELD', status: 400, field: 'nope' });
    expect(outcomes[1]).toMatchObject({ ok: true });
    const created = calls.filter((c) => c.fn === 'create');
    expect(created).toHaveLength(1);
    expect(created[0]!.data).not.toHaveProperty('doubled');
    // `tripled_locked` sat only on the refused row, so it is not reported.
    expect(l.events).toEqual([COMPUTED_DOUBLED]);
  });

  it('a formula also declared readonly is reported ONCE, as computed — not as readonly', async () => {
    const { engine, calls } = await makeEngine();
    const l = listener();
    await engine.insert('proj', { n: 1, tripled_locked: 3 }, { onFieldsDropped: l.onFieldsDropped });

    expect(calls[0]!.data).not.toHaveProperty('tripled_locked');
    expect(l.events).toEqual([{ object: 'proj', fields: ['tripled_locked'], reason: 'computed' }]);
  });

  it('control: a static readonly key is still stripped under `readonly`, beside the computed event', async () => {
    const { engine, calls } = await makeEngine();
    const l = listener();
    await engine.insert('proj', { n: 1, note: 'forged', doubled: 5 }, { onFieldsDropped: l.onFieldsDropped });

    expect(calls[0]!.data).not.toHaveProperty('note');
    expect(calls[0]!.data).not.toHaveProperty('doubled');
    expect(l.events).toEqual([
      COMPUTED_DOUBLED,
      { object: 'proj', fields: ['note'], reason: 'readonly' },
    ]);
  });

  it('the beforeInsert hook is handed the payload that will be stored — no formula key', async () => {
    const { engine } = await makeEngine();
    const seen: string[][] = [];
    engine.registerHook('beforeInsert', async (ctx: any) => { seen.push(Object.keys(ctx.input.data)); }, { object: 'proj' });
    await engine.insert('proj', { n: 1, doubled: 5 });

    expect(seen).toHaveLength(1);
    expect(seen[0]).not.toContain('doubled');
  });
});

describe('[#20805] update — by id and multi, the same strip and the same report', () => {
  it('by id: the SET payload carries no formula key, one computed event', async () => {
    const { engine, calls } = await makeEngine();
    const l = listener();
    await engine.update('proj', { id: 'rec_1', n: 4, doubled: 99 }, { onFieldsDropped: l.onFieldsDropped });

    const upd = calls.filter((c) => c.fn === 'update');
    expect(upd).toHaveLength(1);
    expect(upd[0]!.data).not.toHaveProperty('doubled');
    expect(upd[0]!.data).toMatchObject({ n: 4 });
    expect(l.events).toEqual([COMPUTED_DOUBLED]);
  });

  it('multi: the updateMany payload carries no formula key, one computed event', async () => {
    const { engine, calls } = await makeEngine();
    const l = listener();
    await engine.update('proj', { title: 'x', doubled: 99 }, { where: { n: 1 }, multi: true, onFieldsDropped: l.onFieldsDropped } as any);

    const many = calls.filter((c) => c.fn === 'updateMany');
    expect(many).toHaveLength(1);
    expect(many[0]!.data).not.toHaveProperty('doubled');
    expect(many[0]!.data).toMatchObject({ title: 'x' });
    expect(l.events).toEqual([COMPUTED_DOUBLED]);
  });

  it('isSystem: stripped and reported on update too', async () => {
    const { engine, calls } = await makeEngine();
    const l = listener();
    await engine.update('proj', { id: 'rec_1', doubled: 99, title: 'y' }, { context: { isSystem: true }, onFieldsDropped: l.onFieldsDropped } as any);

    expect(calls.find((c) => c.fn === 'update')!.data).not.toHaveProperty('doubled');
    expect(l.events).toEqual([COMPUTED_DOUBLED]);
  });

  it('control: a static readonly key on update is still reported under `readonly`', async () => {
    const { engine, calls } = await makeEngine();
    const l = listener();
    await engine.update('proj', { id: 'rec_1', note: 'forged', doubled: 99 }, { onFieldsDropped: l.onFieldsDropped });

    const data = calls.find((c) => c.fn === 'update')!.data;
    expect(data).not.toHaveProperty('note');
    expect(data).not.toHaveProperty('doubled');
    expect(l.events).toContainEqual(COMPUTED_DOUBLED);
    expect(l.events).toContainEqual({ object: 'proj', fields: ['note'], reason: 'readonly' });
  });

  it('the beforeUpdate hook is handed no formula key; `ctx.submitted` keeps the submission as sent', async () => {
    const { engine } = await makeEngine();
    const seen: Array<{ data: string[]; submitted: string[] }> = [];
    engine.registerHook('beforeUpdate', async (ctx: any) => {
      seen.push({ data: Object.keys(ctx.input.data), submitted: Object.keys(ctx.submitted ?? {}) });
    }, { object: 'proj' });
    await engine.update('proj', { id: 'rec_1', n: 4, doubled: 99 });

    expect(seen).toHaveLength(1);
    expect(seen[0]!.data).not.toContain('doubled');
    expect(seen[0]!.submitted).toContain('doubled');
  });
});

describe('[#20805] strictReadonlyWrites — the derived coverage refuses a computed drop, nothing is written', () => {
  it('insert: ERR_READONLY_FIELD_REJECTED carrying the computed drop, no driver write', async () => {
    const { engine, calls } = await makeEngine();
    const err = await rejection(engine.insert('proj', { n: 1, doubled: 5 }, { strictReadonlyWrites: true }));

    expect(err.code).toBe('ERR_READONLY_FIELD_REJECTED');
    expect(err.drops).toEqual([COMPUTED_DOUBLED]);
    expect(calls.filter((c) => c.fn === 'create')).toHaveLength(0);
  });

  it('update: the same, under isSystem too', async () => {
    const { engine, calls } = await makeEngine();
    const err = await rejection(
      engine.update('proj', { id: 'rec_1', doubled: 99 }, { strictReadonlyWrites: true, context: { isSystem: true } } as any),
    );

    expect(err.code).toBe('ERR_READONLY_FIELD_REJECTED');
    expect(err.drops).toEqual([COMPUTED_DOUBLED]);
    expect(calls.filter((c) => c.fn === 'update')).toHaveLength(0);
  });
});

describe('[#20805] engine.validate runs the write\'s own doors', () => {
  it('a formula key is stripped and reported as computed, and the row previews valid — insert mode', async () => {
    const { engine, calls } = await makeEngine();
    const l = listener();
    const res = await engine.validate('proj', { n: 1, doubled: 5 }, { onFieldsDropped: l.onFieldsDropped });

    expect(res.valid).toBe(true);
    expect(l.events).toEqual([COMPUTED_DOUBLED]);
    expect(calls).toHaveLength(0);
  });

  it('the same in update mode and under isSystem', async () => {
    const { engine } = await makeEngine();
    const upd = listener();
    await engine.validate('proj', { n: 1, doubled: 5 }, { mode: 'update', onFieldsDropped: upd.onFieldsDropped });
    expect(upd.events).toEqual([COMPUTED_DOUBLED]);

    const sys = listener();
    await engine.validate('proj', { n: 1, doubled: 5 }, { context: { isSystem: true } as any, onFieldsDropped: sys.onFieldsDropped });
    expect(sys.events).toEqual([COMPUTED_DOUBLED]);
  });

  it('an unknown key is refused 400 INVALID_FIELD naming the field — on validate and on insert alike', async () => {
    const { engine, calls } = await makeEngine();
    const onValidate = await rejection(engine.validate('proj', { n: 1, nope: 5 }));
    const onInsert = await rejection(engine.insert('proj', { n: 1, nope: 5 }));

    for (const err of [onValidate, onInsert]) {
      expect(err.code).toBe('INVALID_FIELD');
      expect(err.status).toBe(400);
      expect(err.field).toBe('nope');
    }
    expect(onValidate.fields).toEqual(onInsert.fields);
    expect(calls).toHaveLength(0);
    // update mode takes the same door.
    const onUpdateMode = await rejection(engine.validate('proj', { nope: 5 }, { mode: 'update' }));
    expect(onUpdateMode).toMatchObject({ code: 'INVALID_FIELD', status: 400, field: 'nope' });
  });

  it('the caller-write strips report through the same listener, under the write\'s isSystem gate', async () => {
    const { engine } = await makeEngine();
    const user = listener();
    await engine.validate('proj', { n: 1, note: 'forged', doubled: 5 }, { onFieldsDropped: user.onFieldsDropped });
    expect(user.events).toEqual([
      COMPUTED_DOUBLED,
      { object: 'proj', fields: ['note'], reason: 'readonly' },
    ]);

    const sys = listener();
    await engine.validate('proj', { n: 1, note: 'seeded' }, { context: { isSystem: true } as any, onFieldsDropped: sys.onFieldsDropped });
    expect(sys.events).toEqual([]);

    // update mode: a supplied `id` is the address the write binds, never a
    // payload key — witnessed on an object whose `id` IS declared readonly
    // (as platform objects' are), where the strip would otherwise take it.
    engine.registry.registerObject({
      name: 'acct',
      fields: {
        id: { type: 'text', readonly: true },
        note: { type: 'text', readonly: true },
        label: { type: 'text' },
      },
    } as any);
    const upd = listener();
    await engine.validate('acct', { id: 'a_1', note: 'forged', label: 'x' }, { mode: 'update', onFieldsDropped: upd.onFieldsDropped });
    expect(upd.events).toEqual([{ object: 'acct', fields: ['note'], reason: 'readonly' }]);
  });

  it('control: a payload with nothing to strip reports nothing and previews valid', async () => {
    const { engine } = await makeEngine();
    const l = listener();
    const res = await engine.validate('proj', { n: 1, title: 'ok' }, { onFieldsDropped: l.onFieldsDropped });
    expect(res.valid).toBe(true);
    expect(l.events).toEqual([]);
  });
});
