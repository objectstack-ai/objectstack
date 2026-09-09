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
// remind/resubmit) must evaluate `visible === false` for this exact viewer.
// A pin asserting only the first half would stay green if the predicate
// degenerated to a constant `true` — precisely the failure a
// security-adjacent lever must not have.
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
        expect(actions.length).toBe(8);

        const byName = new Map(actions.map((a) => [a.name, a] as const));
        for (const name of [...OVERRIDE_LEVERS, ...NON_OVERRIDE_LEVERS]) {
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
      } finally {
        await stack.stop();
      }
    },
    60_000,
  );
});
