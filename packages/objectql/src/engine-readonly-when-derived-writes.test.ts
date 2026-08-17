// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #9107 — the CONDITIONAL (`readonlyWhen`) strip on the UPDATE path judges only
// the keys the CALLER submitted at engine entry, exactly as the static
// `readonly` strip has since #5591. A value a `beforeUpdate` hook derived is a
// SERVER value, and the strip that exists to stop caller forgeries must not
// discard it.
//
// The gap this pins, as reported: `stripReadonlyWhenFields` ran after the
// before-phase hooks, keyed on `name in data` over the POST-hook payload, and —
// unlike the static strip immediately below it — carried neither an `isSystem`
// exemption nor the `suppliedValues` discipline. So a field locked by a TRUE
// predicate had NO server-side write path at all: a hook computed it and the
// value was stripped; a cron/plugin wrote it with `{ context: { isSystem: true
// } }` and it was stripped. The derived-field pattern (hook-computed column) and
// a conditional form lock could not coexist on one field.
//
// The measured downstream shape (steedos-labs/os-project-titanwind-ehr#1446,
// reproduced below): `equipment.next_maintenance_date` is derived by a hook
// (last maintenance date + cycle days) and carries an always-TRUE `readonlyWhen`
// so the edit form renders it visible-but-locked. After a maintenance sign-off
// the recompute silently never landed — HTTP 200, field dropped — and a
// scheduler keyed on that date regenerated the same maintenance plan on every
// scan: a user-visible duplicate-plans loop, diagnosed only by reading the
// engine's strip order in the dist bundle.
//
// What this suite is NOT: a relaxation of #3042 / #4889. The API-BOUNDARY lock
// is unchanged and pinned here beside the fix, in all three directions the
// maintainer's ruling names — a caller-supplied value on a TRUE predicate is
// still stripped (`isSystem` included, so Option B stays rejected), and a caller
// cannot launder its own value through the hook phase: when a hook overwrites a
// key the caller also sent, what persists is the HOOK's value, never the
// caller's.

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

/** What the hook derives — a fixed value so the assertions read as identities. */
const DERIVED = '2026-11-14';
/** What a caller forges. Never allowed to reach the row on a locked field. */
const FORGED = '1999-01-01';

describe('readonlyWhen strips CALLER-submitted values only (#9107)', () => {
  let engine: ObjectQL;
  let storeFor: ReturnType<typeof makeDriver>['storeFor'];
  let warns: string[];

  beforeEach(async () => {
    warns = [];
    const logger: any = {
      warn: (m: string) => warns.push(String(m)),
      debug() {}, info() {}, error() {}, trace() {}, fatal() {},
      child() { return logger; },
    };
    engine = new ObjectQL({ logger });
    const d = makeDriver();
    storeFor = d.storeFor;
    engine.registerDriver(d.driver, true);
    await engine.init();

    // The downstream object, trimmed to the fields the report turns on.
    // `next_maintenance_date` is the derived, always-locked one; `closed_note`
    // carries a STATE lock so the unlocked direction is testable on one object.
    engine.registry.registerObject({
      name: 'ehr_equipment',
      fields: {
        name: { type: 'text' },
        status: { type: 'text' },
        period_days: { type: 'number' },
        next_maintenance_date: { type: 'date', readonlyWhen: 'true' },
        closed_note: { type: 'text', readonlyWhen: "record.status == 'closed'" },
      },
    } as any);
    const seed = (id: string, over: Record<string, unknown> = {}) =>
      storeFor('ehr_equipment').set(id, {
        id, name: 'Autoclave', status: 'open', period_days: 90,
        next_maintenance_date: null, closed_note: null, ...over,
      });
    seed('eq_1');

    // The recompute hook: derive `next_maintenance_date` whenever the write
    // touches the cycle. This is the write that had no server-side path.
    engine.registerHook('beforeUpdate', async (ctx: any) => {
      if (Object.prototype.hasOwnProperty.call(ctx.input.data, 'period_days')) {
        ctx.input.data.next_maintenance_date = DERIVED;
      }
    }, { object: 'ehr_equipment', priority: 50 });

    (engine as any).__seed = seed;
  });

  const eq = (id = 'eq_1') => storeFor('ehr_equipment').get(id);
  const seedRow = (id: string, over: Record<string, unknown> = {}) => (engine as any).__seed(id, over);

  // ── The report ────────────────────────────────────────────────────

  it('THE REPORT: a hook-derived value on a TRUE readonlyWhen field now LANDS', async () => {
    // Exactly the reported call: a plain by-id update of the cycle. The hook
    // derives the locked column; before the fix the strip deleted it and the row
    // kept its stale value behind an HTTP 200.
    await engine.update('ehr_equipment', { id: 'eq_1', period_days: 120 });

    expect(eq().period_days).toBe(120);
    // The regression, stated as the value it must NOT be.
    expect(eq().next_maintenance_date).not.toBeNull();
    expect(eq().next_maintenance_date).toBe(DERIVED);
  });

  it('the isSystem caller reported as equally broken lands its hook-derived value too', async () => {
    // The card measured "no caller for which the hook's value persists" —
    // plugin/cron writes with an explicit system context included. The context
    // is NOT what unlocks it (Option B was rejected); the value surviving is the
    // hook's authorship, and this pins that the two agree.
    await engine.update(
      'ehr_equipment', { id: 'eq_1', period_days: 30 },
      { context: { isSystem: true } } as any,
    );
    expect(eq().next_maintenance_date).toBe(DERIVED);
  });

  // ── The API-boundary lock, all three directions ───────────────────

  it('LOCK 1 — a caller-supplied value on a TRUE predicate is still stripped', async () => {
    // No hook overwrite (the write does not touch `period_days`), so the value
    // on the key is the caller's, and it goes. #3042 unchanged.
    await engine.update('ehr_equipment', { id: 'eq_1', name: 'B', next_maintenance_date: FORGED });
    expect(eq().name).toBe('B');
    expect(eq().next_maintenance_date).toBeNull();
    expect(warns.some((w) => w.includes("Field 'next_maintenance_date' is read-only (readonlyWhen)"))).toBe(true);
  });

  it('LOCK 2 — isSystem does NOT exempt a caller-supplied value (Option B stays rejected)', async () => {
    // The documented asymmetry with static `readonly`, deliberately preserved:
    // a state lock (#4889's paid-invoice-frozen class) must not be bypassable by
    // any system-context write.
    await engine.update(
      'ehr_equipment', { id: 'eq_1', next_maintenance_date: FORGED },
      { context: { isSystem: true } } as any,
    );
    expect(eq().next_maintenance_date).toBeNull();
  });

  it('LOCK 3 — LAUNDERING: caller sends the key AND a hook overwrites it ⇒ the HOOK value lands, never the caller value', async () => {
    // The property that makes this safe: a client cannot turn its own value into
    // a "hook-written" one. Echoing the key back does not launder it — the hook
    // overwrote it, so what persists is the server's value. The caller's forgery
    // is gone either way; only its authorship decides WHICH of the two facts
    // (stripped, or replaced) does the work.
    await engine.update('ehr_equipment', {
      id: 'eq_1', period_days: 60, next_maintenance_date: FORGED,
    });
    expect(eq().next_maintenance_date).toBe(DERIVED);
    expect(eq().next_maintenance_date).not.toBe(FORGED);
  });

  it('LOCK 3b — a hook that writes the caller value BACK is the caller value, and goes', async () => {
    // The adversarial edge of the identity test: a hook that echoes
    // `ctx.input.data.x = ctx.input.data.x` has written nothing, and `Object.is`
    // says so. Pinned because "a hook touched this key" is exactly the weaker
    // rule that WOULD open a laundering path.
    engine.registerHook('beforeUpdate', async (ctx: any) => {
      if (Object.prototype.hasOwnProperty.call(ctx.input.data, 'closed_note')) {
        ctx.input.data.closed_note = ctx.input.data.closed_note;
      }
    }, { object: 'ehr_equipment', priority: 60 });

    seedRow('eq_echo', { status: 'closed' });
    await engine.update('ehr_equipment', { id: 'eq_echo', closed_note: FORGED });
    expect(eq('eq_echo').closed_note).toBeNull();
  });

  // ── The unlocked direction is untouched ───────────────────────────

  it('an UNLOCKED predicate still writes the caller value — the predicate decides', async () => {
    // `status` is `open`, so `closed_note` is not locked and an ordinary caller
    // write lands. The fix must not turn a conditional lock into a blanket one.
    await engine.update('ehr_equipment', { id: 'eq_1', closed_note: 'ok' });
    expect(eq().closed_note).toBe('ok');
  });

  it('a STATE lock still refuses the caller once the state flips', async () => {
    seedRow('eq_closed', { status: 'closed', closed_note: 'sealed' });
    await engine.update('ehr_equipment', { id: 'eq_closed', closed_note: FORGED });
    expect(eq('eq_closed').closed_note).toBe('sealed');
  });

  // ── The bulk branch, on the same terms ────────────────────────────

  it('the BULK path lands a hook-derived value on a locked field', async () => {
    // `stripReadonlyWhenFieldsMulti` is a separate call site off the SAME entry
    // snapshot — "both call sites" is the #3106 / #4441 shape that gets missed.
    seedRow('eq_b1');
    await engine.update(
      'ehr_equipment', { period_days: 45 },
      { where: { status: 'open' }, multi: true } as any,
    );
    expect(eq('eq_b1').next_maintenance_date).toBe(DERIVED);
  });

  it('the BULK path still strips a caller forge no hook overwrote', async () => {
    seedRow('eq_b2', { name: 'bulk' });
    await engine.update(
      'ehr_equipment', { name: 'bulk2', next_maintenance_date: FORGED },
      { where: { name: 'bulk' }, multi: true } as any,
    );
    expect(eq('eq_b2').name).toBe('bulk2');
    expect(eq('eq_b2').next_maintenance_date).toBeNull();
  });

  // ── The observability seams must agree with the new verdict ───────

  it('a hook-written locked key is NOT reported to onFieldsDropped', async () => {
    // `DroppedFieldsEvent` is contracted as "dropped, and the write completed
    // WITHOUT them" (#3407). The column IS written now, so reporting it would
    // make the observability seam lie — the same correction #5591 made one strip
    // over.
    const events: any[] = [];
    await engine.update(
      'ehr_equipment', { id: 'eq_1', period_days: 15 },
      { onFieldsDropped: (e: any) => events.push(e) } as any,
    );
    expect(events).toEqual([]);
    expect(eq().next_maintenance_date).toBe(DERIVED);
  });

  it('onFieldsDropped still fires for a caller value that really is discarded', async () => {
    const events: any[] = [];
    await engine.update(
      'ehr_equipment', { id: 'eq_1', name: 'B', next_maintenance_date: FORGED },
      { onFieldsDropped: (e: any) => events.push(e) } as any,
    );
    expect(events).toEqual([
      { object: 'ehr_equipment', fields: ['next_maintenance_date'], reason: 'readonly_when' },
    ]);
  });

  it('strictReadonlyWrites refuses the caller forge and admits the hook write', async () => {
    // #5126 refuses rather than committing without the stripped columns. A
    // hook-written key is not stripped, so a strict caller has nothing to be
    // refused for — its contract is about columns that would be MISSING.
    await expect(engine.update(
      'ehr_equipment', { id: 'eq_1', next_maintenance_date: FORGED },
      { strictReadonlyWrites: true } as any,
    )).rejects.toThrow(/readonlyWhen/);

    await engine.update(
      'ehr_equipment', { id: 'eq_1', period_days: 75 },
      { strictReadonlyWrites: true } as any,
    );
    expect(eq().next_maintenance_date).toBe(DERIVED);
  });

  it('a hook can still SEE the caller-submitted locked value', async () => {
    // Why the fix compares values instead of stripping ahead of the hooks: a
    // `beforeUpdate` guard that reports on what the caller submitted reads
    // `ctx.input.data`, and stripping first would silently empty that out.
    const seen: unknown[] = [];
    engine.registerHook('beforeUpdate', async (ctx: any) => {
      seen.push(Object.keys(ctx.input.data));
    }, { object: 'ehr_equipment', priority: 1 });

    await engine.update('ehr_equipment', { id: 'eq_1', name: 'B', next_maintenance_date: FORGED });
    expect(seen).toEqual([['id', 'name', 'next_maintenance_date']]);
  });
});
