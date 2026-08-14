// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #5126 — `strictReadonlyWrites`: the LOUD half of the readonly-strip seam.
//
// #4903 (PR #5123) made the silent strip DISCOVERABLE — an actionable warn log
// and the `onFieldsDropped` listener. What it could not add was an out: a
// caller that would rather the write FAIL than commit without the column had
// nowhere to say so, because the option key had to live in `packages/spec`.
// The maintainer ruled Option B (#5126): the flag hangs off
// `WriteObservabilityOptions` — the in-process TS contract, next to
// `onFieldsDropped` — and NOT off `EngineUpdateOptionsSchema`, the serializable
// bag a REST body can populate. The anti-creep guard for that half of the
// ruling lives in `packages/spec/src/contracts/data-engine.test.ts`; this suite
// pins the behaviour.
//
// The three facts worth pinning, in order of how expensive each is to get
// wrong:
//
//  1. Strict REFUSES — nothing is written, not even the fields that would have
//     survived the strip. A partial write under a flag whose whole point is
//     "don't half-apply my payload" would be worse than the silent strip.
//  2. Strict is OFF by default and the unset path is byte-identical to before:
//     same strip, same `onFieldsDropped` event, same commit. This flag must not
//     be a behaviour change for anyone who did not ask for it.
//  3. Strict covers BOTH strip reasons. The static-`readonly` strip is skipped
//     for `isSystem` callers, so a strict mode covering only that arm would be
//     nearly inert for the exact caller it was built for — a trusted cron —
//     which still loses `readonlyWhen`-locked fields in silence.

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectQL } from './engine.js';

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

const silentLogger: any = (() => {
  const l: any = {
    debug() {}, info() {}, error() {}, trace() {}, fatal() {}, warn() {},
    child() { return l; },
  };
  return l;
})();

/** Catch and return the rejection, so a case can assert on its shape. */
async function rejection(p: Promise<unknown>): Promise<any> {
  try {
    await p;
  } catch (err) {
    return err;
  }
  throw new Error('expected the write to be refused, but it resolved');
}

describe('strictReadonlyWrites (#5126)', () => {
  let engine: ObjectQL;
  let storeFor: ReturnType<typeof makeDriver>['storeFor'];

  beforeEach(async () => {
    engine = new ObjectQL({ logger: silentLogger });
    const d = makeDriver();
    storeFor = d.storeFor;
    engine.registerDriver(d.driver, true);
    await engine.init();
    // #4903's downstream shape: an attendance row whose worked-hours column is
    // settled by the platform, plus a `readonlyWhen` lock that freezes the
    // check-out time once the row is closed.
    engine.registry.registerObject({
      name: 'attendance',
      fields: {
        status: { type: 'text' },
        note: { type: 'text' },
        check_out_time: { type: 'datetime', readonlyWhen: "record.status == 'closed'" },
        work_duration: { type: 'number', readonly: true },
        approved_by: { type: 'text', readonly: true },
      },
    } as any);
    storeFor('attendance').set('att_1', {
      id: 'att_1', status: 'open', note: 'n0', work_duration: null, approved_by: null,
    });
  });

  const att = (id = 'att_1') => storeFor('attendance').get(id);

  // ── 1. the refusal itself ────────────────────────────────────────────────

  it('refuses the write and names the rejected field', async () => {
    const err = await rejection(engine.update(
      'attendance',
      { id: 'att_1', status: 'closed', work_duration: 480 },
      { strictReadonlyWrites: true } as any,
    ));
    expect(err.code).toBe('ERR_READONLY_FIELD_REJECTED');
    expect(err.fields).toEqual(['work_duration']);
    expect(err.object).toBe('attendance');
    expect(err.message).toContain('work_duration');
  });

  it('writes NOTHING — the fields that would have survived the strip do not land either', async () => {
    // The distinguishing promise of strict over the strip. `status` is an
    // ordinary writable field: under the default strip it commits while
    // `work_duration` is dropped. Under strict the whole payload is refused,
    // so a caller never has to reason about a half-applied update.
    await rejection(engine.update(
      'attendance',
      { id: 'att_1', status: 'closed', note: 'n1', work_duration: 480 },
      { strictReadonlyWrites: true } as any,
    ));
    expect(att()).toMatchObject({ status: 'open', note: 'n0', work_duration: null });
  });

  it('carries the FULL field list across every rejected field, not just the first', async () => {
    const err = await rejection(engine.update(
      'attendance',
      { id: 'att_1', work_duration: 480, approved_by: 'u_1' },
      { strictReadonlyWrites: true } as any,
    ));
    expect([...err.fields].sort()).toEqual(['approved_by', 'work_duration']);
  });

  it('rejects on the BULK path too, and no matched row is touched', async () => {
    storeFor('attendance').set('att_2', { id: 'att_2', status: 'open', note: 'n0', work_duration: null });
    const err = await rejection(engine.update(
      'attendance',
      { note: 'bulk', work_duration: 480 },
      { where: { status: 'open' }, multi: true, strictReadonlyWrites: true } as any,
    ));
    expect(err.code).toBe('ERR_READONLY_FIELD_REJECTED');
    expect(err.fields).toEqual(['work_duration']);
    expect(att().note).toBe('n0');
    expect(att('att_2').note).toBe('n0');
  });

  // ── 2. off by default; the unset path is unchanged ───────────────────────

  it('unset: the strip still happens, the write still commits, onFieldsDropped still fires', async () => {
    const events: any[] = [];
    await engine.update(
      'attendance',
      { id: 'att_1', status: 'closed', work_duration: 480 },
      { onFieldsDropped: (e: any) => events.push(e) } as any,
    );
    expect(events).toEqual([{ object: 'attendance', fields: ['work_duration'], reason: 'readonly' }]);
    expect(att()).toMatchObject({ status: 'closed', work_duration: null });
  });

  it('explicit false is the same as unset — the option is opt-IN, not tri-state', async () => {
    await engine.update(
      'attendance',
      { id: 'att_1', status: 'closed', work_duration: 480 },
      { strictReadonlyWrites: false } as any,
    );
    expect(att()).toMatchObject({ status: 'closed', work_duration: null });
  });

  it('strict with nothing to strip is an ordinary successful write', async () => {
    // No false positives: the flag must not turn "you sent no read-only field"
    // into an error, or every strict caller learns to catch and ignore.
    await engine.update(
      'attendance',
      { id: 'att_1', status: 'closed', note: 'n1' },
      { strictReadonlyWrites: true } as any,
    );
    expect(att()).toMatchObject({ status: 'closed', note: 'n1' });
  });

  it('strict invents no rejection where the strip does not run — isSystem still writes readonly columns', async () => {
    // The static strip is skipped for system callers, so there is no drop and
    // therefore nothing to refuse. Strict reports the strip; it is not a second,
    // stricter policy layered on top of it.
    await engine.update(
      'attendance',
      { id: 'att_1', work_duration: 480 },
      { context: { isSystem: true }, strictReadonlyWrites: true } as any,
    );
    expect(att().work_duration).toBe(480);
  });

  // ── 3. both strip reasons, including the trusted-caller one ──────────────

  it('covers readonlyWhen too — the arm a trusted (isSystem) caller can still hit', async () => {
    // `isSystem` exempts the static strip but NOT the `readonlyWhen` lock. A
    // strict mode that covered only the static arm would be inert for exactly
    // the caller #5126 exists for: the cron that already declares itself
    // trusted and still silently loses locked columns.
    storeFor('attendance').set('att_3', {
      id: 'att_3', status: 'closed', note: 'n0', check_out_time: '2026-08-01T00:00:00Z',
    });
    const err = await rejection(engine.update(
      'attendance',
      { id: 'att_3', check_out_time: '2026-08-05T09:00:00Z' },
      { context: { isSystem: true }, strictReadonlyWrites: true } as any,
    ));
    expect(err.code).toBe('ERR_READONLY_FIELD_REJECTED');
    expect(err.fields).toEqual(['check_out_time']);
    expect(att('att_3').check_out_time).toBe('2026-08-01T00:00:00Z');
  });

  it('an UNLOCKED readonlyWhen field passes strict — the predicate decides, not the declaration', async () => {
    // `att_1` is still `open`, so the lock is false and the field is writable.
    await engine.update(
      'attendance',
      { id: 'att_1', check_out_time: '2026-08-05T09:00:00Z' },
      { strictReadonlyWrites: true } as any,
    );
    expect(att().check_out_time).toBe('2026-08-05T09:00:00Z');
  });

  it('accumulates BOTH reasons into one error rather than failing on the first pass', async () => {
    storeFor('attendance').set('att_4', {
      id: 'att_4', status: 'closed', note: 'n0', check_out_time: '2026-08-01T00:00:00Z', work_duration: null,
    });
    const err = await rejection(engine.update(
      'attendance',
      { id: 'att_4', check_out_time: '2026-08-05T09:00:00Z', work_duration: 480 },
      { strictReadonlyWrites: true } as any,
    ));
    expect([...err.fields].sort()).toEqual(['check_out_time', 'work_duration']);
    // The per-reason breakdown survives on the error, so a caller can tell a
    // schema-level lock from a state-dependent one without parsing prose.
    expect([...err.drops].map((d: any) => d.reason).sort()).toEqual(['readonly', 'readonly_when']);
  });

  // ── 4. strict and the listener are alternatives, not a sequence ──────────

  it('does NOT fire onFieldsDropped on a refused write', async () => {
    // `DroppedFieldsEvent` is contracted as "fields dropped and the write
    // COMPLETED without them". Under strict the write does not complete, so
    // firing it would emit an event whose documented meaning is false — and a
    // flow step listening for drops would report a partial success for a write
    // that never happened.
    const events: any[] = [];
    await rejection(engine.update(
      'attendance',
      { id: 'att_1', work_duration: 480 },
      { strictReadonlyWrites: true, onFieldsDropped: (e: any) => events.push(e) } as any,
    ));
    expect(events).toEqual([]);
  });
});
