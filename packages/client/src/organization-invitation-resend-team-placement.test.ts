// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#17274] `organizations.invitations.resend` declares `teamId` and must now
 * DELIVER it: resending a team invitation keeps the team placement.
 *
 * ## The defect
 *
 * `resend`'s parameter type has carried `teamId?: string | null` since the
 * `organizations.*` family's first commit, and the re-invite it issues carried
 * three members — `email`, `role`, `organizationId`. The placement was dropped
 * between the signature and the wire: the compiler accepted the argument, the
 * request succeeded, and the invitation landed with no team. Nothing refused
 * and nothing warned, which is the whole reason it needed measuring rather
 * than reading.
 *
 * ## Which repair this is, and the measurement that chose it
 *
 * The card left two directions open — forward the member, or stop declaring it
 * — and required the endpoint to be DRIVEN, not read off the vendor's types.
 * Driven here (a real `AuthManager`, better-auth 1.7.3, organization plugin,
 * `teams: { enabled: true }`, over a real `SqliteWasmDriver`), the vendor
 * answered:
 *
 * ```
 * invite-member { …, teamId: '<a real team>' } -> 200  invitation.teamId === that team
 * invite-member { …, teamId: 'team_nope' }     -> 400  Team not found             (TEAM_NOT_FOUND)
 * invite-member { …, teamId: null }            -> 400  [body.teamId] Invalid input (VALIDATION_ERROR)
 * invite-member { … }               (omitted)  -> 200  invitation.teamId === null
 * ```
 *
 * Row 1 settles it: the endpoint accepts a team on this call, so FORWARDING is
 * the repair and removing the member would have deleted a capability the wire
 * actually has. Rows 2–4 are why the forward is not a bare spread, and they
 * are pinned below as hard as row 1 — `null` is the SDK's own spelling of "no
 * team" (`invitations.list` answers `teamId: string | null`, and a caller
 * round-trips that object straight back into `resend`), while the vendor's
 * spelling of the same fact is ABSENCE. A verbatim forward would have turned
 * today's SILENT drop into a LOUD 400 for every caller who ever read an
 * invitation back out of `list()` — a different defect wearing the fix's
 * clothes, and case ③ is the pin that refuses it.
 *
 * ## What each case can and cannot see
 *
 * ① and ② are RED on the defect. ③ is GREEN on the defect and RED on the
 * wrong fix — it is the only case here that discriminates between the two
 * forwards, so it is not optional. ④ holds the request BYTES to FULL-STRING
 * equality, never `toContain`: the drive proves the vendor accepts what we
 * send and is structurally blind to a body carrying MORE than it should, which
 * is exactly how a `null` or a renamed member would get through. ⑤ is
 * compile-time only.
 *
 * `arrange()` is the sibling card's rig (`organization-invite-role-default`
 * .test.ts) plus one team, deliberately not extracted: a shared harness that
 * one card's edit can reshape under another card's pins is the drift both
 * files exist to catch.
 */

import { describe, it, expect, expectTypeOf, vi, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { AuthManager } from '@objectstack/plugin-auth';
import * as identityObjects from '@objectstack/platform-objects/identity';
import { ObjectStackClient } from './index';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const ORIGIN = 'http://localhost:3000';
const PASSWORD = 'S3cure!Passw0rd-17274';

/**
 * The identity objects this arrangement stands up, read out of
 * `@objectstack/platform-objects/identity` BY SHAPE rather than transcribed —
 * same derivation as `organization-invite-role-default.test.ts`.
 */
const IDENTITY_OBJECTS = Object.values(
  identityObjects as unknown as Record<string, unknown>,
).filter(
  (o): o is Record<string, unknown> =>
    !!o &&
    typeof o === 'object' &&
    typeof (o as { name?: unknown }).name === 'string' &&
    typeof (o as { fields?: unknown }).fields === 'object',
);

/**
 * `beforeCreateOrganization` refuses to mint an organization unless a
 * multi-organization posture is standing. Set for the file and restored after,
 * so a sibling suite in the same worker is never handed a posture it did not
 * ask for.
 */
const PRIOR_POSTURE = process.env.OS_TENANCY_POSTURE;

beforeAll(() => {
  process.env.OS_TENANCY_POSTURE = 'isolated';
});

afterAll(() => {
  if (PRIOR_POSTURE === undefined) delete process.env.OS_TENANCY_POSTURE;
  else process.env.OS_TENANCY_POSTURE = PRIOR_POSTURE;
});

let seq = 0;
const nextEmail = (tag: string) => `os17274-${tag}-${++seq}-${Date.now()}@example.com`;

interface Rig {
  client: ObjectStackClient;
  organizationId: string;
  teamId: string;
}

/** A signed-in owner, their organization, and one team inside it. */
async function arrange(): Promise<Rig> {
  const engine = new ObjectQL();
  engine.registerDriver(new SqliteWasmDriver({ filename: ':memory:' }) as never, true);
  await engine.init();
  for (const object of IDENTITY_OBJECTS) {
    engine.registry.registerObject(object as never, '@objectstack/plugin-auth');
  }
  await engine.syncSchemas();

  const manager = new AuthManager({
    secret: SECRET,
    baseUrl: ORIGIN,
    dataEngine: engine,
  } as never);

  const client = new ObjectStackClient({
    baseUrl: ORIGIN,
    fetch: (input: RequestInfo | URL, init?: RequestInit) =>
      manager.handleRequest(new Request(String(input), init)),
  });

  await client.auth.register({
    email: nextEmail('owner'),
    password: PASSWORD,
    name: 'Org Owner',
  });

  const organization = await client.organizations.create({
    name: 'Team Placement Org',
    slug: `os17274-${seq}-${Date.now()}`,
  });
  const organizationId = (organization as unknown as { id: string }).id;
  expect(organizationId, 'no organization was minted — the premise of this suite is gone').toBeTruthy();
  await client.organizations.setActive(organizationId);

  const team = await client.organizations.teams.create({ name: 'Engineering', organizationId });
  const teamId = (team as unknown as { id: string }).id;
  expect(teamId, 'no team was minted — this suite cannot ask its question without one').toBeTruthy();

  return { client, organizationId, teamId };
}

/** What `invitations.list` answers for one invitation — the round-trip shape. */
type ListedInvitation = Awaited<
  ReturnType<ObjectStackClient['organizations']['invitations']['list']>
>['invitations'][number];

// ─────────────────────────────────────────────────────────────────────────
// ① the placement survives a resend — RED on the defect
// ─────────────────────────────────────────────────────────────────────────

describe('#17274 organizations.invitations.resend forwards teamId', () => {
  it('① a resent team invitation lands WITH its team', async () => {
    const { client, organizationId, teamId } = await arrange();

    const resent = await client.organizations.invitations.resend({
      email: nextEmail('team-invitee'),
      organizationId,
      teamId,
    });

    // Before the fix this read `null`: the request succeeded, the invitation
    // existed, and the team it was for was simply not on it.
    expect((resent as unknown as { teamId?: string | null }).teamId).toBe(teamId);
    expect(resent.status).toBe('pending');
    expect(resent.organizationId).toBe(organizationId);
  });

  it('① b the placement is readable back out of list(), not just off the echo', async () => {
    const { client, organizationId, teamId } = await arrange();

    const email = nextEmail('team-listed');
    await client.organizations.invitations.resend({ email, organizationId, teamId });

    const { invitations } = await client.organizations.invitations.list(organizationId);
    const listed = invitations.find((i: ListedInvitation) => i.email === email.toLowerCase());
    expect(listed, 'the resent invitation is not in list() at all').toBeTruthy();
    expect(listed?.teamId).toBe(teamId);
  });

  // ───────────────────────────────────────────────────────────────────────
  // ② the silent drop is replaced by a LOUD refusal — RED on the defect
  // ───────────────────────────────────────────────────────────────────────

  it('② an unknown team is refused TEAM_NOT_FOUND instead of being dropped', async () => {
    const { client, organizationId } = await arrange();

    // On the defect this RESOLVED: the bad id never left the SDK, the vendor
    // never saw it, and the caller got a pending invitation with no team.
    await expect(
      client.organizations.invitations.resend({
        email: nextEmail('bad-team'),
        organizationId,
        teamId: 'team_does_not_exist',
      }),
    ).rejects.toMatchObject({ code: 'TEAM_NOT_FOUND' });
  });

  it('② b invite and resend agree on the placement — one family, one behaviour', async () => {
    const { client, organizationId, teamId } = await arrange();

    const invited = await client.organizations.invite({
      email: nextEmail('family-invite'),
      organizationId,
      teamId,
    });
    const resent = await client.organizations.invitations.resend({
      email: nextEmail('family-resend'),
      organizationId,
      teamId,
    });

    expect((invited as unknown as { teamId?: string | null }).teamId).toBe(teamId);
    expect((resent as unknown as { teamId?: string | null }).teamId).toBe(teamId);
  });

  // ───────────────────────────────────────────────────────────────────────
  // ③ the pin that fails on the WRONG fix
  // ───────────────────────────────────────────────────────────────────────

  it('③ a null teamId is "no team", not a 400 — the list() round trip still works', async () => {
    const { client, organizationId } = await arrange();

    const email = nextEmail('no-team');
    await client.organizations.invite({ email, organizationId });
    const { invitations } = await client.organizations.invitations.list(organizationId);
    const pending = invitations.find((i: ListedInvitation) => i.email === email.toLowerCase());
    expect(pending, 'nothing to round-trip — the arrangement did not land an invitation').toBeTruthy();
    // This is the value `list()` really answers for a team-less invitation,
    // read rather than assumed: it is what a caller hands straight back.
    expect(pending?.teamId ?? null).toBeNull();

    const resent = await client.organizations.invitations.resend({
      id: pending!.id,
      email: pending!.email,
      role: pending!.role,
      organizationId: pending!.organizationId,
      teamId: pending!.teamId,
    });

    // A verbatim forward puts `teamId: null` on the wire and this line becomes
    // `400 [body.teamId] Invalid input` — measured against the real vendor.
    expect(resent.status).toBe('pending');
    expect((resent as unknown as { teamId?: string | null }).teamId ?? null).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// ④ the request BYTES — a mechanism the drive above structurally cannot see
// ─────────────────────────────────────────────────────────────────────────

describe('#17274 the bytes organizations.invitations.resend puts on the wire', () => {
  const INVITE_URL = `${ORIGIN}/api/v1/auth/organization/invite-member`;

  /** The 200 the route answers; its exact members do not matter here. */
  const PENDING = JSON.stringify({
    organizationId: 'org_probe',
    email: 'probe@example.com',
    role: 'member',
    teamId: 'team_probe',
    status: 'pending',
    expiresAt: '2026-09-18T00:16:41.261Z',
    createdAt: '2026-09-16T00:16:41.261Z',
    inviterId: 'usr_probe',
    id: 'inv_probe',
  });

  function capturing() {
    const fetchMock = vi.fn(
      async () =>
        new Response(PENDING, { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    const client = new ObjectStackClient({ baseUrl: ORIGIN, fetch: fetchMock as never });
    return { client, fetchMock };
  }

  function soleBody(fetchMock: ReturnType<typeof capturing>['fetchMock']): string {
    // No `id` is passed anywhere below, so `resend` issues no cancel: exactly
    // one request, and a stray second one fails here rather than being read
    // past.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(INVITE_URL);
    return String(init.body);
  }

  it('④a a teamId reaches the wire, once, and nothing else moves', async () => {
    const { client, fetchMock } = capturing();

    await client.organizations.invitations.resend({
      email: 'probe@example.com',
      organizationId: 'org_probe',
      teamId: 'team_probe',
    });

    expect(soleBody(fetchMock)).toBe(
      JSON.stringify({
        email: 'probe@example.com',
        role: 'member',
        organizationId: 'org_probe',
        teamId: 'team_probe',
      }),
    );
  });

  it('④b teamId: null sends NO teamId member at all', async () => {
    const { client, fetchMock } = capturing();

    await client.organizations.invitations.resend({
      email: 'probe@example.com',
      organizationId: 'org_probe',
      teamId: null,
    });

    // Full-string equality is the whole assertion: a body that merely LOOKS
    // right while carrying `"teamId":null` satisfies every weaker check and is
    // a 400 at the vendor.
    expect(soleBody(fetchMock)).toBe(
      JSON.stringify({ email: 'probe@example.com', role: 'member', organizationId: 'org_probe' }),
    );
  });

  it('④c an omitted teamId is byte-identical to the pre-#17274 call', async () => {
    const { client, fetchMock } = capturing();

    await client.organizations.invitations.resend({
      email: 'probe@example.com',
      organizationId: 'org_probe',
    });

    expect(soleBody(fetchMock)).toBe(
      JSON.stringify({ email: 'probe@example.com', role: 'member', organizationId: 'org_probe' }),
    );
  });

  it('④d a caller-named role still survives — the default is not spelled twice', async () => {
    const { client, fetchMock } = capturing();

    // `resend` no longer carries its own `role ?? 'member'`; it takes the one
    // in `invite`. This is the case that would catch that removal going wrong.
    await client.organizations.invitations.resend({
      email: 'probe@example.com',
      role: 'admin',
      organizationId: 'org_probe',
      teamId: 'team_probe',
    });

    expect(soleBody(fetchMock)).toBe(
      JSON.stringify({
        email: 'probe@example.com',
        role: 'admin',
        organizationId: 'org_probe',
        teamId: 'team_probe',
      }),
    );
  });

  it('④e invite puts teamId LAST wherever the caller wrote it', async () => {
    const { client, fetchMock } = capturing();

    await client.organizations.invite({
      email: 'probe@example.com',
      teamId: 'team_probe',
      organizationId: 'org_probe',
    });

    // Lifting `teamId` out of the spread moves it to the end of the body. The
    // position is deliberate and pinned so it cannot drift silently; every
    // OTHER member keeps the position the caller gave it, which is what
    // `organization-invite-role-default.test.ts` ④ asserts.
    expect(soleBody(fetchMock)).toBe(
      JSON.stringify({
        email: 'probe@example.com',
        organizationId: 'org_probe',
        role: 'member',
        teamId: 'team_probe',
      }),
    );
  });

  it('④f invite with teamId: null sends no teamId either', async () => {
    const { client, fetchMock } = capturing();

    await client.organizations.invite({
      email: 'probe@example.com',
      organizationId: 'org_probe',
      teamId: null,
    });

    expect(soleBody(fetchMock)).toBe(
      JSON.stringify({ email: 'probe@example.com', organizationId: 'org_probe', role: 'member' }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────
// ⑤ the pin on the SHAPE of the fix — compile-time, never invoked
// ─────────────────────────────────────────────────────────────────────────

declare const typedClient: ObjectStackClient;

type ResendRequest = Parameters<
  ObjectStackClient['organizations']['invitations']['resend']
>[0];
type InviteRequest = Parameters<ObjectStackClient['organizations']['invite']>[0];

/**
 * Compiled by `packages/client/tsconfig.test.json` (reached by the package's
 * `typecheck` script through `check:test-typecheck`), never invoked — every
 * statement is an assertion tsc evaluates and none performs a request.
 *
 * This is the guard on the direction NOT taken. Deleting `teamId` from
 * `resend` — the card's other candidate repair, rejected because the vendor
 * demonstrably accepts a team here — makes the first two statements red, so
 * that narrowing cannot arrive later under a green suite. The `invite` half is
 * the same guard on the member this card ADDED: removing it again reinstates
 * the drop, because `resend` has no other route to the wire.
 */
export async function resendTeamIdStaysDeclared17274(): Promise<void> {
  await typedClient.organizations.invitations.resend({
    email: 'e@example.com',
    organizationId: 'o',
    teamId: 't',
  });
  // `null` is a caller's round-trip of `list()`, so it must keep compiling.
  await typedClient.organizations.invitations.resend({
    email: 'e@example.com',
    organizationId: 'o',
    teamId: null,
  });
  await typedClient.organizations.invite({
    email: 'e@example.com',
    organizationId: 'o',
    teamId: 't',
  });

  // Both members are optional AND nullable — the two facts are asserted apart,
  // because dropping either one alone is a narrowing a caller feels.
  expectTypeOf<ResendRequest['teamId']>().toEqualTypeOf<string | null | undefined>();
  expectTypeOf<InviteRequest['teamId']>().toEqualTypeOf<string | null | undefined>();

  // The member `resend` reads out of `list()` is assignable to the one it
  // hands to `invite`: the round trip is a type-level fact, not a convention.
  expectTypeOf<ListedInvitation['teamId']>().toExtend<InviteRequest['teamId']>();
}
