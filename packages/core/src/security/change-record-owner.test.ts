// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
// [#35402] Change Owner, the server half: which objects offer it, the target,
// the per-row report, and the notification.

import { describe, it, expect, vi } from 'vitest';
import { assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { OWNER_FIELD_DEF } from '@objectstack/spec/data';
import {
  CHANGE_OWNER_DISABLED,
  CHANGE_OWNER_NOTIFICATION_TOPIC,
  changeOwnerOffReason,
  changeRecordOwner,
  changeRecordsOwner,
  type ChangeOwnerEngine,
} from './change-record-owner.js';
import { USER_WORK_TRANSFER_ROW_CAP, UserWorkTransferRefusal } from './user-assigned-work.js';

type Row = Record<string, any>;

const QUEUE_FIELD_DEF = { type: 'text', system: true };

// Registered shapes, as `applySystemFields` leaves them: the owner column and
// the queue column ride together on an owner-bearing object (ADR-0142 D3).
const lead = { name: 'lead', label: 'Lead', sharingModel: 'private', fields: { name: { type: 'text' }, owner_id: OWNER_FIELD_DEF, queue: QUEUE_FIELD_DEF } };
const pinned = { ...lead, name: 'pinned_lead', userActions: { transfer: false } };
const line = { name: 'invoice_line', sharingModel: 'controlled_by_parent', fields: { owner_id: OWNER_FIELD_DEF, queue: QUEUE_FIELD_DEF } };
const lineOptedIn = { ...line, name: 'contract_line', userActions: { transfer: true } };
const orgOwned = { name: 'setting_row', ownership: 'org', fields: { name: { type: 'text' } } };
const managed = { name: 'auth_session', managedBy: 'better-auth', fields: { user_id: { type: 'lookup', reference: 'sys_user' } } };
const platform = { name: 'sys_team', fields: { name: { type: 'text' } } };
const noQueue = { name: 'memo', fields: { owner_id: OWNER_FIELD_DEF } };

const SCHEMAS: Record<string, unknown> = Object.fromEntries(
  [lead, pinned, line, lineOptedIn, orgOwned, managed, platform, noQueue].map((o) => [o.name, o]),
);

const CALLER = { userId: 'u_manager', tenantId: 'org_1' };

/** An in-memory engine: by-id updates, a per-row write refusal the way the owner guard throws it. */
function fakeEngine(opts: { refuse?: (id: string) => unknown; hiddenUsers?: string[] } = {}) {
  const tables: Record<string, Row[]> = {
    sys_user: [{ id: 'u_next', banned: false }, { id: 'u_gone', banned: true }, { id: 'u_manager', banned: false }],
    lead: [{ id: 'l1', owner_id: 'u_a' }, { id: 'l2', owner_id: 'u_b' }, { id: 'l3', owner_id: 'u_a' }],
    contract_line: [{ id: 'c1', owner_id: 'u_a' }],
    memo: [{ id: 'm1', owner_id: 'u_a' }],
  };
  const calls: Array<{ op: string; object: string; data?: Row; where?: Row; context?: unknown }> = [];
  const engine: ChangeOwnerEngine & { tables: typeof tables; calls: typeof calls } = {
    tables,
    calls,
    getSchema: (name) => SCHEMAS[name],
    async find(object, q) {
      calls.push({ op: 'find', object, where: q?.where, context: q?.context });
      // Equality on plain fields only; a combinator this double does not implement is refused, never read as a field.
      // A user the caller's read door does not return; an elevated read still finds it.
      const visible = (r: Row) => object !== 'sys_user' || (q?.context as any)?.isSystem || !opts.hiddenUsers?.includes(String(r.id));
      return (tables[object] ?? []).filter((r) => visible(r) && Object.entries(q?.where ?? {}).every(([k, v]) => {
        if (k.startsWith('$')) throw new Error(`mock find: the ${k} combinator is not implemented`);
        return r[k] === v;
      })).slice(0, q?.limit ?? Infinity);
    },
    async update(object, data, o) {
      assertEngineUpdateDispatch(data, o);
      calls.push({ op: 'update', object, data, where: o?.where, context: o?.context });
      const row = (tables[object] ?? []).find((r) => r.id === o?.where?.id);
      if (!row) return null;
      const refusal = opts.refuse?.(row.id);
      if (refusal) throw refusal;
      Object.assign(row, data);
      return row;
    },
  };
  return engine;
}

/** The owner guard's refusal of an owner change without the transfer grant, as plugin-security throws it. */
const transferDenied = () => Object.assign(
  new Error("[Security] Access denied: 'owner_id' on 'lead' is system-managed — changing the owner requires the transfer grant (allowTransfer or modifyAllRecords)"),
  { name: 'PermissionDeniedError', code: 'PERMISSION_DENIED', status: 403 },
);

async function refusalOf(p: Promise<unknown>): Promise<any> {
  return p.then(() => { throw new Error('expected a refusal'); }, (e) => e);
}

describe('[#35402] which objects offer Change Owner', () => {
  it('an owner-bearing object offers it by default; a pinned one, a detail, and the structurally ineligible do not', () => {
    expect(changeOwnerOffReason('lead', lead)).toBeUndefined();
    expect(changeOwnerOffReason('contract_line', lineOptedIn)).toBeUndefined();
    expect(changeOwnerOffReason('pinned_lead', pinned)).toMatch(/userActions\.transfer/);
    expect(changeOwnerOffReason('invoice_line', line)).toMatch(/controlled_by_parent/);
    expect(changeOwnerOffReason('setting_row', orgOwned)).toMatch(/ownership: 'org'/);
    expect(changeOwnerOffReason('auth_session', managed)).toMatch(/managedBy/);
    expect(changeOwnerOffReason('sys_team', platform)).toMatch(/system object/);
  });

  for (const object of ['pinned_lead', 'invoice_line', 'setting_row', 'auth_session', 'sys_team']) {
    it(`refuses '${object}' as a whole, 403 CHANGE_OWNER_DISABLED, before any read or write — single and bulk`, async () => {
      const engine = fakeEngine();
      const single = await refusalOf(changeRecordOwner(engine, object, 'x1', { ownerId: 'u_next' }, CALLER));
      expect({ code: single.code, status: single.status, object: single.object }).toEqual({ code: CHANGE_OWNER_DISABLED, status: 403, object });
      const bulk = await refusalOf(changeRecordsOwner(engine, object, ['x1', 'x2'], { ownerId: 'u_next' }, CALLER));
      expect({ code: bulk.code, status: bulk.status }).toEqual({ code: CHANGE_OWNER_DISABLED, status: 403 });
      expect(engine.calls).toEqual([]);
    });
  }

  it('an unknown object is 404 OBJECT_NOT_FOUND', async () => {
    const err = await refusalOf(changeRecordOwner(fakeEngine(), 'nope', 'x1', { ownerId: 'u_next' }, CALLER));
    expect({ code: err.code, status: err.status }).toEqual({ code: 'OBJECT_NOT_FOUND', status: 404 });
  });

  it('a controlled_by_parent detail that opts in takes the change', async () => {
    const engine = fakeEngine();
    const result = await changeRecordOwner(engine, 'contract_line', 'c1', { ownerId: 'u_next' }, CALLER);
    expect(result).toEqual({ object: 'contract_line', id: 'c1', ownerId: 'u_next', notified: false });
    expect(engine.tables.contract_line[0]!.owner_id).toBe('u_next');
  });
});

describe('[#35402] changeRecordOwner — one record', () => {
  it('writes owner_id alone, by id, under the caller\'s own context', async () => {
    const engine = fakeEngine();
    const result = await changeRecordOwner(engine, 'lead', 'l1', { ownerId: 'u_next' }, CALLER);
    expect(result).toEqual({ object: 'lead', id: 'l1', ownerId: 'u_next', notified: false });
    const writes = engine.calls.filter((c) => c.op === 'update');
    expect(writes).toEqual([{ op: 'update', object: 'lead', data: { owner_id: 'u_next' }, where: { id: 'l1' }, context: CALLER }]);
  });

  it('[ADR-0142 D3] a queue target leaves the owner empty and names the queue', async () => {
    const engine = fakeEngine();
    const result = await changeRecordOwner(engine, 'lead', 'l1', { queue: 'triage' }, CALLER);
    expect(result).toEqual({ object: 'lead', id: 'l1', ownerId: null, queue: 'triage', notified: false });
    expect(engine.calls.find((c) => c.op === 'update')?.data).toEqual({ owner_id: null, queue: 'triage' });
  });

  it('a queue target on an object with no queue column is refused before any write', async () => {
    const engine = fakeEngine();
    const err = await refusalOf(changeRecordOwner(engine, 'memo', 'm1', { queue: 'triage' }, CALLER));
    expect(err).toBeInstanceOf(UserWorkTransferRefusal);
    expect({ code: err.code, status: err.status }).toEqual({ code: 'VALIDATION_ERROR', status: 400 });
    expect(engine.calls.some((c) => c.op === 'update')).toBe(false);
  });

  it('edit without the transfer grant: the owner guard\'s own refusal comes back unchanged', async () => {
    const engine = fakeEngine({ refuse: () => transferDenied() });
    const err = await refusalOf(changeRecordOwner(engine, 'lead', 'l1', { ownerId: 'u_next' }, CALLER));
    expect({ code: err.code, status: err.status }).toEqual({ code: 'PERMISSION_DENIED', status: 403 });
    expect(engine.tables.lead[0]!.owner_id).toBe('u_a');
  });

  it('a row out of reach is 404 RECORD_NOT_FOUND', async () => {
    const err = await refusalOf(changeRecordOwner(fakeEngine(), 'lead', 'l9', { ownerId: 'u_next' }, CALLER));
    expect({ code: err.code, status: err.status }).toEqual({ code: 'RECORD_NOT_FOUND', status: 404 });
  });

  it('a banned or unknown person is refused before any write, naming ownerId', async () => {
    for (const [ownerId, status, code] of [['u_gone', 400, 'reference_user_banned'], ['u_none', 404, 'reference_not_found']] as const) {
      const engine = fakeEngine();
      const err = await refusalOf(changeRecordOwner(engine, 'lead', 'l1', { ownerId }, CALLER));
      expect(err).toBeInstanceOf(UserWorkTransferRefusal);
      expect(err.status).toBe(status);
      expect(err.field).toEqual({ field: 'ownerId', code });
      expect(engine.calls.some((c) => c.op === 'update')).toBe(false);
    }
  });

  it('[#29029] a person the caller cannot read answers as unknown, active or banned, single and bulk, and the ban is not read', async () => {
    for (const ownerId of ['u_next', 'u_gone']) {
      for (const run of [
        (e: ReturnType<typeof fakeEngine>) => changeRecordOwner(e, 'lead', 'l1', { ownerId }, CALLER),
        (e: ReturnType<typeof fakeEngine>) => changeRecordsOwner(e, 'lead', ['l1', 'l2'], { ownerId }, CALLER),
      ]) {
        const engine = fakeEngine({ hiddenUsers: ['u_next', 'u_gone'] });
        const err = await refusalOf(run(engine));
        expect(err).toBeInstanceOf(UserWorkTransferRefusal);
        expect({ status: err.status, field: err.field }).toEqual({ status: 404, field: { field: 'ownerId', code: 'reference_not_found' } });
        expect(engine.calls.some((c) => c.object === 'sys_user' && (c.context as any)?.isSystem)).toBe(false);
        expect(engine.calls.some((c) => c.op === 'update')).toBe(false);
      }
    }
  });
});

describe('[#35402] changeRecordsOwner — the bulk form', () => {
  it('a mixed batch: one moves, one refused by the owner guard, one out of reach — every failure listed with its id', async () => {
    const engine = fakeEngine({ refuse: (id) => (id === 'l2' ? transferDenied() : undefined) });
    const report = await changeRecordsOwner(engine, 'lead', ['l1', 'l2', 'l9'], { ownerId: 'u_next' }, CALLER);
    expect(report).toMatchObject({
      object: 'lead',
      field: 'owner_id',
      ownerId: 'u_next',
      updated: 1,
      failed: 2,
      notified: false,
    });
    expect(report.failures.map((f) => [f.id, f.code])).toEqual([['l2', 'PERMISSION_DENIED'], ['l9', 'RECORD_NOT_FOUND']]);
    // Per-row by-id updates under the caller's context — never a predicate update.
    const writes = engine.calls.filter((c) => c.op === 'update');
    expect(writes.map((w) => w.where)).toEqual([{ id: 'l1' }, { id: 'l2' }, { id: 'l9' }]);
    expect(writes.every((w) => w.context === CALLER)).toBe(true);
    expect(engine.tables.lead.map((r) => r.owner_id)).toEqual(['u_next', 'u_b', 'u_a']);
  });

  it('a row failure is worded by the serving door\'s describer when one is given', async () => {
    const engine = fakeEngine({ refuse: () => transferDenied() });
    const describeFailure = vi.fn(() => ({ code: 'PERMISSION_DENIED', message: 'You cannot change who owns this record.' }));
    const report = await changeRecordsOwner(engine, 'lead', ['l1'], { ownerId: 'u_next' }, CALLER, { describeFailure });
    expect(report.failures).toEqual([{ id: 'l1', code: 'PERMISSION_DENIED', message: 'You cannot change who owns this record.' }]);
  });

  it('refuses an empty list, a repeated id and a list past the #30205 row cap, before any write', async () => {
    const tooMany = Array.from({ length: USER_WORK_TRANSFER_ROW_CAP + 1 }, (_, i) => `l${i}`);
    for (const ids of [[], ['l1', 'l1'], tooMany]) {
      const engine = fakeEngine();
      const err = await refusalOf(changeRecordsOwner(engine, 'lead', ids, { ownerId: 'u_next' }, CALLER));
      expect(err).toBeInstanceOf(UserWorkTransferRefusal);
      expect({ code: err.code, status: err.status }).toEqual({ code: 'VALIDATION_ERROR', status: 400 });
      expect(engine.calls).toEqual([]);
    }
    expect(USER_WORK_TRANSFER_ROW_CAP).toBe(500);
  });

  it('[ADR-0142 D3] moves a list to a queue', async () => {
    const engine = fakeEngine();
    const report = await changeRecordsOwner(engine, 'lead', ['l1', 'l3'], { queue: 'triage' }, CALLER);
    expect(report).toMatchObject({ ownerId: null, queue: 'triage', updated: 2, failed: 0 });
    expect(engine.tables.lead.filter((r) => r.queue === 'triage').map((r) => r.owner_id)).toEqual([null, null]);
  });
});

describe('[#35402] notify', () => {
  it('tells the new owner once, naming the record, only when asked', async () => {
    const messaging = { emit: vi.fn(async () => ({})) };
    const quiet = await changeRecordOwner(fakeEngine(), 'lead', 'l1', { ownerId: 'u_next' }, CALLER, { messaging });
    expect(quiet.notified).toBe(false);
    expect(messaging.emit).not.toHaveBeenCalled();

    const told = await changeRecordOwner(fakeEngine(), 'lead', 'l1', { ownerId: 'u_next' }, CALLER, { notify: true, messaging });
    expect(told.notified).toBe(true);
    expect(messaging.emit).toHaveBeenCalledTimes(1);
    expect(messaging.emit).toHaveBeenCalledWith(expect.objectContaining({
      topic: CHANGE_OWNER_NOTIFICATION_TOPIC,
      audience: ['u_next'],
      source: { object: 'lead', id: 'l1' },
      actorId: 'u_manager',
      organizationId: 'org_1',
    }));
    // The title rides as catalog keys, rendered in the new owner's language at
    // delivery; the English literal is the same sentence, filled.
    const sent = (messaging.emit.mock.calls[0] as any[])[0];
    expect(sent.keyedText).toEqual({
      titleKey: 'messages.recordOwnerChangedTitle',
      params: { object: { key: 'objects.lead.label', fallback: 'Lead' } },
    });
    expect(sent.payload.title).toBe('You are now the owner of this Lead record');
  });

  it('the bulk form sends one notification for the rows that moved, none when nothing moved', async () => {
    const messaging = { emit: vi.fn(async () => ({})) };
    const engine = fakeEngine({ refuse: (id) => (id === 'l2' ? transferDenied() : undefined) });
    const report = await changeRecordsOwner(engine, 'lead', ['l1', 'l2', 'l3'], { ownerId: 'u_next' }, CALLER, { notify: true, messaging });
    expect(report.notified).toBe(true);
    expect(messaging.emit).toHaveBeenCalledTimes(1);
    const sent = (messaging.emit.mock.calls[0] as any[])[0];
    expect(sent.payload.recordIds).toEqual(['l1', 'l3']);
    expect(sent.keyedText).toEqual({
      titleKey: 'messages.recordsOwnerChangedTitle',
      params: { object: { key: 'objects.lead.label', fallback: 'Lead' }, count: '2' },
    });
    expect(sent.payload.title).toBe('You are now the owner of 2 Lead records');

    const none = await changeRecordsOwner(fakeEngine({ refuse: () => transferDenied() }), 'lead', ['l1'], { ownerId: 'u_next' }, CALLER, { notify: true, messaging });
    expect(none.notified).toBe(false);
    expect(messaging.emit).toHaveBeenCalledTimes(1);
  });

  it('a caller taking a record themselves, a missing service and a failing one all answer notified: false, and the change stands', async () => {
    const self = await changeRecordOwner(fakeEngine(), 'lead', 'l1', { ownerId: 'u_manager' }, CALLER, { notify: true, messaging: { emit: vi.fn() } });
    expect(self.notified).toBe(false);
    const absent = await changeRecordOwner(fakeEngine(), 'lead', 'l1', { ownerId: 'u_next' }, CALLER, { notify: true });
    expect(absent.notified).toBe(false);
    const engine = fakeEngine();
    const failing = await changeRecordOwner(engine, 'lead', 'l1', { ownerId: 'u_next' }, CALLER, {
      notify: true,
      messaging: { emit: vi.fn(async () => { throw new Error('outbox down'); }) },
    });
    expect(failing.notified).toBe(false);
    expect(engine.tables.lead[0]!.owner_id).toBe('u_next');
  });
});
