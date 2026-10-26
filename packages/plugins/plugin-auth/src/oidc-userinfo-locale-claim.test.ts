// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The platform OP emits the standard `locale` claim (OIDC Core §5.1) at
 * `/oauth2/userinfo` — see `oidc-userinfo-locale-claim.ts` for the rule.
 *
 * Every reading is taken off a REAL `AuthManager` with its OIDC provider on,
 * over the shared in-memory engine, driven through its HTTP surface: sign-up →
 * client → authorize → consent → token → userinfo. The user's language is the
 * `sys_user.locale` column on that engine, so the claim is read exactly where
 * a deployment keeps it. An assertion on the options handed `oauthProvider()`
 * would stay green under a provider that never calls the hook; the reading has
 * to come off the userinfo body.
 *
 * The last leg is one round trip end to end: a second `AuthManager`, the
 * platform RP (`genericOAuth`, the `objectstack-cloud` provider), signs in
 * through this OP over a `fetch` routed to the OP's handler, and the RP's JIT
 * path (`idp-locale-claim.ts`) stores the claim on the RP's own `sys_user`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AuthManager } from './auth-manager';
import { PLATFORM_IDP_PROVIDER_ID } from './implicit-account-linking';
import { createMemoryEngine } from './impersonation-bearer-rotation.test';
// better-auth's first module load is paid at module load, not inside the first
// clocked case (AGENTS.md, Build & Test). `AuthManager` reaches these through a
// lazy `await import()`.
import 'better-auth';
import 'better-auth/plugins';
import 'better-auth/plugins/bearer';
import 'better-auth/plugins/generic-oauth';
import 'better-auth/plugins/organization';
import { oauthProviderOpenIdConfigMetadata } from '@better-auth/oauth-provider';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const PASSWORD = 'S3cure!Passw0rd-25529';
const OP = 'https://op.example.test';
const RP = 'https://rp.example.test';
const AUTH = '/api/v1/auth';
const AFTER = `${RP}/after-sign-in`;
const SUPPORTED = ['en', 'zh-CN', 'ja-JP'];
const DISCOVERY = `${OP}/.well-known/openid-configuration`;
// RFC 7636 Appendix B verifier/challenge pair: the provider requires PKCE of every client.
const PKCE_VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const PKCE_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
/** The RP's generic-OAuth callback, in both spellings better-auth has used. */
const RP_REDIRECTS = [
  `${RP}${AUTH}/oauth2/callback/${PLATFORM_IDP_PROVIDER_ID}`,
  `${RP}${AUTH}/callback/${PLATFORM_IDP_PROVIDER_ID}`,
];

type Engine = ReturnType<typeof createMemoryEngine>;

const cookiesOf = (res: Response): string =>
  (res.headers.getSetCookie?.() ?? [res.headers.get('set-cookie') ?? ''])
    .map((c) => c.split(';')[0]!)
    .filter(Boolean)
    .join('; ');

/** A real OP: an `AuthManager` with its OIDC provider on, over `engine`. */
function makeOp(engine: Engine, warn = vi.fn()) {
  const manager = new AuthManager({
    secret: SECRET,
    baseUrl: OP,
    dataEngine: engine,
    plugins: { oidcProvider: true },
    logger: { warn },
  } as unknown as ConstructorParameters<typeof AuthManager>[0]);
  return { manager, warn };
}

async function opPost(op: AuthManager, path: string, body: unknown, cookie?: string): Promise<Response> {
  return op.handleRequest(
    new Request(`${OP}${AUTH}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: OP, ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    }),
  );
}

/** Signs a user up on the OP; answers the session cookie and the `sys_user` row. */
async function signUp(op: AuthManager, engine: Engine, email: string) {
  const res = await opPost(op, '/sign-up/email', { email, password: PASSWORD, name: 'Mia Chen' });
  expect(res.status, await res.clone().text()).toBe(200);
  const row = (engine.tables.get('sys_user') ?? []).find((u: any) => u.email === email);
  expect(row, 'sign-up wrote no sys_user row').toBeDefined();
  return { cookie: cookiesOf(res), row };
}

/** A confidential client owned by the signed-in user; answers its credentials. */
async function createClient(op: AuthManager, cookie: string, scope: string) {
  const res = await opPost(
    op,
    '/oauth2/create-client',
    {
      client_name: 'Platform RP (test)',
      redirect_uris: RP_REDIRECTS,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'client_secret_post',
      scope,
    },
    cookie,
  );
  const body: any = await res.json().catch(() => null);
  expect(res.status, JSON.stringify(body)).toBe(201);
  expect(body?.client_id && body?.client_secret, JSON.stringify(body)).toBeTruthy();
  return { clientId: body.client_id as string, clientSecret: body.client_secret as string };
}

/**
 * Follows an OP authorize URL as the signed-in user, through the consent page
 * when the OP shows one; answers the redirect back to the client.
 */
async function authorizeAs(op: AuthManager, cookie: string, authorizeUrl: string): Promise<URL> {
  const res = await op.handleRequest(new Request(authorizeUrl, { headers: { cookie } }));
  let location = res.headers.get('location') ?? '';
  expect(location, `authorize answered ${res.status} with no redirect`).toBeTruthy();
  if (location.includes('/oauth/consent')) {
    const consent = await opPost(op, '/oauth2/consent', { accept: true, oauth_query: location.slice(location.indexOf('?')) }, cookie);
    const body: any = await consent.json().catch(() => null);
    location = body?.redirect_uri ?? body?.url ?? '';
    expect(location, `consent did not produce a redirect: ${JSON.stringify(body)}`).toBeTruthy();
  }
  return new URL(location);
}

/** One OP-only grant: authorize → consent → token; answers the token response. */
async function grant(op: AuthManager, cookie: string, scope: string) {
  const { clientId, clientSecret } = await createClient(op, cookie, scope);
  const url = new URL(`${OP}${AUTH}/oauth2/authorize`);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', RP_REDIRECTS[0]!);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', scope);
  url.searchParams.set('state', 'st');
  url.searchParams.set('code_challenge', PKCE_CHALLENGE);
  url.searchParams.set('code_challenge_method', 'S256');
  const back = await authorizeAs(op, cookie, url.toString());
  const code = back.searchParams.get('code');
  expect(code, `no authorization code: ${back.href}`).toBeTruthy();
  const res = await op.handleRequest(
    new Request(`${OP}${AUTH}/oauth2/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code!,
        redirect_uri: RP_REDIRECTS[0]!,
        client_id: clientId,
        client_secret: clientSecret,
        code_verifier: PKCE_VERIFIER,
      }).toString(),
    }),
  );
  const tokens: any = await res.json().catch(() => null);
  expect(res.status, JSON.stringify(tokens)).toBe(200);
  expect(tokens?.access_token, 'no access token was minted').toBeTruthy();
  return tokens as { access_token: string; id_token?: string };
}

async function userInfo(op: AuthManager, accessToken: string): Promise<Record<string, unknown>> {
  const res = await op.handleRequest(
    new Request(`${OP}${AUTH}/oauth2/userinfo`, { headers: { authorization: `Bearer ${accessToken}` } }),
  );
  const body: any = await res.json().catch(() => null);
  expect(res.status, JSON.stringify(body)).toBe(200);
  return body;
}

const jwtClaims = (token: string): Record<string, unknown> =>
  JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString('utf8'));

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('the platform OP emits `locale` at userinfo under the `profile` scope', () => {
  it('⭐ a zh-CN user: userinfo carries `locale: "zh-CN"`, and the ID token does not', async () => {
    const engine = createMemoryEngine();
    const { manager: op } = makeOp(engine);
    const { cookie, row } = await signUp(op, engine, 'mia@example.test');
    row.locale = 'zh-CN';

    const tokens = await grant(op, cookie, 'openid profile email');
    const info = await userInfo(op, tokens.access_token);

    expect(info.sub).toBe(row.id);
    expect(info.locale).toBe('zh-CN');
    expect(tokens.id_token, 'openid must earn an ID token').toBeTruthy();
    expect(Object.keys(jwtClaims(tokens.id_token!)), 'userinfo only, never the ID token').not.toContain('locale');
  });

  it('a user with no language preference: no `locale` key at all', async () => {
    const engine = createMemoryEngine();
    const { manager: op } = makeOp(engine);
    const { cookie, row } = await signUp(op, engine, 'pat@example.test');
    expect(row.locale ?? null, 'the leg runs with the column unset').toBeNull();

    const info = await userInfo(op, (await grant(op, cookie, 'openid profile email')).access_token);

    expect(info.name, 'the profile scope was granted').toBe('Mia Chen');
    expect(Object.keys(info)).not.toContain('locale');
  });

  it('a stored value that is no BCP-47 tag (the stringified-nothing literal) is no claim', async () => {
    const engine = createMemoryEngine();
    const { manager: op } = makeOp(engine);
    const { cookie, row } = await signUp(op, engine, 'lee@example.test');
    row.locale = 'undefined';

    const info = await userInfo(op, (await grant(op, cookie, 'openid profile email')).access_token);

    expect(Object.keys(info)).not.toContain('locale');
  });

  it('`profile` not granted: no `locale`, and the column is never read', async () => {
    const engine = createMemoryEngine();
    const { manager: op } = makeOp(engine);
    const { cookie, row } = await signUp(op, engine, 'kim@example.test');
    row.locale = 'zh-CN';
    const findOne = vi.spyOn(engine, 'findOne');

    const tokens = await grant(op, cookie, 'openid email');
    findOne.mockClear();
    const info = await userInfo(op, tokens.access_token);

    expect(info.email, 'the email scope was granted').toBe('kim@example.test');
    expect(Object.keys(info)).not.toContain('locale');
    const localeReads = findOne.mock.calls.filter(
      ([object, q]: any[]) => object === 'sys_user' && Array.isArray(q?.fields) && q.fields.includes('locale'),
    );
    expect(localeReads, 'no profile scope, no read').toEqual([]);
  });

  it('a locale read that fails never fails userinfo: the claim is omitted, said once at warn', async () => {
    const engine = createMemoryEngine();
    const { manager: op, warn } = makeOp(engine);
    const { cookie, row } = await signUp(op, engine, 'ana@example.test');
    row.locale = 'zh-CN';
    const tokens = await grant(op, cookie, 'openid profile email');

    const realFindOne = engine.findOne.bind(engine);
    vi.spyOn(engine, 'findOne').mockImplementation(async (object: string, q: any = {}) => {
      if (object === 'sys_user' && Array.isArray(q?.fields) && q.fields.includes('locale')) {
        throw new Error('fake driver: sys_user is unreachable');
      }
      return realFindOne(object, q);
    });
    warn.mockClear();
    const info = await userInfo(op, tokens.access_token);

    expect(info.sub).toBe(row.id);
    expect(info.name).toBe('Mia Chen');
    expect(Object.keys(info)).not.toContain('locale');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![1]).toMatchObject({ userId: row.id });
  });
});

describe('one round trip end to end: the platform RP stores the OP\'s claim', () => {
  it('⭐ a JIT sign-in through this OP creates an RP user whose language is zh-CN', async () => {
    const opEngine = createMemoryEngine();
    const { manager: op } = makeOp(opEngine);
    const { cookie: opCookie, row } = await signUp(op, opEngine, 'mia@example.test');
    row.locale = 'zh-CN';
    // A cloud account's address is verified; the RP refuses to JIT-create from an unverified one.
    row.email_verified = true;
    const { clientId, clientSecret } = await createClient(op, opCookie, 'openid profile email');

    // The RP reaches the OP only through `fetch`: route the OP's origin to its
    // handler, as a network would.
    const realFetch = globalThis.fetch;
    /** What the RP asked the OP, for the failure messages below. */
    const opCalls: string[] = [];
    vi.stubGlobal('fetch', async (input: any, init?: any) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (!url.startsWith(OP)) return realFetch(input, init);
      // The discovery document is mounted at the issuer's origin by the plugin's
      // route registration (`registerOidcDiscoveryRoutes`), from this provider helper.
      const res =
        url === DISCOVERY
          ? await oauthProviderOpenIdConfigMetadata((await op.getAuthInstance()) as any)(new Request(url))
          : await op.handleRequest(new Request(input, init));
      opCalls.push(`${init?.method ?? 'GET'} ${url} -> ${res.status} ${await res.clone().text()}`);
      return res;
    });

    const rpEngine = createMemoryEngine();
    const rp = new AuthManager({
      secret: SECRET,
      baseUrl: RP,
      dataEngine: rpEngine,
      oidcProviders: [
        {
          providerId: PLATFORM_IDP_PROVIDER_ID,
          clientId,
          clientSecret,
          discoveryUrl: DISCOVERY,
          scopes: ['openid', 'profile', 'email'],
          pkce: true,
        },
      ],
      getI18n: () => ({ getLocales: () => SUPPORTED }),
    } as unknown as ConstructorParameters<typeof AuthManager>[0]);

    const begin = await rp.handleRequest(
      new Request(`${RP}${AUTH}/sign-in/social`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: PLATFORM_IDP_PROVIDER_ID, callbackURL: AFTER, disableRedirect: true }),
      }),
    );
    expect(begin.status, await begin.clone().text()).toBe(200);
    const { url: authorizeUrl } = (await begin.json()) as { url: string };

    const back = await authorizeAs(op, opCookie, authorizeUrl);
    expect(RP_REDIRECTS, `the OP redirected elsewhere: ${back.href}`).toContain(`${back.origin}${back.pathname}`);

    const callback = await rp.handleRequest(
      new Request(back.href.replace(/^https?:\/\/[^/]+/, RP), { headers: { cookie: cookiesOf(begin) } }),
    );
    expect(callback.status, await callback.clone().text()).toBe(302);
    expect(new URL(callback.headers.get('location')!, RP).href, opCalls.join('\n')).toBe(AFTER);

    const rpUser = (rpEngine.tables.get('sys_user') ?? []).find((u: any) => u.email === 'mia@example.test');
    expect(rpUser, 'the RP JIT-created no user').toBeDefined();
    expect(rpUser.locale).toBe('zh-CN');
  });
});
