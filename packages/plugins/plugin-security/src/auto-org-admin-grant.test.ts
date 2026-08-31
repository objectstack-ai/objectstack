// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  reconcileOrgAdminGrant,
  backfillOrgAdminGrants,
  AUTO_ORG_ADMIN_GRANT_REASON_PREFIX,
  autoOrgAdminGrantReason,
} from './auto-org-admin-grant.js';

// ---------------------------------------------------------------------------
// [#4640] The double speaks the ENGINE's signatures — or it proves nothing.
//
// The previous stub implemented `delete(object, id)`, a signature ObjectQL has
// never had. The module called `ql.delete(object, id, ctx)`; the stub happily
// deleted the row, every revoke test in this file went green, and in production
// the id landed in the option-bag slot where `rejectUnknownEngineOptions` reads its
// character indices as unknown keys and throws — straight into a swallowing
// `catch`. So for this module's entire life NOTHING was ever revoked: demoted
// admins kept `organization_admin`, hence tenant admin.
//
// A double looser than the real thing is not a weaker test — it is a test of a
// different program. This one therefore mirrors the engine's entry-point
// contract (`packages/objectql/src/engine.ts`) on both axes that matter:
//
//   1. ARITY AND ARGUMENT ROLES, which is where this bug lived:
//        find(object, query: EngineQueryOptions, options?: EngineReadOptions)
//        insert(object, data, options?)          ← context in the 3rd arg
//        delete(object, options?)                ← context in the 2nd arg
//   2. `rejectUnknownEngineOptions`'s rule that an option key the engine does
//      not execute is an ERROR — never something to quietly ignore. A
//      positional argument in the bag slot fails this the same way it fails in
//      the engine, so the same drift is loud here next time.
// ---------------------------------------------------------------------------

/** Mirrors `ENGINE_FIND_OPTION_KEYS` in `packages/objectql/src/engine.ts`. */
const FIND_QUERY_KEYS = new Set([
  'context', 'where', 'fields', 'orderBy', 'limit', 'offset', 'search', 'searchFields', 'expand',
]);
/** Mirrors `ENGINE_DELETE_OPTION_KEYS` — note `where`, and note NO id argument. */
const DELETE_OPTION_KEYS = new Set(['context', 'where', 'multi']);
/** The trailing read/write options bag (`EngineReadOptions` and friends). */
const TRAILING_OPTION_KEYS = new Set(['context']);

/**
 * The engine's own unknown-key rule, applied to a double.
 *
 * Rejecting a non-object bag is the half that catches a positional argument:
 * `Object.entries('ups_1')` yields `'0'/'1'/'2'…`, which is exactly how the
 * real engine reports a mis-shaped call — the message just reads better here.
 */
function assertOptionBag(
  operation: string,
  object: string,
  bag: unknown,
  legal: ReadonlySet<string>,
): void {
  if (bag === undefined || bag === null) return;
  if (typeof bag !== 'object' || Array.isArray(bag)) {
    throw new Error(
      `${operation}('${object}') takes an OPTION BAG in this position, got ${typeof bag} ` +
        `(${String(bag)}). The engine names rows by \`where\`, never positionally — ` +
        `e.g. delete(object, { where: { id }, context }).`,
    );
  }
  const unknown = Object.entries(bag as Record<string, unknown>)
    .filter(([k, v]) => v != null && !legal.has(k))
    .map(([k]) => k);
  if (unknown.length > 0) {
    throw new Error(
      `${operation}('${object}') does not recognise option${unknown.length > 1 ? 's' : ''} ` +
        `${unknown.map((k) => `'${k}'`).join(', ')}. The engine executes none of them, so the ` +
        `call would succeed with the option silently ignored (#4371). ` +
        `Legal keys for ${operation}: ${[...legal].sort().join(', ')}.`,
    );
  }
}

/**
 * This module's writes must run as the system (better-auth's identity tables
 * refuse user-context writes — ADR-0092 D2). Dropping the context was the
 * *other* casualty of the three-arg delete, so the double checks for it too.
 */
function assertSystemContext(operation: string, object: string, context: any): void {
  if (!context || context.isSystem !== true) {
    throw new Error(
      `${operation}('${object}') reached the datastore without a system context ` +
        `(got ${JSON.stringify(context) ?? 'undefined'}). The reconciler's own writes are ` +
        `system writes; a dropped context is how a call shape silently loses its privileges.`,
    );
  }
}

/**
 * [#11670] `SqlDriver.applyTenantScope`, as much of it as this module can
 * observe.
 *
 * A scoped read returns the caller's rows AND organization-less ones — that
 * compatibility arm is exactly why "the first row wins" stopped being right for
 * a catalog read, so a double without it would answer the scoped question the
 * unscoped way and prove nothing about the repair. It also makes `limit` mean
 * what it means in production: a scoped page holds this organization's rows
 * plus the platform bucket, not every tenant's copy.
 *
 * Absent `tenantId` is the unscoped system read (`SYSTEM_CTX`), which sees
 * everything — the question every other read in this module asks.
 */
function tenantVisible(row: any, context: any): boolean {
  const tenantId = context?.tenantId;
  if (typeof tenantId !== 'string' || tenantId === '') return true;
  const owner = row?.organization_id ?? null;
  return owner === tenantId || owner === null;
}

/**
 * Tiny in-memory ObjectQL double: just enough surface for the reconciler
 * (find / insert / delete), with the engine's call shapes ENFORCED.
 */
function makeStub(seed: {
  sys_permission_set?: any[];
  sys_member?: any[];
  sys_user_permission_set?: any[];
} = {}) {
  const tables: Record<string, any[]> = {
    sys_permission_set: seed.sys_permission_set ?? [],
    sys_member: seed.sys_member ?? [],
    sys_user_permission_set: seed.sys_user_permission_set ?? [],
  };
  /** Every delete the module issued, as the engine received it. */
  const deleteCalls: Array<{ object: string; options: any }> = [];
  /**
   * [#11670] Every read the module issued, as the engine received it — the
   * `single`-posture invariance pin measures this multiset, and a query is the
   * only place a leak of the walled scoping into `single` could show up.
   */
  const findCalls: Array<{ object: string; where: any; limit: any; context: any }> = [];

  const matches = (row: any, where: any) => {
    for (const [k, v] of Object.entries(where ?? {})) {
      if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
      // `$in` — the ADR-0105 D4 backfill sweeps BOTH org-admin variants in one read.
      if (v && typeof v === 'object' && Array.isArray((v as any).$in)) {
        if (!(v as any).$in.includes(row[k])) return false;
        continue;
      }
      if (row[k] !== v) return false;
    }
    return true;
  };

  return {
    tables,
    deleteCalls,
    findCalls,
    // find(object, query, options) — `where`/`limit` in the query, execution
    // context in either bag (`options.context` wins, as in the engine).
    async find(object: string, query?: any, options?: any) {
      assertOptionBag('find', object, query, FIND_QUERY_KEYS);
      assertOptionBag('find', object, options, TRAILING_OPTION_KEYS);
      const context = options?.context ?? query?.context;
      assertSystemContext('find', object, context);
      findCalls.push({ object, where: query?.where, limit: query?.limit, context });
      const rows = (tables[object] ?? [])
        .filter((r) => tenantVisible(r, context))
        .filter((r) => matches(r, query?.where));
      return typeof query?.limit === 'number' ? rows.slice(0, query.limit) : rows;
    },
    // insert(object, data, options) — context in the TRAILING bag.
    async insert(object: string, data: any, options?: any) {
      assertOptionBag('insert', object, options, TRAILING_OPTION_KEYS);
      assertSystemContext('insert', object, options?.context);
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error(`insert('${object}') takes a record object as its second argument.`);
      }
      const id = data.id ?? `${object}_${tables[object].length + 1}`;
      const row = { ...data, id };
      tables[object] = [...(tables[object] ?? []), row];
      return row;
    },
    // delete(object, options) — TWO arguments. The row is named by
    // `where.id`; there is no positional id and no third argument.
    async delete(object: string, options?: any) {
      assertOptionBag('delete', object, options, DELETE_OPTION_KEYS);
      assertSystemContext('delete', object, options?.context);
      deleteCalls.push({ object, options });
      const where = options?.where;
      const id = where && typeof where === 'object' ? (where as any).id : undefined;
      const scalarId = typeof id === 'string' || typeof id === 'number' ? id : undefined;
      if (scalarId === undefined && options?.multi !== true) {
        // The engine's own refusal — an unscoped delete never runs by accident.
        throw new Error('Delete requires an ID or options.multi=true');
      }
      const before = tables[object] ?? [];
      tables[object] =
        scalarId !== undefined
          ? before.filter((r) => r.id !== scalarId)
          : before.filter((r) => !matches(r, where));
      return before.length - tables[object].length;
    },
  };
}

// ---------------------------------------------------------------------------
// [#11670] What `sys_permission_set` actually holds for these two names.
//
// It is not one row each, and the fixtures used to say it was — which is why
// every walled case in this file described a deployment shape that stopped
// existing at #10103. Post-#10103 the catalog is materialized PER ORGANIZATION
// and the name is unique per organization (ADR-0120 D3), so one name carries:
//
//   - the ORGANIZATION-LESS platform-bucket row, minted by
//     `bootstrapPlatformAdmin` on every boot and ruled to stay (2026-08-20).
//     On a fresh walled rig it is written 1.3 s BEFORE the first
//     `sys_organization` exists (#11532), so it is also the OLDEST row bearing
//     the name — the one a name-only `limit: 1` read has every reason to
//     return;
//   - one row per organization, created by the per-organization catalog
//     seeding on organization creation and on every boot sweep.
//
// The `single` carve-out keeps the bucket rows FIRST, because `single` reads
// unscoped with `limit: 1` and the first row is the row — that ordering is part
// of what the invariance pin measures.
// ---------------------------------------------------------------------------
const ORG_ADMIN_SET = { id: 'ps_org_admin', name: 'organization_admin' };
// [ADR-0105 D4] The wall-less variant a `single`-posture deployment grants instead.
const ORG_ADMIN_NO_BYPASS_SET = { id: 'ps_org_admin_nb', name: 'organization_admin_no_bypass' };
/** The organization-less platform bucket — both names, no `organization_id`. */
const PLATFORM_BUCKET = [ORG_ADMIN_SET, ORG_ADMIN_NO_BYPASS_SET];
/** One organization's own catalog copies of both names. */
const ownSets = (org: string) => [
  { id: `ps_org_admin_${org}`, name: 'organization_admin', organization_id: org },
  { id: `ps_org_admin_nb_${org}`, name: 'organization_admin_no_bypass', organization_id: org },
];
/** The bucket plus each named organization's own copies, bucket first. */
const catalogFor = (...orgs: string[]) => [...PLATFORM_BUCKET, ...orgs.flatMap(ownSets)];

// Every pre-ADR-0105 case in this file exercised the WALLED behavior (the only
// behavior that existed), so they pin `isolated` explicitly. The wall-less
// posture — which grants the de-VAMA'd variant — gets its own describe below.
const WALLED = { posture: 'isolated' } as const;

describe('reconcileOrgAdminGrant', () => {
  let stub: ReturnType<typeof makeStub>;

  beforeEach(() => {
    stub = makeStub({
      sys_permission_set: catalogFor('o1'),
      sys_member: [],
      sys_user_permission_set: [],
    });
  });

  it('grants when membership role is "owner"', async () => {
    stub.tables.sys_member = [{ id: 'm1', user_id: 'u1', organization_id: 'o1', role: 'owner' }];
    const res = await reconcileOrgAdminGrant(stub, 'u1', 'o1', WALLED);
    expect(res.action).toBe('granted');
    expect(stub.tables.sys_user_permission_set).toHaveLength(1);
    const row = stub.tables.sys_user_permission_set[0];
    expect(row.organization_id).toBe('o1');
    // [#11670] o1's OWN copy of the set — not the organization-less bucket row
    // (`ps_org_admin`) that an unscoped, name-only, `limit: 1` read returns.
    expect(row.permission_set_id).toBe('ps_org_admin_o1');
  });

  it('grants when membership role is "admin"', async () => {
    stub.tables.sys_member = [{ id: 'm1', user_id: 'u1', organization_id: 'o1', role: 'admin' }];
    const res = await reconcileOrgAdminGrant(stub, 'u1', 'o1', WALLED);
    expect(res.action).toBe('granted');
  });

  it('handles comma-separated roles like "owner,admin"', async () => {
    stub.tables.sys_member = [
      { id: 'm1', user_id: 'u1', organization_id: 'o1', role: 'owner,admin' },
    ];
    const res = await reconcileOrgAdminGrant(stub, 'u1', 'o1', WALLED);
    expect(res.action).toBe('granted');
  });

  it('does NOT grant when role is just "member"', async () => {
    stub.tables.sys_member = [{ id: 'm1', user_id: 'u1', organization_id: 'o1', role: 'member' }];
    const res = await reconcileOrgAdminGrant(stub, 'u1', 'o1', WALLED);
    expect(res.action).toBe('noop');
    expect(stub.tables.sys_user_permission_set).toHaveLength(0);
  });

  it('revokes the scoped grant on demotion (admin → member)', async () => {
    stub.tables.sys_member = [{ id: 'm1', user_id: 'u1', organization_id: 'o1', role: 'member' }];
    stub.tables.sys_user_permission_set = [
      {
        id: 'ups1',
        user_id: 'u1',
        organization_id: 'o1',
        permission_set_id: 'ps_org_admin',
      },
    ];
    const res = await reconcileOrgAdminGrant(stub, 'u1', 'o1', WALLED);
    expect(res.action).toBe('revoked');
    expect(stub.tables.sys_user_permission_set).toHaveLength(0);
  });

  it('revokes when membership is gone entirely', async () => {
    stub.tables.sys_user_permission_set = [
      {
        id: 'ups1',
        user_id: 'u1',
        organization_id: 'o1',
        permission_set_id: 'ps_org_admin',
      },
    ];
    const res = await reconcileOrgAdminGrant(stub, 'u1', 'o1', WALLED);
    expect(res.action).toBe('revoked');
  });

  it('is idempotent — re-running keeps exactly one grant row', async () => {
    stub.tables.sys_member = [{ id: 'm1', user_id: 'u1', organization_id: 'o1', role: 'owner' }];
    await reconcileOrgAdminGrant(stub, 'u1', 'o1', WALLED);
    const res = await reconcileOrgAdminGrant(stub, 'u1', 'o1', WALLED);
    expect(res.action).toBe('noop');
    expect(stub.tables.sys_user_permission_set).toHaveLength(1);
  });

  it('only grants org-scoped (organization_id is set, not null)', async () => {
    stub.tables.sys_member = [{ id: 'm1', user_id: 'u1', organization_id: 'o1', role: 'owner' }];
    await reconcileOrgAdminGrant(stub, 'u1', 'o1', WALLED);
    const grant = stub.tables.sys_user_permission_set[0];
    expect(grant.organization_id).toBe('o1');
    expect(grant.organization_id).not.toBeNull();
  });

  it('skips cleanly when the permission set is not seeded', async () => {
    stub.tables.sys_permission_set = [];
    stub.tables.sys_member = [{ id: 'm1', user_id: 'u1', organization_id: 'o1', role: 'owner' }];
    const res = await reconcileOrgAdminGrant(stub, 'u1', 'o1', WALLED);
    expect(res.action).toBe('skipped');
    expect(res.reason).toBe('permission_set_missing');
  });
});

describe('backfillOrgAdminGrants', () => {
  it('grants for every owner/admin membership and revokes orphans', async () => {
    const stub = makeStub({
      sys_permission_set: catalogFor('o1', 'o2'),
      sys_member: [
        { id: 'm1', user_id: 'u1', organization_id: 'o1', role: 'owner' },
        { id: 'm2', user_id: 'u2', organization_id: 'o1', role: 'admin' },
        { id: 'm3', user_id: 'u3', organization_id: 'o1', role: 'member' },
      ],
      sys_user_permission_set: [
        // Orphan grant — no matching membership in o2. [#11670] It points at
        // O2'S OWN copy, which is what a post-repair grant looks like; the
        // sweep's set ids are resolved installation-wide precisely so a grant
        // written for another organization stays reachable.
        {
          id: 'ups_orphan',
          user_id: 'u4',
          organization_id: 'o2',
          permission_set_id: 'ps_org_admin_o2',
        },
      ],
    });

    const summary = await backfillOrgAdminGrants(stub, WALLED);
    expect(summary.scanned).toBe(3);
    expect(summary.granted).toBe(2);
    expect(summary.revoked).toBe(1);

    const grants = stub.tables.sys_user_permission_set;
    expect(grants).toHaveLength(2);
    const grantedUsers = grants.map((g) => g.user_id).sort();
    expect(grantedUsers).toEqual(['u1', 'u2']);
  });
});

// ---------------------------------------------------------------------------
// [ADR-0105 D4] Posture-selected org-admin variant.
//
// `organization_admin` carries wildcard viewAllRecords/modifyAllRecords, which
// is safe ONLY because Layer 0 bounds it to the caller's organization scope.
// A wall-less posture has no such bound — finding F2: with personal orgs on
// signup, every owner/admin would become an environment-wide superuser — so the
// auto-grant hands out the de-VAMA'd variant there instead.
// ---------------------------------------------------------------------------
describe('[ADR-0105 D4] posture selects the org-admin variant', () => {
  const seedBoth = () =>
    makeStub({
      sys_permission_set: catalogFor('o1'),
      sys_member: [{ id: 'm1', user_id: 'u1', organization_id: 'o1', role: 'owner' }],
      sys_user_permission_set: [],
    });

  it('grants the de-VAMA\'d variant under the wall-less `single` posture', async () => {
    const stub = seedBoth();
    const res = await reconcileOrgAdminGrant(stub, 'u1', 'o1', { posture: 'single' });
    expect(res.action).toBe('granted');
    expect(stub.tables.sys_user_permission_set).toHaveLength(1);
    expect(stub.tables.sys_user_permission_set[0].permission_set_id).toBe('ps_org_admin_nb');
  });

  it('grants the full set under `isolated` (the wall bounds the superuser bits)', async () => {
    const stub = seedBoth();
    const res = await reconcileOrgAdminGrant(stub, 'u1', 'o1', { posture: 'isolated' });
    expect(res.action).toBe('granted');
    expect(stub.tables.sys_user_permission_set[0].permission_set_id).toBe('ps_org_admin_o1');
  });

  it('grants the full set under `group` (the union wall bounds them too)', async () => {
    const stub = seedBoth();
    await reconcileOrgAdminGrant(stub, 'u1', 'o1', { posture: 'group' });
    expect(stub.tables.sys_user_permission_set[0].permission_set_id).toBe('ps_org_admin_o1');
  });

  it('defaults to the de-VAMA\'d variant when no posture is supplied (fail safe)', async () => {
    const stub = seedBoth();
    await reconcileOrgAdminGrant(stub, 'u1', 'o1');
    expect(stub.tables.sys_user_permission_set[0].permission_set_id).toBe('ps_org_admin_nb');
  });

  // The F2 close-out: a deployment that drops its wall must not leave the
  // unbounded grant in force. Reconciling converges on exactly one row.
  it('revokes the superseded variant when the posture changes', async () => {
    const stub = seedBoth();
    await reconcileOrgAdminGrant(stub, 'u1', 'o1', { posture: 'isolated' });
    expect(stub.tables.sys_user_permission_set[0].permission_set_id).toBe('ps_org_admin_o1');

    // [#11670] The flip crosses COPIES: the standing grant names o1's own row,
    // the `single` pass resolves the organization-less one. Convergence
    // therefore depends on the revoke matching every copy of the superseded
    // name — a revoke narrowed to the posture's own copy converges on nothing
    // and leaves the unbounded bits in force, which is the F2 outcome this test
    // is the close-out for.
    await reconcileOrgAdminGrant(stub, 'u1', 'o1', { posture: 'single' });
    expect(stub.tables.sys_user_permission_set).toHaveLength(1);
    expect(stub.tables.sys_user_permission_set[0].permission_set_id).toBe('ps_org_admin_nb');

    // ...and back again.
    await reconcileOrgAdminGrant(stub, 'u1', 'o1', { posture: 'isolated' });
    expect(stub.tables.sys_user_permission_set).toHaveLength(1);
    expect(stub.tables.sys_user_permission_set[0].permission_set_id).toBe('ps_org_admin_o1');
  });

  it('backfill converges every pair onto the posture\'s variant', async () => {
    const stub = makeStub({
      sys_permission_set: catalogFor('o1'),
      sys_member: [
        { id: 'm1', user_id: 'u1', organization_id: 'o1', role: 'owner' },
        { id: 'm2', user_id: 'u2', organization_id: 'o1', role: 'admin' },
      ],
      // Pre-existing unbounded grants from a previously-walled boot.
      sys_user_permission_set: [
        { id: 'ups1', user_id: 'u1', organization_id: 'o1', permission_set_id: 'ps_org_admin' },
        { id: 'ups2', user_id: 'u2', organization_id: 'o1', permission_set_id: 'ps_org_admin' },
      ],
    });

    await backfillOrgAdminGrants(stub, { posture: 'single' });

    const grants = stub.tables.sys_user_permission_set;
    expect(grants).toHaveLength(2);
    expect(grants.every((g) => g.permission_set_id === 'ps_org_admin_nb')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// [#12699] Deployment-declared suppression of the unbounded walled grant.
//
// D4's "the wall bounds the superbits" rationale stops holding on a deployment
// that carves platform-global objects OUT of the wall
// (`OrgScopingEntitlement.platformGlobalObjects`), so the same entitlement may
// declare `suppressUnboundedOrgAdminGrant: true` and the walled auto-grant
// hands out the de-VAMA'd variant there too. Fail closed: absent ⇒ D4's
// posture-keyed behaviour byte-identical (the block above IS that pin).
// ---------------------------------------------------------------------------
describe('[#12699] suppressUnboundedOrgAdminGrant', () => {
  const seedBoth = () =>
    makeStub({
      sys_permission_set: catalogFor('o1'),
      sys_member: [{ id: 'm1', user_id: 'u1', organization_id: 'o1', role: 'owner' }],
      sys_user_permission_set: [],
    });

  it('suppression ON: `isolated` grants the de-VAMA\'d variant', async () => {
    const stub = seedBoth();
    const res = await reconcileOrgAdminGrant(stub, 'u1', 'o1', {
      posture: 'isolated',
      suppressUnboundedOrgAdminGrant: true,
    });
    expect(res.action).toBe('granted');
    expect(stub.tables.sys_user_permission_set).toHaveLength(1);
    expect(stub.tables.sys_user_permission_set[0].permission_set_id).toBe('ps_org_admin_nb_o1');
  });

  it('suppression ON: `group` grants the de-VAMA\'d variant too', async () => {
    const stub = seedBoth();
    await reconcileOrgAdminGrant(stub, 'u1', 'o1', {
      posture: 'group',
      suppressUnboundedOrgAdminGrant: true,
    });
    expect(stub.tables.sys_user_permission_set[0].permission_set_id).toBe('ps_org_admin_nb_o1');
  });

  it('suppression OFF (explicit false) is byte-identical to today: `isolated` grants the full set', async () => {
    const stub = seedBoth();
    await reconcileOrgAdminGrant(stub, 'u1', 'o1', {
      posture: 'isolated',
      suppressUnboundedOrgAdminGrant: false,
    });
    expect(stub.tables.sys_user_permission_set[0].permission_set_id).toBe('ps_org_admin_o1');
  });

  it('turning suppression on REVOKES a standing unbounded grant (superseded-variant convergence)', async () => {
    const stub = seedBoth();
    await reconcileOrgAdminGrant(stub, 'u1', 'o1', { posture: 'isolated' });
    expect(stub.tables.sys_user_permission_set[0].permission_set_id).toBe('ps_org_admin_o1');

    await reconcileOrgAdminGrant(stub, 'u1', 'o1', {
      posture: 'isolated',
      suppressUnboundedOrgAdminGrant: true,
    });
    expect(stub.tables.sys_user_permission_set).toHaveLength(1);
    expect(stub.tables.sys_user_permission_set[0].permission_set_id).toBe('ps_org_admin_nb_o1');

    // ...and a deployment that withdraws the declaration converges back —
    // the fail-closed default protects any deployment RELYING on the auto-grant.
    await reconcileOrgAdminGrant(stub, 'u1', 'o1', { posture: 'isolated' });
    expect(stub.tables.sys_user_permission_set).toHaveLength(1);
    expect(stub.tables.sys_user_permission_set[0].permission_set_id).toBe('ps_org_admin_o1');
  });

  it('backfill threads the suppression to every pair AND the orphan sweep', async () => {
    const stub = makeStub({
      sys_permission_set: catalogFor('o1'),
      sys_member: [
        { id: 'm1', user_id: 'u1', organization_id: 'o1', role: 'owner' },
        { id: 'm2', user_id: 'u2', organization_id: 'o1', role: 'admin' },
      ],
      // Pre-existing unbounded grants from a pre-suppression walled boot, plus
      // one orphan (no membership row) that only the sweep can reach.
      //
      // [#11670] They point at the ORGANIZATION-LESS row, which is what every
      // walled grant written before this repair looks like. Converging them is
      // a revoke, so it stays reachable: the sweep and the per-pair revoke both
      // match every copy of the name. (⛔ Nothing re-points them — a row still
      // held by someone who qualifies is left exactly as it is.)
      sys_user_permission_set: [
        { id: 'ups1', user_id: 'u1', organization_id: 'o1', permission_set_id: 'ps_org_admin' },
        { id: 'ups2', user_id: 'u2', organization_id: 'o1', permission_set_id: 'ps_org_admin' },
        { id: 'ups3', user_id: 'u9', organization_id: 'o1', permission_set_id: 'ps_org_admin' },
      ],
    });

    await backfillOrgAdminGrants(stub, {
      posture: 'isolated',
      suppressUnboundedOrgAdminGrant: true,
    });

    const grants = stub.tables.sys_user_permission_set;
    expect(grants).toHaveLength(2);
    expect(grants.every((g) => g.permission_set_id === 'ps_org_admin_nb_o1')).toBe(true);
    expect(grants.some((g) => g.user_id === 'u9')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// [#4586] Hop 2 of the elevation chain stops discarding provenance.
//
// The chain is `sys_member.role` → this reconciler → `sys_user_permission_set`
// → `isTenantAdmin()`. The grant row had a `granted_by` column and wrote `null`
// into it unconditionally, so "why is X a tenant admin" dead-ended one hop in.
// Now the row records BOTH halves of the answer: the human whose better-auth
// call changed the grade (`granted_by`), and the machine writer + the exact
// membership row that triggered it (`reason`).
// ---------------------------------------------------------------------------
describe('[#4586] the auto-grant records its provenance', () => {
  const seed = () =>
    makeStub({
      sys_permission_set: catalogFor('o1'),
      sys_member: [{ id: 'mem_42', user_id: 'u1', organization_id: 'o1', role: 'admin' }],
      sys_user_permission_set: [],
    });

  it('stamps the attributed human into granted_by', async () => {
    const stub = seed();
    await reconcileOrgAdminGrant(stub, 'u1', 'o1', { ...WALLED, attributedUserId: 'usr_boss' });
    expect(stub.tables.sys_user_permission_set[0].granted_by).toBe('usr_boss');
  });

  it('names the machine writer and the triggering sys_member row in reason', async () => {
    const stub = seed();
    await reconcileOrgAdminGrant(stub, 'u1', 'o1', { ...WALLED, attributedUserId: 'usr_boss' });
    const reason: string = stub.tables.sys_user_permission_set[0].reason;
    // The marker a reader matches on — one constant, not a re-derived string.
    expect(reason.startsWith(AUTO_ORG_ADMIN_GRANT_REASON_PREFIX)).toBe(true);
    // …and the rest of the chain: which membership, at which grade, to which set.
    expect(reason).toContain('mem_42');
    expect(reason).toContain('admin');
    expect(reason).toContain('organization_admin');
    expect(reason).toBe(
      autoOrgAdminGrantReason({ id: 'mem_42', role: 'admin' }, 'organization_admin'),
    );
  });

  it('a machine-originated grade change leaves granted_by NULL — never a sentinel', async () => {
    // ADR-0118 D1: `granted_by` is a `sys_user` lookup, so the only two legal
    // values are a real id and null. The kernel:ready backfill and any boot
    // bind have no human, and writing 'system' there would break the join and
    // force every reader to special-case it.
    const stub = seed();
    await reconcileOrgAdminGrant(stub, 'u1', 'o1', WALLED);
    const row = stub.tables.sys_user_permission_set[0];
    expect(row.granted_by).toBeNull();
    // The machine provenance is still recorded — in the column that takes text.
    expect(row.reason.startsWith(AUTO_ORG_ADMIN_GRANT_REASON_PREFIX)).toBe(true);
  });

  it('attribution changes nothing about WHETHER the grant happens', async () => {
    // The threaded human is attribution, not authority: a member-grade row does
    // not become grantable because an admin triggered the write.
    const stub = makeStub({
      sys_permission_set: catalogFor('o1'),
      sys_member: [{ id: 'mem_9', user_id: 'u1', organization_id: 'o1', role: 'member' }],
      sys_user_permission_set: [],
    });
    const res = await reconcileOrgAdminGrant(stub, 'u1', 'o1', {
      ...WALLED,
      attributedUserId: 'usr_boss',
    });
    expect(res.action).toBe('noop');
    expect(stub.tables.sys_user_permission_set).toHaveLength(0);
  });

  it('demotion still revokes — with or without an attributed actor', async () => {
    const stub = seed();
    await reconcileOrgAdminGrant(stub, 'u1', 'o1', { ...WALLED, attributedUserId: 'usr_boss' });
    expect(stub.tables.sys_user_permission_set).toHaveLength(1);

    stub.tables.sys_member = [
      { id: 'mem_42', user_id: 'u1', organization_id: 'o1', role: 'member' },
    ];
    const res = await reconcileOrgAdminGrant(stub, 'u1', 'o1', {
      ...WALLED,
      attributedUserId: 'usr_boss',
    });
    expect(res.action).toBe('revoked');
    expect(stub.tables.sys_user_permission_set).toHaveLength(0);
  });

  it('the backfill grants with no human — it is machine-originated by construction', async () => {
    const stub = makeStub({
      sys_permission_set: catalogFor('o1'),
      sys_member: [{ id: 'mem_7', user_id: 'u1', organization_id: 'o1', role: 'owner' }],
      sys_user_permission_set: [],
    });
    await backfillOrgAdminGrants(stub, WALLED);
    const row = stub.tables.sys_user_permission_set[0];
    expect(row.granted_by).toBeNull();
    expect(row.reason).toContain('mem_7');
  });
});

// ---------------------------------------------------------------------------
// [#4640] The revoke channel, pinned at the call SHAPE.
//
// Every `revoked` assertion in this file was already green while production
// revoked nothing, because the double implemented the wrong signature. The
// tests below pin the two things that green-ness depended on and nobody was
// checking: the exact call the module hands the engine, and the double's
// refusal to accept anything else.
// ---------------------------------------------------------------------------
describe('[#4640] revoke speaks the engine\'s delete signature', () => {
  const seedDemoted = () =>
    makeStub({
      sys_permission_set: catalogFor('o1'),
      sys_member: [{ id: 'm1', user_id: 'u1', organization_id: 'o1', role: 'member' }],
      sys_user_permission_set: [
        { id: 'ups1', user_id: 'u1', organization_id: 'o1', permission_set_id: 'ps_org_admin' },
      ],
    });

  it('names the row by `where.id` in a TWO-argument call carrying the system context', async () => {
    const stub = seedDemoted();
    const res = await reconcileOrgAdminGrant(stub, 'u1', 'o1', WALLED);

    expect(res.action).toBe('revoked');
    expect(stub.deleteCalls).toHaveLength(1);
    const [call] = stub.deleteCalls;
    expect(call.object).toBe('sys_user_permission_set');
    // The whole bug in one assertion: the id belongs INSIDE the option bag.
    expect(call.options).toEqual({ where: { id: 'ups1' }, context: { isSystem: true } });
  });

  it('the double refuses the three-argument call the module used to make', async () => {
    // The drift guard. If a future edit reverts the call shape — or loosens
    // this double back toward `delete(object, id)` — this is what goes red
    // instead of the whole feature going silently inert.
    const stub = seedDemoted();
    await expect(
      (stub as any).delete('sys_user_permission_set', 'ups1', { context: { isSystem: true } }),
    ).rejects.toThrow(/takes an OPTION BAG/);
    expect(stub.tables.sys_user_permission_set).toHaveLength(1);
  });

  it('a delete the datastore rejects is REPORTED — never a silent no-op', async () => {
    // The other half of why this survived: the wrapper's `catch {}` turned a
    // throwing revoke into `false` and told nobody. The capability is still in
    // force, so that has to reach an operator.
    const stub = seedDemoted();
    stub.delete = async () => {
      throw new Error('driver exploded');
    };
    const warnings: Array<{ msg: string; meta?: any }> = [];
    const logger = { warn: (msg: string, meta?: any) => warnings.push({ msg, meta }) };

    const res = await reconcileOrgAdminGrant(stub, 'u1', 'o1', { ...WALLED, logger });

    expect(res).toEqual({ action: 'skipped', reason: 'delete_failed' });
    // The grant row is still there — the state the warning is about.
    expect(stub.tables.sys_user_permission_set).toHaveLength(1);
    expect(warnings.map((w) => w.msg)).toEqual([
      '[security] org-admin grant revoke FAILED — capability still in force',
      '[security] org-admin capability could NOT be revoked — grant rows remain',
    ]);
    expect(warnings[0].meta.error).toBe('driver exploded');
  });

  it('"nothing to revoke" stays distinguishable from "revoke failed"', async () => {
    // `noop` and `skipped/delete_failed` are different facts about the
    // platform's state; collapsing them is how the failure hid.
    const stub = makeStub({
      sys_permission_set: catalogFor('o1'),
      sys_member: [{ id: 'm1', user_id: 'u1', organization_id: 'o1', role: 'member' }],
      sys_user_permission_set: [],
    });
    const res = await reconcileOrgAdminGrant(stub, 'u1', 'o1', WALLED);
    expect(res).toEqual({ action: 'noop' });
    expect(stub.deleteCalls).toHaveLength(0);
  });

  it('membership removal revokes through the same channel', async () => {
    // The `sys_member` delete path: no membership row at all, grant still there.
    const stub = makeStub({
      sys_permission_set: catalogFor('o1'),
      sys_member: [],
      sys_user_permission_set: [
        { id: 'ups1', user_id: 'u1', organization_id: 'o1', permission_set_id: 'ps_org_admin' },
      ],
    });
    const res = await reconcileOrgAdminGrant(stub, 'u1', 'o1', WALLED);
    expect(res.action).toBe('revoked');
    expect(stub.tables.sys_user_permission_set).toHaveLength(0);
    expect(stub.deleteCalls[0].options.where).toEqual({ id: 'ups1' });
  });
});

// ---------------------------------------------------------------------------
// [#11670] The grant target is resolved PER ORGANIZATION; the revoke reach is
// not.
//
// The defect was three properties that each read as deliberate and combine into
// an answer nobody chose: the permission-set read was name-only (no
// `organization_id` predicate, not routed through the governed
// `resolveOwnOrganizationRow`), `limit: 1` (whichever row the driver returned
// first WAS the answer), and cached per ObjectQL instance on the NAME alone (so
// the first organization reconciled in a process picked the row every later one
// got). Post-#10103 one name carries a row per organization PLUS the
// organization-less platform-bucket row, and #11532 measured that the
// organization-less row is the OLDEST of them — so the grant, a foreign key,
// pointed at a row belonging to no organization.
//
// Nothing observable broke, which is why it survived: `resolve-authz-context`
// resolves permission sets BY ID without tenant scoping, so the grant still
// evaluated. The pins below are therefore about WHICH ROW, not about whether
// access works.
// ---------------------------------------------------------------------------
describe('[#11670] the org-admin permission set is resolved per organization', () => {
  /** Reads of the catalog table, as the engine received them. */
  const catalogReads = (stub: ReturnType<typeof makeStub>) =>
    stub.findCalls.filter((c) => c.object === 'sys_permission_set');

  it('grants against THIS organization\'s own row, never the organization-less one', async () => {
    const stub = makeStub({
      sys_permission_set: catalogFor('o1'),
      sys_member: [{ id: 'm1', user_id: 'u1', organization_id: 'o1', role: 'owner' }],
      sys_user_permission_set: [],
    });
    const res = await reconcileOrgAdminGrant(stub, 'u1', 'o1', WALLED);

    expect(res.action).toBe('granted');
    expect(stub.tables.sys_user_permission_set[0].permission_set_id).toBe('ps_org_admin_o1');
    // The bucket row is visible to the scoped read through the driver's
    // compatibility arm — it is REACHABLE and still not chosen.
    expect(stub.tables.sys_permission_set.some((r) => r.id === 'ps_org_admin')).toBe(true);
  });

  it('routes the catalog read through the tenant scope rather than a local predicate', async () => {
    const stub = makeStub({
      sys_permission_set: catalogFor('o1'),
      sys_member: [{ id: 'm1', user_id: 'u1', organization_id: 'o1', role: 'owner' }],
      sys_user_permission_set: [],
    });
    await reconcileOrgAdminGrant(stub, 'u1', 'o1', WALLED);

    // The governed spelling: the organization rides the CONTEXT (so the read
    // goes through `SqlDriver.applyTenantScope`), never a hand-rolled
    // `organization_id` key in `where`. A local predicate would be a second
    // implementation of the wall — the shape this repair exists to retire.
    const scoped = catalogReads(stub).filter((c) => c.context?.tenantId === 'o1');
    expect(scoped.length).toBeGreaterThan(0);
    expect(scoped.every((c) => Object.keys(c.where).length === 1 && 'name' in c.where)).toBe(true);
    // …and `limit: 1` is gone from the scoped read: a scoped page holds this
    // organization's row AND the organization-less one, so one row would again
    // be whichever the driver ordered first.
    expect(scoped.every((c) => c.limit > 1)).toBe(true);
  });

  it('two organizations in ONE process resolve to DIFFERENT ids (the cache key)', async () => {
    // The property the `name`-only cache made impossible to hold. A test with
    // one organization cannot detect it: the first answer of the process was
    // the answer for every organization for the rest of the process, and with
    // one organization that is indistinguishable from correct.
    const stub = makeStub({
      sys_permission_set: catalogFor('o1', 'o2'),
      sys_member: [
        { id: 'm1', user_id: 'u1', organization_id: 'o1', role: 'owner' },
        { id: 'm2', user_id: 'u2', organization_id: 'o2', role: 'owner' },
      ],
      sys_user_permission_set: [],
    });

    // Same `ql` instance, so the same WeakMap entry — that is the point.
    await reconcileOrgAdminGrant(stub, 'u1', 'o1', WALLED);
    await reconcileOrgAdminGrant(stub, 'u2', 'o2', WALLED);

    const byUser = Object.fromEntries(
      stub.tables.sys_user_permission_set.map((g) => [g.user_id, g.permission_set_id]),
    );
    expect(byUser.u1).toBe('ps_org_admin_o1');
    expect(byUser.u2).toBe('ps_org_admin_o2');
    expect(byUser.u1).not.toBe(byUser.u2);
  });

  it('caching still holds WITHIN one organization — the repair keys it, it does not drop it', async () => {
    const stub = makeStub({
      sys_permission_set: catalogFor('o1'),
      sys_member: [{ id: 'm1', user_id: 'u1', organization_id: 'o1', role: 'owner' }],
      sys_user_permission_set: [],
    });
    await reconcileOrgAdminGrant(stub, 'u1', 'o1', WALLED);
    const first = catalogReads(stub).filter((c) => c.context?.tenantId === 'o1').length;
    await reconcileOrgAdminGrant(stub, 'u1', 'o1', WALLED);
    const second = catalogReads(stub).filter((c) => c.context?.tenantId === 'o1').length;
    // The grant-target resolution is memoized per (organization, name), so the
    // second reconcile adds no scoped read for it.
    expect(second).toBe(first);
  });

  describe('no own row — the refusal, and the half it does NOT refuse', () => {
    const bucketOnly = () =>
      makeStub({
        // A walled rig whose per-organization catalog seeding has not run (or
        // failed): only the platform bucket exists, and it is visible to o3's
        // scoped read through the driver's compatibility arm.
        sys_permission_set: [...PLATFORM_BUCKET],
        sys_member: [],
        sys_user_permission_set: [],
      });

    it('REFUSES to grant, loudly, rather than pointing a new grant at the bucket row', async () => {
      const stub = bucketOnly();
      stub.tables.sys_member = [{ id: 'm1', user_id: 'u1', organization_id: 'o3', role: 'owner' }];
      const warnings: string[] = [];
      const res = await reconcileOrgAdminGrant(stub, 'u1', 'o3', {
        ...WALLED,
        logger: { warn: (m: string) => warnings.push(m) },
      });

      expect(res).toEqual({ action: 'skipped', reason: 'permission_set_missing' });
      expect(stub.tables.sys_user_permission_set).toHaveLength(0);
      // The refusal reaches an operator, and says what it did NOT do. Silence
      // here is the failure mode: the bucket row is visible, so without this an
      // operator sees a plausible row and a missing grant with nothing
      // connecting them.
      expect(warnings.some((m) => m.includes('no org-admin capability can be GRANTED'))).toBe(true);
    });

    it('still REVOKES in that same state — the refusal is one-directional', async () => {
      // The half that keeps the repair from being a permission loosening. A
      // narrowed grant target must not narrow the revoke: this pair no longer
      // qualifies, and its standing grant points at the organization-less row,
      // which is what every walled grant written before this repair looks like.
      const stub = bucketOnly();
      stub.tables.sys_user_permission_set = [
        { id: 'ups_old', user_id: 'u1', organization_id: 'o3', permission_set_id: 'ps_org_admin' },
      ];
      const res = await reconcileOrgAdminGrant(stub, 'u1', 'o3', WALLED);

      expect(res.action).toBe('revoked');
      expect(stub.tables.sys_user_permission_set).toHaveLength(0);
    });

    it('warns once per (organization, name), not once per membership pair', async () => {
      const stub = bucketOnly();
      stub.tables.sys_member = [
        { id: 'm1', user_id: 'u1', organization_id: 'o3', role: 'owner' },
        { id: 'm2', user_id: 'u2', organization_id: 'o3', role: 'admin' },
      ];
      const warnings: string[] = [];
      const logger = { warn: (m: string) => warnings.push(m) };
      await reconcileOrgAdminGrant(stub, 'u1', 'o3', { ...WALLED, logger });
      await reconcileOrgAdminGrant(stub, 'u2', 'o3', { ...WALLED, logger });

      const refusals = warnings.filter((m) => m.includes('no org-admin capability can be GRANTED'));
      expect(refusals).toHaveLength(1);
    });
  });

  it('leaves an EXISTING mis-targeted grant exactly as it is (⛔ no repair claimed)', async () => {
    // The card's boundary, pinned so a later reader does not mistake the repair
    // for a migration: this makes NEW resolutions correct. A row already
    // pointing at the organization-less set, held by someone who still
    // qualifies, is neither re-pointed nor deleted — counting and repairing
    // those is the reap card's census. The visible consequence is a second row,
    // and that is the honest state: two grants, both conferring the same
    // capability, one of them the census's to deal with.
    const stub = makeStub({
      sys_permission_set: catalogFor('o1'),
      sys_member: [{ id: 'm1', user_id: 'u1', organization_id: 'o1', role: 'owner' }],
      sys_user_permission_set: [
        { id: 'ups_pre', user_id: 'u1', organization_id: 'o1', permission_set_id: 'ps_org_admin' },
      ],
    });
    await reconcileOrgAdminGrant(stub, 'u1', 'o1', WALLED);

    const rows = stub.tables.sys_user_permission_set;
    expect(rows.find((r) => r.id === 'ups_pre')).toEqual({
      id: 'ups_pre',
      user_id: 'u1',
      organization_id: 'o1',
      permission_set_id: 'ps_org_admin',
    });
    expect(rows.map((r) => r.permission_set_id).sort()).toEqual([
      'ps_org_admin',
      'ps_org_admin_o1',
    ]);
  });

  it('the backfill sweep reaches an orphan grant pointing at ANY organization\'s copy', async () => {
    // Post-repair every organization's grants name its own row, so a sweep
    // holding one unscoped id would match none of them and an orphaned grant
    // would stop being revocable — a capability left standing.
    const stub = makeStub({
      sys_permission_set: catalogFor('o1', 'o2'),
      sys_member: [{ id: 'm1', user_id: 'u1', organization_id: 'o1', role: 'owner' }],
      sys_user_permission_set: [
        { id: 'ups_o2', user_id: 'u9', organization_id: 'o2', permission_set_id: 'ps_org_admin_o2' },
      ],
    });
    const summary = await backfillOrgAdminGrants(stub, WALLED);

    expect(summary.revoked).toBe(1);
    expect(stub.tables.sys_user_permission_set.map((g) => g.user_id)).toEqual(['u1']);
  });
});

// ---------------------------------------------------------------------------
// [#11670] The `single` carve-out, measured.
//
// Under `single` there is no organization for a catalog row to belong to, so
// the organization-less row IS the row and the unscoped answer stays correct.
// This block is the leak detector for the scoping above: if any of it reaches
// the wall-less posture, these go red.
// ---------------------------------------------------------------------------
describe('[#11670] `single` posture is carved out', () => {
  const seedSingle = () =>
    makeStub({
      sys_permission_set: catalogFor('o1'),
      sys_member: [{ id: 'm1', user_id: 'u1', organization_id: 'o1', role: 'owner' }],
      sys_user_permission_set: [],
    });

  it('grants the organization-less row even where an organization copy exists', async () => {
    const stub = seedSingle();
    await reconcileOrgAdminGrant(stub, 'u1', 'o1', { posture: 'single' });
    // The ANSWER, unchanged: the first row of an unscoped read, which is the
    // organization-less one. o1's own copy exists in this fixture and is
    // deliberately NOT preferred — `single` has no wall for it to belong to.
    expect(stub.tables.sys_user_permission_set[0].permission_set_id).toBe('ps_org_admin_nb');
  });

  it('NO read on a `single` path carries a tenantId', async () => {
    // The one-line statement of the carve-out, and the assertion that goes red
    // first if the scoping leaks: threading an organization is what routes a
    // read through the wall, so its absence is the whole property.
    const stub = seedSingle();
    await reconcileOrgAdminGrant(stub, 'u1', 'o1', { posture: 'single' });
    await backfillOrgAdminGrants(stub, { posture: 'single' });
    expect(stub.findCalls.every((c) => c.context?.tenantId === undefined)).toBe(true);
    expect(stub.findCalls.length).toBeGreaterThan(0);
  });

  it('the grant-target read is the unscoped `limit: 1` it always was', async () => {
    const stub = seedSingle();
    await reconcileOrgAdminGrant(stub, 'u1', 'o1', { posture: 'single' });
    const target = stub.findCalls.find(
      (c) => c.object === 'sys_permission_set' && c.where?.name === 'organization_admin_no_bypass',
    );
    expect(target).toEqual({
      object: 'sys_permission_set',
      where: { name: 'organization_admin_no_bypass' },
      limit: 1,
      context: { isSystem: true },
    });
  });

  it('DECLARED DEVIATION: the revoke reads are wide in `single` too', async () => {
    // ⚠️ Not an accident and not the scoping leaking — the one place this diff
    // is visible under `single`, recorded here rather than left for a reader to
    // discover.
    //
    // Before this diff the revoke legs matched a scalar id resolved by the same
    // unscoped `limit: 1` read as the grant target. That is enough only while
    // one row per name exists. The F2 close-out (ADR-0105 D4) is exactly the
    // deployment that DROPS its wall: every grant standing at that moment names
    // a per-organization copy, which `single`'s own resolution cannot see, so a
    // narrow revoke converges on nothing and leaves the unbounded
    // `organization_admin` bits in force with nothing left to bound them.
    //
    // So the revoke reach is posture-independent by design: `{ $in: [every copy
    // of the name] }` at `ORG_ADMIN_SET_COPY_SCAN_LIMIT`, in every posture. The
    // grant target is unchanged; the reads below are the price, and they are
    // still unscoped — no `tenantId`, per the pin above.
    const stub = seedSingle();
    await reconcileOrgAdminGrant(stub, 'u1', 'o1', { posture: 'single' });
    const superseded = stub.findCalls.find(
      (c) => c.object === 'sys_permission_set' && c.where?.name === 'organization_admin',
    );
    expect(superseded?.limit).toBeGreaterThan(1);
    expect(superseded?.context).toEqual({ isSystem: true });
    const staleRead = stub.findCalls.find(
      (c) => c.object === 'sys_user_permission_set' && c.where?.permission_set_id?.$in,
    );
    // Pre-diff this predicate was the scalar `permission_set_id: 'ps_org_admin'`
    // — the organization-less row alone. The second id is the whole point: it
    // is o1's copy, written while the deployment was walled, and it is the row
    // a `single` pass has to be able to revoke.
    expect(staleRead?.where.permission_set_id).toEqual({
      $in: ['ps_org_admin', 'ps_org_admin_o1'],
    });
  });

  it('the read ORDER and the objects read are unchanged under `single`', async () => {
    // The rest of the multiset: same objects, same order, same predicates —
    // only the two reads named in the deviation above differ, and only in
    // `limit`/`$in`.
    const stub = seedSingle();
    await reconcileOrgAdminGrant(stub, 'u1', 'o1', { posture: 'single' });
    expect(stub.findCalls.map((c) => c.object)).toEqual([
      'sys_permission_set', // grant-target resolution (limit 1, unchanged)
      'sys_member', // does the pair qualify
      'sys_permission_set', // superseded-variant ids (widened — see above)
      'sys_user_permission_set', // superseded grants for the pair (widened)
      'sys_user_permission_set', // does the grant already exist (scalar, unchanged)
    ]);
  });
});
