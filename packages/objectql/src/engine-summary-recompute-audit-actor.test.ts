// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ── A roll-up recompute is a SYSTEM write on the master's audit trail ──
//
// A child write recomputes the master's `summary` columns through
// `recomputeSummaries`, which issues an ordinary `update` of the master under a
// `sudo()`-shaped context (`{ ...caller, isSystem: true }`). The caller's
// `userId` rides along on purpose — hooks and record-triggered flows on the
// master still know who triggered the write — but the audit stamp read that
// same `userId` and wrote it into the master's `updated_by`. A finance user who
// inserted an invoice under a contract therefore showed up as the contract's
// last editor, though they edit neither record and hold no edit on it.
//
// Ruling (recorded on the card, comment 6902001862): 「确定汇总字段自动重算时
// 主记录的修改人和修改时间怎么记」 → 「记为系统并刷新时间」. Under ADR-0118 D1
// a system actor is `null` in a user lookup column (no system account, no
// sentinel), so the recompute stamps `updated_by = null` and refreshes
// `updated_at`; the UI renders the null as 系统.
//
// Every child write that recomputes goes through the same door, so each one is
// a row here: insert, update, delete, and a re-parent (which recomputes BOTH the
// old and the new master). The CONTROL is the other half of the contract: a
// direct edit of the master by the same user still stamps that user — the fix
// is scoped to the recompute's own write, not to `isSystem` writes in general.
//
// The harness boots the real `ObjectQLPlugin`, because the stamp under test is
// its `sys_stamp_audit_update` hook. What reaches the fake driver's store IS the
// stored row, so the store is the verdict.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQLPlugin } from './plugin.js';
import { ObjectQL } from './engine.js';

const USER_A = 'u_owner_a';
const USER_B = 'u_child_writer_b';
/** An `updated_at` far in the past, so "the recompute refreshed it" is never a same-millisecond tie. */
const STALE_AT = '2000-01-01T00:00:00.000Z';

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
      if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
        if ('$eq' in v) return row?.[k] === v.$eq;
        if ('$in' in v) return Array.isArray(v.$in) && v.$in.includes(row?.[k]);
        throw new Error(`fake driver: unsupported operator in ${JSON.stringify(v)}`);
      }
      return row?.[k] === v;
    });
  };
  let n = 0;
  const driver: any = {
    name: 'rollup-audit', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async syncSchema() {},
    async find(object: string, ast: any) {
      const rows = Array.from(storeFor(object).values()).filter((r) => matches(r, ast?.where));
      const page = typeof ast?.limit === 'number' ? rows.slice(0, ast.limit) : rows;
      return page.map((r) => ({ ...r }));
    },
    async findOne(object: string, ast: any) {
      for (const r of storeFor(object).values()) if (matches(r, ast?.where)) return { ...r };
      return null;
    },
    async create(object: string, data: Record<string, unknown>) {
      n += 1;
      const id = (data.id as string) ?? `r_${n}`;
      const row = { ...data, id };
      storeFor(object).set(id, row);
      return { ...row };
    },
    async update(object: string, id: string, data: Record<string, unknown>) {
      const s = storeFor(object);
      const row = { ...s.get(id), ...data, id };
      s.set(id, row);
      return { ...row };
    },
    async delete(object: string, id: string) { return storeFor(object).delete(id); },
    async count(object: string, ast: any) {
      return Array.from(storeFor(object).values()).filter((r) => matches(r, ast?.where)).length;
    },
    async bulkCreate(object: string, rows: Record<string, unknown>[]) {
      return Promise.all(rows.map((r) => this.create(object, r)));
    },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() { return { __trx: true, commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, storeFor };
}

describe('roll-up recompute stamps the master as a system write (updated_by = null)', () => {
  let kernel: ObjectKernel;
  let ql: ObjectQL;
  let storeFor: ReturnType<typeof makeDriver>['storeFor'];

  beforeEach(async () => {
    kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
    const d = makeDriver();
    storeFor = d.storeFor;
    await kernel.use({
      name: 'rollup-audit-driver-plugin', type: 'driver', version: '1.0.0',
      init: async (ctx: any) => { ctx.registerService('driver.rollup-audit', d.driver); },
    } as any);
    await kernel.use(new ObjectQLPlugin());
    await kernel.bootstrap();
    ql = kernel.getService<ObjectQL>('objectql');
    // The audit family (`updated_by` / `updated_at` / …) is NOT declared: the
    // registry injects it, exactly as on an authored business object.
    ql.registry.registerObject({
      name: 'contract',
      label: 'Contract',
      datasource: 'rollup-audit',
      fields: {
        name: { name: 'name', label: 'Name', type: 'text' },
        invoiced: { name: 'invoiced', label: 'Invoiced', type: 'summary', summaryOperations: { object: 'invoice', field: 'amount', function: 'sum' } },
        invoice_count: { name: 'invoice_count', label: 'Invoices', type: 'summary', summaryOperations: { object: 'invoice', function: 'count' } },
      },
    } as any, 'test', 'test');
    ql.registry.registerObject({
      name: 'invoice',
      label: 'Invoice',
      datasource: 'rollup-audit',
      fields: {
        amount: { name: 'amount', label: 'Amount', type: 'number' },
        contract: { name: 'contract', label: 'Contract', type: 'master_detail', reference: 'contract' },
      },
    } as any, 'test', 'test');
  });

  afterEach(async () => {
    if (kernel.getState() === 'running') await kernel.shutdown();
  });

  const as = (userId: string) => ({ context: { userId } as any });
  const master = (id: string) => storeFor('contract').get(id);

  /** User A creates and last edits the master; its `updated_at` is then aged so a refresh is visible. */
  async function masterLastEditedByA(name: string): Promise<string> {
    const c = await ql.insert('contract', { name }, as(USER_A));
    await ql.update('contract', { id: c.id, name: `${name} (edited)` }, as(USER_A));
    expect(master(c.id).updated_by).toBe(USER_A);
    storeFor('contract').set(c.id, { ...master(c.id), updated_at: STALE_AT });
    return c.id;
  }

  function expectSystemStamp(id: string) {
    const row = master(id);
    expect(row.updated_by).toBeNull();
    expect(row.updated_by).not.toBe(USER_B);
    expect(typeof row.updated_at).toBe('string');
    expect(Date.parse(row.updated_at)).toBeGreaterThan(Date.parse(STALE_AT));
  }

  it('CONTROL: a direct edit of the master by B still stamps B', async () => {
    const id = await masterLastEditedByA('CTR-CONTROL');
    await ql.update('contract', { id, name: 'CTR-CONTROL (B)' }, as(USER_B));
    expect(master(id).updated_by).toBe(USER_B);
    expect(Date.parse(master(id).updated_at)).toBeGreaterThan(Date.parse(STALE_AT));
  });

  it('a child INSERT by B recomputes the master and stamps it as the system', async () => {
    const id = await masterLastEditedByA('CTR-INSERT');
    await ql.insert('invoice', { contract: id, amount: 40 }, as(USER_B));
    expect(master(id).invoiced).toBe(40);
    expect(master(id).invoice_count).toBe(1);
    expectSystemStamp(id);
  });

  it('a child UPDATE by B recomputes the master and stamps it as the system', async () => {
    const id = await masterLastEditedByA('CTR-UPDATE');
    const inv = await ql.insert('invoice', { contract: id, amount: 40 }, as(USER_A));
    await ql.update('contract', { id, name: 'CTR-UPDATE (A again)' }, as(USER_A));
    storeFor('contract').set(id, { ...master(id), updated_at: STALE_AT });
    expect(master(id).updated_by).toBe(USER_A);

    await ql.update('invoice', { id: inv.id, amount: 55 }, as(USER_B));
    expect(master(id).invoiced).toBe(55);
    expectSystemStamp(id);
  });

  it('a child DELETE by B recomputes the master and stamps it as the system', async () => {
    const id = await masterLastEditedByA('CTR-DELETE');
    const inv = await ql.insert('invoice', { contract: id, amount: 40 }, as(USER_A));
    await ql.update('contract', { id, name: 'CTR-DELETE (A again)' }, as(USER_A));
    storeFor('contract').set(id, { ...master(id), updated_at: STALE_AT });
    expect(master(id).updated_by).toBe(USER_A);

    await ql.delete('invoice', { where: { id: inv.id }, ...as(USER_B) } as any);
    expect(master(id).invoiced).toBe(0);
    expect(master(id).invoice_count).toBe(0);
    expectSystemStamp(id);
  });

  it('a child RE-PARENT by B recomputes BOTH masters and stamps each as the system', async () => {
    const from = await masterLastEditedByA('CTR-FROM');
    const inv = await ql.insert('invoice', { contract: from, amount: 40 }, as(USER_A));
    await ql.update('contract', { id: from, name: 'CTR-FROM (A again)' }, as(USER_A));
    storeFor('contract').set(from, { ...master(from), updated_at: STALE_AT });
    const to = await masterLastEditedByA('CTR-TO');

    await ql.update('invoice', { id: inv.id, contract: to }, as(USER_B));
    expect(master(from).invoiced).toBe(0);
    expect(master(to).invoiced).toBe(40);
    expectSystemStamp(from);
    expectSystemStamp(to);
  });
});
