// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #33207 + #33206 — an organization-scoped seed load resolves people through
 * membership, and every seed write carries the organization its rows are
 * stamped with.
 *
 * ## The two defects, as measured on `main`
 *
 * 1. On a per-organization replay the reference probe AND-scoped EVERY target
 *    with `organization_id = <load org>`, `sys_user` included. `sys_user`
 *    carries no organization column, so the driver refused the filter
 *    (`INVALID_FILTER`), a bare `catch` read the refusal as "no match", and a
 *    seed record naming a person who exists — and is a member — landed owned
 *    by nobody, reported as "no such sys_user row exists".
 * 2. Every seed write ran under `SEED_WRITE_EXECUTION_CONTEXT`, which carries
 *    no organization, although the loader stamps each row with one. A hook on
 *    a seeded row saw `ctx.session` without `organizationId`, so a system hook
 *    that scopes its reads to the writer's organization derived nothing.
 *
 * ## Why this file runs real implementations
 *
 * The refusal is the SQL driver's (`sys_user` has no such column) and the
 * hook's view is built by the engine from the write's execution context, so an
 * engine double would encode the facts under test. This file boots the REAL
 * `AppPlugin` (its per-organization `seed-replayer` on a walled boot, its inline
 * seed on a `single` boot), the real `SeedLoaderService`, a real `ObjectQL` and
 * a real `SqlDriver` over better-sqlite3, the way
 * `seed-replay-per-organization-identity.integration.test.ts` does, and asserts
 * on stored rows and on what a registered hook received.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
// AppPlugin loads `@objectstack/metadata` lazily; pay that load during collection,
// never inside a clocked case.
import '@objectstack/metadata';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SysUser, SysMember, SysOrganization } from '@objectstack/platform-objects/identity';
import type { PluginContext } from '@objectstack/core';
import type { EngineQueryOptions } from '@objectstack/spec/data';
import { AppPlugin } from './app-plugin';
import { SeedLoaderService } from './seed-loader';

/** better-auth-shaped organization ids — the shape every real organization has. */
const ORG_NORTH = 'org_msnorthd2a7k3x9qf';
const ORG_SOUTH = 'org_mssouthd2p4w8m2zc';

/** An app object that names people and an account, the shape of a CRM deal. */
const Deal = {
  name: 'crm_deal',
  label: 'Deal',
  fields: {
    name: { type: 'text', label: 'Name' },
    rep: { type: 'lookup', label: 'Rep', reference: 'sys_user' },
    account: { type: 'lookup', label: 'Account', reference: 'crm_account' },
    country: { type: 'lookup', label: 'Country', reference: 'crm_country' },
    home_org: { type: 'lookup', label: 'Home organization', reference: 'sys_organization' },
    ledger_kind: { type: 'lookup', label: 'Ledger kind', reference: 'crm_ledger_kind' },
    tag: { type: 'lookup', label: 'Tag', reference: 'crm_workspace_tag' },
  },
};
/** A tenant-carrying app object: its rows belong to one organization each. */
const Account = { name: 'crm_account', label: 'Account', fields: { name: { type: 'text', label: 'Name' } } };
/** A global catalog by its author's declaration: no organization column. */
const Country = {
  name: 'crm_country',
  label: 'Country',
  tenancy: { enabled: false },
  fields: { name: { type: 'text', label: 'Name' } },
};
/** A platform-managed table with no organization column — not a seed target. */
const LedgerKind = {
  name: 'crm_ledger_kind',
  label: 'Ledger kind',
  managedBy: 'engine-owned',
  systemFields: { tenant: false },
  fields: { name: { type: 'text', label: 'Name' } },
};

/**
 * An author's object with no `organization_id` column that is STILL walled per
 * organization, by another tenant column: not a global object.
 */
const WorkspaceTag = {
  name: 'crm_workspace_tag',
  label: 'Workspace tag',
  tenancy: { enabled: true, tenantField: 'workspace_id' },
  systemFields: { tenant: false },
  fields: { name: { type: 'text', label: 'Name' }, workspace_id: { type: 'text', label: 'Workspace' } },
};
/** A self-referencing tenant-carrying object: a forward reference to it defers to pass 2. */
const Task = {
  name: 'crm_task',
  label: 'Task',
  fields: { name: { type: 'text', label: 'Name' }, parent: { type: 'lookup', label: 'Parent', reference: 'crm_task' } },
};

const OBJECTS = [SysUser, SysMember, SysOrganization, Deal, Account, Country, LedgerKind, WorkspaceTag, Task] as const;

type Row = Record<string, unknown> & { id: string; name: string };
type Replayer = (organizationId: string, options?: { reseed?: boolean }) => Promise<{
  inserted: number;
  errors: Array<{ message: string }>;
}>;

const openDrivers: SqlDriver[] = [];
const envBefore = { budget: process.env.OS_INLINE_SEED_BUDGET_MS, posture: process.env.OS_TENANCY_POSTURE };

afterEach(async () => {
  while (openDrivers.length) {
    try {
      await openDrivers.pop()?.disconnect();
    } catch {
      /* a test that already disconnected is not a failure */
    }
  }
  for (const [key, name] of [['budget', 'OS_INLINE_SEED_BUDGET_MS'], ['posture', 'OS_TENANCY_POSTURE']] as const) {
    if (envBefore[key] === undefined) delete process.env[name];
    else process.env[name] = envBefore[key];
  }
});

interface BootOptions {
  /** `isolated` boots walled (AppPlugin registers the replayer); `single` seeds inline. */
  readonly posture: 'isolated' | 'single';
  /** The seed the app declares. */
  readonly data: ReadonlyArray<Record<string, unknown>>;
  /**
   * Register `sys_organization` (and create the organizations). Default true.
   * Without it the load has no organization at all, so the deal object is
   * registered as a global one (its rows carry none either).
   */
  readonly organizations?: boolean;
}

async function boot(options: BootOptions) {
  process.env.OS_INLINE_SEED_BUDGET_MS = '60000';
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  openDrivers.push(driver);
  const engine = new ObjectQL();
  engine.registerDriver(driver as any, true);
  await engine.init();
  const objects = OBJECTS.filter((o) => options.organizations !== false || o !== SysOrganization)
    .map((o) => (options.organizations === false && o === Deal ? { ...Deal, tenancy: { enabled: false } } : o));
  for (const o of objects) engine.registry.registerObject(o as any, '@objectstack/platform-objects');
  const definitions = objects.map((o) => engine.registry.getObject((o as { name: string }).name) ?? o);
  await driver.initObjects(definitions as any);

  const sys = { context: { isSystem: true } } as any;
  if (options.organizations !== false) {
    await engine.insert('sys_organization', { id: ORG_NORTH, name: 'North', slug: 'north' }, sys);
    if (options.posture === 'isolated') await engine.insert('sys_organization', { id: ORG_SOUTH, name: 'South', slug: 'south' }, sys);
  }
  // People. Zhang Wei is a member of North only. Two people are named Wang
  // Fang, one per organization; the South one exists FIRST, so a probe that
  // ignored membership would hand North the South person.
  await engine.insert('sys_user', { id: 'usr_wang_south', name: 'Wang Fang', email: 'wang.s@example.com' }, sys);
  await engine.insert('sys_user', { id: 'usr_wang_north', name: 'Wang Fang', email: 'wang.n@example.com' }, sys);
  await engine.insert('sys_user', { id: 'usr_zhang', name: 'Zhang Wei', email: 'zhang@example.com' }, sys);
  if (options.organizations !== false) {
    await engine.insert('sys_member', { id: 'mem_zhang_n', user_id: 'usr_zhang', organization_id: ORG_NORTH, role: 'member' }, sys);
    await engine.insert('sys_member', { id: 'mem_wang_n', user_id: 'usr_wang_north', organization_id: ORG_NORTH, role: 'member' }, sys);
    await engine.insert('sys_member', { id: 'mem_wang_s', user_id: 'usr_wang_south', organization_id: ORG_SOUTH, role: 'member' }, sys);
    // An account that exists only in South.
    await engine.insert('crm_account', { id: 'acc_globex_s', name: 'Globex', organization_id: ORG_SOUTH }, sys);
  }
  await engine.insert('crm_country', { id: 'cty_cn', name: 'China' }, sys);
  await engine.insert('crm_ledger_kind', { id: 'lk_std', name: 'Standard' }, sys);

  /** What every hook on a deal row received: the session and the row's organization. */
  const seen: Array<{ name: unknown; session: Record<string, unknown> | undefined; rowOrganization: unknown }> = [];
  engine.registerHook('afterInsert', async (hctx: any) => {
    seen.push({ name: hctx.input?.data?.name, session: hctx.session, rowOrganization: hctx.result?.organization_id });
  }, { object: 'crm_deal' });

  // The metadata service serves what the author wrote: an object that relies
  // on the injected `owner_id` / `organization_id` does not carry them here.
  // Only the engine's registry holds the enriched definition (`definitions`
  // above), so serving that from the stub would hide every defect of a loader
  // that reads the authored definition and forgets an injected column.
  const metadata = {
    getObject: vi.fn(async (name: string) => objects.find((d: any) => d.name === name)),
    listObjects: vi.fn(async () => objects),
    getObjects: vi.fn(async () => objects),
    get: vi.fn(async () => undefined),
    list: vi.fn(async () => []),
    exists: vi.fn(async () => false),
    listNames: vi.fn(async () => []),
    register: vi.fn(async () => {}),
    unregister: vi.fn(async () => {}),
  };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const services = new Map<string, unknown>();
  if (options.posture === 'isolated') services.set('tenancy', { posture: 'isolated' });
  const ctx = {
    logger,
    registerService: vi.fn((name: string, svc: unknown) => { services.set(name, svc); }),
    getService: vi.fn((name: string) => (name === 'objectql' ? engine : name === 'metadata' ? metadata : services.get(name))),
    getServices: vi.fn(() => services),
    hook: vi.fn(),
    trigger: vi.fn(),
  } as unknown as PluginContext;

  await new AppPlugin({ id: 'com.example.seed-org-scoped-references', data: [...options.data] as any }).start(ctx);

  const replayer = services.get('seed-replayer') as Replayer | undefined;
  const dealsOf = async (organizationId?: string): Promise<Row[]> =>
    (await engine.find('crm_deal', {
      where: organizationId ? { organization_id: organizationId } : {},
      context: { isSystem: true },
    } satisfies EngineQueryOptions)) as Row[];
  return { engine, metadata, logger, replayer, dealsOf, seen };
}

const deals = (records: Array<Record<string, unknown>>) => ({ object: 'crm_deal', mode: 'upsert', externalId: 'name', records });

describe('#33207 an organization-scoped load resolves a person through membership in that organization', () => {
  it('a member of the load organization is resolved, by every probe the person reference takes', async () => {
    const { replayer, dealsOf } = await boot({ posture: 'isolated', data: [deals([{ name: 'Deal 1', rep: 'Zhang Wei', owner_id: 'Zhang Wei' }])] });
    const north = await replayer!(ORG_NORTH);
    expect(north.errors).toEqual([]);
    const [row] = await dealsOf(ORG_NORTH);
    expect(row).toMatchObject({ rep: 'usr_zhang', owner_id: 'usr_zhang' });
  });

  it('a same-named person who is not a member of the load organization is NOT resolved — never borrowed', async () => {
    const { replayer, dealsOf } = await boot({ posture: 'isolated', data: [deals([{ name: 'Deal 1', rep: 'Wang Fang' }, { name: 'Deal 2', rep: 'Zhang Wei' }])] });

    await replayer!(ORG_NORTH);
    const south = await replayer!(ORG_SOUTH);

    // Two people are named Wang Fang; each organization gets its own member,
    // although the South one is the first row the name matches.
    const byName = (rows: Row[]) => Object.fromEntries(rows.map((r) => [r.name, r.rep ?? null]));
    expect(byName(await dealsOf(ORG_NORTH))).toEqual({ 'Deal 1': 'usr_wang_north', 'Deal 2': 'usr_zhang' });
    // Zhang Wei exists and is a member of North only: South does not get him.
    expect(byName(await dealsOf(ORG_SOUTH))).toEqual({ 'Deal 1': 'usr_wang_south', 'Deal 2': null });
    expect(south.errors).toHaveLength(1);
    expect(south.errors[0].message).toContain(`not a member of organization ${ORG_SOUTH}`);
  });

  it('a member among more same-named people than one read holds is found; "not a member" is said only after all were asked', async () => {
    const { engine, replayer, dealsOf } = await boot({ posture: 'isolated', data: [deals([{ name: 'Deal 1', rep: 'Li Na' }])] });
    const sys = { context: { isSystem: true } } as any;
    // Sixty people named Li Na; only the one with the highest id is a member of
    // North, so a probe that weighed a single page of candidates misses her.
    for (let n = 0; n < 60; n++) {
      await engine.insert('sys_user', { id: `usr_li_${String(n).padStart(2, '0')}`, name: 'Li Na', email: `li.${n}@example.com` }, sys);
    }
    await engine.insert('sys_member', { id: 'mem_li_n', user_id: 'usr_li_59', organization_id: ORG_NORTH, role: 'member' }, sys);

    const north = await replayer!(ORG_NORTH);
    const south = await replayer!(ORG_SOUTH);

    expect(north.errors).toEqual([]);
    expect((await dealsOf(ORG_NORTH))[0].rep).toBe('usr_li_59');
    expect((await dealsOf(ORG_SOUTH))[0].rep ?? null).toBeNull();
    expect(south.errors).toHaveLength(1);
    expect(south.errors[0].message).toContain(`not a member of organization ${ORG_SOUTH}`);
  });

  it('a refused probe is reported with its code, not swallowed as "not found"', async () => {
    const { replayer, logger } = await boot({ posture: 'isolated', data: [deals([{ name: 'Deal 1', ledger_kind: 'Standard' }])] });

    const north = await replayer!(ORG_NORTH);

    // The target is platform-managed and carries no organization column: the
    // organization filter is refused by the driver, and the reference says so.
    expect(north.errors).toHaveLength(1);
    expect(north.errors[0].message).toContain('INVALID_FILTER');
    const refusals = logger.warn.mock.calls.filter((c) => (c[1] as { code?: string } | undefined)?.code === 'INVALID_FILTER');
    expect(refusals.map((c) => (c[1] as { object: string }).object)).toContain('crm_ledger_kind');
    // Said once per target, field and code — not once per value and pass.
    const keys = refusals.map((c) => JSON.stringify(c[1]));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('a global catalog (no organization column, by its author) resolves on an organization-scoped load', async () => {
    const { replayer, dealsOf } = await boot({ posture: 'isolated', data: [deals([{ name: 'Deal 1', country: 'China' }])] });
    expect((await replayer!(ORG_NORTH)).errors).toEqual([]);
    expect((await dealsOf(ORG_NORTH))[0].country).toBe('cty_cn');
  });

  it('an object walled by another tenant column is not taken for a global one: another organization’s row is not borrowed', async () => {
    const { engine, replayer, dealsOf } = await boot({ posture: 'isolated', data: [deals([{ name: 'Deal 1', tag: 'Gold' }])] });
    await engine.insert('crm_workspace_tag', { id: 'tag_gold_s', name: 'Gold', workspace_id: ORG_SOUTH }, { context: { isSystem: true } } as any);

    const north = await replayer!(ORG_NORTH);

    expect((await dealsOf(ORG_NORTH))[0].tag ?? null).toBeNull();
    expect(north.errors).toHaveLength(1);
  });

  it('an object walled by another tenant column resolves within the load organization, on that column', async () => {
    const { engine, replayer, dealsOf, logger } = await boot({ posture: 'isolated', data: [deals([{ name: 'Deal 1', tag: 'Gold' }])] });
    const sys = { context: { isSystem: true } } as any;
    // South's Gold exists FIRST, so a probe that ignored the tenant column
    // would hand North the South row.
    await engine.insert('crm_workspace_tag', { id: 'tag_gold_s', name: 'Gold', workspace_id: ORG_SOUTH }, sys);
    await engine.insert('crm_workspace_tag', { id: 'tag_gold_n', name: 'Gold', workspace_id: ORG_NORTH }, sys);

    const north = await replayer!(ORG_NORTH);
    const south = await replayer!(ORG_SOUTH);

    expect(north.errors).toEqual([]);
    expect(south.errors).toEqual([]);
    expect((await dealsOf(ORG_NORTH))[0].tag).toBe('tag_gold_n');
    expect((await dealsOf(ORG_SOUTH))[0].tag).toBe('tag_gold_s');
    // The probe ran: no refusal was said for the tag table.
    const refused = logger.warn.mock.calls.filter((c) => (c[1] as { object?: string } | undefined)?.object === 'crm_workspace_tag');
    expect(refused).toEqual([]);
  });

  it('the organization table answers only for the load organization', async () => {
    const { replayer, dealsOf } = await boot({ posture: 'isolated', data: [deals([{ name: 'Mine', home_org: 'North' }, { name: 'Theirs', home_org: 'South' }])] });
    await replayer!(ORG_NORTH);
    const byName = Object.fromEntries((await dealsOf(ORG_NORTH)).map((r) => [r.name, r.home_org ?? null]));
    expect(byName).toEqual({ Mine: ORG_NORTH, Theirs: null });
  });

  it('CONTROL — a tenant-carrying target still gets the organization filter: another organization’s row is not borrowed', async () => {
    const { replayer, dealsOf } = await boot({ posture: 'isolated', data: [deals([{ name: 'Deal 1', account: 'Globex' }])] });
    const north = await replayer!(ORG_NORTH);
    await replayer!(ORG_SOUTH);
    expect((await dealsOf(ORG_NORTH))[0].account ?? null).toBeNull();
    expect(north.errors).toHaveLength(1);
    expect((await dealsOf(ORG_SOUTH))[0].account).toBe('acc_globex_s');
  });

  it('CONTROL — a load with no organization probes unscoped, as before: no membership is asked', async () => {
    // This composition holds no organization and no membership at all, so a
    // person resolves only if the probe is the unscoped one it always was.
    const { dealsOf, seen } = await boot({ posture: 'single', organizations: false, data: [deals([{ name: 'Deal 1', rep: 'Zhang Wei' }])] });
    const [row] = await dealsOf();
    expect(row.rep).toBe('usr_zhang');
    expect(seen).toHaveLength(1);
  });
});

describe('#33206 a seed write carries the organization its rows are stamped with', () => {
  it('a hook on a seeded row sees the load organization on a per-organization replay and on a reseed', async () => {
    const { engine, replayer, dealsOf, seen } = await boot({ posture: 'isolated', data: [deals([{ name: 'Deal 1' }])] });

    await replayer!(ORG_NORTH);
    await replayer!(ORG_SOUTH);
    // A reseed inserts a missing seed row again: remove South's, then reseed.
    await engine.delete('crm_deal', { where: { id: (await dealsOf(ORG_SOUTH))[0].id }, context: { isSystem: true } } as any);
    await replayer!(ORG_SOUTH, { reseed: true });

    expect(seen.map((s) => [s.session?.organizationId, s.rowOrganization])).toEqual([
      [ORG_NORTH, ORG_NORTH],
      [ORG_SOUTH, ORG_SOUTH],
      [ORG_SOUTH, ORG_SOUTH],
    ]);
    for (const s of seen) expect(s.session).toMatchObject({ isSystem: true, skipTriggers: true });
  });

  it('a hook on a seeded row sees the organization on a `single` boot, where the rows take the sole organization', async () => {
    const { seen } = await boot({ posture: 'single', data: [deals([{ name: 'Deal 1' }])] });
    expect(seen).toHaveLength(1);
    expect(seen[0].rowOrganization).toBe(ORG_NORTH);
    expect(seen[0].session?.organizationId).toBe(ORG_NORTH);
  });

  it('a direct load pinned to an organization (the install path) writes with it', async () => {
    const { engine, metadata, logger, seen } = await boot({ posture: 'isolated', data: [] });
    const loader = new SeedLoaderService(engine as any, metadata as any, logger as any);
    await loader.load({ seeds: [deals([{ name: 'Installed' }])], config: { multiPass: true, organizationId: ORG_SOUTH } } as any);
    expect(seen.map((s) => s.session?.organizationId)).toEqual([ORG_SOUTH]);
  });

  it('a row that supplies its own organization is written as that organization, its pass-2 back-fill included', async () => {
    process.env.OS_TENANCY_POSTURE = 'isolated';
    const { engine, metadata, logger, seen } = await boot({ posture: 'isolated', data: [] });
    // An id the loader keeps as written (UUID-shaped; an `org_` id names no
    // organization but the load's own on a pinned load, so it never lands).
    const ORG_EAST = '5f0c2d9e-7b1a-4c3e-9a8d-2e6f1b0c4a77';
    await engine.insert('sys_organization', { id: ORG_EAST, name: 'East', slug: 'east' }, { context: { isSystem: true } } as any);
    const loader = new SeedLoaderService(engine as any, metadata as any, logger as any);

    const result = await loader.load({
      seeds: [
        deals([{ name: 'Theirs', organization_id: ORG_EAST }]),
        // `Child` names `Parent` before it exists, so its link is back-filled in
        // pass 2 by id; the row lives in East, the load is pinned to North.
        { object: 'crm_task', mode: 'upsert', externalId: 'name', records: [{ name: 'Child', parent: 'Parent', organization_id: ORG_EAST }, { name: 'Parent' }] },
      ],
      config: { multiPass: true, organizationId: ORG_NORTH },
    } as any);

    expect(result.errors).toEqual([]);
    expect(seen.map((s) => [s.session?.organizationId, s.rowOrganization])).toEqual([[ORG_EAST, ORG_EAST]]);
    const tasks = (await engine.find('crm_task', { where: {}, context: { isSystem: true } } satisfies EngineQueryOptions)) as Row[];
    const byName = Object.fromEntries(tasks.map((t) => [t.name, t]));
    expect(byName.Child.organization_id).toBe(ORG_EAST);
    expect(byName.Child.parent).toBe(byName.Parent.id);
  });

  it('a pass-2 back-fill the write organization cannot see is reported as an error, never counted as resolved', async () => {
    process.env.OS_TENANCY_POSTURE = 'isolated';
    const { engine, metadata, logger } = await boot({ posture: 'isolated', data: [] });
    // By the time pass 2 writes its link, the source row has moved to another
    // organization: the by-id update, scoped to the organization the row was
    // written as, finds no row (ObjectQL answers it with a not-found refusal).
    engine.registerHook('afterInsert', async (hctx: any) => {
      if (hctx.input?.data?.name !== 'Parent') return;
      const [child] = (await engine.find('crm_task', { where: { name: 'Child' }, context: { isSystem: true } } satisfies EngineQueryOptions)) as Row[];
      await engine.update('crm_task', { id: child.id, organization_id: ORG_SOUTH }, { context: { isSystem: true } } as any);
    }, { object: 'crm_task' });
    const loader = new SeedLoaderService(engine as any, metadata as any, logger as any);

    const result = await loader.load({
      seeds: [{ object: 'crm_task', mode: 'upsert', externalId: 'name', records: [{ name: 'Child', parent: 'Parent' }, { name: 'Parent' }] }],
      config: { multiPass: true, organizationId: ORG_NORTH },
    } as any);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ sourceObject: 'crm_task', field: 'parent' });
    expect(result.errors[0].message).toContain('not found in crm_task');
  });

  it('CONTROL — a load with no organization, pinned or derived, writes with the seed posture unchanged', async () => {
    const { seen } = await boot({ posture: 'single', organizations: false, data: [deals([{ name: 'Deal 1' }])] });
    expect(seen).toHaveLength(1);
    expect(seen[0].session).toEqual({ isSystem: true, skipTriggers: true });
  });

  it.each(['isolated', 'group'] as const)('under the walled posture %s a hook reads through ctx.api within the load organization (the declared narrowing)', async (posture) => {
    process.env.OS_TENANCY_POSTURE = posture;
    const { engine, replayer } = await boot({ posture: 'isolated', data: [deals([{ name: 'Seeded' }])] });
    await engine.insert('crm_deal', { name: 'South deal', organization_id: ORG_SOUTH }, { context: { isSystem: true } } as any);
    const reads: string[][] = [];
    engine.registerHook('afterInsert', async (hctx: any) => {
      if (hctx.input?.data?.name !== 'Seeded') return;
      const rows = (await hctx.api.object('crm_deal').find({ where: {} })) as Row[];
      reads.push(rows.map((r) => r.name).sort());
    }, { object: 'crm_deal' });

    await replayer!(ORG_NORTH);

    expect(reads).toEqual([['Seeded']]);
  });
});

describe('#33280 the membership probe is bounded by the organization, and an id-shaped person is judged by membership', () => {
  /** Every read the load sends to `sys_user` / `sys_member`, with its options. */
  function recordPersonReads(engine: ObjectQL) {
    const reads: Array<{ object: string; options: EngineQueryOptions }> = [];
    const find = engine.find.bind(engine);
    vi.spyOn(engine, 'find').mockImplementation((async (object: string, options: EngineQueryOptions) => {
      if (object === 'sys_user' || object === 'sys_member') reads.push({ object, options });
      return find(object, options);
    }) as typeof engine.find);
    return reads;
  }

  /** Replay North then South with `strangers` same-named people outside both organizations. */
  async function replayWithStrangers(strangers: number) {
    const { engine, replayer, dealsOf } = await boot({ posture: 'isolated', data: [deals([{ name: 'Deal 1', rep: 'Li Na' }])] });
    const sys = { context: { isSystem: true } } as any;
    // The strangers sort BEFORE the member, so a probe that weighed the
    // same-named people first meets every one of them before her.
    for (let n = 0; n < strangers; n++) {
      await engine.insert('sys_user', { id: `usr_li_${String(n).padStart(3, '0')}`, name: 'Li Na', email: `li.${n}@example.com` }, sys);
    }
    await engine.insert('sys_user', { id: 'usr_li_zz_member', name: 'Li Na', email: 'li.member@example.com' }, sys);
    await engine.insert('sys_member', { id: 'mem_li_n', user_id: 'usr_li_zz_member', organization_id: ORG_NORTH, role: 'member' }, sys);

    const reads = recordPersonReads(engine);
    const north = await replayer!(ORG_NORTH);
    const northReads = reads.length;
    const south = await replayer!(ORG_SOUTH);
    return { north, south, northReads, southReads: reads.length - northReads, reads, dealsOf };
  }

  it('the reads a person reference costs do not grow with same-named people outside the organization', async () => {
    const few = await replayWithStrangers(0);
    const many = await replayWithStrangers(120);

    // Same verdicts either way: North's member is found, South is refused.
    for (const run of [few, many]) {
      expect(run.north.errors).toEqual([]);
      expect((await run.dealsOf(ORG_NORTH))[0].rep).toBe('usr_li_zz_member');
      expect((await run.dealsOf(ORG_SOUTH))[0].rep ?? null).toBeNull();
      expect(run.south.errors).toHaveLength(1);
      expect(run.south.errors[0].message).toContain(`not a member of organization ${ORG_SOUTH}`);
    }
    // The bound: 120 more same-named strangers cost not one more read, on the
    // hit (North) or on the miss (South).
    expect(many.northReads).toBe(few.northReads);
    expect(many.southReads).toBe(few.southReads);
    // And the shape that bounds it: no read pages by offset, every person read
    // naming the key is constrained to member ids or answers one row, and the
    // member read is walled by the load's organization.
    expect(many.reads.length).toBeGreaterThan(0);
    for (const { object, options } of many.reads) {
      expect(options.offset).toBeUndefined();
      const where = (options.where ?? {}) as Record<string, unknown>;
      if (object === 'sys_member') expect([ORG_NORTH, ORG_SOUTH]).toContain(where.organization_id);
      if (object === 'sys_user' && where.name === 'Li Na') {
        expect(where.id !== undefined || options.limit === 1).toBe(true);
      }
    }
  });

  /** A person whose id is UUID-shaped — the shape `looksLikeInternalId` recognises. */
  const UUID_NORTH_MEMBER = '3b9f6c2a-1d4e-4f8a-9c7b-2e5d8a1f0c63';
  const UUID_SOUTH_MEMBER = '8e2a4d7c-5b1f-4a3e-8d9c-7f0b2c6e1a94';

  it('an id-shaped person reference resolves to a member of the load organization, and an outsider’s id is refused like a name', async () => {
    const { engine, replayer, dealsOf } = await boot({
      posture: 'isolated',
      data: [deals([{ name: 'Mine', rep: UUID_NORTH_MEMBER }, { name: 'Theirs', rep: UUID_SOUTH_MEMBER }])],
    });
    const sys = { context: { isSystem: true } } as any;
    await engine.insert('sys_user', { id: UUID_NORTH_MEMBER, name: 'Chen Jie', email: 'chen@example.com' }, sys);
    await engine.insert('sys_user', { id: UUID_SOUTH_MEMBER, name: 'Zhou Min', email: 'zhou@example.com' }, sys);
    await engine.insert('sys_member', { id: 'mem_chen_n', user_id: UUID_NORTH_MEMBER, organization_id: ORG_NORTH, role: 'member' }, sys);
    await engine.insert('sys_member', { id: 'mem_zhou_s', user_id: UUID_SOUTH_MEMBER, organization_id: ORG_SOUTH, role: 'member' }, sys);

    const north = await replayer!(ORG_NORTH);
    const south = await replayer!(ORG_SOUTH);

    const byName = (rows: Row[]) => Object.fromEntries(rows.map((r) => [r.name, r.rep ?? null]));
    // A member's id still names that member — the legitimate seed keeps working.
    expect(byName(await dealsOf(ORG_NORTH))).toEqual({ Mine: UUID_NORTH_MEMBER, Theirs: null });
    expect(byName(await dealsOf(ORG_SOUTH))).toEqual({ Mine: null, Theirs: UUID_SOUTH_MEMBER });
    expect(north.errors).toHaveLength(1);
    expect(north.errors[0].message).toContain(`not a member of organization ${ORG_NORTH}`);
    expect(south.errors).toHaveLength(1);
    expect(south.errors[0].message).toContain(`not a member of organization ${ORG_SOUTH}`);
  });

  it('CONTROL — a load with no organization keeps an id-shaped person reference verbatim, as before', async () => {
    const { dealsOf } = await boot({ posture: 'single', organizations: false, data: [deals([{ name: 'Deal 1', rep: UUID_SOUTH_MEMBER }])] });
    const [row] = await dealsOf();
    expect(row.rep).toBe(UUID_SOUTH_MEMBER);
  });
});

describe('a dataset OF an object walled by a declared tenant column replays per organization on that column', () => {
  const tags = (records: Array<Record<string, unknown>>) => ({ object: 'crm_workspace_tag', mode: 'upsert', externalId: 'name', records });
  const accounts = (records: Array<Record<string, unknown>>) => ({ object: 'crm_account', mode: 'upsert', externalId: 'name', records });
  const sys = { context: { isSystem: true } } as any;
  const rowsOf = async (engine: ObjectQL, object: string): Promise<Row[]> =>
    ((await engine.find(object, { where: {}, context: { isSystem: true } } satisfies EngineQueryOptions)) as Row[])
      .sort((a, b) => a.id.localeCompare(b.id));

  it('each organization gets its own row, stamped on the tenant column; neither sees nor overwrites the other; a second replay matches', async () => {
    const { engine, replayer } = await boot({ posture: 'isolated', data: [tags([{ name: 'Silver' }])] });
    // South already holds a Silver of its own: an upsert that matched across
    // organizations would take it for North's.
    await engine.insert('crm_workspace_tag', { id: 'tag_silver_s', name: 'Silver', workspace_id: ORG_SOUTH }, sys);

    const north = await replayer!(ORG_NORTH);
    const south = await replayer!(ORG_SOUTH);

    expect(north.errors).toEqual([]);
    expect(south.errors).toEqual([]);
    expect(north.inserted).toBe(1);
    expect(south.inserted).toBe(0);
    const landed = await rowsOf(engine, 'crm_workspace_tag');
    expect(landed.map((r) => [r.name, r.workspace_id])).toEqual(
      expect.arrayContaining([['Silver', ORG_NORTH], ['Silver', ORG_SOUTH]]),
    );
    expect(landed).toHaveLength(2);
    expect(landed.find((r) => r.workspace_id === ORG_SOUTH)?.id).toBe('tag_silver_s');

    // A second replay matches each organization's own row: nothing is added.
    const again = [await replayer!(ORG_NORTH), await replayer!(ORG_SOUTH)];
    for (const r of again) {
      expect(r.errors).toEqual([]);
      expect(r.inserted).toBe(0);
    }
    expect(await rowsOf(engine, 'crm_workspace_tag')).toEqual(landed);
  });

  it('a load with no organization, pinned or derivable, refuses the row by name on the tenant column', async () => {
    // Two organizations and no pin: there is no owner to stamp.
    const { engine, metadata, logger } = await boot({ posture: 'isolated', data: [] });
    const loader = new SeedLoaderService(engine as any, metadata as any, logger as any);

    const result = await loader.load({ seeds: [tags([{ name: 'Bronze' }])], config: { multiPass: true } } as any);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ sourceObject: 'crm_workspace_tag', field: 'workspace_id', targetObject: 'sys_organization' });
    expect(await rowsOf(engine, 'crm_workspace_tag')).toEqual([]);
  });

  it('CONTROL — a dataset of an ordinary organization_id object replays per organization, stamped and idempotent', async () => {
    const { engine, replayer } = await boot({ posture: 'isolated', data: [accounts([{ name: 'Initech' }])] });

    const first = [await replayer!(ORG_NORTH), await replayer!(ORG_SOUTH)];
    const again = [await replayer!(ORG_NORTH), await replayer!(ORG_SOUTH)];

    for (const r of first) {
      expect(r.errors).toEqual([]);
      expect(r.inserted).toBe(1);
    }
    for (const r of again) {
      expect(r.errors).toEqual([]);
      expect(r.inserted).toBe(0);
    }
    const initech = (await rowsOf(engine, 'crm_account')).filter((r) => r.name === 'Initech');
    expect(initech.map((r) => r.organization_id).sort()).toEqual([ORG_NORTH, ORG_SOUTH].sort());
  });
});

describe('a dataset OF a global object (tenancy disabled) replays per organization onto one shared row', () => {
  const countries = (records: Array<Record<string, unknown>>) => ({ object: 'crm_country', mode: 'upsert', externalId: 'name', records });
  const rowsOf = async (engine: ObjectQL, object: string): Promise<Row[]> =>
    ((await engine.find(object, { where: {}, context: { isSystem: true } } satisfies EngineQueryOptions)) as Row[])
      .sort((a, b) => a.id.localeCompare(b.id));

  it('two organizations replay it: exactly one shared row, unstamped; a second replay is idempotent', async () => {
    const { engine, replayer } = await boot({ posture: 'isolated', data: [countries([{ name: 'Japan' }])] });

    const north = await replayer!(ORG_NORTH);
    const south = await replayer!(ORG_SOUTH);

    expect(north.errors).toEqual([]);
    expect(south.errors).toEqual([]);
    expect(north.inserted).toBe(1);
    expect(south.inserted).toBe(0);
    // The harness's own fixture rows stay; the seed adds exactly one Japan.
    const landed = (await rowsOf(engine, 'crm_country')).filter((r) => r.name === 'Japan');
    expect(landed).toHaveLength(1);
    // No organization column to stamp: the row carries none.
    expect(landed[0].organization_id ?? null).toBeNull();

    const again = [await replayer!(ORG_NORTH), await replayer!(ORG_SOUTH)];
    for (const r of again) {
      expect(r.errors).toEqual([]);
      expect(r.inserted).toBe(0);
    }
    expect((await rowsOf(engine, 'crm_country')).filter((r) => r.name === 'Japan')).toEqual(landed);
  });

  it('a load with no organization, pinned or derivable, writes the row: it is not refused for a column it does not have', async () => {
    const { engine, metadata, logger } = await boot({ posture: 'isolated', data: [] });
    const loader = new SeedLoaderService(engine as any, metadata as any, logger as any);

    const result = await loader.load({ seeds: [countries([{ name: 'Peru' }])], config: { multiPass: true } } as any);

    expect(result.errors).toEqual([]);
    expect((await rowsOf(engine, 'crm_country')).filter((r) => r.name === 'Peru')).toHaveLength(1);
  });
});

describe('#33791 the injected owner column resolves like a declared person lookup', () => {
  /** `owner_id` and the declared `rep` of each deal, by deal name. */
  const peopleOf = (rows: Row[]) =>
    Object.fromEntries(rows.map((r) => [r.name, { owner_id: r.owner_id ?? null, rep: r.rep ?? null }]));

  it('the harness serves the authored deal, which has no owner_id; the registry injects one', async () => {
    const { engine, metadata } = await boot({ posture: 'single', data: [] });
    const authored = (await metadata.getObject('crm_deal')) as { fields: Record<string, unknown> };
    expect(Object.keys(authored.fields)).not.toContain('owner_id');
    expect(Object.keys(engine.registry.getObject('crm_deal')?.fields ?? {})).toContain('owner_id');
  });

  it('a single boot resolves a member named in owner_id to that member, as it resolves the declared rep', async () => {
    const { dealsOf } = await boot({ posture: 'single', data: [deals([{ name: 'Deal 1', owner_id: 'Zhang Wei', rep: 'Zhang Wei' }])] });
    expect(peopleOf(await dealsOf())).toEqual({ 'Deal 1': { owner_id: 'usr_zhang', rep: 'usr_zhang' } });
  });

  it('a walled replay resolves a member per organization; a non-member is NULL with the same error rep gets', async () => {
    const { replayer, dealsOf } = await boot({
      posture: 'isolated',
      data: [deals([{ name: 'Deal 1', owner_id: 'Wang Fang', rep: 'Wang Fang' }, { name: 'Deal 2', owner_id: 'Zhang Wei', rep: 'Zhang Wei' }])],
    });

    const north = await replayer!(ORG_NORTH);
    const south = await replayer!(ORG_SOUTH);

    expect(north.errors).toEqual([]);
    expect(peopleOf(await dealsOf(ORG_NORTH))).toEqual({
      'Deal 1': { owner_id: 'usr_wang_north', rep: 'usr_wang_north' },
      'Deal 2': { owner_id: 'usr_zhang', rep: 'usr_zhang' },
    });
    // Zhang Wei is not a member of South: neither column borrows him, and the
    // owner is NULL (a first-admin handoff can claim it), never his name as text.
    expect(peopleOf(await dealsOf(ORG_SOUTH))).toEqual({
      'Deal 1': { owner_id: 'usr_wang_south', rep: 'usr_wang_south' },
      'Deal 2': { owner_id: null, rep: null },
    });
    const errors = south.errors as Array<{ message: string; field?: string }>;
    expect(errors.map((e) => e.field).sort()).toEqual(['owner_id', 'rep']);
    for (const e of errors) expect(e.message).toContain(`not a member of organization ${ORG_SOUTH}`);
  });

  it('a direct load pinned to an organization (the install path) resolves owner_id through that organization', async () => {
    const { engine, metadata, logger, dealsOf } = await boot({ posture: 'isolated', data: [] });
    const loader = new SeedLoaderService(engine as any, metadata as any, logger as any);
    const result = await loader.load({
      seeds: [deals([{ name: 'Installed', owner_id: 'Wang Fang' }])],
      config: { multiPass: true, organizationId: ORG_SOUTH },
    } as any);
    expect(result.errors).toEqual([]);
    expect((await dealsOf(ORG_SOUTH))[0].owner_id).toBe('usr_wang_south');
  });

  it('CONTROL — a load with no organization resolves owner_id unscoped, as it resolves rep', async () => {
    const { dealsOf } = await boot({ posture: 'single', organizations: false, data: [deals([{ name: 'Deal 1', owner_id: 'Zhang Wei', rep: 'Zhang Wei' }])] });
    expect(peopleOf(await dealsOf())).toEqual({ 'Deal 1': { owner_id: 'usr_zhang', rep: 'usr_zhang' } });
  });
});
