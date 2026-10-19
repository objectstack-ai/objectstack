// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #24577 — the status mirror writes only a value the field declares.
 *
 * `approvalStatusField` names a field on the business record that the approval
 * mirrors its status onto. On hotcrm it is a `readonly` select declaring
 * `not_required` / `pending` / `approved` / `rejected`, and the app's submit
 * gate admits only `not_required` or empty. The mirror used to write each
 * status verbatim, and the engine judges a readonly field's value for shape
 * only, so a recall left `recalled` in the select: a value it does not
 * declare, which the gate never admits, so the deal never re-entered approval.
 *
 * The producer's rule (triage on the card: a select's declared options are the
 * field's value set, and the producer never writes outside them):
 *  - a status the field declares, or a field with no declared value set, is
 *    written as before;
 *  - a recall or the dead-run sweep abandons the request: a select that does
 *    not declare `recalled` goes back to the value it held at submit (the
 *    request's snapshot), else to its declared default, else empty;
 *  - any other status the select does not declare (send-back's `returned`, a
 *    decision it lacks) is not written, and a `warn` names the object, field
 *    and value. Send-back keeps the field because the run is still alive in
 *    the revise window (ADR-0044): restoring the pre-approval value there
 *    re-admits the app's gate and opens a parallel approval.
 *
 * Real kernel, real ObjectQL engine and validator, real record-change trigger
 * and automation engine, real approval node and record-lock hook, driver-sql
 * on better-sqlite3 `:memory:`. The authz tables the mirror's attribution
 * reads are spelled locally (the `status-mirror-envelope` precedent).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQLPlugin, type ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { AutomationServicePlugin, type AutomationEngine } from '@objectstack/service-automation';
import { RecordChangeTriggerPlugin } from '@objectstack/trigger-record-change';
import { APPROVAL_REVISE_NODE_TYPE } from '@objectstack/spec/automation';
import { ApprovalService } from './approval-service.js';
import { registerApprovalNode } from './approval-node.js';
import { bindApprovalLockHook } from './lifecycle-hooks.js';
import { SysApprovalRequest } from './sys-approval-request.object.js';
import { SysApprovalAction } from './sys-approval-action.object.js';
import { SysApprovalApprover } from './sys-approval-approver.object.js';
import { SysApprovalDelegation } from './sys-approval-delegation.object.js';
import { SysApprovalToken } from './sys-approval-token.object.js';

const ORG = 'org_default';
const SYS = { isSystem: true } as const;
const silent = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** A record-change run the write fired, given up to 3 s to land. */
async function until(check: () => Promise<boolean>, what: string): Promise<void> {
  for (let i = 0; i < 150; i++) {
    if (await check()) return;
    await sleep(20);
  }
  throw new Error(`timed out waiting for ${what}`);
}
/** Before reading an ABSENCE: the time a fired run has to show up, as the positive waits above allow it. */
const settle = () => sleep(300);
const asPerson = (userId: string) => ({ userId, positions: [], permissions: [] }) as any;

const text = (name: string) => ({ name, type: 'text' as const });
const PLATFORM_GLOBAL = { enabled: false };
const authzObjects = [
  { owner: '@objectstack/plugin-auth', def: { name: 'sys_user', label: 'User', tenancy: PLATFORM_GLOBAL, fields: { id: { ...text('id'), primaryKey: true }, email: text('email') } } },
  { owner: '@objectstack/plugin-auth', def: { name: 'sys_member', label: 'Member', tenancy: PLATFORM_GLOBAL, fields: { id: { ...text('id'), primaryKey: true }, user_id: text('user_id'), organization_id: text('organization_id'), role: text('role') } } },
  { owner: '@objectstack/plugin-security', def: { name: 'sys_user_position', label: 'User Position', tenancy: PLATFORM_GLOBAL, fields: { id: { ...text('id'), primaryKey: true }, user_id: text('user_id'), position: text('position'), organization_id: text('organization_id') } } },
  { owner: '@objectstack/plugin-security', def: { name: 'sys_user_permission_set', label: 'User Permission Set', tenancy: PLATFORM_GLOBAL, fields: { id: { ...text('id'), primaryKey: true }, user_id: text('user_id'), permission_set: text('permission_set'), organization_id: text('organization_id') } } },
] as const;

const option = (value: string) => ({ label: value, value });
/** hotcrm's `crm_opportunity.approval_status`, in shape. */
const HOTCRM_VALUES = ['not_required', 'pending', 'approved', 'rejected'];
const deal = {
  name: 'crm_deal',
  label: 'Deal',
  fields: {
    name: text('name'),
    note: text('note'),
    amount: { name: 'amount', type: 'number' as const },
    approval_status: {
      name: 'approval_status', type: 'select' as const, readonly: true,
      defaultValue: 'not_required', options: HOTCRM_VALUES.map(option),
    },
  },
};
/** An editable select with no default and no `approved`: the engine's validator refuses an undeclared value here. */
const QUOTE_VALUES = ['pending', 'rejected'];
const quote = {
  name: 'crm_quote',
  label: 'Quote',
  fields: { name: text('name'), approval_status: { name: 'approval_status', type: 'select' as const, options: QUOTE_VALUES.map(option) } },
};
/** A text status field: no declared value set. */
const ticket = { name: 'crm_ticket', label: 'Ticket', fields: { name: text('name'), approval_status: text('approval_status') } };

const review = { approvers: [{ type: 'user', value: 'approver' }], lockRecord: true, approvalStatusField: 'approval_status' };
const reviseLoop = (start: Record<string, unknown>) => ({
  nodes: [
    start,
    { id: 'review', type: 'approval', label: 'Review', config: review },
    { id: 'wait_revision', type: APPROVAL_REVISE_NODE_TYPE, label: 'Awaiting revision' },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'review' },
    { id: 'e2', source: 'review', target: 'end', label: 'approve' },
    { id: 'e3', source: 'review', target: 'end', label: 'reject' },
    { id: 'e4', source: 'review', target: 'wait_revision', label: 'revise' },
    { id: 'e5', source: 'wait_revision', target: 'review', label: 'resubmit', type: 'back' },
  ],
});
/** The approval flow, started by hand with the record as its trigger record. */
const reviewFlow = { name: 'record_review', label: 'Record review', type: 'autolaunched', ...reviseLoop({ id: 'start', type: 'start', label: 'Start' }) };
/** hotcrm's submit gate on `crm_deal`: an update that leaves a large deal at `not_required` or empty opens approval. */
const gateFlow = {
  name: 'deal_gate',
  label: 'Large deal gate',
  type: 'record_change',
  runAs: 'system',
  ...reviseLoop({
    id: 'start', type: 'start', label: 'Start',
    config: {
      objectName: 'crm_deal',
      triggerType: 'record-after-update',
      condition: 'has(record.amount) && record.amount != null && record.amount >= 100000'
        + ' && (!has(record.approval_status) || record.approval_status == "not_required" || record.approval_status == null)',
    },
  }),
};

describe('the status mirror writes only a value the field declares (#24577)', () => {
  let kernel: ObjectKernel;
  let ql: ObjectQL;
  let automation: AutomationEngine;
  let svc: ApprovalService;
  /** Every value written to an `approval_status`, per record, in order. */
  let written: Map<string, unknown[]>;
  let warns: Array<{ message: string; meta: any }>;

  afterEach(async () => {
    try { await kernel?.shutdown(); } catch { /* noop */ }
  });

  beforeEach(async () => {
    kernel = new ObjectKernel({ logger: { level: 'silent' } } as any);
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(new AutomationServicePlugin());
    await kernel.use(new RecordChangeTriggerPlugin());
    await kernel.bootstrap();
    ql = kernel.getService<ObjectQL>('objectql');
    automation = kernel.getService<AutomationEngine>('automation');

    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    await driver.connect();
    ql.registerDriver(driver, true);
    for (const def of [deal, quote, ticket, SysApprovalRequest, SysApprovalAction, SysApprovalApprover, SysApprovalDelegation, SysApprovalToken]) {
      ql.registry.registerObject(def as any, 'approvals-test', 'approvals-test');
    }
    for (const o of authzObjects) ql.registry.registerObject(o.def as any, o.owner);
    ql.registry.registerObject(
      { name: 'sys_organization', label: 'Organization', managedBy: 'better-auth', fields: { name: text('name'), slug: text('slug') } } as any,
      '@objectstack/plugin-auth',
    );
    await ql.syncSchemas();
    await ql.insert('sys_organization', { id: ORG, name: 'Default Organization', slug: 'default' }, { context: SYS });
    for (const id of ['owner', 'approver']) {
      await ql.insert('sys_user', { id, email: `${id}@example.test` }, { context: SYS });
      await ql.insert('sys_member', { id: `mem_${id}`, user_id: id, organization_id: ORG, role: 'member' }, { context: SYS });
    }

    written = new Map();
    ql.registerMiddleware(async (opCtx: any, next: any) => {
      const data = opCtx.data;
      if (opCtx.operation === 'update' && data && typeof data === 'object' && 'approval_status' in data) {
        const id = String(data.id ?? opCtx.options?.id ?? '');
        written.set(id, [...(written.get(id) ?? []), data.approval_status]);
      }
      return next();
    });
    warns = [];
    const logger = { ...silent, warn: (message: unknown, meta?: unknown) => { warns.push({ message: String(message), meta }); } };
    svc = new ApprovalService({ engine: ql, logger: logger as any });
    svc.attachAutomation(automation as any);
    registerApprovalNode(automation as any, svc, silent);
    bindApprovalLockHook(ql as any, silent);
    automation.registerFlow(reviewFlow.name, reviewFlow as any);
  });

  const read = async (object: string, id: string) => (await ql.find(object, { where: { id }, context: SYS }))[0];
  const requestsOn = async (id: string) =>
    (await ql.find('sys_approval_request', { where: { record_id: id }, orderBy: [{ field: 'created_at', order: 'asc' }], context: SYS }))
      .map((r: any) => ({ id: String(r.id), status: String(r.status) }));
  const seed = (object: string, id: string, extra: Record<string, unknown> = {}) =>
    ql.insert(object, { id, name: id, organization_id: ORG, ...extra }, { context: { isSystem: true, tenantId: ORG } });
  /** Start the approval flow with the record as its trigger record, as a record-change start would. */
  async function submit(object: string, id: string): Promise<string> {
    const before = new Set((await requestsOn(id)).map((r) => r.id));
    const out = await automation.execute(reviewFlow.name, { object, record: await read(object, id), userId: 'owner' } as any);
    expect(out.status, JSON.stringify(out)).toBe('paused');
    const opened = (await requestsOn(id)).filter((r) => !before.has(r.id) && r.status === 'pending');
    expect(opened).toHaveLength(1);
    return opened[0].id;
  }
  /** The owner's edit of an unrelated field, through the engine's update door. */
  const ownerEdits = (id: string, data: Record<string, unknown>) => ql.update('crm_deal', { id, ...data }, { context: asPerson('owner') });
  const skipWarns = () => warns.filter((w) => w.message.includes('was not written'));
  const failedWrites = () => warns.filter((w) => w.message.includes('mirrorStatusField failed'));

  it("recall on a hotcrm-shaped select: the field reads its value at submit, the record is editable, and a new submit opens a new request", async () => {
    await seed('crm_deal', 'd_recall', { amount: 150000 });
    const first = await submit('crm_deal', 'd_recall');
    expect((await read('crm_deal', 'd_recall')).approval_status).toBe('pending');

    await svc.recall(first, { actorId: 'owner' } as any, asPerson('owner'));

    expect((await read('crm_deal', 'd_recall')).approval_status, 'the value the record held when the flow started').toBe('not_required');
    expect(written.get('d_recall')).toEqual(['pending', 'not_required']);
    await expect(ownerEdits('d_recall', { note: 'edited after the recall' })).resolves.toBeTruthy();

    const second = await submit('crm_deal', 'd_recall');
    expect(second).not.toBe(first);
    expect((await read('crm_deal', 'd_recall')).approval_status).toBe('pending');
    expect(failedWrites()).toEqual([]);
    expect(skipWarns()).toEqual([]);
  });

  it("with hotcrm's submit gate bound, a recalled large deal re-enters approval: the restored value re-admits the gate", async () => {
    automation.registerFlow(gateFlow.name, gateFlow as any);
    await seed('crm_deal', 'd_gate', { amount: 10 });
    await ownerEdits('d_gate', { amount: 150000 });
    await until(async () => (await requestsOn('d_gate')).length === 1, 'the gate to open the first request');
    const [first] = await requestsOn('d_gate');
    expect(first?.status, 'the gate opened the first request').toBe('pending');

    await svc.recall(first.id, { actorId: 'owner' } as any, asPerson('owner'));
    await until(async () => (await requestsOn('d_gate')).length === 2, 'the gate to re-admit the recalled deal');

    // The restore is itself an update of the record, so a gate that admits
    // the restored value admits the record at once: the app's own start
    // condition decides whether a recalled record re-enters approval.
    const after = await requestsOn('d_gate');
    expect(after.map((r) => r.status)).toEqual(['recalled', 'pending']);
    expect(written.get('d_gate')).toEqual(['pending', 'not_required', 'pending']);
    expect((written.get('d_gate') ?? []).every((v) => HOTCRM_VALUES.includes(String(v)))).toBe(true);
  });

  it('send-back on the select keeps the field and says so; the revision and the resubmit run with no parallel approval (ADR-0044)', async () => {
    automation.registerFlow(gateFlow.name, gateFlow as any);
    await seed('crm_deal', 'd_back', { amount: 10 });
    await ownerEdits('d_back', { amount: 150000 });
    await until(async () => (await requestsOn('d_back')).length === 1, 'the gate to open the first request');
    const [first] = await requestsOn('d_back');

    await svc.sendBack(first.id, { actorId: 'approver' } as any, asPerson('approver'));
    await settle();

    expect((await read('crm_deal', 'd_back')).approval_status).toBe('pending');
    expect(skipWarns().map((w) => w.meta)).toEqual([
      expect.objectContaining({ object: 'crm_deal', field: 'approval_status', value: 'returned' }),
    ]);
    // The revise window: the record is unlocked for the revision, and the
    // gate stays closed because the field still reads `pending`.
    await expect(ownerEdits('d_back', { note: 'revised' })).resolves.toBeTruthy();
    await settle();
    expect((await requestsOn('d_back')).map((r) => r.status)).toEqual(['returned']);

    await svc.resubmit(first.id, { actorId: 'owner' } as any, asPerson('owner'));
    expect((await requestsOn('d_back')).map((r) => r.status)).toEqual(['returned', 'pending']);
    expect(written.get('d_back')).toEqual(['pending', 'pending']);
    expect(failedWrites()).toEqual([]);
  });

  it('the dead-run sweep abandons the request as a recall does: the field reads its value at submit', async () => {
    await seed('crm_deal', 'd_sweep', { amount: 150000 });
    await submit('crm_deal', 'd_sweep');
    svc.attachAutomation({ getRun: async () => ({ status: 'failed' }) } as any);

    await svc.releaseDeadRunRequests();

    expect((await requestsOn('d_sweep')).map((r) => r.status)).toEqual(['recalled']);
    expect((await read('crm_deal', 'd_sweep')).approval_status).toBe('not_required');
    expect(written.get('d_sweep')).toEqual(['pending', 'not_required']);
  });

  it("a value held at submit that the select does not declare is not restored: the field's declared default, else empty", async () => {
    // A deal left holding `recalled` by the verbatim mirror, submitted again.
    await seed('crm_deal', 'd_stale', { amount: 150000, approval_status: 'recalled' });
    const stale = await submit('crm_deal', 'd_stale');
    await svc.recall(stale, { actorId: 'owner' } as any, asPerson('owner'));
    expect((await read('crm_deal', 'd_stale')).approval_status, "the select's declared default").toBe('not_required');

    // An editable select with no default, empty at submit: empty again. The
    // verbatim `recalled` was refused here by the engine's validator, which
    // left the field reading `pending` with no request pending.
    await seed('crm_quote', 'q_recall');
    const quoteRequest = await submit('crm_quote', 'q_recall');
    await svc.recall(quoteRequest, { actorId: 'owner' } as any, asPerson('owner'));
    expect((await read('crm_quote', 'q_recall')).approval_status ?? null).toBeNull();
    expect(failedWrites()).toEqual([]);
  });

  it('a decision the select does not declare is not written, and the skip names the object, field and value', async () => {
    await seed('crm_quote', 'q_approve');
    const request = await submit('crm_quote', 'q_approve');

    await svc.decide(request, { decision: 'approve', actorId: 'approver' } as any, asPerson('approver'));

    expect((await requestsOn('q_approve')).map((r) => r.status)).toEqual(['approved']);
    expect((await read('crm_quote', 'q_approve')).approval_status).toBe('pending');
    expect(written.get('q_approve')).toEqual(['pending']);
    expect(skipWarns().map((w) => w.meta)).toEqual([
      expect.objectContaining({ object: 'crm_quote', field: 'approval_status', value: 'approved' }),
    ]);
    expect(failedWrites(), 'no undeclared write was attempted').toEqual([]);
  });

  it('a text status field declares no value set and keeps every status verbatim', async () => {
    await seed('crm_ticket', 't_recall');
    const recalled = await submit('crm_ticket', 't_recall');
    await svc.recall(recalled, { actorId: 'owner' } as any, asPerson('owner'));
    expect((await read('crm_ticket', 't_recall')).approval_status).toBe('recalled');

    await seed('crm_ticket', 't_back');
    const returned = await submit('crm_ticket', 't_back');
    await svc.sendBack(returned, { actorId: 'approver' } as any, asPerson('approver'));
    expect((await read('crm_ticket', 't_back')).approval_status).toBe('returned');
    expect(skipWarns()).toEqual([]);
  });
});
