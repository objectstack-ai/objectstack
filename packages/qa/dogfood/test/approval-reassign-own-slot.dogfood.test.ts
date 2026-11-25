// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// An approver reassigns only their own slot. A reassign that neither the
// system nor the administrator override admits moves the caller's own slot
// and no other, through the door the console calls
// (`POST /approvals/requests/:id/reassign`), on a real boot:
//
//   ⭐ a slot holder naming another approver's slot as `from` is refused
//      `403 FORBIDDEN`, and nothing moved: the slate is unchanged and no
//      `reassign` action was recorded;
//   ⭐ CONTROL: the same holder naming their own slot moves it;
//   ⭐ the administrator override still moves another approver's slot.
//
// The system caller has no HTTP door; its leg is pinned beside the service
// (`plugin-approvals` `approval-service.test.ts`, same rule).

import { describe, it, expect } from 'vitest';
import { bootStack } from '@objectstack/verify';
import { ApprovalsServicePlugin } from '@objectstack/plugin-approvals';
import { RecordChangeTriggerPlugin } from '@objectstack/trigger-record-change';
import { MessagingServicePlugin } from '@objectstack/service-messaging';
import {
  reassignOwnSlotStack,
  reassignOwnSlotSecurity,
  FIRST_APPROVER_EMAIL,
  SECOND_APPROVER_EMAIL,
} from './fixtures/reassign-own-slot-fixture.js';

const SYS = { context: { isSystem: true } } as const;
const SUBMITTER = 'reassign-own-slot-submitter@example.com';
const MEMBER = 'reassign-own-slot-member@example.com';
const OTHER_MEMBER = 'reassign-own-slot-other@example.com';

interface Row {
  id: string;
  object_name?: string;
  pending_approvers?: string[];
}

describe('an approver reassigns only their own slot', () => {
  it(
    'refuses another approver\'s slot, moves the caller\'s own, and leaves the override unchanged',
    async () => {
      const stack = await bootStack(reassignOwnSlotStack as unknown as Parameters<typeof bootStack>[0], {
        automation: true,
        security: reassignOwnSlotSecurity(),
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
        const firstToken = await stack.signUp(FIRST_APPROVER_EMAIL);
        await stack.signUp(SECOND_APPROVER_EMAIL);
        await stack.signUp(MEMBER);
        await stack.signUp(OTHER_MEMBER);
        const memberId = await idOf(MEMBER);
        const otherMemberId = await idOf(OTHER_MEMBER);
        expect(memberId).not.toBe('');
        expect(otherMemberId).not.toBe('');

        const created = await stack.apiAs(submitterToken, 'POST', '/data/reassign_own_slot', { name: 'two approvers' });
        expect(created.status).toBe(201);
        const pendingRes = await stack.apiAs(adminToken, 'GET', '/approvals/requests?status=pending');
        expect(pendingRes.status).toBe(200);
        const open = ((await pendingRes.json()) as { data: Row[] }).data
          .find((r) => r.object_name === 'reassign_own_slot');
        expect(open?.pending_approvers, 'precondition: the request is open on both named approvers')
          .toEqual([FIRST_APPROVER_EMAIL, SECOND_APPROVER_EMAIL]);
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

        // ⭐ 1 — another approver's slot is refused, and nothing moved.
        const refused = await reassign(firstToken, { from: SECOND_APPROVER_EMAIL, to: memberId });
        expect(refused.status).toBe(403);
        expect(((await refused.json()) as { code?: string }).code).toBe('FORBIDDEN');
        expect(await slate()).toBe(`${FIRST_APPROVER_EMAIL},${SECOND_APPROVER_EMAIL}`);
        expect(await moves()).toEqual([]);

        // ⭐ 2 — CONTROL: the same holder's own slot moves.
        const own = await reassign(firstToken, { from: FIRST_APPROVER_EMAIL, to: memberId });
        expect(own.status).toBe(200);
        expect(((await own.json()) as { request?: Row }).request?.pending_approvers)
          .toEqual([memberId, SECOND_APPROVER_EMAIL]);
        expect(await moves()).toHaveLength(1);

        // ⭐ 3 — the administrator override still moves another approver's slot.
        const override = await reassign(adminToken, { from: SECOND_APPROVER_EMAIL, to: otherMemberId });
        expect(override.status).toBe(200);
        expect(((await override.json()) as { request?: Row }).request?.pending_approvers)
          .toEqual([memberId, otherMemberId]);
        expect(await moves()).toHaveLength(2);
      } finally {
        await stack.stop();
      }
    },
    120_000,
  );
});
