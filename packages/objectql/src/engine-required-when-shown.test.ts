// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0113 D1, as amended — `required` + the field's own `visibleWhen` is
// required WHEN SHOWN, on every engine write door.
//
// The defect (objectstack#34905, measured on 18.5.0): a field that is
// `required` and hidden by its `visibleWhen` was still enforced on save, so
// every record outside the condition refused every write — even an edit of an
// unrelated field — naming a field the user could not see or fill.
//
// What this file pins, through the real engine and an in-memory driver so
// "nothing is persisted" is read off the store:
//
//  (a) the WIDENING — predicate cleanly FALSE on the merged record ⇒ the
//      requirement is waived, on insert, on an unrelated edit, and on the
//      form's clear-on-hide `null`;
//  (b) the NARROWING — a write that REVEALS the field without filling it is
//      refused (verdict on the merged record, compliance on the prior record),
//      by id and on the bulk path, where one failing row refuses the batch;
//  (c) a FAULT counts as shown — the field keeps the unconditional `required`
//      it had before the amendment, the write is NOT refused for the fault
//      itself (not ADR-0137 D2's arm), and the fault is logged;
//  (d) the acting user is bound as `current_user`, so a role-gated predicate is
//      judged per writer, and a system write with no user counts as shown;
//  (e) the dry run agrees, and a plain `required` with no `visibleWhen` is
//      untouched (no prior read, D1's over-approximation kept).

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectQL } from './engine.js';
import { needsPriorRecord } from './validation/rule-validator.js';

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
      const rows = Array.from(storeFor(object).values()).filter((r) => matches(r, ast?.where));
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

/** The error a write threw, or a failure saying it was accepted. */
async function refusalOf(run: () => Promise<unknown>): Promise<any> {
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

/** The ADR-0112 envelope of a `required` refusal naming one field. */
function expectRequired(err: any, field: string, cleared = false) {
  expect(err.name).toBe('ValidationError');
  expect(err.code).toBe('VALIDATION_FAILED');
  const entry = (err.fields as any[]).find((f) => f.field === field);
  expect(entry).toMatchObject({ field, code: 'required' });
  // The clear-out case keeps its distinct sentence (`required_cleared`).
  if (cleared) expect(entry.message).toMatch(/required and cannot be cleared/);
  else expect(entry.message).not.toMatch(/cannot be cleared/);
  return entry;
}

function capturingLogger() {
  const lines: Array<{ level: string; msg: string; meta?: any }> = [];
  const push = (level: string) => (msg: string, meta?: any) => void lines.push({ level, msg: String(msg), meta });
  const logger: any = {
    lines,
    trace() {}, fatal() {},
    debug: push('debug'), info: push('info'), warn: push('warn'), error: push('error'),
    child() { return logger; },
  };
  return logger;
}

const ADMIN = { context: { userId: 'u_admin', positions: ['org_admin'] } } as any;
const MEMBER = { context: { userId: 'u_member', positions: ['org_member'] } } as any;

describe('ADR-0113 D1 (amended) — `required` + `visibleWhen` is required when shown', () => {
  let engine: ObjectQL;
  let logger: ReturnType<typeof capturingLogger>;
  let storeFor: ReturnType<typeof makeDriver>['storeFor'];

  beforeEach(async () => {
    logger = capturingLogger();
    engine = new ObjectQL({ logger });
    const d = makeDriver();
    storeFor = d.storeFor;
    engine.registerDriver(d.driver, true);
    await engine.init();
    engine.registry.registerObject({
      name: 'rws_account',
      fields: {
        name: { type: 'text' },
        owner: { type: 'text' },
        tier: { type: 'text' },
        // The card's field: required, shown only for one tier.
        vip_note: { type: 'text', required: true, visibleWhen: "record.tier == 'vip'" },
      },
    } as any, 'test-package');
    engine.registry.registerObject({
      name: 'rws_fault',
      fields: {
        status: { type: 'text' },
        // An author typo — `statsu` is declared nowhere: the predicate faults.
        reason: { type: 'text', required: true, visibleWhen: "record.statsu == 'closed'" },
      },
    } as any, 'test-package');
    engine.registry.registerObject({
      name: 'rws_role',
      fields: {
        title: { type: 'text' },
        // Older stored metadata: a role-gated field predicate (today's lint
        // refuses the root at authoring; the server still judges what is stored).
        audit_note: { type: 'text', required: true, visibleWhen: "'org_admin' in current_user.positions" },
      },
    } as any, 'test-package');
    engine.registry.registerObject({
      name: 'rws_formula',
      fields: {
        amount: { type: 'number' },
        // Computed on read, never stored from the write payload.
        risk_level: { type: 'formula', expression: "record.amount > 100 ? 'high' : 'low'", returnType: 'text' },
        review_note: { type: 'text', required: true, visibleWhen: "record.risk_level == 'high'" },
      },
    } as any, 'test-package');
    engine.registry.registerObject({
      name: 'rws_formula_fault',
      fields: {
        amount: { type: 'number' },
        // An author typo inside the formula: it cannot be computed on any row.
        risk_level: { type: 'formula', expression: "record.amout > 100 ? 'high' : 'low'", returnType: 'text' },
        review_note: { type: 'text', required: true, visibleWhen: "record.risk_level == 'high'" },
      },
    } as any, 'test-package');
    engine.registry.registerObject({
      name: 'rws_flag',
      fields: {
        title: { type: 'text' },
        is_vip: { type: 'boolean' },
        // A bare-boolean predicate: an unset flag is null, not FALSE.
        perk_note: { type: 'text', required: true, visibleWhen: 'record.is_vip' },
      },
    } as any, 'test-package');
    engine.registry.registerObject({
      name: 'rws_plain',
      fields: {
        title: { type: 'text' },
        code: { type: 'text', required: true },
      },
    } as any, 'test-package');
  });

  const rows = (object: string) => [...storeFor(object).values()];

  // ── (a) the widening ─────────────────────────────────────────────────────

  describe('(a) predicate cleanly FALSE ⇒ the requirement is waived', () => {
    it('an INSERT outside the condition is accepted without the field', async () => {
      const row = await engine.insert('rws_account', { name: 'Acme', tier: 'basic' });
      expect(row).toMatchObject({ name: 'Acme', tier: 'basic' });
      expect(rows('rws_account')).toHaveLength(1);
    });

    it('an edit of an unrelated field on a record outside the condition is accepted (the card)', async () => {
      storeFor('rws_account').set('a1', { id: 'a1', name: 'Acme', tier: 'basic', owner: 'u1', vip_note: null });
      await engine.update('rws_account', { id: 'a1', owner: 'u2' });
      expect(storeFor('rws_account').get('a1')).toMatchObject({ owner: 'u2', vip_note: null });
    });

    it("the form's clear-on-hide `null` is accepted when the write moves the record out of the condition", async () => {
      storeFor('rws_account').set('a2', { id: 'a2', name: 'Acme', tier: 'vip', vip_note: 'keep warm' });
      await engine.update('rws_account', { id: 'a2', tier: 'basic', vip_note: null });
      expect(storeFor('rws_account').get('a2')).toMatchObject({ tier: 'basic', vip_note: null });
    });
  });

  // ── (b) the narrowing ────────────────────────────────────────────────────

  describe('(b) predicate TRUE ⇒ required, and a reveal without filling is refused', () => {
    it('an INSERT inside the condition without the field is refused — nothing stored', async () => {
      const err = await refusalOf(() => engine.insert('rws_account', { name: 'Acme', tier: 'vip' }));
      expectRequired(err, 'vip_note');
      expect(rows('rws_account')).toHaveLength(0);
    });

    it('an INSERT inside the condition with the field is accepted', async () => {
      await engine.insert('rws_account', { name: 'Acme', tier: 'vip', vip_note: 'call weekly' });
      expect(rows('rws_account')).toHaveLength(1);
    });

    it('an UPDATE that reveals the field without filling it is refused — the row is untouched', async () => {
      storeFor('rws_account').set('a3', { id: 'a3', name: 'Acme', tier: 'basic', vip_note: null });
      const err = await refusalOf(() => engine.update('rws_account', { id: 'a3', tier: 'vip' }));
      expectRequired(err, 'vip_note');
      expect(storeFor('rws_account').get('a3')).toEqual({ id: 'a3', name: 'Acme', tier: 'basic', vip_note: null });
    });

    it('…and the same reveal WITH the field filled is accepted', async () => {
      storeFor('rws_account').set('a4', { id: 'a4', name: 'Acme', tier: 'basic', vip_note: null });
      await engine.update('rws_account', { id: 'a4', tier: 'vip', vip_note: 'call weekly' });
      expect(storeFor('rws_account').get('a4')).toMatchObject({ tier: 'vip', vip_note: 'call weekly' });
    });

    it('clearing the field while it is shown is refused with the clear-out sentence', async () => {
      storeFor('rws_account').set('a5', { id: 'a5', name: 'Acme', tier: 'vip', vip_note: 'call weekly' });
      const err = await refusalOf(() => engine.update('rws_account', { id: 'a5', vip_note: null }));
      expectRequired(err, 'vip_note', true);
      expect(storeFor('rws_account').get('a5')).toMatchObject({ vip_note: 'call weekly' });
    });

    it('a row already shown and empty rests: an unrelated edit, and an explicit null onto it, are accepted', async () => {
      storeFor('rws_account').set('a6', { id: 'a6', name: 'Acme', tier: 'vip', vip_note: null });
      await engine.update('rws_account', { id: 'a6', owner: 'u3' });
      await engine.update('rws_account', { id: 'a6', vip_note: null });
      expect(storeFor('rws_account').get('a6')).toMatchObject({ owner: 'u3', vip_note: null });
    });

    it('a BULK update that reveals the field on one empty row refuses the whole batch, naming that row', async () => {
      storeFor('rws_account').set('b1', { id: 'b1', name: 'One', tier: 'basic', owner: 'x', vip_note: 'filled' });
      storeFor('rws_account').set('b2', { id: 'b2', name: 'Two', tier: 'basic', owner: 'x', vip_note: null });
      const err = await refusalOf(() =>
        engine.update('rws_account', { tier: 'vip' }, { where: { owner: 'x' }, multi: true } as any));
      const entry = expectRequired(err, 'vip_note');
      expect(entry.message).toContain('(record b2)');
      expect(rows('rws_account').map((r) => r.tier)).toEqual(['basic', 'basic']);
    });
  });

  // ── (c) a fault counts as shown ──────────────────────────────────────────

  describe('(c) a predicate that faults counts as shown, and says so in the log', () => {
    it('an INSERT without the field is refused as `required` (not the D2 `rule_violation`), and the fault is logged', async () => {
      const err = await refusalOf(() => engine.insert('rws_fault', { status: 'closed' }));
      expectRequired(err, 'reason');
      expect((err.fields as any[]).some((f) => f.code === 'rule_violation')).toBe(false);
      const line = logger.lines.find((l: any) => l.level === 'warn' && l.msg.includes("visibleWhen of required field 'reason'"));
      expect(line?.meta).toMatchObject({ field: 'reason', reason: 'predicate-fault' });
      expect(rows('rws_fault')).toHaveLength(0);
    });

    it('an INSERT with the field is accepted — the fault costs the waiver, never the write', async () => {
      await engine.insert('rws_fault', { status: 'closed', reason: 'duplicate' });
      expect(rows('rws_fault')).toHaveLength(1);
    });

    it('an UPDATE keeps the pre-amendment answers: a clear is refused, an unrelated edit of a null row rests', async () => {
      storeFor('rws_fault').set('f1', { id: 'f1', status: 'open', reason: 'dup' });
      storeFor('rws_fault').set('f2', { id: 'f2', status: 'open', reason: null });
      const err = await refusalOf(() => engine.update('rws_fault', { id: 'f1', reason: '' }));
      expectRequired(err, 'reason', true);
      await engine.update('rws_fault', { id: 'f2', status: 'closed' });
      expect(storeFor('rws_fault').get('f2')).toMatchObject({ status: 'closed', reason: null });
    });
  });

  // ── (d) the acting user ──────────────────────────────────────────────────

  describe('(d) `current_user` is bound, so a role-gated predicate is judged per writer', () => {
    it('the writer the field is shown to must fill it', async () => {
      const err = await refusalOf(() => engine.insert('rws_role', { title: 'Q3' }, ADMIN));
      expectRequired(err, 'audit_note');
    });

    it('the writer it is hidden from saves without it', async () => {
      await engine.insert('rws_role', { title: 'Q3' }, MEMBER);
      expect(rows('rws_role')).toHaveLength(1);
    });

    it('a system write with no acting user counts as shown, logged as `no-acting-user`', async () => {
      const err = await refusalOf(() => engine.insert('rws_role', { title: 'Q3' }));
      expectRequired(err, 'audit_note');
      const line = logger.lines.find((l: any) => l.level === 'warn' && l.msg.includes("visibleWhen of required field 'audit_note'"));
      expect(line?.meta).toMatchObject({ field: 'audit_note', reason: 'no-acting-user' });
    });
  });

  // ── (e) the dry run, and the plain `required` control ────────────────────

  describe('(e) the dry run agrees; a plain `required` is untouched', () => {
    it('validate() accepts the hidden insert and refuses the shown, empty one', async () => {
      const hidden = await engine.validate('rws_account', { name: 'A', tier: 'basic' }, { mode: 'insert' } as any);
      expect(hidden.results?.[0]?.valid).toBe(true);
      const shown = await engine.validate('rws_account', { name: 'A', tier: 'vip' }, { mode: 'insert' } as any);
      expect(shown.results?.[0]?.valid).toBe(false);
      expect(shown.results?.[0]?.errors).toEqual([expect.objectContaining({ field: 'vip_note', code: 'required' })]);
    });

    it('CONTROL — plain `required`: an insert without it, and an explicit null onto a null row, are refused as before', async () => {
      const ins = await refusalOf(() => engine.insert('rws_plain', { title: 'x' }));
      expectRequired(ins, 'code');
      storeFor('rws_plain').set('p1', { id: 'p1', title: 'x', code: null });
      const upd = await refusalOf(() => engine.update('rws_plain', { id: 'p1', code: null }));
      expectRequired(upd, 'code', true);
    });

    it('CONTROL — only a field with BOTH keys asks for the prior record', () => {
      expect(needsPriorRecord({ fields: { code: { required: true } as any } })).toBe(false);
      expect(needsPriorRecord({ fields: { note: { visibleWhen: "record.a == 'b'" } as any } })).toBe(false);
      expect(needsPriorRecord({ fields: { note: { required: true, visibleWhen: "record.a == 'b'" } as any } })).toBe(true);
    });
  });

  // ── (f) a predicate over a formula field reads the value the form sees ───
  describe('(f) a predicate that reads a formula field is judged on the computed value', () => {
    it('an INSERT inside the condition without the field is refused', async () => {
      const err = await refusalOf(() => engine.insert('rws_formula', { amount: 500 }, ADMIN));
      expectRequired(err, 'review_note');
      expect(rows('rws_formula')).toHaveLength(0);
    });

    it('an INSERT outside the condition is accepted without the field', async () => {
      await engine.insert('rws_formula', { amount: 50 }, ADMIN);
      expect(rows('rws_formula')).toHaveLength(1);
    });

    it('an UPDATE that moves the computed value into the condition without the field is refused', async () => {
      const { id } = await engine.insert('rws_formula', { amount: 50 }, ADMIN);
      const err = await refusalOf(() => engine.update('rws_formula', { id, amount: 500 }, ADMIN));
      expectRequired(err, 'review_note');
      expect(storeFor('rws_formula').get(id)?.amount).toBe(50);
    });

    it('a dry run judges the computed value the same way', async () => {
      const inside = await engine.validate('rws_formula', { amount: 500 }, { mode: 'insert' } as any);
      expect(inside.results?.[0]?.valid).toBe(false);
      expect(inside.results?.[0]?.errors).toEqual([expect.objectContaining({ field: 'review_note', code: 'required' })]);
      const outside = await engine.validate('rws_formula', { amount: 50 }, { mode: 'insert' } as any);
      expect(outside.results?.[0]?.valid).toBe(true);
    });

    it('a formula that cannot be computed counts as shown, and the fault is logged', async () => {
      const err = await refusalOf(() => engine.insert('rws_formula_fault', { amount: 50 }, ADMIN));
      expectRequired(err, 'review_note');
      const warn = logger.lines.find((l: any) => l.level === 'warn' && /review_note/.test(l.msg) && /counted as shown/.test(l.msg));
      expect(warn?.msg).toMatch(/risk_level/);
      expect(warn?.meta).toMatchObject({ field: 'review_note', reason: 'predicate-fault' });
    });
  });

  // ── (g) only a clean TRUE shows the field (the form's reading) ───────────
  describe('(g) a clean value that is not TRUE hides the field, as the form reads it', () => {
    it('an unset boolean (null) hides the field: an INSERT without it is accepted, nothing logged', async () => {
      await engine.insert('rws_flag', { title: 'plain' }, ADMIN);
      expect(rows('rws_flag')).toHaveLength(1);
      expect(logger.lines.filter((l: any) => l.level === 'warn' && /perk_note/.test(l.msg))).toHaveLength(0);
    });

    it('TRUE shows it: an INSERT without it is refused', async () => {
      const err = await refusalOf(() => engine.insert('rws_flag', { title: 'vip', is_vip: true }, ADMIN));
      expectRequired(err, 'perk_note');
    });
  });
});
