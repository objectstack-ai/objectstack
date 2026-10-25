// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #25777 — the two gates in front of the stack's `demoStaff`, each refusal
 * asserted by its ADR-0112 `code` and `status` and its `reason`, never by a
 * bare "did not act".
 *
 * Question 1 (`decideDemoStaffEnvironmentGate`) is pure, so every clause is
 * driven on its own against an otherwise-admitting environment: a refusal
 * that came from a different clause would carry a different `reason` and
 * redden. Question 2 (`probeDemoStaffPriorLogin`) is driven over a recording
 * engine double, so the case can also read WHICH query the probe asked.
 *
 * The provisioning itself, and the boot that wires both gates in front of it,
 * run over a real kernel in `demo-staff-provisioning.test.ts`.
 */

import { describe, expect, it } from 'vitest';

import {
  decideDemoStaffEnvironmentGate,
  probeDemoStaffPriorLogin,
  type DemoStaffEnvironment,
  type DemoStaffProbeEngine,
} from './demo-staff.js';

/** The one environment every clause admits — each case moves exactly one fact. */
const LOCAL_DEV: DemoStaffEnvironment = {
  nodeEnv: 'development',
  migrateAndExit: false,
  wallEnforced: false,
  baseUrl: 'http://localhost:3000',
  baseUrlIsLoopback: true,
};

describe('question 1 — only a local development boot creates demo accounts', () => {
  it('admits the local development boot (the control every refusal below departs from)', () => {
    expect(decideDemoStaffEnvironmentGate(LOCAL_DEV)).toEqual({ act: true });
  });

  it.each([
    ['production', 'production'],
    ['test', 'test'],
    ['unset', undefined],
  ])('refuses NODE_ENV=%s — PERMISSION_DENIED 403, not-development', (_label, nodeEnv) => {
    const verdict = decideDemoStaffEnvironmentGate({ ...LOCAL_DEV, nodeEnv });
    expect(verdict.act).toBe(false);
    if (verdict.act) return;
    expect(verdict.refusal).toMatchObject({ code: 'PERMISSION_DENIED', status: 403, reason: 'not-development' });
    expect(verdict.refusal.message).toContain('`os build` leaves `demoStaff` out of the artifact');
  });

  it('refuses a migrate-and-exit run whatever NODE_ENV says — PERMISSION_DENIED 403', () => {
    const verdict = decideDemoStaffEnvironmentGate({ ...LOCAL_DEV, migrateAndExit: true });
    expect(verdict.act).toBe(false);
    if (verdict.act) return;
    expect(verdict.refusal).toMatchObject({ code: 'PERMISSION_DENIED', status: 403, reason: 'migrate-and-exit' });
  });

  it('refuses an organization-walled posture — PERMISSION_DENIED 403', () => {
    const verdict = decideDemoStaffEnvironmentGate({ ...LOCAL_DEV, wallEnforced: true });
    expect(verdict.act).toBe(false);
    if (verdict.act) return;
    expect(verdict.refusal).toMatchObject({ code: 'PERMISSION_DENIED', status: 403, reason: 'walled-posture' });
  });

  it('refuses a development server published at a reachable address — PERMISSION_DENIED 403', () => {
    const verdict = decideDemoStaffEnvironmentGate({
      ...LOCAL_DEV,
      baseUrl: 'https://legal-demo.example.com',
      baseUrlIsLoopback: false,
    });
    expect(verdict.act).toBe(false);
    if (verdict.act) return;
    expect(verdict.refusal).toMatchObject({ code: 'PERMISSION_DENIED', status: 403, reason: 'non-loopback-base-url' });
    expect(verdict.refusal.message).toContain('https://legal-demo.example.com');
  });

  it('fails closed on an absent base URL even when the caller calls it loopback', () => {
    const verdict = decideDemoStaffEnvironmentGate({ ...LOCAL_DEV, baseUrl: undefined, baseUrlIsLoopback: true });
    expect(verdict.act).toBe(false);
    if (verdict.act) return;
    expect(verdict.refusal).toMatchObject({ code: 'PERMISSION_DENIED', status: 403, reason: 'non-loopback-base-url' });
  });
});

/** An engine double answering `sys_user` and `sys_account` reads from fixed rows, recording each query. */
function recordingEngine(rows: {
  users?: Array<{ id: string; email: string }>;
  accounts?: Array<{ id: string; user_id: string }>;
  fail?: boolean;
}): DemoStaffProbeEngine & { queries: Array<{ object: string; query: Record<string, unknown> }> } {
  const queries: Array<{ object: string; query: Record<string, unknown> }> = [];
  return {
    queries,
    async find(object, query) {
      queries.push({ object, query });
      if (rows.fail) throw new Error('connection refused');
      const where = (query.where ?? {}) as Record<string, { $in?: unknown[]; $nin?: unknown[] }>;
      if (object === 'sys_user') {
        const wanted = where.email?.$in ?? [];
        return (rows.users ?? []).filter((u) => wanted.includes(u.email));
      }
      if (object === 'sys_account') {
        const excluded = where.user_id?.$nin ?? [];
        return (rows.accounts ?? []).filter((a) => !excluded.includes(a.user_id)).slice(0, 1);
      }
      return [];
    },
  };
}

describe('question 2 — a demo account is never the first account that can sign in', () => {
  const STAFF = ['Counsel1@legal.example', 'counsel2@legal.example'];

  it('admits once an account that is not a demo account can sign in', async () => {
    const engine = recordingEngine({
      users: [{ id: 'u_admin', email: 'admin@objectos.ai' }],
      accounts: [{ id: 'a_admin', user_id: 'u_admin' }],
    });
    expect(await probeDemoStaffPriorLogin(engine, STAFF)).toEqual({ act: true });
  });

  it('refuses an empty credential store — PRECONDITION_REQUIRED 428, no-prior-login', async () => {
    const verdict = await probeDemoStaffPriorLogin(recordingEngine({}), STAFF);
    expect(verdict.act).toBe(false);
    if (verdict.act) return;
    expect(verdict.refusal).toMatchObject({ code: 'PRECONDITION_REQUIRED', status: 428, reason: 'no-prior-login' });
  });

  it('does not count a demo account`s own login — a store holding only demo logins still refuses', async () => {
    // A previous boot's demo account, with the developer's admin since deleted:
    // the next account to sign in would be promoted, and it must not be one of these.
    const engine = recordingEngine({
      users: [{ id: 'u_c1', email: 'counsel1@legal.example' }],
      accounts: [{ id: 'a_c1', user_id: 'u_c1' }],
    });
    const verdict = await probeDemoStaffPriorLogin(engine, STAFF);
    expect(verdict.act).toBe(false);
    if (verdict.act) return;
    expect(verdict.refusal).toMatchObject({ code: 'PRECONDITION_REQUIRED', status: 428, reason: 'no-prior-login' });
    // Both spellings of the declared address were asked for, as sign-up stores it lower-cased.
    expect(engine.queries[0]).toMatchObject({
      object: 'sys_user',
      query: { where: { email: { $in: expect.arrayContaining(['Counsel1@legal.example', 'counsel1@legal.example']) } } },
    });
    expect(engine.queries[1]).toMatchObject({ object: 'sys_account', query: { where: { user_id: { $nin: ['u_c1'] } } } });
  });

  it('refuses a probe that throws — SERVICE_UNAVAILABLE 503, never read as "someone can sign in"', async () => {
    const verdict = await probeDemoStaffPriorLogin(recordingEngine({ fail: true }), STAFF);
    expect(verdict.act).toBe(false);
    if (verdict.act) return;
    expect(verdict.refusal).toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503, reason: 'unanswerable' });
    expect(verdict.refusal.message).toContain('connection refused');
  });

  it('refuses when there is no data engine at all — SERVICE_UNAVAILABLE 503', async () => {
    const verdict = await probeDemoStaffPriorLogin(undefined, STAFF);
    expect(verdict.act).toBe(false);
    if (verdict.act) return;
    expect(verdict.refusal).toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503, reason: 'unanswerable' });
  });
});
