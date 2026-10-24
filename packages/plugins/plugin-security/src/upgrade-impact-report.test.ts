// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24447] The upgrade-impact comparison for the non-access classes and its
 * boot report — one pin per finding class, each beside a CONTROL in which the
 * upgrade left the customer's state intact and nothing is raised; the
 * acceptance case under `single` (the administrator is told) and walled (the
 * operator alone).
 *
 * The engine is an in-memory double of the reads the report makes (`find` by
 * equality, `getObject`), and the registry a double of the `SchemaRegistry`
 * reads it declares (`UpgradeImpactRegistry`). Both are the module's declared
 * seams. The plugin's own wiring, on a real engine and registry, is pinned in
 * `upgrade-impact-report.wiring.test.ts`.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetPlatformAdminEmailMemo } from '@objectstack/core';
import {
  NAV_DIAGNOSTICS,
  SCHEMA_REGISTRY,
  SETTINGS_SERVICE,
  UPGRADE_IMPACT_TOPIC,
  collectUpgradeImpactFindings,
  reportUpgradeImpact,
  upgradeImpactDedupKey,
  type NavDiagnosticLike,
  type ObjectContributorLike,
  type SettingsManifestLike,
  type UpgradeImpactRegistry,
} from './upgrade-impact-report.js';
import type { UpgradeReportNotifier } from './upgrade-report-delivery.js';

const OWNER_ENV = 'OS_PLATFORM_OWNER_EMAIL';
const OPERATOR = 'operator@vendor.example';
const DEFAULT_ORG = 'org_default';
const VENDOR = 'com.acme.crm';
const OTHER_VENDOR = 'com.acme.addon';
const AUTHORED = 'app.customer_crm';

afterEach(() => {
  delete process.env[OWNER_ENV];
  resetPlatformAdminEmailMemo();
  vi.restoreAllMocks();
});

type Row = Record<string, unknown>;

/** The stores the deployment holds, by name. */
const STORES = [
  'sys_metadata_activation', 'sys_metadata', 'sys_webhook', 'sys_setting', 'sys_platform_setting',
  'sys_organization', 'sys_user_permission_set',
];

/** The double refuses what it does not implement, rather than matching it silently. */
function matches(row: Row, where: Row): boolean {
  for (const [key, value] of Object.entries(where)) {
    if (key.startsWith('$') || (value !== null && typeof value === 'object')) {
      throw new Error(`the engine double does not implement the where clause ${key}`);
    }
    if (row[key] !== value) return false;
  }
  return true;
}

interface Fake {
  tables: Record<string, Row[]>;
  stores: string[];
  failOn?: string;
  registry?: Partial<UpgradeImpactRegistry>;
  finds: Array<{ object: string; fields?: string[] }>;
}

function fakeEngine(fake: Fake) {
  return {
    registry: fake.registry,
    getObject: (name: string) => (fake.stores.includes(name) ? { name, fields: {} } : undefined),
    async find(object: string, options: Record<string, any>): Promise<Row[]> {
      fake.finds.push({ object, fields: options.fields });
      if (fake.failOn === object) throw new Error(`${object} is unreachable`);
      const where = (options.where ?? {}) as Row;
      const rows = (fake.tables[object] ?? []).filter((row) => matches(row, where));
      const offset = options.offset ?? 0;
      return rows.slice(offset, offset + (options.limit ?? rows.length));
    },
  };
}

/** One registered item: a code artifact unless `tenant`. */
interface Item { type: string; name: string; packageId?: string; member?: string; tenant?: boolean }

/** One served object: its owner, its overlay and extenders, and the actions it serves. */
interface ObjectFixture {
  name: string;
  owner?: { packageId: string; fields: string[] };
  overlay?: { packageId?: string; fields: string[] };
  extenders?: Array<{ packageId: string; fields: string[] }>;
  actions?: Array<{ name: string; packageId?: string; tenant?: boolean }>;
}

const bodyOf = (i: Item) => ({
  name: i.name,
  _packageId: i.packageId ?? 'sys_metadata',
  _provenance: i.tenant ? 'org' : 'package',
  ...(i.member === undefined ? {} : { locale: i.member }),
});

/** A double of the `SchemaRegistry` reads, answering as the real one does. */
function fakeRegistry(r: {
  items?: Item[];
  objects?: ObjectFixture[];
  packages?: Record<string, { source: string; disabled?: boolean }>;
  apps?: Record<string, NavDiagnosticLike[]>;
}): UpgradeImpactRegistry {
  const items = r.items ?? [];
  const objects = r.objects ?? [];
  const packages: Record<string, { source: string; disabled?: boolean }> = {
    [VENDOR]: { source: 'code' }, [OTHER_VENDOR]: { source: 'code' }, [AUTHORED]: { source: 'authored' }, ...(r.packages ?? {}),
  };
  const disabled = (id?: string) => !!id && packages[id]?.disabled === true;
  const contributors = (o: ObjectFixture): ObjectContributorLike[] => [
    ...(o.owner ? [{ packageId: o.owner.packageId, ownership: 'own', definition: { name: o.name, fields: Object.fromEntries(o.owner.fields.map((f) => [f, {}])), _packageId: o.owner.packageId } }] : []),
    ...(o.overlay ? [{ packageId: o.overlay.packageId ?? 'sys_metadata', ownership: 'overlay', definition: { name: o.name, fields: Object.fromEntries(o.overlay.fields.map((f) => [f, {}])), _provenance: 'org' } }] : []),
    ...(o.extenders ?? []).map((e) => ({ packageId: e.packageId, ownership: 'extend', definition: { name: o.name, fields: Object.fromEntries(e.fields.map((f) => [f, {}])) } })),
  ];
  return {
    // Like the real lookup: prefer the named package, else any package's artifact.
    getArtifactItem(type, name, packageId, member) {
      const artifacts = items.filter((i) => i.type === type && i.name === name && !i.tenant && i.packageId
        && (member === undefined || i.member === member));
      const found = artifacts.find((i) => i.packageId === packageId) ?? artifacts[0];
      return found ? bodyOf(found) : undefined;
    },
    listItems(type, packageId) {
      return items.filter((i) => i.type === type && (!packageId || i.packageId === packageId) && !disabled(i.packageId)).map(bodyOf);
    },
    getAllObjects() {
      return objects.map((o) => ({
        name: o.name,
        _packageId: o.owner?.packageId,
        actions: (o.actions ?? []).map((a) => ({
          name: a.name,
          ...(a.packageId ? { _packageId: a.packageId } : {}),
          ...(a.tenant ? { _provenance: 'org' } : {}),
        })),
      }));
    },
    getObjectContributors(name) {
      const o = objects.find((x) => x.name === name);
      return o ? contributors(o) : [];
    },
    getPackagedObjectOwner(name) {
      const o = objects.find((x) => x.name === name);
      return o?.owner ? { packageId: o.owner.packageId } : undefined;
    },
    getPackage: (id) => packages[id],
    isPackageDisabled: disabled,
    getAllApps: () => Object.keys(r.apps ?? {}).map((name) => ({ name })),
    getAppNavDiagnostics: (app) => r.apps?.[app] ?? [],
  };
}

const MANIFESTS: SettingsManifestLike[] = [
  { namespace: 'mail', specifiers: [{ type: 'group', label: 'Sender' }, { key: 'from_address', type: 'text' }, { key: 'reply_to', type: 'text' }] },
  { namespace: 'storage', specifiers: [{ key: 'provider', type: 'select' }] },
];

/** A deployment: its stored state, its registry, and the people to tell. */
function deployment(opts: {
  ledger?: Row[];
  stored?: Row[];
  webhooks?: Row[];
  settings?: Row[];
  platformSettings?: Row[];
  registry?: Parameters<typeof fakeRegistry>[0] | null;
  manifests?: SettingsManifestLike[] | null;
  stores?: string[];
}) {
  const fake: Fake = {
    stores: opts.stores ?? STORES,
    finds: [],
    registry: opts.registry === null ? undefined : fakeRegistry(opts.registry ?? {}),
    tables: {
      sys_metadata_activation: opts.ledger ?? [],
      sys_metadata: opts.stored ?? [],
      sys_webhook: opts.webhooks ?? [],
      sys_setting: opts.settings ?? [],
      sys_platform_setting: opts.platformSettings ?? [],
      sys_organization: [{ id: DEFAULT_ORG, slug: 'default' }],
      sys_user_permission_set: [
        { id: 'g_admin', user_id: 'usr_admin', permission_set: 'admin_full_access', organization_id: DEFAULT_ORG },
      ],
    },
  };
  const settings = opts.manifests === null ? undefined : { listManifests: () => opts.manifests ?? MANIFESTS };
  return { fake, engine: fakeEngine(fake), settings };
}

const switchedOff = (metadata_type: string, name: string, package_id: string | null = VENDOR): Row =>
  ({ id: `act_${metadata_type}_${name}`, metadata_type, name, package_id, active: false });
const storedRow = (type: string, name: string, package_id: string | null, extra: Row = {}): Row =>
  ({ id: `md_${type}_${name}_${package_id ?? 'none'}`, type, name, package_id, state: 'active', ...extra });

const notifier = () => {
  const emit = vi.fn(async (_input: Parameters<UpgradeReportNotifier['emit']>[0]) => ({ notificationId: 'n1' }));
  return { emit };
};
const logger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });

/** Run the boot entry under a posture; the operator address is always configured. */
async function boot(d: ReturnType<typeof deployment>, posture: 'single' | 'walled') {
  process.env[OWNER_ENV] = OPERATOR;
  resetPlatformAdminEmailMemo();
  const messaging = notifier();
  const log = logger();
  const out = await reportUpgradeImpact(d.engine, { settings: d.settings, messaging, walled: posture === 'walled', logger: log });
  return { ...out, messaging, log };
}

const errorLines = (r: Awaited<ReturnType<typeof boot>>) => r.log.error.mock.calls.map(([m]) => String(m));

// ── C: the switched types ────────────────────────────────────────────────────

/** The acceptance: a flow the customer switched off, renamed by the vendor. */
const renamedFlow = (renamed: boolean) => deployment({
  ledger: [switchedOff('flow', 'acme_lead_router')],
  registry: {
    items: [
      { type: 'flow', name: renamed ? 'acme_lead_routing' : 'acme_lead_router', packageId: VENDOR },
      { type: 'flow', name: 'acme_nightly_sync', packageId: VENDOR },
      { type: 'flow', name: 'acme_other_vendor_flow', packageId: OTHER_VENDOR },
    ],
  },
});

describe('flow: a switched-off flow renamed by the vendor', () => {
  for (const posture of ['single', 'walled'] as const) {
    it(`${posture}: names the old name and every unswitched name of its package, and tells ${posture === 'single' ? 'the administrator' : 'the operator alone'}`, async () => {
      const r = await boot(renamedFlow(true), posture);
      expect(r.report.reEnablements).toEqual([{
        type: 'flow', name: 'acme_lead_router', packageId: VENDOR, candidates: ['acme_lead_routing', 'acme_nightly_sync'],
      }]);
      expect(r.report.orphans).toEqual([{ type: 'flow', name: 'acme_lead_router', packageId: VENDOR, switchedOff: true }]);
      expect(errorLines(r).some((m) => m.includes('a rename that makes the item active again'))).toBe(true);
      // The orphan is the re-enablement's own row: it is not logged a second time.
      expect(errorLines(r).some((m) => m.includes('so the switch covers nothing'))).toBe(false);
      if (posture === 'single') {
        expect(r.delivery.outcome).toBe('notified');
        const input = r.messaging.emit.mock.calls[0][0];
        expect({ topic: input.topic, audience: [...input.audience], organizationId: input.organizationId, dedupKey: input.dedupKey })
          .toEqual({ topic: UPGRADE_IMPACT_TOPIC, audience: [OPERATOR, 'usr_admin'], organizationId: DEFAULT_ORG, dedupKey: upgradeImpactDedupKey(r.report) });
        expect((input.payload as any).counts.reEnablements).toBe(1);
      } else {
        expect(r.messaging.emit).not.toHaveBeenCalled();
        expect(r.delivery).toMatchObject({ outcome: 'operator-log', recipients: [OPERATOR] });
        const line = r.log.error.mock.calls.find(([m]) => String(m).startsWith('[security] platform operator:'));
        expect(String(line?.[0])).toContain('the upgrade impact findings above are deployment-level');
        expect(line?.[2]).toEqual({ findingSet: upgradeImpactDedupKey(r.report), operators: [OPERATOR] });
      }
    });

    it(`${posture} CONTROL: the switched-off name still ships — no finding, nobody told`, async () => {
      const r = await boot(renamedFlow(false), posture);
      expect(r.report.orphans).toEqual([]);
      expect(r.report.reEnablements).toEqual([]);
      expect(r.delivery.outcome).toBe('clean');
      expect(r.messaging.emit).not.toHaveBeenCalled();
      expect(r.log.info.mock.calls.some(([m]) => String(m).includes('upgrade impact report: every flow'))).toBe(true);
    });
  }

  it('a candidate a ledger row already covers is no candidate; a row with no package is an orphan, never a re-enablement; a switched-ON orphan is a dead row', async () => {
    const d = deployment({
      ledger: [
        switchedOff('flow', 'acme_lead_router'),
        switchedOff('flow', 'acme_nightly_sync'),
        switchedOff('flow', 'env_gone', null),
        { ...switchedOff('webhook', 'acme_old_hook'), active: true },
      ],
      registry: {
        items: [
          { type: 'flow', name: 'acme_lead_routing', packageId: VENDOR },
          { type: 'flow', name: 'acme_nightly_sync', packageId: VENDOR },
          { type: 'webhook', name: 'acme_new_hook', packageId: VENDOR },
        ],
      },
    });
    const report = await collectUpgradeImpactFindings(d.engine, d);
    expect(report.reEnablements.map((r) => [r.name, r.candidates])).toEqual([['acme_lead_router', ['acme_lead_routing']]]);
    expect(report.orphans.map((o) => [o.type, o.name, o.switchedOff])).toEqual([
      ['flow', 'acme_lead_router', true], ['flow', 'env_gone', true], ['webhook', 'acme_old_hook', false],
    ]);
  });

  it('a disabled package\'s switched-off flow is no orphan: its items are withheld, not gone', async () => {
    const d = deployment({
      ledger: [switchedOff('flow', 'acme_lead_router')],
      registry: { items: [{ type: 'flow', name: 'acme_lead_router', packageId: VENDOR }], packages: { [VENDOR]: { source: 'code', disabled: true } } },
    });
    expect((await collectUpgradeImpactFindings(d.engine, d)).orphans).toEqual([]);
  });

  it('a tenant-authored flow of the switched name is no shipped flow: the switch is still an orphan', async () => {
    const d = deployment({
      ledger: [switchedOff('flow', 'acme_lead_router')],
      registry: { items: [{ type: 'flow', name: 'acme_lead_router', packageId: VENDOR, tenant: true }] },
    });
    expect((await collectUpgradeImpactFindings(d.engine, d)).orphans.map((o) => o.name)).toEqual(['acme_lead_router']);
  });
});

describe('action: a switched-off action, renamed or declared on a second object', () => {
  const objects = (opts: { renamed?: boolean; second?: boolean }): ObjectFixture[] => [
    { name: 'lead', owner: { packageId: VENDOR, fields: ['id'] }, actions: [{ name: opts.renamed ? 'acme_convert_lead' : 'acme_convert' }] },
    { name: 'contact', owner: { packageId: OTHER_VENDOR, fields: ['id'] }, actions: opts.second ? [{ name: 'acme_convert' }] : [] },
    { name: 'note', actions: [{ name: 'env_action', tenant: true }] },
  ];

  it('renamed: an orphan and a suspected re-enablement naming the embedded action its object\'s package ships', async () => {
    const d = deployment({ ledger: [switchedOff('action', 'acme_convert')], registry: { objects: objects({ renamed: true }) } });
    const report = await collectUpgradeImpactFindings(d.engine, d);
    expect(report.reEnablements).toEqual([{ type: 'action', name: 'acme_convert', packageId: VENDOR, candidates: ['acme_convert_lead'] }]);
    expect(report.sharedActionSwitches).toEqual([]);
  });

  it('declared on a second object by an upgrade: the one row switches both off', async () => {
    const d = deployment({ ledger: [switchedOff('action', 'acme_convert')], registry: { objects: objects({ second: true }) } });
    const r = await boot(d, 'single');
    expect(r.report.sharedActionSwitches).toEqual([{ name: 'acme_convert', packageId: VENDOR, objects: ['contact', 'lead'] }]);
    expect(r.report.orphans).toEqual([]);
    expect(errorLines(r).some((m) => m.includes('declared on more than one object'))).toBe(true);
    expect(r.delivery.outcome).toBe('notified');
  });

  it('CONTROL: one object declares it — no finding; a standalone code action resolves the name too', async () => {
    const d = deployment({
      ledger: [switchedOff('action', 'acme_convert'), switchedOff('action', 'acme_global_export')],
      registry: { objects: objects({}), items: [{ type: 'action', name: 'acme_global_export', packageId: VENDOR }] },
    });
    const report = await collectUpgradeImpactFindings(d.engine, d);
    expect(report.orphans).toEqual([]);
    expect(report.sharedActionSwitches).toEqual([]);
  });

  it('a switched-ON row on a shared name is no finding: it switches nothing off', async () => {
    const d = deployment({
      ledger: [{ ...switchedOff('action', 'acme_convert'), active: true }],
      registry: { objects: objects({ second: true }) },
    });
    expect((await collectUpgradeImpactFindings(d.engine, d)).sharedActionSwitches).toEqual([]);
  });
});

describe('stored flow: a row whose name a package now ships', () => {
  it('names the row and the package whose flow runs instead; a plural type spelling is the same type', async () => {
    const d = deployment({
      stored: [storedRow('flow', 'acme_lead_router', null), storedRow('flows', 'acme_nightly_sync', AUTHORED), storedRow('flow', 'env_only', null)],
      registry: { items: [{ type: 'flow', name: 'acme_lead_router', packageId: VENDOR }, { type: 'flow', name: 'acme_nightly_sync', packageId: VENDOR }] },
    });
    const r = await boot(d, 'single');
    expect(r.report.shadowedFlows).toEqual([
      { name: 'acme_lead_router', rowId: 'md_flow_acme_lead_router_none', rowPackageId: null, packageId: VENDOR },
      { name: 'acme_nightly_sync', rowId: `md_flows_acme_nightly_sync_${AUTHORED}`, rowPackageId: AUTHORED, packageId: VENDOR },
    ]);
    expect(errorLines(r).some((m) => m.includes('the stored one never does'))).toBe(true);
  });

  it('CONTROL: no package ships the stored names — no finding', async () => {
    const d = deployment({
      stored: [storedRow('flow', 'env_only', null)],
      registry: { items: [{ type: 'flow', name: 'env_only', tenant: true }] },
    });
    expect((await collectUpgradeImpactFindings(d.engine, d)).shadowedFlows).toEqual([]);
  });

  it('only active rows are read', async () => {
    const d = deployment({
      stored: [storedRow('flow', 'acme_lead_router', null, { state: 'archived' })],
      registry: { items: [{ type: 'flow', name: 'acme_lead_router', packageId: VENDOR }] },
    });
    expect((await collectUpgradeImpactFindings(d.engine, d)).shadowedFlows).toEqual([]);
  });
});

describe('webhook: a sys_webhook row holding a declared name', () => {
  it('names the row, its organization and the package whose declaration is withheld', async () => {
    const d = deployment({
      webhooks: [
        { id: 'wh_1', name: 'acme_deal_won', organization_id: 'org_tenant' },
        { id: 'wh_2', name: 'tenant_own_hook', organization_id: 'org_tenant' },
      ],
      registry: { items: [{ type: 'webhook', name: 'acme_deal_won', packageId: VENDOR }] },
    });
    const r = await boot(d, 'walled');
    expect(r.report.withheldWebhooks).toEqual([{ name: 'acme_deal_won', packageId: VENDOR, rowId: 'wh_1', organizationId: 'org_tenant' }]);
    expect(errorLines(r).some((m) => m.includes('the declared webhook is withheld for the whole deployment'))).toBe(true);
  });

  it('CONTROL: no package declares the row\'s name — no finding', async () => {
    const d = deployment({ webhooks: [{ id: 'wh_2', name: 'tenant_own_hook', organization_id: 'org_tenant' }] });
    expect((await collectUpgradeImpactFindings(d.engine, d)).withheldWebhooks).toEqual([]);
  });
});

// ── O: the overlay types ─────────────────────────────────────────────────────

describe('overlay: a customization bound to a package that no longer ships the item', () => {
  it('names each orphan; a bundled type\'s member is judged as that member', async () => {
    const d = deployment({
      stored: [
        storedRow('dashboard', 'acme_pipeline', VENDOR),
        storedRow('report', 'acme_revenue', VENDOR),
        storedRow('email_template', 'acme_welcome', VENDOR, { id: 'md_tpl_zh', bundle_member: 'zh-CN' }),
        storedRow('email_template', 'acme_welcome', VENDOR, { id: 'md_tpl_en' }),
      ],
      registry: {
        items: [
          { type: 'dashboard', name: 'acme_pipeline_v2', packageId: VENDOR },
          { type: 'report', name: 'acme_revenue', packageId: VENDOR },
          { type: 'email_template', name: 'acme_welcome', packageId: VENDOR, member: 'en' },
        ],
      },
    });
    const r = await boot(d, 'single');
    expect(r.report.overlayOrphans).toEqual([
      { type: 'dashboard', name: 'acme_pipeline', rowId: `md_dashboard_acme_pipeline_${VENDOR}`, packageId: VENDOR },
      { type: 'email_template', name: 'acme_welcome', member: 'zh-CN', rowId: 'md_tpl_zh', packageId: VENDOR },
    ]);
    expect(errorLines(r).some((m) => m.includes('bound to a package that no longer ships the item'))).toBe(true);
  });

  it('another package shipping the same name does not cover the row: the row is bound to its own package', async () => {
    const d = deployment({
      stored: [storedRow('view', 'acme_board', VENDOR)],
      registry: { items: [{ type: 'view', name: 'acme_board', packageId: OTHER_VENDOR }] },
    });
    expect((await collectUpgradeImpactFindings(d.engine, d)).overlayOrphans.map((o) => o.name)).toEqual(['acme_board']);
  });

  it('CONTROL: the package still ships it; and rows that are not judged — package-less, authored, unknown or disabled package, not an overlay type', async () => {
    const d = deployment({
      stored: [
        storedRow('view', 'acme_board', VENDOR),
        storedRow('view', 'env_board', null),
        storedRow('view', 'customer_board', AUTHORED),
        storedRow('view', 'mystery_board', 'com.removed.pkg'),
        storedRow('translation', 'zh-CN', 'com.disabled.pkg'),
        storedRow('page', 'acme_home', VENDOR),
      ],
      registry: {
        items: [{ type: 'view', name: 'acme_board', packageId: VENDOR }],
        packages: { 'com.disabled.pkg': { source: 'code', disabled: true } },
      },
    });
    expect((await collectUpgradeImpactFindings(d.engine, d)).overlayOrphans).toEqual([]);
  });
});

// ── E: the extensions ────────────────────────────────────────────────────────

describe('extension: a field more than one package declares', () => {
  it('the vendor adds a field an extension already declares: the extension\'s is served', async () => {
    const d = deployment({
      registry: {
        objects: [
          { name: 'account', owner: { packageId: VENDOR, fields: ['id', 'name', 'rating'] }, extenders: [{ packageId: AUTHORED, fields: ['rating', 'tier'] }] },
          { name: 'contact', owner: { packageId: VENDOR, fields: ['id', 'email'] }, extenders: [{ packageId: OTHER_VENDOR, fields: ['score'] }, { packageId: AUTHORED, fields: ['score'] }] },
        ],
      },
    });
    const r = await boot(d, 'single');
    expect(r.report.fieldCollisions).toEqual([
      { object: 'account', field: 'rating', declaredBy: [{ packageId: VENDOR, layer: 'own' }, { packageId: AUTHORED, layer: 'extend' }] },
      { object: 'contact', field: 'score', declaredBy: [{ packageId: OTHER_VENDOR, layer: 'extend' }, { packageId: AUTHORED, layer: 'extend' }] },
    ]);
    expect(errorLines(r).some((m) => m.includes('a review item'))).toBe(true);
  });

  it('with a tenant overlay the overlay is the base layer the extension replaces a field of', async () => {
    const d = deployment({
      registry: {
        objects: [{
          name: 'account', owner: { packageId: VENDOR, fields: ['id', 'name'] },
          overlay: { packageId: VENDOR, fields: ['id', 'name', 'region'] }, extenders: [{ packageId: OTHER_VENDOR, fields: ['region'] }],
        }],
      },
    });
    expect((await collectUpgradeImpactFindings(d.engine, d)).fieldCollisions).toEqual([
      { object: 'account', field: 'region', declaredBy: [{ packageId: VENDOR, layer: 'overlay' }, { packageId: OTHER_VENDOR, layer: 'extend' }] },
    ]);
  });

  it('CONTROL: distinct field names, a package extending its own object, an overlay over the owner — no finding', async () => {
    const d = deployment({
      registry: {
        objects: [
          { name: 'account', owner: { packageId: VENDOR, fields: ['id', 'name'] }, extenders: [{ packageId: AUTHORED, fields: ['tier'] }] },
          { name: 'lead', owner: { packageId: VENDOR, fields: ['id', 'source'] }, extenders: [{ packageId: VENDOR, fields: ['source'] }] },
          { name: 'deal', owner: { packageId: VENDOR, fields: ['id', 'stage'] }, overlay: { fields: ['id', 'stage'] } },
        ],
      },
    });
    expect((await collectUpgradeImpactFindings(d.engine, d)).fieldCollisions).toEqual([]);
  });
});

describe('extension: a stored object row a package now owns', () => {
  it('a row bound to another package is refused at boot: named with the owner', async () => {
    const d = deployment({
      stored: [storedRow('object', 'invoice', AUTHORED), storedRow('objects', 'account', OTHER_VENDOR)],
      registry: {
        objects: [
          { name: 'invoice', owner: { packageId: VENDOR, fields: ['id'] } },
          { name: 'account', owner: { packageId: VENDOR, fields: ['id'] } },
        ],
      },
    });
    const r = await boot(d, 'single');
    expect(r.report.refusedObjectRows).toEqual([
      { name: 'account', rowId: `md_objects_account_${OTHER_VENDOR}`, packageId: OTHER_VENDOR, ownerPackageId: VENDOR },
      { name: 'invoice', rowId: `md_object_invoice_${AUTHORED}`, packageId: AUTHORED, ownerPackageId: VENDOR },
    ]);
    expect(errorLines(r).some((m) => m.includes('so the row is not served'))).toBe(true);
  });

  it('CONTROL: a row bound to the owner, a package-less overlay (ADR-0005\'s sanctioned shape), an object no package owns — no finding', async () => {
    const d = deployment({
      stored: [storedRow('object', 'account', VENDOR), storedRow('object', 'deal', null), storedRow('object', 'custom_thing', AUTHORED)],
      registry: {
        objects: [
          { name: 'account', owner: { packageId: VENDOR, fields: ['id'] } },
          { name: 'deal', owner: { packageId: VENDOR, fields: ['id'] } },
          { name: 'custom_thing' },
        ],
      },
    });
    expect((await collectUpgradeImpactFindings(d.engine, d)).refusedObjectRows).toEqual([]);
  });
});

describe('extension: a navigation contribution whose group its app no longer has', () => {
  it('names the app, the group, the contributing package and the relocated items', async () => {
    const d = deployment({
      registry: { apps: { crm: [{ app: 'crm', group: 'sales_tools', packageId: OTHER_VENDOR, relocated: ['addon_quotes'] }], setup: [] } },
    });
    const r = await boot(d, 'single');
    expect(r.report.relocatedNavContributions).toEqual([{ app: 'crm', group: 'sales_tools', packageId: OTHER_VENDOR, relocated: ['addon_quotes'] }]);
    expect(errorLines(r).some((m) => m.includes("moved to the app's top level"))).toBe(true);
  });

  it('CONTROL: every contribution found its group — no finding', async () => {
    const d = deployment({ registry: { apps: { crm: [], setup: [] } } });
    expect((await collectUpgradeImpactFindings(d.engine, d)).relocatedNavContributions).toEqual([]);
  });

  it('a registry with no navigation diagnostics names what is absent and judges nothing of it', async () => {
    const d = deployment({});
    const registry = d.fake.registry as any;
    delete registry.getAppNavDiagnostics;
    const report = await collectUpgradeImpactFindings(d.engine, d);
    expect(report.absent).toEqual([NAV_DIAGNOSTICS]);
  });
});

// ── Settings ─────────────────────────────────────────────────────────────────

describe('settings: a stored key its namespace no longer declares', () => {
  it('names the store, namespace and key, the row count and the organizations — never a value', async () => {
    const d = deployment({
      settings: [
        { id: 's1', namespace: 'mail', key: 'sender_address', organization_id: 'org_a', value: 'secret-ish' },
        { id: 's2', namespace: 'mail', key: 'sender_address', organization_id: 'org_b' },
        { id: 's3', namespace: 'mail', key: 'sender_address', organization_id: null },
        { id: 's4', namespace: 'mail', key: 'from_address', organization_id: 'org_a' },
        { id: 's5', namespace: 'unregistered_plugin', key: 'anything', organization_id: 'org_a' },
      ],
      platformSettings: [{ id: 'p1', namespace: 'storage', key: 'bucket' }, { id: 'p2', namespace: 'storage', key: 'provider' }],
    });
    const r = await boot(d, 'single');
    expect(r.report.settingOrphans).toEqual([
      { store: 'sys_platform_setting', namespace: 'storage', name: 'bucket', rows: 1, organizations: [] },
      { store: 'sys_setting', namespace: 'mail', name: 'sender_address', rows: 3, organizations: ['org_a', 'org_b'] },
    ]);
    expect(JSON.stringify(r.messaging.emit.mock.calls[0][0])).not.toContain('secret-ish');
    // The value columns are never read.
    for (const find of d.fake.finds.filter((f) => f.object.endsWith('setting'))) {
      expect(find.fields?.some((f) => f.startsWith('value'))).toBe(false);
    }
    expect(errorLines(r).some((m) => m.includes('the stored value is never read'))).toBe(true);
  });

  it('CONTROL: every stored key is declared — no finding; a layout-only specifier with no key declares nothing', async () => {
    const d = deployment({ settings: [{ id: 's4', namespace: 'mail', key: 'from_address', organization_id: 'org_a' }] });
    expect((await collectUpgradeImpactFindings(d.engine, d)).settingOrphans).toEqual([]);
  });

  it('without the settings service nothing of settings is judged, and the absence is named', async () => {
    const d = deployment({ manifests: null, settings: [{ id: 's1', namespace: 'mail', key: 'sender_address' }] });
    const report = await collectUpgradeImpactFindings(d.engine, d);
    expect(report.settingOrphans).toEqual([]);
    expect(report.absent).toEqual([SETTINGS_SERVICE]);
    expect(d.fake.finds.some((f) => f.object === 'sys_setting')).toBe(false);
  });
});

// ── A read that did not happen ───────────────────────────────────────────────

describe('a read that did not happen is not "resolves nowhere"', () => {
  for (const store of ['sys_metadata_activation', 'sys_metadata', 'sys_webhook', 'sys_setting'] as const) {
    it(`${store} unreadable: the report stops, names the store, reports no finding and tells nobody`, async () => {
      const d = deployment({
        ledger: [switchedOff('flow', 'acme_gone')],
        settings: [{ id: 's1', namespace: 'mail', key: 'sender_address' }],
      });
      d.fake.failOn = store;
      const r = await boot(d, 'single');
      expect(r.report).toMatchObject({ stopped: 'scan-unreadable', stoppedReading: store, orphans: [], settingOrphans: [] });
      expect(r.delivery.outcome).toBe('stopped');
      expect(r.messaging.emit).not.toHaveBeenCalled();
      expect(r.log.warn.mock.calls.some(([m]) => String(m).includes(`the upgrade impact report stopped: ${store} could not be read`))).toBe(true);
    });
  }

  it('the settings manifests unreadable: the report stops', async () => {
    const d = deployment({});
    const r = await reportUpgradeImpact(d.engine, {
      settings: { listManifests: () => { throw new Error('settings registry broke'); } }, walled: false, logger: logger(),
    });
    expect(r.report).toMatchObject({ stopped: 'settings-unreadable', stoppedError: 'settings registry broke' });
  });

  it('absent stores are named and judge nothing that needs them', async () => {
    const d = deployment({ stores: ['sys_metadata', 'sys_organization', 'sys_user_permission_set'], ledger: [switchedOff('flow', 'acme_gone')] });
    const report = await collectUpgradeImpactFindings(d.engine, d);
    expect(report.absent).toEqual(['sys_metadata_activation', 'sys_webhook', 'sys_setting', 'sys_platform_setting']);
    expect(report.orphans).toEqual([]);
  });

  it('an engine with no registry judges no registry class, and still judges the settings', async () => {
    const d = deployment({ registry: null, ledger: [switchedOff('flow', 'acme_gone')], settings: [{ id: 's1', namespace: 'mail', key: 'sender_address' }] });
    const report = await collectUpgradeImpactFindings(d.engine, d);
    expect(report.absent).toEqual([SCHEMA_REGISTRY]);
    expect(report.orphans).toEqual([]);
    expect(report.settingOrphans.map((s) => s.name)).toEqual(['sender_address']);
    expect(d.fake.finds.some((f) => f.object === 'sys_metadata_activation')).toBe(false);
  });
});

describe('the finding set', () => {
  it('an unchanged set has one dedupKey across boots, under its own topic; a changed set has another', async () => {
    const first = await boot(renamedFlow(true), 'single');
    const second = await boot(renamedFlow(true), 'single');
    expect(first.messaging.emit.mock.calls[0][0].dedupKey).toBe(second.messaging.emit.mock.calls[0][0].dedupKey);
    expect(upgradeImpactDedupKey(first.report)).toMatch(/^system\.upgrade_impact:[0-9a-f]{32}$/);
    const changed = await boot(deployment({ ...{ ledger: [switchedOff('flow', 'acme_other_gone')] } }), 'single');
    expect(changed.messaging.emit.mock.calls[0][0].dedupKey).not.toBe(first.messaging.emit.mock.calls[0][0].dedupKey);
  });

  it('it writes nothing: the engine double offers no write verb and none is asked for', async () => {
    const d = deployment({ ledger: [switchedOff('flow', 'acme_gone')] });
    await boot(d, 'single');
    expect(Object.keys(d.engine).sort()).toEqual(['find', 'getObject', 'registry']);
  });
});
