// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// objectstack#8093 — a single-record update must not report the row's OWN
// primary key as a field the caller supplied and the engine refused.
//
// ## What was wrong
//
// `droppedFields` / `onFieldsDropped` has one declared meaning: fields the
// CALLER SUPPLIED and the engine REFUSED. On the by-id branch an `id` that
// names the row being written was refused nothing — it is the ADDRESS of the
// write, not part of its payload — and it was being reported as a `readonly`
// drop on every object whose `id` carries `readonly: true` (every platform
// object).
//
// The reported route in: the REST ingress folds the path id into the write
// payload (`metadata-protocol`'s `updateData`, #6479, so a body `id` cannot
// bind a row other than the one the URL / OCC / receipt all name). That fold
// lands in `data` before the engine's `suppliedValues` snapshot, so the address
// became indistinguishable from something the caller typed. Measured on `main`
// through the real ingress, with a body containing no `id` key at all:
//
//     PATCH /data/sys_user_preference/4mekbFDEhx0QgC85   body: {"value":[…]}
//     → 200  droppedFields:[{object:…,fields:["id"],reason:"readonly"}]
//
// The console's recents trace runs on every org switch, so that answer popped a
// user-facing amber warning toast on every org switch, about a field the user
// never touched. The cost is not the toast — it is that the warning channel is
// trained to be ignored, so the drop that DOES matter is ignored with it. Same
// failure mode as #3431 / #3794 one field over (`updated_at`).
//
// ## Predicted table, written BEFORE the first run
//
// | case                                                   | event                         | driver SET clause     |
// |--------------------------------------------------------|-------------------------------|-----------------------|
// | by-id, readonly `id` = the addressed row                | NONE                          | no `id` (unchanged)   |
// | canonical `update(obj,{id,…})` spelling, readonly `id`  | NONE                          | no `id` (unchanged)   |
// | by-id, a readonly field the caller really supplied      | {fields:['locked_note'],readonly} | that field absent |
// | both at once                                            | {fields:['locked_note']} ONLY | neither in SET        |
// | by-id, ruled-non-id `data.id` (#6262/#6435 strip)       | {fields:['id'],primary_key}   | no `id`               |
// | MULTI, ruled-non-id `data.id`                           | {fields:['id'],primary_key}   | no `id`               |
// | object whose `id` is NOT readonly                       | NONE (as before)              | `id` PRESENT          |
// | strict + addressing id only                             | no refusal                    | write happens         |
// | strict + a really-supplied readonly field               | REFUSED, unchanged            | no driver call        |
//
// The last three rows are the ones that make this file able to fail. The fix
// NARROWS what is reported, so without a case that still demands a report — and
// one that pins the strip's own behaviour as untouched — "stop reporting
// dropped fields" and "stop reporting the address" look identical.
//
// ## Reverse verification — prediction, then what actually happened
//
// PREDICTED, before the run: delete the `!(idAddressesThisRow && k === 'id')`
// term from `reportDroppedFields` in `engine.ts` and the four "NONE / ONLY"
// rows above gain an `id` entry and go red, while every `primary_key` row, the
// not-readonly row and BOTH STRICT ROWS stay green.
//
// MEASURED: 6 failed / 4 passed — the prediction was WRONG about the two strict
// rows, and the way it was wrong is worth keeping. Both went red too:
//
//   * "does NOT refuse a write whose only drop was the address" — reverting the
//     report ALSO restores a refusal, so under `strictReadonlyWrites` the write
//     throws instead of committing;
//   * "still refuses a really-supplied read-only field" — the refusal survives,
//     but its `drops` breakdown comes back as `['locked_note','id']`.
//
// That is the #6437 derived-coverage contract doing exactly what it says:
// `strictReadonlyWrites` covers "every drop `onFieldsDropped` reports", so the
// quiet and loud halves cannot move apart — un-reporting the address un-refuses
// it in the same edit. Predicting them independent was the error. The 4 rows
// that DID stay green are the ones the fix claims not to touch: both
// `primary_key` strips, the predicate/multi report, and the object whose `id`
// is not readonly.

import { describe, it, expect } from 'vitest';
import { ObjectQL } from './engine.js';
import type { DroppedFieldsEvent } from '@objectstack/spec/data';

const silentLogger: any = (() => {
  const l: any = {
    debug() {}, info() {}, error() {}, trace() {}, fatal() {}, warn() {},
    child() { return l; },
  };
  return l;
})();

interface DriverWrite {
  readonly fn: 'update' | 'updateMany';
  readonly id?: unknown;
  /** A COPY — the engine keeps mutating its own payload after the call. */
  readonly data: Record<string, unknown>;
}

function makeRecordingDriver() {
  const writes: DriverWrite[] = [];
  const row = { id: 'rec_1', value: 'v0', locked_note: 'n0', title: 't0' };
  const driver: any = {
    name: 'recording', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find() { return [{ ...row }]; },
    async findOne() { return { ...row }; },
    async create(_o: string, data: Record<string, unknown>) { return { id: 'rec_1', ...data }; },
    async update(_o: string, id: string, data: Record<string, unknown>) {
      writes.push({ fn: 'update', id, data: { ...data } });
      return { ...row, ...data, id };
    },
    async updateMany(_o: string, _ast: unknown, data: Record<string, unknown>) {
      writes.push({ fn: 'updateMany', data: { ...data } });
      return 2;
    },
    async delete() { return true; },
    async deleteMany() { return 0; },
    async count() { return 1; },
    async bulkCreate() { return []; }, async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() { return { __trx: true, commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, writes };
}

/**
 * `readonlyId: true` mirrors every platform object — `sys_user_preference`'s
 * `id` is `Field.text({ label: 'Preference ID', required: true, readonly: true })`,
 * and "Preference ID" is the label the amber toast rendered.
 */
async function makeEngine(readonlyId: boolean) {
  const engine = new ObjectQL({ logger: silentLogger });
  const { driver, writes } = makeRecordingDriver();
  engine.registerDriver(driver, true);
  await engine.init();
  engine.registry.registerObject({
    name: 'pref',
    fields: {
      id: { name: 'id', label: 'Preference ID', type: 'text', primaryKey: true, ...(readonlyId ? { readonly: true } : {}) },
      value: { name: 'value', type: 'text' },
      locked_note: { name: 'locked_note', type: 'text', readonly: true },
      title: { name: 'title', type: 'text' },
    },
  } as any, 'test');
  return { engine, writes };
}

/** Run a write with a listener attached; return the events and driver writes. */
async function observe(
  data: unknown,
  options: Record<string, unknown> = {},
  opts: { readonlyId?: boolean } = {},
) {
  const { engine, writes } = await makeEngine(opts.readonlyId !== false);
  const events: DroppedFieldsEvent[] = [];
  await engine.update('pref', data as any, {
    ...options,
    onFieldsDropped: (e: DroppedFieldsEvent) => events.push(e),
  } as any);
  return { events, writes };
}

describe('#8093 — the addressed row\'s primary key is not a dropped field', () => {
  it('the REST ingress shape reports NOTHING: {…, id} + where.id, `id` readonly', async () => {
    // Byte-for-byte what `metadata-protocol`'s `updateData` builds for
    // `PATCH /data/pref/rec_1` with the body `{ value: 'v1' }`:
    // `{ ...request.data, id: request.id }` plus `where: { id: request.id }`.
    const { events, writes } = await observe(
      { value: 'v1', id: 'rec_1' },
      { where: { id: 'rec_1' } },
    );
    expect(events).toEqual([]);
    // The strip is UNCHANGED — this fix narrows the report, never the write.
    // `id` still never reaches the SET clause (a same-value primary-key write
    // is a no-op on SQL but a rejection on stores with immutable keys).
    expect(writes.map((w) => w.fn)).toEqual(['update']);
    expect(writes[0].data).toEqual({ value: 'v1' });
    expect(writes[0].id).toBe('rec_1');
  });

  it('the canonical ObjectQL by-id spelling `update(obj, { id, ...fields })` reports nothing either', async () => {
    // The engine's own documented by-id call (quoted in the #6435 remedy
    // prose). Its `id` is the address by definition, whatever `where` says.
    const { events, writes } = await observe({ id: 'rec_1', value: 'v1' });
    expect(events).toEqual([]);
    expect(writes[0].data).toEqual({ value: 'v1' });
  });

  it('a read-only field the caller REALLY supplied is still reported, unchanged', async () => {
    // The counter-direction. Without this the fix is indistinguishable from
    // "stop reporting dropped fields".
    const { events, writes } = await observe(
      { value: 'v1', locked_note: 'forged', id: 'rec_1' },
      { where: { id: 'rec_1' } },
    );
    expect(events).toEqual([{ object: 'pref', fields: ['locked_note'], reason: 'readonly' }]);
    expect(writes[0].data).toEqual({ value: 'v1' });
  });

  it('a real refusal does not drag the address into its field list', async () => {
    const { events } = await observe(
      { locked_note: 'forged', id: 'rec_1' },
      { where: { id: 'rec_1' } },
    );
    expect(events.flatMap((e) => e.fields)).not.toContain('id');
    expect(events.flatMap((e) => e.fields)).toEqual(['locked_note']);
  });

  it('an object whose `id` is NOT readonly is unaffected in both channels', async () => {
    // Nothing was ever stripped or reported here; the fix must not invent a
    // strip. The `id` still rides into the SET clause exactly as before —
    // widening the strip to that case is #6435's explicitly separate decision.
    const { events, writes } = await observe(
      { value: 'v1', id: 'rec_1' },
      { where: { id: 'rec_1' } },
      { readonlyId: false },
    );
    expect(events).toEqual([]);
    expect(writes[0].data).toEqual({ value: 'v1', id: 'rec_1' });
  });

  it('the #6437 `primary_key` strip is untouched on the by-id branch', async () => {
    // A ruled-non-id `data.id` is NOT an address — the dispatch said so — and
    // the exclusion cannot reach it: it is keyed on equality with the bound
    // key, which a ruled-non-id value never has.
    const { events, writes } = await observe(
      { id: { $in: ['a', 'b'] }, value: 'v1' },
      { where: { id: 'rec_1' } },
    );
    expect(events).toEqual([{ object: 'pref', fields: ['id'], reason: 'primary_key' }]);
    expect(writes[0].data).toEqual({ value: 'v1' });
  });

  it('the #6437 `primary_key` strip is untouched on the MULTI branch', async () => {
    const { events, writes } = await observe(
      { id: { $in: ['a', 'b'] }, value: 'v1' },
      { multi: true },
    );
    expect(events).toEqual([{ object: 'pref', fields: ['id'], reason: 'primary_key' }]);
    expect(writes.map((w) => w.fn)).toEqual(['updateMany']);
  });

  it('a predicate write still reports a really-supplied read-only field', async () => {
    // The multi branch addresses rows by predicate, so nothing there is an
    // address-in-the-payload; its accounting must not have moved.
    const { events } = await observe(
      { locked_note: 'forged', value: 'v1' },
      { multi: true, where: { title: 't0' } },
    );
    expect(events).toEqual([{ object: 'pref', fields: ['locked_note'], reason: 'readonly' }]);
  });
});

describe('#8093 — strictReadonlyWrites stays consistent with what is reported', () => {
  it('does NOT refuse a write whose only "drop" was the address', async () => {
    // `strictReadonlyWrites` is contracted as covering "every drop
    // `onFieldsDropped` reports" — a set DERIVED from the reported set (#6437).
    // So a non-drop must not be a refusal either, or the loud half would refuse
    // every single-record PATCH of a platform object.
    const { engine, writes } = await makeEngine(true);
    const res = await engine.update(
      'pref',
      { value: 'v1', id: 'rec_1' } as any,
      { where: { id: 'rec_1' }, strictReadonlyWrites: true } as any,
    );
    expect(res).toBeTruthy();
    expect(writes.map((w) => w.fn)).toEqual(['update']);
    expect(writes[0].data).toEqual({ value: 'v1' });
  });

  it('still refuses a really-supplied read-only field, before any driver call', async () => {
    const { engine, writes } = await makeEngine(true);
    let err: any;
    try {
      await engine.update(
        'pref',
        { value: 'v1', locked_note: 'forged', id: 'rec_1' } as any,
        { where: { id: 'rec_1' }, strictReadonlyWrites: true } as any,
      );
    } catch (e) { err = e; }
    expect(err).toBeDefined();
    // Asserted on the ENVELOPE, not on the throw. The pair this class actually
    // contracts is `code` + `drops`, not `code` + `status`: `strictReadonlyWrites`
    // lives on `WriteObservabilityOptions`, which is not the serializable options
    // bag, so no wire caller can reach this refusal and it carries no HTTP status
    // to assert (`contracts/data-engine.ts`, "In-process only — what a REMOTE
    // caller observes"). `drops` is the documented breakdown a caller reads after
    // catching the one stable code (#6437).
    expect(err.code).toBe('ERR_READONLY_FIELD_REJECTED');
    expect(err.drops).toEqual([{ object: 'pref', fields: ['locked_note'], reason: 'readonly' }]);
    // The refusal names the field the caller really sent — and not the address.
    expect(String(err.message)).toContain('locked_note');
    expect(String(err.message)).not.toContain("'id'");
    expect(writes).toHaveLength(0);
  });
});
