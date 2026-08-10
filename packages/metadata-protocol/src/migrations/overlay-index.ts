// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `sys_metadata` — overlay uniqueness, delivered at runtime (#6418).
 *
 * ## What was broken
 *
 * `metadata-core`'s `sys-metadata.object.ts` declares
 *
 * ```ts
 * { name: 'idx_sys_metadata_overlay_active',
 *   fields: ['type', 'name', 'organization_id', 'package_id'], unique: true }
 * ```
 *
 * and `syncDeclaredIndexes` materializes it as an UNRESTRICTED, NULL-distinct
 * UNIQUE index — knex's `table.unique()` can express neither a `WHERE` nor a
 * `COALESCE`. What ADR-0005 actually wants is uniqueness among ACTIVE rows over
 * a NULL-safe key, and `protocol.ts`'s `ensureOverlayIndex` has always
 * delivered that in raw SQL at boot.
 *
 * Its ORDER was the defect. It ran
 *
 * ```text
 * DROP INDEX IF EXISTS idx_sys_metadata_overlay_active   ← always succeeds
 * CREATE UNIQUE INDEX  idx_sys_metadata_overlay_active … ← may fail
 * ```
 *
 * with nothing that puts the dropped index back, and both `catch` blocks empty.
 * On SQLite/PostgreSQL — the dialects that DO support the form — a `CREATE` that
 * failed on existing rows therefore left `sys_metadata` with **no** unique index
 * at all, and no line in the log. ADR-0005 overlay uniqueness is the base of
 * metadata correctness: with two ACTIVE rows for one
 * `(type, name, organization_id, package_id)`, which one `getMetaItem` returns
 * is undefined.
 *
 * The degradation branch could not save it either. It fired only when the
 * driver's message matched `/partial|where clause|syntax/i`, which duplicate-row
 * errors (`UNIQUE constraint failed` / `duplicate key value`) do not — so the
 * one failure that is about DATA fell through to a bare `// best-effort`
 * comment. MySQL was safe only by accident: `DROP INDEX IF EXISTS` is not legal
 * MySQL, so the drop failed first and the old index survived.
 *
 * ## Why a conflict is a LIVE path here
 *
 * The runtime index is a **tightening** of the declared one in two independent
 * ways, so rows the database admits today can block it:
 *
 * - the declared index is NULL-distinct, and `package_id` is NULL for every
 *   package-less (global) overlay — so two ACTIVE global rows under one
 *   `(type, name, organization_id)` are legal for it and rejected by
 *   `COALESCE(package_id, '')`;
 * - `WHERE state = 'active'` narrows the row set, which by itself is a
 *   relaxation — but the DDL still has to be built against whatever the table
 *   already holds.
 *
 * Hence {@link ensureMetadataOverlayIndexes} takes
 * `partial-index-probe.ts`'s probe-first order — build under a throwaway name,
 * and only once that has demonstrably succeeded drop the real name and rebuild
 * it — and reports every failure the way ADR-0120 D4 requires: keep the
 * previous index, name the key that is NOT enforced, ship the exact query that
 * lists the offending rows, point at `os migrate plan`, never block the boot.
 * `SqlDriver.createNullSafeUniqueIndex` is the in-repo precedent for that
 * disposition; the sibling `view-definition-active-index.ts` is the precedent
 * for the order.
 *
 * ## Why the fallback stays NON-unique
 *
 * On a dialect that cannot build the partial form the degradation target is a
 * plain composite index (`CREATE INDEX`, no `UNIQUE`) — exactly as before
 * #6418. That is deliberate and must not be "fixed" into a full UNIQUE: this
 * table legitimately holds one ACTIVE row and one DRAFT row for the same
 * `(type, name, organization_id, package_id)` at the same time — that
 * coexistence is the entire reason
 * {@link OVERLAY_DRAFT_INDEX_NAME} exists as a separate index — and an
 * unrestricted UNIQUE would reject it. This is the key difference from
 * `sys_view_definition`, whose declared index IS a full UNIQUE.
 *
 * What #6418 changes about the fallback is not its shape but its honesty: it is
 * created with `IF NOT EXISTS` and **without** a preceding drop, so it can only
 * ever add an index and never replace a stronger one, and the report says
 * plainly that uniqueness is not enforced on this dialect.
 *
 * ## The KEY spelling is untouched
 *
 * `(type, name, organization_id, COALESCE(package_id, ''))`, byte-identical to
 * what shipped before. #6418 is an ORDER and REPORTING fix; re-keying this
 * index (notably the bare, NULL-distinct `organization_id` part) is a separate
 * question with its own ADR-0120 D4 ceremony and is deliberately not decided
 * here.
 */

import {
    logProblem,
    probeThenReplaceIndex,
    type IndexExec,
    type IndexMigrationLogger,
    type PartialIndexStatus,
} from './partial-index-probe.js';

/** The one table this migration touches. */
export const OVERLAY_TABLE = 'sys_metadata';

/**
 * The two overlay states that get their own partial UNIQUE index. They are
 * separate indexes precisely so an active row and a draft row for one key can
 * coexist — the `state` predicate is what keeps them from colliding.
 */
export type OverlayIndexState = 'active' | 'draft';

/**
 * Index names, per state. `…_active` is deliberately the SAME name
 * `sys-metadata.object.ts` declares, so `syncDeclaredIndexes` — which skips by
 * name — treats the slot as filled and never re-imposes the unrestricted form.
 */
export const OVERLAY_INDEX_NAMES: Readonly<Record<OverlayIndexState, string>> = {
    active: 'idx_sys_metadata_overlay_active',
    draft: 'idx_sys_metadata_overlay_draft',
};

/** Throwaway names used to prove the partial form is possible before dropping. */
export const OVERLAY_PROBE_INDEX_NAMES: Readonly<Record<OverlayIndexState, string>> = {
    active: 'idx_sys_metadata_overlay_active_probe',
    draft: 'idx_sys_metadata_overlay_draft_probe',
};

/** The key COLUMNS, unchanged by #6418 — see the module header. */
export const OVERLAY_INDEX_COLUMNS = ['type', 'name', 'organization_id', 'package_id'] as const;

/**
 * The nullable key column that folds its NULLs into ONE bucket, and the
 * sentinel it folds to.
 *
 * `package_id` is NULL for every package-less (global) overlay, and SQL UNIQUE
 * treats NULLs as DISTINCT — so without this the global rows would be
 * unconstrained among themselves. `''` is the spelling that shipped; a package
 * id is never the empty string, so the bucket cannot collide with real data.
 *
 * ⚠️ `organization_id` is deliberately NOT listed. It is bare in the index that
 * shipped, and #6418 is an ordering fix — folding it too is a re-keying with
 * its own ADR-0120 D4 ceremony, not a rider on this one.
 */
export const OVERLAY_NULL_SENTINELS: Readonly<Record<string, string>> = {
    package_id: '',
};

/**
 * The index's key parts, in key order: a bare column, or its NULL-safe
 * `COALESCE` form when {@link OVERLAY_NULL_SENTINELS} names one.
 *
 * One builder so the CREATE, the duplicate-listing query the conflict report
 * ships, and the degradation messages can never describe different keys.
 */
export function overlayIndexKeyParts(): string[] {
    return OVERLAY_INDEX_COLUMNS.map((column) => {
        const sentinel = OVERLAY_NULL_SENTINELS[column];
        return sentinel === undefined ? column : `COALESCE(${column}, '${sentinel}')`;
    });
}

/** `CREATE UNIQUE INDEX … WHERE state = '<state>'` under the given name. */
export function buildOverlayIndexSql(indexName: string, state: OverlayIndexState): string {
    return (
        `CREATE UNIQUE INDEX IF NOT EXISTS ${indexName} ` +
        `ON ${OVERLAY_TABLE} (${overlayIndexKeyParts().join(', ')}) ` +
        `WHERE state = '${state}'`
    );
}

/**
 * The dialect fallback: a plain composite index over the BARE columns.
 *
 * Non-UNIQUE on purpose (see the module header) and created with
 * `IF NOT EXISTS` and no preceding drop, so on a name that already holds a
 * stronger index this statement is a no-op rather than a downgrade.
 */
export function buildOverlayFallbackIndexSql(indexName: string): string {
    return (
        `CREATE INDEX IF NOT EXISTS ${indexName} ` +
        `ON ${OVERLAY_TABLE} (${OVERLAY_INDEX_COLUMNS.join(', ')})`
    );
}

/**
 * The query that lists the rows blocking the tightening — ADR-0120 D4's "name
 * the offending rows", shipped inside the report so an operator has it without
 * waiting for `os migrate plan`.
 *
 * It GROUPs by exactly the index's own key parts, so what it reports and what
 * the index rejects cannot diverge. The nullable column is projected through
 * the SAME `COALESCE` it is grouped by (aliased `package_key`) rather than
 * bare: a bare projection of a column that appears in `GROUP BY` only inside an
 * expression is rejected by PostgreSQL, and this query has to run on both
 * dialects that can build the index it is explaining.
 */
export function buildOverlayDuplicateProbeSql(state: OverlayIndexState): string {
    const projected = OVERLAY_INDEX_COLUMNS.map((column) => {
        const sentinel = OVERLAY_NULL_SENTINELS[column];
        return sentinel === undefined ? column : `COALESCE(${column}, '${sentinel}') AS ${column}_key`;
    });
    return (
        `SELECT ${projected.join(', ')}, COUNT(*) AS duplicate_rows ` +
        `FROM ${OVERLAY_TABLE} WHERE state = '${state}' ` +
        `GROUP BY ${overlayIndexKeyParts().join(', ')} HAVING COUNT(*) > 1`
    );
}

/**
 * What became of the non-UNIQUE composite fallback, when one was attempted.
 *
 * `'ensured'` deliberately does not claim the index was CREATED: the statement
 * carries `IF NOT EXISTS`, so on a name that already holds an index (the
 * declaration's own unrestricted UNIQUE, typically) it is a no-op and that
 * stronger index survives. All the outcome states is that the name now holds
 * an index and nothing was replaced by something weaker.
 */
export type OverlayFallbackOutcome = 'not-attempted' | 'ensured' | 'refused';

export interface EnsureOverlayIndexResult {
    status: PartialIndexStatus;
    /** Driver error text, when there was one. */
    detail?: string;
    /** Only ever leaves `'not-attempted'` on the `unsupported` path. */
    fallback: OverlayFallbackOutcome;
}

/**
 * Bring ONE overlay index (`active` or `draft`) to its partial-UNIQUE form
 * without ever leaving `sys_metadata` less protected than it was.
 *
 * Best-effort by design — a boot must never fail because an index could not be
 * tightened, which is why every branch returns a status instead of throwing.
 */
export async function ensureOverlayStateIndex(
    exec: IndexExec | undefined,
    state: OverlayIndexState,
    logger?: IndexMigrationLogger,
): Promise<EnsureOverlayIndexResult> {
    if (!exec) return { status: 'no-driver', fallback: 'not-attempted' };

    const indexName = OVERLAY_INDEX_NAMES[state];
    const outcome = await probeThenReplaceIndex(exec, {
        indexName,
        probeIndexName: OVERLAY_PROBE_INDEX_NAMES[state],
        buildSql: (name) => buildOverlayIndexSql(name, state),
    });

    if (outcome.status === 'created') return { status: 'created', fallback: 'not-attempted' };

    const detail = outcome.detail ?? '';

    if (outcome.failedAt === 'replace') {
        // Only reachable on a race with another process between the drop and
        // the create — the probe already cleared dialect and data. Say so
        // rather than leaving a table that now has no unique index at all.
        logProblem(
            logger,
            `[metadata-protocol] could not create '${indexName}' on "${OVERLAY_TABLE}" after the probe ` +
            `succeeded — the table may currently have NO unique index over ` +
            `(${overlayIndexKeyParts().join(', ')}) among state='${state}' rows. Restart to retry (#6418).`,
            detail,
        );
        return { status: 'failed', detail, fallback: 'not-attempted' };
    }

    // The probe failed, so nothing was dropped: whatever index held this name
    // is exactly as it was. On a dialect that cannot build the partial form,
    // still offer the composite LOOKUP index — additively, never replacing.
    let fallback: OverlayFallbackOutcome = 'not-attempted';
    if (outcome.status === 'unsupported') {
        try {
            await exec(buildOverlayFallbackIndexSql(indexName));
            fallback = 'ensured';
        } catch {
            // Expected on MySQL proper, which has no `CREATE INDEX IF NOT
            // EXISTS` either. Reported below rather than swallowed.
            fallback = 'refused';
        }
    }

    reportDegradation(state, outcome.status, detail, fallback, logger);
    return { status: outcome.status, detail, fallback };
}

/**
 * Bring BOTH overlay indexes to their partial-UNIQUE form.
 *
 * The two are independent: a failure on one must not skip the other, because
 * they protect different row sets and losing both is strictly worse than
 * losing one.
 */
export async function ensureMetadataOverlayIndexes(
    exec: IndexExec | undefined,
    logger?: IndexMigrationLogger,
): Promise<Record<OverlayIndexState, EnsureOverlayIndexResult>> {
    return {
        active: await ensureOverlayStateIndex(exec, 'active', logger),
        draft: await ensureOverlayStateIndex(exec, 'draft', logger),
    };
}

/**
 * Say what is NOT enforced and what fixes it — ADR-0120 D4's wording contract,
 * which `SqlDriver.createNullSafeUniqueIndex` already follows for the same class
 * of event. Never fails the boot: from the outside everything else looks normal,
 * so silence here is what makes the gap expensive.
 *
 * Every arm is `error`, and that is a deliberate level choice rather than a
 * default. What goes missing in all three is an INTEGRITY guarantee the platform
 * states it enforces (ADR-0005): duplicate ACTIVE overlays accumulate, nothing
 * looks broken, and `getMetaItem` starts returning whichever row the engine
 * happened to reach first — a defect that surfaces releases later to someone who
 * cannot connect it to a boot line. That is the durability arm of AGENTS.md's
 * logging rule, and the level the empty `catch` blocks this replaces were the
 * exact opposite of.
 */
function reportDegradation(
    state: OverlayIndexState,
    status: PartialIndexStatus,
    detail: string,
    fallback: OverlayFallbackOutcome,
    logger?: IndexMigrationLogger,
): void {
    const indexName = OVERLAY_INDEX_NAMES[state];
    const columns = OVERLAY_INDEX_COLUMNS.join(', ');
    const keyParts = overlayIndexKeyParts().join(', ');
    const duplicateQuery = buildOverlayDuplicateProbeSql(state);

    if (status === 'unsupported') {
        const fallbackNote =
            fallback === 'ensured'
                ? `A plain composite index over (${columns}) is ensured under that name instead, as the ` +
                  `degradation target — deliberately NOT UNIQUE, because one ACTIVE and one DRAFT row ` +
                  `for the same key legitimately coexist on this table and an unrestricted UNIQUE would ` +
                  `reject legal data.`
                : `The plain-composite degradation target could not be created either (this dialect has ` +
                  `no "CREATE INDEX IF NOT EXISTS"), so no index was added.`;
        logProblem(
            logger,
            `[metadata-protocol] this database cannot build the overlay-uniqueness index — ` +
            `'${indexName}' on "${OVERLAY_TABLE}" cannot be scoped to state='${state}' rows over ` +
            `(${keyParts}), so ADR-0005 overlay uniqueness is NOT enforced as specified on this ` +
            `dialect: package-less ${state} rows (package_id NULL) stay NULL-distinct and can duplicate ` +
            `— getMetaItem then has no defined answer for which row wins — and any unrestricted UNIQUE ` +
            `that remains additionally rejects the legal ACTIVE+DRAFT pair. The system keeps looking ` +
            `healthy either way. Whatever index already carried this name is left exactly as it was, ` +
            `never replaced by something weaker. ${fallbackNote} MySQL/MariaDB has no partial indexes, ` +
            `so there is no in-dialect fix: run this platform on SQLite/PostgreSQL for the guarantee, ` +
            `and meanwhile watch for duplicates with: ${duplicateQuery}`,
            detail,
        );
        return;
    }

    if (status === 'conflict') {
        logProblem(
            logger,
            `[metadata-protocol] cannot rebuild '${indexName}' on "${OVERLAY_TABLE}" — existing rows ` +
            `violate (${keyParts}) among state='${state}'. The previous index is left in place, so ` +
            `(${columns}) is enforced only as far as it was before; ADR-0005 overlay uniqueness is NOT ` +
            `enforced until the duplicates are resolved, and getMetaItem has no defined answer for ` +
            `which of the colliding rows wins. List them with: ${duplicateQuery} — or run ` +
            `"os migrate plan" — then restart (ADR-0120 D4, #6418).`,
            detail,
        );
        return;
    }

    // The catch-all ('failed'), raised alongside the dialect arm above and for
    // the same reason. Leaving it quieter would report the case we UNDERSTAND
    // (a named dialect limitation) more loudly than the one we do not, while the
    // consequence is identical: the DDL did not run, overlay uniqueness is not
    // in force, and nothing else looks wrong.
    logProblem(
        logger,
        `[metadata-protocol] could not rebuild '${indexName}' on "${OVERLAY_TABLE}" as the ` +
        `state='${state}' partial UNIQUE index; the existing index is unchanged, so two ${state} ` +
        `overlay rows for one (${columns}) can still coexist while everything else looks healthy. ` +
        `Fix the cause below and restart (#6418).`,
        detail,
    );
}
