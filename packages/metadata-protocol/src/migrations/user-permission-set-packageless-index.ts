// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `sys_user_permission_set` — one grant per `(user_id, permission_set,
 * organization_id)` among the grants that name no package, delivered at runtime
 * (ADR-0150 D4, ADR-0120 D4, #32164).
 *
 * ## What is broken without it
 *
 * A permission set is identified by `(package, name)` (ADR-0150 D4), so the
 * grant's declared key is `(user_id, permission_set, permission_set_package,
 * organization_id)`: one user may hold both packages' sets of one name in one
 * organization. `permission_set_package` is NULL on every grant of a set the
 * environment authored, the platform registered, or two packages hold with no
 * binding yet (the column's documented "empty", never a sentinel), and a SQL
 * UNIQUE treats NULLs as distinct, so for exactly those grants the declared key
 * constrains nothing. The key it replaced, `(user_id, permission_set,
 * organization_id)`, held them to one. Two of them would grant the same set
 * twice, and a revoke that deletes one would leave the other granting.
 *
 * ## Why THIS route
 *
 * `IndexSchema` (`name` / `fields` / `unique`) can say neither "NULL-safe" for a
 * non-tenant column nor `WHERE`, so the declared surface cannot carry it. It is
 * the activation ledger's package-less index applied to this table
 * (`activation-ledger-packageless-index.ts`, whose docblock carries the full
 * argument and the per-dialect measurements): a runtime-managed migration that
 * ADDS an index beside the grant's declared key and replaces nothing. The epic seat
 * ruled the route on #32164 (comment 6770072902).
 *
 * ## When — at schema sync, on every kernel that runs the table's DDL
 *
 * The old key stood from the table's first DDL, on whichever kernel ran it, so
 * this one must too (epic ruling on #32164, MF6, "on every host"; its review's
 * must-fix 1). `metadata-protocol`'s assembly runs
 * {@link createUserPermissionSetGuardAtSchemaSync} on `objectql:schema-synced`,
 * which `ObjectQLPlugin` triggers when each schema sync pass's DDL is done:
 * inside the boot's schema-migration lock, before any later plugin's `start()`
 * writes a grant, and on a `bootPhaseHooks: false` host too, which withholds
 * `kernel:ready`. Built at `kernel:ready`, a fresh database took every bootstrap
 * grant (each one package-less before the holders are sealed) with no key over
 * them, and a `bootPhaseHooks: false` host never built it.
 *
 * The subscription does not sit behind the `runPlatformMigrations` gate that
 * arms the boot repairs: a kernel with an `environmentId` and no declaration
 * (a per-project kernel) and every one-shot CLI boot have it off, and both
 * create this table at their own schema sync. Instead:
 *
 * - A pass that performs no DDL builds nothing. `os migrate plan` and every
 *   dry-run mode boot with their drivers holding DDL back, which the ensurer
 *   reads (`'held-back'`); `os migrate apply` holds it back until the operator
 *   confirms, then performs it and triggers the event again, which builds this
 *   index. A one-shot write mode that boots plainly (`--apply` of the data
 *   commands) builds it at its sync, as a serving boot does.
 * - A `skipSchemaSync` boot (`OS_SKIP_SCHEMA_SYNC`) triggers no pass. Its
 *   tables come from another boot's DDL (a serving boot, an
 *   `OS_MIGRATE_AND_EXIT` job, or `os migrate apply`), which builds this index
 *   with them. Where the gate is on, its `kernel:ready` repair builds it too,
 *   for a database whose DDL came from somewhere that did not.
 * - Re-checked after every pass, never latched once built: each pass reads the
 *   catalog first and issues DDL only when this index is missing. A standing
 *   index costs that read and nothing else, never a `CREATE … IF NOT EXISTS`,
 *   which on PostgreSQL waits for the table's SHARE lock (behind every open
 *   write, and every new write behind it) before it finds the name taken, and
 *   which the MySQL family refuses outright. A SQLite table rebuild drops every
 *   index and recreates only the declared ones, so the next pass finds this one
 *   missing and puts it back. A refusal is reported once per boot.
 *
 * ## The index, per dialect
 *
 * - SQLite and PostgreSQL: a partial unique index,
 *   `(user_id, permission_set, organization_id) WHERE permission_set_package IS NULL`.
 * - MySQL (8.0.13+): a functional key part over the driver's hash-shadow digest
 *   (`unhex(sha2(concat(…, 0x1f, …), 256))`), NULL for a packaged grant, which
 *   UNIQUE then exempts.
 * - MariaDB: a UNIQUE key over an INVISIBLE generated column carrying that
 *   digest, `uniq_sys_user_permission_set_packageless__hash` (MariaDB 10.3+),
 *   which `driver-sql` reads as a partial unique on the three columns
 *   (`parseHashShadowRowScope`).
 * - `driver-mongodb` builds its own copy at collection sync (`mongodb-schema.ts`,
 *   `RUNTIME_OWNED_UNIQUES`, `{ permission_set_package: null }`).
 * - `driver-memory` is no SQL host (`no-driver`), the ledger precedent's
 *   exemption. It is a declared limit (epic condition 3 on #32164): measured,
 *   its unique check treats NULLs as distinct, so it admits two package-less
 *   grants of one name, and a pin asserts that admission so a future guard
 *   seam turns it red (`driver-memory`'s `memory-user-permission-set-packageless.test.ts`).
 *
 * ## What it admits — nothing the old key refused (epic condition 1)
 *
 * Every key part is a plain column, as every part of the plain old key is
 * (ADR-0131 D1), so a grant whose organization is NULL is exempt here exactly
 * as it is under that key: the plain three-column key admits two such grants on
 * every dialect (measured side by side in this file's SQLite and live
 * PostgreSQL/MySQL pins; MySQL's digest is NULL when any part is), and so does
 * this index. An 18.0 store carries the old key in the NULL-safe form instead
 * (ADR-0120 D3, `COALESCE(organization_id, '__global__')`), which refuses the
 * second of them. Condition 1 holds there too, because `driver-sql`'s widening
 * arm keeps that key on a table whose tenant column is not certified NOT NULL,
 * and offers to retire it only once this index stands on a certified table
 * (`tenantKeyCertified`, ADR-0131 D1), where no organization is NULL. On a table
 * `driver-sql` builds the case cannot arise at all — the tenant column is NOT
 * NULL there (ADR-0131 D1). Two package-less grants of one name in one
 * organization are refused, as they were.
 *
 * ## The old key retires on the next boot (or `os migrate apply`)
 *
 * `driver-sql`'s widening arm (`widenedUniqueReplacements`) and
 * `driver-mongodb`'s (`retireWidenedUniques`) offer to retire the old
 * three-column key — create-before-drop, categorized `safe` — only once this
 * index stands, because the gained column is nullable. On SQL the drift plan is
 * read during the table's sync, before this index is built, so on an upgraded
 * database the old key is retired by the NEXT sync that runs safe drift (dev
 * `autoMigrate: 'safe'`, or `os migrate apply`); until then it keeps refusing
 * what it refused.
 *
 * ## A dialect with no form keeps the old key (epic ruling, MF6)
 *
 * MySQL before 8.0.13 and MariaDB before 10.3 have no partial index, no
 * functional key part and no INVISIBLE column, so this index cannot be built
 * there (`'unsupported'`). There the old three-column key stays until it can:
 * an upgraded database keeps it (the widening arm offers nothing while this
 * index is missing), and a database that never had it gets it, under the name
 * `driver-sql` generates for it ({@link USER_PERMISSION_SET_OLD_KEY_INDEX_NAME}),
 * so the widening arm reads it as the superseded key and retires it once this
 * index stands. It refuses everything this index would, and also one user's
 * grant of a second package's set of the same name in one organization, which
 * ADR-0150's `(package, name)` identity admits: a declared limit of those
 * servers.
 *
 * ## Refuse, never keep-one (ADR-0120 D4; epic condition 2)
 *
 * The build fails only on a database that already holds two package-less
 * grants of one `(user_id, permission_set, organization_id)`, which the old key
 * refused, so they were written after it was retired. Nothing here deletes,
 * re-stamps or guesses a package for either: the operator gets the key that is
 * not enforced, the consequence, the duplicated keys themselves (a grant's key
 * is a user id, a set name and an organization id — no secret), and the query
 * that lists the rows ({@link buildUserPermissionSetPackagelessDuplicateProbeSql},
 * also what `os migrate duplicates` runs through `runtime-index-preflight.ts`).
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
export const USER_PERMISSION_SET_TABLE = 'sys_user_permission_set';

/**
 * The index name. Its own name, never one the driver generates: the widened
 * key's narrower predecessor is the driver's generated name for
 * `(user_id, permission_set, organization_id)`, and claiming that name would let
 * the widening arm read this index as the superseded one.
 */
export const USER_PERMISSION_SET_PACKAGELESS_INDEX_NAME = 'uniq_sys_user_permission_set_packageless';

/**
 * The old three-column key's name: what `driver-sql`'s `buildIndexName` generates
 * for `(user_id, permission_set, organization_id)` on this table (pinned against
 * it in `plugin-security`'s `user-permission-set-guard-at-schema-sync.test.ts`).
 * Built only where this index cannot be (module doc, "A dialect with no form").
 */
export const USER_PERMISSION_SET_OLD_KEY_INDEX_NAME = 'uniq_sys_user_permission_set_ac248331';

/** The key columns, in key order — the old key's, so the widening arm reads this index as its guard. */
export const USER_PERMISSION_SET_PACKAGELESS_INDEX_COLUMNS = ['user_id', 'permission_set', 'organization_id'] as const;

/** The rows the index covers. */
export const USER_PERMISSION_SET_PACKAGELESS_ROW_SCOPE = 'permission_set_package IS NULL';

/**
 * MariaDB's carrier column for the index. It must be the name `driver-sql`'s
 * `hashShadowColumnFor` derives from the index name — the index name plus
 * `__hash` — or the drift differ reads it as an orphan column.
 */
export const USER_PERMISSION_SET_PACKAGELESS_SHADOW_COLUMN = `${USER_PERMISSION_SET_PACKAGELESS_INDEX_NAME}__hash`;

/** How many duplicated keys a refusal names before it says how many more there are. */
const NAMED_DUPLICATE_KEYS = 10;

/** The digest both MySQL-family forms key: the driver's own hash-shadow digest. */
function packagelessDigest(): string {
    return `unhex(sha2(concat(${USER_PERMISSION_SET_PACKAGELESS_INDEX_COLUMNS.join(', 0x1f, ')}), 256))`;
}

/**
 * The MariaDB statement: one `ALTER TABLE` adding the INVISIBLE generated
 * carrier and the UNIQUE key over it, so the column never stands without its
 * key. A second boot answers ER_DUP_FIELDNAME, which the caller follows with
 * {@link buildUserPermissionSetPackagelessMariaDbKeySql}.
 */
export function buildUserPermissionSetPackagelessMariaDbSql(): string {
    return (
        `ALTER TABLE ${USER_PERMISSION_SET_TABLE} ADD COLUMN ${USER_PERMISSION_SET_PACKAGELESS_SHADOW_COLUMN} VARBINARY(32) ` +
        `GENERATED ALWAYS AS (CASE WHEN ${USER_PERMISSION_SET_PACKAGELESS_ROW_SCOPE} THEN ${packagelessDigest()} END) ` +
        `VIRTUAL INVISIBLE, ` +
        `ADD UNIQUE KEY ${USER_PERMISSION_SET_PACKAGELESS_INDEX_NAME} (${USER_PERMISSION_SET_PACKAGELESS_SHADOW_COLUMN})`
    );
}

/** The key alone, over a carrier column that already stands (a second boot after ER_DUP_FIELDNAME). */
export function buildUserPermissionSetPackagelessMariaDbKeySql(): string {
    return (
        `ALTER TABLE ${USER_PERMISSION_SET_TABLE} ADD UNIQUE KEY ${USER_PERMISSION_SET_PACKAGELESS_INDEX_NAME} ` +
        `(${USER_PERMISSION_SET_PACKAGELESS_SHADOW_COLUMN})`
    );
}

/**
 * `CREATE UNIQUE INDEX …` for the connected dialect. `client` is the knex client
 * name; anything not MySQL-family takes the partial form.
 */
export function buildUserPermissionSetPackagelessIndexSql(client?: string): string {
    const columns = USER_PERMISSION_SET_PACKAGELESS_INDEX_COLUMNS;
    if (catalogFamilyOf(client) === 'mysql') {
        // No `IF NOT EXISTS` for CREATE INDEX on MySQL: an existing index
        // answers ER_DUP_KEYNAME, which the caller reads as "already there".
        return (
            `CREATE UNIQUE INDEX ${USER_PERMISSION_SET_PACKAGELESS_INDEX_NAME} ON ${USER_PERMISSION_SET_TABLE} ` +
            `((CASE WHEN ${USER_PERMISSION_SET_PACKAGELESS_ROW_SCOPE} THEN ${packagelessDigest()} END))`
        );
    }
    return (
        `CREATE UNIQUE INDEX IF NOT EXISTS ${USER_PERMISSION_SET_PACKAGELESS_INDEX_NAME} ` +
        `ON ${USER_PERMISSION_SET_TABLE} (${columns.join(', ')}) WHERE ${USER_PERMISSION_SET_PACKAGELESS_ROW_SCOPE}`
    );
}

/**
 * The old three-column key, for a dialect this index has no form on (module doc,
 * "A dialect with no form"). No `IF NOT EXISTS` on MySQL, where an existing
 * index answers ER_DUP_KEYNAME.
 */
export function buildUserPermissionSetOldKeySql(client?: string): string {
    const ifNotExists = catalogFamilyOf(client) === 'mysql' ? '' : 'IF NOT EXISTS ';
    return (
        `CREATE UNIQUE INDEX ${ifNotExists}${USER_PERMISSION_SET_OLD_KEY_INDEX_NAME} ON ${USER_PERMISSION_SET_TABLE} ` +
        `(${USER_PERMISSION_SET_PACKAGELESS_INDEX_COLUMNS.join(', ')})`
    );
}

/** The fallback "is this table here?" statement, for a dialect `read-probe.ts` has no catalog arm for. */
export function buildUserPermissionSetPresenceSql(): string {
    return `SELECT 1 FROM ${USER_PERMISSION_SET_TABLE} WHERE 1 = 0`;
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
export function buildUserPermissionSetPackagelessIndexPresenceSql(client?: string): string | undefined {
    const index = USER_PERMISSION_SET_PACKAGELESS_INDEX_NAME;
    const table = USER_PERMISSION_SET_TABLE;
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
 * transaction on the grant table and holds every new writer behind it
 * meanwhile (measured on PostgreSQL 16), and the MySQL family refuses its
 * statement outright. A pass that finds the guard issues none of it.
 *
 * `'unknown'` (no catalog arm for the client, a refused read, no result set)
 * is ⛔ never read as present: the build runs as it ran before this read
 * existed, idempotent and reporting its own failure. The read only saves a
 * statement; it never decides that the build may be skipped.
 */
async function readPackagelessIndexPresence(exec: IndexExec, client?: string): Promise<'present' | 'absent' | 'unknown'> {
    const sql = buildUserPermissionSetPackagelessIndexPresenceSql(client);
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
 * The grants blocking the index, grouped by its key. A grant whose key part is
 * NULL conflicts with nothing under a UNIQUE index (a platform-wide grant
 * among them), so it is no duplicate to list. One statement for every dialect.
 */
export function buildUserPermissionSetPackagelessDuplicateProbeSql(): string {
    const columns = USER_PERMISSION_SET_PACKAGELESS_INDEX_COLUMNS;
    return (
        `SELECT ${columns.join(', ')}, COUNT(*) AS duplicate_rows ` +
        `FROM ${USER_PERMISSION_SET_TABLE} ` +
        `WHERE ${USER_PERMISSION_SET_PACKAGELESS_ROW_SCOPE} AND ${columns.map((c) => `${c} IS NOT NULL`).join(' AND ')} ` +
        `GROUP BY ${columns.join(', ')} HAVING COUNT(*) > 1`
    );
}

/** This migration's statuses: the shared vocabulary plus `'absent'` (no such table on this kernel). */
export type EnsureUserPermissionSetPackagelessIndexStatus = PartialIndexStatus | 'absent';

export interface EnsureUserPermissionSetPackagelessIndexResult {
    status: EnsureUserPermissionSetPackagelessIndexStatus;
    /** Driver error text, when there was one. */
    detail?: string;
    /**
     * On `'unsupported'` only: whether the old three-column key stands in its
     * place (`'kept'`: built now or already there) or could not be built
     * (`'failed'`, its driver text in `oldKeyDetail`). Module doc, "A dialect
     * with no form".
     */
    oldKey?: 'kept' | 'failed';
    oldKeyDetail?: string;
}

/** Resolve the raw-SQL seam (and dialect) for `sys_user_permission_set`. @see resolveIndexSeamForTable */
export function resolveUserPermissionSetIndexSeam(engine: unknown): { exec: IndexExec; client?: string } | undefined {
    return resolveIndexSeamForTable(engine, USER_PERMISSION_SET_TABLE);
}

/** Build the MariaDB form; a second boot re-keys or finds the key in place. */
async function buildOnMariaDb(exec: IndexExec): Promise<void> {
    try {
        await exec(buildUserPermissionSetPackagelessMariaDbSql());
    } catch (err: unknown) {
        if (!isDuplicateColumnName(err)) throw err;
        await exec(buildUserPermissionSetPackagelessMariaDbKeySql());
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
        const result = await exec(buildUserPermissionSetPackagelessDuplicateProbeSql());
        if (!isResultSet(result)) return '';
        const rows = normalizeRows(result);
        if (rows.length === 0) return '';
        const named = rows.slice(0, NAMED_DUPLICATE_KEYS).map((r) =>
            `user_id=${String(r.user_id)}, permission_set=${String(r.permission_set)}, ` +
            `organization_id=${String(r.organization_id)} (${String(r.duplicate_rows)} grants)`);
        const more = rows.length > NAMED_DUPLICATE_KEYS ? `; and ${rows.length - NAMED_DUPLICATE_KEYS} more` : '';
        return `: ${named.join('; ')}${more}`;
    } catch {
        return '';
    }
}

/**
 * Ensure the package-less one-grant index (module doc).
 *
 * Idempotent: an existing index is left as it is, found by a catalog read
 * before any DDL (`readPackagelessIndexPresence`), and reported `created`.
 * Best-effort by design — a boot never fails because the index could not be
 * built, so every branch returns a status instead of throwing, and every
 * branch that leaves the guarantee unenforced says so at `error`.
 */
export async function ensureUserPermissionSetPackagelessIndex(
    exec: IndexExec | undefined,
    logger?: IndexMigrationLogger,
    opts: { client?: string } = {},
): Promise<EnsureUserPermissionSetPackagelessIndexResult> {
    if (!exec) return { status: 'no-driver' };

    const presence = await readTablePresence(exec, {
        table: USER_PERMISSION_SET_TABLE,
        client: opts.client,
        fallbackSql: buildUserPermissionSetPresenceSql(),
    });
    if (presence.verdict === 'absent') return { status: 'absent' };
    if (presence.verdict === 'unreadable') {
        logProblem(
            logger,
            `[metadata-protocol] could not read whether "${USER_PERMISSION_SET_TABLE}" exists, so the index that keeps ` +
                'one grant per (user_id, permission_set, organization_id) among grants naming no package was NOT ensured ' +
                'this boot. This is not the table being absent, which is a normal, silent no-op. Verify by hand with: ' +
                buildUserPermissionSetPresenceSql(),
            presence.detail ?? '',
        );
        return { status: 'failed', detail: presence.detail };
    }

    // A guard that already stands is left as it is without a statement that
    // locks the table or is refused (`readPackagelessIndexPresence`).
    if ((await readPackagelessIndexPresence(exec, opts.client)) === 'present') return { status: 'created' };

    try {
        if (catalogFamilyOf(opts.client) === 'mysql' && (await isMariaDb(exec))) await buildOnMariaDb(exec);
        else await exec(buildUserPermissionSetPackagelessIndexSql(opts.client));
        return { status: 'created' };
    } catch (err: unknown) {
        if (isDuplicateKeyName(err)) return { status: 'created' };
        const status = classifyIndexFailure(err);
        const detail = operatorFacingErrorText(err);
        const duplicates =
            status === 'conflict'
                ? describeDuplicateKeys(await countDuplicateKeys(exec, buildUserPermissionSetPackagelessDuplicateProbeSql())) +
                  (await nameDuplicateKeys(exec))
                : '';
        if (status === 'unsupported') {
            const kept = await keepOldKey(exec, opts.client);
            reportUnsupported(detail, logger, kept);
            return { status, detail, ...kept };
        }
        // `duplicates` reads " (N duplicated keys, held by M rows): user_id=…; …" — the count, then the keys.
        reportDegradation(status, detail, logger, duplicates);
        return { status, detail };
    }
}

/**
 * What one schema-sync pass did about the guard
 * ({@link createUserPermissionSetGuardAtSchemaSync}): the migration's own
 * status, or
 *
 * - `'held-back'`: the driver behind the table holds this pass's DDL back (a
 *   dry run, or `os migrate apply` before its confirmation), so nothing was
 *   built and the next pass tries again;
 * - `'refused-earlier'`: this kernel already reported a refusal, so the build
 *   is neither tried nor reported again until the next boot.
 */
export type UserPermissionSetGuardPassOutcome = EnsureUserPermissionSetPackagelessIndexStatus | 'held-back' | 'refused-earlier';

/** The statuses that latch: each one was reported at `error`, and a second pass in one boot would only say it again. */
const REFUSALS: ReadonlySet<EnsureUserPermissionSetPackagelessIndexStatus> = new Set(['conflict', 'unsupported', 'failed']);

/**
 * [#32164] The guard as a kernel's schema sync builds it: one ensurer per
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
 *   no DDL, so a `metadata:reloaded` re-sync neither locks the grant table nor
 *   sends a statement the server refuses.
 * - **A refusal latches.** `conflict`, `unsupported` and `failed` were each
 *   reported at `error` once; the next boot tries again.
 * - It never throws: a boot does not fail because the guard could not be built,
 *   so an unexpected throw is reported at `error` and latched as a refusal.
 */
export function createUserPermissionSetGuardAtSchemaSync(
    engine: unknown,
    logger: IndexMigrationLogger,
): () => Promise<UserPermissionSetGuardPassOutcome> {
    let refused = false;
    return async () => {
        if (refused) return 'refused-earlier';
        try {
            if (isSchemaDdlHeldBackForTable(engine, USER_PERMISSION_SET_TABLE)) return 'held-back';
            const seam = resolveUserPermissionSetIndexSeam(engine);
            const { status } = await ensureUserPermissionSetPackagelessIndex(seam?.exec, logger, { client: seam?.client });
            if (REFUSALS.has(status)) refused = true;
            return status;
        } catch (err: unknown) {
            refused = true;
            logProblem(
                logger,
                '[metadata-protocol] permission-set grant index migration skipped — the index that keeps one grant per ' +
                    '(user_id, permission_set, organization_id) among grants naming no package was not ensured this boot, ' +
                    'so two such grants can coexist for one user in one organization',
                operatorFacingErrorText(err),
            );
            return 'failed';
        }
    };
}

/** Build (or find) the old three-column key where this index has no form. */
async function keepOldKey(
    exec: IndexExec,
    client: string | undefined,
): Promise<{ oldKey: 'kept' | 'failed'; oldKeyDetail?: string }> {
    try {
        await exec(buildUserPermissionSetOldKeySql(client));
        return { oldKey: 'kept' };
    } catch (err: unknown) {
        if (isDuplicateKeyName(err)) return { oldKey: 'kept' };
        return { oldKey: 'failed', oldKeyDetail: operatorFacingErrorText(err) };
    }
}

/**
 * The `'unsupported'` line: what still guards (the old key, kept or built), or,
 * when that key could not be built either, that nothing does. `error` either
 * way: once the grant's key is widened, that key alone admits what the old key
 * refused.
 */
function reportUnsupported(
    detail: string,
    logger: IndexMigrationLogger | undefined,
    kept: { oldKey: 'kept' | 'failed'; oldKeyDetail?: string },
): void {
    const key = `(${USER_PERMISSION_SET_PACKAGELESS_INDEX_COLUMNS.join(', ')}) WHERE ${USER_PERMISSION_SET_PACKAGELESS_ROW_SCOPE}`;
    const head =
        `[metadata-protocol] this database cannot build '${USER_PERMISSION_SET_PACKAGELESS_INDEX_NAME}' on ` +
        `"${USER_PERMISSION_SET_TABLE}" — it has no partial index, no functional key part and no INVISIBLE ` +
        `column (MySQL before 8.0.13, or MariaDB before 10.3) — so ${key} is NOT enforced by an index of its own. `;
    if (kept.oldKey === 'kept') {
        logProblem(
            logger,
            head +
                `The old (user_id, permission_set, organization_id) index '${USER_PERMISSION_SET_OLD_KEY_INDEX_NAME}' ` +
                'stands in its place (kept, or built where it was missing) and refuses every second grant naming no ' +
                'package, but it also refuses one user a second package\'s set of the same name in one organization, ' +
                'which a set\'s (package, name) identity admits. Upgrade to MySQL 8.0.13+ or MariaDB 10.3+ and restart to build the ' +
                'index; the next safe sync then retires the old one.',
            detail,
        );
        return;
    }
    logProblem(
        logger,
        head +
            `The old (user_id, permission_set, organization_id) index '${USER_PERMISSION_SET_OLD_KEY_INDEX_NAME}' could ` +
            'not be built in its place either, so two grants of one permission set naming no package can coexist for ' +
            'one user in one organization, and revoking one leaves the other granting. Fix the cause below, or list ' +
            `the duplicates with: ${buildUserPermissionSetPackagelessDuplicateProbeSql()}, then restart.`,
        kept.oldKeyDetail ?? detail,
    );
}

/**
 * Say what is NOT enforced and what fixes it (ADR-0120 D4's wording contract).
 * Every arm is `error`: afterwards the platform looks healthy while two grants
 * of one set can coexist for one user in one organization.
 */
function reportDegradation(
    status: Exclude<PartialIndexStatus, 'unsupported'>,
    detail: string,
    logger: IndexMigrationLogger | undefined,
    duplicates: string,
): void {
    const key = `(${USER_PERMISSION_SET_PACKAGELESS_INDEX_COLUMNS.join(', ')}) WHERE ${USER_PERMISSION_SET_PACKAGELESS_ROW_SCOPE}`;
    const duplicateQuery = buildUserPermissionSetPackagelessDuplicateProbeSql();
    const consequence =
        'two grants of one permission set naming no package can coexist for one user in one organization, and ' +
        'revoking one leaves the other granting';

    if (status === 'conflict') {
        logProblem(
            logger,
            `[metadata-protocol] cannot build '${USER_PERMISSION_SET_PACKAGELESS_INDEX_NAME}' on ` +
                `"${USER_PERMISSION_SET_TABLE}" — existing grants violate ${key}${duplicates}. Nothing is enforced on ` +
                `that key, so ${consequence}. No grant is deleted, and no package is guessed for one: this migration ` +
                'keeps refusing until an operator revokes the grant that should not stand, or binds one to its ' +
                `package ("os migrate stored-references bind"). List them with: ${duplicateQuery} — or run ` +
                '"os migrate duplicates" — then restart (ADR-0120 D4).',
            detail,
        );
        return;
    }

    logProblem(
        logger,
        `[metadata-protocol] could not build '${USER_PERMISSION_SET_PACKAGELESS_INDEX_NAME}' on ` +
            `"${USER_PERMISSION_SET_TABLE}", so ${key} is not enforced and ${consequence}, while everything else ` +
            'looks healthy. Fix the cause below and restart.',
        detail,
    );
}
