// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#18682] The ENGINE half of relationship traversal, driven end-to-end through
 * the real engine and a real driver.
 *
 * The rule-validator tests hand `related` in by hand, which pins the evaluator
 * and nothing about how the binding is produced. Everything this file asserts is
 * engine behaviour that only a call site can show (PD #10: a `case` label is not
 * enforcement — check the CALL SITE):
 *
 *  - the related read runs under SYSTEM authority (like `parent`, and for the
 *    same kind of reason: a validation verdict is the system's, not the
 *    caller's), bounded by its PROJECTION rather than by the caller;
 *  - the projection names `id` plus only the fields the rules actually read,
 *    and never smuggles a column the related object does not declare;
 *  - on UPDATE the foreign key is read off the PRIOR row when the patch omits
 *    it, so a rule still resolves;
 *  - the driver's write payload carries the foreign KEY, never the expanded
 *    related record;
 *  - a DECLARED but empty related column evaluates as `null` rather than
 *    refusing (#6457's trap, one root over and on a fail-CLOSED seam);
 *  - an unresolvable related field refuses, whichever CEL operator was written.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectQL } from './engine.js';

import '@objectstack/spec';
import '@objectstack/formula';

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
      if (k === '$and') return (v as any[]).every((w) => matches(row, w));
      if (k === '$or') return (v as any[]).some((w) => matches(row, w));
      const cond = v as any;
      if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
        if ('$in' in cond) return Array.isArray(cond.$in) && cond.$in.includes(row?.[k]);
        if ('$eq' in cond) return row?.[k] === cond.$eq;
      }
      return row?.[k] === cond;
    });
  };
  const calls: Array<{ object: string; ast: any }> = [];
  const writes: Array<{ op: string; object: string; data: any }> = [];
  let n = 0;
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find(object: string, ast: any) {
      calls.push({ object, ast });
      const rows = Array.from(storeFor(object).values()).filter((r) => matches(r, ast?.where));
      // The driver echoes ONLY the projected keys, and — like `driver-memory` —
      // omits a key whose value is `undefined`. That omission is the shape this
      // file pins the engine against.
      // Hold the caller's bound: a double that ignores `limit` lets a real
      // double-limit defect through unnoticed (`check:objectql-double-limit`).
      const bounded = typeof ast?.limit === 'number' ? rows.slice(0, ast.limit) : rows;
      const fields: string[] | undefined = ast?.fields;
      if (!fields) return bounded;
      return bounded.map((r) => {
        const out: any = {};
        for (const f of fields) if (r[f] !== undefined) out[f] = r[f];
        return out;
      });
    },
    async findOne(object: string, ast: any) {
      for (const r of storeFor(object).values()) if (matches(r, ast?.where)) return r;
      return null;
    },
    async create(object: string, data: Record<string, unknown>) {
      writes.push({ op: 'create', object, data });
      n += 1;
      const id = (data.id as string) ?? `r_${n}`;
      const row = { ...data, id };
      storeFor(object).set(id, row);
      return row;
    },
    async update(object: string, id: string, data: Record<string, unknown>) {
      writes.push({ op: 'update', object, data });
      const s = storeFor(object);
      const row = { ...s.get(id), ...data, id };
      s.set(id, row);
      return row;
    },
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
  return { driver, storeFor, calls, writes };
}

const ACTING = { userId: 'u1', positions: ['rep'] } as any;

describe('#18682 — engine-produced relationship bindings', () => {
  let engine: ObjectQL;
  let d: ReturnType<typeof makeDriver>;

  beforeEach(async () => {
    engine = new ObjectQL();
    d = makeDriver();
    engine.registerDriver(d.driver, true);
    await engine.init();
    engine.registry.registerObject({
      name: 'crm_account',
      fields: { name: { type: 'text' }, type: { type: 'text' }, secret: { type: 'text' } },
    } as any, 'test-package');
    engine.registry.registerObject({
      name: 'crm_opportunity',
      fields: {
        name: { type: 'text' },
        amount: { type: 'number' },
        account: { type: 'lookup', reference: 'crm_account' },
      },
      validations: [{
        name: 'partner_cap', type: 'script', severity: 'error',
        message: 'Partner accounts are capped at 10000.',
        condition: "record.account.type == 'partner' && record.amount > 10000",
      }],
    } as any, 'test-package');
    d.storeFor('crm_account').set('acc_p', { id: 'acc_p', name: 'P', type: 'partner', secret: 's' });
    d.storeFor('crm_account').set('acc_d', { id: 'acc_d', name: 'D', type: 'direct', secret: 's' });
    // A readable account whose `type` was never set — the driver will omit it.
    d.storeFor('crm_account').set('acc_empty', { id: 'acc_empty', name: 'E', secret: 's' });
  });

  const relatedReads = () => d.calls.filter((c) => c.object === 'crm_account');

  it('projects id plus only the fields the rules name — not the whole row', async () => {
    await engine.insert('crm_opportunity', { name: 'A', amount: 10, account: 'acc_d' }, { context: ACTING } as any);
    const fields = [...(relatedReads()[0].ast?.fields ?? [])].sort();
    expect(fields).toEqual(['id', 'type']);
    // `secret` is declared on the related object and named by no rule.
    expect(fields).not.toContain('secret');
  });

  it('costs ONE related read for a batch, not one per row', async () => {
    await engine.insert('crm_opportunity', [
      { name: 'A', amount: 10, account: 'acc_d' },
      { name: 'B', amount: 20, account: 'acc_p' },
      { name: 'C', amount: 30, account: 'acc_d' },
    ] as any, { context: ACTING } as any);
    expect(relatedReads()).toHaveLength(1);
  });

  it('ACCEPTS and REFUSES on the real write path, per the parent field', async () => {
    await expect(
      engine.insert('crm_opportunity', { name: 'ok', amount: 50000, account: 'acc_d' }, { context: ACTING } as any),
    ).resolves.toBeTruthy();
    await expect(
      engine.insert('crm_opportunity', { name: 'no', amount: 50000, account: 'acc_p' }, { context: ACTING } as any),
    ).rejects.toThrow(/Partner accounts are capped/);
  });

  it('writes the foreign KEY to the driver, never the expanded related record', async () => {
    await engine.insert('crm_opportunity', { name: 'A', amount: 10, account: 'acc_p' }, { context: ACTING } as any);
    const create = d.writes.find((w) => w.op === 'create' && w.object === 'crm_opportunity');
    expect(create!.data.account).toBe('acc_p');
    expect(typeof create!.data.account).toBe('string');
  });

  it('resolves the FK off the PRIOR row when the patch does not carry it', async () => {
    const made = await engine.insert(
      'crm_opportunity', { name: 'A', amount: 10, account: 'acc_p' }, { context: ACTING } as any,
    ) as any;
    // The patch touches `amount` only; the rule still needs the account.
    await expect(
      engine.update('crm_opportunity', { amount: 50000 }, { where: { id: made.id }, context: ACTING } as any),
    ).rejects.toThrow(/Partner accounts are capped/);
  });

  // #6457 one root over: a readable column the driver did not echo must not
  // refuse a valid write. The engine materialises it to `null`.
  it('ACCEPTS when a readable related column is simply empty', async () => {
    await expect(
      engine.insert('crm_opportunity', { name: 'A', amount: 50000, account: 'acc_empty' }, { context: ACTING } as any),
    ).resolves.toBeTruthy();
  });

  // ⭐ The ruled read authority: a validation rule's output is a pass/fail the
  // SYSTEM enforces, so the related row is read under system authority and the
  // rule is authorable for exactly the persona it exists to constrain. Bounded
  // by the PROJECTION, never by the caller.
  it('reads the related row under SYSTEM authority', async () => {
    const seen: any[] = [];
    engine.registerMiddleware(async (opCtx: any, next: () => Promise<void>) => {
      if (opCtx?.objectName === 'crm_account' || opCtx?.object === 'crm_account') seen.push(opCtx);
      await next();
    });
    await engine.insert('crm_opportunity', { name: 'A', amount: 10, account: 'acc_d' }, { context: ACTING } as any);
    const ctx = seen[0].context ?? seen[0].executionContext;
    expect(ctx?.isSystem).toBe(true);
    // …and the acting identity is carried through, so audit still sees who wrote.
    expect(ctx?.userId).toBe('u1');
  });

  // ⛔ The bound on the elevation. A predicate that names a column the related
  // object does not declare must NOT put that name into a system-authority
  // query — the projection is the whole of what limits an elevated read.
  it('never smuggles an UNDECLARED field into the system read set', async () => {
    engine.registry.registerObject({
      name: 'crm_opportunity',
      fields: {
        name: { type: 'text' }, amount: { type: 'number' },
        account: { type: 'lookup', reference: 'crm_account' },
      },
      validations: [{ name: 'sneaky', type: 'script', severity: 'error', message: 'x',
        condition: "record.account.not_a_column == 'x'" }],
    } as any, 'test-package');
    d.calls.length = 0;
    await expect(
      engine.insert('crm_opportunity', { name: 'A', amount: 1, account: 'acc_p' }, { context: ACTING } as any),
    ).rejects.toThrow(/declares no 'not_a_column'/);
    // The read either never happened or never named the column.
    for (const call of d.calls.filter((c) => c.object === 'crm_account')) {
      expect(call.ast?.fields ?? []).not.toContain('not_a_column');
    }
  });

  // The refusal is about the WRITE, never about the value. A caller can infer a
  // value by observing refusals — an accepted, deliberately narrow channel — so
  // nothing may make the refusal more informative than "this rule refused".
  it('never echoes the related VALUE in the refusal', async () => {
    await expect(
      engine.insert('crm_opportunity', { name: 'A', amount: 50000, account: 'acc_p' }, { context: ACTING } as any),
    ).rejects.toThrow(/Partner accounts are capped/);
    try {
      engine.registry.registerObject({
        name: 'crm_opportunity',
        fields: {
          name: { type: 'text' }, amount: { type: 'number' },
          account: { type: 'lookup', reference: 'crm_account' },
        },
        validations: [{ name: 'sneaky', type: 'script', severity: 'error', message: 'x',
          condition: "record.account.not_a_column == 'x'" }],
      } as any, 'test-package');
      await engine.insert('crm_opportunity', { name: 'A', amount: 1, account: 'acc_p' }, { context: ACTING } as any);
    } catch (e) {
      const text = JSON.stringify((e as any).fields ?? (e as Error).message);
      // 'partner' / 'P' / 's' are the stored values on acc_p.
      expect(text).not.toContain('partner');
      expect(text).not.toContain('"s"');
    }
  });

  it('the dry run agrees with the write it previews', async () => {
    const preview = await engine.validate(
      'crm_opportunity', { name: 'A', amount: 50000, account: 'acc_d' },
      { mode: 'insert', context: ACTING } as any,
    );
    expect(preview.results?.[0]?.valid).toBe(true);
    await expect(
      engine.insert('crm_opportunity', { name: 'A', amount: 50000, account: 'acc_d' }, { context: ACTING } as any),
    ).resolves.toBeTruthy();

    const refused = await engine.validate(
      'crm_opportunity', { name: 'B', amount: 50000, account: 'acc_p' },
      { mode: 'insert', context: ACTING } as any,
    );
    expect(refused.results?.[0]?.valid).toBe(false);
  });

  // ⭐ THE REPAIR THE REFUSAL PRESCRIBES MUST ACTUALLY WORK.
  //
  // The conflict arm tells an author to compare `record.<fk>.id`. The primary
  // key is declared by the platform, not by the author, so it is absent from
  // every object's field map — which made the engine refuse the very spelling
  // it had just prescribed, and then prescribe declaring `id` on the related
  // object, which is equally impossible. An actively misleading prescription is
  // worse than none (ADR-0078 §6), so this drives the loop end to end: take the
  // message the refusal emits, write the rule it asks for, and require that it
  // is ACCEPTED.
  it('accepts the repair its own refusal prescribes', async () => {
    const mixed = "record.account.type == 'partner' && record.account == 'acc_p'";
    engine.registry.registerObject({
      name: 'crm_opportunity',
      fields: {
        name: { type: 'text' }, amount: { type: 'number' },
        account: { type: 'lookup', reference: 'crm_account' },
      },
      validations: [{ name: 'mixed', type: 'script', severity: 'error', message: 'x', condition: mixed }],
    } as any, 'test-package');

    let prescription = '';
    try {
      await engine.insert('crm_opportunity', { name: 'A', amount: 1, account: 'acc_p' }, { context: ACTING } as any);
      throw new Error('expected the mixed shape to be refused');
    } catch (e) {
      prescription = JSON.stringify((e as any).fields ?? (e as Error).message);
    }
    // The refusal names the repair…
    expect(prescription).toContain('record.account.id');

    // …and the repair is accepted, on the same engine, against the same row.
    engine.registry.registerObject({
      name: 'crm_opportunity',
      fields: {
        name: { type: 'text' }, amount: { type: 'number' },
        account: { type: 'lookup', reference: 'crm_account' },
      },
      validations: [{
        name: 'repaired', type: 'script', severity: 'error', message: 'partner acc_p is capped',
        condition: "record.account.type == 'partner' && record.account.id == 'acc_p' && record.amount > 10000",
      }],
    } as any, 'test-package');

    // Under the cap: accepted, and NOT with an unevaluable fault.
    await expect(
      engine.insert('crm_opportunity', { name: 'ok', amount: 10, account: 'acc_p' }, { context: ACTING } as any),
    ).resolves.toBeTruthy();
    // Over the cap: the rule fires for real, so `.id` genuinely resolved.
    await expect(
      engine.insert('crm_opportunity', { name: 'no', amount: 50000, account: 'acc_p' }, { context: ACTING } as any),
    ).rejects.toThrow(/partner acc_p is capped/);
  });

  // The gate that keeps the accepted inference channel to writers only. A
  // caller who could not perform this write gets NO elevated read at all.
  it('issues NO elevated read in validate() for a caller who may not write', async () => {
    (engine as any).registerWriteGateProbe(async () => false);
    d.calls.length = 0;
    const preview = await engine.validate(
      'crm_opportunity', { name: 'A', amount: 50000, account: 'acc_d' },
      { mode: 'insert', context: ACTING } as any,
    );
    // ⛔ Nothing was read on the related object.
    expect(d.calls.filter((c) => c.object === 'crm_account')).toHaveLength(0);
    // …and the preview refuses rather than answering from data it never read.
    expect(preview.results?.[0]?.valid).toBe(false);
  });

  it('issues the elevated read in validate() for a caller who MAY write', async () => {
    (engine as any).registerWriteGateProbe(async () => true);
    d.calls.length = 0;
    const preview = await engine.validate(
      'crm_opportunity', { name: 'A', amount: 50000, account: 'acc_d' },
      { mode: 'insert', context: ACTING } as any,
    );
    expect(d.calls.filter((c) => c.object === 'crm_account').length).toBeGreaterThan(0);
    expect(preview.results?.[0]?.valid).toBe(true);
  });

  it('pays nothing when no rule traverses', async () => {
    engine.registry.registerObject({
      name: 'plain',
      fields: { name: { type: 'text' }, account: { type: 'lookup', reference: 'crm_account' } },
      validations: [{ name: 'n', type: 'script', condition: "record.name == ''", message: 'x' }],
    } as any, 'test-package');
    d.calls.length = 0;
    await engine.insert('plain', { name: 'A', account: 'acc_p' }, { context: ACTING } as any);
    expect(d.calls.filter((c) => c.object === 'crm_account')).toHaveLength(0);
  });
});
