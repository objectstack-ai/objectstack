// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// FLOW runAs — the user-less run is REFUSED, exercised end-to-end through the
// real automation + security + data stack (#1888 → #3760, ADR-0049/ADR-0073).
//
// @proof: flow-runas-schedule
// Sibling of flow-runas.dogfood.test.ts. That gate proves runAs switches identity
// for a USER-triggered run; this one pins the boundary case: a run with NO
// trigger user under an effective `runAs:'user'` (the default) resolves no
// identity, so its CRUD nodes would present no ObjectQL context → the security
// middleware SKIPS (it delegates auth to the auth layer) → the run would execute
// UNSCOPED (effectively elevated), not restricted.
//
// Until #3760 that is exactly what happened, and THIS FILE PINNED IT — asserting
// that a user-less run read and wrote an admin-owned record a member cannot
// touch. Its own note said a fail-closed change must turn these assertions RED
// and "force the product decision to be revisited deliberately". That is what
// #3760 did: `runAs:'user'` is an access-NARROWING declaration, so failing to
// resolve it must never resolve to a grant, and the operation is refused.
//
// A schedule was never the boundary — it is simply the most obvious user-less
// trigger. The commonest is a record-change flow fired by a write that carried
// no user (`isSystem` does not suppress trigger dispatch). The assertions below
// hold for every one of them; the schedule-shaped context is just the cheapest
// to drive here.
//
// We reuse the owner-isolated runas_note fixture and drive the flows directly
// through the automation service with a USER-LESS context — exactly the shape the
// schedule trigger builds ({ event:'schedule', params }, no userId) — proving:
//   • runAs:'user'  (user-less) → REFUSED: the run fails and the admin's note is
//     neither read nor written, with the engine's [runAs] warning emitted at run
//     setup so the refusal is diagnosable;
//   • runAs:'system'(user-less) → the explicit, attributable elevation, still
//     working, with NO warning — the declaration authors should make.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { runasFixtureStack, runasFixtureSecurity } from './fixtures/flow-runas-fixture.js';

/** An AutomationContext shaped exactly like the schedule trigger's: an event +
 *  params carrying the flow input, but NO userId (a cron fire has no user). */
function scheduleContext(noteId: string): Record<string, unknown> {
  return { event: 'schedule', params: { jobId: 'flow-schedule:runas', noteId } };
}

/**
 * Capture the platform logger's output. In Node the core logger writes via
 * `process.stdout/stderr.write` (NOT console.*), so we intercept the streams and
 * count lines carrying the engine's `[runAs]` tag. Restore with `.restore()`.
 */
function captureRunAsWarnings() {
  const lines: string[] = [];
  const sink = (chunk: unknown): boolean => {
    lines.push(String(chunk));
    return true;
  };
  const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation(sink as never);
  const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(sink as never);
  return {
    count: () => lines.filter((l) => l.includes('[runAs]')).length,
    restore: () => {
      outSpy.mockRestore();
      errSpy.mockRestore();
    },
  };
}

describe('objectstack verify FLOW: user-less runAs is refused (#flow-runas-schedule)', () => {
  let stack: VerifyStack;
  let adminToken: string;
  let memberToken: string;
  // The automation engine, registered under the 'automation' service.
  let automation: { execute(flow: string, ctx?: unknown): Promise<{ success?: boolean; output?: any }> };

  beforeAll(async () => {
    stack = await bootStack(runasFixtureStack, { automation: true, security: runasFixtureSecurity() });
    adminToken = await stack.signIn();
    // First user is the seeded dev admin → this fresh sign-up is a plain member
    // who falls back to the owner-scoped fixture permission set.
    memberToken = await stack.signUp('sched-member@runas.test');
    automation = stack.kernel.getService('automation') as typeof automation;
    expect(automation?.execute, 'automation service (engine.execute) must be wired').toBeTruthy();
  }, 60_000);

  afterAll(async () => {
    await stack?.stop();
  });

  async function adminCreateNote(name: string): Promise<string> {
    const res = await stack.apiAs(adminToken, 'POST', '/data/runas_note', { name, status: 'new' });
    expect(res.status, `admin create ${name} failed: ${res.status}`).toBeLessThan(300);
    const j = (await res.json()) as { id?: string; record?: { id?: string } };
    const id = j.id ?? j.record?.id;
    expect(id, 'no id returned from create').toBeTruthy();
    return id as string;
  }

  async function adminStatusOf(id: string): Promise<unknown> {
    const res = await stack.apiAs(adminToken, 'GET', `/data/runas_note/${id}`);
    expect(res.status).toBe(200);
    const j = (await res.json()) as { record?: Record<string, unknown> } & Record<string, unknown>;
    return (j.record ?? j).status;
  }

  it('precondition: the member is genuinely RLS-denied on the admin note (isolation is real)', async () => {
    const id = await adminCreateNote('sched-iso');
    expect(await adminStatusOf(id)).toBe('new');
    const res = await stack.apiAs(memberToken, 'GET', `/data/runas_note/${id}`);
    if (res.status === 200) {
      const j = (await res.json()) as { record?: Record<string, unknown> } & Record<string, unknown>;
      const rec = (j.record ?? j) as Record<string, unknown>;
      expect(rec.id ?? rec.name, 'member could READ the admin note — RLS isolation is not in effect').toBeFalsy();
    } else {
      expect(res.status).toBe(404);
    }
  });

  it("FAIL-CLOSED (pinned): a user-less runAs:'user' run is REFUSED — never reads or writes the admin note", async () => {
    const id = await adminCreateNote('sched-user');
    const warns = captureRunAsWarnings();
    try {
      // READ: user mode + no user → refused. Before #3760 this returned the
      // admin's note, which a member cannot read.
      const read = await automation.execute('runas_user_read', scheduleContext(id));
      expect(
        read.success,
        'a user-less user-mode run READ successfully — the #3760 fail-open is back (ADR-0049/#1888)',
      ).toBe(false);
      const found = read.output?.found;
      expect(
        found && typeof found === 'object' ? (found as any).id : found,
        'a user-less user-mode run read a record unscoped',
      ).toBeFalsy();

      // WRITE: user mode + no user → refused, and — the assertion that actually
      // matters — the admin's record is UNCHANGED. Before #3760 it read
      // 'touched-user' here.
      const write = await automation.execute('runas_user_touch', scheduleContext(id));
      expect(write.success, 'a user-less user-mode run WROTE successfully — the fail-open is back').toBe(false);
      expect(
        await adminStatusOf(id),
        "a user-less run stamped the admin's note — it wrote unscoped",
      ).toBe('new');

      // ...and the refusal is DIAGNOSABLE — the engine warned at run setup,
      // before any node executed (≥1 across the two runs).
      expect(
        warns.count(),
        'expected the engine to warn that a user-less user-mode run will be refused',
      ).toBeGreaterThanOrEqual(1);
    } finally {
      warns.restore();
    }
  });

  it("EXPLICIT FIX: a user-less runAs:'system' run elevates explicitly — same access, NO warning", async () => {
    const id = await adminCreateNote('sched-system');
    const warns = captureRunAsWarnings();
    try {
      const read = await automation.execute('runas_system_read', scheduleContext(id));
      expect(read.success, `system read not successful: ${JSON.stringify(read)}`).toBe(true);
      expect(read.output?.found, 'system run could not read the record it should see').toBeTruthy();

      // system names an explicit principal → the run is intentional, not a fail-open.
      expect(warns.count(), 'runAs:system must NOT emit the unscoped warning').toBe(0);
    } finally {
      warns.restore();
    }
  });
});
