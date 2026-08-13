// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8192] The credential-at-rest posture for `sys_scim_provider.scim_token` and
 * `sys_oauth_application.client_secret` is PINNED here.
 *
 * ## Why this file exists (nothing is broken — that is the point)
 *
 * #8011 measured, by real round trip, that both columns already store a one-way
 * SHA-256 digest. This file is not a defect fix; it is the tripwire that holds
 * that posture in place. The two columns get there by two mechanisms with very
 * different fragilities:
 *
 * | column                          | how hashing is obtained                | upstream default if the wiring is dropped |
 * |:--------------------------------|:---------------------------------------|:------------------------------------------|
 * | `sys_scim_provider.scim_token`  | EXPLICIT `scim({ storeSCIMToken: 'hashed' })` in `auth-manager.ts` | **`'plain'` — cleartext** |
 * | `sys_oauth_application.client_secret` | IMPLICIT — nothing is passed; `@better-auth/oauth-provider` resolves `storeClientSecret: disableJwtPlugin ? 'encrypted' : 'hashed'` | `'hashed'` |
 *
 * The SCIM row is the sharp one, and the asymmetry is structural rather than a
 * matter of which default happens to be safer. Upstream's two helpers END
 * differently on an unrecognised storage method:
 *
 *   - `@better-auth/scim`'s `storeSCIMToken()` falls through to
 *     `return scimToken` — cleartext, silently.
 *   - `@better-auth/oauth-provider`'s `storeClientSecret()` ends in
 *     `throw new BetterAuthError("Unsupported storeClientSecret type …")`.
 *
 * So `client_secret` cannot reach cleartext by a dropped literal at all: the
 * only non-hashed value the plugin will accept is `'encrypted'` (and only with
 * `disableJwtPlugin`, which its own validation cross-checks). `scim_token` can,
 * and a single option literal is the only thing between a live IdP bearer and a
 * cleartext value in a column that is readable over the generic data API
 * (`sys_scim_provider` declares `apiMethods: ['list']`).
 * Before this file, `grep -rn 'storeSCIMToken|storeClientSecret' --include=*.test.ts`
 * returned **zero hits** — so dropping that literal (a plausible edit during the
 * `@better-auth/scim` rc.2 migration tracked in #3653, which changes this exact
 * call site's construction signature) would persist the bearer in cleartext with
 * the entire gate farm green.
 *
 * ## What makes this pin non-vacuous — five deliberate choices
 *
 * 1. **It drives `AuthManager`, not `scim()`.** This is the load-bearing choice.
 *    A test that calls `scim({ storeSCIMToken: 'hashed' })` itself pins its own
 *    literal and would stay green forever after the repo's literal was deleted —
 *    it would certify exactly the regression it was written to catch. Every
 *    assertion below runs against a plugin list built by the REPO's own
 *    `AuthManager.buildPluginList()`, so the option literal in `auth-manager.ts`
 *    is inside the system under test.
 * 2. **It reads the row at DRIVER level**, below the ObjectQL read mask and below
 *    the plugin's own accessor. Asking better-auth what it stored proves nothing
 *    about what is on disk.
 * 3. **It asserts the hash RELATIONSHIP, recomputed independently.** The expected
 *    digest is computed here with `node:crypto`, not by calling better-auth's
 *    hasher. "Differs from the plaintext" would be satisfied by base64 of the
 *    plaintext, which is not a credential-at-rest posture at all.
 * 4. **It pins the inner-token trap as an explicit NEGATIVE.** For SCIM the value
 *    handed to the caller is `base64url("BASE:providerId:organizationId")` while
 *    the stored digest is over the inner `BASE` alone. Hashing the full bearer
 *    does NOT reproduce the stored value. #8011 measured both; case ②-b below
 *    asserts the full-bearer digest does not match, so a future rewrite cannot
 *    "fix" this file into the naive shape that fails on correct code.
 * 5. **The control arm measures the upstream default rather than citing it.**
 *    Case ③ constructs `scim()` with NO option and shows the bearer lands in
 *    cleartext. That is what makes the literal demonstrably load-bearing: without
 *    it a reader cannot tell whether `storeSCIMToken: 'hashed'` is doing work or
 *    is redundant belt-and-braces. It is also the permanent form of this card's
 *    ablation — the "flip it to plain and watch it go red" experiment, kept.
 *
 * ## Ablation measured when this file landed (predicted first, then run)
 *
 * - `storeSCIMToken: 'hashed'` → `'plain'` in `auth-manager.ts`: case ②-a red,
 *   `stored` = the raw 24-char inner base token, everything else green.
 * - `storeClientSecret: { hash: async (s) => s }` added to the same file's
 *   `oauthProvider(...)` call: case ① red, `stored` = the 32-char plaintext
 *   secret, everything else green. Note the shape — `'plain'` is NOT usable as
 *   an ablation here, because `storeClientSecret()` throws on it rather than
 *   storing cleartext.
 *
 * Predicted and measured agreed in both directions, including the deliberate
 * prediction that the AUTHENTICATES case stays GREEN under the SCIM ablation:
 * `verifySCIMToken` mirrors whatever storage method is configured, so with
 * `'plain'` it compares plaintext to plaintext and still succeeds. That case is
 * a liveness arm, not a posture detector, and the ablation is what establishes
 * the difference.
 *
 * And each positive case asserts the credential still AUTHENTICATES. Hashing is
 * trivially satisfiable by storing garbage; a posture pin that only checked "not
 * cleartext" would pass on a build where SCIM provisioning is entirely broken —
 * the same trap `sso-client-secret-at-rest.test.ts` (#8009) names in its header.
 *
 * ## One honest deviation from the usual "the test chooses the plaintext" bar
 *
 * For `sso-client-secret-at-rest.test.ts` the secret is caller-supplied, so that
 * file feeds in a literal of its own and nothing in the implementation can
 * supply it. Neither credential here works that way: `/scim/generate-token`
 * mints `generateRandomString(24)` and `/oauth2/register` mints
 * `generateRandomString(32)` server-side by design — RFC 7591 registration does
 * not accept a client-chosen secret. So the plaintext is necessarily observed
 * rather than chosen. The independence that bar protects is preserved by the
 * ORACLE instead: the expected digest is recomputed here from that observed
 * plaintext by a different implementation (`node:crypto`), and the negative
 * cases below pin the two ways the relationship could be wrong. Stated plainly
 * rather than papered over.
 *
 * ## Backend note
 *
 * A real `ObjectQL` over `@objectstack/driver-sql` + better-sqlite3 `:memory:`,
 * the backend the sibling at-rest pin (#8009) and the SCIM adapter tests already
 * use.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { betterAuth } from 'better-auth';
import { AuthManager } from './auth-manager.js';
import { createObjectQLAdapterFactory } from './objectql-adapter.js';
import {
  buildOrganizationPluginSchema,
  buildAdminPluginSchema,
  AUTH_USER_CONFIG,
  AUTH_SESSION_CONFIG,
  AUTH_ACCOUNT_CONFIG,
  AUTH_VERIFICATION_CONFIG,
} from './auth-schema-config.js';
import { createTenancyService } from './tenancy-service.js';
import {
  SysUser,
  SysSession,
  SysAccount,
  SysVerification,
  SysOrganization,
  SysMember,
  SysInvitation,
  SysTeam,
  SysTeamMember,
  SysScimProvider,
  SysOauthApplication,
  SysOauthAccessToken,
  SysOauthRefreshToken,
  SysOauthConsent,
  SysJwks,
} from '@objectstack/platform-objects';

const BASE = 'http://localhost:3000';
const AUTH = `${BASE}/api/v1/auth`;
const SECRET = 'test-secret-at-least-32-chars-long-8192';

const SCIM_PROVIDER_OBJECT = 'sys_scim_provider';
const OAUTH_APPLICATION_OBJECT = 'sys_oauth_application';

/**
 * SHA-256 → base64url, unpadded. Recomputed HERE rather than imported from
 * better-auth: an expectation produced by the implementation under test cannot
 * fail. This mirrors `@better-auth/utils`' `defaultKeyHasher`, and #8011
 * measured the two agree byte for byte.
 */
function sha256b64url(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('base64url');
}

/**
 * The SCIM bearer handed to the IdP admin is
 * `base64url("BASE:providerId:organizationId")`. The stored digest covers the
 * inner `BASE` only — see `generateSCIMToken` in `@better-auth/scim`.
 */
function decodeInnerBaseToken(bearer: string): string {
  return Buffer.from(bearer, 'base64url').toString('utf8').split(':')[0];
}

const engines: ObjectQL[] = [];
afterEach(async () => {
  while (engines.length) {
    const e = engines.pop();
    try {
      await (e as unknown as { destroy?(): Promise<void> })?.destroy?.();
    } catch {
      /* noop */
    }
  }
});

/** The identity surface the org + admin + scim + oauth-provider plugins touch. */
const AUTH_OBJECTS = [
  SysUser,
  SysSession,
  SysAccount,
  SysVerification,
  SysOrganization,
  SysMember,
  SysInvitation,
  SysTeam,
  SysTeamMember,
  SysScimProvider,
  SysOauthApplication,
  SysOauthAccessToken,
  SysOauthRefreshToken,
  SysOauthConsent,
  SysJwks,
];

async function bootEngine(): Promise<ObjectQL> {
  const engine = new ObjectQL();
  engines.push(engine);
  engine.registerDriver(
    new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    }),
    true,
  );
  await engine.init();
  // `packageId` is a REQUIRED parameter; several older harnesses in this package
  // omit it and are part of why plugin-auth carries a TEST_DEBT entry. Passing
  // it keeps this file out of that pile and records real provenance.
  for (const object of AUTH_OBJECTS) {
    engine.registry.registerObject(object as never, '@objectstack/plugin-auth');
  }
  await engine.syncSchemas();
  return engine;
}

/**
 * The stored row read at DRIVER level — below every engine read mask, and below
 * the plugin accessor that would happily tell us what it *meant* to store.
 */
async function readRowsAtRest(
  engine: ObjectQL,
  object: string,
): Promise<Record<string, unknown>[]> {
  const driver = (
    engine as unknown as {
      getDriver(o: string): { find(o: string, q: unknown): Promise<unknown> };
    }
  ).getDriver(object);
  const found = await driver.find(object, { where: {} });
  return (Array.isArray(found) ? found : [found]).filter(Boolean) as Record<string, unknown>[];
}

function cookiesFrom(response: Response): string {
  return (response.headers.get('set-cookie') ?? '')
    .split(',')
    .map((c) => c.split(';')[0].trim())
    .filter(Boolean)
    .join('; ');
}

/** Sign up through the real pipeline and return the session cookie header. */
async function signUpAdmin(
  send: (request: Request) => Promise<Response>,
  email = 'admin@example.com',
): Promise<string> {
  const res = await send(
    new Request(`${AUTH}/sign-up/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: BASE },
      body: JSON.stringify({ email, password: 'S3cure!Passw0rd-8192', name: 'Admin' }),
    }),
  );
  expect(res.status, `sign-up/email failed: ${await res.clone().text()}`).toBeLessThan(400);
  return cookiesFrom(res);
}

async function createOrganization(
  send: (request: Request) => Promise<Response>,
  cookie: string,
  slug: string,
): Promise<string> {
  const res = await send(
    new Request(`${AUTH}/organization/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: BASE, cookie },
      body: JSON.stringify({ name: 'Probe Org', slug }),
    }),
  );
  expect(res.status, `organization/create failed: ${await res.clone().text()}`).toBeLessThan(400);
  const body = (await res.json()) as Record<string, unknown>;
  const id = (body?.id ?? (body?.organization as Record<string, unknown>)?.id) as string;
  expect(id, 'organization/create must return an organization id').toBeTruthy();
  return id;
}

async function generateScimToken(
  send: (request: Request) => Promise<Response>,
  cookie: string,
  organizationId: string,
  providerId = 'okta-probe',
): Promise<string> {
  const res = await send(
    new Request(`${AUTH}/scim/generate-token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: BASE, cookie },
      body: JSON.stringify({ providerId, organizationId }),
    }),
  );
  expect(res.status, `scim/generate-token failed: ${await res.clone().text()}`).toBeLessThan(400);
  const body = (await res.json()) as { scimToken?: string };
  expect(body.scimToken, 'generate-token must return the plaintext bearer exactly once').toBeTruthy();
  return body.scimToken!;
}

/**
 * The manager under test — built exactly the way a deployment with SCIM and the
 * OIDC provider turned on builds it. Nothing here names `storeSCIMToken` or
 * `storeClientSecret`; those come from `AuthManager.buildPluginList()`, which is
 * the whole point.
 */
function makeManager(engine: ObjectQL): AuthManager {
  return new AuthManager({
    secret: SECRET,
    baseUrl: BASE,
    dataEngine: engine as never,
    // ADR-0093 D5 / #5233 — `organization/create` is gated by the EFFECTIVE
    // tenancy posture. SCIM tokens are org-scoped by construction, so a wall
    // that is actually in force is part of the fixture, not part of the claim.
    getTenancy: () => createTenancyService({ requested: 'isolated', probeIsolation: () => true }),
    plugins: {
      scim: true,
      organization: true,
      oidcProvider: true,
      dynamicClientRegistration: true,
    },
  } as never);
}

describe('[#8192] sys_scim_provider.scim_token is hashed at rest — via the repo’s own wiring', () => {
  it('② the persisted bearer is the SHA-256 digest of the INNER base token, never cleartext', async () => {
    const engine = await bootEngine();
    const manager = makeManager(engine);
    const send = (request: Request) => manager.handleRequest(request);

    const cookie = await signUpAdmin(send);
    const organizationId = await createOrganization(send, cookie, 'probe-org-8192');
    const bearer = await generateScimToken(send, cookie, organizationId);

    const rows = await readRowsAtRest(engine, SCIM_PROVIDER_OBJECT);
    expect(rows).toHaveLength(1);
    const stored = String(rows[0].scim_token);
    const inner = decodeInnerBaseToken(bearer);

    // Sanity on the decode itself, so a change in the bearer's SHAPE surfaces
    // here rather than silently turning the cases below into tautologies.
    expect(inner).toBeTruthy();
    expect(inner).not.toBe(bearer);
    expect(Buffer.from(bearer, 'base64url').toString('utf8')).toContain(`:${organizationId}`);

    // ②-a THE POSITIVE. Recomputed by node:crypto from the observed plaintext.
    expect(stored).toBe(sha256b64url(inner));

    // ②-b THE NEGATIVE THAT CATCHES THE NAIVE PIN. Hashing the full bearer —
    // the string the caller actually received — must NOT match. #8011 measured
    // this; without the case, a future rewrite could "simplify" ②-a into the
    // shape that fails while the code is correct.
    expect(stored).not.toBe(sha256b64url(bearer));

    // ②-c not cleartext, in either spelling, anywhere in the row.
    expect(stored).not.toBe(bearer);
    expect(stored).not.toBe(inner);
    expect(JSON.stringify(rows[0])).not.toContain(inner);
    expect(JSON.stringify(rows[0])).not.toContain(bearer);
  }, 60_000);

  it('② the hashed credential still AUTHENTICATES a real SCIM 2.0 request', async () => {
    // The half that stops "hash it" from being satisfiable by storing garbage:
    // a build that persisted a digest of the wrong thing would pass the at-rest
    // case above and break every IdP provisioning call.
    const engine = await bootEngine();
    const manager = makeManager(engine);
    const send = (request: Request) => manager.handleRequest(request);

    const cookie = await signUpAdmin(send);
    const organizationId = await createOrganization(send, cookie, 'probe-org-8192-auth');
    const bearer = await generateScimToken(send, cookie, organizationId);

    const ok = await send(
      new Request(`${AUTH}/scim/v2/Users`, {
        method: 'GET',
        headers: { origin: BASE, authorization: `Bearer ${bearer}` },
      }),
    );
    expect(ok.status, `SCIM v2 Users rejected a freshly minted bearer: ${await ok.clone().text()}`)
      .toBe(200);

    // …and a bearer that is merely well-formed is still refused, so the 200
    // above is evidence of verification rather than of an open door.
    const forged = Buffer.from(`not-the-base-token:okta-probe:${organizationId}`, 'utf8')
      .toString('base64url');
    const denied = await send(
      new Request(`${AUTH}/scim/v2/Users`, {
        method: 'GET',
        headers: { origin: BASE, authorization: `Bearer ${forged}` },
      }),
    );
    expect(denied.status).toBe(401);
  }, 60_000);
});

describe('[#8192] sys_oauth_application.client_secret is hashed at rest', () => {
  it('① the persisted secret is the SHA-256 digest of the issued secret, never cleartext', async () => {
    const engine = await bootEngine();
    const manager = makeManager(engine);
    const send = (request: Request) => manager.handleRequest(request);

    // RFC 7591 dynamic client registration — the repo's own DCR wiring.
    const res = await send(
      new Request(`${AUTH}/oauth2/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: BASE },
        body: JSON.stringify({
          client_name: 'issue-8192-probe',
          redirect_uris: ['https://example.com/cb'],
        }),
      }),
    );
    expect(res.status, `oauth2/register failed: ${await res.clone().text()}`).toBeLessThan(400);
    const body = (await res.json()) as { client_secret?: string; client_id?: string };
    const issued = body.client_secret;
    expect(issued, 'registration must return the plaintext secret exactly once').toBeTruthy();

    const rows = await readRowsAtRest(engine, OAUTH_APPLICATION_OBJECT);
    expect(rows).toHaveLength(1);
    const stored = String(rows[0].client_secret);

    // ①-a THE POSITIVE — independently recomputed.
    expect(stored).toBe(sha256b64url(issued!));
    // ①-b not cleartext, and not some reversible re-encoding of it.
    expect(stored).not.toBe(issued);
    expect(Buffer.from(stored, 'base64url').toString('utf8')).not.toContain(issued!);
    expect(JSON.stringify(rows[0])).not.toContain(issued);
  }, 60_000);
});

describe('[#8192] the control arm — what the SCIM plugin does with NO option', () => {
  it('③ upstream’s default persists the bearer in CLEARTEXT, so the literal is load-bearing', async () => {
    // This is the ablation, kept. It constructs `scim()` with upstream defaults
    // — deliberately NOT through AuthManager — and measures the posture the repo
    // would inherit if `storeSCIMToken: 'hashed'` were dropped from
    // `auth-manager.ts`. It is the reason the cases above mean something.
    //
    // If this case ever goes RED, upstream changed its default. That is
    // INFORMATION for whoever is doing the #3653 rc.2 migration, not a defect:
    // re-read whether the explicit literal is still load-bearing, and update
    // this file's header table. Do not "fix" it by deleting the literal.
    const engine = await bootEngine();
    const { scim } = await import('@better-auth/scim');
    const { organization } = await import('better-auth/plugins/organization');
    const { admin } = await import('better-auth/plugins/admin');

    const auth = betterAuth({
      secret: SECRET,
      baseURL: BASE,
      basePath: '/api/v1/auth',
      trustedOrigins: [BASE],
      emailAndPassword: { enabled: true },
      // The same column mapping AuthManager applies — without it better-auth
      // writes camelCase keys the sys_* objects do not declare, and the control
      // arm would fail for a reason that has nothing to do with token storage.
      user: { ...AUTH_USER_CONFIG },
      session: { ...AUTH_SESSION_CONFIG },
      account: { ...AUTH_ACCOUNT_CONFIG },
      verification: { ...AUTH_VERIFICATION_CONFIG },
      database: createObjectQLAdapterFactory(engine as never),
      plugins: [
        admin({ schema: buildAdminPluginSchema() } as never),
        organization({ schema: buildOrganizationPluginSchema() } as never),
        // No `storeSCIMToken` — upstream's own default.
        scim() as never,
      ],
    });
    const send = (request: Request) => auth.handler(request);

    const cookie = await signUpAdmin(send, 'control@example.com');
    const organizationId = await createOrganization(send, cookie, 'control-org-8192');
    const bearer = await generateScimToken(send, cookie, organizationId);

    const rows = await readRowsAtRest(engine, SCIM_PROVIDER_OBJECT);
    expect(rows).toHaveLength(1);
    const stored = String(rows[0].scim_token);
    const inner = decodeInnerBaseToken(bearer);

    // The measured exposure: the inner base token, verbatim, on disk.
    expect(
      stored,
      'upstream @better-auth/scim no longer defaults to cleartext — see this case’s comment',
    ).toBe(inner);
    expect(stored).not.toBe(sha256b64url(inner));
  }, 60_000);
});
