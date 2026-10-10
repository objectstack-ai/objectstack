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
 *    `permission_set` is empty. The grant-name backfill
 *    (`grant-permission-set-name-backfill.ts`) names every grant whose set row
 *    carries a name the catalog resolves; the rest — an id with no set row,
 *    another organization's set row, a set row whose name the catalog does not
 *    resolve (a row-only set) — stay unnamed, and an unnamed grant confers
 *    nothing.
 * 4. **Positions with no definition** — `sys_position` rows whose name the
 *    catalog does not resolve, by name and organization. Under a walled
 *    posture these are the positions an organization authored in Setup: there
 *    is no organization-level catalog (ADR-0131 D3), so they have no registry
 *    home. Under `single` they are the row-only positions the row-only
 *    position backfill (`position-environment-backfill.ts`) could not define,
 *    each marked `refusedName` when its name is one the metadata door refuses
 *    (that class is final for the backfill, which records its verdict and
 *    stops reporting it).
 *
 * And, under `single` only, where a position name is unique per deployment:
 *
 * 5. **Conflicting position names** — a name carried by more than one
 *    `sys_position` row (two organizations' rows, or an organization's row
 *    beside the row a package or a built-in seeded). Reported, never guessed
 *    and never merged (ADR-0131 D10, fate 4). Under a walled posture the
 *    catalog rows are materialized per organization, so one name on several
 *    rows is the expected shape there, not a conflict.
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
 * composition without one of the three objects reads the others and names the
 * absent one in the result.
 *
 * ## When it runs
 *
 * At `kernel:bootstrapped`, from `SecurityPlugin.start`, AFTER the grant-name
 * and row-only position backfills registered beside it (handlers run in
 * registration order): every `kernel:ready` handler has settled, so every
 * code, package and environment definition this boot registers is in the
 * catalog, and a name either backfill gives a definition or a grant this boot
 * is not reported. A package installed into the running process later is not
 * re-judged until the next boot, which is why every line says "at this boot".
 *
 * ADR anchors: ADR-0131 D3 (one catalog home, no organization-level catalog),
 * D4 (references by name), D10 (a conflict is reported, never guessed).
 */

import { postureEnforcesWall, type TenancyPosture } from '@objectstack/spec/security';
import type { SecurityCatalogReader, SecurityCatalogType } from '@objectstack/core';
import { GRANT_OBJECT, GRANT_SET_ID_FIELD, GRANT_SET_NAME_FIELD } from './grant-permission-set-name.js';
import { POSITION_OBJECT, metadataDoorAcceptsPositionName } from './position-write-through.js';

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
  /** The tenancy posture in force: it decides whether a shared position name is a conflict. */
  posture: TenancyPosture;
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
  /** The grant's id reference, when it carries one — what the name backfill could not turn into a name. */
  permissionSetId: string | null;
}

/** One position name an organization holds rows of, with no definition in the catalog. */
export interface PositionWithoutDefinition {
  name: string;
  /** The metadata door refuses this name, so no definition can ever carry it. */
  refusedName: boolean;
}

/** Everything the report found for one organization; `null` is the organization-less bucket. */
export interface OrganizationCatalogReferences {
  organizationId: string | null;
  positionAssignments: UnresolvedReference[];
  permissionSetGrants: UnresolvedReference[];
  unnamedGrants: UnnamedGrant[];
  positionsWithoutDefinition: PositionWithoutDefinition[];
}

/** A position name more than one `sys_position` row carries under `single`. */
export interface ConflictingPositionName {
  name: string;
  /** The organization of each row carrying it, `null` for an organization-less row; sorted, repeats kept. */
  organizationIds: Array<string | null>;
  /** Whether the catalog resolves the name (a package, a built-in or the environment holds it). */
  resolves: boolean;
}

/** Why the report stopped before it judged every reference. */
export type CatalogReferenceReportStop =
  | 'scan-unreadable'
  | 'catalog-unreadable';

/** What one report found. Only organizations with a finding are listed, the organization-less bucket first. */
export interface CatalogReferenceReport {
  posture: TenancyPosture;
  organizations: OrganizationCatalogReferences[];
  /** Under `single` only; always empty under a walled posture. */
  conflictingPositionNames: ConflictingPositionName[];
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

/** The catalog's answer per name, each name asked once. */
function catalogResolver(catalog: SecurityCatalogReader): (type: SecurityCatalogType, name: string) => Promise<boolean> {
  const memo = new Map<string, boolean>();
  return async (type, name) => {
    const key = `${type}\u0000${name}`;
    const known = memo.get(key);
    if (known !== undefined) return known;
    let resolves: boolean;
    try {
      const entry = await catalog.resolve(type, name);
      resolves = entry !== undefined && entry.name === name;
    } catch (e) {
      throw new ReportStop('catalog-unreadable', 'the security catalog', e);
    }
    memo.set(key, resolves);
    return resolves;
  };
}

/**
 * Read the stored references and the catalog, and return what resolves
 * nowhere. Logs nothing; {@link reportCatalogReferences} is the boot entry.
 * A read that did not happen is returned in `stopped`, never thrown.
 */
export async function collectCatalogReferences(
  engine: CatalogReferenceReportEngine,
  deps: Pick<CatalogReferenceReportDeps, 'posture' | 'catalog'>,
): Promise<CatalogReferenceReport> {
  const report: CatalogReferenceReport = {
    posture: deps.posture,
    organizations: [],
    conflictingPositionNames: [],
    absent: [],
  };
  const has = (object: string): boolean => {
    const present = !!engine?.getObject?.(object);
    if (!present) report.absent.push(object);
    return present;
  };
  const readAssignments = has(POSITION_ASSIGNMENT_OBJECT);
  const readGrants = has(GRANT_OBJECT);
  const readPositions = has(POSITION_OBJECT);

  const byOrganization = new Map<string | null, OrganizationCatalogReferences>();
  const bucket = (organizationId: string | null): OrganizationCatalogReferences => {
    let found = byOrganization.get(organizationId);
    if (!found) {
      found = {
        organizationId,
        positionAssignments: [],
        permissionSetGrants: [],
        unnamedGrants: [],
        positionsWithoutDefinition: [],
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
        if (name === undefined || (await resolves('position', name))) continue;
        bucket(organizationOf(row)).positionAssignments.push({
          id: String(row.id), userId: stringOrNull(row.user_id), name,
        });
      }
    }

    if (readGrants) {
      const rows = await scanAll(engine, GRANT_OBJECT, [
        'id', 'user_id', GRANT_SET_ID_FIELD, GRANT_SET_NAME_FIELD, 'organization_id',
      ]);
      for (const row of rows) {
        const name = nameOf(row[GRANT_SET_NAME_FIELD]);
        if (name === undefined) {
          bucket(organizationOf(row)).unnamedGrants.push({
            id: String(row.id), userId: stringOrNull(row.user_id), permissionSetId: stringOrNull(row[GRANT_SET_ID_FIELD]),
          });
          continue;
        }
        if (await resolves('permission', name)) continue;
        bucket(organizationOf(row)).permissionSetGrants.push({
          id: String(row.id), userId: stringOrNull(row.user_id), name,
        });
      }
    }

    if (readPositions) {
      // No field projection: the organization column is the one the tenancy
      // layer provisions, not one the object declares.
      const rows = await scanAll(engine, POSITION_OBJECT);
      const organizationsByName = new Map<string, Array<string | null>>();
      for (const row of rows) {
        const name = nameOf(row.name);
        if (name === undefined) continue;
        const list = organizationsByName.get(name);
        if (list) list.push(organizationOf(row));
        else organizationsByName.set(name, [organizationOf(row)]);
      }
      const single = !postureEnforcesWall(deps.posture);
      for (const name of [...organizationsByName.keys()].sort()) {
        const organizationIds = organizationsByName.get(name)!.sort(compareKeys);
        const resolved = await resolves('position', name);
        if (!resolved) {
          for (const organizationId of new Set(organizationIds)) {
            bucket(organizationId).positionsWithoutDefinition.push({
              name, refusedName: !metadataDoorAcceptsPositionName(name),
            });
          }
        }
        if (single && organizationIds.length > 1) {
          report.conflictingPositionNames.push({ name, organizationIds, resolves: resolved });
        }
      }
    }
  } catch (e) {
    if (!(e instanceof ReportStop)) throw e;
    report.stopped = e.stop;
    report.stoppedReading = e.reading;
    report.stoppedError = errorText(e.reason);
    report.organizations = [];
    report.conflictingPositionNames = [];
    return report;
  }

  report.organizations = [...byOrganization.values()].sort((a, b) => compareKeys(a.organizationId, b.organizationId));
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
        'empty), so each confers nothing (ADR-0131 D4). The one-time name backfill names a grant whose set row ' +
        'carries a name the catalog resolves; these did not get one — the set row is missing, belongs to another ' +
        'organization, or carries a name the catalog does not resolve, and the backfill logs which. Nothing was ' +
        'changed. Fix: grant the intended permission set again by name, or remove these grants.',
      { count: unnamed.count, organizations: unnamed.organizations },
    );
  }

  const positions = perOrganization(report, (o) => o.positionsWithoutDefinition, (items) => ({
    positions: listed(items.map((i) => i.name)),
    refusedNames: items.filter((i) => i.refusedName).map((i) => i.name),
  }));
  if (positions.count > 0) {
    const walled = postureEnforcesWall(report.posture);
    logError(
      logger,
      `[security] ${positions.count} position(s), listed by name and organization, have ${POSITION_OBJECT} rows ` +
        'and no definition the security catalog resolves at this boot, so assignments to them distribute no ' +
        'permission set. ' +
        (walled
          ? 'Under a walled posture a position an organization authored in Setup has no catalog home: the catalog ' +
            'is environment-level (ADR-0131 D3). Fix: define the position in the environment catalog through the ' +
            'metadata door, or remove it and its assignments.'
          : 'Under single the row-only position backfill gives such a position its environment definition, except ' +
            'a name the metadata door refuses (refusedNames) or a name whose rows disagree. Fix: rename a refused ' +
            'name in Setup to a lowercase snake_case name; make disagreeing rows agree; or remove the position and ' +
            'its assignments.') +
        ' Nothing was changed.',
      { count: positions.count, organizations: positions.organizations },
    );
  }

  if (report.conflictingPositionNames.length > 0) {
    logError(
      logger,
      `[security] ${report.conflictingPositionNames.length} position name(s) are carried by more than one ` +
        `${POSITION_OBJECT} row under the single posture, where a position name is unique per deployment. Each is ` +
        'reported as conflicting, never guessed and never merged (ADR-0131 D10): an assignment names only the ' +
        'name, so at most one of those rows can be what it means. Nothing was changed. Fix: keep one row per name ' +
        '— rename or remove the others in Setup.',
      {
        count: report.conflictingPositionNames.length,
        conflicting: listed(report.conflictingPositionNames.map((c) => ({
          name: c.name, organizationIds: c.organizationIds, resolves: c.resolves,
        }))),
      },
    );
  }

  const clean = report.organizations.length === 0 && report.conflictingPositionNames.length === 0;
  // A composition with none of the three objects has nothing to report on.
  if (clean && report.absent.length < 3) {
    logger?.info?.(
      '[security] catalog reference report: every position assignment and permission-set grant names an item ' +
        'the security catalog resolves at this boot, and no position row is without a definition',
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
