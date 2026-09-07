// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * cloud#1345 — THE INVARIANT: a newly created organization's rows come from
 * the APP's own seed definitions, or the organization starts EMPTY. They never
 * come from another organization's data.
 *
 * What this replaces. `clone-org-seed-data-posture-gate.test.ts` (cloud#1006)
 * pinned the behaviour of `cloneOrgSeedData` — a "Fallback B" that copied the
 * FIRST organization's business rows into every subsequent one, gated OFF under
 * the `group` posture and ON under `isolated`. That whole mechanism is retired
 * here, so its suite goes with it rather than being re-spelled: its subject no
 * longer exists. The maintainer's ruling (2026-08-16) denies the requirement,
 * not merely the default:
 *
 *   「每个新组织注册时克隆第一个组织的全部业务行，没有这个需求啊，
 *     比如 hotcrm seed 数据应该从代码中加载。」
 *
 * What this suite pins instead is the DISCLOSURE SHAPE, permanently: two
 * organizations, one database, and org #2 holding zero rows traceable to org
 * #1. That assertion outlives any particular mechanism — it reddens whether a
 * future clone comes back as a donor pattern, a template-org pattern, or an
 * accident in the seed pipeline.
 *
 * ── The sentinel (why this test can fail) ─────────────────────────────────
 *
 * "org #2 has no rows from org #1" is worthless if the probe could not have
 * seen them anyway. So org #1 writes a distinctive row AFTER its seed
 * (`SENTINEL_NAME`), and every assertion below is preceded by proving the very
 * same probe DOES surface that row when pointed at org #1. Only then is its
 * absence from org #2 evidence of anything.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OrganizationsPlugin } from './organizations-plugin.js';
// The fake engines below open `update()` with `assertEngineUpdateDispatch`
// (`pnpm check:engine-double-contract`). A double looser than the real
// `ObjectQLEngine.update` is how a dead write path ships with its suite green;
// one call pins these fakes to the producer's rejection surface and, unlike a
// mirrored `if`, cannot drift when that rule changes.
import { assertEngineUpdateDispatch } from '@objectstack/metadata-core';

// ⛔ No entitlement grant, and none is needed: the open package has no licence
// gate (ADR-0132 boundary 3). The closed runtime's copy of this suite granted
// one because its constructor refused without it (cloud#1020). The subject
// here is unchanged — the seed pipeline and its no-donor-clone invariant.

const ORG_ONE = 'org_customer_one';
const ORG_TWO = 'org_customer_two';

/** Org #1's post-seed private row. Absent from any app seed definition. */
const SENTINEL_NAME = 'CUSTOMER-ONE-PRIVATE-a3f19c7d';

/** What the app's own seed definitions produce, per organization. */
const SEEDED_ACCOUNT_NAME = 'Acme Corporation';

const BUSINESS_OBJECTS = ['crm_account', 'crm_opportunity'] as const;

/**
 * A minimal in-memory ObjectQL stand-in: a registry of user-defined objects
 * that declare `organization_id`, plus find/insert/update over a row store.
 * Enough to observe exactly what the org-creation pipeline WROTE — which is
 * the whole point of "assert org #2 holds nothing of org #1's".
 */
function makeFakeQl() {
  const schemas = BUSINESS_OBJECTS.map((name) => ({
    name,
    fields: {
      id: { name: 'id', type: 'text' },
      organization_id: { name: 'organization_id', type: 'text' },
      name: { name: 'name', type: 'text' },
      amount: { name: 'amount', type: 'number' },
    },
  }));

  const store: Record<string, Record<string, unknown>[]> = {
    sys_organization: [{ id: ORG_ONE, name: 'Customer One', created_at: '2026-01-01' }],
  };
  for (const name of BUSINESS_OBJECTS) store[name] = [];

  const ql: any = {
    registry: { getAllObjects: () => schemas },
    registerMiddleware: (_mw: any) => undefined,
    getSchema: (name: string) => schemas.find((s) => s.name === name),
    find: vi.fn(async (object: string, query: any = {}) => {
      let rows = [...(store[object] ?? [])];
      const where = query?.where ?? {};
      for (const [k, v] of Object.entries(where)) rows = rows.filter((r) => r[k] === v);
      if (typeof query?.limit === 'number') rows = rows.slice(0, query.limit);
      return rows;
    }),
    insert: vi.fn(async (object: string, data: Record<string, unknown>) => {
      (store[object] ??= []).push({ ...data });
      return data;
    }),
    update: vi.fn(async (object: string, data: any, options?: any) => {
      assertEngineUpdateDispatch(data, options);
      const row = (store[object] ?? []).find((r) => r.id === data.id);
      if (row) Object.assign(row, data);
      return row;
    }),
  };

  /**
   * THE PROBE. Every row an object holds for one organization — the same
   * surface used for the sentinel proof and for the absence assertions, so a
   * probe that cannot see rows cannot silently pass the absence checks.
   */
  const rowsFor = (object: string, orgId: string) =>
    (store[object] ?? []).filter((r) => r.organization_id === orgId);

  /** Every row of every business object held by one organization. */
  const allRowsFor = (orgId: string): Record<string, unknown>[] =>
    BUSINESS_OBJECTS.flatMap((o) =>
      rowsFor(o, orgId).map((r): Record<string, unknown> => ({ ...r, object: o })),
    );

  return { ql, store, rowsFor, allRowsFor };
}

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn() };
}

/**
 * A stand-in for AppPlugin's registered `seed-replayer`: writes the APP's own
 * seed definitions into whichever organization is being seeded. Deliberately
 * ignorant of every other organization — that is the sanctioned mechanism's
 * defining property, and what makes it donor-less.
 */
function makeAppSeedReplayer(ql: any) {
  return vi.fn(async (organizationId: string) => {
    await ql.insert('crm_account', {
      id: `acc_${organizationId}`,
      organization_id: organizationId,
      name: SEEDED_ACCOUNT_NAME,
      amount: 0,
    });
    return { inserted: 1, updated: 0, skipped: 0, errors: [] as unknown[] };
  });
}

/**
 * Drive the REAL plugin's Middleware B (the per-org seed pipeline) for a
 * `sys_organization` insert — the exact seam org creation runs through.
 *
 * `services` decides which deployment shape is under test: register
 * `seed-datasets` + `seed-replayer` for an app that ships seed definitions,
 * register neither for one that does not (the shape where the retired clone
 * used to fire).
 */
async function createOrganizationThroughPipeline(
  ql: any,
  newOrgId: string,
  logger: { info: any; warn: any },
  extraServices: Record<string, any> = {},
) {
  const plugin = new OrganizationsPlugin();
  const services: Record<string, any> = {
    manifest: { register: vi.fn() },
    objectql: ql,
    metadata: { get: async () => undefined },
    ...extraServices,
  };
  const middlewares: any[] = [];
  ql.registerMiddleware = (mw: any) => middlewares.push(mw);
  const ctx: any = {
    logger,
    // Park `kernel:ready` so the default-org bootstrap never fires: it is
    // fire-and-forget and would race the row assertions below with writes that
    // have nothing to do with the seed pipeline.
    hook: vi.fn(),
    registerService: (name: string, svc: any) => {
      services[name] = svc;
    },
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  await plugin.init(ctx);
  await plugin.start(ctx);

  // The org row itself, then the pipeline that fires off its insert.
  await ql.insert('sys_organization', { id: newOrgId, name: newOrgId, created_at: '2026-02-01' });
  // middlewares[0] = organization_id auto-stamp, middlewares[1] = seed pipeline.
  await middlewares[1](
    {
      object: 'sys_organization',
      operation: 'insert',
      data: { id: newOrgId, name: newOrgId },
      result: { id: newOrgId },
      context: { isSystem: true },
    },
    async () => {},
  );
}

describe('cloud#1345 — a new organization never receives another organization\'s rows', () => {
  let fake: ReturnType<typeof makeFakeQl>;
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(async () => {
    fake = makeFakeQl();
    logger = makeLogger();

    // Customer #1 is live: seeded demo rows PLUS the private row they created
    // afterwards. Both are attributed to org #1, exactly as the wall requires.
    await fake.ql.insert('crm_account', {
      id: 'acc_one_seeded',
      organization_id: ORG_ONE,
      name: SEEDED_ACCOUNT_NAME,
      amount: 0,
    });
    await fake.ql.insert('crm_account', {
      id: 'acc_one_private',
      organization_id: ORG_ONE,
      name: SENTINEL_NAME,
      amount: 4_200,
    });
    await fake.ql.insert('crm_opportunity', {
      id: 'opp_one_private',
      organization_id: ORG_ONE,
      name: SENTINEL_NAME,
      amount: 99_000,
    });
  });

  it('SENTINEL CONTROL: the probe DOES surface org #1\'s post-seed rows when pointed at org #1', () => {
    // Without this, every absence assertion below would pass on a probe that
    // sees nothing at all. Both objects, so the multi-object sweeps are covered.
    const accounts = fake.rowsFor('crm_account', ORG_ONE);
    const opportunities = fake.rowsFor('crm_opportunity', ORG_ONE);
    expect(accounts.map((r) => r.name)).toContain(SENTINEL_NAME);
    expect(opportunities.map((r) => r.name)).toContain(SENTINEL_NAME);
    expect(fake.allRowsFor(ORG_ONE).filter((r) => r.name === SENTINEL_NAME)).toHaveLength(2);
  });

  it('with NO app seed datasets, org #2 is created EMPTY — not populated from org #1', async () => {
    // The exact shape the retired `cloneOrgSeedData` fired on: a second
    // organization, no replayer registered. It used to copy every one of org
    // #1's rows — the seeded ones AND the private ones — into org #2.
    await createOrganizationThroughPipeline(fake.ql, ORG_TWO, logger);

    // Sentinel re-proof at the moment of assertion: org #1 still holds the rows
    // the probe is being asked to look for.
    expect(fake.allRowsFor(ORG_ONE).map((r) => r.name)).toContain(SENTINEL_NAME);

    expect(fake.allRowsFor(ORG_TWO)).toEqual([]);
    for (const object of BUSINESS_OBJECTS) {
      expect(fake.rowsFor(object, ORG_TWO), `${object} rows in org #2`).toHaveLength(0);
    }
  });

  it('with app seed datasets, org #2 holds exactly the APP\'s seed rows and nothing traceable to org #1', async () => {
    const replayer = makeAppSeedReplayer(fake.ql);
    await createOrganizationThroughPipeline(fake.ql, ORG_TWO, logger, {
      'seed-datasets': [{ object: 'crm_account', records: [{ name: SEEDED_ACCOUNT_NAME }] }],
      'seed-replayer': replayer,
    });

    expect(replayer).toHaveBeenCalledWith(ORG_TWO);
    expect(fake.allRowsFor(ORG_ONE).map((r) => r.name)).toContain(SENTINEL_NAME);

    // Org #2's rows come from the app's seed definitions: same natural key,
    // its own physical row.
    const twoAccounts = fake.rowsFor('crm_account', ORG_TWO);
    expect(twoAccounts.map((r) => r.name)).toEqual([SEEDED_ACCOUNT_NAME]);
    const oneIds = new Set(fake.allRowsFor(ORG_ONE).map((r) => String(r.id)));
    for (const row of fake.allRowsFor(ORG_TWO)) {
      expect(oneIds.has(String(row.id)), `row ${row.id} is org #1's physical row`).toBe(false);
    }

    // And NOTHING of org #1's post-seed private data.
    expect(fake.allRowsFor(ORG_TWO).map((r) => r.name)).not.toContain(SENTINEL_NAME);
    // Row COUNT is part of the invariant too: the retired clone reproduced org
    // #1's row count, so "one seeded account, no opportunities" is what
    // distinguishes an app-seeded org from a cloned one.
    expect(fake.rowsFor('crm_opportunity', ORG_TWO)).toHaveLength(0);
  });

  it('the pipeline reads NO rows out of any other organization while creating org #2', async () => {
    // The disclosure happens at READ time — a clone that is later hidden by the
    // wall has already crossed it. So this asserts on the queries themselves:
    // the pipeline may look at `sys_organization` (it counts orgs), but it must
    // never query a business object scoped to another organization.
    await createOrganizationThroughPipeline(fake.ql, ORG_TWO, logger);

    const businessReads = (fake.ql.find as any).mock.calls.filter(
      (c: any[]) => c[0] !== 'sys_organization',
    );
    for (const [object, query] of businessReads) {
      const where = (query ?? {}).where ?? {};
      expect(
        where.organization_id === undefined || where.organization_id === ORG_TWO,
        `${object} read scoped to ${String(where.organization_id)} while creating ${ORG_TWO}`,
      ).toBe(true);
    }
  });

  it('creating org #2 leaves org #1\'s own rows untouched', async () => {
    const before = fake.allRowsFor(ORG_ONE).length;
    await createOrganizationThroughPipeline(fake.ql, ORG_TWO, logger);
    expect(fake.allRowsFor(ORG_ONE)).toHaveLength(before);
    expect(fake.allRowsFor(ORG_ONE).map((r) => r.name)).toContain(SENTINEL_NAME);
  });
});
