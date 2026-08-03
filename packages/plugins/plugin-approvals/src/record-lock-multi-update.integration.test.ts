// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #4778 — the approvals record lock, through a REAL {@link ObjectQL} engine, on
 * the write shape that used to walk straight past it.
 *
 * `engine.update()` extracts `input.id` only from a **scalar** `where.id`; an
 * operator object (`{ $in: [...] }`) or any other predicate is a multi-row
 * write that routes to `updateMany` and reaches `beforeUpdate` with no id at
 * all. The lock hook opened with `if (!id) return`, so the *same edit* written
 * as `multi: true` bypassed it — with no admin role, no `isSystem`, no
 * `lockRecord: false` and no whitelisted field. The bypass cost was "spell the
 * write differently", which is the worst bypass cost there is.
 *
 * The unit cases next to the other lock tests (`approval-service.test.ts`) fire
 * the hook directly. This file refuses to stub the hop that produced the bug:
 * the engine decides by-id vs `updateMany`, seeds the AST and builds the hook
 * context — so it is the engine, not a fake, that hands the hook a write with
 * no id. Same three lines as the issue's repro.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { bindApprovalLockHook } from './lifecycle-hooks.js';

const opportunity = {
  name: 'opportunity',
  label: 'Opportunity',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    name: { name: 'name', type: 'text' as const },
    amount: { name: 'amount', type: 'number' as const },
    approval_status: { name: 'approval_status', type: 'text' as const },
  },
};

/** The lock hook reads pending requests off this object. */
const approvalRequest = {
  name: 'sys_approval_request',
  label: 'Approval Request',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    object_name: { name: 'object_name', type: 'text' as const },
    record_id: { name: 'record_id', type: 'text' as const },
    status: { name: 'status', type: 'text' as const },
    flow_run_id: { name: 'flow_run_id', type: 'text' as const },
    node_config_json: { name: 'node_config_json', type: 'text' as const },
  },
};

/**
 * A memory driver that understands the operators this path actually binds:
 * `$in` (the caller's predicate) and `$and` (the lock's intersection of that
 * predicate with the locked ids). An unknown operator matches nothing rather
 * than comparing an object to a scalar — a fixture that silently matched
 * everything would prove the opposite of what these tests claim.
 */
function makeMemoryDriver() {
  const stores = new Map<string, Map<string, Record<string, unknown>>>();
  const storeFor = (o: string) => {
    let s = stores.get(o);
    if (!s) { s = new Map(); stores.set(o, s); }
    return s;
  };
  let nextId = 0;
  const matches = (row: Record<string, unknown>, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    for (const [k, v] of Object.entries(where)) {
      if (k === '$and') { if (!(v as any[]).every((w) => matches(row, w))) return false; continue; }
      if (k === '$or') { if (!(v as any[]).some((w) => matches(row, w))) return false; continue; }
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        if ('$in' in (v as any)) {
          if (!(v as any).$in.map(String).includes(String(row[k]))) return false;
          continue;
        }
        if ('$eq' in (v as any)) {
          if ((row[k] ?? null) !== ((v as any).$eq ?? null)) return false;
          continue;
        }
        return false;
      }
      if ((row[k] ?? null) !== (v ?? null)) return false;
    }
    return true;
  };
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find(o: string, ast: any) { return Array.from(storeFor(o).values()).filter((r) => matches(r, ast?.where)); },
    async findOne(o: string, ast: any) { for (const r of storeFor(o).values()) if (matches(r, ast?.where)) return r; return null; },
    async create(o: string, data: Record<string, unknown>) {
      nextId += 1;
      const id = (data.id as string) ?? `r_${nextId}`;
      const row = { ...data, id };
      storeFor(o).set(id, row);
      return row;
    },
    async update(o: string, id: string, data: Record<string, unknown>) {
      const s = storeFor(o);
      const cur = s.get(id);
      if (!cur) throw new Error(`nf ${o}/${id}`);
      const up = { ...cur, ...data, id };
      s.set(id, up);
      return up;
    },
    async updateMany(o: string, ast: any, data: Record<string, unknown>) {
      const s = storeFor(o);
      const hits = Array.from(s.values()).filter((r) => matches(r, ast?.where));
      for (const r of hits) s.set(String(r.id), { ...r, ...data, id: r.id });
      return hits.length;
    },
    async upsert(o: string, data: Record<string, unknown>) {
      const id = data.id as string | undefined;
      return id && storeFor(o).has(id) ? this.update(o, id, data) : this.create(o, data);
    },
    async delete(o: string, id: string) { return storeFor(o).delete(id); },
    async count(o: string, ast: any) { return (await this.find(o, ast)).length; },
    async bulkCreate(o: string, rows: Record<string, unknown>[]) { return Promise.all(rows.map((r) => this.create(o, r))); },
    async bulkUpdate() { return []; },
    async bulkDelete() {},
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return driver;
}

const USER_CTX = { isSystem: false, userId: 'u1', positions: [], permissions: [] };

describe('approvals record lock — predicate (multi) updates (#4778)', () => {
  let engine: ObjectQL;
  /** Held by a pending approval. */
  let lockedId: string;
  /** Same object, same predicates, no approval. */
  let freeId: string;

  const amountOf = async (id: string) =>
    (await engine.findOne('opportunity', { where: { id }, context: USER_CTX } as any))?.amount;

  const openRequest = async (config: Record<string, unknown>, extra: Record<string, unknown> = {}) => {
    await engine.insert('sys_approval_request', {
      object_name: 'opportunity',
      record_id: lockedId,
      status: 'pending',
      flow_run_id: 'run_1',
      node_config_json: JSON.stringify(config),
      ...extra,
    }, { context: { isSystem: true } } as any);
  };

  beforeEach(async () => {
    engine = new ObjectQL();
    engine.registerDriver(makeMemoryDriver(), true);
    await engine.init();
    for (const o of [opportunity, approvalRequest]) engine.registry.registerObject(o as any);

    lockedId = String((await engine.insert('opportunity', { name: 'Deal', amount: 100 })).id);
    freeId = String((await engine.insert('opportunity', { name: 'Other', amount: 100 })).id);
    await openRequest({ lockRecord: true, approvalStatusField: 'approval_status' });

    bindApprovalLockHook(engine as any);
  });

  it('the issue verbatim: the by-id write is refused, and so are both predicate rewrites', async () => {
    await expect(
      engine.update('opportunity', { amount: 999 }, { where: { id: lockedId }, context: USER_CTX } as any),
    ).rejects.toThrow(/RECORD_LOCKED/);

    await expect(
      engine.update('opportunity', { amount: 999 }, { where: { id: { $in: [lockedId] } }, multi: true, context: USER_CTX } as any),
    ).rejects.toThrow(/RECORD_LOCKED/);

    await expect(
      engine.update('opportunity', { amount: 999 }, { where: { name: 'Deal' }, multi: true, context: USER_CTX } as any),
    ).rejects.toThrow(/RECORD_LOCKED/);

    // The refusal is a refusal: nothing reached the driver.
    expect(await amountOf(lockedId)).toBe(100);
  });

  it('refuses an unscoped whole-table update', async () => {
    await expect(
      engine.update('opportunity', { amount: 999 }, { multi: true, context: USER_CTX } as any),
    ).rejects.toThrow(/RECORD_LOCKED/);
    expect(await amountOf(lockedId)).toBe(100);
    expect(await amountOf(freeId)).toBe(100);
  });

  it('still lets a predicate update that misses the locked record through', async () => {
    // The lock is a per-row verdict, not "this object has an approval open".
    await expect(
      engine.update('opportunity', { amount: 999 }, { where: { name: 'Other' }, multi: true, context: USER_CTX } as any),
    ).resolves.toBeDefined();
    expect(await amountOf(freeId)).toBe(999);
    expect(await amountOf(lockedId)).toBe(100);
  });

  it('lets a predicate update through once the request is no longer pending', async () => {
    const [req] = await engine.find('sys_approval_request', { where: { record_id: lockedId }, context: { isSystem: true } } as any);
    await engine.update('sys_approval_request', { id: req.id, status: 'approved' }, { context: { isSystem: true } } as any);
    await expect(
      engine.update('opportunity', { amount: 999 }, { where: { name: 'Deal' }, multi: true, context: USER_CTX } as any),
    ).resolves.toBeDefined();
    expect(await amountOf(lockedId)).toBe(999);
  });

  // ── the exemptions, on the multi path, through the real engine ─────

  it('exempts an engine self-write (isSystem)', async () => {
    await expect(
      engine.update('opportunity', { amount: 999 }, { where: { name: 'Deal' }, multi: true, context: { isSystem: true, positions: [], permissions: [] } } as any),
    ).resolves.toBeDefined();
    expect(await amountOf(lockedId)).toBe(999);
  });

  it('exempts the run that opened the approval (flowRunId provenance)', async () => {
    await expect(
      engine.update('opportunity', { amount: 999 }, { where: { name: 'Deal' }, multi: true, context: { ...USER_CTX, flowRunId: 'run_1' } } as any),
    ).resolves.toBeDefined();
    expect(await amountOf(lockedId)).toBe(999);

    // …and only that run.
    await expect(
      engine.update('opportunity', { amount: 1 }, { where: { name: 'Deal' }, multi: true, context: { ...USER_CTX, flowRunId: 'run_other' } } as any),
    ).rejects.toThrow(/RECORD_LOCKED/);
  });

  it('exempts a status-mirror write (only the approvalStatusField changes)', async () => {
    await expect(
      engine.update('opportunity', { approval_status: 'approved' }, { where: { name: 'Deal' }, multi: true, context: USER_CTX } as any),
    ).resolves.toBeDefined();
    expect(
      (await engine.findOne('opportunity', { where: { id: lockedId }, context: USER_CTX } as any))?.approval_status,
    ).toBe('approved');
  });

  it('exempts a node that opted out of the lock (lockRecord: false)', async () => {
    const [req] = await engine.find('sys_approval_request', { where: { record_id: lockedId }, context: { isSystem: true } } as any);
    await engine.update(
      'sys_approval_request',
      { id: req.id, node_config_json: JSON.stringify({ lockRecord: false }) },
      { context: { isSystem: true } } as any,
    );
    await expect(
      engine.update('opportunity', { amount: 999 }, { where: { name: 'Deal' }, multi: true, context: USER_CTX } as any),
    ).resolves.toBeDefined();
    expect(await amountOf(lockedId)).toBe(999);
  });
});
