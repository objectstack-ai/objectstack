// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  AuthEndpointPaths,
  DeviceRequestResponseSchema,
  AuthEndpointSchema,
  AuthEndpointAliases,
  AuthFeaturesConfigSchema,
  GetAuthConfigResponseSchema,
  EndpointMapping,
  getAuthEndpointUrl,
  OneTimeTokenHandoffQuerySchema,
  OneTimeTokenVerifyRequestSchema,
  OneTimeTokenVerifyResponseSchema,
} from './auth-endpoints.zod';
import {
  PUBLIC_AUTH_CONFIG_NON_FLAG_KEYS,
  PUBLIC_AUTH_FEATURE_NAMES,
  PUBLIC_AUTH_FEATURES_NOT_ADVERTISED,
} from '../kernel/public-auth-features';

describe('AuthEndpointPaths', () => {
  it('should define email/password authentication endpoints', () => {
    expect(AuthEndpointPaths.signInEmail).toBe('/sign-in/email');
    expect(AuthEndpointPaths.signUpEmail).toBe('/sign-up/email');
    expect(AuthEndpointPaths.signOut).toBe('/sign-out');
  });

  it('should define session management endpoints', () => {
    expect(AuthEndpointPaths.getSession).toBe('/get-session');
  });

  it('should define password management endpoints', () => {
    expect(AuthEndpointPaths.forgetPassword).toBe('/forget-password');
    expect(AuthEndpointPaths.resetPassword).toBe('/reset-password');
  });

  it('should define email verification endpoints', () => {
    expect(AuthEndpointPaths.sendVerificationEmail).toBe('/send-verification-email');
    expect(AuthEndpointPaths.verifyEmail).toBe('/verify-email');
  });

  it('should define 2FA endpoints', () => {
    expect(AuthEndpointPaths.twoFactorEnable).toBe('/two-factor/enable');
    expect(AuthEndpointPaths.twoFactorVerify).toBe('/two-factor/verify');
  });

  it('should define passkey endpoints', () => {
    expect(AuthEndpointPaths.passkeyRegister).toBe('/passkey/register');
    expect(AuthEndpointPaths.passkeyAuthenticate).toBe('/passkey/authenticate');
  });

  it('should define magic link endpoints', () => {
    expect(AuthEndpointPaths.magicLinkSend).toBe('/magic-link/send');
    expect(AuthEndpointPaths.magicLinkVerify).toBe('/magic-link/verify');
  });
});

describe('AuthEndpointSchema', () => {
  it('should validate signInEmail endpoint', () => {
    const endpoint = AuthEndpointSchema.shape.signInEmail.parse({
      method: 'POST',
      path: '/sign-in/email',
      description: 'Sign in with email and password',
    });

    expect(endpoint.method).toBe('POST');
    expect(endpoint.path).toBe('/sign-in/email');
  });

  it('should validate signUpEmail endpoint', () => {
    const endpoint = AuthEndpointSchema.shape.signUpEmail.parse({
      method: 'POST',
      path: '/sign-up/email',
      description: 'Register new user with email and password',
    });

    expect(endpoint.method).toBe('POST');
    expect(endpoint.path).toBe('/sign-up/email');
  });

  it('should validate getSession endpoint', () => {
    const endpoint = AuthEndpointSchema.shape.getSession.parse({
      method: 'GET',
      path: '/get-session',
      description: 'Get current user session',
    });

    expect(endpoint.method).toBe('GET');
    expect(endpoint.path).toBe('/get-session');
  });

  it('should reject invalid HTTP method', () => {
    expect(() =>
      AuthEndpointSchema.shape.signInEmail.parse({
        method: 'GET', // Should be POST
        path: '/sign-in/email',
        description: 'Sign in with email and password',
      })
    ).toThrow();
  });

  it('should reject invalid path', () => {
    expect(() =>
      AuthEndpointSchema.shape.signInEmail.parse({
        method: 'POST',
        path: '/wrong-path', // Should be /sign-in/email
        description: 'Sign in with email and password',
      })
    ).toThrow();
  });
});

// #7481 — the two flags withdrawn from `/api/v1/auth/config` by the maintainer
// ruling of 2026-08-11. `AuthFeaturesConfigSchema` is not `.strict()`, so a
// plain deletion would have Zod SILENTLY STRIP a key a client kept sending and
// leave nothing to grep (#3733, ADR-0104) — the tombstone is what makes the
// withdrawal audible, so it is pinned on both legs: the prescription a writer
// hits, and the absence a reader gets.
describe('AuthFeaturesConfig retired flags (ruled: stop advertising them)', () => {
  const valid = { twoFactor: false, organization: true };

  it('rejects `passkeys` with its own prescription, naming the missing consumer', () => {
    expect(() => AuthFeaturesConfigSchema.parse({ ...valid, passkeys: true }))
      .toThrow(/`features\.passkeys` was removed.*Delete the key/s);
  });

  it('rejects `magicLink` with a prescription that keeps its endpoints alive', () => {
    // Deliberately NOT the same string as passkeys: magic-link's better-auth
    // endpoints still answer, and a shared prescription would tell a magic-link
    // deployer to stop using a capability that was never withdrawn.
    expect(() => AuthFeaturesConfigSchema.parse({ ...valid, magicLink: true }))
      .toThrow(/`features\.magicLink` was removed.*magic-link\/send/s);
  });

  it('does not serve either key on a clean parse', () => {
    const parsed = AuthFeaturesConfigSchema.parse(valid);
    expect(parsed).not.toHaveProperty('passkeys');
    expect(parsed).not.toHaveProperty('magicLink');
  });
});

// `features.sso` is served (plugin-auth's `/config` route and the hono
// adapter's, both refined to "usable") and read (the console LoginForm), so
// the contract declares it: a parse keeps it instead of stripping it.
describe('AuthFeaturesConfig.sso (served, now declared)', () => {
  const valid = { twoFactor: false, organization: true };

  it.each([true, false])('keeps a served `sso: %s` through a parse', (sso) => {
    const parsed = AuthFeaturesConfigSchema.parse({ ...valid, sso });
    expect(parsed.sso).toBe(sso);
  });

  it('keeps it through the whole GET /auth/config response parse', () => {
    const parsed = GetAuthConfigResponseSchema.parse({
      emailPassword: { enabled: true },
      socialProviders: [],
      features: { ...valid, sso: true, ssoEnforced: false },
    });
    expect(parsed.features.sso).toBe(true);
    expect(parsed.features.ssoEnforced).toBe(false);
  });

  it('CONTROL: an absent `sso` stays absent (no default is invented)', () => {
    const parsed = AuthFeaturesConfigSchema.parse(valid);
    expect(parsed).not.toHaveProperty('sso');
  });

  it.each([['yes'], [1], [null]])('refuses a non-boolean `sso` (%j)', (sso) => {
    const result = AuthFeaturesConfigSchema.safeParse({ ...valid, sso });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues).toEqual([
      expect.objectContaining({ code: 'invalid_type', expected: 'boolean', path: ['sso'] }),
    ]);
  });

  it('says it is the usable answer and how it differs from ssoEnforced', () => {
    const description = AuthFeaturesConfigSchema.shape.sso.description ?? '';
    expect(description).toMatch(/isSsoUsable/);
    expect(description).toMatch(/ssoEnforced/);
    expect(description).not.toMatch(/#\d{3,}/);
  });
});

// The registry-to-schema pin. plugin-auth's drift guard holds the served
// `features` keys equal to PUBLIC_AUTH_FEATURES plus the non-flag list; this
// holds those same keys equal to what the contract declares, so a key can no
// longer be served and classified while a contract parse strips it.
describe('AuthFeaturesConfig declares every classified served key', () => {
  const shape = AuthFeaturesConfigSchema.shape;
  const declared = Object.keys(shape);
  const retired: readonly string[] = PUBLIC_AUTH_FEATURES_NOT_ADVERTISED;
  const classified = [...PUBLIC_AUTH_FEATURE_NAMES, ...PUBLIC_AUTH_CONFIG_NON_FLAG_KEYS];

  it('declared keys, retired tombstones excepted, equal the flag registry plus the non-flag list', () => {
    expect(declared.filter((key) => !retired.includes(key)).sort()).toEqual([...classified].sort());
  });

  it('keeps a tombstone for every reserved-but-unadvertised key', () => {
    for (const key of retired) expect(declared).toContain(key);
  });

  it.each([...PUBLIC_AUTH_FEATURE_NAMES])('declares the flag `%s` as an optional boolean', (name) => {
    expect(AuthFeaturesConfigSchema.parse({ [name]: true })[name]).toBe(true);
    expect(AuthFeaturesConfigSchema.parse({ [name]: false })[name]).toBe(false);
    const refused = AuthFeaturesConfigSchema.safeParse({ [name]: 'yes' });
    expect(refused.success).toBe(false);
    if (refused.success) return;
    expect(refused.error.issues).toEqual([
      expect.objectContaining({ code: 'invalid_type', expected: 'boolean', path: [name] }),
    ]);
  });

  it.each(declared.filter((key) => !retired.includes(key)))('`%s` carries a describe with no tracker id', (key) => {
    const description = shape[key as keyof typeof shape].description ?? '';
    expect(description.length).toBeGreaterThan(0);
    expect(description).not.toMatch(/#\d{3,}/);
  });

  // The served shape, every key `getPublicConfig()` can put in `features`.
  const served = {
    twoFactor: false,
    organization: true,
    multiOrgEnabled: true,
    tenancyPosture: 'group',
    audiencePosture: 'invite_only',
    degradedTenancy: false,
    oidcProvider: true,
    sso: false,
    ssoEnforced: false,
    deviceAuthorization: true,
    admin: true,
    phoneNumber: false,
    phoneNumberOtp: false,
    cloudManaged: false,
    termsUrl: 'https://objectstack.ai/terms',
    privacyUrl: 'https://objectstack.ai/privacy',
    turnstileSiteKey: '0x4AAAAAAA',
  } as const;

  it('the served fixture names every classified key, so the parse below covers them all', () => {
    expect(Object.keys(served).sort()).toEqual([...classified].sort());
  });

  it('a whole GET /auth/config response keeps every served features key through a parse', () => {
    const parsed = GetAuthConfigResponseSchema.parse({
      emailPassword: { enabled: true },
      socialProviders: [],
      features: served,
    });
    expect(parsed.features).toEqual(served);
  });

  it('CONTROL: absent new keys stay absent (no default is invented)', () => {
    const parsed = AuthFeaturesConfigSchema.parse({ twoFactor: false, organization: true });
    expect(Object.keys(parsed).sort()).toEqual(['organization', 'twoFactor']);
  });

  it.each([
    ['tenancyPosture', 'multi'],
    ['audiencePosture', 'public'],
  ])('refuses an off-vocabulary `%s` (%j)', (key, value) => {
    const result = AuthFeaturesConfigSchema.safeParse({ [key]: value });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues).toEqual([expect.objectContaining({ code: 'invalid_value', path: [key] })]);
  });

  it.each(['termsUrl', 'privacyUrl'])('refuses a non-string `%s`', (key) => {
    const result = AuthFeaturesConfigSchema.safeParse({ [key]: true });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues).toEqual([
      expect.objectContaining({ code: 'invalid_type', expected: 'string', path: [key] }),
    ]);
  });
});

describe('AuthEndpointAliases', () => {
  it('should map common names to canonical endpoints', () => {
    expect(AuthEndpointAliases.login).toBe('/sign-in/email');
    expect(AuthEndpointAliases.register).toBe('/sign-up/email');
    expect(AuthEndpointAliases.logout).toBe('/sign-out');
    expect(AuthEndpointAliases.me).toBe('/get-session');
  });
});

describe('EndpointMapping', () => {
  it('should map legacy paths to canonical paths', () => {
    expect(EndpointMapping['/login']).toBe('/sign-in/email');
    expect(EndpointMapping['/register']).toBe('/sign-up/email');
    expect(EndpointMapping['/logout']).toBe('/sign-out');
    expect(EndpointMapping['/me']).toBe('/get-session');
    expect(EndpointMapping['/refresh']).toBe('/get-session');
  });
});

describe('getAuthEndpointUrl', () => {
  it('should construct full endpoint URLs', () => {
    const basePath = '/api/v1/auth';

    expect(getAuthEndpointUrl(basePath, 'signInEmail')).toBe('/api/v1/auth/sign-in/email');
    expect(getAuthEndpointUrl(basePath, 'signUpEmail')).toBe('/api/v1/auth/sign-up/email');
    expect(getAuthEndpointUrl(basePath, 'getSession')).toBe('/api/v1/auth/get-session');
  });

  it('should handle trailing slash in basePath', () => {
    const basePath = '/api/v1/auth/';

    expect(getAuthEndpointUrl(basePath, 'signInEmail')).toBe('/api/v1/auth/sign-in/email');
    expect(getAuthEndpointUrl(basePath, 'getSession')).toBe('/api/v1/auth/get-session');
  });

  it('should work with different base paths', () => {
    expect(getAuthEndpointUrl('/custom/auth', 'signInEmail')).toBe('/custom/auth/sign-in/email');
    expect(getAuthEndpointUrl('http://localhost:3000/api/auth', 'signUpEmail')).toBe(
      'http://localhost:3000/api/auth/sign-up/email'
    );
  });
});

// #15677 (stack card 2/6 of #14478) — ruling B: the unit of a duration-shaped
// number lives in the key NAME. The old spellings are `retiredKey()` tombstones,
// so the refusal carries the RENAME (the prescription IS the payload) rather
// than a bare unrecognized-key error, and the value survives at the same
// magnitude. Asserting the message, not just `.toThrow()`: a bare throw stays
// green when the schema throws for some unrelated reason.
describe('DeviceRequestResponse.interval \u2192 intervalSeconds', () => {
  const base = {
    code: 'ABCD-1234',
    verificationUrl: 'https://example.com/device',
    expiresAt: '2026-09-05T12:00:00.000Z',
  };

  it('REFUSES the retired `interval` spelling with the rename in the message', () => {
    const result = DeviceRequestResponseSchema.safeParse({ ...base, interval: 5 });
    expect(result.success).toBe(false);
    const issue = result.error!.issues.find((i) => i.path.join('.') === 'interval');
    expect(issue).toBeDefined();
    expect(issue!.code).not.toBe('unrecognized_keys');
    expect(issue!.message).toMatch(
      /`DeviceRequestResponse\.interval` was renamed to `intervalSeconds`/,
    );
  });

  it('records in the prescription that this is NOT an RFC 8628 mirror', () => {
    const result = DeviceRequestResponseSchema.safeParse({ ...base, interval: 5 });
    const issue = result.error!.issues.find((i) => i.path.join('.') === 'interval');
    expect(issue!.message).toMatch(/not an RFC 8628 device-authorization payload/);
  });

  it('accepts `intervalSeconds` at the same magnitude, and keeps the default', () => {
    const parsed = DeviceRequestResponseSchema.parse({ ...base, intervalSeconds: 5 });
    expect(parsed.intervalSeconds).toBe(5);
    expect(parsed).not.toHaveProperty('interval');
    expect(DeviceRequestResponseSchema.parse(base).intervalSeconds).toBe(2);
  });
});

describe('mobile sign-in hand-off (one-time token)', () => {
  // 43 base64url characters: an S256 challenge, and a verifier at the RFC 7636 minimum.
  const challenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  const token = 'aB3-_xYz0123456789abcdefGHIJKLmn';

  it('declares the hand-off and the vendor verify route, and not the client-refused generate', () => {
    expect(AuthEndpointPaths.oneTimeTokenHandoff).toBe('/one-time-token/handoff');
    expect(AuthEndpointPaths.oneTimeTokenVerify).toBe('/one-time-token/verify');
    expect(Object.values(AuthEndpointPaths)).not.toContain('/one-time-token/generate');
  });

  it('accepts a hand-off query with and without the challenge method', () => {
    const base = { redirect_uri: 'com.example.app://auth/callback', code_challenge: challenge };
    expect(OneTimeTokenHandoffQuerySchema.safeParse(base).success).toBe(true);
    expect(
      OneTimeTokenHandoffQuerySchema.safeParse({ ...base, code_challenge_method: 'S256' }).success,
    ).toBe(true);
  });

  it('closes the hand-off parameter set: an unknown parameter is refused', () => {
    const result = OneTimeTokenHandoffQuerySchema.safeParse({
      redirect_uri: 'com.example.app://auth/callback',
      code_challenge: challenge,
      state: 'x',
    });
    expect(result.success).toBe(false);
    expect(result.error!.issues[0].code).toBe('unrecognized_keys');
  });

  it('refuses the plain method, a malformed challenge, a missing challenge and an empty redirect_uri', () => {
    const base = { redirect_uri: 'com.example.app://cb', code_challenge: challenge };
    const plain = OneTimeTokenHandoffQuerySchema.safeParse({ ...base, code_challenge_method: 'plain' });
    expect(plain.success).toBe(false);
    expect(plain.error!.issues[0].path).toEqual(['code_challenge_method']);
    const short = OneTimeTokenHandoffQuerySchema.safeParse({ ...base, code_challenge: challenge.slice(1) });
    expect(short.success).toBe(false);
    expect(short.error!.issues[0].path).toEqual(['code_challenge']);
    const padded = OneTimeTokenHandoffQuerySchema.safeParse({ ...base, code_challenge: `${challenge.slice(1)}=` });
    expect(padded.success).toBe(false);
    const emptyUri = OneTimeTokenHandoffQuerySchema.safeParse({ ...base, redirect_uri: '' });
    expect(emptyUri.success).toBe(false);
    expect(emptyUri.error!.issues[0].path).toEqual(['redirect_uri']);
    const missing = OneTimeTokenHandoffQuerySchema.safeParse({ redirect_uri: base.redirect_uri });
    expect(missing.success).toBe(false);
    expect(missing.error!.issues[0].path).toEqual(['code_challenge']);
  });

  it('accepts a verify body carrying the token, a dot and the verifier', () => {
    expect(OneTimeTokenVerifyRequestSchema.safeParse({ token: `${token}.${verifier}` }).success).toBe(true);
    // A verifier may itself contain dots and tildes (RFC 7636 unreserved set): the split is on the FIRST dot.
    expect(
      OneTimeTokenVerifyRequestSchema.safeParse({ token: `${token}.${verifier.slice(0, 40)}.~_` }).success,
    ).toBe(true);
  });

  it('refuses a verify body without the verifier binding, or with a short verifier', () => {
    const bare = OneTimeTokenVerifyRequestSchema.safeParse({ token });
    expect(bare.success).toBe(false);
    expect(bare.error!.issues[0].path).toEqual(['token']);
    const short = OneTimeTokenVerifyRequestSchema.safeParse({ token: `${token}.${verifier.slice(1)}` });
    expect(short.success).toBe(false);
  });

  it('parses the vendor verify body: the session and its user, unwrapped', () => {
    const body = {
      session: {
        id: 's1',
        token: 'session-token',
        userId: 'u1',
        expiresAt: '2026-11-10T03:00:00.000Z',
        createdAt: '2026-11-03T03:00:00.000Z',
      },
      user: { id: 'u1', email: 'ada@example.com', emailVerified: true, name: 'Ada', image: null },
    };
    const result = OneTimeTokenVerifyResponseSchema.safeParse(body);
    expect(result.success).toBe(true);
  });
});
