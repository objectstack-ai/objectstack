// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #4889 — PARENT-scoped `readonlyWhen` is a SERVER guarantee.
//
// `readonlyWhen: parent.status == 'paid'` on `showcase_invoice_line.{quantity,
// unit_price}` reads, in the showcase's own words, "once the header invoice is
// Paid, its lines are frozen". It was enforced only in the client grid: the
// server-side strip bound `record` and `previous` and nothing else, so every
// `parent.*` predicate faulted, took the fail-OPEN branch, and the write landed
// with a 200 while the UI still drew the cell locked. ADR-0057 D10 puts
// enforcement on the SERVER and makes the client courtesy; this suite pins that
// direction end-to-end through the real engine + a real driver, not through the
// strip function in isolation (PD #10: a `case` label is not enforcement —
// check the CALL SITE).
//
// The record-scoped contrast the issue drew — `showcase_invoice.tax_rate` with
// `readonlyWhen: record.status == 'paid'`, which worked all along — is pinned in
// the same file so a future change cannot fix one by breaking the other.
//
// #6457 extends this suite rather than starting its own, because what it changes
// is the same binding this file already owns: the header the engine resolves is
// now TOTAL over the MASTER object's declared fields, so a `parent.<field>`
// predicate no longer depends on which columns the driver echoed back. Only the
// MIDDLE row of the issue's verdict table moves (resolved-but-sparse: fail-OPEN
// ⇒ evaluated); the fail-CLOSED line above (unresolvable ⇒ LOCKED) is asserted
// unchanged, on the same fixtures, in the same block.

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

describe('parent-scoped readonlyWhen is enforced server-side (#4889)', () => {
  let engine: ObjectQL;
  let storeFor: ReturnType<typeof makeDriver>['storeFor'];

  beforeEach(async () => {
    engine = new ObjectQL();
    const d = makeDriver();
    storeFor = d.storeFor;
    engine.registerDriver(d.driver, true);
    await engine.init();
    // The showcase's shape, trimmed to what the lock needs
    // (`examples/app-showcase/src/data/objects/invoice.object.ts`).
    engine.registry.registerObject({
      name: 'showcase_invoice',
      fields: {
        invoice_number: { type: 'text' },
        status: { type: 'select', options: [{ value: 'draft' }, { value: 'sent' }, { value: 'paid' }] },
        // The RECORD-scoped contrast (invoice.object.ts L144).
        tax_rate: { type: 'number', readonlyWhen: "record.status == 'paid'" },
      },
    } as any);
    engine.registry.registerObject({
      name: 'showcase_invoice_line',
      fields: {
        invoice: { type: 'master_detail', reference: 'showcase_invoice', required: true },
        // PARENT-scoped (invoice.object.ts L201/L219/L225).
        product: { type: 'lookup', reference: 'showcase_product', readonlyWhen: "parent.status == 'paid'" },
        quantity: { type: 'number', readonlyWhen: "parent.status == 'paid'" },
        unit_price: { type: 'currency', readonlyWhen: "parent.status == 'paid'" },
        // No lock at all — a line is still editable in the ways the author left open.
        description: { type: 'text' },
        // [#6457] The issue's own predicate — a lock that reads a header key the
        // driver may or may not have echoed back. TRUE on a header carrying no
        // `status`, which is what makes the middle-row flip observable.
        locked_until_status: { type: 'text', readonlyWhen: 'parent.status == null' },
        // [#6457] The recorded CONSEQUENCE (#4953's, one root over): a
        // materialised `null` is a PRESENT key, so `has()` over a DECLARED
        // master field is uniformly TRUE.
        has_guard: { type: 'text', readonlyWhen: 'has(parent.status)' },
        // [#6457] The #4649 line, unmoved: materialisation covers the master's
        // DECLARED fields only, so an author typo on the header stays
        // unevaluable — and therefore fail-OPEN — instead of reading as null.
        typo_guard: { type: 'text', readonlyWhen: 'parent.stauts == null' },
      },
    } as any);

    storeFor('showcase_invoice').set('INV-1003', { id: 'INV-1003', invoice_number: 'INV-1003', status: 'paid', tax_rate: 8 });
    storeFor('showcase_invoice').set('INV-1004', { id: 'INV-1004', invoice_number: 'INV-1004', status: 'draft', tax_rate: 8 });
    // [#6457] A header row the driver returned WITHOUT its `status` column — the
    // MIDDLE row of the issue's verdict table. `status` is declared on the
    // master; this row simply does not carry the key.
    storeFor('showcase_invoice').set('INV-SPARSE', { id: 'INV-SPARSE', invoice_number: 'INV-SPARSE' });
    storeFor('showcase_invoice_line').set('line_paid', { id: 'line_paid', invoice: 'INV-1003', quantity: 6, unit_price: 49.99, description: 'seat' });
    storeFor('showcase_invoice_line').set('line_draft', { id: 'line_draft', invoice: 'INV-1004', quantity: 3, unit_price: 10, description: 'seat' });
    storeFor('showcase_invoice_line').set('line_sparse', {
      id: 'line_sparse', invoice: 'INV-SPARSE', quantity: 1, unit_price: 5,
      // A description OUTSIDE the 'seat' match set the bulk tests above use.
      description: 'sparse', locked_until_status: 'kept', has_guard: 'kept', typo_guard: 'kept',
    });
  });

  const line = (id: string) => storeFor('showcase_invoice_line').get(id);
  const invoice = (id: string) => storeFor('showcase_invoice').get(id);

  /** Everything the engine warned during one write — the strip's own channel,
   *  which is how the fail-OPEN exit and the LOCKED exits are told apart. */
  async function warningsDuring(run: () => Promise<unknown>): Promise<string[]> {
    const warns: string[] = [];
    const base = (engine as any).logger;
    (engine as any).logger = new Proxy(base, {
      get: (t: any, k: string) => (k === 'warn' ? (m: string) => warns.push(String(m)) : t[k]),
    });
    try {
      await run();
    } finally {
      (engine as any).logger = base;
    }
    return warns;
  }

  it('THE REGRESSION: a paid invoice\'s frozen line survives the PATCH that used to rewrite it', async () => {
    // Verbatim from the issue: PATCH {"quantity":9999,"unit_price":0.01} on a
    // line of the PAID invoice INV-1003 returned 200 and PERSISTED.
    await engine.update('showcase_invoice_line', { id: 'line_paid', quantity: 9999, unit_price: 0.01 });
    expect(line('line_paid')).toMatchObject({ quantity: 6, unit_price: 49.99 });
  });

  it('reports the strip to the caller as reason `readonly_when` (#3407 observability)', async () => {
    const events: any[] = [];
    await engine.update(
      'showcase_invoice_line',
      { id: 'line_paid', quantity: 9999 },
      { onFieldsDropped: (e: any) => events.push(e) } as any,
    );
    expect(events).toEqual([
      { object: 'showcase_invoice_line', fields: ['quantity'], reason: 'readonly_when' },
    ]);
  });

  it('leaves an unlocked field on the SAME locked row writable', async () => {
    await engine.update('showcase_invoice_line', { id: 'line_paid', quantity: 9999, description: 'renamed' });
    expect(line('line_paid')).toMatchObject({ quantity: 6, description: 'renamed' });
  });

  it('does NOT lock a line whose header is still draft (no false positives)', async () => {
    await engine.update('showcase_invoice_line', { id: 'line_draft', quantity: 42, unit_price: 12.5 });
    expect(line('line_draft')).toMatchObject({ quantity: 42, unit_price: 12.5 });
  });

  it('judges a REPOINT against the master the write lands on, not the one it leaves', async () => {
    // Moving a draft line onto the PAID invoice: the incoming `invoice` value is
    // the master whose state decides the lock.
    await engine.update('showcase_invoice_line', { id: 'line_draft', invoice: 'INV-1003', quantity: 777 });
    expect(line('line_draft')).toMatchObject({ invoice: 'INV-1003', quantity: 3 });
  });

  it('holds the field LOCKED when the header cannot be resolved (fail-CLOSED)', async () => {
    storeFor('showcase_invoice_line').set('orphan', { id: 'orphan', invoice: 'GONE', quantity: 1 });
    await engine.update('showcase_invoice_line', { id: 'orphan', quantity: 9999 });
    // An unresolvable `parent` is NOT read as "unlocked" — the declared lock is
    // not waived just because the platform could not check it.
    expect(line('orphan')).toMatchObject({ quantity: 1 });
  });

  it('enforces the lock on the BULK path too, per matched row (#3042 shape)', async () => {
    // One paid line + one draft line in the match set. `readonlyWhen` locked in
    // ≥1 matched row ⇒ the field is dropped for the whole batch.
    await engine.update('showcase_invoice_line', { quantity: 9999 }, { where: { description: 'seat' }, multi: true } as any);
    expect(line('line_paid')).toMatchObject({ quantity: 6 });
    expect(line('line_draft')).toMatchObject({ quantity: 3 });
  });

  it('leaves a bulk edit that touches only draft-header lines alone', async () => {
    await engine.update('showcase_invoice_line', { quantity: 55 }, { where: { invoice: 'INV-1004' }, multi: true } as any);
    expect(line('line_draft')).toMatchObject({ quantity: 55 });
    expect(line('line_paid')).toMatchObject({ quantity: 6 });
  });

  it('CONTRAST: the record-scoped lock on the header still works (and still only when TRUE)', async () => {
    await engine.update('showcase_invoice', { id: 'INV-1003', tax_rate: 99 });
    expect(invoice('INV-1003')).toMatchObject({ tax_rate: 8 });

    await engine.update('showcase_invoice', { id: 'INV-1004', tax_rate: 99 });
    expect(invoice('INV-1004')).toMatchObject({ tax_rate: 99 });
  });

  it('reads the header ONCE per single-id write, and not at all without a parent-scoped lock', async () => {
    const reads: string[] = [];
    const original = (engine as any).findOne.bind(engine);
    (engine as any).findOne = async (name: string, q: any, o?: any) => {
      reads.push(name);
      return original(name, q, o);
    };
    await engine.update('showcase_invoice_line', { id: 'line_paid', quantity: 9999 });
    expect(reads.filter((r) => r === 'showcase_invoice')).toHaveLength(1);

    // A payload touching no parent-scoped field pays nothing.
    reads.length = 0;
    await engine.update('showcase_invoice_line', { id: 'line_paid', description: 'note' });
    expect(reads.filter((r) => r === 'showcase_invoice')).toHaveLength(0);
  });

  // ── #6457 — the resolved header is TOTAL over the MASTER's declared fields ──
  //
  // The issue's three-row verdict table, pinned end-to-end. Exactly one row
  // moves. The other two — including #4889's fail-CLOSED line — are asserted on
  // the same fixtures precisely so the move cannot quietly take them with it,
  // and they are told apart by FAULT CHANNEL, not by the write's outcome: rows 2
  // and 3 can both end in "the field was not written", and only the warning says
  // whether that was an evaluated verdict or a refusal to guess.

  it('ROW 1 (header carries the key): evaluates as it always did, verdict unchanged', async () => {
    // INV-1003 carries `status: 'paid'`, so `parent.status == null` is FALSE and
    // the field is writable. No fault ⇒ nothing on the fail-open channel.
    const warns = await warningsDuring(() =>
      engine.update('showcase_invoice_line', { id: 'line_paid', locked_until_status: 'written' }));
    expect(line('line_paid')).toMatchObject({ locked_until_status: 'written' });
    expect(warns.some((w) => w.includes('failed to evaluate — change allowed through'))).toBe(false);
  });

  it('ROW 2 — THE FIX: a header missing the key now LOCKS instead of failing open', async () => {
    // Before #6457 this was `No such key: status` on a BOUND `parent`, so
    // `unknownVariableOf` did not match, the ordinary fail-OPEN exit ran, and
    // the declared lock was let through. The header is now total over the
    // master's declared fields, so `status` reads `null`, the predicate is TRUE,
    // and the field is stripped.
    const warns = await warningsDuring(() =>
      engine.update('showcase_invoice_line', { id: 'line_sparse', locked_until_status: 'forged' }));
    expect(line('line_sparse')).toMatchObject({ locked_until_status: 'kept' });
    // The verdict came from an EVALUATION: the fail-open exit is not on the
    // channel at all…
    expect(warns.some((w) => w.includes('failed to evaluate — change allowed through'))).toBe(false);
    expect(warns.some((w) => w.includes("Field 'locked_until_status' is read-only (readonlyWhen)"))).toBe(true);
    // …and it is NOT #4889's unbound-root exit either — `parent` IS bound here.
    // This is the assertion that keeps ROW 2 and ROW 3 distinguishable.
    expect(warns.some((w) => w.includes("reads 'parent'"))).toBe(false);
  });

  it('ROW 2: the strip is reported to the caller as `readonly_when` (#3407)', async () => {
    const events: any[] = [];
    await engine.update(
      'showcase_invoice_line',
      { id: 'line_sparse', locked_until_status: 'forged' },
      { onFieldsDropped: (e: any) => events.push(e) } as any,
    );
    expect(events).toEqual([
      { object: 'showcase_invoice_line', fields: ['locked_until_status'], reason: 'readonly_when' },
    ]);
  });

  it('ROW 3 (unresolvable header): still LOCKED, and still by the UNBOUND-ROOT exit (#4889)', async () => {
    // The fail-closed line, unmoved and byte-identical: materialisation is only
    // ever applied to a row that EXISTS, so a header that resolves to nothing
    // still leaves `parent` unbound and still faults as `Unknown variable`.
    storeFor('showcase_invoice_line').set('orphan', { id: 'orphan', invoice: 'GONE', locked_until_status: 'kept' });
    const warns = await warningsDuring(() =>
      engine.update('showcase_invoice_line', { id: 'orphan', locked_until_status: 'forged' }));
    expect(line('orphan')).toMatchObject({ locked_until_status: 'kept' });
    expect(warns.some((w) => w.includes("reads 'parent'") && w.includes('LOCKED'))).toBe(true);
  });

  it('a sparse header that answers FALSE allows the change — by a VERDICT, not by a fault', async () => {
    // `parent.status == 'paid'` over a header carrying no status now evaluates
    // to FALSE. The write lands either way; what changed is why, and the why is
    // what every other predicate on that header depends on.
    const warns = await warningsDuring(() =>
      engine.update('showcase_invoice_line', { id: 'line_sparse', quantity: 42 }));
    expect(line('line_sparse')).toMatchObject({ quantity: 42 });
    expect(warns.some((w) => w.includes('failed to evaluate — change allowed through'))).toBe(false);
  });

  it('CONSEQUENCE: `has(parent.<declared>)` is uniformly TRUE — it locks even on a sparse header', async () => {
    // CEL's own rule, the same one #4953 recorded for `record`: a materialised
    // `null` is a PRESENT key. `has()` guards against an UNDECLARED key on the
    // header, not against an empty value — test emptiness with `!= null`.
    await engine.update('showcase_invoice_line', { id: 'line_sparse', has_guard: 'forged' });
    expect(line('line_sparse')).toMatchObject({ has_guard: 'kept' });
  });

  it('BOUNDARY: an UNDECLARED key on the header stays unevaluable — fail-OPEN (#4649 unmoved)', async () => {
    // `parent.stauts` is a typo, not a sparse column. Materialising it would
    // paper over the bug; it must stay reportable.
    const warns = await warningsDuring(() =>
      engine.update('showcase_invoice_line', { id: 'line_sparse', typo_guard: 'written' }));
    expect(line('line_sparse')).toMatchObject({ typo_guard: 'written' });
    expect(warns.some((w) => w.includes('failed to evaluate — change allowed through'))).toBe(true);
  });

  it('does NOT mutate the stored header row — the materialised copy stays local', async () => {
    // The in-memory driver hands back the stored object BY REFERENCE, which is
    // exactly how a materialisation leaks: the header would silently gain a
    // `status: null` column that every later reader (and after-hooks) sees.
    await engine.update('showcase_invoice_line', { id: 'line_sparse', locked_until_status: 'forged' });
    expect('status' in invoice('INV-SPARSE')).toBe(false);
    expect(invoice('INV-SPARSE')).toEqual({ id: 'INV-SPARSE', invoice_number: 'INV-SPARSE' });
  });

  it('BULK: the batch path materialises its headers too, per matched row', async () => {
    await engine.update(
      'showcase_invoice_line',
      { locked_until_status: 'forged' },
      { where: { description: 'sparse' }, multi: true } as any,
    );
    expect(line('line_sparse')).toMatchObject({ locked_until_status: 'kept' });
  });

  it('BULK: a batch under a header that DOES carry the key still writes', async () => {
    await engine.update(
      'showcase_invoice_line',
      { locked_until_status: 'written' },
      { where: { description: 'seat' }, multi: true } as any,
    );
    expect(line('line_paid')).toMatchObject({ locked_until_status: 'written' });
    expect(line('line_draft')).toMatchObject({ locked_until_status: 'written' });
  });

  it('BULK: an unresolvable header still LOCKS the batch (fail-CLOSED, bulk twin)', async () => {
    storeFor('showcase_invoice_line').set('orphan_b', {
      id: 'orphan_b', invoice: 'GONE', description: 'orphaned', locked_until_status: 'kept',
    });
    await engine.update(
      'showcase_invoice_line',
      { locked_until_status: 'forged' },
      { where: { description: 'orphaned' }, multi: true } as any,
    );
    expect(line('orphan_b')).toMatchObject({ locked_until_status: 'kept' });
  });

  it('costs no extra header read — materialisation is a registry lookup, not a query', async () => {
    const reads: string[] = [];
    const original = (engine as any).findOne.bind(engine);
    (engine as any).findOne = async (name: string, q: any, o?: any) => {
      reads.push(name);
      return original(name, q, o);
    };
    await engine.update('showcase_invoice_line', { id: 'line_sparse', locked_until_status: 'forged' });
    expect(reads.filter((r) => r === 'showcase_invoice')).toHaveLength(1);
  });
});
