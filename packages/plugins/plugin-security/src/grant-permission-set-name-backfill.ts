// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The one-time backfill of `sys_user_permission_set.permission_set` — the
 * grant's permission set BY NAME ([ADR-0131] D4) — on the grants written
 * before the column existed.
 *
 * ## What it does
 *
 * Every grant written since the column landed names its set: the platform's
 * writers write both columns, and the engine hooks in
 * `grant-permission-set-name.ts` derive the name from `permission_set_id` for
 * every other writer. Grants written before that carry `NULL`. This pass gives
 * each of them the name its own id already points at, so every grant obeys the
 * column's one rule — system-written, agreeing with the id — before any reader
 * is switched onto the name. It changes no reader, no id and no grant's
 * meaning, and it deletes nothing (deletions are ADR-0131 C7's).
 *
 * For each grant with no name:
 *
 * 1. **The set row its id names, read inside the grant's own wall.** The read
 *    runs under the grant's organization (`seedCtx`), so it routes through the
 *    driver's tenant scope — the one governed spelling of the wall, the same
 *    read the hooks and the authorization resolver's position read make —
 *    and sees that organization's rows and the organization-less ones. The
 *    grant rule the resolver applies to every stored grant row is then asked
 *    of the set row: an organization-less row applies everywhere, a row of an
 *    organization applies only to a grant of that same organization. So an
 *    organization-less grant (one that applies in every organization) may
 *    name only an organization-less set.
 * 2. **The name is verified through the security catalog read** (S1's
 *    `createSecurityCatalogReader`, `@objectstack/core`) before it is written:
 *    a name the catalog does not resolve is not written.
 * 3. **Written as a system update of the name alone**, under the grant's own
 *    organization. The update hook re-derives the name from the row's stored
 *    id through its own walled read and refuses a disagreement, so a grant
 *    whose id moved between this pass's read and its write is refused, not
 *    mislabelled. The hook stamps a name by itself only on a write that
 *    carries `permission_set_id`; this write carries the verified name and no
 *    id, so nothing keyed on the id column (the last-administrator guard's
 *    standing keys among them) re-judges the grant. ⛔ The wall in step 1 is
 *    this pass's own: for a SYSTEM write whose stored id the hook cannot
 *    resolve inside the writer's wall, the hook stands down and lets the
 *    value land, so it would not stop a name carried across organizations.
 *
 * ## Report, never guess
 *
 * A grant this pass cannot name keeps `NULL` and is reported, by count and
 * grant row id. Nothing about another organization is logged:
 *
 * - **an id that names no set row** (`warn`) — it grants nothing today either;
 * - **an id whose set row belongs to another organization** (`warn`) — its
 *   name is never written: a name carries no organization, so writing another
 *   organization's name would point the grant at whatever this organization
 *   calls by that name. The authorization resolver still reads a grant's set
 *   row by id without a wall, so such a grant grants by id today; the pass
 *   does not carry that answer into the name;
 * - **a set row whose name the catalog read does not resolve** (`error`) —
 *   the grant points at a definition the catalog does not hold, so it would
 *   fail closed once readers read the name.
 *
 * ## Once, and remembered
 *
 * The pass runs until it has reached a verdict once, records that verdict in
 * the deployment ledger `sys_migration`, and every later pass reads the record
 * and does nothing — the shape of `plugin-auth`'s
 * `membership-backfill-ledger.ts`. The row: its own id
 * ({@link GRANT_SET_NAME_BACKFILL_MIGRATION_ID}), `verified_at: null` (no
 * consumer gates on it, so it certifies nothing) and `blocking: 0` (it holds
 * no consumer closed); `details` carries what the pass did.
 *
 * Recorded — nothing a later pass could change: every unnamed grant was named,
 * or names no set row, or names another organization's set row.
 *
 * Not recorded — a later pass may still decide differently, so it gets its
 * turn on the next boot:
 *
 * - a set row whose name the catalog read did not resolve: the catalog is
 *   filled by code, environment metadata and installed packages, and a
 *   definition missing now may be registered later;
 * - a read that did not happen (the grant scan, a set row, the catalog), or a
 *   name write that did not land.
 *
 * Without a readable ledger the pass still runs — it only fills a `NULL` with
 * the name the row's own id already points at, so running it twice writes
 * nothing the first run did not — but its verdict cannot be remembered, and
 * every boot scans again. This is where it departs from the membership
 * backfill, which does not run without its ledger because a second run of
 * that pass would decide again what the first one decided.
 *
 * ## When it runs
 *
 * At `kernel:bootstrapped`, from `SecurityPlugin.start`: after every
 * `kernel:ready` handler has settled — the platform bootstrap that seeds the
 * catalog rows, and the environment metadata hydrated before it — so the
 * catalog read sees every code and environment definition this boot will
 * register, including one a provider registers from a `kernel:ready` handler
 * that runs after this plugin's own. A definition that arrives later still (a
 * package installed into the running process) cannot turn into a recorded
 * "missing": an unresolved name leaves the verdict unrecorded, and the next
 * boot judges it again.
 *
 * ADR anchors: ADR-0131 D4 (references by name), D10 (the id column is dropped
 * after a verified rewrite — not here), C7 (deletions — not here).
 */

import { classifyFilterToken } from '@objectstack/spec/data';
import { DATA_MIGRATION_FLAG_OBJECT, type DataMigrationFlag } from '@objectstack/spec/system';
import type { SecurityCatalogReader } from '@objectstack/core';
import {
  GRANT_OBJECT,
  GRANT_SET_ID_FIELD,
  GRANT_SET_NAME_FIELD,
  PERMISSION_SET_CATALOG_OBJECT,
} from './grant-permission-set-name.js';
import { rowOrganizationId, seedCtx } from './per-organization-catalog.js';

/** Ledger row id of the one-time grant name backfill. */
export const GRANT_SET_NAME_BACKFILL_MIGRATION_ID = 'adr-0131-grant-permission-set-name-backfill';

/** Rows per page of the unnamed-grant scan. */
const SCAN_PAGE_SIZE = 500;

/** Grant row ids printed per category; the count is always complete. */
const LOGGED_ID_LIMIT = 50;

const SYSTEM_CTX = { isSystem: true } as const;

/** The engine surface the backfill uses — ObjectQL satisfies it as it stands. */
export interface GrantNameBackfillEngine {
  getObject(name: string): unknown;
  find(object: string, options: Record<string, unknown>): Promise<unknown>;
  findOne(object: string, options: Record<string, unknown>): Promise<Record<string, unknown> | null>;
  insert(object: string, data: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
  update(object: string, data: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
}

/** The kernel logger, as this module uses it. */
export interface GrantNameBackfillLogger {
  info?: (message: string, meta?: Record<string, any>) => void;
  warn: (message: string, meta?: Record<string, any>) => void;
  /** The kernel logger's shape: message, cause, meta. */
  error?: (message: string, cause?: Error, meta?: Record<string, any>) => void;
}

/** Why a pass stopped before it reached a verdict. */
export type GrantNameBackfillStop =
  /** No grant object, or no permission-set catalog object, in this composition. */
  | 'objects-absent'
  /** The unnamed-grant scan could not be read in full. */
  | 'scan-unreadable'
  /** A set row could not be read. */
  | 'set-row-unreadable'
  /** The security catalog read did not happen. */
  | 'catalog-unreadable';

/** What one pass did. Every list holds grant row ids. */
export interface GrantNameBackfillResult {
  /** Unnamed grants the scan found. */
  unnamed: number;
  /** Grants this pass named. */
  named: string[];
  /** Grants whose id names no set row. */
  dangling: string[];
  /** Grants whose id names another organization's set row. */
  crossOrganization: string[];
  /** Grants whose set row's name the catalog read did not resolve. */
  unresolved: string[];
  /** Grants whose name write did not land. */
  failed: string[];
  /** Set when the pass stopped before it judged every unnamed grant. */
  stopped?: GrantNameBackfillStop;
}

export interface GrantNameBackfillDeps {
  /** S1's security catalog read; every name is verified through it before it is written. */
  catalog: SecurityCatalogReader;
  logger?: GrantNameBackfillLogger;
}

/** What the set row a grant's id names comes to, inside the grant's wall. */
type SetVerdict =
  | { kind: 'name'; name: string }
  | { kind: 'dangling' }
  | { kind: 'cross-organization' }
  | { kind: 'unresolved'; name: string };

/** Thrown inside the pass to stop it; never escapes the module. */
class BackfillStop extends Error {
  constructor(readonly stop: GrantNameBackfillStop, readonly reason: unknown) {
    super(stop);
  }
}

/** The store a stop could not read, as the report names it. */
const STOPPED_READING: Record<GrantNameBackfillStop, string> = {
  'objects-absent': 'this composition',
  'scan-unreadable': GRANT_OBJECT,
  'set-row-unreadable': PERMISSION_SET_CATALOG_OBJECT,
  'catalog-unreadable': 'the security catalog',
};

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Whether a grant row's name column carries a name — `null` and a blank do not. */
function carriesName(value: unknown): boolean {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * The id a `permission_set_id` value reads by, or `undefined` for a value that
 * names no row: only a non-blank string or a finite number is an id, and a
 * placeholder-shaped string (`{…}`) is never one — in `where` it would be
 * resolved as a filter token rather than compared.
 */
function idKey(value: unknown): string | undefined {
  let key: string | undefined;
  if (typeof value === 'string') key = value;
  else if (typeof value === 'number' && Number.isFinite(value)) key = String(value);
  if (key === undefined || key.trim() === '') return undefined;
  if (classifyFilterToken(key) !== null) return undefined;
  return key;
}

/**
 * The grant rule the authorization resolver asks of every stored grant row,
 * asked here of the set row a grant names: an organization-less row applies
 * everywhere; a row of an organization applies only within that organization.
 */
function setRowAppliesToGrant(setOrganizationId: string | null, grantOrganizationId: string | null): boolean {
  return setOrganizationId === null || setOrganizationId === grantOrganizationId;
}

/** Read every unnamed grant in full, ordered by id, before anything is written. */
async function scanUnnamedGrants(engine: GrantNameBackfillEngine): Promise<Record<string, unknown>[]> {
  const byId = new Map<string, Record<string, unknown>>();
  // NULL is the pre-column shape; a blank is what a system write may have left
  // beside an id that resolved nothing. Neither is a name.
  for (const value of [null, '']) {
    for (let offset = 0; ; offset += SCAN_PAGE_SIZE) {
      let page: unknown;
      try {
        page = await engine.find(GRANT_OBJECT, {
          where: { [GRANT_SET_NAME_FIELD]: value },
          fields: ['id', GRANT_SET_ID_FIELD, GRANT_SET_NAME_FIELD, 'organization_id'],
          orderBy: [{ field: 'id', order: 'asc' }],
          limit: SCAN_PAGE_SIZE,
          offset,
          context: SYSTEM_CTX,
        });
      } catch (e) {
        throw new BackfillStop('scan-unreadable', e);
      }
      const rows = Array.isArray(page) ? page : [];
      for (const row of rows) {
        const id = (row as Record<string, unknown> | null)?.id;
        if (typeof id === 'string' && id !== '' && !carriesName((row as Record<string, unknown>)[GRANT_SET_NAME_FIELD])) {
          byId.set(id, row as Record<string, unknown>);
        }
      }
      if (rows.length < SCAN_PAGE_SIZE) break;
    }
  }
  // Code-unit order — the order the driver's id sort gives, independent of locale.
  return [...byId.values()].sort((a, b) => (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0));
}

/** What the set row `setId` comes to for a grant of `grantOrganizationId`. */
async function judgeSetRow(
  engine: GrantNameBackfillEngine,
  catalog: SecurityCatalogReader,
  setId: string,
  grantOrganizationId: string | null,
  resolvedNames: Map<string, boolean>,
): Promise<SetVerdict> {
  let row: Record<string, unknown> | null;
  try {
    row = await engine.findOne(PERMISSION_SET_CATALOG_OBJECT, {
      where: { id: setId },
      fields: ['id', 'name', 'organization_id'],
      context: seedCtx(grantOrganizationId ?? undefined),
    });
  } catch (e) {
    throw new BackfillStop('set-row-unreadable', e);
  }
  if (row && !setRowAppliesToGrant(rowOrganizationId(row), grantOrganizationId)) {
    return { kind: 'cross-organization' };
  }
  if (!row) {
    // Nothing inside the wall. Whether the id names a row OUTSIDE it decides
    // which report the grant lands in; only the row's existence is read.
    let outside: Record<string, unknown> | null;
    try {
      outside = await engine.findOne(PERMISSION_SET_CATALOG_OBJECT, {
        where: { id: setId },
        fields: ['id'],
        context: SYSTEM_CTX,
      });
    } catch (e) {
      throw new BackfillStop('set-row-unreadable', e);
    }
    return outside ? { kind: 'cross-organization' } : { kind: 'dangling' };
  }

  const name = row.name;
  if (typeof name !== 'string' || name.trim() === '') return { kind: 'unresolved', name: String(name ?? '') };
  let resolves = resolvedNames.get(name);
  if (resolves === undefined) {
    try {
      const entry = await catalog.resolve('permission', name);
      resolves = entry !== undefined && entry.name === name;
    } catch (e) {
      throw new BackfillStop('catalog-unreadable', e);
    }
    resolvedNames.set(name, resolves);
  }
  return resolves ? { kind: 'name', name } : { kind: 'unresolved', name };
}

/** At most {@link LOGGED_ID_LIMIT} ids, and how many more there are. */
function listed(ids: readonly string[]): { ids: string[]; more?: number } {
  return ids.length > LOGGED_ID_LIMIT
    ? { ids: ids.slice(0, LOGGED_ID_LIMIT), more: ids.length - LOGGED_ID_LIMIT }
    : { ids: [...ids] };
}

function logError(logger: GrantNameBackfillLogger | undefined, message: string, meta: Record<string, unknown>): void {
  if (logger?.error) logger.error(message, undefined, meta);
  else logger?.warn(message, meta);
}

/** Report what one pass could not name — once per category, never once per row. */
function reportPass(result: GrantNameBackfillResult, unresolvedNames: string[], logger?: GrantNameBackfillLogger): void {
  if (result.named.length > 0) {
    logger?.info?.(
      `[security] ${result.named.length} of ${result.unnamed} unnamed ${GRANT_OBJECT} grant(s) now name their ` +
        `permission set (ADR-0131 D4): each name was read from the set row its ${GRANT_SET_ID_FIELD} points at, ` +
        `inside the grant's own organization, and resolved in the security catalog before it was written`,
      { named: result.named.length, unnamed: result.unnamed },
    );
  }
  if (result.dangling.length > 0) {
    logger?.warn(
      `[security] ${result.dangling.length} ${GRANT_OBJECT} grant(s) keep no ${GRANT_SET_NAME_FIELD}: their ` +
        `${GRANT_SET_ID_FIELD} names no ${PERMISSION_SET_CATALOG_OBJECT} row, so they grant nothing today and ` +
        `there is no name to give them. Nothing was deleted; review these grants and remove or re-point them.`,
      { count: result.dangling.length, grants: listed(result.dangling) },
    );
  }
  if (result.crossOrganization.length > 0) {
    logger?.warn(
      `[security] ${result.crossOrganization.length} ${GRANT_OBJECT} grant(s) keep no ${GRANT_SET_NAME_FIELD}: ` +
        `their ${GRANT_SET_ID_FIELD} names a ${PERMISSION_SET_CATALOG_OBJECT} row outside the grant's own ` +
        `organization (an organization-less grant may name only an organization-less set), and a name is never ` +
        `carried across organizations. Nothing was changed; re-point each grant at a set of its own organization.`,
      { count: result.crossOrganization.length, grants: listed(result.crossOrganization) },
    );
  }
  if (result.unresolved.length > 0) {
    logError(
      logger,
      `[security] ${result.unresolved.length} ${GRANT_OBJECT} grant(s) were NOT given a ${GRANT_SET_NAME_FIELD}: ` +
        `the ${PERMISSION_SET_CATALOG_OBJECT} row each one points at carries a name the security catalog does not ` +
        `resolve at this boot, so the name cannot be shown to name a definition. These grants still resolve by ` +
        `id today, and would fail closed once readers read the name. Fix: register the permission set ` +
        `definition (its package or environment metadata), or re-point the grants; the backfill runs again on ` +
        `the next boot.`,
      { count: result.unresolved.length, names: unresolvedNames, grants: listed(result.unresolved) },
    );
  }
  if (result.failed.length > 0) {
    logError(
      logger,
      `[security] ${result.failed.length} ${GRANT_OBJECT} name write(s) did NOT land, so those grants still ` +
        `carry no ${GRANT_SET_NAME_FIELD} while every other line of this backfill reads clean. The backfill runs ` +
        `again on the next boot; if it fails again, check that ${GRANT_OBJECT} is writable by the system context.`,
      { count: result.failed.length, grants: listed(result.failed) },
    );
  }
}

/**
 * One pass: name every unnamed grant whose name can be verified, report the
 * rest. A read that did not happen stops the pass; the stop is returned in
 * `stopped` and reported, never thrown.
 */
export async function backfillGrantPermissionSetNames(
  engine: GrantNameBackfillEngine,
  deps: GrantNameBackfillDeps,
): Promise<GrantNameBackfillResult> {
  const result: GrantNameBackfillResult = {
    unnamed: 0, named: [], dangling: [], crossOrganization: [], unresolved: [], failed: [],
  };
  const { catalog, logger } = deps;
  if (!engine?.getObject?.(GRANT_OBJECT) || !engine.getObject(PERMISSION_SET_CATALOG_OBJECT)) {
    result.stopped = 'objects-absent';
    return result;
  }

  const unresolvedNames = new Set<string>();
  try {
    const grants = await scanUnnamedGrants(engine);
    result.unnamed = grants.length;
    const verdicts = new Map<string, SetVerdict>();
    const resolvedNames = new Map<string, boolean>();

    for (const grant of grants) {
      const grantId = String(grant.id);
      const setId = idKey(grant[GRANT_SET_ID_FIELD]);
      if (setId === undefined) {
        result.dangling.push(grantId);
        continue;
      }
      const grantOrganizationId = rowOrganizationId(grant);
      const memoKey = JSON.stringify([grantOrganizationId, setId]);
      let verdict = verdicts.get(memoKey);
      if (!verdict) {
        verdict = await judgeSetRow(engine, catalog, setId, grantOrganizationId, resolvedNames);
        verdicts.set(memoKey, verdict);
      }

      if (verdict.kind === 'dangling') result.dangling.push(grantId);
      else if (verdict.kind === 'cross-organization') result.crossOrganization.push(grantId);
      else if (verdict.kind === 'unresolved') {
        result.unresolved.push(grantId);
        unresolvedNames.add(verdict.name);
      } else {
        try {
          await engine.update(
            GRANT_OBJECT,
            { id: grantId, [GRANT_SET_NAME_FIELD]: verdict.name },
            { context: seedCtx(grantOrganizationId ?? undefined) },
          );
          result.named.push(grantId);
        } catch {
          result.failed.push(grantId);
        }
      }
    }
  } catch (e) {
    if (!(e instanceof BackfillStop)) throw e;
    result.stopped = e.stop;
    logger?.warn(
      `[security] the ${GRANT_OBJECT} name backfill stopped before it judged every unnamed grant: ` +
        `${STOPPED_READING[e.stop]} could not be read, and an unread answer is never taken for "no such set". ` +
        `No name was written past that point; the backfill runs again on the next boot.`,
      { stop: e.stop, error: errorText(e.reason), named: result.named.length },
    );
  }
  reportPass(result, [...unresolvedNames].sort(), logger);
  return result;
}

/** A pass's verdict is final when nothing a later pass could decide differently remains. */
export function isRecordableGrantNameVerdict(result: GrantNameBackfillResult): boolean {
  return result.stopped === undefined && result.unresolved.length === 0 && result.failed.length === 0;
}

/** What the deployment ledger says about this backfill. */
export type GrantNameLedgerReading = 'recorded' | 'absent' | 'unavailable' | 'unreadable';

/** Read the ledger row by its id. Never throws. */
export async function readGrantNameBackfillLedger(engine: GrantNameBackfillEngine): Promise<GrantNameLedgerReading> {
  try {
    if (!engine?.getObject?.(DATA_MIGRATION_FLAG_OBJECT)) return 'unavailable';
    const row = await engine.findOne(DATA_MIGRATION_FLAG_OBJECT, {
      where: { id: GRANT_SET_NAME_BACKFILL_MIGRATION_ID },
      context: SYSTEM_CTX,
    });
    return row?.id === GRANT_SET_NAME_BACKFILL_MIGRATION_ID ? 'recorded' : 'absent';
  } catch {
    return 'unreadable';
  }
}

/** The ledger row for a decided pass — pure. */
export function buildGrantNameBackfillRecord(result: GrantNameBackfillResult, now: string): DataMigrationFlag {
  return {
    id: GRANT_SET_NAME_BACKFILL_MIGRATION_ID,
    last_run_at: now,
    applied_at: now,
    verified_at: null,
    blocking: 0,
    details: JSON.stringify({
      unnamed: result.unnamed,
      named: result.named.length,
      dangling: result.dangling.length,
      crossOrganization: result.crossOrganization.length,
    }),
  };
}

/**
 * Insert the ledger row. THROWS on failure — the caller decides what a lost
 * record means.
 */
async function persistGrantNameBackfillRecord(engine: GrantNameBackfillEngine, flag: DataMigrationFlag): Promise<void> {
  const now = flag.last_run_at;
  await engine.insert(DATA_MIGRATION_FLAG_OBJECT, { ...flag, created_at: now, updated_at: now }, { context: SYSTEM_CTX });
}

export type GrantNameBackfillStatus =
  /** The pass decided, and its record landed. */
  | 'ran'
  /** The pass decided, but its record did not land (or there is no ledger to land it in). */
  | 'ran-unrecorded'
  /** The pass left something a later pass may decide differently — retried on the next boot. */
  | 'undecided'
  /** The ledger already records the verdict — nothing was scanned or written. */
  | 'already-run';

export interface OneTimeGrantNameBackfillResult {
  status: GrantNameBackfillStatus;
  ledger: GrantNameLedgerReading;
  /** The pass's own summary, present whenever it ran. */
  backfill?: GrantNameBackfillResult;
}

/**
 * Run the grant name backfill unless the deployment ledger already records
 * its verdict, and record the verdict when this pass reaches one. A read the
 * pass could not make is reported and returned, never thrown; the boot hook
 * that calls this still guards against anything unforeseen.
 */
export async function runOneTimeGrantPermissionSetNameBackfill(
  engine: GrantNameBackfillEngine,
  deps: GrantNameBackfillDeps,
): Promise<OneTimeGrantNameBackfillResult> {
  const { logger } = deps;
  const ledger = await readGrantNameBackfillLedger(engine);
  if (ledger === 'recorded') return { status: 'already-run', ledger };

  const backfill = await backfillGrantPermissionSetNames(engine, deps);
  if (!isRecordableGrantNameVerdict(backfill)) return { status: 'undecided', ledger, backfill };

  if (ledger !== 'absent') {
    logger?.warn(
      `[security] the ${GRANT_OBJECT} name backfill reached its verdict but cannot record it: the deployment ` +
        `ledger ${DATA_MIGRATION_FLAG_OBJECT} is ${ledger === 'unavailable' ? 'not available on this kernel' : 'unreadable'}, ` +
        `so every boot scans the grants again. Nothing is renamed twice. Compose PlatformObjectsPlugin (it ` +
        `provisions the ledger) to let the verdict be remembered.`,
      { ledger },
    );
    return { status: 'ran-unrecorded', ledger, backfill };
  }

  const flag = buildGrantNameBackfillRecord(backfill, new Date().toISOString());
  try {
    await persistGrantNameBackfillRecord(engine, flag);
  } catch (e) {
    // A concurrent boot that landed the same id first has recorded it.
    if ((await readGrantNameBackfillLedger(engine)) === 'recorded') return { status: 'ran', ledger, backfill };
    // At `error`: the pass's writes stand and every line reads clean, while the
    // record that makes it one-time is absent.
    logError(
      logger,
      `[security] the ${GRANT_OBJECT} name backfill ran, but recording it in ${DATA_MIGRATION_FLAG_OBJECT} failed ` +
        `(${errorText(e)}). The next boot scans every grant again and re-reports what it cannot name. Fix: make ` +
        `${DATA_MIGRATION_FLAG_OBJECT} writable on this deployment (it is provisioned by PlatformObjectsPlugin) ` +
        `and verify with SELECT * FROM ${DATA_MIGRATION_FLAG_OBJECT} WHERE id = '${GRANT_SET_NAME_BACKFILL_MIGRATION_ID}'.`,
      { error: errorText(e) },
    );
    return { status: 'ran-unrecorded', ledger, backfill };
  }
  logger?.info?.(
    `[security] the ${GRANT_OBJECT} name backfill is recorded in ${DATA_MIGRATION_FLAG_OBJECT} ` +
      `(id '${GRANT_SET_NAME_BACKFILL_MIGRATION_ID}') — later boots will not run it again`,
    { id: flag.id, details: flag.details },
  );
  return { status: 'ran', ledger, backfill };
}
