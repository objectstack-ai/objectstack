// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Commit 1c83ca226 — whether this deployment ALREADY has a platform admin, and why the
 * answer stopped being a function of how many ORG admins it has.
 *
 * ## The defect, re-measured on this branch's base before anything changed
 *
 * The `already_have_admin` short-circuit read `tryFind(ql,
 * 'sys_user_permission_set', { permission_set_id: adminPsId }, 50)` — no
 * `orderBy`, cap 50 — and then applied the predicate that actually decides,
 * `!organization_id`, CLIENT-SIDE to whatever 50 rows the driver produced
 * first. `admin_full_access` is not only the platform-admin set: every
 * ORGANIZATION-SCOPED grant of it writes a row carrying the same
 * `permission_set_id`, so the population this query counts grows with the
 * number of ORG admins. A tenant with fifty-odd of them fills the window with
 * rows that all fail the filter, and the guard answers "no platform admin
 * here" about a deployment that has one.
 *
 * The consequence is not a missing log line. A SECOND unscoped
 * `admin_full_access` grant is minted, and `claimSeedOwnership` re-owns the
 * seeded business records to the newly promoted user — silently, because the
 * boot logs a successful promotion exactly as on a genuinely fresh install.
 * The guarantee that fails open is #14348 case D: 「Moving an already-granted
 * platform admin is reserved to the maintainer.」
 *
 * ## ⭐ The contrast IS the test — both halves predicted before running
 *
 * The card's reproduction sketch is a cell, not a failure:
 *
 * | fixture | on the base | after the fix |
 * |---|---|---|
 * | 60 org-scoped grants + 1 anchoring human grant sorting LAST (61 rows) | `adminPromoted: true`, **two** anchoring grant rows | `already_have_admin`, **one** anchoring grant row |
 * | the SAME fixture with 9 org-scoped grants (10 rows, under the cap) | `already_have_admin` | `already_have_admin` — unchanged |
 *
 * ⛔ The 60-row failure on its own would be half a test. The 10-row row is the
 * CONTROL that proves the fixture measures TRUNCATION and not some other
 * difference between the two populations: the same code, the same shapes, the
 * same posture, one number changed.
 *
 * Both rows were predicted in writing first and then observed. The measured
 * base run is quoted on the PR.
 *
 * ## Whose grant is the anchor, and what the two reads ask ([ADR-0131] D5)
 *
 * The anchoring grant is the one the DEFAULT ORGANIZATION owns — the row a
 * `single` promotion writes, and the only one the derivation site reads. Leg A
 * asks the driver for exactly that, ONCE: `{ permission_set:
 * 'admin_full_access', organization_id: <the Default Organization> }`. Leg B,
 * only when leg A found nobody, is the ordered, bounded scan of every grant of
 * the set, applying the same predicate client-side.
 *
 * An ORGANIZATION-LESS row (`null`, or the `''` shape both SQL families store)
 * is never a holder: the 18.0 ownership ceremony (ADR-0131 D10) attributes every
 * such row to an organization before an upgraded database boots, and a fresh
 * install never writes one. This card's earlier revision pinned the opposite —
 * leg A asking a second time for the `null` row, and leg B still seeing the
 * `''`-shaped one; both cases below are rewritten to the rule that replaced it.
 * Where no Default Organization can be named — under a wall, or with no
 * organization to name — the scan asks the grant table NOTHING.
 *
 * ## Why the row ORDER is permuted rather than a second driver package
 *
 * Same reason as `bootstrap-platform-admin-promotion-selection.test.ts`
 * (commit 9b9581b11): `@objectstack/driver-memory` cannot be declared here without a
 * `scripts/driver-memory-census.ledger.json` disposition, which is a
 * maintainer ruling. Each case runs the REAL engine over the REAL
 * better-sqlite3 driver behind a facade that permutes a result ONLY when the
 * query carried no `orderBy` — precisely the freedom a driver has there. When
 * the query DOES carry `orderBy` the facade forwards it and returns the result
 * untouched, so a fix that sent an order and a driver that ignored it would
 * still be caught, and `AS_RETURNED` is an unwrapped real-driver run.
 */

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { resetPlatformAdminEmailMemo } from '@objectstack/core';
import { SysUser, SysAccount, SysOrganization } from '@objectstack/platform-objects/identity';
import {
  bootstrapPlatformAdmin,
  PLATFORM_ADMIN_GRANT_PAGE_SIZE,
  PLATFORM_ADMIN_GRANT_SCAN_CEILING,
} from './bootstrap-platform-admin.js';
import { SysPermissionSet } from './__tests__/legacy-catalog-objects.testkit.js';
import { SysUserPermissionSet } from './objects/sys-user-permission-set.object.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';

const SYSTEM_CTX = { isSystem: true };
const OWNER_ENV = 'OS_PLATFORM_OWNER_EMAIL';
/** The permission-set id the fixture pre-seeds, so grant rows can point at it. */
const ADMIN_PS_ID = 'ps_admin_full';
/** [ADR-0131 D5] The Default Organization {@link boot} creates — the anchoring grant's owner. */
const DEFAULT_ORG = 'org_default';

const engines: ObjectQL[] = [];

afterEach(async () => {
  while (engines.length) {
    try {
      await engines.pop()?.destroy();
    } catch {
      /* noop */
    }
  }
});

beforeEach(() => {
  delete process.env[OWNER_ENV];
  resetPlatformAdminEmailMemo();
});

afterEach(() => {
  delete process.env[OWNER_ENV];
  resetPlatformAdminEmailMemo();
});

/** A fresh engine on its own `:memory:` sqlite database with the REAL declarations. */
async function boot(): Promise<ObjectQL> {
  const engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    }),
    true,
  );
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.security-objects',
    name: 'Security Objects',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [SysPermissionSet, SysUserPermissionSet, SysUser, SysAccount, SysOrganization],
  } as any);
  await engine.syncSchemas();
  // [ADR-0131 D3/D5] The Default Organization a `single` boot creates before any
  // `kernel:ready` hook runs; it owns the promotion's grant.
  await engine.insert('sys_organization', { id: 'org_default', name: 'Default Organization', slug: 'default' }, { context: { isSystem: true } });
  engines.push(engine);
  return engine;
}

const NATURAL_ORDERS = ['AS_RETURNED', 'INSERTION', 'REVERSED'] as const;
type NaturalOrder = (typeof NATURAL_ORDERS)[number];

/**
 * Wrap a real engine so an UNORDERED read comes back in `order`.
 *
 * ⚠️ The rule that keeps this honest: when the query carries `orderBy`, the
 * query is forwarded verbatim and the RESULT is returned untouched. The facade
 * never sorts, so everything the fix relies on is done by the real SQL engine.
 */
/** [C8 stage 8b] The real engine behind a {@link withNaturalOrder} facade, for landing residue. */
const ENGINE_OF = new WeakMap<object, ObjectQL>();

function withNaturalOrder(engine: ObjectQL, order: NaturalOrder): any {
  const insertionRank = new Map<string, number>();
  let nextRank = 0;
  const rankKey = (object: string, id: unknown) => `${object}:${String(id)}`;
  const facade = {
    async find(object: string, query: any, options: any) {
      const rows = await (engine as any).find(object, query, options);
      if (!Array.isArray(rows)) return rows;
      if (order === 'AS_RETURNED') return rows;
      if (query?.orderBy) return rows;
      if (order === 'REVERSED') return [...rows].reverse();
      return [...rows].sort(
        (a, b) =>
          (insertionRank.get(rankKey(object, a?.id)) ?? 0) -
          (insertionRank.get(rankKey(object, b?.id)) ?? 0),
      );
    },
    async insert(object: string, data: any, options: any) {
      const result = await (engine as any).insert(object, data, options);
      const id = data?.id ?? result?.id;
      if (id !== undefined) insertionRank.set(rankKey(object, id), nextRank++);
      return result;
    },
    // The shared engine-double contract (`check:engine-double-contract`):
    // asserted BEFORE delegating, so this wrapper can never be the loose link.
    async update(object: string, data: any, options: any) {
      assertEngineUpdateDispatch(data, options);
      return (engine as any).update(object, data, options);
    },
  };
  ENGINE_OF.set(facade, engine);
  return facade;
}

// ───────────────────────────────────────────────────────────────────────────
// Fixtures
// ───────────────────────────────────────────────────────────────────────────

async function seedUser(
  ql: any,
  id: string,
  email: string,
  createdAt: string,
  withAccount: boolean,
): Promise<void> {
  await ql.insert(
    'sys_user',
    { id, email, name: email.split('@')[0], created_at: createdAt, email_verified: false },
    { context: SYSTEM_CTX },
  );
  if (withAccount) {
    await ql.insert(
      'sys_account',
      { id: `acc_${id}`, user_id: id, account_id: email, provider_id: 'credential' },
      { context: SYSTEM_CTX },
    );
  }
}

/**
 * The card's population: a tenant whose `admin_full_access` rows are dominated
 * by OTHER organizations' grants, plus the one Default Organization grant whose
 * human holder IS its platform admin.
 *
 * The anchoring grant row's id collates AFTER every other one, so the real
 * driver's own unordered window is exactly the window the card describes: full
 * of rows that fail the anchor predicate, with the row that decides outside it.
 *
 * `usr_orgadmin_001` is the OLDEST authenticable human — an org admin imported
 * before the founder signed up, which is what a tenant with sixty org admins
 * actually looks like. So when the guard fails, the promotion does not merely
 * duplicate the founder's grant: it hands platform admin to an ORG admin.
 *
 * @param orgGrants how many other organizations' grants of the same set exist
 * @param founderOrganizationId the value the founder's grant stores — the
 *   Default Organization (the anchor), or an organization-less legacy shape
 */
async function seedTenant(
  ql: any,
  orgGrants: number,
  founderOrganizationId: typeof DEFAULT_ORG | null | '' = DEFAULT_ORG,
): Promise<void> {
  await ql.insert(
    'sys_permission_set',
    { id: ADMIN_PS_ID, name: 'admin_full_access', label: 'Admin Full Access', managed_by: 'platform', active: true },
    { context: SYSTEM_CTX },
  );

  // The founder — this deployment's platform admin, and the row the guard has
  // to find. Inserted FIRST so the insertion-order family puts it in row 1.
  await seedUser(ql, 'usr_founder', 'founder@tenant.example', '2026-01-01T00:00:00.000Z', true);
  // [C8 stage 8b] Landed straight through the driver, so the value stored is
  // exactly `founderOrganizationId`: under `single` the engine would stamp an
  // organization-less platform insert with the Default Organization (ADR-0131
  // D9), and the organization-less shapes are what the negative case needs.
  // An unranked row sorts first in the insertion-order family, as it did when
  // it was inserted first.
  const real: any = ENGINE_OF.get(ql) ?? ql;
  await real.getDriver('sys_user_permission_set').create('sys_user_permission_set', {
    id: 'ups_zzz_founder',
    user_id: 'usr_founder',
    permission_set: 'admin_full_access',
    organization_id: founderOrganizationId,
  });

  for (let i = 1; i <= orgGrants; i++) {
    const n = String(i).padStart(3, '0');
    await seedUser(
      ql,
      `usr_orgadmin_${n}`,
      `orgadmin${n}@tenant.example`,
      `2025-01-01T00:00:${String(i % 60).padStart(2, '0')}.000Z`,
      true,
    );
    await ql.insert(
      'sys_user_permission_set',
      {
        id: `ups_org_${n}`,
        user_id: `usr_orgadmin_${n}`,
        permission_set: 'admin_full_access',
        organization_id: `org_${n}`,
      },
      { context: SYSTEM_CTX },
    );
  }
}

async function findRows(engine: ObjectQL, object: string, where: any = {}): Promise<any[]> {
  const rows = await (engine as any).find(object, { where, limit: 5000 }, { context: SYSTEM_CTX });
  return Array.isArray(rows) ? rows : [];
}

/** Every `admin_full_access` grant row the Default Organization owns — the anchoring ones. */
async function anchorGrants(engine: ObjectQL): Promise<any[]> {
  const links = await findRows(engine, 'sys_user_permission_set', { permission_set: 'admin_full_access' });
  expect(links.length, 'ANTI-VACUITY: the fixture must have written grant rows').toBeGreaterThan(0);
  return links.filter((r) => r.organization_id === DEFAULT_ORG);
}

function collectingLogger() {
  const info: string[] = [];
  const warn: string[] = [];
  const error: string[] = [];
  return {
    info,
    warn,
    error,
    logger: {
      info: (m: string) => info.push(m),
      warn: (m: string) => warn.push(m),
      error: (m: string) => error.push(m),
    },
  };
}

/**
 * A synthetic grant population — the one case whose subject is a row COUNT
 * larger than any fixture worth storing. Every row is ORGANIZATION-scoped,
 * which is the shape that fills the window in the first place, and the
 * generator serves `offset`/`limit` so the paging is exercised for real.
 */
function makeSyntheticQl(
  grantCount: number,
  organizations: any[] = [{ id: DEFAULT_ORG, slug: 'default' }],
) {
  const permissionSets: any[] = [];
  const inserted: any[] = [];
  /** The `where` of every read of the grant table, in order. */
  const grantReads: Record<string, unknown>[] = [];
  return {
    inserted,
    grantReads,
    async find(object: string, q: any) {
      const bound = (rows: any[]) =>
        typeof q?.limit === 'number' ? rows.slice(0, q.limit) : rows;
      const where = q?.where ?? {};
      if (object === 'sys_permission_set') {
        return bound(
          permissionSets.filter((r) =>
            Object.entries(where).every(([k, v]) => {
              // Refuse loudly rather than reading a combinator as a field
              // name — a matcher that answers `false` for `$or` reports a
              // row it never understood as absent.
              if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
              return r[k] === v;
            }),
          ),
        );
      }
      for (const k of Object.keys(where)) {
        if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
      }
      if (object === 'sys_user_permission_set') {
        grantReads.push(where);
        // Every synthetic row is another organization's, so the narrow leg
        // (the Default Organization's grants) legitimately answers with
        // nothing.
        if ('organization_id' in where && where.organization_id === DEFAULT_ORG) return [];
        if ('organization_id' in where) throw new Error(`fake driver: unexpected organization_id ${String(where.organization_id)}`);
        const offset = q?.offset ?? 0;
        const limit = q?.limit ?? 100;
        const out: any[] = [];
        for (let i = offset; i < Math.min(offset + limit, grantCount); i++) {
          out.push({
            id: `ups_${String(i).padStart(6, '0')}`,
            user_id: `usr_${String(i).padStart(6, '0')}`,
            permission_set: 'admin_full_access',
            organization_id: `org_${i}`,
          });
        }
        return out;
      }
      if (object === 'sys_user') {
        if (Object.keys(where).length > 0) return [];
        const offset = q?.offset ?? 0;
        return offset === 0
          ? [{ id: 'usr_promotable', email: 'p@demo.example', created_at: '2026-01-01T00:00:00.000Z' }]
          : [];
      }
      if (object === 'sys_account') return [{ id: 'acc_p', user_id: 'usr_promotable' }];
      // [ADR-0131 D5] The Default Organization, which owns the promotion's grant.
      if (object === 'sys_organization') {
        return bound(
          organizations.filter((r) =>
            Object.entries(where).every(([k, v]) => {
              if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
              return r[k] === v;
            }),
          ),
        );
      }
      return [];
    },
    async insert(object: string, data: any) {
      if (object === 'sys_permission_set') permissionSets.push({ ...data });
      inserted.push({ object, data });
      return { id: data.id };
    },
    async update(_object: string, data: any, options?: any) {
      assertEngineUpdateDispatch(data, options);
      return 0;
    },
  };
}

describe('#16861 — an existing platform admin is found, not sampled for', () => {
  // ─────────────────────────────────────────────────────────────────────────
  // ANTI-VACUITY: the truncated window really is driver-shaped
  // ─────────────────────────────────────────────────────────────────────────

  it('ANTI-VACUITY: the old unordered 50-row read really does hide the anchoring grant', async () => {
    // Without this the 60-row case could be green because the fixture happens
    // to be shaped some other way, rather than because the guard was repaired.
    const engine = await boot();
    await seedTenant(engine as any, 60);

    const all = await findRows(engine, 'sys_user_permission_set', { permission_set: 'admin_full_access' });
    expect(all).toHaveLength(61);

    // The exact read the defect shipped: same object, the same population (every
    // grant of the admin set, read by name now that the id is retired), same cap, no order.
    const window50 = await (engine as any).find(
      'sys_user_permission_set',
      { where: { permission_set: 'admin_full_access' }, limit: 50 },
      { context: SYSTEM_CTX },
    );
    expect(window50).toHaveLength(50);
    expect(window50.some((r: any) => r.id === 'ups_zzz_founder')).toBe(false);
    // …and every row it DID return fails the predicate that decides.
    expect(window50.every((r: any) => !!r.organization_id && r.organization_id !== DEFAULT_ORG)).toBe(true);
    // The row that decides exists all the same.
    expect((await anchorGrants(engine)).map((r) => r.id)).toEqual(['ups_zzz_founder']);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 1. The card's cell: 60 org grants FAILS on the base, and its 10-row CONTROL
  // ─────────────────────────────────────────────────────────────────────────

  describe("the card's cell — the answer must not be a function of the org-admin count", () => {
    for (const [label, orgGrants] of [
      ['60 organization-scoped grants (61 rows — over the old cap)', 60],
      ['CONTROL: 9 organization-scoped grants (10 rows — under the old cap)', 9],
    ] as const) {
      for (const order of NATURAL_ORDERS) {
        it(`${label}, natural order ${order} ⇒ already_have_admin`, async () => {
          const engine = await boot();
          const ql = withNaturalOrder(engine, order);
          await seedTenant(ql, orgGrants);

          const { info, logger } = collectingLogger();
          const report = await bootstrapPlatformAdmin(ql, defaultPermissionSets, { logger });

          expect(report.adminPromoted).toBe(false);
          expect(report.reason).toBe('already_have_admin');
          // ⭐ The harm, stated as the card states it: no SECOND anchoring grant.
          expect((await anchorGrants(engine)).map((r) => r.id)).toEqual(['ups_zzz_founder']);
          // …and nothing was re-owned, because nothing was promoted.
          expect(info.join('\n')).not.toContain('promoted to platform admin');
        });
      }
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 2. An organization-less row is never a holder, in either stored shape
  // ─────────────────────────────────────────────────────────────────────────

  for (const [shape, organizationLess] of [['null', null], ["''", '']] as const) {
    it(`an organization-less grant (organization_id ${shape}) is never a holder — the promotion proceeds`, async () => {
      // What this proves: the scan reads the founder's row and REFUSES it — leg
      // B examines every one of the 61 rows, the organization-less one among
      // them — and the deployment is promoted exactly as one with no grant at
      // all would be. ⛔ An organization-less `admin_full_access` row anchors
      // nothing (ADR-0131 D5/D10): the 18.0 ceremony attributes it to an
      // organization before an upgraded database boots. The CONTROL is the
      // card's cell above — the same fixture with the founder's grant owned by
      // the Default Organization answers `already_have_admin`.
      const engine = await boot();
      const ql = withNaturalOrder(engine, 'AS_RETURNED');
      await seedTenant(ql, 60, organizationLess);

      const { logger } = collectingLogger();
      const report = await bootstrapPlatformAdmin(ql, defaultPermissionSets, { logger });

      expect(report.adminGrantRowsExamined).toBe(61);
      expect(report.adminPromoted).toBe(true);
      // The age rule answers, as on a fresh install: the oldest authenticable
      // human, who is not the founder (the fixture's seconds wrap at 60, so
      // that is `usr_orgadmin_060`, created at second :00).
      expect(report.adminUserId).toBe('usr_orgadmin_060');
      expect((await anchorGrants(engine)).map((r) => r.user_id)).toEqual(['usr_orgadmin_060']);
      // The organization-less row itself is left exactly as it was.
      const [legacy] = await findRows(engine, 'sys_user_permission_set', { id: 'ups_zzz_founder' });
      expect(legacy?.organization_id).toBe(organizationLess);
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 3. The guard says how many rows it examined
  // ─────────────────────────────────────────────────────────────────────────

  it('reports the number of grant rows examined, on the answer as well as in the log', async () => {
    const engine = await boot();
    const ql = withNaturalOrder(engine, 'AS_RETURNED');
    await seedTenant(ql, 60);

    const { logger } = collectingLogger();
    const report = await bootstrapPlatformAdmin(ql, defaultPermissionSets, { logger });

    expect(report.reason).toBe('already_have_admin');
    // The narrow leg answers this fixture on its own, so the number is the
    // anchoring population — not "up to 50, whichever the driver produced first".
    expect(report.adminGrantRowsExamined).toBe(1);
  });

  it('a fresh install examines nothing and still promotes', async () => {
    const engine = await boot();
    const ql = withNaturalOrder(engine, 'AS_RETURNED');
    await seedUser(ql, 'usr_first', 'first@tenant.example', '2026-02-01T00:00:00.000Z', true);

    const { logger } = collectingLogger();
    const report = await bootstrapPlatformAdmin(ql, defaultPermissionSets, { logger });

    expect(report.adminPromoted).toBe(true);
    expect(report.adminGrantRowsExamined).toBe(0);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 4. The system row still never counts — the fix did not over-tighten
  // ─────────────────────────────────────────────────────────────────────────

  it('an anchoring grant held by usr_system does NOT block promotion', async () => {
    // Self-healing on restart: a DB where the seed identity was wrongly
    // promoted must not block every real admin forever. The scan sees the row
    // and the predicate still refuses it.
    const engine = await boot();
    const ql = withNaturalOrder(engine, 'AS_RETURNED');
    await ql.insert(
      'sys_permission_set',
      { id: ADMIN_PS_ID, name: 'admin_full_access', label: 'Admin Full Access', managed_by: 'platform', active: true },
      { context: SYSTEM_CTX },
    );
    await ql.insert(
      'sys_user_permission_set',
      { id: 'ups_system', user_id: 'usr_system', permission_set: 'admin_full_access', organization_id: DEFAULT_ORG },
      { context: SYSTEM_CTX },
    );
    await seedUser(ql, 'usr_real', 'real@tenant.example', '2026-03-01T00:00:00.000Z', true);

    const { logger } = collectingLogger();
    const report = await bootstrapPlatformAdmin(ql, defaultPermissionSets, { logger });

    expect(report.adminPromoted).toBe(true);
    expect(report.adminGrantRowsExamined).toBe(1);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 5. The bound is real, and it is never silent
  // ─────────────────────────────────────────────────────────────────────────

  describe('the grant scan is bounded but never silent', () => {
    it('warns, naming the ceiling and the number examined, when the scan stops short', async () => {
      const ql = makeSyntheticQl(
        PLATFORM_ADMIN_GRANT_SCAN_CEILING + PLATFORM_ADMIN_GRANT_PAGE_SIZE,
      );
      const { warn, logger } = collectingLogger();

      const report = await bootstrapPlatformAdmin(ql as any, defaultPermissionSets, { logger });

      // The population is entirely org-scoped, so promoting IS the right answer
      // here — what must never happen is doing it silently.
      expect(report.adminPromoted).toBe(true);
      expect(report.adminGrantRowsExamined).toBe(PLATFORM_ADMIN_GRANT_SCAN_CEILING);
      const said = warn.join('\n');
      expect(said).toContain('stopped at its ceiling');
      expect(said).toContain(String(PLATFORM_ADMIN_GRANT_SCAN_CEILING));
      expect(said).toContain('were NOT examined');
      expect(said).toContain('SECOND platform-admin grant');
    });

    it('CONTROL: a population inside the ceiling produces no truncation warning', async () => {
      const ql = makeSyntheticQl(
        PLATFORM_ADMIN_GRANT_SCAN_CEILING - PLATFORM_ADMIN_GRANT_PAGE_SIZE,
      );
      const { warn, logger } = collectingLogger();

      const report = await bootstrapPlatformAdmin(ql as any, defaultPermissionSets, { logger });

      expect(report.adminPromoted).toBe(true);
      expect(report.adminGrantRowsExamined).toBe(
        PLATFORM_ADMIN_GRANT_SCAN_CEILING - PLATFORM_ADMIN_GRANT_PAGE_SIZE,
      );
      expect(warn.join('\n')).not.toContain('stopped at its ceiling');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 6. What leg A asks — and that nothing is asked when no owner can be named
  // ─────────────────────────────────────────────────────────────────────────

  describe('the scan asks the Default Organization, once — and nothing when none can be named', () => {
    it("leg A is ONE read, for the Default Organization's grants of the set; no organization-less read is made", async () => {
      const ql = makeSyntheticQl(10);
      const report = await bootstrapPlatformAdmin(ql as any, defaultPermissionSets, { logger: collectingLogger().logger });

      // Everyone is another organization's grant: the scan saw all ten and promoted.
      expect(report.adminPromoted).toBe(true);
      expect(report.adminGrantRowsExamined).toBe(10);
      const narrow = ql.grantReads.filter((where) => 'organization_id' in where);
      expect(narrow).toEqual([{ permission_set: 'admin_full_access', organization_id: DEFAULT_ORG }]);
      // …and it is the first question asked; leg B's pages follow it.
      expect(ql.grantReads[0]).toEqual({ permission_set: 'admin_full_access', organization_id: DEFAULT_ORG });
      expect(ql.grantReads.length).toBeGreaterThan(1);
    });

    it('no nameable Default Organization (several organizations, none `default`) ⇒ zero grant reads, nobody found', async () => {
      const ql = makeSyntheticQl(10, [{ id: 'org_a', slug: 'a' }, { id: 'org_b', slug: 'b' }]);
      const report = await bootstrapPlatformAdmin(ql as any, defaultPermissionSets, { logger: collectingLogger().logger });

      expect(ql.grantReads).toEqual([]);
      expect(report.adminGrantRowsExamined).toBe(0);
      // Nobody found, and no grant is written without an owner.
      expect(report.adminPromoted).toBe(false);
      expect(report.reason).toBe('default_organization_unresolved');
      expect(ql.inserted.filter((i) => i.object === 'sys_user_permission_set')).toEqual([]);
    });

    describe('under a wall', () => {
      const OLD_POSTURE = process.env.OS_TENANCY_POSTURE;
      afterEach(() => {
        if (OLD_POSTURE === undefined) delete process.env.OS_TENANCY_POSTURE;
        else process.env.OS_TENANCY_POSTURE = OLD_POSTURE;
      });

      it('a walled posture ⇒ zero grant reads, whatever the Default Organization', async () => {
        process.env.OS_TENANCY_POSTURE = 'isolated';
        // The Default Organization exists here — the wall alone is why nothing is asked.
        const ql = makeSyntheticQl(10);
        const report = await bootstrapPlatformAdmin(ql as any, defaultPermissionSets, { logger: collectingLogger().logger });

        expect(ql.grantReads).toEqual([]);
        expect(report.adminPromoted).toBe(false);
        expect(report.reason).toBe('walled_owner_email_undeclared');
        expect(ql.inserted.filter((i) => i.object === 'sys_user_permission_set')).toEqual([]);
      });
    });
  });
});
