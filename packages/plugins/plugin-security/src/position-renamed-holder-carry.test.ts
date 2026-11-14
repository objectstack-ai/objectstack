// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#32983, ruling A1 (record 6841971722)] A declared position rename carries
 * its holders at boot — measured on a REAL `ObjectQL` engine over a real SQL
 * driver (better-sqlite3 `:memory:`), so the filter, the keyset walk, the
 * single-column write and the activation-ledger read are the driver's own
 * answers, not a double's.
 *
 * Most positions come from a stand-in catalog (`list('position')`), which is
 * what lets one test hold a position of another package, of the environment,
 * or two claimants of one old name: a real registry refuses the clashes at
 * registration. The disabled-package and environment-sentinel cases run
 * through the REAL reader (`createSecurityCatalogReader`) over the engine's
 * own `SchemaRegistry`, since the gaps they pin live in the real shapes. Each of the ruling's conditions is pinned both ways — the old
 * name refused, and the honest declaration beside it carried:
 *
 *  1. a switched-off old position does not come back active under the new name;
 *  2. a package never claims an old name another package (enabled or
 *     disabled) or the environment holds, or is recorded as owning;
 *  3. no current name, no cycle, no old name claimed twice.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL, ObjectQLPlugin } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import { SysMetadataActivation } from '@objectstack/platform-objects/system';
import { SysMember, SysOrganization, SysUser } from '@objectstack/platform-objects/identity';
import { ObjectKernel, createSecurityCatalogReader, type Plugin, type PluginContext, type SecurityCatalogEntry } from '@objectstack/core';
import { SysUserPosition } from './objects/sys-user-position.object.js';
import { SecurityPlugin } from './security-plugin.js';
import {
  carryRenamedPositionHolders,
  carryRenamedPositionHoldersAtBoot,
  createPositionRenameCarryRuns,
  logPositionRenameCarry,
} from './position-renamed-holder-carry.js';

const SYSTEM_CTX = { isSystem: true } as const;
const CRM = 'com.acme.crm';
const HR = 'com.acme.hr';

/** Two stand-in tables the carry only names: a recipient table and the approval slate. */
const SharingRuleStandIn = ObjectSchema.create({
  name: 'sys_sharing_rule',
  label: 'Sharing rule (stand-in)',
  fields: {
    id: Field.text({ label: 'ID', required: true }),
    organization_id: Field.text({ label: 'Organization' }),
    recipient_type: Field.text({ label: 'Recipient type' }),
    recipient_id: Field.text({ label: 'Recipient' }),
  },
} as any);
const ApprovalRequestStandIn = ObjectSchema.create({
  name: 'sys_approval_request',
  label: 'Approval request (stand-in)',
  fields: {
    id: Field.text({ label: 'ID', required: true }),
    organization_id: Field.text({ label: 'Organization' }),
    status: Field.text({ label: 'Status' }),
    pending_approvers: Field.textarea({ label: 'Pending approvers' }),
  },
} as any);

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
    id: 'com.objectstack.qa.position-renamed-holder-carry',
    name: 'Position rename holder carry',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [SysUserPosition, SysMetadataActivation, SharingRuleStandIn, ApprovalRequestStandIn],
  } as any);
  await engine.syncSchemas();
  engines.push(engine);
  return engine;
}

/** A catalog entry for position `name`, declared by `packageId` (`null`: the environment). */
const entry = (name: string, packageId: string | null, renamedFrom?: string[]): SecurityCatalogEntry => ({
  type: 'position',
  name,
  source: packageId ? 'registry' : 'metadata',
  definition: { name, label: name, ...(renamedFrom ? { renamedFrom } : {}) },
  ...(packageId ? { packageId } : {}),
} as SecurityCatalogEntry);

const catalogOf = (...entries: SecurityCatalogEntry[]) => ({ list: async () => entries });

const holder = (id: string, user: string, position: string, organization: string, extra: Record<string, unknown> = {}) => ({
  id, user_id: user, position, organization_id: organization, ...extra,
});

async function seed(engine: ObjectQL, object: string, rows: Array<Record<string, unknown>>): Promise<void> {
  for (const row of rows) await engine.insert(object, row, { context: SYSTEM_CTX });
}

async function positionsById(engine: ObjectQL): Promise<Record<string, unknown>> {
  const rows = (await engine.find('sys_user_position', { where: {}, context: SYSTEM_CTX })) as Array<Record<string, unknown>>;
  return Object.fromEntries(rows.map((r) => [String(r.id), r.position]));
}

describe('the holders of an old name move to the new one, in every organization', () => {
  it('moves each holder row, writes only `position`, and leaves rows of other names alone', async () => {
    const engine = await boot();
    await seed(engine, 'sys_user_position', [
      holder('h1', 'u1', 'sales_rep', 'org_a', { reason: 'hired', valid_until: '2027-01-01T00:00:00.000Z' }),
      holder('h2', 'u2', 'sales_rep', 'org_a'),
      holder('h3', 'u3', 'sales_rep', 'org_b'),
      holder('h4', 'u4', 'auditor', 'org_a'),
    ]);

    const report = await carryRenamedPositionHolders(engine as any, { catalog: catalogOf(entry('crm_sales_rep', CRM, ['sales_rep']), entry('auditor', HR)) });

    expect(await positionsById(engine)).toEqual({ h1: 'crm_sales_rep', h2: 'crm_sales_rep', h3: 'crm_sales_rep', h4: 'auditor' });
    expect(report.carried).toEqual([
      expect.objectContaining({ from: 'sales_rep', to: 'crm_sales_rep', packageId: CRM, rows: 3, byOrganization: { org_a: 2, org_b: 1 }, alreadyHolds: [] }),
    ]);
    expect(report.refused).toEqual([]);
    const [h1] = (await engine.find('sys_user_position', { where: { id: 'h1' }, context: SYSTEM_CTX })) as Array<Record<string, unknown>>;
    expect(h1).toMatchObject({ user_id: 'u1', organization_id: 'org_a', reason: 'hired' });
    expect(String(h1.valid_until)).toContain('2027-01-01');
  });

  it('is idempotent: a second boot moves nothing, and a row already re-pointed by hand is untouched', async () => {
    const engine = await boot();
    await seed(engine, 'sys_user_position', [holder('h1', 'u1', 'sales_rep', 'org_a'), holder('h2', 'u2', 'crm_sales_rep', 'org_a')]);
    const deps = { catalog: catalogOf(entry('crm_sales_rep', CRM, ['sales_rep'])) };

    await carryRenamedPositionHolders(engine as any, deps);
    const update = vi.spyOn(engine, 'update');
    const second = await carryRenamedPositionHolders(engine as any, deps);

    expect(second.carried).toEqual([expect.objectContaining({ rows: 0, alreadyHolds: [] })]);
    expect(update).not.toHaveBeenCalled();
    expect(await positionsById(engine)).toEqual({ h1: 'crm_sales_rep', h2: 'crm_sales_rep' });
  });

  it('a holder who already holds the new name in that organization keeps both rows; the old one is named, never deleted', async () => {
    const engine = await boot();
    await seed(engine, 'sys_user_position', [
      holder('h1', 'u1', 'sales_rep', 'org_a'),
      holder('h2', 'u1', 'crm_sales_rep', 'org_a'),
      holder('h3', 'u1', 'sales_rep', 'org_b'),
    ]);

    const report = await carryRenamedPositionHolders(engine as any, { catalog: catalogOf(entry('crm_sales_rep', CRM, ['sales_rep'])) });

    expect(await positionsById(engine)).toEqual({ h1: 'sales_rep', h2: 'crm_sales_rep', h3: 'crm_sales_rep' });
    expect(report.carried[0]).toMatchObject({ rows: 1, byOrganization: { org_b: 1 }, alreadyHolds: [{ id: 'h1', organization: 'org_a' }] });
  });

  it('reads nothing when no position declares `renamedFrom`', async () => {
    const engine = await boot();
    const find = vi.spyOn(engine, 'find');
    const report = await carryRenamedPositionHolders(engine as any, { catalog: catalogOf(entry('crm_sales_rep', CRM)) });
    expect(report).toEqual({ carried: [], refused: [], failed: [], leftBehind: [], notRead: [] });
    expect(find).not.toHaveBeenCalled();
  });
});

describe('condition 1: a switched-off old position does not come back active under the new name', () => {
  it.each([
    ['switched off (active: false)', false, 'sales_rep', 'switched-off'],
    ['recorded active (active: true)', true, 'crm_sales_rep', undefined],
  ] as const)('old name %s', async (_label, active, after, reason) => {
    const engine = await boot();
    await seed(engine, 'sys_user_position', [holder('h1', 'u1', 'sales_rep', 'org_a')]);
    await seed(engine, 'sys_metadata_activation', [{ id: 'l1', metadata_type: 'position', name: 'sales_rep', package_id: CRM, active }]);

    // No `switchedOff` injected: the authorization resolver's own read decides.
    const report = await carryRenamedPositionHolders(engine as any, { catalog: catalogOf(entry('crm_sales_rep', CRM, ['sales_rep'])) });

    expect((await positionsById(engine)).h1).toBe(after);
    expect(report.refused.map((r) => r.reason)).toEqual(reason ? [reason] : []);
  });
});

describe('condition 2: a package never claims an old name it did not own', () => {
  it.each([
    ['another package declares it', [entry('crm_sales_rep', CRM, ['sales_rep']), entry('sales_rep', HR)], 'held-by-other'],
    ['the environment declares it', [entry('crm_sales_rep', CRM, ['sales_rep']), entry('sales_rep', null)], 'held-by-other'],
  ] as const)('refused when %s; its holders stay', async (_label, entries, reason) => {
    const engine = await boot();
    await seed(engine, 'sys_user_position', [holder('h1', 'u1', 'sales_rep', 'org_a')]);

    const report = await carryRenamedPositionHolders(engine as any, { catalog: catalogOf(...entries) });

    expect((await positionsById(engine)).h1).toBe('sales_rep');
    expect(report.carried).toEqual([]);
    expect(report.refused).toEqual([expect.objectContaining({ from: 'sales_rep', to: 'crm_sales_rep', reason })]);
  });

  it.each([
    ['the ledger records it under another package', CRM, HR, 'sales_rep', 'owned-by-other'],
    ['the ledger records it under the claiming package', CRM, CRM, 'crm_sales_rep', undefined],
    ['the ledger row names no package (no evidence either way)', CRM, null, 'crm_sales_rep', undefined],
    ['an environment position claims a name the ledger records under a package', null, CRM, 'sales_rep', 'owned-by-other'],
    // The activation door stores the environment's sentinel for an item the environment authored.
    ['the ledger records it as the environment\'s (`sys_metadata`), and a package claims it', CRM, 'sys_metadata', 'sales_rep', 'owned-by-other'],
    ['the ledger records it as the environment\'s (`sys_metadata`), and an environment position claims it', null, 'sys_metadata', 'crm_sales_rep', undefined],
  ] as const)('a name that is no position now: %s', async (_label, claimant, recorded, after, reason) => {
    const engine = await boot();
    await seed(engine, 'sys_user_position', [holder('h1', 'u1', 'sales_rep', 'org_a')]);
    await seed(engine, 'sys_metadata_activation', [
      { id: 'l1', metadata_type: 'position', name: 'sales_rep', ...(recorded ? { package_id: recorded } : {}), active: true },
    ]);

    const report = await carryRenamedPositionHolders(engine as any, { catalog: catalogOf(entry('crm_sales_rep', claimant, ['sales_rep'])) });

    expect((await positionsById(engine)).h1).toBe(after);
    expect(report.refused.map((r) => r.reason)).toEqual(reason ? [reason] : []);
  });
});

describe('condition 3, across the one catalog: no current name, no cycle, no old name claimed twice', () => {
  it('two positions claiming one old name: neither carries, both are named', async () => {
    const engine = await boot();
    await seed(engine, 'sys_user_position', [holder('h1', 'u1', 'sales_rep', 'org_a')]);

    const report = await carryRenamedPositionHolders(engine as any, {
      catalog: catalogOf(entry('crm_sales_rep', CRM, ['sales_rep']), entry('hr_sales_rep', HR, ['sales_rep'])),
    });

    expect((await positionsById(engine)).h1).toBe('sales_rep');
    expect(report.refused.map((r) => [r.to, r.reason])).toEqual([['crm_sales_rep', 'claimed-twice'], ['hr_sales_rep', 'claimed-twice']]);
    expect(report.refused[0].detail).toContain('hr_sales_rep');
  });

  it('an old name the same package still declares, and a cycle: nothing moves', async () => {
    const engine = await boot();
    await seed(engine, 'sys_user_position', [holder('h1', 'u1', 'a_rep', 'org_a'), holder('h2', 'u2', 'b_rep', 'org_a')]);

    const report = await carryRenamedPositionHolders(engine as any, {
      catalog: catalogOf(entry('a_rep', CRM, ['b_rep']), entry('b_rep', CRM, ['a_rep'])),
    });

    expect(await positionsById(engine)).toEqual({ h1: 'a_rep', h2: 'b_rep' });
    expect(report.refused.map((r) => r.reason)).toEqual(['still-declared', 'still-declared']);
    expect(report.leftBehind).toEqual([]);
  });
});

describe('holders only: every other reference to an old name is named, never written', () => {
  it('names a sharing-rule recipient and a pending approver slot, and leaves both as they are', async () => {
    const engine = await boot();
    await seed(engine, 'sys_user_position', [holder('h1', 'u1', 'sales_rep', 'org_a')]);
    await seed(engine, 'sys_sharing_rule', [
      { id: 'r1', organization_id: 'org_a', recipient_type: 'position', recipient_id: 'sales_rep' },
      { id: 'r2', organization_id: 'org_a', recipient_type: 'team', recipient_id: 'sales_rep' },
    ]);
    await seed(engine, 'sys_approval_request', [
      { id: 'a1', organization_id: 'org_b', status: 'pending', pending_approvers: 'u9,position:sales_rep' },
      { id: 'a2', organization_id: 'org_b', status: 'approved', pending_approvers: 'position:sales_rep' },
      { id: 'a3', organization_id: 'org_b', status: 'pending', pending_approvers: 'position:sales_rep_lead' },
    ]);

    const report = await carryRenamedPositionHolders(engine as any, { catalog: catalogOf(entry('crm_sales_rep', CRM, ['sales_rep'])) });

    expect((await positionsById(engine)).h1).toBe('crm_sales_rep');
    expect(report.leftBehind).toEqual([
      expect.objectContaining({ object: 'sys_sharing_rule', byName: { sales_rep: { rows: 1, organizations: ['org_a'] } } }),
      expect.objectContaining({ object: 'sys_approval_request', byName: { sales_rep: { rows: 1, organizations: ['org_b'] } } }),
    ]);
    const rule = (await engine.find('sys_sharing_rule', { where: { id: 'r1' }, context: SYSTEM_CTX })) as Array<Record<string, unknown>>;
    expect(rule[0].recipient_id).toBe('sales_rep');
    const request = (await engine.find('sys_approval_request', { where: { id: 'a1' }, context: SYSTEM_CTX })) as Array<Record<string, unknown>>;
    expect(request[0].pending_approvers).toBe('u9,position:sales_rep');

    const warn = vi.fn();
    logPositionRenameCarry(report, { warn, info: vi.fn() });
    expect(warn.mock.calls.map(([m]) => String(m)).join('\n')).toMatch(/sys_sharing_rule[\s\S]*'sales_rep' \(1 row\(s\) in 1 organization\(s\)\)/);
  });
});

/** The engine's own registry, and a real catalog reader over it (no stored metadata unless given). */
function realCatalog(engine: ObjectQL, stored: Array<Record<string, unknown>> = []) {
  const registry = (engine as any).registry;
  const metadata = {
    get: async (type: string, name: string) => (type === 'position' ? stored.find((d) => d.name === name) : undefined),
    list: async (type: string) => (type === 'position' ? stored : []),
  };
  return { registry, catalog: createSecurityCatalogReader({ registry, metadata }) };
}

/** Install `packageId` on the real registry with `positions`. */
function installWithPositions(registry: any, packageId: string, positions: Array<Record<string, unknown>>): void {
  registry.installPackage({ id: packageId, name: packageId, version: '1.0.0', type: 'app', namespace: packageId.split('.').pop() } as never, 'code');
  for (const p of positions) registry.registerItem('position', { label: String(p.name), ...p }, 'name', packageId);
}

describe('condition 2 over every installed package: a disabled package still holds its names', () => {
  it('a position of a DISABLED package is refused as held; once that package is uninstalled, the same claim carries', async () => {
    const engine = await boot();
    await seed(engine, 'sys_user_position', [holder('h1', 'u1', 'sales_rep', 'org_a')]);
    const { registry, catalog } = realCatalog(engine);
    installWithPositions(registry, HR, [{ name: 'sales_rep' }]);
    installWithPositions(registry, CRM, [{ name: 'crm_sales_rep', renamedFrom: ['sales_rep'] }]);
    registry.disablePackage(HR);
    // The served catalog no longer lists HR's position: the gap this pins.
    expect((await catalog.list('position')).map((e) => e.name)).not.toContain('sales_rep');

    const whileDisabled = await carryRenamedPositionHolders(engine as any, { catalog });
    expect((await positionsById(engine)).h1).toBe('sales_rep');
    expect(whileDisabled.refused).toEqual([
      expect.objectContaining({ from: 'sales_rep', to: 'crm_sales_rep', packageId: CRM, reason: 'held-by-other', detail: `'sales_rep' is a position package "${HR}" (disabled) declares` }),
    ]);

    registry.uninstallPackage(HR);
    const afterUninstall = await carryRenamedPositionHolders(engine as any, { catalog });
    expect((await positionsById(engine)).h1).toBe('crm_sales_rep');
    expect(afterUninstall.carried).toEqual([expect.objectContaining({ from: 'sales_rep', rows: 1 })]);
  });

  it('a disabled package claiming an old name: alone it is not carried; beside another claimant, both are claimed-twice', async () => {
    const engine = await boot();
    await seed(engine, 'sys_user_position', [holder('h1', 'u1', 'sales_rep', 'org_a')]);
    const { registry, catalog } = realCatalog(engine);
    installWithPositions(registry, HR, [{ name: 'hr_sales_rep', renamedFrom: ['sales_rep'] }]);
    registry.disablePackage(HR);

    const alone = await carryRenamedPositionHolders(engine as any, { catalog });
    expect(alone.refused).toEqual([expect.objectContaining({ to: 'hr_sales_rep', reason: 'claimant-disabled', disabled: true })]);

    installWithPositions(registry, CRM, [{ name: 'crm_sales_rep', renamedFrom: ['sales_rep'] }]);
    const both = await carryRenamedPositionHolders(engine as any, { catalog });
    expect(both.refused.map((r) => [r.to, r.reason]).sort()).toEqual([['crm_sales_rep', 'claimed-twice'], ['hr_sales_rep', 'claimed-twice']]);
    expect((await positionsById(engine)).h1).toBe('sales_rep');
  });

  it('the real reader: an environment position (stamped `sys_metadata`) is "the environment", never a package', async () => {
    const engine = await boot();
    await seed(engine, 'sys_user_position', [holder('h1', 'u1', 'sales_rep', 'org_a'), holder('h2', 'u2', 'old_rep', 'org_a')]);
    const { registry, catalog } = realCatalog(engine, [
      { name: 'sales_rep', label: 'Sales rep', _packageId: 'sys_metadata' },
      { name: 'env_rep', label: 'Env rep', _packageId: 'sys_metadata', renamedFrom: ['old_rep'] },
    ]);
    installWithPositions(registry, CRM, [{ name: 'crm_sales_rep', renamedFrom: ['sales_rep'] }]);

    const report = await carryRenamedPositionHolders(engine as any, { catalog });
    expect(report.refused).toEqual([
      expect.objectContaining({ from: 'sales_rep', reason: 'held-by-other', detail: "'sales_rep' is a position the environment declares" }),
    ]);
    expect(report.carried).toEqual([expect.objectContaining({ from: 'old_rep', to: 'env_rep', packageId: null, rows: 1 })]);
  });
});

describe('a failure is one claim\'s: the others still run, and what moved before it is said', () => {
  it('a row whose write is refused is named and skipped: the rows after it still move, and the next claim is carried', async () => {
    const engine = await boot();
    await seed(engine, 'sys_user_position', [
      holder('h1', 'u1', 'sales_rep', 'org_a'),
      holder('h2', 'u2', 'sales_rep', 'org_b'),
      holder('h2b', 'u4', 'sales_rep', 'org_b'),
      holder('h3', 'u3', 'field_rep', 'org_a'),
    ]);
    const realUpdate = engine.update.bind(engine);
    vi.spyOn(engine, 'update').mockImplementation(async (object: any, data: any, options: any) => {
      if (data?.id === 'h2') throw new Error('refused by a write gate');
      return realUpdate(object, data, options);
    });

    const report = await carryRenamedPositionHolders(engine as any, {
      catalog: catalogOf(entry('crm_sales_rep', CRM, ['sales_rep']), entry('crm_field_rep', CRM, ['field_rep'])),
    });

    expect(await positionsById(engine)).toEqual({ h1: 'crm_sales_rep', h2: 'sales_rep', h2b: 'crm_sales_rep', h3: 'crm_field_rep' });
    expect(report.failed).toEqual([expect.objectContaining({
      from: 'sales_rep', rows: 2, byOrganization: { org_a: 1, org_b: 1 }, error: 'refused by a write gate',
      failedRows: [{ id: 'h2', organization: 'org_b', error: 'refused by a write gate' }],
    })]);
    expect(report.carried).toEqual([expect.objectContaining({ from: 'field_rep', rows: 1 })]);
    const warn = vi.fn();
    logPositionRenameCarry(report, { warn, info: vi.fn() });
    expect(warn.mock.calls.map(([m]) => String(m)).join('\n')).toMatch(/'sales_rep' → 'crm_sales_rep' .* did not finish: 2 holder row\(s\) were moved \(org_a: 1, org_b: 1\), and 1 row\(s\) could not be written \(refused by a write gate\): h2/);
  });

  it('a row another replica moved after this one read it is neither moved again nor named as a twin', async () => {
    const engine = await boot();
    // Already on the new name: the other replica's write.
    await seed(engine, 'sys_user_position', [holder('h1', 'u1', 'crm_sales_rep', 'org_a')]);
    const realFind = engine.find.bind(engine);
    let served = false;
    vi.spyOn(engine, 'find').mockImplementation(async (object: any, options: any) => {
      // This replica's read of the old name, taken before the other replica's write.
      if (object === 'sys_user_position' && !served && JSON.stringify(options?.where ?? {}).includes('"sales_rep"')) {
        served = true;
        return [holder('h1', 'u1', 'sales_rep', 'org_a')] as any;
      }
      return realFind(object, options);
    });
    const update = vi.spyOn(engine, 'update');

    const report = await carryRenamedPositionHolders(engine as any, { catalog: catalogOf(entry('crm_sales_rep', CRM, ['sales_rep'])) });

    expect(report.carried).toEqual([expect.objectContaining({ rows: 0, alreadyHolds: [] })]);
    expect(update).not.toHaveBeenCalled();
  });
});

describe('at boot', () => {
  it('never throws: a catalog that cannot be read is said once at warn', async () => {
    const engine = await boot();
    const warn = vi.fn();
    const report = await carryRenamedPositionHoldersAtBoot(
      engine as any,
      { catalog: { list: async () => { throw new Error('catalog down'); } } },
      { warn },
    );
    expect(report).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('did not finish');
  });
});

/**
 * [#33238] After the boot, in a RUNNING kernel: a real `ObjectKernel` with the
 * SQL driver, `ObjectQLPlugin` and the real `SecurityPlugin`, and a door that
 * does what the marketplace install-local door does — a hot install
 * `manifest.register`s the package and then announces `metadata:reloaded`
 * naming it (`announceHotInstall`, pinned on that door in
 * `marketplace-install-local-hot-resync.test.ts`); an uninstall withdraws it
 * through `SchemaRegistry.uninstallPackage`.
 */
const HOT = 'com.acme.hot';

/** The package at `version`: v1 ships `hot_sales_rep`; v2 renames it, declaring the old name. Both ship the CONTROL `hot_auditor`. */
const hotPackage = (version: '1.0.0' | '2.0.0') => ({
  id: HOT,
  name: 'Hot install',
  version,
  type: 'app',
  namespace: 'hot',
  positions: [
    version === '1.0.0' ? { name: 'hot_sales_rep', label: 'Sales rep' } : { name: 'hot_crm_sales_rep', label: 'Sales rep', renamedFrom: ['hot_sales_rep'] },
    { name: 'hot_auditor', label: 'Auditor' },
  ],
});

async function runningKernel() {
  const kernel = new ObjectKernel({ logger: { level: 'silent' } });
  const logger = (kernel as unknown as { logger: { warn: (...a: unknown[]) => void } }).logger;
  const warnings: string[] = [];
  vi.spyOn(logger, 'warn').mockImplementation((...a: unknown[]) => void warnings.push(String(a[0])));
  let door: PluginContext | undefined;
  await kernel.use({
    name: 'test.hot.driver',
    type: 'standard',
    version: '1.0.0',
    async init(ctx: PluginContext) {
      ctx.registerService('driver.default', new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }));
    },
  } as Plugin);
  await kernel.use(new ObjectQLPlugin());
  await kernel.use(new SecurityPlugin({ fallbackPermissionSet: null }));
  await kernel.use({
    name: 'test.hot.door',
    type: 'standard',
    version: '1.0.0',
    dependencies: ['com.objectstack.engine.objectql'],
    async init(ctx: PluginContext) {
      door = ctx;
      const manifest = ctx.getService<{ register(m: unknown): unknown }>('manifest');
      // The identity objects the security plugin's store reads (a test kit's `createIdentityObjectsPlugin`).
      await manifest.register({ id: 'test.hot.identity', name: 'Identity', version: '1.0.0', type: 'plugin', objects: [SysUser, SysMember, SysOrganization] });
      await manifest.register(hotPackage('1.0.0'));
    },
  } as Plugin);
  await kernel.bootstrap();
  const ql = kernel.getService<ObjectQL>('objectql');
  const served = async (): Promise<string[]> =>
    (await createSecurityCatalogReader({ registry: (ql as any).registry, metadata: { get: async () => undefined, list: async () => [] } }).list('position')).map((e) => e.name);
  return {
    kernel,
    ql,
    warnings,
    served,
    /** The door's hot install (or upgrade): register `version`, then announce it. */
    async hotInstall(version: '1.0.0' | '2.0.0'): Promise<void> {
      await door!.getService<{ register(m: unknown): unknown }>('manifest').register(hotPackage(version));
      await door!.trigger('metadata:reloaded', { changed: [`app/${HOT}`] });
    },
    /** The door's uninstall: the running kernel withdraws the package; its holder rows stay. */
    uninstall(): void {
      (ql as any).registry.uninstallPackage(HOT);
    },
  };
}

const renameWarnings = (warnings: readonly string[]) => warnings.filter((w) => w.includes('position rename'));

describe('after the boot: a hot install carries its holders without a restart (#33238)', () => {
  it('a running kernel, v1 uninstalled, v2 hot-installed renaming a position: its holder holds the new name at once; the CONTROL is untouched; a second install is a no-op', async () => {
    const k = await runningKernel();
    try {
      await seed(k.ql, 'sys_user_position', [holder('h1', 'u1', 'hot_sales_rep', 'org_a'), holder('h2', 'u2', 'hot_auditor', 'org_a')]);
      k.uninstall();
      expect(await k.served()).not.toContain('hot_sales_rep');

      await k.hotInstall('2.0.0');

      expect(await positionsById(k.ql)).toEqual({ h1: 'hot_crm_sales_rep', h2: 'hot_auditor' });
      expect(renameWarnings(k.warnings)).toEqual([]);

      // Idempotent: the same install again reads the old name, finds nobody on it, writes nothing and says nothing.
      const update = vi.spyOn(k.ql, 'update');
      const before = k.warnings.length;
      await k.hotInstall('2.0.0');
      expect(update.mock.calls.filter(([object]) => object === 'sys_user_position')).toEqual([]);
      expect(renameWarnings(k.warnings.slice(before))).toEqual([]);
      expect(await positionsById(k.ql)).toEqual({ h1: 'hot_crm_sales_rep', h2: 'hot_auditor' });
    } finally {
      await Promise.race([k.kernel.shutdown(), new Promise<void>((r) => setTimeout(r, 10_000))]);
    }
  }, 60_000);

  it('a hot upgrade over v1, which the running kernel still serves: no holder is left on a position the catalog does not serve', async () => {
    const k = await runningKernel();
    try {
      await seed(k.ql, 'sys_user_position', [holder('h1', 'u1', 'hot_sales_rep', 'org_a'), holder('h2', 'u2', 'hot_auditor', 'org_a')]);

      await k.hotInstall('2.0.0');

      // Measured: a re-register of an installed id withdraws nothing of the
      // version before it, so `hot_sales_rep` still serves until the restart
      // and the old name reads as still declared (no move); the boot after
      // the restart carries it. Either way, no holder names nothing.
      const served = new Set(await k.served());
      const positions = await positionsById(k.ql);
      expect(Object.values(positions).filter((p) => !served.has(String(p)))).toEqual([]);
      expect(positions.h2).toBe('hot_auditor');
    } finally {
      await Promise.race([k.kernel.shutdown(), new Promise<void>((r) => setTimeout(r, 10_000))]);
    }
  }, 60_000);
});

describe('the runner: one boot run, then one run per reload', () => {
  const quietEngine = () => ({ find: vi.fn(async () => []), update: vi.fn(async () => ({})) });

  it('a reload heard before the boot run reads nothing: the catalog is still being filled', async () => {
    const engine = quietEngine();
    const list = vi.fn(async () => [entry('crm_sales_rep', CRM, ['sales_rep'])]);
    const runs = createPositionRenameCarryRuns(engine as any, () => ({ catalog: { list }, switchedOff: async () => new Set() }), { warn: vi.fn() });

    expect(await runs.afterReload()).toBeUndefined();
    expect(list).not.toHaveBeenCalled();
    expect(engine.find).not.toHaveBeenCalled();

    await runs.atBoot();
    expect(list).toHaveBeenCalledTimes(1);
    await runs.afterReload();
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('a refusal said at boot is not said again while it stands, and is said again once it has cleared and comes back', async () => {
    const engine = quietEngine();
    let catalog = [entry('crm_sales_rep', CRM, ['sales_rep']), entry('sales_rep', HR)];
    const warn = vi.fn();
    const runs = createPositionRenameCarryRuns(engine as any, () => ({ catalog: { list: async () => catalog }, switchedOff: async () => new Set() }), { warn });

    await runs.atBoot();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("'sales_rep' → 'crm_sales_rep'");
    await runs.afterReload();
    expect(warn).toHaveBeenCalledTimes(1);

    catalog = [entry('crm_sales_rep', CRM, ['sales_rep'])];
    await runs.afterReload();
    expect(warn).toHaveBeenCalledTimes(1);
    catalog = [entry('crm_sales_rep', CRM, ['sales_rep']), entry('sales_rep', HR)];
    await runs.afterReload();
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('runs never overlap: a reload that lands during a run waits for it', async () => {
    const engine = quietEngine();
    let open = 0;
    let most = 0;
    const list = async () => {
      open += 1;
      most = Math.max(most, open);
      await new Promise((r) => setTimeout(r, 5));
      open -= 1;
      return [];
    };
    const runs = createPositionRenameCarryRuns(engine as any, () => ({ catalog: { list } }), { warn: vi.fn() });
    await Promise.all([runs.atBoot(), runs.afterReload(), runs.afterReload()]);
    expect(most).toBe(1);
  });

  it('never throws past the runner: a failed run is said, and the next run still runs', async () => {
    const engine = quietEngine();
    let fail = true;
    const warn = vi.fn();
    const runs = createPositionRenameCarryRuns(engine as any, () => ({
      catalog: { list: async () => { if (fail) throw new Error('catalog down'); return []; } },
    }), { warn });
    expect(await runs.atBoot()).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    fail = false;
    expect(await runs.afterReload()).toEqual({ carried: [], refused: [], failed: [], leftBehind: [], notRead: [] });
  });
});
