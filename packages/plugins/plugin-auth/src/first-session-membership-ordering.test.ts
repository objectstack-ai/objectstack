// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8247 rule 2 / #8245] A user's FIRST session must not be minted before their
 * membership settles.
 *
 * ## What was open
 *
 * `session.create.before` resolves a session's `activeOrganizationId` from the
 * caller's `sys_member` row. The ADR-0093 D2 reconciler that WRITES that row is
 * composed into `user.create.after`, and better-auth defers it past the sign-up
 * transaction. So the session sign-up mints runs first, finds no membership, and
 * carries no active organization — for every new user, on every deployment.
 *
 * That first session is not a harmless intermediate. Its `login` audit row takes
 * its tenant from `session.activeOrganizationId` (`auth-session-audit.ts`), so
 * the row lands with a NULL tenant and the SecurityPlugin's RLS predicate hides
 * it from every reader forever. Nothing back-fills a written ledger row, and the
 * rows lost this way are exactly the ones describing account creation.
 *
 * ## Anti-vacuity
 *
 * The fix is an ORDERING change, so the trap is a test that would pass on the
 * broken build because it never establishes that the membership was absent when
 * the session was minted. Every case below therefore starts from a store with
 * **no `sys_member` row for the user** and asserts on the FIRST session — the
 * one that used to be tenant-less. `PRECONDITION` cases pin that starting state
 * rather than assuming it.
 *
 * The second trap is the opposite over-reach: an ordering fix must not become a
 * POLICY change. The `invite-only` and no-target-org cases are not decoration —
 * they are the property that makes this safe to land, and they assert on the
 * store (`insert` never called), not merely on the returned draft. A user whom
 * policy says must not be bound still mints a session with no active
 * organization, which is the legal state the #8247 ruling declares.
 */

import { describe, it, expect, vi } from 'vitest';
import { AuthManager } from './auth-manager.js';
import { loginEventFor } from './auth-session-audit.js';

const USER = 'u_first_session';
const DEFAULT_ORG = 'org_default';

interface MemberRow {
  id: string;
  organization_id: string;
  user_id: string;
  role?: string;
}

/**
 * A minimal ObjectQL double over an in-memory `sys_member` table.
 *
 * `find` / `findOne` / `insert` only — the three verbs this path uses. It
 * deliberately declares no `update` / `delete`: there is no dispatch contract
 * for a verb the double does not offer, and adding stubs would put a looser
 * copy of a write verb in front of the real one.
 */
function makeEngine(seed: MemberRow[] = []) {
  const rows: MemberRow[] = [...seed];
  const match = (r: MemberRow, where: Record<string, unknown> = {}) =>
    (where.user_id === undefined || r.user_id === where.user_id) &&
    (where.role === undefined || r.role === where.role) &&
    (where.organization_id === undefined || r.organization_id === where.organization_id);
  const insert = vi.fn(async (model: string, data: MemberRow) => {
    if (model !== 'sys_member') return data;
    rows.push(data);
    return data;
  });
  return {
    rows,
    insert,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    find: vi.fn(async (model: string, q: any) =>
      model === 'sys_member' ? rows.filter((r) => match(r, q?.where)).slice(0, q?.limit ?? 100) : [],
    ),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    findOne: vi.fn(async (model: string, q: any) =>
      model === 'sys_member' ? (rows.find((r) => match(r, q?.where)) ?? null) : null,
    ),
  };
}

interface ManagerOpts {
  engine: ReturnType<typeof makeEngine>;
  /** `undefined` → the `auto` default. */
  membershipPolicy?: 'auto' | 'invite-only';
  /** What `tenancy.defaultOrgId()` answers. `null` = no unambiguous target. */
  defaultOrgId?: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  databaseHooks?: any;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function hooksFor(opts: ManagerOpts): any {
  const manager = new AuthManager({
    secret: 'test-secret-at-least-32-chars-long',
    baseUrl: 'http://localhost:3000',
    dataEngine: opts.engine,
    ...(opts.membershipPolicy ? { membershipPolicy: opts.membershipPolicy } : {}),
    getTenancy: () => ({ defaultOrgId: async () => opts.defaultOrgId ?? null }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (manager as any).composeDatabaseHooks(opts.databaseHooks);
}

describe("[#8247 rule 2] a user's FIRST session settles the membership before resolving its active org", () => {
  it('PRECONDITION: the store really does hold no membership for the user before sign-in', async () => {
    // Without this the whole file could be measuring a user who was already
    // bound, which is the pre-existing (and always-worked) path.
    const engine = makeEngine();
    expect(engine.rows).toHaveLength(0);
    const hooks = hooksFor({ engine, defaultOrgId: DEFAULT_ORG });
    expect(typeof hooks.session.create.before).toBe('function');
  });

  it('the FIRST session carries the active organization — the reconciler is run, then re-read', async () => {
    const engine = makeEngine();
    const hooks = hooksFor({ engine, defaultOrgId: DEFAULT_ORG });
    const result = await hooks.session.create.before({ userId: USER });
    expect(result?.data?.activeOrganizationId).toBe(DEFAULT_ORG);
    // …and it is a real membership, not a value invented for the draft. The
    // difference matters: a stamped-but-unbacked org would satisfy the session
    // and still leave the user missing from the Members list and outside every
    // RLS predicate that reads `sys_member`.
    expect(engine.rows).toHaveLength(1);
    expect(engine.rows[0]).toMatchObject({ organization_id: DEFAULT_ORG, user_id: USER });
  });

  it("the login audit event for that first session carries the tenant — #8245's chain, end to end", async () => {
    // The consequence the card is actually about. `loginEventFor` reads
    // `session.activeOrganizationId`; with the ordering fixed there is one to
    // read, so the ledger row is written INTO a tenant instead of into NULL
    // where no RLS reader could ever see it again.
    const engine = makeEngine();
    const hooks = hooksFor({ engine, defaultOrgId: DEFAULT_ORG });
    const result = await hooks.session.create.before({ userId: USER, id: 'sess_1' });
    const event = loginEventFor(result?.data);
    expect(event?.organizationId).toBe(DEFAULT_ORG);
    expect(event?.userId).toBe(USER);
  });

  it('an already-bound user is unchanged, and NO second membership is written', async () => {
    const engine = makeEngine([{ id: 'm1', organization_id: 'org_existing', user_id: USER, role: 'member' }]);
    const hooks = hooksFor({ engine, defaultOrgId: DEFAULT_ORG });
    const result = await hooks.session.create.before({ userId: USER });
    expect(result?.data?.activeOrganizationId).toBe('org_existing');
    expect(engine.insert).not.toHaveBeenCalled();
    expect(engine.rows).toHaveLength(1);
  });

  it('owner-preference survives the settle path (the selection is one function, called twice)', async () => {
    // A bound user with two memberships takes the OWNER one. This is the pin
    // that goes red if the post-settle re-read is ever replaced by a "simpler"
    // lookup: the two calls must select identically, or a freshly-bound user's
    // active org would depend on which path found it.
    const engine = makeEngine([
      { id: 'm1', organization_id: 'org_member', user_id: USER, role: 'member' },
      { id: 'm2', organization_id: 'org_owner', user_id: USER, role: 'owner' },
    ]);
    const hooks = hooksFor({ engine, defaultOrgId: DEFAULT_ORG });
    const result = await hooks.session.create.before({ userId: USER });
    expect(result?.data?.activeOrganizationId).toBe('org_owner');
  });

  describe('⛔ the ordering fix removes a RACE, never a POLICY', () => {
    it('`invite-only`: nothing is bound, and the session is legitimately org-less', async () => {
      const engine = makeEngine();
      const hooks = hooksFor({ engine, membershipPolicy: 'invite-only', defaultOrgId: DEFAULT_ORG });
      const result = await hooks.session.create.before({ userId: USER });
      expect(result?.data?.activeOrganizationId).toBeUndefined();
      // Asserted on the STORE, not just on the draft: a policy that says "no
      // auto-bind" must not be satisfied by binding and then declining to stamp.
      expect(engine.insert).not.toHaveBeenCalled();
      expect(engine.rows).toHaveLength(0);
    });

    it('no unambiguous target organization (multi-org): nothing is bound, session org-less', async () => {
      const engine = makeEngine();
      const hooks = hooksFor({ engine, defaultOrgId: null });
      const result = await hooks.session.create.before({ userId: USER });
      expect(result?.data?.activeOrganizationId).toBeUndefined();
      expect(engine.insert).not.toHaveBeenCalled();
      expect(engine.rows).toHaveLength(0);
    });

    it('a no-bind sign-in costs NO extra membership read — the re-read is gated on the outcome', async () => {
      const engine = makeEngine();
      const hooks = hooksFor({ engine, membershipPolicy: 'invite-only', defaultOrgId: DEFAULT_ORG });
      await hooks.session.create.before({ userId: USER });
      // The two owner-preferred lookups of the ORIGINAL selection, and nothing
      // more: `invite-only` is refused by the reconciler before it touches the
      // store, and the re-read never runs because nothing was bound.
      expect(engine.findOne).toHaveBeenCalledTimes(2);
      expect(engine.find).not.toHaveBeenCalled();
    });
  });

  describe('the pre-existing contract of this hook is untouched', () => {
    it('a draft that already carries an org is left alone, and nothing is read or written', async () => {
      const engine = makeEngine();
      const hooks = hooksFor({ engine, defaultOrgId: DEFAULT_ORG });
      const result = await hooks.session.create.before({
        userId: USER,
        activeOrganizationId: 'org_explicit',
      });
      expect(result?.data?.activeOrganizationId ?? 'org_explicit').toBe('org_explicit');
      expect(engine.findOne).not.toHaveBeenCalled();
      expect(engine.insert).not.toHaveBeenCalled();
    });

    it('the HOST session hook still chains first and still wins', async () => {
      const engine = makeEngine();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const hostHook = vi.fn(async (session: any) => ({
        data: { ...session, activeOrganizationId: 'org_host' },
      }));
      const hooks = hooksFor({
        engine,
        defaultOrgId: DEFAULT_ORG,
        databaseHooks: { session: { create: { before: hostHook } } },
      });
      const result = await hooks.session.create.before({ userId: USER });
      expect(hostHook).toHaveBeenCalledTimes(1);
      expect(result?.data?.activeOrganizationId).toBe('org_host');
      // The host owned it, so the settle never ran.
      expect(engine.insert).not.toHaveBeenCalled();
    });

    it('a broken engine never breaks session create', async () => {
      const engine = {
        findOne: vi.fn(async () => { throw new Error('db down'); }),
        find: vi.fn(async () => { throw new Error('db down'); }),
        insert: vi.fn(async () => { throw new Error('db down'); }),
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const hooks = hooksFor({ engine: engine as any, defaultOrgId: DEFAULT_ORG });
      const result = await hooks.session.create.before({ userId: USER });
      expect(result?.data?.activeOrganizationId).toBeUndefined();
    });

    it('`user.create.after` still binds — the creation seam is unchanged', async () => {
      // The other half of "one owner": hoisting the settle to the session seam
      // must not have quietly removed it from the seam every creation path
      // flows through (admin create-user, bulk import, SSO JIT — none of which
      // mint a session at all).
      const engine = makeEngine();
      const hooks = hooksFor({ engine, defaultOrgId: DEFAULT_ORG });
      await hooks.user.create.after({ id: USER });
      expect(engine.rows).toHaveLength(1);
      expect(engine.rows[0]).toMatchObject({ organization_id: DEFAULT_ORG, user_id: USER });
    });

    it('both seams read the SAME policy — neither can auto-bind while the other does not', async () => {
      // The drift `getMembershipPolicy()` exists to prevent (#5152), now that a
      // second caller shares it. One manager, one policy, two seams: both must
      // decline.
      const engine = makeEngine();
      const hooks = hooksFor({ engine, membershipPolicy: 'invite-only', defaultOrgId: DEFAULT_ORG });
      await hooks.user.create.after({ id: USER });
      await hooks.session.create.before({ userId: USER });
      expect(engine.insert).not.toHaveBeenCalled();
    });
  });
});
