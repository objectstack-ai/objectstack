// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#11739] Audience posture — the declared answer to "who may become a user of
// this environment", enforced at better-auth's `user.validateUserInfo` seam.
//
// Three layers, matching the module split:
//
//  1. PURE decision matrix — `decideAudienceAdmission` / `classifyCreationMethod`
//     drive the full posture × creation-method table as direct calls, including
//     the paths an HTTP harness cannot cheaply reach (SSO JIT, SCIM, unknown
//     methods).
//  2. ENTRY validation — `assertAudienceConfig` at the constructor and
//     `applyConfigPatch`: off-vocabulary postures, inert declarations
//     (ADR-0078), the open-with-verification-off contradiction.
//  3. END of the chain (the #4785 lesson: assert the outcome, not the middle) —
//     a real better-auth pipeline over the in-memory engine: refusals carry the
//     REGISTERED code + 403 status on the wire, admissions mint accounts, and
//     an admitted self-registrant really receives the declared permission set
//     (`sys_user_permission_set` row), because a declaration nothing lands is
//     the ADR-0078 defect this card closes.

import { describe, it, expect, vi } from 'vitest';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/objectql';
import { ERROR_CODE_LEDGER } from '@objectstack/spec/api';
import { AuthManager } from './auth-manager';
import {
  assertAudienceConfig,
  classifyCreationMethod,
  decideAudienceAdmission,
  emailDomainAllowed,
  extractEmailDomain,
  resolveAudience,
  SELF_REGISTRATION_CLOSED,
  EMAIL_DOMAIN_NOT_ALLOWED,
  AUDIENCE_CONFIG_ERROR,
  type ResolvedAudience,
} from './audience-posture';

// ── In-memory IDataEngine (the #3585 / session-of-record harness shape) ──────

const createMemoryEngine = () => {
  const tables = new Map<string, any[]>();
  const rows = (name: string) => {
    if (!tables.has(name)) tables.set(name, []);
    return tables.get(name)!;
  };
  const eq = (a: any, b: any) =>
    a instanceof Date || b instanceof Date
      ? new Date(a as any).getTime() === new Date(b as any).getTime()
      : a === b;
  const matches = (row: any, where: Record<string, any> = {}) =>
    Object.entries(where).every(([k, v]) => {
      if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
      const actual = row[k];
      if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
        if ('$ne' in v) return !eq(actual, v.$ne);
        if ('$in' in v) return (v.$in as any[]).some((x) => eq(actual, x));
        if ('$gt' in v) return actual > v.$gt;
        if ('$gte' in v) return actual >= v.$gte;
        if ('$lt' in v) return actual < v.$lt;
        if ('$lte' in v) return actual <= v.$lte;
      }
      return eq(actual, v);
    });
  const project = (row: any, fields?: string[]) => {
    if (!Array.isArray(fields) || fields.length === 0) return { ...row };
    const out: any = {};
    for (const f of ['id', ...fields]) if (f in row) out[f] = row[f];
    return out;
  };
  let seq = 0;
  return {
    tables,
    async insert(name: string, data: any) {
      const row = { id: data.id ?? `row_${++seq}`, ...data };
      rows(name).push(row);
      return { ...row };
    },
    async findOne(name: string, q: any = {}) {
      const row = rows(name).find((r) => matches(r, q.where));
      return row ? project(row, q.fields) : null;
    },
    async find(name: string, q: any = {}) {
      let out = rows(name).filter((r) => matches(r, q.where));
      if (q.offset) out = out.slice(q.offset);
      if (q.limit) out = out.slice(0, q.limit);
      return out.map((r) => project(r, q.fields));
    },
    async count(name: string, q: any = {}) {
      return rows(name).filter((r) => matches(r, q.where)).length;
    },
    async update(name: string, patch: any, options?: any) {
      assertEngineUpdateDispatch(patch, options);
      const row = rows(name).find((r) => r.id === patch.id);
      if (!row) return null;
      Object.assign(row, patch);
      return { ...row };
    },
    async delete(name: string, q: any = {}) {
      assertEngineDeleteDispatch(q);
      const table = rows(name);
      const keep = table.filter((r) => !matches(r, q.where));
      tables.set(name, keep);
      return table.length - keep.length;
    },
  };
};

const SECRET = 'test-secret-at-least-32-chars-long!!';
const PASSWORD = 'S3cure!Passw0rd-4785';

const makeManager = (engine: any, config: Record<string, unknown> = {}) =>
  new AuthManager({
    secret: SECRET,
    baseUrl: 'http://localhost:3000',
    dataEngine: engine,
    ...config,
  } as any);

const signUp = (manager: AuthManager, email: string) =>
  manager.handleRequest(
    new Request('http://localhost:3000/api/v1/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD, name: 'Audience Test' }),
    }),
  );

/** Seed one existing user so the zero-user bootstrap bypass is OFF. */
const seedExistingUser = (engine: any) => {
  engine.tables.set('sys_user', [
    {
      id: 'usr_existing',
      email: 'owner@example.com',
      name: 'Owner',
      email_verified: true,
      created_at: new Date(),
      updated_at: new Date(),
    },
  ]);
};

const seedPermissionSet = (engine: any, name: string, extra: Record<string, unknown> = {}) => {
  engine.tables.set('sys_permission_set', [
    ...(engine.tables.get('sys_permission_set') ?? []),
    { id: `ps_${name}`, name, label: name, active: true, ...extra },
  ]);
};

const seedPendingInvitation = (engine: any, email: string, extra: Record<string, unknown> = {}) => {
  engine.tables.set('sys_invitation', [
    ...(engine.tables.get('sys_invitation') ?? []),
    {
      id: `inv_${Math.random().toString(36).slice(2, 8)}`,
      email,
      status: 'pending',
      organization_id: 'org_1',
      expires_at: new Date(Date.now() + 60_000),
      ...extra,
    },
  ]);
};

const audience = (over: Partial<ResolvedAudience> = {}): ResolvedAudience => ({
  posture: 'invite_only',
  allowedEmailDomains: [],
  ...over,
});

// ─────────────────────────────────────────────────────────────────────────────

describe('pinned domain matching (#11739)', () => {
  it('rule 1: the domain is everything after the LAST @; no @ / empty ⇒ no match ever', () => {
    expect(extractEmailDomain('user@acme.com')).toBe('acme.com');
    expect(extractEmailDomain('we"ird@user@acme.com')).toBe('acme.com');
    expect(extractEmailDomain('no-at-sign')).toBeNull();
    expect(extractEmailDomain('trailing@')).toBeNull();
    expect(extractEmailDomain(undefined)).toBeNull();
    expect(emailDomainAllowed('no-at-sign', ['acme.com'])).toBe(false);
  });

  it('rule 2: case-insensitive on both sides', () => {
    expect(emailDomainAllowed('user@ACME.com', ['acme.com'])).toBe(true);
    expect(emailDomainAllowed('user@acme.com', ['AcMe.CoM'])).toBe(true);
  });

  it('rule 3: exact equality — subdomains are NOT implied, in either direction', () => {
    expect(emailDomainAllowed('user@mail.acme.com', ['acme.com'])).toBe(false);
    expect(emailDomainAllowed('user@acme.com', ['mail.acme.com'])).toBe(false);
    expect(emailDomainAllowed('user@mail.acme.com', ['mail.acme.com'])).toBe(true);
    // A suffix that is not a label boundary must not match either.
    expect(emailDomainAllowed('user@evilacme.com', ['acme.com'])).toBe(false);
  });

  it('rule 4: +tag local parts are irrelevant (matching never reads the local part)', () => {
    expect(emailDomainAllowed('user+anything@acme.com', ['acme.com'])).toBe(true);
    expect(emailDomainAllowed('user+tag@other.com', ['acme.com'])).toBe(false);
  });

  it('placeholder / phone-style addresses carry no matchable domain', () => {
    expect(emailDomainAllowed('', ['acme.com'])).toBe(false);
  });
});

describe('creation-method classification (#11739)', () => {
  const enterprise = { enterpriseOAuthProviderIds: new Set(['okta', 'objectstack-cloud']) };

  it('operator methods are never posture-gated: admin, scim', () => {
    expect(classifyCreationMethod({ method: 'admin' }, enterprise)).toBe('operator');
    expect(classifyCreationMethod({ method: 'scim' }, enterprise)).toBe('operator');
  });

  it('operator-registered identity authorities are provider class: sso-oidc, sso-saml, enterprise oauth', () => {
    expect(classifyCreationMethod({ method: 'sso-oidc' }, enterprise)).toBe('provider');
    expect(classifyCreationMethod({ method: 'sso-saml' }, enterprise)).toBe('provider');
    expect(classifyCreationMethod({ method: 'oauth', oauth: { providerId: 'okta' } }, enterprise)).toBe('provider');
    expect(
      classifyCreationMethod({ method: 'oauth', oauth: { providerId: 'objectstack-cloud' } }, enterprise),
    ).toBe('provider');
  });

  it('self-serve methods are posture-gated: email-password, social oauth, magic-link, email-otp, phone, anonymous, siwe', () => {
    for (const method of ['email-password', 'magic-link', 'email-otp', 'phone-number', 'anonymous', 'siwe']) {
      expect(classifyCreationMethod({ method }, enterprise)).toBe('self-serve');
    }
    expect(classifyCreationMethod({ method: 'oauth', oauth: { providerId: 'google' } }, enterprise)).toBe('self-serve');
  });

  it('an UNRECOGNIZED method is self-serve — fail closed, a future creation path must not bypass the wall', () => {
    expect(classifyCreationMethod({ method: 'future-thing' }, enterprise)).toBe('self-serve');
    expect(classifyCreationMethod({}, enterprise)).toBe('self-serve');
    expect(classifyCreationMethod(undefined, enterprise)).toBe('self-serve');
  });
});

describe('admission decision matrix (#11739): posture × creation class', () => {
  const base = { email: 'user@acme.com', hasPendingInvitation: false, isBootstrap: false };

  it.each([
    ['invite_only', 'operator'],
    ['invite_only', 'provider'],
    ['email_domain', 'operator'],
    ['email_domain', 'provider'],
    ['open', 'operator'],
    ['open', 'provider'],
  ] as const)('%s admits the %s class (admin-create / SSO JIT are operator-sanctioned)', (posture, cls) => {
    const verdict = decideAudienceAdmission({
      ...base,
      audience: audience({ posture, allowedEmailDomains: posture === 'email_domain' ? ['acme.com'] : [] }),
      creationClass: cls,
    });
    expect(verdict).toEqual({ admit: true, grantPermissionSet: false });
  });

  it('invite_only refuses self-serve with SELF_REGISTRATION_CLOSED', () => {
    const verdict = decideAudienceAdmission({ ...base, audience: audience(), creationClass: 'self-serve' });
    expect(verdict.admit).toBe(false);
    if (!verdict.admit) expect(verdict.code).toBe(SELF_REGISTRATION_CLOSED);
  });

  it('invite_only admits a self-serve creation holding a pending invitation (the carve-out)', () => {
    const verdict = decideAudienceAdmission({
      ...base,
      hasPendingInvitation: true,
      audience: audience(),
      creationClass: 'self-serve',
    });
    expect(verdict).toEqual({ admit: true, grantPermissionSet: false });
  });

  it('email_domain admits on-list self-serve WITH the permission-set grant, refuses off-list with EMAIL_DOMAIN_NOT_ALLOWED', () => {
    const aud = audience({
      posture: 'email_domain',
      allowedEmailDomains: ['acme.com'],
      selfRegistrationPermissionSet: 'portal_user',
    });
    expect(decideAudienceAdmission({ ...base, audience: aud, creationClass: 'self-serve' })).toEqual({
      admit: true,
      grantPermissionSet: true,
    });
    const refused = decideAudienceAdmission({
      ...base,
      email: 'user@other.com',
      audience: aud,
      creationClass: 'self-serve',
    });
    expect(refused.admit).toBe(false);
    if (!refused.admit) expect(refused.code).toBe(EMAIL_DOMAIN_NOT_ALLOWED);
  });

  it('an explicit invitation trumps the email_domain allowlist (no invite dead-end for external invitees)', () => {
    const verdict = decideAudienceAdmission({
      ...base,
      email: 'contractor@external.com',
      hasPendingInvitation: true,
      audience: audience({ posture: 'email_domain', allowedEmailDomains: ['acme.com'], selfRegistrationPermissionSet: 'portal_user' }),
      creationClass: 'self-serve',
    });
    expect(verdict).toEqual({ admit: true, grantPermissionSet: false });
  });

  it('open admits self-serve with the grant', () => {
    const verdict = decideAudienceAdmission({
      ...base,
      audience: audience({ posture: 'open', selfRegistrationPermissionSet: 'portal_user' }),
      creationClass: 'self-serve',
    });
    expect(verdict).toEqual({ admit: true, grantPermissionSet: true });
  });

  it('bootstrap (zero users) admits self-serve under every posture — a fresh install never locks its operator out', () => {
    for (const posture of ['invite_only', 'email_domain', 'open'] as const) {
      const verdict = decideAudienceAdmission({
        email: 'owner@anything.com',
        hasPendingInvitation: false,
        isBootstrap: true,
        audience: audience({
          posture,
          allowedEmailDomains: posture === 'email_domain' ? ['acme.com'] : [],
          selfRegistrationPermissionSet: posture === 'invite_only' ? undefined : 'portal_user',
        }),
        creationClass: 'self-serve',
      });
      expect(verdict).toEqual({ admit: true, grantPermissionSet: false });
    }
  });

  it('an off-vocabulary posture refuses with AUTH_CONFIG_ERROR — a verdict distinct from "policy said no" (#5205)', () => {
    const verdict = decideAudienceAdmission({
      ...base,
      audience: audience({ invalid: { raw: "'inviteOnly'" } }),
      creationClass: 'self-serve',
    });
    expect(verdict.admit).toBe(false);
    if (!verdict.admit) {
      expect(verdict.code).toBe(AUDIENCE_CONFIG_ERROR);
      expect(verdict.message).toContain("'inviteOnly'");
      expect(verdict.message).toContain('configuration error');
    }
  });

  it('the three refusal codes are DISTINCT and the two new ones are registered in the ADR-0112 ledger', () => {
    expect(SELF_REGISTRATION_CLOSED).not.toBe(EMAIL_DOMAIN_NOT_ALLOWED);
    expect(SELF_REGISTRATION_CLOSED).not.toBe(AUDIENCE_CONFIG_ERROR);
    const registered = (ERROR_CODE_LEDGER as Record<string, readonly string[]>)['@objectstack/plugin-auth'];
    expect(registered).toContain(SELF_REGISTRATION_CLOSED);
    expect(registered).toContain(EMAIL_DOMAIN_NOT_ALLOWED);
    expect(registered).toContain(AUDIENCE_CONFIG_ERROR);
  });
});

describe('resolveAudience (#11739)', () => {
  it('undeclared ⇒ invite_only (the ruled default — no legacy limbo)', () => {
    expect(resolveAudience(undefined).posture).toBe('invite_only');
    expect(resolveAudience({}).posture).toBe('invite_only');
  });

  it('marks an off-vocabulary posture invalid and coerces DISPLAY to the safe end, never the open one', () => {
    const resolved = resolveAudience({ posture: 'inviteOnly' } as any);
    expect(resolved.posture).toBe('invite_only');
    expect(resolved.invalid?.raw).toBe("'inviteOnly'");
  });
});

describe('entry validation: assertAudienceConfig (#11739)', () => {
  it('accepts an undeclared audience and every well-formed declaration', () => {
    expect(() => assertAudienceConfig(undefined, undefined)).not.toThrow();
    expect(() => assertAudienceConfig({ posture: 'invite_only' }, undefined)).not.toThrow();
    expect(() =>
      assertAudienceConfig(
        { posture: 'email_domain', allowedEmailDomains: ['acme.com'], selfRegistrationPermissionSet: 'portal_user' },
        undefined,
      ),
    ).not.toThrow();
    expect(() =>
      assertAudienceConfig({ posture: 'open', selfRegistrationPermissionSet: 'member_default' }, undefined),
    ).not.toThrow();
  });

  it('refuses an off-vocabulary posture loudly, naming the value and the vocabulary', () => {
    expect(() => assertAudienceConfig({ posture: 'inviteOnly' } as any, undefined)).toThrow(
      /'inviteOnly'.*invite_only, email_domain, open/s,
    );
  });

  it('refuses email_domain without a non-empty, well-formed, duplicate-free domain list', () => {
    expect(() =>
      assertAudienceConfig({ posture: 'email_domain', selfRegistrationPermissionSet: 'p' }, undefined),
    ).toThrow(/non-empty allowedEmailDomains/);
    expect(() =>
      assertAudienceConfig(
        { posture: 'email_domain', allowedEmailDomains: [], selfRegistrationPermissionSet: 'p' },
        undefined,
      ),
    ).toThrow(/non-empty allowedEmailDomains/);
    expect(() =>
      assertAudienceConfig(
        { posture: 'email_domain', allowedEmailDomains: ['@acme.com'], selfRegistrationPermissionSet: 'p' },
        undefined,
      ),
    ).toThrow(/not a bare domain name/);
    expect(() =>
      assertAudienceConfig(
        { posture: 'email_domain', allowedEmailDomains: ['acme.com', 'ACME.COM'], selfRegistrationPermissionSet: 'p' },
        undefined,
      ),
    ).toThrow(/duplicated/);
  });

  it('refuses inert declarations (ADR-0078): domains outside email_domain, permission set under invite_only', () => {
    expect(() =>
      assertAudienceConfig({ posture: 'invite_only', allowedEmailDomains: ['acme.com'] }, undefined),
    ).toThrow(/inert/);
    expect(() =>
      assertAudienceConfig(
        { posture: 'open', allowedEmailDomains: ['acme.com'], selfRegistrationPermissionSet: 'p' },
        undefined,
      ),
    ).toThrow(/inert/);
    expect(() =>
      assertAudienceConfig({ posture: 'invite_only', selfRegistrationPermissionSet: 'p' }, undefined),
    ).toThrow(/inert/);
  });

  it('requires the self-registrant permission set for self-registration-permitting postures, and refuses admin_full_access', () => {
    expect(() => assertAudienceConfig({ posture: 'open' }, undefined)).toThrow(/selfRegistrationPermissionSet/);
    expect(() =>
      assertAudienceConfig({ posture: 'open', selfRegistrationPermissionSet: 'admin_full_access' }, undefined),
    ).toThrow(/admin_full_access/);
  });

  it('refuses the open-posture-with-verification-off contradiction (verification is FORCED on)', () => {
    expect(() =>
      assertAudienceConfig(
        { posture: 'open', selfRegistrationPermissionSet: 'p' },
        { requireEmailVerification: false },
      ),
    ).toThrow(/verification/i);
    // Explicit true and undefined are both fine — the wiring forces true.
    expect(() =>
      assertAudienceConfig(
        { posture: 'open', selfRegistrationPermissionSet: 'p' },
        { requireEmailVerification: true },
      ),
    ).not.toThrow();
  });

  it('the constructor runs the same assertion (boot refusal, not a first-signup 403)', () => {
    expect(() => makeManager(createMemoryEngine(), { audience: { posture: 'bogus' } })).toThrow(/bogus/);
    expect(() =>
      makeManager(createMemoryEngine(), { audience: { posture: 'email_domain', allowedEmailDomains: [] as string[] } }),
    ).toThrow(/allowedEmailDomains/);
  });

  it('applyConfigPatch refuses an invalid merged result and the standing config keeps ruling', () => {
    const manager = makeManager(createMemoryEngine(), {
      audience: { posture: 'open', selfRegistrationPermissionSet: 'portal_user' },
    });
    expect(() => manager.applyConfigPatch({ audience: { posture: 'email_domain' } } as any)).toThrow(
      /allowedEmailDomains/,
    );
    expect(manager.getAudience().posture).toBe('open');
    // A verification-off patch beside a standing open posture is the same contradiction.
    expect(() =>
      manager.applyConfigPatch({ emailAndPassword: { requireEmailVerification: false } } as any),
    ).toThrow(/verification/i);
  });
});

describe('end of the chain: better-auth pipeline over the memory engine (#11739)', () => {
  it('bootstrap: the very first signup is admitted under the default (undeclared ⇒ invite_only)', async () => {
    const engine = createMemoryEngine();
    const manager = makeManager(engine);
    const res = await signUp(manager, 'first@anything.com');
    expect(res.status).toBeLessThan(300);
    expect(engine.tables.get('sys_user')?.length).toBe(1);
  });

  it('undeclared audience: a SECOND self-serve signup is refused 403 SELF_REGISTRATION_CLOSED', async () => {
    const engine = createMemoryEngine();
    const manager = makeManager(engine);
    await signUp(manager, 'first@anything.com');
    const res = await signUp(manager, 'second@anything.com');
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe(SELF_REGISTRATION_CLOSED);
    expect(String(body.message)).toContain('Self-registration is closed');
    // The refusal really refused — no second user row landed.
    expect(engine.tables.get('sys_user')?.length).toBe(1);
  });

  it('invite_only: a pending invitation admits the invitee (case-insensitively), an expired one does not', async () => {
    const engine = createMemoryEngine();
    seedExistingUser(engine);
    const manager = makeManager(engine);
    seedPendingInvitation(engine, 'Bob@Acme.com');
    const admitted = await signUp(manager, 'bob@acme.com');
    expect(admitted.status).toBeLessThan(300);

    seedPendingInvitation(engine, 'late@acme.com', { expires_at: new Date(Date.now() - 60_000) });
    const refused = await signUp(manager, 'late@acme.com');
    expect(refused.status).toBe(403);
    expect((await refused.json()).code).toBe(SELF_REGISTRATION_CLOSED);
  });

  it('email_domain: on-list admitted AND the declared permission set really lands; off-list refused with EMAIL_DOMAIN_NOT_ALLOWED', async () => {
    const engine = createMemoryEngine();
    seedExistingUser(engine);
    seedPermissionSet(engine, 'portal_user');
    const manager = makeManager(engine, {
      audience: {
        posture: 'email_domain',
        allowedEmailDomains: ['acme.com'],
        selfRegistrationPermissionSet: 'portal_user',
      },
    });

    const admitted = await signUp(manager, 'User+tag@ACME.com');
    expect(admitted.status).toBeLessThan(300);
    // declared = enforced: the grant row exists, bound to the created user.
    await vi.waitFor(() => {
      const grants = engine.tables.get('sys_user_permission_set') ?? [];
      expect(grants.length).toBe(1);
      expect(grants[0].permission_set_id).toBe('ps_portal_user');
      const created = (engine.tables.get('sys_user') ?? []).find((u: any) => u.email === 'user+tag@acme.com');
      expect(grants[0].user_id).toBe(created?.id);
    });

    const refused = await signUp(manager, 'user@mail.acme.com'); // subdomain: NOT implied
    expect(refused.status).toBe(403);
    const body = await refused.json();
    expect(body.code).toBe(EMAIL_DOMAIN_NOT_ALLOWED);
    expect((engine.tables.get('sys_user') ?? []).some((u: any) => u.email === 'user@mail.acme.com')).toBe(false);
  });

  it('email_domain forces email verification on: the wired flag, the public config, and the minted session agree', async () => {
    const engine = createMemoryEngine();
    seedExistingUser(engine);
    seedPermissionSet(engine, 'portal_user');
    const manager = makeManager(engine, {
      audience: {
        posture: 'email_domain',
        allowedEmailDomains: ['acme.com'],
        selfRegistrationPermissionSet: 'portal_user',
      },
    });
    // Public surface mirrors the forcing (nothing set requireEmailVerification).
    const pub = manager.getPublicConfig();
    expect(pub.emailPassword.requireEmailVerification).toBe(true);
    expect((pub.features as any).audiencePosture).toBe('email_domain');
    // And better-auth really runs with it: the admitted signup creates the
    // user but does NOT auto-sign-in an unverified account.
    const res = await signUp(manager, 'user@acme.com');
    expect(res.status).toBeLessThan(300);
    const body = await res.json().catch(() => ({}));
    expect(body?.token ?? null).toBeNull();
  });

  it('a DANGLING declared permission set refuses admission with AUTH_CONFIG_ERROR — never an ungranted admit', async () => {
    const engine = createMemoryEngine();
    seedExistingUser(engine);
    // NOTE: no sys_permission_set row named 'ghost' is seeded.
    const manager = makeManager(engine, {
      audience: { posture: 'open', selfRegistrationPermissionSet: 'ghost' },
    });
    const res = await signUp(manager, 'user@anywhere.com');
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe(AUDIENCE_CONFIG_ERROR);
    expect(String(body.message)).toContain("'ghost'");
    expect((engine.tables.get('sys_user') ?? []).length).toBe(1);
  });

  it('open: self-serve admitted and granted', async () => {
    const engine = createMemoryEngine();
    seedExistingUser(engine);
    seedPermissionSet(engine, 'member_default');
    const manager = makeManager(engine, {
      audience: { posture: 'open', selfRegistrationPermissionSet: 'member_default' },
    });
    const res = await signUp(manager, 'anyone@anywhere.com');
    expect(res.status).toBeLessThan(300);
    await vi.waitFor(() => {
      expect((engine.tables.get('sys_user_permission_set') ?? []).length).toBe(1);
    });
  });

  it('an off-vocabulary posture smuggled past entry (direct mutation) fails CLOSED at admission with AUTH_CONFIG_ERROR', async () => {
    const engine = createMemoryEngine();
    seedExistingUser(engine);
    const manager = makeManager(engine);
    (manager as any).config.audience = { posture: 'inviteOnly' };
    const res = await signUp(manager, 'user@anywhere.com');
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe(AUDIENCE_CONFIG_ERROR);
    // Display surfaces coerce to the SAFE end while enforcement refuses.
    expect((manager.getPublicConfig().features as any).audiencePosture).toBe('invite_only');
  });

  it('the admission gate classifies enterprise oidcProviders JIT as provider class (admitted under invite_only)', async () => {
    const engine = createMemoryEngine();
    seedExistingUser(engine);
    const manager = makeManager(engine, {
      oidcProviders: [
        { providerId: 'okta', clientId: 'x', clientSecret: 'y', discoveryUrl: 'https://idp.example/.well-known/openid-configuration' },
      ],
    });
    const nonBootstrapCtx = { context: { adapter: { findOne: async () => ({ id: 'usr_existing' }) } } };
    const enterprise = await (manager as any).validateAudienceAdmission(
      {
        user: { email: 'jit@corp.com' },
        source: { action: 'create-user', method: 'oauth', oauth: { providerId: 'okta' } },
      },
      nonBootstrapCtx,
    );
    expect(enterprise).toBeUndefined();
    const social = await (manager as any).validateAudienceAdmission(
      {
        user: { email: 'jit@gmail.com' },
        source: { action: 'create-user', method: 'oauth', oauth: { providerId: 'google' } },
      },
      nonBootstrapCtx,
    );
    expect(social?.error).toBe(SELF_REGISTRATION_CLOSED);
    // SSO JIT and SCIM ride their own methods — admitted under invite_only.
    for (const method of ['sso-oidc', 'sso-saml', 'scim', 'admin']) {
      const verdict = await (manager as any).validateAudienceAdmission(
        { user: { email: 'x@corp.com' }, source: { action: 'create-user', method } },
        nonBootstrapCtx,
      );
      expect(verdict).toBeUndefined();
    }
    // link-account / sign-in actions are not audience admission.
    const linking = await (manager as any).validateAudienceAdmission(
      { user: { email: 'x@corp.com' }, source: { action: 'link-account', method: 'oauth', oauth: { providerId: 'google' } } },
      nonBootstrapCtx,
    );
    expect(linking).toBeUndefined();
  });
});
