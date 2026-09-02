// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #14259 — the two SIBLING seams of the strip #14088 repaired must decide
// hook-vs-caller by the same RECORD, not by `Object.is`.
//
// #14088 replaced `Object.is(payload[k], supplied[k])` inside
// `stripReadonlyFields` with a recording of the keys the before-phase hook
// chain actually assigned (`recordHookPayloadWrites`). Its argument was never
// about `null`: value equality cannot separate
//
//   - the hook deliberately wrote the value the caller also sent, from
//   - the hook never touched the key at all,
//
// and the two demand opposite verdicts. Two functions in the same file were
// left on the comparison that argument retired, and this suite pins both:
//
//  1. `isCallerSuppliedValue` — the shared predicate behind
//     `stripReadonlyWhenFields` and `stripReadonlyWhenFieldsMulti`, whose own
//     docblock says it is written to be textually parallel with the test inside
//     `stripReadonlyFields` so the two "can never disagree about what
//     caller-supplied means". Between #14088 and this, they did.
//  2. `stripRuntimeOwnedFields` — the INSERT-side twin. #6339's own prose is
//     the finding: it argued a key SET made the contract true "only BY
//     ACCIDENT" and moved to values, which is accidental in the identical way.
//
// ⛔ WHAT THIS SUITE IS NOT, and is written to fail if anyone reads it that
// way: it is NOT a relaxation of #3042 / #4889 / #5503, and it is NOT a `null`
// case. The DISCRIMINATOR PAIRS are the deliverable's proof — the same caller
// payload, byte for byte, on the same locked key, reaching OPPOSITE verdicts
// depending on whether a hook assigned it. A caller-supplied value that no hook
// wrote is still stripped, still warns with the same text, and still reports
// through `onFieldsDropped` / `strictReadonlyWrites`. That is what value
// equality cannot deliver and a record can.
//
// ⛔ And the forgery boundary is inherited unchanged: A CALLER-SUPPLIED VALUE
// MUST NEVER BECOME HOOK-OWNED. The insert-side recording this card arms is new
// (the update path's already existed), so it owes the same three properties,
// and they are pinned below: armed after the caller's payload has arrived,
// sealed before any engine-owned pass touches it, and recording that an
// assignment ran rather than anything about the payload's contents.

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
      const out = [];
      for (const r of rows) out.push(await this.create(object, r, undefined));
      return out;
    },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() { return { __trx: true, commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, storeFor };
}

const makeLogger = (sink: string[]) => {
  const logger: any = {
    warn: (m: string) => sink.push(String(m)),
    debug() {}, info() {}, error() {}, trace() {}, fatal() {},
    child() { return logger; },
  };
  return logger;
};

// ─────────────────────────────────────────────────────────────────────────────
// SEAM 1 — `readonlyWhen`, UPDATE path
// ─────────────────────────────────────────────────────────────────────────────

/** What the recompute hook derives. A client mirroring the formula sends this. */
const DERIVED = '2026-11-14';
/** What sits on the stored row before the write — the value a lost hook write leaves behind. */
const STALE = '2026-01-01';
/** What a caller forges. Never allowed to reach the row on a locked field. */
const FORGED = '1999-01-01';
/** A fault instant already on the stored row — the `null` collision's stale residue. */
const FAULT_AT = '2026-08-01T09:00:00.000Z';

describe('seam 1 — the readonlyWhen strips read PROVENANCE, not value equality (#14259)', () => {
  let engine: ObjectQL;
  let storeFor: ReturnType<typeof makeDriver>['storeFor'];
  let warns: string[];

  beforeEach(async () => {
    warns = [];
    engine = new ObjectQL({ logger: makeLogger(warns) });
    const d = makeDriver();
    storeFor = d.storeFor;
    engine.registerDriver(d.driver, true);
    await engine.init();

    // The #9107 downstream object, trimmed to the fields this card turns on.
    // Three ALWAYS-locked columns so the collision can be shown on a string, on
    // `null` and on `0` — proof the repair is provenance and not a sentinel —
    // plus one STATE lock for the #4889 direction.
    engine.registry.registerObject({
      name: 'prov_equipment',
      fields: {
        name: { type: 'text' },
        status: { type: 'text' },
        period_days: { type: 'number' },
        next_maintenance_date: { type: 'date', readonlyWhen: 'true' },
        last_fault_at: { type: 'datetime', readonlyWhen: 'true' },
        overdue_days: { type: 'number', readonlyWhen: 'true' },
        closed_note: { type: 'text', readonlyWhen: "record.status == 'closed'" },
      },
      // `packageId` is REQUIRED and passed on purpose: omitting it is what the
      // TEST_DEBT ledger counts in this package, and a new test file may not
      // add to a shrink-only ratchet.
    } as any, 'test');

    // The recompute hook, exactly #9107's shape: derive the locked columns
    // whenever the write touches the cycle. It CLEARS the fault instant and
    // ZEROES the overdue counter in the same pass, which is where the `null`
    // and `0` collisions live.
    engine.registerHook('beforeUpdate', async (ctx: any) => {
      if (!Object.prototype.hasOwnProperty.call(ctx.input.data, 'period_days')) return;
      ctx.input.data.next_maintenance_date = DERIVED;
      ctx.input.data.last_fault_at = null;
      ctx.input.data.overdue_days = 0;
    }, { object: 'prov_equipment', priority: 50 });
  });

  const seed = (id: string, over: Record<string, unknown> = {}) =>
    storeFor('prov_equipment').set(id, {
      id, name: 'Autoclave', status: 'open', period_days: 90,
      next_maintenance_date: STALE, last_fault_at: FAULT_AT, overdue_days: 7,
      closed_note: null, ...over,
    });
  const eq = (id: string) => storeFor('prov_equipment').get(id);

  // ── THE DEFECT ────────────────────────────────────────────────────────────

  it('THE DEFECT: a hook write the caller ECHOED now LANDS on a TRUE readonlyWhen field', async () => {
    // The card's reproduction shape. A thick client (or a retried submit)
    // mirrors the server's formula and sends the same date the hook is about to
    // derive. `Object.is(DERIVED, DERIVED)` is true, so the pre-#14259 predicate
    // read the hook's deliberate write as "the hook never touched the key",
    // deleted it, and committed the new cycle beside the OLD maintenance date —
    // the duplicate-plans loop #9107 measured, reopened on one input.
    seed('eq_1');

    await engine.update('prov_equipment', {
      id: 'eq_1', period_days: 120, next_maintenance_date: DERIVED,
    });

    expect(eq('eq_1').period_days).toBe(120);
    // The regression, stated as the value it must NOT be.
    expect(eq('eq_1').next_maintenance_date).not.toBe(STALE);
    expect(eq('eq_1').next_maintenance_date).toBe(DERIVED);
    // The write landed, so nothing was dropped and nothing may be logged.
    expect(warns).toEqual([]);
  });

  it('the same collision on `null` — the `Object.is(null, null)` case the file names', async () => {
    // The hook CLEARS the fault instant; the caller's form round-trip submits
    // the disabled input as `null`. Identical bytes on the key, and the stored
    // row keeps a stale fault timestamp beside a freshly serviced machine.
    seed('eq_2');

    await engine.update('prov_equipment', {
      id: 'eq_2', period_days: 120, last_fault_at: null,
    });

    expect(eq('eq_2').last_fault_at).not.toBe(FAULT_AT);
    expect(eq('eq_2').last_fault_at).toBeNull();
  });

  it('the same collision on `0` — so the repair cannot be a `null` sentinel', async () => {
    // `Object.is(0, 0)` is true for exactly the reason `Object.is(null, null)`
    // is. A fix that reads `null` specially leaves this one corrupt. (A plain
    // `0`, never `-0`: `Object.is` separates those two, and leaning on that
    // would be the same accident a third time.)
    seed('eq_3');

    await engine.update('prov_equipment', {
      id: 'eq_3', period_days: 120, overdue_days: 0,
    });

    expect(eq('eq_3').overdue_days).toBe(0);
  });

  // ── ⛔ THE NEGATIVE CONTROL — the deliverable's proof ──────────────────────

  it('⛔ NEGATIVE CONTROL: the IDENTICAL caller payload with NO hook write is still STRIPPED', async () => {
    // The one case that separates "provenance" from "stopped locking". The key
    // and the value are byte-identical to THE DEFECT above —
    // `next_maintenance_date: DERIVED` — but the payload omits `period_days`,
    // so the hook returns without assigning and nobody authorised the write.
    // The stored value must survive and the caller must be told.
    seed('eq_4');

    await engine.update('prov_equipment', {
      id: 'eq_4', name: 'Renamed', next_maintenance_date: DERIVED,
    });

    expect(eq('eq_4').name).toBe('Renamed');
    expect(eq('eq_4').next_maintenance_date).toBe(STALE);
    // The same warning text as before this card — the strip's documented line.
    expect(warns.some((w) =>
      w.includes("Field 'next_maintenance_date' is read-only (readonlyWhen) — ignoring incoming change"),
    )).toBe(true);
  });

  it('⛔ NEGATIVE CONTROL on `null`: an unauthorised clear is still stripped', async () => {
    seed('eq_5');
    await engine.update('prov_equipment', { id: 'eq_5', name: 'R', last_fault_at: null });
    expect(eq('eq_5').last_fault_at).toBe(FAULT_AT);
    expect(warns.some((w) => w.includes("Field 'last_fault_at' is read-only (readonlyWhen)"))).toBe(true);
  });

  it('⛔ NEGATIVE CONTROL: the drop still reaches onFieldsDropped as readonly_when', async () => {
    seed('eq_6');
    const events: any[] = [];

    await engine.update(
      'prov_equipment',
      { id: 'eq_6', next_maintenance_date: DERIVED },
      { onFieldsDropped: (e: any) => events.push(e) } as any,
    );

    expect(events.some((e) => e.reason === 'readonly_when' && e.fields.includes('next_maintenance_date'))).toBe(true);
    expect(eq('eq_6').next_maintenance_date).toBe(STALE);
  });

  it('⛔ NEGATIVE CONTROL: strictReadonlyWrites still REFUSES the unauthorised write', async () => {
    seed('eq_7');
    let refused: any;

    await engine.update(
      'prov_equipment',
      { id: 'eq_7', next_maintenance_date: DERIVED },
      { strictReadonlyWrites: true } as any,
    ).catch((e: unknown) => { refused = e; });

    // The refusal ENVELOPE, not merely "it threw": a bare `toThrow()` would
    // stay green against any unrelated failure on this path.
    // ⚠️ `ReadonlyFieldRejectedError` carries `code` and `name` only — it has no
    // `status` member (the HTTP mapping lives at the protocol layer), so
    // asserting one here would pin a property this class does not have.
    expect(refused).toBeDefined();
    expect(refused.name).toBe('ReadonlyFieldRejectedError');
    expect(refused.code).toBe('ERR_READONLY_FIELD_REJECTED');
    expect(refused.fields).toContain('next_maintenance_date');
    // And nothing was written.
    expect(eq('eq_7').next_maintenance_date).toBe(STALE);
  });

  it('⛔ a hook that runs but writes some OTHER key confers nothing on this one', async () => {
    // Provenance is per KEY, never "a hook ran on this write".
    engine.registerHook('beforeUpdate', async (ctx: any) => {
      ctx.input.data.name = 'rewritten-by-hook';
    }, { object: 'prov_equipment', priority: 60 });
    seed('eq_8');

    await engine.update('prov_equipment', { id: 'eq_8', next_maintenance_date: FORGED });

    expect(eq('eq_8').name).toBe('rewritten-by-hook');
    expect(eq('eq_8').next_maintenance_date).toBe(STALE);
  });

  // ── The #4889 lock: provenance leaves CALLER writes exactly where they were ─

  it('#4889 UNCHANGED: a caller value on a TRUE STATE predicate is still stripped', async () => {
    // The frozen-record class the triage ruling names. No hook assigns
    // `closed_note`, so no record exempts it, and the state lock holds.
    seed('eq_9', { status: 'closed' });

    await engine.update('prov_equipment', { id: 'eq_9', closed_note: 'caller note' });

    expect(eq('eq_9').closed_note).toBeNull();
    expect(warns.some((w) => w.includes("Field 'closed_note' is read-only (readonlyWhen)"))).toBe(true);
  });

  it('#4889 UNCHANGED: isSystem still does NOT exempt a caller value (Option B stays rejected)', async () => {
    seed('eq_10', { status: 'closed' });
    await engine.update(
      'prov_equipment', { id: 'eq_10', closed_note: 'caller note' },
      { context: { isSystem: true } } as any,
    );
    expect(eq('eq_10').closed_note).toBeNull();
  });

  it("what persists is always the HOOK's value, never the caller's", async () => {
    // The forgery boundary read as an outcome: a caller cannot launder its own
    // value through the hook phase, because the hook's assignment is what stands
    // on the key afterwards.
    seed('eq_11');

    await engine.update('prov_equipment', {
      id: 'eq_11', period_days: 120, next_maintenance_date: FORGED,
    });

    expect(eq('eq_11').next_maintenance_date).not.toBe(FORGED);
    expect(eq('eq_11').next_maintenance_date).toBe(DERIVED);
  });

  it('MEASURED-UNCHANGED: a hook writing a DIFFERENT value than the caller behaves as before', async () => {
    // Pinned because the card asks for today's behaviour on this input to be
    // measured before it moves — and it must NOT move. Pre-#14259 the value
    // test already answered "not the caller's" here (`Object.is(DERIVED,
    // FORGED)` is false) and kept the hook's write; under provenance the record
    // answers the same way for a different reason. Same verdict, both routes,
    // which is what makes the record a strictly narrower gate than the
    // comparison it fronts.
    seed('eq_12');
    await engine.update('prov_equipment', {
      id: 'eq_12', period_days: 120, next_maintenance_date: FORGED,
    });
    expect(eq('eq_12').next_maintenance_date).toBe(DERIVED);
    expect(warns).toEqual([]);
  });

  // ── The BULK branch reaches the same verdict off the SAME sealed record ────

  it('MULTI: the echoed hook write lands on the predicate branch too', async () => {
    seed('eq_20', { status: 'active' });
    seed('eq_21', { status: 'active' });

    await engine.update(
      'prov_equipment',
      { period_days: 120, next_maintenance_date: DERIVED },
      { where: { status: 'active' }, multi: true } as any,
    );

    expect(eq('eq_20').next_maintenance_date).toBe(DERIVED);
    expect(eq('eq_21').next_maintenance_date).toBe(DERIVED);
  });

  it('⛔ MULTI NEGATIVE CONTROL: the identical payload with no hook write is still stripped', async () => {
    // #3106 / #4441 "both call sites": a bulk write must not reach a different
    // verdict about who wrote a key than a by-id write does — in EITHER
    // direction. This is the by-id negative control, run through
    // `stripReadonlyWhenFieldsMulti`.
    seed('eq_22', { status: 'active' });

    await engine.update(
      'prov_equipment',
      { name: 'Renamed', next_maintenance_date: DERIVED },
      { where: { status: 'active' }, multi: true } as any,
    );

    expect(eq('eq_22').name).toBe('Renamed');
    expect(eq('eq_22').next_maintenance_date).toBe(STALE);
    expect(warns.some((w) => w.includes("Field 'next_maintenance_date' is read-only (readonlyWhen) in ≥1 matched row"))).toBe(true);
  });

  it('a hook that REPLACES ctx.input.data falls back to the value test, not to "keep everything"', async () => {
    // The recorder's KNOWN LIMIT, inherited: a replacement's keys are mostly
    // the CALLER's, so reading them as hook-owned would launder a forgery. With
    // no attributable record the strip must behave exactly as it did before
    // this card — i.e. over-strip. Fail-safe means "keep the old bug".
    engine.registerHook('beforeUpdate', async (ctx: any) => {
      ctx.input.data = { ...ctx.input.data, next_maintenance_date: DERIVED };
    }, { object: 'prov_equipment', priority: 60 });
    seed('eq_23');

    await engine.update('prov_equipment', {
      id: 'eq_23', name: 'R', next_maintenance_date: DERIVED,
    });

    expect(eq('eq_23').name).toBe('R');
    expect(eq('eq_23').next_maintenance_date).toBe(STALE);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SEAM 2 — runtime-owned (`autonumber`), INSERT path
// ─────────────────────────────────────────────────────────────────────────────

describe('seam 2 — the insert-side runtime-owned strip reads PROVENANCE (#14259)', () => {
  let engine: ObjectQL;
  let storeFor: ReturnType<typeof makeDriver>['storeFor'];
  let warns: string[];
  let hookSaw: Array<Record<string, unknown>>;

  beforeEach(async () => {
    warns = [];
    hookSaw = [];
    engine = new ObjectQL({ logger: makeLogger(warns) });
    const d = makeDriver();
    storeFor = d.storeFor;
    engine.registerDriver(d.driver, true);
    await engine.init();

    engine.registry.registerObject({
      name: 'prov_ticket',
      fields: { title: { type: 'text' }, code: { type: 'autonumber' } },
    } as any, 'test');

    // #6339's own hook, unchanged: a `beforeInsert` that OWNS the record number
    // — it re-issues or normalises it rather than letting the sequence decide.
    // `title: 'no-hook'` short-circuits it, which is how a test tells "the hook
    // did not fire" from "the hook fired and lost".
    engine.registerHook('beforeInsert', async (ctx: any) => {
      hookSaw.push({ ...(ctx.input.data as Record<string, unknown>) });
      if (ctx.input.data.title === 'no-hook') return;
      ctx.input.data.code = `HOOK-${String(ctx.input.data.title)}`;
    }, { object: 'prov_ticket', priority: 50 });
  });

  // ── THE DEFECT ────────────────────────────────────────────────────────────

  it('THE DEFECT: a hook write the caller ECHOED now LANDS on a runtime-owned field', async () => {
    // The whole-record POST: read a record, edit a field, submit everything
    // back — so the payload necessarily echoes the record-number column it just
    // read, and the hook re-issues the SAME number (an idempotent normalise, or
    // a retried submit). `Object.is('HOOK-B', 'HOOK-B')` is true, so the
    // pre-#14259 strip deleted the hook's deliberate write and the sequence
    // value went to the database instead.
    const row: any = await engine.insert('prov_ticket', { title: 'B', code: 'HOOK-B' });

    // The regression, stated as the value it must NOT be. The sequence renders
    // through the contract default `{0000}` since #6555 / #7262.
    expect(row.code).not.toBe('0001');
    expect(row.code).toBe('HOOK-B');
    expect(warns).toEqual([]);
  });

  it('the echoing caller and the omitting caller now AGREE — the difference was the accident', async () => {
    // #6339's own proof shape, re-run on the input its fix could not see. The
    // two calls differ in nothing but whether the caller's payload happened to
    // carry the value the hook was going to write.
    const omitted: any = await engine.insert('prov_ticket', { title: 'X' });
    const echoed: any = await engine.insert('prov_ticket', { title: 'X', code: 'HOOK-X' });
    expect(omitted.code).toBe(echoed.code);
    expect(echoed.code).toBe('HOOK-X');
  });

  // ── ⛔ THE NEGATIVE CONTROL — the deliverable's proof ──────────────────────

  it('⛔ NEGATIVE CONTROL: the IDENTICAL caller payload with NO hook write is still STRIPPED', async () => {
    // `title: 'no-hook'` makes the hook return without assigning, so the value
    // standing on `code` is the caller's seed and #5503 takes it. Byte-identical
    // key and value shape to THE DEFECT above; opposite verdict.
    const row: any = await engine.insert('prov_ticket', { title: 'no-hook', code: 'HOOK-no-hook' });

    expect(row.code).not.toBe('HOOK-no-hook');
    expect(row.code).toBe('0001');
    // The same warning text as before this card — contract of the text, not its
    // wording, per #5503's own pin discipline.
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain("Field 'code' on 'prov_ticket'");
    expect(warns[0]).toContain('runtime-owned');
    expect(warns[0]).toContain('COMMITTED WITHOUT IT');
    expect(warns[0]).toContain('hook-written keys are not caller-supplied');
  });

  it('⛔ NEGATIVE CONTROL: the drop still reaches onFieldsDropped as readonly', async () => {
    const events: any[] = [];
    await engine.insert(
      'prov_ticket',
      { title: 'no-hook', code: 'CALLER-SEEDED' },
      { onFieldsDropped: (e: any) => events.push(e) } as any,
    );
    expect(events.some((e) => e.reason === 'readonly' && e.fields.includes('code'))).toBe(true);
  });

  it('⛔ NEGATIVE CONTROL: strictReadonlyWrites still REFUSES the unauthorised seed', async () => {
    let refused: any;
    await engine.insert(
      'prov_ticket',
      { title: 'no-hook', code: 'CALLER-SEEDED' },
      { strictReadonlyWrites: true } as any,
    ).catch((e: unknown) => { refused = e; });

    // The refusal ENVELOPE, not merely "it threw" (see the seam 1 twin for why
    // `status` is not asserted: this class carries `code` and `name` only).
    expect(refused).toBeDefined();
    expect(refused.name).toBe('ReadonlyFieldRejectedError');
    expect(refused.code).toBe('ERR_READONLY_FIELD_REJECTED');
    expect(refused.fields).toContain('code');
    expect(refused.operation).toBe('insert');
    // Refused BEFORE any driver dispatch.
    expect(storeFor('prov_ticket').size).toBe(0);
  });

  it('⛔ a hook that runs but writes some OTHER key confers nothing on `code`', async () => {
    engine.registerHook('beforeInsert', async (ctx: any) => {
      ctx.input.data.title = `${String(ctx.input.data.title)}!`;
    }, { object: 'prov_ticket', priority: 60 });

    const row: any = await engine.insert('prov_ticket', { title: 'no-hook', code: 'CALLER-SEEDED' });

    expect(row.title).toBe('no-hook!');
    expect(row.code).toBe('0001');
  });

  // ── PER ROW, never per call ───────────────────────────────────────────────

  it('a BATCH records per ROW: a hook stamping row 0 does not exempt row 1', async () => {
    // The property a single shared recording would break, and the reason the
    // insert path arms one recorder per row rather than one per call.
    const rows: any = await engine.insert('prov_ticket', [
      { title: 'A', code: 'HOOK-A' },
      { title: 'no-hook', code: 'HOOK-A' },
    ] as any);

    expect(rows[0].code).toBe('HOOK-A');
    // Row 1's hook returned without assigning, so its caller seed is stripped
    // and the sequence issues the number — even though the value is the very
    // one row 0's hook legitimately wrote.
    expect(rows[1].code).not.toBe('HOOK-A');
    // `0001`, not `0002`: `applyAutonumbers` fills only an EMPTY slot, and row
    // 0 kept its hook-written code, so row 1 is the batch's first draw. Pinned
    // at the measured value rather than at the row index — reading the counter
    // as "one per row" would be a guess this very fix makes wrong.
    expect(rows[1].code).toBe('0001');
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain("Field 'code' on 'prov_ticket'");
  });

  // ── The forgery boundary the NEW recording owes (card, verbatim) ───────────

  it('FORGERY BOUNDARY: the recording is armed AFTER the caller payload arrives', async () => {
    // "armed after the caller's payload has arrived": the hook sees the caller's
    // own keys and values, and the caller's object is not the recorded one — so
    // nothing the caller sent is in the record and the strip still judges
    // against what the caller actually sent (`suppliedPerRow`, an explicit
    // shallow copy taken ahead of the hooks, #6339's P3 invariant).
    const payload: Record<string, unknown> = { title: 'no-hook', code: 'CALLER-SEEDED' };
    const row: any = await engine.insert('prov_ticket', payload);

    expect(hookSaw[0]).toEqual({ title: 'no-hook', code: 'CALLER-SEEDED' });
    expect(hookSaw[0]).not.toBe(payload);
    expect(payload).toEqual({ title: 'no-hook', code: 'CALLER-SEEDED' });
    // The caller's echo did not become hook-owned.
    expect(row.code).toBe('0001');
  });

  it('FORGERY BOUNDARY: the recording is SEALED before any engine-owned pass', async () => {
    // "sealed before any engine-owned pass touches it". `applyAutonumbers` is
    // the engine-owned writer of exactly this column and it runs AFTER the
    // strip; if the recorder were still armed for it, the sequence value would
    // register as a hook write. Read as an outcome: on the `no-hook` row the
    // engine's own autonumber write does NOT exempt the caller's seed, so the
    // strip still fires and still warns.
    const row: any = await engine.insert('prov_ticket', { title: 'no-hook', code: 'CALLER-SEEDED' });
    expect(row.code).toBe('0001');
    expect(warns).toHaveLength(1);
  });

  it('FORGERY BOUNDARY: the record says an assignment RAN, not what the value was', async () => {
    // "it records that an assignment ran rather than anything about the
    // payload's contents". A hook that assigns the key the caller's OWN value,
    // deliberately, is a hook write — that is the whole ruling — and a hook that
    // assigns a different one is equally a hook write. Same verdict, two
    // values: the record is blind to contents.
    const same: any = await engine.insert('prov_ticket', { title: 'S', code: 'HOOK-S' });
    const diff: any = await engine.insert('prov_ticket', { title: 'D', code: 'CALLER-SEEDED' });
    expect(same.code).toBe('HOOK-S');
    expect(diff.code).toBe('HOOK-D');
    expect(warns).toEqual([]);
  });

  it('a hook that REPLACES ctx.input.data falls back to the value test, not to "keep everything"', async () => {
    // The recorder's KNOWN LIMIT on the insert path. The replacement carries the
    // caller's own `code`, and reading a replacement's keys as hook-owned would
    // launder a caller-seeded record number into a platform write — so the
    // fallback deliberately keeps the pre-#14259 over-strip.
    engine.registerHook('beforeInsert', async (ctx: any) => {
      if (ctx.input.data.title !== 'replace') return;
      ctx.input.data = { ...ctx.input.data };
    }, { object: 'prov_ticket', priority: 60 });

    const row: any = await engine.insert('prov_ticket', { title: 'replace', code: 'HOOK-replace' });

    // The priority-50 hook assigned `HOOK-replace` on the RECORDING view; the
    // priority-60 hook then replaced the object, so there is no attributable
    // record and the value test judges the result. The caller sent the same
    // value, so it is stripped — the old bug, kept on purpose.
    expect(row.code).not.toBe('HOOK-replace');
    expect(row.code).toBe('0001');
  });

  // ── The exemptions above this seam are untouched ──────────────────────────

  it('#5503 UNCHANGED: an isSystem caller still bypasses the whole pass', async () => {
    const row: any = await engine.insert(
      'prov_ticket', { title: 'no-hook', code: 'SEEDED' },
      { context: { isSystem: true } } as any,
    );
    expect(row.code).toBe('SEEDED');
    expect(warns).toEqual([]);
  });
});
