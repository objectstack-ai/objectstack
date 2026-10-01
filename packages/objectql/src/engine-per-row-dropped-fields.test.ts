// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #20922 — the per-row drop report. The dry run (`validate` → a row's
// `droppedFields`) and the commit (`insertMany` → an `ok` outcome's
// `droppedFields`) name what the strips took from EACH row, recorded at the
// strips themselves; the batch-level `onFieldsDropped` union beside them is
// unchanged and still names no row.
//
// ## What was wrong (measured on `main` 9b0de7de7)
//
// `engine.validate` and `engine.insert` built the strips' result across ALL
// rows and emitted ONE event per reason, so neither the dry run nor the commit
// could say which row lost which field. `ValidateDataResponseSchema.results[]`
// and `ImportRowResultSchema` declare a per-row `droppedFields`, and nothing
// set it: a formula value or a forged `readonly` column was answered
// `valid: true` / `ok: true` on its row with nothing to say it would not land.
//
// ## What this file pins, on a recording driver
//
// A formula column (`doubled`, reason `computed`) and a static `readonly`
// column (`note`, reason `readonly`): dry run and commit answer the same
// per-row drops with the right reason; a clean row carries none (the control);
// the listener's union is the one it always was. Through the protocol too
// (`validateData`, `insertManyData`), which relay what the engine answers.

import { describe, it, expect } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { ObjectQL, type InsertManyRowOutcome } from './engine.js';
import type { DroppedFieldsEvent } from '@objectstack/spec/data';

const silentLogger: any = (() => {
  const l: any = {
    trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {},
    child() { return l; },
  };
  return l;
})();

/** Records what reaches the driver — the payload is the verdict. */
function makeRecordingDriver() {
  const created: Array<Record<string, unknown>> = [];
  let seq = 0;
  const driver: any = {
    name: 'recording', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find() { return []; },
    async findOne() { return null; },
    async create(_o: string, data: Record<string, unknown>) {
      created.push({ ...data });
      return { id: (data.id as string | undefined) ?? `gen_${++seq}`, ...data };
    },
    async update(_o: string, id: string, data: Record<string, unknown>) { return { id, ...data }; },
    async updateMany() { return 0; },
    async delete() { return true; },
    async deleteMany() { return 0; },
    async count() { return 0; },
    async bulkCreate(o: string, list: Record<string, unknown>[]) {
      const out = [];
      for (const r of list) out.push(await driver.create(o, r));
      return out;
    },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, created };
}

/**
 * `doubled` is the formula under test; `note` is a static `readonly` column;
 * `code` carries a `maxLength`, so a row can be made INVALID without touching
 * either strip; `n` / `title` are the writable controls.
 */
async function makeRig() {
  const engine = new ObjectQL({ logger: silentLogger });
  const { driver, created } = makeRecordingDriver();
  engine.registerDriver(driver, true);
  await engine.init();
  engine.registry.registerObject({
    name: 'proj',
    fields: {
      n: { type: 'number' },
      title: { type: 'text' },
      code: { type: 'text', maxLength: 3 },
      doubled: { type: 'formula', expression: 'record.n * 2' },
      note: { type: 'text', readonly: true },
    },
  } as any);
  const protocol = new ObjectStackProtocolImplementation(engine as any);
  return { engine, protocol, created };
}

function listener() {
  const events: DroppedFieldsEvent[] = [];
  return { events, onFieldsDropped: (e: DroppedFieldsEvent) => { events.push(e); } };
}

const COMPUTED = (...fields: string[]): DroppedFieldsEvent => ({ object: 'proj', fields, reason: 'computed' });
const READONLY = (...fields: string[]): DroppedFieldsEvent => ({ object: 'proj', fields, reason: 'readonly' });

/**
 * Four rows, one per cell: a formula value, a forged `readonly` value, a clean
 * row (the control), and both at once.
 */
const ROWS: Array<Record<string, unknown>> = [
  { n: 1, doubled: 5 },
  { n: 2, note: 'forged' },
  { n: 3, title: 'clean' },
  { n: 4, doubled: 9, note: 'forged' },
];
/** What each row of {@link ROWS} loses, in the strips' order. */
const PER_ROW: Array<DroppedFieldsEvent[] | undefined> = [
  [COMPUTED('doubled')],
  [READONLY('note')],
  undefined,
  [COMPUTED('doubled'), READONLY('note')],
];
/** The batch-level union over {@link ROWS}: one event per reason, naming no row. */
const UNION: DroppedFieldsEvent[] = [COMPUTED('doubled'), READONLY('note')];

function okOutcome(o: InsertManyRowOutcome): Extract<InsertManyRowOutcome, { ok: true }> {
  if (!o.ok) throw new Error(`expected an ok outcome, got ${JSON.stringify(o)}`);
  return o;
}

describe('[#20922] the dry run answers per-row drops — engine.validate', () => {
  it('each row names what the write would take from IT, with the right reason; the clean row carries none', async () => {
    const { engine, created } = await makeRig();
    const res = await engine.validate('proj', ROWS);

    expect(res.valid).toBe(true);
    expect(res.results).toHaveLength(ROWS.length);
    res.results.forEach((r, i) => {
      expect(r.valid).toBe(true);
      if (PER_ROW[i] === undefined) expect(r, `row ${i} took nothing`).not.toHaveProperty('droppedFields');
      else expect(r.droppedFields, `row ${i}`).toEqual(PER_ROW[i]);
      // A strip is not a finding.
      expect(r.errors).toEqual([]);
    });
    expect(created).toHaveLength(0);
  });

  it('the listener still reports the batch-level union, one event per reason, naming no row', async () => {
    const { engine } = await makeRig();
    const l = listener();
    await engine.validate('proj', ROWS, { onFieldsDropped: l.onFieldsDropped });
    expect(l.events).toEqual(UNION);
  });

  it('a row the verdict refuses carries no drops — the write would not complete it', async () => {
    const { engine } = await makeRig();
    const res = await engine.validate('proj', [{ n: 1, code: 'too-long', doubled: 5 }, { n: 2, doubled: 5 }]);

    expect(res.results[0]!.valid).toBe(false);
    expect(res.results[0]).not.toHaveProperty('droppedFields');
    expect(res.results[1]!.droppedFields).toEqual([COMPUTED('doubled')]);
  });

  it('isSystem: the readonly strip stands down per row as it does on the write, the computed strip does not', async () => {
    const { engine } = await makeRig();
    const res = await engine.validate('proj', ROWS, { context: { isSystem: true } as any });
    expect(res.results.map((r) => r.droppedFields)).toEqual([
      [COMPUTED('doubled')], undefined, undefined, [COMPUTED('doubled')],
    ]);
  });

  it('update mode: the same per-row report from the update-side strips', async () => {
    const { engine } = await makeRig();
    const res = await engine.validate('proj', ROWS, { mode: 'update' });
    expect(res.results.map((r) => r.droppedFields)).toEqual(PER_ROW);
  });
});

describe('[#20922] the commit answers per-row drops — engine.insertMany', () => {
  it('each ok outcome names what was taken from THAT row; the clean row carries none', async () => {
    const { engine, created } = await makeRig();
    const outcomes = await engine.insertMany('proj', ROWS);

    expect(outcomes).toHaveLength(ROWS.length);
    outcomes.forEach((o, i) => {
      const ok = okOutcome(o);
      if (PER_ROW[i] === undefined) expect(ok, `row ${i} took nothing`).not.toHaveProperty('droppedFields');
      else expect(ok.droppedFields, `row ${i}`).toEqual(PER_ROW[i]);
    });
    // The report describes the stored payload: neither key reached the driver.
    expect(created).toHaveLength(ROWS.length);
    for (const row of created) {
      expect(row).not.toHaveProperty('doubled');
      expect(row).not.toHaveProperty('note');
    }
  });

  it('the dry run and the commit answer the same drops, row for row', async () => {
    const { engine } = await makeRig();
    const dry = await engine.validate('proj', ROWS);
    const commit = await engine.insertMany('proj', ROWS);
    expect(commit.map((o) => okOutcome(o).droppedFields)).toEqual(dry.results.map((r) => r.droppedFields));
  });

  it('the listener still reports the batch-level union, one event per reason, naming no row', async () => {
    const { engine } = await makeRig();
    const l = listener();
    await engine.insertMany('proj', ROWS, { onFieldsDropped: l.onFieldsDropped });
    expect(l.events).toEqual(UNION);
  });

  it('a failed outcome carries no drops — its write did not complete', async () => {
    const { engine } = await makeRig();
    const outcomes = await engine.insertMany('proj', [{ n: 1, code: 'too-long', note: 'forged' }, { n: 2, note: 'forged' }]);

    expect(outcomes[0]!.ok).toBe(false);
    expect(outcomes[0]).not.toHaveProperty('droppedFields');
    expect(okOutcome(outcomes[1]!).droppedFields).toEqual([READONLY('note')]);
  });

  it('a hook that writes the readonly key on ONE row keeps it there: only the other row is named', async () => {
    // The case a reconstruction from the union cannot get right: both rows
    // SUPPLIED `note`, so "which rows supplied it" names both. Row 1's
    // `beforeInsert` hook assigns it, which exempts it on that row alone.
    const { engine, created } = await makeRig();
    engine.registerHook('beforeInsert', async (ctx: any) => {
      if (ctx.input.data.n === 2) ctx.input.data.note = 'hook-stamped';
    }, { object: 'proj' });
    const l = listener();
    const outcomes = await engine.insertMany(
      'proj',
      [{ n: 1, note: 'forged' }, { n: 2, note: 'forged' }],
      { onFieldsDropped: l.onFieldsDropped },
    );

    expect(okOutcome(outcomes[0]!).droppedFields).toEqual([READONLY('note')]);
    expect(okOutcome(outcomes[1]!), 'the hook wrote it, so it was not dropped').not.toHaveProperty('droppedFields');
    expect(created[1]).toMatchObject({ note: 'hook-stamped' });
    expect(l.events).toEqual([READONLY('note')]);
  });

  it('the non-partial batch insert is unchanged: it returns the records, with no per-row slot', async () => {
    const { engine } = await makeRig();
    const records = await engine.insert('proj', ROWS);
    expect(Array.isArray(records)).toBe(true);
    for (const r of records as Array<Record<string, unknown>>) expect(r).not.toHaveProperty('droppedFields');
  });
});

describe('[#20922] through the protocol — validateData and insertManyData relay the engine\'s per-row report', () => {
  it('validateData answers each row\'s drops in results[].droppedFields', async () => {
    const { protocol } = await makeRig();
    const res: any = await protocol.validateData({ object: 'proj', data: ROWS });
    expect(res.results.map((r: any) => r.droppedFields)).toEqual(PER_ROW);
  });

  it('insertManyData passes the per-outcome report through and keeps the batch-level union', async () => {
    const { protocol } = await makeRig();
    const res = await protocol.insertManyData({ object: 'proj', records: ROWS });
    expect(res.outcomes.map((o) => o.droppedFields)).toEqual(PER_ROW);
    expect(res.droppedFields).toEqual(UNION);
  });

  it('control: nothing taken anywhere ⇒ no per-row key and no batch-level key', async () => {
    const { protocol } = await makeRig();
    const dry: any = await protocol.validateData({ object: 'proj', data: [{ n: 1 }, { n: 2, title: 'x' }] });
    for (const r of dry.results) expect(r).not.toHaveProperty('droppedFields');
    const commit = await protocol.insertManyData({ object: 'proj', records: [{ n: 1 }, { n: 2, title: 'x' }] });
    for (const o of commit.outcomes) expect(o).not.toHaveProperty('droppedFields');
    expect(commit).not.toHaveProperty('droppedFields');
  });
});
