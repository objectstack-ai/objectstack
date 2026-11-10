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
 * argument and the per-dialect measurements): a runtime-managed `kernel:ready`
 * migration that ADDS an index beside the declared key and replaces nothing.
 * The epic seat ruled the route on #32164 (comment 6770072902).
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
 * Every key part is a plain column, as every part of the old key was
 * (ADR-0131 D1), so a grant whose organization is NULL would be exempt here
 * exactly as it was under the old key: the old key admitted two such grants on
 * every dialect (measured side by side in this file's SQLite and live
 * PostgreSQL/MySQL pins; MySQL's digest is NULL when any part is), and so does
 * this index. On a table `driver-sql` builds the case cannot arise at all — the
 * tenant column is NOT NULL there (ADR-0131 D1). Two package-less grants of one
 * name in one organization are refused, as they were.
 *
 * ## The old key retires on the next boot (or `os migrate apply`)
 *
 * `driver-sql`'s widening arm (`widenedUniqueReplacements`) and
 * `driver-mongodb`'s (`retireWidenedUniques`) offer to retire the old
 * three-column key — create-before-drop, categorized `safe` — only once this
 * index stands, because the gained column is nullable. This index is built at
 * `kernel:ready`, after the boot's schema sync, so on an upgraded database the
 * old key is retired by the NEXT sync that runs safe drift (dev `autoMigrate:
 * 'safe'`, or `os migrate apply`); until then it keeps refusing what it refused.
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
 * The index name. Its own name, never one the driver generates: the declared
 * key's narrower predecessor is the driver's generated name for
 * `(user_id, permission_set, organization_id)`, and claiming that name would let
 * the widening arm read this index as the superseded one.
 */
export const USER_PERMISSION_SET_PACKAGELESS_INDEX_NAME = 'uniq_sys_user_permission_set_packageless';

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

/** The fallback "is this table here?" statement, for a dialect `read-probe.ts` has no catalog arm for. */
export function buildUserPermissionSetPresenceSql(): string {
    return `SELECT 1 FROM ${USER_PERMISSION_SET_TABLE} WHERE 1 = 0`;
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
 * Idempotent: an existing index is left as it is. Best-effort by design — a
 * boot never fails because the index could not be built, so every branch
 * returns a status instead of throwing, and every branch that leaves the
 * guarantee unenforced says so at `error`.
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
        // `duplicates` reads " (N duplicated keys, held by M rows): user_id=…; …" — the count, then the keys.
        reportDegradation(status, detail, logger, duplicates);
        return { status, detail };
    }
}

/**
 * Say what is NOT enforced and what fixes it (ADR-0120 D4's wording contract).
 * Every arm is `error`: afterwards the platform looks healthy while two grants
 * of one set can coexist for one user in one organization.
 */
function reportDegradation(
    status: PartialIndexStatus,
    detail: string,
    logger: IndexMigrationLogger | undefined,
    duplicates: string,
): void {
    const key = `(${USER_PERMISSION_SET_PACKAGELESS_INDEX_COLUMNS.join(', ')}) WHERE ${USER_PERMISSION_SET_PACKAGELESS_ROW_SCOPE}`;
    const duplicateQuery = buildUserPermissionSetPackagelessDuplicateProbeSql();
    const consequence =
        'two grants of one permission set naming no package can coexist for one user in one organization, and ' +
        'revoking one leaves the other granting';

    if (status === 'unsupported') {
        logProblem(
            logger,
            `[metadata-protocol] this database cannot build '${USER_PERMISSION_SET_PACKAGELESS_INDEX_NAME}' on ` +
                `"${USER_PERMISSION_SET_TABLE}" — it has no partial index, no functional key part and no INVISIBLE ` +
                `column (MySQL before 8.0.13, or MariaDB before 10.3) — so ${key} is NOT enforced by an index of its ` +
                'own. A database an earlier release built keeps its old (user_id, permission_set, organization_id) ' +
                'index, which "os migrate plan" does not offer to retire safely while this index is missing; on any ' +
                `other, ${consequence}. Watch for duplicates with: ${duplicateQuery}`,
            detail,
        );
        return;
    }

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
