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
 *    caller's), bounded by its PROJECTION;
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
  // by the PROJECTION.
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
  // query.
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

  // The probe's refusal: a caller it refuses gets NO elevated read at all.
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

// ⛔ A by-id UPDATE whose FK repoint is STRIPPED keeps the stored FK, so the
// rule must be judged against the account the stored row points at — never the
// one the caller asked for and did not get.
describe.each([
  ['static `readonly`', { readonly: true }],
  ['a TRUE `readonlyWhen`', { readonlyWhen: "record.stage == 'closed'" }],
])('#18682 — a stripped FK repoint is judged against the stored FK (%s)', (_name, lock) => {
  let engine: ObjectQL;
  let d: ReturnType<typeof makeDriver>;

  beforeEach(async () => {
    engine = new ObjectQL();
    d = makeDriver();
    engine.registerDriver(d.driver, true);
    await engine.init();
    engine.registry.registerObject({
      name: 'crm_account',
      fields: { name: { type: 'text' }, type: { type: 'text' } },
    } as any, 'test-package');
    engine.registry.registerObject({
      name: 'crm_opportunity',
      fields: {
        name: { type: 'text' },
        amount: { type: 'number' },
        stage: { type: 'text' },
        account: { type: 'lookup', reference: 'crm_account', ...lock },
      },
      validations: [{
        name: 'partner_cap', type: 'script', severity: 'error',
        message: 'Partner accounts are capped at 10000.',
        condition: "record.account.type == 'partner' && record.amount > 10000",
      }],
    } as any, 'test-package');
    d.storeFor('crm_account').set('acc_p', { id: 'acc_p', name: 'P', type: 'partner' });
    d.storeFor('crm_account').set('acc_d', { id: 'acc_d', name: 'D', type: 'direct' });
  });

  const seed = (account: string) =>
    d.storeFor('crm_opportunity').set('opp_1', { id: 'opp_1', name: 'O', amount: 10, stage: 'closed', account });
  const update = (patch: Record<string, unknown>) =>
    engine.update('crm_opportunity', patch, { where: { id: 'opp_1' }, context: ACTING } as any);
  const readIds = () => d.calls.filter((c) => c.object === 'crm_account').map((c) => c.ast?.where?.id?.$in);

  it('REFUSES a repoint away from a partner account the strip keeps', async () => {
    seed('acc_p');
    await expect(update({ amount: 50000, account: 'acc_d' })).rejects.toThrow(/Partner accounts are capped/);
    expect(d.storeFor('crm_opportunity').get('opp_1')).toMatchObject({ account: 'acc_p', amount: 10 });
    expect(readIds()).toEqual([['acc_p']]);
  });

  it('CONTROL: the same amount without the repoint is refused alike', async () => {
    seed('acc_p');
    await expect(update({ amount: 50000 })).rejects.toThrow(/Partner accounts are capped/);
    expect(d.storeFor('crm_opportunity').get('opp_1')).toMatchObject({ account: 'acc_p', amount: 10 });
  });

  it('ACCEPTS a repoint onto a partner account the strip drops', async () => {
    seed('acc_d');
    await expect(update({ amount: 50000, account: 'acc_p' })).resolves.toBeTruthy();
    expect(d.storeFor('crm_opportunity').get('opp_1')).toMatchObject({ account: 'acc_d', amount: 50000 });
    expect(readIds()).toEqual([['acc_d']]);
  });
});

// ---------------------------------------------------------------------------
// [#20006] Deleting a record clears the references to it (`set_null`, the
// lookup default) through a cleanup UPDATE of each referencing record. That
// UPDATE resolves no related record for a traversing rule — deliberately, see
// `resolvePredicateRelated` — so such a rule faults and refuses the cleanup,
// which refuses the delete. The refusal stands; what these pin is its TEXT.
//
// The generic fault text named the wrong object: "The predicate reads 'status',
// which this object does not declare — fix the rule's condition, or declare the
// field." The DELETER did not write the referencing object's rule, and an
// author who follows that sentence adds a bogus column to the object carrying
// the rule. The text now names the blocked delete, the reference being cleared,
// the rule and its object, and the two repairs measured to work.
// ---------------------------------------------------------------------------

describe('#20006 — a cascade reference clear refused by a traversing rule says so', () => {
  const CLOSED_MESSAGE = 'Deals on a closed account are frozen.';
  const SECRET_MESSAGE = 'Deals in a secret region are frozen.';
  /** Reads the account the delete is clearing — the card's own shape. */
  const readsCleared = {
    name: 'closed_account_frozen', type: 'script', severity: 'error',
    message: CLOSED_MESSAGE, condition: "record.account.status == 'closed'",
  };
  /** Reads a DIFFERENT reference, which the clear leaves set. */
  const readsOther = {
    name: 'no_secret_region', type: 'script', severity: 'error',
    message: SECRET_MESSAGE, condition: "record.region.kind == 'secret'",
  };
  /** The repair the refusal prescribes, as an author writes it. */
  const guarded = (rule: Record<string, unknown>) => ({
    name: `${String(rule.name)}_when_linked`, type: 'conditional', severity: 'error',
    message: 'Only checked while the deal is linked to an account.',
    when: 'record.account != null', then: rule,
  });

  async function boot(validations: unknown[], deal: Record<string, unknown> = {}) {
    const engine = new ObjectQL();
    const d = makeDriver();
    engine.registerDriver(d.driver, true);
    await engine.init();
    engine.registry.registerObject({
      name: 'crm_account', fields: { name: { type: 'text' }, status: { type: 'text' } },
    } as any, 'test-package');
    engine.registry.registerObject({
      name: 'crm_region', fields: { name: { type: 'text' }, kind: { type: 'text' } },
    } as any, 'test-package');
    engine.registry.registerObject({
      name: 'crm_deal',
      fields: {
        name: { type: 'text' },
        amount: { type: 'number' },
        // An OPTIONAL lookup with no `deleteBehavior`: the delete clears it.
        account: { type: 'lookup', reference: 'crm_account' },
        region: { type: 'lookup', reference: 'crm_region' },
      },
      validations,
    } as any, 'test-package');
    d.storeFor('crm_account').set('acc_1', { id: 'acc_1', name: 'A', status: 'closed' });
    d.storeFor('crm_region').set('reg_1', { id: 'reg_1', name: 'R', kind: 'secret' });
    // Straight into the store: a seed through the engine is judged by the very
    // rule under test, and the fixture is not the subject.
    d.storeFor('crm_deal').set('deal_1', {
      id: 'deal_1', name: 'D', amount: 50, account: 'acc_1', region: 'reg_1', ...deal,
    });
    return { engine, d };
  }

  async function deleteAccount(validations: unknown[], deal?: Record<string, unknown>) {
    const { engine, d } = await boot(validations, deal);
    const err: any = await engine
      .delete('crm_account', { where: { id: 'acc_1' }, context: { isSystem: true } } as any)
      .then(() => null, (e: unknown) => e);
    return {
      err,
      accountStored: d.storeFor('crm_account').has('acc_1'),
      deal: d.storeFor('crm_deal').get('deal_1'),
    };
  }

  it('REFUSES with the delete, the reference, the rule and both repairs named — a rule reading the cleared reference', async () => {
    const { err, accountStored, deal } = await deleteAccount([readsCleared]);
    expect(err?.code).toBe('VALIDATION_FAILED');
    expect(err?.fields).toHaveLength(1);
    // The machine-readable half is unchanged: same code, same reason, same fault.
    expect(err.fields[0]).toMatchObject({ field: '_record', code: 'rule_violation' });
    expect(err.fields[0].constraint).toEqual({
      rule: 'closed_account_frozen', reason: 'unevaluable',
      fault: 'runtime: No such key: status', missingKey: 'status',
    });
    const message: string = err.message;
    expect(message).toBe(err.fields[0].message);
    expect(message).toContain('Cannot delete crm_account (acc_1)');           // the blocked delete
    expect(message).toContain('clears `account` on the crm_deal records');    // the reference cleared
    expect(message).toContain("validation rule 'closed_account_frozen' on crm_deal"); // rule + object
    expect(message).toContain('`when` is `record.account != null`');          // repair 1
    expect(message).toContain('`deleteBehavior` on crm_deal.account');        // repair 2
    // ⛔ The wrong-object prescription the generic fault text carried.
    expect(message).not.toContain('declare the field');
    // The refusal itself stands (fail-closed): nothing landed.
    expect(accountStored).toBe(true);
    expect(deal?.account).toBe('acc_1');
  });

  it('ACCEPTS the same delete once the rule is guarded as the refusal prescribes', async () => {
    const { err, accountStored, deal } = await deleteAccount([guarded(readsCleared)]);
    expect(err).toBe(null);
    expect(accountStored).toBe(false);
    expect(deal?.account).toBe(null);
  });

  it('CONTROL: the guard does not switch the rule off — an ordinary write on a linked deal is still judged', async () => {
    const { engine } = await boot([guarded(readsCleared)]);
    const err: any = await engine
      .update('crm_deal', { id: 'deal_1', amount: 60 }, { context: { isSystem: true } } as any)
      .then(() => null, (e: unknown) => e);
    expect(err?.code).toBe('VALIDATION_FAILED');
    expect(err?.message).toBe(CLOSED_MESSAGE);
  });

  it('REFUSES naming the reference the rule reads AND the one the delete clears — a rule reading another reference', async () => {
    const { err, accountStored, deal } = await deleteAccount([readsOther]);
    expect(err?.code).toBe('VALIDATION_FAILED');
    expect(err.fields[0].constraint).toEqual({
      rule: 'no_secret_region', reason: 'unevaluable',
      fault: 'runtime: No such key: kind', missingKey: 'kind',
    });
    const message: string = err.message;
    expect(message).toContain('Cannot delete crm_account (acc_1)');
    expect(message).toContain('clears `account` on the crm_deal records');
    expect(message).toContain("validation rule 'no_secret_region' on crm_deal");
    expect(message).toContain("reads 'kind' through `region`");
    expect(message).toContain('`when` is `record.account != null`');
    expect(message).toContain('`deleteBehavior` on crm_deal.account');
    expect(message).not.toContain('declare the field');
    expect(accountStored).toBe(true);
    expect(deal?.account).toBe('acc_1');
  });

  it('ACCEPTS that delete too once the rule is guarded on the cleared reference', async () => {
    const { err, accountStored, deal } = await deleteAccount([guarded(readsOther)]);
    expect(err).toBe(null);
    expect(accountStored).toBe(false);
    expect(deal).toMatchObject({ account: null, region: 'reg_1' });
  });

  it("ACCEPTS the delete when the reference's deleteBehavior is 'cascade' — the other named repair", async () => {
    const { engine, d } = await boot([readsCleared]);
    const deal = engine.registry.getObject('crm_deal') as any;
    engine.registry.registerObject({
      ...deal,
      fields: { ...deal.fields, account: { ...deal.fields.account, deleteBehavior: 'cascade' } },
    }, 'test-package');
    const err = await engine
      .delete('crm_account', { where: { id: 'acc_1' }, context: { isSystem: true } } as any)
      .then(() => null, (e: unknown) => e);
    expect(err).toBe(null);
    expect(d.storeFor('crm_account').has('acc_1')).toBe(false);
    expect(d.storeFor('crm_deal').has('deal_1')).toBe(false);
  });

  it('CONTROL: a rule that traverses nothing keeps its text byte for byte on the same clear', async () => {
    const { err } = await deleteAccount([{
      name: 'broken', type: 'script', severity: 'error', message: 'never shown',
      condition: "record.nope == 'x'",
    }]);
    expect(err?.code).toBe('VALIDATION_FAILED');
    expect(err?.message).toBe(
      "Validation rule 'broken' could not be evaluated (runtime: No such key: nope) — write rejected."
      + " The predicate reads 'nope', which this object does not declare — fix the rule's condition, or declare the field.",
    );
  });

  it('CONTROL: an ordinary write keeps its text byte for byte', async () => {
    const { engine } = await boot([{
      name: 'broken', type: 'script', severity: 'error', message: 'never shown',
      condition: "record.nope == 'x'",
    }]);
    const err: any = await engine
      .update('crm_deal', { id: 'deal_1', amount: 70 }, { context: { isSystem: true } } as any)
      .then(() => null, (e: unknown) => e);
    expect(err?.code).toBe('VALIDATION_FAILED');
    expect(err?.message).toBe(
      "Validation rule 'broken' could not be evaluated (runtime: No such key: nope) — write rejected."
      + " The predicate reads 'nope', which this object does not declare — fix the rule's condition, or declare the field.",
    );
  });

  it('CONTROL: a user emptying the same reference by hand is not told about a delete', async () => {
    const { engine } = await boot([readsCleared]);
    const err: any = await engine
      .update('crm_deal', { id: 'deal_1', account: null }, { context: { isSystem: true } } as any)
      .then(() => null, (e: unknown) => e);
    expect(err?.code).toBe('VALIDATION_FAILED');
    expect(err?.message).toContain("Validation rule 'closed_account_frozen' could not be evaluated");
    expect(err?.message).not.toContain('Cannot delete');
  });

  it('THE REFUSED SET DOES NOT MOVE: a rule that never reaches its traversal still lets the delete through', async () => {
    // `false && <fault>` is `false` in CEL, so this rule has a verdict on the
    // clear without reading anything through `account` — and had one before.
    const { err, accountStored } = await deleteAccount([{
      ...readsCleared, condition: "record.amount > 100 && record.account.status == 'closed'",
    }]);
    expect(err).toBe(null);
    expect(accountStored).toBe(false);
  });

  it('a write that only INHERITS the clear marker keeps the generic text — the cause names another record', async () => {
    const { engine } = await boot([readsOther]);
    const inherited = (cause: Record<string, unknown>) => engine
      .update('crm_deal', { id: 'deal_1', amount: 80 }, {
        context: { isSystem: true, __referentialFieldClear: true, __referentialFieldClearCause: cause },
      } as any)
      .then(() => null, (e: any) => e?.message as string);
    const base = { object: 'crm_account', id: 'acc_1', referencingObject: 'crm_deal', referencingId: 'deal_1', field: 'account' };
    // CONTROL — the cause names THIS record: the delete's text.
    expect(await inherited(base)).toContain('Cannot delete crm_account (acc_1)');
    // Another object's cleanup, or another row's: today's text.
    for (const other of [{ referencingObject: 'crm_other' }, { referencingId: 'deal_2' }]) {
      const message = await inherited({ ...base, ...other });
      expect(message).toContain("Validation rule 'no_secret_region' could not be evaluated (runtime: No such key: kind)");
      expect(message).not.toContain('Cannot delete');
    }
  });
});
