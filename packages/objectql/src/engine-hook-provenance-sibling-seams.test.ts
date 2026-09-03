// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #14259 — the INSERT-side runtime-owned strip must decide hook-vs-caller by
// the same RECORD `stripReadonlyFields` uses, not by `Object.is`.
//
// #14088 replaced `Object.is(payload[k], supplied[k])` inside
// `stripReadonlyFields` with a recording of the keys the before-phase hook
// chain actually assigned (`recordHookPayloadWrites`). Its argument was never
// about `null`: value equality cannot separate
//
//   - the hook deliberately wrote the value the caller also sent, from
//   - the hook never touched the key at all,
//
// and the two demand opposite verdicts. `stripRuntimeOwnedFields` — the
// INSERT-side twin — was left on the comparison that argument retired, and
// #6339's own prose is the finding: it argued a key SET made the contract true
// "only BY ACCIDENT" and moved to VALUES, which is accidental in the identical
// way. So a `beforeInsert` hook that re-issues or normalises a record number
// still loses its write to the one caller that submitted the same value.
//
// ⛔ THE SIBLING SEAM IS DELIBERATELY NOT HERE, AND IT HAS SINCE BEEN RULED.
// #14259 named a second one — `isCallerSuppliedValue`, behind the two
// `readonlyWhen` strips — and maintainer ruling B kept it on VALUE EQUALITY:
// the divergence from this seam is deliberate, not a port nobody got to.
// ⛔ The argument is NOT restated here. It lives on `isCallerSuppliedValue`'s
// docblock (`validation/rule-validator.ts`), and each face carries a pin:
// `MEASURED: a lone self-assigning hook leaves the CALLER value on the key`
// (this suite, insert side; `engine-readonly-strip-caller-values.test.ts`,
// update side) against `LOCK 3b` in
// `engine-readonly-when-derived-writes.test.ts`.
//
// ⛔ WHAT THIS SUITE IS NOT, and is written to fail if anyone reads it that
// way: it is NOT a relaxation of #5503. The DISCRIMINATOR PAIRS are the
// deliverable's proof — the same caller payload, byte for byte, on the same
// runtime-owned key, reaching OPPOSITE verdicts depending on whether a hook
// assigned it. A caller-seeded record number that no hook wrote is still
// stripped, still warns with the same text, and still reports through
// `onFieldsDropped` / `strictReadonlyWrites`. That is what value equality
// cannot deliver and a record can.
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
      const rows = Array.from(storeFor(object).values()).filter((r) => matches(r, ast?.where));
      // The caller's bound, applied AFTER the filter and by PRESENCE
      // (`check:objectql-double-limit`): a double that silently ignores `limit`
      // answers with more rows than the engine asked for, and a test written
      // against it passes for a reason the real driver does not share.
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

  // ── The measured consequence of "an assignment ran", stated out loud ──────

  it('MEASURED: a lone self-assigning hook leaves the CALLER value on the key', async () => {
    // ⚠️ RECORDING BEHAVIOUR, NOT BLESSING IT. This is the direct consequence
    // of the mechanism the card mandates: the record says an ASSIGNMENT RAN and
    // is deliberately blind to the value, so `ctx.input.data.code =
    // ctx.input.data.code` — which computes nothing — is a `set`, and the
    // caller's seed becomes hook-owned and survives. `title: 'no-hook'`
    // short-circuits the priority-50 hook so the self-assignment is the ONLY
    // write to `code`, which is what makes the surviving value the caller's.
    //
    // Pinned so the consequence is visible rather than discovered later, and
    // pinned rather than argued: it is the exact shape that forked the
    // `readonlyWhen` seam out of this PR, whose #9107 pin `LOCK 3b` pins the
    // OPPOSITE verdict for a STATE lock ("a hook that writes the caller value
    // BACK is the caller value, and goes"). That fork was RULED (#14259,
    // maintainer ruling B): the two verdicts are one recorded asymmetry, and
    // `isCallerSuppliedValue`'s docblock carries the argument.
    //
    // Why the same mechanism ships on THIS seam: `stripRuntimeOwnedFields`
    // guards a runtime-owned COLUMN (#5503) — the same class of protection
    // #14088 already moved to provenance on the update side, and the class
    // whose exemption `runtimeOwnedStripWarning` promises hook authors in prose
    // — not a STATE lock whose whole purpose is that no caller write survives a
    // TRUE predicate. INSERT is exempt from `readonlyWhen` entirely, so no lock
    // of that class exists on this path to open. A ruling that self-assignment
    // must NOT count would move this pin and #14088's seam together; that is a
    // deliberate follow-up, not silent drift.
    engine.registerHook('beforeInsert', async (ctx: any) => {
      ctx.input.data.code = ctx.input.data.code;
    }, { object: 'prov_ticket', priority: 60 });

    const row: any = await engine.insert('prov_ticket', { title: 'no-hook', code: 'CALLER-SEEDED' });

    expect(row.code).toBe('CALLER-SEEDED');
    expect(warns).toEqual([]);
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
