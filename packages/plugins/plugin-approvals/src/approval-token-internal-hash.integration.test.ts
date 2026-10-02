// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21197] `sys_approval_token.token_hash` is declared `internal: true` (ruling
 * record 5942811916, C2): the generic data path and the compliance ledger's
 * CRUD mirror both omit it. The approval service only ever FILTERS by the
 * column, so the actionable-link lookup must keep working with the column
 * stripped from every row the engine hands back.
 *
 * Real `ObjectQL` over `@objectstack/driver-sql` + better-sqlite3, so the
 * engine's strip is live — the fake engine in `approval-service.test.ts` hands
 * rows back whole and cannot tell the two apart.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import type { EngineQueryOptions } from '@objectstack/spec/data';
import { ApprovalService } from './approval-service.js';
import { SysApprovalRequest } from './sys-approval-request.object.js';
import { SysApprovalAction } from './sys-approval-action.object.js';
import { SysApprovalApprover } from './sys-approval-approver.object.js';
import { SysApprovalDelegation } from './sys-approval-delegation.object.js';
import { SysApprovalToken } from './sys-approval-token.object.js';

const SYSTEM = { isSystem: true, positions: [], permissions: [] } as any;
const SUBMITTER = { userId: 'submitter', positions: [], permissions: [] } as any;

const leaveRequest = {
  name: 'crm_leave_request',
  label: 'Leave Request',
  fields: {
    id: { name: 'id', label: 'Id', type: 'text' as const, primaryKey: true },
    title: { name: 'title', label: 'Title', type: 'text' as const },
    approval_status: { name: 'approval_status', label: 'Approval Status', type: 'text' as const },
  },
};

describe('[#21197] the approval token digest is internal, and the actionable link still resolves', () => {
  let engine: ObjectQL;
  let svc: ApprovalService;

  beforeEach(async () => {
    engine = new ObjectQL();
    engine.registerDriver(
      new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
      true,
    );
    await engine.init();
    for (const def of [leaveRequest, SysApprovalRequest, SysApprovalAction, SysApprovalApprover, SysApprovalDelegation, SysApprovalToken]) {
      engine.registry.registerObject(def as any, 'approvals-test', 'approvals-test');
    }
    await engine.syncSchemas();
    svc = new ApprovalService({
      engine: engine as any,
      automation: {
        resume: vi.fn(async () => ({ status: 'completed' })),
        cancelRun: vi.fn(async () => undefined),
        getRun: vi.fn(async (runId: string) => ({ id: runId, status: 'suspended' })),
      } as any,
      logger: { warn: () => {} } as any,
    });
    await engine.insert('crm_leave_request', { id: 'LR1', title: 'Leave' }, { context: SYSTEM } as any);
  });

  afterEach(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
  });

  it('the generic read omits the digest, storage holds it, and peek + redeem resolve by it', async () => {
    const opened: any = await svc.openNodeRequest({
      object: 'crm_leave_request', recordId: 'LR1', runId: 'run_1', nodeId: 'manager_review',
      flowName: 'leave_approval',
      config: { approvers: [{ type: 'user', value: 'approver' }], behavior: 'first_response', approvalStatusField: 'approval_status' },
      submitterId: 'submitter', record: { id: 'LR1', title: 'Leave' },
    } as any, SUBMITTER);
    const { approve } = await svc.issueActionTokens(opened.id, 'approver');

    const generic = (await engine.find('sys_approval_token', { context: SYSTEM } satisfies EngineQueryOptions)) as any[];
    expect(generic.length).toBeGreaterThan(0);
    for (const row of generic) expect(row).not.toHaveProperty('token_hash');
    const atRest = (await (engine as any).getDriver('sys_approval_token').find('sys_approval_token', { where: {} })) as any[];
    expect(atRest.every((r) => typeof r.token_hash === 'string' && r.token_hash.length === 64)).toBe(true);

    expect(await svc.peekActionToken(approve)).toMatchObject({ ok: true, action: 'approve' });
    expect(await svc.redeemActionToken(approve)).toMatchObject({ ok: true, action: 'approve', approverId: 'approver' });
    expect(await svc.redeemActionToken(approve)).toMatchObject({ ok: false, reason: 'consumed' });
    expect(await svc.redeemActionToken('not-a-token')).toMatchObject({ ok: false, reason: 'invalid' });
  });
});
