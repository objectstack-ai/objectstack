// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #16679 — the composite pin the card's own sentence names as missing:
// "neither is visible from inside this repository's own tests — the
// measurement needed a real app." Each of three gates is individually
// observable somewhere in this repo; the CONJUNCTION — a served `viewer`
// block, served `sys_approval_request` action metadata, and a CEL verdict
// evaluating one against the other, on a real booted app — was pinned
// nowhere. That is the seam through which a change to any one of the three
// could silently break the #3424 platform-admin override with every existing
// test green.
//
// ## What this measures, on the wire, on a real boot
//
// A plain member (never the platform admin) submits a record into a flow
// whose sole node routes to a NAMED APPROVER WHO IS NOT THERE TO ACT — the
// "stranded" shape: a slate no one present can decide, `lockRecord: true`,
// otherwise undecidable. (Not a position nobody holds: under the default
// `admin_rescue` that slate now opens on the organization's administrators,
// #22824, so it is no longer stranded.)
// The platform admin then reads the SAME request the console's approvals
// inbox would, on both faces (`listRequests` / `getRequest`), and the SAME
// `sys_approval_request` action metadata `GET /meta/object` serves — then
// evaluates the served predicates against the served viewer with
// `@objectstack/formula`'s `celEngine`, the engine the console itself uses.
//
// Both halves are asserted, not just the affirmative one (#16679 ⭐): the four
// override levers (approve/reject/reassign/recall) must evaluate `visible ===
// true`, AND the four secondary/submitter levers (send_back/request_info/
// remind/resubmit) and the thread reply (`approval_comment`) must evaluate
// `visible === false` for this exact viewer. A pin asserting only the first
// half would stay green if the predicate degenerated to a constant `true` —
// precisely the failure a security-adjacent lever must not have. The set of
// served actions that evaluate `true` is also asserted EXACTLY, so a lever
// added later cannot join the override set without this pin moving.
//
// The thread reply has a second half on the wire: its predicate carries no
// override arm because the comment route admits none, so the same admin's
// POST to that route is refused with `FORBIDDEN` — the hidden button and the
// refused route are asserted together.
//
// See `test/fixtures/override-composite-fixture.ts` for why this boots a
// purpose-built object + flow rather than the showcase's own
// `showcase_budget_approval` (the flow the #16679 measurement round drove):
// showcase's `onEnable` unconditionally STAFFS the position that flow's
// second rung needs unstaffed.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack } from '@objectstack/verify';
import { celEngine } from '@objectstack/formula';
import type { Expression } from '@objectstack/spec';
import { ApprovalsServicePlugin } from '@objectstack/plugin-approvals';
import { RecordChangeTriggerPlugin } from '@objectstack/trigger-record-change';
import {
  overrideCompositeStack,
  overrideCompositeSecurity,
  DEPARTED_APPROVER,
} from './fixtures/override-composite-fixture.js';

/** The four #3424 override-admitted decision levers — served `visible` must OR in `can_override`. */
const OVERRIDE_LEVERS = ['approval_approve', 'approval_reject', 'approval_reassign', 'approval_recall'] as const;

/**
 * The secondary approver levers (gate on `can_act` alone) and the submitter
 * continuity levers (gate on `is_submitter` alone). Neither ORs in
 * `can_override` (deliberate boundary, `action-predicate-sparse-face.test.ts`
 * `:140`) — for THIS viewer (`can_act: false`, `is_submitter: false`) every
 * one of these must evaluate `visible === false`.
 */
const NON_OVERRIDE_LEVERS = [
  'approval_send_back',
  'approval_request_info',
  'approval_remind',
  'approval_resubmit',
] as const;

/**
 * The thread reply. It gates on `can_act`, or on `is_submitter` while the
 * request is pending — the comment route's own admission
 * (`ApprovalService.comment`), which has no override arm — so for THIS viewer
 * it must evaluate `visible === false`, and the route must refuse the post.
 */
const THREAD_REPLY = 'approval_comment';

interface ServedViewer {
  can_act: boolean;
  is_submitter: boolean;
  can_override: boolean;
  /** `can_override` minus an approval of the viewer's own request — Approve's override arm. */
  can_override_approve: boolean;
}

interface ServedAction {
  name: string;
  visible?: Expression;
}

async function bootFixture() {
  return bootStack(overrideCompositeStack as unknown as Parameters<typeof bootStack>[0], {
    automation: true,
    security: overrideCompositeSecurity(),
    extraPlugins: [new RecordChangeTriggerPlugin(), new ApprovalsServicePlugin()],
  });
}

describe('approval override composite (#16679)', () => {
  it(
    'serves an override-only viewer whose CEL-evaluated actions admit exactly the four override levers',
    async () => {
      const stack = await bootFixture();
      try {
        // A plain member submits — never the admin — so the admin reading the
        // request back is neither the approver nor the submitter: the exact
        // `{can_act:false, is_submitter:false, can_override:true}` triple the
        // #16679 measurement round read off the wire.
        const memberToken = await stack.signUp('override-composite-member@example.com');
        // The departed approver's account exists, and its holder never acts.
        await stack.signUp(DEPARTED_APPROVER);
        const createRes = await stack.apiAs(memberToken, 'POST', '/data/override_composite_request', {
          name: 'Stranded request',
          amount: 100,
        });
        expect(createRes.status).toBe(201);

        const adminToken = await stack.signIn();

        // ── GATE A + the stranded-scene positive control ──────────────────
        // A zero-row list would be indistinguishable from "nothing to measure"
        // (NOT MEASURED, never a pass) — assert the scene actually opened
        // before reading anything off it.
        const listRes = await stack.apiAs(adminToken, 'GET', '/approvals/requests?status=pending');
        expect(listRes.status).toBe(200);
        const listBody = (await listRes.json()) as { data: Array<Record<string, unknown>> };
        expect(listBody.data.length).toBe(1);
        const listRow = listBody.data[0];
        expect(listRow.status).toBe('pending');
        expect(listRow.pending_approvers).toEqual([DEPARTED_APPROVER]);
        expect(listRow.lock_record).toBe(true);
        expect(listRow.viewer).toBeTruthy();

        const requestId = String(listRow.id);
        const getRes = await stack.apiAs(adminToken, 'GET', `/approvals/requests/${requestId}`);
        expect(getRes.status).toBe(200);
        const getRow = (await getRes.json()) as Record<string, unknown>;
        expect(getRow.viewer).toBeTruthy();

        // ── GATE B — `can_override` true on BOTH faces, and the fail-safe's
        //    other two flags correctly false for this actor. The admin did
        //    not submit the request, so Approve's `can_override_approve` is
        //    true with it ───────────────────────────────────────────────────
        const expectedViewer: ServedViewer = {
          can_act: false, is_submitter: false, can_override: true, can_override_approve: true,
        };
        expect(listRow.viewer).toEqual(expectedViewer);
        expect(getRow.viewer).toEqual(expectedViewer);

        // ── GATE C — the served action metadata ORs `can_override` in on
        //    exactly the four core levers, and nowhere else ─────────────────
        const metaRes = await stack.apiAs(adminToken, 'GET', '/meta/object/sys_approval_request');
        expect(metaRes.status).toBe(200);
        const metaBody = (await metaRes.json()) as { item?: { actions?: ServedAction[] } };
        const actions = metaBody.item?.actions ?? [];
        expect(actions.length).toBe(9);

        const byName = new Map(actions.map((a) => [a.name, a] as const));
        for (const name of [...OVERRIDE_LEVERS, ...NON_OVERRIDE_LEVERS, THREAD_REPLY]) {
          const action = byName.get(name);
          expect(action, `served actions must include '${name}'`).toBeTruthy();
          expect(action?.visible?.dialect).toBe('cel');
        }

        // ── COMPOSITE — evaluate the SERVED predicates against the SERVED
        //    viewer with @objectstack/formula's celEngine, the engine the
        //    console itself uses (`action-predicate-sparse-face.test.ts`
        //    treats it as the authority). `record` is the served row itself
        //    — the same binding shape the console evaluates `visible`
        //    against (`record.status`, `record.viewer.*`). ────────────────
        const evaluateVisible = (action: ServedAction | undefined): boolean => {
          if (!action?.visible) throw new Error('action carries no visible predicate');
          const result = celEngine.evaluate(action.visible, { record: getRow });
          if (!result.ok) {
            throw new Error(`CEL evaluation of '${action.name}' faulted: ${JSON.stringify(result)}`);
          }
          return result.value === true;
        };

        // ⭐ Both halves. A pin asserting only this first loop would stay
        // green if `visible` degenerated to a constant `true`.
        for (const name of OVERRIDE_LEVERS) {
          expect(evaluateVisible(byName.get(name)), `${name} must be visible=true for an override-only viewer`).toBe(
            true,
          );
        }
        for (const name of NON_OVERRIDE_LEVERS) {
          expect(
            evaluateVisible(byName.get(name)),
            `${name} must stay visible=false — it must not admit an actor who is neither the approver nor the submitter`,
          ).toBe(false);
        }
        expect(
          evaluateVisible(byName.get(THREAD_REPLY)),
          `${THREAD_REPLY} must stay visible=false — the comment route admits the submitter and the slot holders only`,
        ).toBe(false);

        // "Exactly the four": every served action, not only the ones named
        // above, is evaluated, and the ones that admit this viewer are the
        // override levers and nothing else.
        expect(actions.filter((a) => evaluateVisible(a)).map((a) => a.name).sort()).toEqual(
          [...OVERRIDE_LEVERS].sort(),
        );

        // The route half of the hidden reply: the same admin's post is
        // refused, and nothing is written to the request's timeline.
        const replyRes = await stack.apiAs(adminToken, 'POST', `/approvals/requests/${requestId}/comment`, {
          comment: 'an override admin on no slot',
        });
        expect(replyRes.status).toBe(403);
        expect(((await replyRes.json()) as { code?: string }).code).toBe('FORBIDDEN');
        const timelineRes = await stack.apiAs(adminToken, 'GET', `/approvals/requests/${requestId}/actions`);
        expect(timelineRes.status).toBe(200);
        const timeline = ((await timelineRes.json()) as { data: Array<{ action?: string }> }).data;
        expect(timeline.length).toBeGreaterThan(0);
        expect(timeline.map((a) => a.action)).not.toContain('comment');
      } finally {
        await stack.stop();
      }
    },
    60_000,
  );
});

/**
 * [Maintainer ruling 2026-11-17, option B] The #3424 override never approves a
 * request its actor submitted, and never hands the request's slot to its
 * submitter. Pinned here through the real approvals routes on the same booted
 * fixture: the dev admin (a platform administrator and the default
 * organization's owner) submits a request whose slate names the approver who
 * never acts, so the admin holds no slot on it and is admitted only through
 * the override.
 *
 *   ⭐ the admin's approve of their own request answers 403 FORBIDDEN and
 *      records nothing; their viewer block reads `can_override_approve: false`
 *      and the served Approve predicate evaluates false;
 *   ⭐ the admin's reassign of their own request to themselves, by id or by
 *      email, answers 400 VALIDATION_FAILED and leaves the slate; so does a
 *      reassign of a member's request to that member;
 *   ⭐ the admin's reject and recall of their own requests succeed;
 *   ⭐ CONTROLS: the admin still override-approves a member's request, audited
 *      `via_override: true`, after which the slate's approver reads 404; a
 *      slot holder still approves their own request (`via_override: false`).
 *
 * The service-level half is `plugin-approvals`' `approval-override-audit.test.ts`.
 */
describe('the override never approves its actor\'s own request, through the approvals routes', () => {
  const ADMIN_EMAIL = 'admin@objectos.ai';
  const MEMBER = 'override-own-request-member@example.com';
  const SYS = { isSystem: true } as const;
  let stack: Awaited<ReturnType<typeof bootFixture>>;
  let ql: any;
  let adminToken: string;
  let memberToken: string;
  let approverToken: string;
  let adminId: string;
  let memberId: string;

  interface Answer { status: number; code?: string; body: Record<string, unknown> }

  const call = async (token: string, method: 'GET' | 'POST', path: string, body?: unknown): Promise<Answer> => {
    const res = await stack.apiAs(token, method, path, body);
    const parsed = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const error = parsed.error as { code?: string } | undefined;
    return { status: res.status, code: (parsed.code as string | undefined) ?? error?.code, body: parsed };
  };

  /** `token`'s user files one request; the flow opens its pending step. */
  const openRequest = async (token: string, name: string): Promise<string> => {
    const res = await stack.apiAs(token, 'POST', '/data/override_composite_request', { name, amount: 1 });
    expect(res.status, await res.clone().text()).toBe(201);
    const created = (await res.json()) as { id?: string; record?: { id?: string } };
    const recordId = String(created.id ?? created.record?.id ?? '');
    const [opened] = await ql.find('sys_approval_request', {
      where: { object_name: 'override_composite_request', record_id: recordId }, context: SYS,
    });
    expect(opened?.status, 'the flow opened the approval step').toBe('pending');
    return String(opened.id);
  };

  const requestRow = async (id: string) =>
    (await ql.find('sys_approval_request', { where: { id }, context: SYS }))[0];
  const decisionsOn = async (id: string) =>
    ((await ql.find('sys_approval_action', { where: { request_id: id }, context: SYS })) as Array<Record<string, unknown>>)
      .filter((a) => a.action !== 'submit');
  const idOf = async (email: string) =>
    String((await ql.findOne('sys_user', { where: { email }, context: SYS }))?.id ?? '');

  beforeAll(async () => {
    stack = await bootFixture();
    ql = await stack.kernel.getServiceAsync('objectql');
    adminToken = await stack.signIn();
    memberToken = await stack.signUp(MEMBER);
    approverToken = await stack.signUp(DEPARTED_APPROVER);
    adminId = await idOf(ADMIN_EMAIL);
    memberId = await idOf(MEMBER);
    expect(adminId).not.toBe('');
    expect(memberId).not.toBe('');
  }, 60_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('refuses the submitter-administrator\'s approve with 403, records nothing, and does not offer Approve', async () => {
    const id = await openRequest(adminToken, 'own approve');
    const row = await requestRow(id);
    expect(String(row.submitter_id)).toBe(adminId);
    expect(String(row.pending_approvers)).not.toContain(adminId);

    const read = await call(adminToken, 'GET', `/approvals/requests/${id}`);
    expect(read.status).toBe(200);
    expect(read.body.viewer).toEqual({
      can_act: false, is_submitter: true, can_override: true, can_override_approve: false,
    });
    const meta = await call(adminToken, 'GET', '/meta/object/sys_approval_request');
    const actions = ((meta.body.item as { actions?: ServedAction[] } | undefined)?.actions ?? []);
    const visibleFor = (name: string) => {
      const action = actions.find((a) => a.name === name);
      const result = celEngine.evaluate(action!.visible!, { record: read.body });
      if (!result.ok) throw new Error(`CEL evaluation of '${name}' faulted: ${JSON.stringify(result)}`);
      return result.value === true;
    };
    expect(visibleFor('approval_approve')).toBe(false);
    expect(visibleFor('approval_reject')).toBe(true);
    expect(visibleFor('approval_recall')).toBe(true);

    const approve = await call(adminToken, 'POST', `/approvals/requests/${id}/approve`, {});
    expect([approve.status, approve.code]).toEqual([403, 'FORBIDDEN']);
    expect((await requestRow(id)).status).toBe('pending');
    expect(await decisionsOn(id)).toEqual([]);
  }, 60_000);

  it('refuses an override reassign that hands the request to its submitter, leaving the slate', async () => {
    const own = await openRequest(adminToken, 'own reassign');
    const slate = String((await requestRow(own)).pending_approvers);
    for (const to of [adminId, ADMIN_EMAIL]) {
      const answer = await call(adminToken, 'POST', `/approvals/requests/${own}/reassign`, { to });
      expect([answer.status, answer.code], `reassign to ${to}`).toEqual([400, 'VALIDATION_FAILED']);
    }
    expect(String((await requestRow(own)).pending_approvers)).toBe(slate);

    const members = await openRequest(memberToken, 'member reassign');
    const toSubmitter = await call(adminToken, 'POST', `/approvals/requests/${members}/reassign`, { to: memberId });
    expect([toSubmitter.status, toSubmitter.code]).toEqual([400, 'VALIDATION_FAILED']);
    expect(await decisionsOn(own)).toEqual([]);
    expect(await decisionsOn(members)).toEqual([]);
  }, 60_000);

  it('leaves the submitter-administrator their reject and their recall', async () => {
    const rejected = await openRequest(adminToken, 'own reject');
    const reject = await call(adminToken, 'POST', `/approvals/requests/${rejected}/reject`, { comment: 'Filed in error.' });
    expect(reject.status).toBe(200);
    expect((await requestRow(rejected)).status).toBe('rejected');
    expect(await decisionsOn(rejected)).toMatchObject([{ action: 'reject', via_override: true }]);

    const recalled = await openRequest(adminToken, 'own recall');
    const recall = await call(adminToken, 'POST', `/approvals/requests/${recalled}/recall`, {});
    expect(recall.status).toBe(200);
    expect((await requestRow(recalled)).status).toBe('recalled');
  }, 60_000);

  // [#35719] A reject carries its reason on the approvals route too, with the
  // answer the `approval_reject` action door gives: 400 VALIDATION_ERROR naming
  // `comment`, before anything is read or written.
  it('refuses a reject with no reason, or a blank one, and leaves the request pending', async () => {
    const id = await openRequest(memberToken, 'reasonless reject');
    for (const body of [{}, { comment: '' }, { comment: '   ' }, { comment: null }]) {
      const reject = await call(adminToken, 'POST', `/approvals/requests/${id}/reject`, body);
      expect([reject.status, reject.code], JSON.stringify(body)).toEqual([400, 'VALIDATION_ERROR']);
      expect(JSON.stringify(reject.body)).toContain('Action param \\"comment\\" is required');
    }
    expect((await requestRow(id)).status).toBe('pending');
    expect(await decisionsOn(id)).toEqual([]);
  }, 60_000);

  it('CONTROL: a reject with its reason is recorded with that reason', async () => {
    const id = await openRequest(memberToken, 'reasoned reject');
    const reject = await call(adminToken, 'POST', `/approvals/requests/${id}/reject`, { comment: 'Over budget.' });
    expect(reject.status).toBe(200);
    expect((await requestRow(id)).status).toBe('rejected');
    expect(await decisionsOn(id)).toMatchObject([{ action: 'reject', comment: 'Over budget.' }]);
  }, 60_000);

  it('CONTROL: an administrator who did not submit the request override-approves it, audited, and the slate\'s approver then reads 404', async () => {
    const id = await openRequest(memberToken, 'member approve');
    const approve = await call(adminToken, 'POST', `/approvals/requests/${id}/approve`, {});
    expect(approve.status).toBe(200);
    expect((await requestRow(id)).status).toBe('approved');
    expect(await decisionsOn(id)).toMatchObject([{ action: 'approve', via_override: true }]);

    const slateApprover = await call(approverToken, 'POST', `/approvals/requests/${id}/approve`, {});
    expect([slateApprover.status, slateApprover.code]).toEqual([404, 'REQUEST_NOT_FOUND']);
    expect((await call(approverToken, 'GET', `/approvals/requests/${id}`)).status).toBe(404);
  }, 60_000);

  it('CONTROL: a slot holder approving their own request is unchanged', async () => {
    const id = await openRequest(approverToken, 'slot holder approve');
    const approve = await call(approverToken, 'POST', `/approvals/requests/${id}/approve`, {});
    expect(approve.status).toBe(200);
    expect(await decisionsOn(id)).toMatchObject([{ action: 'approve', via_override: false }]);
  }, 60_000);
});
