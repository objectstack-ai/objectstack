// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The FIRST organization a walled store creates adopts no organization-less
 * row (ADR-0131 D9, D10).
 *
 * `claimOrphanOrgRows` used to run here: when the per-org seed replay landed
 * nothing and the store held exactly one organization, it wrote that
 * organization's id onto every `organization_id IS NULL` row of every
 * application object. Being created first names no owner. Under a wall --
 * the only posture that mounts this plugin -- the organization-ownership
 * ceremony reports such a row, leaves it NULL and holds it against
 * certification ("the ceremony never guesses an owner"); the claim then gave
 * the same row to whichever organization happened to exist. The claim is
 * retired, and this suite holds the outcome rather than the mechanism: the
 * rows stay NULL, because the ceremony, not this plugin, owns them.
 *
 * The other two things the plugin does on organization creation are held
 * beside it, unchanged: the per-org seed replay still lands the app's seed rows
 * in the new organization, and the seed ownership claim still re-owns exactly
 * the rows that replay reported.
 *
 * ── Why this can fail ─────────────────────────────────────────────────────
 *
 * The NULL rows sit on objects the retired claim's filter selected (not
 * `managedBy`, not `sys_`, declaring `organization_id`), the store holds no
 * organization before the insert, and the replay lands nothing in the
 * seedless case -- exactly the shape that reached the claim. Restoring it
 * turns the first two cases red.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OrganizationsPlugin } from './organizations-plugin.js';
import { claimOrgSeedOwnership } from './claim-org-seed-ownership.js';
// The fake engine opens `update()` with `assertEngineUpdateDispatch`
// (`pnpm check:engine-double-contract`): a double looser than the real
// `ObjectQLEngine.update` would let a write the engine refuses look landed.
import { assertEngineUpdateDispatch } from '@objectstack/metadata-core';

const FIRST_ORG = 'org_first';
const OWNER = 'usr_owner';
const APP_OBJECTS = ['crm_account', 'crm_task'] as const;

/** Field equality (NULL matching an absent column) plus `{ $in: [...] }`. */
function rowMatches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (k.startsWith('$')) throw new Error(`this double implements field predicates only; it cannot answer '${k}'`);
    const actual = row[k] ?? null;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      const ops = Object.keys(v);
      if (ops.length === 1 && ops[0] === '$in') return ((v as any).$in as unknown[]).includes(actual);
      throw new Error(`this double implements equality and $in only; it cannot answer ${JSON.stringify(ops)}`);
    }
    return actual === (v ?? null);
  });
}

/** An in-memory engine over a walled store that holds no organization yet. */
function makeStore() {
  const schemas = APP_OBJECTS.map((name) => ({
    name,
    fields: {
      id: { name: 'id' },
      organization_id: { name: 'organization_id' },
      owner_id: { name: 'owner_id' },
      name: { name: 'name' },
    },
  }));
  const rows: Record<string, Record<string, unknown>[]> = { sys_organization: [] };
  for (const name of APP_OBJECTS) rows[name] = [];

  const ql: any = {
    registry: { getAllObjects: () => schemas },
    registerMiddleware: (_mw: unknown) => undefined,
    getSchema: (name: string) => schemas.find((s) => s.name === name),
    find: vi.fn(async (object: string, query: any = {}) => {
      const hits = (rows[object] ?? []).filter((r) => rowMatches(r, query?.where ?? {}));
      return typeof query?.limit === 'number' ? hits.slice(0, query.limit) : hits;
    }),
    insert: vi.fn(async (object: string, data: Record<string, unknown>) => {
      (rows[object] ??= []).push({ ...data });
      return data;
    }),
    update: vi.fn(async (object: string, data: any, options?: any) => {
      const dispatch = assertEngineUpdateDispatch(data, options);
      const matched = (rows[object] ?? []).filter((r) =>
        dispatch.kind === 'by-id' ? r.id === dispatch.id : rowMatches(r, options?.where ?? {}),
      );
      const { id: _id, ...patch } = data;
      for (const row of matched) Object.assign(row, patch);
      return dispatch.kind === 'by-id' ? matched[0] : matched.length;
    }),
  };

  /** Rows an organization-less write left behind: the population under test. */
  const nullRows = () =>
    APP_OBJECTS.flatMap((o) => rows[o].filter((r) => (r.organization_id ?? null) === null).map((r) => `${o}:${r.id}`));
  return { ql, rows, nullRows };
}

/** Drive the real plugin's Middleware B for the store's first `sys_organization` insert. */
async function createFirstOrganization(ql: any, extraServices: Record<string, unknown> = {}) {
  const plugin = new OrganizationsPlugin();
  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: ql,
    metadata: { get: async () => undefined },
    ...extraServices,
  };
  const middlewares: any[] = [];
  ql.registerMiddleware = (mw: unknown) => middlewares.push(mw);
  const logger = { info: vi.fn(), warn: vi.fn() };
  const ctx: any = {
    logger,
    // Park `kernel:ready` so the default-org bootstrap never fires: it would
    // race the row assertions with writes unrelated to organization creation.
    hook: vi.fn(),
    registerService: (name: string, svc: unknown) => {
      services[name] = svc;
    },
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  await plugin.init(ctx);
  await plugin.start(ctx);

  await ql.insert('sys_organization', { id: FIRST_ORG, name: 'First' });
  // middlewares[0] = organization_id auto-stamp, middlewares[1] = seed pipeline.
  await middlewares[1](
    {
      object: 'sys_organization',
      operation: 'insert',
      data: { id: FIRST_ORG, name: 'First' },
      result: { id: FIRST_ORG },
      context: { isSystem: true },
    },
    async () => {},
  );
  return { logger };
}

describe('the first organization adopts no organization-less row (ADR-0131 D9, D10)', () => {
  let store: ReturnType<typeof makeStore>;

  beforeEach(async () => {
    store = makeStore();
    // Organization-less application rows, written before any organization
    // existed -- the shape the ceremony refuses to attribute under a wall.
    await store.ql.insert('crm_account', { id: 'acc_orphan', name: 'Orphan account' });
    await store.ql.insert('crm_task', { id: 'task_orphan_1', organization_id: null, name: 'Orphan task' });
    await store.ql.insert('crm_task', { id: 'task_orphan_2', organization_id: null, name: 'Orphan task' });
    store.ql.update.mockClear();
  });

  it('CONTROL: the store holds no organization and three organization-less rows the probe sees', () => {
    expect(store.rows.sys_organization).toEqual([]);
    expect(store.nullRows()).toEqual(['crm_account:acc_orphan', 'crm_task:task_orphan_1', 'crm_task:task_orphan_2']);
  });

  it('with no seed replay, creating the first organization leaves every organization-less row NULL', async () => {
    await createFirstOrganization(store.ql);

    expect(store.rows.sys_organization).toHaveLength(1);
    expect(store.nullRows()).toEqual(['crm_account:acc_orphan', 'crm_task:task_orphan_1', 'crm_task:task_orphan_2']);
    expect(store.ql.update).not.toHaveBeenCalled();
  });

  it('with a seed replay, the first organization gets the app\'s seed rows and the organization-less rows stay NULL', async () => {
    const replayer = vi.fn(async (organizationId: string) => {
      await store.ql.insert('crm_account', { id: `acc_seed_${organizationId}`, organization_id: organizationId, name: 'Acme' });
      return { inserted: 1, updated: 0, skipped: 0, errors: [] };
    });
    const { logger } = await createFirstOrganization(store.ql, {
      'seed-datasets': [{ object: 'crm_account', records: [{ name: 'Acme' }] }],
      'seed-replayer': replayer,
    });

    // The per-org seed replay is unchanged: it ran once, for the new organization.
    expect(replayer).toHaveBeenCalledTimes(1);
    expect(replayer).toHaveBeenCalledWith(FIRST_ORG);
    expect(store.rows.crm_account.filter((r) => r.organization_id === FIRST_ORG).map((r) => r.id)).toEqual([
      `acc_seed_${FIRST_ORG}`,
    ]);
    expect(
      (logger.info as any).mock.calls.some((c: unknown[]) => String(c[0]).includes(`per-org seed replay for ${FIRST_ORG}`)),
    ).toBe(true);

    expect(store.nullRows()).toEqual(['crm_account:acc_orphan', 'crm_task:task_orphan_1', 'crm_task:task_orphan_2']);
    expect(store.ql.update).not.toHaveBeenCalled();
  });

  it('the seed ownership claim still re-owns exactly the rows the replay reported, and no organization-less row', async () => {
    await store.ql.insert('crm_account', { id: 'acc_seeded', organization_id: FIRST_ORG, name: 'Acme' });
    await store.ql.insert('crm_account', { id: 'acc_guest', organization_id: FIRST_ORG, name: 'Guest intake' });

    const result = await claimOrgSeedOwnership(store.ql, FIRST_ORG, OWNER, {
      seededRecordIds: (object) => (object === 'crm_account' ? ['acc_seeded'] : []),
    });

    expect(result).toEqual([{ object: 'crm_account', count: 1 }]);
    const byId = Object.fromEntries(store.rows.crm_account.map((r) => [r.id, r]));
    expect(byId.acc_seeded.owner_id).toBe(OWNER);
    expect(byId.acc_guest.owner_id).toBeUndefined();
    expect(store.nullRows()).toEqual(['crm_account:acc_orphan', 'crm_task:task_orphan_1', 'crm_task:task_orphan_2']);
    for (const r of store.rows.crm_task) expect(r.owner_id).toBeUndefined();
  });
});
