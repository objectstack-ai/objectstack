// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A pending approver decides from the request page: the approval actions
 * through `POST /api/v1/actions/sys_approval_request/:action`, on a booted
 * stack — the real dispatcher, the real approvals service and its real
 * decision routes, the real in-process forward. No fetch is doubled.
 *
 * The request page's decision actions are same-origin `type: 'api'` actions
 * (`approval_approve` → `POST /api/v1/approvals/requests/{id}/approve`). The
 * action door loads the subject row in the CALLER's data scope first, and a
 * member has no data-door read on `sys_approval_request` by design: the
 * decision routes authorize a pending approver themselves (ADR-0066 D4). The
 * door used to answer that denied load with its own `404 RECORD_NOT_FOUND`
 * ahead of the forward, so no non-admin decision from the page ever reached
 * the routes that would have admitted it. A denied load now forwards an api
 * action whose request needs nothing from the row, and the door answers what
 * the target answers.
 *
 * What is pinned, each against what only the real stack produces:
 *  - the control: the approver cannot read the request row through the data
 *    door, so every answer below is the forward's, not a widened grant's;
 *  - the approver's Approve through the action door answers 200, and the
 *    request MOVES: one of two approvals recorded, the approver off
 *    `pending_approvers`, an `approve` row in the request's actions;
 *  - a member who is NOT on the slate meets the approvals door's own refusal
 *    (the same status and code the decision route answers them directly),
 *    never a 200, never the row;
 *  - the decision route's refusal sentence is relayed, not replaced by
 *    "its target answered HTTP N".
 *
 * ⚠️ This suite resolves `@objectstack/runtime` and
 * `@objectstack/plugin-approvals` through their BUILT `dist/`. Rebuild
 * runtime before trusting a run of this file — and especially an ablated one.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { defineStack, defineFlow } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import { ApprovalsServicePlugin } from '@objectstack/plugin-approvals';
import { RecordChangeTriggerPlugin } from '@objectstack/trigger-record-change';

import { bootStack, type VerifyStack } from './harness.js';
import { warmUpBoot } from './boot-warm-up.testkit.js';

// Booting the full in-process stack runs well past vitest's 5s default.
const BOOT_TIMEOUT = 120_000;

// The boot's first load, paid during collection rather than in the
// `beforeAll` below (see `boot-warm-up.testkit.ts`): the same options and the
// same `requires` as this file's own boot.
await warmUpBoot({ automation: true }, { requires: ['automation', 'triggers'] });

const OBJECT = 'afd_invoice';
const SYS = { isSystem: true } as const;

/** The step's slate, both by email: `unanimous`, so one approval is 1 of 2. */
const FIRST = 'afd-first@verify.test';
const SECOND = 'afd-second@verify.test';
/** On no slate. */
const STRANGER = 'afd-stranger@verify.test';

const Invoice = ObjectSchema.create({
  name: OBJECT,
  label: 'Invoice',
  pluralLabel: 'Invoices',
  sharingModel: 'private',
  fields: { name: Field.text({ label: 'Name', required: true }) },
});

const flow = defineFlow({
  name: `${OBJECT}_signoff`,
  label: 'Invoice Dual Sign-off',
  description: 'Fires on insert and waits on both approvers, unanimously.',
  type: 'autolaunched',
  status: 'active',
  nodes: [
    { id: 'start', type: 'start', label: 'On Create', config: { objectName: OBJECT, triggerType: 'record-after-create' } },
    {
      id: 'signoff',
      type: 'approval',
      label: 'Sign-off',
      config: {
        approvers: [{ type: 'user', value: FIRST }, { type: 'user', value: SECOND }],
        behavior: 'unanimous',
        lockRecord: false,
      },
    },
    { id: 'approved', type: 'end', label: 'Approved' },
    { id: 'rejected', type: 'end', label: 'Rejected' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'signoff' },
    { id: 'e2', source: 'signoff', target: 'approved', label: 'approve' },
    { id: 'e3', source: 'signoff', target: 'rejected', label: 'reject' },
  ],
});

const fixtureStack = defineStack({
  manifest: {
    id: 'com.objectstack.verify.action-door-api-forward-denied-subject',
    namespace: 'afd',
    version: '0.0.0',
    type: 'app',
    name: 'Action Door Api Forward Denied Subject Fixture',
    description: 'One private object and a two-approver unanimous sign-off flow on it.',
  },
  // ADR-0097: the `record-after-create` start node needs the trigger capability.
  requires: ['automation', 'triggers'],
  objects: [Invoice],
  flows: [flow],
});

type Answer = { status: number; text: string; json: any };

let stack: VerifyStack;
let admin: string;
let first: string;
let firstId: string;
let stranger: string;
let ql: any;

const call = async (token: string, method: string, path: string, body?: unknown): Promise<Answer> => {
  const res = await stack.apiAs(token, method, path, body);
  const text = await res.text();
  let json: any;
  try { json = JSON.parse(text); } catch { json = undefined; }
  return { status: res.status, text, json };
};

/** Open one request: the admin creates an invoice, the flow opens the step. */
const openRequest = async (name: string): Promise<string> => {
  const created = await call(admin, 'POST', `/data/${OBJECT}`, { name });
  expect(created.status, created.text).toBe(201);
  const recordId = String(created.json?.id ?? created.json?.record?.id ?? '');
  const rows = await ql.find('sys_approval_request', {
    where: { object_name: OBJECT, record_id: recordId, status: 'pending' }, context: SYS,
  });
  expect(rows, `the flow opened a request for ${name}`).toHaveLength(1);
  return String(rows[0].id);
};

const requestRow = async (id: string): Promise<any> =>
  ql.findOne('sys_approval_request', { where: { id }, context: SYS });
const approveRows = async (id: string): Promise<any[]> =>
  ql.find('sys_approval_action', { where: { request_id: id, action: 'approve' }, context: SYS });
const pendingOf = (row: any): string[] => String(row?.pending_approvers ?? '').split(',').map((s) => s.trim()).filter(Boolean);

beforeAll(async () => {
  stack = await bootStack(fixtureStack as never, {
    automation: true,
    extraPlugins: [new RecordChangeTriggerPlugin(), new ApprovalsServicePlugin()],
  });
  ql = await stack.kernel.getServiceAsync('objectql');
  admin = await stack.signIn();
  // The first user is the seeded dev admin, so these sign-ups are plain members.
  first = await stack.signUp(FIRST);
  await stack.signUp(SECOND);
  stranger = await stack.signUp(STRANGER);
  firstId = String((await ql.findOne('sys_user', { where: { email: FIRST }, context: SYS }))?.id ?? '');
  expect(firstId).not.toBe('');
}, BOOT_TIMEOUT);

afterAll(async () => {
  await stack?.stop().catch(() => undefined);
});

describe('a pending approver decides through the action door — the forward authorizes, not the data door', () => {
  it('the control: the approver cannot read the request row through the data door', async () => {
    const requestId = await openRequest('INV-control');
    // The slate holds the addresses the flow named.
    expect(pendingOf(await requestRow(requestId))).toEqual([FIRST, SECOND]);
    // A member holds no object grant on the request table, so the data door
    // refuses the read outright.
    const read = await call(first, 'GET', `/data/sys_approval_request/${requestId}`);
    expect(read.status, read.text).toBe(403);
    expect(read.json?.code).toBe('PERMISSION_DENIED');
  });

  it('Approve answers 200 and the request moves: 1 of 2, the approver off the slate, an approve row', async () => {
    const requestId = await openRequest('INV-1');
    expect(await approveRows(requestId)).toEqual([]);
    expect(pendingOf(await requestRow(requestId))).toEqual([FIRST, SECOND]);

    const answer = await call(first, 'POST', '/actions/sys_approval_request/approval_approve', {
      recordId: requestId, params: { comment: 'Looks right.' },
    });

    expect(answer.status, answer.text).toBe(200);
    const row = await requestRow(requestId);
    expect(row.status).toBe('pending');
    expect(pendingOf(row)).toEqual([SECOND]);
    const approvals = await approveRows(requestId);
    expect(approvals).toHaveLength(1);
    expect(approvals[0].actor_id).toBe(firstId);
    expect(approvals[0].comment).toBe('Looks right.');
    // The decision route's own read-back, as the approver reads it.
    const served = await call(first, 'GET', `/approvals/requests/${requestId}`);
    expect(served.status, served.text).toBe(200);
    const progress = (served.json?.data ?? served.json)?.decision_progress;
    expect(progress).toMatchObject({ behavior: 'unanimous', got: 1, need: 2 });
  });

  it('a member on no slate gets the decision route\'s own refusal through the door — never a 200, never the row', async () => {
    const requestId = await openRequest('INV-2');

    const direct = await call(stranger, 'POST', `/approvals/requests/${requestId}/approve`, {});
    const viaDoor = await call(stranger, 'POST', '/actions/sys_approval_request/approval_approve', {
      recordId: requestId, params: {},
    });

    expect(direct.status, direct.text).toBeGreaterThanOrEqual(400);
    expect(viaDoor.status, viaDoor.text).toBe(direct.status);
    expect(viaDoor.json?.success).toBe(false);
    expect(viaDoor.json?.error?.code).toBe(direct.json?.code);
    // The route's own sentence, relayed — not "its target answered HTTP N".
    expect(viaDoor.json?.error?.message).toBe(direct.json?.error);
    expect(viaDoor.text).not.toContain('its target answered HTTP');
    expect(viaDoor.text).not.toContain('INV-2');
    // Nothing moved.
    expect(await approveRows(requestId)).toEqual([]);
    expect(pendingOf(await requestRow(requestId))).toEqual([FIRST, SECOND]);
  });
});
