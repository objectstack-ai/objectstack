// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `sys_notification_preference` — one admin-global default per (organization,
 * topic, channel), delivered at runtime.
 *
 * ## What is broken without it
 *
 * `service-messaging`'s `notification-preference.object.ts` declares
 *
 * ```ts
 * { fields: ['user_id', 'topic', 'channel'], unique: 'organization' }
 * ```
 *
 * and `SqlDriver.syncDeclaredIndexes` materializes it, measured on real SQLite
 * from the shipped declaration, as
 *
 * ```text
 * CREATE UNIQUE INDEX `uniq_sys_notification_preference_a22d7d27`
 *   on `sys_notification_preference` (`organization_id`, `user_id`, `topic`, `channel`)
 * ```
 *
 * `user_id` is a `sys_user` reference whose EMPTY value is the admin-global
 * default (ADR-0118 D1: no sentinel in a user column, so "every user" is the
 * empty reference). SQL UNIQUE treats NULLs as mutually DISTINCT, so the
 * declared key never constrains the global-default rows. Measured on a real
 * engine (ObjectQL over driver-sql): two empty-reference rows for one
 * (organization, topic, channel) were both accepted, and the control — one
 * real user twice — was refused `409 DUPLICATE_RECORD`. `PreferenceResolver`
 * then indexes the rows by key and keeps whichever arrived last, so which of two
 * contradictory admin defaults applies is unspecified.
 *
 * ## Why THIS route
 *
 * The declared vocabulary (`IndexSchema`: `name` / `fields` / `unique`) has no
 * way to mark a non-tenant column NULL-safe, and the driver derives its
 * NULL-safe key parts from the tenant column alone. The route ADR-0120 D4 runs
 * today for exactly this class is a runtime-managed `kernel:ready` index
 * migration, and this module is its fourth instance: it copies
 * `sys-setting-identity-index.ts` (`sys_setting`'s `user_id`, the same NULL
 * reason) rather than inventing a variant — the same probe-first order
 * (`partial-index-probe.ts`), the same seam (`driver-exec.ts`), the same reuse
 * of the declared name, and the same refuse-to-migrate disposition. ADR-0120's
 * parked declared-vocabulary route, when it lands, retires all four together.
 *
 * ## Why the index REUSES the declared name
 *
 * `syncDeclaredIndexes` skips by name, so claiming
 * {@link NOTIFICATION_PREFERENCE_IDENTITY_INDEX_NAME} — the name the driver
 * derives for the declaration (hash-suffixed, because the long form passes the
 * driver's 60-character cap) — keeps every later boot from re-imposing the
 * NULL-distinct form. The drift differ does not fight it back for the reason it
 * leaves `sys_setting`'s alone: `isSyncReproducibleIndex` admits only a
 * `COALESCE` over the tenant column, so this index's `COALESCE(user_id, '')`
 * makes it runtime-managed and the differ skips it.
 *
 * ## The KEY
 *
 * - `organization_id` — plain, as the driver keys it since ADR-0131 D1 (the
 *   tenant column is NOT NULL). An index an 18.0 release built with
 *   `COALESCE(organization_id, '__global__')` is rebuilt to this key, because
 *   the migration rebuilds the definition on every boot.
 * - `user_id` → `COALESCE(user_id, '')`. Copied from `sys_setting`'s
 *   `user_id` (and `ensureOverlayIndex`'s `package_id` before it). `''` is also
 *   the engine's own "no link" spelling, so a NULL and an empty-string
 *   reference are one global bucket, the way `PreferenceResolver` reads them.
 *   No user id is the empty string, so the bucket cannot collide with real
 *   data.
 * - `topic`, `channel` — required, plain.
 *
 * ⚠️ Storage is NOT touched: the rows keep their NULL, only the index folds it.
 *
 * ## Refuse-to-migrate, never keep-one (ADR-0120 D4)
 *
 * A tightening can fail on a database that already holds two global defaults
 * for one key. They are two admin decisions, so nothing here deletes, rewrites
 * or reorders a row: the probe-first order leaves the PREVIOUS index in place,
 * and the operator gets the key that is not enforced, the consequence, and the
 * query that lists the rows ({@link buildNotificationPreferenceDuplicateProbeSql},
 * also what `os migrate duplicates` runs for this index through
 * `runtime-index-preflight.ts`).
 *
 * ## Where it does not reach
 *
 * SQLite and PostgreSQL build it. MySQL/MariaDB refuse the unparenthesized
 * functional key parts (`unsupported`, the previous index stays), and
 * `driver-memory` is no SQL host — both keep the declared, NULL-distinct form,
 * exactly as they do for `sys_setting`.
 */

import { countDuplicateKeys, describeDuplicateKeys, logProblem, probeThenReplaceIndex, resolveIndexSeamForTable, type IndexExec, type IndexMigrationLogger, type PartialIndexStatus } from './partial-index-probe.js';
import { readTablePresence } from './read-probe.js';

/** The one table this migration touches. */
export const NOTIFICATION_PREFERENCE_TABLE = 'sys_notification_preference';

/**
 * The index name — the SAME one `SqlDriver.syncDeclaredIndexes` derives for the
 * declaration, measured on the real driver (and pinned driver-side as the
 * hash-suffixed replacement name of this object's organization-scoped key).
 */
export const NOTIFICATION_PREFERENCE_IDENTITY_INDEX_NAME = 'uniq_sys_notification_preference_a22d7d27';

/** Throwaway name the probe-first order builds under before touching anything. */
export const NOTIFICATION_PREFERENCE_IDENTITY_PROBE_INDEX_NAME = 'idx_sys_notification_preference_identity_probe';

/**
 * The index's key COLUMNS, in the driver's normalized order: the tenant column
 * prepended to the three the declaration lists (ADR-0120 D1).
 */
export const NOTIFICATION_PREFERENCE_IDENTITY_INDEX_COLUMNS = [
    'organization_id',
    'user_id',
    'topic',
    'channel',
] as const;

/** The nullable key columns and the sentinel each one's NULL folds to. */
export const NOTIFICATION_PREFERENCE_NULL_SENTINELS: Readonly<Record<string, string>> = {
    user_id: '',
};

/**
 * The index's key parts, in key order: a bare column, or its NULL-safe
 * `COALESCE` form. One builder, so the CREATE, the duplicate listing and the
 * degradation messages cannot describe different keys.
 */
export function notificationPreferenceIdentityKeyParts(): string[] {
    return NOTIFICATION_PREFERENCE_IDENTITY_INDEX_COLUMNS.map((column) => {
        const sentinel = NOTIFICATION_PREFERENCE_NULL_SENTINELS[column];
        return sentinel === undefined ? column : `COALESCE(${column}, '${sentinel}')`;
    });
}

/** `CREATE UNIQUE INDEX …` under the given name, over the NULL-safe key parts. Every row: no `WHERE`. */
export function buildNotificationPreferenceIdentityIndexSql(indexName: string): string {
    return (
        `CREATE UNIQUE INDEX IF NOT EXISTS ${indexName} ` +
        `ON ${NOTIFICATION_PREFERENCE_TABLE} (${notificationPreferenceIdentityKeyParts().join(', ')})`
    );
}

/** The fallback "is this table here?" statement, for a dialect `read-probe.ts` has no catalog arm for. */
export function buildNotificationPreferencePresenceSql(): string {
    return `SELECT 1 FROM ${NOTIFICATION_PREFERENCE_TABLE} WHERE 1 = 0`;
}

/**
 * The rows blocking the tightening, grouped by exactly the index's key parts.
 *
 * The folded column is projected through its own `COALESCE` (as
 * `user_id_key`), never bare, because PostgreSQL refuses a bare projection of a
 * column grouped only inside an expression (the #6772 lesson `sys_setting`'s
 * builder records). `user_id_key = ''` reads as "the admin-global default".
 * A row whose plain key part is NULL conflicts with nothing under a UNIQUE
 * index, so it is no duplicate to list.
 *
 * No MySQL-spelled twin: unlike `sys_setting`'s `key`, no identifier here is
 * reserved on MySQL, so this one statement runs on all three dialects.
 */
export function buildNotificationPreferenceDuplicateProbeSql(): string {
    const keyParts = notificationPreferenceIdentityKeyParts();
    const projected = NOTIFICATION_PREFERENCE_IDENTITY_INDEX_COLUMNS.map((column, i) => {
        const keyPart = keyParts[i]!;
        return keyPart === column ? keyPart : `${keyPart} AS ${column}_key`;
    });
    const plain = NOTIFICATION_PREFERENCE_IDENTITY_INDEX_COLUMNS.filter(
        (column) => NOTIFICATION_PREFERENCE_NULL_SENTINELS[column] === undefined,
    );
    return (
        `SELECT ${projected.join(', ')}, COUNT(*) AS duplicate_rows ` +
        `FROM ${NOTIFICATION_PREFERENCE_TABLE} ` +
        `WHERE ${plain.map((column) => `${column} IS NOT NULL`).join(' AND ')} ` +
        `GROUP BY ${keyParts.join(', ')} HAVING COUNT(*) > 1`
    );
}

/**
 * This migration's statuses: the shared vocabulary plus `'absent'` — no such
 * table on this kernel (the messaging service is not composed, or the table is
 * not provisioned yet). A silent no-op, never a degradation.
 */
export type EnsureNotificationPreferenceIndexStatus = PartialIndexStatus | 'absent';

export interface EnsureNotificationPreferenceIndexResult {
    status: EnsureNotificationPreferenceIndexStatus;
    /** Driver error text, when there was one. */
    detail?: string;
}

/** Resolve the raw-SQL seam (and dialect) for `sys_notification_preference`. @see resolveIndexSeamForTable */
export function resolveNotificationPreferenceIndexSeam(
    engine: unknown,
): { exec: IndexExec; client?: string } | undefined {
    return resolveIndexSeamForTable(engine, NOTIFICATION_PREFERENCE_TABLE);
}

/**
 * Replace the NULL-distinct declared UNIQUE index with the NULL-safe one.
 *
 * Idempotent: a re-run rebuilds the same definition. Best-effort by design — a
 * boot never fails because an index could not be tightened, so every branch
 * returns a status instead of throwing, and every branch that leaves the key
 * unenforced says so at `error`.
 */
export async function ensureNotificationPreferenceIdentityIndex(
    exec: IndexExec | undefined,
    logger?: IndexMigrationLogger,
    opts: { client?: string } = {},
): Promise<EnsureNotificationPreferenceIndexResult> {
    if (!exec) return { status: 'no-driver' };

    const presence = await readTablePresence(exec, {
        table: NOTIFICATION_PREFERENCE_TABLE,
        client: opts.client,
        fallbackSql: buildNotificationPreferencePresenceSql(),
    });
    if (presence.verdict === 'absent') return { status: 'absent' };
    if (presence.verdict === 'unreadable') {
        // Not absence: nothing looked, so an operator is told.
        logProblem(
            logger,
            `[metadata-protocol] could not read whether "${NOTIFICATION_PREFERENCE_TABLE}" exists, so the ` +
                'one-global-default-per-key index tightening did NOT run and the table keeps whatever unique index ' +
                'it had. This is not the table being absent, which is a normal, silent no-op. Verify by hand with: ' +
                buildNotificationPreferencePresenceSql(),
            presence.detail ?? '',
        );
        return { status: 'failed', detail: presence.detail };
    }

    const outcome = await probeThenReplaceIndex(exec, {
        indexName: NOTIFICATION_PREFERENCE_IDENTITY_INDEX_NAME,
        probeIndexName: NOTIFICATION_PREFERENCE_IDENTITY_PROBE_INDEX_NAME,
        buildSql: buildNotificationPreferenceIdentityIndexSql,
        // [#26630] Selects PostgreSQL's constraint-aware drop and read-back.
        table: NOTIFICATION_PREFERENCE_TABLE,
        client: opts.client,
    });
    if (outcome.status === 'created') return { status: 'created' };

    const detail = outcome.detail ?? '';
    if (outcome.failedAt === 'replace') {
        // Only reachable on a race between the drop and the create: the probe
        // already cleared dialect and data.
        logProblem(
            logger,
            `[metadata-protocol] could not create '${NOTIFICATION_PREFERENCE_IDENTITY_INDEX_NAME}' on ` +
                `"${NOTIFICATION_PREFERENCE_TABLE}" after the probe succeeded — the table may currently have NO ` +
                `unique index on (${notificationPreferenceIdentityKeyParts().join(', ')}). Restart to retry.`,
            detail,
        );
        return { status: 'failed', detail };
    }

    // [#26630] A conflict is reported with its size (keys and rows, no values).
    const duplicates =
        outcome.status === 'conflict'
            ? describeDuplicateKeys(await countDuplicateKeys(exec, buildNotificationPreferenceDuplicateProbeSql()))
            : '';
    reportDegradation(outcome.status, detail, logger, duplicates);
    return { status: outcome.status, detail };
}

/**
 * Say what is NOT enforced and what fixes it (ADR-0120 D4's wording contract).
 *
 * Every arm is `error`, on the AGENTS.md question rather than by default:
 * afterwards the platform looks healthy while two contradictory admin-global
 * notification defaults for one (topic, channel) can coexist, and which one
 * applies to every user is unspecified.
 */
function reportDegradation(
    status: PartialIndexStatus,
    detail: string,
    logger?: IndexMigrationLogger,
    duplicates = '',
): void {
    const columns = NOTIFICATION_PREFERENCE_IDENTITY_INDEX_COLUMNS.join(', ');
    const keyParts = notificationPreferenceIdentityKeyParts().join(', ');
    const duplicateQuery = buildNotificationPreferenceDuplicateProbeSql();
    const consequence =
        'two admin-global defaults (an empty User) for one topic and channel in ONE organization can coexist, ' +
        'and which of them applies to every user is unspecified';

    if (status === 'unsupported') {
        // MySQL/MariaDB: no (unparenthesized) functional key parts. The previous
        // index stays — ADR-0120 D3's degradation, kept rather than rebuilt.
        logProblem(
            logger,
            `[metadata-protocol] this database cannot build the NULL-safe notification preference index — ` +
                `'${NOTIFICATION_PREFERENCE_IDENTITY_INDEX_NAME}' on "${NOTIFICATION_PREFERENCE_TABLE}" stays ` +
                `NULL-distinct on user_id over (${columns}). The system keeps looking healthy while ${consequence}. ` +
                'There is no in-dialect fix: run this platform on SQLite/PostgreSQL for the guarantee, and meanwhile ' +
                `watch for duplicates with: ${duplicateQuery}`,
            detail,
        );
        return;
    }

    if (status === 'conflict') {
        logProblem(
            logger,
            `[metadata-protocol] cannot tighten '${NOTIFICATION_PREFERENCE_IDENTITY_INDEX_NAME}' on ` +
                `"${NOTIFICATION_PREFERENCE_TABLE}" — existing rows violate (${keyParts})${duplicates}. The previous index is ` +
                `left in place and the NULL-safe key is NOT enforced, so ${consequence}. Preferences are ` +
                'admin-authored, so no row is discarded automatically and this migration keeps refusing until an ' +
                `operator deletes the one that should not apply. List them with: ${duplicateQuery} — or run ` +
                '"os migrate duplicates" — then restart (ADR-0120 D4).',
            detail,
        );
        return;
    }

    logProblem(
        logger,
        `[metadata-protocol] could not rebuild '${NOTIFICATION_PREFERENCE_IDENTITY_INDEX_NAME}' on ` +
            `"${NOTIFICATION_PREFERENCE_TABLE}" as the NULL-safe index; the existing index is unchanged, so ` +
            `${consequence}, while everything else looks healthy. Fix the cause below and restart.`,
        detail,
    );
}
