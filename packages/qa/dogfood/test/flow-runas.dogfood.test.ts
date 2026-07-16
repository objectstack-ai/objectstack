// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// FLOW runAs identity-enforcement proof (#1888), exercised end-to-end through the
// real HTTP + automation + security stack.
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

  /** Trigger a flow as the restricted member; returns the inner AutomationResult. */
  async function memberTrigger(flow: string, noteId: string): Promise<{ success?: boolean; output?: any }> {
    const res = await stack.apiAs(memberToken, 'POST', `/automation/${flow}/trigger`, { params: { noteId } });
    expect(res.status, `trigger ${flow} HTTP failed: ${res.status} ${await res.clone().text()}`).toBeLessThan(300);
    const body = (await res.json()) as { success?: boolean; data?: { success?: boolean; output?: any } };
    expect(body.success).toBe(true);
    return body.data ?? {};
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
    await memberTrigger('runas_user_touch', id);
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
