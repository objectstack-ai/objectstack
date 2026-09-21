// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * MCP OAuth 2.1 track (#2698) — authorization-server wiring + the
 * resource-server half that lives on AuthManager.
 *
 * Token verification tests use REAL jose-signed JWTs against a locally
 * generated JWKS (mocked `getApi().getJwks`), so the crypto path — signature,
 * issuer, audience, expiry — is exercised for real, fail-closed on each axis.
 *
 * ⚠️ The `oauthProvider plugin wiring` block below reads the options object
 * this package passes to a MOCKED `oauthProvider`. That subject can only
 * answer "did we pass X", never "does the provider honour X" — so ⛔ never
 * assert protocol behaviour here. Anything whose truth depends on what the
 * installed provider DOES belongs in auth-manager.mcp-oauth-resource.test.ts,
 * which boots the real provider and drives the flow end to end.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SignJWT, generateKeyPair, exportJWK } from 'jose';
import { MCP_OAUTH_SCOPES } from '@objectstack/spec/ai';

import {
  AuthManager,
  resolveOidcProviderEnabled,
  resolveDcrEnabled,
  isOAuthEligibleBaseUrl,
} from './auth-manager';

// Mock better-auth so plugin-registration tests can capture the config
// without booting a real instance (same pattern as auth-manager.test.ts).
vi.mock('better-auth', () => ({
  betterAuth: vi.fn(() => ({ handler: vi.fn(), api: {} })),
}));
vi.mock('@better-auth/oauth-provider', () => ({
  oauthProvider: vi.fn((opts: any) => ({ id: 'oauth-provider', _opts: opts })),
}));

import { betterAuth } from 'better-auth';
import { oauthProvider } from '@better-auth/oauth-provider';

const ENV_KEYS = ['OS_MCP_SERVER_ENABLED', 'OS_OIDC_PROVIDER_ENABLED', 'OS_OIDC_DCR_ENABLED'] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

/**
 * The transport rule is a SECURITY BOUNDARY, so every leg below is spelled
 * out rather than sampled: the private/link-local arm that the rule opens,
 * the public arm it must keep refusing exactly as before, the loopback and
 * scheme invariants it may not disturb, and the four boundary traps a
 * text-prefix implementation would get wrong.
 *
 * Shape ruled by the maintainer (2026-09-21): a DEPLOYMENT-level rule with
 * the semantics of Keycloak's `sslRequired=external` — plain HTTP on a
 * loopback or private / link-local host, TLS everywhere else, ⛔ no
 * configuration key and ⛔ no environment variable, and no separate
 * development-mode branch (a dev bind on a LAN address IS a private address).
 */
describe('isOAuthEligibleBaseUrl (OAuth 2.1 transport rule — TLS public, plain HTTP private)', () => {
  // ── The arm this rule OPENS ───────────────────────────────────────────
  it.each([
    ['http://10.0.0.5:3000', true],
    ['http://192.168.1.10', true],
    ['http://172.16.0.1', true],
    ['http://172.31.255.255', true],
    ['http://[fc00::1]', true],
    ['http://169.254.1.1', true],
    ['http://[fe80::1]', true],
  ])('private / link-local over plain HTTP is ELIGIBLE: %s → %s', (url, expected) => {
    expect(isOAuthEligibleBaseUrl(url)).toBe(expected);
  });

  // ── The arm this rule must NOT open — the security floor ──────────────
  //
  // A regression here does not degrade a feature: it serves plaintext OAuth
  // to the public internet, which is strictly worse than the refusal the
  // card exists to relax. These legs are why the rule reads IP LITERALS and
  // never a text prefix.
  it.each([
    ['http://example.com', false],
    ['http://203.0.113.5', false],
    ['http://intranet.corp:3000', false],
    ['http://host.docker.internal:3000', false],
  ])('a public host over plain HTTP is still REFUSED: %s → %s', (url, expected) => {
    expect(isOAuthEligibleBaseUrl(url)).toBe(expected);
  });

  // ── Invariants the change may not disturb ─────────────────────────────
  it.each([
    ['https://acme.example.com', true],
    ['https://intranet.corp', true],
    ['https://203.0.113.5', true],
    ['http://localhost:3000', true],
    ['http://127.0.0.1:8080', true],
    ['http://[::1]:3000', true],
    ['http://myapp.localhost:3000', true],
    ['ftp://localhost', false],
    ['ws://10.0.0.5', false],
    ['not a url', false],
  ])('unchanged: %s → %s', (url, expected) => {
    expect(isOAuthEligibleBaseUrl(url)).toBe(expected);
  });

  // ── Boundary traps ────────────────────────────────────────────────────
  //
  // Each of these is a value a plausible-looking implementation gets wrong,
  // and each one it gets wrong in the UNSAFE direction.
  it.each([
    // RFC 1918 is 172.16.0.0/12 — 172.15.x and 172.32.x are ordinary public
    // space, and a `172.` prefix test would hand both of them plaintext.
    ['http://172.15.0.1', false],
    ['http://172.32.0.1', false],
    // A hostname that merely BEGINS with a private IPv4 string. Its owner
    // points it wherever they like; a `startsWith('10.')` test opens it.
    ['http://10.0.0.5.evil.com', false],
    ['http://192.168.1.10.attacker.test', false],
    // Site-local fec0::/10 was deprecated by RFC 3879 and is NOT inside
    // fc00::/7 — the ruled range. febf:: is the last link-local prefix and
    // fdff:: the last unique-local one, so both stay in.
    ['http://[fec0::1]', false],
    ['http://[febf::1]', true],
    ['http://[fdff:ffff::1]', true],
    // IPv4-mapped IPv6: WHATWG URL canonicalises `::ffff:10.0.0.5` to
    // `::ffff:a00:5`. The rule refuses it rather than unwrapping it — the
    // conservative side, pinned so the choice is visible if it is revisited.
    ['http://[::ffff:10.0.0.5]', false],
    // The unspecified/wildcard bind address is not a reachable origin.
    ['http://0.0.0.0:3000', false],
    ['http://[::]:3000', false],
  ])('boundary: %s → %s', (url, expected) => {
    expect(isOAuthEligibleBaseUrl(url)).toBe(expected);
  });

  it('accepts a private address in any spelling WHATWG URL canonicalises to one', () => {
    // `http://167772161` parses to hostname 10.0.0.1 — it IS that address,
    // so eligibility follows the canonical host, not the typed text.
    expect(new URL('http://167772161').hostname).toBe('10.0.0.1');
    expect(isOAuthEligibleBaseUrl('http://167772161')).toBe(true);
    expect(isOAuthEligibleBaseUrl('http://[FC00::1]')).toBe(true);
  });

  it('is reachable by no configuration key and no environment variable', () => {
    // The ruling refused the contributor's escape hatch as written. This pins
    // the refusal where it can actually be observed: the predicate takes one
    // argument, the deployment's own origin, and reads no process state.
    expect(isOAuthEligibleBaseUrl.length).toBe(1);
    process.env.OS_ALLOW_INSECURE_OAUTH_HTTP = 'true';
    try {
      expect(isOAuthEligibleBaseUrl('http://example.com')).toBe(false);
      expect(isOAuthEligibleBaseUrl('http://203.0.113.5')).toBe(false);
    } finally {
      delete process.env.OS_ALLOW_INSECURE_OAUTH_HTTP;
    }
  });
});

describe('isMcpOAuthEnabled follows the transport rule through the manager', () => {
  const managerOn = (baseUrl: string) =>
    new AuthManager({ secret: 'test-secret-at-least-32-chars-long', baseUrl });

  it('a private-address plain-HTTP deployment gets the OAuth track and its metadata URL', () => {
    const m = managerOn('http://192.168.1.10:3000');
    expect(m.isMcpOAuthEnabled()).toBe(true);
    expect(m.getMcpResourceMetadataUrl()).toBe(
      'http://192.168.1.10:3000/.well-known/oauth-protected-resource',
    );
  });

  it('a public plain-HTTP deployment stays dark — fail-closed, nothing advertised', () => {
    const m = managerOn('http://example.com');
    expect(m.isMcpOAuthEnabled()).toBe(false);
    expect(m.getMcpResourceMetadataUrl()).toBeNull();
  });
});

describe('enable-flag resolution (env → config → follows MCP surface)', () => {
  it('defaults ON — the MCP surface is a default-on core capability and AS/DCR follow it', () => {
    expect(resolveOidcProviderEnabled({})).toBe(true);
    expect(resolveDcrEnabled({})).toBe(true);
  });

  it('follows the MCP surface off when OS_MCP_SERVER_ENABLED=false', () => {
    process.env.OS_MCP_SERVER_ENABLED = 'false';
    expect(resolveOidcProviderEnabled({})).toBe(false);
    expect(resolveDcrEnabled({})).toBe(false);
  });

  it('follows OS_MCP_SERVER_ENABLED (the self-serve MCP connect default)', () => {
    process.env.OS_MCP_SERVER_ENABLED = 'true';
    expect(resolveOidcProviderEnabled({})).toBe(true);
    expect(resolveDcrEnabled({})).toBe(true);
  });

  it('explicit env override wins over the MCP default (operator can force off)', () => {
    process.env.OS_MCP_SERVER_ENABLED = 'true';
    process.env.OS_OIDC_PROVIDER_ENABLED = 'false';
    process.env.OS_OIDC_DCR_ENABLED = 'false';
    expect(resolveOidcProviderEnabled({})).toBe(false);
    expect(resolveDcrEnabled({})).toBe(false);
  });

  it('config file wins over the MCP default but loses to env', () => {
    expect(resolveOidcProviderEnabled({ oidcProvider: true })).toBe(true);
    expect(resolveDcrEnabled({ dynamicClientRegistration: true } as any)).toBe(true);
    process.env.OS_OIDC_PROVIDER_ENABLED = 'false';
    expect(resolveOidcProviderEnabled({ oidcProvider: true })).toBe(false);
  });
});

describe('canonical issuer / resource URLs', () => {
  const manager = () =>
    new AuthManager({
      secret: 'test-secret-at-least-32-chars-long',
      baseUrl: 'https://acme.example.com',
    });

  it('issuer = baseUrl + auth basePath (matches the jwt plugin iss claim)', () => {
    expect(manager().getAuthIssuer()).toBe('https://acme.example.com/api/v1/auth');
  });

  // getCanonicalOrigin() backs every user-facing URL (invitation, loginPage,
  // consentPage, device verificationUri, and the reset/verify/magic-link email
  // links better-auth derives from baseURL). A bare host must become https://.
  it('a bare-host baseUrl is promoted to an absolute https:// origin', () => {
    const m = new AuthManager({
      secret: 'test-secret-at-least-32-chars-long',
      baseUrl: 'cloud.objectos.ai',
    });
    expect(m.getAuthIssuer()).toBe('https://cloud.objectos.ai/api/v1/auth');
  });

  it('an explicit scheme and a trailing slash are preserved / trimmed, not doubled', () => {
    const m = new AuthManager({
      secret: 'test-secret-at-least-32-chars-long',
      baseUrl: 'https://acme.example.com/',
    });
    expect(m.getAuthIssuer()).toBe('https://acme.example.com/api/v1/auth');
  });

  it('MCP resource = baseUrl + api prefix + /mcp (derived from the auth basePath)', () => {
    expect(manager().getMcpResourceUrl()).toBe('https://acme.example.com/api/v1/mcp');
  });

  it('protected-resource metadata points at THIS deployment as the AS and lists the MCP scopes', () => {
    process.env.OS_MCP_SERVER_ENABLED = 'true';
    const md = manager().getMcpProtectedResourceMetadata() as any;
    expect(md.resource).toBe('https://acme.example.com/api/v1/mcp');
    expect(md.authorization_servers).toEqual(['https://acme.example.com/api/v1/auth']);
    for (const scope of MCP_OAUTH_SCOPES) expect(md.scopes_supported).toContain(scope);
    expect(md.scopes_supported).toContain('offline_access');
    expect(md.bearer_methods_supported).toEqual(['header']);
  });

  it('resource metadata URL is null when the AS is off (nothing advertised, fail-closed)', () => {
    process.env.OS_MCP_SERVER_ENABLED = 'false'; // opt out of the default-on surface
    expect(manager().getMcpResourceMetadataUrl()).toBeNull();
  });

  // The contributor's strict-spelling refusal pin, kept as the production
  // arm's: `intranet.corp` is a HOSTNAME, not an IP literal, so the widened
  // transport rule leaves it exactly as refused as before.
  it('resource metadata URL is null on a plain-HTTP non-IP hostname even with the AS on', () => {
    process.env.OS_MCP_SERVER_ENABLED = 'true';
    const m = new AuthManager({
      secret: 'test-secret-at-least-32-chars-long',
      baseUrl: 'http://intranet.corp:3000',
    });
    expect(m.isMcpOAuthEnabled()).toBe(false);
    expect(m.getMcpResourceMetadataUrl()).toBeNull();
  });

  it('advertises the metadata URL when MCP + AS are on over an eligible origin', () => {
    process.env.OS_MCP_SERVER_ENABLED = 'true';
    expect(manager().getMcpResourceMetadataUrl()).toBe(
      'https://acme.example.com/.well-known/oauth-protected-resource',
    );
  });
});

describe('verifyMcpAccessToken (local JWKS verification, fail-closed)', () => {
  const ISSUER = 'https://acme.example.com/api/v1/auth';
  const AUDIENCE = 'https://acme.example.com/api/v1/mcp';

  let privateKey: CryptoKey;
  let jwks: { keys: any[] };

  beforeEach(async () => {
    process.env.OS_MCP_SERVER_ENABLED = 'true';
    const pair = await generateKeyPair('RS256');
    privateKey = pair.privateKey as CryptoKey;
    const jwk = await exportJWK(pair.publicKey);
    jwks = { keys: [{ ...jwk, alg: 'RS256', kid: 'test-key' }] };
  });

  function manager(): AuthManager {
    const m = new AuthManager({
      secret: 'test-secret-at-least-32-chars-long',
      baseUrl: 'https://acme.example.com',
    });
    vi.spyOn(m, 'getApi').mockResolvedValue({ getJwks: async () => jwks } as any);
    return m;
  }

  function signToken(overrides: Record<string, unknown> = {}, opts: { expired?: boolean } = {}) {
    const now = Math.floor(Date.now() / 1000);
    // `undefined` in an override DROPS the claim: jose serialises the payload
    // with JSON.stringify, which omits undefined values. That is how the
    // no-client-claim case below is expressed without a second signer.
    const jwt = new SignJWT({
      scope: 'data:read data:write',
      azp: 'client-abc',
      ...overrides,
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuer((overrides.iss as string) ?? ISSUER)
      .setAudience((overrides.aud as string) ?? AUDIENCE)
      .setSubject((overrides.sub as string) ?? 'user-1')
      .setIssuedAt(opts.expired ? now - 7200 : now)
      .setExpirationTime(opts.expired ? now - 3600 : now + 3600);
    return jwt.sign(privateKey);
  }

  it('resolves the principal + scopes + client from a valid token', async () => {
    const token = await signToken();
    const res = await manager().verifyMcpAccessToken(token);
    expect(res).toEqual({ userId: 'user-1', scopes: ['data:read', 'data:write'], clientId: 'client-abc' });
  });

  it('rejects an expired token', async () => {
    const token = await signToken({}, { expired: true });
    expect(await manager().verifyMcpAccessToken(token)).toBeNull();
  });

  it('rejects a token minted for a DIFFERENT audience (no cross-resource replay)', async () => {
    const token = await signToken({ aud: 'https://acme.example.com/api/v1/auth/oauth2/userinfo' });
    expect(await manager().verifyMcpAccessToken(token)).toBeNull();
  });

  it('rejects a token from a different issuer', async () => {
    const token = await signToken({ iss: 'https://evil.example.com/api/v1/auth' });
    expect(await manager().verifyMcpAccessToken(token)).toBeNull();
  });

  it('rejects a token signed by an UNKNOWN key (signature check is real)', async () => {
    const rogue = await generateKeyPair('RS256');
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({ scope: 'data:read' })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setSubject('user-1')
      .setIssuedAt(now)
      .setExpirationTime(now + 3600)
      .sign(rogue.privateKey as CryptoKey);
    expect(await manager().verifyMcpAccessToken(token)).toBeNull();
  });

  it('rejects a sub-less token — a subject is the minimum a principal can be built from', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({ scope: 'data:read', azp: 'client-abc' })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt(now)
      .setExpirationTime(now + 3600)
      .sign(privateKey);
    expect(await manager().verifyMcpAccessToken(token)).toBeNull();
  });

  // ── the client_credentials discriminator, by CLAIM SHAPE ─────────────────
  // These pin the rule on hand-built claim combinations, including ones no
  // grant produces today (a token disagreeing with itself across the two
  // client spellings). The behaviour on a token the REAL provider actually
  // mints for a `client_credentials` grant is pinned in
  // auth-manager.mcp-oauth-resource.test.ts, against a real authorization
  // server — the docblock's former "carries no `sub`" premise was green here
  // for years precisely because no minted token was ever handed to it.

  it('rejects a token whose `sub` IS its `azp` — RFC 9068 §2.2.3.1: no resource owner was involved', async () => {
    const token = await signToken({ sub: 'client-abc', azp: 'client-abc' });
    expect(await manager().verifyMcpAccessToken(token)).toBeNull();
  });

  it('rejects a token whose `sub` IS its `client_id` — the RFC 9068 §2.2 spelling of the same fact', async () => {
    const token = await signToken({ sub: 'client-abc', client_id: 'client-abc', azp: undefined });
    expect(await manager().verifyMcpAccessToken(token)).toBeNull();
  });

  it('refuses on EITHER client spelling — a token that disagrees with itself is still refused', async () => {
    // `azp` says one client, `client_id` says another, and `sub` matches the
    // one a `??` chain would have discarded. Read as a pair, this is refused;
    // read through a precedence chain, it resolves.
    const token = await signToken({ sub: 'client-two', client_id: 'client-two', azp: 'client-one' });
    expect(await manager().verifyMcpAccessToken(token)).toBeNull();
  });

  it('rejects a token carrying NEITHER `client_id` nor `azp` — the discriminator cannot run, so it must not pass', async () => {
    const token = await signToken({ azp: undefined });
    expect(await manager().verifyMcpAccessToken(token)).toBeNull();
  });

  it('still resolves a delegated token that carries `client_id` and `azp` alongside a DIFFERENT `sub`', async () => {
    // The positive half of the pair rule, on the claim set a real
    // authorization-code token carries (measured: `client_id` === `azp`,
    // both != `sub`). Without this, the four refusals above are also
    // satisfied by a method that refuses everything.
    const token = await signToken({ sub: 'user-1', client_id: 'client-abc', azp: 'client-abc' });
    expect(await manager().verifyMcpAccessToken(token)).toEqual({
      userId: 'user-1',
      scopes: ['data:read', 'data:write'],
      clientId: 'client-abc',
    });
  });

  it('rejects garbage / non-JWT input without touching the JWKS', async () => {
    const m = manager();
    expect(await m.verifyMcpAccessToken('')).toBeNull();
    expect(await m.verifyMcpAccessToken('osk_not_a_jwt')).toBeNull();
    expect(await m.verifyMcpAccessToken('a.b')).toBeNull();
    expect(m.getApi).not.toHaveBeenCalled();
  });

  it('rejects every token when the OAuth track is off (provider disabled)', async () => {
    process.env.OS_MCP_SERVER_ENABLED = 'false'; // opt out of the default-on surface
    const token = await signToken();
    expect(await manager().verifyMcpAccessToken(token)).toBeNull();
  });
});

describe('oauthProvider plugin wiring (DCR + scopes — options we pass, not behaviour)', () => {
  async function capturePluginOpts(env: Record<string, string>): Promise<any> {
    for (const [k, v] of Object.entries(env)) process.env[k] = v;
    (betterAuth as any).mockImplementation((config: any) => ({ handler: vi.fn(), api: {}, _cfg: config }));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const manager = new AuthManager({
        secret: 'test-secret-at-least-32-chars-long',
        baseUrl: 'https://acme.example.com',
      });
      await manager.getAuthInstance();
    } finally {
      warnSpy.mockRestore();
    }
    const call = (oauthProvider as any).mock.calls.at(-1);
    return call?.[0];
  }

  it('enables DCR (incl. unauthenticated) and advertises MCP scopes when the MCP surface is on', async () => {
    const opts = await capturePluginOpts({ OS_MCP_SERVER_ENABLED: 'true' });
    expect(opts).toBeDefined();
    expect(opts.allowDynamicClientRegistration).toBe(true);
    expect(opts.allowUnauthenticatedClientRegistration).toBe(true);
    for (const scope of MCP_OAUTH_SCOPES) expect(opts.scopes).toContain(scope);
    expect(opts.scopes).toEqual(expect.arrayContaining(['openid', 'profile', 'email', 'offline_access']));
    // ⛔ RFC 8707 audience binding is NOT asserted here. The subject available
    // in this describe block is the options object we passed in, and the
    // provider never consumes it — an assertion on it is green whether or not
    // the installed version reads the option, which is exactly how a dead
    // `validAudiences` survived a version bump. The refutable form lives in
    // auth-manager.mcp-oauth-resource.test.ts, which boots the REAL provider
    // and drives `authorize?resource=<mcp url>` to a minted token.
  });

  it('OS_OIDC_DCR_ENABLED=false forces DCR off even with MCP on', async () => {
    const opts = await capturePluginOpts({ OS_MCP_SERVER_ENABLED: 'true', OS_OIDC_DCR_ENABLED: 'false' });
    expect(opts.allowDynamicClientRegistration).toBe(false);
    expect(opts.allowUnauthenticatedClientRegistration).toBe(false);
  });

  it('does not register the oauthProvider plugin when the MCP surface is opted out', async () => {
    await capturePluginOpts({ OS_MCP_SERVER_ENABLED: 'false' });
    expect((oauthProvider as any).mock.calls.length).toBe(0);
  });

  it('registers the oauthProvider plugin by default (MCP surface default-on)', async () => {
    const opts = await capturePluginOpts({});
    expect(opts).toBeDefined();
    expect(opts.allowDynamicClientRegistration).toBe(true);
  });
});
