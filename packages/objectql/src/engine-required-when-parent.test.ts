// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #4977 — PARENT-scoped `requiredWhen` is a SERVER guarantee.
//
// The mirror of #4889, one slot over on the same field. `requiredWhen:
// parent.status == 'sent'` on a detail object — "once the header invoice is
// Sent, every line must carry a description" — was evaluated by the inline grid
// and was a NO-OP on the server: nothing bound `parent`, the predicate faulted,
// the fail-open branch skipped the rule, and the write landed with the field
// empty.
//
// Note the failure mode is the MIRROR of #4889's, not the same one: a
// `readonlyWhen` failing open WROTE a field that should have been frozen; a
// `requiredWhen` failing open ACCEPTS a record that should have been rejected.
//
// The maintainer ruled A+C (2026-08-06): bind the scope, keep the evaluation
// semantics FAIL-OPEN, and catch the unbindable declaration at build time
// instead (`@objectstack/lint`). Option B — 422 on an unresolvable header — was
// explicitly NOT taken, so the "header cannot be read" case below asserts the
// write is ACCEPTED. That is the deliberate asymmetry with #4889's fail-CLOSED
// twin, and it is pinned here so nobody "fixes" one into the other by accident.
//
// Driven end-to-end through the real engine + a real driver, not through the
// evaluator in isolation (PD #10: a `case` label is not enforcement — check the
// CALL SITE). The driver fixture is #4889's, unchanged.

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectQL } from './engine.js';

function makeDriver() {
  const stores = new Map<string, Map<string, any>>();
  const storeFor = (o: string) => {
    let s = stores.get(o);
    if (!s) { s = new Map(); stores.set(o, s); }
    return s;
  };
  const checkOp = (value: any, cond: any): boolean => {
    if (cond === null || typeof cond !== 'object' || Array.isArray(cond) || cond instanceof Date) {
      return value === cond;
    }
    return Object.entries(cond).every(([op, target]: [string, any]) => {
      switch (op) {
        case '$eq': return value === target;
        case '$ne': return value !== target;
        case '$in': return Array.isArray(target) && target.includes(value);
        default: return true;
      }
    });
  };
  const matches = (row: any, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    return Object.entries(where).every(([k, v]: [string, any]) => {
      if (k === '$and') return (v as any[]).every((w) => matches(row, w));
      if (k === '$or') return (v as any[]).some((w) => matches(row, w));
      if (k === '$not') return !matches(row, v);
      return checkOp(row?.[k], v);
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

describe('parent-scoped requiredWhen is enforced server-side (#4977)', () => {
  let engine: ObjectQL;
  let storeFor: ReturnType<typeof makeDriver>['storeFor'];

  beforeEach(async () => {
    engine = new ObjectQL();
    const d = makeDriver();
    storeFor = d.storeFor;
    engine.registerDriver(d.driver, true);
    await engine.init();
    engine.registry.registerObject({
      name: 'showcase_invoice',
      fields: {
        invoice_number: { type: 'text' },
        status: { type: 'select', options: [{ value: 'draft' }, { value: 'sent' }, { value: 'paid' }] },
        // The RECORD-scoped contrast on the header itself
        // (`invoice.object.ts` L153) — worked all along, must keep working.
        paid_on: { type: 'date', requiredWhen: "record.status == 'paid'" },
      },
    } as any, 'test-package');
    engine.registry.registerObject({
      name: 'showcase_invoice_line',
      fields: {
        invoice: { type: 'master_detail', reference: 'showcase_invoice', required: true },
        // THE SUBJECT: the issue's own example — "once the header is Sent,
        // every line must carry a description".
        description: { type: 'text', requiredWhen: "parent.status == 'sent'" },
        // The ROW-scoped contrast the showcase actually ships today
        // (`invoice.object.ts` L212).
        note: { type: 'text', requiredWhen: 'record.quantity >= 100' },
        quantity: { type: 'number' },
        // [#6457] A requirement whose predicate is TRUE exactly when the header
        // carries no `status`. On a header row the driver returned without that
        // column this used to fault (`No such key: status` on a BOUND `parent`)
        // and fail OPEN — the requirement enforced nothing. The mirror of
        // #4889's hole: opposite direction, same `declared ≠ enforced`.
        reason: { type: 'text', requiredWhen: 'parent.status == null' },
      },
    } as any, 'test-package');

    storeFor('showcase_invoice').set('INV-SENT', { id: 'INV-SENT', invoice_number: 'INV-SENT', status: 'sent' });
    storeFor('showcase_invoice').set('INV-DRAFT', { id: 'INV-DRAFT', invoice_number: 'INV-DRAFT', status: 'draft' });
    // [#6457] The MIDDLE row of the issue's table: `status` is declared on the
    // master; this header row simply does not carry the key.
    storeFor('showcase_invoice').set('INV-SPARSE', { id: 'INV-SPARSE', invoice_number: 'INV-SPARSE' });
  });

  const line = (id: string) => storeFor('showcase_invoice_line').get(id);
  const lines = () => [...storeFor('showcase_invoice_line').values()];

  /** The error a write threw, or a failure saying it was accepted. Callers
   *  assert on `.name` / `.fields` (field + code) — never a bare `toThrow()`. */
  async function rejectionOf(run: () => Promise<unknown>): Promise<any> {
    let thrown: unknown;
    let threw = false;
    try {
      await run();
    } catch (err) {
      threw = true;
      thrown = err;
    }
    expect(threw).toBe(true);
    return thrown as any;
  }

  // ── parent scope HIT ──────────────────────────────────────────────────────

  it('THE GAP: rejects an INSERT that leaves the field empty under a Sent header', async () => {
    await expect(
      engine.insert('showcase_invoice_line', { invoice: 'INV-SENT', quantity: 1 }),
    ).rejects.toThrow(/description/i);
    // Nothing was written — the rejection is before the driver, not after.
    expect(lines()).toHaveLength(0);
  });

  it('rejects an UPDATE that nulls the field while the header is Sent', async () => {
    storeFor('showcase_invoice_line').set('l1', { id: 'l1', invoice: 'INV-SENT', description: 'seat', quantity: 1 });
    await expect(
      engine.update('showcase_invoice_line', { id: 'l1', description: '' }),
    ).rejects.toThrow(/description/i);
    expect(line('l1')).toMatchObject({ description: 'seat' });
  });

  // ── parent scope MISS ─────────────────────────────────────────────────────

  it('does NOT require the field when the header is still Draft (no false positives)', async () => {
    const row = await engine.insert('showcase_invoice_line', { invoice: 'INV-DRAFT', quantity: 1 });
    expect(row).toMatchObject({ invoice: 'INV-DRAFT' });
    await engine.update('showcase_invoice_line', { id: (row as any).id, quantity: 2 });
    expect(line((row as any).id)).toMatchObject({ quantity: 2 });
  });

  it('accepts the write once the field IS supplied under a Sent header', async () => {
    const row = await engine.insert('showcase_invoice_line', { invoice: 'INV-SENT', description: 'seat', quantity: 1 });
    expect(row).toMatchObject({ description: 'seat' });
  });

  // ── parent MISSING — fail-OPEN (the deliberate asymmetry with #4889) ──────

  it('is FAIL-OPEN when the header cannot be resolved (option B was NOT taken)', async () => {
    // A stored row whose header is gone — #4889's own orphan fixture, and the
    // only spelling that reaches this branch (a DANGLING FK in an insert
    // payload is refused earlier by the #4441 reference guard, so the header
    // can only go missing under a row that already exists).
    //
    // #4889's `readonlyWhen` twin treats an unbound `parent` as LOCKED. The
    // ruling on #4977 explicitly declined the symmetric answer (reject the
    // write), so here the requirement is skipped and the write lands — even
    // though `description` is empty and the predicate, could it have been
    // evaluated, might well have said it is required.
    storeFor('showcase_invoice_line').set('orphan', { id: 'orphan', invoice: 'GONE', description: '', quantity: 1 });
    await engine.update('showcase_invoice_line', { id: 'orphan', quantity: 9 });
    expect(line('orphan')).toMatchObject({ quantity: 9, description: '' });
  });

  it('names the unbound ROOT in the skip diagnostic (fail-open, but not silent)', async () => {
    const warns: string[] = [];
    const base = (engine as any).logger;
    (engine as any).logger = new Proxy(base, {
      get: (t: any, k: string) => (k === 'warn' ? (m: string) => warns.push(String(m)) : t[k]),
    });
    storeFor('showcase_invoice_line').set('orphan', { id: 'orphan', invoice: 'GONE', description: '', quantity: 1 });
    await engine.update('showcase_invoice_line', { id: 'orphan', quantity: 9 });
    expect(warns.some((w) => /requiredWhen for 'description' reads 'parent'/.test(w))).toBe(true);
    expect(warns.some((w) => /NOT enforced/.test(w))).toBe(true);
  });

  // ── repoint ───────────────────────────────────────────────────────────────

  it('judges a REPOINT against the master the write lands on, not the one it leaves', async () => {
    // A line that legitimately has no description under a DRAFT header. Moving
    // it onto the SENT invoice turns the requirement on, and the write that
    // does the moving is the one that must be rejected — the ADR-0113
    // pre-check must not read this as a pre-existing violation that may rest.
    storeFor('showcase_invoice_line').set('l2', { id: 'l2', invoice: 'INV-DRAFT', description: '', quantity: 1 });
    await expect(
      engine.update('showcase_invoice_line', { id: 'l2', invoice: 'INV-SENT' }),
    ).rejects.toThrow(/description/i);
    expect(line('l2')).toMatchObject({ invoice: 'INV-DRAFT' });
  });

  it('lets a legacy row rest: an unrelated edit under an already-Sent header is not blocked (ADR-0113)', async () => {
    // Stored state ALREADY violates (header sent, description empty). ADR-0113
    // non-regression: a write that leaves the violation in place is allowed —
    // enforcement tightens for new violations, it does not brick deployed rows.
    storeFor('showcase_invoice_line').set('l3', { id: 'l3', invoice: 'INV-SENT', description: '', quantity: 1 });
    await engine.update('showcase_invoice_line', { id: 'l3', quantity: 7 });
    expect(line('l3')).toMatchObject({ quantity: 7, description: '' });
  });

  // ── bulk ──────────────────────────────────────────────────────────────────

  it('enforces the requirement on the BULK path too, per matched row (#3106 shape)', async () => {
    storeFor('showcase_invoice_line').set('b_sent', { id: 'b_sent', invoice: 'INV-SENT', description: 'seat', quantity: 1 });
    storeFor('showcase_invoice_line').set('b_draft', { id: 'b_draft', invoice: 'INV-DRAFT', description: 'seat', quantity: 1 });
    // One payload, N priors: nulling the description violates for the row whose
    // header is Sent, so the WHOLE batch is rejected before anything is written.
    await expect(
      engine.update('showcase_invoice_line', { description: '' }, { where: { quantity: 1 }, multi: true } as any),
    ).rejects.toThrow(/description/i);
    expect(line('b_sent')).toMatchObject({ description: 'seat' });
    expect(line('b_draft')).toMatchObject({ description: 'seat' });
  });

  it('leaves a bulk edit that touches only Draft-header rows alone', async () => {
    storeFor('showcase_invoice_line').set('b_draft', { id: 'b_draft', invoice: 'INV-DRAFT', description: 'seat', quantity: 1 });
    await engine.update('showcase_invoice_line', { description: '' }, { where: { invoice: 'INV-DRAFT' }, multi: true } as any);
    expect(line('b_draft')).toMatchObject({ description: '' });
  });

  // ── contrasts that must not move ──────────────────────────────────────────

  it('CONTRAST: the ROW-scoped requiredWhen on the same object still works', async () => {
    await expect(
      engine.insert('showcase_invoice_line', { invoice: 'INV-DRAFT', quantity: 500 }),
    ).rejects.toThrow(/note/i);
    const row = await engine.insert('showcase_invoice_line', { invoice: 'INV-DRAFT', quantity: 500, note: 'bulk order' });
    expect(row).toMatchObject({ note: 'bulk order' });
  });

  it('CONTRAST: the record-scoped requiredWhen on the HEADER object still works', async () => {
    await expect(
      engine.update('showcase_invoice', { id: 'INV-DRAFT', status: 'paid' }),
    ).rejects.toThrow(/paid_on/i);
  });

  // ── blast radius: the object-level rules at the SAME evaluation site ──────

  it('does NOT bind `parent` for object-level rules — they stay fail-CLOSED (#4649)', async () => {
    // The reason #4889 left this change out of PR #4972: `script` /
    // `cross_field` rules share this evaluation call and have REJECTED an
    // unevaluable predicate since #4649. Binding a new root for them would flip
    // writes they refuse today into accepted ones. The binding is scoped to the
    // field-level `requiredWhen` block precisely so this verdict does not move.
    engine.registry.registerObject({
      name: 'scoped_line',
      fields: {
        invoice: { type: 'master_detail', reference: 'showcase_invoice', required: true },
        description: { type: 'text', requiredWhen: "parent.status == 'sent'" },
      },
      validations: [{
        type: 'script',
        name: 'no_parent_root_here',
        message: 'object-level rules do not get a parent binding',
        condition: "parent.status == 'sent'",
      }],
    } as any, 'test-package');
    // The header resolves fine (the field predicate below would evaluate), yet
    // the object-level rule still faults on `parent` and still fails CLOSED.
    await expect(
      engine.insert('scoped_line', { invoice: 'INV-DRAFT', description: 'seat' }),
    ).rejects.toThrow();
  });

  // ── cost ─────────────────────────────────────────────────────────────────

  it('batch-reads the headers ONCE per insert, and not at all without a parent-scoped requiredWhen', async () => {
    // The header resolution goes through `find` (batched, #4889's
    // `resolveMasterDetailParents`), so that is what is counted here — the
    // `findOne`s on the same object belong to the #4441 reference guard and are
    // not this change's cost.
    const reads: string[] = [];
    const original = (engine as any).find.bind(engine);
    (engine as any).find = async (name: string, q: any, o?: any) => {
      reads.push(name);
      return original(name, q, o);
    };
    // Two rows under the SAME master, and two more under another: N rows, M
    // masters, ONE query.
    await engine.insert('showcase_invoice_line', [
      { invoice: 'INV-SENT', description: 'a', quantity: 1 },
      { invoice: 'INV-SENT', description: 'b', quantity: 1 },
      { invoice: 'INV-DRAFT', quantity: 1 },
    ] as any);
    expect(reads.filter((r) => r === 'showcase_invoice')).toHaveLength(1);

    // An object with only record-scoped requirements pays nothing extra.
    engine.registry.registerObject({
      name: 'plain_line',
      fields: {
        invoice: { type: 'master_detail', reference: 'showcase_invoice', required: true },
        note: { type: 'text', requiredWhen: 'record.quantity >= 100' },
        quantity: { type: 'number' },
      },
    } as any, 'test-package');
    reads.length = 0;
    await engine.insert('plain_line', { invoice: 'INV-SENT', quantity: 1 });
    expect(reads.filter((r) => r === 'showcase_invoice')).toHaveLength(0);
  });

  // ── #6457 — the header is TOTAL over the MASTER's declared fields ──────────
  //
  // The `requiredWhen` half of the same change. #4977 bound the scope; what it
  // could not fix from here is what the bound header CONTAINS — a driver that
  // returns only the columns it stored hands over a header missing the very key
  // the predicate reads, and a `requiredWhen` that faults is fail-OPEN, so the
  // requirement silently enforces nothing.
  //
  // Note which line moves and which does not. The middle row (header RESOLVED
  // but sparse) becomes evaluable and therefore ENFORCED. The bottom row (header
  // UNRESOLVABLE) keeps #4977's deliberate fail-OPEN asymmetry with #4889 —
  // option B was not taken here and is not taken here now either.

  /** Every warning the engine emitted during one write. */
  async function warningsDuring(run: () => Promise<unknown>): Promise<string[]> {
    const warns: string[] = [];
    const base = (engine as any).logger;
    (engine as any).logger = new Proxy(base, {
      get: (t: any, k: string) => (k === 'warn' ? (m: string) => warns.push(String(m)) : t[k]),
    });
    try {
      await run();
    } catch {
      /* the caller asserts the outcome; this helper only collects the channel */
    } finally {
      (engine as any).logger = base;
    }
    return warns;
  }

  it('ROW 1 (header carries the key): evaluates as it always did — no false positive', async () => {
    // INV-SENT carries `status: 'sent'`, so `parent.status == null` is FALSE and
    // `reason` is not required.
    const row = await engine.insert('showcase_invoice_line', { invoice: 'INV-SENT', description: 'seat', quantity: 1 });
    expect(row).toMatchObject({ description: 'seat' });
  });

  it('ROW 2 — THE FIX: an INSERT under a sparse header is now REJECTED (was accepted)', async () => {
    const err = await rejectionOf(() =>
      engine.insert('showcase_invoice_line', { invoice: 'INV-SPARSE', quantity: 1 }));
    expect(err.name).toBe('ValidationError');
    expect(err.code).toBe('VALIDATION_FAILED');
    expect(err.fields).toContainEqual(expect.objectContaining({ field: 'reason', code: 'required' }));
    // Rejected BEFORE the driver, not rolled back after it.
    expect(lines()).toHaveLength(0);
  });

  it('ROW 2: accepted once the required field IS supplied under the same sparse header', async () => {
    const row = await engine.insert('showcase_invoice_line', { invoice: 'INV-SPARSE', reason: 'awaiting status', quantity: 1 });
    expect(row).toMatchObject({ reason: 'awaiting status' });
  });

  it('ROW 2: an UPDATE that nulls the field under a sparse header is REJECTED', async () => {
    storeFor('showcase_invoice_line').set('s1', { id: 's1', invoice: 'INV-SPARSE', reason: 'stated', quantity: 1 });
    const err = await rejectionOf(() =>
      engine.update('showcase_invoice_line', { id: 's1', reason: '' }));
    expect(err.fields).toContainEqual(expect.objectContaining({ field: 'reason', code: 'required' }));
    expect(line('s1')).toMatchObject({ reason: 'stated' });
  });

  it('ROW 2: the refusal is an EVALUATED verdict — the unbound-root diagnostic is absent', async () => {
    // What tells ROW 2 apart from ROW 3: here `parent` IS bound, so nothing on
    // the channel names it as unbound. The write is refused because the
    // predicate said so, not because it could not be asked.
    const warns = await warningsDuring(() =>
      engine.insert('showcase_invoice_line', { invoice: 'INV-SPARSE', quantity: 1 }));
    expect(warns.some((w) => /requiredWhen for 'reason' reads 'parent'/.test(w))).toBe(false);
    expect(warns.some((w) => /requiredWhen for 'reason' failed to evaluate/.test(w))).toBe(false);
  });

  it('ROW 3 (unresolvable header): still FAIL-OPEN, still names the unbound root (#4977 asymmetry)', async () => {
    // The line #4977 drew and this issue does NOT move: a header that resolves
    // to nothing leaves `parent` unbound, the predicate is skipped, and the
    // write lands with the field empty. Option B (422) stays not taken.
    storeFor('showcase_invoice_line').set('orphan', { id: 'orphan', invoice: 'GONE', reason: '', quantity: 1 });
    const warns = await warningsDuring(() =>
      engine.update('showcase_invoice_line', { id: 'orphan', quantity: 9 }));
    expect(line('orphan')).toMatchObject({ quantity: 9, reason: '' });
    expect(warns.some((w) => /requiredWhen for 'reason' reads 'parent'/.test(w) && /NOT enforced/.test(w))).toBe(true);
  });

  it('ADR-0113 still holds on the newly-evaluable predicate: a legacy row may rest', async () => {
    // The stored row ALREADY violates (sparse header, `reason` empty). Making
    // the predicate evaluable must not brick unrelated edits to rows deployed
    // before it started enforcing — enforcement tightens for NEW violations.
    storeFor('showcase_invoice_line').set('legacy', { id: 'legacy', invoice: 'INV-SPARSE', reason: '', quantity: 1 });
    await engine.update('showcase_invoice_line', { id: 'legacy', quantity: 7 });
    expect(line('legacy')).toMatchObject({ quantity: 7, reason: '' });
  });

  it('judges a REPOINT onto a sparse header against the header it lands on', async () => {
    // A line with no `reason` under a Sent header (where none is required).
    // Moving it under the sparse header turns the requirement ON, and the write
    // that does the moving is the one that must be refused — the ADR-0113
    // pre-check must read the STORED row's own header, not the landing one.
    storeFor('showcase_invoice_line').set('r1', { id: 'r1', invoice: 'INV-SENT', description: 'seat', reason: '', quantity: 1 });
    const err = await rejectionOf(() =>
      engine.update('showcase_invoice_line', { id: 'r1', invoice: 'INV-SPARSE' }));
    expect(err.fields).toContainEqual(expect.objectContaining({ field: 'reason', code: 'required' }));
    expect(line('r1')).toMatchObject({ invoice: 'INV-SENT' });
  });

  it('BULK: the batch path materialises its headers too, per matched row', async () => {
    storeFor('showcase_invoice_line').set('b_sparse', { id: 'b_sparse', invoice: 'INV-SPARSE', reason: 'stated', quantity: 3 });
    storeFor('showcase_invoice_line').set('b_sent', { id: 'b_sent', invoice: 'INV-SENT', description: 'seat', quantity: 3 });
    const err = await rejectionOf(() =>
      engine.update('showcase_invoice_line', { reason: '' }, { where: { quantity: 3 }, multi: true } as any));
    expect(err.fields).toContainEqual(expect.objectContaining({ field: 'reason', code: 'required' }));
    // Rejected before anything was written — neither matched row moved.
    expect(line('b_sparse')).toMatchObject({ reason: 'stated' });
  });

  it('BULK INSERT: one batched header read still materialises every header', async () => {
    // The insert path is the bulk resolver with `data: null` — each row supplies
    // its own FK. One row lands under a header carrying `status`, one under the
    // sparse header, and only the second is required to carry `reason`.
    const err = await rejectionOf(() =>
      engine.insert('showcase_invoice_line', [
        { invoice: 'INV-SENT', description: 'seat', quantity: 1 },
        { invoice: 'INV-SPARSE', quantity: 1 },
      ] as any));
    expect(err.fields).toContainEqual(expect.objectContaining({ field: 'reason', code: 'required' }));
  });

  it('does NOT mutate the stored header row — the materialised copy stays local', async () => {
    await engine.insert('showcase_invoice_line', { invoice: 'INV-SPARSE', reason: 'stated', quantity: 1 });
    expect('status' in storeFor('showcase_invoice').get('INV-SPARSE')).toBe(false);
  });
});
