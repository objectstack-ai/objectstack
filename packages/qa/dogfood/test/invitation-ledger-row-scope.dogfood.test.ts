// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8095] `sys_invitation` is row-scoped to its addressee — proven over the real
 * data API, with the card's own probe.
 *
 * The defect, measured live by the filer and reproduced here: `sys_invitation`
 * is in `BETTER_AUTH_MANAGED_OBJECTS`, so `denyWritesOnManagedObjects()` grants
 * `allowRead: true` on it to `member_default` / `viewer_readonly`, and NEITHER
 * set declared a row-level policy for the object. An object with no applicable
 * policy compiles to a NULL Layer 1 — no row filter at all — so a plain `member`
 * read the organization's entire invitation ledger: every invitee's email
 * address, the role each was about to be granted, who invited them, and when it
 * expires. Byte-identical to what the org owner sees. `sys_member` is a staff
 * directory and reads that way on purpose; a pending invitation is
 * administrative INTENT about people who are not members and never consented to
 * a directory listing, and "who is about to become an admin" is the wrong thing
 * to broadcast to everyone who can log in.
 *
 * Maintainer ruling (2026-08-12): narrow the read to owner/admin, PLUS a
 * row-scope carve-out so an invitee still sees their own invitation. This file
 * pins BOTH halves, because each one alone is satisfied by a broken fix:
 *
 *   1. NARROWING — a plain member reads none of the ledger;
 *   2. CARVE-OUT — the addressee still reads THEIR OWN row. Narrowing without
 *      this breaks acceptance (`sys_invitation`'s `accept_invitation` /
 *      `reject_invitation` row actions are gated on
 *      `record.email == ctx.user.email`, so an invitee who cannot read the row
 *      cannot act on it) — and that breakage sails past assertion 1 looking
 *      exactly like "permissions fixed";
 *   3. and the OWNER still reads the full ledger, because a change that broke
 *      the object for everyone would pass 1 and 2 together.
 *
 * Why over HTTP and not against the permission-set constant: an assertion whose
 * expectation and reality both come from `default-permission-sets.ts` cannot
 * fail. The narrowing is only real if it survives the whole resolved chain —
 * permission-set resolution, the `everyone` anchor, `auto-org-admin-grant`, the
 * Layer 0 / Layer 1 composition and the REST layer. So every assertion below
 * reads a real `GET /api/v1/data/sys_invitation` response body.
 *
 * Harness note: `bootStack` disables the default-org bootstrap, so this file
 * mints the organization itself and sets membership roles through the system
 * context — the only writer better-auth-managed tables accept (ADR-0092) and
 * exactly what the single-org bootstrap would do. The two invitation rows are
 * created through the REAL `invite-member` endpoint, so they carry whatever
 * better-auth actually writes rather than a hand-built approximation. Sessions
 * are stamped with the active organization the way a real org switch does
 * (`session.active_organization_id` is the one field `resolveAuthzContext`
 * reads into `tenantId`), because the card's probe was taken "with the active
 * organization set".
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';

const SYSTEM_CTX = { isSystem: true };

/** The org owner — deliberately NOT the seeded platform admin. */
const OWNER_EMAIL = 'owner.8095@acme-test.example';
/** A plain member with no invitation addressed to them (the card's attacker). */
const MEMBER_EMAIL = 'member.8095@acme-test.example';
/** A member who DOES have an invitation addressed to them (the card's `lisi@`). */
const INVITEE_EMAIL = 'invitee.8095@acme-test.example';
/** Invited as `admin`, never signed up (the card's `wangwu@` — the row that leaked). */
const OUTSIDER_EMAIL = 'outsider.8095@acme-test.example';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function findRows(ql: any, object: string, where: any, limit = 50): Promise<any[]> {
  const rows = await ql.find(object, { where, limit }, { context: SYSTEM_CTX });
  return Array.isArray(rows) ? rows : (rows?.records ?? []);
}

/** The membership row the sign-up reconciler writes lands asynchronously. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function waitForMembership(ql: any, userId: string): Promise<any> {
  for (let i = 0; i < 40; i++) {
    const rows = await findRows(ql, 'sys_member', { user_id: userId }, 5);
    if (rows.length > 0) return rows[0];
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no sys_member row appeared for ${userId}`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function userIdOf(ql: any, email: string): Promise<string> {
  const [user] = await findRows(ql, 'sys_user', { email }, 1);
  if (!user) throw new Error(`no sys_user row for ${email}`);
  return String(user.id);
}

/**
 * Stamp the active organization onto every session the user holds — the one
 * wire field a real org switch sets, and what `resolveAuthzContext` reads into
 * `ExecutionContext.tenantId`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function setActiveOrg(ql: any, userId: string, orgId: string): Promise<void> {
  for (const s of await findRows(ql, 'sys_session', { user_id: userId }, 20)) {
    await ql.update(
      'sys_session',
      { id: s.id, active_organization_id: orgId },
      { context: SYSTEM_CTX },
    );
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowsOf(body: any): any[] {
  return Array.isArray(body) ? body : (body?.records ?? []);
}

/** Read `/data/sys_invitation` as a persona and return `{ status, rows, raw }`. */
async function readLedger(stack: VerifyStack, token: string) {
  const res = await stack.apiAs(token, 'GET', '/data/sys_invitation');
  const raw = await res.text();
  let body: unknown = null;
  try {
    body = JSON.parse(raw);
  } catch {
    /* non-JSON body — `raw` is still asserted on */
  }
  return { status: res.status, rows: rowsOf(body), raw };
}

describe('#8095: a member cannot read the org invitation ledger — only their own row', () => {
  let stack: VerifyStack;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ql: any;
  let orgId: string;
  let ownerToken: string;
  let memberToken: string;
  let inviteeToken: string;

  beforeAll(async () => {
    stack = await bootStack(showcaseStack, {});
    const adminToken = await stack.signIn(); // the seeded dev admin (platform admin)
    ql = await stack.kernel.getServiceAsync<unknown>('objectql');

    const org = await ql.insert(
      'sys_organization',
      { name: 'Acme Test Org', slug: 'acme-8095' },
      { context: SYSTEM_CTX },
    );
    orgId = String(org.id);

    // The seeded dev admin predates the org row; give it the owner membership
    // the single-org bootstrap would have, so `invite-member` has an authorized
    // caller for the fixture rows.
    const adminUserId = await userIdOf(ql, 'admin@objectos.ai');
    const adminMembers = await findRows(ql, 'sys_member', { user_id: adminUserId }, 5);
    if (adminMembers.length > 0) {
      await ql.update(
        'sys_member',
        { id: adminMembers[0].id, organization_id: orgId, role: 'owner' },
        { context: SYSTEM_CTX },
      );
    } else {
      await ql.insert(
        'sys_member',
        { user_id: adminUserId, organization_id: orgId, role: 'owner' },
        { context: SYSTEM_CTX },
      );
    }
    await setActiveOrg(ql, adminUserId, orgId);

    // ── The three personas ────────────────────────────────────────────────
    // The org owner. A SEPARATE principal from the seeded platform admin on
    // purpose: `admin_full_access` would satisfy the owner assertion through
    // the platform-admin path and prove nothing about an ORG owner, which is
    // the persona the card compared against.
    ownerToken = await stack.signUp(OWNER_EMAIL, 'Owner!Pass123', 'Owner 8095');
    const ownerUserId = await userIdOf(ql, OWNER_EMAIL);
    const ownerMember = await waitForMembership(ql, ownerUserId);
    await ql.update('sys_member', { id: ownerMember.id, role: 'owner' }, { context: SYSTEM_CTX });

    // The two invitations, written by the real better-auth endpoint.
    for (const [email, role] of [
      [INVITEE_EMAIL, 'member'],
      [OUTSIDER_EMAIL, 'admin'],
    ] as const) {
      const res = await stack.apiAs(adminToken, 'POST', '/auth/organization/invite-member', {
        email,
        role,
        organizationId: orgId,
      });
      expect(res.status, `invite ${email} as ${role}: ${await res.clone().text()}`).toBe(200);
    }

    // The addressee of one of them, who then joins as an ordinary member.
    inviteeToken = await stack.signUp(INVITEE_EMAIL, 'Invitee!Pass123', 'Invitee 8095');
    const inviteeUserId = await userIdOf(ql, INVITEE_EMAIL);
    await waitForMembership(ql, inviteeUserId);

    // The plain member — no invitation carries their address.
    memberToken = await stack.signUp(MEMBER_EMAIL, 'Member!Pass123', 'Member 8095');
    const memberUserId = await userIdOf(ql, MEMBER_EMAIL);
    await waitForMembership(ql, memberUserId);

    for (const uid of [ownerUserId, inviteeUserId, memberUserId]) {
      await setActiveOrg(ql, uid, orgId);
    }

    // Fixture sanity: both rows really exist in the ledger. Without this, every
    // "member sees nothing" assertion below would pass on an EMPTY table.
    const ledger = await findRows(ql, 'sys_invitation', { organization_id: orgId }, 50);
    expect(ledger.map((r) => r.email).sort()).toEqual([INVITEE_EMAIL, OUTSIDER_EMAIL].sort());
  }, 240_000);

  afterAll(async () => {
    await stack?.stop?.();
  });

  it('the org OWNER still reads the full ledger — both rows, with role and inviter', async () => {
    // Asserted FIRST and deliberately: it is the control that keeps the two
    // narrowing assertions honest. A change that simply broke `sys_invitation`
    // for everyone satisfies "a member sees nothing" perfectly.
    const { status, rows } = await readLedger(stack, ownerToken);
    expect(status).toBe(200);
    expect(rows.map((r) => r.email).sort()).toEqual([INVITEE_EMAIL, OUTSIDER_EMAIL].sort());

    const outsider = rows.find((r) => r.email === OUTSIDER_EMAIL);
    // The administrative fields the card names — an owner is entitled to them.
    expect(outsider.role).toBe('admin');
    expect(outsider.inviter_id).toBeTruthy();
  }, 60_000);

  it('a plain MEMBER reads NONE of it — the exposure the card measured is gone', async () => {
    const { status, rows, raw } = await readLedger(stack, memberToken);

    // 200, not 403: this is a ROW narrowing. A 403 here would mean the object
    // was closed outright, which also closes the invitee's own row — the
    // failure mode assertion 3 exists to catch.
    expect(status).toBe(200);
    expect(rows).toHaveLength(0);

    // The card's exact finding, asserted on the wire rather than on a row
    // count: the pending admin invitation's address must not appear ANYWHERE in
    // the response — not in a record, not in a facet, not in an echoed filter.
    expect(raw).not.toContain(OUTSIDER_EMAIL);
    expect(raw).not.toContain(INVITEE_EMAIL);
  }, 60_000);

  it('the INVITEE still reads their own row — and only their own', async () => {
    // The accept flow's requirement. If this goes red the narrowing has broken
    // acceptance, which is the one way to "fix" #8095 and ship a worse bug.
    const { status, rows, raw } = await readLedger(stack, inviteeToken);

    expect(status).toBe(200);
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe(INVITEE_EMAIL);
    // Their own row is whole — the row action they need to act on it is gated
    // on fields that must actually be present.
    expect(rows[0].status).toBeTruthy();
    // …and the carve-out is a row scope, not a blanket re-open.
    expect(raw).not.toContain(OUTSIDER_EMAIL);
  }, 60_000);

  it("the narrowing holds against a by-id fetch of another person's invitation", async () => {
    // A row filter that only engages on the list path is not a row filter. The
    // by-id route composes the same Layer 1 predicate; if it did not, the list
    // assertion above would be a facade an attacker walks around with one id —
    // and ids are handed out by the invitation email link.
    const [outsiderRow] = await findRows(ql, 'sys_invitation', { email: OUTSIDER_EMAIL }, 1);
    expect(outsiderRow?.id, 'fixture: the outsider row exists to be fetched').toBeTruthy();

    const res = await stack.apiAs(memberToken, 'GET', `/data/sys_invitation/${outsiderRow.id}`);
    expect([403, 404]).toContain(res.status);
    expect(await res.text()).not.toContain(OUTSIDER_EMAIL);
  }, 60_000);
});
