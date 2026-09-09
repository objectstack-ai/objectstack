// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#16568] `organizations.getActiveMember(organizationId)` addresses the
 * organisation the CALLER NAMES — not whichever one the session happens to
 * have active.
 *
 * ## The defect
 *
 * The method used to build
 * `GET /organization/get-active-member?organizationId=…`. better-auth 1.7.2's
 * handler for that path (`plugins/organization/routes/crud-members.mjs`) reads
 * `session.session.activeOrganizationId` and never looks at `ctx.query`, so the
 * query string was dead on arrival: a caller doing a permission check for
 * organisation B while A was active was told about **A**, with a 200 and no
 * diagnostic. The SDK's own JSDoc promised "the calling user's membership row
 * in the given organisation" — a declared capability the runtime did not
 * deliver.
 *
 * ## The fixture is the vendor's behaviour, measured — not an approximation
 *
 * {@link betterAuthDouble} below is modelled on a drive of a REAL `AuthManager`
 * (better-auth 1.7.2, organization plugin, teams enabled) over a REAL
 * `SqlDriver` (better-sqlite3 `:memory:`), one user owning two organisations
 * with A active. The transcript that fixes each arm:
 *
 * ```
 * GET /organization/get-active-member?organizationId=<A>  -> 200 {organizationId:<A>, role:'owner', …}
 * GET /organization/get-active-member?organizationId=<B>  -> 200 {organizationId:<A>, role:'owner', …}   <- same row
 * GET /organization/get-active-member  (no active org)    -> 400 NO_ACTIVE_ORGANIZATION
 * GET /organization/list-members?organizationId=<B>&filterField=userId&filterValue=<self>&limit=1
 *                                                        -> 200 {members:[{organizationId:<B>, …}], total:1}
 * GET /organization/list-members?organizationId=<A>&filterField=userId&filterValue=<self>&limit=1
 *                                                        -> 200 {members:[{organizationId:<A>, …}], total:1}
 * GET /organization/list-members?organizationId=<B>       -> 200 {members:[<self>, <other>], total:2}
 * GET /organization/list-members?organizationId=<B>&filterField=userId&filterValue=<other> -> the OTHER row
 * GET /organization/list-members?organizationId=<foreign>&filterField=userId&filterValue=<self>
 *                                                        -> 403 YOU_ARE_NOT_A_MEMBER_OF_THIS_ORGANIZATION
 * GET /get-session          (signed in)                  -> 200 {user:{id,…}, session:{…}}   (BARE, no envelope)
 * GET /get-session          (anonymous)                  -> 200 null
 * GET /organization/list-members  (anonymous)            -> 401 UNAUTHORIZED
 * ```
 *
 * The two rows the fixture serves differ in `id` **and** `organizationId`, so
 * "answered the wrong organisation" is a value difference an assertion can see.
 *
 * ## Why this file cannot pass for the wrong reason
 *
 * The double keeps the DEFECT alive on `get-active-member`: it answers the
 * ACTIVE organisation's row whatever id the query names, exactly as the vendor
 * does. So a regression that routes the method back to that path returns A's
 * row while the case asks for B's, and case ① goes red on the value — not
 * merely on a URL string. The URL assertions in case ② are the second face:
 * they pin the request BYTES, which is what the card's finding was ultimately
 * about, and they fail on a filter that is dropped or misspelled even if some
 * future double got lucky on the row.
 */

import { describe, it, expect } from 'vitest';
import { ObjectStackClient } from './index';
import type { OrganizationMemberWithUserWire } from './index';

const BASE = 'http://localhost:9';
const AUTH = `${BASE}/api/v1/auth`;

const USER = { id: 'usr_self', name: 'Probe', email: 'probe@example.com', image: null } as const;
const OTHER = { id: 'usr_other', name: 'Second', email: 'second@example.com', image: null } as const;

const ORG_A = 'org_alpha';
const ORG_B = 'org_bravo';
const ORG_FOREIGN = 'org_foreign';

/** The membership rows the fixture's store holds, in the vendor's own shape. */
const ROWS: Record<string, OrganizationMemberWithUserWire[]> = {
  [ORG_A]: [
    { id: 'mem_a_self', organizationId: ORG_A, userId: USER.id, role: 'owner', createdAt: '2026-09-08T02:34:14.706Z', user: { ...USER } },
  ],
  [ORG_B]: [
    { id: 'mem_b_self', organizationId: ORG_B, userId: USER.id, role: 'owner', createdAt: '2026-09-08T02:34:14.707Z', user: { ...USER } },
    { id: 'mem_b_other', organizationId: ORG_B, userId: OTHER.id, role: 'member', createdAt: '2026-09-08T02:34:14.902Z', user: { ...OTHER } },
  ],
  [ORG_FOREIGN]: [],
};

interface DoubleOptions {
  /** `null` models a signed-in session with no active organisation. */
  activeOrganizationId: string | null;
  /** `false` models an anonymous caller: `/get-session` answers the literal `null`. */
  signedIn?: boolean;
}

interface Drive {
  client: ObjectStackClient;
  /** Every URL the client put on the wire, in order. */
  urls: string[];
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/**
 * A stand-in for better-auth 1.7.2's organization routes, arm for arm as
 * measured. Only the socket is faked — every status, code and row shape below
 * is a transcript line from the drive quoted in this file's header.
 */
function betterAuthDouble(options: DoubleOptions): Drive {
  const signedIn = options.signedIn !== false;
  const urls: string[] = [];

  const client = new ObjectStackClient({
    baseUrl: BASE,
    fetch: async (input) => {
      const url = String(input);
      urls.push(url);
      const parsed = new URL(url);
      const q = parsed.searchParams;

      if (parsed.pathname === '/api/v1/auth/get-session') {
        // Measured: the BARE `{ user, session }` body for a signed-in caller,
        // and the literal `null` — at 200, not 401 — for an anonymous one.
        if (!signedIn) return json(200, null);
        return json(200, {
          user: { ...USER, emailVerified: false, createdAt: '2026-09-08T02:34:14.6Z', updatedAt: '2026-09-08T02:34:14.6Z' },
          session: { id: 'ses_1', userId: USER.id, token: 'tok', activeOrganizationId: options.activeOrganizationId, activeTeamId: null },
        });
      }

      if (!signedIn) {
        // Every organisation route sits behind better-auth's session
        // middleware, which refuses before any handler reads the query.
        return json(401, { message: 'Unauthorized', code: 'UNAUTHORIZED' });
      }

      if (parsed.pathname === '/api/v1/auth/organization/get-active-member') {
        // THE DEFECT, KEPT ALIVE: `organizationId` in the query is ignored and
        // the session's active organisation answers. This arm exists so a
        // regression to this route fails on the ROW, not on a URL string.
        const active = options.activeOrganizationId;
        if (!active) return json(400, { message: 'No active organization', code: 'NO_ACTIVE_ORGANIZATION' });
        const row = (ROWS[active] ?? []).find((m) => m.userId === USER.id);
        if (!row) return json(400, { message: 'Member not found', code: 'MEMBER_NOT_FOUND' });
        return json(200, row);
      }

      if (parsed.pathname === '/api/v1/auth/organization/list-members') {
        const organizationId = q.get('organizationId') || options.activeOrganizationId;
        if (!organizationId) return json(400, { message: 'No active organization', code: 'NO_ACTIVE_ORGANIZATION' });
        const table = ROWS[organizationId] ?? [];
        // The vendor's own membership gate, which runs BEFORE the filter.
        if (!table.some((m) => m.userId === USER.id)) {
          return json(403, {
            message: 'You are not a member of this organization',
            code: 'YOU_ARE_NOT_A_MEMBER_OF_THIS_ORGANIZATION',
          });
        }
        let members = table;
        const field = q.get('filterField');
        if (field) {
          const value = q.get('filterValue');
          members = members.filter((m) => String((m as unknown as Record<string, unknown>)[field]) === value);
        }
        const limit = q.get('limit');
        if (limit) members = members.slice(0, Number(limit));
        return json(200, { members, total: members.length });
      }

      throw new Error(`fixture: unexpected request ${url}`);
    },
  });

  return { client, urls };
}

describe('[#16568] organizations.getActiveMember addresses the organisation the caller names', () => {
  it('① answers the NAMED organisation’s row while a DIFFERENT one is active — the reported defect', async () => {
    const { client, urls } = betterAuthDouble({ activeOrganizationId: ORG_A });

    const member = await client.organizations.getActiveMember(ORG_B);

    // The value that separates fixed from broken: before the fix this resolved
    // to `mem_a_self` / `org_alpha` — a 200 carrying the wrong organisation.
    expect(member.organizationId).toBe(ORG_B);
    expect(member.id).toBe('mem_b_self');
    expect(member.userId).toBe(USER.id);
    expect(member.role).toBe('owner');
    // The joined user projection survives the route change (the two routes
    // serve the identical row shape — measured, and the reason the declared
    // return type does not move).
    expect(member.user).toEqual(USER);

    // ...and the dead route is not consulted at all.
    expect(urls.some((u) => u.includes('/organization/get-active-member'))).toBe(false);
  });

  it('② the request bytes: who-am-I, then a self-filtered read of the NAMED organisation', async () => {
    const { client, urls } = betterAuthDouble({ activeOrganizationId: ORG_A });

    await client.organizations.getActiveMember(ORG_B);

    expect(urls).toHaveLength(2);
    expect(urls[0]).toBe(`${AUTH}/get-session`);

    const second = new URL(urls[1]!);
    expect(second.pathname).toBe('/api/v1/auth/organization/list-members');
    expect(second.searchParams.get('organizationId')).toBe(ORG_B);
    expect(second.searchParams.get('filterField')).toBe('userId');
    expect(second.searchParams.get('filterValue')).toBe(USER.id);
    expect(second.searchParams.get('limit')).toBe('1');
  });

  it('③ still answers the ACTIVE organisation correctly when that is what the caller names', async () => {
    const { client } = betterAuthDouble({ activeOrganizationId: ORG_A });

    const member = await client.organizations.getActiveMember(ORG_A);

    expect(member.organizationId).toBe(ORG_A);
    expect(member.id).toBe('mem_a_self');
  });

  it('④ needs no active organisation — `setActive` stopped being a precondition', async () => {
    // Against `get-active-member` this exact call was a thrown
    // `400 NO_ACTIVE_ORGANIZATION`, which is what made "name the organisation
    // you mean" impossible to express through this method at all.
    const { client } = betterAuthDouble({ activeOrganizationId: null });

    const member = await client.organizations.getActiveMember(ORG_B);

    expect(member.organizationId).toBe(ORG_B);
    expect(member.id).toBe('mem_b_self');
  });

  it('⑤ a NON-member is refused by the server, in the ADR-0112 envelope', async () => {
    const { client } = betterAuthDouble({ activeOrganizationId: ORG_A });

    // Asserted as an envelope, not as a bare `toThrow()`: a method that threw a
    // plain `Error` for its own reasons would satisfy `toThrow` and tell us
    // nothing about who refused.
    const error = await client.organizations
      .getActiveMember(ORG_FOREIGN)
      .then(() => null, (e: unknown) => e as { code?: string; httpStatus?: number });

    expect(error?.code).toBe('YOU_ARE_NOT_A_MEMBER_OF_THIS_ORGANIZATION');
    expect(error?.httpStatus).toBe(403);
  });

  it('⑥ an anonymous caller is still refused 401 by the server, not by an invented client-side error', async () => {
    const { client, urls } = betterAuthDouble({ activeOrganizationId: ORG_A, signedIn: false });

    const error = await client.organizations
      .getActiveMember(ORG_B)
      .then(() => null, (e: unknown) => e as { code?: string; httpStatus?: number });

    expect(error?.code).toBe('UNAUTHORIZED');
    expect(error?.httpStatus).toBe(401);
    // The refusal comes from the second request — the SDK does not short-circuit
    // on the `null` session and substitute a diagnostic of its own.
    expect(urls).toHaveLength(2);
    expect(urls[1]).toContain('/organization/list-members');
  });

  it('⑦ the double really can serve the wrong row — guard the guard', async () => {
    // Cases ①/③/④ are value assertions, and a value assertion is only as good
    // as the fixture's ability to produce the other value. This drives the
    // dead route directly through the same double and pins that it STILL
    // reproduces the defect: named B, answered A. If this ever goes red the
    // vendor has changed and the arms above stopped discriminating.
    const { client } = betterAuthDouble({ activeOrganizationId: ORG_A });
    const raw = await (client as unknown as {
      fetchImpl: (input: string) => Promise<Response>;
    }).fetchImpl(`${AUTH}/organization/get-active-member?organizationId=${ORG_B}`);

    expect(raw.status).toBe(200);
    expect(await raw.json()).toMatchObject({ organizationId: ORG_A, id: 'mem_a_self' });
  });

  it('⑧ an EMPTY organizationId is refused before the wire, not answered with the ACTIVE row', async () => {
    // The last input in the wrong-but-plausible class. better-auth resolves
    // `ctx.query.organizationId || session.activeOrganizationId`, so an empty
    // string reached `list-members` and came back 200 carrying ORG_A's row
    // while the JSDoc said "the GIVEN organisation" — the same silent
    // substitution this card is about, surviving on one argument.
    const { client, urls } = betterAuthDouble({ activeOrganizationId: ORG_A });

    await expect(client.organizations.getActiveMember('')).rejects.toThrow(
      '[ObjectStack] organizations.getActiveMember: organizationId is required',
    );
    // Refused CLIENT-side: nothing was put on the wire at all, so this cannot
    // pass because some server happened to say no.
    expect(urls).toEqual([]);

    // Guard the guard: the fallback the refusal prevents is real in this
    // fixture, exactly as it is in the vendor. Drive `list-members` with an
    // empty id through the same double and watch it answer the ACTIVE
    // organisation at 200 — which is what case ⑧ would have returned.
    const raw = await (client as unknown as {
      fetchImpl: (input: string) => Promise<Response>;
    }).fetchImpl(`${AUTH}/organization/list-members?organizationId=&filterField=userId&filterValue=${USER.id}&limit=1`);

    expect(raw.status).toBe(200);
    expect(await raw.json()).toMatchObject({ members: [{ organizationId: ORG_A, id: 'mem_a_self' }] });
  });
});
