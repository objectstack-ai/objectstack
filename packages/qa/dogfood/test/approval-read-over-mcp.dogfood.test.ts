// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #32442 (ruling A; maintainer ruling 6849636735, 1B + 2B) — an approver's
// agent lists the approval requests waiting on them over MCP, with the
// existing record tools, and then decides one.
//
// Three things make that reachable, each pinned here through the live MCP
// transport:
//
//   - `sys_approval_request` declares `enable.aiReadable: true` (#32865), so
//     the MCP read tools admit it past the `sys_*` refusal; no write tool does;
//   - `member_default` names it read-only (1B), so a signed-in member holds a
//     data-door read on the object with no grant from the app. Which ROWS is
//     still the approvals request read gate (`request-read-gate.ts`): the
//     submitter, a current approver, a past actor;
//   - that gate answers "waiting on me" — `pending_approvers` contains
//     `{current_user_id}`, the console's My Pending filter — with the approvals
//     service's own fold (2B), so a slate that addresses the approver by email
//     is found, not only one holding their user id.
//
// Nothing in this file grants the request object: every member here holds the
// shipped baseline and an app set naming the app's own objects.
//
// Real `SecurityPlugin`, real flows, real approvals plugin, real MCP plugin.
// Two one-step flows: overtime waits on one approver addressed by EMAIL and,
// once approved, stamps the record; expense waits on a TEAM. The overtime
// object carries a capability-gated masked field only the submitter may read.
//
//   ⭐ the approver's "pending for me" query returns exactly their requests —
//      the email-addressed ones, not the team's — with the inbox row's display
//      fields; the team member's returns exactly the team's;
//   ⭐ the same query as the submitter returns nothing;
//   ⭐ a member on no request reads nothing: by query, by id, by aggregate;
//   ⭐ the snapshot field the approver may not read is not served to them,
//      on the request row or in its activity rows;
//   ⭐ the object is listed and described; no write tool opens it, and
//      `sys_approval_action` stays refused;
//   ⭐ the query tool's text names the "pending for me" filter shape;
//   ⭐ end to end: the submitter files over MCP, the approver lists, approves
//      with confirmation, and the record's flow resumes and stamps it.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { bootStack } from '@objectstack/verify';
import { ApprovalsServicePlugin } from '@objectstack/plugin-approvals';
import { RecordChangeTriggerPlugin } from '@objectstack/trigger-record-change';
import { MCPServerPlugin } from '@objectstack/mcp';
import { AuditPlugin } from '@objectstack/plugin-audit';
import { defineStack, defineFlow } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import { PermissionSetSchema, type PermissionSet } from '@objectstack/spec/security';
import { AI_ACTION_CONFIRMATION_MEMBER } from '@objectstack/spec/contracts';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';
import { catalogPermissionSet } from './catalog-permission-set.js';

const OVERTIME = 'aprmcp_overtime';
const EXPENSE = 'aprmcp_expense';
const REQUEST = 'sys_approval_request';
const SYS = { context: { isSystem: true } } as const;
const rowsOf = (r: any): any[] => (Array.isArray(r) ? r : Array.isArray(r?.records) ? r.records : Array.isArray(r?.value) ? r.value : []);

const SUBMITTER = 'aprmcp-submitter@verify.test';
const APPROVER = 'aprmcp-approver@verify.test';
const TEAMMATE = 'aprmcp-teammate@verify.test';
const STRANGER = 'aprmcp-stranger@verify.test';
/** The team the expense flow waits on, inserted with this id before any request opens. */
const TEAM_ID = 'aprmcp_team_reviewers';

/** A capability-gated masked field: the submitter holds the capability, the approver does not. */
const MASKED = 'aprmcp_cost_code';
const CAPABILITY = 'aprmcp_read_cost_code';
const STORED = 'SYNTH7731CODE';

/** The console's My Pending filter, spelled as an MCP `where`. */
const PENDING_FOR_ME = { status: 'pending', pending_approvers: { $contains: '{current_user_id}' } };

const overtime = ObjectSchema.create({
  name: OVERTIME,
  label: 'Overtime Request',
  pluralLabel: 'Overtime Requests',
  sharingModel: 'public_read_write',
  fields: {
    name: Field.text({ label: 'Name', required: true }),
    outcome: Field.text({ label: 'Outcome' }),
    [MASKED]: Field.text({ label: 'Cost Code', maskingRule: { keepHead: 1, keepTail: 1 }, requiredPermissions: [CAPABILITY] }),
  },
});
const expense = ObjectSchema.create({
  name: EXPENSE,
  label: 'Expense Claim',
  pluralLabel: 'Expense Claims',
  fields: { name: Field.text({ label: 'Name', required: true }) },
});

const overtimeFlow = defineFlow({
  name: `${OVERTIME}_flow`,
  label: 'Overtime approval',
  description: 'Fires on insert, waits on the approver by email, and stamps the record once approved.',
  type: 'autolaunched',
  status: 'active',
  runAs: 'system',
  nodes: [
    { id: 'start', type: 'start', label: 'On Create', config: { objectName: OVERTIME, triggerType: 'record-after-create' } },
    {
      id: 'manager',
      type: 'approval',
      label: 'Manager review',
      config: { approvers: [{ type: 'user', value: APPROVER }], behavior: 'first_response', lockRecord: false },
    },
    {
      id: 'stamp',
      type: 'update_record',
      label: 'Stamp the outcome',
      config: {
        objectName: OVERTIME,
        filter: { id: { dialect: 'cel', source: 'record.id' } },
        fields: { outcome: 'approved' },
      },
    },
    { id: 'approved', type: 'end', label: 'Approved' },
    { id: 'rejected', type: 'end', label: 'Rejected' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'manager' },
    { id: 'e2', source: 'manager', target: 'stamp', label: 'approve' },
    { id: 'e3', source: 'stamp', target: 'approved' },
    { id: 'e4', source: 'manager', target: 'rejected', label: 'reject' },
  ],
});

const expenseFlow = defineFlow({
  name: `${EXPENSE}_flow`,
  label: 'Expense approval',
  description: 'Fires on insert and waits on a team.',
  type: 'autolaunched',
  status: 'active',
  nodes: [
    { id: 'start', type: 'start', label: 'On Create', config: { objectName: EXPENSE, triggerType: 'record-after-create' } },
    {
      id: 'manager',
      type: 'approval',
      label: 'Team review',
      config: { approvers: [{ type: 'team', value: TEAM_ID }], behavior: 'first_response', lockRecord: false },
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
    description: 'Two one-step approval flows, listed and decided over MCP.',
  },
  requires: ['automation', 'triggers'],
  objects: [overtime, expense],
  flows: [overtimeFlow, expenseFlow],
});

/** The app's own objects only: nothing here names `sys_approval_request`. */
const appObjects = {
  [OVERTIME]: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: false },
  [EXPENSE]: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: false },
};
const baselineSet: PermissionSet = PermissionSetSchema.parse({
  name: 'aprmcp_baseline',
  label: 'Approval Read Over MCP Baseline — the app objects',
  objects: appObjects,
});
const submitterSet: PermissionSet = PermissionSetSchema.parse({
  name: 'aprmcp_submitter',
  label: 'Approval Read Over MCP Submitter — the app objects and the cost-code capability',
  objects: appObjects,
  systemPermissions: [CAPABILITY],
});

type Caller = { bearer: string };

describe('an approver\'s agent lists the approvals waiting on them over MCP (#32442, read half)', () => {
  let stack: VerifyStack;
  let ql: any;
  let submitter: string;
  let approver: string;
  let teammate: string;
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
  const pendingIds = async (as: Caller) => {
    const answer = await pendingForMe(as);
    expect(answer.isError, answer.text).toBe(false);
    return rowsOf(answer.payload).map((r) => String(r.id)).sort();
  };

  const requestRow = async (requestId: string) =>
    rowsOf(await ql.find(REQUEST, { where: { id: requestId }, context: SYS.context }))[0];

  /** The submitter files one record over MCP; its flow opens the pending step. */
  const fileOverMcp = async (object: string, data: Record<string, unknown>): Promise<{ recordId: string; requestId: string }> => {
    const created = await tool({ bearer: submitter }, 'create_record', { objectName: object, data });
    expect(created.isError, created.text).toBe(false);
    const recordId = String(created.payload?.id ?? created.payload?.record?.id ?? '');
    expect(recordId).not.toBe('');
    const [opened] = rowsOf(await ql.find(REQUEST, { where: { object_name: object, record_id: recordId }, context: SYS.context }));
    expect(opened, 'the flow opened the approval step').toBeTruthy();
    expect(opened.status).toBe('pending');
    return { recordId, requestId: String(opened.id) };
  };

  let first: { recordId: string; requestId: string };
  let second: { recordId: string; requestId: string };
  let teamOne: { recordId: string; requestId: string };

  beforeAll(async () => {
    stack = await bootStack(stackConfig as unknown as Parameters<typeof bootStack>[0], {
      automation: true,
      security: new SecurityPlugin({
        defaultPermissionSets: [...securityDefaultPermissionSets, baselineSet, submitterSet],
        fallbackPermissionSet: baselineSet.name,
      }),
      extraPlugins: [new RecordChangeTriggerPlugin(), new ApprovalsServicePlugin(), new MCPServerPlugin(), new AuditPlugin()],
    });
    ql = await stack.kernel.getServiceAsync('objectql');
    await stack.signIn();
    submitter = await stack.signUp(SUBMITTER);
    approver = await stack.signUp(APPROVER);
    teammate = await stack.signUp(TEAMMATE);
    stranger = await stack.signUp(STRANGER);
    const assignments: Array<[string, PermissionSet]> = [
      [SUBMITTER, submitterSet], [APPROVER, baselineSet], [TEAMMATE, baselineSet], [STRANGER, baselineSet],
    ];
    for (const [email, set] of assignments) {
      expect(await catalogPermissionSet(ql, set.name), `${set.name} is served by the catalog`).toBeTruthy();
      await ql.insert('sys_user_permission_set', { user_id: await idOf(email), permission_set: set.name }, SYS);
    }
    submitterId = await idOf(SUBMITTER);

    // The expense flow's team, in the members' organization, with one member.
    const membership = await ql.findOne('sys_member', { where: { user_id: submitterId }, context: SYS.context });
    const orgId = String(membership?.organization_id ?? '');
    expect(orgId).not.toBe('');
    await ql.insert('sys_team', { id: TEAM_ID, name: 'Expense reviewers', organization_id: orgId }, SYS);
    await ql.insert('sys_team_member', { team_id: TEAM_ID, user_id: await idOf(TEAMMATE) }, SYS);

    first = await fileOverMcp(OVERTIME, { name: 'saturday shift', [MASKED]: STORED });
    second = await fileOverMcp(OVERTIME, { name: 'sunday shift' });
    teamOne = await fileOverMcp(EXPENSE, { name: 'taxi' });
  }, 300_000);

  afterAll(async () => {
    await stack?.stop?.();
  });

  it('⭐ the approver\'s "pending for me" query returns exactly the requests waiting on them, with the inbox row\'s display fields', async () => {
    // The overtime slate holds the approver's EMAIL: the literal column is not their id.
    expect((await requestRow(first.requestId)).pending_approvers).toBe(APPROVER);
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
      expect(row.object_name).toBe(OVERTIME);
      expect([first.recordId, second.recordId]).toContain(String(row.record_id));
    }
  });

  it('⭐ a team member\'s "pending for me" returns exactly the team\'s request', async () => {
    expect(await pendingIds({ bearer: teammate })).toEqual([teamOne.requestId]);
  });

  it('⭐ the same query as the submitter returns nothing, though the submitter reads their own requests', async () => {
    expect(await pendingIds({ bearer: submitter })).toEqual([]);
    // The participant read is wider: the submitter's untargeted read serves
    // the requests they filed. "Pending for me" is the filter, not the gate.
    const all = await tool({ bearer: submitter }, 'query_records', { objectName: REQUEST });
    expect(all.isError, all.text).toBe(false);
    expect(rowsOf(all.payload).map((r) => String(r.id)).sort())
      .toEqual([first.requestId, second.requestId, teamOne.requestId].sort());
  });

  it('⭐ a member on no request reads nothing: by query, by id, by aggregate', async () => {
    const listed = await tool({ bearer: stranger }, 'query_records', { objectName: REQUEST });
    expect(listed.isError, listed.text).toBe(false);
    expect(rowsOf(listed.payload)).toEqual([]);
    expect(await pendingIds({ bearer: stranger })).toEqual([]);
    const byId = await tool({ bearer: stranger }, 'get_record', { objectName: REQUEST, recordId: first.requestId });
    expect(byId.isError, byId.text).toBe(true);
    expect(byId.text).not.toContain(first.recordId);
    const counted = await tool({ bearer: stranger }, 'aggregate_records', {
      objectName: REQUEST,
      aggregations: [{ function: 'count', alias: 'n' }],
    });
    expect(counted.isError, counted.text).toBe(false);
    expect(JSON.stringify(counted.payload)).toContain('"n":0');
  });

  it('⭐ the snapshot field the approver may not read is not served to them; the submitter, who may, is served it', async () => {
    const forApprover = rowsOf((await pendingForMe({ bearer: approver })).payload).find((r) => String(r.id) === first.requestId);
    expect(forApprover?.payload_json, 'the approver is served the snapshot').toBeTruthy();
    expect(String(forApprover.payload_json)).not.toContain(MASKED);
    expect(String(forApprover.payload_json)).not.toContain(STORED);
    // Control: the stored snapshot carries it, and the submitter is served it.
    expect(String((await requestRow(first.requestId)).payload_json)).toContain(STORED);
    const own = await tool({ bearer: submitter }, 'get_record', { objectName: REQUEST, recordId: first.requestId });
    expect(own.isError, own.text).toBe(false);
    expect(own.text).toContain(STORED);
  });

  it('⭐ the request\'s activity rows serve the approver no value they may not read', async () => {
    // Control: the value is at rest.
    const stored = rowsOf(await ql.find('sys_activity', {
      where: { object_name: REQUEST, record_id: first.requestId }, context: SYS.context,
    }));
    expect(stored.length, 'the request\'s insert left an activity row').toBeGreaterThan(0);
    expect(JSON.stringify(stored)).toContain(STORED);
    // The approver reads those rows on the data door (their participant read
    // of the parent admits them).
    const res = await stack.api('/data/sys_activity', { headers: { Authorization: `Bearer ${approver}` } });
    const text = await res.text();
    expect(res.status, text).toBe(200);
    expect(text, 'the approver reads the request\'s activity').toContain(first.requestId);
    expect(text).not.toContain(STORED);
  });

  it('⭐ the object is listed and described for the approver; no write tool opens it, and sys_approval_action stays refused', async () => {
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

  it('⭐ end to end: the approver lists what waits on them, approves one with confirmation, and the flow resumes', async () => {
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

    expect((await requestRow(first.requestId)).status).toBe('approved');
    // The run resumed past the approval node down its approve edge, whose
    // next node stamps the record.
    const record = rowsOf(await ql.find(OVERTIME, { where: { id: first.recordId }, context: SYS.context }))[0];
    expect(record?.outcome, JSON.stringify(record)).toBe('approved');

    expect(await pendingIds({ bearer: approver })).toEqual([second.requestId]);
  });
});
