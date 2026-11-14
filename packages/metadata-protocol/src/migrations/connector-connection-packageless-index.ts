// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `sys_connector_connection` — one connection per `(organization_id,
 * connector_name)` among the connections that name no package, delivered at
 * runtime (ADR-0150 D4 and D8 row R11, ADR-0120 D4, #31699).
 *
 * ## What is broken without it
 *
 * A connector instance is identified by `(package, name)` (ADR-0150 D4), so the
 * connection's declared key is `(organization_id, connector_package,
 * connector_name)`: one organization may connect both packages' instances of one
 * name (the maintainer's ruling on #31699, "unique by package and name").
 * `connector_package` is NULL on every connection of an instance the
 * environment authored or a plugin registers in code, and of a name the
 * stored-reference backfill could not bind (the column's documented "empty",
 * never a sentinel). A SQL UNIQUE treats NULLs as distinct, so for exactly those
 * connections the declared key constrains nothing. The key it replaced,
 * `(organization_id, connector_name)`, held them to one. Two of them would keep
 * two refresh tokens for one instance in one organization, and a revoke that
 * deletes one would leave the other stored.
 *
 * ## Why THIS route
 *
 * The same as `sys_user_permission_set`'s grant guard
 * (`user-permission-set-packageless-index.ts`, #32164), whose docblock carries
 * the full argument, and the activation ledger's before it
 * (`activation-ledger-packageless-index.ts`, with the per-dialect
 * measurements). `IndexSchema` can say neither "NULL-safe" for a non-tenant
 * column nor `WHERE`, so the declared surface cannot carry it: this runtime
 * migration ADDS an index beside the declared key and replaces nothing.
 *
 * Its key is the old key's columns in the old key's order, because that is
 * what `driver-sql`'s widening arm (`widenedUniqueReplacements`) asks of the
 * guard before it retires the old key (`hasPartialUniqueGuard`: a partial
 * UNIQUE on exactly the narrower columns). Measured on SQLite: with this index
 * standing, the drift plan is one `replace_unique_index`, categorized `safe`;
 * without it, the arm keeps the old key and plans nothing.
 *
 * ## When — at schema sync, on every kernel that runs the table's DDL
 *
 * As the grant guard: `metadata-protocol`'s assembly runs
 * {@link createConnectorConnectionGuardAtSchemaSync} on
 * `objectql:schema-synced`, so the guard follows the table's DDL wherever that
 * runs, a pass that performs no DDL builds nothing (`'held-back'`), a standing
 * guard costs one catalog read, and a refusal is reported once per boot.
 *
 * ## The index, per dialect
 *
 * - SQLite and PostgreSQL: a partial unique index,
 *   `(organization_id, connector_name) WHERE connector_package IS NULL`.
 * - MySQL (8.0.13+): a functional key part over the driver's hash-shadow digest,
 *   NULL for a packaged connection, which UNIQUE then exempts. ⚠ `driver-sql`
 *   reads that key part as an expression, not as a partial guard, so on MySQL
 *   the widening arm keeps the old key (a declared limit; the grant guard
 *   shares it). The old key keeps refusing what it refused, nothing more.
 * - MariaDB: a UNIQUE key over an INVISIBLE generated column carrying that
 *   digest, `uniq_sys_connector_connection_packageless__hash` (MariaDB 10.3+),
 *   which `driver-sql` reads as a partial unique on the two columns.
 * - `driver-mongodb` builds its own copy at collection sync (`mongodb-schema.ts`,
 *   `RUNTIME_OWNED_UNIQUES`). Mongo materialized the earlier declaration's
 *   columns verbatim, `(connector_name)` alone, so its guard is keyed on that.
 * - `driver-memory` is no SQL host (`no-driver`): a declared limit, pinned in
 *   `driver-memory`'s `memory-connector-connection-packageless.test.ts`.
 *
 * ## What it admits — nothing the old key refused
 *
 * Both key parts are required, plain columns, so no connection escapes this
 * index or the declared key by a NULL organization or name. Two package-less
 * connections of one instance in one organization are refused, as they were.
 * The table first shipped after plain organization keys (18.3.0), so no
 * released database carries the old key in ADR-0120 D3's NULL-safe form.
 *
 * ## The old key retires on the next boot (or `os migrate apply`)
 *
 * The widening arm offers to retire the old key only once this index stands,
 * because the gained column is nullable. On SQL the drift plan is read during
 * the table's sync, before this index is built, so on an upgraded database the
 * old key is retired by the NEXT sync that runs safe drift (dev
 * `autoMigrate: 'safe'`, or `os migrate apply`); until then it keeps refusing
 * what it refused.
 *
 * ## A dialect with no form keeps the old key
 *
 * MySQL before 8.0.13 and MariaDB before 10.3 can build no form of this index
 * (`'unsupported'`). There the old key stays, or is built under the name
 * `driver-sql` generates for it ({@link CONNECTOR_CONNECTION_OLD_KEY_INDEX_NAME})
 * where it is missing, so the widening arm reads it as the superseded key once
 * this index can stand. It refuses everything this index would, and also an
 * organization's connection of a second package's instance of the same name: a
 * declared limit of those servers.
 *
 * ## Refuse, never keep-one (ADR-0120 D4)
 *
 * The build fails only on a database that already holds two package-less
 * connections of one `(organization_id, connector_name)`, which the old key
 * refused, so they were written after it was retired. Nothing here deletes,
 * re-stamps or guesses a package for either: the operator gets the key that is
 * not enforced, the consequence, the duplicated keys (an organization id and an
 * instance name, no secret), and the query that lists the rows
 * ({@link buildConnectorConnectionPackagelessDuplicateProbeSql}, also what
 * `os migrate duplicates` runs through `runtime-index-preflight.ts`).
 * Re-runnable: an existing index is left as it is, and a refused build is tried
 * again on the next boot.
 */

import { operatorFacingErrorText } from '@objectstack/types';

import {
    classifyIndexFailure,
    countDuplicateKeys,
    describeDuplicateKeys,
    isSchemaDdlHeldBackForTable,
    logProblem,
    resolveIndexSeamForTable,
    type IndexExec,
    type IndexMigrationLogger,
    type PartialIndexStatus,
} from './partial-index-probe.js';
import { catalogFamilyOf, isResultSet, normalizeRows, readTablePresence } from './read-probe.js';
import { isDuplicateColumnName, isDuplicateKeyName, isMariaDb } from './activation-ledger-packageless-index.js';

/** The one table this migration touches. */
export const CONNECTOR_CONNECTION_TABLE = 'sys_connector_connection';

/**
 * The index name. Its own name, never one the driver generates: the widened
 * key's narrower predecessor is the driver's generated name for
 * `(organization_id, connector_name)`, and claiming that name would let
 * the widening arm read this index as the superseded one.
 */
export const CONNECTOR_CONNECTION_PACKAGELESS_INDEX_NAME = 'uniq_sys_connector_connection_packageless';

/**
 * The old two-column key's name: what `driver-sql`'s `buildIndexName` generates
 * for `(organization_id, connector_name)` on this table, which the earlier
 * `{ fields: ['connector_name'], unique: 'organization' }` declaration built
 * (pinned against it in `connector-connection-packageless-index.test.ts`).
 * Built only where this index cannot be (module doc, "A dialect with no form").
 */
export const CONNECTOR_CONNECTION_OLD_KEY_INDEX_NAME = 'uniq_sys_connector_connection_organization_id_connector_name';

/** The key columns, in key order — the old key's, so the widening arm reads this index as its guard. */
export const CONNECTOR_CONNECTION_PACKAGELESS_INDEX_COLUMNS = ['organization_id', 'connector_name'] as const;

/** The rows the index covers. */
export const CONNECTOR_CONNECTION_PACKAGELESS_ROW_SCOPE = 'connector_package IS NULL';

/**
 * MariaDB's carrier column for the index. It must be the name `driver-sql`'s
 * `hashShadowColumnFor` derives from the index name — the index name plus
 * `__hash` — or the drift differ reads it as an orphan column.
 */
export const CONNECTOR_CONNECTION_PACKAGELESS_SHADOW_COLUMN = `${CONNECTOR_CONNECTION_PACKAGELESS_INDEX_NAME}__hash`;

/** How many duplicated keys a refusal names before it says how many more there are. */
const NAMED_DUPLICATE_KEYS = 10;

/** The digest both MySQL-family forms key: the driver's own hash-shadow digest. */
function packagelessDigest(): string {
    return `unhex(sha2(concat(${CONNECTOR_CONNECTION_PACKAGELESS_INDEX_COLUMNS.join(', 0x1f, ')}), 256))`;
}

/**
 * The MariaDB statement: one `ALTER TABLE` adding the INVISIBLE generated
 * carrier and the UNIQUE key over it, so the column never stands without its
 * key. A second boot answers ER_DUP_FIELDNAME, which the caller follows with
 * {@link buildConnectorConnectionPackagelessMariaDbKeySql}.
 */
export function buildConnectorConnectionPackagelessMariaDbSql(): string {
    return (
        `ALTER TABLE ${CONNECTOR_CONNECTION_TABLE} ADD COLUMN ${CONNECTOR_CONNECTION_PACKAGELESS_SHADOW_COLUMN} VARBINARY(32) ` +
        `GENERATED ALWAYS AS (CASE WHEN ${CONNECTOR_CONNECTION_PACKAGELESS_ROW_SCOPE} THEN ${packagelessDigest()} END) ` +
        `VIRTUAL INVISIBLE, ` +
        `ADD UNIQUE KEY ${CONNECTOR_CONNECTION_PACKAGELESS_INDEX_NAME} (${CONNECTOR_CONNECTION_PACKAGELESS_SHADOW_COLUMN})`
    );
}

/** The key alone, over a carrier column that already stands (a second boot after ER_DUP_FIELDNAME). */
export function buildConnectorConnectionPackagelessMariaDbKeySql(): string {
    return (
        `ALTER TABLE ${CONNECTOR_CONNECTION_TABLE} ADD UNIQUE KEY ${CONNECTOR_CONNECTION_PACKAGELESS_INDEX_NAME} ` +
        `(${CONNECTOR_CONNECTION_PACKAGELESS_SHADOW_COLUMN})`
    );
}

/**
 * `CREATE UNIQUE INDEX …` for the connected dialect. `client` is the knex client
 * name; anything not MySQL-family takes the partial form.
 */
export function buildConnectorConnectionPackagelessIndexSql(client?: string): string {
    const columns = CONNECTOR_CONNECTION_PACKAGELESS_INDEX_COLUMNS;
    if (catalogFamilyOf(client) === 'mysql') {
        // No `IF NOT EXISTS` for CREATE INDEX on MySQL: an existing index
        // answers ER_DUP_KEYNAME, which the caller reads as "already there".
        return (
            `CREATE UNIQUE INDEX ${CONNECTOR_CONNECTION_PACKAGELESS_INDEX_NAME} ON ${CONNECTOR_CONNECTION_TABLE} ` +
            `((CASE WHEN ${CONNECTOR_CONNECTION_PACKAGELESS_ROW_SCOPE} THEN ${packagelessDigest()} END))`
        );
    }
    return (
        `CREATE UNIQUE INDEX IF NOT EXISTS ${CONNECTOR_CONNECTION_PACKAGELESS_INDEX_NAME} ` +
        `ON ${CONNECTOR_CONNECTION_TABLE} (${columns.join(', ')}) WHERE ${CONNECTOR_CONNECTION_PACKAGELESS_ROW_SCOPE}`
    );
}

/**
 * The old two-column key, for a dialect this index has no form on (module doc,
 * "A dialect with no form"). No `IF NOT EXISTS` on MySQL, where an existing
 * index answers ER_DUP_KEYNAME.
 */
export function buildConnectorConnectionOldKeySql(client?: string): string {
    const ifNotExists = catalogFamilyOf(client) === 'mysql' ? '' : 'IF NOT EXISTS ';
    return (
        `CREATE UNIQUE INDEX ${ifNotExists}${CONNECTOR_CONNECTION_OLD_KEY_INDEX_NAME} ON ${CONNECTOR_CONNECTION_TABLE} ` +
        `(${CONNECTOR_CONNECTION_PACKAGELESS_INDEX_COLUMNS.join(', ')})`
    );
}

/** The fallback "is this table here?" statement, for a dialect `read-probe.ts` has no catalog arm for. */
export function buildConnectorConnectionPresenceSql(): string {
    return `SELECT 1 FROM ${CONNECTOR_CONNECTION_TABLE} WHERE 1 = 0`;
}

/**
 * The catalog statement that answers "does the guard already stand on the
 * table?" with no DDL: one row when an index of its name is on the table, none
 * when not. `undefined` for a client `read-probe.ts` has no catalog arm for, a
 * guessed spelling being that module's fence; the build then runs as before.
 * Each arm resolves the table the way the unqualified DDL does: SQLite's
 * connection catalog, PostgreSQL's search path (`to_regclass`), the MySQL
 * family's connected schema (`DATABASE()`), whose `statistics` lists the
 * functional key and MariaDB's key over its carrier column alike.
 */
export function buildConnectorConnectionPackagelessIndexPresenceSql(client?: string): string | undefined {
    const index = CONNECTOR_CONNECTION_PACKAGELESS_INDEX_NAME;
    const table = CONNECTOR_CONNECTION_TABLE;
    switch (catalogFamilyOf(client)) {
        case 'sqlite':
            return `SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = '${index}' AND tbl_name = '${table}'`;
        case 'postgres':
            return (
                `SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid ` +
                `WHERE i.indrelid = to_regclass('"${table}"') AND c.relname = '${index}'`
            );
        case 'mysql':
            return (
                `SELECT 1 FROM information_schema.statistics ` +
                `WHERE table_schema = DATABASE() AND table_name = '${table}' AND index_name = '${index}'`
            );
        default:
            return undefined;
    }
}

/**
 * Does the guard already stand? Read before any DDL (module doc, "When"):
 * `CREATE UNIQUE INDEX IF NOT EXISTS` takes PostgreSQL's SHARE lock on the
 * table before it finds the name taken, so it waits behind every open write
 * transaction on the connection table and holds every new writer behind it
 * meanwhile (measured on PostgreSQL 16), and the MySQL family refuses its
 * statement outright. A pass that finds the guard issues none of it.
 *
 * `'unknown'` (no catalog arm for the client, a refused read, no result set)
 * is ⛔ never read as present: the build runs as it ran before this read
 * existed, idempotent and reporting its own failure. The read only saves a
 * statement; it never decides that the build may be skipped.
 */
async function readPackagelessIndexPresence(exec: IndexExec, client?: string): Promise<'present' | 'absent' | 'unknown'> {
    const sql = buildConnectorConnectionPackagelessIndexPresenceSql(client);
    if (sql === undefined) return 'unknown';
    let result: unknown;
    try {
        result = await exec(sql);
    } catch {
        return 'unknown';
    }
    if (!isResultSet(result)) return 'unknown';
    return normalizeRows(result).length > 0 ? 'present' : 'absent';
}

/**
 * The connections blocking the index, grouped by its key. A row whose key part
 * is NULL conflicts with nothing under a UNIQUE index, so it is no duplicate to
 * list (`organization_id` and `connector_name` are both required, so none is
 * expected). One statement for every dialect.
 */
export function buildConnectorConnectionPackagelessDuplicateProbeSql(): string {
    const columns = CONNECTOR_CONNECTION_PACKAGELESS_INDEX_COLUMNS;
    return (
        `SELECT ${columns.join(', ')}, COUNT(*) AS duplicate_rows ` +
        `FROM ${CONNECTOR_CONNECTION_TABLE} ` +
        `WHERE ${CONNECTOR_CONNECTION_PACKAGELESS_ROW_SCOPE} AND ${columns.map((c) => `${c} IS NOT NULL`).join(' AND ')} ` +
        `GROUP BY ${columns.join(', ')} HAVING COUNT(*) > 1`
    );
}

/** This migration's statuses: the shared vocabulary plus `'absent'` (no such table on this kernel). */
export type EnsureConnectorConnectionPackagelessIndexStatus = PartialIndexStatus | 'absent';

export interface EnsureConnectorConnectionPackagelessIndexResult {
    status: EnsureConnectorConnectionPackagelessIndexStatus;
    /** Driver error text, when there was one. */
    detail?: string;
    /**
     * On `'unsupported'` only: whether the old two-column key stands in its
     * place (`'kept'`: built now or already there) or could not be built
     * (`'failed'`, its driver text in `oldKeyDetail`). Module doc, "A dialect
     * with no form".
     */
    oldKey?: 'kept' | 'failed';
    oldKeyDetail?: string;
}

/** Resolve the raw-SQL seam (and dialect) for `sys_connector_connection`. @see resolveIndexSeamForTable */
export function resolveConnectorConnectionIndexSeam(engine: unknown): { exec: IndexExec; client?: string } | undefined {
    return resolveIndexSeamForTable(engine, CONNECTOR_CONNECTION_TABLE);
}

/** Build the MariaDB form; a second boot re-keys or finds the key in place. */
async function buildOnMariaDb(exec: IndexExec): Promise<void> {
    try {
        await exec(buildConnectorConnectionPackagelessMariaDbSql());
    } catch (err: unknown) {
        if (!isDuplicateColumnName(err)) throw err;
        await exec(buildConnectorConnectionPackagelessMariaDbKeySql());
    }
}

/**
 * The duplicated keys, as the clause a `'conflict'` line names them by (module
 * doc, "Refuse, never keep-one"): the first {@link NAMED_DUPLICATE_KEYS}, then
 * how many more. `''` when they cannot be read — the count and the query still
 * say what to do.
 */
async function nameDuplicateKeys(exec: IndexExec): Promise<string> {
    try {
        const result = await exec(buildConnectorConnectionPackagelessDuplicateProbeSql());
        if (!isResultSet(result)) return '';
        const rows = normalizeRows(result);
        if (rows.length === 0) return '';
        const named = rows.slice(0, NAMED_DUPLICATE_KEYS).map((r) =>
            `organization_id=${String(r.organization_id)}, connector_name=${String(r.connector_name)} ` +
            `(${String(r.duplicate_rows)} connections)`);
        const more = rows.length > NAMED_DUPLICATE_KEYS ? `; and ${rows.length - NAMED_DUPLICATE_KEYS} more` : '';
        return `: ${named.join('; ')}${more}`;
    } catch {
        return '';
    }
}

/**
 * Ensure the package-less one-connection index (module doc).
 *
 * Idempotent: an existing index is left as it is, found by a catalog read
 * before any DDL (`readPackagelessIndexPresence`), and reported `created`.
 * Best-effort by design — a boot never fails because the index could not be
 * built, so every branch returns a status instead of throwing, and every
 * branch that leaves the guarantee unenforced says so at `error`.
 */
export async function ensureConnectorConnectionPackagelessIndex(
    exec: IndexExec | undefined,
    logger?: IndexMigrationLogger,
    opts: { client?: string } = {},
): Promise<EnsureConnectorConnectionPackagelessIndexResult> {
    if (!exec) return { status: 'no-driver' };

    const presence = await readTablePresence(exec, {
        table: CONNECTOR_CONNECTION_TABLE,
        client: opts.client,
        fallbackSql: buildConnectorConnectionPresenceSql(),
    });
    if (presence.verdict === 'absent') return { status: 'absent' };
    if (presence.verdict === 'unreadable') {
        logProblem(
            logger,
            `[metadata-protocol] could not read whether "${CONNECTOR_CONNECTION_TABLE}" exists, so the index that keeps ` +
                'one connection per (organization_id, connector_name) among connections naming no package was NOT ensured ' +
                'this boot. This is not the table being absent, which is a normal, silent no-op. Verify by hand with: ' +
                buildConnectorConnectionPresenceSql(),
            presence.detail ?? '',
        );
        return { status: 'failed', detail: presence.detail };
    }

    // A guard that already stands is left as it is without a statement that
    // locks the table or is refused (`readPackagelessIndexPresence`).
    if ((await readPackagelessIndexPresence(exec, opts.client)) === 'present') return { status: 'created' };

    try {
        if (catalogFamilyOf(opts.client) === 'mysql' && (await isMariaDb(exec))) await buildOnMariaDb(exec);
        else await exec(buildConnectorConnectionPackagelessIndexSql(opts.client));
        return { status: 'created' };
    } catch (err: unknown) {
        if (isDuplicateKeyName(err)) return { status: 'created' };
        const status = classifyIndexFailure(err);
        const detail = operatorFacingErrorText(err);
        const duplicates =
            status === 'conflict'
                ? describeDuplicateKeys(await countDuplicateKeys(exec, buildConnectorConnectionPackagelessDuplicateProbeSql())) +
                  (await nameDuplicateKeys(exec))
                : '';
        if (status === 'unsupported') {
            const kept = await keepOldKey(exec, opts.client);
            reportUnsupported(detail, logger, kept);
            return { status, detail, ...kept };
        }
        // `duplicates` reads " (N duplicated keys, held by M rows): organization_id=…; …" — the count, then the keys.
        reportDegradation(status, detail, logger, duplicates);
        return { status, detail };
    }
}

/**
 * What one schema-sync pass did about the guard
 * ({@link createConnectorConnectionGuardAtSchemaSync}): the migration's own
 * status, or
 *
 * - `'held-back'`: the driver behind the table holds this pass's DDL back (a
 *   dry run, or `os migrate apply` before its confirmation), so nothing was
 *   built and the next pass tries again;
 * - `'refused-earlier'`: this kernel already reported a refusal, so the build
 *   is neither tried nor reported again until the next boot.
 */
export type ConnectorConnectionGuardPassOutcome = EnsureConnectorConnectionPackagelessIndexStatus | 'held-back' | 'refused-earlier';

/** The statuses that latch: each one was reported at `error`, and a second pass in one boot would only say it again. */
const REFUSALS: ReadonlySet<EnsureConnectorConnectionPackagelessIndexStatus> = new Set(['conflict', 'unsupported', 'failed']);

/**
 * [#31699] The guard as a kernel's schema sync builds it: one ensurer per
 * kernel, run after each pass's DDL (`objectql:schema-synced`, module doc
 * "When"). `metadata-protocol`'s assembly subscribes it on every kernel,
 * whatever its `runPlatformMigrations` gate says, so the guard follows the
 * table's DDL wherever that runs.
 *
 * - **A pass that performed no DDL builds nothing.** While the driver behind the
 *   table holds DDL back ({@link isSchemaDdlHeldBackForTable}) the answer is
 *   `'held-back'`, unlatched: the one-shot CLI boot triggers the event again
 *   once its flush has performed what was held back (`os migrate apply`), and
 *   a dry run never flushes.
 * - **`created` never latches.** Every later pass re-checks the guard, because
 *   a pass can lose it: a SQLite table rebuild drops every index and recreates
 *   only the declared ones. While it stands the check is one catalog read and
 *   no DDL, so a `metadata:reloaded` re-sync neither locks the connection table nor
 *   sends a statement the server refuses.
 * - **A refusal latches.** `conflict`, `unsupported` and `failed` were each
 *   reported at `error` once; the next boot tries again.
 * - It never throws: a boot does not fail because the guard could not be built,
 *   so an unexpected throw is reported at `error` and latched as a refusal.
 */
export function createConnectorConnectionGuardAtSchemaSync(
    engine: unknown,
    logger: IndexMigrationLogger,
): () => Promise<ConnectorConnectionGuardPassOutcome> {
    let refused = false;
    return async () => {
        if (refused) return 'refused-earlier';
        try {
            if (isSchemaDdlHeldBackForTable(engine, CONNECTOR_CONNECTION_TABLE)) return 'held-back';
            const seam = resolveConnectorConnectionIndexSeam(engine);
            const { status } = await ensureConnectorConnectionPackagelessIndex(seam?.exec, logger, { client: seam?.client });
            if (REFUSALS.has(status)) refused = true;
            return status;
        } catch (err: unknown) {
            refused = true;
            logProblem(
                logger,
                '[metadata-protocol] connector connection index migration skipped — the index that keeps one connection ' +
                    'per (organization_id, connector_name) among connections naming no package was not ensured this boot, ' +
                    'so two such connections of one connector instance can stand in one organization',
                operatorFacingErrorText(err),
            );
            return 'failed';
        }
    };
}

/** Build (or find) the old two-column key where this index has no form. */
async function keepOldKey(
    exec: IndexExec,
    client: string | undefined,
): Promise<{ oldKey: 'kept' | 'failed'; oldKeyDetail?: string }> {
    try {
        await exec(buildConnectorConnectionOldKeySql(client));
        return { oldKey: 'kept' };
    } catch (err: unknown) {
        if (isDuplicateKeyName(err)) return { oldKey: 'kept' };
        return { oldKey: 'failed', oldKeyDetail: operatorFacingErrorText(err) };
    }
}

/**
 * The `'unsupported'` line: what still guards (the old key, kept or built), or,
 * when that key could not be built either, that nothing does. `error` either
 * way: once the connection's key is widened, that key alone admits what the old key
 * refused.
 */
function reportUnsupported(
    detail: string,
    logger: IndexMigrationLogger | undefined,
    kept: { oldKey: 'kept' | 'failed'; oldKeyDetail?: string },
): void {
    const key = `(${CONNECTOR_CONNECTION_PACKAGELESS_INDEX_COLUMNS.join(', ')}) WHERE ${CONNECTOR_CONNECTION_PACKAGELESS_ROW_SCOPE}`;
    const head =
        `[metadata-protocol] this database cannot build '${CONNECTOR_CONNECTION_PACKAGELESS_INDEX_NAME}' on ` +
        `"${CONNECTOR_CONNECTION_TABLE}" — it has no partial index, no functional key part and no INVISIBLE ` +
        `column (MySQL before 8.0.13, or MariaDB before 10.3) — so ${key} is NOT enforced by an index of its own. `;
    if (kept.oldKey === 'kept') {
        logProblem(
            logger,
            head +
                `The old (organization_id, connector_name) index '${CONNECTOR_CONNECTION_OLD_KEY_INDEX_NAME}' ` +
                'stands in its place (kept, or built where it was missing) and refuses every second connection naming no ' +
                'package, but it also refuses one organization a connection of a second package\'s connector instance of ' +
                'the same name, which an instance\'s (package, name) identity admits. Upgrade to MySQL 8.0.13+ or MariaDB 10.3+ and restart to build the ' +
                'index; the next safe sync then retires the old one.',
            detail,
        );
        return;
    }
    logProblem(
        logger,
        head +
            `The old (organization_id, connector_name) index '${CONNECTOR_CONNECTION_OLD_KEY_INDEX_NAME}' could ` +
            'not be built in its place either, so two connections of one connector instance naming no package can ' +
            'stand in one organization, and revoking one leaves the other\'s refresh token stored. Fix the cause below, or list ' +
            `the duplicates with: ${buildConnectorConnectionPackagelessDuplicateProbeSql()}, then restart.`,
        kept.oldKeyDetail ?? detail,
    );
}

/**
 * Say what is NOT enforced and what fixes it (ADR-0120 D4's wording contract).
 * Every arm is `error`: afterwards the platform looks healthy while two
 * connections of one connector instance can stand in one organization.
 */
function reportDegradation(
    status: Exclude<PartialIndexStatus, 'unsupported'>,
    detail: string,
    logger: IndexMigrationLogger | undefined,
    duplicates: string,
): void {
    const key = `(${CONNECTOR_CONNECTION_PACKAGELESS_INDEX_COLUMNS.join(', ')}) WHERE ${CONNECTOR_CONNECTION_PACKAGELESS_ROW_SCOPE}`;
    const duplicateQuery = buildConnectorConnectionPackagelessDuplicateProbeSql();
    const consequence =
        'two connections of one connector instance naming no package can stand in one organization, and revoking ' +
        'one leaves the other\'s refresh token stored';

    if (status === 'conflict') {
        logProblem(
            logger,
            `[metadata-protocol] cannot build '${CONNECTOR_CONNECTION_PACKAGELESS_INDEX_NAME}' on ` +
                `"${CONNECTOR_CONNECTION_TABLE}" — existing connections violate ${key}${duplicates}. Nothing is enforced on ` +
                `that key, so ${consequence}. No connection is deleted, and no package is guessed for one: this migration ` +
                'keeps refusing until an operator revokes the connection that should not stand, or binds one to its ' +
                `package ("os migrate stored-references bind"). List them with: ${duplicateQuery} — or run ` +
                '"os migrate duplicates" — then restart (ADR-0120 D4).',
            detail,
        );
        return;
    }

    logProblem(
        logger,
        `[metadata-protocol] could not build '${CONNECTOR_CONNECTION_PACKAGELESS_INDEX_NAME}' on ` +
            `"${CONNECTOR_CONNECTION_TABLE}", so ${key} is not enforced and ${consequence}, while everything else ` +
            'looks healthy. Fix the cause below and restart.',
        detail,
    );
}
