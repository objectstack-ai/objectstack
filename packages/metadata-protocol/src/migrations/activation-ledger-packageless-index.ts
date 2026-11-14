// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `sys_metadata_activation` — one row per `(metadata_type, name)` among the rows
 * that name no package, delivered at runtime (ADR-0150 D4, ADR-0120 D4).
 *
 * ## What is broken without it
 *
 * The activation ledger's declared key is `(metadata_type, package_id, name)`,
 * so two packages may each switch off an item of one name. `package_id` is
 * NULL on every row for an item the environment authored (ADR-0126 §4: the
 * environment's own spelling, never a sentinel), and SQL UNIQUE treats NULLs as
 * distinct, so for exactly those rows the declared key constrains nothing. The
 * key it replaced, `(metadata_type, name)`, held them; without a second index
 * their one-row property would rest on the store's read-then-write alone, and
 * two concurrent first writes (two replicas, two admin requests) could leave
 * two rows — whose name-keyed readers then take whichever comes first. That is
 * the NULL-distinct-composite hazard ADR-0120 D3 exists to prevent.
 *
 * ## Why THIS route
 *
 * `IndexSchema` (`name` / `fields` / `unique`) can say neither "NULL-safe" for a
 * non-tenant column nor `WHERE`, so the declared surface cannot carry it. The
 * route ADR-0120 D4 runs for the class is a runtime-managed `kernel:ready` index
 * migration, as `notification-preference-identity-index.ts` and
 * `sys-setting-identity-index.ts` do. One difference shapes everything below:
 * those REPLACE a declared index with a tighter one, while this one ADDS an
 * index beside the declared key and replaces nothing — so there is no previous
 * index to protect, no probe name, and nothing is ever dropped.
 *
 * ## The index, per dialect (measured on live servers, PR body)
 *
 * - SQLite and PostgreSQL: a partial unique index,
 *   `(metadata_type, name) WHERE package_id IS NULL`. Packaged rows are outside
 *   it; the declared key constrains them.
 * - MySQL (8.0.13+): no partial indexes, so a functional key part carries the
 *   same guarantee — MySQL implements it as a hidden generated column. The part
 *   is the same digest the driver's own hash shadows use for TEXT keys
 *   (`unhex(sha2(concat(…, 0x1f, …), 256))`), and it is NULL for a packaged
 *   row, which UNIQUE then exempts.
 * - MariaDB has neither partial indexes nor functional key parts (it answers
 *   both with a syntax error, measured on 11.8), so the index keys an INVISIBLE
 *   generated column that carries the same digest, NULL for a packaged row:
 *   `uniq_sys_metadata_activation_packageless__hash`, `VIRTUAL INVISIBLE`
 *   (MariaDB 10.3+). INVISIBLE keeps it out of `SELECT *`, so no read sees it.
 *   The `__hash` suffix is `driver-sql`'s hash-shadow naming
 *   (`hashShadowColumnFor`), which is what makes the drift differ treat the
 *   column as driver-owned and read the index as a partial unique on
 *   `(metadata_type, name)` (`parseHashShadowRowScope`): never an orphan, and
 *   the guard its widening arm asks for before it retires the old key.
 *   MariaDB is told apart from MySQL by `SELECT VERSION()`; a version that
 *   cannot be read takes the MySQL form. MariaDB before 10.3 refuses
 *   `INVISIBLE` and reports `unsupported`, and there the old
 *   `(metadata_type, name)` index keeps guarding, because the widening arm
 *   offers to retire it only once this index exists
 *   (`widenedUniqueReplacements`).
 * - SQL Server is federation-only (ADR-0015 §4.6): ObjectStack creates no table
 *   there, so no ledger lives there.
 * - `driver-memory` is no SQL host (`no-driver`): single-process and never
 *   multi-replica, so the concurrent-first-write race does not cross processes.
 * - `driver-mongodb` builds its own copy at collection sync (`mongodb-schema.ts`,
 *   `{ package_id: null }` partial filter, which covers a missing field too).
 *
 * ## Refuse, never keep-one (ADR-0120 D4)
 *
 * The build fails only on a database that already holds two package-less rows
 * of one `(metadata_type, name)`, which the previous key refused, so it takes
 * rows written after that key was retired. They are two administrators'
 * switches, so nothing here deletes or picks one: the operator gets the key that
 * is not enforced, the consequence, and the query that lists the rows
 * ({@link buildActivationLedgerPackagelessDuplicateProbeSql}, also what
 * `os migrate duplicates` runs through `runtime-index-preflight.ts`).
 *
 * The drift differ leaves the index alone: a partial or expression index is not
 * sync-reproducible (`isSyncReproducibleIndex`), so it is runtime-managed and
 * never read as an orphan.
 */

import { operatorFacingErrorText } from '@objectstack/types';

import {
    classifyIndexFailure,
    countDuplicateKeys,
    describeDuplicateKeys,
    logProblem,
    resolveIndexSeamForTable,
    type IndexExec,
    type IndexMigrationLogger,
    type PartialIndexStatus,
} from './partial-index-probe.js';
import { catalogFamilyOf, normalizeRows, readTablePresence } from './read-probe.js';

/** The one table this migration touches. */
export const ACTIVATION_LEDGER_TABLE = 'sys_metadata_activation';

/**
 * The index name. Its own name, never one the driver generates: the declared
 * key's narrower predecessor is `uniq_sys_metadata_activation_metadata_type_name`,
 * and claiming that name would let the widening arm read this index as the
 * superseded one.
 */
export const ACTIVATION_LEDGER_PACKAGELESS_INDEX_NAME = 'uniq_sys_metadata_activation_packageless';

/** The key columns, in key order. */
export const ACTIVATION_LEDGER_PACKAGELESS_INDEX_COLUMNS = ['metadata_type', 'name'] as const;

/** The rows the index covers. */
export const ACTIVATION_LEDGER_PACKAGELESS_ROW_SCOPE = 'package_id IS NULL';

/**
 * MariaDB's carrier column for the index (module doc). It must be the name
 * `driver-sql`'s `hashShadowColumnFor` derives from the index name — the index
 * name plus `__hash` — or the drift differ reads it as an orphan column and the
 * index as an orphan carrier.
 */
export const ACTIVATION_LEDGER_PACKAGELESS_SHADOW_COLUMN = `${ACTIVATION_LEDGER_PACKAGELESS_INDEX_NAME}__hash`;

/** The digest both MySQL-family forms key: the driver's own hash-shadow digest. */
function packagelessDigest(): string {
    return `unhex(sha2(concat(${ACTIVATION_LEDGER_PACKAGELESS_INDEX_COLUMNS.join(', 0x1f, ')}), 256))`;
}

/**
 * The MariaDB statement (module doc): one `ALTER TABLE` adding the INVISIBLE
 * generated carrier and the UNIQUE key over it, so the column never stands
 * without its key. No `IF NOT EXISTS`: a second boot answers ER_DUP_FIELDNAME,
 * which the caller follows with {@link buildActivationLedgerPackagelessMariaDbKeySql}.
 */
export function buildActivationLedgerPackagelessMariaDbSql(): string {
    return (
        `ALTER TABLE ${ACTIVATION_LEDGER_TABLE} ADD COLUMN ${ACTIVATION_LEDGER_PACKAGELESS_SHADOW_COLUMN} VARBINARY(32) ` +
        `GENERATED ALWAYS AS (CASE WHEN ${ACTIVATION_LEDGER_PACKAGELESS_ROW_SCOPE} THEN ${packagelessDigest()} END) ` +
        `VIRTUAL INVISIBLE, ` +
        `ADD UNIQUE KEY ${ACTIVATION_LEDGER_PACKAGELESS_INDEX_NAME} (${ACTIVATION_LEDGER_PACKAGELESS_SHADOW_COLUMN})`
    );
}

/**
 * The key alone, over a carrier column that already stands: what a second boot
 * runs after ER_DUP_FIELDNAME, so a column left without its key (a key dropped
 * by hand) gets it back, and a key already there answers ER_DUP_KEYNAME.
 */
export function buildActivationLedgerPackagelessMariaDbKeySql(): string {
    return (
        `ALTER TABLE ${ACTIVATION_LEDGER_TABLE} ADD UNIQUE KEY ${ACTIVATION_LEDGER_PACKAGELESS_INDEX_NAME} ` +
        `(${ACTIVATION_LEDGER_PACKAGELESS_SHADOW_COLUMN})`
    );
}

/**
 * `CREATE UNIQUE INDEX …` for the connected dialect (module doc). `client` is
 * the knex client name; anything not MySQL-family takes the partial form.
 */
export function buildActivationLedgerPackagelessIndexSql(client?: string): string {
    const columns = ACTIVATION_LEDGER_PACKAGELESS_INDEX_COLUMNS;
    if (catalogFamilyOf(client) === 'mysql') {
        // No `IF NOT EXISTS` for CREATE INDEX on MySQL: an existing index
        // answers ER_DUP_KEYNAME, which the caller reads as "already there".
        const digest = packagelessDigest();
        return (
            `CREATE UNIQUE INDEX ${ACTIVATION_LEDGER_PACKAGELESS_INDEX_NAME} ON ${ACTIVATION_LEDGER_TABLE} ` +
            `((CASE WHEN ${ACTIVATION_LEDGER_PACKAGELESS_ROW_SCOPE} THEN ${digest} END))`
        );
    }
    return (
        `CREATE UNIQUE INDEX IF NOT EXISTS ${ACTIVATION_LEDGER_PACKAGELESS_INDEX_NAME} ` +
        `ON ${ACTIVATION_LEDGER_TABLE} (${columns.join(', ')}) WHERE ${ACTIVATION_LEDGER_PACKAGELESS_ROW_SCOPE}`
    );
}

/** The fallback "is this table here?" statement, for a dialect `read-probe.ts` has no catalog arm for. */
export function buildActivationLedgerPresenceSql(): string {
    return `SELECT 1 FROM ${ACTIVATION_LEDGER_TABLE} WHERE 1 = 0`;
}

/**
 * The rows blocking the index, grouped by its key. A row whose key part is NULL
 * conflicts with nothing under a UNIQUE index, so it is no duplicate to list.
 * One statement for every dialect: no identifier here is reserved on MySQL.
 */
export function buildActivationLedgerPackagelessDuplicateProbeSql(): string {
    const columns = ACTIVATION_LEDGER_PACKAGELESS_INDEX_COLUMNS;
    return (
        `SELECT ${columns.join(', ')}, COUNT(*) AS duplicate_rows ` +
        `FROM ${ACTIVATION_LEDGER_TABLE} ` +
        `WHERE ${ACTIVATION_LEDGER_PACKAGELESS_ROW_SCOPE} AND ${columns.map((c) => `${c} IS NOT NULL`).join(' AND ')} ` +
        `GROUP BY ${columns.join(', ')} HAVING COUNT(*) > 1`
    );
}

/** This migration's statuses: the shared vocabulary plus `'absent'` (no such table on this kernel). */
export type EnsureActivationLedgerPackagelessIndexStatus = PartialIndexStatus | 'absent';

export interface EnsureActivationLedgerPackagelessIndexResult {
    status: EnsureActivationLedgerPackagelessIndexStatus;
    /** Driver error text, when there was one. */
    detail?: string;
}

/** Resolve the raw-SQL seam (and dialect) for `sys_metadata_activation`. @see resolveIndexSeamForTable */
export function resolveActivationLedgerIndexSeam(engine: unknown): { exec: IndexExec; client?: string } | undefined {
    return resolveIndexSeamForTable(engine, ACTIVATION_LEDGER_TABLE);
}

/**
 * MySQL's "an index of that name already exists" (ER_DUP_KEYNAME). Shared with
 * the grant's package-less guard (`user-permission-set-packageless-index.ts`).
 */
export function isDuplicateKeyName(error: unknown): boolean {
    const e = error as { errno?: unknown; code?: unknown; message?: unknown; cause?: unknown } | undefined;
    if (e?.errno === 1061 || e?.code === 'ER_DUP_KEYNAME') return true;
    if (typeof e?.message === 'string' && /duplicate key name/i.test(e.message)) return true;
    return e?.cause !== undefined && e.cause !== error && isDuplicateKeyName(e.cause);
}

/** MySQL/MariaDB's "a column of that name already exists" (ER_DUP_FIELDNAME). Shared as {@link isDuplicateKeyName} is. */
export function isDuplicateColumnName(error: unknown): boolean {
    const e = error as { errno?: unknown; code?: unknown; message?: unknown; cause?: unknown } | undefined;
    if (e?.errno === 1060 || e?.code === 'ER_DUP_FIELDNAME') return true;
    if (typeof e?.message === 'string' && /duplicate column name/i.test(e.message)) return true;
    return e?.cause !== undefined && e.cause !== error && isDuplicateColumnName(e.cause);
}

/**
 * Is the MySQL-family server MariaDB? Read from `SELECT VERSION()`, whose
 * answer carries `MariaDB` there and not on MySQL. Unreadable ⇒ `false`: the
 * MySQL form is then tried, and a MariaDB that refuses it is reported
 * `unsupported`, as before this arm existed.
 */
export async function isMariaDb(exec: IndexExec): Promise<boolean> {
    try {
        const row = normalizeRows(await exec('SELECT VERSION() AS version'))[0];
        return /mariadb/i.test(String(row?.version ?? row?.VERSION ?? ''));
    } catch {
        return false;
    }
}

/** Build the MariaDB form (module doc); a second boot re-keys or finds the key in place. */
async function buildOnMariaDb(exec: IndexExec): Promise<void> {
    try {
        await exec(buildActivationLedgerPackagelessMariaDbSql());
    } catch (err: unknown) {
        if (!isDuplicateColumnName(err)) throw err;
        await exec(buildActivationLedgerPackagelessMariaDbKeySql());
    }
}

/**
 * Ensure the package-less one-row index (module doc).
 *
 * Idempotent: an existing index is left as it is. Best-effort by design — a
 * boot never fails because the index could not be built, so every branch
 * returns a status instead of throwing, and every branch that leaves the
 * guarantee unenforced says so at `error`.
 */
export async function ensureActivationLedgerPackagelessIndex(
    exec: IndexExec | undefined,
    logger?: IndexMigrationLogger,
    opts: { client?: string } = {},
): Promise<EnsureActivationLedgerPackagelessIndexResult> {
    if (!exec) return { status: 'no-driver' };

    const presence = await readTablePresence(exec, {
        table: ACTIVATION_LEDGER_TABLE,
        client: opts.client,
        fallbackSql: buildActivationLedgerPresenceSql(),
    });
    if (presence.verdict === 'absent') return { status: 'absent' };
    if (presence.verdict === 'unreadable') {
        logProblem(
            logger,
            `[metadata-protocol] could not read whether "${ACTIVATION_LEDGER_TABLE}" exists, so the index that keeps ` +
                'one row per (metadata_type, name) among rows naming no package was NOT ensured this boot. This is ' +
                'not the table being absent, which is a normal, silent no-op. Verify by hand with: ' +
                buildActivationLedgerPresenceSql(),
            presence.detail ?? '',
        );
        return { status: 'failed', detail: presence.detail };
    }

    try {
        if (catalogFamilyOf(opts.client) === 'mysql' && (await isMariaDb(exec))) await buildOnMariaDb(exec);
        else await exec(buildActivationLedgerPackagelessIndexSql(opts.client));
        return { status: 'created' };
    } catch (err: unknown) {
        if (isDuplicateKeyName(err)) return { status: 'created' };
        // The verdict from the error object itself, the detail from the
        // operator-facing text (the precedents' split, `partial-index-probe.ts`).
        const status = classifyIndexFailure(err);
        const detail = operatorFacingErrorText(err);
        const duplicates =
            status === 'conflict'
                ? describeDuplicateKeys(await countDuplicateKeys(exec, buildActivationLedgerPackagelessDuplicateProbeSql()))
                : '';
        reportDegradation(status, detail, logger, duplicates);
        return { status, detail };
    }
}

/**
 * Say what is NOT enforced and what fixes it (ADR-0120 D4's wording contract).
 * Every arm is `error`: afterwards the platform looks healthy while two switches
 * for one environment-authored item can coexist, and which one applies is
 * unspecified.
 */
function reportDegradation(
    status: PartialIndexStatus,
    detail: string,
    logger: IndexMigrationLogger | undefined,
    duplicates: string,
): void {
    const key = `(${ACTIVATION_LEDGER_PACKAGELESS_INDEX_COLUMNS.join(', ')}) WHERE ${ACTIVATION_LEDGER_PACKAGELESS_ROW_SCOPE}`;
    const duplicateQuery = buildActivationLedgerPackagelessDuplicateProbeSql();
    const consequence =
        'two activation rows for one item the environment authored (no package) can coexist, and which switch ' +
        'applies to it is unspecified';

    if (status === 'unsupported') {
        logProblem(
            logger,
            `[metadata-protocol] this database cannot build '${ACTIVATION_LEDGER_PACKAGELESS_INDEX_NAME}' on ` +
                `"${ACTIVATION_LEDGER_TABLE}" — it has no partial index, no functional key part and no INVISIBLE ` +
                `column (MySQL before 8.0.13, or MariaDB before 10.3) — so ${key} is NOT enforced by an index of its own. A database an earlier release ` +
                'built keeps its old (metadata_type, name) index, which "os migrate plan" does not offer to retire ' +
                `safely while this index is missing; on any other, ${consequence}. Watch for duplicates with: ` +
                duplicateQuery,
            detail,
        );
        return;
    }

    if (status === 'conflict') {
        logProblem(
            logger,
            `[metadata-protocol] cannot build '${ACTIVATION_LEDGER_PACKAGELESS_INDEX_NAME}' on ` +
                `"${ACTIVATION_LEDGER_TABLE}" — existing rows violate ${key}${duplicates}. Nothing is enforced on ` +
                `that key, so ${consequence}. They are administrators' switches, so no row is discarded ` +
                `automatically and this migration keeps refusing until an operator deletes the one that should not ` +
                `apply. List them with: ${duplicateQuery} — or run "os migrate duplicates" — then restart (ADR-0120 D4).`,
            detail,
        );
        return;
    }

    logProblem(
        logger,
        `[metadata-protocol] could not build '${ACTIVATION_LEDGER_PACKAGELESS_INDEX_NAME}' on ` +
            `"${ACTIVATION_LEDGER_TABLE}", so ${key} is not enforced and ${consequence}, while everything else ` +
            'looks healthy. Fix the cause below and restart.',
        detail,
    );
}
