// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #6339 — the runtime-owned strip on the INSERT path must delete the value the
// CALLER SUBMITTED, never whatever value happens to sit on the key at the moment
// the strip runs. The insert-side twin of #5591 (update path), found while
// measuring that one, and wrong for the identical reason.
//
// `stripRuntimeOwnedFields` runs AFTER `beforeInsert` — `engine.insert` hands it
// the post-hook rows — but decided what to delete from a snapshot of the
// caller's KEY NAMES. Those are different facts the instant a hook writes to a
// runtime-owned column, and `delete result[name]` took whatever was standing
// there. Measured on `origin/main` (one object `{ title: text, code: autonumber
// }`, one hook assigning `ctx.input.data.code`):
//
//   caller omits `code`  ⇒ committed `code` = the hook's value  (hook write lives)
//   caller sends `code`  ⇒ committed `code` = "1"               (hook write dies)
//
// The two calls differ in nothing but whether the caller's payload happened to
// carry a same-named key — and the first outcome is what
// `runtimeOwnedStripWarning()` promises IN PROSE to every hook author:
//
//   "A beforeInsert/beforeUpdate hook does NOT need either — hook-written keys
//    are not caller-supplied."
//
// So the second is the code contradicting its own documented contract, not a
// deliberate policy. The user-visible shape is the whole-record POST: read a
// template, edit fields, submit everything back — the payload necessarily echoes
// the record-number column it just read, and a hook that re-issues or normalizes
// that number silently loses its write to the sequence.
//
// What this suite is NOT: a relaxation of #5503. A caller-seeded record number
// that no hook overwrote is still stripped, still warns, and still reports
// through `onFieldsDropped` / `strictReadonlyWrites` — pinned here next to the
// fix so the two verdicts are read together.

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectQL } from './engine.js';

function makeDriver() {
  const stores = new Map<string, Map<string, any>>();
  const storeFor = (o: string) => {
    let s = stores.get(o);
    if (!s) { s = new Map(); stores.set(o, s); }
    return s;
  };
  let n = 0;
  const driver: any = {
    // `supports: {}` — no native autonumber, so the ENGINE issues the sequence
    // value in `applyAutonumbers`. That is the path the fallback shows up on:
    // the strip deletes the hook's value, the field is then empty, and the
    // sequence fills it.
    name: 'memory', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find(object: string) { return Array.from(storeFor(object).values()); },
    async findOne() { return null; },
    async create(object: string, data: Record<string, unknown>) {
      n += 1;
      const id = (data.id as string) ?? `r_${n}`;
      const row = { ...data, id };
      storeFor(object).set(id, row);
      return row;
    },
    async update() { return null; },
    async updateMany() { return 0; },
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

describe('insert strip acts on CALLER-submitted values (#6339)', () => {
  let engine: ObjectQL;
  let warns: string[];
  /** Every `ctx.input.data` the hook saw, in call order. */
  let hookSaw: Array<Record<string, unknown>>;

  beforeEach(async () => {
    warns = [];
    hookSaw = [];
    const logger: any = {
      warn: (m: string) => warns.push(String(m)),
      debug() {}, info() {}, error() {}, trace() {}, fatal() {},
      child() { return logger; },
    };
    engine = new ObjectQL({ logger });
    engine.registerDriver(makeDriver().driver, true);
    await engine.init();

    engine.registry.registerObject({
      name: 'probe_num2',
      fields: { title: { type: 'text' }, code: { type: 'autonumber' } },
    } as any);

    // The reported hook shape: a `beforeInsert` that OWNS the record number —
    // it re-issues or normalizes it rather than letting the sequence decide.
    // `code_source` is a plain text column recording that the hook ran, so a
    // test can tell "the hook did not fire" from "the hook fired and lost".
    engine.registerHook('beforeInsert', async (ctx: any) => {
      hookSaw.push({ ...(ctx.input.data as Record<string, unknown>) });
      if (ctx.input.data.title === 'no-hook') return;
      ctx.input.data.code = `HOOK-${String(ctx.input.data.title)}`;
    }, { object: 'probe_num2', priority: 50 });
  });

  it('A (control, must not regress): a code the hook ADDS lands', async () => {
    // The face that already worked before #6339, and the one
    // `runtimeOwnedStripWarning` describes. The fix is worthless if it moved
    // this one, so it is pinned first.
    const row: any = await engine.insert('probe_num2', { title: 'A' });
    expect(row.code).toBe('HOOK-A');
    expect(warns).toEqual([]);
  });

  it('B (THE REPORT): a code the hook OVERWROTE lands, even though the caller sent the key', async () => {
    // Identical to A except that the caller's payload also carries `code`.
    // Before #6339 this committed the SEQUENCE value, because the strip deleted
    // the hook's write. Stated as the value it must NOT be, then as the value it
    // must be.
    //
    // ⚠️ The sequence value is spelled `'0001'`, not `'1'`, since #6555/#7262:
    // this field declares no format, so it renders through the contract default
    // `{0000}`. Re-pinned rather than left at `'1'` because `'1'` stopped being
    // the value this guard means to exclude the moment the render moved.
    const row: any = await engine.insert('probe_num2', { title: 'B', code: 'CALLER-FORGED' });
    expect(row.code).not.toBe('0001');
    expect(row.code).not.toBe('CALLER-FORGED');
    expect(row.code).toBe('HOOK-B');
  });

  it('A and B now agree — the accident was the difference between them', async () => {
    // The proof the old behaviour was never deliberate: the same hook, the same
    // object, the same transition; only the caller's key set differed, and only
    // one of the two hook writes survived.
    const a: any = await engine.insert('probe_num2', { title: 'X' });
    const b: any = await engine.insert('probe_num2', { title: 'X', code: 'CALLER-FORGED' });
    expect(a.code).toBe(b.code);
    expect(a.code).toBe('HOOK-X');
  });

  it('#5503 UNCHANGED: a caller seed that NO hook overwrote is still stripped, with the same warning', async () => {
    // `title: 'no-hook'` makes the hook return without writing, so the caller's
    // value is the value on the key — and it goes, exactly as before. The
    // sequence issues the number instead.
    //
    // ⚠️ The sequence's first number is `'0001'`, not `'1'`, since #6555/#7262:
    // `code` declares no format, so it renders through the contract default
    // `{0000}`. Do not "fix" this back to a bare `'1'` — that spelling was the
    // engine-vs-driver-sql fork the ruling closed. What this case is about is
    // the STRIP, not the width.
    const row: any = await engine.insert('probe_num2', { title: 'no-hook', code: 'CALLER-FORGED' });
    expect(row.code).not.toBe('CALLER-FORGED');
    expect(row.code).toBe('0001');
    expect(warns).toHaveLength(1);
    // The contract of the text, not its wording (#5503's own pin discipline).
    expect(warns[0]).toContain("Field 'code' on 'probe_num2'");
    expect(warns[0]).toContain('runtime-owned');
    expect(warns[0]).toContain('COMMITTED WITHOUT IT');
    expect(warns[0]).toContain('hook-written keys are not caller-supplied');
  });

  it('a hook-overwritten code produces NO warning — the log would otherwise lie', async () => {
    // `runtimeOwnedStripWarning` says "the caller-supplied value was DROPPED and
    // the write is being COMMITTED WITHOUT IT". After the fix the column IS
    // committed, with the hook's value, so warning here would report a drop
    // that did not happen.
    await engine.insert('probe_num2', { title: 'B', code: 'CALLER-FORGED' });
    expect(warns).toEqual([]);
  });

  it('P3: the caller-value snapshot is NOT the object the hook mutates in place', async () => {
    // The insert-path detail the report flagged as needing measurement, pinned
    // as an invariant rather than left as a coincidence. `suppliedPerRow` is now
    // an explicit shallow COPY of `opCtx.data`, taken ahead of the hooks — so a
    // hook writing `ctx.input.data.code = …` (in place, the ordinary spelling)
    // cannot rewrite the record of what the caller sent.
    //
    // Measured direction: on `origin/main` these were ALREADY distinct objects,
    // because `applyFieldDefaults` returns `{ ...record }` — but it hands the
    // SAME reference back on its `!fields` early return, and
    // `initializeSummaryFields` copies only when it seeds. The copy makes the
    // separation a property of the insert path itself.
    const payload: Record<string, unknown> = { title: 'B', code: 'CALLER-FORGED' };
    const row: any = await engine.insert('probe_num2', payload);

    // The hook mutated a different object than the caller's...
    expect(hookSaw[0]).not.toBe(payload);
    // ...the caller's payload is unchanged by the write...
    expect(payload).toEqual({ title: 'B', code: 'CALLER-FORGED' });
    // ...and the strip judged against 'CALLER-FORGED', not against the hook's
    // value, which is why the hook's value survived.
    expect(row.code).toBe('HOOK-B');
  });

  it('a hook that REPLACES ctx.input.data wholesale is judged the same way', async () => {
    // The other spelling a hook may use. `rows[i]` becomes an object the caller
    // never touched, so no key on it holds the caller's value and nothing is
    // stripped — including the record number the hook chose.
    engine.registerHook('beforeInsert', async (ctx: any) => {
      ctx.input.data = { ...(ctx.input.data as Record<string, unknown>), code: 'REPLACED-1' };
    }, { object: 'probe_num2', priority: 90 });
    const row: any = await engine.insert('probe_num2', { title: 'B', code: 'CALLER-FORGED' });
    expect(row.code).toBe('REPLACED-1');
    expect(warns).toEqual([]);
  });

  it('BULK: one batch, mixed rows — each row is judged on its own values', async () => {
    // The batch path runs the strip per row off one snapshot array, so a row
    // whose hook overwrote the key and a row whose hook did not must come out
    // differently in the SAME call. This is the shape a per-call flag or a
    // shared snapshot would get wrong.
    const rows: any = await engine.insert('probe_num2', [
      { title: 'r1' },                              // hook ADDS      ⇒ HOOK-r1
      { title: 'r2', code: 'CALLER-FORGED' },       // hook OVERWRITES ⇒ HOOK-r2
      { title: 'no-hook', code: 'CALLER-FORGED' },  // no hook write   ⇒ stripped, sequence
      { title: 'no-hook' },                         // nothing at all  ⇒ sequence
    ]);
    expect(rows[0].code).toBe('HOOK-r1');
    expect(rows[1].code).toBe('HOOK-r2');
    // ⚠️ `'0001'` / `'0002'`, not bare — the format-less contract default
    // `{0000}` (#6555/#7262). The counter, which is what this case pins, still
    // runs 1 then 2 across the two sequence-issued rows.
    expect(rows[2].code).toBe('0001');
    expect(rows[3].code).toBe('0002');
    // Exactly one row was stripped, so exactly one warning.
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain("Field 'code'");
  });

  it('BULK: a caller-supplied value is never read from the WRONG row', async () => {
    // Off-by-one insurance for the per-row snapshot: row 0 supplies the value
    // row 1's hook happens to produce, and vice versa. A snapshot indexed wrong
    // would strip one of them.
    const rows: any = await engine.insert('probe_num2', [
      { title: 'p', code: 'HOOK-q' },
      { title: 'q', code: 'HOOK-p' },
    ]);
    expect(rows[0].code).toBe('HOOK-p');
    expect(rows[1].code).toBe('HOOK-q');
    expect(warns).toEqual([]);
  });

  it('onFieldsDropped: silent for a hook-overwritten code, fires for a real drop', async () => {
    // `DroppedFieldsEvent` is contracted as "dropped, and the write completed
    // WITHOUT them" (#3407). A committed column is not a drop.
    const kept: unknown[] = [];
    await engine.insert(
      'probe_num2',
      { title: 'B', code: 'CALLER-FORGED' },
      { onFieldsDropped: (e) => kept.push(e) },
    );
    expect(kept).toEqual([]);

    const dropped: unknown[] = [];
    await engine.insert(
      'probe_num2',
      { title: 'no-hook', code: 'CALLER-FORGED' },
      { onFieldsDropped: (e) => dropped.push(e) },
    );
    expect(dropped).toEqual([{ object: 'probe_num2', fields: ['code'], reason: 'readonly' }]);
  });

  it('strictReadonlyWrites refuses the real forge and admits the hook write', async () => {
    // #5126 refuses rather than committing without the stripped column. A
    // hook-overwritten key is not stripped, so there is nothing to refuse — the
    // strict caller's contract is about columns that would be MISSING.
    await expect(engine.insert(
      'probe_num2',
      { title: 'no-hook', code: 'CALLER-FORGED' },
      { strictReadonlyWrites: true },
    )).rejects.toThrow();

    const row: any = await engine.insert(
      'probe_num2',
      { title: 'B', code: 'CALLER-FORGED' },
      { strictReadonlyWrites: true },
    );
    expect(row.code).toBe('HOOK-B');
  });

  it('an isSystem caller keeps its own seeded record number', async () => {
    // The whole pass is skipped for a trusted writer; the hook still runs, and
    // still wins, because it assigns last.
    const row: any = await engine.insert(
      'probe_num2',
      { title: 'no-hook', code: 'SEED-9' },
      { context: { isSystem: true } },
    );
    expect(row.code).toBe('SEED-9');
  });

  it('a preserveAudit historical import still reinstates a legacy record number', async () => {
    const row: any = await engine.insert(
      'probe_num2',
      { title: 'no-hook', code: 'LEGACY-7' },
      { context: { preserveAudit: true } },
    );
    expect(row.code).toBe('LEGACY-7');
    expect(warns).toEqual([]);
  });

  it('the hook can still SEE the caller-submitted record number', async () => {
    // Why the fix compares values instead of stripping ahead of the hooks: a
    // `beforeInsert` guard that reports on what the caller submitted reads
    // `ctx.input.data`. Stripping first would empty that out and silently
    // degrade every such diagnostic.
    await engine.insert('probe_num2', { title: 'B', code: 'CALLER-FORGED' });
    expect(hookSaw[0]).toEqual({ title: 'B', code: 'CALLER-FORGED' });
  });
});
