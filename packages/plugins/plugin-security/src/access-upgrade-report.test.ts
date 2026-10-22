// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0126 §6 wall 3] The access-class upgrade comparison and its boot
 * report — pins per access type (permission set, position, sharing rule,
 * capability), each under `single` (the administrator is told) and walled (the
 * operator alone), each beside a CONTROL in which the upgrade left the
 * customer's choice intact and nothing is raised.
 *
 * The engine is an in-memory double of the two reads the report makes (`find`
 * by equality, `getObject`); the catalog is a double of the security catalog
 * read. Both are the module's declared seams. The plugin's own wiring, on a
 * real engine, is pinned in `access-upgrade-report.wiring.test.ts`.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetPlatformAdminEmailMemo, type SecurityCatalogEntry, type SecurityCatalogReader } from '@objectstack/core';
import {
  ACCESS_UPGRADE_TOPIC,
  accessUpgradeDedupKey,
  collectAccessUpgradeFindings,
  criteriaFields,
  reportAccessUpgrade,
  type AccessUpgradeNotifier,
  type DeclaredRuleLike,
} from './access-upgrade-report.js';

const OWNER_ENV = 'OS_PLATFORM_OWNER_EMAIL';
const OPERATOR = 'operator@vendor.example';
const DEFAULT_ORG = 'org_default';
const VENDOR = 'com.acme.crm';

afterEach(() => {
  delete process.env[OWNER_ENV];
  resetPlatformAdminEmailMemo();
  vi.restoreAllMocks();
});

type Row = Record<string, unknown>;

/** The registry's objects: name → field names. */
const OBJECTS: Record<string, string[]> = {
  account: ['id', 'name', 'region', 'revenue', 'margin'],
  opportunity: ['id', 'name', 'stage', 'amount'],
  sys_metadata_activation: ['id', 'metadata_type', 'name', 'package_id', 'active'],
  sys_sharing_rule: ['id', 'name', 'organization_id', 'object_name', 'criteria_json'],
  sys_organization: ['id', 'slug'],
  sys_user_permission_set: ['id', 'user_id', 'permission_set', 'organization_id'],
};

interface Fake {
  tables: Record<string, Row[]>;
  objects: Record<string, string[]>;
  failOn?: string;
}

function fakeEngine(fake: Fake) {
  const getObject = (name: string) =>
    fake.objects[name] ? { name, fields: Object.fromEntries(fake.objects[name].map((f) => [f, { type: 'text' }])) } : undefined;
  return {
    registry: { getObject },
    getObject,
    async find(object: string, options: Record<string, any>): Promise<Row[]> {
      if (fake.failOn === object) throw new Error(`${object} is unreachable`);
      const where = (options.where ?? {}) as Row;
      const rows = (fake.tables[object] ?? []).filter((row) =>
        Object.entries(where).every(([k, v]) => (v && typeof v === 'object' ? true : row[k] === v)));
      const offset = options.offset ?? 0;
      return rows.slice(offset, offset + (options.limit ?? rows.length));
    },
  };
}

type Entry = { type: 'position' | 'permission' | 'capability'; name: string; packageId?: string; definition: Record<string, unknown> };

function fakeCatalog(entries: Entry[], fail = false): SecurityCatalogReader {
  const asEntry = (e: Entry): SecurityCatalogEntry => ({
    type: e.type, name: e.name, source: 'registry', definition: { name: e.name, ...e.definition },
    ...(e.packageId ? { packageId: e.packageId } : {}),
  });
  return {
    async list(type) {
      if (fail) throw new Error('catalog reader failed');
      return entries.filter((e) => e.type === type).map(asEntry);
    },
    async resolve(type, name) {
      if (fail) throw new Error('catalog reader failed');
      const found = entries.find((e) => e.type === type && e.name === name);
      return found ? asEntry(found) : undefined;
    },
  };
}

const vendor = (type: Entry['type'], name: string, definition: Record<string, unknown> = {}): Entry =>
  ({ type, name, packageId: VENDOR, definition });
const customer = (type: Entry['type'], name: string, definition: Record<string, unknown> = {}): Entry =>
  ({ type, name, definition: { ...definition, _provenance: 'org' } });
const switchedOff = (metadata_type: string, name: string, package_id: string | null = VENDOR): Row =>
  ({ id: `act_${metadata_type}_${name}`, metadata_type, name, package_id, active: false });

/** A deployment: its ledger, rule rows, registry, and the people to tell. */
function deployment(opts: {
  ledger?: Row[];
  rules?: Row[];
  catalog?: Entry[];
  declared?: DeclaredRuleLike[] | null;
  objects?: Record<string, string[]>;
}) {
  const fake: Fake = {
    objects: { ...OBJECTS, ...(opts.objects ?? {}) },
    tables: {
      sys_metadata_activation: opts.ledger ?? [],
      sys_sharing_rule: opts.rules ?? [],
      sys_organization: [{ id: DEFAULT_ORG, slug: 'default' }],
      sys_user_permission_set: [
        { id: 'g_admin', user_id: 'usr_admin', permission_set: 'admin_full_access', organization_id: DEFAULT_ORG },
        { id: 'g_tenant_admin', user_id: 'usr_other', permission_set: 'admin_full_access', organization_id: 'org_other' },
      ],
    },
  };
  const engine = fakeEngine(fake);
  const catalog = fakeCatalog(opts.catalog ?? []);
  const sharingRules = opts.declared === null ? undefined : { listDeclaredRules: async () => opts.declared ?? [] };
  return { fake, engine, catalog, sharingRules };
}

const notifier = () => {
  const emit = vi.fn(async (_input: Parameters<AccessUpgradeNotifier['emit']>[0]) => ({ notificationId: 'n1' }));
  return { emit };
};
const logger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });

/** Run the boot entry under a posture; the operator address is always configured. */
async function boot(d: ReturnType<typeof deployment>, posture: 'single' | 'walled') {
  process.env[OWNER_ENV] = OPERATOR;
  resetPlatformAdminEmailMemo();
  const messaging = notifier();
  const log = logger();
  const out = await reportAccessUpgrade(d.engine, {
    catalog: d.catalog, sharingRules: d.sharingRules, messaging, walled: posture === 'walled', logger: log,
  });
  return { ...out, messaging, log };
}

/** What the people told were sent, or `undefined` for nobody. */
const told = (r: Awaited<ReturnType<typeof boot>>) => {
  const call = r.messaging.emit.mock.calls[0]?.[0];
  return call && { audience: [...call.audience], organizationId: call.organizationId, topic: call.topic, severity: call.severity };
};
const SINGLE_AUDIENCE = { audience: [OPERATOR, 'usr_admin'], organizationId: DEFAULT_ORG, topic: ACCESS_UPGRADE_TOPIC, severity: 'warning' };
const WALLED_AUDIENCE = { audience: [OPERATOR], organizationId: undefined, topic: ACCESS_UPGRADE_TOPIC, severity: 'warning' };

// ── The four access types ────────────────────────────────────────────────────

/** The acceptance: a set the customer switched off, renamed by the vendor, its own position binding the new name. */
const renamedSet = (renamed: boolean) => deployment({
  ledger: [switchedOff('permission', 'acme_sales_rep')],
  catalog: [
    vendor('permission', renamed ? 'acme_sales_representative' : 'acme_sales_rep', { objects: { account: { allowRead: true } } }),
    vendor('permission', 'acme_viewer', { objects: {} }),
    vendor('position', 'acme_sales_lead', { permissionSets: [renamed ? 'acme_sales_representative' : 'acme_sales_rep'] }),
  ],
});

describe('permission set: a switched-off set renamed by the vendor', () => {
  for (const posture of ['single', 'walled'] as const) {
    it(`${posture}: names the old name, the new name and the positions that bind it, and tells ${posture === 'single' ? 'the administrator' : 'the operator alone'}`, async () => {
      const r = await boot(renamedSet(true), posture);
      expect(r.report.reEnablements).toEqual([{
        type: 'permission', name: 'acme_sales_rep', packageId: VENDOR,
        candidates: [
          { name: 'acme_sales_representative', positions: ['acme_sales_lead'] },
          { name: 'acme_viewer', positions: [] },
        ],
      }]);
      expect(r.report.orphans).toEqual([{ type: 'permission', name: 'acme_sales_rep', packageId: VENDOR, switchedOff: true }]);
      expect(r.delivery.outcome).toBe('notified');
      expect(told(r)).toEqual(posture === 'single' ? SINGLE_AUDIENCE : WALLED_AUDIENCE);
    });

    it(`${posture} CONTROL: the switched-off name still ships — no finding, nobody told`, async () => {
      const r = await boot(renamedSet(false), posture);
      expect(r.report.orphans).toEqual([]);
      expect(r.report.reEnablements).toEqual([]);
      expect(r.delivery.outcome).toBe('clean');
      expect(r.messaging.emit).not.toHaveBeenCalled();
    });
  }

  it('a candidate a ledger row already covers is no candidate; a row with no package is an orphan, never a re-enablement', async () => {
    const d = deployment({
      ledger: [
        switchedOff('permission', 'acme_sales_rep'),
        switchedOff('permission', 'acme_viewer'),
        switchedOff('permission', 'env_gone', null),
      ],
      catalog: [vendor('permission', 'acme_viewer'), vendor('permission', 'acme_sales_representative')],
    });
    const report = await collectAccessUpgradeFindings(d.engine, d);
    expect(report.reEnablements.map((r) => [r.name, r.candidates.map((c) => c.name)]))
      .toEqual([['acme_sales_rep', ['acme_sales_representative']]]);
    expect(report.orphans.map((o) => o.name)).toEqual(['acme_sales_rep', 'env_gone']);
  });

  it('a switched-ON orphan is a dead row: listed, never a re-enablement', async () => {
    const d = deployment({
      ledger: [{ ...switchedOff('permission', 'acme_old'), active: true }],
      catalog: [vendor('permission', 'acme_new')],
    });
    const report = await collectAccessUpgradeFindings(d.engine, d);
    expect(report.orphans).toEqual([{ type: 'permission', name: 'acme_old', packageId: VENDOR, switchedOff: false }]);
    expect(report.reEnablements).toEqual([]);
  });
});

const renamedPosition = (renamed: boolean) => deployment({
  ledger: [switchedOff('position', 'acme_field_rep')],
  catalog: [vendor('position', renamed ? 'acme_field_representative' : 'acme_field_rep')],
});

describe('position: a switched-off position renamed by the vendor', () => {
  for (const posture of ['single', 'walled'] as const) {
    it(`${posture}: a suspected re-enablement with its candidate, raised to ${posture === 'single' ? 'the administrator' : 'the operator alone'}`, async () => {
      const r = await boot(renamedPosition(true), posture);
      expect(r.report.reEnablements).toEqual([{
        type: 'position', name: 'acme_field_rep', packageId: VENDOR,
        candidates: [{ name: 'acme_field_representative', positions: [] }],
      }]);
      expect(told(r)).toEqual(posture === 'single' ? SINGLE_AUDIENCE : WALLED_AUDIENCE);
    });

    it(`${posture} CONTROL: the position still ships — nothing raised`, async () => {
      const r = await boot(renamedPosition(false), posture);
      expect(r.delivery.outcome).toBe('clean');
      expect(r.messaging.emit).not.toHaveBeenCalled();
    });
  }
});

const sharingDeployment = (upgraded: boolean) => deployment({
  ledger: [switchedOff('sharing_rule', 'acme_share_west')],
  declared: [
    { name: upgraded ? 'acme_share_western_region' : 'acme_share_west', object: 'account', packageId: VENDOR },
    { name: 'acme_share_east', object: 'account', packageId: VENDOR },
  ],
  rules: [
    // The customer's clone of the switched-off rule, under its own name.
    { id: 'srule_1', name: 'west_custom', organization_id: DEFAULT_ORG, object_name: 'account',
      criteria_json: JSON.stringify(upgraded ? { region: 'west', territory: 'pacific' } : { region: 'west' }) },
    ...(upgraded ? [{ id: 'srule_2', name: 'acme_share_east', organization_id: 'org_b', object_name: 'account', criteria_json: '{"region":"east"}' }] : []),
  ],
});

describe('sharing rule: a switched-off rule renamed, a collision, and a clone naming a removed field', () => {
  for (const posture of ['single', 'walled'] as const) {
    it(`${posture}: all three are listed, per organization, and raised to ${posture === 'single' ? 'the administrator' : 'the operator alone'}`, async () => {
      // `territory` was a field the vendor removed from `account`.
      const r = await boot(sharingDeployment(true), posture);
      expect(r.report.reEnablements).toEqual([{
        type: 'sharing_rule', name: 'acme_share_west', packageId: VENDOR,
        // Suspected: the vendor ships two unswitched rules, so both are candidates.
        candidates: [
          { name: 'acme_share_east', positions: [] },
          { name: 'acme_share_western_region', positions: [] },
        ],
      }]);
      expect(r.report.collisions).toEqual([
        { rule: 'acme_share_east', packageId: VENDOR, rowId: 'srule_2', organizationId: 'org_b' },
      ]);
      expect(r.report.brokenReferences).toEqual([{
        type: 'sharing_rule', name: 'west_custom', rowId: 'srule_1', organizationId: DEFAULT_ORG,
        missing: [{ kind: 'field', name: 'account.territory' }],
      }]);
      expect(told(r)).toEqual(posture === 'single' ? SINGLE_AUDIENCE : WALLED_AUDIENCE);
    });

    it(`${posture} CONTROL: the rule still ships, no row takes a declared name, every criteria field exists — nothing raised`, async () => {
      const r = await boot(sharingDeployment(false), posture);
      expect(r.delivery.outcome).toBe('clean');
      expect(r.messaging.emit).not.toHaveBeenCalled();
    });
  }

  it('a rule row naming an object the registry lacks is reported by its object', async () => {
    const d = deployment({ rules: [{ id: 'srule_9', name: 'legacy', organization_id: null, object_name: 'acme_lead', criteria_json: '{"x":1}' }] });
    const report = await collectAccessUpgradeFindings(d.engine, d);
    expect(report.brokenReferences).toEqual([{
      type: 'sharing_rule', name: 'legacy', rowId: 'srule_9', organizationId: null, missing: [{ kind: 'object', name: 'acme_lead' }],
    }]);
  });
});

const capabilityDeployment = (removed: boolean) => deployment({
  catalog: [
    // The vendor's set carried `acme_export` until the upgrade removed it.
    vendor('permission', 'acme_analyst', { objects: {}, systemPermissions: removed ? [] : ['acme_export'] }),
    vendor('capability', 'manage_users'),
    customer('permission', 'my_analyst', { objects: {}, systemPermissions: ['acme_export', 'manage_users'] }),
  ],
});

describe('capability: a customer set naming a capability the vendor removed', () => {
  for (const posture of ['single', 'walled'] as const) {
    it(`${posture}: the clone body's capability is reported, and raised to ${posture === 'single' ? 'the administrator' : 'the operator alone'}`, async () => {
      const r = await boot(capabilityDeployment(true), posture);
      expect(r.report.brokenReferences).toEqual([{
        type: 'permission', name: 'my_analyst', missing: [{ kind: 'capability', name: 'acme_export' }],
      }]);
      expect(told(r)).toEqual(posture === 'single' ? SINGLE_AUDIENCE : WALLED_AUDIENCE);
    });

    it(`${posture} CONTROL: a package-shipped set still carries it (ADR-0066 ⑨) — nothing raised`, async () => {
      const r = await boot(capabilityDeployment(false), posture);
      expect(r.delivery.outcome).toBe('clean');
      expect(r.messaging.emit).not.toHaveBeenCalled();
    });
  }
});

describe('clone bodies against the registry', () => {
  it('a customer set naming a removed object, a removed field, and lacking a field deny the vendor set gained', async () => {
    const d = deployment({
      catalog: [
        vendor('permission', 'acme_rep', {
          objects: { account: { allowRead: true, allowEdit: true } },
          fields: { 'account.margin': { readable: false }, 'account.revenue': { readable: true, editable: false } },
        }),
        customer('permission', 'my_rep', {
          objects: { account: { allowRead: true, allowEdit: true }, acme_quote: { allowRead: true } },
          fields: { 'account.territory': { readable: true }, 'opportunity.discount': { readable: false } },
        }),
        // Grants the object for read only: the edit deny does not reach it, the read deny does.
        customer('permission', 'my_reader', { objects: { account: { allowRead: true } }, fields: { 'account.margin': { readable: false } } }),
      ],
    });
    const report = await collectAccessUpgradeFindings(d.engine, d);
    expect(report.brokenReferences).toEqual([{
      type: 'permission', name: 'my_rep',
      missing: [
        { kind: 'object', name: 'acme_quote' },
        { kind: 'field', name: 'account.territory' },
        { kind: 'field', name: 'opportunity.discount' },
      ],
    }]);
    expect(report.uncoveredDenies).toEqual([{
      managedSet: 'acme_rep', packageId: VENDOR, customerSet: 'my_rep', object: 'account',
      fields: [{ field: 'account.margin', denies: 'read' }, { field: 'account.revenue', denies: 'edit' }],
    }]);
  });

  it('CONTROL: a stack-declared set (no package, not authored here) and a matching clone are not judged', async () => {
    const d = deployment({
      catalog: [
        vendor('permission', 'acme_rep', { objects: { account: { allowRead: true } }, fields: { 'account.margin': { readable: false } } }),
        { type: 'permission', name: 'stack_set', definition: { objects: { ghost: { allowRead: true } } } },
        customer('permission', 'my_rep', { objects: { account: { allowRead: true } }, fields: { 'account.margin': { readable: false } } }),
      ],
    });
    const report = await collectAccessUpgradeFindings(d.engine, d);
    expect(report.brokenReferences).toEqual([]);
    expect(report.uncoveredDenies).toEqual([]);
  });
});

// ── A read that did not happen ───────────────────────────────────────────────

describe('fail closed: an unread answer is never "resolves nowhere"', () => {
  it('a catalog read that throws stops the report: no finding, nobody told, one warning', async () => {
    const d = renamedSet(true);
    process.env[OWNER_ENV] = OPERATOR;
    const messaging = notifier();
    const log = logger();
    const r = await reportAccessUpgrade(d.engine, { catalog: fakeCatalog([], true), messaging, walled: false, logger: log, sharingRules: d.sharingRules });
    expect(r.report).toMatchObject({ stopped: 'catalog-unreadable', orphans: [], reEnablements: [] });
    expect(r.delivery.outcome).toBe('stopped');
    expect(messaging.emit).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  it('a ledger scan that throws stops the report', async () => {
    const d = renamedSet(true);
    d.fake.failOn = 'sys_metadata_activation';
    const report = await collectAccessUpgradeFindings(d.engine, d);
    expect(report).toMatchObject({ stopped: 'scan-unreadable', stoppedReading: 'sys_metadata_activation', orphans: [] });
  });

  it('a declared sharing-rule read that throws stops the report', async () => {
    const d = sharingDeployment(true);
    const report = await collectAccessUpgradeFindings(d.engine, {
      catalog: d.catalog, sharingRules: { listDeclaredRules: async () => { throw new Error('registry unreachable'); } },
    });
    expect(report).toMatchObject({ stopped: 'sharing-unreadable', reEnablements: [], collisions: [] });
  });

  it('no sharing service: no sharing_rule row is judged an orphan, and the absence is named', async () => {
    const d = deployment({ ledger: [switchedOff('sharing_rule', 'acme_share_west')], declared: null });
    const report = await collectAccessUpgradeFindings(d.engine, d);
    expect(report.orphans).toEqual([]);
    expect(report.collisions).toEqual([]);
    expect(report.absent).toEqual(['sharingRules']);
  });

  it('no ledger object: the absence is named and nothing is judged from it', async () => {
    const d = renamedSet(true);
    delete d.fake.objects.sys_metadata_activation;
    const report = await collectAccessUpgradeFindings(d.engine, d);
    expect(report.absent).toEqual(['sys_metadata_activation']);
    expect(report.orphans).toEqual([]);
  });
});

// ── Delivery ─────────────────────────────────────────────────────────────────

describe('delivery: once per distinct finding set, and loud when it reaches nobody', () => {
  it('the dedup key is stable for one finding set and moves with it', async () => {
    const a = await collectAccessUpgradeFindings(renamedSet(true).engine, renamedSet(true));
    const b = await collectAccessUpgradeFindings(renamedSet(true).engine, renamedSet(true));
    const c = await collectAccessUpgradeFindings(renamedPosition(true).engine, renamedPosition(true));
    expect(accessUpgradeDedupKey(a)).toBe(accessUpgradeDedupKey(b));
    expect(accessUpgradeDedupKey(a)).not.toBe(accessUpgradeDedupKey(c));
    expect(accessUpgradeDedupKey(a).startsWith(`${ACCESS_UPGRADE_TOPIC}:`)).toBe(true);
  });

  it('the notification carries the findings and the dedup key', async () => {
    const r = await boot(renamedSet(true), 'single');
    const call = r.messaging.emit.mock.calls[0][0];
    expect(call.dedupKey).toBe(accessUpgradeDedupKey(r.report));
    expect((call.payload.findings as any).reEnablements[0].name).toBe('acme_sales_rep');
    expect(call.payload.counts).toEqual({ reEnablements: 1, orphans: 1, collisions: 0, brokenReferences: 0, uncoveredDenies: 0 });
  });

  it('no messaging service: the log says the findings reached nobody, with the remedy', async () => {
    const d = renamedSet(true);
    const log = logger();
    const r = await reportAccessUpgrade(d.engine, { catalog: d.catalog, walled: true, logger: log });
    expect(r.delivery).toMatchObject({ outcome: 'undelivered', reason: 'this composition has no messaging service' });
    expect(log.error.mock.calls.some(([m]) => String(m).includes('reached no administrator') && String(m).includes('OS_PLATFORM_OWNER_EMAIL'))).toBe(true);
  });

  it('walled with no operator configured: nobody is told, and the log says so — a tenant administrator is never the fallback', async () => {
    const d = renamedSet(true);
    const messaging = notifier();
    const log = logger();
    const r = await reportAccessUpgrade(d.engine, { catalog: d.catalog, messaging, walled: true, logger: log });
    expect(r.delivery).toMatchObject({ outcome: 'undelivered', reason: 'no platform operator is configured' });
    expect(messaging.emit).not.toHaveBeenCalled();
  });

  it('an emit that throws is reported undelivered, never thrown', async () => {
    const d = renamedSet(true);
    process.env[OWNER_ENV] = OPERATOR;
    const messaging = { emit: vi.fn(async () => { throw new Error('outbox down'); }) };
    const r = await reportAccessUpgrade(d.engine, { catalog: d.catalog, messaging, walled: false, logger: logger() });
    expect(r.delivery).toMatchObject({ outcome: 'undelivered', recipients: [OPERATOR, 'usr_admin'] });
  });

  it('the log line is written beside the notification, once per category', async () => {
    const r = await boot(sharingDeployment(true), 'single');
    const lines = r.log.error.mock.calls.map(([m]) => String(m));
    expect(lines.filter((m) => m.includes('no longer shipped under that name'))).toHaveLength(1);
    expect(lines.filter((m) => m.includes('hold the name of a declared sharing rule'))).toHaveLength(1);
    expect(r.messaging.emit).toHaveBeenCalledTimes(1);
  });
});

describe('criteria fields', () => {
  it('reads field names through the logical operators, first path segment only', () => {
    expect([...criteriaFields({ $and: [{ region: 'west' }, { $or: [{ 'owner.name': 'x' }, { stage: { $in: ['a'] } }] }] })].sort())
      .toEqual(['owner', 'region', 'stage']);
  });
});
