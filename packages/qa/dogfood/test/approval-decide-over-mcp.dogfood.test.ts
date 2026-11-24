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
//      no slate) is refused, and the request stays pending: the account
//      confirmation rule (ADR-0151 D3 rule 3) answers first, `428`
//      `ACTION_CONFIRMATION_REQUIRED` with `details.reason: 'service_account'`
//      whatever the call sends;
//   ⭐ [#33690] every other caller's decision, recall, send-back and resubmit
//      runs nothing over MCP, confirmed or not: the actions declare
//      `ai.requiresConfirmation: true`, so the caller's own `confirm: true`
//      never counts, and this stack registers no pending-confirmation service,
//      so each call is refused `428`, `details.reason:
//      'no_confirmation_service'`, and the request stays pending. Before the
//      amended contract a confirmed call decided here; a person now decides in
//      the app (a host's pending-confirmation service hands the call to them).
//      [#34209] A call that carries `confirm` at all is refused earlier, at
//      `run_action`'s closed input, and the request stays pending as well.

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

  /**
   * [#33690] What every decision call over MCP answers now: the decide,
   * recall, resubmit and send-back actions declare `ai.requiresConfirmation:
   * true`, so the caller's own `confirm: true` never runs them; this stack
   * registers no pending-confirmation service, so the call is refused at
   * confirmation, after the request row is read and before it is forwarded.
   * [#34209] A call that carries the retired `confirm` member is refused
   * earlier still, at the tool's closed input, and never reaches the action:
   * with `confirm` set, that refusal is what is asserted.
   */
  const expectRefusedAtConfirmation = (
    answer: { isError: boolean; payload: any; text: string }, reason: string, confirm = false,
  ) => {
    expect(answer.isError, answer.text).toBe(true);
    if (confirm) {
      expect(answer.text).toContain(`\`${AI_ACTION_CONFIRMATION_MEMBER}\``);
      expect(answer.payload?.error?.code, answer.text).toBeUndefined();
      return;
    }
    expect(answer.payload?.error?.code, answer.text).toBe('ACTION_CONFIRMATION_REQUIRED');
    expect(answer.payload?.error?.status, answer.text).toBe(428);
    expect(answer.payload?.error?.details?.reason, answer.text).toBe(reason);
  };

  it('⭐ a member on no slate is refused, confirmed or not, and the request stays pending', async () => {
    const requestId = await openRequest('stranger');
    for (const confirm of [true, false]) {
      // [#33690] Refused at confirmation now, never forwarded: the service's
      // own `REQUEST_NOT_FOUND` is no longer reached over MCP.
      expectRefusedAtConfirmation(await approve({ bearer: stranger }, requestId, confirm), 'no_confirmation_service', confirm);
    }
    await expectUndecided(requestId, 'a member on no slate');
  });

  it('⭐ the submitter is refused, and the request stays pending', async () => {
    const requestId = await openRequest('submitter');
    expectRefusedAtConfirmation(await approve({ bearer: submitter }, requestId, false), 'no_confirmation_service');
    await expectUndecided(requestId, 'the submitter');
  });

  it('⭐ an AI service account acting for itself is refused, and the request stays pending', async () => {
    const requestId = await openRequest('account');
    // The account confirmation rule answers first (ADR-0151 D3 rule 3): an AI
    // service account does not confirm an action for itself, so the decision
    // action, which declares `ai.requiresConfirmation`, is refused at admission
    // whatever the call carries, before the request is looked up; [#33690]
    // the refusal names `reason: 'service_account'`.
    expectRefusedAtConfirmation(await approve({ key: accountKey }, requestId, false), 'service_account');
    await expectUndecided(requestId, 'an AI service account');
  });

  it('⭐ [#33690] the approver\'s call decides nothing, confirmed or not: refused at confirmation, the request stays pending', async () => {
    const requestId = await openRequest('approver');
    for (const confirm of [false, true]) {
      expectRefusedAtConfirmation(await approve({ bearer: approver }, requestId, confirm), 'no_confirmation_service', confirm);
      await expectUndecided(requestId, `an approver's call (confirm: ${confirm})`);
    }
  });

  it('⭐ [#33690] the submitter\'s recall, resubmit and the approver\'s send-back run nothing over MCP, confirmed or not', async () => {
    const requestId = await openRequest('recall');
    for (const confirm of [false, true]) {
      expectRefusedAtConfirmation(
        await act({ bearer: submitter }, 'approval_recall', requestId, confirm, 'fixing the lines'), 'no_confirmation_service', confirm,
      );
      expectRefusedAtConfirmation(
        await act({ bearer: approver }, 'approval_send_back', requestId, confirm, 'fix the dates'), 'no_confirmation_service', confirm,
      );
      expectRefusedAtConfirmation(
        await act({ bearer: submitter }, 'approval_resubmit', requestId, confirm, 'dates fixed'), 'no_confirmation_service', confirm,
      );
    }
    await expectUndecided(requestId, 'recall, send-back and resubmit over MCP');
  });

  /**
   * A reject through `approval_reject` always carries its reason: it declares its
   * `comment` required, so the declared param contract (ADR-0104 D2) refuses a
   * missing or blank one at the REST action door and at MCP `run_action`,
   * before the confirmation gate and before the approvals route. CONTROL: the
   * approver's REST reject with a reason rejects the request as before.
   */
  it('⭐ a reject with no reason, or a blank one, is refused at the REST action door and over MCP; with a reason it rejects', async () => {
    const requestId = await openRequest('reject-reason');
    const restReject = (params: Record<string, unknown>) =>
      stack.apiAs(approver, 'POST', `/actions/${REQUEST}/approval_reject`, { recordId: requestId, params });
    for (const params of [{}, { comment: '' }, { comment: '  \n\t ' }]) {
      const res = await restReject(params);
      const body: any = await res.json();
      const label = `REST ${JSON.stringify(params)} → ${JSON.stringify(body)}`;
      expect([res.status, body?.error?.code ?? body?.code], label).toEqual([400, 'VALIDATION_ERROR']);
      expect(String(body?.error?.message), label).toMatch(/\bcomment\b/);
      const viaMcp = await act({ bearer: approver }, 'approval_reject', requestId, false, String(params.comment ?? ''));
      expect(viaMcp.isError, viaMcp.text).toBe(true);
      expect([viaMcp.payload?.error?.status, viaMcp.payload?.error?.code], viaMcp.text).toEqual([400, 'VALIDATION_ERROR']);
      expect(String(viaMcp.payload?.error?.message), viaMcp.text).toMatch(/\bcomment\b/);
    }
    await expectUndecided(requestId, 'a reject without a reason');

    const res = await restReject({ comment: 'Over budget.' });
    expect(res.status, await res.clone().text()).toBe(200);
    expect((await requestRow(requestId)).status).toBe('rejected');
    expect((await decisionsOn(requestId)).map((r) => [r.action, r.comment])).toEqual([['reject', 'Over budget.']]);
  });
});
