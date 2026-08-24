// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The ID-SHAPED platform-admin question, asked at the two gates that turn its
// answer into authorization: `/sso/register` and `/admin/impersonate-user`.
//
// Both gates used to ask a judge that lived in `auth-manager.ts` and re-derived
// the ADR-0068 D2 standing itself. `core/security/resolve-authz-context.ts`
// declares that every entry point must resolve authorization through it and
// never re-read `sys_*_permission_set` — so the judge was a second
// implementation of a predicate that already had an owner, and the two had
// drifted apart in ways nothing could see while both existed.
//
// This suite pins the answer at the GATES rather than at the predicate, because
// that is the only place the drift was ever observable. Every case is asserted
// in BOTH directions on the same fixture family (a genuine platform admin is
// admitted; the near-miss principal is refused), and every refusal is asserted
// as STATUS **and** `code` (ADR-0112) — a bare "it refused" cannot tell this
// gate's answer apart from a validation error or from the vendor's own.
//
// Three properties are pinned that a widened implementation would score green
// without:
//
//   • an ORG owner / org admin — and a TENANT_ADMIN-posture principal — is NOT
//     a platform admin at either gate. #10009/#10390 spent a whole card taking
//     that wider reading off `/sso/register`; pinning only "the platform admin
//     is admitted" would go green against a gate that admits everyone.
//   • a grant outside its ADR-0091 validity window, and a DEACTIVATED
//     `admin_full_access` row (ADR-0049), authorize NOTHING. Four distinct
//     refusals, two per gate, deliberately not collapsed into one case that
//     could pass for the wrong reason.
//   • the `admin_full_access` row is resolved by IDENTITY, not by scanning a
//     page of the catalogue. Pinned with a catalogue larger than any fixed page
//     — the environment shape in which a page scan silently demotes every
//     platform admin at once.
//
// Real pipeline throughout: requests go in as `Request` objects through
// `AuthManager.handleRequest`, over a real better-auth instance carrying the
// real `admin` and `@better-auth/sso` plugins.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ADMIN_FULL_ACCESS } from '@objectstack/spec/identity';
import { AuthManager } from './auth-manager';
// ⚠️ Imported from a sibling TEST file on purpose — the same trade
// `admin-impersonate-endpoint.test.ts` measured and documented at its own
// import of it: re-registering that file's `describe`s here is cheaper than
// minting a second engine double (a second looseness risk plus new
// `check:engine-double-contract` ledger entries) and far cheaper than moving it
// to a plain `.ts` helper, which would remove it from that gate's sight
// entirely (the gate discovers doubles by walking `*.test.ts` only).
import { createMemoryEngine } from './impersonation-bearer-rotation.test';
import { inviteForAudienceGate } from './audience-gate-test-support';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const PASSWORD = 'S3cure!Passw0rd-10348';
const BASE = 'http://localhost:3000/api/v1/auth';
const PS_ADMIN = 'ps_admin_full_access';
const PS_ORG_ADMIN = 'ps_organization_admin';

/** Bigger than any fixed page a catalogue scan could have read. */
const DECOY_PERMISSION_SETS = 60;

const makeManager = (engine: any) =>
  new AuthManager({
    secret: SECRET,
    baseUrl: 'http://localhost:3000',
    dataEngine: engine,
    // `/admin/impersonate-user` lives on better-auth's `admin` plugin and
    // `/sso/register` on `@better-auth/sso`; both are opt-in in this repo.
    plugins: { admin: true, sso: true },
  } as any);

const signUp = (manager: AuthManager, email: string, name: string) => {
  // [#11739] default posture invite_only: fixture users beyond the first
  // enter through the invitation carve-out (see audience-gate-test-support).
  inviteForAudienceGate(manager, email);
  return manager.handleRequest(
    new Request(`${BASE}/sign-up/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD, name }),
    }),
  );
};

const signIn = (manager: AuthManager, email: string) =>
  manager.handleRequest(
    new Request(`${BASE}/sign-in/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD }),
    }),
  );

const bearerFrom = (response: Response): string => {
  const token = response.headers.get('set-auth-token');
  if (!token) throw new Error('no set-auth-token on the response');
  return token;
};

const userRows = (engine: any) => (engine.tables.get('sys_user') ?? []) as any[];

const userIdFor = (engine: any, email: string): string => {
  const row = userRows(engine).find((r) => r.email === email);
  if (!row) throw new Error(`no sys_user row for ${email}`);
  return String(row.id);
};

const jsonOf = async (res: Response) => {
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { __raw: text }; }
};

// ── the two gates ───────────────────────────────────────────────────────────

/**
 * The ObjectStack refusal on `/sso/register` (ADR-0024 + ADR-0068 D4).
 *
 * ⭐ The pin is on OUR gate's answer, so "admitted" means exactly "this
 * refusal was not issued" — and that is deliberate rather than a compromise.
 * Measured on this fixture family: a near-miss principal gets
 * `403 SSO_REGISTER_FORBIDDEN` (our before-hook fired) and a platform admin
 * gets the vendor's own judgment of the body instead (`400 VALIDATION_ERROR`
 * on this deliberately incomplete SAML shape) — two answers that cannot be
 * confused, from one request shape. Pinning our gate rather than a successful
 * registration also keeps the suite valid across a vendor schema bump, which a
 * body pinned to today's schema would not be. Every "admitted" case below
 * carries an IN-TEST control proving the refusal is reachable on the same
 * engine with the same body, so admission is never a vacuous pass.
 */
const SSO_REGISTER_BODY = {
  providerId: 'pin-idp',
  issuer: 'https://idp.example.com/entity',
  domain: 'idp.example.com',
  samlConfig: {
    entryPoint: 'https://idp.example.com/sso',
    cert: 'MIICertificateBodyForThePin',
    callbackUrl: 'http://localhost:3000/api/v1/auth/sso/saml2/sp/acs/pin-idp',
    identifierFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
    spMetadata: { entityID: 'http://localhost:3000/api/v1/auth/sso/saml2/sp/metadata?providerId=pin-idp' },
  },
};

const ssoRegister = (manager: AuthManager, bearer: string) =>
  manager.handleRequest(
    new Request(`${BASE}/sso/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', authorization: `Bearer ${bearer}` },
      body: JSON.stringify(SSO_REGISTER_BODY),
    }),
  );

/** `{ refused, status, code }` for the `/sso/register` gate. */
const ssoVerdict = async (manager: AuthManager, bearer: string) => {
  const res = await ssoRegister(manager, bearer);
  const body = await jsonOf(res);
  const code = body?.code ?? body?.error?.code;
  return { refused: res.status === 403 && code === 'SSO_REGISTER_FORBIDDEN', status: res.status, code };
};

const impersonate = (manager: AuthManager, bearer: string, userId: string) =>
  manager.handleRequest(
    new Request(`${BASE}/admin/impersonate-user`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', authorization: `Bearer ${bearer}` },
      body: JSON.stringify({ userId }),
    }),
  );

/** `{ refused, status, code }` for the `/admin/impersonate-user` gate. */
const impersonateVerdict = async (manager: AuthManager, bearer: string, userId: string) => {
  const res = await impersonate(manager, bearer, userId);
  const body = await jsonOf(res);
  const code = body?.code ?? body?.error?.code;
  return {
    refused: res.status === 403 && code === 'YOU_ARE_NOT_ALLOWED_TO_IMPERSONATE_USERS',
    status: res.status,
    code,
  };
};

// ── fixture seeding ─────────────────────────────────────────────────────────

interface StandingShape {
  /** Rows written into `sys_permission_set` BEFORE `admin_full_access`. */
  decoySets?: number;
  /** ADR-0049: the `admin_full_access` catalogue row is switched off. */
  deactivatedSet?: boolean;
  /** ADR-0091: the grant carries a `valid_until` already in the past. */
  expiredGrant?: boolean;
  /** ADR-0068 D2 says PLATFORM standing is the ORG-LESS link; this scopes it. */
  orgScopedGrant?: boolean;
}

const seedPlatformAdmin = async (engine: any, userId: string, shape: StandingShape = {}) => {
  for (let i = 0; i < (shape.decoySets ?? 0); i += 1) {
    await engine.insert('sys_permission_set', { id: `ps_decoy_${i}`, name: `decoy_set_${i}` });
  }
  await engine.insert('sys_permission_set', {
    id: PS_ADMIN,
    name: ADMIN_FULL_ACCESS,
    ...(shape.deactivatedSet ? { active: false } : {}),
  });
  await engine.insert('sys_user_permission_set', {
    user_id: userId,
    permission_set_id: PS_ADMIN,
    organization_id: shape.orgScopedGrant ? 'org_pin' : null,
    ...(shape.expiredGrant ? { valid_until: new Date(Date.now() - 60_000).toISOString() } : {}),
  });
};

/** An org OWNER/ADMIN — administrative inside one tenant, and nothing more. */
const seedOrgAdmin = async (engine: any, userId: string, role: 'owner' | 'admin') => {
  await engine.insert('sys_organization', { id: 'org_pin', name: 'Pin Org', slug: 'pin-org' });
  await engine.insert('sys_member', { organization_id: 'org_pin', user_id: userId, role });
};

/**
 * A principal whose resolved posture is TENANT_ADMIN — the strongest near-miss
 * there is. It holds the `organization_admin` capability grant, org-scoped.
 */
const seedTenantAdmin = async (engine: any, userId: string) => {
  await engine.insert('sys_organization', { id: 'org_pin', name: 'Pin Org', slug: 'pin-org' });
  await engine.insert('sys_member', { organization_id: 'org_pin', user_id: userId, role: 'owner' });
  await engine.insert('sys_permission_set', { id: PS_ORG_ADMIN, name: 'organization_admin' });
  await engine.insert('sys_user_permission_set', {
    user_id: userId,
    permission_set_id: PS_ORG_ADMIN,
    organization_id: 'org_pin',
  });
};

/**
 * Two signed-in principals over one engine: `caller` (the one under test) and
 * `target` (an ordinary user for the impersonation body). The caller's standing
 * is seeded by `seed` BEFORE sign-in, so the session it gets is the one the
 * product would mint for that standing.
 */
const arrange = async (seed?: (engine: any, callerId: string) => Promise<void>) => {
  const engine = createMemoryEngine();
  const manager = makeManager(engine);

  await signUp(manager, 'caller@example.com', 'Caller');
  await signUp(manager, 'target@example.com', 'Target');

  const callerId = userIdFor(engine, 'caller@example.com');
  const targetId = userIdFor(engine, 'target@example.com');
  if (seed) await seed(engine, callerId);

  // The premise every case below rests on: standing is never the legacy scalar.
  // If a future seed starts writing `role: 'admin'`, the admissions would go
  // green through the vendor's own gate instead of ObjectStack's.
  const callerRow = userRows(engine).find((r) => String(r.id) === callerId);
  expect(callerRow.role ?? 'user').not.toBe('admin');

  const callerBearer = bearerFrom(await signIn(manager, 'caller@example.com'));
  // `target` holds NO standing of any kind — the in-test control for every
  // "admitted" case: the same gate, same engine, same body, refused.
  const targetBearer = bearerFrom(await signIn(manager, 'target@example.com'));
  return { engine, manager, callerId, targetId, callerBearer, targetBearer };
};

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

// ───────────────────────────────────────────────────────────────────────────
// PIN 1 — the genuine ADR-0068 D2 platform admin is admitted at BOTH gates.
// ───────────────────────────────────────────────────────────────────────────
describe('a genuine platform admin (ADR-0068 D2 org-less admin_full_access) is ADMITTED', () => {
  it('/sso/register admits (and refuses the standing-less control on the same engine)', async () => {
    const { manager, callerBearer, targetBearer } = await arrange((e, id) => seedPlatformAdmin(e, id));
    const v = await ssoVerdict(manager, callerBearer);
    expect(v, JSON.stringify(v)).toMatchObject({ refused: false });
    expect(await ssoVerdict(manager, targetBearer)).toMatchObject({
      refused: true,
      status: 403,
      code: 'SSO_REGISTER_FORBIDDEN',
    });
  });

  it('/admin/impersonate-user admits', async () => {
    const { manager, callerBearer, targetId } = await arrange((e, id) => seedPlatformAdmin(e, id));
    const res = await impersonate(manager, callerBearer, targetId);
    expect(res.status, await res.clone().text()).toBe(200);
    expect((await jsonOf(res))?.user?.id).toBe(targetId);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// PIN 2 — the #10009/#10390 boundary: administrative INSIDE an org is not
// platform standing. Without this, a widened implementation scores green on
// PIN 1 alone.
// ───────────────────────────────────────────────────────────────────────────
describe('an org owner / org admin / TENANT_ADMIN principal is NOT admitted', () => {
  const nearMisses: Array<[string, (e: any, id: string) => Promise<void>]> = [
    ['org owner (sys_member.role = owner)', (e, id) => seedOrgAdmin(e, id, 'owner')],
    ['org admin (sys_member.role = admin)', (e, id) => seedOrgAdmin(e, id, 'admin')],
    ['TENANT_ADMIN posture (organization_admin capability grant)', seedTenantAdmin],
    ['an ORG-SCOPED admin_full_access grant', (e, id) => seedPlatformAdmin(e, id, { orgScopedGrant: true })],
  ];

  for (const [label, seed] of nearMisses) {
    it(`/sso/register refuses ${label}`, async () => {
      const { manager, callerBearer } = await arrange(seed);
      const v = await ssoVerdict(manager, callerBearer);
      expect(v, JSON.stringify(v)).toMatchObject({ refused: true, status: 403, code: 'SSO_REGISTER_FORBIDDEN' });
    });

    it(`/admin/impersonate-user refuses ${label}`, async () => {
      const { manager, callerBearer, targetId } = await arrange(seed);
      const v = await impersonateVerdict(manager, callerBearer, targetId);
      expect(v, JSON.stringify(v)).toMatchObject({
        refused: true,
        status: 403,
        code: 'YOU_ARE_NOT_ALLOWED_TO_IMPERSONATE_USERS',
      });
    });
  }

  it('a plain member with no standing at all is refused at both gates', async () => {
    const { manager, callerBearer, targetId } = await arrange();
    expect(await ssoVerdict(manager, callerBearer)).toMatchObject({ refused: true, code: 'SSO_REGISTER_FORBIDDEN' });
    expect(await impersonateVerdict(manager, callerBearer, targetId)).toMatchObject({
      refused: true,
      code: 'YOU_ARE_NOT_ALLOWED_TO_IMPERSONATE_USERS',
    });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// PIN 3 — fail-closed floor.
// ───────────────────────────────────────────────────────────────────────────
describe('fail-closed floor', () => {
  it('an empty user id is refused WITHOUT reading anything', async () => {
    const engine = createMemoryEngine();
    const manager = makeManager(engine);
    const findSpy = vi.spyOn(engine, 'find');
    expect(await (manager as any).isPlatformAdminUserId('')).toBe(false);
    expect(findSpy).not.toHaveBeenCalled();
  });

  it('an unknown user id is refused', async () => {
    const engine = createMemoryEngine();
    const manager = makeManager(engine);
    expect(await (manager as any).isPlatformAdminUserId('usr_does_not_exist')).toBe(false);
  });

  it('a standing lookup that THROWS is refused at both gates (never an exception out of the gate)', async () => {
    const { engine, manager, callerBearer, targetId } = await arrange((e, id) => seedPlatformAdmin(e, id));

    // Break the standing reads only — after sign-in, so the session itself is
    // real. Anything the resolver reads to answer "is this a platform admin"
    // now fails; the gate must refuse rather than admit or throw.
    const realFind = engine.find.bind(engine);
    engine.find = async (name: string, q: any = {}) => {
      if (name.startsWith('sys_user_permission_set') || name === 'sys_permission_set') {
        throw new Error('standing lookup unavailable');
      }
      return realFind(name, q);
    };

    expect(await ssoVerdict(manager, callerBearer)).toMatchObject({ refused: true, code: 'SSO_REGISTER_FORBIDDEN' });
    expect(await impersonateVerdict(manager, callerBearer, targetId)).toMatchObject({
      refused: true,
      code: 'YOU_ARE_NOT_ALLOWED_TO_IMPERSONATE_USERS',
    });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// PIN 4 (#10949 axis ①) — a grant that has lapsed, and a catalogue row that has
// been switched off, authorize NOTHING. Four distinct refusals.
// ───────────────────────────────────────────────────────────────────────────
describe('ADR-0091 validity window — an EXPIRED admin_full_access grant authorizes nothing', () => {
  it('/sso/register refuses the expired grant', async () => {
    const { manager, callerBearer } = await arrange((e, id) => seedPlatformAdmin(e, id, { expiredGrant: true }));
    const v = await ssoVerdict(manager, callerBearer);
    expect(v, JSON.stringify(v)).toMatchObject({ refused: true, status: 403, code: 'SSO_REGISTER_FORBIDDEN' });
  });

  it('/admin/impersonate-user refuses the expired grant', async () => {
    const { manager, callerBearer, targetId } = await arrange((e, id) =>
      seedPlatformAdmin(e, id, { expiredGrant: true }),
    );
    const v = await impersonateVerdict(manager, callerBearer, targetId);
    expect(v, JSON.stringify(v)).toMatchObject({
      refused: true,
      status: 403,
      code: 'YOU_ARE_NOT_ALLOWED_TO_IMPERSONATE_USERS',
    });
  });
});

describe('ADR-0049 active flag — a DEACTIVATED admin_full_access row authorizes nothing', () => {
  it('/sso/register refuses while the catalogue row is switched off', async () => {
    const { manager, callerBearer } = await arrange((e, id) => seedPlatformAdmin(e, id, { deactivatedSet: true }));
    const v = await ssoVerdict(manager, callerBearer);
    expect(v, JSON.stringify(v)).toMatchObject({ refused: true, status: 403, code: 'SSO_REGISTER_FORBIDDEN' });
  });

  it('/admin/impersonate-user refuses while the catalogue row is switched off', async () => {
    const { manager, callerBearer, targetId } = await arrange((e, id) =>
      seedPlatformAdmin(e, id, { deactivatedSet: true }),
    );
    const v = await impersonateVerdict(manager, callerBearer, targetId);
    expect(v, JSON.stringify(v)).toMatchObject({
      refused: true,
      status: 403,
      code: 'YOU_ARE_NOT_ALLOWED_TO_IMPERSONATE_USERS',
    });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// PIN 5 (#10949 axis ②) — the row is resolved by IDENTITY. A catalogue bigger
// than any fixed page must not demote the platform admin.
// ───────────────────────────────────────────────────────────────────────────
describe('admin_full_access is resolved by identity, not by scanning a page of the catalogue', () => {
  it(`/sso/register still admits with ${DECOY_PERMISSION_SETS} other permission sets ahead of it`, async () => {
    const { manager, callerBearer, targetBearer } = await arrange((e, id) =>
      seedPlatformAdmin(e, id, { decoySets: DECOY_PERMISSION_SETS }),
    );
    const v = await ssoVerdict(manager, callerBearer);
    expect(v, JSON.stringify(v)).toMatchObject({ refused: false });
    expect(await ssoVerdict(manager, targetBearer)).toMatchObject({
      refused: true,
      status: 403,
      code: 'SSO_REGISTER_FORBIDDEN',
    });
  });

  it(`/admin/impersonate-user still admits with ${DECOY_PERMISSION_SETS} other permission sets ahead of it`, async () => {
    const { manager, callerBearer, targetId } = await arrange((e, id) =>
      seedPlatformAdmin(e, id, { decoySets: DECOY_PERMISSION_SETS }),
    );
    const res = await impersonate(manager, callerBearer, targetId);
    expect(res.status, await res.clone().text()).toBe(200);
  });

  it('the same catalogue does NOT start admitting a plain member (the pin is not vacuous)', async () => {
    const { manager, callerBearer, targetId } = await arrange(async (e) => {
      for (let i = 0; i < DECOY_PERMISSION_SETS; i += 1) {
        await e.insert('sys_permission_set', { id: `ps_decoy_${i}`, name: `decoy_set_${i}` });
      }
      await e.insert('sys_permission_set', { id: PS_ADMIN, name: ADMIN_FULL_ACCESS });
    });
    expect(await ssoVerdict(manager, callerBearer)).toMatchObject({ refused: true, code: 'SSO_REGISTER_FORBIDDEN' });
    expect(await impersonateVerdict(manager, callerBearer, targetId)).toMatchObject({ refused: true });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// PIN 6 — verdict parity on the session payload. `customSession` derives
// `positions[]` / `isPlatformAdmin` from the same question, and the answer for
// every shape above must be the SAME answer the gates give.
// ───────────────────────────────────────────────────────────────────────────
describe('the session payload agrees with the gates, shape for shape', () => {
  const payloadFor = async (manager: AuthManager, bearer: string) => {
    const auth: any = await manager.getAuthInstance();
    const session = await auth.api
      .getSession({ headers: new Headers({ authorization: `Bearer ${bearer}` }) })
      .catch(() => null);
    return session?.user ?? null;
  };

  it('a genuine platform admin carries platform_admin', async () => {
    const { manager, callerBearer } = await arrange((e, id) => seedPlatformAdmin(e, id));
    const user = await payloadFor(manager, callerBearer);
    expect(user?.isPlatformAdmin).toBe(true);
    expect(user?.positions).toContain('platform_admin');
  });

  it('an org owner does NOT carry platform_admin', async () => {
    const { manager, callerBearer } = await arrange((e, id) => seedOrgAdmin(e, id, 'owner'));
    const user = await payloadFor(manager, callerBearer);
    expect(user?.isPlatformAdmin).toBe(false);
    expect(user?.positions ?? []).not.toContain('platform_admin');
  });

  it('an EXPIRED grant does NOT carry platform_admin', async () => {
    const { manager, callerBearer } = await arrange((e, id) => seedPlatformAdmin(e, id, { expiredGrant: true }));
    const user = await payloadFor(manager, callerBearer);
    expect(user?.isPlatformAdmin).toBe(false);
    expect(user?.positions ?? []).not.toContain('platform_admin');
  });

  it('a DEACTIVATED admin_full_access row does NOT carry platform_admin', async () => {
    const { manager, callerBearer } = await arrange((e, id) => seedPlatformAdmin(e, id, { deactivatedSet: true }));
    const user = await payloadFor(manager, callerBearer);
    expect(user?.isPlatformAdmin).toBe(false);
    expect(user?.positions ?? []).not.toContain('platform_admin');
  });

  it(`still carries platform_admin with ${DECOY_PERMISSION_SETS} other permission sets ahead of it`, async () => {
    const { manager, callerBearer } = await arrange((e, id) =>
      seedPlatformAdmin(e, id, { decoySets: DECOY_PERMISSION_SETS }),
    );
    const user = await payloadFor(manager, callerBearer);
    expect(user?.isPlatformAdmin).toBe(true);
    expect(user?.positions).toContain('platform_admin');
  });

  it('the stored role scalar is still never overwritten (ADR-0068 D2)', async () => {
    const { manager, callerBearer } = await arrange((e, id) => seedPlatformAdmin(e, id));
    const user = await payloadFor(manager, callerBearer);
    expect(user?.role ?? 'user').not.toBe('admin');
  });
});
