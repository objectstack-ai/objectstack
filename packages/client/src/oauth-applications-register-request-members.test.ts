// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#15447] `oauth.applications.register` must declare only members the route
 * it posts to actually accepts — and must still send the ones it does, byte
 * for byte.
 *
 * ## Two halves, two mechanisms, and neither can do the other's job
 *
 * 1. **The removal is type-level only.** `POST /oauth2/create-client` answers
 *    **201 either way** — that is the entire reason the defect was invisible
 *    for as long as it was. A runtime assertion on the status, on the response
 *    body, or on a read-back would have been green before the fix and green
 *    after it. Only a compile-time assertion can observe a member leaving a
 *    declared type, so `registerRequestMemberPins15447` below is compiled and
 *    never invoked, exactly like `return-type-precision.test.ts`'s pins.
 * 2. **The members that survive are runtime-pinned**, because those the SDK
 *    can still break: it serialises the caller's object straight into the
 *    request body, so a later "helpful" translation layer (mapping `name` onto
 *    `client_name`, joining a `scopes` array) would change what reaches the
 *    server without changing a single type. The `it()` blocks hold the request
 *    bytes to FULL-STRING equality for that reason — never `toContain`, which
 *    a body carrying extra members would satisfy.
 *
 * ## What was measured, and where
 *
 * Driven on the card (issue #15447, comment 5559384773) against real
 * `betterAuth` + real `@better-auth/oauth-provider@1.7.2` over the real
 * ObjectQL engine on a real TCP socket, through the real `ObjectStackClient`.
 * ⛔ Nothing here re-drives that rig; these fixtures encode its verdict.
 *
 * | posted member | response | `get` | `list` | `sys_oauth_application` row |
 * |---|---|---|---|---|
 * | `client_name: 'CTRL-…'` *(control)* | present | present | present | column `name` = `'CTRL-…'` |
 * | `scope: 'openid profile email'` *(control)* | present | present | present | column `scopes` = `["openid","profile","email"]` |
 * | `name: 'PROBE-…'` | absent | absent | absent | column `name` = **null** |
 * | `scopes: ['openid',…]` | absent | absent | absent | column `scopes` = **null** |
 * | `metadata: {…}` | absent | absent | absent | column `metadata` = **null** |
 *
 * The vendor body schema has no `catchall`, so it is zod's default **strip**:
 * parsing a body carrying all three reports `ok: true` with
 * `droppedKeys: ["name","scopes","metadata"]`. A second, independent barrier
 * stands behind that strip — the handler funnels the parsed rest into the
 * opaque-metadata envelope and all three names sit in
 * `OPAQUE_METADATA_RESERVED_FIELDS` — so loosening the SDK alone could never
 * have made them arrive.
 *
 * ## ⚠️ The two near-misses are the RECORD vocabulary, not typos
 *
 * `client_name` writes the DB column literally named `name`; `scope` writes
 * the column literally named `scopes`. The removed members were the column
 * names, offered next to the wire names in the same type. That is also why
 * `scopes` → `scope` is not a rename: `scope` is one space-delimited string,
 * and the array form is driven-refused with
 * `400 [body.scope] Invalid input: expected string, received array`. The
 * FIRST case below sends that prescription, byte for byte; the third pins what
 * the SDK does with the refusal the array form draws.
 *
 * `metadata` has no reachable door at all: only the SERVER_ONLY
 * `PATCH /admin/oauth2/update-client` honours it, and `better-call`'s router
 * skips SERVER_ONLY endpoints (driven over HTTP: 404, zero bytes).
 */

import { describe, it, expect, expectTypeOf, vi } from 'vitest';
import { ObjectStackClient } from './index';

const BASE = 'http://localhost:3000';
const CREATE_CLIENT_URL = `${BASE}/api/v1/auth/oauth2/create-client`;

/** The 201 the route answers — identical before and after this card. */
const REGISTERED = JSON.stringify({
  client_id: 'GshJvINrsShauIzjLxjKpcCtxsYjoOxP',
  client_secret: 'aLPpOONfpGeJymAExjukigaMaxNLvpjt',
  client_secret_expires_at: 0,
  client_id_issued_at: 1788699309,
});

function clientCapturingRequest() {
  const fetchMock = vi.fn(
    async () =>
      new Response(REGISTERED, { status: 201, headers: { 'content-type': 'application/json' } }),
  );
  const client = new ObjectStackClient({ baseUrl: BASE, fetch: fetchMock as never });
  return { client, fetchMock };
}

/** The one request the method under test is allowed to make. */
function soleRequest(fetchMock: ReturnType<typeof clientCapturingRequest>['fetchMock']) {
  expect(fetchMock).toHaveBeenCalledTimes(1);
  return fetchMock.mock.calls[0] as unknown as [string, RequestInit];
}

// ─────────────────────────────────────────────────────────────────────────
// ① The pin — type-level, and RED on the defect rather than on the fix
// ─────────────────────────────────────────────────────────────────────────

declare const client: ObjectStackClient;

/** The declared request type of the method this card narrows. */
type RegisterRequest = Parameters<ObjectStackClient['oauth']['applications']['register']>[0];

/**
 * Compiled by `packages/client/tsconfig.test.json` (which includes `src/**` and
 * is named by `package.json`'s `typecheck` script through
 * `check:test-typecheck`), never invoked — every statement is an assertion tsc
 * evaluates, and none of them may perform a request.
 *
 * ⚠️ Both directions below are red while the defect stands, which is what
 * makes this a pin on the DEFECT and not on the fix:
 *
 *  - the key-set equality fails because the union carried three more members;
 *  - each `@ts-expect-error` goes UNUSED (TS2578, "Unused '@ts-expect-error'
 *    directive") because the literal was accepted while the member was
 *    declared.
 *
 * The key set is asserted as an EQUALITY, not as three absences, so it is also
 * the guard against the opposite move: re-adding any of the three under a new
 * spelling, or slipping in a compatibility alias member, reddens it too.
 */
export async function registerRequestMemberPins15447(): Promise<void> {
  // ── direction 1: the surviving key set, exactly ──────────────────────
  expectTypeOf<keyof RegisterRequest>().toEqualTypeOf<
    | 'client_name'
    | 'redirect_uris'
    | 'token_endpoint_auth_method'
    | 'grant_types'
    | 'response_types'
    | 'client_uri'
    | 'logo_uri'
    | 'scope'
    | 'contacts'
    | 'tos_uri'
    | 'policy_uri'
  >();

  // The two wire members the route DOES honour are still declared, and still
  // carry the types the wire uses — `scope` a single space-delimited string,
  // never the array the removed `scopes` invited.
  expectTypeOf<RegisterRequest['client_name']>().toEqualTypeOf<string | undefined>();
  expectTypeOf<RegisterRequest['scope']>().toEqualTypeOf<string | undefined>();

  // ── direction 2: the three stripped members are now REFUSED ──────────
  // Each suppression sits on the property line, because that is where the
  // excess-property check reports, and each is UNUSED while the member is
  // still declared.
  void (await client.oauth.applications.register({
    redirect_uris: ['https://app.example.com/cb'],
    // @ts-expect-error [#15447] `name` is the DB COLUMN `client_name` writes, not a wire member; the route strips it and answers 201
    name: 'PROBE-NAME-15447',
  }));
  void (await client.oauth.applications.register({
    redirect_uris: ['https://app.example.com/cb'],
    // @ts-expect-error [#15447] `scopes` is the DB COLUMN `scope` writes; it is stripped everywhere and is NOT a rename of `scope` — that one takes a space-joined string
    scopes: ['openid', 'profile', 'email'],
  }));
  void (await client.oauth.applications.register({
    redirect_uris: ['https://app.example.com/cb'],
    // @ts-expect-error [#15447] `metadata` is honoured only by the SERVER_ONLY admin update, which is not an HTTP route at all
    metadata: { tenant: 'acme', tier: 7 },
  }));
}

// ─────────────────────────────────────────────────────────────────────────
// ①b [#17215] `redirect_uris` is OPTIONAL — parity with the vendor schema
// ─────────────────────────────────────────────────────────────────────────

/**
 * [#17215] The eleventh member was the one required member on this type, and
 * the route it posts to declares it **optional**. Re-introspected at runtime
 * against `@better-auth/oauth-provider@1.7.3` — instantiate `oauthProvider()`,
 * walk `endpoints`, read `options.body` — every one of that schema's 21
 * members is optional, and `body.safeParse({ client_name })` succeeds with
 * `redirect_uris` absent. So a request the route accepts had no spelling here.
 *
 * ⚠️ This pin is type-level for the same reason `registerRequestMemberPins15447`
 * is: the route answers the same way either way, and only a compile-time
 * assertion can observe a member's OPTIONALITY changing. A runtime assertion
 * on the request bytes cannot — `JSON.stringify` omits an absent member
 * whether the type required it or not, so the body is byte-identical in both
 * states and any such test is green before the fix and green after it.
 *
 * ⛔ The key-set equality above is deliberately NOT the guard for this:
 * `keyof` is blind to optionality, so it reads the same eleven names in both
 * states. That is why it keeps holding across this change, and why this needs
 * its own assertion rather than relying on the one already there.
 */
export async function registerRedirectUrisOptionalPin17215(): Promise<void> {
  // ── the parity assertion — red if anyone re-tightens it ──────────────
  expectTypeOf<RegisterRequest['redirect_uris']>().toEqualTypeOf<string[] | undefined>();

  // ── the call that was previously INEXPRESSIBLE ───────────────────────
  // Before this card `redirect_uris` was required, so this did not compile at
  // all. It is the whole point of the change: the vendor accepts this body.
  void (await client.oauth.applications.register({ client_name: 'PROBE-17215-OMITTED' }));

  // The emptiest legal call: every member of the vendor schema is optional.
  void (await client.oauth.applications.register({}));

  // ── and the call that always worked still does ───────────────────────
  void (await client.oauth.applications.register({
    client_name: 'CTRL-17215-SUPPLIED',
    redirect_uris: ['https://app.example.com/cb'],
  }));

  // ⚠️ Optional is not "any array will do": the vendor refuses `[]`
  // (`safeParse([])` fails at runtime). The TYPE cannot express non-empty, so
  // this still compiles — recorded here so the next reader does not mistake
  // the compiling call for a legal one.
  void (await client.oauth.applications.register({ redirect_uris: [] }));
}

// ─────────────────────────────────────────────────────────────────────────
// ② The negative control — what the route DOES honour still arrives verbatim
// ─────────────────────────────────────────────────────────────────────────

describe('#15447 oauth.applications.register — the honoured members still reach the wire', () => {
  it('sends `client_name` and a space-joined `scope` byte for byte', async () => {
    const { client: c, fetchMock } = clientCapturingRequest();
    await c.oauth.applications.register({
      client_name: 'CTRL-CLIENT-NAME-15447',
      scope: ['openid', 'profile', 'email'].join(' '),
      redirect_uris: ['https://app.example.com/cb'],
    });
    const [url, init] = soleRequest(fetchMock);
    expect(url).toBe(CREATE_CLIENT_URL);
    expect(init.method).toBe('POST');
    // ⛔ Full-string equality, never `toContain`: a body that also carried a
    // re-introduced `name`/`scopes`/`metadata`, or one the SDK had started
    // translating, would satisfy a containment check.
    expect(init.body).toBe(
      JSON.stringify({
        client_name: 'CTRL-CLIENT-NAME-15447',
        scope: 'openid profile email',
        redirect_uris: ['https://app.example.com/cb'],
      }),
    );
  });

  it('is a pass-through: every surviving member arrives unchanged and nothing is added', async () => {
    const { client: c, fetchMock } = clientCapturingRequest();
    const req = {
      client_name: 'CTRL-CLIENT-NAME-15447',
      redirect_uris: ['https://app.example.com/cb'],
      token_endpoint_auth_method: 'client_secret_basic' as const,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      client_uri: 'https://app.example.com',
      logo_uri: 'https://app.example.com/logo.png',
      scope: 'openid profile email',
      contacts: ['ops@example.com'],
      tos_uri: 'https://app.example.com/tos',
      policy_uri: 'https://app.example.com/privacy',
    };
    await c.oauth.applications.register(req);
    const [, init] = soleRequest(fetchMock);
    // The method's whole body-building step is `JSON.stringify(req)`. Holding
    // it to that exactly is what makes a future mapping layer — the shape
    // triage called "keep and honour" — a red test rather than a silent
    // divergence from the vendor's wire vocabulary.
    expect(init.body).toBe(JSON.stringify(req));
  });

  it('[#17215] a call omitting `redirect_uris` sends a body without the key at all', async () => {
    // The type-level pin above cannot witness this half: it proves the call
    // COMPILES, never what reaches the wire. This proves the SDK adds no
    // default — no `redirect_uris: []` synthesised on the caller's behalf,
    // which the vendor would refuse outright.
    const { client: c, fetchMock } = clientCapturingRequest();
    await c.oauth.applications.register({ client_name: 'PROBE-17215-OMITTED' });
    const [url, init] = soleRequest(fetchMock);
    expect(url).toBe(CREATE_CLIENT_URL);
    expect(init.body).toBe(JSON.stringify({ client_name: 'PROBE-17215-OMITTED' }));
    expect(JSON.parse(init.body as string)).not.toHaveProperty('redirect_uris');
  });

  it("surfaces the route's refusal of an array-form `scope` rather than swallowing it", async () => {
    // ⚠️ The 400 below is a RECORDED response, replayed — never one this test
    // produces. It is the verbatim answer the driven run got (issue #15447,
    // comment 5559384773) from posting `scope: ['openid','profile']` at the
    // real route; the same run got 201 and `"scope":"openid profile"` back from
    // `['openid','profile'].join(' ')`. ⛔ Nothing here re-drives that, so what
    // this case pins is the SDK's HANDLING of the refusal — that it surfaces
    // it rather than papering over it — and never the route's own verdict,
    // which a transport double answering 400 unconditionally cannot witness.
    //
    // The request carries the ARRAY form, spelled through a suppression,
    // because that is the body which actually produced the recorded 400 —
    // pairing it with the joined body the route ACCEPTS would be a fixture
    // asserting one request's answer against another request. The suppression
    // is load-bearing twice: after this card's narrowing the array form is no
    // longer expressible through the declared type at all (the removed
    // `scopes` was the member that invited it), which is the fact that makes
    // the pairing honest rather than merely relabelled; and if `scope` is ever
    // widened to accept an array, the directive goes unused and this goes red.
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            message: '[body.scope] Invalid input: expected string, received array',
            code: 'VALIDATION_ERROR',
          }),
          { status: 400, headers: { 'content-type': 'application/json' } },
        ),
    );
    const c = new ObjectStackClient({ baseUrl: BASE, fetch: fetchMock as never });
    await expect(
      c.oauth.applications.register({
        client_name: 'CTRL-CLIENT-NAME-15447',
        redirect_uris: ['https://app.example.com/cb'],
        // @ts-expect-error [#15447] `scope` is ONE space-delimited string; the array is what the recorded 400 refuses, and the narrowed type no longer lets a caller spell it
        scope: ['openid', 'profile', 'email'],
      }),
    ).rejects.toThrow(/expected string, received array/);
  });
});
