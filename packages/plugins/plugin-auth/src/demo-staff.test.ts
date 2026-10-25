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
  provisionDemoStaff,
  type DemoStaffEngine,
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

/**
 * The rows a `where` selects, for the doubles below: equality, `$in` and `$nin`
 * — every operator the code under test sends. A combinator or any other
 * operator throws, so a query this double does not implement fails loudly
 * instead of being answered as a different one.
 */
function selectRows<T extends Record<string, unknown>>(rows: readonly T[], where: Record<string, unknown>): T[] {
  return rows.filter((row) => {
    const clauses = Object.entries(where);
    if (clauses.some(([field]) => field.startsWith('$'))) throw new Error('test double: combinators are not implemented');
    return clauses.every(([field, cond]) => {
      if (cond === null || typeof cond !== 'object') return row[field] === cond;
      if (Object.keys(cond).some((op) => op !== '$in' && op !== '$nin')) {
        throw new Error(`test double: only $in and $nin are implemented (${field})`);
      }
      const { $in, $nin } = cond as { $in?: unknown[]; $nin?: unknown[] };
      return ($in === undefined || $in.includes(row[field])) && ($nin === undefined || !$nin.includes(row[field]));
    });
  });
}

/**
 * An engine double answering `sys_user` and `sys_account` reads from fixed rows,
 * recording each query. It holds the caller's `limit` after the filter, as the
 * engine does, so the probe's own bound is what is measured.
 */
function recordingEngine(rows: {
  users?: Array<{ id: string; email: string }>;
  accounts?: Array<{ id: string; user_id: string }>;
}): DemoStaffProbeEngine & { queries: Array<{ object: string; query: Record<string, unknown> }> } {
  const queries: Array<{ object: string; query: Record<string, unknown> }> = [];
  return {
    queries,
    async find(object, query) {
      queries.push({ object, query });
      const where = (query.where ?? {}) as Record<string, unknown>;
      const table: Array<Record<string, unknown>> =
        object === 'sys_user' ? (rows.users ?? []) : object === 'sys_account' ? (rows.accounts ?? []) : [];
      const matched = selectRows(table, where);
      return typeof query.limit === 'number' ? matched.slice(0, query.limit) : matched;
    },
  };
}

/** An engine whose every read fails, as an unreachable credential store does. */
const unreachableEngine = (): DemoStaffProbeEngine => ({
  async find() {
    throw new Error('connection refused');
  },
});

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
    const verdict = await probeDemoStaffPriorLogin(unreachableEngine(), STAFF);
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

describe('provisioning — a failure after sign-up says the account exists', () => {
  it('lists an account it created but could not assign under both, and the failure says it was created', async () => {
    const users: Array<Record<string, unknown>> = [];
    const engine: DemoStaffEngine = {
      async find(object, query) {
        const matched = object === 'sys_user' ? selectRows(users, (query.where ?? {}) as Record<string, unknown>) : [];
        return typeof query.limit === 'number' ? matched.slice(0, query.limit) : matched;
      },
      async update() {
        return undefined;
      },
      async insert() {
        throw new Error('no assignment may be written without an organization');
      },
    };

    const outcome = await provisionDemoStaff(
      [{ name: 'Legal Counsel 1', email: 'Counsel1@legal.example', position: 'legal_counsel' }],
      {
        engine,
        password: 'admin123',
        signUp: async ({ email }) => {
          users.push({ id: 'u_c1', email });
        },
        defaultOrganizationId: async () => null,
      },
    );

    expect(outcome.created).toEqual(['counsel1@legal.example']);
    expect(outcome.failed).toEqual([
      {
        email: 'counsel1@legal.example',
        message: 'its account was created, but there is no Default Organization to assign its position and permission sets in, so none was written',
      },
    ]);
    expect(outcome.assignmentsAdded).toBe(0);
  });
});
