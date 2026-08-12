// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// objectstack#8141 — the read-only strip's WARN must stop calling the addressed
// row's OWN primary key a forged caller write.
//
// ## What was wrong
//
// #8093 fixed the REPORT channel (`droppedFields` / `onFieldsDropped`): on a
// by-id update the payload `id` that equals the bound row is the write's
// ADDRESS, not payload, so it is not a drop. It deliberately left the strip —
// and the strip's own log — alone, so `stripReadonlyFields` went on emitting
// `readonlyStripWarning('id', …)` on every single-record update of every object
// declaring `id` as `readonly: true`, i.e. every platform object.
//
// Measured by the card on a real ObjectQL + a real protocol, with
// `updateData({ object: 'sys_user_preference', id: 'rec_1', data: { value: ['x'] } })`
// — a body carrying no `id` key at all:
//
//     droppedFields : null            ← #8093's fix, correct
//     warn count    : 1
//       WARN: Field 'id' on 'sys_user_preference' is read-only: the caller-supplied
//             value was DROPPED and the update is being COMMITTED WITHOUT IT — …
//
// All three claims are false for that write. The value was not caller-supplied
// (`metadata-protocol`'s `updateData` folds the path id into the body, #6479);
// nothing the caller wanted was dropped; nothing it asked for was left out of
// the commit. And the message's remedy tells that caller to pass
// `{ context: { isSystem: true } }` — which would exempt it from the static
// read-only strip ENTIRELY: a strictly worse posture bought to silence a line
// that should never have printed.
//
// The console's recents trace alone emits one per org switch. The cost is the
// same one #3431 / #3794 and #8093 were about, one channel over: a warning that
// fires on every ordinary write trains its reader to skip the channel, and the
// forgery this line exists to surface is skipped with it.
//
// ## What the fix is, and what it is NOT
//
// `stripReadonlyFields` gains `options.addressKey`: the named key is still
// STRIPPED, it just no longer LOGS. The by-id branch passes the key from the
// SAME `idAddressesThisRow` predicate #8093 wired to the report channel — one
// notion of "this id is the address", feeding both channels, so they cannot
// disagree. NOT "stop stripping `id`" (a same-value primary-key write is a
// no-op on SQL but a rejection on stores with immutable primary keys), and NOT
// "remove the address before the read-only pass" (that changes what the driver
// receives for objects whose `id` is not readonly — #6435's explicitly separate
// decision). The driver's SET clause is byte-identical before and after, which
// is why half the cases below assert it.
//
// ## Predicted table, written BEFORE the first run
//
// | case                                                          | warn lines                          | driver SET       |
// |---------------------------------------------------------------|-------------------------------------|------------------|
// | REST ingress shape: `{value,id}` + `where.id`, readonly `id`    | NONE                                | no `id`          |
// | canonical `update(obj,{id,…})`, readonly `id`                   | NONE                                | no `id`          |
// | address + a really-forged `locked_note`                         | ONE — `locked_note`, byte-identical | no `id`, no note |
// | ruled-non-id `data.id` + forged `locked_note` (by-id branch)    | TWO — `primary_key` + `locked_note` | neither          |
// | MULTI branch, forged `locked_note`                              | ONE — `locked_note`, byte-identical | no note          |
// | object whose `id` is NOT readonly                               | NONE (as before)                    | `id` PRESENT     |
// | `isSystem` caller writing `locked_note`                         | NONE (as before)                    | note PRESENT     |
//
// Rows 3–5 are the ones that make this file able to fail: the fix NARROWS what
// is logged, so without a case that still DEMANDS the line — asserted `toBe`
// against the exported message, so a reworded or downgraded one is red —
// "stop calling the address a forgery" and "delete the tripwire" look alike.
//
// ## Reverse verification — prediction, then what actually happened
//
// PREDICTED, before the run: drop the `addressKey` argument at the `engine.ts`
// by-id call site (leave everything else, including #8093's report exclusion,
// in place) and rows 1, 2 and 3 go RED — 1 and 2 gain the `id` line, 3 sees two
// warns instead of one — while rows 4, 5, 6 and 7 stay GREEN, because none of
// them has an address to exclude.
//
// MEASURED: exactly that — 3 failed / 6 passed, and the three failures are rows
// 1, 2 and 3, each reporting the extra `readonlyStripWarning('id', 'pref')`
// line. Recorded verbatim in the PR body. The direction was NOT the "more
// diagnostics, not fewer" inversion #8093 hit on its strict rows: this option
// feeds no counter and no derived refusal — `strictReadonlyWrites` is keyed on
// `reportDroppedFields`, which #8093 already excluded the address from, so the
// loud half cannot move when only the log line does. Rows 4–7 confirmed it did
// not.

import { describe, it, expect } from 'vitest';
import { ObjectQL } from './engine.js';
import { readonlyStripWarning } from './validation/rule-validator.js';
import type { DroppedFieldsEvent } from '@objectstack/spec/data';

/** A logger that records every line, with its level. */
function makeCapturingLogger() {
  const lines: Array<{ level: string; msg: string }> = [];
  const logger: any = {
    lines,
    trace() {}, fatal() {},
    debug(msg: string) { lines.push({ level: 'debug', msg: String(msg) }); },
    info(msg: string) { lines.push({ level: 'info', msg: String(msg) }); },
    warn(msg: string) { lines.push({ level: 'warn', msg: String(msg) }); },
    error(msg: string) { lines.push({ level: 'error', msg: String(msg) }); },
    child() { return logger; },
  };
  return logger;
}

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
 * `id` is `Field.text({ label: 'Preference ID', required: true, readonly: true })`.
 */
async function makeEngine(readonlyId: boolean) {
  const logger = makeCapturingLogger();
  const engine = new ObjectQL({ logger });
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
  return { engine, writes, logger };
}

/** Run one write; return the WARN lines it emitted plus the driver's writes. */
async function observe(
  data: unknown,
  options: Record<string, unknown> = {},
  opts: { readonlyId?: boolean } = {},
) {
  const { engine, writes, logger } = await makeEngine(opts.readonlyId !== false);
  const events: DroppedFieldsEvent[] = [];
  await engine.update('pref', data as any, {
    ...options,
    onFieldsDropped: (e: DroppedFieldsEvent) => events.push(e),
  } as any);
  const warns = logger.lines.filter((l: any) => l.level === 'warn').map((l: any) => l.msg);
  return { warns, writes, events, lines: logger.lines };
}

describe('#8141 — the addressed row\'s primary key is not logged as a forged caller write', () => {
  it('THE REPRO: the REST ingress shape logs NOTHING, and the strip is unchanged', async () => {
    // Byte-for-byte what `metadata-protocol`'s `updateData` builds for
    // `PATCH /data/pref/rec_1` with the body `{ value: 'v1' }` — no `id` key:
    // `{ ...request.data, id: request.id }` plus `where: { id: request.id }`.
    const { warns, writes, events } = await observe(
      { value: 'v1', id: 'rec_1' },
      { where: { id: 'rec_1' } },
    );
    expect(warns).toEqual([]);
    // …and #8093's channel still agrees — one predicate, two channels.
    expect(events).toEqual([]);
    // The strip itself did NOT move: `id` still never reaches the SET clause.
    expect(writes.map((w) => w.fn)).toEqual(['update']);
    expect(writes[0].data).toEqual({ value: 'v1' });
    expect(writes[0].id).toBe('rec_1');
  });

  it('the canonical ObjectQL by-id spelling `update(obj, { id, ...fields })` logs nothing either', async () => {
    const { warns, writes } = await observe({ id: 'rec_1', value: 'v1' });
    expect(warns).toEqual([]);
    expect(writes[0].data).toEqual({ value: 'v1' });
  });

  it('THE TRIPWIRE: a read-only field the caller REALLY forged still WARNs, byte-identical', async () => {
    // Without this the fix is indistinguishable from "stop warning about
    // dropped fields". `toBe` against the exported message pins the wording,
    // and the level assertion pins that it is still `warn` — the level its own
    // docblock defends precisely so real forgery attempts stay visible.
    const { warns, writes, events, lines } = await observe(
      { value: 'v1', locked_note: 'forged', id: 'rec_1' },
      { where: { id: 'rec_1' } },
    );
    expect(warns).toEqual([readonlyStripWarning('locked_note', 'pref')]);
    expect(lines.filter((l: any) => l.level !== 'debug' && l.level !== 'info').map((l: any) => l.level))
      .toEqual(['warn']);
    // The line still carries the consequence and both remedies (#4903), and
    // the remedy is TRUE here: this caller really did write a read-only column.
    expect(warns[0]).toContain('COMMITTED WITHOUT IT');
    expect(warns[0]).toContain('{ context: { isSystem: true } }');
    expect(warns[0]).toContain('onFieldsDropped');
    // …and it names the forged field alone, never the address.
    expect(warns[0]).not.toContain("Field 'id'");
    expect(events).toEqual([{ object: 'pref', fields: ['locked_note'], reason: 'readonly' }]);
    expect(writes[0].data).toEqual({ value: 'v1' });
  });

  it('a caller-supplied `id` that does NOT address the bound row is still called out', async () => {
    // The engine rules a non-scalar `data.id` "not a primary key" and strips it
    // on the by-id branch as `primary_key` (#6262 / #6435 / #6437) BEFORE the
    // read-only pass — so this is the shape a non-addressing `id` actually
    // takes on this branch, and its own WARN must survive untouched. The
    // exclusion cannot reach it: it is keyed on equality with the bound key,
    // which a ruled-non-id value never has.
    const { warns, writes, events } = await observe(
      { id: { $in: ['a', 'b'] }, value: 'v1', locked_note: 'forged' },
      { where: { id: 'rec_1' } },
    );
    expect(warns).toHaveLength(2);
    expect(warns.some((w: string) => w.includes("dropped 'id' from the write payload"))).toBe(true);
    expect(warns).toContain(readonlyStripWarning('locked_note', 'pref'));
    expect(events).toEqual([
      { object: 'pref', fields: ['id'], reason: 'primary_key' },
      { object: 'pref', fields: ['locked_note'], reason: 'readonly' },
    ]);
    expect(writes[0].data).toEqual({ value: 'v1' });
  });

  it('the MULTI branch is untouched — it passes no address at all', async () => {
    // Nothing addresses a row by key on a predicate write, so that call site
    // hands `stripReadonlyFields` no `addressKey` and its behaviour is
    // identical to before the option existed.
    const { warns, writes } = await observe(
      { locked_note: 'forged', value: 'v1' },
      { multi: true, where: { title: 't0' } },
    );
    expect(warns).toEqual([readonlyStripWarning('locked_note', 'pref')]);
    expect(writes.map((w) => w.fn)).toEqual(['updateMany']);
    expect(writes[0].data).toEqual({ value: 'v1' });
  });

  it('an object whose `id` is NOT readonly is unaffected — no strip existed to silence', async () => {
    const { warns, writes } = await observe(
      { value: 'v1', id: 'rec_1' },
      { where: { id: 'rec_1' } },
      { readonlyId: false },
    );
    expect(warns).toEqual([]);
    // Unchanged: the `id` still rides into the SET clause. Removing it here is
    // #6435's explicitly separate decision, not this card's.
    expect(writes[0].data).toEqual({ value: 'v1', id: 'rec_1' });
  });

  it('an `isSystem` caller still skips the whole strip, silently, as before', async () => {
    const { engine, writes, logger } = await makeEngine(true);
    await engine.update(
      'pref',
      { id: 'rec_1', value: 'v1', locked_note: 'system-write' } as any,
      { where: { id: 'rec_1' }, context: { isSystem: true } } as any,
    );
    expect(logger.lines.filter((l: any) => l.level === 'warn')).toEqual([]);
    // The exemption is the whole pass — including the address, which is why
    // this case cannot be confused with the one above it.
    expect(writes[0].data).toEqual({ id: 'rec_1', value: 'v1', locked_note: 'system-write' });
  });
});
