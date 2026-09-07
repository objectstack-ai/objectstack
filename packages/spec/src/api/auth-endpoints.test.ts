// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  AuthEndpointPaths,
  DeviceRequestResponseSchema,
  AuthEndpointSchema,
  AuthEndpointAliases,
  AuthFeaturesConfigSchema,
  EndpointMapping,
  getAuthEndpointUrl,
} from './auth-endpoints.zod';

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
describe('AuthFeaturesConfig retired flags (#7481)', () => {
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
describe('DeviceRequestResponse.interval \u2192 intervalSeconds (#15677)', () => {
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
