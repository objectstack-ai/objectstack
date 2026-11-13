// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #32442 (ruling A) — an approver's agent decides a pending approval request
// over MCP, through the request's own decide actions, behind the same gate the
// console's buttons reach.
//
// The four approver decisions on `sys_approval_request` (approve, reject,
// reassign, send back) declare `ai: { exposed: true, requiresConfirmation: true }`.
// Each is a same-origin `type: 'api'` action, so `run_action` forwards it to its
// approvals route as the CALLER, and `ApprovalService` decides who may act.
// Nothing in the MCP door or the action door adds a check of its own, so the
// negative pins below are the service's gate observed through the live MCP
// transport, not a second gate.
//
// [#32993] The submitter's side of the same process: `approval_recall` and
// `approval_resubmit` declare the same `ai` shape, forwarded to their routes as
// the caller, so `ApprovalService` decides who may recall or resubmit.
//
// Real `SecurityPlugin`, real flows, real approvals plugin, real MCP plugin. A
// one-step flow waits on one approver, addressed by email, with an ADR-0044
// revise window (send back → returned → resubmit).
//
//   ⭐ `list_actions` lists the four decisions and the submitter's recall and
//      resubmit on `sys_approval_request`, attested `aiExposed`, and none of
//      the other levers;
//   ⭐ a member on no slate is refused, and the request stays pending;
//   ⭐ the submitter is refused, and the request stays pending;
//   ⭐ an AI service account acting for itself (ADR-0151, its own API key, on
//      no slate) is refused, and the request stays pending;
//   ⭐ the approver is refused `428` until the call carries `confirm: true`;
//   ⭐ confirmed, the approver's call decides: the request is approved and
//      the decision is recorded once, as the approver's;
//   ⭐ [#32993] the submitter's recall is refused `428` until confirmed, then
//      withdraws the pending request, recorded once as the submitter's;
//   ⭐ [#32993] a caller who is not the submitter (the approver) is refused
//      recall in `approval_recall_not_submitter`'s words, and the request
//      stays pending;
//   ⭐ [#32993] on a request sent back for revision, the submitter edits the
//      record and resubmits over MCP (confirmed): round 2 opens a pending
//      request; unconfirmed, or from the approver, nothing moves.
//
// The read half of the card (an approver listing their pending requests over
// MCP) is not here: the MCP object tools refuse every `sys_*` object, so this
// file finds each request id as the system.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { bootStack } from '@objectstack/verify';
import { ApprovalsServicePlugin } from '@objectstack/plugin-approvals';
import { RecordChangeTriggerPlugin } from '@objectstack/trigger-record-change';
import { MCPServerPlugin } from '@objectstack/mcp';
import { defineStack, defineFlow } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import { PermissionSetSchema, type PermissionSet } from '@objectstack/spec/security';
import { AI_ACTION_CONFIRMATION_MEMBER } from '@objectstack/spec/contracts';
import { BUILTIN_OPERATION_MESSAGES } from '@objectstack/spec/system';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';
import { catalogPermissionSet } from './catalog-permission-set.js';

const OBJECT = 'apmcp_leave';
const REQUEST = 'sys_approval_request';
const SYS = { context: { isSystem: true } } as const;
const rowsOf = (r: any): any[] => (Array.isArray(r) ? r : Array.isArray(r?.records) ? r.records : Array.isArray(r?.value) ? r.value : []);

const SUBMITTER = 'apmcp-submitter@verify.test';
const APPROVER = 'apmcp-approver@verify.test';
const STRANGER = 'apmcp-stranger@verify.test';

const DECISIONS = ['approval_approve', 'approval_reassign', 'approval_reject', 'approval_send_back'];
// [#32993] The submitter's recall and resubmit, exposed beside the decisions.
const EXPOSED = [...DECISIONS, 'approval_recall', 'approval_resubmit'].sort();
const RECALL_REFUSAL = BUILTIN_OPERATION_MESSAGES.en!.approval_recall_not_submitter!;

const leave = ObjectSchema.create({
  name: OBJECT,
  label: 'Leave Request',
  pluralLabel: 'Leave Requests',
  fields: { name: Field.text({ label: 'Name', required: true }) },
});

const flow = defineFlow({
  name: `${OBJECT}_flow`,
  label: 'Leave approval',
  description: 'Fires on insert and waits on one approver.',
  type: 'autolaunched',
  status: 'active',
  nodes: [
    { id: 'start', type: 'start', label: 'On Create', config: { objectName: OBJECT, triggerType: 'record-after-create' } },
    {
      id: 'manager',
      type: 'approval',
      label: 'Manager',
      config: { approvers: [{ type: 'user', value: APPROVER }], behavior: 'first_response', lockRecord: false },
    },
    // ADR-0044 revise window, so a request can be sent back (`returned`) and resubmitted.
    { id: 'rework', type: 'approval_revise', label: 'Awaiting Revision' },
    { id: 'approved', type: 'end', label: 'Approved' },
    { id: 'rejected', type: 'end', label: 'Rejected' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'manager' },
    { id: 'e2', source: 'manager', target: 'approved', label: 'approve' },
    { id: 'e3', source: 'manager', target: 'rejected', label: 'reject' },
    { id: 'e4', source: 'manager', target: 'rework', label: 'revise' },
    { id: 'e5', source: 'rework', target: 'manager', label: 'resubmit', type: 'back' },
  ],
});

const stackConfig = defineStack({
  manifest: {
    id: 'com.dogfood.approval-decide-over-mcp',
    namespace: 'apmcp',
    version: '0.0.0',
    type: 'app',
    name: 'Approval Decide Over MCP Fixture',
    description: 'A one-step approval flow on one object, decided over MCP.',
  },
  requires: ['automation', 'triggers'],
  objects: [leave],
  flows: [flow],
});

const baselineSet: PermissionSet = PermissionSetSchema.parse({
  name: 'apmcp_baseline',
  label: 'Approval Decide Over MCP Baseline — CRUD on the fixture object',
  objects: { [OBJECT]: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: false } },
});

type Caller = { bearer: string } | { key: string };

describe('an approver\'s agent decides a pending approval request over MCP (#32442)', () => {
  let stack: VerifyStack;
  let ql: any;
  let submitter: string;
  let approver: string;
  let stranger: string;
  let approverId: string;
  let submitterId: string;
  let accountKey: string;

  const idOf = async (email: string): Promise<string> =>
    String((await ql.findOne('sys_user', { where: { email }, context: SYS.context }))?.id ?? '');

  /** One `tools/call` over the live MCP transport, as a bearer or as an API key. */
  const tool = async (as: Caller, name: string, args: Record<string, unknown>) => {
    const res = await stack.api('/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...('bearer' in as ? { Authorization: `Bearer ${as.bearer}` } : { 'x-api-key': as.key }),
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    });
    expect(res.status).toBe(200);
    const rpc: any = await res.json();
    expect(rpc.error, JSON.stringify(rpc.error)).toBeUndefined();
    const text = String(rpc.result?.content?.[0]?.text ?? '');
    let payload: any;
    try { payload = JSON.parse(text); } catch { payload = { message: text }; }
    return { isError: rpc.result?.isError === true, payload, text };
  };
  /** `run_action` on one request's action, confirmed or not. */
  const act = (as: Caller, actionName: string, requestId: string, confirm: boolean, comment: string) =>
    tool(as, 'run_action', {
      actionName,
      objectName: REQUEST,
      recordId: requestId,
      params: { comment },
      ...(confirm ? { [AI_ACTION_CONFIRMATION_MEMBER]: true } : {}),
    });
  const approve = (as: Caller, requestId: string, confirm: boolean) =>
    act(as, 'approval_approve', requestId, confirm, 'approved over MCP');

  const requestRow = async (requestId: string) =>
    rowsOf(await ql.find(REQUEST, { where: { id: requestId }, context: SYS.context }))[0];
  const decisionsOn = async (requestId: string) =>
    rowsOf(await ql.find('sys_approval_action', { where: { request_id: requestId }, context: SYS.context }))
      .filter((r) => r.action !== 'submit');

  /** The submitter files one leave request; the flow opens its pending step. Each pin gets its own. */
  const openRequest = async (name: string): Promise<string> => {
    const res = await stack.apiAs(submitter, 'POST', `/data/${OBJECT}`, { name });
    expect(res.status, await res.clone().text()).toBe(201);
    const created = (await res.json()) as { id?: string; record?: { id?: string } };
    const recordId = String(created.id ?? created.record?.id ?? '');
    const [opened] = rowsOf(await ql.find(REQUEST, { where: { object_name: OBJECT, record_id: recordId }, context: SYS.context }));
    expect(opened, 'the flow opened the approval step').toBeTruthy();
    expect(opened.status).toBe('pending');
    return String(opened.id);
  };
  /** The request is still pending and no decision was recorded on it. */
  const expectUndecided = async (requestId: string, who: string) => {
    expect((await requestRow(requestId)).status, `${who} must not move the request`).toBe('pending');
    expect(await decisionsOn(requestId), `${who} must not record a decision`).toEqual([]);
  };

  beforeAll(async () => {
    stack = await bootStack(stackConfig as unknown as Parameters<typeof bootStack>[0], {
      automation: true,
      security: new SecurityPlugin({
        defaultPermissionSets: [...securityDefaultPermissionSets, baselineSet],
        fallbackPermissionSet: baselineSet.name,
      }),
      extraPlugins: [new RecordChangeTriggerPlugin(), new ApprovalsServicePlugin(), new MCPServerPlugin()],
    });
    ql = await stack.kernel.getServiceAsync('objectql');
    const admin = await stack.signIn();
    submitter = await stack.signUp(SUBMITTER);
    approver = await stack.signUp(APPROVER);
    stranger = await stack.signUp(STRANGER);
    for (const email of [SUBMITTER, APPROVER, STRANGER]) {
      expect(await catalogPermissionSet(ql, baselineSet.name), `${baselineSet.name} is served by the catalog`).toBeTruthy();
      await ql.insert('sys_user_permission_set', { user_id: await idOf(email), permission_set: baselineSet.name }, SYS);
    }
    approverId = await idOf(APPROVER);
    expect(approverId).not.toBe('');
    submitterId = await idOf(SUBMITTER);
    expect(submitterId).not.toBe('');

    // An AI service account acting for itself (ADR-0151): registered by the
    // administrator, its key minted for it, on no slate.
    const adminId = String(((await (await stack.apiAs(admin, 'GET', '/auth/get-session')).json()) as any)?.user?.id ?? '');
    const registered = await stack.apiAs(admin, 'POST', '/auth/service-account/register', { name: 'Leave bot', ownerId: adminId });
    const registeredBody: any = await registered.json();
    expect(registered.status, JSON.stringify(registeredBody)).toBe(201);
    const accountId = String(registeredBody.data.userId);
    const minted = await stack.apiAs(admin, 'POST', '/auth/service-account/create-key', { userId: accountId, name: 'leave bot key' });
    const mintedBody: any = await minted.json();
    expect(minted.status, JSON.stringify(mintedBody)).toBe(201);
    accountKey = String(mintedBody.data.key);
  }, 300_000);

  afterAll(async () => {
    await stack?.stop?.();
  });

  it('⭐ the approver\'s and the submitter\'s agents list the decisions, recall and resubmit, attested and asking for confirmation, and none of the other levers', async () => {
    await openRequest('listed');
    for (const [who, token] of [['approver', approver], ['submitter', submitter]] as const) {
      const listed = await tool({ bearer: token }, 'list_actions', {});
      expect(listed.isError, listed.text).toBe(false);
      const onRequest = (listed.payload.actions as any[]).filter((a) => a.objectName === REQUEST);
      expect(onRequest.map((a) => a.name).sort(), `${who}'s list_actions`).toEqual(EXPOSED);
      for (const row of onRequest) {
        expect(row.aiExposed, `${row.name} is attested as exposed`).toBe(true);
        expect(row.requiresConfirmation, `${row.name} asks for confirmation`).toBe(true);
      }
    }
  });

  it('⭐ a member on no slate is refused, confirmed or not, and the request stays pending', async () => {
    const requestId = await openRequest('stranger');
    const answer = await approve({ bearer: stranger }, requestId, true);
    expect(answer.isError, answer.text).toBe(true);
    // The service's own answer: a request the caller takes no part in is
    // answered as missing (existence non-disclosure), never decided.
    expect(answer.payload?.error?.code, answer.text).toBe('REQUEST_NOT_FOUND');
    await expectUndecided(requestId, 'a member on no slate');
  });

  it('⭐ the submitter is refused, and the request stays pending', async () => {
    const requestId = await openRequest('submitter');
    const answer = await approve({ bearer: submitter }, requestId, true);
    expect(answer.isError, answer.text).toBe(true);
    expect(answer.payload?.error?.code, answer.text).toBe('FORBIDDEN');
    expect(answer.text).toContain('is not a pending approver');
    await expectUndecided(requestId, 'the submitter');
  });

  it('⭐ an AI service account acting for itself is refused, and the request stays pending', async () => {
    const requestId = await openRequest('account');
    const answer = await approve({ key: accountKey }, requestId, true);
    expect(answer.isError, answer.text).toBe(true);
    // The account confirmation rule answers first (ADR-0151 D3 rule 3): an AI
    // service account does not confirm an action for itself, so the decision
    // action, which declares `ai.requiresConfirmation`, is refused at admission
    // whatever the call carries, before the request is looked up.
    expect(answer.payload?.error?.code, answer.text).toBe('ACTION_CONFIRMATION_REQUIRED');
    expect(answer.payload?.error?.status, answer.text).toBe(428);
    await expectUndecided(requestId, 'an AI service account');
  });

  it('⭐ the approver is refused until the call is confirmed, then decides, recorded once as the approver\'s', async () => {
    const requestId = await openRequest('approver');
    const unconfirmed = await approve({ bearer: approver }, requestId, false);
    expect(unconfirmed.isError, unconfirmed.text).toBe(true);
    expect(unconfirmed.text).toContain('ACTION_CONFIRMATION_REQUIRED');
    await expectUndecided(requestId, 'an unconfirmed call');

    const confirmed = await approve({ bearer: approver }, requestId, true);
    expect(confirmed.isError, confirmed.text).toBe(false);
    expect((await requestRow(requestId)).status).toBe('approved');
    expect((await decisionsOn(requestId)).map((r) => [r.action, r.actor_id])).toEqual([['approve', approverId]]);
  });

  it('⭐ [#32993] the submitter\'s recall is refused until confirmed, then withdraws the pending request, recorded once as the submitter\'s', async () => {
    const requestId = await openRequest('recall');
    const unconfirmed = await act({ bearer: submitter }, 'approval_recall', requestId, false, 'fixing the lines');
    expect(unconfirmed.isError, unconfirmed.text).toBe(true);
    expect(unconfirmed.text).toContain('ACTION_CONFIRMATION_REQUIRED');
    await expectUndecided(requestId, 'an unconfirmed recall');

    const confirmed = await act({ bearer: submitter }, 'approval_recall', requestId, true, 'fixing the lines');
    expect(confirmed.isError, confirmed.text).toBe(false);
    expect((await requestRow(requestId)).status).toBe('recalled');
    expect((await decisionsOn(requestId)).map((r) => [r.action, r.actor_id])).toEqual([['recall', submitterId]]);
  });

  it('⭐ [#32993] a caller who is not the submitter is refused recall in the service\'s own words, and the request stays pending', async () => {
    const requestId = await openRequest('recall-not-submitter');
    const answer = await act({ bearer: approver }, 'approval_recall', requestId, true, 'not mine to recall');
    expect(answer.isError, answer.text).toBe(true);
    expect(answer.payload?.error?.code, answer.text).toBe('FORBIDDEN');
    expect(answer.text).toContain(RECALL_REFUSAL);
    await expectUndecided(requestId, 'a recall by the approver');
  });

  it('⭐ [#32993] on a request sent back for revision, the submitter edits the record and resubmits over MCP: round 2 opens a pending request', async () => {
    const requestId = await openRequest('resubmit');
    const recordId = String((await requestRow(requestId)).record_id);
    const sentBack = await act({ bearer: approver }, 'approval_send_back', requestId, true, 'fix the dates');
    expect(sentBack.isError, sentBack.text).toBe(false);
    expect((await requestRow(requestId)).status).toBe('returned');

    const edited = await stack.apiAs(submitter, 'PATCH', `/data/${OBJECT}/${recordId}`, { name: 'resubmit (dates fixed)' });
    expect(edited.status, await edited.clone().text()).toBe(200);

    const pendingOn = async () =>
      rowsOf(await ql.find(REQUEST, { where: { object_name: OBJECT, record_id: recordId, status: 'pending' }, context: SYS.context }));

    // Unconfirmed, or from anyone but the submitter, nothing moves.
    const unconfirmed = await act({ bearer: submitter }, 'approval_resubmit', requestId, false, 'dates fixed');
    expect(unconfirmed.isError, unconfirmed.text).toBe(true);
    expect(unconfirmed.text).toContain('ACTION_CONFIRMATION_REQUIRED');
    const byApprover = await act({ bearer: approver }, 'approval_resubmit', requestId, true, 'not mine');
    expect(byApprover.isError, byApprover.text).toBe(true);
    expect(byApprover.payload?.error?.code, byApprover.text).toBe('FORBIDDEN');
    expect((await requestRow(requestId)).status).toBe('returned');
    expect(await pendingOn(), 'no round 2 before the submitter\'s confirmed resubmit').toEqual([]);

    const confirmed = await act({ bearer: submitter }, 'approval_resubmit', requestId, true, 'dates fixed');
    expect(confirmed.isError, confirmed.text).toBe(false);
    const round2 = await pendingOn();
    expect(round2, 'the resubmit opened round 2').toHaveLength(1);
    expect(round2[0].id).not.toBe(requestId);
    // One row each, in no stored order (the read is unsorted).
    expect((await decisionsOn(requestId)).map((r) => `${r.action}:${r.actor_id}`).sort()).toEqual(
      [`resubmit:${submitterId}`, `revise:${approverId}`].sort(),
    );
  });
});
