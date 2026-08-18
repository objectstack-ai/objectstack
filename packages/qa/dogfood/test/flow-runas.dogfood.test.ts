// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// FLOW runAs identity-enforcement proof (#1888), exercised end-to-end through the
// real HTTP + automation + security stack.
//
// ADR-0056 D10 — the authz-conformance matrix row this file is the cited proof
// for; `authz-conformance.test.ts` asserts the pairing is mutual (#7976).
// authz-row: flow-run-as
//
// @proof: flow-runas-identity
// Security-layer instance of the "configured in the UI, silently does nothing at
// runtime" anti-pattern (sibling of the assignment/decision node fixes). A flow's
// `runAs` MUST switch the execution identity of its data nodes:
//   • runAs:'system' → elevated, RLS-bypassing (the run can touch records the
//     triggering user cannot),
//   • runAs:'user'   → the triggering user (RLS-respecting; cannot exceed grants).
//
// The proof drives both directions as a RESTRICTED member against an owner-scoped
// object the member cannot read or write directly:
//   • system flows succeed on the admin's note  → elevation is REAL,
//   • user flows are RLS-denied on the same note → de-elevation is REAL.
// The two user-mode legs are denied DIFFERENTLY, and both shapes are asserted:
// the WRITE is refused at the record layer, so the run fails and the trigger
// route answers 400 `FLOW_FAILED` (#9378 — it rode HTTP 200 with an inner
// `{success:false}` until then); the READ is filtered by RLS, so the run
// SUCCEEDS with an empty `found`. Neither is a status band: a write leg that
// started answering 403/500, or a read leg that started failing outright, is a
// different bug and must not pass here.
// Before the #1888 fix the user flows wrongly succeed (CRUD nodes passed no
// identity → security skipped) → this file is RED; after the fix → GREEN.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { runasFixtureStack, runasFixtureSecurity } from './fixtures/flow-runas-fixture.js';

describe('objectstack verify FLOW: runAs identity enforcement (#flow-runas)', () => {
  let stack: VerifyStack;
  let adminToken: string;
  let memberToken: string;

  beforeAll(async () => {
    stack = await bootStack(runasFixtureStack, { automation: true, security: runasFixtureSecurity() });
    adminToken = await stack.signIn();
    // First user is the seeded dev admin, so this fresh sign-up is a plain member
    // who falls back to the owner-scoped fixture permission set.
    memberToken = await stack.signUp('member@runas.test');
  }, 60_000);

  afterAll(async () => {
    await stack?.stop();
  });

  /** Admin creates a note it owns; returns the new id. */
  async function adminCreateNote(name: string): Promise<string> {
    const res = await stack.apiAs(adminToken, 'POST', '/data/runas_note', { name, status: 'new' });
    expect(res.status, `admin create ${name} failed: ${res.status} ${await res.clone().text()}`).toBeLessThan(300);
    const j = (await res.json()) as { id?: string; record?: { id?: string } };
    const id = j.id ?? j.record?.id;
    expect(id, 'no id returned from create').toBeTruthy();
    return id as string;
  }

  /** Read a note's status as the admin (who can always see every row). */
  async function adminStatusOf(id: string): Promise<unknown> {
    const res = await stack.apiAs(adminToken, 'GET', `/data/runas_note/${id}`);
    expect(res.status).toBe(200);
    const j = (await res.json()) as { record?: Record<string, unknown> } & Record<string, unknown>;
    return (j.record ?? j).status;
  }

  /**
   * Trigger a flow as the restricted member and require the run to have
   * COMPLETED; returns the inner AutomationResult.
   *
   * [#9378] Since the trigger route answers real HTTP status codes, this helper
   * is also the discriminator it could not be before: a run that fails now
   * comes back 400 and is rejected HERE. Until then a failed run rode HTTP 200
   * with `{success:false}` inside, so the read leg below — which only checks
   * that `found` is falsy — passed identically whether the RLS-scoped read
   * returned EMPTY (the thing it means to prove) or the run DIED before
   * reading anything at all.
   */
  async function memberTrigger(flow: string, noteId: string): Promise<{ success?: boolean; output?: any }> {
    const res = await stack.apiAs(memberToken, 'POST', `/automation/${flow}/trigger`, { params: { noteId } });
    expect(res.status, `trigger ${flow} HTTP failed: ${res.status} ${await res.clone().text()}`).toBeLessThan(300);
    const body = (await res.json()) as { success?: boolean; data?: { success?: boolean; output?: any } };
    expect(body.success).toBe(true);
    return body.data ?? {};
  }

  /**
   * Trigger a flow as the restricted member and require the run to have RUN AND
   * FAILED on a record-access refusal — the de-elevation proof's write leg.
   *
   * [#9378] The transport contract this asserts, in full rather than by status
   * band: the route answers **400** `FLOW_FAILED` (ADR-0112 envelope), the node
   * failure is `error.message` verbatim, and the per-node accounting in
   * `error.details.summary` names WHICH node failed. Asserting the band
   * (`>= 400`) or the throw alone would keep passing if the refusal turned into
   * a 403 authorization verdict or a 500 fault — both of which would mean the
   * de-elevation broke in a different way, and both of which this file exists
   * to catch.
   *
   * Before #9378 this same run answered `HTTP 200 {"success":true,"data":{
   * "success":false,…}}`, so the ONLY visible trace of the denial was the
   * record staying unchanged. That assertion is still below and still the
   * primary proof; this one is the transport half that used to be invisible.
   */
  async function memberTriggerExpectingAccessRefusal(flow: string, noteId: string, failingNodeId: string) {
    const res = await stack.apiAs(memberToken, 'POST', `/automation/${flow}/trigger`, { params: { noteId } });
    const text = await res.clone().text();
    expect(res.status, `trigger ${flow} should be 400 FLOW_FAILED: ${res.status} ${text}`).toBe(400);

    const body = (await res.json()) as {
      success?: boolean;
      data?: unknown;
      error?: { code?: string; message?: string; httpStatus?: number; details?: { summary?: { nodes?: any[] } } };
    };
    expect(body.success).toBe(false);
    expect(body.error?.code, `expected FLOW_FAILED: ${text}`).toBe('FLOW_FAILED');
    expect(body.error?.httpStatus).toBe(400);
    // The double envelope is GONE, not re-labelled: nothing is left for a
    // status-blind caller to misread as a successful run.
    expect(body.data).toBeUndefined();
    // The failure is the RLS refusal on the note, named node-first — not a
    // generic "flow failed", which would pass while the run died of anything.
    expect(body.error?.message).toContain(`Node '${failingNodeId}' failed`);
    expect(body.error?.message).toMatch(/do not have access to this record/i);
    // Which node failed survives the envelope change — the reason `summary`
    // rides in `details` at all.
    const failed = body.error?.details?.summary?.nodes?.find((n) => n?.nodeId === failingNodeId);
    expect(failed?.status, `no failure entry for node '${failingNodeId}' in ${text}`).toBe('failure');
  }

  it('precondition: the automation service is wired and a flow is registered', async () => {
    const res = await stack.apiAs(memberToken, 'GET', '/automation/runas_system_touch');
    expect(res.status, `automation service not wired: ${res.status}`).toBe(200);
  });

  it('precondition: the member is genuinely RLS-denied on the admin note (isolation is real)', async () => {
    const id = await adminCreateNote('iso-check');
    // Admin sees it; member must NOT (owner policy keyed on created_by).
    expect(await adminStatusOf(id)).toBe('new');
    const res = await stack.apiAs(memberToken, 'GET', `/data/runas_note/${id}`);
    if (res.status === 200) {
      const j = (await res.json()) as { record?: Record<string, unknown> } & Record<string, unknown>;
      const rec = (j.record ?? j) as Record<string, unknown>;
      // A 200 is only acceptable if it carries NO actual row (RLS filtered it out).
      expect(rec.id ?? rec.name, 'member could READ the admin note — RLS isolation is not in effect').toBeFalsy();
    } else {
      expect(res.status, `unexpected status for RLS-denied read: ${res.status}`).toBe(404);
    }
  });

  // ── WRITE direction ───────────────────────────────────────────────────────

  it("runAs:'system' ELEVATES — member-triggered system flow WRITES a record the member cannot", async () => {
    const id = await adminCreateNote('sys-touch');
    const result = await memberTrigger('runas_system_touch', id);
    expect(result.success, `system flow run not successful: ${JSON.stringify(result)}`).toBe(true);
    // The elevated run bypassed RLS and stamped the admin's note.
    expect(await adminStatusOf(id)).toBe('touched-system');
  });

  it("runAs:'user' DE-ELEVATES — member-triggered user flow is RLS-DENIED on the same record", async () => {
    const id = await adminCreateNote('user-touch');
    // The de-elevated run reaches the record layer as the MEMBER and the write
    // is refused there, so the run fails on its `touch` node — surfaced since
    // #9378 as 400 `FLOW_FAILED` instead of a 200 wrapping the inner failure.
    // The refusal text is asserted in the helper: this leg proves the identity
    // switch is real, so "denied because of WHO ran it" is the load-bearing
    // part, not merely "something went wrong".
    await memberTriggerExpectingAccessRefusal('runas_user_touch', id, 'touch');
    // The run executed as the member; the by-id write to the admin's note is
    // RLS-denied, so the record is unchanged. (Before the fix it would read
    // 'touched-user' — the privilege-boundary surprise this gate pins.)
    const after = await adminStatusOf(id);
    expect(after, 'user-mode flow wrote a record the triggering member cannot access (#1888 regression)').not.toBe(
      'touched-user',
    );
    expect(after).toBe('new');
  });

  // ── READ direction ────────────────────────────────────────────────────────

  it("runAs:'system' READS a record the member cannot; runAs:'user' cannot", async () => {
    const id = await adminCreateNote('read-check');

    const sys = await memberTrigger('runas_system_read', id);
    expect(sys.output?.found, 'system flow could not read the record it should see (elevation broken)').toBeTruthy();

    const usr = await memberTrigger('runas_user_read', id);
    const found = usr.output?.found;
    expect(
      found && typeof found === 'object' ? (found as any).id : found,
      'user-mode flow READ a record the triggering member cannot access (#1888 regression)',
    ).toBeFalsy();
  });
});
