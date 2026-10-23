// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The access-class upgrade comparison, and its boot report (ADR-0126 §6 wall
 * 3: no upgrade un-makes a customer's choice).
 *
 * ## What it compares
 *
 * A code-package change rewrites the packaged base; the customer's choices
 * stay where they were written — the activation ledger
 * (`sys_metadata_activation`, one row per bare `(metadata_type, name)`), the
 * permission sets and positions the environment authored (clones included,
 * `_provenance: 'org'`), and the organizations' `sys_sharing_rule` rows. Those
 * choices are kept by NAME, so an upgrade that renames, removes or collides
 * with a name can leave a choice that no longer means what the customer chose.
 * At every boot this module reads the customer's state against the post-boot
 * registry, for the four access types (sharing rules, permission sets,
 * positions, capabilities), and lists:
 *
 * 1. **Orphans** — ledger rows of type `position`, `permission` or
 *    `sharing_rule` whose name the registry no longer resolves.
 * 2. **Suspected re-enablements** — a switched-off orphan whose recorded
 *    `package_id` is P, and every name of the same type P now ships that no
 *    ledger row names. A switch-off is kept by name, so a vendor rename makes
 *    the renamed item active again by default. "Suspected", because nothing
 *    records which name replaced which: the ledger keeps no version, and P may
 *    ship several unswitched names (each is a candidate). A permission-set
 *    candidate names the positions whose definition binds it — the positions
 *    through which it grants again.
 * 3. **Collisions** — a declared sharing rule whose name an organization's
 *    `sys_sharing_rule` row holds: the declaration is served nowhere in that
 *    scope. Position, permission-set and capability collisions never reach
 *    this report: the registry refuses them at registration, and a package
 *    name the environment catalog holds refuses the boot
 *    (`security-catalog-namespace.ts`).
 * 4. **Broken references inside the customer's items** — an
 *    environment-authored permission set naming an object, a field or a
 *    capability the registry lacks, and a `sys_sharing_rule` row naming an
 *    object or a criteria field the registry lacks. A capability counts as
 *    known when it is registered or a package-shipped set still carries it
 *    (ADR-0066 ⑨'s rule: a set's `systemPermissions` declares it). This is the
 *    capability type's whole part: capabilities are code-only and never
 *    switched.
 * 5. **Field denies a customer set lacks** — a package-shipped set that denies
 *    a field (`readable: false`, or not `editable` on an object it grants
 *    edit on) and an environment-authored set granting the same object with no
 *    entry for that field. An unlisted field is visible and editable, so the
 *    customer set exposes what the vendor now hides.
 *
 * ## Two limits, both forced (ADR-0126 §9)
 *
 * A clone records no base: no package, no link (`permission-set-clone.ts`).
 * So "the old name carrying a clone" cannot be read at boot; the sanctioned
 * ceremony is clone PLUS switch-off, and the switch-off half carries the
 * finding — a clone whose base stays on is not a choice a rename un-makes.
 * And item 5 reads "grants the same object", not "copied from that set": it
 * can name a customer set unrelated to the vendor's. Both are review items.
 * "The same package" is read from the ledger row's `package_id` and the
 * entry's `packageId`; a row with no `package_id` (an item the environment
 * authored) has no package to compare, and yields an orphan, never a
 * re-enablement.
 *
 * ## What it does not do
 *
 * It writes nothing — no ledger row, no definition — and refuses nothing at
 * boot. The marketplace door's refusal is a separate stage.
 *
 * ## A read that did not happen is not "resolves nowhere"
 *
 * As `catalog-reference-report.ts`: a scan that throws, a catalog read that
 * throws, or the declared sharing-rule read that throws stops the report — it
 * says which store could not be read and reports no finding. A composition
 * without the ledger, without `sys_sharing_rule`, or without the sharing
 * service names what is absent and judges nothing that needs it: with no
 * declared-rule list, no `sharing_rule` row is an orphan.
 *
 * ## Who is told
 *
 * The log, always, once per category. And the people who can act on the
 * choice:
 *
 *  - under `single`, through the existing notification ingress
 *    (`messaging.emit()`, ADR-0030: a `sys_notification` event in Setup's
 *    Notification Events, and the in-app inbox), to the Default
 *    Organization's `admin_full_access` holders and any
 *    `OS_PLATFORM_OWNER_EMAIL` address. The notification's `dedupKey` is the
 *    finding set's digest, so an unchanged set notifies once, not once per
 *    boot. No messaging service, nobody to tell, or a refused emit: one log
 *    line says so, with the fix for that cause;
 *  - under a wall (`group`, `isolated`), the operator alone, by one `error`
 *    line addressed to the operator. The ledger and the catalog are
 *    deployment-level and only the operator may switch or clone there
 *    (ADR-0126 §5, ADR-0131 D3); the notification family is
 *    organization-scoped, so a walled write with no organization is refused
 *    (ADR-0131 D9), and stamping an organization would tell a tenant. No
 *    notification is attempted.
 *
 * ## When it runs
 *
 * At `kernel:bootstrapped`, beside the catalog reference report: every
 * definition this boot registers is in the registry by then.
 */

import { createHash } from 'node:crypto';
import {
  METADATA_ACTIVATION_TABLE,
  readDefaultOrganizationId,
  resolvePlatformAdminEmails,
  type SecurityCatalogEntry,
  type SecurityCatalogReader,
} from '@objectstack/core';
import { isTenantAuthored } from '@objectstack/metadata-core';
import { ADMIN_FULL_ACCESS } from '@objectstack/spec/identity';
import { GRANT_OBJECT, GRANT_SET_NAME_FIELD } from './grant-permission-set-name.js';

/** The notification topic the report is raised on. */
export const ACCESS_UPGRADE_TOPIC = 'security.access_upgrade';

/** The organization-authored sharing rule object (plugin-sharing). */
export const SHARING_RULE_OBJECT = 'sys_sharing_rule';

/** The ledger types this report reads; `capability` is never switched. */
export const ACCESS_LEDGER_TYPES = ['position', 'permission', 'sharing_rule'] as const;
export type AccessLedgerType = (typeof ACCESS_LEDGER_TYPES)[number];

/** The service name plugin-sharing registers its rule service under. */
export const SHARING_RULES_SERVICE = 'sharingRules';

const SCAN_PAGE_SIZE = 500;
const LOGGED_LIMIT = 50;
const SYSTEM_CTX = { isSystem: true } as const;

/** The engine surface the report reads through — ObjectQL satisfies it as it stands. */
export interface AccessUpgradeReportEngine {
  getObject(name: string): unknown;
  find(object: string, options: Record<string, unknown>): Promise<unknown>;
}

/** A declared sharing rule, as plugin-sharing's `listDeclaredRules` answers it. */
export interface DeclaredRuleLike {
  name: string;
  object?: string;
  packageId?: string;
}

/** The read plugin-sharing's rule service offers this report. */
export interface DeclaredSharingRuleReader {
  /** `null`: the service reads no declarations — no answer about any name. */
  listDeclaredRules(): Promise<readonly DeclaredRuleLike[] | null>;
}

export interface AccessUpgradeReportDeps {
  catalog: SecurityCatalogReader;
  /** plugin-sharing's rule service; absent when the composition has none. */
  sharingRules?: DeclaredSharingRuleReader;
}

/** A ledger row whose name the registry does not resolve. */
export interface LedgerOrphan {
  type: AccessLedgerType;
  name: string;
  packageId: string | null;
  /** `true`: the customer switched it off. `false`: a dead row with no effect. */
  switchedOff: boolean;
}

/** A name the orphan's package now ships with no ledger row. */
export interface ReEnablementCandidate {
  name: string;
  /** Permission sets only: the positions whose definition binds the candidate. */
  positions: string[];
}

/** A switched-off orphan whose package ships unswitched names of its type. */
export interface SuspectedReEnablement {
  type: AccessLedgerType;
  /** The switched-off name the registry no longer resolves. */
  name: string;
  packageId: string;
  candidates: ReEnablementCandidate[];
}

/** A declared sharing rule whose name an organization's row holds. */
export interface SharingRuleCollision {
  rule: string;
  packageId: string | null;
  rowId: string;
  organizationId: string | null;
}

export interface MissingReference {
  kind: 'object' | 'field' | 'capability';
  /** The object, `object.field`, or capability name. */
  name: string;
}

/** A customer item naming something the registry lacks. */
export interface BrokenCustomerReference {
  type: 'permission' | 'sharing_rule';
  /** The permission set's name, or the sharing rule row's name. */
  name: string;
  /** Sharing rule rows only: the row's id and organization. */
  rowId?: string;
  organizationId?: string | null;
  missing: MissingReference[];
}

/** A package-shipped field deny an environment-authored set granting the object lacks. */
export interface UncoveredFieldDeny {
  /** The package-shipped set that denies. */
  managedSet: string;
  packageId: string;
  /** The environment-authored set that lacks the deny. */
  customerSet: string;
  object: string;
  /** `object.field` keys, each with the access the managed set withholds. */
  fields: Array<{ field: string; denies: 'read' | 'edit' }>;
}

export type AccessUpgradeReportStop = 'scan-unreadable' | 'catalog-unreadable' | 'sharing-unreadable';

export interface AccessUpgradeReport {
  orphans: LedgerOrphan[];
  reEnablements: SuspectedReEnablement[];
  collisions: SharingRuleCollision[];
  brokenReferences: BrokenCustomerReference[];
  uncoveredDenies: UncoveredFieldDeny[];
  /** What this composition does not provide; the parts that need it were not judged. */
  absent: string[];
  stopped?: AccessUpgradeReportStop;
  stoppedReading?: string;
  stoppedError?: string;
}

class ReportStop extends Error {
  constructor(readonly stop: AccessUpgradeReportStop, readonly reading: string, readonly reason: unknown) {
    super(stop);
  }
}

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function nameOf(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const name = value.trim();
  return name === '' ? undefined : name;
}

function organizationOf(row: Record<string, unknown>): string | null {
  const value = row.organization_id ?? row.organizationId;
  if (value === null || value === undefined || value === '') return null;
  return String(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const byName = <T extends { name: string }>(a: T, b: T): number => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

async function scanAll(
  engine: AccessUpgradeReportEngine,
  object: string,
  fields: string[],
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (let offset = 0; ; offset += SCAN_PAGE_SIZE) {
    let page: unknown;
    try {
      page = await engine.find(object, {
        where: {},
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

async function listCatalog(catalog: SecurityCatalogReader, type: 'position' | 'permission'): Promise<SecurityCatalogEntry[]> {
  let entries: unknown;
  try {
    entries = await catalog.list(type);
  } catch (e) {
    throw new ReportStop('catalog-unreadable', 'the security catalog', e);
  }
  if (!Array.isArray(entries)) {
    throw new ReportStop('catalog-unreadable', 'the security catalog', new Error(`the ${type} list answered no list`));
  }
  return entries as SecurityCatalogEntry[];
}

/** The object's field names, or `undefined` when the registry holds no such object. */
function fieldsOf(engine: AccessUpgradeReportEngine, object: string): Set<string> | undefined {
  const schema = engine.getObject(object) as { fields?: unknown } | undefined | null;
  if (!schema) return undefined;
  return new Set(isRecord(schema.fields) ? Object.keys(schema.fields) : []);
}

/** The field names a sharing rule's criteria (a FilterCondition) reads, first path segment only. */
export function criteriaFields(criteria: unknown, out: Set<string> = new Set()): Set<string> {
  if (Array.isArray(criteria)) {
    for (const item of criteria) criteriaFields(item, out);
    return out;
  }
  if (!isRecord(criteria)) return out;
  for (const [key, value] of Object.entries(criteria)) {
    if (key.startsWith('$')) criteriaFields(value, out);
    else if (key !== '') out.add(key.split('.')[0]);
  }
  return out;
}

function parseCriteria(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

/** The `object.field` keys a permission set's `fields` block holds, split; `undefined` for a malformed key. */
function splitFieldKey(key: string): { object: string; field: string } | undefined {
  const dot = key.indexOf('.');
  if (dot <= 0 || dot === key.length - 1) return undefined;
  return { object: key.slice(0, dot), field: key.slice(dot + 1) };
}

/**
 * Read the customer's access state and the registry, and return what an
 * upgrade left behind. Logs nothing; {@link reportAccessUpgrade} is the boot
 * entry. A read that did not happen is returned in `stopped`, never thrown.
 */
export async function collectAccessUpgradeFindings(
  engine: AccessUpgradeReportEngine,
  deps: AccessUpgradeReportDeps,
): Promise<AccessUpgradeReport> {
  const report: AccessUpgradeReport = {
    orphans: [], reEnablements: [], collisions: [], brokenReferences: [], uncoveredDenies: [], absent: [],
  };
  const has = (object: string): boolean => {
    const present = !!engine?.getObject?.(object);
    if (!present) report.absent.push(object);
    return present;
  };

  try {
    const ledgerRows = has(METADATA_ACTIVATION_TABLE)
      ? await scanAll(engine, METADATA_ACTIVATION_TABLE, ['id', 'metadata_type', 'name', 'package_id', 'active'])
      : [];
    const ruleRows = has(SHARING_RULE_OBJECT)
      ? await scanAll(engine, SHARING_RULE_OBJECT, ['id', 'name', 'organization_id', 'object_name', 'criteria_json'])
      : [];

    let declaredRules: readonly DeclaredRuleLike[] | null = null;
    if (deps.sharingRules) {
      try {
        declaredRules = await deps.sharingRules.listDeclaredRules();
      } catch (e) {
        throw new ReportStop('sharing-unreadable', 'the declared sharing rules', e);
      }
    }
    if (declaredRules === null) report.absent.push(SHARING_RULES_SERVICE);

    const permissions = await listCatalog(deps.catalog, 'permission');
    const positions = await listCatalog(deps.catalog, 'position');

    // ── What the registry holds now, per ledger type: name → shipping package.
    const held: Record<AccessLedgerType, Map<string, string | null>> = {
      position: new Map(positions.map((e) => [e.name, e.packageId ?? null])),
      permission: new Map(permissions.map((e) => [e.name, e.packageId ?? null])),
      sharing_rule: new Map((declaredRules ?? []).map((r) => [r.name, nameOf(r.packageId) ?? null])),
    };
    const judged = (type: AccessLedgerType): boolean => type !== 'sharing_rule' || declaredRules !== null;

    // ── 1. Orphans, and 2. suspected re-enablements.
    const ledgerNames: Record<AccessLedgerType, Set<string>> = {
      position: new Set(), permission: new Set(), sharing_rule: new Set(),
    };
    const ledger: Array<{ type: AccessLedgerType; name: string; packageId: string | null; switchedOff: boolean }> = [];
    for (const row of ledgerRows) {
      const type = row.metadata_type as AccessLedgerType;
      const name = nameOf(row.name);
      if (!(ACCESS_LEDGER_TYPES as readonly string[]).includes(type) || name === undefined) continue;
      ledgerNames[type].add(name);
      ledger.push({
        type, name, packageId: nameOf(row.package_id) ?? null, switchedOff: row.active === false || row.active === 0,
      });
    }
    const bindingPositions = (set: string): string[] =>
      positions
        .filter((p) => Array.isArray(p.definition?.permissionSets) && (p.definition.permissionSets as unknown[]).includes(set))
        .map((p) => p.name)
        .sort();
    for (const row of ledger) {
      if (!judged(row.type) || held[row.type].has(row.name)) continue;
      report.orphans.push({ ...row });
      if (!row.switchedOff || row.packageId === null) continue;
      const candidates: ReEnablementCandidate[] = [];
      for (const [name, packageId] of held[row.type]) {
        if (packageId !== row.packageId || ledgerNames[row.type].has(name)) continue;
        candidates.push({ name, positions: row.type === 'permission' ? bindingPositions(name) : [] });
      }
      if (candidates.length === 0) continue;
      report.reEnablements.push({ type: row.type, name: row.name, packageId: row.packageId, candidates: candidates.sort(byName) });
    }

    // ── 3. Sharing-rule collisions, per organization.
    if (declaredRules !== null) {
      for (const row of ruleRows) {
        const name = nameOf(row.name);
        if (name === undefined || !held.sharing_rule.has(name)) continue;
        report.collisions.push({
          rule: name, packageId: held.sharing_rule.get(name) ?? null, rowId: String(row.id), organizationId: organizationOf(row),
        });
      }
    }

    // ── 4. Broken references inside the customer's items.
    const customerSets = permissions.filter((e) => isTenantAuthored(e.definition));
    const managedSets = permissions.filter((e) => !isTenantAuthored(e.definition) && e.packageId !== undefined);
    let knownCapabilities: Set<string> | undefined;
    const capabilityKnown = async (name: string): Promise<boolean> => {
      if (!knownCapabilities) {
        knownCapabilities = new Set<string>();
        for (const set of managedSets) {
          const bits = set.definition?.systemPermissions;
          if (Array.isArray(bits)) for (const bit of bits) if (typeof bit === 'string') knownCapabilities.add(bit);
        }
      }
      if (knownCapabilities.has(name)) return true;
      try {
        return (await deps.catalog.resolve('capability', name)) !== undefined;
      } catch (e) {
        throw new ReportStop('catalog-unreadable', 'the security catalog', e);
      }
    };
    for (const set of customerSets) {
      const missing: MissingReference[] = [];
      const missingObjects = new Set<string>();
      const objects = isRecord(set.definition?.objects) ? set.definition.objects : {};
      for (const object of Object.keys(objects)) {
        if (object === '*' || fieldsOf(engine, object)) continue;
        missingObjects.add(object);
        missing.push({ kind: 'object', name: object });
      }
      const fields = isRecord(set.definition?.fields) ? set.definition.fields : {};
      for (const key of Object.keys(fields)) {
        const split = splitFieldKey(key);
        if (!split || missingObjects.has(split.object)) continue;
        const known = fieldsOf(engine, split.object);
        if (!known) {
          missingObjects.add(split.object);
          missing.push({ kind: 'object', name: split.object });
        } else if (!known.has(split.field)) {
          missing.push({ kind: 'field', name: key });
        }
      }
      const bits = Array.isArray(set.definition?.systemPermissions) ? set.definition.systemPermissions : [];
      for (const bit of new Set(bits as unknown[])) {
        const name = nameOf(bit);
        if (name !== undefined && !(await capabilityKnown(name))) missing.push({ kind: 'capability', name });
      }
      if (missing.length > 0) report.brokenReferences.push({ type: 'permission', name: set.name, missing });
    }
    for (const row of ruleRows) {
      const name = nameOf(row.name);
      const object = nameOf(row.object_name);
      if (name === undefined || object === undefined) continue;
      const known = fieldsOf(engine, object);
      const missing: MissingReference[] = [];
      if (!known) missing.push({ kind: 'object', name: object });
      else {
        for (const field of [...criteriaFields(parseCriteria(row.criteria_json))].sort()) {
          if (!known.has(field)) missing.push({ kind: 'field', name: `${object}.${field}` });
        }
      }
      if (missing.length > 0) {
        report.brokenReferences.push({ type: 'sharing_rule', name, rowId: String(row.id), organizationId: organizationOf(row), missing });
      }
    }

    // ── 5. Package-shipped field denies a customer set granting the object lacks.
    for (const managed of managedSets) {
      const mFields = isRecord(managed.definition?.fields) ? managed.definition.fields : {};
      const mObjects = isRecord(managed.definition?.objects) ? managed.definition.objects : {};
      const denies = new Map<string, Array<{ field: string; denies: 'read' | 'edit' }>>();
      for (const [key, value] of Object.entries(mFields)) {
        const split = splitFieldKey(key);
        if (!split || !isRecord(value)) continue;
        const grantsEdit = isRecord(mObjects[split.object]) && (mObjects[split.object] as Record<string, unknown>).allowEdit === true;
        const deny = value.readable === false ? 'read' : grantsEdit && value.editable !== true ? 'edit' : undefined;
        if (!deny) continue;
        const list = denies.get(split.object) ?? [];
        list.push({ field: key, denies: deny });
        denies.set(split.object, list);
      }
      for (const customer of customerSets) {
        const cObjects = isRecord(customer.definition?.objects) ? customer.definition.objects : {};
        const cFields = isRecord(customer.definition?.fields) ? customer.definition.fields : {};
        for (const [object, list] of denies) {
          const grant = cObjects[object];
          if (!isRecord(grant)) continue;
          const lacking = list.filter((d) => {
            if (cFields[d.field] !== undefined) return false;
            return d.denies === 'read' ? grant.allowRead === true : grant.allowEdit === true;
          });
          if (lacking.length === 0) continue;
          report.uncoveredDenies.push({
            managedSet: managed.name, packageId: managed.packageId as string, customerSet: customer.name, object, fields: lacking,
          });
        }
      }
    }
  } catch (e) {
    if (!(e instanceof ReportStop)) throw e;
    return {
      orphans: [], reEnablements: [], collisions: [], brokenReferences: [], uncoveredDenies: [], absent: report.absent,
      stopped: e.stop, stoppedReading: e.reading, stoppedError: errorText(e.reason),
    };
  }

  const typeThenName = <T extends { name: string; type?: string }>(a: T, b: T): number =>
    (a.type ?? '') < (b.type ?? '') ? -1 : (a.type ?? '') > (b.type ?? '') ? 1 : byName(a, b);
  report.orphans.sort(typeThenName);
  report.reEnablements.sort(typeThenName);
  report.collisions.sort((a, b) => (a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : a.rowId < b.rowId ? -1 : 1));
  report.brokenReferences.sort(typeThenName);
  return report;
}

/** Does the report carry anything an administrator must hear? */
export function hasAccessUpgradeFindings(report: AccessUpgradeReport): boolean {
  return report.orphans.length + report.reEnablements.length + report.collisions.length
    + report.brokenReferences.length + report.uncoveredDenies.length > 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// The boot report: the log, and the administrator-visible notification.
// ─────────────────────────────────────────────────────────────────────────────

/** The kernel logger, as this module uses it. */
export interface AccessUpgradeReportLogger {
  info?: (message: string, meta?: Record<string, any>) => void;
  warn: (message: string, meta?: Record<string, any>) => void;
  error?: (message: string, cause?: Error, meta?: Record<string, any>) => void;
}

/** The notification ingress, as this module uses it — service-messaging's `emit`. */
export interface AccessUpgradeNotifier {
  emit(input: {
    topic: string;
    audience: readonly string[];
    severity: 'warning';
    dedupKey: string;
    organizationId?: string;
    payload: Record<string, unknown>;
  }): Promise<unknown>;
}

export interface AccessUpgradeBootDeps extends AccessUpgradeReportDeps {
  logger?: AccessUpgradeReportLogger;
  /** The `messaging` service; absent when the composition has none. */
  messaging?: AccessUpgradeNotifier;
  /** `true` under `group` / `isolated`: the operator alone is told, in the log. */
  walled: boolean;
}

/** Who the report is delivered to, and the organization a `single` delivery is stamped with. */
export interface AccessUpgradeAudience {
  recipients: string[];
  organizationId?: string;
}

/**
 * The people who can act on an access choice under `single`: any configured
 * platform operator and every holder of the Default Organization's
 * `admin_full_access` grant. A read that throws propagates. (Under a wall no
 * audience is resolved: see {@link reportAccessUpgrade}.)
 */
export async function resolveAccessUpgradeAudience(
  engine: AccessUpgradeReportEngine,
): Promise<AccessUpgradeAudience> {
  const recipients = [...resolvePlatformAdminEmails().emails];
  const organizationId = await readDefaultOrganizationId(engine);
  if (organizationId === undefined || !engine.getObject(GRANT_OBJECT)) return { recipients };
  const grants = await engine.find(GRANT_OBJECT, {
    where: { [GRANT_SET_NAME_FIELD]: ADMIN_FULL_ACCESS, organization_id: organizationId },
    fields: ['user_id'],
    limit: 10000,
    context: SYSTEM_CTX,
  });
  for (const row of Array.isArray(grants) ? grants : []) {
    const userId = nameOf((row as Record<string, unknown>)?.user_id);
    if (userId !== undefined && !recipients.includes(userId)) recipients.push(userId);
  }
  return { recipients, organizationId };
}

function listed<T>(items: readonly T[]): { items: T[]; more?: number } {
  return items.length > LOGGED_LIMIT
    ? { items: items.slice(0, LOGGED_LIMIT), more: items.length - LOGGED_LIMIT }
    : { items: [...items] };
}

function logError(logger: AccessUpgradeReportLogger | undefined, message: string, meta: Record<string, unknown>): void {
  if (logger?.error) logger.error(message, undefined, meta);
  else logger?.warn(message, meta);
}

const ACTIVATION_DOOR = 'POST /api/v1/security/_activation/<type>/<name> with { "enabled": false }';

/** The finding set as stable data: what the digest, the notification and the log carry. */
export function accessUpgradeSummary(report: AccessUpgradeReport): Record<string, unknown> {
  return {
    orphans: report.orphans.map((o) => ({ type: o.type, name: o.name, packageId: o.packageId, switchedOff: o.switchedOff })),
    reEnablements: report.reEnablements.map((r) => ({
      type: r.type, name: r.name, packageId: r.packageId, candidates: r.candidates,
    })),
    collisions: report.collisions,
    brokenReferences: report.brokenReferences,
    uncoveredDenies: report.uncoveredDenies,
  };
}

/** One notification per distinct finding set: the set's digest. */
export function accessUpgradeDedupKey(report: AccessUpgradeReport): string {
  const digest = createHash('sha256').update(JSON.stringify(accessUpgradeSummary(report))).digest('hex').slice(0, 32);
  return `${ACCESS_UPGRADE_TOPIC}:${digest}`;
}

function logReport(report: AccessUpgradeReport, logger?: AccessUpgradeReportLogger): void {
  if (report.stopped) {
    logger?.warn(
      `[security] the access upgrade report stopped: ${report.stoppedReading} could not be read, and an unread ` +
        'answer is never taken for "resolves nowhere". It reports nothing for this boot and runs again on the next.',
      { stop: report.stopped, error: report.stoppedError },
    );
    return;
  }
  if (report.reEnablements.length > 0) {
    logError(
      logger,
      `[security] ${report.reEnablements.length} access item(s) the customer switched off are no longer shipped under ` +
        'that name, while the same package ships name(s) of the same type no switch covers — a rename that makes the ' +
        "item active again (ADR-0126 §6: no upgrade un-makes a customer's choice). Suspected: nothing records which " +
        'name replaced which. Nothing was changed. Fix: review each candidate, and switch it off if it is the renamed ' +
        `item (${ACTIVATION_DOOR}).`,
      { count: report.reEnablements.length, reEnablements: listed(report.reEnablements) },
    );
  }
  const orphans = report.orphans.filter((o) => !report.reEnablements.some((r) => r.type === o.type && r.name === o.name));
  if (orphans.length > 0) {
    logError(
      logger,
      `[security] ${orphans.length} activation ledger row(s) name an access item the registry does not resolve at ` +
        'this boot, so the switch covers nothing. Nothing was changed. Fix: if the item was renamed, switch the new ' +
        'name as the old one was; reinstalling the package that shipped it clears the line at the next boot.',
      { count: orphans.length, orphans: listed(orphans) },
    );
  }
  if (report.collisions.length > 0) {
    logError(
      logger,
      `[security] ${report.collisions.length} sys_sharing_rule row(s) hold the name of a declared sharing rule, so the ` +
        'declared rule is served nowhere in that scope while the row answers as its own rule. Nothing was changed. ' +
        'Fix: rename the stored rule, which makes it a clone of its own, and switch the declared rule off if it must ' +
        'not grant.',
      { count: report.collisions.length, collisions: listed(report.collisions) },
    );
  }
  if (report.brokenReferences.length > 0) {
    logError(
      logger,
      `[security] ${report.brokenReferences.length} permission set(s) or sharing rule(s) authored in this system name ` +
        'an object, field or capability the registry does not hold at this boot, so that part grants nothing. ' +
        'Nothing was changed. Fix: edit the item to name what the upgraded package ships, or remove the name.',
      { count: report.brokenReferences.length, brokenReferences: listed(report.brokenReferences) },
    );
  }
  if (report.uncoveredDenies.length > 0) {
    logError(
      logger,
      `[security] ${report.uncoveredDenies.length} permission set(s) authored in this system grant an object whose ` +
        'field a package-shipped set denies, with no entry for that field, so the field stays visible or editable ' +
        'through them. Read as "grants the same object", not "copied from": a review item. Nothing was changed. Fix: ' +
        'add the field entry to the set if it was cloned from the package-shipped one.',
      { count: report.uncoveredDenies.length, uncoveredDenies: listed(report.uncoveredDenies) },
    );
  }
  if (!hasAccessUpgradeFindings(report)) {
    logger?.info?.(
      '[security] access upgrade report: every activation ledger row, sharing rule row and permission set authored ' +
        'in this system matches the registry at this boot',
      { absent: report.absent },
    );
  }
}

/** What the boot report did with its findings. */
export interface AccessUpgradeDelivery {
  /**
   * `notified`: handed to the ingress (`single`). `operator-log`: walled, so
   * the operator's line in this log is the channel. `undelivered`: `single`
   * findings that reached no administrator, said in the log with the cause.
   */
  outcome: 'clean' | 'stopped' | 'notified' | 'operator-log' | 'undelivered';
  recipients: string[];
  /** The finding set's digest — the notification's `dedupKey`. */
  findingSet?: string;
  reason?: string;
}

/**
 * The boot entry: collect, log, and raise the findings to the people who can
 * act on them. Never throws for a read or a delivery that did not happen.
 *
 * Under a wall the notification is never attempted: the findings are
 * deployment-level, the operator alone can act on them, and the notification
 * family is organization-scoped, so a walled system write with no organization
 * is refused (ADR-0131 D9) and stamping one would hand the finding to a tenant.
 * One `error` line addressed to the operator is the channel there.
 */
export async function reportAccessUpgrade(
  engine: AccessUpgradeReportEngine,
  deps: AccessUpgradeBootDeps,
): Promise<{ report: AccessUpgradeReport; delivery: AccessUpgradeDelivery }> {
  const report = await collectAccessUpgradeFindings(engine, deps);
  logReport(report, deps.logger);
  if (report.stopped) return { report, delivery: { outcome: 'stopped', recipients: [] } };
  if (!hasAccessUpgradeFindings(report)) return { report, delivery: { outcome: 'clean', recipients: [] } };

  const findingSet = accessUpgradeDedupKey(report);
  if (deps.walled) {
    const operators = [...resolvePlatformAdminEmails().emails];
    logError(
      deps.logger,
      '[security] platform operator: the access upgrade findings above are deployment-level — the activation ledger ' +
        'and the security catalog are shared by every organization — so only the operator can act on them, through ' +
        'the activation and clone doors. This tenancy posture has no in-app channel for a deployment-level ' +
        'notification, so this log is where they are raised; no organization is told. ' +
        (operators.length > 0
          ? 'The configured operator(s) are named in this line.'
          : 'No operator is configured: set OS_PLATFORM_OWNER_EMAIL to name the platform operator.'),
      { findingSet, operators },
    );
    return { report, delivery: { outcome: 'operator-log', recipients: operators, findingSet } };
  }

  const undelivered = (
    reason: string,
    fix: string,
    recipients: string[] = [],
  ): { report: AccessUpgradeReport; delivery: AccessUpgradeDelivery } => {
    logError(
      deps.logger,
      `[security] the access upgrade findings above reached no administrator: ${reason}. They are in this log only. ` +
        `Fix: ${fix}`,
      { findingSet },
    );
    return { report, delivery: { outcome: 'undelivered', recipients, findingSet, reason } };
  };
  if (!deps.messaging || typeof deps.messaging.emit !== 'function') {
    return undelivered('this composition has no messaging service', 'compose the messaging service.');
  }

  let audience: AccessUpgradeAudience;
  try {
    audience = await resolveAccessUpgradeAudience(engine);
  } catch (e) {
    return undelivered(
      `the administrators could not be read (${errorText(e)})`,
      'restore the store the grants are read from; the next boot reads them again.',
    );
  }
  if (audience.recipients.length === 0) {
    return undelivered(
      'no administrator is configured or granted',
      'grant admin_full_access in the Default Organization, or set OS_PLATFORM_OWNER_EMAIL.',
    );
  }
  const counts = {
    reEnablements: report.reEnablements.length,
    orphans: report.orphans.length,
    collisions: report.collisions.length,
    brokenReferences: report.brokenReferences.length,
    uncoveredDenies: report.uncoveredDenies.length,
  };
  try {
    await deps.messaging.emit({
      topic: ACCESS_UPGRADE_TOPIC,
      audience: audience.recipients,
      severity: 'warning',
      dedupKey: findingSet,
      ...(audience.organizationId !== undefined ? { organizationId: audience.organizationId } : {}),
      payload: {
        title: 'An upgrade changed what your access settings cover',
        body:
          'A package upgrade renamed, removed or collided with a sharing rule, permission set, position or ' +
          'capability your settings name. ' +
          (counts.reEnablements > 0
            ? `${counts.reEnablements} item(s) you switched off may be active again under a new name. `
            : '') +
          'Nothing was changed. The server log line "[security] access upgrade" lists each finding with its fix.',
        counts,
        findings: accessUpgradeSummary(report),
      },
    });
  } catch (e) {
    return undelivered(
      `the notification ingress refused it (${errorText(e)})`,
      'repair the cause the ingress names; the next boot raises the same findings again.',
      audience.recipients,
    );
  }
  return { report, delivery: { outcome: 'notified', recipients: audience.recipients, findingSet } };
}
