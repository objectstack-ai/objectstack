// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0126 §6 wall 3] The access upgrade check as `SecurityPlugin` registers
 * it (`security.accessUpgradeCheck`): a REAL `ObjectQL` engine over the SQL
 * driver holding version 1 of a vendor package, the real plugin started on
 * it, and the service the plugin registered asked about version 2.
 *
 * Pins what the marketplace door refuses on: the findings the upgrade would
 * CREATE — for each of the four access types, with a CONTROL that keeps the
 * name — and nothing that predates it. Also the two clone-body cases the card
 * names (a field the new version removed, a field deny the managed set
 * gained), read through the registry's own record of version 1, and the
 * fail-closed answers.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import {
  SysMetadataObject, SysMetadataHistoryObject, SysMetadataCommitObject, SysMetadataAuditObject,
} from '@objectstack/metadata-core';
import { SysOrganization } from '@objectstack/platform-objects/identity';
import { SysMetadataActivation } from '@objectstack/platform-objects/system';

import { SecurityPlugin } from './security-plugin.js';
import { SysUserPermissionSet } from './objects/sys-user-permission-set.object.js';
import {
  ACCESS_UPGRADE_CHECK_SERVICE,
  accessUpgradeDelta,
  type AccessUpgradeCheck,
  type AccessUpgradeCheckResult,
} from './access-upgrade-check.js';
import type { AccessUpgradeReport } from './access-upgrade-report.js';

const SYS = { isSystem: true } as const;
const VENDOR = 'com.acme.u2';

interface Names { set: string; position: string; rule: string; capability: string | null }
const V1: Names = { set: 'u2_sales_rep', position: 'u2_lead', rule: 'u2_share_open', capability: 'u2.export' };

function vendorBody(version: string, names: Names, extra: { fields?: Record<string, unknown>; setFields?: Record<string, unknown> } = {}) {
  return {
    id: VENDOR, name: 'U2 vendor', version, type: 'app',
    objects: [{ name: 'u2_deal', label: 'Deal', fields: extra.fields ?? { amount: { type: 'number' }, stage: { type: 'text' } } }],
    capabilities: names.capability ? [{ name: names.capability, label: 'Export' }] : [],
    permissions: [{
      name: names.set, label: 'Sales rep',
      objects: { u2_deal: { allowRead: true, allowEdit: true } },
      ...(extra.setFields ? { fields: extra.setFields } : {}),
      ...(names.capability ? { systemPermissions: [names.capability] } : {}),
    }],
    positions: [{ name: names.position, label: 'Lead', permissionSets: [names.set] }],
    sharingRules: [{ name: names.rule, object: 'u2_deal' }],
  };
}

const engines: ObjectQL[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  while (engines.length) {
    try { await engines.pop()?.destroy(); } catch { /* noop */ }
  }
});

interface Seed {
  ledger?: Array<{ type: string; name: string; packageId?: string; active: boolean }>;
  customerSets?: Array<Record<string, unknown>>;
  failLedger?: boolean;
}

async function boot(seed: Seed = {}, start = true) {
  const engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
    true,
  );
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.access-upgrade-check', name: 'Access upgrade check', version: '1.0.0',
    type: 'plugin', scope: 'system',
    objects: [
      SysOrganization, SysUserPermissionSet, SysMetadataActivation,
      SysMetadataObject, SysMetadataHistoryObject, SysMetadataCommitObject, SysMetadataAuditObject,
    ],
  } as any);
  // Version 1 of the vendor package, as the boot registered it.
  const installed = vendorBody('1.0.0', V1, { setFields: { 'u2_deal.amount': { readable: true, editable: true } } });
  engine.registerApp(installed as any);
  await engine.syncSchemas();
  engines.push(engine);
  const registry = (engine as any).registry;
  for (const set of installed.permissions) registry.registerItem('permission', set, 'name', VENDOR);
  for (const position of installed.positions) registry.registerItem('position', position, 'name', VENDOR);
  for (const capability of installed.capabilities) registry.registerItem('capability', capability, 'name', VENDOR);

  const customerSets = seed.customerSets ?? [];
  const metadata = {
    get: async (type: string, name: string) => (type === 'permission' ? customerSets.find((s) => s.name === name) ?? null : null),
    list: async (type: string) => (type === 'permission' ? customerSets : []),
  };
  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata,
    protocol: new ObjectStackProtocolImplementation(engine as never, () => new Map(), undefined),
    sharingRules: { listDeclaredRules: async () => installed.sharingRules.map((r) => ({ ...r, packageId: VENDOR })) },
  };
  const registered = new Map<string, unknown>();
  const ctx: any = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    hook: () => undefined,
    registerService: (name: string, service: unknown) => registered.set(name, service),
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
  await plugin.init(ctx);
  if (start) await plugin.start(ctx);
  vi.spyOn((engine as any).logger, 'warn').mockImplementation(() => undefined);

  let n = 0;
  for (const row of seed.ledger ?? []) {
    await engine.insert('sys_metadata_activation', {
      id: `act_${n++}`, metadata_type: row.type, name: row.name, package_id: row.packageId ?? VENDOR, active: row.active,
    }, { context: SYS } as any);
  }
  if (seed.failLedger) {
    const find = engine.find.bind(engine);
    vi.spyOn(engine, 'find').mockImplementation(async (object: string, options: any) => {
      if (object === 'sys_metadata_activation') throw new Error('ledger store offline');
      return find(object, options);
    });
  }
  return registered.get(ACCESS_UPGRADE_CHECK_SERVICE) as AccessUpgradeCheck;
}

const ask = (check: AccessUpgradeCheck, names: Names, extra?: Parameters<typeof vendorBody>[2]) =>
  check.check({ packageId: VENDOR, manifest: vendorBody('2.0.0', names, extra) });

function findings(result: AccessUpgradeCheckResult): AccessUpgradeReport {
  if (result.outcome !== 'findings') throw new Error(`expected findings, got ${JSON.stringify(result)}`);
  return result.findings;
}

describe('[ADR-0126 §6 wall 3] security.accessUpgradeCheck, as SecurityPlugin registers it', () => {
  it('permission set: a switched-off set the upgrade renames is a suspected re-enablement, naming the binding position', async () => {
    const check = await boot({ ledger: [{ type: 'permission', name: V1.set, active: false }] });
    const report = findings(await ask(check, { ...V1, set: 'u2_sales_representative' }));
    expect(report.reEnablements).toEqual([{
      type: 'permission', name: V1.set, packageId: VENDOR,
      candidates: [{ name: 'u2_sales_representative', positions: [V1.position] }],
    }]);
  });

  it('position: a switched-off position the upgrade renames is a suspected re-enablement', async () => {
    const check = await boot({ ledger: [{ type: 'position', name: V1.position, active: false }] });
    const report = findings(await ask(check, { ...V1, position: 'u2_team_lead' }));
    expect(report.reEnablements).toEqual([{
      type: 'position', name: V1.position, packageId: VENDOR, candidates: [{ name: 'u2_team_lead', positions: [] }],
    }]);
  });

  it('sharing rule: a switched-off declared rule the upgrade renames is a suspected re-enablement', async () => {
    const check = await boot({ ledger: [{ type: 'sharing_rule', name: V1.rule, active: false }] });
    const report = findings(await ask(check, { ...V1, rule: 'u2_share_open_deals' }));
    expect(report.reEnablements).toEqual([{
      type: 'sharing_rule', name: V1.rule, packageId: VENDOR, candidates: [{ name: 'u2_share_open_deals', positions: [] }],
    }]);
  });

  it('capability: a customer set naming a capability the upgrade drops is a broken reference', async () => {
    const check = await boot({
      customerSets: [{ name: 'cust_exporter', label: 'Exporter', _provenance: 'org', objects: {}, systemPermissions: [V1.capability] }],
    });
    const report = findings(await ask(check, { ...V1, capability: null }));
    expect(report.brokenReferences).toEqual([
      { type: 'permission', name: 'cust_exporter', missing: [{ kind: 'capability', name: V1.capability }] },
    ]);
  });

  for (const type of ['permission', 'position', 'sharing_rule'] as const) {
    it(`${type} CONTROL: the upgrade that keeps the switched-off name is clean`, async () => {
      const name = type === 'permission' ? V1.set : type === 'position' ? V1.position : V1.rule;
      const check = await boot({ ledger: [{ type, name, active: false }] });
      expect(await ask(check, V1)).toEqual({ outcome: 'clean' });
    });
  }

  it('capability CONTROL: the upgrade that keeps the capability is clean', async () => {
    const check = await boot({
      customerSets: [{ name: 'cust_exporter', label: 'Exporter', _provenance: 'org', objects: {}, systemPermissions: [V1.capability] }],
    });
    expect(await ask(check, V1)).toEqual({ outcome: 'clean' });
  });

  it('a customer set naming a field the upgrade removes is a broken reference — version 1 read from the registry', async () => {
    const check = await boot({
      customerSets: [{
        name: 'cust_deal_reader', label: 'Deal reader', _provenance: 'org',
        objects: { u2_deal: { allowRead: true } }, fields: { 'u2_deal.stage': { readable: true } },
      }],
    });
    const report = findings(await ask(check, V1, { fields: { amount: { type: 'number' } } }));
    expect(report.brokenReferences).toEqual([
      { type: 'permission', name: 'cust_deal_reader', missing: [{ kind: 'field', name: 'u2_deal.stage' }] },
    ]);
  });

  it('a field deny the managed set gains, which a customer set granting the object lacks, is reported', async () => {
    const check = await boot({
      customerSets: [{ name: 'cust_deal_reader', label: 'Deal reader', _provenance: 'org', objects: { u2_deal: { allowRead: true } } }],
    });
    const report = findings(await ask(check, V1, { setFields: { 'u2_deal.amount': { readable: false } } }));
    expect(report.uncoveredDenies).toEqual([{
      managedSet: V1.set, packageId: VENDOR, customerSet: 'cust_deal_reader', object: 'u2_deal',
      fields: [{ field: 'u2_deal.amount', denies: 'read' }],
    }]);
  });

  it('a finding that predates the upgrade is not the upgrade\'s: the answer is clean', async () => {
    const check = await boot({ ledger: [{ type: 'permission', name: 'gone_set', packageId: 'com.other.pkg', active: false }] });
    expect(await ask(check, V1)).toEqual({ outcome: 'clean' });
  });

  it('a ledger that cannot be read stops the check — never "no finding"', async () => {
    const check = await boot({ ledger: [{ type: 'permission', name: V1.set, active: false }], failLedger: true });
    expect(await ask(check, V1)).toMatchObject({ outcome: 'stopped', stop: 'scan-unreadable', reading: 'sys_metadata_activation' });
  });

  it('before the plugin starts the check is unbound, and says so', async () => {
    const check = await boot({}, false);
    expect(await ask(check, V1)).toMatchObject({ outcome: 'stopped', stop: 'unbound' });
  });
});

describe('accessUpgradeDelta', () => {
  const empty = (): AccessUpgradeReport => ({
    orphans: [], reEnablements: [], collisions: [], brokenReferences: [], uncoveredDenies: [], absent: [],
  });

  it('keeps only what grew: a new candidate, a new missing name, a new uncovered field', () => {
    const before = empty();
    before.reEnablements.push({ type: 'permission', name: 'a', packageId: 'p', candidates: [{ name: 'b', positions: [] }] });
    before.brokenReferences.push({ type: 'permission', name: 's', missing: [{ kind: 'field', name: 'o.x' }] });
    before.uncoveredDenies.push({ managedSet: 'm', packageId: 'p', customerSet: 'c', object: 'o', fields: [{ field: 'o.x', denies: 'read' }] });
    const after = empty();
    after.reEnablements.push({
      type: 'permission', name: 'a', packageId: 'p', candidates: [{ name: 'b', positions: [] }, { name: 'c', positions: [] }],
    });
    after.brokenReferences.push({ type: 'permission', name: 's', missing: [{ kind: 'field', name: 'o.x' }, { kind: 'field', name: 'o.y' }] });
    after.uncoveredDenies.push({
      managedSet: 'm', packageId: 'p', customerSet: 'c', object: 'o',
      fields: [{ field: 'o.x', denies: 'read' }, { field: 'o.y', denies: 'edit' }],
    });
    const delta = accessUpgradeDelta(before, after);
    expect(delta.reEnablements[0].candidates).toEqual([{ name: 'c', positions: [] }]);
    expect(delta.brokenReferences[0].missing).toEqual([{ kind: 'field', name: 'o.y' }]);
    expect(delta.uncoveredDenies[0].fields).toEqual([{ field: 'o.y', denies: 'edit' }]);
  });

  it('an unchanged report has an empty delta', () => {
    const report = empty();
    report.orphans.push({ type: 'position', name: 'x', packageId: null, switchedOff: true });
    report.collisions.push({ rule: 'r', packageId: 'p', rowId: '1', organizationId: 'o' });
    const delta = accessUpgradeDelta(report, report);
    expect([delta.orphans, delta.collisions, delta.reEnablements, delta.brokenReferences, delta.uncoveredDenies]).toEqual([[], [], [], [], []]);
  });
});
