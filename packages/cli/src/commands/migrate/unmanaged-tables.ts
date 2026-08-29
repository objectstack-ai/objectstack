// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The physical tables **nothing declares** — `os migrate plan`'s informational
 * sweep (#13204).
 *
 * ## The blind spot this closes
 *
 * `detectManagedDrift()` iterates the driver's `managedObjectFields`: it diffs
 * the tables metadata DECLARES against the physical database, and a table no
 * declaration names is not in that map, so no plan can ever mention it.
 * Retiring an object therefore strands its table forever — measured on
 * ObjectStack Cloud's control DB, where a retired `sys_scim_provider` is still
 * present (0 rows) and every plan since has read as clean.
 *
 * ## ⛔ It never drops anything, and never proposes a drop
 *
 * The output is a list of names and a count. No DDL is generated here, none is
 * suggested, and this module is wired into nothing that executes DDL. Dropping
 * an existing physical table is destructive and hard to reverse: that decision
 * stays with a human, and this card deliberately does not introduce it.
 *
 * ## ⛔ It is NOT `composition.coverage` (#13057), and must not blur into it
 *
 * Two different predicates over two different populations:
 *
 *  - **coverage** — of the objects this deployment DECLARES, how many did the
 *    plan examine? Its unexamined remainder is declared metadata that the plan
 *    could not reach.
 *  - **this sweep** — of the tables that physically EXIST, which ones does no
 *    declaration account for at all?
 *
 * Folding them together would make "examined and clean" indistinguishable from
 * "never looked at", which is the blind spot both exist to remove. So a
 * declared-but-unexamined object's table is deliberately **excluded** here (see
 * {@link buildKnownTableNames}): coverage already reports it, and reporting it
 * a second time as "unmanaged" would be false — it is declared.
 *
 * ## Why a naive `sys_` prefix scan is NOT the predicate (measured)
 *
 * Three physical-table families carry a platform prefix while being legitimate,
 * and a difference against `managedObjectFields` alone reports all three:
 *
 *  1. **Rotation shards.** `sys_activity` declares
 *     `lifecycle.storage.strategy: 'rotation'` with 14 daily shards, so the
 *     physical database carries up to 14 `sys_activity__r<YYYYMMDD>` tables and
 *     the base name is a VIEW. `aliasShardBookkeeping` copies the per-table
 *     bookkeeping to each shard but deliberately does NOT add it to
 *     `managedObjectFields` — only the base name is ever a key there. A naive
 *     sweep prints 14 false rows on every plan of every deployment running
 *     `plugin-audit`. {@link rotationBaseOf} folds a shard back onto its base
 *     before the membership test.
 *  2. **Declared-but-unexamined objects.** On the control plane #13028
 *     measured, ~80 objects were declared and **8** reached the driver: the
 *     other ~72 tables exist and are absent from `managedObjectFields`. A
 *     naive sweep would print ~72 false rows and bury the one real orphan.
 *  3. **Driver-internal tables.** `_objectstack_sequences` and the SQLite
 *     rebuild scratch table `__os_mig_<table>` carry no platform prefix, so the
 *     prefix test excludes them without an allowlist to maintain.
 *
 * The prefix itself is read from `PLATFORM_OBJECT_PREFIXES` rather than
 * spelled `'sys_'` here. That constant is the repo's own registry of namespaces
 * reserved for platform-provided objects, and its module header records what a
 * fourth hand-rolled copy of the prefix heuristic cost the last time.
 *
 * ## The declaration set has to be the deployment's own, or the question is unaskable
 *
 * "No declaration accounts for this table" is only answerable when the composed
 * object set actually MIRRORS what this deployment's `os serve` boot registers.
 * On a project with a compiled artifact and no host config, the composed set is
 * the artifact plus the platform FLOOR — measured: `sys_metadata` and its four
 * siblings, `sys_migration`, `sys_migration_journal`, `sys_metadata_activation`,
 * `sys_secret`, and nothing else — so a database carrying the other ~40
 * platform tables would have every one of them reported. That is the cry-wolf
 * failure, from a knowingly partial premise rather than from a wrong predicate.
 *
 * So the sweep runs only when `composition.hostConfigLoaded` is true — the same
 * discriminator #12953's ruling kept for consumers, and for the same reason: a
 * composition that does not mirror the deployment produces an UNMEASURED
 * result, and an unmeasured result must say so rather than render as findings.
 *
 * ## ⛔ "Could not look" is never reported as "nothing found"
 *
 * Every path that fails to obtain an answer returns {@link UnmanagedTablesUnreadable}
 * — the same discipline `os migrate duplicates` carries for its own probe. An
 * empty list here means the sweep RAN and found nothing; a sweep that could not
 * run says so, because those two have opposite consequences and are otherwise
 * byte-identical to a reader.
 */

import { PLATFORM_OBJECT_PREFIXES, StorageNameMapping, hasPlatformObjectPrefix } from '@objectstack/spec/system';
// The result-set/no-answer predicate `os migrate duplicates` already publishes
// (#10677). Imported rather than re-spelled: a second copy would drift, and the
// two commands must agree on what "the seam did not answer" looks like. Both
// modules are siblings under `commands/migrate/`, and the import costs nothing
// `plan.ts` does not already load.
import { isResultSet } from './duplicates.js';

/** How a raw SELECT is issued against the driver the plan diffed. */
export type PlannedDriverExec = (sql: string, params?: unknown[]) => Promise<unknown>;

/**
 * One row of the informational section.
 *
 * `table` is the physical table name — except when `rotationShards` is present,
 * where it is the rotation BASE the shards belong to. A retired rotation object
 * leaves N shard tables and no base table, and listing all N separately would
 * be N rows of noise for one stranded object.
 */
export interface UnmanagedTableFinding {
  /** The unmanaged table, or the rotation base when this row collapses a shard family. */
  table: string;
  /** Present only on a collapsed rotation family: the shard tables it stands for. */
  rotationShards?: string[];
}

/** The sweep ran. `tables: []` is a real answer — nothing physical is unaccounted for. */
export interface UnmanagedTablesRead {
  status: 'read';
  /** Namespace prefixes the sweep considered. */
  prefixes: readonly string[];
  /** How many physical base tables the sweep enumerated, of any prefix. */
  physicalTables: number;
  /** Sorted, and empty when everything physical is declared. */
  tables: UnmanagedTableFinding[];
}

/** The sweep could not obtain an answer. ⛔ Never to be rendered as "none found". */
export interface UnmanagedTablesUnreadable {
  status: 'unreadable';
  prefixes: readonly string[];
  /** Why, in the operator's terms. */
  detail: string;
}

export type UnmanagedTablesReport = UnmanagedTablesRead | UnmanagedTablesUnreadable;

/** knex client spellings, per family — the same three families `SqlDriver` emits for. */
const SQLITE_CLIENTS: ReadonlySet<string> = new Set(['sqlite3', 'sqlite', 'better-sqlite3']);
const POSTGRES_CLIENTS: ReadonlySet<string> = new Set(['postgres', 'pg', 'postgresql', 'pgnative']);
const MYSQL_CLIENTS: ReadonlySet<string> = new Set(['mysql', 'mysql2']);

/**
 * The statement that lists physical BASE TABLES, for the dialect actually
 * connected — or `null` when the client spelling names no family this sweep can
 * enumerate.
 *
 * `null` is deliberately not "assume sqlite": a wrong catalog query either
 * throws (loud, fine) or returns rows for the wrong population (silent, not
 * fine), and an unrecognised dialect must reach {@link UnmanagedTablesUnreadable}
 * instead of either.
 *
 * The three statements mirror `SqlDriver.introspectSchema()`'s own table-name
 * pass, including its two exclusions that matter here: VIEWS are out (a
 * rotation base is a view, and a view is not stranded storage), and SQLite's
 * internal `sqlite_%` tables are out. This sweep does not CALL that method
 * because it needs table names alone — `introspectSchema` costs four further
 * introspection round-trips per table, which on the ~80-table control plane
 * this card comes from would be ~320 queries added to a dry run that the card
 * asks to stay cheap. One query, one round trip.
 */
export function physicalTableListSql(client?: string): string | null {
  const c = String(client ?? '').toLowerCase();
  if (SQLITE_CLIENTS.has(c)) {
    return "SELECT name AS table_name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'";
  }
  if (POSTGRES_CLIENTS.has(c)) {
    return 'SELECT table_name FROM information_schema.tables '
      + 'WHERE table_schema = ANY (current_schemas(false)) AND table_type = \'BASE TABLE\'';
  }
  if (MYSQL_CLIENTS.has(c)) {
    return 'SELECT table_name FROM information_schema.tables '
      + "WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'";
  }
  return null;
}

/**
 * The rotation BASE a shard table belongs to, or `null` when the name is not a
 * shard.
 *
 * `__r` + a 6-to-8 digit period key is `SqlDriver.ensureRotation`'s own shard
 * grammar (`/__r\d{6,8}$/`), restated here because this is the consumer side of
 * the same naming decision.
 */
export function rotationBaseOf(table: string): string | null {
  const match = /^(.+)__r\d{6,8}$/.exec(table);
  return match ? match[1]! : null;
}

/**
 * Read the planned driver's managed-table map — the SAME `managedObjectFields`
 * `detectManagedDrift()` iterates — as a name set.
 *
 * ⚠️ Returns `null`, never an empty set, when the map cannot be read. The field
 * is `protected` on `SqlDriver` and reached structurally, so a rename would
 * hand this an `undefined`; treating that as "nothing is managed" would report
 * every platform-namespaced table in the database as unmanaged — the loudest
 * possible false alarm, from the quietest possible cause.
 */
export function readManagedTableNames(driver: unknown): ReadonlySet<string> | null {
  const map = (driver as { managedObjectFields?: unknown } | null | undefined)?.managedObjectFields;
  if (!(map instanceof Map)) return null;
  const names = new Set<string>();
  for (const key of map.keys()) if (typeof key === 'string' && key) names.add(key);
  return names;
}

/**
 * Every table name a declaration accounts for: the planned driver's managed set
 * UNION the table names of every object the booted stack registered.
 *
 * The managed set is the plan's own (premise: one source, so the section cannot
 * disagree with the plan beside it). The declared set is the wider one, and it
 * is what keeps a declared-but-unexamined object out of this report — see this
 * module's header on why that belongs to `composition.coverage` instead.
 *
 * Both an object's `name` and its resolved table name are added: legacy
 * double-underscore names resolve to a different table, and over-excluding is
 * the safe direction for a section whose failure mode is crying wolf.
 */
export function buildKnownTableNames(
  managed: ReadonlySet<string>,
  declaredObjects: readonly unknown[],
): ReadonlySet<string> {
  const known = new Set<string>(managed);
  for (const object of declaredObjects) {
    const name = (object as { name?: unknown } | null | undefined)?.name;
    if (typeof name !== 'string' || !name) continue;
    known.add(name);
    try {
      known.add(StorageNameMapping.resolveTableName({ name }));
    } catch {
      /* a name the mapping rejects is already added verbatim above */
    }
  }
  return known;
}

/**
 * The predicate itself: platform-namespaced physical tables that `known`
 * accounts for neither directly nor as a rotation shard.
 */
export function selectUnmanagedTables(
  physical: readonly string[],
  known: ReadonlySet<string>,
): UnmanagedTableFinding[] {
  const findings = new Map<string, UnmanagedTableFinding>();
  for (const table of physical) {
    if (!hasPlatformObjectPrefix(table)) continue;
    if (known.has(table)) continue;
    const base = rotationBaseOf(table);
    if (base !== null) {
      // A declared rotation object's shards ARE its managed storage; only the
      // base name is ever a `managedObjectFields` key.
      if (known.has(base)) continue;
      const existing = findings.get(base) ?? { table: base };
      (existing.rotationShards ??= []).push(table);
      findings.set(base, existing);
      continue;
    }
    findings.set(table, findings.get(table) ?? { table });
  }
  const out = [...findings.values()];
  for (const finding of out) finding.rotationShards?.sort();
  return out.sort((a, b) => a.table.localeCompare(b.table));
}

/** Pull a table name out of one catalog row — MySQL answers `TABLE_NAME`. */
function tableNameOf(row: Record<string, unknown>): string | null {
  for (const key of ['table_name', 'TABLE_NAME', 'name'] as const) {
    const value = row[key];
    if (typeof value === 'string' && value) return value;
  }
  return null;
}

/**
 * Resolve the raw-SQL seam **of the driver the plan diffed**.
 *
 * ⛔ Deliberately NOT `resolveSeedTenancyExec(engine)`, which walks the engine
 * for ANY raw-capable driver: on a deployment with more than one datasource
 * that can be a different database entirely, and this sweep would then compare
 * database A's tables against database B's managed set — every row a false
 * positive. The identity that matters is the same one `measureComposedCoverage`
 * uses (`driver !== plannedDriver`), so the seam is taken from that driver and
 * nowhere else.
 */
export function resolvePlannedDriverExec(driver: unknown): PlannedDriverExec | null {
  const d = driver as {
    execute?: (sql: string, params?: unknown[]) => Promise<unknown>;
    raw?: (sql: string) => Promise<unknown>;
  } | null | undefined;
  if (typeof d?.execute === 'function') return (sql, params) => d.execute!(sql, params ?? []);
  if (typeof d?.raw === 'function') return (sql) => d.raw!(sql);
  return null;
}

const unreadable = (detail: string): UnmanagedTablesUnreadable => ({
  status: 'unreadable',
  prefixes: PLATFORM_OBJECT_PREFIXES,
  detail,
});

/**
 * Sweep the physical database for platform-namespaced tables no declaration
 * accounts for.
 *
 * Reads only — one SELECT against a catalog. Every failure lands as
 * {@link UnmanagedTablesUnreadable}; none of them throws, because this section
 * is informational and must never turn a working `os migrate plan` into a
 * failing one.
 *
 * @param driver the driver whose managed set the plan diffed.
 * @param declaredObjects everything the booted stack registered (`stack.allObjects()`).
 * @param composition what the boot composed — read for `hostConfigLoaded`, the
 *   premise above.
 * @param normalize `normalizeRows` — flattens the three dialect result shapes.
 */
export async function collectUnmanagedTables(opts: {
  driver: unknown;
  declaredObjects: readonly unknown[];
  composition: { hostConfigLoaded: boolean; hostConfigPath: string | null };
  normalize: (result: unknown) => Record<string, unknown>[];
}): Promise<UnmanagedTablesReport> {
  if (!opts.composition.hostConfigLoaded) {
    return unreadable(
      opts.composition.hostConfigPath === null
        ? 'this project has no host config, so the composed object set is the compiled artifact plus the '
          + 'platform floor rather than what `os serve` registers — against a knowingly partial declaration '
          + 'set, "declared by nothing" is UNMEASURED rather than false'
        : `the host config ${opts.composition.hostConfigPath} did not load, so the composed object set covers `
          + 'only a fraction of this deployment — "declared by nothing" is UNMEASURED against it',
    );
  }

  const managed = readManagedTableNames(opts.driver);
  if (managed === null) {
    return unreadable(
      'the planned driver exposes no readable managed-table map, so "declared by nothing" could not be '
      + 'decided — reporting nothing rather than reporting every platform table as unmanaged',
    );
  }

  const exec = resolvePlannedDriverExec(opts.driver);
  if (exec === null) {
    return unreadable('the planned driver exposes no raw SQL seam, so its table catalog could not be read');
  }

  const client = (opts.driver as { config?: { client?: unknown } } | null | undefined)?.config?.client;
  const clientName = typeof client === 'string' ? client : '';
  const sql = physicalTableListSql(clientName);
  if (sql === null) {
    return unreadable(
      `the connected dialect (${clientName || 'unnamed client'}) is not one this sweep enumerates tables on `
      + '(sqlite / postgres / mysql)',
    );
  }

  let result: unknown;
  try {
    result = await exec(sql, []);
  } catch (error: unknown) {
    return unreadable(
      `the table-catalog read failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // #10677's distinction, restated for this probe: a seam that returns no
  // RESULT SET did not answer "no tables" — it did not answer.
  if (!isResultSet(result)) {
    return unreadable(
      'the raw SQL seam returned no result set — a seam that cannot answer is not a seam that answered '
      + '"no unmanaged tables"',
    );
  }

  const rows = opts.normalize(result);
  const names: string[] = [];
  for (const row of rows) {
    const name = tableNameOf(row);
    if (name !== null) names.push(name);
  }
  if (rows.length > 0 && names.length === 0) {
    return unreadable(
      `the table catalog answered ${rows.length} row(s) carrying no recognised table-name column`,
    );
  }

  return {
    status: 'read',
    prefixes: PLATFORM_OBJECT_PREFIXES,
    physicalTables: names.length,
    tables: selectUnmanagedTables(names, buildKnownTableNames(managed, opts.declaredObjects)),
  };
}

/** One finding as an operator-facing line (no leading bullet, no colour). */
export function describeUnmanagedTable(finding: UnmanagedTableFinding): string {
  if (!finding.rotationShards || finding.rotationShards.length === 0) return finding.table;
  return `${finding.table} (${finding.rotationShards.length} rotation shard(s): `
    + `${finding.rotationShards.join(', ')})`;
}

/**
 * The informational section, as the lines `os migrate plan` prints — or `[]`
 * when there is nothing to say.
 *
 * ⛔ The wording states what was found and stops. It proposes no remedy,
 * because the only remedy is a destructive DDL statement this card does not
 * introduce.
 */
export function renderUnmanagedTables(report: UnmanagedTablesReport): string[] {
  if (report.status === 'unreadable') {
    return [`Unmanaged-table sweep did not run: ${report.detail}.`];
  }
  if (report.tables.length === 0) return [];
  return [
    `${report.tables.length} table(s) in this database carry a reserved platform prefix `
    + `(${report.prefixes.join(', ')}) and are declared by no object in this plan:`,
    ...report.tables.map((finding) => `  • ${describeUnmanagedTable(finding)}`),
    'They are reported for information only — nothing here drops them, and a plan writes nothing.',
  ];
}
