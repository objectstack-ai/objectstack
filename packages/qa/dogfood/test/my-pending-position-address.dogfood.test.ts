// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #21350 — "My Pending" never listed a request routed to a position.
//
// A request whose approver position nobody holds when it opens keeps the
// literal `position:<p>` slot. Staff a user into `p` afterwards and they can
// approve it — `resolveActor` admits a holder under `position:<p>` or
// `role:<p>` — yet the approvals inbox's "My Pending" door never showed it:
// the console asks under `role:<p>`, and the list filter matched literally.
// Measured on a real boot before the fix, the defect had TWO halves:
//
//   - the STAFFED SUBMITTER (HotCRM's shape) found it under `position:<p>`
//     only — the list filter's half;
//   - a STAFFED REVIEWER who neither submitted it nor holds admin standing
//     found it under NEITHER spelling, and read `404` on the request itself,
//     while the approve call succeeded — the participant gate's half (it keyed
//     a "current approver" on the bare user id).
//
// Both now read the acting path's ONE position-address equivalence
// (`plugin-approvals/src/approver-address.ts`). This pins the door the inbox
// actually calls, on a booted app, with both halves and both controls:
//
//   ⭐ either spelling lists the request, for the reviewer AND the submitter;
//   ⭐ a user who does not hold the position sees nothing (negative control);
//   ⭐ a spelling the acting path does not admit folds onto nothing;
//   ⭐ the acting path is unchanged — the reviewer decides under the stored
//      spelling, the bystander is refused (the control).

import { describe, it, expect } from 'vitest';
import { bootStack } from '@objectstack/verify';
import { ApprovalsServicePlugin } from '@objectstack/plugin-approvals';
import { RecordChangeTriggerPlugin } from '@objectstack/trigger-record-change';
import {
  myPendingStack,
  myPendingSecurity,
  ROUTED_POSITION,
  OTHER_POSITION,
} from './fixtures/my-pending-position-fixture.js';

const SYS = { context: { isSystem: true } } as const;
const SUBMITTER = 'my-pending-submitter@example.com';
const REVIEWER = 'my-pending-reviewer@example.com';
const BYSTANDER = 'my-pending-bystander@example.com';

interface ListBody {
  data: Array<{ id: string; pending_approvers?: string[] }>;
}

describe('"My Pending" lists a position-routed request under either spelling (#21350)', () => {
  it(
    'a holder of the routed position finds it under role: and position:, a non-holder does not, and the acting path is unchanged',
    async () => {
      const stack = await bootStack(myPendingStack as unknown as Parameters<typeof bootStack>[0], {
        automation: true,
        security: myPendingSecurity(),
        extraPlugins: [new RecordChangeTriggerPlugin(), new ApprovalsServicePlugin()],
      });
      try {
        const ql: any = await stack.kernel.getServiceAsync('objectql');
        const idOf = async (email: string): Promise<string> => {
          const u = await ql.findOne('sys_user', { where: { email }, context: SYS.context });
          return String(u?.id ?? '');
        };
        const submitterToken = await stack.signUp(SUBMITTER);
        const reviewerToken = await stack.signUp(REVIEWER);
        const bystanderToken = await stack.signUp(BYSTANDER);
        const submitterId = await idOf(SUBMITTER);
        const reviewerId = await idOf(REVIEWER);
        const bystanderId = await idOf(BYSTANDER);

        // Opens while NOBODY holds the routed position → the literal slot.
        const createRes = await stack.apiAs(submitterToken, 'POST', '/data/my_pending_request', { name: 'r1' });
        expect(createRes.status).toBe(201);

        // Staffed only AFTER the request opened (the HotCRM order). The
        // submitter is staffed too: that is the card's own shape, the one the
        // participant gate already admitted, so it isolates the filter's half.
        await ql.insert('sys_user_position', { id: 'mp_hold_reviewer', user_id: reviewerId, position: ROUTED_POSITION }, SYS);
        await ql.insert('sys_user_position', { id: 'mp_hold_submitter', user_id: submitterId, position: ROUTED_POSITION }, SYS);
        await ql.insert('sys_user_position', { id: 'mp_hold_bystander', user_id: bystanderId, position: OTHER_POSITION }, SYS);

        const myPending = async (token: string, identities: string[]) => {
          const qs = new URLSearchParams({ status: 'pending', approverId: identities.join(',') });
          const res = await stack.apiAs(token, 'GET', `/approvals/requests?${qs}`);
          expect(res.status).toBe(200);
          return ((await res.json()) as ListBody).data;
        };

        // The scene opened, and on the literal slot — a zero-row read below
        // would otherwise be indistinguishable from "nothing to measure".
        const adminToken = await stack.signIn();
        const all = await myPending(adminToken, [`position:${ROUTED_POSITION}`]);
        expect(all.length).toBe(1);
        expect(all[0].pending_approvers).toEqual([`position:${ROUTED_POSITION}`]);
        const requestId = all[0].id;

        // ⭐ Either spelling, for the reviewer (the participant gate's half)
        // and for the submitter (the filter's half) — the console's identity
        // list is `<id>,<email>,role:<p>`.
        for (const spelling of [`role:${ROUTED_POSITION}`, `position:${ROUTED_POSITION}`]) {
          const asReviewer = await myPending(reviewerToken, [reviewerId, REVIEWER, spelling]);
          expect(asReviewer.map((r) => r.id), `reviewer under '${spelling}'`).toEqual([requestId]);
          const asSubmitter = await myPending(submitterToken, [submitterId, SUBMITTER, spelling]);
          expect(asSubmitter.map((r) => r.id), `submitter under '${spelling}'`).toEqual([requestId]);
        }
        const detail = await stack.apiAs(reviewerToken, 'GET', `/approvals/requests/${requestId}`);
        expect(detail.status).toBe(200);

        // ⭐ Negative control — holding A position is not holding THIS one.
        for (const spelling of [`role:${ROUTED_POSITION}`, `position:${ROUTED_POSITION}`]) {
          const asBystander = await myPending(bystanderToken, [bystanderId, BYSTANDER, spelling]);
          expect(asBystander, `bystander under '${spelling}'`).toEqual([]);
        }
        const bystanderDetail = await stack.apiAs(bystanderToken, 'GET', `/approvals/requests/${requestId}`);
        expect(bystanderDetail.status).toBe(404);

        // ⭐ Negative control — only the two spellings the acting path admits
        // fold; the admin sees every row, so a miss is the filter's verdict.
        for (const address of [`team:${ROUTED_POSITION}`, `org_membership_level:${ROUTED_POSITION}`]) {
          expect(await myPending(adminToken, [address]), `'${address}' must not fold`).toEqual([]);
        }

        // ⭐ The acting path, unchanged (the control): a non-holder naming the
        // slot is refused; the holder decides under the stored spelling.
        const refused = await stack.apiAs(bystanderToken, 'POST', `/approvals/requests/${requestId}/approve`, {
          actorId: `position:${ROUTED_POSITION}`,
        });
        expect(refused.status).toBe(403);
        expect(((await refused.json()) as { code?: string }).code).toBe('FORBIDDEN');

        const decided = await stack.apiAs(reviewerToken, 'POST', `/approvals/requests/${requestId}/approve`, {
          actorId: `position:${ROUTED_POSITION}`,
        });
        expect(decided.status).toBe(200);
        const decidedBody = (await decided.json()) as { request?: { status?: string } };
        expect(decidedBody.request?.status).toBe('approved');
      } finally {
        await stack.stop();
      }
    },
    120_000,
  );
});
