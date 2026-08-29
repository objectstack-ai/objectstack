// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8192 → #3653] The credential-at-rest posture for
 * `sys_scim_connection_credential.token_digest` and
 * `sys_oauth_application.client_secret` is PINNED here.
 *
 * ## History — why the SCIM half of this file changed shape (#3653)
 *
 * This file originally pinned `sys_scim_provider.scim_token`, whose hashing
 * hung on a single option literal: `scim({ storeSCIMToken: 'hashed' })` in
 * `auth-manager.ts`, against an upstream default of **`'plain'` — cleartext**.
 * The stable `@better-auth/scim` 1.7.x line VACATED that posture rather than
 * weakening it: `storeSCIMToken`, `/scim/generate-token` and the
 * `scimProvider` model are all gone (0 occurrences), and **no stable model
 * declares any token/secret/credential column at all** — upstream stores
 * nothing. Under the application-owned `verifyBearerToken` route ObjectStack
 * now owns the whole credential lifecycle — mint, store, verify — in
 * `scim-connection-service.ts` + `sys_scim_connection_credential`.
 *
 * So the pin moved WITH the credential. The posture it holds is deliberately
 * at parity or better than what the old literal bought:
 *
 * | column | posture | how it is obtained |
 * |:---|:---|:---|
 * | `sys_scim_connection_credential.token_digest` | HMAC-SHA-256(secret, "scim-credential-v1:" + token), base64url | `mintScimConnectionCredential()` — ObjectStack code, no upstream default to fall back to |
 * | `sys_oauth_application.client_secret` | SHA-256(secret), base64url | IMPLICIT — `@better-auth/oauth-provider` resolves `storeClientSecret: 'hashed'` |
 *
 * "Better": rc.1 stored an UNSALTED SHA-256 of the token; the keyed digest
 * additionally resists offline table matching if the table leaks without the
 * deployment secret. Case ②-b pins the unkeyed shape as a NEGATIVE so a
 * future "simplification" back to bare SHA-256 goes red.
 *
 * ## The control arm, restated honestly (#3653)
 *
 * Case ③ used to construct `scim()` with NO option and MEASURE upstream's
 * cleartext default — proof the repo literal was load-bearing. That arm is no
 * longer measurable, because upstream now stores nothing at all: there is no
 * upstream write path to compare against. Its honest successor asserts the
 * fact that vacated it, from the installed artifact itself: no stable scim
 * model declares a credential-shaped column, and the rc.1 mint endpoint
 * answers 404 through the repo's own manager. If ③ ever goes RED, upstream
 * has grown a credential store again — re-read whether ObjectStack's own
 * mint/verify is still the right ownership boundary before touching anything
 * here (do NOT delete the service to get green).
 *
 * ## What makes this pin non-vacuous — the same five choices, restated
 *
 * 1. **Verification drives `AuthManager`.** The AUTHENTICATES cases run
 *    against `manager.handleRequest()`, so the `verifyBearerToken` wiring in
 *    `auth-manager.ts` — not the service called directly — is inside the
 *    system under test. (Mint has no HTTP surface yet by design — the Setup
 *    admin surface is its own epic leg — so ② mints through the service the
 *    manager's verifier reads.)
 * 2. **It reads the row at DRIVER level**, below the ObjectQL read mask and
 *    below the service's own accessor.
 * 3. **It asserts the digest RELATIONSHIP, recomputed independently** with
 *    `node:crypto` here — not by importing the service's digest function,
 *    which would certify whatever the implementation does.
 * 4. **It pins the wrong-digest shapes as explicit NEGATIVES**: the unkeyed
 *    SHA-256 (the rc.1 posture), a wrong-key HMAC, and a missing
 *    domain-separation prefix must all NOT match the stored value.
 * 5. **Each positive case asserts the credential still AUTHENTICATES** a real
 *    SCIM 2.0 request — hashing is trivially satisfiable by storing garbage —
 *    and the rejection paths (forged, revoked, expired) pin status and error
 *    envelope, so the 200 is evidence of verification, not an open door.
 *
 * ## Backend note
 *
 * A real `ObjectQL` over `@objectstack/driver-sql` + better-sqlite3
 * `:memory:`, the backend the sibling at-rest pin (#8009) already uses.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createHash, createHmac } from 'node:crypto';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { AuthManager } from './auth-manager.js';
import { createTenancyService } from './tenancy-service.js';
import {
  mintScimConnectionCredential,
  SCIM_BEARER_PREFIX,
} from './scim-connection-service.js';
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
  SysScimConnectionBinding,
  SysScimConnectionCredential,
  SysScimGroup,
  SysScimGroupMember,
  SysScimIdentityTombstone,
  SysScimProjectionGrant,
  SysScimSubject,
  SysScimUser,
  SysOauthApplication,
  SysOauthAccessToken,
  SysOauthRefreshToken,
  SysOauthConsent,
  SysJwks,
} from '@objectstack/platform-objects';

const BASE = 'http://localhost:3000';
const AUTH = `${BASE}/api/v1/auth`;
const SECRET = 'test-secret-at-least-32-chars-long-8192';

const SCIM_CREDENTIAL_OBJECT = 'sys_scim_connection_credential';
const OAUTH_APPLICATION_OBJECT = 'sys_oauth_application';

/**
 * SHA-256 → base64url, unpadded. Recomputed HERE rather than imported: an
 * expectation produced by the implementation under test cannot fail. Positive
 * oracle for the oauth case (①), and the UNKEYED negative for the scim case
 * (②-b) — the rc.1-era posture the keyed digest deliberately exceeds.
 */
function sha256b64url(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('base64url');
}

/**
 * The scim digest relationship, recomputed independently with `node:crypto`:
 * HMAC-SHA-256 keyed by the deployment auth secret over the domain-separated
 * bearer. Mirrors `scim-connection-service.ts`'s documented construction —
 * the negatives in ②-b are what keep this from being a tautology if the two
 * ever drift.
 */
function hmacScimDigest(secret: string, token: string): string {
  return createHmac('sha256', secret).update(`scim-credential-v1:${token}`, 'utf8').digest('base64url');
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
  // The stable scim model set + the ObjectStack-owned credential store (#3653).
  SysScimConnectionBinding,
  SysScimConnectionCredential,
  SysScimGroup,
  SysScimGroupMember,
  SysScimIdentityTombstone,
  SysScimProjectionGrant,
  SysScimSubject,
  SysScimUser,
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
 * the service accessor that would happily tell us what it *meant* to store.
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

/**
 * The manager under test — built exactly the way a deployment with SCIM and the
 * OIDC provider turned on builds it. Nothing here names a digest or a storage
 * method; the verifier wiring comes from `AuthManager.buildPluginList()`, which
 * is the whole point.
 */
function makeManager(engine: ObjectQL): AuthManager {
  return new AuthManager({
    secret: SECRET,
    baseUrl: BASE,
    dataEngine: engine as never,
    // ADR-0093 D5 / #5233 — `organization/create` is gated by the EFFECTIVE
    // tenancy posture; a wall that is actually in force is part of the fixture.
    getTenancy: () => createTenancyService({ requested: 'isolated', probeIsolation: () => true }),
    plugins: {
      scim: true,
      organization: true,
      oidcProvider: true,
      dynamicClientRegistration: true,
    },
  } as never);
}

describe('[#8192/#3653] sys_scim_connection_credential.token_digest is a keyed one-way digest — via the repo’s own wiring', () => {
  it('② the persisted value is the keyed HMAC of the bearer, never cleartext and never the unkeyed rc.1 shape', async () => {
    const engine = await bootEngine();

    const { token, credentialId } = await mintScimConnectionCredential(engine as never, SECRET, {
      connectionId: 'okta-probe',
      organizationId: 'probe-org-8192',
    });
    expect(token.startsWith(SCIM_BEARER_PREFIX)).toBe(true);
    expect(credentialId).toBeTruthy();

    const rows = await readRowsAtRest(engine, SCIM_CREDENTIAL_OBJECT);
    expect(rows).toHaveLength(1);
    const stored = String(rows[0].token_digest);

    // ②-a THE POSITIVE. Recomputed by node:crypto from the observed plaintext.
    expect(stored).toBe(hmacScimDigest(SECRET, token));

    // ②-b THE NEGATIVES THAT CATCH THE WRONG SHAPES. The unkeyed SHA-256 is
    // the rc.1 posture this store deliberately exceeds; the wrong-key HMAC
    // pins that the digest is bound to THIS deployment's secret; the
    // no-domain-separation HMAC pins the input framing. Any of these matching
    // means the relationship in ②-a stopped being what this file claims.
    expect(stored).not.toBe(sha256b64url(token));
    expect(stored).not.toBe(hmacScimDigest('a-different-secret-32-chars-long!!', token));
    expect(stored).not.toBe(createHmac('sha256', SECRET).update(token, 'utf8').digest('base64url'));

    // ②-c not cleartext, in any spelling, anywhere in the row.
    expect(stored).not.toBe(token);
    expect(JSON.stringify(rows[0])).not.toContain(token);
  }, 60_000);

  it('② the digested credential still AUTHENTICATES a real SCIM 2.0 request — and the rejection paths refuse', async () => {
    // The half that stops "digest it" from being satisfiable by storing
    // garbage: a build that digested the wrong thing would pass the at-rest
    // case above and break every IdP provisioning call.
    const engine = await bootEngine();
    const manager = makeManager(engine);
    const send = (request: Request) => manager.handleRequest(request);

    const { token } = await mintScimConnectionCredential(engine as never, SECRET, {
      connectionId: 'okta-probe',
    });

    const ok = await send(
      new Request(`${AUTH}/scim/v2/Users`, {
        method: 'GET',
        headers: { origin: BASE, authorization: `Bearer ${token}` },
      }),
    );
    expect(ok.status, `SCIM v2 Users rejected a freshly minted bearer: ${await ok.clone().text()}`)
      .toBe(200);

    // …and a bearer that is merely well-formed is still refused, so the 200
    // above is evidence of verification rather than of an open door. Pinned
    // as code+status: HTTP 401 with the SCIM 2.0 error envelope.
    const forged = `${SCIM_BEARER_PREFIX}${'A'.repeat(43)}`;
    const denied = await send(
      new Request(`${AUTH}/scim/v2/Users`, {
        method: 'GET',
        headers: { origin: BASE, authorization: `Bearer ${forged}` },
      }),
    );
    expect(denied.status).toBe(401);
    const deniedBody = (await denied.json()) as { schemas?: string[]; status?: string };
    expect(deniedBody.schemas ?? []).toContain('urn:ietf:params:scim:api:messages:2.0:Error');
    expect(String(deniedBody.status)).toBe('401');
  }, 60_000);

  it('② revocation and expiry are enforced at verification, not just stored', async () => {
    const engine = await bootEngine();
    const manager = makeManager(engine);
    const send = (request: Request) => manager.handleRequest(request);

    // Revoked: minted, then switched inactive — refused.
    const revoked = await mintScimConnectionCredential(engine as never, SECRET, {
      connectionId: 'okta-revoked',
    });
    await (engine as unknown as {
      update(o: string, data: Record<string, unknown>): Promise<unknown>;
    }).update(SCIM_CREDENTIAL_OBJECT, { id: revoked.credentialId, active: false });

    const deniedRevoked = await send(
      new Request(`${AUTH}/scim/v2/Users`, {
        method: 'GET',
        headers: { origin: BASE, authorization: `Bearer ${revoked.token}` },
      }),
    );
    expect(deniedRevoked.status).toBe(401);

    // Expired: minted with a past expiry — refused.
    const expired = await mintScimConnectionCredential(engine as never, SECRET, {
      connectionId: 'okta-expired',
      expiresAt: new Date(Date.now() - 60_000),
    });
    const deniedExpired = await send(
      new Request(`${AUTH}/scim/v2/Users`, {
        method: 'GET',
        headers: { origin: BASE, authorization: `Bearer ${expired.token}` },
      }),
    );
    expect(deniedExpired.status).toBe(401);
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

describe('[#3653] the control arm, restructured — stable upstream stores NOTHING', () => {
  it('③ no stable scim model declares a credential-shaped column, and the rc.1 mint endpoint is gone', async () => {
    // The old arm measured upstream's cleartext DEFAULT to prove the repo's
    // `storeSCIMToken: 'hashed'` literal was load-bearing. Stable upstream
    // stores no credential at all, so that comparison has no subject any more
    // — what this arm pins instead is exactly the fact that vacated it. RED
    // here means upstream grew a credential store again: re-read the
    // ownership boundary (see the file header) before changing anything.
    const { scim } = await import('@better-auth/scim');
    const plugin = scim({
      connections: [],
      authentication: { verifyBearerToken: () => null },
    } as never) as unknown as { schema?: Record<string, { fields?: Record<string, unknown> }> };

    const models = Object.entries(plugin.schema ?? {});
    expect(models.length, 'the installed scim plugin declared no schema — the sweep below would be vacuous')
      .toBeGreaterThan(0);

    const credentialish = models.flatMap(([model, def]) =>
      Object.keys(def.fields ?? {})
        .filter((field) => /token|secret|credential|digest|hash|password/i.test(field))
        .map((field) => `${model}.${field}`),
    );
    expect(credentialish).toEqual([]);

    // And through the repo's own manager: the rc.1 mint endpoint no longer
    // exists (404 — route absent, not a refusal envelope).
    const engine = await bootEngine();
    const manager = makeManager(engine);
    const res = await manager.handleRequest(
      new Request(`${AUTH}/scim/generate-token`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: BASE },
        body: JSON.stringify({ providerId: 'okta-probe', organizationId: 'probe-org' }),
      }),
    );
    expect(res.status).toBe(404);
  }, 60_000);
});
