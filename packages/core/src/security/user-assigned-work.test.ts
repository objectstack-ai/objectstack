// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import {
  countUserAssignedWork,
  transferUserAssignedWork,
  userAssignedWorkFields,
  UserWorkTransferRefusal,
  type UserWorkEngine,
} from './user-assigned-work.js';

const ticket = {
  name: 'ticket',
  fields: {
    title: { type: 'text' },
    owner_id: { type: 'lookup', reference: 'sys_user' },
    assignee: { type: 'user' },
    watchers: { type: 'lookup', reference: 'sys_user', multiple: true },
    created_by: { type: 'lookup', reference: 'sys_user', readonly: true, system: true },
    account: { type: 'lookup', reference: 'account' },
  },
};
const account = { name: 'account', fields: { owner_id: { type: 'lookup', reference: 'sys_user' } } };
const grant = { name: 'sys_user_permission_set', fields: { user_id: { type: 'lookup', reference: 'sys_user' } } };
const managed = { name: 'auth_session', managedBy: 'better-auth', fields: { user_id: { type: 'lookup', reference: 'sys_user' } } };

describe('[#30205] userAssignedWorkFields', () => {
  it('counts the owner field and every app user field; leaves provenance, platform tables and managed objects out', () => {
    const { fields, truncated } = userAssignedWorkFields([ticket, account, grant, managed]);
    expect(truncated).toBe(false);
    expect(fields).toEqual([
      { object: 'ticket', field: 'owner_id', multiple: false },
      { object: 'ticket', field: 'assignee', multiple: false },
      { object: 'ticket', field: 'watchers', multiple: true },
      { object: 'account', field: 'owner_id', multiple: false },
    ]);
  });

  it('stops at the cap and says so', () => {
    const { fields, truncated } = userAssignedWorkFields([ticket, account], 2);
    expect(fields).toHaveLength(2);
    expect(truncated).toBe(true);
  });
});

type Row = Record<string, any>;

/** Equality and `$contains`; a logical operator is refused, never read as a field. */
const match = (row: Row, where: Record<string, any>) => Object.entries(where).every(([k, v]) => {
  if (k.startsWith('$')) throw new Error('fake engine: unsupported logical operator ' + k);
  return v && typeof v === 'object' && '$contains' in v ? Array.isArray(row[k]) && row[k].includes(v.$contains) : row[k] === v;
});

/** An in-memory engine: equality and `$contains` filters, a per-object read/write refusal. */
function fakeEngine(seed: Record<string, Row[]>, opts: { unreadable?: string[]; refuseUpdate?: (object: string, id: string) => boolean; disabled?: string[] } = {}) {
  const tables = new Map(Object.entries(seed).map(([k, rows]) => [k, rows.map((r) => ({ ...r }))]));
  const calls: Array<{ op: string; object: string; context: any; where?: any }> = [];
  const guard = (object: string, context: any) => {
    if (opts.unreadable?.includes(object) && !context?.isSystem) throw Object.assign(new Error('denied'), { code: 'PERMISSION_DENIED' });
  };
  const engine: UserWorkEngine & { tables: typeof tables; calls: typeof calls } = {
    tables,
    calls,
    registry: { isObjectPackageDisabled: (name: string) => opts.disabled?.includes(name) ?? false },
    getConfigs: () => ({ ticket, account, grant, user: { name: 'sys_user', fields: {} } }),
    async count(object, q) {
      calls.push({ op: 'count', object, context: q?.context, where: q?.where });
      guard(object, q?.context);
      return (tables.get(object) ?? []).filter((r) => match(r, q?.where ?? {})).length;
    },
    async find(object, q) {
      calls.push({ op: 'find', object, context: q?.context, where: q?.where });
      guard(object, q?.context);
      const rows = (tables.get(object) ?? []).filter((r) => match(r, q?.where ?? {}));
      return typeof q?.limit === 'number' ? rows.slice(0, q.limit) : rows;
    },
    async update(object, data, o) {
      assertEngineUpdateDispatch(data, o);
      calls.push({ op: 'update', object, context: o?.context, where: o?.where });
      const row = (tables.get(object) ?? []).find((r) => match(r, o?.where ?? {}));
      if (!row) return null;
      if (opts.refuseUpdate?.(object, row.id)) throw Object.assign(new Error('Insufficient privileges'), { code: 'PERMISSION_DENIED' });
      Object.assign(row, data);
      return row;
    },
  };
  return engine;
}

const CALLER = { userId: 'u_admin', tenantId: 'org_1' };

function seed(): Record<string, Row[]> {
  return {
    sys_user: [
      { id: 'u_gone', banned: true },
      { id: 'u_next', banned: false },
      { id: 'u_also_banned', banned: true, ban_expires: null },
    ],
    ticket: [
      { id: 't1', owner_id: 'u_gone', assignee: 'u_gone', watchers: ['u_gone'] },
      { id: 't2', owner_id: 'u_gone', assignee: 'u_x', watchers: [] },
      { id: 't3', owner_id: 'u_x', assignee: 'u_gone', watchers: ['u_x', 'u_gone'] },
    ],
    account: [{ id: 'a1', owner_id: 'u_gone' }, { id: 'a2', owner_id: 'u_x' }],
  };
}

describe('[#30205] countUserAssignedWork', () => {
  it('answers per (object, field) counts as the caller, and the total', async () => {
    const engine = fakeEngine(seed());
    const summary = await countUserAssignedWork(engine, 'u_gone', CALLER);
    expect(summary).toEqual({
      userId: 'u_gone',
      objects: [
        { object: 'ticket', field: 'owner_id', count: 2, transferable: true },
        { object: 'ticket', field: 'assignee', count: 2, transferable: true },
        { object: 'ticket', field: 'watchers', count: 2, transferable: false },
        { object: 'account', field: 'owner_id', count: 1, transferable: true },
      ],
      total: 7,
      truncated: false,
      unreadable: [],
    });
    // Every count ran under the caller's own context, never elevated.
    expect(engine.calls.every((c) => c.context === CALLER)).toBe(true);
  });

  it('an object the caller cannot read is named, not counted as zero', async () => {
    const summary = await countUserAssignedWork(fakeEngine(seed(), { unreadable: ['account'] }), 'u_gone', CALLER);
    expect(summary.unreadable).toEqual(['account']);
    expect(summary.objects.map((o) => o.object)).not.toContain('account');
  });

  it('a disabled package\'s object holds no work to count', async () => {
    const summary = await countUserAssignedWork(fakeEngine(seed(), { disabled: ['account'] }), 'u_gone', CALLER);
    expect(summary.objects.map((o) => o.object)).not.toContain('account');
    expect(summary.unreadable).toEqual([]);
  });
});

describe('[#30205] transferUserAssignedWork', () => {
  it('moves every single-valued holding to the target as the caller, and answers what moved', async () => {
    const engine = fakeEngine(seed());
    const report = await transferUserAssignedWork(engine, 'u_gone', 'u_next', CALLER);
    expect(report).toEqual({
      fromUserId: 'u_gone',
      toUserId: 'u_next',
      objects: [
        { object: 'ticket', field: 'owner_id', updated: 2, failed: 0, failures: [] },
        { object: 'ticket', field: 'assignee', updated: 2, failed: 0, failures: [] },
        { object: 'account', field: 'owner_id', updated: 1, failed: 0, failures: [] },
      ],
      updated: 5,
      failed: 0,
      remaining: 0,
    });
    const t = engine.tables.get('ticket')!;
    expect(t.map((r) => [r.owner_id, r.assignee])).toEqual([['u_next', 'u_next'], ['u_next', 'u_x'], ['u_x', 'u_next']]);
    // A multi-valued field is never rewritten.
    expect(t[0].watchers).toEqual(['u_gone']);
    // Every write went through `update` under the caller's own context.
    const writes = engine.calls.filter((c) => c.op === 'update');
    expect(writes).toHaveLength(5);
    expect(writes.every((c) => c.context === CALLER)).toBe(true);
  });

  it('reports a row the caller may not change as a failure and keeps going', async () => {
    const engine = fakeEngine(seed(), { refuseUpdate: (object, id) => object === 'ticket' && id === 't2' });
    const report = await transferUserAssignedWork(engine, 'u_gone', 'u_next', CALLER, { objects: ['ticket'] });
    expect(report.objects[0]).toEqual({
      object: 'ticket', field: 'owner_id', updated: 1, failed: 1,
      failures: [{ id: 't2', code: 'PERMISSION_DENIED', message: 'Insufficient privileges' }],
    });
    expect(report.failed).toBe(1);
    // The refused row still names the user, and `objects` kept account out.
    expect(report.remaining).toBe(1);
    expect(engine.tables.get('account')![0].owner_id).toBe('u_gone');
  });

  it('a serving door may word a refused row the way its own write door answers it', async () => {
    const engine = fakeEngine(seed(), { refuseUpdate: (object, id) => object === 'ticket' && id === 't2' });
    const seen: string[] = [];
    const report = await transferUserAssignedWork(engine, 'u_gone', 'u_next', CALLER, {
      objects: ['ticket'],
      describeFailure: (_err, object) => { seen.push(object); return { code: 'FORBIDDEN', message: 'You may not change this record' }; },
    });
    expect(report.objects[0].failures).toEqual([{ id: 't2', code: 'FORBIDDEN', message: 'You may not change this record' }]);
    expect(seen).toEqual(['ticket']);
  });

  it('moves at most the row cap per call and answers what remains', async () => {
    const engine = fakeEngine(seed());
    const first = await transferUserAssignedWork(engine, 'u_gone', 'u_next', CALLER, { rowCap: 3 });
    expect(first.updated).toBe(3);
    expect(first.remaining).toBe(2);
    const second = await transferUserAssignedWork(engine, 'u_gone', 'u_next', CALLER, { rowCap: 3 });
    expect(second.updated).toBe(2);
    expect(second.remaining).toBe(0);
  });

  it('refuses a banned target, a missing one and the same user before any write', async () => {
    for (const [to, status, code, fieldCode] of [
      ['u_also_banned', 400, 'VALIDATION_ERROR', 'reference_user_banned'],
      ['u_nobody', 404, 'RESOURCE_NOT_FOUND', 'reference_not_found'],
      ['u_gone', 400, 'VALIDATION_ERROR', undefined],
    ] as const) {
      const engine = fakeEngine(seed());
      const err = await transferUserAssignedWork(engine, 'u_gone', to, CALLER).then(() => null, (e) => e);
      expect(err).toBeInstanceOf(UserWorkTransferRefusal);
      expect({ status: err.status, code: err.code, field: err.field?.code }).toEqual({ status, code, field: fieldCode });
      expect(engine.calls.filter((c) => c.op === 'update')).toHaveLength(0);
    }
  });

  it('reads the target\'s ban state elevated inside the caller\'s tenant, even when the caller cannot read users', async () => {
    const engine = fakeEngine(seed(), { unreadable: ['sys_user'] });
    const err = await transferUserAssignedWork(engine, 'u_gone', 'u_also_banned', CALLER).then(() => null, (e) => e);
    expect(err?.field?.code).toBe('reference_user_banned');
    const read = engine.calls.find((c) => c.object === 'sys_user')!;
    expect(read.context).toEqual({ ...CALLER, isSystem: true });
  });
});
