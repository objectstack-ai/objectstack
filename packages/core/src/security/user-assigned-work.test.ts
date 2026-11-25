// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { AUDIT_FIELD_DEFS, OWNER_FIELD_DEF, resolveUserActionTransfer } from '@objectstack/spec/data';
import { changeOwnerOffReason } from './change-record-owner.js';
import {
  countUserAssignedWork,
  transferUserAssignedWork,
  userAssignedWorkFields,
  UserWorkTransferRefusal,
  type UserWorkEngine,
} from './user-assigned-work.js';

// [#30646] `owner_id`, `created_by` and `updated_by` are the platform's own
// injected definitions, as `applySystemFields` spreads them: the owner column is
// `system: true` but not `readonly`, the audit lookups are both.
const ticket = {
  name: 'ticket',
  fields: {
    title: { type: 'text' },
    owner_id: OWNER_FIELD_DEF,
    assignee: { type: 'user' },
    watchers: { type: 'lookup', reference: 'sys_user', multiple: true },
    created_by: AUDIT_FIELD_DEFS.created_by,
    updated_by: AUDIT_FIELD_DEFS.updated_by,
    account: { type: 'lookup', reference: 'account' },
  },
};
const account = { name: 'account', fields: { owner_id: OWNER_FIELD_DEF } };
const grant = { name: 'sys_user_permission_set', fields: { user_id: { type: 'lookup', reference: 'sys_user' } } };
const managed = { name: 'auth_session', managedBy: 'better-auth', fields: { user_id: { type: 'lookup', reference: 'sys_user' } } };

describe('[#30205] userAssignedWorkFields', () => {
  it('counts the owner field and every app user field; leaves provenance, platform tables and managed objects out', () => {
    const { fields, truncated } = userAssignedWorkFields([ticket, account, grant, managed]);
    expect(truncated).toBe(false);
    expect(fields).toEqual([
      { object: 'ticket', field: 'owner_id', multiple: false, transferable: true },
      { object: 'ticket', field: 'assignee', multiple: false, transferable: true },
      { object: 'ticket', field: 'watchers', multiple: true, transferable: false, reason: 'multi_valued' },
      { object: 'account', field: 'owner_id', multiple: false, transferable: true },
    ]);
  });

  it('[#30646] takes the injected owner_id as the platform defines it, and leaves the audit lookups out', () => {
    // The premise this pins: the injected owner column is a platform column
    // (`system`) that stays assignable, so `system` alone cannot exclude it.
    expect({ system: OWNER_FIELD_DEF.system, readonly: OWNER_FIELD_DEF.readonly }).toEqual({ system: true, readonly: false });
    const { fields } = userAssignedWorkFields([{ name: 'deal', fields: { owner_id: OWNER_FIELD_DEF, ...AUDIT_FIELD_DEFS } }]);
    expect(fields).toEqual([{ object: 'deal', field: 'owner_id', multiple: false, transferable: true }]);
  });

  it('[ADR-0153 D4] leaves a synced object out — a user field on a pulled row is source data, not reassignable work', () => {
    const copy = { name: 'erp_ticket_copy', managedBy: 'synced', fields: { owner_id: OWNER_FIELD_DEF, assignee: { type: 'lookup', reference: 'sys_user' } } };
    expect(userAssignedWorkFields([copy]).fields).toEqual([]);
    // twin: the same object unmanaged is counted
    const { managedBy: _m, ...unmanaged } = copy;
    expect(userAssignedWorkFields([unmanaged]).fields.map((f) => f.field)).toEqual(['owner_id', 'assignee']);
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
function fakeEngine(seed: Record<string, Row[]>, opts: { unreadable?: string[]; hidden?: Record<string, string[]>; refuseUpdate?: (object: string, id: string) => boolean; disabled?: string[]; configs?: Record<string, unknown> } = {}) {
  const tables = new Map(Object.entries(seed).map(([k, rows]) => [k, rows.map((r) => ({ ...r }))]));
  const calls: Array<{ op: string; object: string; context: any; where?: any }> = [];
  const guard = (object: string, context: any) => {
    if (opts.unreadable?.includes(object) && !context?.isSystem) throw Object.assign(new Error('denied'), { code: 'PERMISSION_DENIED' });
  };
  const engine: UserWorkEngine & { tables: typeof tables; calls: typeof calls } = {
    tables,
    calls,
    registry: { isObjectPackageDisabled: (name: string) => opts.disabled?.includes(name) ?? false },
    getConfigs: () => opts.configs ?? { ticket, account, grant, user: { name: 'sys_user', fields: {} } },
    async count(object, q) {
      calls.push({ op: 'count', object, context: q?.context, where: q?.where });
      guard(object, q?.context);
      return (tables.get(object) ?? []).filter((r) => match(r, q?.where ?? {})).length;
    },
    async find(object, q) {
      calls.push({ op: 'find', object, context: q?.context, where: q?.where });
      guard(object, q?.context);
      // A row the caller's read door does not return; an elevated read still finds it.
      const visible = (r: Row) => q?.context?.isSystem || !opts.hidden?.[object]?.includes(r.id);
      const rows = (tables.get(object) ?? []).filter((r) => visible(r) && match(r, q?.where ?? {}));
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
      { id: 't1', owner_id: 'u_gone', assignee: 'u_gone', watchers: ['u_gone'], created_by: 'u_gone', updated_by: 'u_gone' },
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
        { object: 'ticket', field: 'watchers', count: 2, transferable: false, reason: 'multi_valued' },
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
    // A multi-valued field is never rewritten, and neither is who did what.
    expect(t[0].watchers).toEqual(['u_gone']);
    expect([t[0].created_by, t[0].updated_by]).toEqual(['u_gone', 'u_gone']);
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

  it('reads a readable target\'s ban state elevated, inside the caller\'s tenant', async () => {
    const engine = fakeEngine(seed());
    const err = await transferUserAssignedWork(engine, 'u_gone', 'u_also_banned', CALLER).then(() => null, (e) => e);
    expect(err?.field?.code).toBe('reference_user_banned');
    const reads = engine.calls.filter((c) => c.object === 'sys_user');
    expect(reads.map((c) => c.context)).toEqual([CALLER, { ...CALLER, isSystem: true }]);
  });

  it('[#29029] a user the caller cannot read answers as unknown, active or banned, and its ban is not read', async () => {
    for (const opts of [{ unreadable: ['sys_user'] }, { hidden: { sys_user: ['u_next', 'u_also_banned'] } }]) {
      for (const to of ['u_next', 'u_also_banned']) {
        const engine = fakeEngine(seed(), opts);
        const err = await transferUserAssignedWork(engine, 'u_gone', to, CALLER).then(() => null, (e) => e);
        expect(err, `${to} ${JSON.stringify(opts)}`).toBeInstanceOf(UserWorkTransferRefusal);
        expect({ status: err.status, code: err.code, field: err.field?.code })
          .toEqual({ status: 404, code: 'RESOURCE_NOT_FOUND', field: 'reference_not_found' });
        expect(engine.calls.filter((c) => c.object === 'sys_user' && c.context?.isSystem)).toHaveLength(0);
        expect(engine.calls.filter((c) => c.op === 'update')).toHaveLength(0);
      }
    }
  });
});

// A master and its `controlled_by_parent` detail. The detail declares no
// `userActions.transfer`, so its Change Owner switch takes the default its
// sharing model implies: off.
const expenseReport = {
  name: 'expense_report',
  sharingModel: 'private',
  fields: { owner_id: OWNER_FIELD_DEF, approver: { type: 'user' } },
};
const expenseLine = {
  name: 'expense_line',
  sharingModel: 'controlled_by_parent',
  fields: {
    report: { type: 'master_detail', reference: 'expense_report', required: true },
    owner_id: OWNER_FIELD_DEF,
    approver: { type: 'lookup', reference: 'sys_user' },
  },
};
const EXPENSE_CONFIGS = { expenseReport, expenseLine, user: { name: 'sys_user', fields: {} } };

function expenseSeed(): Record<string, Row[]> {
  return {
    sys_user: [{ id: 'u_gone', banned: true }, { id: 'u_next', banned: false }],
    expense_report: [{ id: 'r1', owner_id: 'u_gone', approver: 'u_x' }],
    expense_line: [
      { id: 'l1', report: 'r1', owner_id: 'u_gone', approver: 'u_gone' },
      { id: 'l2', report: 'r1', owner_id: 'u_gone', approver: 'u_x' },
    ],
  };
}

/** The roster's verdict on an object's `owner_id`, or `undefined` when it is not in the roster. */
const ownerEntry = (def: unknown) =>
  userAssignedWorkFields([def]).fields.find((f) => f.field === 'owner_id');

// [#35399] The hand-over's owner column follows the object's Change Owner
// switch. Subsumes the #35344 interim pin, which left a detail's owner out of
// the roster: it is now counted, marked `transfer_off`, and never moved.
describe('[#35399] owner_id follows the object\'s Change Owner switch (userActions.transfer)', () => {
  it('derived default on a detail: its owner is counted as not transferable (transfer_off); its own user field and the master\'s owner stay transferable', () => {
    expect(userAssignedWorkFields([expenseReport, expenseLine]).fields).toEqual([
      { object: 'expense_report', field: 'owner_id', multiple: false, transferable: true },
      { object: 'expense_report', field: 'approver', multiple: false, transferable: true },
      { object: 'expense_line', field: 'owner_id', multiple: false, transferable: false, reason: 'transfer_off' },
      { object: 'expense_line', field: 'approver', multiple: false, transferable: true },
    ]);
  });

  it('switch on: a detail that turns userActions.transfer on hands its owner over', () => {
    for (const transfer of [true, { enabled: true }]) {
      expect(ownerEntry({ ...expenseLine, userActions: { transfer } })).toEqual(
        { object: 'expense_line', field: 'owner_id', multiple: false, transferable: true },
      );
    }
  });

  it('switch off: an object that turns userActions.transfer off keeps its owner; its app-authored user field is still handed over', () => {
    for (const transfer of [false, { enabled: false }]) {
      const fields = userAssignedWorkFields([{ ...expenseReport, userActions: { transfer } }]).fields;
      expect(fields).toEqual([
        { object: 'expense_report', field: 'owner_id', multiple: false, transferable: false, reason: 'transfer_off' },
        { object: 'expense_report', field: 'approver', multiple: false, transferable: true },
      ]);
    }
  });

  it('twin: the detail under any other sharing model hands its owner over', () => {
    for (const sharingModel of ['private', 'public_read', 'public_read_write', undefined]) {
      expect(ownerEntry({ ...expenseLine, sharingModel })?.transferable).toBe(true);
    }
  });

  it('an owner_id the platform does not provide is app-authored work: the switch does not govern it', () => {
    // `systemFields: false` gives the object no platform owner, so an author's
    // own `owner_id` user field is like any other app user field.
    const appOwner = { ...expenseLine, systemFields: false, fields: { owner_id: { type: 'user' } } };
    expect(ownerEntry(appOwner)).toEqual({ object: 'expense_line', field: 'owner_id', multiple: false, transferable: true });
  });

  it('one rule with Change Owner: the roster\'s owner verdict is resolveUserActionTransfer\'s, and Change Owner refuses exactly what the hand-over keeps', () => {
    const defs: Array<Record<string, unknown>> = [
      expenseReport,
      expenseLine,
      { ...expenseLine, userActions: { transfer: true } },
      { ...expenseLine, userActions: { transfer: { enabled: true, visibleWhen: 'record.status == "open"' } } },
      { ...expenseLine, userActions: { transfer: { visibleWhen: 'true' } } },
      { ...expenseReport, userActions: { transfer: false } },
      { ...expenseReport, userActions: { transfer: { enabled: false } } },
      { ...expenseReport, sharingModel: undefined },
      // Off-spec nested spot: both doors read the switch only, so they agree here too.
      { name: 'expense_line', security: { sharingModel: 'controlled_by_parent' }, fields: expenseLine.fields },
    ];
    for (const def of defs) {
      const entry = ownerEntry(def);
      expect(entry, JSON.stringify(def)).toBeDefined();
      expect(entry!.transferable, JSON.stringify(def)).toBe(resolveUserActionTransfer(def).enabled);
      expect(changeOwnerOffReason(String(def.name), def) === undefined, JSON.stringify(def)).toBe(entry!.transferable);
    }
  });

  it('counts the switched-off owner as not transferable, beside the transferable holdings', async () => {
    const summary = await countUserAssignedWork(fakeEngine(expenseSeed(), { configs: EXPENSE_CONFIGS }), 'u_gone', CALLER);
    expect(summary.objects).toEqual([
      { object: 'expense_report', field: 'owner_id', count: 1, transferable: true },
      { object: 'expense_line', field: 'owner_id', count: 2, transferable: false, reason: 'transfer_off' },
      { object: 'expense_line', field: 'approver', count: 1, transferable: true },
    ]);
    expect(summary.total).toBe(4);
  });

  it('moves the master\'s owner and the detail\'s approver, never the detail\'s owner', async () => {
    const engine = fakeEngine(expenseSeed(), { configs: EXPENSE_CONFIGS });
    const report = await transferUserAssignedWork(engine, 'u_gone', 'u_next', CALLER);
    expect(report.objects).toEqual([
      { object: 'expense_report', field: 'owner_id', updated: 1, failed: 0, failures: [] },
      { object: 'expense_line', field: 'approver', updated: 1, failed: 0, failures: [] },
    ]);
    // `remaining` counts only what a further call could move.
    expect(report.remaining).toBe(0);
    expect(engine.tables.get('expense_report')![0].owner_id).toBe('u_next');
    expect(engine.tables.get('expense_line')!.map((r) => [r.owner_id, r.approver])).toEqual([['u_gone', 'u_next'], ['u_gone', 'u_x']]);
    // No read or write named the detail's owner column.
    expect(engine.calls.some((c) => c.object === 'expense_line' && c.op !== 'count' && 'owner_id' in (c.where ?? {}))).toBe(false);
    expect(engine.calls.filter((c) => c.op === 'update' && c.object === 'expense_line')).toHaveLength(1);
  });

  it('a transfer naming the detail alone moves its approver and leaves its owner', async () => {
    const engine = fakeEngine(expenseSeed(), { configs: EXPENSE_CONFIGS });
    const report = await transferUserAssignedWork(engine, 'u_gone', 'u_next', CALLER, { objects: ['expense_line'] });
    expect(report.updated).toBe(1);
    expect(engine.tables.get('expense_line')!.map((r) => r.owner_id)).toEqual(['u_gone', 'u_gone']);
    expect(engine.calls.some((c) => c.op === 'find' && c.object === 'expense_line' && 'owner_id' in (c.where ?? {}))).toBe(false);
  });

  it('switch on: the detail\'s owner is moved like any other', async () => {
    const opened = { ...expenseLine, userActions: { transfer: true } };
    const engine = fakeEngine(expenseSeed(), { configs: { ...EXPENSE_CONFIGS, expenseLine: opened } });
    const report = await transferUserAssignedWork(engine, 'u_gone', 'u_next', CALLER, { objects: ['expense_line'] });
    expect(report.objects).toEqual([
      { object: 'expense_line', field: 'owner_id', updated: 2, failed: 0, failures: [] },
      { object: 'expense_line', field: 'approver', updated: 1, failed: 0, failures: [] },
    ]);
    expect(engine.tables.get('expense_line')!.map((r) => r.owner_id)).toEqual(['u_next', 'u_next']);
  });

  it('optional master: a row whose master reference is empty follows the object\'s switch too — counted, never moved', async () => {
    const optional = {
      ...expenseLine,
      fields: { ...expenseLine.fields, report: { type: 'master_detail', reference: 'expense_report', required: false } },
    };
    const rows = expenseSeed();
    rows.expense_line.push({ id: 'l3', report: null, owner_id: 'u_gone', approver: 'u_x' });
    const configs = { ...EXPENSE_CONFIGS, expenseLine: optional };
    const summary = await countUserAssignedWork(fakeEngine(rows, { configs }), 'u_gone', CALLER);
    expect(summary.objects.find((o) => o.object === 'expense_line' && o.field === 'owner_id'))
      .toEqual({ object: 'expense_line', field: 'owner_id', count: 3, transferable: false, reason: 'transfer_off' });
    const engine = fakeEngine(rows, { configs });
    await transferUserAssignedWork(engine, 'u_gone', 'u_next', CALLER);
    expect(engine.tables.get('expense_line')!.find((r) => r.id === 'l3')!.owner_id).toBe('u_gone');
  });
});
