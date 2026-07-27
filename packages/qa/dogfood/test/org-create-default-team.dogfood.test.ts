// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #3624 — `POST /auth/organization/create` must not 500 when teams are enabled.
 *
 * better-auth's organization plugin is on by default (`organization: true` in
 * the auth manager) and so is its team sub-feature, which means EVERY org
 * create also inserts a default team. better-auth 1.7.0-rc.1 gave that team
 * model a `memberCount` column; `sys_team` provisioned no such column and
 * `AUTH_TEAM_SCHEMA` carried no mapping for it, so the insert died with
 * `table sys_team has no column named memberCount`.
 *
 * The org row commits BEFORE the team insert runs, so the failure mode was
 * uniquely nasty: HTTP 500 on top of a half-created organization — an org row
 * with no default team, and a client that was told the whole thing failed.
 *
 * This is the end-to-end half of the fix. The static half — every column
 * better-auth can write must exist on the platform object — is gated by
 * `better-auth-schema-parity.test.ts` in plugin-auth, which is what turns the
 * NEXT better-auth bump into a red build instead of another production 500.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';

describe('#3624: org create provisions its default team', () => {
  let stack: VerifyStack;
  let token: string;
  let priorMultiOrg: string | undefined;

  beforeAll(async () => {
    stack = await bootStack(showcaseStack, {});
    token = await stack.signIn();
    // `beforeCreateOrganization` denies the route outright unless multi-org is
    // on, so a single-tenant boot 403s before better-auth ever reaches the team
    // insert. The guard calls `resolveMultiOrgEnabled()` live per request, so
    // flipping the flag AFTER boot opens the route while leaving the stack
    // itself single-tenant — no OrgScopingPlugin, no enterprise
    // `@objectstack/organizations` dependency (which this workspace does not
    // ship, and which is why the multi-org RLS dogfood test skips here).
    // The regression is in the team INSERT, which is identical either way.
    priorMultiOrg = process.env.OS_MULTI_ORG_ENABLED;
    process.env.OS_MULTI_ORG_ENABLED = 'true';
  }, 120_000);

  afterAll(async () => {
    if (priorMultiOrg === undefined) delete process.env.OS_MULTI_ORG_ENABLED;
    else process.env.OS_MULTI_ORG_ENABLED = priorMultiOrg;
    await stack?.stop?.();
  });

  it('creates the org AND its default team without a 500', async () => {
    const res = await stack.apiAs(token, 'POST', '/auth/organization/create', {
      name: 'Regression Org 3624',
      slug: 'regression-org-3624',
    });

    expect(
      res.status,
      `organization/create returned ${res.status}: ${await res.clone().text()}`,
    ).toBe(200);

    const org = (await res.json()) as { id?: string };
    expect(org.id).toBeTruthy();

    // The default team is the row that used to blow up. Reading it back proves
    // the insert committed, not merely that the endpoint swallowed an error.
    const teams = await stack.apiAs(token, 'GET', '/data/sys_team');
    expect(teams.status).toBe(200);
    const body = (await teams.json()) as { records?: Array<Record<string, unknown>> };
    const team = (body.records ?? []).find((t) => t.organization_id === org.id);

    expect(team, 'no sys_team row for the freshly created org — the default-team insert was lost').toBeDefined();
    // better-auth inserts the team with `memberCount: 0`, then seats the
    // creator through `addTeamMemberWithLimit`, which guard-increments the
    // counter via the adapter's `incrementOne`. A number here therefore proves
    // BOTH writes landed on a real column — an unprovisioned one would surface
    // as undefined (or, before the fix, as a 500 on the insert). The exact
    // seat count is better-auth's business; only the round-trip is ours.
    expect(typeof team?.member_count, `member_count did not round-trip: ${JSON.stringify(team)}`).toBe('number');
    expect(team?.member_count as number).toBeGreaterThanOrEqual(1);

    // Seating the creator writes the second column the same bump added:
    // `teamMember.membershipKey`, better-auth's derived (teamId, userId) digest.
    const members = await stack.apiAs(token, 'GET', '/data/sys_team_member');
    expect(members.status).toBe(200);
    const memberBody = (await members.json()) as { records?: Array<Record<string, unknown>> };
    const membership = (memberBody.records ?? []).find((m) => m.team_id === team?.id);

    expect(membership, 'no sys_team_member row — the creator was never seated into the default team').toBeDefined();
    expect(
      typeof membership?.membership_key,
      `membership_key did not round-trip: ${JSON.stringify(membership)}`,
    ).toBe('string');
  });
});
