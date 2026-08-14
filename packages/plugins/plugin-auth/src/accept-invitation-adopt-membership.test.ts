// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#7725] Regression suite for "accept-invitation returns a bodyless 500 and the
// invitation stays `pending` forever".
//
// These run the REAL better-auth pipeline through a REAL `AuthManager` — the
// organization plugin, the framework's `beforeCreateInvitation` role cap, the
// membership reconciler on `user.create.after`, and the ObjectQL adapter — the
// same shape as `auth-manager.jwt-eddsa-fallback.test.ts`. Nothing on the
// acceptance path is stubbed.
//
// ## The one thing the fake engine MUST do, or this whole file is theatre
//
// `sys_member` declares `{ organization_id, user_id }` UNIQUE
// (`platform-objects/src/identity/sys-member.object.ts`). A plain in-memory map
// happily stores two rows for one pair, so on such a fake the defect is
// invisible: acceptance "succeeds", the invitation flips to `accepted`, and the
// only symptom is a duplicate row nobody asserted about. The reported failure is
// the DATABASE refusing the second insert, so {@link createMemoryEngine} enforces
// that index and throws in SQLite's own words. That is what makes the ablation
// (revert the fix → these tests go red) mean anything.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/objectql';
import { AuthManager } from './auth-manager';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const BASE = 'http://localhost:3000';
const DEFAULT_ORG = 'org_default';
const PARTNER_ORG = 'org_partner';
const PASSWORD = 'S3cure!Passw0rd-7725';

/**
 * In-memory engine that ENFORCES `sys_member`'s declared unique index.
 *
 * Everything else is the same minimal engine double the other end-to-end
 * auth-manager suites use.
 */
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
        if ('$regex' in v) return new RegExp(String(v.$regex)).test(String(actual ?? ''));
      }
      return eq(actual, v);
    });

  /**
   * The declared index, in the driver's voice. The message is quoted from the
   * server log on the issue so a future reader can match the two by eye.
   */
  const assertMemberUnique = (name: string, candidate: any, ignoreId?: string) => {
    if (name !== 'sys_member') return;
    const clash = rows(name).some(
      (r) =>
        r.id !== ignoreId &&
        eq(r.organization_id, candidate.organization_id) &&
        eq(r.user_id, candidate.user_id),
    );
    if (clash) {
      throw new Error(
        'insert into sys_member … UNIQUE constraint failed: ' +
          'sys_member.organization_id, sys_member.user_id',
      );
    }
  };

  let seq = 0;
  return {
    tables,
    async insert(name: string, data: any) {
      const row = { id: data.id ?? `row_${++seq}`, ...data };
      assertMemberUnique(name, row);
      rows(name).push(row);
      return { ...row };
    },
    async findOne(name: string, q: any = {}) {
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
      if (q.offset) out = out.slice(q.offset);
      if (q.limit) out = out.slice(0, q.limit);
      return out.map((r) => ({ ...r }));
    },
    async count(name: string, q: any = {}) {
      return rows(name).filter((r) => matches(r, q.where)).length;
    },
    async update(name: string, patch: any, options?: any) {
      // Pinned to ObjectQL.update's own dispatch predicate, for the same reason
      // `delete` below is: this fake carries the ADOPTION write, so a fake looser
      // than the real engine would let a by-id update that ObjectQL refuses look
      // like a working adoption. `adopt-membership.ts` dispatches by scalar id.
      assertEngineUpdateDispatch(patch, options);
      const row = rows(name).find((r) => r.id === patch.id);
      if (!row) return null;
      assertMemberUnique(name, { ...row, ...patch }, row.id);
      Object.assign(row, patch);
      return { ...row };
    },
    async delete(name: string, q: any = {}) {
      // [#4550] Pinned to ObjectQL.delete's own dispatch predicate rather than a
      // hand-written approximation of it — a fake that accepts a call the real
      // engine refuses is how a dead route ships with its suite green.
      assertEngineDeleteDispatch(q);
      const table = rows(name);
      const keep = table.filter((r) => !matches(r, q.where));
      tables.set(name, keep);
      return table.length - keep.length;
    },
  };
};

type MemoryEngine = ReturnType<typeof createMemoryEngine>;

/** Minimal tenancy stub — the reconciler only ever asks for `defaultOrgId()`. */
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
    // Single-org, auto-bind — the ADR-0093 D1/D2 posture the defect lives on.
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

/** Sign a user up and return their session cookie + user id. */
const signUp = async (manager: AuthManager, engine: MemoryEngine, email: string) => {
  const res = await post(manager, '/sign-up/email', { email, password: PASSWORD, name: email });
  expect(res.status, await res.clone().text()).toBe(200);
  const user = (engine.tables.get('sys_user') ?? []).find((u) => u.email === email);
  expect(user, `sign-up did not create ${email}`).toBeDefined();
  return { cookie: cookieFrom(res), userId: String(user!.id) };
};

const membersOf = (engine: MemoryEngine, organizationId: string, userId: string) =>
  (engine.tables.get('sys_member') ?? []).filter(
    (m) => m.organization_id === organizationId && m.user_id === userId,
  );

const invitationsFor = (engine: MemoryEngine, email: string) =>
  (engine.tables.get('sys_invitation') ?? []).filter((i) => i.email === email);

/** Force a membership role directly, the way an operator's data would look. */
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

/**
 * Bring up a deployment with an owner who can issue invitations.
 *
 * Order matters and mirrors the issue's reproduction: the invitation is created
 * BEFORE the invitee exists, because better-auth's `invite-member` refuses an
 * email that is already a member of the target org
 * (`USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION`). The collision is created by
 * the invitee then SIGNING UP, at which point the reconciler binds them to the
 * default organization — the very org they were invited into.
 */
const bootWithOwner = async () => {
  const engine = createMemoryEngine();
  seedOrganizations(engine);
  const manager = makeManager(engine);
  const owner = await signUp(manager, engine, 'owner@example.com');
  setRole(engine, DEFAULT_ORG, owner.userId, 'owner');
  return { engine, manager, owner };
};

describe('#7725 — accepting an invitation when the invitee is already auto-bound', () => {
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('the reported bug: acceptance returns 2xx, the invitation becomes accepted, and there is exactly ONE membership', async () => {
    const { engine, manager, owner } = await bootWithOwner();

    const invite = await post(
      manager,
      '/organization/invite-member',
      { email: 'invitee@example.com', role: 'member', organizationId: DEFAULT_ORG },
      owner.cookie,
    );
    expect(invite.status, await invite.clone().text()).toBe(200);
    const [invitation] = invitationsFor(engine, 'invitee@example.com');
    expect(invitation?.status).toBe('pending');

    // The sign-up that creates the collision: the reconciler binds the invitee
    // to the default org, which is the invitation's target org.
    const invitee = await signUp(manager, engine, 'invitee@example.com');
    expect(membersOf(engine, DEFAULT_ORG, invitee.userId)).toHaveLength(1);

    const accept = await post(
      manager,
      '/organization/accept-invitation',
      { invitationId: String(invitation.id) },
      invitee.cookie,
    );

    // Before the fix this was a 500 with an EMPTY body.
    expect(accept.status, await accept.clone().text()).toBe(200);
    const body: any = await accept.json();
    expect(body.member?.userId ?? body.member?.user_id).toBe(invitee.userId);

    // ... and the invitation no longer sits at `pending` forever. better-auth's
    // transaction catch is what rolled it back, so this assertion is the one
    // that pins the reported user-visible symptom, not merely the status code.
    const [after] = invitationsFor(engine, 'invitee@example.com');
    expect(after.status).toBe('accepted');

    // EXACTLY one membership — adoption, not a second row and not a lost one.
    expect(membersOf(engine, DEFAULT_ORG, invitee.userId)).toHaveLength(1);
  });

  it('the adopted row carries the INVITATION’s role, not the reconciler’s default', async () => {
    const { engine, manager, owner } = await bootWithOwner();

    // An owner may invite an admin (the role cap only bounds issuers BELOW admin
    // grade), so this is the case where invitation intent and the auto-bound
    // default actually differ.
    const invite = await post(
      manager,
      '/organization/invite-member',
      { email: 'promoted@example.com', role: 'admin', organizationId: DEFAULT_ORG },
      owner.cookie,
    );
    expect(invite.status, await invite.clone().text()).toBe(200);
    const [invitation] = invitationsFor(engine, 'promoted@example.com');

    const invitee = await signUp(manager, engine, 'promoted@example.com');
    // The reconciler's default, which adoption must not silently keep.
    expect(membersOf(engine, DEFAULT_ORG, invitee.userId)[0]!.role).toBe('member');

    const accept = await post(
      manager,
      '/organization/accept-invitation',
      { invitationId: String(invitation.id) },
      invitee.cookie,
    );
    expect(accept.status, await accept.clone().text()).toBe(200);

    const rows = membersOf(engine, DEFAULT_ORG, invitee.userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.role).toBe('admin');
  });

  it('adoption never DEMOTES: an owner accepting a member invitation keeps owner', async () => {
    // Acceptance is an admission instrument. Demotion belongs to
    // `update-member-role`, which is where `last-admin-guard` stands — routing a
    // demotion through acceptance would take an organization's last owner away
    // with every gate reporting success.
    const { engine, manager, owner } = await bootWithOwner();

    // Seeded directly, and it has to be: `invite-member` refuses an email that is
    // already a member of the target org, so an owner can never be re-invited
    // into their own organization through the route. The row is exactly what
    // better-auth would have written — this pins what ACCEPTANCE does with such
    // an invitation, however it came to exist (a stale invitation the invitee
    // signed up against, an operator's import, a re-invite after a role change).
    await engine.insert('sys_invitation', {
      id: 'inv_demote',
      email: 'owner@example.com',
      role: 'member',
      status: 'pending',
      organization_id: DEFAULT_ORG,
      inviter_id: owner.userId,
      expires_at: new Date(Date.now() + 86_400_000),
    });

    const accept = await post(
      manager,
      '/organization/accept-invitation',
      { invitationId: 'inv_demote' },
      owner.cookie,
    );
    expect(accept.status, await accept.clone().text()).toBe(200);

    const rows = membersOf(engine, DEFAULT_ORG, owner.userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.role).toBe('owner');
  });

  it('an invitee who is NOT yet a member of the target org still gets a membership CREATED', async () => {
    // The untouched half: adoption must not swallow the ordinary insert. The
    // invitee here is auto-bound to the DEFAULT org and invited into a DIFFERENT
    // one, so no pair collides and better-auth's own insert must still run.
    const { engine, manager, owner } = await bootWithOwner();

    // Give the owner a membership in the partner org so they may invite there.
    await engine.insert('sys_member', {
      id: 'mem_owner_partner',
      organization_id: PARTNER_ORG,
      user_id: owner.userId,
      role: 'owner',
    });

    const invite = await post(
      manager,
      '/organization/invite-member',
      { email: 'crossorg@example.com', role: 'member', organizationId: PARTNER_ORG },
      owner.cookie,
    );
    expect(invite.status, await invite.clone().text()).toBe(200);
    const [invitation] = invitationsFor(engine, 'crossorg@example.com');

    const invitee = await signUp(manager, engine, 'crossorg@example.com');
    expect(membersOf(engine, DEFAULT_ORG, invitee.userId)).toHaveLength(1);
    expect(membersOf(engine, PARTNER_ORG, invitee.userId)).toHaveLength(0);

    const accept = await post(
      manager,
      '/organization/accept-invitation',
      { invitationId: String(invitation.id) },
      invitee.cookie,
    );
    expect(accept.status, await accept.clone().text()).toBe(200);

    // A NEW row in the partner org, and the default-org one left alone.
    expect(membersOf(engine, PARTNER_ORG, invitee.userId)).toHaveLength(1);
    expect(membersOf(engine, DEFAULT_ORG, invitee.userId)).toHaveLength(1);
    expect(invitationsFor(engine, 'crossorg@example.com')[0]!.status).toBe('accepted');
  });
});

describe('#7725 — the delegated-admin issuance scope is UNCHANGED (ADR-0090 D12 / ADR-0105 D8)', () => {
  // These are the pins that must stay GREEN through the ablation: the reported
  // break was purely in acceptance, and the fix must not move the issuance gate
  // a millimetre.
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const bootWithDelegate = async () => {
    const { engine, manager, owner } = await bootWithOwner();
    const delegate = await signUp(manager, engine, 'delegate@example.com');
    setRole(engine, DEFAULT_ORG, delegate.userId, 'delegated_admin');
    return { engine, manager, owner, delegate };
  };

  it('a delegated_admin CAN invite a plain member — 200, exactly one attributed pending row', async () => {
    const { engine, manager, delegate } = await bootWithDelegate();

    const res = await post(
      manager,
      '/organization/invite-member',
      { email: 'scoped.ok@example.com', role: 'member', organizationId: DEFAULT_ORG },
      delegate.cookie,
    );
    expect(res.status, await res.clone().text()).toBe(200);

    const invitations = invitationsFor(engine, 'scoped.ok@example.com');
    expect(invitations).toHaveLength(1);
    expect(invitations[0]!.status).toBe('pending');
    expect(invitations[0]!.role).toBe('member');
    expect(invitations[0]!.inviter_id).toBe(delegate.userId);
  });

  it('a delegated_admin CANNOT invite an admin — 403 with the ADR-0090 D12 message, and ZERO orphan rows', async () => {
    const { engine, manager, delegate } = await bootWithDelegate();

    const res = await post(
      manager,
      '/organization/invite-member',
      { email: 'scoped.denied@example.com', role: 'admin', organizationId: DEFAULT_ORG },
      delegate.cookie,
    );
    expect(res.status).toBe(403);
    const body = await res.text();
    expect(body).toContain('ADR-0090 D12');
    expect(body).toContain('Access denied');

    // The cap runs in `beforeCreateInvitation`, which better-auth invokes BEFORE
    // `adapter.createInvitation` — so a refusal leaves nothing behind.
    expect(invitationsFor(engine, 'scoped.denied@example.com')).toHaveLength(0);
  });
});
