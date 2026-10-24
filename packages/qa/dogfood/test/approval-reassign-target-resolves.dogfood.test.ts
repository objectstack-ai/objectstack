// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #25485 — the reassign door accepted a `to` that resolves to no one.
//
// `POST /approvals/requests/:id/reassign {"to":"usr_does_not_exist"}` answered
// 200 and wrote the address onto the slate, so the request waited on nobody
// until an override actor moved it again — as the slot holder and as an admin
// (measured on stock showcase). Now `to` must resolve in the request's
// organization, on a real boot, through the door the console calls:
//
//   ⭐ the slot holder's reassign to a user id no account carries, and to a
//      bare word, are refused `400 VALIDATION_FAILED` naming the address;
//   ⭐ so is the platform admin's (the override does not exempt the new slot),
//      and a `type:value` literal no approver acts under;
//   ⭐ none of them moved anything: the slate is unchanged and no `reassign`
//      action was recorded;
//   ⭐ CONTROL: a reassign to a member of the organization moves the slot, and
//      the member then finds the request in their "My Pending".
//
// The fixture is #22824's: its staffed object routes one request to a named
// user by email, which is the slot the holder hands over here.

import { describe, it, expect } from 'vitest';
import { bootStack } from '@objectstack/verify';
import { ApprovalsServicePlugin } from '@objectstack/plugin-approvals';
import { RecordChangeTriggerPlugin } from '@objectstack/trigger-record-change';
import { MessagingServicePlugin } from '@objectstack/service-messaging';
import {
  adminRescueStack,
  adminRescueSecurity,
  STAFFED_APPROVER_EMAIL,
} from './fixtures/admin-rescue-slate-fixture.js';

const SYS = { context: { isSystem: true } } as const;
const SUBMITTER = 'reassign-target-submitter@example.com';
const MEMBER = 'reassign-target-member@example.com';

interface Row {
  id: string;
  object_name?: string;
  pending_approvers?: string[];
}

describe('the reassign door refuses a target that resolves to no one (#25485)', () => {
  it(
    'refuses an unknown user id, a bare word and a slot literal, as holder and as admin, moves nothing, and still moves a slot to a member',
    async () => {
      const stack = await bootStack(adminRescueStack as unknown as Parameters<typeof bootStack>[0], {
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
        const idOf = async (email: string): Promise<string> => {
          const u = await ql.findOne('sys_user', { where: { email }, context: SYS.context });
          return String(u?.id ?? '');
        };
        // The dev admin first, so the sign-ups below are plain members.
        const adminToken = await stack.signIn();
        const submitterToken = await stack.signUp(SUBMITTER);
        const approverToken = await stack.signUp(STAFFED_APPROVER_EMAIL);
        const memberToken = await stack.signUp(MEMBER);
        const memberId = await idOf(MEMBER);
        expect(memberId).not.toBe('');

        const created = await stack.apiAs(submitterToken, 'POST', '/data/admin_rescue_staffed', { name: 'reassign me' });
        expect(created.status).toBe(201);
        const pendingRes = await stack.apiAs(adminToken, 'GET', '/approvals/requests?status=pending');
        expect(pendingRes.status).toBe(200);
        const open = ((await pendingRes.json()) as { data: Row[] }).data
          .find((r) => r.object_name === 'admin_rescue_staffed');
        expect(open?.pending_approvers, 'precondition: the request is open on the named approver').toEqual([STAFFED_APPROVER_EMAIL]);
        const requestId = open!.id;

        const reassign = (token: string, body: Record<string, unknown>) =>
          stack.apiAs(token, 'POST', `/approvals/requests/${requestId}/reassign`, body);
        const slate = async (): Promise<string> => {
          const row = await ql.findOne('sys_approval_request', { where: { id: requestId }, context: SYS.context });
          return String(row?.pending_approvers ?? '');
        };
        const moves = async (): Promise<unknown[]> =>
          (await ql.find('sys_approval_action', { where: { request_id: requestId }, context: SYS.context }))
            .filter((a: any) => a.action === 'reassign');

        // ⭐ 1–2 — every unresolvable target is refused, naming the address.
        const refusals: Array<[string, string, Record<string, unknown>]> = [
          ['the slot holder, an unknown user id', approverToken, { to: 'usr_does_not_exist' }],
          ['the slot holder, a bare word', approverToken, { to: 'nobody-at-all' }],
          ['the slot holder, a team literal', approverToken, { to: 'team:nobody' }],
          ['the platform admin, an unknown user id', adminToken, { to: 'usr_does_not_exist', from: STAFFED_APPROVER_EMAIL }],
        ];
        for (const [who, token, body] of refusals) {
          const res = await reassign(token, body);
          expect(res.status, who).toBe(400);
          const answer = (await res.json()) as { code?: string; error?: string };
          expect(answer.code, who).toBe('VALIDATION_FAILED');
          expect(answer.error, who).toContain(`cannot reassign to '${String(body.to)}'`);
        }

        // ⭐ 3 — none of them moved anything.
        expect(await slate()).toBe(STAFFED_APPROVER_EMAIL);
        expect(await moves()).toEqual([]);

        // ⭐ 4 — CONTROL: a member of the organization takes the slot.
        const moved = await reassign(approverToken, { to: memberId });
        expect(moved.status).toBe(200);
        expect(((await moved.json()) as { request?: Row }).request?.pending_approvers).toEqual([memberId]);
        expect(await moves()).toHaveLength(1);
        const mine = await stack.apiAs(
          memberToken, 'GET',
          `/approvals/requests?status=pending&approverId=${encodeURIComponent(memberId)},${encodeURIComponent(MEMBER)}&limit=50`,
        );
        expect(mine.status).toBe(200);
        expect(((await mine.json()) as { data: Row[] }).data.map((r) => r.id)).toEqual([requestId]);
      } finally {
        await stack.stop();
      }
    },
    120_000,
  );
});
