// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #21665 — a per-organization seed replay gives each organization its own row
 * identity. A fixed `id` authored in a seed is never reused across
 * organizations, and in-replay references follow the id each organization got.
 *
 * ## The defect, as measured on a walled showcase boot
 *
 * Under a walled posture AppPlugin writes no seed rows at boot. It registers a
 * `seed-replayer`, which the organizations runtime calls with the new
 * organization's id on every `sys_organization` insert. The showcase seeds its
 * `sys_business_unit` tree with authored ids (`bu_acme`, `bu_field_ops`, …) and
 * `externalId: 'id'`. The first organization's replay inserted those ids
 * verbatim. The second organization's replay looked for existing rows inside
 * ITS organization only, found none, and inserted the same five ids again. A
 * primary key is global, so all five were refused as duplicates. The four
 * `parent_business_unit_id` references were then deferred, and pass 2 could not
 * resolve them either: nine `[SeedLoader]` errors per organization, and every
 * organization after the first started without the tree.
 *
 * ## Why this file runs real implementations
 *
 * The collision lives in the database's primary key. An engine double has to be
 * told to refuse a duplicate id, so it would encode the very fact under test.
 * This file uses the REAL replayer that AppPlugin registers on a walled boot
 * (the callable the organizations runtime invokes per new organization), the
 * real `SeedLoaderService` behind it, a real `ObjectQL` engine, and a real
 * `SqlDriver` over better-sqlite3. It asserts on the stored rows.
 *
 * The walled boot is built here, in-test: a `tenancy` service answering the
 * `isolated` posture is what makes AppPlugin skip the inline seed and register
 * the replayer, the same branch a real walled deployment takes. No example app
 * declares `@objectstack/organizations`, so a booted walled example is not
 * available as a fixture; the replayer it would call is.
 *
 * ## The three pins, and the census row they are written against
 *
 * The census of fixed-id rows on tenant-scoped objects found exactly one
 * population: the showcase's five `sys_business_unit` rows
 * (`examples/app-showcase/src/data/seed/index.ts`). hotcrm and the platform's
 * own packages seed none. `ORG_UNITS` below is that dataset's shape.
 *
 *   1. Two organizations created on a walled boot each hold the full seeded
 *      set, with zero `[SeedLoader]` errors.
 *   2. The parent references resolve inside each organization.
 *   3. The first organization is unchanged: it keeps the authored ids, and the
 *      second organization's replay does not touch its rows.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SysBusinessUnit } from '@objectstack/platform-objects/identity';
import type { PluginContext } from '@objectstack/core';
import { AppPlugin } from './app-plugin';

/** better-auth-shaped organization ids — the shape every real organization has. */
const ORG_NORTH = 'org_msnorthd2a7k3x9qf';
const ORG_SOUTH = 'org_mssouthd2p4w8m2zc';

/** The census row: the showcase's `sys_business_unit` dataset, as authored. */
const ORG_UNITS = {
  object: 'sys_business_unit',
  mode: 'upsert',
  externalId: 'id',
  records: [
    { id: 'bu_acme', name: 'Acme Corporation', code: 'ACME', kind: 'company', active: true },
    { id: 'bu_field_ops', name: 'Field Operations', code: 'FOPS', kind: 'division', parent_business_unit_id: 'bu_acme', active: true },
    { id: 'bu_west_coast', name: 'West Coast', code: 'FOPS-W', kind: 'office', parent_business_unit_id: 'bu_field_ops', active: true },
    { id: 'bu_east_coast', name: 'East Coast', code: 'FOPS-E', kind: 'office', parent_business_unit_id: 'bu_field_ops', active: true },
    { id: 'bu_hq_finance', name: 'HQ Finance', code: 'FIN', kind: 'department', parent_business_unit_id: 'bu_acme', active: true },
  ],
};

/** Authored name → authored parent name, the tree every organization must hold. */
const AUTHORED_PARENT_BY_NAME: Record<string, string | null> = {
  'Acme Corporation': null,
  'Field Operations': 'Acme Corporation',
  'West Coast': 'Field Operations',
  'East Coast': 'Field Operations',
  'HQ Finance': 'Acme Corporation',
};

/**
 * The same tree authored with UUID-shaped ids. The loader treats a UUID-shaped
 * reference value as an internal id and keeps it verbatim, so without the
 * per-organization identity a second organization's parent link would point at
 * the FIRST organization's row: a cross-organization reference.
 */
const UUID_ROOT = '6f1c2a7e-3b4d-4e5f-8a9b-0c1d2e3f4a5b';
const UUID_CHILD = '9e8d7c6b-5a4f-4e3d-9c2b-1a0f9e8d7c6b';
const UUID_UNITS = {
  object: 'sys_business_unit',
  mode: 'upsert',
  externalId: 'id',
  records: [
    { id: UUID_ROOT, name: 'Root Unit', code: 'ROOT', kind: 'company', active: true },
    { id: UUID_CHILD, name: 'Child Unit', code: 'CHILD', kind: 'office', parent_business_unit_id: UUID_ROOT, active: true },
  ],
};

type Replayer = (organizationId: string) => Promise<{ inserted: number; updated: number; skipped: number; errors: unknown[] }>;
type Row = Record<string, unknown> & { id: string; name: string; parent_business_unit_id?: string | null };

const openDrivers: SqlDriver[] = [];
const envBefore = process.env.OS_INLINE_SEED_BUDGET_MS;

afterEach(async () => {
  while (openDrivers.length) {
    const d = openDrivers.pop();
    try {
      await d?.disconnect();
    } catch {
      /* a test that already disconnected is not a failure */
    }
  }
  if (envBefore === undefined) delete process.env.OS_INLINE_SEED_BUDGET_MS;
  else process.env.OS_INLINE_SEED_BUDGET_MS = envBefore;
});

function createLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

/**
 * Boot the walled composition and hand back the replayer AppPlugin registered.
 * The replayer is the production closure: it builds the per-organization
 * request (`defaultMode: 'upsert'`, `multiPass: true`, `organizationId`) and
 * runs the real loader against the real engine.
 */
async function bootWalled(dataset: typeof ORG_UNITS) {
  process.env.OS_INLINE_SEED_BUDGET_MS = '60000';
  const driver = new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
  openDrivers.push(driver);
  await driver.initObjects([SysBusinessUnit as any]);
  const engine = new ObjectQL();
  engine.registerDriver(driver as any, true);
  await engine.init();
  engine.registry.registerObject(SysBusinessUnit as any, '@objectstack/platform-objects');

  const metadata = {
    getObject: vi.fn(async (name: string) => (name === 'sys_business_unit' ? SysBusinessUnit : undefined)),
    listObjects: vi.fn(async () => [SysBusinessUnit]),
    getObjects: vi.fn(async () => [SysBusinessUnit]),
    get: vi.fn(async () => undefined),
    list: vi.fn(async () => []),
    exists: vi.fn(async () => false),
    listNames: vi.fn(async () => []),
    register: vi.fn(async () => {}),
    unregister: vi.fn(async () => {}),
  };
  const logger = createLogger();
  const services = new Map<string, unknown>();
  // The walled posture. AppPlugin reads it through the `tenancy` service and,
  // seeing a wall, writes nothing inline and registers the per-org replayer.
  services.set('tenancy', { posture: 'isolated' });
  const ctx = {
    logger,
    registerService: vi.fn((name: string, svc: unknown) => { services.set(name, svc); }),
    getService: vi.fn((name: string) => {
      if (name === 'objectql') return engine;
      if (name === 'metadata') return metadata;
      return services.get(name);
    }),
    getServices: vi.fn(() => services),
    hook: vi.fn(),
    trigger: vi.fn(),
  } as unknown as PluginContext;

  await new AppPlugin({ id: 'com.example.walled-seed-replay', data: [dataset] }).start(ctx);

  const replayer = services.get('seed-replayer') as Replayer | undefined;
  if (typeof replayer !== 'function') throw new Error('the walled boot registered no seed-replayer');

  const rowsOf = async (organizationId: string): Promise<Row[]> => {
    const rows = (await engine.find('sys_business_unit', { where: { organization_id: organizationId } })) as Row[];
    return [...rows].sort((a, b) => a.name.localeCompare(b.name));
  };
  const seedLoaderErrors = () =>
    logger.error.mock.calls.filter((call) => String(call[0]).includes('[SeedLoader]')).map((call) => String(call[0]));

  return { engine, replayer, rowsOf, seedLoaderErrors };
}

/** Each row's parent, read back by NAME within the same organization's rows. */
function parentNamesWithin(rows: Row[]): Record<string, string | null> {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out: Record<string, string | null> = {};
  for (const row of rows) {
    const parentId = row.parent_business_unit_id ?? null;
    out[row.name] = parentId === null ? null : (byId.get(parentId)?.name ?? `UNRESOLVED IN THIS ORG: ${parentId}`);
  }
  return out;
}

describe('#21665 per-organization seed replay — row identity per organization (real replayer, ObjectQL, SqlDriver)', () => {
  it('the walled boot writes nothing inline: every row below is a per-organization replay', async () => {
    const { engine } = await bootWalled(ORG_UNITS);
    expect(await engine.find('sys_business_unit', { where: {} })).toEqual([]);
  });

  it('pin 1 — two organizations each hold the full seeded set, with zero SeedLoader errors', async () => {
    const { replayer, rowsOf, seedLoaderErrors } = await bootWalled(ORG_UNITS);

    const north = await replayer(ORG_NORTH);
    const south = await replayer(ORG_SOUTH);

    expect(north.errors).toEqual([]);
    expect(south.errors).toEqual([]);
    expect(seedLoaderErrors()).toEqual([]);
    expect(north.inserted).toBe(5);
    expect(south.inserted).toBe(5);

    const authoredNames = ORG_UNITS.records.map((r) => r.name).sort();
    expect((await rowsOf(ORG_NORTH)).map((r) => r.name).sort()).toEqual(authoredNames);
    expect((await rowsOf(ORG_SOUTH)).map((r) => r.name).sort()).toEqual(authoredNames);
  });

  it('pin 2 — the parent references resolve inside each organization', async () => {
    const { replayer, rowsOf } = await bootWalled(ORG_UNITS);
    await replayer(ORG_NORTH);
    await replayer(ORG_SOUTH);

    const northRows = await rowsOf(ORG_NORTH);
    const southRows = await rowsOf(ORG_SOUTH);

    expect(parentNamesWithin(northRows)).toEqual(AUTHORED_PARENT_BY_NAME);
    expect(parentNamesWithin(southRows)).toEqual(AUTHORED_PARENT_BY_NAME);

    // No south row holds a north id, and no south parent link names one.
    const northIds = new Set(northRows.map((r) => r.id));
    expect(southRows.filter((r) => northIds.has(r.id))).toEqual([]);
    expect(southRows.filter((r) => r.parent_business_unit_id && northIds.has(r.parent_business_unit_id))).toEqual([]);
  });

  it('pin 3 — the first organization is unchanged: authored ids kept, untouched by the second replay', async () => {
    const { replayer, rowsOf } = await bootWalled(ORG_UNITS);
    await replayer(ORG_NORTH);
    const northBefore = await rowsOf(ORG_NORTH);

    // The first organization holds exactly what the authored seed says,
    // ids and parent links included: the shape it had before this change.
    expect(northBefore.map((r) => [r.name, r.id, r.parent_business_unit_id ?? null])).toEqual(
      ORG_UNITS.records
        .map((r) => [r.name, r.id, (r as { parent_business_unit_id?: string }).parent_business_unit_id ?? null])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    );

    await replayer(ORG_SOUTH);
    await replayer(ORG_SOUTH);

    expect(await rowsOf(ORG_NORTH)).toEqual(northBefore);
  });

  it('a second replay into the same organization finds its own rows: no duplicates, ids stable', async () => {
    const { replayer, rowsOf } = await bootWalled(ORG_UNITS);
    await replayer(ORG_NORTH);
    await replayer(ORG_SOUTH);
    const southFirst = await rowsOf(ORG_SOUTH);

    const again = await replayer(ORG_SOUTH);

    expect(again.errors).toEqual([]);
    expect(again.inserted).toBe(0);
    expect(await rowsOf(ORG_SOUTH)).toEqual(southFirst);
  });

  it('a UUID-shaped authored id is re-pointed too: the second organization never links to the first one\'s row', async () => {
    const { replayer, rowsOf, seedLoaderErrors } = await bootWalled(UUID_UNITS);
    await replayer(ORG_NORTH);
    const south = await replayer(ORG_SOUTH);

    expect(south.errors).toEqual([]);
    expect(seedLoaderErrors()).toEqual([]);

    const northRows = await rowsOf(ORG_NORTH);
    const southRows = await rowsOf(ORG_SOUTH);
    expect(northRows.map((r) => r.id).sort()).toEqual([UUID_ROOT, UUID_CHILD].sort());
    expect(parentNamesWithin(southRows)).toEqual({ 'Child Unit': 'Root Unit', 'Root Unit': null });
    const southChild = southRows.find((r) => r.name === 'Child Unit');
    expect(southChild?.parent_business_unit_id).not.toBe(UUID_ROOT);
  });
});
