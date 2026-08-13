// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8102] ADR-0069 D5.1's `/oauth2/authorize` env-access gate must run for an
 * AUTHENTICATED subject on EVERY credential spelling — including the signed
 * bearer the documented API lane hands out.
 *
 * ## The defect this pins
 *
 * The gate's branch resolved its subject with an INLINE COPY of `resolveActor`
 * — line for line the same logic, in a second place. #8101 fixed one bug in the
 * shared resolver (`session.token` stores the UNSIGNED value, while `bearer()`
 * hands clients the SIGNED form in `set-auth-token` and accepts it back, so a
 * bearer credential must have its signature stripped before lookup) and left
 * the copy untouched. From that moment the two disagreed about what a signed
 * bearer means.
 *
 * What makes it `security` rather than a lookup miss is the FAIL-OPEN default
 * sitting immediately behind it. The unresolved case is deliberately permissive
 * — *"Unauthenticated -> fall through so the OP redirects to login"* — so an
 * authenticated caller holding the signed bearer was read as unauthenticated
 * and the org-membership / app-assignment check never evaluated at all. Not a
 * denied request: a request that was never judged, which then proceeded to be
 * issued an authorization code.
 *
 * The fail-open default itself is CORRECT and is deliberately preserved (a
 * genuinely anonymous caller must still reach the OP's login redirect). This
 * file pins the authenticated case only.
 *
 * ## Why the fixture is shaped the way it is
 *
 * Three ways a test of this surface can be green while proving nothing, all
 * three closed here on purpose:
 *
 *  1. **Driven with a cookie, it passes before and after the fix.** The inline
 *     copy's cookie branch always stripped the signature; only the bearer
 *     branch did not. So the cookie lane cannot detect this defect — it is
 *     carried below as the CONTROL that proves the gate is armed and the
 *     fixture wired, and the signed-bearer lane is the actual regression pin.
 *     Both bearer spellings are driven for the same reason `#8049` drives both:
 *     the raw sign-in token happens to match the stored column verbatim, so it
 *     too passes on the broken build. Exactly ONE of the three lanes flips.
 *  2. **Against a gate that ALLOWS, refusal and fall-through are the same
 *     observation.** The gate here DENIES, so the two outcomes are distinct and
 *     opposite: refused (403 `ENV_ACCESS_DENIED`, no code) versus fell through
 *     (302 to the redirect URI carrying `code=`). The client is seeded with
 *     `skip_consent`, so fall-through really does mint a code for a subject the
 *     gate would have denied — the assertion is the security failure itself,
 *     not a proxy for it.
 *  3. **With no gate configured at all it is vacuously green.**
 *     `oidcAuthorizeGate` is unset in open editions / self-host (it is a cloud
 *     control-plane hook), and the pre-existing
 *     `oidc-authorization-code-flow.dogfood.test.ts` drives this same endpoint
 *     with none set. This file installs one through `applyConfigPatch` — the
 *     same seam settings writes use — and asserts it was actually CALLED, with
 *     the right `userId`. A gate that never ran cannot deny anything, and the
 *     call recorder is what tells the two apart.
 *
 * The invocation assertion is the sharp one: it distinguishes "resolved the
 * subject and denied it" from "resolved nothing and skipped the check", which
 * a status code alone cannot do.
 */

import { createHash } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { assertArmed, authSettingArmed } from './armed.js';

// Must be on before the AuthPlugin builds its plugin list (kernel.use during
// bootStack), or /oauth2/authorize is not mounted and every assertion below
// would be measuring a 404.
process.env.OS_OIDC_PROVIDER_ENABLED = 'true';

const CLIENT_ID = 'project_envgate_8102';
const CLIENT_SECRET = 'envgate-plaintext-secret';
const REDIRECT_URI = 'https://env.example.com/api/v1/auth/callback/objectstack-cloud';

const ADMIN_EMAIL = 'admin@objectos.ai';
const ADMIN_PASSWORD = 'admin123';

/** SHA-256 -> base64url (no padding) — @better-auth/oauth-provider defaultHasher. */
function hashSecret(plaintext: string): string {
  return createHash('sha256').update(plaintext)
    .digest('base64')
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

/** Collect a response's Set-Cookie values into a single request Cookie header. */
function cookieHeader(res: Response): string {
  const jar = res.headers.getSetCookie?.() ?? [];
  return jar.map((c) => c.split(';')[0]).join('; ');
}

/**
 * One authenticated transport. `credential` picks this lane's credential out of
 * a sign-in response; `headers` turns it into the request headers that lane
 * would send.
 */
interface Lane {
  readonly name: string;
  /** Does this lane's credential spelling detect the #8102 defect? */
  readonly pinsTheDefect: boolean;
  credential(res: Response, body: { token?: string }): string;
  headers(credential: string): Record<string, string>;
}

const LANES: Lane[] = [
  {
    // CONTROL. The browser lane the OP is normally driven by, and the one the
    // inline copy already normalized — green before and after the fix. It is
    // here to prove the gate is armed and denying, so a red bearer lane below
    // cannot be dismissed as "the fixture never worked".
    name: 'cookie (control — normalized even on the broken build)',
    pinsTheDefect: false,
    credential: (res) => cookieHeader(res),
    headers: (c) => ({ Cookie: c }),
  },
  {
    // THE PIN. `bearer()` hands this to clients in the `set-auth-token`
    // response header; it is the documented API-lane credential and the only
    // spelling that fails against the unfixed build.
    name: 'bearer, signed set-auth-token (THE PIN)',
    pinsTheDefect: true,
    credential: (res) => res.headers.get('set-auth-token') ?? '',
    headers: (c) => ({ Authorization: `Bearer ${c}` }),
  },
  {
    // CONTROL. The other accepted spelling: the raw session token from the
    // sign-in body, which matches the stored column verbatim and so resolved
    // fine even on the broken build.
    name: 'bearer, raw sign-in token (control — matches the column verbatim)',
    pinsTheDefect: false,
    credential: (_res, body) => body.token ?? '',
    headers: (c) => ({ Authorization: `Bearer ${c}` }),
  },
];

/** One recorded `oidcAuthorizeGate` invocation. */
interface GateCall {
  readonly userId: string;
  readonly clientId: string;
}

describe('#8102: the D5.1 /oauth2/authorize env-access gate runs on every credential spelling', () => {
  let stack: VerifyStack;
  let adminUserId: string;
  let gateCalls: GateCall[] = [];

  beforeAll(async () => {
    stack = await bootStack(showcaseStack, {});

    // Seed the OAuth client the way cloud's seedPlatformSsoClient does.
    // `skip_consent` matters: without it a fall-through would stop at a consent
    // screen and look like a refusal. With it, falling through mints a code.
    const ql = await stack.kernel.getServiceAsync<any>('objectql');
    const nowIso = new Date().toISOString();
    await ql.insert('sys_oauth_application', {
      id: 'oauthc_envgate_8102',
      name: 'Env Gate Pin',
      client_id: CLIENT_ID,
      client_secret: hashSecret(CLIENT_SECRET),
      type: 'web',
      redirect_uris: JSON.stringify([REDIRECT_URI]),
      grant_types: JSON.stringify(['authorization_code', 'refresh_token']),
      response_types: JSON.stringify(['code']),
      scopes: JSON.stringify(['openid', 'email', 'profile']),
      token_endpoint_auth_method: 'client_secret_basic',
      require_pkce: false,
      skip_consent: true,
      disabled: false,
      subject_type: 'public',
      created_at: nowIso,
      updated_at: nowIso,
    }, { context: { isSystem: true } });

    // Arm the gate. Unset (the default for open editions) there is no gate at
    // all and every assertion in this file would pass on the broken build.
    // DENY, so "refused" and "fell through" are opposite observations.
    const auth = await stack.kernel.getServiceAsync<any>('auth');
    auth.applyConfigPatch({
      oidcAuthorizeGate: (params: { userId: string; clientId: string }) => {
        gateCalls.push({ userId: params.userId, clientId: params.clientId });
        return false;
      },
    });

    // [#8074] The comment above says it in prose; this reads it back off the
    // live manager. `this.config.oidcAuthorizeGate` is consulted only when it
    // is truthy, so an unset gate means the branch under test never executes
    // and "the request was refused" cannot be told from "there was no gate".
    await assertArmed([
      authSettingArmed({
        stack,
        setting: 'oidcAuthorizeGate',
        armed: (v) => typeof v === 'function',
        control: 'the cloud control-plane OIDC authorize gate',
        disarmedBy:
          '`oidcAuthorizeGate` is unset in open editions, so the hook never runs and every ' +
          'assertion in this file passes on the broken build. Install one through ' +
          '`applyConfigPatch`.',
        describe: (v) => (typeof v === 'function' ? 'a function (installed)' : String(v)),
      }),
    ]);

    const user = (await ql.find(
      'sys_user',
      { where: { email: ADMIN_EMAIL }, limit: 1 },
      { context: { isSystem: true } },
    ))[0];
    adminUserId = String(user?.id ?? '');
    expect(adminUserId, 'fixture: could not read the admin user id').toBeTruthy();
  }, 180_000);

  afterAll(async () => { await stack?.stop?.(); });

  /** Sign in through the real route and hand back every lane's credential. */
  async function signIn() {
    const res = await stack.api('/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
    });
    const body = res.status === 200 ? ((await res.clone().json()) as { token?: string }) : {};
    return { res, body };
  }

  function authorizeQuery(): string {
    return new URLSearchParams({
      response_type: 'code',
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      scope: 'openid email profile',
      state: 'envgate-8102',
    }).toString();
  }

  for (const lane of LANES) {
    // eslint-disable-next-line vitest/valid-title
    describe(`lane: ${lane.name}`, () => {
      it('a denying gate REFUSES the authorize request, and is actually invoked with the caller as its subject', async () => {
        const { res: signInRes, body } = await signIn();
        expect(signInRes.status, await signInRes.clone().text()).toBe(200);
        const credential = lane.credential(signInRes, body);
        expect(credential, `${lane.name}: sign-in yielded no credential`).toBeTruthy();

        gateCalls = [];
        const res = await stack.api(`/auth/oauth2/authorize?${authorizeQuery()}`, {
          headers: lane.headers(credential),
          redirect: 'manual',
        });

        // (1) The gate RAN, and resolved this caller as its subject. This is
        // what separates "denied" from "never evaluated" — on the unfixed build
        // the signed-bearer lane recorded zero calls here.
        expect(
          gateCalls.length,
          `${lane.name}: oidcAuthorizeGate was never invoked — the subject did not resolve, `
          + 'so the env-access check was skipped entirely (fail-open)',
        ).toBe(1);
        expect(gateCalls[0].userId).toBe(adminUserId);
        expect(gateCalls[0].clientId).toBe(CLIENT_ID);

        // (2) The request was REFUSED — code AND status, per the ADR-0112
        // envelope. Not "did not obviously succeed".
        const text = await res.clone().text();
        expect(res.status, `${lane.name}: ${text}`).toBe(403);
        const refusal: any = await res.json().catch(() => ({}));
        expect(refusal?.code ?? refusal?.error?.code).toBe('ENV_ACCESS_DENIED');

        // (3) …and refused rather than fallen through: no authorization code
        // was minted for a subject the gate denied. On the unfixed build this
        // was a 302 to the redirect URI carrying `code=`.
        const location = res.headers.get('location') ?? '';
        expect(location, `${lane.name}: redirected instead of refusing`).toBe('');
        expect(text).not.toContain('code=');
      }, 120_000);

      it('the same request with an ALLOWING gate is let through — the refusal above is the gate talking, not a broken request', async () => {
        const auth = await stack.kernel.getServiceAsync<any>('auth');
        const seen: GateCall[] = [];
        auth.applyConfigPatch({
          oidcAuthorizeGate: (params: { userId: string; clientId: string }) => {
            seen.push({ userId: params.userId, clientId: params.clientId });
            return true;
          },
        });
        try {
          const { res: signInRes, body } = await signIn();
          const credential = lane.credential(signInRes, body);
          const res = await stack.api(`/auth/oauth2/authorize?${authorizeQuery()}`, {
            headers: lane.headers(credential),
            redirect: 'manual',
          });

          expect([302, 303]).toContain(res.status);
          const location = res.headers.get('location') ?? '';
          expect(location.startsWith(REDIRECT_URI)).toBe(true);
          expect(new URL(location).searchParams.get('code')).toBeTruthy();
          // The allow lane proves the endpoint works; it proves nothing about
          // the DEFECT — an unresolved subject also reaches this outcome. Only
          // the recorder distinguishes them, so assert it here too.
          expect(seen.length, `${lane.name}: gate not invoked on the allow pass`).toBe(1);
          expect(seen[0].userId).toBe(adminUserId);
        } finally {
          auth.applyConfigPatch({
            oidcAuthorizeGate: (params: { userId: string; clientId: string }) => {
              gateCalls.push({ userId: params.userId, clientId: params.clientId });
              return false;
            },
          });
        }
      }, 120_000);
    });
  }

  it('fixture self-check: exactly ONE lane is the discriminator', () => {
    // The file's central claim is that two of the three lanes CANNOT detect
    // this defect and are carried as controls. If a later edit made a second
    // lane the pin — or dropped the signed-bearer lane — the suite would still
    // be green while proving something else, so the claim is asserted rather
    // than only written down. (This also keeps `pinsTheDefect` a field that is
    // read, not merely declared.)
    expect(LANES.filter((l) => l.pinsTheDefect).map((l) => l.name)).toEqual([
      'bearer, signed set-auth-token (THE PIN)',
    ]);
  });

  it('an UNAUTHENTICATED caller still falls through to the OP login redirect (the fail-open default is deliberate)', async () => {
    gateCalls = [];
    const res = await stack.api(`/auth/oauth2/authorize?${authorizeQuery()}`, {
      redirect: 'manual',
    });
    // Never judged, because there is no subject to judge — the OP takes over
    // and sends the browser to log in. Changing THIS is a separate decision;
    // the assertion exists so a future "fix" to the fail-open default cannot
    // land silently under cover of this file.
    expect(gateCalls.length, 'the gate must not run without a resolved subject').toBe(0);
    expect(res.status).not.toBe(403);
  }, 120_000);
});
