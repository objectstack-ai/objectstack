// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #32442 (ruling A, the read half) — an approver's agent lists the approval
// requests waiting on them over MCP, with the existing record tools, and then
// decides one.
//
// `sys_approval_request` declares `enable.aiReadable: true` (#32865), so the
// MCP read tools (list, describe, query, get one, aggregate) admit it past the
// `sys_*` refusal. Nothing else changes after admission: the caller's
// permissions, the approvals request-read gate (`request-read-gate.ts`, the
// participant set) and the payload redaction still decide which rows and which
// field values the caller is served. Every write tool still refuses the object.
//
// "Pending for me" is the console's My Pending list view, filter for filter:
// `status = pending` and `pending_approvers` contains `{current_user_id}`. The
// engine resolves the placeholder against the caller, so the MCP door reaches
// it without a resolver of its own.
//
// Real `SecurityPlugin`, real flows, real approvals plugin, real MCP plugin. A
// one-step flow waits on one approver, addressed by email.
//
//   ⭐ the approver's "pending for me" query returns exactly the requests
//      waiting on them, with the display fields the inbox row shows;
//   ⭐ the same query as the submitter returns nothing;
//   ⭐ a member on no request reads nothing, by query or by id;
//   ⭐ the object is listed, described and countable; no write tool opens it,
//      and its sibling `sys_approval_action` stays refused;
//   ⭐ the query tool's text names the "pending for me" filter shape;
//   ⭐ end to end: the submitter files over MCP, the approver lists, approves
//      with confirmation, and the record's run resumes.

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

const OBJECT = 'aprmcp_overtime';
const REQUEST = 'sys_approval_request';
const SYS = { context: { isSystem: true } } as const;
const rowsOf = (r: any): any[] => (Array.isArray(r) ? r : Array.isArray(r?.records) ? r.records : Array.isArray(r?.value) ? r.value : []);

const SUBMITTER = 'aprmcp-submitter@verify.test';
const APPROVER = 'aprmcp-approver@verify.test';
const STRANGER = 'aprmcp-stranger@verify.test';

/** The console's My Pending filter, spelled as an MCP `where`. */
const PENDING_FOR_ME = { status: 'pending', pending_approvers: { $contains: '{current_user_id}' } };

const overtime = ObjectSchema.create({
  name: OBJECT,
  label: 'Overtime Request',
  pluralLabel: 'Overtime Requests',
  fields: { name: Field.text({ label: 'Name', required: true }) },
});

const flow = defineFlow({
  name: `${OBJECT}_flow`,
  label: 'Overtime approval',
  description: 'Fires on insert and waits on one approver.',
  type: 'autolaunched',
  status: 'active',
  nodes: [
    { id: 'start', type: 'start', label: 'On Create', config: { objectName: OBJECT, triggerType: 'record-after-create' } },
    {
      id: 'manager',
      type: 'approval',
      label: 'Manager review',
      config: { approvers: [{ type: 'user', value: APPROVER }], behavior: 'first_response', lockRecord: false },
    },
    { id: 'approved', type: 'end', label: 'Approved' },
    { id: 'rejected', type: 'end', label: 'Rejected' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'manager' },
    { id: 'e2', source: 'manager', target: 'approved', label: 'approve' },
    { id: 'e3', source: 'manager', target: 'rejected', label: 'reject' },
  ],
});

const stackConfig = defineStack({
  manifest: {
    id: 'com.dogfood.approval-read-over-mcp',
    namespace: 'aprmcp',
    version: '0.0.0',
    type: 'app',
    name: 'Approval Read Over MCP Fixture',
    description: 'A one-step approval flow on one object, listed and decided over MCP.',
  },
  requires: ['automation', 'triggers'],
  objects: [overtime],
  flows: [flow],
});

const baselineSet: PermissionSet = PermissionSetSchema.parse({
  name: 'aprmcp_baseline',
  label: 'Approval Read Over MCP Baseline — CRUD on the fixture object',
  objects: {
    [OBJECT]: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: false },
    // PROBE: the app grants read on the request object (a member holds none by default).
    [REQUEST]: { allowRead: true, allowCreate: false, allowEdit: false, allowDelete: false },
  },
});

type Caller = { bearer: string };

describe('an approver\'s agent lists the approvals waiting on them over MCP (#32442, read half)', () => {
  let stack: VerifyStack;
  let ql: any;
  let submitter: string;
  let approver: string;
  let stranger: string;
  let submitterId: string;

  const idOf = async (email: string): Promise<string> =>
    String((await ql.findOne('sys_user', { where: { email }, context: SYS.context }))?.id ?? '');

  /** One MCP JSON-RPC call over the live transport, as a bearer. */
  const rpc = async (as: Caller, method: string, params: Record<string, unknown>) => {
    const res = await stack.api('/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${as.bearer}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.error, JSON.stringify(body.error)).toBeUndefined();
    return body.result;
  };
  /** One `tools/call`, its first content block parsed. */
  const tool = async (as: Caller, name: string, args: Record<string, unknown>) => {
    const result = await rpc(as, 'tools/call', { name, arguments: args });
    const text = String(result?.content?.[0]?.text ?? '');
    let payload: any;
    try { payload = JSON.parse(text); } catch { payload = { message: text }; }
    return { isError: result?.isError === true, payload, text };
  };
  const pendingForMe = (as: Caller) =>
    tool(as, 'query_records', { objectName: REQUEST, where: PENDING_FOR_ME });

  const requestRow = async (requestId: string) =>
    rowsOf(await ql.find(REQUEST, { where: { id: requestId }, context: SYS.context }))[0];

  /** The submitter files one overtime request over MCP; the flow opens its pending step. */
  const fileOverMcp = async (name: string): Promise<{ recordId: string; requestId: string }> => {
    const created = await tool({ bearer: submitter }, 'create_record', { objectName: OBJECT, data: { name } });
    expect(created.isError, created.text).toBe(false);
    const recordId = String(created.payload?.id ?? created.payload?.record?.id ?? '');
    expect(recordId).not.toBe('');
    const [opened] = rowsOf(await ql.find(REQUEST, { where: { object_name: OBJECT, record_id: recordId }, context: SYS.context }));
    expect(opened, 'the flow opened the approval step').toBeTruthy();
    expect(opened.status).toBe('pending');
    return { recordId, requestId: String(opened.id) };
  };

  let first: { recordId: string; requestId: string };
  let second: { recordId: string; requestId: string };

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
    await stack.signIn();
    submitter = await stack.signUp(SUBMITTER);
    approver = await stack.signUp(APPROVER);
    stranger = await stack.signUp(STRANGER);
    for (const email of [SUBMITTER, APPROVER, STRANGER]) {
      expect(await catalogPermissionSet(ql, baselineSet.name), `${baselineSet.name} is served by the catalog`).toBeTruthy();
      await ql.insert('sys_user_permission_set', { user_id: await idOf(email), permission_set: baselineSet.name }, SYS);
    }
    submitterId = await idOf(SUBMITTER);
    first = await fileOverMcp('saturday shift');
    second = await fileOverMcp('sunday shift');
  }, 300_000);

  afterAll(async () => {
    await stack?.stop?.();
  });

  it('⭐ the approver\'s "pending for me" query returns exactly the requests waiting on them, with the inbox row\'s display fields', async () => {
    const answer = await pendingForMe({ bearer: approver });
    expect(answer.isError, answer.text).toBe(false);
    const rows = rowsOf(answer.payload);
    expect(rows.map((r) => String(r.id)).sort()).toEqual([first.requestId, second.requestId].sort());
    for (const row of rows) {
      expect(row.status).toBe('pending');
      // What an agent tells its user without a second lookup: which flow,
      // which step, who submitted, and which record.
      expect(row.process_label).toBe('Overtime approval');
      expect(row.current_step_label).toBe('Manager review');
      expect(String(row.submitter_id?.id ?? row.submitter_id)).toBe(submitterId);
      expect(row.object_name).toBe(OBJECT);
      expect([first.recordId, second.recordId]).toContain(String(row.record_id));
    }
  });

  it('⭐ the same query as the submitter returns nothing, though the submitter reads their own requests', async () => {
    const mine = await pendingForMe({ bearer: submitter });
    expect(mine.isError, mine.text).toBe(false);
    expect(rowsOf(mine.payload)).toEqual([]);
    // The participant read is wider: the submitter's untargeted read serves
    // the requests they filed. "Pending for me" is the filter, not the gate.
    const all = await tool({ bearer: submitter }, 'query_records', { objectName: REQUEST });
    expect(all.isError, all.text).toBe(false);
    expect(rowsOf(all.payload).map((r) => String(r.id)).sort()).toEqual([first.requestId, second.requestId].sort());
  });

  it('⭐ a member on no request reads nothing new: no rows, and a by-id read answers as missing', async () => {
    const listed = await tool({ bearer: stranger }, 'query_records', { objectName: REQUEST });
    expect(listed.isError, listed.text).toBe(false);
    expect(rowsOf(listed.payload)).toEqual([]);
    const byId = await tool({ bearer: stranger }, 'get_record', { objectName: REQUEST, recordId: first.requestId });
    const served = byId.isError ? undefined : (byId.payload?.record ?? byId.payload);
    expect(served?.id, byId.text).toBeUndefined();
  });

  it('⭐ the object is listed, described and countable for the approver; no write tool opens it, and sys_approval_action stays refused', async () => {
    const listed = await tool({ bearer: approver }, 'list_objects', {});
    expect(listed.isError, listed.text).toBe(false);
    const names = (listed.payload.objects as any[]).map((o) => o.name);
    expect(names).toContain(REQUEST);
    expect(names.filter((n) => /^sys_/i.test(n))).toEqual([REQUEST]);

    const described = await tool({ bearer: approver }, 'describe_object', { objectName: REQUEST });
    expect(described.isError, described.text).toBe(false);
    expect(JSON.stringify(described.payload)).toContain('pending_approvers');

    const counted = await tool({ bearer: approver }, 'aggregate_records', {
      objectName: REQUEST,
      where: PENDING_FOR_ME,
      aggregations: [{ function: 'count', alias: 'n' }],
    });
    expect(counted.isError, counted.text).toBe(false);
    expect(JSON.stringify(counted.payload)).toContain('"n":2');

    const writes: Array<[string, Record<string, unknown>]> = [
      ['create_record', { objectName: REQUEST, data: { status: 'approved' } }],
      ['update_record', { objectName: REQUEST, recordId: first.requestId, data: { status: 'approved' } }],
      ['delete_record', { objectName: REQUEST, recordId: first.requestId }],
    ];
    for (const [name, args] of writes) {
      const refused = await tool({ bearer: approver }, name, args);
      expect(refused.isError, `${name}: ${refused.text}`).toBe(true);
      expect(refused.text).toContain('is a system object and is not exposed via MCP');
    }
    expect((await requestRow(first.requestId)).status).toBe('pending');

    const sibling = await tool({ bearer: approver }, 'query_records', { objectName: 'sys_approval_action' });
    expect(sibling.isError, sibling.text).toBe(true);
    expect(sibling.text).toContain('is a system object and is not exposed via MCP');
  });

  it('⭐ the query tool\'s text tells an agent the "pending for me" filter shape', async () => {
    const listed = await rpc({ bearer: approver }, 'tools/list', {});
    const query = (listed.tools as any[]).find((t) => t.name === 'query_records');
    expect(query?.description).toContain(REQUEST);
    expect(query?.description).toContain('{current_user_id}');
    expect(query?.description).toContain('pending_approvers');
  });

  it('⭐ end to end: the approver lists what waits on them, approves one with confirmation, and the run resumes', async () => {
    const before = rowsOf((await pendingForMe({ bearer: approver })).payload);
    const target = before.find((r) => String(r.record_id) === first.recordId);
    expect(target, 'the approver sees the request in their pending list').toBeTruthy();

    const decided = await tool({ bearer: approver }, 'run_action', {
      actionName: 'approval_approve',
      objectName: REQUEST,
      recordId: String(target.id),
      params: { comment: 'approved over MCP' },
      [AI_ACTION_CONFIRMATION_MEMBER]: true,
    });
    expect(decided.isError, decided.text).toBe(false);

    const row = await requestRow(first.requestId);
    expect(row.status).toBe('approved');
    // The run resumed past the approval node and finished on its approve edge.
    const run = rowsOf(await ql.find('sys_automation_run', { where: { id: row.flow_run_id }, context: SYS.context }))[0];
    expect(run?.status, JSON.stringify(run)).toBe('completed');

    const after = rowsOf((await pendingForMe({ bearer: approver })).payload).map((r) => String(r.id));
    expect(after).toEqual([second.requestId]);
  });
});
