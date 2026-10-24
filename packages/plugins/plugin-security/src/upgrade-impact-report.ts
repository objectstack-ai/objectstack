// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The upgrade-impact comparison for the non-access classes, and its boot
 * report (#24447; ADR-0126 §6 wall 3: no upgrade un-makes a customer's
 * choice). The access classes are `access-upgrade-report.ts`'s; this module
 * reads the rest the same way.
 *
 * ## What it compares
 *
 * A code-package change rewrites the packaged base, and the customer's state
 * stays where it was written: the activation ledger (`sys_metadata_activation`,
 * one row per bare `(metadata_type, name)`), the stored metadata rows
 * (`sys_metadata`), the organizations' `sys_webhook` rows and the stored
 * settings (`sys_setting`, `sys_platform_setting`). That state is kept by
 * NAME, so an upgrade that renames, removes or collides with a name can leave
 * it meaning something else. At every boot this module reads it against the
 * post-boot registry and lists, per class of the ruling on #24443:
 *
 * **C, the switched types** (flow, action, webhook):
 *
 * 1. **Orphans** — ledger rows whose name no package ships at this boot.
 * 2. **Suspected re-enablements** — a switched-off orphan whose recorded
 *    `package_id` is P, and every name of the same type P now ships that no
 *    ledger row names: a rename makes the item active again by default.
 *    "Suspected", as in the access report: nothing records which name
 *    replaced which.
 * 3. **Switch-offs on a shared action name** — a switched-off action whose
 *    name more than one served object declares. The ledger addresses an
 *    action by name alone, so the row switches every one of them off; the
 *    activation door refuses such a flip, but an upgrade can add the second
 *    declaration after the row was written.
 * 4. **Shadowed stored flows** — an active `sys_metadata` flow row whose name
 *    a package ships. The packaged flow is armed and the stored one never runs
 *    (ADR-0126 §2, `service-automation`'s `flow-precedence.ts`).
 * 5. **Withheld declared webhooks** — a `sys_webhook` row holding the name of
 *    a webhook a package declares. The row answers and the declaration is
 *    withheld for the whole deployment (`plugin-webhooks`' `declared-webhooks.ts`).
 *
 * Validations and scheduled jobs have no switch and no stored row of their
 * own, so nothing of theirs is kept by name for an upgrade to strand.
 *
 * **O, the overlay types** (view, dashboard, report, translation, email
 * template):
 *
 * 6. **Overlay orphans** — an active `sys_metadata` row bound to an installed,
 *    enabled code or marketplace package that no longer ships the item (the
 *    row's bundle member, for a bundled type). Its artifact lookup finds
 *    nothing, so the row registers and serves as an item of its own beside
 *    whatever replaced it.
 *
 * **E, the extensions** (objects and apps):
 *
 * 7. **Field collisions** — a field an `extend` contributor declares that the
 *    object's base layer (the tenant overlay when there is one, else the
 *    owner) or another package's extension also declares. The fold is
 *    last-writer-wins on `fields`, so the later declaration replaces the
 *    others with no diagnostic (`objectql`'s `mergeObjectDefinitions`).
 *    Read as "declared twice", not "conflicting": a review item.
 * 8. **Refused object rows** — an active `sys_metadata` object row bound to a
 *    package Q while a code package P ≠ Q owns the name. The boot hydration
 *    refuses the row (ADR-0029 D9.9, `OBJECT_OVERLAY_PACKAGE_MISMATCH`), so
 *    the object answers with P's definition and the row is not served.
 * 9. **Relocated navigation contributions** — a contribution naming a group
 *    its target app no longer has; the registry moved its items to the app's
 *    top level (`getAppNavDiagnostics`, #14553).
 *
 * **Settings:**
 *
 * 10. **Setting orphans** — a stored value whose namespace a registered
 *     manifest declares and whose key it does not. The settings door refuses
 *     an undeclared key, so the value is never read and the default applies.
 *
 * ## What it does not read, and why
 *
 *  - A package-less object row over a packaged owner is ADR-0005's sanctioned
 *    environment-wide overlay (ADR-0029 D9.9's accepted case), and it cannot
 *    be told apart from an object the environment authored before a package
 *    shipped the name. It is not listed.
 *  - An overlay row bound to a package the registry does not hold is not
 *    judged: it may be an authored package this composition does not hydrate,
 *    or a package removed from the deployment, and the registry cannot tell
 *    which. A row bound to a disabled package is not judged either: its
 *    package's items are withheld whatever they are.
 *  - A stored setting whose namespace no manifest registers is not judged: the
 *    namespace may belong to a plugin this composition does not load, or be
 *    held by the tenancy posture (`branding` under a wall).
 *  - A navigation contribution aimed at an app no package registers is not
 *    listed: the registry offers no enumeration of contributions by target.
 *  - View diagnostics inside an overlay (a broken column or filter reference)
 *    are the metadata protocol's diagnostics, not this comparison's.
 *
 * ## What it does not do
 *
 * It writes nothing and refuses nothing at boot. It never reads a setting's
 * value or a stored row's body: a finding names the row, never its content.
 *
 * ## A read that did not happen is not "resolves nowhere"
 *
 * As `access-upgrade-report.ts`: a scan or a manifest read that throws stops
 * the report, which says which store could not be read and reports no
 * finding. A composition without one of the stores, without the settings
 * service, or with a registry that does not offer the reads below names what
 * is absent and judges nothing that needs it.
 *
 * ## Who is told
 *
 * The log, always, once per category. And the people who can act, through
 * `upgrade-report-delivery.ts`, under this report's own topic and `dedupKey`:
 * the Default Organization's administrators under `single`; under a wall, the
 * operator alone, and in-app in the organization
 * `OS_PLATFORM_OWNER_ORGANIZATION` names when it is set. The ledger, the
 * stored metadata and the packages are deployment-level; a stored setting or
 * webhook row names its organization, so the operator can tell it.
 *
 * ## When it runs
 *
 * At `kernel:bootstrapped`, beside the access upgrade report: every
 * definition this boot registers, and every settings manifest, is in place by
 * then.
 */

import { createHash } from 'node:crypto';
import { METADATA_ACTIVATION_TABLE } from '@objectstack/core';
import { isCodeArtifactBody, isTenantAuthored } from '@objectstack/metadata-core';
import { PLURAL_TO_SINGULAR } from '@objectstack/spec/shared';
import {
  deliverUpgradeReport,
  type UpgradeReportDelivery,
  type UpgradeReportLogger,
  type UpgradeReportNotifier,
} from './upgrade-report-delivery.js';

/** The notification topic the report is raised on. */
export const UPGRADE_IMPACT_TOPIC = 'system.upgrade_impact';

/** The ledger types this report reads; the access types are the access report's. */
export const UPGRADE_IMPACT_LEDGER_TYPES = ['flow', 'action', 'webhook'] as const;
export type UpgradeImpactLedgerType = (typeof UPGRADE_IMPACT_LEDGER_TYPES)[number];

/** The overlay types (ADR-0126 §3, regime O). */
export const UPGRADE_IMPACT_OVERLAY_TYPES = ['view', 'dashboard', 'report', 'translation', 'email_template'] as const;
export type UpgradeImpactOverlayType = (typeof UPGRADE_IMPACT_OVERLAY_TYPES)[number];

/** The stored metadata rows. */
export const STORED_METADATA_OBJECT = 'sys_metadata';

/** The organization-authored webhook rows (plugin-webhooks). */
export const WEBHOOK_OBJECT = 'sys_webhook';

/** The stored settings: the organization and user layers, and the deployment layer. */
export const SETTING_OBJECTS = ['sys_setting', 'sys_platform_setting'] as const;
export type SettingStore = (typeof SETTING_OBJECTS)[number];

/** The service name service-settings registers under. */
export const SETTINGS_SERVICE = 'settings';

/** What the report names when the engine's registry does not offer the reads it needs. */
export const SCHEMA_REGISTRY = 'the schema registry';

/** What the report names when the registry offers no navigation diagnostics. */
export const NAV_DIAGNOSTICS = 'the navigation contribution diagnostics';

const SCAN_PAGE_SIZE = 500;
const LOGGED_LIMIT = 50;
const SYSTEM_CTX = { isSystem: true } as const;

/** One registered object contributor, as `SchemaRegistry.getObjectContributors` answers it. */
export interface ObjectContributorLike {
  packageId?: string;
  ownership?: string;
  definition?: unknown;
}

/** One relocated contribution, as `SchemaRegistry.getAppNavDiagnostics` answers it. */
export interface NavDiagnosticLike {
  app?: string;
  group?: string;
  packageId?: string;
  relocated?: readonly string[];
}

/** The registry reads this report needs — ObjectQL's `SchemaRegistry` offers each as it stands. */
export interface UpgradeImpactRegistry {
  getArtifactItem(type: string, name: string, packageId?: string, member?: string): unknown;
  listItems(type: string, packageId?: string): unknown[];
  getAllObjects(): unknown[];
  getObjectContributors(name: string): readonly ObjectContributorLike[];
  getPackagedObjectOwner(name: string): { packageId?: string } | undefined;
  getPackage(id: string): { source?: string } | undefined;
  isPackageDisabled(id?: string): boolean;
  getAllApps?(): unknown[];
  getAppNavDiagnostics?(app: string): readonly NavDiagnosticLike[];
}

const REGISTRY_READS = [
  'getArtifactItem', 'listItems', 'getAllObjects', 'getObjectContributors', 'getPackagedObjectOwner', 'getPackage',
  'isPackageDisabled',
] as const;

/** The engine surface the report reads through — ObjectQL satisfies it as it stands. */
export interface UpgradeImpactEngine {
  getObject(name: string): unknown;
  find(object: string, options: Record<string, unknown>): Promise<unknown>;
  registry?: unknown;
}

/** One registered settings manifest, as `SettingsService.listManifests` answers it. */
export interface SettingsManifestLike {
  namespace?: unknown;
  specifiers?: unknown;
}

/** The read service-settings offers this report. */
export interface SettingsManifestReader {
  listManifests(): readonly SettingsManifestLike[];
}

export interface UpgradeImpactReportDeps {
  /** service-settings; absent when the composition has none. */
  settings?: SettingsManifestReader;
}

/** A ledger row whose name no package ships. */
export interface SwitchOrphan {
  type: UpgradeImpactLedgerType;
  name: string;
  packageId: string | null;
  /** `true`: the customer switched it off. `false`: a row with no effect. */
  switchedOff: boolean;
}

/** A switched-off orphan whose package ships unswitched names of its type. */
export interface SuspectedSwitchReEnablement {
  type: UpgradeImpactLedgerType;
  /** The switched-off name no package ships. */
  name: string;
  packageId: string;
  /** The names of the same type the package ships with no ledger row. */
  candidates: string[];
}

/** A switched-off action whose name more than one served object declares. */
export interface SharedActionSwitch {
  name: string;
  packageId: string | null;
  /** The objects declaring an action of that name, every one switched off by the row. */
  objects: string[];
}

/** An active stored flow row a packaged flow of the same name shadows. */
export interface ShadowedStoredFlow {
  name: string;
  rowId: string;
  /** The stored row's own binding; `null` for a package-less row. */
  rowPackageId: string | null;
  /** The package shipping the flow that runs instead. */
  packageId: string;
}

/** A `sys_webhook` row holding a declared webhook's name. */
export interface WithheldDeclaredWebhook {
  name: string;
  /** The package declaring the withheld webhook. */
  packageId: string;
  rowId: string;
  organizationId: string | null;
}

/** An overlay row bound to a package that no longer ships the item. */
export interface OverlayOrphan {
  type: UpgradeImpactOverlayType;
  name: string;
  /** A bundled type's member, when the row names one. */
  member?: string;
  rowId: string;
  packageId: string;
}

/** One layer declaring a field, in the fold's order. */
export interface FieldDeclarer {
  packageId: string | null;
  layer: 'own' | 'overlay' | 'extend';
}

/** A field more than one package declares on one object; the last declarer is served. */
export interface ExtensionFieldCollision {
  object: string;
  field: string;
  declaredBy: FieldDeclarer[];
}

/** A stored object row bound to a package that does not own the object. */
export interface RefusedObjectRow {
  name: string;
  rowId: string;
  packageId: string;
  ownerPackageId: string;
}

/** A navigation contribution whose group its app no longer has. */
export interface RelocatedNavContribution {
  app: string;
  group: string;
  packageId: string | null;
  /** Ids of the items moved to the app's top level. */
  relocated: string[];
}

/** Stored values of a key their registered namespace no longer declares. */
export interface SettingOrphan {
  store: SettingStore;
  namespace: string;
  /**
   * The key. Not spelled `key`: the core logger redacts a field of that name,
   * which would hide from the operator the very key the finding names.
   */
  name: string;
  /** How many rows hold a value for the key. */
  rows: number;
  /** The organizations those rows belong to, when they name one. */
  organizations: string[];
}

export type UpgradeImpactReportStop = 'scan-unreadable' | 'settings-unreadable';

export interface UpgradeImpactReport {
  orphans: SwitchOrphan[];
  reEnablements: SuspectedSwitchReEnablement[];
  sharedActionSwitches: SharedActionSwitch[];
  shadowedFlows: ShadowedStoredFlow[];
  withheldWebhooks: WithheldDeclaredWebhook[];
  overlayOrphans: OverlayOrphan[];
  fieldCollisions: ExtensionFieldCollision[];
  refusedObjectRows: RefusedObjectRow[];
  relocatedNavContributions: RelocatedNavContribution[];
  settingOrphans: SettingOrphan[];
  /** What this composition does not provide; the parts that need it were not judged. */
  absent: string[];
  stopped?: UpgradeImpactReportStop;
  stoppedReading?: string;
  stoppedError?: string;
}

/** The finding lists, in the order the report logs them. */
const FINDING_KEYS = [
  'reEnablements', 'orphans', 'sharedActionSwitches', 'shadowedFlows', 'withheldWebhooks', 'overlayOrphans',
  'fieldCollisions', 'refusedObjectRows', 'relocatedNavContributions', 'settingOrphans',
] as const;
type FindingKey = (typeof FINDING_KEYS)[number];

function emptyReport(absent: string[] = []): UpgradeImpactReport {
  return {
    orphans: [], reEnablements: [], sharedActionSwitches: [], shadowedFlows: [], withheldWebhooks: [],
    overlayOrphans: [], fieldCollisions: [], refusedObjectRows: [], relocatedNavContributions: [], settingOrphans: [],
    absent,
  };
}

class ReportStop extends Error {
  constructor(readonly stop: UpgradeImpactReportStop, readonly reading: string, readonly reason: unknown) {
    super(stop);
  }
}

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function nameOf(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const name = value.trim();
  return name === '' ? undefined : name;
}

/** A row's package binding: `null` for none and for the `'sys_metadata'` sentinel. */
function bindingOf(value: unknown): string | null {
  const binding = nameOf(value);
  return binding === undefined || binding === 'sys_metadata' ? null : binding;
}

function organizationOf(row: Record<string, unknown>): string | null {
  const value = row.organization_id ?? row.organizationId;
  if (value === null || value === undefined || value === '') return null;
  return String(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A stored row's type, singular (the boot hydration's own normalization). */
function storedTypeOf(row: Record<string, unknown>): string | undefined {
  const type = nameOf(row.type);
  return type === undefined ? undefined : (PLURAL_TO_SINGULAR[type] ?? type);
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const sortedBy = <T>(items: T[], ...keys: Array<(item: T) => string>): T[] =>
  items.sort((a, b) => {
    for (const key of keys) {
      const order = compare(key(a), key(b));
      if (order !== 0) return order;
    }
    return 0;
  });

function registryOf(engine: UpgradeImpactEngine): UpgradeImpactRegistry | undefined {
  const registry = engine?.registry as Partial<UpgradeImpactRegistry> | undefined;
  if (!registry) return undefined;
  return REGISTRY_READS.every((read) => typeof registry[read] === 'function')
    ? (registry as UpgradeImpactRegistry)
    : undefined;
}

async function scanAll(
  engine: UpgradeImpactEngine,
  object: string,
  fields: string[],
  where: Record<string, unknown> = {},
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (let offset = 0; ; offset += SCAN_PAGE_SIZE) {
    let page: unknown;
    try {
      page = await engine.find(object, {
        where,
        fields,
        orderBy: [{ field: 'id', order: 'asc' }],
        limit: SCAN_PAGE_SIZE,
        offset,
        context: SYSTEM_CTX,
      });
    } catch (e) {
      throw new ReportStop('scan-unreadable', object, e);
    }
    const rows = Array.isArray(page) ? (page as Record<string, unknown>[]) : [];
    for (const row of rows) if (isRecord(row)) out.push(row);
    if (rows.length < SCAN_PAGE_SIZE) break;
  }
  return out;
}

/** The package that ships `(type, name)` as a code artifact, or `undefined`. */
function shippingPackage(registry: UpgradeImpactRegistry, type: string, name: string): string | undefined {
  const artifact = registry.getArtifactItem(type, name);
  return isCodeArtifactBody(artifact) ? String((artifact as { _packageId: unknown })._packageId) : undefined;
}

interface ActionDeclaration {
  object: string;
  /** The package shipping it; `null` for an action the environment authored. */
  packageId: string | null;
}

/**
 * Every action the served objects declare, by name. Attribution follows the
 * runtime's `shippingPackageOf` (`@objectstack/runtime`'s `/actions` domain):
 * a code artifact's own package, else the object's packaged owner for an
 * embedded action, never one the environment authored.
 */
function servedActionDeclarations(registry: UpgradeImpactRegistry): Map<string, ActionDeclaration[]> {
  const byName = new Map<string, ActionDeclaration[]>();
  for (const object of registry.getAllObjects()) {
    if (!isRecord(object)) continue;
    const objectName = nameOf(object.name);
    if (objectName === undefined || !Array.isArray(object.actions)) continue;
    const owner = bindingOf(registry.getPackagedObjectOwner(objectName)?.packageId);
    for (const action of object.actions as unknown[]) {
      if (!isRecord(action)) continue;
      const name = nameOf(action.name);
      if (name === undefined) continue;
      const packageId = isCodeArtifactBody(action)
        ? String(action._packageId)
        : isTenantAuthored(action) ? null : owner;
      const list = byName.get(name) ?? [];
      list.push({ object: objectName, packageId });
      byName.set(name, list);
    }
  }
  return byName;
}

/**
 * Read the customer's state and the registry, and return what an upgrade left
 * behind. Logs nothing; {@link reportUpgradeImpact} is the boot entry. A read
 * that did not happen is returned in `stopped`, never thrown.
 */
export async function collectUpgradeImpactFindings(
  engine: UpgradeImpactEngine,
  deps: UpgradeImpactReportDeps = {},
): Promise<UpgradeImpactReport> {
  const report = emptyReport();
  const has = (object: string): boolean => {
    const present = !!engine?.getObject?.(object);
    if (!present) report.absent.push(object);
    return present;
  };
  const registry = registryOf(engine);
  if (!registry) report.absent.push(SCHEMA_REGISTRY);

  try {
    const ledgerRows = registry && has(METADATA_ACTIVATION_TABLE)
      ? await scanAll(engine, METADATA_ACTIVATION_TABLE, ['id', 'metadata_type', 'name', 'package_id', 'active'])
      : [];
    const storedRows = registry && has(STORED_METADATA_OBJECT)
      ? await scanAll(engine, STORED_METADATA_OBJECT, ['id', 'type', 'name', 'package_id', 'bundle_member'], { state: 'active' })
      : [];
    const webhookRows = registry && has(WEBHOOK_OBJECT)
      ? await scanAll(engine, WEBHOOK_OBJECT, ['id', 'name', 'organization_id'])
      : [];

    let manifests: readonly SettingsManifestLike[] | undefined;
    if (deps.settings) {
      try {
        manifests = deps.settings.listManifests();
      } catch (e) {
        throw new ReportStop('settings-unreadable', 'the settings manifests', e);
      }
      if (!Array.isArray(manifests)) {
        throw new ReportStop('settings-unreadable', 'the settings manifests', new Error('listManifests answered no list'));
      }
    } else {
      report.absent.push(SETTINGS_SERVICE);
    }
    const settingRows: Array<{ store: SettingStore; rows: Record<string, unknown>[] }> = [];
    if (manifests) {
      for (const store of SETTING_OBJECTS) {
        if (!has(store)) continue;
        const fields = store === 'sys_setting' ? ['id', 'namespace', 'key', 'organization_id'] : ['id', 'namespace', 'key'];
        settingRows.push({ store, rows: await scanAll(engine, store, fields) });
      }
    }

    if (registry) {
      // ── C: 1. orphans, 2. suspected re-enablements, 3. switch-offs on a shared action name.
      const actions = servedActionDeclarations(registry);
      const shipper = (type: UpgradeImpactLedgerType, name: string): string | null | undefined => {
        const shipped = shippingPackage(registry, type, name);
        if (shipped !== undefined || type !== 'action') return shipped;
        const declared = actions.get(name);
        return declared ? (declared.find((d) => d.packageId !== null)?.packageId ?? null) : undefined;
      };
      const shippedNames = (type: UpgradeImpactLedgerType, packageId: string): string[] => {
        const names = new Set<string>();
        for (const item of registry.listItems(type, packageId)) {
          if (!isRecord(item) || !isCodeArtifactBody(item) || item._packageId !== packageId) continue;
          const name = nameOf(item.name);
          if (name !== undefined) names.add(name);
        }
        if (type === 'action') {
          for (const [name, declared] of actions) if (declared.some((d) => d.packageId === packageId)) names.add(name);
        }
        return [...names].sort(compare);
      };

      const ledgerNames: Record<UpgradeImpactLedgerType, Set<string>> = { flow: new Set(), action: new Set(), webhook: new Set() };
      const ledger: Array<{ type: UpgradeImpactLedgerType; name: string; packageId: string | null; switchedOff: boolean }> = [];
      for (const row of ledgerRows) {
        const type = row.metadata_type as UpgradeImpactLedgerType;
        const name = nameOf(row.name);
        if (!(UPGRADE_IMPACT_LEDGER_TYPES as readonly string[]).includes(type) || name === undefined) continue;
        ledgerNames[type].add(name);
        ledger.push({ type, name, packageId: bindingOf(row.package_id), switchedOff: row.active === false || row.active === 0 });
      }
      for (const row of ledger) {
        if (shipper(row.type, row.name) !== undefined) {
          if (row.type !== 'action' || !row.switchedOff) continue;
          const objects = [...new Set((actions.get(row.name) ?? []).map((d) => d.object))].sort(compare);
          if (objects.length > 1) report.sharedActionSwitches.push({ name: row.name, packageId: row.packageId, objects });
          continue;
        }
        report.orphans.push({ ...row });
        if (!row.switchedOff || row.packageId === null) continue;
        const candidates = shippedNames(row.type, row.packageId).filter((name) => !ledgerNames[row.type].has(name));
        if (candidates.length > 0) {
          report.reEnablements.push({ type: row.type, name: row.name, packageId: row.packageId, candidates });
        }
      }

      // ── C: 4. shadowed stored flows; O: 6. overlay orphans; E: 8. refused object rows.
      for (const row of storedRows) {
        const type = storedTypeOf(row);
        const name = nameOf(row.name);
        if (type === undefined || name === undefined) continue;
        const rowId = String(row.id);
        const binding = bindingOf(row.package_id);
        if (type === 'flow') {
          const packageId = shippingPackage(registry, 'flow', name);
          if (packageId !== undefined) report.shadowedFlows.push({ name, rowId, rowPackageId: binding, packageId });
        } else if (type === 'object') {
          const owner = bindingOf(registry.getPackagedObjectOwner(name)?.packageId);
          if (binding !== null && owner !== null && binding !== owner) {
            report.refusedObjectRows.push({ name, rowId, packageId: binding, ownerPackageId: owner });
          }
        } else if ((UPGRADE_IMPACT_OVERLAY_TYPES as readonly string[]).includes(type) && binding !== null) {
          const pkg = registry.getPackage(binding);
          if (!pkg || pkg.source === 'authored' || registry.isPackageDisabled(binding)) continue;
          const member = nameOf(row.bundle_member);
          const artifact = registry.getArtifactItem(type, name, binding, member);
          if (isCodeArtifactBody(artifact) && (artifact as { _packageId: unknown })._packageId === binding) continue;
          report.overlayOrphans.push({
            type: type as UpgradeImpactOverlayType, name, ...(member === undefined ? {} : { member }), rowId, packageId: binding,
          });
        }
      }

      // ── C: 5. withheld declared webhooks.
      for (const row of webhookRows) {
        const name = nameOf(row.name);
        const packageId = name === undefined ? undefined : shippingPackage(registry, 'webhook', name);
        if (name === undefined || packageId === undefined) continue;
        report.withheldWebhooks.push({ name, packageId, rowId: String(row.id), organizationId: organizationOf(row) });
      }

      // ── E: 7. field collisions.
      for (const object of registry.getAllObjects()) {
        const objectName = isRecord(object) ? nameOf(object.name) : undefined;
        if (objectName === undefined) continue;
        const contributors = registry.getObjectContributors(objectName);
        const base = contributors.find((c) => c.ownership === 'overlay') ?? contributors.find((c) => c.ownership === 'own');
        const extenders = contributors.filter((c) => c.ownership === 'extend');
        if (extenders.length === 0) continue;
        const declarers = new Map<string, FieldDeclarer[]>();
        for (const layer of base ? [base, ...extenders] : extenders) {
          const fields = isRecord(layer.definition) && isRecord(layer.definition.fields) ? layer.definition.fields : {};
          for (const field of Object.keys(fields)) {
            const list = declarers.get(field) ?? [];
            list.push({ packageId: bindingOf(layer.packageId), layer: layer.ownership as FieldDeclarer['layer'] });
            declarers.set(field, list);
          }
        }
        for (const [field, declaredBy] of declarers) {
          if (!declaredBy.some((d) => d.layer === 'extend')) continue;
          if (new Set(declaredBy.map((d) => d.packageId)).size < 2) continue;
          report.fieldCollisions.push({ object: objectName, field, declaredBy });
        }
      }

      // ── E: 9. relocated navigation contributions.
      if (typeof registry.getAllApps === 'function' && typeof registry.getAppNavDiagnostics === 'function') {
        for (const app of registry.getAllApps()) {
          const appName = isRecord(app) ? nameOf(app.name) : undefined;
          if (appName === undefined) continue;
          for (const d of registry.getAppNavDiagnostics(appName)) {
            const group = nameOf(d?.group);
            if (group === undefined) continue;
            report.relocatedNavContributions.push({
              app: appName,
              group,
              packageId: bindingOf(d.packageId),
              relocated: Array.isArray(d.relocated) ? d.relocated.map(String) : [],
            });
          }
        }
      } else {
        report.absent.push(NAV_DIAGNOSTICS);
      }
    }

    // ── Settings: 10. setting orphans.
    if (manifests) {
      const declared = new Map<string, Set<string>>();
      for (const manifest of manifests) {
        const namespace = nameOf(manifest?.namespace);
        if (namespace === undefined) continue;
        const keys = declared.get(namespace) ?? new Set<string>();
        for (const spec of Array.isArray(manifest.specifiers) ? manifest.specifiers : []) {
          const key = isRecord(spec) ? nameOf(spec.key) : undefined;
          if (key !== undefined) keys.add(key);
        }
        declared.set(namespace, keys);
      }
      for (const { store, rows } of settingRows) {
        const orphans = new Map<string, SettingOrphan>();
        for (const row of rows) {
          const namespace = nameOf(row.namespace);
          const key = nameOf(row.key);
          if (namespace === undefined || key === undefined) continue;
          const keys = declared.get(namespace);
          if (!keys || keys.has(key)) continue;
          const id = JSON.stringify([namespace, key]);
          const orphan = orphans.get(id) ?? { store, namespace, name: key, rows: 0, organizations: [] };
          orphan.rows += 1;
          const organization = organizationOf(row);
          if (organization !== null && !orphan.organizations.includes(organization)) orphan.organizations.push(organization);
          orphans.set(id, orphan);
        }
        for (const orphan of orphans.values()) {
          orphan.organizations.sort(compare);
          report.settingOrphans.push(orphan);
        }
      }
    }
  } catch (e) {
    if (!(e instanceof ReportStop)) throw e;
    return { ...emptyReport(report.absent), stopped: e.stop, stoppedReading: e.reading, stoppedError: errorText(e.reason) };
  }

  sortedBy(report.orphans, (o) => o.type, (o) => o.name);
  sortedBy(report.reEnablements, (r) => r.type, (r) => r.name);
  sortedBy(report.sharedActionSwitches, (s) => s.name);
  sortedBy(report.shadowedFlows, (s) => s.name, (s) => s.rowId);
  sortedBy(report.withheldWebhooks, (w) => w.name, (w) => w.rowId);
  sortedBy(report.overlayOrphans, (o) => o.type, (o) => o.name, (o) => o.member ?? '', (o) => o.rowId);
  sortedBy(report.fieldCollisions, (c) => c.object, (c) => c.field);
  sortedBy(report.refusedObjectRows, (r) => r.name, (r) => r.rowId);
  sortedBy(report.relocatedNavContributions, (r) => r.app, (r) => r.group, (r) => r.packageId ?? '');
  sortedBy(report.settingOrphans, (s) => s.store, (s) => s.namespace, (s) => s.name);
  return report;
}

/** How many findings of each class the report carries. */
export function upgradeImpactCounts(report: UpgradeImpactReport): Record<FindingKey, number> {
  return Object.fromEntries(FINDING_KEYS.map((key) => [key, report[key].length])) as Record<FindingKey, number>;
}

/** Does the report carry anything an administrator must hear? */
export function hasUpgradeImpactFindings(report: UpgradeImpactReport): boolean {
  return FINDING_KEYS.some((key) => report[key].length > 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// The boot report: the log, and the administrator-visible notification.
// ─────────────────────────────────────────────────────────────────────────────

export interface UpgradeImpactBootDeps extends UpgradeImpactReportDeps {
  logger?: UpgradeReportLogger;
  /** The `messaging` service; absent when the composition has none. */
  messaging?: UpgradeReportNotifier;
  /** `true` under `group` / `isolated`: the operator alone is told (see `upgrade-report-delivery.ts`). */
  walled: boolean;
}

function listed<T>(items: readonly T[]): { items: T[]; more?: number } {
  return items.length > LOGGED_LIMIT
    ? { items: items.slice(0, LOGGED_LIMIT), more: items.length - LOGGED_LIMIT }
    : { items: [...items] };
}

function logError(logger: UpgradeReportLogger | undefined, message: string, meta: Record<string, unknown>): void {
  if (logger?.error) logger.error(message, undefined, meta);
  else logger?.warn(message, meta);
}

const SWITCH_DOORS =
  'POST /api/v1/automation/<flow>/toggle, POST /api/v1/actions/_activation/<object>/<action> or ' +
  'POST /api/v1/security/_activation/webhook/<name>, with { "enabled": false }';

/** The finding set as stable data: what the digest, the notification and the log carry. */
export function upgradeImpactSummary(report: UpgradeImpactReport): Record<FindingKey, unknown[]> {
  return Object.fromEntries(FINDING_KEYS.map((key) => [key, report[key]])) as Record<FindingKey, unknown[]>;
}

/** One notification per distinct finding set: the set's digest. */
export function upgradeImpactDedupKey(report: UpgradeImpactReport): string {
  const digest = createHash('sha256').update(JSON.stringify(upgradeImpactSummary(report))).digest('hex').slice(0, 32);
  return `${UPGRADE_IMPACT_TOPIC}:${digest}`;
}

/** Each category's log line, in {@link FINDING_KEYS} order. */
const CATEGORY_LINES: Record<FindingKey, (count: number) => string> = {
  reEnablements: (n) =>
    `[security] upgrade impact: ${n} flow, action or webhook switch-off(s) name an item its package no longer ` +
    'ships, while the same package ships name(s) of that type no switch covers — a rename that makes the item ' +
    "active again (ADR-0126 §6: no upgrade un-makes a customer's choice). Suspected: nothing records which name " +
    `replaced which. Nothing was changed. Fix: review each candidate, and switch it off if it is the renamed item (${SWITCH_DOORS}).`,
  orphans: (n) =>
    `[security] upgrade impact: ${n} activation ledger row(s) for a flow, action or webhook name an item no ` +
    'package ships at this boot, so the switch covers nothing. Nothing was changed. Fix: if the item was renamed, ' +
    'switch the new name as the old one was; reinstalling the package that shipped it clears the line at the next boot.',
  sharedActionSwitches: (n) =>
    `[security] upgrade impact: ${n} switched-off action name(s) are declared on more than one object, and the ` +
    'activation ledger addresses an action by its name alone (ADR-0126 §4), so the one row switches the action ' +
    'off on every one of those objects. Nothing was changed. Fix: if only one of them was meant, switch the row ' +
    'back on (POST /api/v1/actions/_activation/<object>/<action> with { "enabled": true }) and ask the packages ' +
    'for distinct machine names.',
  shadowedFlows: (n) =>
    `[security] upgrade impact: ${n} stored flow row(s) hold the name of a flow a package ships, so the packaged ` +
    'flow runs and the stored one never does (ADR-0126 §2: a packaged base is never overridden). Nothing was ' +
    'changed. Fix: save the stored flow under a new name, which makes it a flow of its own, and switch the ' +
    'packaged one off if it must not run (POST /api/v1/automation/<flow>/toggle with { "enabled": false }).',
  withheldWebhooks: (n) =>
    `[security] upgrade impact: ${n} sys_webhook row(s) hold the name of a webhook a package declares, so the row ` +
    'answers and the declared webhook is withheld for the whole deployment. Nothing was changed. Fix: rename or ' +
    'delete the row to let the declaration answer; to keep the row as well, rename it, and switch the declared ' +
    'one off if it must not fire (POST /api/v1/security/_activation/webhook/<name> with { "enabled": false }).',
  overlayOrphans: (n) =>
    `[security] upgrade impact: ${n} customization(s) of a view, dashboard, report, translation or email template ` +
    'are bound to a package that no longer ships the item, so each is served as an item of its own beside ' +
    'whatever replaced it. Nothing was changed. Fix: if the item was renamed, customize the new name and delete ' +
    'the orphaned row (DELETE /api/v1/meta/<type>/<name>?package=<package>); if it was removed, delete the row or ' +
    'keep it as it is.',
  fieldCollisions: (n) =>
    `[security] upgrade impact: ${n} object field(s) are declared both by an object extension and by the layer it ` +
    'extends or another package\'s extension, and the last declaration replaces the others, so the field is ' +
    'served with that one\'s definition. Read as "declared twice", not "conflicting": a review item. Nothing was ' +
    'changed. Fix: rename the extension\'s field if it was not meant to replace the other.',
  refusedObjectRows: (n) =>
    `[security] upgrade impact: ${n} stored object row(s) are bound to a package that does not own the object, ` +
    'because another package ships that name, so the row is not served and the object answers with the owning ' +
    "package's definition (ADR-0029 D9.9). Nothing was changed. Fix: move the customization into an object of " +
    'its own name, or bind it to the owning package; the row stays readable and deletable through the metadata API.',
  relocatedNavContributions: (n) =>
    `[security] upgrade impact: ${n} navigation contribution(s) name a group their app no longer has, so their ` +
    "items were moved to the app's top level. Nothing was changed. Fix: point the contribution at a group the " +
    'app ships.',
  settingOrphans: (n) =>
    `[security] upgrade impact: ${n} stored setting key(s) are no longer declared by their namespace, so the ` +
    "stored value is never read and the key's default applies. Nothing was changed. Fix: if the key was renamed, " +
    'set the new key to the value you meant through the settings page; the old row has no effect.',
};

function logReport(report: UpgradeImpactReport, logger?: UpgradeReportLogger): void {
  if (report.stopped) {
    logger?.warn(
      `[security] the upgrade impact report stopped: ${report.stoppedReading} could not be read, and an unread ` +
        'answer is never taken for "resolves nowhere". It reports nothing for this boot and runs again on the next.',
      { stop: report.stopped, error: report.stoppedError },
    );
    return;
  }
  for (const key of FINDING_KEYS) {
    const items: readonly unknown[] = key === 'orphans'
      ? report.orphans.filter((o) => !report.reEnablements.some((r) => r.type === o.type && r.name === o.name))
      : report[key];
    if (items.length === 0) continue;
    logError(logger, CATEGORY_LINES[key](items.length), { count: items.length, [key]: listed(items) });
  }
  if (!hasUpgradeImpactFindings(report)) {
    logger?.info?.(
      '[security] upgrade impact report: every flow, action and webhook switch, stored metadata row, object ' +
        'extension, navigation contribution and stored setting matches the registry at this boot',
      { absent: report.absent },
    );
  }
}

/** What the boot report did with its findings: `clean` or `stopped`, else the delivery's own answer. */
export interface UpgradeImpactDelivery extends Omit<UpgradeReportDelivery, 'outcome' | 'findingSet'> {
  outcome: 'clean' | 'stopped' | UpgradeReportDelivery['outcome'];
  /** The finding set's digest — the notification's `dedupKey`. */
  findingSet?: string;
}

/** Why only the operator can act on these findings under a wall: the delivery's operator line. */
const UPGRADE_IMPACT_OPERATOR_REASON =
  'the activation ledger, the stored metadata and the installed packages are shared by every organization — so ' +
  'only the operator can act on them; a stored setting or webhook row names its organization, so the operator ' +
  'can tell it.';

/**
 * The boot entry: collect, log, and raise the findings to the people who can
 * act on them, through `upgrade-report-delivery.ts`. Never throws for a read
 * or a delivery that did not happen.
 */
export async function reportUpgradeImpact(
  engine: UpgradeImpactEngine,
  deps: UpgradeImpactBootDeps,
): Promise<{ report: UpgradeImpactReport; delivery: UpgradeImpactDelivery }> {
  const report = await collectUpgradeImpactFindings(engine, deps);
  logReport(report, deps.logger);
  if (report.stopped) return { report, delivery: { outcome: 'stopped', recipients: [] } };
  if (!hasUpgradeImpactFindings(report)) return { report, delivery: { outcome: 'clean', recipients: [] } };

  const counts = upgradeImpactCounts(report);
  const delivery = await deliverUpgradeReport(engine, deps, {
    topic: UPGRADE_IMPACT_TOPIC,
    findingSet: upgradeImpactDedupKey(report),
    subject: 'the upgrade impact findings above',
    operatorReason: UPGRADE_IMPACT_OPERATOR_REASON,
    payload: {
      title: 'An upgrade changed what your customizations cover',
      body:
        'A package upgrade renamed, removed or collided with a flow, action, webhook, view, dashboard, report, ' +
        'translation, email template, object, navigation group or setting your customizations name. ' +
        (counts.reEnablements > 0
          ? `${counts.reEnablements} item(s) you switched off may be active again under a new name. `
          : '') +
        'Nothing was changed. The server log lines "[security] upgrade impact" list each finding with its fix.',
      counts,
      findings: upgradeImpactSummary(report),
    },
  });
  return { report, delivery };
}
