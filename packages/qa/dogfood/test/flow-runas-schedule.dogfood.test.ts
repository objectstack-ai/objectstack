// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// FLOW runAs — the SCHEDULE (user-less) fail-open, exercised end-to-end through
// the real automation + security + data stack (#1888 follow-up, ADR-0049).
//
// @proof: flow-runas-schedule
// Sibling of flow-runas.dogfood.test.ts. That gate proves runAs switches identity
// for a USER-triggered run; this one pins the boundary case #1888 deliberately
// left open: a SCHEDULE-triggered run has NO trigger user, so an effective
// `runAs:'user'` (the default) resolves no identity → CRUD nodes pass no ObjectQL
// context → the security middleware SKIPS (it delegates auth to the auth layer)
// → the run executes UNSCOPED (effectively elevated), not restricted.
//
// We reuse the owner-isolated runas_note fixture and drive the flows directly
// through the automation service with a USER-LESS context — exactly the shape the
// schedule trigger builds ({ event:'schedule', params }, no userId) — proving:
//   • runAs:'user'  (user-less) → UNSCOPED: reads + writes the admin's note a
//     member cannot touch, and the engine emits the [runAs] warning (the
//     fail-open is now AUDIBLE, not silent);
//   • runAs:'system'(user-less) → the explicit, attributable elevation (same
//     access) with NO warning — the fix authors should declare.
//
// This is the live, revert-provable form of "passes static checks / silently
// elevated at runtime": if a future change makes the user-less case fail-closed
// (deny) or auto-elevate, the behavioral assertions here go RED and force the
// product decision to be revisited deliberately.

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

describe('objectstack verify FLOW: schedule/user-less runAs fail-open (#flow-runas-schedule)', () => {
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

  it("FAIL-OPEN (pinned): a user-less runAs:'user' run executes UNSCOPED — reads + writes the admin note, audibly", async () => {
    const id = await adminCreateNote('sched-user');
    const warns = captureRunAsWarnings();
    try {
      // READ: user mode + no user → unscoped → finds the admin's note (a member can't).
      const read = await automation.execute('runas_user_read', scheduleContext(id));
      expect(read.success, `read run not successful: ${JSON.stringify(read)}`).toBe(true);
      const found = read.output?.found;
      expect(
        found && typeof found === 'object' ? (found as any).id : found,
        'a user-less user-mode run did NOT read unscoped — the fail-open behavior changed; revisit the product decision (ADR-0049/#1888)',
      ).toBeTruthy();

      // WRITE: user mode + no user → unscoped → stamps the admin's note.
      const write = await automation.execute('runas_user_touch', scheduleContext(id));
      expect(write.success, `write run not successful: ${JSON.stringify(write)}`).toBe(true);
      expect(await adminStatusOf(id)).toBe('touched-user');

      // ...and the fail-open is AUDIBLE — the engine warned (≥1 across the two runs).
      expect(
        warns.count(),
        'expected the engine to warn that a user-less user-mode run executes unscoped',
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
