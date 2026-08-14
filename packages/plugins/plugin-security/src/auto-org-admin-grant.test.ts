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
    // find(object, query, options) — `where`/`limit` in the query, execution
    // context in either bag (`options.context` wins, as in the engine).
    async find(object: string, query?: any, options?: any) {
      assertOptionBag('find', object, query, FIND_QUERY_KEYS);
      assertOptionBag('find', object, options, TRAILING_OPTION_KEYS);
      assertSystemContext('find', object, options?.context ?? query?.context);
      const rows = (tables[object] ?? []).filter((r) => matches(r, query?.where));
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

const ORG_ADMIN_SET = { id: 'ps_org_admin', name: 'organization_admin' };
// [ADR-0105 D4] The wall-less variant a `single`-posture deployment grants instead.
const ORG_ADMIN_NO_BYPASS_SET = { id: 'ps_org_admin_nb', name: 'organization_admin_no_bypass' };

// Every pre-ADR-0105 case in this file exercised the WALLED behavior (the only
// behavior that existed), so they pin `isolated` explicitly. The wall-less
// posture — which grants the de-VAMA'd variant — gets its own describe below.
const WALLED = { posture: 'isolated' } as const;

describe('reconcileOrgAdminGrant', () => {
  let stub: ReturnType<typeof makeStub>;

  beforeEach(() => {
    stub = makeStub({
      sys_permission_set: [ORG_ADMIN_SET, ORG_ADMIN_NO_BYPASS_SET],
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
    expect(row.permission_set_id).toBe('ps_org_admin');
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
      sys_permission_set: [ORG_ADMIN_SET, ORG_ADMIN_NO_BYPASS_SET],
      sys_member: [
        { id: 'm1', user_id: 'u1', organization_id: 'o1', role: 'owner' },
        { id: 'm2', user_id: 'u2', organization_id: 'o1', role: 'admin' },
        { id: 'm3', user_id: 'u3', organization_id: 'o1', role: 'member' },
      ],
      sys_user_permission_set: [
        // Orphan grant — no matching membership in o2.
        {
          id: 'ups_orphan',
          user_id: 'u4',
          organization_id: 'o2',
          permission_set_id: 'ps_org_admin',
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
      sys_permission_set: [ORG_ADMIN_SET, ORG_ADMIN_NO_BYPASS_SET],
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
    expect(stub.tables.sys_user_permission_set[0].permission_set_id).toBe('ps_org_admin');
  });

  it('grants the full set under `group` (the union wall bounds them too)', async () => {
    const stub = seedBoth();
    await reconcileOrgAdminGrant(stub, 'u1', 'o1', { posture: 'group' });
    expect(stub.tables.sys_user_permission_set[0].permission_set_id).toBe('ps_org_admin');
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
    expect(stub.tables.sys_user_permission_set[0].permission_set_id).toBe('ps_org_admin');

    await reconcileOrgAdminGrant(stub, 'u1', 'o1', { posture: 'single' });
    expect(stub.tables.sys_user_permission_set).toHaveLength(1);
    expect(stub.tables.sys_user_permission_set[0].permission_set_id).toBe('ps_org_admin_nb');

    // ...and back again.
    await reconcileOrgAdminGrant(stub, 'u1', 'o1', { posture: 'isolated' });
    expect(stub.tables.sys_user_permission_set).toHaveLength(1);
    expect(stub.tables.sys_user_permission_set[0].permission_set_id).toBe('ps_org_admin');
  });

  it('backfill converges every pair onto the posture\'s variant', async () => {
    const stub = makeStub({
      sys_permission_set: [ORG_ADMIN_SET, ORG_ADMIN_NO_BYPASS_SET],
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
      sys_permission_set: [ORG_ADMIN_SET, ORG_ADMIN_NO_BYPASS_SET],
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
      sys_permission_set: [ORG_ADMIN_SET, ORG_ADMIN_NO_BYPASS_SET],
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
      sys_permission_set: [ORG_ADMIN_SET, ORG_ADMIN_NO_BYPASS_SET],
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
      sys_permission_set: [ORG_ADMIN_SET, ORG_ADMIN_NO_BYPASS_SET],
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
      sys_permission_set: [ORG_ADMIN_SET, ORG_ADMIN_NO_BYPASS_SET],
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
      sys_permission_set: [ORG_ADMIN_SET, ORG_ADMIN_NO_BYPASS_SET],
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
