// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #3703 / #3712 / #3760 — the run that opened a pending approval may write its
 * own locked record.
 *
 * #3703 exempted "the run that opened the pending request" from the approvals
 * record lock, keyed on `flowRunId`. #3712 extended that to the run that
 * resolved no identity — an effective `runAs:'user'` run with no trigger user —
 * by giving it a provenance-only ObjectQL context carrying just the run id.
 *
 * #3760 then closed the fail-open that path depended on: a run with no trigger
 * user may no longer perform a data operation at all, because presenting no
 * principal is precisely what made the write UNSCOPED. So the user-less variant
 * is now REFUSED rather than exempted, and a schedule reaches its own record the
 * explicit way — `runAs:'system'`, which the hook exempts on its own
 * `isSystem` branch. The `flowRunId` exemption remains live and load-bearing for
 * what it was built for: a `runAs:'user'` run that DOES have a user.
 *
 * The original miss was a HAND-OFF gap, not a logic gap: every hop worked in
 * isolation. So this test still refuses to stub any hop. It runs the real
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

/**
 * A `runAs:'user'` run that HAS a trigger user — the live consumer of the
 * `flowRunId` exemption, and the shape #3703 built it for (a record-change or
 * screen flow that opened the approval and now writes its own target record).
 */
const OWNING_RUN = (flowRunId: string) => ({ runAs: 'user' as const, userId: 'u1', flowRunId });

/** What a schedule trigger produces: an event, and NO user. Refused since #3760. */
const USER_LESS_RUN = (flowRunId: string) => ({ runAs: 'user' as const, flowRunId });

/** The supported shape for a schedule that must write records (ADR-0049). */
const SYSTEM_RUN = (flowRunId: string) => ({ runAs: 'system' as const, flowRunId });

describe('an owning run and the approvals record lock (#3703 / #3712 / #3760)', () => {
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

  it('lets the OWNING run write its own target record', async () => {
    // The full hand-off, unstubbed: the automation runtime resolves the run's
    // ObjectQL context, the engine turns it into hook provenance, the lock hook
    // matches it against the pending request it opened.
    const dataCtx = resolveRunDataContext(OWNING_RUN('run_1'));
    expect(dataCtx, 'nothing could carry the run id').toMatchObject({ flowRunId: 'run_1' });

    await expect(writeAs(dataCtx)).resolves.toBeDefined();
    const row = await engine.findOne('opportunity', { where: { id: oppId } });
    expect(row.amount).toBe(200);
  });

  it('still blocks a DIFFERENT run', async () => {
    await expect(writeAs(resolveRunDataContext(OWNING_RUN('run_other'))))
      .rejects.toThrow(/RECORD_LOCKED/);
  });

  it('still blocks an ordinary user edit', async () => {
    await expect(writeAs({ isSystem: false, userId: 'u1', positions: [], permissions: [] }))
      .rejects.toThrow(/RECORD_LOCKED/);
  });

  it('still blocks a context-less write', async () => {
    await expect(writeAs(undefined)).rejects.toThrow(/RECORD_LOCKED/);
  });

  it('the exemption is PROVENANCE, not privilege — the exempted write is not elevated', async () => {
    // The exemption must not have been bought with elevation: the run that
    // writes its own locked record is still a plain `runAs:'user'` principal,
    // subject to the same RLS as the user who triggered it. Only `flowRunId`
    // distinguishes it, and `flowRunId` grants nothing on its own.
    const dataCtx = resolveRunDataContext(OWNING_RUN('run_1')) as Record<string, unknown>;
    expect(dataCtx.isSystem, 'the exemption rode in on isSystem').toBe(false);
    expect(dataCtx.flowRunId).toBe('run_1');
    expect(dataCtx.userId).toBe('u1');
  });

  // #3760 — the case #3712 solved by handing the lock a provenance-only context
  // is gone at the root: such a run may not perform a data operation at all,
  // because presenting no principal is exactly what made the write unscoped. It
  // is refused BEFORE the lock is ever consulted.
  it('a USER-LESS run never reaches the lock — it cannot perform a data op at all', async () => {
    expect(() => resolveRunDataContext(USER_LESS_RUN('run_1')))
      .toThrow(/no trigger user could be resolved/);
  });

  // ...and the capability itself survives, via the explicit route: a schedule
  // that must write records declares `runAs:'system'`, which the lock hook
  // exempts on its own isSystem branch. Elevation is now declared rather than
  // acquired by having no identity.
  it("a schedule that declares runAs:'system' still writes its own target record", async () => {
    const dataCtx = resolveRunDataContext(SYSTEM_RUN('run_1'));
    expect(dataCtx).toMatchObject({ isSystem: true, flowRunId: 'run_1' });

    await expect(writeAs(dataCtx)).resolves.toBeDefined();
    const row = await engine.findOne('opportunity', { where: { id: oppId } });
    expect(row.amount).toBe(200);
  });
});
