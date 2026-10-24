// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #25598 — an SLA escalation with `action: 'reassign'` wrote an `escalateTo`
// that resolves to no one onto the slate. The position expansion of an
// unstaffed (or mistyped) name is empty, the sweep fell back to the literal,
// and the overdue request moved off its real approver onto a slate nobody
// could decide, the state #25485 closed for the reassign door. Now the
// sweep judges the literal by the door's predicate, on a real boot:
//
//   ⭐ an overdue request whose escalation names a position nobody holds keeps
//      its approver, who is told the SLA lapsed, and its `escalate` audit row
//      says the reassign was not applied and why;
//   ⭐ CONTROL: an overdue request whose escalation names a member of the
//      organization (by email) moves to them, and the member then finds it in
//      their "My Pending".
//
// The sweep is run through the service the plugin registers, the call its
// scheduled job makes; the requests are made overdue by moving `created_at`
// back, since the deadline is `created_at + timeoutHours`.

import { describe, it, expect } from 'vitest';
import { bootStack } from '@objectstack/verify';
import { defineStack, defineFlow } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import { ApprovalsServicePlugin } from '@objectstack/plugin-approvals';
import { RecordChangeTriggerPlugin } from '@objectstack/trigger-record-change';
import { MessagingServicePlugin } from '@objectstack/service-messaging';
import { adminRescueSecurity } from './fixtures/admin-rescue-slate-fixture.js';

const SYS = { context: { isSystem: true } } as const;
const SUBMITTER = 'sla-reassign-submitter@example.com';
const APPROVER = 'sla-reassign-approver@example.com';
const MEMBER = 'sla-reassign-member@example.com';
/** A position nothing in this fixture ever staffs. */
const UNSTAFFED = 'sla_reassign_nobody';

function slaObject(name: string) {
  return ObjectSchema.create({
    name,
    label: name,
    pluralLabel: name,
    sharingModel: 'public_read_write',
    fields: { name: Field.text({ label: 'Name', required: true }) },
  });
}

function slaFlow(name: string, objectName: string, escalateTo: string) {
  return defineFlow({
    name,
    label: name,
    description: `Fires on insert of ${objectName}; its approval step reassigns to ${escalateTo} after an hour.`,
    type: 'autolaunched',
    status: 'active',
    nodes: [
      { id: 'start', type: 'start', label: 'On Create', config: { objectName, triggerType: 'record-after-create' } },
      {
        id: 'gate',
        type: 'approval',
        label: 'Gate',
        config: {
          approvers: [{ type: 'user', value: APPROVER }],
          behavior: 'first_response',
          lockRecord: true,
          escalation: { timeoutHours: 1, action: 'reassign', escalateTo, notifySubmitter: false },
        },
      },
      { id: 'approved', type: 'end', label: 'Approved' },
      { id: 'rejected', type: 'end', label: 'Rejected' },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'gate' },
      { id: 'e2', source: 'gate', target: 'approved', label: 'approve' },
      { id: 'e3', source: 'gate', target: 'rejected', label: 'reject' },
    ],
  });
}

// The admin-rescue fixture's security plugin gives a fresh member create +
// read on ITS two objects only, so these objects reuse those names.
const slaStack = defineStack({
  manifest: {
    id: 'com.dogfood.sla-reassign-target',
    namespace: 'admin_rescue',
    version: '0.0.0',
    type: 'app',
    name: 'SLA Reassign Target Fixture',
    description: 'Two approval steps that reassign on timeout: one to a position nobody holds, one to a member.',
  },
  requires: ['automation', 'triggers'],
  objects: [slaObject('admin_rescue_stuck'), slaObject('admin_rescue_staffed')],
  flows: [
    slaFlow('sla_reassign_nobody_flow', 'admin_rescue_stuck', UNSTAFFED),
    slaFlow('sla_reassign_member_flow', 'admin_rescue_staffed', MEMBER),
  ],
});

interface Row {
  id: string;
  object_name?: string;
  pending_approvers?: string[];
}

describe('an SLA reassign to a target that resolves to no one keeps the slate (#25598)', () => {
  it(
    'keeps and notifies the approver when the escalation names an unstaffed position, and still moves a request to a member',
    async () => {
      const stack = await bootStack(slaStack as unknown as Parameters<typeof bootStack>[0], {
        automation: true,
        security: adminRescueSecurity(),
        extraPlugins: [
          new MessagingServicePlugin({ reliableDelivery: false }),
          new RecordChangeTriggerPlugin(),
          new ApprovalsServicePlugin(),
        ],
      });
      try {
        const ql: any = await stack.kernel.getServiceAsync('objectql');
        const approvals: any = await stack.kernel.getServiceAsync('approvals');
        const idOf = async (email: string): Promise<string> => {
          const u = await ql.findOne('sys_user', { where: { email }, context: SYS.context });
          return String(u?.id ?? '');
        };
        // The dev admin first, so the sign-ups below are plain members.
        const adminToken = await stack.signIn();
        const submitterToken = await stack.signUp(SUBMITTER);
        const approverToken = await stack.signUp(APPROVER);
        const memberToken = await stack.signUp(MEMBER);
        const approverId = await idOf(APPROVER);
        const memberId = await idOf(MEMBER);
        expect(approverId).not.toBe('');
        expect(memberId).not.toBe('');

        for (const object of ['admin_rescue_stuck', 'admin_rescue_staffed']) {
          const created = await stack.apiAs(submitterToken, 'POST', `/data/${object}`, { name: `overdue ${object}` });
          expect(created.status, object).toBe(201);
        }
        const pendingRes = await stack.apiAs(adminToken, 'GET', '/approvals/requests?status=pending');
        expect(pendingRes.status).toBe(200);
        const open = ((await pendingRes.json()) as { data: Row[] }).data;
        const stuck = open.find((r) => r.object_name === 'admin_rescue_stuck');
        const staffed = open.find((r) => r.object_name === 'admin_rescue_staffed');
        expect(stuck?.pending_approvers, 'precondition: open on the named approver').toEqual([APPROVER]);
        expect(staffed?.pending_approvers, 'precondition: open on the named approver').toEqual([APPROVER]);

        // Both are two hours old against a one-hour SLA.
        const twoHoursAgo = new Date(Date.now() - 2 * 3600_000).toISOString();
        for (const id of [stuck!.id, staffed!.id]) {
          await ql.update('sys_approval_request', { id, created_at: twoHoursAgo }, SYS);
          const back = await ql.findOne('sys_approval_request', { where: { id }, context: SYS.context });
          expect(String(back?.created_at), 'precondition: the request is overdue').toBe(twoHoursAgo);
        }

        expect(await approvals.runEscalations()).toMatchObject({ escalated: 2 });

        const slateOf = async (id: string): Promise<string> =>
          String((await ql.findOne('sys_approval_request', { where: { id }, context: SYS.context }))?.pending_approvers ?? '');
        const escalateComment = async (id: string): Promise<string> => {
          const rows = await ql.find('sys_approval_action', { where: { request_id: id, action: 'escalate' }, context: SYS.context });
          return String(rows?.[0]?.comment ?? '');
        };
        const topicsAbout = async (id: string): Promise<string[]> =>
          ((await ql.find('sys_notification', { where: { source_id: id }, context: SYS.context })) ?? [])
            .map((n: any) => String(n.topic));
        const inboxOf = async (token: string, userId: string, email: string): Promise<string[]> => {
          const res = await stack.apiAs(
            token, 'GET',
            `/approvals/requests?status=pending&approverId=${encodeURIComponent(userId)},${encodeURIComponent(email)}&limit=50`,
          );
          expect(res.status).toBe(200);
          return ((await res.json()) as { data: Row[] }).data.map((r) => r.id);
        };

        // ⭐ 1 — the unresolvable target moved nothing, and the row says why.
        expect(await slateOf(stuck!.id)).toBe(APPROVER);
        expect(await escalateComment(stuck!.id)).toBe(
          `reassign → ${UNSTAFFED} — not applied: it names no user in this request's organization. `
          + 'The pending approvers were kept and notified.',
        );
        expect(await inboxOf(approverToken, approverId, APPROVER)).toContain(stuck!.id);
        // …the slate heard the SLA lapse, and nothing announced a move.
        expect(await topicsAbout(stuck!.id)).toContain('approval.sla_breached');
        expect(await topicsAbout(stuck!.id)).not.toContain('approval.escalated');

        // ⭐ 2 — CONTROL: a member of the organization takes the slot.
        expect(await slateOf(staffed!.id)).toBe(MEMBER);
        expect(await escalateComment(staffed!.id)).toBe(`reassign → ${MEMBER}`);
        expect(await topicsAbout(staffed!.id)).toContain('approval.escalated');
        expect(await inboxOf(memberToken, memberId, MEMBER)).toEqual([staffed!.id]);
      } finally {
        await stack.stop();
      }
    },
    120_000,
  );
});
