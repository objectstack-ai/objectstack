// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #16344 — UPDATE side: a caller-supplied value for a statically `readonly`
// field must not be visible to `beforeUpdate`.
//
// The strip itself was never the defect. `stripReadonlyFields` does keep the
// caller's value out of the SET clause, and the read-back proves it. What
// leaked was the HOOK INPUT: the strip ran AFTER `triggerHooks('beforeUpdate')`,
// so a hook computing a derived column off the incoming record computed it from
// a number the row would never contain — and THAT write, being the hook's own,
// persisted. The committed row then cited values it does not hold:
//
//   PATCH { actual_value: 380, target_value: 1, weight: 1 }  -> 200
//   read back: target_value 400  weight 10   (the strip worked)
//              score 1.2  calc_trace "实际 380 / 目标 1 … 权重 1%"
//
// The invariant this suite pins is the triage ruling's, verbatim:
// 「交给生命周期钩子的记录,就是它打算持久化的那条记录。」
//
// The ruling that decided the SHAPE is the maintainer's, decision batch #87
// (2026-09-08), and it has two halves — both pinned here:
//
//   1. `ctx.input.data` on `beforeUpdate` becomes the record the engine intends
//      to persist: caller-forged static `readonly` values are hidden before the
//      before phase is dispatched.
//   2. The caller's submission AS SENT travels on `ctx.submitted`, a declared
//      `HookContext` member — "diagnostics only, never the persist image" — so
//      a guard that reports on what the caller sent keeps naming it. Without
//      half 2, half 1 silently degrades plugin-auth's ADR-0092 identity write
//      guard from `403 … (role) …` to `403 … (—) …`; that degradation was
//      measured, and it is why the two halves ship together.
//
// ⚠️ Read the ORDERING probe below as the card's whole claim. It is measured,
// not inferred from where the two call sites sit in the file: the probe records
// what the hook actually observed, and a same-write CONTROL on a writable field
// proves the probe can see payload values at all — so an empty reading on the
// read-only key is a reading, not a broken probe.
//
// Pre-fix reading on this branch's base (`fd5cff209`, 3 failed / 4 passed of
// the 7 cases that existed then): ORDERING failed at `readonlyKeyPresent`
// ("expected true to be false") with its control leg PASSING, THE REPORT
// committed `score` 380 against a baseline of 9.5, and the PREDICATE branch
// failed identically.
//
// What this suite is NOT: a relaxation of #5591 / #14088. A hook writing a
// read-only column is still the hook's write and still lands; those controls are
// re-pinned here so the two verdicts are read together, and so a future repair
// of one cannot silently reintroduce the other. The ENFORCEMENT pass did not
// move — only what the hooks are SHOWN did.

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
      // (`check:objectql-double-limit`): a double that silently ignores
      // `limit` answers with rows the engine asked it not to return, which is
      // the one way a fake driver can make a paging bug pass.
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

/** What the `beforeUpdate` hook observed on `ctx.input.data`, per call. */
type HookSighting = {
  readonlyKeyPresent: boolean;
  readonlyValue: unknown;
  writableKeyPresent: boolean;
  writableValue: unknown;
  /** The declared submission channel, read in the SAME dispatch. */
  submittedKeys: string[] | undefined;
  submittedReadonlyValue: unknown;
  submittedIsFrozen: boolean | undefined;
};

describe('#16344 — caller-forged readonly values are hidden from beforeUpdate', () => {
  let engine: ObjectQL;
  let storeFor: ReturnType<typeof makeDriver>['storeFor'];
  let sightings: HookSighting[];
  let warns: string[];

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

    // The reported object, trimmed to the fields the repro turns on.
    engine.registry.registerObject({
      name: 'kpi_entry_line',
      fields: {
        target_value: { type: 'number', readonly: true, scale: 4 },
        weight: { type: 'number', readonly: true, scale: 2 },
        actual_value: { type: 'number', scale: 4 },
        score: { type: 'number', scale: 4 },
        calc_trace: { type: 'text' },
        reviewed_at: { type: 'datetime', readonly: true },
      },
    } as any);

    const seed = () => ({
      id: 'kpi_1', target_value: 400, weight: 10, actual_value: 100,
      score: 2.5, calc_trace: 'seed', reviewed_at: null,
    });
    storeFor('kpi_entry_line').set('kpi_1', seed());
    storeFor('kpi_entry_line').set('kpi_2', { ...seed(), id: 'kpi_2' });

    // ── The ORDERING probe, and its control in the same hook ────────────────
    //
    // `target_value` is read-only, `actual_value` is not, and the repro's PATCH
    // carries BOTH. One hook invocation therefore yields both legs of the
    // measurement: if the writable key is visible and the read-only key is not,
    // the strip provably ran first. If NEITHER is visible the probe is broken
    // and the reading is void — which is the whole reason the control is here.
    engine.registerHook('beforeUpdate', async (ctx: any) => {
      const data = (ctx.input?.data ?? {}) as Record<string, unknown>;
      const submitted = ctx.submitted as Record<string, unknown> | undefined;
      sightings.push({
        readonlyKeyPresent: Object.prototype.hasOwnProperty.call(data, 'target_value'),
        readonlyValue: data.target_value,
        writableKeyPresent: Object.prototype.hasOwnProperty.call(data, 'actual_value'),
        writableValue: data.actual_value,
        submittedKeys: submitted ? Object.keys(submitted) : undefined,
        submittedReadonlyValue: submitted?.target_value,
        submittedIsFrozen: submitted ? Object.isFrozen(submitted) : undefined,
      });
    }, { object: 'kpi_entry_line', priority: 10 });

    // The reported app hook: recompute the derived columns from the incoming
    // record, falling back to the stored row for anything the payload omits.
    // That fallback is the ordinary shape — and it is exactly what the leak
    // defeated, because the payload DID carry a `target_value`, just not one
    // that would ever be stored.
    engine.registerHook('beforeUpdate', async (ctx: any) => {
      const data = ctx.input.data as Record<string, any>;
      const prev = (ctx.previous ?? {}) as Record<string, any>;
      const target = data.target_value ?? prev.target_value;
      const weight = data.weight ?? prev.weight;
      const actual = data.actual_value ?? prev.actual_value;
      const rate = (actual / target) * 100;
      data.score = Number(((weight / 100) * rate).toFixed(4));
      data.calc_trace = `实际 ${actual} / 目标 ${target} → 完成率 ${rate}%;权重 ${weight}%`;
    }, { object: 'kpi_entry_line', priority: 50 });

    // An unrelated read-only column the hook STAMPS. It is the #5591/#14088
    // control: a hook's own write to a read-only field must survive, and must
    // keep surviving after this card moves the strip.
    engine.registerHook('beforeUpdate', async (ctx: any) => {
      ctx.input.data.reviewed_at = '2026-09-08T00:00:00.000Z';
    }, { object: 'kpi_entry_line', priority: 60 });
  });

  const row = (id = 'kpi_1') => storeFor('kpi_entry_line').get(id);

  it('ORDERING (the card): the hook does not see a caller-supplied readonly value, and DOES see the writable one', async () => {
    await engine.update('kpi_entry_line', {
      id: 'kpi_1', actual_value: 380, target_value: 1, weight: 1,
    });

    expect(sightings).toHaveLength(1);
    const seen = sightings[0]!;
    // CONTROL leg — the probe can observe the payload at all.
    expect(seen.writableKeyPresent).toBe(true);
    expect(seen.writableValue).toBe(380);
    // MEASUREMENT leg — the strip ran first, so the key is simply gone.
    expect(seen.readonlyKeyPresent).toBe(false);
    expect(seen.readonlyValue).toBeUndefined();
  });

  it('THE REPORT: the persisted derived columns cite values the row actually holds', async () => {
    // Baseline — write only the writable field.
    await engine.update('kpi_entry_line', { id: 'kpi_1', actual_value: 380 });
    const baseline = { score: row().score, calc_trace: row().calc_trace };
    expect(baseline.score).toBe(9.5);

    // The same request plus values for the two read-only fields. The reported
    // symptom is that this diverges from the baseline; it must not.
    await engine.update('kpi_entry_line', {
      id: 'kpi_2', actual_value: 380, target_value: 1, weight: 1,
    });

    expect(row('kpi_2').target_value).toBe(400);
    expect(row('kpi_2').weight).toBe(10);
    expect(row('kpi_2').score).toBe(baseline.score);
    expect(row('kpi_2').calc_trace).toBe(baseline.calc_trace);
    // Stated as the value it must NOT be. 380 is what THIS fixture read on
    // `origin/main` before the fix, not the report's 1.2 — the reported app
    // caps its completion rate and this one does not, so the number differs
    // while the defect is the same one: a score derived from `target_value: 1`
    // on a row that holds 400.
    expect(row('kpi_2').score).not.toBe(380);
    expect(row('kpi_2').calc_trace).not.toContain('目标 1');
  });

  it('the strip still reports and still warns — the caller is not told the write was whole', async () => {
    const dropped: any[] = [];
    await engine.update(
      'kpi_entry_line',
      { id: 'kpi_1', actual_value: 380, target_value: 1, weight: 1 },
      { onFieldsDropped: (e: any) => dropped.push(e) } as any,
    );
    const fields = dropped.flatMap((e) => e.fields).sort();
    expect(fields).toEqual(['target_value', 'weight']);
    expect(dropped.every((e) => e.reason === 'readonly')).toBe(true);
    expect(warns.some((w) => w.includes("Field 'target_value'"))).toBe(true);
  });

  it('#5591/#14088 CONTROL: a hook write to a read-only column still lands', async () => {
    await engine.update('kpi_entry_line', { id: 'kpi_1', actual_value: 380 });
    expect(row().reviewed_at).toBe('2026-09-08T00:00:00.000Z');
  });

  it('#5591/#14088 CONTROL: a hook write lands even when the caller echoed the same key', async () => {
    // The whole-record write-back idiom: the caller echoes `reviewed_at` back
    // as it read it. The hook overwrites it, and the hook's value is the one
    // that commits.
    await engine.update('kpi_entry_line', {
      id: 'kpi_1', actual_value: 380, reviewed_at: null,
    });
    expect(row().reviewed_at).toBe('2026-09-08T00:00:00.000Z');
  });

  it('the PREDICATE branch is fixed on the same terms', async () => {
    // Both update branches run the strip off one snapshot, so the multi path
    // must not need its own fix — pinned, because "both call sites" is the
    // #3106 / #4441 shape that gets missed.
    await engine.update(
      'kpi_entry_line',
      { actual_value: 380, target_value: 1, weight: 1 },
      { where: { target_value: 400 }, multi: true } as any,
    );
    expect(sightings.length).toBeGreaterThan(0);
    expect(sightings.every((s) => s.readonlyKeyPresent === false)).toBe(true);
    expect(sightings.every((s) => s.writableValue === 380)).toBe(true);
    expect(row('kpi_1').target_value).toBe(400);
    expect(row('kpi_1').score).toBe(9.5);
    expect(row('kpi_1').calc_trace).not.toContain('目标 1');
  });

  it('an isSystem caller is UNCHANGED: the exemption is not narrowed by this card', async () => {
    // `isSystem` legitimately writes read-only columns, and it must still see
    // its own payload in the hook — the strip's gate is untouched.
    await engine.update(
      'kpi_entry_line',
      { id: 'kpi_1', actual_value: 380, target_value: 1000 },
      { context: { isSystem: true } } as any,
    );
    expect(sightings[0]!.readonlyKeyPresent).toBe(true);
    expect(sightings[0]!.readonlyValue).toBe(1000);
    expect(row().target_value).toBe(1000);
  });

  // ── The ruling's SECOND half: `ctx.submitted` ─────────────────────────────

  it('`ctx.submitted` carries the caller submission as sent, including what was hidden', async () => {
    // The whole point of the channel: what half 1 takes out of `input.data`
    // has to remain READABLE somewhere, or every guard that reports on the
    // caller's submission degrades silently. Asserted in the SAME dispatch as
    // the hidden reading above, so the pair cannot drift.
    await engine.update('kpi_entry_line', {
      id: 'kpi_1', actual_value: 380, target_value: 1, weight: 1,
    });

    const seen = sightings[0]!;
    expect(seen.readonlyKeyPresent).toBe(false);          // half 1
    expect(seen.submittedKeys).toEqual(['id', 'actual_value', 'target_value', 'weight']);
    expect(seen.submittedReadonlyValue).toBe(1);          // half 2
  });

  it('`ctx.submitted` is frozen — "diagnostics only" is enforced, not merely documented', async () => {
    // `previous` is the only other read-only-by-contract member and it is a
    // live driver row, so nothing would enforce this if the producer did not.
    let threw: unknown;
    let payloadAfter: Record<string, unknown> | undefined;
    engine.registerHook('beforeUpdate', async (ctx: any) => {
      expect(Object.isFrozen(ctx.submitted)).toBe(true);
      // ES modules are strict by construction, so the assignment THROWS rather
      // than failing silently — which is the half that makes the freeze a
      // guarantee an author can rely on instead of a convention.
      try { ctx.submitted.target_value = 999; } catch (e) { threw = e; }
      payloadAfter = { ...(ctx.input.data as Record<string, unknown>) };
    }, { object: 'kpi_entry_line', priority: 20 });

    await engine.update('kpi_entry_line', {
      id: 'kpi_1', actual_value: 380, target_value: 1,
    });

    expect(threw).toBeInstanceOf(TypeError);
    // ⛔ And the attempt reached the payload through no other door: writing to
    // the diagnostics record must never be a way to reinstate a refused value.
    expect(payloadAfter).not.toHaveProperty('target_value');
    expect(row().target_value).toBe(400);
  });

  it('`ctx.submitted` is NOT the payload object — a hook rewriting the payload does not rewrite it', async () => {
    // The #5591 aliasing hazard, asked of the new member: a snapshot that
    // aliased `input.data` would answer every question about "what the caller
    // sent" with the POST-hook payload, which is the failure this key exists
    // to make impossible.
    const submittedAtEnd: unknown[] = [];
    engine.registerHook('beforeUpdate', async (ctx: any) => {
      ctx.input.data.actual_value = 999;
      ctx.input.data.calc_trace = 'rewritten by a hook';
    }, { object: 'kpi_entry_line', priority: 20 });
    engine.registerHook('beforeUpdate', async (ctx: any) => {
      submittedAtEnd.push({ ...(ctx.submitted as Record<string, unknown>) });
    }, { object: 'kpi_entry_line', priority: 90 });

    await engine.update('kpi_entry_line', { id: 'kpi_1', actual_value: 380 });

    expect(submittedAtEnd).toEqual([{ id: 'kpi_1', actual_value: 380 }]);
  });

  it('`ctx.submitted` is bound on the PREDICATE path too — one write, one submission', async () => {
    // Per-row contexts are spread from the batch context, so this is a
    // statement about that spread rather than a second binding site: every
    // matched row's dispatch sees the SAME submission, because one caller
    // write has one submission however many rows it matches.
    await engine.update(
      'kpi_entry_line',
      { actual_value: 380, target_value: 1, weight: 1 },
      { where: { target_value: 400 }, multi: true } as any,
    );

    expect(sightings.length).toBeGreaterThan(1);
    expect(sightings.every((s) => s.submittedIsFrozen === true)).toBe(true);
    expect(sightings.every((s) => s.submittedReadonlyValue === 1)).toBe(true);
    expect(sightings.every((s) => s.readonlyKeyPresent === false)).toBe(true);
  });

  it('`ctx.submitted` reaches the AFTER phase on the same write', async () => {
    // The by-id path reuses one context across the before/after pair, so the
    // member is present in both — pinned so a later refactor that rebuilds the
    // after context cannot drop it unnoticed.
    const afterSubmitted: unknown[] = [];
    engine.registerHook('afterUpdate', async (ctx: any) => {
      afterSubmitted.push(ctx.submitted ? { ...(ctx.submitted as object) } : undefined);
    }, { object: 'kpi_entry_line', priority: 10 });

    await engine.update('kpi_entry_line', {
      id: 'kpi_1', actual_value: 380, target_value: 1,
    });

    expect(afterSubmitted).toEqual([{ id: 'kpi_1', actual_value: 380, target_value: 1 }]);
  });
});
