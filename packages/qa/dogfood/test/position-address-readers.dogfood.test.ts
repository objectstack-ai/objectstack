// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #21379 — the readers that still keyed a slot on the bare user id.
//
// #21350 put "My Pending" and the participant gate on the one slot-address
// equivalence (`plugin-approvals/src/approver-address.ts`). Measured on a real
// boot of `origin/main` after it (ecb6ca025), a holder of a position staffed
// only after the request opened — its slot the literal `position:<p>` — read:
//
//   viewer.can_act                           false
//   approve, no actorId (the default)        403 FORBIDDEN
//   approve, actorId role:<p> (the console)  403 FORBIDDEN
//   approve, actorId position:<p>            200
//   GET /requests/:id after that decision    404
//
// and a reviewer named by a `user` approver authored as an EMAIL found the
// request in neither "My Pending" nor `GET /requests/:id` (404), and was
// refused with the default actor, while naming the email decided it.
//
// Every one of those readers — `can_act`, the decision methods' slot test, the
// already-acted probe, the participant gate's email half — now takes the
// caller's acting addresses from that module. This pins the doors the console
// calls, on a booted app:
//
//   ⭐ can_act is the default actor's decision answer, row for row — holder,
//      bystander, submitter, admin;
//   ⭐ the holder decides with the default actor AND with the console's
//      spelling, `position:<p>`; the decision records the holder in
//      `actor_id` and the slot's stored spelling in `acted_as` (#21411: the
//      person and the slot are two facts, in two columns);
//   ⭐ the retired `role:<p>` (ADR-0090 D3, no alias window) is no address of
//      the slot: it lists nothing, and an approve naming it is refused 403
//      FORBIDDEN with nothing recorded;
//   ⭐ the holder keeps sight of the request after deciding it; the bystander
//      never sees it (this widens nobody);
//   ⭐ the email-keyed slot is listed, flagged, decided and kept in sight.

import { describe, it, expect } from 'vitest';
import { bootStack } from '@objectstack/verify';
import { ApprovalsServicePlugin } from '@objectstack/plugin-approvals';
import { RecordChangeTriggerPlugin } from '@objectstack/trigger-record-change';
import {
  positionAddressReadersStack,
  positionAddressReadersSecurity,
  ROUTED_POSITION,
  OTHER_POSITION,
  EMAIL_APPROVER,
} from './fixtures/position-address-readers-fixture.js';

const SYS = { context: { isSystem: true } } as const;
const SUBMITTER = 'pa-submitter@example.com';
const HOLDER = 'pa-holder@example.com';
const BYSTANDER = 'pa-bystander@example.com';
const SLOT = `position:${ROUTED_POSITION}`;

interface Viewer { can_act?: boolean; can_override?: boolean }
interface Row { id: string; pending_approvers?: string[]; viewer?: Viewer }

describe('every slot reader takes the caller\'s acting addresses (#21379)', () => {
  it(
    'a holder of a position-literal slot, and an email-keyed approver, decide with the default actor, see can_act, and keep sight of it',
    async () => {
      const stack = await bootStack(positionAddressReadersStack as unknown as Parameters<typeof bootStack>[0], {
        automation: true,
        security: positionAddressReadersSecurity(),
        extraPlugins: [new RecordChangeTriggerPlugin(), new ApprovalsServicePlugin()],
      });
      try {
        const ql: any = await stack.kernel.getServiceAsync('objectql');
        const idOf = async (email: string): Promise<string> => {
          const u = await ql.findOne('sys_user', { where: { email }, context: SYS.context });
          return String(u?.id ?? '');
        };
        const submitterToken = await stack.signUp(SUBMITTER);
        const holderToken = await stack.signUp(HOLDER);
        const bystanderToken = await stack.signUp(BYSTANDER);
        const emailToken = await stack.signUp(EMAIL_APPROVER);
        const adminToken = await stack.signIn();
        const holderId = await idOf(HOLDER);
        const bystanderId = await idOf(BYSTANDER);
        const emailId = await idOf(EMAIL_APPROVER);

        const list = async (token: string, identities?: string[]): Promise<Row[]> => {
          const qs = new URLSearchParams({ status: 'pending' });
          if (identities) qs.set('approverId', identities.join(','));
          const res = await stack.apiAs(token, 'GET', `/approvals/requests?${qs}`);
          expect(res.status).toBe(200);
          return ((await res.json()) as { data: Row[] }).data;
        };
        const detail = async (token: string, id: string) =>
          (await stack.apiAs(token, 'GET', `/approvals/requests/${id}`)).status;
        const approve = async (token: string, id: string, body: Record<string, unknown> = {}) => {
          const res = await stack.apiAs(token, 'POST', `/approvals/requests/${id}/approve`, body);
          const json = (await res.json()) as { code?: string; request?: { status?: string } };
          return { status: res.status, code: json.code, requestStatus: json.request?.status };
        };
        const recorded = async (id: string) => {
          const rows: any[] = await ql.find('sys_approval_action', {
            where: { request_id: id, action: 'approve' }, context: SYS.context,
          });
          return rows.map((r) => ({ actor_id: r.actor_id ?? null, acted_as: r.acted_as ?? null, via_override: r.via_override }));
        };
        const seen = new Set<string>();
        /** Open one position-routed request while NOBODY holds the position. */
        const openPositionRequest = async (name: string): Promise<string> => {
          const created = await stack.apiAs(submitterToken, 'POST', '/data/pa_position_request', { name });
          expect(created.status).toBe(201);
          const rows = (await list(adminToken, [SLOT])).filter((r) => !seen.has(r.id));
          expect(rows.map((r) => r.pending_approvers)).toEqual([[SLOT]]);
          seen.add(rows[0].id);
          return rows[0].id;
        };

        // Three requests opened before anyone holds the position, so each
        // slate is the literal slot.
        const tableRequest = await openPositionRequest('table');
        const consoleSpellingRequest = await openPositionRequest('console-spelling');
        const adminRequest = await openPositionRequest('admin');

        // Staffed only AFTER the requests opened (the HotCRM order).
        await ql.insert('sys_user_position', { id: 'pa_hold_holder', user_id: holderId, position: ROUTED_POSITION }, SYS);
        await ql.insert('sys_user_position', { id: 'pa_hold_bystander', user_id: bystanderId, position: OTHER_POSITION }, SYS);

        // ⭐ can_act, served, for every caller who may read the request…
        const holderRow = (await list(holderToken, [holderId, HOLDER, SLOT]))
          .find((r) => r.id === tableRequest);
        const submitterRow = (await list(submitterToken)).find((r) => r.id === tableRequest);
        const adminRow = (await list(adminToken, [SLOT])).find((r) => r.id === tableRequest);
        expect(holderRow?.viewer).toMatchObject({ can_act: true, can_override: false });
        expect(submitterRow?.viewer).toMatchObject({ can_act: false, can_override: false });
        expect(adminRow?.viewer).toMatchObject({ can_act: false, can_override: true });
        // …and the bystander may not read it at all.
        expect(await list(bystanderToken, [bystanderId, BYSTANDER, SLOT])).toEqual([]);
        // ⭐ The retired spelling lists nothing, for the holder either.
        expect(await list(holderToken, [holderId, HOLDER, `role:${ROUTED_POSITION}`])).toEqual([]);
        expect(await detail(bystanderToken, tableRequest)).toBe(404);

        // ⭐ …is the default actor's decision answer, row for row.
        const bystanderTry = await approve(bystanderToken, tableRequest);
        expect([bystanderTry.status, bystanderTry.code]).toEqual([403, 'FORBIDDEN']);
        const submitterTry = await approve(submitterToken, tableRequest);
        expect([submitterTry.status, submitterTry.code]).toEqual([403, 'FORBIDDEN']);
        const holderDecision = await approve(holderToken, tableRequest);
        expect([holderDecision.status, holderDecision.requestStatus]).toEqual([200, 'approved']);
        expect(await recorded(tableRequest)).toEqual([{ actor_id: holderId, acted_as: SLOT, via_override: false }]);
        const adminDecision = await approve(adminToken, adminRequest);
        expect([adminDecision.status, adminDecision.requestStatus]).toEqual([200, 'approved']);
        // An override records the admin — the person — and no slot.
        const adminId = await idOf('admin@objectos.ai');
        expect(adminId).not.toBe('');
        expect(await recorded(adminRequest)).toEqual([{ actor_id: adminId, acted_as: null, via_override: true }]);

        // ⭐ The holder keeps sight of what they decided; the bystander never had it.
        expect(await detail(holderToken, tableRequest)).toBe(200);
        expect(await detail(bystanderToken, tableRequest)).toBe(404);

        // ⭐ The retired `role:<p>` is refused, and records nothing…
        const viaRole = await approve(holderToken, consoleSpellingRequest, { actorId: `role:${ROUTED_POSITION}` });
        expect([viaRole.status, viaRole.code]).toEqual([403, 'FORBIDDEN']);
        expect(await recorded(consoleSpellingRequest)).toEqual([]);
        // …while the console's spelling, `position:<p>`, reaches the slot.
        const viaPosition = await approve(holderToken, consoleSpellingRequest, { actorId: SLOT });
        expect([viaPosition.status, viaPosition.requestStatus]).toEqual([200, 'approved']);
        expect(await recorded(consoleSpellingRequest)).toEqual([{ actor_id: holderId, acted_as: SLOT, via_override: false }]);

        // ⭐ The email-keyed slot, for a reviewer who did not submit it.
        const createdEmail = await stack.apiAs(submitterToken, 'POST', '/data/pa_email_request', { name: 'email' });
        expect(createdEmail.status).toBe(201);
        const emailRows = await list(adminToken, [EMAIL_APPROVER]);
        expect(emailRows.map((r) => r.pending_approvers)).toEqual([[EMAIL_APPROVER]]);
        const emailRequest = emailRows[0].id;
        const myPending = await list(emailToken, [emailId, EMAIL_APPROVER]);
        expect(myPending.map((r) => r.id)).toEqual([emailRequest]);
        expect(myPending[0].viewer).toMatchObject({ can_act: true });
        expect(await detail(emailToken, emailRequest)).toBe(200);
        expect(await list(bystanderToken, [bystanderId, EMAIL_APPROVER])).toEqual([]);
        const emailDecision = await approve(emailToken, emailRequest);
        expect([emailDecision.status, emailDecision.requestStatus]).toEqual([200, 'approved']);
        expect(await recorded(emailRequest)).toEqual([{ actor_id: emailId, acted_as: EMAIL_APPROVER, via_override: false }]);
        expect(await detail(emailToken, emailRequest)).toBe(200);
      } finally {
        await stack.stop();
      }
    },
    180_000,
  );
});
