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
// whose sole node routes to a POSITION NOBODY HOLDS — the "stranded" shape:
// an unresolved approver slate, `lockRecord: true`, otherwise undecidable.
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

import { describe, it, expect } from 'vitest';
import { bootStack } from '@objectstack/verify';
import { celEngine } from '@objectstack/formula';
import type { Expression } from '@objectstack/spec';
import { ApprovalsServicePlugin } from '@objectstack/plugin-approvals';
import { RecordChangeTriggerPlugin } from '@objectstack/trigger-record-change';
import { overrideCompositeStack, overrideCompositeSecurity } from './fixtures/override-composite-fixture.js';

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
        expect(listRow.pending_approvers).toEqual(['position:override_composite_unstaffed']);
        expect(listRow.lock_record).toBe(true);
        expect(listRow.viewer).toBeTruthy();

        const requestId = String(listRow.id);
        const getRes = await stack.apiAs(adminToken, 'GET', `/approvals/requests/${requestId}`);
        expect(getRes.status).toBe(200);
        const getRow = (await getRes.json()) as Record<string, unknown>;
        expect(getRow.viewer).toBeTruthy();

        // ── GATE B — `can_override` true on BOTH faces, and the fail-safe's
        //    other two flags correctly false for this actor ────────────────
        const expectedViewer: ServedViewer = { can_act: false, is_submitter: false, can_override: true };
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
