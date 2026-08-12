// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8144, sub-issue A of #7675] A real sign-in leaves a `login` row that names
 * its actor and its tenant — measured end to end, exactly as #7675 measured its
 * absence.
 *
 * ## The reproduction, inverted
 *
 * #7675, twice: fresh boot → sign up + sign in a member → as admin
 * `GET /api/v1/data/sys_audit_log?$filter={"action":"login"}` → **total 0**;
 * the only trace was an unattributed `update sys_user` row (`user_id` null)
 * diffing `last_login_at`. This file runs that same script and asserts the
 * opposite, through the same route.
 *
 * ## Why every assertion reads the row back
 *
 * Every `sys_audit_log` field is `readonly`, and `validateRecord` skips
 * readonly/system fields on both branches (#8203), so the `action` enum
 * declares a vocabulary **nothing validates in either direction** — a row
 * carrying an action the enum never heard of is accepted silently, and a writer
 * that never ran throws nothing either. On this object "no error was raised" is
 * not evidence of anything. So the claims here are made against rows read back
 * through the platform's own read paths: the data API for the acceptance
 * criterion (which also proves an admin can actually SEE the rows through RLS —
 * a row written into a tenant nobody can read would satisfy a `ql.find` under a
 * system context and still leave the `auth_events` view empty), and the engine
 * for the field-level detail.
 *
 * Harness notes:
 *  - `bootStack` installs no audit plugin; `AuditPlugin` is added here, which is
 *    both what registers the `audit` service the auth hooks call and what turns
 *    ordinary writes into ledger rows.
 *  - `orgContext: true` binds the harness admin to an organization, so their
 *    session carries an `activeOrganizationId` — without it the "and tenant"
 *    half of the acceptance criterion could not be measured at all.
 *  - Audit rows land ASYNCHRONOUSLY: better-auth settles `session.create.after`
 *    /`session.delete.after` through `queueAfterTransactionHook`, after the
 *    response. Every read polls.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { AuditPlugin } from '@objectstack/plugin-audit';

const SYSTEM_CTX = { isSystem: true };
const MEMBER_EMAIL = 'member.8144@example.com';
const MEMBER_PASSWORD = 'Member!Pass8144';

async function findRows(ql: any, object: string, where: any, limit = 200): Promise<any[]> {
  const rows = await ql.find(object, { where, limit }, { context: SYSTEM_CTX });
  return Array.isArray(rows) ? rows : (rows?.records ?? []);
}

/** Rows out of a data-API list response, whichever envelope it uses. */
async function rowsOf(res: Response): Promise<any[]> {
  const body = (await res.json()) as any;
  return body?.records ?? body?.data ?? (Array.isArray(body) ? body : []);
}

/** Poll until `predicate` holds, then return the rows that satisfied it. */
async function waitForRows(
  load: () => Promise<any[]>,
  predicate: (rows: any[]) => boolean,
  what: string,
): Promise<any[]> {
  let rows: any[] = [];
  for (let i = 0; i < 40; i++) {
    rows = await load();
    if (predicate(rows)) return rows;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(
    `${what} — last saw ${rows.length} row(s): ` +
      JSON.stringify(rows.map((r) => ({ action: r.action, user_id: r.user_id, tenant: r.tenant_id }))),
  );
}

describe('#8144: auth session events reach sys_audit_log', () => {
  let stack: VerifyStack;
  let ql: any;
  let adminToken: string;
  let memberToken: string;
  let memberUserId: string;
  let memberOrgId: string;

  beforeAll(async () => {
    stack = await bootStack(showcaseStack, { extraPlugins: [new AuditPlugin()], orgContext: true });
    ql = await stack.kernel.getServiceAsync<any>('objectql');
    adminToken = await stack.signIn();

    // #7675's script: a member signs up and signs in.
    await stack.signUp(MEMBER_EMAIL, MEMBER_PASSWORD, 'Member 8144');
    const [memberUser] = await findRows(ql, 'sys_user', { email: MEMBER_EMAIL }, 1);
    memberUserId = String(memberUser.id);

    // Settle the membership BEFORE the measured sign-in, and say why rather
    // than sleeping: `session.create.before` derives `activeOrganizationId`
    // from the caller's `sys_member` row, and ADR-0093's reconciler runs on
    // `user.create.after`, which better-auth defers past the signup
    // transaction. So a user's very FIRST session — the one sign-up mints —
    // legitimately predates their membership and carries no active org; its
    // ledger row therefore has no tenant, and no seam downstream can invent
    // one. That is a property of the sign-up ordering, not of this writer, and
    // it is why the tenant half is measured on an ordinary sign-in.
    const [membership] = await waitForRows(
      () => findRows(ql, 'sys_member', { user_id: memberUserId }, 5),
      (rows) => rows.length > 0,
      'ADR-0093 reconciler never bound the new member to an organization',
    );
    memberOrgId = String(membership.organization_id);
    memberToken = await stack.signIn(MEMBER_EMAIL, MEMBER_PASSWORD);
  }, 180_000);

  afterAll(async () => {
    await stack?.stop?.();
  });

  // ── The acceptance criterion, through the reported route ────────────────

  it('the issue\'s own query returns the login event, with actor and tenant', async () => {
    const query = `/data/sys_audit_log?$filter=${encodeURIComponent(JSON.stringify({ action: 'login' }))}`;
    const rows = await waitForRows(
      async () => {
        const res = await stack.apiAs(adminToken, 'GET', query);
        expect(res.status, await res.clone().text()).toBe(200);
        return rowsOf(res);
      },
      (found) => found.some((r: any) => r.user_id === memberUserId && r.tenant_id),
      'GET /data/sys_audit_log?$filter={"action":"login"} never returned the member\'s login (this was `total 0` before #8144)',
    );

    const mine = rows.filter((r: any) => r.user_id === memberUserId);
    expect(mine.length).toBeGreaterThan(0);
    for (const row of mine) {
      // WHAT happened…
      expect(row.action).toBe('login');
      // …and WHO — the half #7675 called out as missing (`user_id` null).
      expect(row.user_id).toBe(memberUserId);
    }

    // …and WHERE, so the row survives the RLS predicate a non-admin reads
    // through: a tenant-less row is invisible to every member of every org.
    // Checked against the membership the platform actually wrote, NOT against
    // anything this writer passed in — an expectation and a reality drawn from
    // the same source could not disagree.
    const tenanted = mine.filter((r: any) => r.tenant_id);
    expect(tenanted.length, 'no login row carries a tenant').toBeGreaterThan(0);
    for (const row of tenanted) expect(row.tenant_id).toBe(memberOrgId);

    // The actor is a REAL sys_user row, not a sentinel (ADR-0118 D1).
    expect(await findRows(ql, 'sys_user', { id: mine[0].user_id }, 1)).toHaveLength(1);
  }, 120_000);

  it('the shipped `auth_events` list view stops being empty', async () => {
    // The view's own filter: action in (login, logout, permission_change). It
    // shipped against rows nothing wrote, so it was permanently empty by
    // construction — that is the user-visible half of #7675.
    const query = `/data/sys_audit_log?$filter=${encodeURIComponent(
      JSON.stringify({ action: { $in: ['login', 'logout', 'permission_change'] } }),
    )}`;
    const res = await stack.apiAs(adminToken, 'GET', query);
    expect(res.status, await res.clone().text()).toBe(200);
    const rows = await rowsOf(res);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r: any) => ['login', 'logout', 'permission_change'].includes(r.action))).toBe(true);
  }, 60_000);

  // ── The other half of the ruling: logout ────────────────────────────────

  it('signing out writes a `logout` row for the same actor', async () => {
    const before = (await findRows(ql, 'sys_audit_log', { action: 'logout', user_id: memberUserId })).length;

    const res = await stack.apiAs(memberToken, 'POST', '/auth/sign-out', {});
    expect(res.status, await res.clone().text()).toBe(200);

    const rows = await waitForRows(
      () => findRows(ql, 'sys_audit_log', { action: 'logout', user_id: memberUserId }),
      (found) => found.length > before,
      'POST /auth/sign-out wrote no `logout` row',
    );
    const row = rows[rows.length - 1];
    expect(row.action).toBe('logout');
    expect(row.user_id).toBe(memberUserId);
    // Navigable back to the session that ended.
    expect(row.object_name).toBe('sys_session');
    expect(String(row.metadata)).toContain('/sign-out');
  }, 120_000);

  it('an admin revoke is NOT recorded as the member logging out', async () => {
    // A session row is deleted by revokes, bans, erasure and better-auth's own
    // collection of expired rows. Recording those as `logout` would name an
    // action the subject never took — worse for an auditor than no row, and the
    // revoke already carries its own cause on the ADR-0069 D4 tombstone.
    const freshToken = await stack.signIn(MEMBER_EMAIL, MEMBER_PASSWORD);
    await waitForRows(
      () => findRows(ql, 'sys_session', { user_id: memberUserId }),
      (rows) => rows.some((r: any) => !r.revoked_at),
      'no live session for the member after signing back in',
    );
    const logoutsBefore = (
      await findRows(ql, 'sys_audit_log', { action: 'logout', user_id: memberUserId })
    ).length;

    const res = await stack.apiAs(freshToken, 'POST', '/auth/revoke-sessions', {});
    expect(res.status, await res.clone().text()).toBe(200);

    // The revoke really happened — otherwise the assertion below is vacuous.
    await waitForRows(
      () => findRows(ql, 'sys_session', { user_id: memberUserId }),
      (rows) => rows.length > 0 && rows.every((r: any) => r.revoked_at),
      'revoke-sessions left a live session behind',
    );
    // Give any late-settling hook the same window a positive assertion gets.
    await new Promise((r) => setTimeout(r, 1_000));
    expect(
      (await findRows(ql, 'sys_audit_log', { action: 'logout', user_id: memberUserId })).length,
    ).toBe(logoutsBefore);
  }, 120_000);

  // ── The incidental defect the ruling named ──────────────────────────────

  it('the `last_login_at` system write is attributed to the user who signed in', async () => {
    // #7675: "the only trace is an **unattributed** `update sys_user` row
    // (`user_id` null) diffing `last_login_at`". The row still exists — a login
    // from a new address is worth keeping — but it now names its actor, through
    // the platform's one attribution channel (`attributedUserId`, #4586).
    await stack.signIn(MEMBER_EMAIL, MEMBER_PASSWORD);

    const rows = await waitForRows(
      () =>
        findRows(ql, 'sys_audit_log', {
          object_name: 'sys_user',
          record_id: memberUserId,
          action: 'update',
        }),
      (found) => found.some((r: any) => String(r.new_value ?? '').includes('last_login_at')),
      'no `update sys_user` row diffing last_login_at appeared',
    );

    const lastLoginRows = rows.filter((r: any) => String(r.new_value ?? '').includes('last_login_at'));
    expect(lastLoginRows.length).toBeGreaterThan(0);
    for (const row of lastLoginRows) {
      expect(row.user_id, '`last_login_at` diff row is still unattributed').toBe(memberUserId);
    }
  }, 120_000);
});
