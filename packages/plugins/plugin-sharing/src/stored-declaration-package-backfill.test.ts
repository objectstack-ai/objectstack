// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D8 rows R5, R6, R13] The declared-item package backfill, measured
 * on a REAL `ObjectQL` engine over a real SQL driver (better-sqlite3
 * `:memory:`), so the null filter, the managed-row filter, the keyset walk and
 * the single-column write are the driver's own answers, not a double's.
 *
 * The holders come from a stand-in registry carrying the reads objectql's
 * `resolvePackageScopedName` (the one rule) is asked over. None of the three
 * types has a phase-1 backstop, so two packages declaring one name is a state
 * a real deployment can be in today; the stand-in states it directly.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL, type PackageScopedRegistry } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SysSharingRule, SysQueueMember, SysAssignmentCursor } from './objects/index.js';
import {
  STORED_DECLARATION_REFERENCES,
  backfillStoredDeclarationPackages,
  backfillStoredDeclarationPackagesAtBoot,
  declaredHolderOf,
} from './stored-declaration-package-backfill.js';

const ORG = 'org_a';
const SYS_ORG = { isSystem: true, tenantId: ORG } as const;
const SYSTEM_CTX = { isSystem: true } as const;

const [RULES, MEMBERS, CURSORS] = STORED_DECLARATION_REFERENCES;

const CRM = 'com.acme.crm';
const HR = 'com.acme.hr';
const ONE_HOLDER = 'route_leads';
const TWO_HOLDERS = 'shared_inbox';
const ENV_ITEM = 'env_escalations';
const NOBODY = 'retired_name';

/**
 * A registry where, for every one of the three types: `route_leads` is CRM's
 * alone; `shared_inbox` is declared by CRM and HR; `env_escalations` is the
 * environment's own item.
 */
function standInRegistry(): PackageScopedRegistry {
  const packageHolders: Record<string, string[]> = { [ONE_HOLDER]: [CRM], [TWO_HOLDERS]: [CRM, HR] };
  return {
    packageScopedHoldersOf: (_type: string, name: string) => packageHolders[name] ?? [],
    getPackageScopedItem: (_type: string, name: string, packageId: string) =>
      (packageHolders[name] ?? []).includes(packageId) ? { name, _packageId: packageId } : undefined,
    getEnvironmentScopedItem: (_type: string, name: string) => (name === ENV_ITEM ? { name } : undefined),
    getPackage: () => undefined,
    getAllPackages: () => [],
  } as unknown as PackageScopedRegistry;
}

const engines: ObjectQL[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  while (engines.length) {
    try { await engines.pop()?.destroy(); } catch { /* noop */ }
  }
});

async function boot(): Promise<ObjectQL> {
  const engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
    true,
  );
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.declaration-package-backfill',
    name: 'Declared-item package backfill',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [SysSharingRule, SysQueueMember, SysAssignmentCursor],
  } as any);
  await engine.syncSchemas();
  engines.push(engine);
  return engine;
}

const rule = (id: string, name: string, managedBy: string, extra: Record<string, unknown> = {}) => ({
  id, name, label: name, object_name: 'account', criteria_json: '{"status":"open"}', recipient_type: 'user',
  recipient_id: 'u_1', access_level: 'read', active: true, managed_by: managedBy, organization_id: ORG, ...extra,
});
const member = (id: string, queue: string, extra: Record<string, unknown> = {}) => ({
  id, queue, recipient_type: 'position', recipient_id: `pos_${id}`, organization_id: ORG, ...extra,
});
const cursor = (id: string, ruleName: string) => ({ id, rule: ruleName, entry: `entry_${id}`, version: 0, organization_id: ORG });

async function seed(engine: ObjectQL): Promise<void> {
  for (const row of [
    rule('r1', ONE_HOLDER, 'package'),
    rule('r2', TWO_HOLDERS, 'package'),
    rule('r3', NOBODY, 'platform'),
    // An organization's own rule is never asked, whatever its name.
    rule('r4', `${ONE_HOLDER}_copy`, 'admin'),
  ]) await engine.insert(RULES.object, row, { context: SYS_ORG });
  for (const row of [
    member('m1', ONE_HOLDER),
    member('m2', ONE_HOLDER),
    member('m3', TWO_HOLDERS),
    member('m4', ENV_ITEM),
    member('m5', NOBODY),
    member('m6', ONE_HOLDER, { queue_package: 'com.acme.elsewhere' }),
  ]) await engine.insert(MEMBERS.object, row, { context: SYS_ORG });
  for (const row of [cursor('c1', ONE_HOLDER), cursor('c2', TWO_HOLDERS), cursor('c3', NOBODY)]) {
    await engine.insert(CURSORS.object, row, { context: SYS_ORG });
  }
}

async function packagesById(engine: ObjectQL, object: string, column: string): Promise<Record<string, unknown>> {
  const rows = (await engine.find(object, { where: {}, context: SYSTEM_CTX })) as Array<Record<string, unknown>>;
  return Object.fromEntries(rows.map((r) => [String(r.id), r[column] ?? null]));
}

describe('R6 — a queue member gains the package that holds its queue', () => {
  it('a name one package holds is bound to it; every other row is left naming no package', async () => {
    const engine = await boot();
    await seed(engine);

    const report = await backfillStoredDeclarationPackages(engine, MEMBERS, declaredHolderOf(standInRegistry()));

    expect(await packagesById(engine, MEMBERS.object, 'queue_package')).toEqual({
      m1: CRM, m2: CRM, m3: null, m4: null, m5: null, m6: 'com.acme.elsewhere',
    });
    expect(report.bound).toEqual([{ name: ONE_HOLDER, rows: 2, packageId: CRM }]);
    expect(report.unheld).toEqual([{ name: NOBODY, rows: 1 }]);
    expect(report.unpackaged).toEqual([{ name: ENV_ITEM, rows: 1, holder: 'environment' }]);
  });

  it('a name two packages hold is left null and reported naming BOTH, never bound to the first', async () => {
    const engine = await boot();
    await seed(engine);

    const report = await backfillStoredDeclarationPackages(engine, MEMBERS, declaredHolderOf(standInRegistry()));

    expect(report.ambiguous).toHaveLength(1);
    expect(report.ambiguous[0].name).toBe(TWO_HOLDERS);
    expect(report.ambiguous[0].candidates).toHaveLength(2);
    expect(report.ambiguous[0].candidates.join(' ')).toContain(CRM);
    expect(report.ambiguous[0].candidates.join(' ')).toContain(HR);
    expect((await packagesById(engine, MEMBERS.object, 'queue_package')).m3).toBeNull();
  });

  it('a second run writes no row and reports the same ambiguous and unheld names', async () => {
    const engine = await boot();
    await seed(engine);
    const holderOf = declaredHolderOf(standInRegistry());
    const first = await backfillStoredDeclarationPackages(engine, MEMBERS, holderOf);

    const update = vi.spyOn(engine, 'update');
    const second = await backfillStoredDeclarationPackages(engine, MEMBERS, holderOf);

    expect(update).not.toHaveBeenCalled();
    expect(second.bound).toEqual([]);
    expect(second.ambiguous).toEqual(first.ambiguous);
    expect(second.unheld).toEqual(first.unheld);
    expect(second.unpackaged).toEqual(first.unpackaged);
  });

  it('writes only the package column: the member\'s other columns are untouched', async () => {
    const engine = await boot();
    await seed(engine);
    const read = async () =>
      ((await engine.find(MEMBERS.object, { where: { id: 'm1' }, context: SYSTEM_CTX })) as Array<Record<string, unknown>>)[0];
    const before = await read();

    await backfillStoredDeclarationPackages(engine, MEMBERS, declaredHolderOf(standInRegistry()));

    const { queue_package: added, updated_at: _a, ...rest } = await read();
    const { queue_package: was, updated_at: _b, ...restBefore } = before;
    expect(was ?? null).toBeNull();
    expect(added).toBe(CRM);
    expect(rest).toEqual(restBefore);
  });
});

describe('R5 — a managed sharing-rule row gains the package that holds its declared rule', () => {
  it('binds the managed rows only; an organization\'s own rule is never asked', async () => {
    const engine = await boot();
    await seed(engine);

    const report = await backfillStoredDeclarationPackages(engine, RULES, declaredHolderOf(standInRegistry()));

    expect(await packagesById(engine, RULES.object, 'package_id')).toEqual({ r1: CRM, r2: null, r3: null, r4: null });
    expect(report.bound).toEqual([{ name: ONE_HOLDER, rows: 1, packageId: CRM }]);
    expect(report.ambiguous.map((a) => a.name)).toEqual([TWO_HOLDERS]);
    expect(report.unheld).toEqual([{ name: NOBODY, rows: 1 }]);
    const asked = [...report.bound, ...report.ambiguous, ...report.unheld, ...report.unpackaged].map((n) => n.name);
    expect(asked).not.toContain(`${ONE_HOLDER}_copy`);
  });
});

describe('R13 — an assignment cursor gains the package that holds its rule', () => {
  it('binds the one holder, leaves the ambiguous and unheld names null and reports them', async () => {
    const engine = await boot();
    await seed(engine);

    const report = await backfillStoredDeclarationPackages(engine, CURSORS, declaredHolderOf(standInRegistry()));

    expect(await packagesById(engine, CURSORS.object, 'rule_package')).toEqual({ c1: CRM, c2: null, c3: null });
    expect(report.ambiguous.map((a) => a.name)).toEqual([TWO_HOLDERS]);
    expect(report.unheld).toEqual([{ name: NOBODY, rows: 1 }]);
  });
});

describe('the boot run', () => {
  const logger = () => ({ info: vi.fn(), warn: vi.fn() });
  const sealed = (registry: PackageScopedRegistry, getObject: (name: string) => unknown) =>
    Object.assign(registry, { bareNameHoldersAreSealed: true, getObject });

  it('waits for the holder seal: before it, nothing is read or written', async () => {
    const engine = await boot();
    await seed(engine);
    const find = vi.spyOn(engine, 'find');
    const registry = Object.assign(standInRegistry(), { bareNameHoldersAreSealed: false, getObject: () => ({}) });

    expect(await backfillStoredDeclarationPackagesAtBoot(engine, registry, logger())).toBeUndefined();
    expect(find).not.toHaveBeenCalled();
  });

  it('binds all three references and warns once per table naming every candidate of the ambiguous set', async () => {
    const engine = await boot();
    await seed(engine);
    const log = logger();
    const registry = sealed(standInRegistry(), (name) => engine.registry.getObject(name));

    const reports = await backfillStoredDeclarationPackagesAtBoot(engine, registry, log);

    expect(reports?.map((r) => r.row)).toEqual(['R5', 'R6', 'R13']);
    const warned = log.warn.mock.calls.map((c) => String(c[0]));
    expect(warned).toHaveLength(3);
    for (const line of warned) {
      expect(line).toContain(TWO_HOLDERS);
      expect(line).toContain(CRM);
      expect(line).toContain(HR);
    }
  });

  it('a table it cannot read keeps its rows and says so, and the boot goes on', async () => {
    const engine = await boot();
    await seed(engine);
    const log = logger();
    vi.spyOn(engine, 'find').mockRejectedValue(new Error('driver offline'));
    const registry = sealed(standInRegistry(), (name) => engine.registry.getObject(name));

    expect(await backfillStoredDeclarationPackagesAtBoot(engine, registry, log)).toEqual([]);
    expect(log.warn).toHaveBeenCalledTimes(3);
    expect(String(log.warn.mock.calls[0][0])).toContain('did not finish');
  });
});
