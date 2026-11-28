// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#16569] `GET /organization/list-user-invitations` needs a verified email
// address, on every deployment: a session whose address is not verified is
// refused, as it is at accept and decline, so the listing never hands it an
// invitation's id. `get-invitation` alone stays open to the recipient.
//
// These run the REAL better-auth pipeline through a REAL `AuthManager` — the
// organization plugin, the audience-gate invitation carve-out, the membership
// reconciler and the ObjectQL adapter — the same shape as
// `accept-invitation-adopt-membership.test.ts`. Nothing on the listing path is
// stubbed: the rows come back through the vendor's own `getOrgAdapter(...)
// .listUserInvitations(email)`, which is the one definition of "which
// invitations may this session see" — this suite pins that the rebuilt route
// never widens it (own email only, no client-side `?email=`).
//
// ## One fixture fact every inbox assertion has to know
//
// Fixture users beyond the first enter through the audience gate's invitation
// carve-out (`audience-gate-test-support.ts`), which seeds a PENDING
// `sys_invitation` row addressed to the sign-up email under
// `org_audience_gate`. That row is a real pending invitation to the very email
// being listed, so it is CORRECTLY in the invitee's inbox — the suite counts
// it as B's (it strengthens the own-email pin) and excludes it only where an
// exact id set is compared.

// Pays the first load of the egress module at collection, not inside a clocked test.
import '@objectstack/core/egress';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, assertEngineFindOnePredicate } from '@objectstack/objectql';
import { AuthManager } from './auth-manager';
import { inviteForAudienceGate } from './audience-gate-test-support';
import {
  EMAIL_VERIFICATION_REQUIRED_FOR_INVITATION,
  LIST_USER_INVITATIONS_PATH,
  requireVerifiedAddressOnListing,
} from './list-user-invitations-verification';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const BASE = 'http://localhost:3000';
const DEFAULT_ORG = 'org_default';
const PARTNER_ORG = 'org_partner';
/** The org the audience-gate carve-out seeds its row under (see header). */
const AUDIENCE_GATE_ORG = 'org_audience_gate';
const PASSWORD = 'S3cure!Passw0rd-16569';

/** The minimal engine double the other end-to-end auth-manager suites use. */
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
  const matches = (row: any, where: Record<string, any> = {}): boolean =>
    Object.entries(where).every(([k, v]) => {
      // A conjunction of conditions, as the engine's predicate path takes one.
      if (k === '$and' && Array.isArray(v)) return v.every((w) => matches(row, w));
      if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
      const actual = row[k];
      if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
        if ('$ne' in v) return !eq(actual, v.$ne);
        if ('$in' in v) return (v.$in as any[]).some((x) => eq(actual, x));
        if ('$gt' in v) return actual > v.$gt;
        if ('$gte' in v) return actual >= v.$gte;
        if ('$lt' in v) return actual < v.$lt;
        if ('$lte' in v) return actual <= v.$lte;
        if ('$regex' in v) return new RegExp(String(v.$regex)).test(String(actual ?? ''));
      }
      return eq(actual, v);
    });

  let seq = 0;
  return {
    tables,
    async insert(name: string, data: any) {
      const row = { id: data.id ?? `row_${++seq}`, ...data };
      rows(name).push(row);
      return { ...row };
    },
    async findOne(name: string, q: any = {}) {
      assertEngineFindOnePredicate(name, q);
      const found = rows(name).find((r) => matches(r, q.where));
      return found ? { ...found } : null;
    },
    async find(name: string, q: any = {}) {
      let out = rows(name).filter((r) => matches(r, q.where));
      const order = q.orderBy?.[0];
      if (order) {
        out = [...out].sort(
          (a, b) => (a[order.field] > b[order.field] ? 1 : -1) * (order.order === 'desc' ? -1 : 1),
        );
      }
      if (typeof q.offset === 'number') out = out.slice(q.offset);
      // By PRESENCE, not truthiness: `limit: 0` is a bound, not its absence
      // (`check:objectql-double-limit`).
      if (typeof q.limit === 'number') out = out.slice(0, q.limit);
      return out.map((r) => ({ ...r }));
    },
    async count(name: string, q: any = {}) {
      return rows(name).filter((r) => matches(r, q.where)).length;
    },
    async update(name: string, patch: any, options?: any) {
      const dispatch = assertEngineUpdateDispatch(patch, options);
      // The predicate path (`multi: true`, a `where` and no id in the payload)
      // writes every matching row and answers how many it wrote.
      if (dispatch.kind === 'multi') {
        const targets = rows(name).filter((r) => matches(r, options?.where));
        for (const target of targets) Object.assign(target, patch);
        return targets.length;
      }
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

type MemoryEngine = ReturnType<typeof createMemoryEngine>;

const singleOrgTenancy = () =>
  ({
    posture: 'single',
    requestedPosture: 'single',
    isolationActive: false,
    requested: false,
    degraded: false,
    defaultOrgId: async () => DEFAULT_ORG,
  }) as any;

const makeManager = (engine: MemoryEngine) =>
  new AuthManager({
    secret: SECRET,
    baseUrl: BASE,
    dataEngine: engine as any,
    membershipPolicy: 'auto',
    getTenancy: () => singleOrgTenancy(),
  });

const cookieFrom = (response: Response): string =>
  (response.headers.getSetCookie?.() ?? [response.headers.get('set-cookie') ?? ''])
    .map((c) => c.split(';')[0])
    .filter(Boolean)
    .join('; ');

const post = (manager: AuthManager, path: string, body: unknown, cookie?: string) =>
  manager.handleRequest(
    new Request(`${BASE}/api/v1/auth${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(body),
    }),
  );

const get = (manager: AuthManager, path: string, cookie?: string) =>
  manager.handleRequest(
    new Request(`${BASE}/api/v1/auth${path}`, {
      method: 'GET',
      headers: cookie ? { cookie } : {},
    }),
  );

/**
 * Sign a user up and return their session cookie + user id. No mailer is wired,
 * so the account starts UNVERIFIED — asserted; a case that needs a verified
 * session marks it with {@link verify}.
 */
const signUp = async (manager: AuthManager, engine: MemoryEngine, email: string) => {
  const invitationId = await inviteForAudienceGate(engine, email);
  const res = await post(manager, '/sign-up/email', { email, password: PASSWORD, name: email, invitationId });
  expect(res.status, await res.clone().text()).toBe(200);
  const user = (engine.tables.get('sys_user') ?? []).find((u) => u.email === email);
  expect(user, `sign-up did not create ${email}`).toBeDefined();
  expect(Boolean(user!.email_verified), `${email} should start unverified (no mailer)`).toBe(false);
  return { cookie: cookieFrom(res), userId: String(user!.id) };
};

const membersOf = (engine: MemoryEngine, organizationId: string, userId: string) =>
  (engine.tables.get('sys_member') ?? []).filter(
    (m) => m.organization_id === organizationId && m.user_id === userId,
  );

const setRole = (engine: MemoryEngine, organizationId: string, userId: string, role: string) => {
  const [row] = membersOf(engine, organizationId, userId);
  expect(row, 'no membership to promote — the reconciler did not bind').toBeDefined();
  row!.role = role;
};

const seedOrganizations = (engine: MemoryEngine) => {
  engine.tables.set('sys_organization', [
    { id: DEFAULT_ORG, name: 'Default', slug: 'default' },
    { id: PARTNER_ORG, name: 'Partner', slug: 'partner' },
  ]);
};

/** Invite `email` into `organizationId` as the owner; returns the vendor's row. */
const invite = async (
  manager: AuthManager,
  ownerCookie: string,
  email: string,
  organizationId: string,
) => {
  const res = await post(
    manager,
    '/organization/invite-member',
    { email, role: 'member', organizationId },
    ownerCookie,
  );
  expect(res.status, await res.clone().text()).toBe(200);
  const body: any = await res.json();
  expect(body.id, 'invite-member answered without an id').toBeTruthy();
  return body as { id: string; email: string; organizationId: string; status: string };
};

/** The inbox rows that are NOT the audience-gate seed — for exact id comparisons. */
const issuedRows = (body: any[]) => body.filter((i) => i.organizationId !== AUDIENCE_GATE_ORG);

/**
 * Bring up a deployment with an owner of BOTH organizations who can issue
 * invitations into either.
 */
const bootWithOwner = async () => {
  const engine = createMemoryEngine();
  seedOrganizations(engine);
  const manager = makeManager(engine);
  const owner = await signUp(manager, engine, 'owner@example.com');
  setRole(engine, DEFAULT_ORG, owner.userId, 'owner');
  await engine.insert('sys_member', {
    id: 'mem_owner_partner',
    organization_id: PARTNER_ORG,
    user_id: owner.userId,
    role: 'owner',
    created_at: new Date(),
  });
  return { engine, manager, owner };
};

/**
 * The fixture every test reads: two invitations addressed to B (one per
 * organization) and one addressed to C — the row that must NEVER appear in
 * B's inbox. Invitations are issued BEFORE the invitees exist, because
 * `invite-member` refuses an address that is already a member of the target
 * org, and B's sign-up auto-binds B to the default org.
 */
const bootInbox = async () => {
  const { engine, manager, owner } = await bootWithOwner();
  const bDefault = await invite(manager, owner.cookie, 'b@example.com', DEFAULT_ORG);
  const bPartner = await invite(manager, owner.cookie, 'b@example.com', PARTNER_ORG);
  const cPartner = await invite(manager, owner.cookie, 'c@example.com', PARTNER_ORG);
  const b = await signUp(manager, engine, 'b@example.com');
  return { engine, manager, owner, b, bDefault, bPartner, cPartner };
};

/** Mark a fixture user's address verified, as completing the verification mail does. */
const verify = (engine: MemoryEngine, userId: string) => {
  const user = (engine.tables.get('sys_user') ?? []).find((u) => u.id === userId);
  expect(user, `no user ${userId}`).toBeDefined();
  user!.email_verified = true;
};

describe('the invitation inbox requires a verified address, as accept and decline do; reading an invitation does not', () => {
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('a session whose address is not verified is refused by the listing, accept and reject alike, and can read the invitation', async () => {
    const { engine, manager, b, bDefault, bPartner } = await bootInbox();
    const refused = async (res: Response, code: string) => {
      const text = await res.clone().text();
      expect(res.status, text).toBe(403);
      expect((JSON.parse(text) as { code?: unknown }).code).toBe(code);
      return text;
    };

    const listed = await refused(await get(manager, LIST_USER_INVITATIONS_PATH, b.cookie), EMAIL_VERIFICATION_REQUIRED_FOR_INVITATION.code);
    expect(listed).not.toContain(bDefault.id);
    expect(listed).not.toContain(bPartner.id);
    const read = await get(manager, `/organization/get-invitation?id=${bPartner.id}`, b.cookie);
    expect(read.status, await read.clone().text()).toBe(200);
    await refused(
      await post(manager, '/organization/reject-invitation', { invitationId: bPartner.id }, b.cookie),
      'EMAIL_VERIFICATION_REQUIRED_BEFORE_ACCEPTING_OR_REJECTING_INVITATION',
    );
    await refused(
      await post(manager, '/organization/accept-invitation', { invitationId: bPartner.id }, b.cookie),
      'EMAIL_VERIFICATION_REQUIRED_BEFORE_ACCEPTING_OR_REJECTING_INVITATION',
    );

    expect(membersOf(engine, PARTNER_ORG, b.userId)).toHaveLength(0);
    const statuses = (engine.tables.get('sys_invitation') ?? [])
      .filter((i) => i.id === bDefault.id || i.id === bPartner.id)
      .map((i) => i.status);
    expect(statuses).toEqual(['pending', 'pending']);
  });

  it('a verified session lists the invitations addressed to it, and accepts one', async () => {
    const { engine, manager, b, bDefault, bPartner } = await bootInbox();
    verify(engine, b.userId);

    const res = await get(manager, LIST_USER_INVITATIONS_PATH, b.cookie);
    expect(res.status, await res.clone().text()).toBe(200);
    const body: any = await res.json();
    expect(Array.isArray(body), 'the vendor route answers a bare array').toBe(true);
    expect(issuedRows(body).map((i: any) => i.id).sort()).toEqual([bDefault.id, bPartner.id].sort());
    for (const inv of body) {
      expect(inv.email).toBe('b@example.com');
      expect(inv.status).toBe('pending');
    }

    const accepted = await post(manager, '/organization/accept-invitation', { invitationId: bPartner.id }, b.cookie);
    expect(accepted.status, await accepted.clone().text()).toBe(200);
    expect(membersOf(engine, PARTNER_ORG, b.userId)).toHaveLength(1);
  });

  it('SCOPE PIN: the listing is the session email\'s own — another user\'s invitation is never visible', async () => {
    const { engine, manager, b, cPartner } = await bootInbox();
    verify(engine, b.userId);

    const res = await get(manager, LIST_USER_INVITATIONS_PATH, b.cookie);
    expect(res.status, await res.clone().text()).toBe(200);
    const body: any[] = await res.json();
    expect(body.length).toBeGreaterThan(0);
    expect(body.some((i) => i.id === cPartner.id), 'C\'s invitation leaked into B\'s inbox').toBe(false);
    expect(body.some((i) => i.email === 'c@example.com')).toBe(false);
    // Every row — the audience-gate seed included — is addressed to B.
    expect(body.every((i) => i.email === 'b@example.com')).toBe(true);
  });

  it('SCOPE PIN: a client-side `?email=` is still refused with the vendor\'s 400 — no listing by arbitrary address', async () => {
    const { engine, manager, b } = await bootInbox();
    verify(engine, b.userId);

    const res = await get(
      manager,
      `${LIST_USER_INVITATIONS_PATH}?email=${encodeURIComponent('c@example.com')}`,
      b.cookie,
    );
    expect(res.status, await res.clone().text()).toBe(400);
    const body: any = await res.json();
    expect(String(body.message)).toMatch(/cannot be passed for client side/i);
  });

  it('SCOPE PIN: no session and no email keeps the vendor\'s 400 (the route was never anonymous)', async () => {
    const { manager } = await bootInbox();
    const res = await get(manager, LIST_USER_INVITATIONS_PATH);
    expect(res.status, await res.clone().text()).toBe(400);
  });

  it('only PENDING rows are listed — a rejected invitation drops out', async () => {
    const { engine, manager, b, bDefault, bPartner } = await bootInbox();
    verify(engine, b.userId);

    const rejected = await post(
      manager,
      '/organization/reject-invitation',
      { invitationId: bPartner.id },
      b.cookie,
    );
    expect(rejected.status, await rejected.clone().text()).toBe(200);

    const res = await get(manager, LIST_USER_INVITATIONS_PATH, b.cookie);
    expect(res.status, await res.clone().text()).toBe(200);
    const body: any[] = await res.json();
    expect(issuedRows(body).map((i) => i.id)).toEqual([bDefault.id]);
  });
});

describe('#16569 — the rebuilt endpoint is the vendor\'s contract, carrying the verified-address rule itself', () => {
  it('replaces the endpoint IN PLACE, under the vendor\'s key, from the vendor\'s own options object', async () => {
    const { organization } = await import('better-auth/plugins/organization');
    const options = { requireEmailVerificationOnInvitation: false as const };
    const plugin: any = organization(options);
    const vendor = plugin.endpoints.listUserInvitations;
    expect(vendor?.path).toBe(LIST_USER_INVITATIONS_PATH);
    const keysBefore = Object.keys(plugin.endpoints).sort();

    await expect(requireVerifiedAddressOnListing(plugin, options)).resolves.toBe(true);

    const rebuilt = plugin.endpoints.listUserInvitations;
    expect(rebuilt).not.toBe(vendor);
    expect(rebuilt.path).toBe(LIST_USER_INVITATIONS_PATH);
    // The request contract is the vendor's own objects, by IDENTITY — no
    // second copy exists to drift. (`createAuthEndpoint` shallow-copies the
    // options record to append its own base middleware to `use`, measured on
    // better-call 1.4.0 `createEndpoint.create`; the vendor's entries are all
    // still there.)
    expect(rebuilt.options.method).toBe(vendor.options.method);
    expect(rebuilt.options.query).toBe(vendor.options.query);
    expect(rebuilt.options.metadata).toBe(vendor.options.metadata);
    for (const middleware of vendor.options.use ?? []) {
      expect(rebuilt.options.use).toContain(middleware);
    }
    // No endpoint added, none dropped: one owner for the path.
    expect(Object.keys(plugin.endpoints).sort()).toEqual(keysBefore);
  });

  it('a plugin without the endpoint is left untouched and reported (the vendor-drift door)', async () => {
    const plugin = { id: 'organization', endpoints: { listInvitations: { path: '/organization/list-invitations', options: {} } } };
    await expect(requireVerifiedAddressOnListing(plugin, {})).resolves.toBe(false);
    expect(Object.keys(plugin.endpoints)).toEqual(['listInvitations']);
  });

  it('the locally restated refusal is the vendor\'s own $ERROR_CODES entry', async () => {
    const { organization } = await import('better-auth/plugins/organization');
    const plugin: any = organization({});
    // `code` and `message` are the wire contract; the vendor's entry also
    // carries a `toString` helper that never reaches the wire.
    const vendorEntry = plugin.$ERROR_CODES?.EMAIL_VERIFICATION_REQUIRED_FOR_INVITATION;
    expect(vendorEntry?.code).toBe(EMAIL_VERIFICATION_REQUIRED_FOR_INVITATION.code);
    expect(vendorEntry?.message).toBe(EMAIL_VERIFICATION_REQUIRED_FOR_INVITATION.message);
  });
});

// ---------------------------------------------------------------------------
// The vendor handler as it stands — the pin that sees an upstream change
// ---------------------------------------------------------------------------

/**
 * Locate this package by walking up from the CWD — the idiom
 * `member-role-canonical.test.ts` uses here and states the reason for:
 * plugin-auth is CJS-typed (no `"type": "module"`), so under
 * `module: NodeNext` `import.meta` is a TS1470 in this package.
 */
function findUp(predicate: (dir: string) => boolean, what: string): string {
  let dir = process.cwd();
  for (;;) {
    if (predicate(dir)) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`could not locate ${what}`);
    dir = parent;
  }
}

const PKG = findUp((dir) => {
  const manifest = join(dir, 'package.json');
  if (!existsSync(manifest)) return false;
  const { name } = JSON.parse(readFileSync(manifest, 'utf8')) as { name?: string };
  return name === '@objectstack/plugin-auth';
}, 'the @objectstack/plugin-auth package root');

// Resolved from THIS package, so the file read is the better-auth this package
// is pinned to — not whatever a hoist happens to put at the repo root.
const require_ = createRequire(join(PKG, 'probe.js'));
const VENDOR_DIST = dirname(require_.resolve('better-auth'));
const CRUD_INVITES = join(VENDOR_DIST, 'plugins', 'organization', 'routes', 'crud-invites.mjs');

describe('#16569 — vendor pin: better-auth\'s listUserInvitations refuses unconditionally, and its siblings read the option', () => {
  const source = readFileSync(CRUD_INVITES, 'utf8');
  const start = source.indexOf('const listUserInvitations = ');
  const listing = start >= 0 ? source.slice(start) : '';

  it('positive control: the file read is the invite-route module and declares the route', () => {
    expect(start, 'listUserInvitations declaration not found — vendor file moved?').toBeGreaterThanOrEqual(0);
    expect(listing).toContain('"/organization/list-user-invitations"');
  });

  it('the three id-addressed siblings still ask the option, and the listing still does not', () => {
    // Siblings: accept / reject / get-invitation — one call each.
    const siblingCalls = source.slice(0, start).match(/shouldRequireVerifiedEmailForInvitationIdAction\(\{/g) ?? [];
    expect(siblingCalls).toHaveLength(3);
    // The listing: the unconditional refusal, verbatim. When upstream makes
    // this line read the option, this pin goes red: the rebuild then is what
    // keeps the inbox closed under the platform's `false` declaration.
    expect(listing).toMatch(
      /if \(session && !session\.user\.emailVerified\) throw APIError\.from\("FORBIDDEN", ORGANIZATION_ERROR_CODES\.EMAIL_VERIFICATION_REQUIRED_FOR_INVITATION\);/,
    );
    expect(listing).not.toContain('shouldRequireVerifiedEmailForInvitationIdAction(');
  });
});
