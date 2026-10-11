// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #22725 — an `admin_rescue` request was in no one's pending queue.
//
// A node whose approvers resolve to no holder opens, under the default
// `onEmptyApprovers: 'admin_rescue'`, on a slate that names no person (here
// the literal `position:<p>`). A privileged admin may decide it, but the
// inbox's "My Pending" door asked by the caller's own approver identities, and
// an admin's identities never equal an unstaffed `position:<p>`. So no My
// Pending listed it, the bell counted 0, and the `lockRecord: true` record
// stayed locked until someone browsed the unfiltered list (measured on HotCRM).
//
// The fix is the `unstaffed` arm on `GET /approvals/requests`, ORed with
// `approverId`. This pins the card's three cases on a real boot, through the
// door the console calls, on both faces it reads (the paged list and its
// `total`, which is the bell's number):
//
//   ⭐ an admin_rescue request appears for an override actor, with
//      `viewer.can_override: true`, beside the admin's own identities;
//   ⭐ it does not appear for a member, who sent the same parameter;
//   ⭐ CONTROL: a staffed request's queue is unchanged. Its approver reads the
//      same rows with the arm and without it, and the arm never claims it.
//
// And the door's half: a value other than `true` / `false` is refused, so a
// malformed ask never reads as an empty rescue queue.

import { describe, it, expect } from 'vitest';
import { bootStack } from '@objectstack/verify';
import { ApprovalsServicePlugin } from '@objectstack/plugin-approvals';
import { RecordChangeTriggerPlugin } from '@objectstack/trigger-record-change';
import {
  unstaffedArmStack,
  unstaffedArmSecurity,
  UNSTAFFED_POSITION,
  STAFFED_APPROVER_EMAIL,
} from './fixtures/unstaffed-arm-fixture.js';

const SYS = { context: { isSystem: true } } as const;
const SUBMITTER = 'unstaffed-arm-submitter@example.com';
/** `bootStack`'s seeded dev admin: a platform admin, so an override actor. */
const ADMIN_EMAIL = 'admin@objectos.ai';

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

describe('the approvals inbox\'s unstaffed arm, through the REST door (#22725)', () => {
  it(
    'returns an admin_rescue request to an override actor, not to a member, and leaves a staffed queue unchanged',
    async () => {
      const stack = await bootStack(unstaffedArmStack as unknown as Parameters<typeof bootStack>[0], {
        automation: true,
        security: unstaffedArmSecurity(),
        extraPlugins: [new RecordChangeTriggerPlugin(), new ApprovalsServicePlugin()],
      });
      try {
        const ql: any = await stack.kernel.getServiceAsync('objectql');
        const idOf = async (email: string): Promise<string> => {
          const u = await ql.findOne('sys_user', { where: { email }, context: SYS.context });
          return String(u?.id ?? '');
        };
        // Seed the dev admin FIRST, so the sign-ups below are plain members.
        const adminToken = await stack.signIn();
        const submitterToken = await stack.signUp(SUBMITTER);
        const approverToken = await stack.signUp(STAFFED_APPROVER_EMAIL);
        const submitterId = await idOf(SUBMITTER);
        const approverId = await idOf(STAFFED_APPROVER_EMAIL);
        const adminId = await idOf(ADMIN_EMAIL);
        expect(submitterId).not.toBe('');
        expect(approverId).not.toBe('');
        expect(adminId).not.toBe('');

        // A plain member submits both records: one opens on the unstaffed
        // literal (admin_rescue), one on the named approver (the control).
        const stuckRes = await stack.apiAs(submitterToken, 'POST', '/data/unstaffed_arm_stuck', { name: 'stuck' });
        expect(stuckRes.status).toBe(201);
        const staffedRes = await stack.apiAs(submitterToken, 'POST', '/data/unstaffed_arm_staffed', { name: 'staffed' });
        expect(staffedRes.status).toBe(201);

        const list = async (token: string, query: string): Promise<ListBody> => {
          const res = await stack.apiAs(token, 'GET', `/approvals/requests?${query}`);
          expect(res.status, `GET /approvals/requests?${query}`).toBe(200);
          return (await res.json()) as ListBody;
        };

        // The scene, before anything is read off it: both requests are open,
        // and each slate is what its half needs. A zero-row answer below must
        // never be readable as "nothing was opened".
        const all = await list(adminToken, 'status=pending');
        expect(all.data).toHaveLength(2);
        const stuck = all.data.find((r) => r.object_name === 'unstaffed_arm_stuck');
        const staffed = all.data.find((r) => r.object_name === 'unstaffed_arm_staffed');
        expect(stuck?.pending_approvers).toEqual([`position:${UNSTAFFED_POSITION}`]);
        expect(staffed?.pending_approvers).toEqual([STAFFED_APPROVER_EMAIL]);

        // ⭐ 1 — an override actor finds it. Beside their own identities (the
        // console's "My Pending" shape) and alone, on both faces.
        const adminIdentities = `&approverId=${encodeURIComponent(adminId)},${encodeURIComponent(ADMIN_EMAIL)}`;
        const before = await list(adminToken, `status=pending${adminIdentities}&limit=50`);
        expect(before.data.map((r) => r.id)).not.toContain(stuck!.id);
        for (const query of [
          `status=pending${adminIdentities}&unstaffed=true&limit=50`,
          'status=pending&unstaffed=true&limit=50',
        ]) {
          const got = await list(adminToken, query);
          expect(got.data.map((r) => r.id), query).toEqual([stuck!.id]);
          expect(got.total, query).toBe(1);
          expect(got.data[0].viewer).toEqual({ can_act: false, is_submitter: false, can_override: true });
        }

        // ⭐ 2 — a member who sends the same parameter gets nothing extra.
        const memberQuery = `status=pending&approverId=${encodeURIComponent(submitterId)},${encodeURIComponent(SUBMITTER)}`;
        for (const query of [`${memberQuery}&unstaffed=true&limit=50`, 'status=pending&unstaffed=true&limit=50']) {
          const got = await list(submitterToken, query);
          expect(got.data, query).toEqual([]);
          expect(got.total, query).toBe(0);
        }

        // ⭐ 3 — CONTROL: the staffed request's approver reads the same queue
        // with the arm and without it, and the arm never claims that request.
        const approverQuery = `status=pending&approverId=${encodeURIComponent(approverId)},${encodeURIComponent(STAFFED_APPROVER_EMAIL)}&limit=50`;
        const without = await list(approverToken, approverQuery);
        const withArm = await list(approverToken, `${approverQuery}&unstaffed=true`);
        expect(without.data.map((r) => r.id)).toEqual([staffed!.id]);
        expect(without.total).toBe(1);
        expect(withArm.data.map((r) => r.id)).toEqual(without.data.map((r) => r.id));
        expect(withArm.total).toBe(without.total);
        const rescue = await list(adminToken, 'status=pending&unstaffed=true');
        expect(rescue.data.map((r) => r.id)).not.toContain(staffed!.id);

        // The door's half: a value the door cannot read is refused, never
        // guessed into "no arm".
        const refused = await stack.apiAs(adminToken, 'GET', '/approvals/requests?status=pending&unstaffed=1');
        expect(refused.status).toBe(400);
        const refusal: any = await refused.json();
        expect(refusal?.code).toBe('VALIDATION_FAILED');
        expect(refusal?.fields?.[0]).toMatchObject({ field: 'unstaffed', code: 'invalid_boolean' });
      } finally {
        await stack.stop();
      }
    },
    120_000,
  );
});
