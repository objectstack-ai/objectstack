// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#26180 · ruling 6429330267, letter A] Which records a pending approval step
 * lets a caller READ — `ApprovalService.pendingApproverReadGrants`, the answer
 * plugin-sharing ORs into its read filter.
 *
 * The full door (a real kernel, the security and sharing plugins, a two-step
 * flow) is pinned in dogfood's `approval-pending-approver-record-read`. What
 * only this level can state is the derivation itself and its bounds:
 *
 *  - who: a PERSON on the pending slate — the caller's user id or account
 *    email in a slot — and the override holder; a `position:` literal (a
 *    target that resolved to nobody) names no person and grants no read;
 *  - while: a decided request grants nothing, at the next read of the same
 *    request context too (a write retires the memo);
 *  - where: never across organizations, the platform administrator's override
 *    included (that boot is `single`, one organization, no wall to cross);
 *  - cost: a request context pays one account read and one index read for its
 *    slate, and one request read per object — never a read per record, and a
 *    caller on no slate stops after the index read;
 *  - fail: a failed read is rethrown and never memoized.
 *
 * The rig is the read-gate suites' (`record-reader-opt-in.integration.test.ts`):
 * a real ObjectQL engine over better-sqlite3 and the real
 * `ApprovalsServicePlugin.start()`.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import type { EngineQueryOptions } from '@objectstack/spec/data';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { ApprovalService } from './approval-service.js';
import { ApprovalsServicePlugin } from './approvals-plugin.js';
import { SysApprovalRequest } from './sys-approval-request.object.js';
import { SysApprovalAction } from './sys-approval-action.object.js';
import { SysApprovalApprover } from './sys-approval-approver.object.js';
import { SysApprovalDelegation } from './sys-approval-delegation.object.js';
import { DEFAULT_ORGANIZATION_ID, installDefaultOrganization } from './default-organization.testkit.js';

const OBJECT = 'contract_sheet';
const OTHER = 'memo_sheet';
const PKG = 'approvals-pending-approver-read-test';
const OTHER_ORG = 'org_other';

const SYSTEM: ExecutionContext = { isSystem: true, positions: [], permissions: [] };
/** A request row as the system reads it. */
const requestRow = async (rig: Rig, where: Record<string, unknown>): Promise<any> =>
  ((await rig.engine.find('sys_approval_request', { where, context: SYSTEM } satisfies EngineQueryOptions)) as any[])[0];
/** A member of `org`, acting as themself. */
const member = (userId: string, org: string = DEFAULT_ORGANIZATION_ID) =>
  ({ userId, tenantId: org, organizationId: org, positions: [], permissions: [], posture: 'MEMBER' }) as any;

const SUBMITTER = 'u_submitter';
/** On the slate by user id. */
const BY_ID = 'u_by_id';
/** On the slate by the email their account carries. */
const BY_EMAIL = 'u_by_email';
const BY_EMAIL_ADDRESS = 'by.email@verify.test';
/** Holds position `buyer`; the slate holds only the unresolved `position:buyer` literal. */
const BUYER = 'u_buyer';
/** On no slate. */
const STRANGER = 'u_stranger';

function sheet(name: string) {
  return {
    name,
    label: name,
    fields: {
      id: { name: 'id', label: 'Id', type: 'text' as const, primaryKey: true },
      title: { name: 'title', label: 'Title', type: 'text' as const },
    },
  };
}

/** The account table `callerAccountEmail` reads. */
const SysUser = {
  name: 'sys_user',
  label: 'User',
  managedBy: 'better-auth',
  fields: {
    id: { name: 'id', label: 'Id', type: 'text' as const, primaryKey: true },
    email: { name: 'email', label: 'Email', type: 'text' as const },
  },
};

interface Rig {
  engine: ObjectQL;
  svc: ApprovalService;
  finds: string[];
}

let current: ObjectQL | undefined;

afterEach(async () => {
  try { await current?.destroy(); } catch { /* noop */ }
  current = undefined;
});

async function boot(): Promise<Rig> {
  const engine = new ObjectQL();
  current = engine;
  engine.registerDriver(new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  }), true);
  await engine.init();
  for (const def of [
    sheet(OBJECT), sheet(OTHER), SysUser,
    SysApprovalRequest, SysApprovalAction, SysApprovalApprover, SysApprovalDelegation,
  ]) {
    engine.registry.registerObject(def as any, PKG, PKG);
  }
  await engine.syncSchemas();
  await installDefaultOrganization(engine);
  await engine.getDriverForObject('sys_organization')!.create('sys_organization', { id: OTHER_ORG, name: 'Other' });
  await engine.getDriverForObject('sys_user')!.create('sys_user', { id: BY_EMAIL, email: BY_EMAIL_ADDRESS });
  // A `user` approver holds a slot only when an account carries it (#27397).
  await engine.getDriverForObject('sys_user')!.create('sys_user', { id: BY_ID });

  const services: Record<string, unknown> = { objectql: engine };
  const ctx: any = {
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`[Kernel] Service '${name}' not found`);
      return services[name];
    },
    registerService: (name: string, svc: unknown) => { services[name] = svc; },
    hook: () => {},
    logger: { info: () => {}, debug: () => {}, warn: () => {}, error: () => {} },
  };
  await new ApprovalsServicePlugin().start(ctx);

  // Every engine read of the approval tables and the account table, by table —
  // the cost the read path pays. Counted at the engine's own `find`.
  const finds: string[] = [];
  const find = engine.find.bind(engine);
  (engine as any).find = (object: string, options?: EngineQueryOptions) => {
    if (object.startsWith('sys_approval') || object === 'sys_user') finds.push(object);
    return find(object, options);
  };
  return { engine, svc: services.approvals as ApprovalService, finds };
}

/** Open one pending request on `recordId` of `object`, its slate the given approver targets. */
async function open(
  rig: Rig,
  object: string,
  recordId: string,
  approvers: Array<{ type: 'user' | 'position'; value: string }>,
  organizationId: string = DEFAULT_ORGANIZATION_ID,
): Promise<string> {
  await rig.engine.insert(object, { id: recordId, title: recordId, organization_id: organizationId }, { context: SYSTEM });
  const opened = await rig.svc.openNodeRequest({
    object, recordId, runId: `run_${recordId}`, nodeId: 'review', flowName: 'contract_review',
    config: { approvers, behavior: 'first_response' } as any,
    submitterId: SUBMITTER, record: { id: recordId, title: recordId }, organizationId,
  }, member(SUBMITTER, organizationId)) as any;
  expect(opened?.status, `request on ${recordId} is pending`).toBe('pending');
  return String(opened.id);
}

/** The grant as plain data: record id → request ids. */
async function grantsOf(rig: Rig, object: string, context: any): Promise<Record<string, string[]>> {
  return Object.fromEntries([...(await rig.svc.pendingApproverReadGrants(object, context))].map(([k, v]) => [k, [...v]]));
}

describe('pendingApproverReadGrants — the records a pending approval step lets a caller read (#26180)', () => {
  it('grants a person on the pending slate, by user id or by account email, the one record — and no one else', async () => {
    const rig = await boot();
    const byIdRequest = await open(rig, OBJECT, 'c_by_id', [{ type: 'user', value: BY_ID }]);
    const byEmailRequest = await open(rig, OBJECT, 'c_by_email', [{ type: 'user', value: BY_EMAIL_ADDRESS }]);
    await open(rig, OBJECT, 'c_position', [{ type: 'position', value: 'buyer' }]);

    expect(await grantsOf(rig, OBJECT, member(BY_ID))).toEqual({ c_by_id: [byIdRequest] });
    expect(await grantsOf(rig, OBJECT, member(BY_EMAIL))).toEqual({ c_by_email: [byEmailRequest] });
    // The submitter, a stranger: on no slate.
    expect(await grantsOf(rig, OBJECT, member(SUBMITTER))).toEqual({});
    expect(await grantsOf(rig, OBJECT, member(STRANGER))).toEqual({});
    // A `position:` literal names no person: the holder may decide it, but
    // the read is the resolved person's alone.
    const positionRow = await requestRow(rig, { record_id: 'c_position' });
    expect(String(positionRow.pending_approvers)).toBe('position:buyer');
    expect(await grantsOf(rig, OBJECT, { ...member(BUYER), positions: ['buyer'] })).toEqual({});
    // Another object's records are never granted by this one's requests.
    expect(await grantsOf(rig, OTHER, member(BY_ID))).toEqual({});
    // No user, a system context: nothing to grant (system reads are unscoped anyway).
    expect(await grantsOf(rig, OBJECT, { positions: [], permissions: [] })).toEqual({});
    expect(await grantsOf(rig, OBJECT, SYSTEM)).toEqual({});
  });

  it('grants the override holder every pending record of the object in their organization', async () => {
    const rig = await boot();
    const a = await open(rig, OBJECT, 'c_a', [{ type: 'user', value: BY_ID }]);
    const b = await open(rig, OBJECT, 'c_b', [{ type: 'user', value: BY_EMAIL_ADDRESS }]);
    const tenantAdmin = { ...member('u_admin'), posture: 'TENANT_ADMIN', permissions: ['organization_admin_no_bypass'] };
    expect(await grantsOf(rig, OBJECT, tenantAdmin)).toEqual({ c_a: [a], c_b: [b] });
  });

  it('ends with the step: a decided request grants nothing, on the same request context too', async () => {
    const rig = await boot();
    const request = await open(rig, OBJECT, 'c_decided', [{ type: 'user', value: BY_ID }]);
    const ctx = member(BY_ID);
    expect(await grantsOf(rig, OBJECT, ctx)).toEqual({ c_decided: [request] });

    await rig.svc.decideNode(request, { decision: 'approve', actorId: BY_ID }, member(BY_ID));
    const row = await requestRow(rig, { id: request });
    expect(row.status).toBe('approved');
    expect(await grantsOf(rig, OBJECT, ctx)).toEqual({});
    expect(await grantsOf(rig, OBJECT, member(BY_ID))).toEqual({});

    const rejected = await open(rig, OBJECT, 'c_rejected', [{ type: 'user', value: BY_ID }]);
    expect(await grantsOf(rig, OBJECT, ctx)).toEqual({ c_rejected: [rejected] });
    await rig.svc.decideNode(rejected, { decision: 'reject', actorId: BY_ID }, member(BY_ID));
    expect(await grantsOf(rig, OBJECT, ctx)).toEqual({});
  });

  it('never crosses an organization — the platform administrator\'s override included', async () => {
    const rig = await boot();
    const there = await open(rig, OBJECT, 'c_there', [{ type: 'user', value: BY_ID }], OTHER_ORG);
    const row = await requestRow(rig, { id: there });
    expect(row.organization_id, 'the request lives in the other organization').toBe(OTHER_ORG);

    // The same person, acting in their default organization: nothing.
    expect(await grantsOf(rig, OBJECT, member(BY_ID))).toEqual({});
    // …and in the request's own organization: the record.
    expect(await grantsOf(rig, OBJECT, member(BY_ID, OTHER_ORG))).toEqual({ c_there: [there] });
    // The platform administrator may DECIDE across the wall; the read stays home.
    const platformAdmin = { ...member('u_platform'), posture: 'PLATFORM_ADMIN' };
    expect(await grantsOf(rig, OBJECT, platformAdmin)).toEqual({});
    // An org-less caller reaches only org-less requests.
    expect(await grantsOf(rig, OBJECT, { userId: BY_ID, positions: [], permissions: [] })).toEqual({});
  });

  it('costs one account read and one index read per request context, plus one request read per object — never per record', async () => {
    const rig = await boot();
    const r1 = await open(rig, OBJECT, 'c_1', [{ type: 'user', value: BY_ID }]);
    const r2 = await open(rig, OBJECT, 'c_2', [{ type: 'user', value: BY_ID }]);

    const ctx = member(BY_ID);
    rig.finds.length = 0;
    for (let i = 0; i < 5; i++) expect(await grantsOf(rig, OBJECT, ctx)).toEqual({ c_1: [r1], c_2: [r2] });
    expect(await grantsOf(rig, OTHER, ctx)).toEqual({});
    expect(rig.finds).toEqual(['sys_user', 'sys_approval_approver', 'sys_approval_request', 'sys_approval_request']);

    // A caller on no slate stops after the index read, for every object.
    const stranger = member(STRANGER);
    rig.finds.length = 0;
    await grantsOf(rig, OBJECT, stranger);
    await grantsOf(rig, OTHER, stranger);
    expect(rig.finds).toEqual(['sys_user', 'sys_approval_approver']);

    // Any write through the engine retires the memo: the next read asks again.
    await rig.engine.insert(OTHER, { id: 'm_1', title: 'unrelated', organization_id: DEFAULT_ORGANIZATION_ID }, { context: SYSTEM });
    rig.finds.length = 0;
    await grantsOf(rig, OBJECT, ctx);
    expect(rig.finds).toEqual(['sys_user', 'sys_approval_approver', 'sys_approval_request']);
  });

  it('rethrows a failed read and never memoizes it', async () => {
    const rig = await boot();
    const request = await open(rig, OBJECT, 'c_fault', [{ type: 'user', value: BY_ID }]);
    const ctx = member(BY_ID);
    const find = (rig.engine as any).find;
    let failNext = true;
    (rig.engine as any).find = (object: string, options?: EngineQueryOptions) => {
      if (object === 'sys_approval_approver' && failNext) {
        failNext = false;
        return Promise.reject(new Error('store unavailable'));
      }
      return find(object, options);
    };
    await expect(rig.svc.pendingApproverReadGrants(OBJECT, ctx)).rejects.toThrow('store unavailable');
    expect(await grantsOf(rig, OBJECT, ctx)).toEqual({ c_fault: [request] });
  });
});
