import { describe, it, expect } from 'vitest';
import {
  AuthProvider,
  SessionUserSchema,
  SessionSchema,
  LoginType,
  LoginRequestSchema,
  RegisterRequestSchema,
  RefreshTokenRequestSchema,
  SessionResponseSchema,
  UserProfileResponseSchema,
} from './auth.zod';

describe('AuthProvider', () => {
  it('should accept all valid providers', () => {
    for (const p of ['local', 'google', 'github', 'microsoft', 'ldap', 'saml']) {
      expect(AuthProvider.parse(p)).toBe(p);
    }
  });

  it('should reject invalid provider', () => {
    expect(() => AuthProvider.parse('facebook')).toThrow();
  });
});

describe('LoginType', () => {
  it('should accept all valid login types', () => {
    for (const t of ['email', 'username', 'phone', 'magic-link', 'social']) {
      expect(LoginType.parse(t)).toBe(t);
    }
  });

  it('should reject invalid login type', () => {
    expect(() => LoginType.parse('biometric')).toThrow();
  });
});

describe('SessionUserSchema', () => {
  it('should accept valid user with required fields', () => {
    const user = SessionUserSchema.parse({
      id: 'usr_123',
      email: 'test@example.com',
      name: 'Test User',
    });
    expect(user.id).toBe('usr_123');
    expect(user.emailVerified).toBe(false);
    expect(user.roles).toEqual([]);
    // #14788 — `language` is retired: no default is minted any more, and the
    // parsed user carries no such property at all (pinned again below).
    expect(user).not.toHaveProperty('language');
  });

  it('should accept user with all optional fields', () => {
    const user = SessionUserSchema.parse({
      id: 'usr_456',
      email: 'admin@example.com',
      emailVerified: true,
      name: 'Admin',
      image: 'https://example.com/avatar.png',
      username: 'admin',
      roles: ['admin', 'editor'],
      tenantId: 'tenant_1',
      timezone: 'Europe/Paris',
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-06-01T00:00:00Z',
    });
    expect(user.emailVerified).toBe(true);
    expect(user.roles).toEqual(['admin', 'editor']);
    expect(user.timezone).toBe('Europe/Paris');
  });

  it('should reject invalid email', () => {
    expect(() =>
      SessionUserSchema.parse({
        id: 'usr_1',
        email: 'not-an-email',
        name: 'Bad',
      })
    ).toThrow();
  });

  it('should reject missing required fields', () => {
    expect(() => SessionUserSchema.parse({ id: 'usr_1' })).toThrow();
    expect(() => SessionUserSchema.parse({ email: 'a@b.com' })).toThrow();
  });
});

describe('SessionUser.language retirement (#14788, ADR-0049 — maintainer ruling D, 2026-09-03)', () => {
  const base = { id: 'usr_1', email: 'a@b.com', name: 'A' };

  it('REJECTS a `language` value, with the prescription in the message', () => {
    // Tombstoned, not deleted: SessionUserSchema is a non-strict `z.object`,
    // so a plain deletion would have STRIPPED the key silently and a producer
    // still writing it would never learn. `retiredKey()` makes the rejection
    // carry the fix — that prescription is the payload, and what this pins.
    expect(() => SessionUserSchema.parse({ ...base, language: 'fr' }))
      .toThrow(/SessionUser\.language.*removed.*\/auth\/me\/localization/s);
  });

  it('parses cleanly without it, and mints NO default in its place', () => {
    // The retired key used to default to `'en'` — a constant a reader took
    // for the user's language. Absence of the key is the whole point: a
    // reader now gets `undefined`, never a wrong-but-plausible value.
    const user = SessionUserSchema.parse(base);
    expect(user).not.toHaveProperty('language');
    expect(Object.keys(user)).not.toContain('language');
    // Positive control: the sibling preference key survives untouched.
    expect(SessionUserSchema.parse({ ...base, timezone: 'Asia/Shanghai' }).timezone).toBe('Asia/Shanghai');
  });

  it('the response envelopes carrying SessionUser refuse it too (both faces)', () => {
    const rejects = (fn: () => unknown) =>
      expect(fn).toThrow(/SessionUser\.language.*removed/s);
    rejects(() => SessionResponseSchema.parse({
      success: true,
      data: { session: { id: 's', expiresAt: '2025-12-31T23:59:59Z', userId: 'usr_1' }, user: { ...base, language: 'fr' } },
    }));
    rejects(() => UserProfileResponseSchema.parse({ success: true, data: { ...base, language: 'fr' } }));
  });

  it('nothing in packages/spec/src reads `.language` off a SessionUser any more', async () => {
    // Tree-scoped over this package's own source (the radius a spec test may
    // walk without a cross-package declaration — a repo-wide glob would put
    // spec's whole suite on every PR, the radius `check:cross-package-test-
    // inputs` exists to keep narrow). Beyond this tree the tombstone's `never`
    // input type is the enforcement: writing the key anywhere in the monorepo
    // fails `tsc`; objectui was measured at zero readers at dispatch.
    // Excluded, with the reason: the tombstone itself names the key in its
    // prescription, and this pin names it in its own assertions.
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const self = fileURLToPath(import.meta.url);
    const tombstone = path.join(srcRoot, 'api', 'auth.zod.ts');
    const readers: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.ts') && full !== self && full !== tombstone) {
          const src = fs.readFileSync(full, 'utf-8');
          if (/SessionUser/.test(src) && /\.language\b/.test(src)) readers.push(path.relative(srcRoot, full));
        }
      }
    };
    walk(srcRoot);
    // Anti-vacuity: the walk must have seen the tombstone's own neighbours.
    expect(fs.existsSync(tombstone)).toBe(true);
    expect(readers, 'a reader of SessionUser.language reappeared — the key is retired (#14788)').toEqual([]);
  });
});

describe('SessionSchema', () => {
  it('should accept valid session', () => {
    const session = SessionSchema.parse({
      id: 'sess_abc',
      expiresAt: '2025-12-31T23:59:59Z',
      userId: 'usr_123',
    });
    expect(session.id).toBe('sess_abc');
    expect(session.token).toBeUndefined();
  });

  it('should accept session with optional fields', () => {
    const session = SessionSchema.parse({
      id: 'sess_xyz',
      expiresAt: '2025-12-31T23:59:59Z',
      token: 'jwt_token_value',
      ipAddress: '192.168.1.1',
      userAgent: 'Mozilla/5.0',
      userId: 'usr_456',
    });
    expect(session.token).toBe('jwt_token_value');
    expect(session.ipAddress).toBe('192.168.1.1');
  });

  it('should reject invalid datetime', () => {
    expect(() =>
      SessionSchema.parse({
        id: 'sess_1',
        expiresAt: 'not-a-date',
        userId: 'usr_1',
      })
    ).toThrow();
  });

  it('should reject missing userId', () => {
    expect(() =>
      SessionSchema.parse({
        id: 'sess_1',
        expiresAt: '2025-12-31T23:59:59Z',
      })
    ).toThrow();
  });
});

describe('LoginRequestSchema', () => {
  it('should accept email login with defaults', () => {
    const req = LoginRequestSchema.parse({
      email: 'user@example.com',
      password: 'secret123',
    });
    expect(req.type).toBe('email');
    expect(req.email).toBe('user@example.com');
  });

  it('should accept social login', () => {
    const req = LoginRequestSchema.parse({
      type: 'social',
      provider: 'google',
    });
    expect(req.type).toBe('social');
    expect(req.provider).toBe('google');
  });

  it('should accept username login', () => {
    const req = LoginRequestSchema.parse({
      type: 'username',
      username: 'admin',
      password: 'pass',
    });
    expect(req.type).toBe('username');
  });

  it('should accept magic-link login', () => {
    const req = LoginRequestSchema.parse({
      type: 'magic-link',
      email: 'user@example.com',
      redirectTo: '/dashboard',
    });
    expect(req.type).toBe('magic-link');
    expect(req.redirectTo).toBe('/dashboard');
  });

  it('should reject invalid email format', () => {
    expect(() =>
      LoginRequestSchema.parse({
        type: 'email',
        email: 'bad-email',
        password: 'pass',
      })
    ).toThrow();
  });
});

describe('RegisterRequestSchema', () => {
  it('should accept valid registration', () => {
    const req = RegisterRequestSchema.parse({
      email: 'new@example.com',
      password: 'secure123',
      name: 'New User',
    });
    expect(req.email).toBe('new@example.com');
    expect(req.image).toBeUndefined();
  });

  it('should accept registration with image', () => {
    const req = RegisterRequestSchema.parse({
      email: 'user@example.com',
      password: 'pass',
      name: 'User',
      image: 'https://example.com/img.png',
    });
    expect(req.image).toBe('https://example.com/img.png');
  });

  it('should reject missing required fields', () => {
    expect(() => RegisterRequestSchema.parse({ email: 'a@b.com' })).toThrow();
    expect(() =>
      RegisterRequestSchema.parse({ email: 'a@b.com', password: 'x' })
    ).toThrow();
  });

  it('should reject invalid email', () => {
    expect(() =>
      RegisterRequestSchema.parse({
        email: 'invalid',
        password: 'pass',
        name: 'X',
      })
    ).toThrow();
  });
});

describe('RefreshTokenRequestSchema', () => {
  it('should accept valid refresh token request', () => {
    const req = RefreshTokenRequestSchema.parse({
      refreshToken: 'rt_abc123',
    });
    expect(req.refreshToken).toBe('rt_abc123');
  });

  it('should reject missing refreshToken', () => {
    expect(() => RefreshTokenRequestSchema.parse({})).toThrow();
  });
});

describe('SessionResponseSchema', () => {
  it('should accept valid session response', () => {
    const resp = SessionResponseSchema.parse({
      success: true,
      data: {
        session: {
          id: 'sess_1',
          expiresAt: '2025-12-31T23:59:59Z',
          userId: 'usr_1',
        },
        user: {
          id: 'usr_1',
          email: 'user@example.com',
          name: 'User',
        },
      },
    });
    expect(resp.success).toBe(true);
    expect(resp.data.session.id).toBe('sess_1');
    expect(resp.data.user.email).toBe('user@example.com');
  });

  it('should accept session response with token', () => {
    const resp = SessionResponseSchema.parse({
      success: true,
      data: {
        session: {
          id: 'sess_1',
          expiresAt: '2025-12-31T23:59:59Z',
          userId: 'usr_1',
        },
        user: {
          id: 'usr_1',
          email: 'user@example.com',
          name: 'User',
        },
        token: 'bearer_token_value',
      },
    });
    expect(resp.data.token).toBe('bearer_token_value');
  });

  it('should reject missing session or user', () => {
    expect(() =>
      SessionResponseSchema.parse({
        success: true,
        data: {
          user: { id: 'usr_1', email: 'a@b.com', name: 'U' },
        },
      })
    ).toThrow();

    expect(() =>
      SessionResponseSchema.parse({
        success: true,
        data: {
          session: { id: 's', expiresAt: '2025-12-31T23:59:59Z', userId: 'u' },
        },
      })
    ).toThrow();
  });
});

describe('UserProfileResponseSchema', () => {
  it('should accept valid user profile response', () => {
    const resp = UserProfileResponseSchema.parse({
      success: true,
      data: {
        id: 'usr_1',
        email: 'user@example.com',
        name: 'User',
      },
    });
    expect(resp.data.id).toBe('usr_1');
    expect(resp.data.emailVerified).toBe(false);
  });

  it('should reject invalid user data', () => {
    expect(() =>
      UserProfileResponseSchema.parse({
        success: true,
        data: { id: 'usr_1' },
      })
    ).toThrow();
  });
});
