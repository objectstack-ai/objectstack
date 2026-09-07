// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// objectstack#11225 / objectstack#11184 clause 2 — the ENTERPRISE half.
//
// The ruling (2026-08-23) says: under a walled posture + `invite-only`, NO
// self-registrant is auto-merged into the Default Organization — it belongs to
// the operator only. The OPEN half of that was already pinned in
// `plugin-auth`'s own suite, because `AuthPlugin` SKIPS its default-org
// bootstrap under a wall (`!postureEnforcesWall(resolveTenancyPosture())`) and
// hands the job to THIS package. So the open pin proves nothing about the
// runtime that actually does the work on a walled deployment: this file is it.
//
// ## What this suite is about, stated as a mechanism rather than an outcome
//
// The seam card's worry was a specific WIRING question. `OrganizationsPlugin`
// re-runs the bootstrap on every write matched by
// `isDefaultOrganizationBootstrapTrigger`, and since objectstack#11973 that
// predicate's FIRST arm is a plain `sys_user` insert. So the bootstrap on a
// walled box IS registration-triggered — the inference "objectstack#11211 took
// the admin grant away, so the trigger is gone too" is FALSE, and clause 2
// cannot rest on it.
//
// What clause 2 actually rests on is that the helper is ADMIN-KEYED, not
// first-registrant-keyed: it binds the account resolved by the config anchor
// (a declared `OS_PLATFORM_OWNER_EMAIL` address whose stored row reads
// VERIFIED) or by the legacy cross-tenant `admin_full_access` grant — and on a
// walled deployment `bootstrap-platform-admin.ts` mints no such grant for
// anybody. A self-registrant matches neither, so the trigger fires and the
// helper answers `no_admin`.
//
// ⚠️ Therefore an outcome-only assertion would be worthless here: "no org was
// created" is also what an empty fake store says when nothing is wired at all.
// Every negative case below is paired with a POSITIVE control that flips
// exactly one fact and makes the same middleware create the org — so a green
// negative is evidence about the KEYING, not about the harness being inert.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { resetPlatformAdminEmailMemo } from '@objectstack/core';
import { OrganizationsPlugin } from './organizations-plugin.js';

// ⛔ No entitlement grant: the open package has no licence gate to satisfy
// (ADR-0132 boundary 3).

const OWNER_EMAIL = 'ops@operator.test';
/** cloud#1509's own reproduction address, kept verbatim. */
const SELF_REGISTRANT_EMAIL = 'alice@tenant-a.test';

interface Row {
  [key: string]: unknown;
}

/**
 * A fake ObjectQL engine over an in-memory store, recording every insert.
 *
 * `find` implements only the shapes `ensureDefaultOrganization` actually
 * issues: exact-match `where` over one table, `null` matching a missing or
 * null column (the unscoped-grant probe spells `organization_id: null`).
 */
function makeEngine(store: Record<string, Row[]>) {
  const inserts: Array<{ object: string; data: Row }> = [];
  const matches = (row: Row, where: Row | undefined): boolean => {
    if (!where) return true;
    return Object.entries(where).every(([key, value]) => {
      // ⛔ REFUSE a combinator rather than reading it as a field name
      // (`pnpm check:where-matcher`). A `$and` / `$or` key looked up as a column
      // is `undefined`, so the row drops and the fake answers "no rows" for a
      // filter it cannot express — and every negative assertion in this file
      // would read that empty answer as evidence. Refusing turns the same
      // situation into a loud failure naming the shape this double lacks.
      if (key.startsWith('$')) {
        throw new Error(
          `fake engine: WHERE combinator \`${key}\` is not implemented — this double ` +
            'supports exact-match keys only (and `null` for a missing column)',
        );
      }
      const actual = row[key];
      if (value === null) return actual == null;
      return actual === value;
    });
  };
  const ql: any = {
    registerMiddleware: vi.fn(),
    getSchema: () => null,
    find: vi.fn(async (object: string, query: any) => {
      const rows = (store[object] ?? []).filter((r) => matches(r, query?.where));
      return rows.slice(0, query?.limit ?? rows.length);
    }),
    insert: vi.fn(async (object: string, data: Row) => {
      inserts.push({ object, data });
      (store[object] ??= []).push({ ...data });
      return { ...data };
    }),
  };
  const middlewares: any[] = [];
  ql.registerMiddleware = (mw: any) => middlewares.push(mw);
  return { ql, inserts, middlewares };
}

function makeCtx(ql: any) {
  const hooks = new Map<string, Array<() => unknown>>();
  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: ql,
    // `invite-only`, declared through the settings cascade with a non-`default`
    // source — the shape `membership-policy-gate.ts` requires a walled
    // deployment to present (cloud#1092). Anything less refuses the boot, so
    // this is what "walled + invite-only" means at this seam.
    settings: {
      getNamespace: vi.fn(async () => ({
        values: { membership_policy: { value: 'invite-only', source: 'env' } },
      })),
    },
    auth: { getMembershipPolicy: () => 'invite-only' },
  };
  const ctx: any = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    registerService: (name: string, svc: unknown) => {
      services[name] = svc;
    },
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
    hook: (name: string, handler: () => unknown) => {
      if (!hooks.has(name)) hooks.set(name, []);
      hooks.get(name)!.push(handler);
    },
  };
  const trigger = async (name: string) => {
    for (const h of hooks.get(name) ?? []) await h();
  };
  return { ctx, trigger };
}

const savedPosture = process.env.OS_TENANCY_POSTURE;
const savedOwner = process.env.OS_PLATFORM_OWNER_EMAIL;
afterEach(() => {
  if (savedPosture === undefined) delete process.env.OS_TENANCY_POSTURE;
  else process.env.OS_TENANCY_POSTURE = savedPosture;
  if (savedOwner === undefined) delete process.env.OS_PLATFORM_OWNER_EMAIL;
  else process.env.OS_PLATFORM_OWNER_EMAIL = savedOwner;
  resetPlatformAdminEmailMemo();
});

/**
 * Boot the plugin on a walled + invite-only rig over `store`, run the
 * `kernel:ready` bootstrap leg, then drive one write through the bootstrap
 * middleware as the engine would.
 *
 * The middleware under test is the LAST one registered by `start()` — the
 * bootstrap re-run arm. Asserting its index would pin the registration order
 * of two unrelated middlewares, so it is taken from the end.
 */
async function bootAndFire(
  store: Record<string, Row[]>,
  write: { object: string; operation: string; data?: Row },
) {
  process.env.OS_TENANCY_POSTURE = 'isolated';
  process.env.OS_PLATFORM_OWNER_EMAIL = OWNER_EMAIL;
  resetPlatformAdminEmailMemo();

  const { ql, inserts, middlewares } = makeEngine(store);
  const { ctx, trigger } = makeCtx(ql);
  const plugin = new OrganizationsPlugin();
  await plugin.init(ctx);
  await plugin.start(ctx);
  await trigger('kernel:bootstrapped');
  await trigger('kernel:ready');

  const bootstrapMw = middlewares[middlewares.length - 1];
  await bootstrapMw(write, async () => {});

  return {
    inserts,
    orgInserts: inserts.filter((i) => i.object === 'sys_organization'),
    memberInserts: inserts.filter((i) => i.object === 'sys_member'),
  };
}

/** The rows every walled deployment has once `plugin-security` has seeded. */
function seededPermissionSets(): Row[] {
  return [{ id: 'ps_admin', name: 'admin_full_access' }];
}

describe('walled + invite-only: the multi-org default-org bootstrap never joins a self-registrant (#11184 clause 2)', () => {
  it('case (a) — the FIRST self-registrant creates NO organization and NO membership', async () => {
    // The exact rig cloud#1509 reported against: walled + invite-only, an
    // operator address DECLARED but not yet registered, and Alice is the first
    // account on the box. Post-objectstack#11211 no `sys_user_permission_set`
    // row is minted for her, which is why the store has none.
    const store: Record<string, Row[]> = {
      sys_permission_set: seededPermissionSets(),
      sys_user_permission_set: [],
      sys_user: [
        {
          id: 'usr_alice',
          email: SELF_REGISTRANT_EMAIL,
          email_verified: true,
          created_at: '2026-01-01T00:00:00.000Z',
        },
      ],
      sys_organization: [],
      sys_member: [],
    };

    const { orgInserts, memberInserts } = await bootAndFire(store, {
      object: 'sys_user',
      operation: 'insert',
      data: { id: 'usr_alice', email: SELF_REGISTRANT_EMAIL },
    });

    expect(orgInserts, 'a Default Organization was created for a self-registrant').toEqual([]);
    expect(memberInserts, 'a self-registrant was bound into an organization').toEqual([]);
    expect(store.sys_organization).toEqual([]);
    expect(store.sys_member).toEqual([]);
  });

  it('case (b) — a LATER self-registrant is treated identically, with the Default Organization already present', async () => {
    // The second registrant, on a box where the operator has already arrived
    // and owns the Default Organization. The helper short-circuits on the
    // ADMIN's membership, so the risk here is the opposite of case (a): not
    // "create an org" but "bind Bob into the existing one".
    const store: Record<string, Row[]> = {
      sys_permission_set: seededPermissionSets(),
      sys_user_permission_set: [],
      sys_user: [
        { id: 'usr_ops', email: OWNER_EMAIL, email_verified: true, created_at: '2026-01-01T00:00:00.000Z' },
        { id: 'usr_bob', email: 'bob@tenant-b.test', email_verified: true, created_at: '2026-02-02T00:00:00.000Z' },
      ],
      sys_organization: [{ id: 'org_default', slug: 'default', name: 'Default Organization' }],
      sys_member: [{ id: 'mem_ops', organization_id: 'org_default', user_id: 'usr_ops', role: 'owner' }],
    };

    const { orgInserts, memberInserts } = await bootAndFire(store, {
      object: 'sys_user',
      operation: 'insert',
      data: { id: 'usr_bob', email: 'bob@tenant-b.test' },
    });

    expect(orgInserts).toEqual([]);
    expect(memberInserts, 'a later self-registrant was bound into the Default Organization').toEqual([]);
    expect(store.sys_member).toHaveLength(1);
    expect(store.sys_member[0]!.user_id).toBe('usr_ops');
  });

  it('POSITIVE CONTROL — the same middleware DOES bootstrap the operator once their declared address verifies', async () => {
    // One fact differs from case (a): the account carrying the DECLARED owner
    // address exists and reads verified. If this did not create the org, both
    // negatives above would be vacuous.
    const store: Record<string, Row[]> = {
      sys_permission_set: seededPermissionSets(),
      sys_user_permission_set: [],
      sys_user: [
        { id: 'usr_alice', email: SELF_REGISTRANT_EMAIL, email_verified: true, created_at: '2026-01-01T00:00:00.000Z' },
        { id: 'usr_ops', email: OWNER_EMAIL, email_verified: true, created_at: '2026-03-03T00:00:00.000Z' },
      ],
      sys_organization: [],
      sys_member: [],
    };

    const { orgInserts, memberInserts } = await bootAndFire(store, {
      object: 'sys_user',
      operation: 'update',
      data: { id: 'usr_ops', email_verified: true },
    });

    expect(orgInserts).toHaveLength(1);
    expect(orgInserts[0]!.data.slug).toBe('default');
    expect(memberInserts).toHaveLength(1);
    // ⛔ The bind goes to the OPERATOR, never to the older self-registrant —
    // "oldest account wins" is the retired pre-#11211 rule and Alice is older.
    expect(memberInserts[0]!.data.user_id).toBe('usr_ops');
    expect(memberInserts[0]!.data.role).toBe('owner');
  });

  it('POSITIVE CONTROL — a legacy cross-tenant grant still anchors the bootstrap, which is what makes case (a) a measurement', async () => {
    // This is cloud#1509's reported defect reconstructed at the seam: give the
    // first self-registrant the unscoped `admin_full_access` grant that walled
    // deployments used to mint for her, and the SAME middleware creates the
    // Default Organization and merges her into it — `positions: [… org_owner,
    // platform_admin], activeOrganizationId: <default org>`, verbatim from the
    // card. Case (a) is green only because objectstack#11211 stopped minting
    // that row on a walled box, not because this path is inert.
    const store: Record<string, Row[]> = {
      sys_permission_set: seededPermissionSets(),
      sys_user_permission_set: [
        { id: 'ups_1', permission_set_id: 'ps_admin', organization_id: null, user_id: 'usr_alice' },
      ],
      sys_user: [
        { id: 'usr_alice', email: SELF_REGISTRANT_EMAIL, email_verified: true, created_at: '2026-01-01T00:00:00.000Z' },
      ],
      sys_organization: [],
      sys_member: [],
    };

    const { orgInserts, memberInserts } = await bootAndFire(store, {
      object: 'sys_user',
      operation: 'insert',
      data: { id: 'usr_alice', email: SELF_REGISTRANT_EMAIL },
    });

    expect(orgInserts).toHaveLength(1);
    expect(memberInserts).toHaveLength(1);
    expect(memberInserts[0]!.data.user_id).toBe('usr_alice');
  });

  it('the bootstrap really IS registration-triggered here — a `sys_user` insert reaches the helper', async () => {
    // The seam card's inference was that removing the admin grant removes the
    // TRIGGER derivatively. It does not: `isDefaultOrganizationBootstrapTrigger`
    // fires on a plain `sys_user` insert (objectstack#11973), so clause 2 must
    // hold on the KEYING, which is what the cases above measure. Pinned so the
    // wrong reason cannot be quietly re-adopted: this asserts the helper was
    // CONSULTED on a self-registrant's insert (it read the anchors) while
    // writing nothing.
    const store: Record<string, Row[]> = {
      sys_permission_set: seededPermissionSets(),
      sys_user_permission_set: [],
      sys_user: [
        { id: 'usr_alice', email: SELF_REGISTRANT_EMAIL, email_verified: true, created_at: '2026-01-01T00:00:00.000Z' },
      ],
      sys_organization: [],
      sys_member: [],
    };

    process.env.OS_TENANCY_POSTURE = 'isolated';
    process.env.OS_PLATFORM_OWNER_EMAIL = OWNER_EMAIL;
    resetPlatformAdminEmailMemo();
    const { ql, inserts, middlewares } = makeEngine(store);
    const { ctx, trigger } = makeCtx(ql);
    const plugin = new OrganizationsPlugin();
    await plugin.init(ctx);
    await plugin.start(ctx);
    await trigger('kernel:bootstrapped');
    await trigger('kernel:ready');

    const readsBefore = ql.find.mock.calls.length;
    const bootstrapMw = middlewares[middlewares.length - 1];
    await bootstrapMw(
      { object: 'sys_user', operation: 'insert', data: { id: 'usr_alice' } },
      async () => {},
    );
    expect(
      ql.find.mock.calls.length,
      'the sys_user insert did not reach the default-org bootstrap at all',
    ).toBeGreaterThan(readsBefore);
    expect(inserts).toEqual([]);
  });
});
