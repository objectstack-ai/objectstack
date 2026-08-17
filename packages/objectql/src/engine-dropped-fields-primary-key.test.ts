// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// objectstack#6437 — `DroppedFieldsEvent.reason` gains `primary_key`, so the
// write path's primary-key strip becomes visible to BOTH halves of the #3407 /
// #5126 seam instead of only to the server log.
//
// ## What was wrong
//
// #6262 / PR #6433 (multi branch) and #6435 (by-id branch) each added a legal
// strip: a `data.id` the update dispatch has ALREADY RULED is not a primary key
// is removed from the SET payload, because writing it would overwrite the
// identity of the very rows the call targets. Both were caller-supplied fields
// legally dropped from a write — the exact thing `onFieldsDropped` exists to
// report — but `reason` was a closed enum over the two READ-ONLY strips, so
// both blocks emitted a `warn` and deliberately reported nothing. Neither PR
// was willing to force-fit `readonly`: `id` is not read-only (a truthy scalar
// `id` writes fine), and a `reason` that lies is worse than silence.
//
// The consequence this file pins away: a caller subscribed to
// `onFieldsDropped` saw nothing, and a caller that had opted into
// `strictReadonlyWrites` — whose whole promise is "refuse rather than commit a
// payload I did not write" — still got a success whose `id` had been dropped.
//
// ## Predicted table, written BEFORE the first run
//
// | case                                  | default mode                          | strictReadonlyWrites: true                |
// |---------------------------------------|---------------------------------------|-------------------------------------------|
// | multi update, ruled-non-id `data.id`  | event {fields:['id'],'primary_key'},  | REFUSED, ERR_READONLY_FIELD_REJECTED,     |
// |                                       | write SUCCEEDS                        | drops[].reason='primary_key', no driver   |
// | by-id update, ruled-non-id `data.id`  | same event, write SUCCEEDS            | REFUSED, same                             |
// | readonly / readonly_when strip        | UNCHANGED `readonly`/`readonly_when`  | REFUSED, byte-identical #5126 message     |
// | truthy scalar `data.id` (not stripped)| NO event                              | no throw                                  |
// | write carrying no `id` at all         | NO event                              | no throw                                  |
//
// The strict column is the deliberate part. `strictReadonlyWrites` covers
// "every drop `onFieldsDropped` reports" by its own contract sentence
// (`spec/src/contracts/data-engine.ts`), and that coverage is DERIVED from the
// reported set rather than enumerated — measured on `main` in
// `reportDroppedFields`, whose `strictDrops.push` has no reason-class filter.
// So reporting a new reason NECESSARILY adds a new refusal. That is stated in
// the option's doc and pinned here, in both directions, rather than left for a
// caller to discover.
//
// ## Reverse verification, direction predicted first
//
// Delete the two `reportDroppedFields(..., 'primary_key')` call sites in
// `engine.ts` and:
//   - every `primary_key` case below goes RED (no event / the write resolves);
//   - every `readonly` / `readonly_when` case stays GREEN — the read-only seam
//     is untouched, which is the claim the changeset makes;
//   - the byte-identity pin stays GREEN.
// Revert `readonly-strict-errors.ts` instead and only the wording pins move:
// the `primary_key` message assertions go RED while the byte-identity pin
// stays GREEN. Measured results are recorded in the PR body.

import { describe, it, expect } from 'vitest';
import { ObjectQL } from './engine.js';
import type { DroppedFieldsEvent } from '@objectstack/spec/data';

interface RecordedCall {
  readonly fn: 'update' | 'updateMany';
  readonly id?: unknown;
  /** A COPY — the engine may keep mutating its own payload after the call. */
  readonly data: Record<string, unknown>;
}

const silentLogger: any = (() => {
  const l: any = {
    debug() {}, info() {}, error() {}, trace() {}, fatal() {}, warn() {},
    child() { return l; },
  };
  return l;
})();

function makeRecordingDriver() {
  const calls: RecordedCall[] = [];
  const rows = new Map<string, Record<string, unknown>>();
  const driver: any = {
    name: 'recording', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find() { return [...rows.values()]; },
    async findOne() { return rows.values().next().value ?? null; },
    async create(_o: string, data: Record<string, unknown>) { return { id: 'r1', ...data }; },
    async update(_o: string, id: string, data: Record<string, unknown>) {
      calls.push({ fn: 'update', id, data: { ...data } });
      return { id, ...data };
    },
    async updateMany(_o: string, _ast: unknown, data: Record<string, unknown>) {
      calls.push({ fn: 'updateMany', data: { ...data } });
      return 2;
    },
    async delete() { return true; },
    async deleteMany() { return 0; },
    async count() { return 0; },
    async bulkCreate() { return []; }, async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() { return { __trx: true, commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  rows.set('rec_1', { id: 'rec_1', title: 't0', status: 'open', settled_total: null });
  return { driver, calls, rows };
}

async function makeEngine() {
  const engine = new ObjectQL({ logger: silentLogger });
  const { driver, calls } = makeRecordingDriver();
  engine.registerDriver(driver, true);
  await engine.init();
  engine.registry.registerObject({
    name: 'task',
    fields: {
      title: { type: 'text' },
      status: { type: 'text' },
      settled_total: { type: 'number', readonly: true },
      closed_at: { type: 'datetime', readonlyWhen: "record.status == 'open'" },
    },
  } as any);
  return { engine, calls };
}

/** Run a write with a listener attached; return the events and driver calls. */
async function observe(data: unknown, options: Record<string, unknown> = {}) {
  const { engine, calls } = await makeEngine();
  const events: DroppedFieldsEvent[] = [];
  await engine.update('task', data as any, {
    ...options,
    onFieldsDropped: (e: DroppedFieldsEvent) => events.push(e),
  } as any);
  return { events, calls };
}

/** Catch and return the rejection, so a case can assert on its shape. */
async function rejection(p: Promise<unknown>): Promise<any> {
  try {
    await p;
  } catch (err) {
    return err;
  }
  throw new Error('expected the write to be refused, but it resolved');
}

/** Run a write under strict; return the error and whether the driver was hit. */
async function refuse(data: unknown, options: Record<string, unknown> = {}) {
  const { engine, calls } = await makeEngine();
  const err = await rejection(engine.update('task', data as any, {
    ...options,
    strictReadonlyWrites: true,
  } as any));
  return { err, calls };
}

// ── 1. the quiet half: onFieldsDropped now sees the primary-key strip ──────

describe('#6437 — the primary-key strip is reported as reason `primary_key`', () => {
  it('MULTI branch: an operator-object data.id is reported, and the write still succeeds', async () => {
    const { events, calls } = await observe(
      { id: { $in: ['a', 'b'] }, title: 'x' },
      { multi: true },
    );
    // The signal #6433 could not emit.
    expect(events).toEqual([{ object: 'task', fields: ['id'], reason: 'primary_key' }]);
    // ...and the strip's own behaviour is unchanged: still a bulk write, still
    // no `id` in the SET clause, still carrying the column the caller meant.
    expect(calls.map((c) => c.fn)).toEqual(['updateMany']);
    expect(calls[0].data).toEqual({ title: 'x' });
  });

  it('BY-ID branch: a ruled-non-id data.id beside a scalar where.id is reported too', async () => {
    // #6435's block — the card named only PR #6433's multi block, but `main`
    // carries two strips of the same class and both had the same deliberate
    // "not reporting this one" comment.
    const { events, calls } = await observe(
      { id: { $in: ['a', 'b'] }, title: 'x' },
      { where: { id: 'rec_1' } },
    );
    expect(events).toEqual([{ object: 'task', fields: ['id'], reason: 'primary_key' }]);
    expect(calls.map((c) => c.fn)).toEqual(['update']);
    expect(calls[0].id).toBe('rec_1');
    expect(calls[0].data).toEqual({ title: 'x' });
  });

  // ── the contrast pins: what does NOT report ──────────────────────────────

  it('a TRUTHY SCALAR data.id is the bound key — not stripped, so nothing is reported', async () => {
    const { events, calls } = await observe({ id: 'rec_1', title: 'x' }, {});
    expect(events).toEqual([]);
    expect(calls[0].data).toMatchObject({ title: 'x' });
  });

  it('a write carrying no id at all reports nothing', async () => {
    const { events } = await observe({ title: 'x' }, { multi: true, where: { status: 'open' } });
    expect(events).toEqual([]);
  });
});

// ── 2. the read-only seam is untouched ────────────────────────────────────

describe('#6437 — the two read-only reasons are unchanged', () => {
  it('a static readonly strip still reports `readonly`, not the new value', async () => {
    const { events } = await observe({ id: 'rec_1', settled_total: 99 }, {});
    expect(events).toEqual([{ object: 'task', fields: ['settled_total'], reason: 'readonly' }]);
  });

  it('a readonlyWhen strip still reports `readonly_when`', async () => {
    const { events } = await observe({ id: 'rec_1', closed_at: '2026-01-01' }, {});
    expect(events).toEqual([{ object: 'task', fields: ['closed_at'], reason: 'readonly_when' }]);
  });

  it('a primary-key strip and a readonly strip in one payload are SEPARATE events', async () => {
    // One event per strip pass, each truthfully labelled — the whole point of
    // widening the vocabulary rather than merging the classes.
    const { events } = await observe(
      { id: { $in: ['a', 'b'] }, title: 'x', settled_total: 99 },
      { multi: true },
    );
    expect(events).toEqual([
      { object: 'task', fields: ['id'], reason: 'primary_key' },
      { object: 'task', fields: ['settled_total'], reason: 'readonly' },
    ]);
  });
});

// ── 3. the loud half: strictReadonlyWrites gains a refusal, deliberately ──

describe('#6437 — strictReadonlyWrites refuses the primary-key strip too', () => {
  it('MULTI branch: REFUSED with the envelope code, and no driver call happens', async () => {
    const { err, calls } = await refuse({ id: { $in: ['a', 'b'] }, title: 'x' }, { multi: true });
    expect(err.code).toBe('ERR_READONLY_FIELD_REJECTED');
    expect(err.name).toBe('ReadonlyFieldRejectedError');
    expect(err.object).toBe('task');
    expect(err.fields).toEqual(['id']);
    // Nothing written — not the stripped key, not `title`, which would have
    // survived the strip on the default path.
    expect(calls).toEqual([]);
  });

  it('BY-ID branch: REFUSED the same way', async () => {
    const { err, calls } = await refuse(
      { id: { $in: ['a', 'b'] }, title: 'x' },
      { where: { id: 'rec_1' } },
    );
    expect(err.code).toBe('ERR_READONLY_FIELD_REJECTED');
    expect(err.fields).toEqual(['id']);
    expect(calls).toEqual([]);
  });

  it('`drops` carries the reason, so a caller separates the classes without parsing prose', async () => {
    const { err } = await refuse({ id: { $in: ['a', 'b'] }, title: 'x' }, { multi: true });
    expect(err.drops).toEqual([{ object: 'task', fields: ['id'], reason: 'primary_key' }]);
  });

  it('a mixed payload accumulates BOTH classes into one refusal', async () => {
    const { err } = await refuse(
      { id: { $in: ['a', 'b'] }, title: 'x', settled_total: 99 },
      { multi: true },
    );
    expect([...err.fields].sort()).toEqual(['id', 'settled_total']);
    expect([...err.drops].map((d: any) => d.reason)).toEqual(['primary_key', 'readonly']);
  });

  it('the listener does NOT also fire on a refused write — quiet-or-loud, one per call', async () => {
    const { engine } = await makeEngine();
    const events: DroppedFieldsEvent[] = [];
    await rejection(engine.update(
      'task',
      { id: { $in: ['a', 'b'] }, title: 'x' } as any,
      { multi: true, strictReadonlyWrites: true, onFieldsDropped: (e: DroppedFieldsEvent) => events.push(e) } as any,
    ));
    expect(events).toEqual([]);
  });

  it('a truthy scalar data.id is NOT refused — strict adds no second policy', async () => {
    // The rule #5126 wrote down: strict refuses exactly what the strip takes.
    // The strip leaves a bound scalar key alone, so strict must accept it.
    const { engine, calls } = await makeEngine();
    await engine.update('task', { id: 'rec_1', title: 'x' } as any, { strictReadonlyWrites: true } as any);
    expect(calls.map((c) => c.fn)).toEqual(['update']);
  });
});

// ── 4. the refusal message tells the truth per reason ─────────────────────

describe('#6437 — the refusal message is composed from `drops`, not from the code name', () => {
  it('a primary_key refusal does NOT claim the field is read-only', async () => {
    const { err } = await refuse({ id: { $in: ['a', 'b'] }, title: 'x' }, { multi: true });
    // The lie this change exists to prevent — `id` is not read-only, and
    // `isSystem` does not exempt it.
    expect(err.message).not.toContain('are read-only and would have been stripped');
    expect(err.message).toContain('primary key');
    expect(err.message).toContain('was REFUSED');
    // ...and it points at the real remedy for THIS class.
    expect(err.message).toContain('SCALAR id');
  });

  it('the READ-ONLY-only message is unmoved by a NEW REASON CLASS', async () => {
    // The compatibility half, and read it for what it actually asserts: adding
    // a `reason` (#6437's whole change) must not disturb the wording payloads
    // that carry no such class see. That property still holds.
    //
    // [#9107] What it never claimed is that the sentence is frozen for all
    // time. The remedy clause moved ONCE, deliberately, when the maintainer
    // ruled the conditional strip judges only API-boundary callers: the old
    // text told a server author its hook-derived write was locked out, which
    // stopped being true. A remedy sentence that has gone false is the one
    // thing a refusal message may not keep — so the pin moves WITH the ruling,
    // and stays a byte-exact pin so the next unintended drift is still caught.
    const { err } = await refuse({ id: 'rec_1', settled_total: 99 }, {});
    expect(err.message).toBe(
      `Update on 'task' was REFUSED: 1 caller-supplied field(s) ` +
      `(settled_total) are read-only and would have been stripped, and this write ` +
      `passed options.strictReadonlyWrites — so NOTHING was written, including the fields ` +
      `that would have survived. Remove the read-only field(s) from the payload; or, for ` +
      `server-side code that legitimately writes read-only columns, pass ` +
      `{ context: { isSystem: true } } (this exempts statically 'readonly' fields, but NOT ` +
      `fields locked by a TRUE 'readonlyWhen' predicate — those stay locked for every ` +
      `API-boundary caller, isSystem included. A value DERIVED by a beforeUpdate hook is ` +
      `not a caller write and is never stripped — that is the sanctioned write path for a ` +
      `conditionally-locked derived field). To let the strip happen and merely observe it, drop ` +
      `strictReadonlyWrites and pass options.onFieldsDropped instead (#3407).`,
    );
  });

  it('a mixed refusal names each reason against its own fields', async () => {
    const { err } = await refuse(
      { id: { $in: ['a', 'b'] }, title: 'x', settled_total: 99 },
      { multi: true },
    );
    expect(err.message).toContain('id — the primary key');
    expect(err.message).toContain('settled_total — read-only');
    expect(err.message).not.toContain('are read-only and would have been stripped');
  });
});
