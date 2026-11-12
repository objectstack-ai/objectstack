// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The boot report of security catalog references that resolve nowhere
 * (ADR-0131 D3/D4).
 *
 * ## What it reports
 *
 * ADR-0131 D4 makes every reference to a position or a permission set a NAME,
 * and resolution reads the security catalog — the environment registry, read
 * through `createSecurityCatalogReader` (`@objectstack/core`). A stored
 * reference whose name the catalog does not hold confers nothing: the
 * authorization resolver grants through the catalog, so such a reference fails
 * closed. Failing closed is silent by itself — the assignment is still listed
 * in Setup, and nothing tells anyone it grants nothing. This report is the loud
 * half. At every boot it reads, and lists PER ORGANIZATION:
 *
 * 1. **Assignments naming no position** — `sys_user_position` rows whose
 *    `position` the catalog does not resolve.
 * 2. **Grants naming no permission set** — `sys_user_permission_set` rows
 *    whose `permission_set` the catalog does not resolve.
 * 3. **Grants that name nothing** — `sys_user_permission_set` rows whose
 *    `permission_set` is empty. The v18 ceremony's verified rewrite names
 *    every grant it can before the legacy id column is dropped, and blocks on
 *    the rest; an unnamed grant confers nothing.
 * 5. **[ADR-0150 D8] Grants withheld beside a bound grant** —
 *    `sys_user_permission_set` rows whose `permission_set_package` names a
 *    package that no longer serves the set, read onto a holder another grant
 *    of the same user, set and organization is bound to. Each confers nothing
 *    (`staleGrantBesideBoundGrant`, `@objectstack/core`, the rule the
 *    authorization resolver applies); the fix is to remove it.
 *
 * And it lists PER POSITION, since a definition belongs to the environment and
 * to no organization:
 *
 * 4. **Positions naming a permission set the catalog does not resolve** — position definitions in the
 *    catalog whose `permissionSets` name a set the catalog does not resolve.
 *    The authorization resolver reads a position's sets from its definition,
 *    so a holder of the position is granted nothing through such a name. The
 *    usual cause is a package that declared the set and is now uninstalled or
 *    disabled while a position still binds it; reinstalling the package clears
 *    the line at the next boot, with nothing else to do. [ADR-0150 D3/D7] A
 *    position's set resolves from the package that declared the position, so
 *    a name that package cannot reach — held only by the environment, or only
 *    by a package outside its declared dependency closure — or that two
 *    holders it can reach both hold, is reported here too, with the
 *    resolver's refusal naming every candidate.
 *
 * It reads no `sys_position` row: positions are read from the catalog. The catalog row objects are retired (C3
 * stage 8), so no composition provisions that table, and a Setup-authored
 * position row with no definition — or a name several such rows carry — is
 * the upgrade ceremony's to convert or report (ADR-0131 D10, C7), never a boot
 * report's.
 *
 * ## What it does not do
 *
 * It writes nothing: no row, no definition, no ledger entry. It repairs
 * nothing and deletes nothing (deletions are ADR-0131 C7's). It does not
 * decide what a reference grants — the authorization resolver does; this only
 * says which references the catalog cannot resolve at this boot. A reference
 * the next boot resolves (its definition re-declared, or saved through the
 * metadata door) simply drops out of the next report.
 *
 * ## A read that did not happen is not "resolves nowhere"
 *
 * A scan that cannot be read, or a catalog read that throws (the catalog
 * raises `AuthzStoreUnavailableError` for a reader that failed), stops the
 * report: it says which store could not be read and reports no finding past
 * that point, because an unread answer is never taken for an absent name. A
 * composition without one of the two objects reads the other and names the
 * absent one in the result; the position definitions are read from the catalog
 * in every composition.
 *
 * ## When it runs
 *
 * At `kernel:bootstrapped`, from `SecurityPlugin.start`: every `kernel:ready`
 * handler has settled, so every code, package and environment definition this
 * boot registers is in the catalog. A package installed into the running process later is not
 * re-judged until the next boot, which is why every line says "at this boot".
 *
 * ADR anchors: ADR-0131 D3 (one catalog home), D4 (references by name).
 */

import {
  boundGrantPackages,
  catalogEntryAddress,
  resolveCatalogReference,
  staleGrantBesideBoundGrant,
  storedPermissionSetScope,
  type SecurityCatalogEntry,
  type SecurityCatalogReader,
  type SecurityCatalogType,
} from '@objectstack/core';
import { GRANT_OBJECT, GRANT_SET_NAME_FIELD } from './grant-permission-set-name.js';
import { PERMISSION_SET_PACKAGE_COLUMN } from './stored-permission-set-package-backfill.js';

/** The user ↔ position assignment object (ADR-0057 D4). */
export const POSITION_ASSIGNMENT_OBJECT = 'sys_user_position';

/** Rows per page of each scan. */
const SCAN_PAGE_SIZE = 500;

/** Entries printed per list; every count is complete. */
const LOGGED_LIMIT = 50;

const SYSTEM_CTX = { isSystem: true } as const;

/** The engine surface the report reads through — ObjectQL satisfies it as it stands. */
export interface CatalogReferenceReportEngine {
  getObject(name: string): unknown;
  find(object: string, options: Record<string, unknown>): Promise<unknown>;
}

/** The kernel logger, as this module uses it. */
export interface CatalogReferenceReportLogger {
  info?: (message: string, meta?: Record<string, any>) => void;
  warn: (message: string, meta?: Record<string, any>) => void;
  /** The kernel logger's shape: message, cause, meta. */
  error?: (message: string, cause?: Error, meta?: Record<string, any>) => void;
}

export interface CatalogReferenceReportDeps {
  /** The security catalog read every name is resolved through. */
  catalog: SecurityCatalogReader;
  logger?: CatalogReferenceReportLogger;
}

/** One stored reference whose name the catalog does not resolve. */
export interface UnresolvedReference {
  /** The assignment or grant row's id. */
  id: string;
  userId: string | null;
  /** The name the row carries. */
  name: string;
}

/** One grant that names no permission set. */
export interface UnnamedGrant {
  id: string;
  userId: string | null;
}

/**
 * [ADR-0150 D8] One grant whose package no longer serves its set, read onto a
 * holder another grant of the same user, set and organization is bound to.
 */
export interface StaleGrantBesideBound {
  id: string;
  userId: string | null;
  /** The set's name. */
  name: string;
  /** The package the row names, which no longer serves the set. */
  packageId: string;
  /** The package the set now resolves to, which the other grant is bound to. */
  holder: string;
}

/** Everything the report found for one organization; `null` is the organization-less bucket. */
export interface OrganizationCatalogReferences {
  organizationId: string | null;
  positionAssignments: UnresolvedReference[];
  permissionSetGrants: UnresolvedReference[];
  unnamedGrants: UnnamedGrant[];
  /** [ADR-0150 D8] Grants that confer nothing beside a grant bound to the holder they read. */
  staleGrantsBesideBound: StaleGrantBesideBound[];
}

/** One position definition that names permission sets the catalog does not resolve. */
export interface PositionNamingUnresolvedSets {
  /** The position's name. */
  position: string;
  /** The package the definition names as its owner, or `null` for a stack or environment definition. */
  packageId: string | null;
  /** The names in its `permissionSets` the catalog does not resolve, in declared order. */
  permissionSets: string[];
  /**
   * [ADR-0150 D3] Those of {@link PositionNamingUnresolvedSets.permissionSets}
   * the package-scoped resolution refused, each with every candidate — absent
   * when none was refused.
   */
  refusals?: PositionSetRefusal[];
}

/** [ADR-0150 D3] One permission-set name a position cannot resolve, and why: every candidate named, none picked. */
export interface PositionSetRefusal {
  permissionSet: string;
  /** The resolver's reason (`outside-closure`, `ambiguous-in-closure`, `ambiguous-in-environment`). */
  reason: string;
  /** Every candidate holder, described. */
  candidates: string[];
  /** The resolver's sentence. */
  message: string;
}

/** Why the report stopped before it judged every reference. */
export type CatalogReferenceReportStop =
  | 'scan-unreadable'
  | 'catalog-unreadable';

/** What one report found. Only organizations with a finding are listed, the organization-less bucket first. */
export interface CatalogReferenceReport {
  organizations: OrganizationCatalogReferences[];
  /** Position definitions naming a permission set the catalog does not resolve, by position name. */
  positions: PositionNamingUnresolvedSets[];
  /** The objects this composition does not provision; their part of the report was not read. */
  absent: string[];
  /** Set when a read did not happen; no finding is reported past it. */
  stopped?: CatalogReferenceReportStop;
  /** The store that could not be read, when `stopped` is set. */
  stoppedReading?: string;
  /** What the failed read said, when `stopped` is set. */
  stoppedError?: string;
}

/** Thrown inside the report to stop it; never escapes the module. */
class ReportStop extends Error {
  constructor(readonly stop: CatalogReferenceReportStop, readonly reading: string, readonly reason: unknown) {
    super(stop);
  }
}

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** The organization a stored row belongs to, or `null`; a blank value is the legacy organization-less spelling. */
function organizationOf(row: Record<string, unknown>): string | null {
  const value = row.organization_id ?? row.organizationId;
  if (value === null || value === undefined || value === '') return null;
  return String(value);
}

/** A non-blank string, trimmed; anything else is no name. */
function nameOf(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const name = value.trim();
  return name === '' ? undefined : name;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : typeof value === 'number' ? String(value) : null;
}

/** Code-unit order, `null` first — independent of locale. */
function compareKeys(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  return a < b ? -1 : 1;
}

/** Every row of `object`, read in full, ordered by id. */
async function scanAll(
  engine: CatalogReferenceReportEngine,
  object: string,
  fields?: string[],
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (let offset = 0; ; offset += SCAN_PAGE_SIZE) {
    let page: unknown;
    try {
      page = await engine.find(object, {
        where: {},
        ...(fields ? { fields } : {}),
        orderBy: [{ field: 'id', order: 'asc' }],
        limit: SCAN_PAGE_SIZE,
        offset,
        context: SYSTEM_CTX,
      });
    } catch (e) {
      throw new ReportStop('scan-unreadable', object, e);
    }
    const rows = Array.isArray(page) ? (page as Record<string, unknown>[]) : [];
    for (const row of rows) if (row && typeof row === 'object') out.push(row);
    if (rows.length < SCAN_PAGE_SIZE) break;
  }
  return out;
}

/** Every position definition in the catalog; a read that fails, or answers no list, stops the report. */
async function listPositions(catalog: SecurityCatalogReader): Promise<SecurityCatalogEntry[]> {
  let entries: unknown;
  try {
    entries = await catalog.list('position');
  } catch (e) {
    throw new ReportStop('catalog-unreadable', 'the security catalog', e);
  }
  if (!Array.isArray(entries)) {
    throw new ReportStop('catalog-unreadable', 'the security catalog', new Error('the position list answered no list'));
  }
  return entries as SecurityCatalogEntry[];
}

/**
 * The catalog's answer per name, each name asked once: the package of the
 * holder it resolves to (`null` for the environment's), or `false` when it
 * resolves nowhere.
 */
function catalogResolver(
  catalog: SecurityCatalogReader,
): (type: SecurityCatalogType, name: string, packageColumn?: unknown) => Promise<string | null | false> {
  const memo = new Map<string, string | null | false>();
  return async (type, name, packageColumn) => {
    // [ADR-0150 D8 R1] A grant naming its holder is asked for that package's
    // set, as the authorization resolver asks it (`storedPermissionSetScope`).
    const scope = type === 'permission' ? storedPermissionSetScope(packageColumn) : undefined;
    const key = `${type}\u0000${name}\u0000${scope?.packageId ?? ''}`;
    const known = memo.get(key);
    if (known !== undefined) return known;
    let holder: string | null | false;
    try {
      const entry = await catalog.resolve(type, name, scope);
      holder = entry !== undefined && entry.name === name ? catalogEntryAddress(entry).packageId : false;
    } catch (e) {
      throw new ReportStop('catalog-unreadable', 'the security catalog', e);
    }
    memo.set(key, holder);
    return holder;
  };
}

/**
 * Read the stored references and the catalog, and return what resolves
 * nowhere. Logs nothing; {@link reportCatalogReferences} is the boot entry.
 * A read that did not happen is returned in `stopped`, never thrown.
 */
export async function collectCatalogReferences(
  engine: CatalogReferenceReportEngine,
  deps: Pick<CatalogReferenceReportDeps, 'catalog'>,
): Promise<CatalogReferenceReport> {
  const report: CatalogReferenceReport = {
    organizations: [],
    positions: [],
    absent: [],
  };
  const has = (object: string): boolean => {
    const present = !!engine?.getObject?.(object);
    if (!present) report.absent.push(object);
    return present;
  };
  const readAssignments = has(POSITION_ASSIGNMENT_OBJECT);
  const readGrants = has(GRANT_OBJECT);

  const byOrganization = new Map<string | null, OrganizationCatalogReferences>();
  const bucket = (organizationId: string | null): OrganizationCatalogReferences => {
    let found = byOrganization.get(organizationId);
    if (!found) {
      found = {
        organizationId,
        positionAssignments: [],
        permissionSetGrants: [],
        unnamedGrants: [],
        staleGrantsBesideBound: [],
      };
      byOrganization.set(organizationId, found);
    }
    return found;
  };
  const resolves = catalogResolver(deps.catalog);

  try {
    if (readAssignments) {
      const rows = await scanAll(engine, POSITION_ASSIGNMENT_OBJECT, ['id', 'user_id', 'position', 'organization_id']);
      for (const row of rows) {
        const name = nameOf(row.position);
        if (name === undefined || (await resolves('position', name)) !== false) continue;
        bucket(organizationOf(row)).positionAssignments.push({
          id: String(row.id), userId: stringOrNull(row.user_id), name,
        });
      }
    }

    if (readGrants) {
      const rows = await scanAll(engine, GRANT_OBJECT, [
        'id', 'user_id', GRANT_SET_NAME_FIELD, PERMISSION_SET_PACKAGE_COLUMN, 'organization_id',
      ]);
      // [ADR-0150 D8] The holders each user's grants are bound to, read as the
      // authorization resolver reads them: every row, whatever its window.
      const rowsByUser = new Map<string | null, Record<string, unknown>[]>();
      for (const row of rows) {
        const userId = stringOrNull(row.user_id);
        const own = rowsByUser.get(userId);
        if (own) own.push(row);
        else rowsByUser.set(userId, [row]);
      }
      const boundByUser = new Map([...rowsByUser].map(([userId, own]) => [userId, boundGrantPackages(own)] as const));
      for (const row of rows) {
        const name = nameOf(row[GRANT_SET_NAME_FIELD]);
        if (name === undefined) {
          bucket(organizationOf(row)).unnamedGrants.push({
            id: String(row.id), userId: stringOrNull(row.user_id),
          });
          continue;
        }
        const holder = await resolves('permission', name, row[PERMISSION_SET_PACKAGE_COLUMN]);
        if (holder === false) {
          bucket(organizationOf(row)).permissionSetGrants.push({
            id: String(row.id), userId: stringOrNull(row.user_id), name,
          });
          continue;
        }
        const userId = stringOrNull(row.user_id);
        if (holder !== null && staleGrantBesideBoundGrant(row, holder, boundByUser.get(userId) ?? new Map())) {
          bucket(organizationOf(row)).staleGrantsBesideBound.push({
            id: String(row.id), userId, name, packageId: String(row[PERMISSION_SET_PACKAGE_COLUMN]).trim(), holder,
          });
        }
      }
    }

    for (const entry of await listPositions(deps.catalog)) {
      const declared = entry?.definition?.permissionSets;
      if (!Array.isArray(declared)) continue;
      const unresolved: string[] = [];
      const refusals: PositionSetRefusal[] = [];
      for (const value of declared) {
        const name = nameOf(value);
        if (name === undefined || unresolved.includes(name)) continue;
        // [ADR-0150 D7] Resolved from the position, as the authorization
        // resolver grants it — never by the bare name alone.
        let answer: Awaited<ReturnType<typeof resolveCatalogReference>>;
        try {
          answer = await resolveCatalogReference(deps.catalog, 'permission', name, { position: entry });
        } catch (e) {
          throw new ReportStop('catalog-unreadable', 'the security catalog', e);
        }
        if (answer.status === 'resolved' && answer.entry.name === name) continue;
        unresolved.push(name);
        if (answer.status === 'refused') {
          refusals.push({ permissionSet: name, reason: answer.reason, candidates: [...answer.candidates], message: answer.message });
        }
      }
      if (unresolved.length === 0) continue;
      report.positions.push({
        position: entry.name,
        packageId: entry.packageId ?? null,
        permissionSets: unresolved,
        ...(refusals.length > 0 ? { refusals } : {}),
      });
    }
  } catch (e) {
    if (!(e instanceof ReportStop)) throw e;
    report.stopped = e.stop;
    report.stoppedReading = e.reading;
    report.stoppedError = errorText(e.reason);
    report.organizations = [];
    report.positions = [];
    return report;
  }

  report.organizations = [...byOrganization.values()].sort((a, b) => compareKeys(a.organizationId, b.organizationId));
  report.positions.sort((a, b) => compareKeys(a.position, b.position));
  return report;
}

/** At most {@link LOGGED_LIMIT} entries, and how many more there are. */
function listed<T>(items: readonly T[]): { items: T[]; more?: number } {
  return items.length > LOGGED_LIMIT
    ? { items: items.slice(0, LOGGED_LIMIT), more: items.length - LOGGED_LIMIT }
    : { items: [...items] };
}

function logError(logger: CatalogReferenceReportLogger | undefined, message: string, meta: Record<string, unknown>): void {
  if (logger?.error) logger.error(message, undefined, meta);
  else logger?.warn(message, meta);
}

/** The per-organization lines of one category, each organization once. */
function perOrganization<T>(
  report: CatalogReferenceReport,
  pick: (o: OrganizationCatalogReferences) => readonly T[],
  describe: (items: readonly T[]) => Record<string, unknown>,
): { count: number; organizations: { items: Record<string, unknown>[]; more?: number } } {
  let count = 0;
  const lines: Record<string, unknown>[] = [];
  for (const organization of report.organizations) {
    const items = pick(organization);
    if (items.length === 0) continue;
    count += items.length;
    lines.push({ organizationId: organization.organizationId, count: items.length, ...describe(items) });
  }
  return { count, organizations: listed(lines) };
}

/** Distinct names, sorted, with how many rows carry each. */
function nameCounts(items: readonly UnresolvedReference[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of [...items].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    counts[item.name] = (counts[item.name] ?? 0) + 1;
  }
  return counts;
}

/** Log one report — once per category, never once per row. */
function logReport(report: CatalogReferenceReport, logger?: CatalogReferenceReportLogger): void {
  if (report.stopped) {
    logger?.warn(
      `[security] the catalog reference report stopped: ${report.stoppedReading} could not be read, and an unread ` +
        'answer is never taken for "resolves nowhere". It reports nothing for this boot and runs again on the next.',
      { stop: report.stopped, error: report.stoppedError },
    );
    return;
  }

  const assignments = perOrganization(report, (o) => o.positionAssignments, (items) => ({
    positions: nameCounts(items), assignments: listed(items.map((i) => i.id)),
  }));
  if (assignments.count > 0) {
    logError(
      logger,
      `[security] ${assignments.count} ${POSITION_ASSIGNMENT_OBJECT} assignment(s) name a position the security ` +
        'catalog does not resolve at this boot (ADR-0131 D4: a reference is a name the catalog resolves), so no ' +
        'permission set reaches a user through them, while Setup still lists each one. Nothing was changed. Fix: ' +
        'declare the position again (its package, or its environment definition), or remove the assignments.',
      { count: assignments.count, organizations: assignments.organizations },
    );
  }

  const grants = perOrganization(report, (o) => o.permissionSetGrants, (items) => ({
    permissionSets: nameCounts(items), grants: listed(items.map((i) => i.id)),
  }));
  if (grants.count > 0) {
    logError(
      logger,
      `[security] ${grants.count} ${GRANT_OBJECT} grant(s) name a permission set the security catalog does not ` +
        'resolve at this boot (ADR-0131 D4), so each confers nothing, while Setup still lists it. Nothing was ' +
        'changed. Fix: declare the permission set again (its package, or its environment definition), or remove ' +
        'the grants.',
      { count: grants.count, organizations: grants.organizations },
    );
  }

  const unnamed = perOrganization(report, (o) => o.unnamedGrants, (items) => ({
    grants: listed(items.map((i) => i.id)),
  }));
  if (unnamed.count > 0) {
    logError(
      logger,
      `[security] ${unnamed.count} ${GRANT_OBJECT} grant(s) name no permission set (${GRANT_SET_NAME_FIELD} is ` +
        'empty), so each confers nothing (ADR-0131 D4). Nothing was changed. Fix: run the v18 ceremony. Plan it ' +
        'first, os migrate organization-ownership --out plan.json, and review the file it writes; then run ' +
        'os migrate organization-ownership --apply --backup-taken --plan-file plan.json, which executes that plan: ' +
        'it names each legacy grant from its retired id and lists the ones it cannot name. Then restart. Granting ' +
        'the set again by name before it runs makes a second grant the ceremony will report, not name.',
      { count: unnamed.count, organizations: unnamed.organizations },
    );
  }

  const withheld = perOrganization(report, (o) => o.staleGrantsBesideBound, (items) => ({
    grants: listed(items.map((i) => ({ id: i.id, userId: i.userId, permissionSet: i.name, packageId: i.packageId, holder: i.holder }))),
  }));
  if (withheld.count > 0) {
    logError(
      logger,
      `[security] ${withheld.count} ${GRANT_OBJECT} grant(s) name a package that no longer serves their permission set, ` +
        'and the set now resolves to a package another grant of the same user, set and organization is bound to ' +
        '(ADR-0150 D8), so each confers nothing: the bound grant, with its validity window, grants the set. Nothing ' +
        'was changed. Fix: remove each listed grant.',
      { count: withheld.count, organizations: withheld.organizations },
    );
  }

  if (report.positions.length > 0) {
    const sets = new Set(report.positions.flatMap((p) => p.permissionSets));
    logError(
      logger,
      `[security] ${report.positions.length} position definition(s) name a permission set the security catalog ` +
        'does not resolve at this boot (ADR-0131 D4), so a holder of the position is granted nothing through that ' +
        'name. Nothing was changed. Fix: install or enable again the package that declared the permission set (the ' +
        'next boot then clears this line by itself), declare the set again, or remove the name from the ' +
        "position's permissionSets. A name listed under refusals is held, but not where the position's package " +
        'can reach it, or by more than one holder it can reach (ADR-0150 D3): each refusal names every candidate. ' +
        'Declare a dependency on the package that holds it, or bind the set through an administrator overlay of ' +
        'the position, which resolves it as the environment does.',
      {
        count: report.positions.length,
        permissionSets: [...sets].sort(),
        positions: listed(report.positions.map((p) => ({
          position: p.position,
          packageId: p.packageId,
          permissionSets: p.permissionSets,
          ...(p.refusals ? { refusals: p.refusals } : {}),
        }))),
      },
    );
  }

  const clean = report.organizations.length === 0 && report.positions.length === 0;
  // A composition with neither object has no assignment or grant to report on.
  if (clean && report.absent.length < 2) {
    logger?.info?.(
      '[security] catalog reference report: every position assignment, permission-set grant and position ' +
        "definition's permission set names an item the security catalog resolves at this boot",
      { absent: report.absent },
    );
  }
}

/**
 * The boot entry: collect the report, log it, and return it. Never throws for
 * a read that did not happen; the boot hook that calls this still guards
 * against anything unforeseen.
 */
export async function reportCatalogReferences(
  engine: CatalogReferenceReportEngine,
  deps: CatalogReferenceReportDeps,
): Promise<CatalogReferenceReport> {
  const report = await collectCatalogReferences(engine, deps);
  logReport(report, deps.logger);
  return report;
}
