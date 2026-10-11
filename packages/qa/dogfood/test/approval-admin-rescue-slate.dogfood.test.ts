// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #22824 — an `admin_rescue` request was in no one's queue.
//
// A node whose approvers resolve to no holder used to open, under the default
// `onEmptyApprovers: 'admin_rescue'`, on a slate that named no person (the
// literal `position:<p>`). No "My Pending" listed it, the bell counted 0, no
// one was told, and a `lockRecord: true` record stayed locked until an admin
// found it under All and decided it through the privileged override
// (measured on HotCRM's fresh installs).
//
// It now opens on the organization's administrators, as ordinary approvers.
// This pins that on a real boot, through the doors the console calls, with the
// real grant provisioning: the seeded admin owns the default organization, and
// a second member is promoted to `admin` by a `sys_member` write, which is
// what provisions their organization-admin capability.
//
//   ⭐ the request opens on both administrators, and each one's "My Pending"
//      lists it, its `total` (the bell's number) counts it, and their inbox
//      holds one `approval.requested` notification;
//   ⭐ a member sees nothing and is told nothing;
//   ⭐ an administrator's decision through the door is an ordinary approval,
//      recorded with `via_override: false`, and the timeline says why the
//      request was with the administrators;
//   ⭐ CONTROL: a staffed request's slate is unchanged;
//   ⭐ the retired `?unstaffed=` arm is refused, never read as an answer.

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
/** `bootStack`'s seeded dev admin: the default organization's owner. */
const ADMIN_EMAIL = 'admin@objectos.ai';
const CO_ADMIN = 'admin-rescue-co-admin@example.com';
const SUBMITTER = 'admin-rescue-submitter@example.com';
const MEMBER = 'admin-rescue-member@example.com';

interface Row {
  id: string;
  object_name?: string;
  pending_approvers?: string[];
  viewer?: { can_act: boolean; is_submitter: boolean; can_override: boolean };
}
interface ListBody {
  data: Row[];
  total?: number;
}

describe('an empty admin_rescue slate opens on the organization\'s administrators, through the REST door (#22824)', () => {
  it(
    'lists, counts and notifies each administrator, not a member, records an ordinary approval, and leaves a staffed slate unchanged',
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
        // Seed the dev admin FIRST, so the sign-ups below are plain members.
        const adminToken = await stack.signIn();
        const coAdminToken = await stack.signUp(CO_ADMIN);
        const submitterToken = await stack.signUp(SUBMITTER);
        const memberToken = await stack.signUp(MEMBER);
        const approverToken = await stack.signUp(STAFFED_APPROVER_EMAIL);
        const adminId = await idOf(ADMIN_EMAIL);
        const coAdminId = await idOf(CO_ADMIN);
        const memberId = await idOf(MEMBER);
        const approverId = await idOf(STAFFED_APPROVER_EMAIL);
        for (const id of [adminId, coAdminId, memberId, approverId]) expect(id).not.toBe('');

        // Promote the co-admin the way an organization does: its membership
        // role. The organization-admin capability is provisioned from it, and
        // that capability — not the role — is what puts them on the slate.
        const [membership] = await ql.find('sys_member', { where: { user_id: coAdminId }, context: SYS.context });
        expect(membership?.organization_id, 'precondition: the co-admin is a member of an organization').toBeTruthy();
        await ql.update('sys_member', { id: membership.id, role: 'admin' }, SYS);
        const coAdminGrants = await ql.find('sys_user_permission_set', { where: { user_id: coAdminId }, context: SYS.context });
        expect(
          coAdminGrants.map((g: any) => g.permission_set),
          'precondition: the admin role provisioned the organization-admin capability',
        ).toEqual(expect.arrayContaining([expect.stringMatching(/^organization_admin/)]));

        const stuckRes = await stack.apiAs(submitterToken, 'POST', '/data/admin_rescue_stuck', { name: 'stuck' });
        expect(stuckRes.status).toBe(201);
        const staffedRes = await stack.apiAs(submitterToken, 'POST', '/data/admin_rescue_staffed', { name: 'staffed' });
        expect(staffedRes.status).toBe(201);

        const list = async (token: string, query: string): Promise<ListBody> => {
          const res = await stack.apiAs(token, 'GET', `/approvals/requests?${query}`);
          expect(res.status, `GET /approvals/requests?${query}`).toBe(200);
          return (await res.json()) as ListBody;
        };
        const myPending = (token: string, id: string, email: string) =>
          list(token, `status=pending&approverId=${encodeURIComponent(id)},${encodeURIComponent(email)}&limit=50`);
        const requested = async (token: string): Promise<unknown[]> => {
          const res = await stack.apiAs(token, 'GET', '/notifications?type=approval.requested');
          expect(res.status).toBe(200);
          return ((await res.json()) as { data: { notifications: unknown[] } }).data.notifications;
        };

        // The scene, before anything is read off it: both requests are open.
        const all = await list(adminToken, 'status=pending');
        expect(all.data).toHaveLength(2);
        const stuck = all.data.find((r) => r.object_name === 'admin_rescue_stuck');
        const staffed = all.data.find((r) => r.object_name === 'admin_rescue_staffed');

        // ⭐ 1 — opened on both administrators: listed, counted, told.
        expect([...(stuck?.pending_approvers ?? [])].sort()).toEqual([adminId, coAdminId].sort());
        for (const [token, id, email] of [[adminToken, adminId, ADMIN_EMAIL], [coAdminToken, coAdminId, CO_ADMIN]]) {
          const mine = await myPending(token, id, email);
          expect(mine.data.map((r) => r.id), email).toEqual([stuck!.id]);
          expect(mine.total, email).toBe(1);
          expect(mine.data[0].viewer?.can_act, email).toBe(true);
          expect(await requested(token), email).toHaveLength(1);
        }

        // ⭐ 2 — a member sees nothing and is told nothing.
        const asMember = await myPending(memberToken, memberId, MEMBER);
        expect([asMember.data, asMember.total]).toEqual([[], 0]);
        expect(await requested(memberToken)).toEqual([]);

        // ⭐ 3 — CONTROL: the staffed slate is unchanged, and its approver
        // finds it exactly as before.
        expect(staffed?.pending_approvers).toEqual([STAFFED_APPROVER_EMAIL]);
        const asApprover = await myPending(approverToken, approverId, STAFFED_APPROVER_EMAIL);
        expect(asApprover.data.map((r) => r.id)).toEqual([staffed!.id]);

        // ⭐ 4 — an administrator decides it as an ordinary approver.
        const decided = await stack.apiAs(coAdminToken, 'POST', `/approvals/requests/${stuck!.id}/approve`, {});
        expect(decided.status).toBe(200);
        expect(((await decided.json()) as { request?: { status?: string } }).request?.status).toBe('approved');
        const actions = await ql.find('sys_approval_action', { where: { request_id: stuck!.id }, context: SYS.context });
        const approval = actions.find((a: any) => a.action === 'approve');
        expect(approval).toMatchObject({ actor_id: coAdminId, acted_as: coAdminId });
        expect(Boolean(approval?.via_override)).toBe(false);
        const note = actions.find((a: any) => a.action === 'comment');
        expect(String(note?.comment)).toContain('has no holder');

        // ⭐ 5 — the retired rescue arm is refused at the door, never read.
        const retired = await stack.apiAs(adminToken, 'GET', '/approvals/requests?status=pending&unstaffed=true');
        expect(retired.status).toBe(400);
        expect(((await retired.json()) as { error?: { code?: string } }).error?.code).toBe('VALIDATION_ERROR');
      } finally {
        await stack.stop();
      }
    },
    120_000,
  );
});
