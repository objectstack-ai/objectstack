// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #13568 — a record's PENDING approvals are voided when the record is deleted.
 *
 * ## The defect, as it was found
 *
 * A leave-request module declared an approval node with `lockRecord: true`. The
 * lock blocks the EDIT, so an author who needs to change a submitted record has
 * exactly one route left — delete it and build it again. That delete left the
 * pending `sys_approval_request` row behind: still `pending`, still counted in
 * the approver's inbox, still openable, and pointing at a `record_id` that no
 * longer resolves to anything. Nothing about that is specific to leave
 * requests; every "approval + `lockRecord`" object walks the same path, which
 * is why the fix is one global lifecycle linkage rather than a module rule.
 *
 * The maintainer's 2026-08-31 ruling: pending requests auto-cancel on record
 * delete — status `cancelled` plus a MACHINE-READABLE reason, rows KEPT for
 * audit, out of the pending count and the inbox's default view. Historical
 * terminal rows are kept as they are (their dead-reference PRESENTATION is a
 * separate objectui card), the "forbid delete while pending" direction was
 * vetoed, and a cancellation is a status write — not a flow resume.
 *
 * ## Why this file boots the real engine
 *
 * The seam under test is the ENGINE's delete dispatch. Whether a delete arrives
 * as one by-id call or as a predicate write fanned out per row, and whether the
 * deleted row's pre-image is bound on the way past, are decisions ObjectQL
 * makes — the whole defect lives in what the hook is handed. A fake engine
 * would be a fixture written by the same author as the assertion, deciding the
 * one thing the test exists to measure. So: a real {@link ObjectQL} over
 * `@objectstack/driver-sql` + better-sqlite3 `:memory:`, the real
 * `sys_approval_*` schemas, and the real {@link ApprovalService} — the requests
 * are opened by `openNodeRequest`, so the `sys_approval_approver` index rows
 * this file asserts the disappearance of were written by production code.
 *
 * ## The control case is load-bearing
 *
 * `describe('control — without the linkage')` at the bottom runs the same
 * delete with the hook NOT bound and asserts the row stays `pending`. Without
 * it, every positive assertion above would also pass against an engine that
 * cancels requests for some unrelated reason, and a linkage that quietly
 * stopped being registered would go on reading green forever.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
// The read options below are DECLARED rather than erased to `any` (#4674 /
// #4918). None of these queries is deliberately off-contract — they are plain
// `where` + `context` reads — so the contract type is the right instrument and
// `as unknown as EngineQueryOptions` (the sanctioned spelling for input a test
// means to be invalid) would be a false claim here.
import type { EngineQueryOptions } from '@objectstack/spec/data';
import { ApprovalService } from './approval-service.js';
import { bindRecordDeleteCancelHook } from './lifecycle-hooks.js';
import { SysApprovalRequest } from './sys-approval-request.object.js';
import { SysApprovalAction } from './sys-approval-action.object.js';
import { SysApprovalApprover } from './sys-approval-approver.object.js';
import { SysApprovalDelegation } from './sys-approval-delegation.object.js';

const SYSTEM = { isSystem: true, positions: [], permissions: [] } as any;
const SUBMITTER = { userId: 'submitter', positions: [], permissions: [] } as any;
const APPROVER = { userId: 'approver', positions: [], permissions: [] } as any;

/** The business object the approvals are about. */
const leaveRequest = {
  name: 'crm_leave_request',
  label: 'Leave Request',
  fields: {
    id: { name: 'id', label: 'Id', type: 'text' as const, primaryKey: true },
    title: { name: 'title', label: 'Title', type: 'text' as const },
    approval_status: { name: 'approval_status', label: 'Approval Status', type: 'text' as const },
  },
};

/**
 * The node config from the card: an approval that LOCKS its record. `lockRecord`
 * is what makes "delete and recreate" the author's only route, so it is the
 * shape the linkage exists for — even though the cancel path itself never reads
 * it.
 */
const nodeConfig = {
  approvers: [{ type: 'user' as const, value: 'approver' }],
  behavior: 'first_response' as const,
  lockRecord: true,
  approvalStatusField: 'approval_status',
};

function makeSqliteDriver() {
  return new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
}

/**
 * A stand-in for the automation service that RECORDS instead of acting.
 *
 * Its purpose is a negative: the ruling says a cancellation is a status write
 * plus a reason, NOT a flow resume, and this is how "the downstream nodes did
 * not run" is measured rather than asserted. A spy that is never called proves
 * nothing unless the same spy is reachable — `openNodeRequest` below is handed
 * this same object, so the wiring is live throughout.
 */
function makeAutomationSpy() {
  return {
    resume: vi.fn(async () => ({ status: 'completed' })),
    cancelRun: vi.fn(async () => undefined),
    getRun: vi.fn(async (runId: string) => ({ id: runId, status: 'suspended' })),
  };
}

describe('a deleted record auto-cancels its pending approvals (#13568)', () => {
  let engine: ObjectQL;
  let svc: ApprovalService;
  let automation: ReturnType<typeof makeAutomationSpy>;
  let warnings: Array<{ msg: string; meta: any }>;

  const requestsFor = (recordId: string) =>
    engine.find('sys_approval_request', {
      where: { object_name: 'crm_leave_request', record_id: recordId },
      context: SYSTEM,
    } satisfies EngineQueryOptions) as Promise<any[]>;

  const actionsFor = (requestId: string) =>
    engine.find('sys_approval_action', {
      where: { request_id: requestId }, context: SYSTEM,
    } satisfies EngineQueryOptions) as Promise<any[]>;

  const approverIndexFor = (requestId: string) =>
    engine.find('sys_approval_approver', {
      where: { request_id: requestId }, context: SYSTEM,
    } satisfies EngineQueryOptions) as Promise<any[]>;

  const openOn = (recordId: string, runId: string) => svc.openNodeRequest({
    object: 'crm_leave_request', recordId, runId, nodeId: 'manager_review',
    flowName: 'leave_approval', config: nodeConfig, submitterId: 'submitter',
    record: { id: recordId, title: 'Leave' },
  }, SUBMITTER) as Promise<any>;

  afterEach(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
  });

  beforeEach(async () => {
    engine = new ObjectQL();
    engine.registerDriver(makeSqliteDriver(), true);
    await engine.init();
    for (const def of [
      leaveRequest, SysApprovalRequest, SysApprovalAction, SysApprovalApprover, SysApprovalDelegation,
    ]) {
      engine.registry.registerObject(def as any, 'approvals-test', 'approvals-test');
    }
    // Real DDL through the real driver — including the `cancel_reason` column
    // this card adds, so a write of it that the schema does not carry fails
    // here rather than passing against a permissive fake.
    await engine.syncSchemas();

    warnings = [];
    automation = makeAutomationSpy();
    svc = new ApprovalService({
      engine: engine as any,
      automation: automation as any,
      logger: {
        warn: (msg: any, meta?: any) => { warnings.push({ msg: String(msg), meta }); },
      } as any,
    });

    await engine.insert('crm_leave_request', { id: 'LR6', title: 'Leave' }, { context: SYSTEM } as any);
    await engine.insert('crm_leave_request', { id: 'LR7', title: 'Other leave' }, { context: SYSTEM } as any);

    bindRecordDeleteCancelHook(engine as any, svc);
  });

  // ── positive ────────────────────────────────────────────────────

  it('the card verbatim: deleting the record cancels its pending request, and the row survives', async () => {
    const opened = await openOn('LR6', 'run_1');
    expect((await requestsFor('LR6'))[0].status).toBe('pending');

    await engine.delete('crm_leave_request', { where: { id: 'LR6' }, context: SYSTEM } as any);

    const rows = await requestsFor('LR6');
    // KEPT for audit — the ruling's first clause. A cancel that deleted the row
    // would satisfy every inbox assertion below and destroy the evidence that
    // an approval was ever opened.
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(opened.id);
    expect(rows[0].status).toBe('cancelled');
    // The MACHINE-READABLE reason, read off the column rather than parsed out
    // of prose.
    expect(rows[0].cancel_reason).toBe('record_deleted');
    expect(rows[0].completed_at).toBeTruthy();
    // Cleared with the exit from `pending`, exactly as every other terminal
    // transition clears it.
    expect(rows[0].pending_approvers ?? null).toBeNull();
  });

  it('writes one append-only audit row, attributed to no person', async () => {
    const opened = await openOn('LR6', 'run_1');
    await engine.delete('crm_leave_request', { where: { id: 'LR6' }, context: SYSTEM } as any);

    const cancels = (await actionsFor(opened.id)).filter((a) => a.action === 'cancel');
    expect(cancels).toHaveLength(1);
    // The point of the `cancel` kind: nobody decided this. Recording it as
    // `recall` would file a submitter withdrawal that never happened, and as
    // `reject` an approver decision that never happened.
    expect(cancels[0].actor_id ?? null).toBeNull();
    expect(String(cancels[0].comment)).toMatch(/deleted/i);
  });

  it('leaves the pending count and the approver inbox — both halves', async () => {
    await openOn('LR6', 'run_1');
    // Before: the row the card's approver saw.
    expect(await svc.countRequests({ status: 'pending', approverId: 'approver' }, APPROVER)).toBe(1);

    await engine.delete('crm_leave_request', { where: { id: 'LR6' }, context: SYSTEM } as any);

    expect(await svc.countRequests({ status: 'pending', approverId: 'approver' }, APPROVER)).toBe(0);
    expect(await svc.listRequests({ status: 'pending', approverId: 'approver' }, APPROVER)).toEqual([]);
  });

  it('clears the normalized approver index, not only the status', async () => {
    const opened = await openOn('LR6', 'run_1');
    // The index is what the inbox's approver filter actually resolves through
    // (#1745) — a status-only cancel would leave these rows behind and the
    // request would stay reachable by every approver filter forever.
    expect((await approverIndexFor(opened.id)).length).toBeGreaterThan(0);

    await engine.delete('crm_leave_request', { where: { id: 'LR6' }, context: SYSTEM } as any);

    expect(await approverIndexFor(opened.id)).toEqual([]);
  });

  it('surfaces the reason through the service read path, not only in the table', async () => {
    const opened = await openOn('LR6', 'run_1');
    await engine.delete('crm_leave_request', { where: { id: 'LR6' }, context: SYSTEM } as any);

    const row = await svc.getRequest(opened.id, SYSTEM);
    expect(row?.status).toBe('cancelled');
    expect(row?.cancel_reason).toBe('record_deleted');
  });

  it('covers a predicate (bulk) delete — every deleted row, not just the first', async () => {
    const a = await openOn('LR6', 'run_1');
    const b = await openOn('LR7', 'run_2');

    // The shape the record lock once walked straight past (#4778): no scalar
    // `where.id`, so the engine routes to `deleteMany` and fans `afterDelete`
    // out per matched row. Both requests must be cancelled, not one.
    await engine.delete('crm_leave_request', {
      where: { id: { $in: ['LR6', 'LR7'] } }, multi: true, context: SYSTEM,
    } as any);

    expect((await requestsFor('LR6'))[0].status).toBe('cancelled');
    expect((await requestsFor('LR7'))[0].status).toBe('cancelled');
    expect((await approverIndexFor(a.id))).toEqual([]);
    expect((await approverIndexFor(b.id))).toEqual([]);
  });

  // ── negative ────────────────────────────────────────────────────

  it('does NOT touch a terminal request about the same record', async () => {
    const opened = await openOn('LR6', 'run_1');
    await svc.decide(opened.id, { decision: 'approve', actorId: 'approver' }, APPROVER);
    const before = (await requestsFor('LR6'))[0];
    expect(before.status).toBe('approved');

    await engine.delete('crm_leave_request', { where: { id: 'LR6' }, context: SYSTEM } as any);

    const after = (await requestsFor('LR6'))[0];
    // The ruling's second clause: history is kept as history. Rewriting a
    // recorded decision into `cancelled` would erase the fact that someone
    // approved this — the audit trail's whole job.
    expect(after.status).toBe('approved');
    expect(after.cancel_reason ?? null).toBeNull();
    expect((await actionsFor(opened.id)).filter((x) => x.action === 'cancel')).toEqual([]);
  });

  it('does NOT touch a request about a DIFFERENT record of the same object', async () => {
    await openOn('LR6', 'run_1');
    await openOn('LR7', 'run_2');

    await engine.delete('crm_leave_request', { where: { id: 'LR6' }, context: SYSTEM } as any);

    expect((await requestsFor('LR6'))[0].status).toBe('cancelled');
    // Per-record, never "this object has a delete happening".
    expect((await requestsFor('LR7'))[0].status).toBe('pending');
    expect(await svc.countRequests({ status: 'pending', approverId: 'approver' }, APPROVER)).toBe(1);
  });

  it('runs no flow node and mirrors no status back', async () => {
    await openOn('LR6', 'run_1');
    automation.resume.mockClear();
    automation.cancelRun.mockClear();

    await engine.delete('crm_leave_request', { where: { id: 'LR6' }, context: SYSTEM } as any);

    // A cancellation is a status write plus a reason. Resuming would run the
    // approval's downstream nodes for a decision nobody made; the mirror-back
    // would be an `update_record` against a row that no longer exists — the
    // exact write this card's forensics caught failing on the reject door.
    expect(automation.resume).not.toHaveBeenCalled();
    expect(automation.cancelRun).not.toHaveBeenCalled();
    // The suspended run is REPORTED rather than repaired — the datum an
    // operator (and the automation-side card) needs, without this hook
    // guessing at run lifecycle.
    expect(warnings.some((w) => w.msg.includes('stay suspended')
      && Array.isArray(w.meta?.runs) && w.meta.runs.includes('run_1'))).toBe(true);
  });

  it('does not fail the delete when the approvals bookkeeping cannot be written', async () => {
    await openOn('LR6', 'run_1');
    const boom = vi.spyOn(svc as any, 'cancelForDeletedRecord')
      .mockRejectedValue(new Error('bookkeeping unavailable'));

    // The delete already landed by the time the hook runs; failing it here
    // would report an error for a row that is gone. The pre-existing state
    // (a stale request) is the safe degradation, and it is logged.
    await expect(
      engine.delete('crm_leave_request', { where: { id: 'LR6' }, context: SYSTEM } as any),
    ).resolves.toBeDefined();
    expect(await engine.find('crm_leave_request', {
      where: { id: 'LR6' }, context: SYSTEM,
    } satisfies EngineQueryOptions)).toEqual([]);
    boom.mockRestore();
  });
});

// ── the control ───────────────────────────────────────────────────

describe('#13568 control — without the linkage the same delete strands the request', () => {
  let engine: ObjectQL;
  let svc: ApprovalService;

  afterEach(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
  });

  beforeEach(async () => {
    engine = new ObjectQL();
    engine.registerDriver(makeSqliteDriver(), true);
    await engine.init();
    for (const def of [
      leaveRequest, SysApprovalRequest, SysApprovalAction, SysApprovalApprover, SysApprovalDelegation,
    ]) {
      engine.registry.registerObject(def as any, 'approvals-test', 'approvals-test');
    }
    await engine.syncSchemas();
    svc = new ApprovalService({ engine: engine as any });
    await engine.insert('crm_leave_request', { id: 'LR6', title: 'Leave' }, { context: SYSTEM } as any);
    // ⛔ deliberately NOT bound — that is the whole case.
  });

  it('reproduces the reported symptom exactly, so the pins above measure the hook', async () => {
    await svc.openNodeRequest({
      object: 'crm_leave_request', recordId: 'LR6', runId: 'run_1', nodeId: 'manager_review',
      flowName: 'leave_approval', config: nodeConfig, submitterId: 'submitter',
      record: { id: 'LR6', title: 'Leave' },
    }, SUBMITTER);

    await engine.delete('crm_leave_request', { where: { id: 'LR6' }, context: SYSTEM } as any);

    const rows = await engine.find('sys_approval_request', {
      where: { object_name: 'crm_leave_request', record_id: 'LR6' }, context: SYSTEM,
    } satisfies EngineQueryOptions) as any[];
    // The card's screenshot, in one assertion: the record is gone and the
    // request is still waiting for a decision about it.
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('pending');
    expect(await svc.countRequests({ status: 'pending', approverId: 'approver' }, APPROVER)).toBe(1);
  });
});
