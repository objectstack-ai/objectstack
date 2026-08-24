import { describe, it, expect } from 'vitest';
import {
  AuthProviderConfigSchema,
  AuthPluginConfigSchema,
  AuthConfigSchema,
  MutualTLSConfigSchema,
  SocialProviderConfigSchema,
  EmailAndPasswordConfigSchema,
  EmailVerificationConfigSchema,
  AdvancedAuthConfigSchema,
  AudienceConfigSchema,
  AUDIENCE_POSTURES,
  isAudiencePosture,
  audiencePermitsSelfRegistration,
} from './auth-config.zod';

describe('AuthProviderConfigSchema', () => {
  it('should accept valid provider config', () => {
    const config = AuthProviderConfigSchema.parse({
      id: 'github',
      clientId: 'abc123',
      clientSecret: 'secret456',
    });

    expect(config.id).toBe('github');
    expect(config.clientId).toBe('abc123');
    expect(config.clientSecret).toBe('secret456');
  });

  it('should accept optional scope', () => {
    const config = AuthProviderConfigSchema.parse({
      id: 'google',
      clientId: 'abc123',
      clientSecret: 'secret456',
      scope: ['email', 'profile'],
    });

    expect(config.scope).toEqual(['email', 'profile']);
  });

  it('should reject missing required fields', () => {
    expect(() => AuthProviderConfigSchema.parse({})).toThrow();
    expect(() => AuthProviderConfigSchema.parse({ id: 'github' })).toThrow();
    expect(() => AuthProviderConfigSchema.parse({ id: 'github', clientId: 'abc' })).toThrow();
  });
});

describe('AuthPluginConfigSchema', () => {
  it('should apply defaults for all fields', () => {
    const config = AuthPluginConfigSchema.parse({});

    expect(config.organization).toBe(true);
    expect(config.twoFactor).toBe(false);
    expect(config.passkeys).toBe(false);
    expect(config.magicLink).toBe(false);
  });

  it('should accept custom values', () => {
    const config = AuthPluginConfigSchema.parse({
      organization: true,
      twoFactor: true,
      passkeys: true,
      magicLink: true,
    });

    expect(config.organization).toBe(true);
    expect(config.twoFactor).toBe(true);
    expect(config.passkeys).toBe(true);
    expect(config.magicLink).toBe(true);
  });
});

describe('AuthConfigSchema', () => {
  it('should accept minimal configuration', () => {
    const config = AuthConfigSchema.parse({});

    expect(config.secret).toBeUndefined();
    expect(config.baseUrl).toBeUndefined();
    expect(config.providers).toBeUndefined();
    expect(config.plugins).toBeUndefined();
    expect(config.session).toBeUndefined();
  });

  it('should accept full configuration', () => {
    const config = AuthConfigSchema.parse({
      secret: 'my-secret',
      baseUrl: 'https://auth.example.com',
      databaseUrl: 'postgres://localhost/auth',
      providers: [
        { id: 'github', clientId: 'abc', clientSecret: 'def' },
      ],
      plugins: { organization: true, twoFactor: true },
      session: { expiresIn: 3600, updateAge: 600 },
    });

    expect(config.secret).toBe('my-secret');
    expect(config.baseUrl).toBe('https://auth.example.com');
    expect(config.providers).toHaveLength(1);
    expect(config.plugins?.organization).toBe(true);
    expect(config.session?.expiresIn).toBe(3600);
  });

  it('should apply session defaults', () => {
    const config = AuthConfigSchema.parse({
      session: {},
    });

    expect(config.session?.expiresIn).toBe(60 * 60 * 24 * 7);
    expect(config.session?.updateAge).toBe(60 * 60 * 24);
  });

  it('should allow extra properties via catchall', () => {
    const config = AuthConfigSchema.parse({
      customSetting: 'value',
    });

    expect(config.customSetting).toBe('value');
  });

  it('should accept trustedOrigins as an array of strings', () => {
    const config = AuthConfigSchema.parse({
      trustedOrigins: ['https://*.example.com', 'http://localhost:3000'],
    });

    expect(config.trustedOrigins).toEqual(['https://*.example.com', 'http://localhost:3000']);
  });

  it('should accept empty trustedOrigins array', () => {
    const config = AuthConfigSchema.parse({
      trustedOrigins: [],
    });

    expect(config.trustedOrigins).toEqual([]);
  });

  it('should allow trustedOrigins to be omitted', () => {
    const config = AuthConfigSchema.parse({});

    expect(config.trustedOrigins).toBeUndefined();
  });
});

// ==========================================
// Mutual TLS Configuration Tests
// ==========================================

describe('MutualTLSConfigSchema', () => {
  it('should accept minimal mTLS config', () => {
    const config = MutualTLSConfigSchema.parse({
      trustedCAs: ['/path/to/ca.pem'],
      certificateValidation: 'strict',
    });

    expect(config.enabled).toBe(false);
    expect(config.clientCertRequired).toBe(false);
    expect(config.trustedCAs).toHaveLength(1);
    expect(config.certificateValidation).toBe('strict');
  });

  it('should accept full mTLS config', () => {
    const config = MutualTLSConfigSchema.parse({
      enabled: true,
      clientCertRequired: true,
      trustedCAs: ['/path/to/ca1.pem', '/path/to/ca2.pem'],
      crlUrl: 'https://crl.example.com/crl.pem',
      ocspUrl: 'https://ocsp.example.com',
      certificateValidation: 'strict',
      allowedCNs: ['client.example.com', 'service.example.com'],
      allowedOUs: ['Engineering', 'DevOps'],
      pinning: {
        enabled: true,
        pins: ['sha256/AAAA', 'sha256/BBBB'],
      },
    });

    expect(config.enabled).toBe(true);
    expect(config.clientCertRequired).toBe(true);
    expect(config.trustedCAs).toHaveLength(2);
    expect(config.allowedCNs).toHaveLength(2);
    expect(config.allowedOUs).toHaveLength(2);
    expect(config.pinning?.enabled).toBe(true);
    expect(config.pinning?.pins).toHaveLength(2);
  });

  it('should accept all certificate validation levels', () => {
    const levels = ['strict', 'relaxed', 'none'] as const;
    levels.forEach(level => {
      const config = MutualTLSConfigSchema.parse({
        trustedCAs: [],
        certificateValidation: level,
      });
      expect(config.certificateValidation).toBe(level);
    });
  });

  it('should require trustedCAs and certificateValidation', () => {
    expect(() => MutualTLSConfigSchema.parse({})).toThrow();
    expect(() => MutualTLSConfigSchema.parse({
      trustedCAs: [],
    })).toThrow();
  });

  it('should accept mTLS in AuthConfigSchema', () => {
    const config = AuthConfigSchema.parse({
      mutualTls: {
        enabled: true,
        clientCertRequired: true,
        trustedCAs: ['/certs/ca.pem'],
        certificateValidation: 'strict',
      },
    });

    expect(config.mutualTls?.enabled).toBe(true);
    expect(config.mutualTls?.clientCertRequired).toBe(true);
  });
});

// ==========================================
// Social Provider Configuration Tests
// ==========================================

describe('SocialProviderConfigSchema', () => {
  it('should accept a map of providers', () => {
    const config = SocialProviderConfigSchema.parse({
      google: { clientId: 'gid', clientSecret: 'gsecret' },
      github: { clientId: 'ghid', clientSecret: 'ghsecret', scope: ['repo'] },
    });

    expect(config?.google.clientId).toBe('gid');
    expect(config?.github.scope).toEqual(['repo']);
  });

  it('should default enabled to true', () => {
    const config = SocialProviderConfigSchema.parse({
      google: { clientId: 'gid', clientSecret: 'gsecret' },
    });

    expect(config?.google.enabled).toBe(true);
  });

  it('should allow extra provider-specific properties via catchall', () => {
    const config = SocialProviderConfigSchema.parse({
      google: { clientId: 'gid', clientSecret: 'gsecret', accessType: 'offline' },
    });

    expect((config?.google as any).accessType).toBe('offline');
  });

  it('should accept undefined (omitted)', () => {
    const config = SocialProviderConfigSchema.parse(undefined);
    expect(config).toBeUndefined();
  });
});

// ==========================================
// Email And Password Configuration Tests
// ==========================================

describe('EmailAndPasswordConfigSchema', () => {
  it('should accept full config', () => {
    const config = EmailAndPasswordConfigSchema.parse({
      enabled: true,
      disableSignUp: false,
      requireEmailVerification: true,
      minPasswordLength: 10,
      maxPasswordLength: 64,
      autoSignIn: false,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 7200,
    });

    expect(config?.enabled).toBe(true);
    expect(config?.minPasswordLength).toBe(10);
    expect(config?.revokeSessionsOnPasswordReset).toBe(true);
  });

  it('should default enabled to true', () => {
    const config = EmailAndPasswordConfigSchema.parse({});
    expect(config?.enabled).toBe(true);
  });

  it('should accept undefined (omitted)', () => {
    const config = EmailAndPasswordConfigSchema.parse(undefined);
    expect(config).toBeUndefined();
  });
});

// ==========================================
// Email Verification Configuration Tests
// ==========================================

describe('EmailVerificationConfigSchema', () => {
  it('should accept full config', () => {
    const config = EmailVerificationConfigSchema.parse({
      sendOnSignUp: true,
      sendOnSignIn: false,
      autoSignInAfterVerification: true,
      expiresIn: 1800,
    });

    expect(config?.sendOnSignUp).toBe(true);
    expect(config?.expiresIn).toBe(1800);
  });

  it('should accept empty object', () => {
    const config = EmailVerificationConfigSchema.parse({});
    expect(config).toBeDefined();
    expect(config?.sendOnSignUp).toBeUndefined();
  });

  it('should accept undefined (omitted)', () => {
    const config = EmailVerificationConfigSchema.parse(undefined);
    expect(config).toBeUndefined();
  });
});

// ==========================================
// Advanced Auth Configuration Tests
// ==========================================

describe('AdvancedAuthConfigSchema', () => {
  it('should accept crossSubDomainCookies', () => {
    const config = AdvancedAuthConfigSchema.parse({
      crossSubDomainCookies: {
        enabled: true,
        domain: '.objectos.app',
      },
    });

    expect(config?.crossSubDomainCookies?.enabled).toBe(true);
    expect(config?.crossSubDomainCookies?.domain).toBe('.objectos.app');
  });

  it('should accept all advanced options', () => {
    const config = AdvancedAuthConfigSchema.parse({
      crossSubDomainCookies: {
        enabled: true,
        additionalCookies: ['my_cookie'],
      },
      useSecureCookies: true,
      disableCSRFCheck: false,
      cookiePrefix: 'objectos',
    });

    expect(config?.useSecureCookies).toBe(true);
    expect(config?.cookiePrefix).toBe('objectos');
  });

  it('should accept undefined (omitted)', () => {
    const config = AdvancedAuthConfigSchema.parse(undefined);
    expect(config).toBeUndefined();
  });
});

// ==========================================
// AuthConfigSchema integration with new fields
// ==========================================

describe('AuthConfigSchema – new passthrough fields', () => {
  it('should accept socialProviders in AuthConfig', () => {
    const config = AuthConfigSchema.parse({
      socialProviders: {
        google: { clientId: 'gid', clientSecret: 'gsecret' },
      },
    });

    expect(config.socialProviders?.google.clientId).toBe('gid');
  });

  it('should accept emailAndPassword in AuthConfig', () => {
    const config = AuthConfigSchema.parse({
      emailAndPassword: {
        enabled: true,
        minPasswordLength: 12,
      },
    });

    expect(config.emailAndPassword?.minPasswordLength).toBe(12);
  });

  it('should accept emailVerification in AuthConfig', () => {
    const config = AuthConfigSchema.parse({
      emailVerification: { sendOnSignUp: true, expiresIn: 600 },
    });

    expect(config.emailVerification?.sendOnSignUp).toBe(true);
  });

  it('should accept advanced in AuthConfig', () => {
    const config = AuthConfigSchema.parse({
      advanced: {
        crossSubDomainCookies: { enabled: true, domain: '.objectos.app' },
        useSecureCookies: true,
      },
    });

    expect(config.advanced?.crossSubDomainCookies?.enabled).toBe(true);
    expect(config.advanced?.useSecureCookies).toBe(true);
  });

  it('should accept all new fields together', () => {
    const config = AuthConfigSchema.parse({
      secret: 'my-secret',
      baseUrl: 'https://app.objectos.app',
      trustedOrigins: ['https://*.objectos.app'],
      socialProviders: {
        google: { clientId: 'g', clientSecret: 's' },
        github: { clientId: 'g', clientSecret: 's' },
      },
      emailAndPassword: { enabled: true, requireEmailVerification: true },
      emailVerification: { sendOnSignUp: true },
      advanced: { crossSubDomainCookies: { enabled: true } },
    });

    expect(config.socialProviders).toBeDefined();
    expect(config.emailAndPassword?.requireEmailVerification).toBe(true);
    expect(config.emailVerification?.sendOnSignUp).toBe(true);
    expect(config.advanced?.crossSubDomainCookies?.enabled).toBe(true);
  });
});

describe('AudienceConfigSchema (#11739)', () => {
  it('defaults an undeclared posture to invite_only (the ruled safe default)', () => {
    const parsed = AudienceConfigSchema.parse({});
    expect(parsed.posture).toBe('invite_only');
  });

  it('exposes the closed vocabulary as a runtime value list with a type guard', () => {
    expect(AUDIENCE_POSTURES).toEqual(['invite_only', 'email_domain', 'open']);
    for (const p of AUDIENCE_POSTURES) expect(isAudiencePosture(p)).toBe(true);
    // Off-vocabulary values — including the fail-open shapes the
    // MembershipPolicy precedent exists for — are NOT postures.
    for (const bad of ['inviteOnly', 'invite-only', 'OPEN', 'domain', '', null, undefined, 0, {}]) {
      expect(isAudiencePosture(bad)).toBe(false);
    }
  });

  it('classifies which postures permit self-registration', () => {
    expect(audiencePermitsSelfRegistration('invite_only')).toBe(false);
    expect(audiencePermitsSelfRegistration('email_domain')).toBe(true);
    expect(audiencePermitsSelfRegistration('open')).toBe(true);
  });

  it('refuses an off-vocabulary posture loudly (never coerces)', () => {
    for (const bad of ['inviteOnly', 'invite-only', 'Open', 'anything']) {
      expect(() => AudienceConfigSchema.parse({ posture: bad })).toThrow();
    }
  });

  it('email_domain requires a non-empty domain list (completeness predicate)', () => {
    expect(() => AudienceConfigSchema.parse({ posture: 'email_domain', selfRegistrationPermissionSet: 'portal_user' })).toThrow(/allowedEmailDomains/);
    expect(() => AudienceConfigSchema.parse({
      posture: 'email_domain', allowedEmailDomains: [], selfRegistrationPermissionSet: 'portal_user',
    })).toThrow(/non-empty/);
    const ok = AudienceConfigSchema.parse({
      posture: 'email_domain', allowedEmailDomains: ['acme.com'], selfRegistrationPermissionSet: 'portal_user',
    });
    expect(ok.allowedEmailDomains).toEqual(['acme.com']);
  });

  it('refuses a domain list under a posture that never reads it (declared-but-inert, ADR-0078)', () => {
    expect(() => AudienceConfigSchema.parse({
      posture: 'invite_only', allowedEmailDomains: ['acme.com'],
    })).toThrow(/inert/);
    expect(() => AudienceConfigSchema.parse({
      posture: 'open', allowedEmailDomains: ['acme.com'], selfRegistrationPermissionSet: 'portal_user',
    })).toThrow(/inert/);
  });

  it('validates domain entry shape and refuses duplicates', () => {
    for (const bad of ['@acme.com', 'https://acme.com', 'acme', '.acme.com', 'acme.com.', 'a cme.com', '*.acme.com', '']) {
      expect(() => AudienceConfigSchema.parse({
        posture: 'email_domain', allowedEmailDomains: [bad], selfRegistrationPermissionSet: 'portal_user',
      })).toThrow();
    }
    expect(() => AudienceConfigSchema.parse({
      posture: 'email_domain', allowedEmailDomains: ['acme.com', 'ACME.com'], selfRegistrationPermissionSet: 'portal_user',
    })).toThrow(/duplicate/);
  });

  it('a self-registration-permitting posture requires the permission set declaration', () => {
    expect(() => AudienceConfigSchema.parse({ posture: 'open' })).toThrow(/selfRegistrationPermissionSet/);
    expect(() => AudienceConfigSchema.parse({
      posture: 'email_domain', allowedEmailDomains: ['acme.com'],
    })).toThrow(/selfRegistrationPermissionSet/);
    // Declaring member_default EXPLICITLY is fine — what is retired is the fallback.
    const ok = AudienceConfigSchema.parse({ posture: 'open', selfRegistrationPermissionSet: 'member_default' });
    expect(ok.selfRegistrationPermissionSet).toBe('member_default');
  });

  it('refuses admin_full_access as the self-registration permission set', () => {
    expect(() => AudienceConfigSchema.parse({
      posture: 'open', selfRegistrationPermissionSet: 'admin_full_access',
    })).toThrow(/admin_full_access/);
  });

  it('refuses a permission set declared under invite_only (inert there)', () => {
    expect(() => AudienceConfigSchema.parse({
      posture: 'invite_only', selfRegistrationPermissionSet: 'portal_user',
    })).toThrow(/inert/);
  });

  it('rides AuthConfigSchema as the authorable `audience` key', () => {
    const parsed = AuthConfigSchema.parse({
      audience: { posture: 'email_domain', allowedEmailDomains: ['acme.com'], selfRegistrationPermissionSet: 'portal_user' },
    });
    expect((parsed.audience as { posture?: string } | undefined)?.posture).toBe('email_domain');
    expect(() => AuthConfigSchema.parse({ audience: { posture: 'bogus' } })).toThrow();
  });
});
