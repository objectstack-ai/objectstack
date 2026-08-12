// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#7724] Regression suite for "`remove-user` is non-atomic and can never
// succeed — 409 leaks as a bodyless HTTP 500, credential rows deleted without
// rollback".
//
// Three compounding problems, three groups below, one end-to-end pipeline for
// all of them: the REAL better-auth admin plugin driven through a REAL
// `AuthManager`, the same shape as `accept-invitation-adopt-membership.test.ts`
// (#7725/#7796). Nothing on the removal path is stubbed.
//
// ## The two things the fake engine MUST do, or this whole file is theatre
//
// 1. **The referential rule has to come from the real declaration.** The defect
//    is a `deleteBehavior` that `sys-member.object.ts` did not declare, so a
//    fake that hard-codes "cascading works" would stay green with the fix
//    reverted — it would be asserting its own constant. {@link referentialRule}
//    therefore READS `SysMember.fields.user_id` and reproduces `ObjectQL`'s own
//    `cascadeDeleteRelations` arithmetic over it, including the escalation of a
//    `set_null` on a REQUIRED foreign key to `restrict`
//    (`packages/objectql/src/engine.ts`). Delete the `deleteBehavior` line from
//    the object and this fake starts vetoing again, exactly as the engine does.
//
// 2. **The transaction has to be able to actually roll back.** A fake whose
//    `transaction()` merely calls the callback would make the atomicity group
//    green without any rollback existing — the empty-reason pass. This one
//    snapshots every table on entry and restores them on throw, which is the
//    contract `ObjectQL.transaction` implements over a driver
//    (begin/commit/rollback, ADR-0034).
//
// Both write verbs are pinned to the real engine's dispatch predicates
// (`assertEngineDeleteDispatch` / `assertEngineUpdateDispatch`, #4550/#5480) so
// the double cannot accept a call ObjectQL refuses.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/objectql';
import { SysMember } from '@objectstack/platform-objects';
import { AuthManager } from './auth-manager';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const BASE = 'http://localhost:3000';
const DEFAULT_ORG = 'org_default';
const PASSWORD = 'S3cure!Passw0rd-7724';

/**
 * The engine's referential verdict for `sys_member.user_id`, derived from the
 * DECLARATION rather than restated here.
 *
 * `ObjectQL.cascadeDeleteRelations` resolves a `lookup` to its configured
 * `deleteBehavior` (default `set_null`) and then escalates a `set_null` on a
 * REQUIRED foreign key to `restrict`, because a NOT NULL column cannot be
 * cleared. That escalation is the whole defect: `user_id` is required, nothing
 * declared a behaviour, so every `sys_user` delete was vetoed.
 */
const referentialRule = (): 'cascade' | 'restrict' | 'set_null' => {
  const field = (SysMember.fields as Record<string, any>).user_id;
  const declared = (field?.deleteBehavior as string | undefined) ?? 'set_null';
  if (declared === 'set_null' && field?.required === true) return 'restrict';
  return declared as 'cascade' | 'restrict' | 'set_null';
};

/**
 * The engine's `DELETE_RESTRICTED` envelope, in the engine's own shape
 * (`code` / `status` / `developerMessage` / `dependentObject` /
 * `dependentCount`, ADR-0112 + #7307). plugin-auth duck-types the error by
 * `code`, so a same-shape stand-in exercises the exact mapping arm.
 */
const deleteRestricted = (dependentCount: number) => {
  const err: any = new Error('Cannot delete User: 1 or more Member records still reference it.');
  err.code = 'DELETE_RESTRICTED';
  err.status = 409;
  err.object = 'sys_user';
  err.dependentObject = 'sys_member';
  err.dependentCount = dependentCount;
  err.developerMessage =
    `Cannot delete sys_user: ${dependentCount} dependent sys_member record(s) reference it via user_id ` +
    `(user_id is required, so it cannot be cleared). ` +
    `Delete or reassign them first, or set deleteBehavior:'cascade' on sys_member.user_id.`;
  return err;
};

/**
 * In-memory engine enforcing `sys_member`'s unique index, the declared
 * referential rule, and real snapshot transactions.
 *
 * @param vetoUserDelete optional stand-in for ANY other refusal of the
 *   `sys_user` delete — a `beforeDelete` guard, a driver fault, a constraint on
 *   some other dependent table. The atomicity group needs one that survives the
 *   cascade fix, because otherwise "nothing was left behind" would be true for
 *   the empty reason that nothing failed.
 */
const createMemoryEngine = (vetoUserDelete?: () => Error | undefined) => {
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

  const engine: any = {
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
      assertEngineUpdateDispatch(patch, options);
      const row = rows(name).find((r) => r.id === patch.id);
      if (!row) return null;
      assertMemberUnique(name, { ...row, ...patch }, row.id);
      Object.assign(row, patch);
      return { ...row };
    },
    async delete(name: string, q: any = {}) {
      assertEngineDeleteDispatch(q);

      if (name === 'sys_user') {
        const targets = rows(name).filter((r) => matches(r, q.where));
        for (const target of targets) {
          // The engine resolves dependents BEFORE removing the parent row.
          const dependents = rows('sys_member').filter((m) => eq(m.user_id, target.id));
          if (dependents.length > 0) {
            const rule = referentialRule();
            if (rule === 'restrict') throw deleteRestricted(dependents.length);
            for (const dep of dependents) {
              // "Recurse via the public delete so the child's own cascade,
              // hooks and events fire" — engine.ts. Re-entering keeps the
              // dispatch contract honoured on the child too.
              if (rule === 'cascade') await engine.delete('sys_member', { where: { id: dep.id } });
              else await engine.update('sys_member', { id: dep.id, user_id: null });
            }
          }
          const veto = vetoUserDelete?.();
          if (veto) throw veto;
        }
      }

      const table = rows(name);
      const keep = table.filter((r) => !matches(r, q.where));
      tables.set(name, keep);
      return table.length - keep.length;
    },

    /**
     * `ObjectQL.transaction`'s contract over a driver that supports one
     * (ADR-0034): run the callback, commit on return, roll everything back on
     * throw. Snapshot/restore is how `driver-memory` implements it too.
     */
    async transaction<T>(callback: (trxCtx: any, info: any) => Promise<T>): Promise<T> {
      const snapshot = new Map<string, any[]>();
      for (const [name, table] of tables) snapshot.set(name, table.map((r) => ({ ...r })));
      try {
        return await callback({ transaction: { id: 'tx_test' } }, { owned: true });
      } catch (err) {
        tables.clear();
        for (const [name, table] of snapshot) tables.set(name, table);
        throw err;
      }
    },
  };

  return engine;
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
    // `/admin/remove-user` is the better-auth admin plugin's route, and the
    // plugin is opt-in (`admin: pluginConfig.admin ?? scimEffective`). Without
    // this the route 404s and every assertion below would be measuring the
    // absence of an endpoint rather than the behaviour of one.
    plugins: { admin: true },
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

const signUp = async (manager: AuthManager, engine: MemoryEngine, email: string) => {
  const res = await post(manager, '/sign-up/email', { email, password: PASSWORD, name: email });
  expect(res.status, await res.clone().text()).toBe(200);
  const user = (engine.tables.get('sys_user') ?? []).find((u: any) => u.email === email);
  expect(user, `sign-up did not create ${email}`).toBeDefined();
  return { cookie: cookieFrom(res), userId: String(user!.id) };
};

const rowsOf = (engine: MemoryEngine, table: string) => engine.tables.get(table) ?? [];
const membersOf = (engine: MemoryEngine, userId: string) =>
  rowsOf(engine, 'sys_member').filter((m: any) => m.user_id === userId);
const accountsOf = (engine: MemoryEngine, userId: string) =>
  rowsOf(engine, 'sys_account').filter((a: any) => a.user_id === userId);
const userRow = (engine: MemoryEngine, userId: string) =>
  rowsOf(engine, 'sys_user').find((u: any) => String(u.id) === userId);

const seedOrganizations = (engine: MemoryEngine) => {
  engine.tables.set('sys_organization', [{ id: DEFAULT_ORG, name: 'Default', slug: 'default' }]);
};

/**
 * A deployment with a platform admin who can drive `/admin/remove-user`.
 *
 * The admin keeps their own local credential, which also keeps the break-glass
 * guard out of the way: it refuses only when the TARGET holds the last one
 * (`auth-manager.ts`), and here two users hold credentials throughout.
 */
const bootWithAdmin = async (engine: MemoryEngine) => {
  seedOrganizations(engine);
  const manager = makeManager(engine);
  const admin = await signUp(manager, engine, 'admin@example.com');
  // better-auth's admin plugin authorizes by `user.role` (default
  // `adminRoles: ['admin']`).
  userRow(engine, admin.userId)!.role = 'admin';
  return { manager, admin };
};

describe('#7724 — removing a user is one unit of work that can actually complete', () => {
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // 1. The reported bug — the auto-bound membership vetoed every removal
  // -------------------------------------------------------------------------

  it('the reported bug: an auto-bound user can be removed, and nothing is left behind', async () => {
    const engine = createMemoryEngine();
    const { manager, admin } = await bootWithAdmin(engine);

    // The reconciler binds every user to the default org at sign-up — the
    // dependent row that used to make this operation impossible.
    const victim = await signUp(manager, engine, 'victim@example.com');
    expect(membersOf(engine, victim.userId)).toHaveLength(1);
    expect(accountsOf(engine, victim.userId).length).toBeGreaterThan(0);

    const res = await post(manager, '/admin/remove-user', { userId: victim.userId }, admin.cookie);

    // Before the fix: HTTP 500 with an EMPTY body.
    expect(res.status, await res.clone().text()).toBe(200);
    expect(userRow(engine, victim.userId)).toBeUndefined();
    expect(membersOf(engine, victim.userId)).toHaveLength(0);
    expect(accountsOf(engine, victim.userId)).toHaveLength(0);
  });

  // The card's required case: the membership must be gone whether the reconciler
  // merely created it or invitation ACCEPTANCE adopted it (#7796). Adoption
  // rewrites the same row rather than adding one, so a cascade keyed on
  // `user_id` covers both — this pins that it does, rather than assuming it.
  it('a user who ACCEPTED an invitation leaves no orphan membership and no orphan credentials', async () => {
    const engine = createMemoryEngine();
    const { manager, admin } = await bootWithAdmin(engine);
    // The admin is the organization owner, so they may issue invitations.
    const adminMember = rowsOf(engine, 'sys_member').find((m: any) => m.user_id === admin.userId);
    expect(adminMember, 'the reconciler did not bind the admin').toBeDefined();
    adminMember!.role = 'owner';

    const invite = await post(
      manager,
      '/organization/invite-member',
      { email: 'invitee@example.com', role: 'member', organizationId: DEFAULT_ORG },
      admin.cookie,
    );
    expect(invite.status, await invite.clone().text()).toBe(200);
    const invitation = rowsOf(engine, 'sys_invitation').find(
      (i: any) => i.email === 'invitee@example.com',
    );
    expect(invitation).toBeDefined();

    const invitee = await signUp(manager, engine, 'invitee@example.com');
    const accept = await post(
      manager,
      '/organization/accept-invitation',
      { invitationId: String(invitation!.id) },
      invitee.cookie,
    );
    expect(accept.status, await accept.clone().text()).toBe(200);
    // The row acceptance ADOPTED — one membership, not two.
    expect(membersOf(engine, invitee.userId)).toHaveLength(1);

    const res = await post(manager, '/admin/remove-user', { userId: invitee.userId }, admin.cookie);
    expect(res.status, await res.clone().text()).toBe(200);

    expect(userRow(engine, invitee.userId)).toBeUndefined();
    expect(membersOf(engine, invitee.userId)).toHaveLength(0);
    expect(accountsOf(engine, invitee.userId)).toHaveLength(0);
    expect(rowsOf(engine, 'sys_session').filter((s: any) => s.user_id === invitee.userId)).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // 2. Atomicity — the harmful half, and the half that must survive the cascade
  // -------------------------------------------------------------------------

  describe('when something still refuses the sys_user delete', () => {
    // A refusal that is NOT the membership restrict, so it survives problem 1's
    // fix. This is the "some other failure path" the card names: the cascade
    // makes the reported case succeed, and atomicity is what keeps the NEXT
    // failure from leaving an un-authenticatable identity on the roster.
    const guardRefusal = () => {
      const err: any = new Error('Refused by a beforeDelete guard on sys_user.');
      err.code = 'PERMISSION_DENIED';
      err.status = 403;
      return err;
    };

    it('rolls the credential and session deletes back — the identity stays usable', async () => {
      const engine = createMemoryEngine(guardRefusal);
      const { manager, admin } = await bootWithAdmin(engine);
      const victim = await signUp(manager, engine, 'victim@example.com');

      const accountsBefore = accountsOf(engine, victim.userId).map((a: any) => a.id);
      expect(accountsBefore.length).toBeGreaterThan(0);

      const res = await post(manager, '/admin/remove-user', { userId: victim.userId }, admin.cookie);
      expect(res.status).toBeGreaterThanOrEqual(400);

      // The reported harm, inverted: the user row survived the refusal, so its
      // credentials must have survived it too. Without the transaction these
      // are gone and that email can never sign in again (401) while still
      // occupying the org roster.
      expect(userRow(engine, victim.userId)).toBeDefined();
      expect(accountsOf(engine, victim.userId).map((a: any) => a.id)).toEqual(accountsBefore);
      // The membership the cascade had already removed is back too — the whole
      // unit of work, not just the part the reporter happened to notice.
      expect(membersOf(engine, victim.userId)).toHaveLength(1);
    });

    it('the refusal still reaches the client as a structured body, not an empty one', async () => {
      const engine = createMemoryEngine(guardRefusal);
      const { manager, admin } = await bootWithAdmin(engine);
      const victim = await signUp(manager, engine, 'victim@example.com');

      const res = await post(manager, '/admin/remove-user', { userId: victim.userId }, admin.cookie);
      const text = await res.clone().text();
      expect(text.length, 'the response body is empty — the fault leaked unmapped').toBeGreaterThan(0);
      expect(res.status).toBe(403);
      expect((await res.json()).code).toBe('PERMISSION_DENIED');
    });
  });

  // -------------------------------------------------------------------------
  // 3. The status-code leak — a referential veto is a 409, never a bodyless 500
  // -------------------------------------------------------------------------

  it('a DELETE_RESTRICTED veto surfaces as a 409 carrying the engine’s explanation', async () => {
    // Reached through the same seam the membership restrict used to reach: any
    // dependent table the engine may neither cascade nor null. Pinned here
    // end-to-end because the unit-level arm cannot show that better-auth's
    // router renders it instead of swallowing it.
    const engine = createMemoryEngine(() => deleteRestricted(1));
    const { manager, admin } = await bootWithAdmin(engine);
    const victim = await signUp(manager, engine, 'victim@example.com');

    const res = await post(manager, '/admin/remove-user', { userId: victim.userId }, admin.cookie);

    expect(res.status).toBe(409);
    const body: any = await res.json();
    expect(body.code).toBe('DELETE_RESTRICTED');
    expect(body.dependentObject).toBe('sys_member');
    expect(body.dependentCount).toBe(1);
    expect(body.developerMessage).toContain("deleteBehavior:'cascade'");

    // Same request, the other half of the card: refused AND clean.
    expect(userRow(engine, victim.userId)).toBeDefined();
    expect(accountsOf(engine, victim.userId).length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // 4. The declaration itself
  // -------------------------------------------------------------------------

  it('sys_member.user_id declares the cascade rather than inheriting the veto', () => {
    // The rule the fake reads, asserted directly so a failure in the groups
    // above can be told apart from the declaration simply being gone.
    const field = (SysMember.fields as Record<string, any>).user_id;
    expect(field.required).toBe(true);
    expect(field.deleteBehavior).toBe('cascade');
    expect(referentialRule()).toBe('cascade');
  });
});
