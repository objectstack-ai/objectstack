// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#32442 — maintainer ruling 6849636735, 2B] "Waiting on me" on the generic
 * data door is the approvals door's own answer.
 *
 * The console's My Pending list view and an agent over MCP ask for
 * `status = pending` AND `pending_approvers` contains `{current_user_id}`. Read
 * literally, that misses a slot the caller acts under without its user id: a
 * position nobody held when the step opened stores `position:<p>`, an email
 * approver stores the email. The request read gate answers that conjunct, where
 * it pins the caller's OWN id, with the service's fold (the pending-approver
 * index over the caller's acting addresses), and narrows to the participant set
 * after it as for every read.
 *
 * The rig is `request-read-gate.integration.test.ts`'s: a real ObjectQL engine
 * over better-sqlite3, the real `ApprovalsServicePlugin.start()`, so the gate is
 * the one the plugin binds, and the placeholder is resolved by the engine as in
 * a deployment. No security plugin: every caller holds read on the object (the
 * member baseline grant, ruling 1B, pinned in the dogfood suite).
 *
 *   - an approver whose slot is their user id gets exactly that request;
 *   - a position holder gets the request whose slot is the unstaffed
 *     `position:<p>` literal — the pin a literal `$contains` fails;
 *   - by find, count and grouped count alike;
 *   - a member on no request gets nothing;
 *   - a `pending_approvers` predicate naming ANOTHER id, or under `$or`, is left
 *     as written (and still narrowed to the caller's participant set);
 *   - a decided request leaves the answer.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ApprovalService } from './approval-service.js';
import { ApprovalsServicePlugin } from './approvals-plugin.js';
import { SysApprovalRequest } from './sys-approval-request.object.js';
import { SysApprovalAction } from './sys-approval-action.object.js';
import { SysApprovalApprover } from './sys-approval-approver.object.js';
import { SysApprovalDelegation } from './sys-approval-delegation.object.js';
import { installDefaultOrganization } from './default-organization.testkit.js';
import { splitWaitingOnCaller } from './request-read-gate.js';
import type { EngineAggregateOptions, EngineCountOptions, EngineQueryOptions } from '@objectstack/spec/data';

const REQUEST = 'sys_approval_request';
const OBJECT = 'exam_sheet';
const SYSTEM = { isSystem: true, positions: [], permissions: [] } as any;
const asUser = (userId: string, positions: string[] = []) => ({ userId, positions, permissions: [] }) as any;

const SUBMITTER = 'u_submitter';
const APPROVER = 'u_approver';
/** Holds the position the second request's slot names; on no other request. */
const LEAD = 'u_lead';
const LEAD_POSITION = 'exam_lead';
const OUTSIDER = 'u_outsider';

/** The My Pending filter, as the list view and the MCP tool text spell it. */
const WAITING_ON_ME = { status: 'pending', pending_approvers: { $contains: '{current_user_id}' } };

const examSheet = {
  name: OBJECT,
  label: 'Exam Sheet',
  fields: {
    id: { name: 'id', label: 'Id', type: 'text' as const, primaryKey: true },
    title: { name: 'title', label: 'Title', type: 'text' as const },
  },
};

let current: ObjectQL | undefined;
afterEach(async () => {
  try { await current?.destroy(); } catch { /* noop */ }
  current = undefined;
});

async function boot() {
  const engine = new ObjectQL();
  current = engine;
  engine.registerDriver(new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  }), true);
  await engine.init();
  for (const def of [examSheet, SysApprovalRequest, SysApprovalAction, SysApprovalApprover, SysApprovalDelegation]) {
    engine.registry.registerObject(def as any, 'approvals-waiting-on-caller-test', 'approvals-waiting-on-caller-test');
  }
  await engine.syncSchemas();
  await installDefaultOrganization(engine);
  for (const id of ['sheet_a', 'sheet_b']) {
    await engine.insert(OBJECT, { id, title: id }, { context: SYSTEM } satisfies EngineQueryOptions);
  }

  const services: Record<string, unknown> = { objectql: engine };
  const ctx: any = {
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`[Kernel] Service '${name}' not found`);
      return services[name];
    },
    registerService: (name: string, svc: unknown) => { services[name] = svc; },
    hook: () => {},
    logger: { info: () => {}, debug: () => {}, error: () => {}, warn: () => {} },
  };
  await new ApprovalsServicePlugin({}).start(ctx);
  const svc = services.approvals as ApprovalService;

  const open = async (recordId: string, runId: string) => (await svc.openNodeRequest({
    object: OBJECT, recordId, runId, nodeId: 'review', flowName: 'exam_review',
    config: { approvers: [{ type: 'user', value: APPROVER }], behavior: 'first_response' } as any,
    submitterId: SUBMITTER, record: { id: recordId, title: recordId },
  }, asUser(SUBMITTER)) as any).id as string;
  const byUserId = await open('sheet_a', 'run_a');
  const byPosition = await open('sheet_b', 'run_b');

  // The second step opened on a position nobody held: the slot is the
  // `position:<p>` literal, on the request and in the pending-approver index,
  // as the open path writes it (`approver-address.ts`).
  const literal = `position:${LEAD_POSITION}`;
  await engine.update(REQUEST, { id: byPosition, pending_approvers: literal }, { context: SYSTEM } satisfies EngineQueryOptions);
  const [indexRow] = await engine.find('sys_approval_approver', { where: { request_id: byPosition }, context: SYSTEM } satisfies EngineQueryOptions) as any[];
  await engine.update('sys_approval_approver', { id: indexRow.id, approver: literal }, { context: SYSTEM } satisfies EngineQueryOptions);

  return { engine, svc, ids: { byUserId, byPosition } };
}

const idsOf = (rows: unknown) => (rows as any[]).map((r) => String(r.id)).sort();

describe('[#32442] the request read gate answers "waiting on me" with the approvals fold', () => {
  it('an approver whose slot is their user id gets exactly that request', async () => {
    const rig = await boot();
    const rows = await rig.engine.find(REQUEST, { where: WAITING_ON_ME, context: asUser(APPROVER) } satisfies EngineQueryOptions);
    expect(idsOf(rows)).toEqual([rig.ids.byUserId]);
  });

  it('a position holder gets the request whose slot is the unstaffed position literal, by find, count and grouped count', async () => {
    const rig = await boot();
    const lead = asUser(LEAD, [LEAD_POSITION]);
    // The literal reading matches nothing: the column holds `position:exam_lead`, not the id.
    const stored = await rig.engine.find(REQUEST, { where: { id: rig.ids.byPosition }, context: SYSTEM } satisfies EngineQueryOptions) as any[];
    expect(stored[0].pending_approvers).toBe(`position:${LEAD_POSITION}`);

    expect(idsOf(await rig.engine.find(REQUEST, { where: WAITING_ON_ME, context: lead } satisfies EngineQueryOptions))).toEqual([rig.ids.byPosition]);
    expect(await rig.engine.count(REQUEST, { where: WAITING_ON_ME, context: lead } satisfies EngineCountOptions)).toBe(1);
    const groups = await rig.engine.aggregate(REQUEST, {
      where: WAITING_ON_ME, groupBy: ['status'], aggregations: [{ function: 'count', alias: 'n' }], context: lead,
    } satisfies EngineAggregateOptions) as any[];
    expect(groups.map((g) => [g.status, Number(g.n)])).toEqual([['pending', 1]]);
  });

  it('a member on no request gets nothing, and the submitter gets nothing waiting on them', async () => {
    const rig = await boot();
    expect(await rig.engine.find(REQUEST, { where: WAITING_ON_ME, context: asUser(OUTSIDER) } satisfies EngineQueryOptions)).toEqual([]);
    expect(await rig.engine.count(REQUEST, { where: WAITING_ON_ME, context: asUser(OUTSIDER) } satisfies EngineCountOptions)).toBe(0);
    expect(await rig.engine.find(REQUEST, { where: WAITING_ON_ME, context: asUser(SUBMITTER) } satisfies EngineQueryOptions)).toEqual([]);
    // Control: the submitter's untargeted read serves both requests they filed.
    expect(idsOf(await rig.engine.find(REQUEST, { context: asUser(SUBMITTER) } satisfies EngineQueryOptions)))
      .toEqual([rig.ids.byUserId, rig.ids.byPosition].sort());
  });

  it('a predicate naming another id is left as written, still narrowed to the caller\'s own requests', async () => {
    const rig = await boot();
    // The submitter asks what waits on the approver: read literally, under the
    // submitter's participant set: the one request whose column holds that id.
    const rows = await rig.engine.find(REQUEST, {
      where: { status: 'pending', pending_approvers: { $contains: APPROVER } }, context: asUser(SUBMITTER),
    } satisfies EngineQueryOptions);
    expect(idsOf(rows)).toEqual([rig.ids.byUserId]);
    // An outsider asking the same reads nothing: the participant narrowing still applies.
    expect(await rig.engine.find(REQUEST, {
      where: { pending_approvers: { $contains: APPROVER } }, context: asUser(OUTSIDER),
    } satisfies EngineQueryOptions)).toEqual([]);
  });

  it('a decided request leaves the answer', async () => {
    const rig = await boot();
    await rig.svc.decideNode(rig.ids.byUserId, { decision: 'approve' } as any, asUser(APPROVER));
    expect(await rig.engine.find(REQUEST, { where: WAITING_ON_ME, context: asUser(APPROVER) } satisfies EngineQueryOptions)).toEqual([]);
  });
});

describe('[#32442] splitWaitingOnCaller reads only a conjunctive pin of the caller\'s own id', () => {
  const me = 'u_me';
  it('takes the conjunct out at the root and inside a root $and', () => {
    expect(splitWaitingOnCaller({ status: 'pending', pending_approvers: { $contains: me } }, me))
      .toEqual({ where: { status: 'pending' }, matched: true });
    expect(splitWaitingOnCaller({ $and: [{ status: 'pending' }, { pending_approvers: { $contains: me } }] }, me))
      .toEqual({ where: { $and: [{ status: 'pending' }] }, matched: true });
  });

  it('leaves another id, another operator, and a pin under $or as written', () => {
    for (const where of [
      { pending_approvers: { $contains: 'u_other' } },
      { pending_approvers: me },
      { pending_approvers: { $contains: me, $ne: 'x' } },
      { $or: [{ pending_approvers: { $contains: me } }, { status: 'pending' }] },
    ]) {
      expect(splitWaitingOnCaller(where, me)).toEqual({ where, matched: false });
    }
  });
});
