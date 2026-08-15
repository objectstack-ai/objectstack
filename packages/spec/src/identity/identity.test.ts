import { describe, it, expect } from 'vitest';
import {
  UserSchema,
  AccountSchema,
  VerificationTokenSchema,
  type User,
  type Account,
  type VerificationToken,
} from "./identity.zod";

describe('UserSchema', () => {
  it('should accept valid user data', () => {
    const user: User = {
      id: 'user_123',
      email: 'test@example.com',
      emailVerified: true,
      name: 'Test User',
      image: 'https://example.com/avatar.jpg',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    expect(() => UserSchema.parse(user)).not.toThrow();
  });

  it('should accept minimal user data', () => {
    const user = {
      id: 'user_123',
      email: 'test@example.com',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const result = UserSchema.parse(user);
    expect(result.emailVerified).toBe(false); // default value
  });

  it('should validate email format', () => {
    const user = {
      id: 'user_123',
      email: 'invalid-email',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    expect(() => UserSchema.parse(user)).toThrow();
  });

  it('should validate image URL format', () => {
    const user = {
      id: 'user_123',
      email: 'test@example.com',
      image: 'not-a-url',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    expect(() => UserSchema.parse(user)).toThrow();
  });

  it('should accept user without optional fields', () => {
    const user = {
      id: 'user_123',
      email: 'test@example.com',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    expect(() => UserSchema.parse(user)).not.toThrow();
  });
});

describe('AccountSchema', () => {
  it('should accept valid OAuth account', () => {
    const account: Account = {
      id: 'account_123',
      userId: 'user_123',
      type: 'oauth',
      provider: 'google',
      providerAccountId: 'google_user_123',
      accessToken: 'access_token_xyz',
      refreshToken: 'refresh_token_xyz',
      expiresAt: Date.now() + 3600000,
      tokenType: 'Bearer',
      scope: 'openid profile email',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    expect(() => AccountSchema.parse(account)).not.toThrow();
  });

  it('should accept minimal account data', () => {
    const account = {
      id: 'account_123',
      userId: 'user_123',
      type: 'email',
      provider: 'email',
      providerAccountId: 'email_user_123',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    expect(() => AccountSchema.parse(account)).not.toThrow();
  });

  it('should accept all account types', () => {
    const types = ['oauth', 'oidc', 'email', 'credentials', 'saml', 'ldap'] as const;

    types.forEach((type) => {
      const account = {
        id: 'account_123',
        userId: 'user_123',
        type,
        provider: 'provider',
        providerAccountId: 'provider_account_123',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      expect(() => AccountSchema.parse(account)).not.toThrow();
    });
  });

  it('should reject invalid account type', () => {
    const account = {
      id: 'account_123',
      userId: 'user_123',
      type: 'invalid',
      provider: 'provider',
      providerAccountId: 'provider_account_123',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    expect(() => AccountSchema.parse(account)).toThrow();
  });
});

describe('Session is not declared here (#4641)', () => {
  // Pin: this module no longer declares the bare `SessionSchema` name. The pin is
  // compile-time (`typeof import` is type-level only — no runtime barrel load):
  // if the name is re-added here, the conditional type flips to `true` and the
  // `false` assignment fails `tsc --noEmit`.
  //
  // The bare names belong to `@objectstack/spec/api` alone — that declaration is
  // the live one, embedded in `SessionResponseSchema` (the `/get-session` body).
  // A second declaration on this entry meant the shape a consumer got depended
  // only on their import path (#4411), and the two disagreed on field names
  // (`expires` vs `expiresAt`, `sessionToken` vs `token`).
  //
  // Why this asserts at RUNTIME rather than with the `typeof import(...)`
  // conditional-type pin used by #4581 / #4610: when this was written that pin
  // could not fail here. `packages/spec/tsconfig.json` excluded `**/*.test.ts`,
  // so `pnpm typecheck` never compiled this file, and vitest transpiles without
  // typechecking — a conditional-type assertion in a spec test was inert.
  // #5286 closed that hole (the sibling `tsconfig.test.json` compiles the test
  // layer, and PINS_CHECKED keeps it that way). The module-namespace check
  // below is cheap — this file already imports the module — and it actually
  // runs, which is why it stays the load-bearing one.
  //
  // Scope, deliberately: this covers the VALUE export. A type-only
  // `export type Session` has no runtime footprint, so no unit test can see it.
  // Two things cover the type instead, and neither is vacuous:
  //   1. house style derives it (`type Session = z.infer< typeof SessionSchema >`),
  //      so it cannot come back without the const this test already catches; and
  //   2. `check:dual-source-exports` reads the BUILT entry `.d.ts` and enumerates
  //      types as well as consts — a re-added `Session` type on `./identity`
  //      fails it as a new dual-source name, which is how the baseline row that
  //      this PR deleted was phrased in the first place.
  it('does not re-expose the bare SessionSchema name from ./identity', async () => {
    const identityModule = await import('./identity.zod');
    expect(Object.keys(identityModule)).not.toContain('SessionSchema');
  });
});

describe('VerificationTokenSchema', () => {
  it('should accept valid verification token', () => {
    const token: VerificationToken = {
      identifier: 'test@example.com',
      token: 'verification_token_xyz',
      expires: new Date(Date.now() + 3600000).toISOString(),
      createdAt: new Date().toISOString(),
    };

    expect(() => VerificationTokenSchema.parse(token)).not.toThrow();
  });

  it('should accept token with phone identifier', () => {
    const token = {
      identifier: '+1234567890',
      token: 'verification_token_xyz',
      expires: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };

    expect(() => VerificationTokenSchema.parse(token)).not.toThrow();
  });

  it('should accept token with email identifier', () => {
    const token = {
      identifier: 'user@example.com',
      token: 'reset_password_token',
      expires: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };

    expect(() => VerificationTokenSchema.parse(token)).not.toThrow();
  });
});

describe('Type inference', () => {
  it('should correctly infer User type', () => {
    const user: User = {
      id: 'user_123',
      email: 'test@example.com',
      emailVerified: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // This test passes if TypeScript compiles without errors
    expect(user.id).toBe('user_123');
    expect(user.email).toBe('test@example.com');
  });

  it('should correctly infer Account type', () => {
    const account: Account = {
      id: 'account_123',
      userId: 'user_123',
      type: 'oauth',
      provider: 'google',
      providerAccountId: 'google_123',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // This test passes if TypeScript compiles without errors
    expect(account.type).toBe('oauth');
    expect(account.provider).toBe('google');
  });

  it('should correctly infer VerificationToken type', () => {
    const token: VerificationToken = {
      identifier: 'test@example.com',
      token: 'token_xyz',
      expires: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };

    // This test passes if TypeScript compiles without errors
    expect(token.identifier).toBe('test@example.com');
    expect(token.token).toBe('token_xyz');
  });
});
