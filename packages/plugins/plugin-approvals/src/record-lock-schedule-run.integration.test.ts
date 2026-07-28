// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #3712 — a schedule-triggered run may write its own locked record.
 *
 * #3703 exempted "the run that opened the pending request" from the approvals
 * record lock, keyed on `flowRunId`. It worked for every run that resolved an
 * identity and silently missed the one that doesn't: an effective
 * `runAs:'user'` run with no trigger user — a schedule — passed NO ObjectQL
 * context at all, so nothing carried the run id and the run still died on its
 * own `RECORD_LOCKED`.
 *
 * That miss was a HAND-OFF gap, not a logic gap: every hop worked in isolation.
 * So this test refuses to stub any hop. It runs the real
 * `resolveRunDataContext` from the automation runtime, feeds its output to a
 * real {@link ObjectQL} engine, and lets the real lock hook decide — the same
 * three layers, in the same order, as a live deployment.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { resolveRunDataContext } from '@objectstack/service-automation';
import { bindApprovalLockHook } from './lifecycle-hooks.js';

const opportunity = {
  name: 'opportunity',
  label: 'Opportunity',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    name: { name: 'name', type: 'text' as const },
    amount: { name: 'amount', type: 'number' as const },
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
      if (k.startsWith('$')) continue;
      const exp = (v && typeof v === 'object' && '$eq' in (v as any)) ? (v as any).$eq : v;
      if ((row[k] ?? null) !== (exp ?? null)) return false;
    }
    return true;
  };
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find(o: string, ast: any) { return Array.from(storeFor(o).values()).filter((r) => matches(r, ast?.where)); },
    findStream() { throw new Error('ns'); },
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

/** The run context a schedule trigger produces: an event, and no user. */
const SCHEDULE_RUN = (flowRunId: string) => ({ runAs: 'user' as const, flowRunId });

describe('a schedule-triggered run and the approvals record lock (#3712)', () => {
  let engine: ObjectQL;
  let oppId: string;

  beforeEach(async () => {
    engine = new ObjectQL();
    engine.registerDriver(makeMemoryDriver(), true);
    await engine.init();
    for (const o of [opportunity, approvalRequest]) engine.registry.registerObject(o as any);

    const opp = await engine.insert('opportunity', { name: 'Deal', amount: 100 });
    oppId = String(opp.id);
    await engine.insert('sys_approval_request', {
      object_name: 'opportunity',
      record_id: oppId,
      status: 'pending',
      flow_run_id: 'run_1',
      node_config_json: JSON.stringify({ lockRecord: true }),
    });

    bindApprovalLockHook(engine as any);
  });

  const writeAs = (context: unknown) =>
    engine.update('opportunity', { id: oppId, amount: 200 }, { context } as any);

  it('lets the OWNING schedule run write its own target record', async () => {
    // The full hand-off, unstubbed: the automation runtime resolves the run's
    // ObjectQL context, the engine turns it into hook provenance, the lock hook
    // matches it against the pending request it opened.
    const dataCtx = resolveRunDataContext(SCHEDULE_RUN('run_1'));
    expect(dataCtx, 'the run resolved no context — nothing could carry the run id').toEqual({
      flowRunId: 'run_1',
    });

    await expect(writeAs(dataCtx)).resolves.toBeDefined();
    const row = await engine.findOne('opportunity', { where: { id: oppId } });
    expect(row.amount).toBe(200);
  });

  it('still blocks a DIFFERENT schedule run', async () => {
    await expect(writeAs(resolveRunDataContext(SCHEDULE_RUN('run_other'))))
      .rejects.toThrow(/RECORD_LOCKED/);
  });

  it('still blocks an ordinary user edit', async () => {
    await expect(writeAs({ isSystem: false, userId: 'u1', positions: [], permissions: [] }))
      .rejects.toThrow(/RECORD_LOCKED/);
  });

  it('still blocks a context-less write', async () => {
    await expect(writeAs(undefined)).rejects.toThrow(/RECORD_LOCKED/);
  });

  it('the exempted write presents NO principal — the lock was opened by provenance, not privilege', async () => {
    // The exemption must not have been bought with elevation. Nothing the
    // security middleware keys on is present, so the run's authorization is the
    // same unscoped #1888 posture it had before this fix.
    const dataCtx = resolveRunDataContext(SCHEDULE_RUN('run_1')) as Record<string, unknown>;
    for (const key of ['isSystem', 'userId', 'positions', 'permissions', 'tenantId']) {
      expect(dataCtx, `the exemption rode in on '${key}'`).not.toHaveProperty(key);
    }
  });
});
