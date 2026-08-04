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

/**
 * ── How this fixture opens the route (#5261) ─────────────────────────────────
 *
 * `beforeCreateOrganization` denies `organization/create` outright unless an
 * organization wall is in force, so a single-tenant boot 403s long before
 * better-auth reaches the team insert this file is about.
 *
 * It used to open the route by flipping `OS_MULTI_ORG_ENABLED=true` AFTER boot
 * and leaning on the gate reading env live per request. That was a BYPASS, not a
 * deployment: the stack stayed single-tenant while the gate alone was told
 * otherwise. #5261 made the gate read the tenancy service's EFFECTIVE posture
 * precisely so that no env combination can talk a wall-less deployment into
 * minting organizations, which closes that trick — deliberately.
 *
 * So the fixture now simulates the DEPLOYMENT instead of fooling the gate:
 * `multiTenant: 'posture-only'` registers the harness's stand-in for the
 * enterprise `org-scoping` runtime, and the `tenancy` service resolves a real,
 * non-degraded `isolated` posture the whole stack agrees on. That is more honest
 * than the flag flip — it is the shape a deployment with the wall up actually
 * has — but it is a stand-in, and its limits are exactly stated in
 * `BootOptions.multiTenant`: it activates the POSTURE, never the WALL. Nothing
 * here asserts isolation; the cross-tenant proofs still skip in this workspace
 * (see `enterprise-organizations.ts`) rather than pretend.
 *
 * #3624's regression is in the team INSERT, which is identical under any
 * posture that lets the route run.
 */
describe('#3624: org create provisions its default team', () => {
  let stack: VerifyStack;
  let token: string;

  beforeAll(async () => {
    stack = await bootStack(showcaseStack, { multiTenant: 'posture-only' });
    token = await stack.signIn();
  }, 120_000);

  afterAll(async () => {
    await stack?.stop?.();
  });

  it('boots a genuinely walled posture — the route is open because the deployment is, not because a flag was flipped', async () => {
    // [#5261] Guard the guard. If the stand-in ever stops activating the
    // posture, the create below would 403 and this file would report "#3624
    // regressed" — sending the next reader after a team-insert bug that isn't
    // there. Naming the precondition separately keeps that misdiagnosis off the
    // table, and pins the fact the fixture actually depends on.
    const tenancy = await stack.kernel.getServiceAsync<{
      posture: string;
      requestedPosture: string;
      isolationActive: boolean;
      degraded: boolean;
    }>('tenancy');

    expect(tenancy.requestedPosture).toBe('isolated');
    expect(tenancy.posture).toBe('isolated');
    expect(tenancy.isolationActive).toBe(true);
    // NOT degraded — that is the whole difference from the old flag flip, and
    // the state #5261 refuses to create organizations in.
    expect(tenancy.degraded).toBe(false);

    // And the capability the console renders its button from agrees, because
    // since #5261 it is the same derivation the gate uses.
    const cfg = await stack.api('/auth/config');
    expect(cfg.status).toBe(200);
    const body = (await cfg.json()) as { data?: { features?: Record<string, unknown> } };
    const features = body.data?.features;
    // Read the key out explicitly before asserting on it: `?? {}` over a moved
    // envelope turns "the flag is missing" into "the flag is false", which is
    // how a green assertion can cover a route that stopped reporting at all.
    expect(features, `no features in /auth/config: ${JSON.stringify(body)}`).toBeDefined();
    expect(features!.multiOrgEnabled).toBe(true);
    expect(features!.degradedTenancy).toBe(false);
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
