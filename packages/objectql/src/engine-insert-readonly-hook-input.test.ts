// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #22306 — INSERT side of #16344: a caller-supplied value the create-side
// strips will take must not be visible to `beforeInsert`.
//
// Measured before the fix, on a REAL engine over `driver-sql` (better-sqlite3),
// non-system context, the hotcrm shape — a `beforeInsert` hook that stamps a
// read-only column only when it is absent:
//
//   insert { stage_entry_date: '2020-01-01' } -> hook saw '2020-01-01', stood down
//     stored: stage_entry_date NULL, days_in_stage NULL
//   insert { }                                -> hook stamped
//     stored: stage_entry_date '2026-10-09', days_in_stage 0
//
// The strip worked — the caller's value is not stored. What leaked was the HOOK
// INPUT: the hook decided on a value the engine had already decided to drop.
// The invariant pinned here is #16344's ruling, applied to the create:
// 「交给生命周期钩子的记录,就是它打算持久化的那条记录。」
//
// What this suite is NOT: a relaxation of #14147 / #14259. The enforcement pass
// did not move (still after the hooks), a hook's own write to a read-only column
// still lands, and the strip still reports, warns and refuses on what it takes —
// those controls are pinned beside the fix so the verdicts are read together.

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectQL } from './engine.js';
import { HookWithheldReadonlyFaultError } from './hook-withheld-readonly-fault.js';

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
    // `supports: {}` — no native autonumber, so the ENGINE issues the sequence
    // value in `applyAutonumbers`.
    name: 'memory', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find(object: string, ast: any) {
      const rows = Array.from(storeFor(object).values()).filter((r) => matches(r, ast?.where));
      // The caller's bound, applied AFTER the filter and by PRESENCE
      // (`check:objectql-double-limit`).
      return typeof ast?.limit === 'number' ? rows.slice(0, ast.limit) : rows;
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

const STAMP = '2026-10-09';
const FORGED = '2020-01-01';
const USER = { context: { userId: 'u_rep' } } as any;

/** What the probe `beforeInsert` hook observed on `ctx.input.data`, per call. */
type Sighting = Record<string, { present: boolean; value: unknown }>;

describe('#22306 — caller-supplied readonly values are withheld from beforeInsert', () => {
  let engine: ObjectQL;
  let storeFor: ReturnType<typeof makeDriver>['storeFor'];
  let sightings: Sighting[];
  let warns: string[];

  const PROBED = ['note', 'stage_entry_date', 'approval_status', 'code', 'created_at', 'closed_at'];

  beforeEach(async () => {
    warns = [];
    sightings = [];
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

    // The reported object (hotcrm `crm_opportunity`), trimmed to what the repro
    // turns on, plus one field per withheld kind and one writable control.
    engine.registry.registerObject({
      name: 'crm_opp',
      fields: {
        name: { type: 'text' },
        note: { type: 'text' },
        stage_entry_date: { type: 'date', readonly: true },
        days_in_stage: { type: 'number', readonly: true },
        approval_status: { type: 'text', readonly: true, defaultValue: 'draft' },
        meta: { type: 'json', readonly: true },
        closed_at: { type: 'datetime', readonly: true },
        code: { type: 'autonumber' },
      },
    } as any);

    // ── The probe, and its control in the same hook ────────────────────────
    // `note` is writable and every insert below carries it: if `note` is seen
    // and a read-only key is not, the hide provably ran first. If NEITHER is
    // seen the probe is broken and the reading is void.
    engine.registerHook('beforeInsert', async (ctx: any) => {
      const data = (ctx.input?.data ?? {}) as Record<string, unknown>;
      const s: Sighting = {};
      for (const k of PROBED) {
        s[k] = { present: Object.prototype.hasOwnProperty.call(data, k), value: data[k] };
      }
      sightings.push(s);
    }, { object: 'crm_opp', priority: 5 });

    // hotcrm's `opportunity.hook.ts` shape: stamp only when absent.
    engine.registerHook('beforeInsert', async (ctx: any) => {
      const data = ctx.input.data as Record<string, any>;
      if (!data.stage_entry_date) {
        data.stage_entry_date = STAMP;
        data.days_in_stage = 0;
      }
    }, { object: 'crm_opp', priority: 50 });
  });

  const stored = (id: string) => storeFor('crm_opp').get(id);

  it('ORDERING: the hook does not see a caller-supplied readonly value, and DOES see the writable one', async () => {
    await engine.insert('crm_opp', { name: 'A', note: 'w', stage_entry_date: FORGED }, USER);

    expect(sightings).toHaveLength(1);
    // CONTROL leg — the probe can observe the payload at all.
    expect(sightings[0]!.note).toEqual({ present: true, value: 'w' });
    // MEASUREMENT leg — withheld before the dispatch.
    expect(sightings[0]!.stage_entry_date).toEqual({ present: false, value: undefined });
  });

  it('THE REPORT (hotcrm shape): a caller-supplied readonly key no longer stops the hook from stamping', async () => {
    const forged: any = await engine.insert('crm_opp', { name: 'A', note: 'w', stage_entry_date: FORGED }, USER);
    const plain: any = await engine.insert('crm_opp', { name: 'B', note: 'w' }, USER);

    // Baseline — the key absent: the hook stamps.
    expect(stored(plain.id).stage_entry_date).toBe(STAMP);
    expect(stored(plain.id).days_in_stage).toBe(0);
    // The reported request stores exactly what the baseline stores. Before the
    // fix it stored NULL in both columns: the hook stood down on '2020-01-01'
    // and the strip then took '2020-01-01'.
    expect(stored(forged.id).stage_entry_date).toBe(STAMP);
    expect(stored(forged.id).days_in_stage).toBe(0);
  });

  it('a withheld key with a defaultValue is SHOWN its default — the hook cannot tell a forging caller from an honest one', async () => {
    await engine.insert('crm_opp', { name: 'A', note: 'w', approval_status: 'approved' }, USER);
    await engine.insert('crm_opp', { name: 'B', note: 'w' }, USER);

    expect(sightings).toHaveLength(2);
    expect(sightings[1]!.approval_status).toEqual({ present: true, value: 'draft' });
    expect(sightings[0]!.approval_status).toEqual(sightings[1]!.approval_status);
    // And the store holds the default the strip re-derives, as before.
    const rows = [...storeFor('crm_opp').values()];
    expect(rows.map((r) => r.approval_status)).toEqual(['draft', 'draft']);
  });

  it('a caller-supplied runtime-owned value (autonumber) is withheld too, and the sequence still issues the number', async () => {
    const rec: any = await engine.insert('crm_opp', { name: 'A', note: 'w', code: 'OPP-FORGED' }, USER);

    expect(sightings[0]!.note.present).toBe(true);
    expect(sightings[0]!.code).toEqual({ present: false, value: undefined });
    expect(stored(rec.id).code).not.toBe('OPP-FORGED');
    expect(stored(rec.id).code).toBeTruthy();
  });

  it('CONTROL — a system writer is exempt from the strip, so its readonly value is shown to the hook and stored', async () => {
    const rec: any = await engine.insert(
      'crm_opp', { name: 'A', note: 'w', stage_entry_date: FORGED }, { context: { isSystem: true } } as any,
    );

    expect(sightings[0]!.stage_entry_date).toEqual({ present: true, value: FORGED });
    expect(stored(rec.id).stage_entry_date).toBe(FORGED);
    // The hook stood down on a value that WAS stored — the correct reading.
    expect(stored(rec.id).days_in_stage).toBeUndefined();
  });

  it('CONTROL — the strip still takes, warns and reports what no hook wrote; a hook-written key is not reported', async () => {
    const drops: any[] = [];
    const rec: any = await engine.insert(
      'crm_opp',
      { name: 'A', note: 'w', stage_entry_date: FORGED, approval_status: 'approved' },
      { ...USER, onFieldsDropped: (e: any) => drops.push(e) },
    );

    // `approval_status`: withheld, handed back untouched, then taken and
    // re-defaulted by the strip exactly as before the hide existed.
    expect(stored(rec.id).approval_status).toBe('draft');
    expect(drops).toEqual([{ object: 'crm_opp', fields: ['approval_status'], reason: 'readonly' }]);
    expect(warns.some((w) => w.includes('approval_status'))).toBe(true);
    // `stage_entry_date`: the hook ASSIGNED it, so it is the hook's write.
    expect(stored(rec.id).stage_entry_date).toBe(STAMP);
  });

  it('CONTROL — `strictReadonlyWrites` still refuses a forgery no hook overwrote, before any driver write', async () => {
    const before = storeFor('crm_opp').size;
    const err: any = await engine
      .insert('crm_opp', { name: 'A', note: 'w', approval_status: 'approved' }, { ...USER, strictReadonlyWrites: true })
      .catch((e) => e);

    expect(err?.code).toBe('ERR_READONLY_FIELD_REJECTED');
    expect(err?.fields).toEqual(['approval_status']);
    expect(storeFor('crm_opp').size).toBe(before);
  });

  it('a self-assignment of a withheld key (`data.x = data.x`) is a no-op: the caller value is stripped and reported, never stored as `undefined`', async () => {
    engine.registerHook('beforeInsert', async (ctx: any) => {
      const data = ctx.input.data as Record<string, any>;
      data.closed_at = data.closed_at;
    }, { object: 'crm_opp', priority: 60 });
    const drops: any[] = [];

    const rec: any = await engine.insert(
      'crm_opp', { name: 'A', note: 'w', closed_at: '2021-01-01T00:00:00.000Z' },
      { ...USER, onFieldsDropped: (e: any) => drops.push(e) },
    );

    expect(Object.prototype.hasOwnProperty.call(stored(rec.id), 'closed_at')).toBe(false);
    expect(drops).toEqual([{ object: 'crm_opp', fields: ['closed_at'], reason: 'readonly' }]);
  });

  it('BATCH: each row is withheld on its own, so a forging row and a plain row both get the stamp', async () => {
    const recs: any[] = await engine.insert(
      'crm_opp', [{ name: 'A', note: 'w', stage_entry_date: FORGED }, { name: 'B', note: 'w' }], USER,
    );

    expect(sightings.map((s) => s.stage_entry_date.present)).toEqual([false, false]);
    expect(recs.map((r) => stored(r.id).stage_entry_date)).toEqual([STAMP, STAMP]);
  });

  it('insertMany (partial-success batch) follows the same order', async () => {
    const outcomes: any[] = await engine.insertMany(
      'crm_opp', [{ name: 'A', note: 'w', stage_entry_date: FORGED }, { name: 'B', note: 'w' }], USER,
    );

    expect(outcomes.every((o) => o.ok)).toBe(true);
    expect(sightings.map((s) => s.stage_entry_date.present)).toEqual([false, false]);
    expect(outcomes.map((o) => stored(o.record.id).stage_entry_date)).toEqual([STAMP, STAMP]);
  });

  it('preserveAudit: the audit timeline stays visible (the binder reinstates it), a business readonly column is still withheld', async () => {
    engine.registry.registerObject({
      name: 'crm_case',
      fields: {
        note: { type: 'text' },
        created_at: { type: 'datetime', readonly: true, system: true },
        closed_at: { type: 'datetime', readonly: true },
      },
    } as any);
    engine.registerHook('beforeInsert', async (ctx: any) => {
      const data = (ctx.input?.data ?? {}) as Record<string, unknown>;
      const s: Sighting = {};
      for (const k of PROBED) s[k] = { present: Object.prototype.hasOwnProperty.call(data, k), value: data[k] };
      sightings.push(s);
    }, { object: 'crm_case', priority: 5 });
    const AT = '2021-03-01T09:00:00.000Z';

    await engine.insert('crm_case', { note: 'w', created_at: AT, closed_at: AT }, { context: { userId: 'u', preserveAudit: true } } as any);
    await engine.insert('crm_case', { note: 'w', created_at: AT, closed_at: AT }, USER);

    // Historical import: `created_at` is shown — the audit binder's
    // `preserveAudit` branch reads it there to reinstate it.
    expect(sightings[0]!.created_at).toEqual({ present: true, value: AT });
    expect(sightings[0]!.closed_at.present).toBe(false);
    // Ordinary create: both withheld.
    expect(sightings[1]!.created_at.present).toBe(false);
    expect(sightings[1]!.closed_at.present).toBe(false);
    expect(sightings.every((s) => s.note.present)).toBe(true);
  });

  it('a hook that faults reaching THROUGH a withheld key is told which key was withheld, as a 400', async () => {
    engine.registerHook('beforeInsert', async (ctx: any) => {
      (ctx.input.data.meta as any).who = 'hook';
    }, { object: 'crm_opp', priority: 60 });

    const err: any = await engine
      .insert('crm_opp', { name: 'A', note: 'w', meta: { who: 'caller' } }, USER)
      .catch((e) => e);

    expect(err).toBeInstanceOf(HookWithheldReadonlyFaultError);
    expect(err.status).toBe(400);
    expect(err.withheldKeys).toEqual(['meta']);
    expect(err.cause).toBeInstanceOf(TypeError);
  });

  it('CONTROL — update is unchanged: beforeUpdate is still shown the persist image and a hook stamp still lands', async () => {
    const rec: any = await engine.insert('crm_opp', { name: 'A', note: 'w' }, USER);
    const seen: Array<{ present: boolean }> = [];
    engine.registerHook('beforeUpdate', async (ctx: any) => {
      seen.push({ present: Object.prototype.hasOwnProperty.call(ctx.input.data, 'closed_at') });
      ctx.input.data.days_in_stage = 7;
    }, { object: 'crm_opp' });

    await engine.update('crm_opp', { id: rec.id, note: 'x', closed_at: '2021-01-01T00:00:00.000Z' }, USER);

    expect(seen).toEqual([{ present: false }]);
    expect(stored(rec.id).note).toBe('x');
    expect(stored(rec.id).days_in_stage).toBe(7);
    expect(stored(rec.id).closed_at).toBeUndefined();
  });
});
