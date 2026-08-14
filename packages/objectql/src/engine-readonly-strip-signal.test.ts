// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #4903 — the static `readonly: true` write strip, from the CALLER's side.
//
// A server-side plugin (cron / background job) that writes a `readonly` column
// through `ctx.getService('data').update(...)` gets a SUCCESSFUL call whose
// value never lands: `getService('data')` hands back the plain engine, whose
// execution context is empty, so `!context.isSystem` sends trusted server code
// down the same strip as untrusted client input. Downstream report:
// os-project-titanwind-ehr#750 — a settled `work_duration` stayed `null` when
// (and only when) the auto-clock-out cron wrote it, while every REST path for
// the same field worked, which reads as "cron is broken" rather than "the field
// was stripped".
//
// This suite pins the three things that decide how expensive that is to
// diagnose:
//
//  1. WHY the hook path differs (the caller's payload is snapshotted at engine
//     entry, BEFORE middleware and beforeUpdate hooks run, so a hook write is
//     not a caller write). #5591 narrowed that snapshot's reading from a key
//     SET to the keys AND VALUES: a hook that OVERWRITES a read-only key the
//     caller also sent now survives too, where before it was deleted along
//     with the caller's value. See the block at the bottom of this file — the
//     case that pinned the old behaviour was replaced there, not re-spelled.
//  2. The strip's log states the CONSEQUENCE and both REMEDIES, so the log is
//     actionable on its own (#4632's second-class shape: caller believes
//     persisted, database disagrees, log is the only trace).
//  3. The machine-readable signal that ALREADY exists — `onFieldsDropped`
//     (#3407) — is reachable from exactly the caller shape the issue describes
//     (in-process engine, no context), and `{ context: { isSystem: true } }`
//     makes the same write land.
//
// What is NOT here: the strict/reject mode. It landed later, under #5126 —
// `options.strictReadonlyWrites` on `WriteObservabilityOptions` (the ruling
// chose the in-process TS contract over the client-serializable
// `EngineUpdateOptionsSchema`, which would have made write-refusal settable
// from a wire body). Its suite is `engine-readonly-strict-writes.test.ts`.
// Everything below stays the DEFAULT path — strict is off unless asked for,
// and these cases are what "off" must keep meaning.

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectQL } from './engine.js';
import { readonlyStripWarning, stripReadonlyFields } from './validation/rule-validator.js';

function makeDriver() {
  const stores = new Map<string, Map<string, any>>();
  const storeFor = (o: string) => {
    let s = stores.get(o);
    if (!s) { s = new Map(); stores.set(o, s); }
    return s;
  };
  const matches = (row: any, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    return Object.entries(where).every(([k, v]: [string, any]) => {
      if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
      return row?.[k] === v;
    });
  };
  let n = 0;
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find(object: string, ast: any) {
      return Array.from(storeFor(object).values()).filter((r) => matches(r, ast?.where));
    },
    async findOne(object: string, ast: any) {
      for (const r of storeFor(object).values()) if (matches(r, ast?.where)) return r;
      return null;
    },
    async create(object: string, data: Record<string, unknown>) {
      n += 1;
      const id = (data.id as string) ?? `r_${n}`;
      const row = { ...data, id };
      storeFor(object).set(id, row);
      return row;
    },
    async update(object: string, id: string, data: Record<string, unknown>) {
      const s = storeFor(object);
      const row = { ...s.get(id), ...data, id };
      s.set(id, row);
      return row;
    },
    async updateMany(object: string, ast: any, data: Record<string, unknown>) {
      const s = storeFor(object);
      let count = 0;
      for (const row of [...s.values()]) {
        if (!matches(row, ast?.where)) continue;
        s.set(row.id, { ...row, ...data, id: row.id });
        count += 1;
      }
      return count;
    },
    async delete(object: string, id: string) { return storeFor(object).delete(id); },
    async count() { return 0; },
    async bulkCreate(object: string, rows: Record<string, unknown>[]) {
      return Promise.all(rows.map((r) => this.create(object, r, undefined)));
    },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() { return { __trx: true, commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, storeFor };
}

/** A logger that records the lines the engine writes, for the log-contract pin. */
function makeCapturingLogger() {
  const warns: string[] = [];
  const logger: any = {
    warns,
    debug() {}, info() {}, error() {}, trace() {}, fatal() {},
    warn(msg: string) { warns.push(String(msg)); },
    child() { return logger; },
  };
  return logger;
}

describe('static `readonly` write strip — caller-facing signal (#4903)', () => {
  let engine: ObjectQL;
  let logger: ReturnType<typeof makeCapturingLogger>;
  let storeFor: ReturnType<typeof makeDriver>['storeFor'];

  beforeEach(async () => {
    logger = makeCapturingLogger();
    engine = new ObjectQL({ logger });
    const d = makeDriver();
    storeFor = d.storeFor;
    engine.registerDriver(d.driver, true);
    await engine.init();
    // The downstream shape, trimmed: an attendance record whose worked-hours
    // column is settled by the platform, never typed by a user.
    engine.registry.registerObject({
      name: 'attendance',
      fields: {
        status: { type: 'text' },
        check_out_time: { type: 'datetime' },
        work_duration: { type: 'number', readonly: true },
      },
    } as any);
    storeFor('attendance').set('att_1', { id: 'att_1', status: 'open', work_duration: null });
  });

  const att = () => storeFor('attendance').get('att_1');

  // ── 1. the reported behaviour, and the documented way out ───────────────

  it('THE REPORT: a contextless plugin write lands every field EXCEPT the readonly one', async () => {
    await engine.update('attendance', {
      id: 'att_1', status: 'closed', check_out_time: '2026-08-04T09:00:00Z', work_duration: 480,
    });
    // The call resolved without throwing — that is the whole complaint.
    expect(att()).toMatchObject({ status: 'closed', check_out_time: '2026-08-04T09:00:00Z' });
    expect(att().work_duration).toBeNull();
  });

  it('the SAME write lands in full once the caller declares itself trusted', async () => {
    await engine.update(
      'attendance',
      { id: 'att_1', status: 'closed', work_duration: 480 },
      { context: { isSystem: true } } as any,
    );
    expect(att()).toMatchObject({ status: 'closed', work_duration: 480 });
  });

  // ── 2. the machine-readable signal that already exists (#3407) ───────────

  it('reports the drop to a contextless caller via onFieldsDropped', async () => {
    // The listener is reachable from exactly the shape the issue describes:
    // `ctx.getService('data')` registers the in-process engine (plugin.ts), so
    // no RPC boundary swallows the event.
    const events: any[] = [];
    await engine.update(
      'attendance',
      { id: 'att_1', status: 'closed', work_duration: 480 },
      { onFieldsDropped: (e: any) => events.push(e) } as any,
    );
    expect(events).toEqual([{ object: 'attendance', fields: ['work_duration'], reason: 'readonly' }]);
  });

  it('reports the drop on the BULK path too', async () => {
    const events: any[] = [];
    await engine.update(
      'attendance',
      { work_duration: 480 },
      { where: { status: 'open' }, multi: true, onFieldsDropped: (e: any) => events.push(e) } as any,
    );
    expect(events).toEqual([{ object: 'attendance', fields: ['work_duration'], reason: 'readonly' }]);
    expect(att().work_duration).toBeNull();
  });

  // ── 3. the log is actionable on its own ─────────────────────────────────

  it('the strip WARNs the consequence and BOTH remedies, naming the object and field', async () => {
    await engine.update('attendance', { id: 'att_1', work_duration: 480 });
    const line = logger.warns.find((w: string) => w.includes('work_duration'));
    expect(line, 'the strip must log').toBeDefined();
    // Consequence — not just "ignoring incoming change".
    expect(line).toContain("Field 'work_duration' on 'attendance'");
    expect(line).toContain('COMMITTED WITHOUT IT');
    // Remedy A: the documented convention for genuinely trusted server code.
    expect(line).toContain('{ context: { isSystem: true } }');
    // Remedy B: the machine-readable signal, so the log is not the only way out.
    expect(line).toContain('onFieldsDropped');
  });

  it('stays at WARN — the seam cannot tell a forged client body from trusted server code', () => {
    // Pinned deliberately: `ExecutionContext` carries no origin/channel marker,
    // so an `error` level here would be client-triggerable log spam and a
    // `debug` level would restore the silent drop. One level, chosen.
    const calls: Array<[string, string]> = [];
    const probe: any = {
      warn: (m: string) => calls.push(['warn', m]),
      error: (m: string) => calls.push(['error', m]),
      info: (m: string) => calls.push(['info', m]),
      debug: (m: string) => calls.push(['debug', m]),
    };
    stripReadonlyFields(
      { name: 'attendance', fields: { work_duration: { type: 'number', readonly: true } } } as any,
      { work_duration: 480 },
      { work_duration: 480 },
      probe,
    );
    expect(calls.map(([level]) => level)).toEqual(['warn']);
    expect(calls[0][1]).toBe(readonlyStripWarning('work_duration', 'attendance', { preserveAuditApplies: true }));
  });

  it('omits the object clause when the schema carries no name', () => {
    expect(readonlyStripWarning('work_duration')).toContain("Field 'work_duration' is read-only");
  });

  // ── 4. hook write vs. caller supply — the two are now judged alike ──────
  //
  // This block used to pin the OPPOSITE of its second case, under the heading
  // "the hook/plugin asymmetry, PINNED as-is", explicitly as a mechanism record
  // and explicitly not as an endorsement ("a future change is made on purpose
  // instead of by accident"). #5591 is that change, so the case is REPLACED
  // rather than re-spelled: it asserted that a hook could not rescue a key the
  // caller had supplied, which is exactly the limb that was removed.
  //
  // What survives unchanged is the principle underneath: a value a HOOK wrote
  // is a platform write and lands; a value the CALLER submitted to a read-only
  // column does not. #4903 pins that from the "hook adds a new key" side, and
  // the old asymmetry was that the same hook write died instead whenever the
  // caller's payload happened to carry the same key name.

  describe('beforeUpdate write vs. caller supply', () => {
    it('a hook-written readonly field LANDS while the same field supplied by the caller is stripped', async () => {
      engine.registerHook('beforeUpdate', async (ctx: any) => {
        ctx.input.data.work_duration = 480;
      }, { object: 'attendance' });

      // Caller supplies nothing read-only; the hook backfills it → persisted.
      await engine.update('attendance', { id: 'att_1', status: 'closed' });
      expect(att().work_duration).toBe(480);
    });

    it('[#5591] a hook OVERWRITING a key the caller supplied now survives the strip', async () => {
      // The mechanism, restated: the entry snapshot carries the caller's VALUES,
      // and the strip deletes a read-only key only while it still holds the
      // caller's own value. A hook that writes over it has replaced a caller
      // write with a platform write, and platform writes to read-only columns
      // are legitimate. Before #5591 the snapshot was a key SET, so the hook's
      // 999 was deleted and the column kept its stored null.
      storeFor('attendance').set('att_2', { id: 'att_2', status: 'open', work_duration: null });
      engine.registerHook('beforeUpdate', async (ctx: any) => {
        if (ctx.input.data.work_duration !== undefined) ctx.input.data.work_duration = 999;
      }, { object: 'attendance' });

      await engine.update('attendance', { id: 'att_2', status: 'closed', work_duration: 480 });
      expect(storeFor('attendance').get('att_2')).toMatchObject({ status: 'closed' });
      // The HOOK's value — never the caller's 480.
      expect(storeFor('attendance').get('att_2').work_duration).toBe(999);
    });

    it('[#5591] with NO hook on the key, the caller-supplied value is still stripped', async () => {
      // The #2948 verdict, unchanged: this is the case the strip exists for,
      // and it must not have moved a millimetre.
      storeFor('attendance').set('att_3', { id: 'att_3', status: 'open', work_duration: null });
      await engine.update('attendance', { id: 'att_3', status: 'closed', work_duration: 480 });
      expect(storeFor('attendance').get('att_3').work_duration).toBeNull();
    });

    it('the engine-stamped audit column is the same exemption, not a special case', () => {
      // `updated_by` survives a user write for exactly one reason: the audit
      // hook writes it, so it is not in the caller's snapshot. Supplied
      // explicitly, it is dropped like any other readonly field.
      const schema = {
        name: 'attendance',
        fields: { updated_by: { type: 'text', readonly: true, system: true } },
      } as any;
      const stamped = stripReadonlyFields(schema, { updated_by: 'hook-stamp' }, {});
      expect(stamped).toEqual({ updated_by: 'hook-stamp' });
      const forged = stripReadonlyFields(schema, { updated_by: 'attacker' }, { updated_by: 'attacker' });
      expect(forged).toEqual({});
    });
  });
});
