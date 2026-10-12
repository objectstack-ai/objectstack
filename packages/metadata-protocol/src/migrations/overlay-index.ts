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
 *   fields: ['type', 'name', 'organization_id', 'package_id'], unique: 'global' }
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
 * lists the offending rows, point at `os migrate duplicates`, never block the
 * boot. `SqlDriver.createNullSafeUniqueIndex` is the in-repo precedent for that
 * disposition; the order's precedent was #5839's `sys_view_definition`
 * migration, retired with its table (ADR-0131 D13), and the order itself now
 * lives in `partial-index-probe.ts`.
 *
 * ⚠️ The referral named `os migrate plan` until #8725, and it was FALSE for
 * this class: the differ never sees these indexes — `isRuntimeManagedIndex`
 * excludes the partial form once it is built, and before that the migration
 * reuses the DECLARED index's name, so the name-matched slot reads as filled
 * either way — and `PendingSchemaWork` carries no index kind at all. Maintainer
 * ruling 2026-08-22 routes the class to `os migrate duplicates`, which boots
 * read-only and owns the "inventory, never repair" contract, keeping `os
 * migrate plan`'s drift contract untouched. Both overlay states are probed
 * there, because either can be blocked independently.
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
 * unrestricted UNIQUE would reject it.
 *
 * What #6418 changes about the fallback is not its shape but its honesty: it is
 * created with `IF NOT EXISTS` and **without** a preceding drop, so it can only
 * ever add an index and never replace a stronger one, and the report says
 * plainly that uniqueness is not enforced on this dialect.
 *
 * ## The KEY, and its one re-keying (#22877)
 *
 * `(type, name, organization_id, COALESCE(package_id, ''),
 * COALESCE(bundle_member, ''))`. #6418 was an ORDER and REPORTING fix and kept
 * the key byte-identical; the member part is the one re-keying since, ruled
 * through this ceremony.
 *
 * `bundle_member` is the member of a metadata type whose identity is a pair
 * (`ITEM_KEY_DISCRIMINATORS`, today `email_template`'s `(name, locale)`): two
 * locales of one template are two overlay rows, where the four-part key kept
 * one and the second locale's save replaced the first at the next boot. NULL is
 * the canonical member and every row of an undiscriminated type, folded to the
 * `''` bucket so those rows are constrained exactly as before.
 *
 * The probe-then-replace order needs nothing new to carry a CHANGED key: it
 * drops and rebuilds the real name on every first write, so the next boot after
 * the upgrade replaces the four-part index with this one. Adding a key part only
 * RELAXES uniqueness — rows the old key admitted are distinct under the new one
 * — so no store that built the old index can be refused by this one; the
 * `conflict` arm below still reports a store that was already blocked. Rows
 * written before the column existed carry NULL whatever member their body
 * declares, and {@link backfillOverlayBundleMembers} gives each its body's
 * member before a read can take it for the canonical one.
 *
 * The bare, NULL-distinct `organization_id` part is still a separate question
 * with its own ADR-0120 D4 ceremony and is deliberately not decided here.
 */

import { ITEM_KEY_DISCRIMINATORS, itemDiscriminator } from '@objectstack/metadata-core';
import { PLURAL_TO_SINGULAR } from '@objectstack/spec/shared';
import { operatorFacingErrorText } from '@objectstack/types';
// The shared "which driver read errors are benign" vocabulary (#4867).
import { isMissingTableError } from '@objectstack/metadata/errors';

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

/**
 * The column that carries a bundled type's member (#22877) — see the module
 * header and `sys-metadata.object.ts`. One name, read by the key below, the
 * repository's write head and the protocol's by-name reads.
 */
export const OVERLAY_MEMBER_COLUMN = 'bundle_member';

/** The key COLUMNS — see the module header for the member part. */
export const OVERLAY_INDEX_COLUMNS = ['type', 'name', 'organization_id', 'package_id', OVERLAY_MEMBER_COLUMN] as const;

/**
 * The nullable key columns that fold their NULLs into ONE bucket, and the
 * sentinel each folds to.
 *
 * `package_id` is NULL for every package-less (global) overlay, and SQL UNIQUE
 * treats NULLs as DISTINCT — so without this the global rows would be
 * unconstrained among themselves. `''` is the spelling that shipped; a package
 * id is never the empty string, so the bucket cannot collide with real data.
 *
 * `bundle_member` is NULL for the canonical member and for every row of an
 * undiscriminated type — nearly every row of the table — so a bare part would
 * leave exactly the rows this index has always constrained unconstrained. A
 * member is never the empty string ({@link overlayMemberValue} answers NULL for
 * it), so `''` cannot collide with a real member either.
 *
 * ⚠️ `organization_id` is deliberately NOT listed. It is bare in the index that
 * shipped, and #6418 is an ordering fix — folding it too is a re-keying with
 * its own ADR-0120 D4 ceremony, not a rider on this one.
 */
export const OVERLAY_NULL_SENTINELS: Readonly<Record<string, string>> = {
    package_id: '',
    [OVERLAY_MEMBER_COLUMN]: '',
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
 * waiting for `os migrate duplicates`.
 *
 * The same statement is what `os migrate duplicates` issues for this index
 * (#8725), once per state: the command reads this builder rather than restating
 * the key, so the pre-flight and the boot report cannot describe different
 * duplicates.
 *
 * It GROUPs by exactly the index's own key parts, so what it reports and what
 * the index rejects cannot diverge. The nullable column is projected through
 * the SAME `COALESCE` it is grouped by (aliased `<column>_key`) rather than
 * bare: a bare projection of a column that appears in `GROUP BY` only inside an
 * expression is rejected by PostgreSQL, and this query has to run on both
 * dialects that can build the index it is explaining. Both NULL-folded parts
 * project that way: `package_id_key` and `bundle_member_key`.
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
 * [#22877] Does this store's `sys_metadata` carry {@link OVERLAY_MEMBER_COLUMN}
 * yet? `SELECT <column> FROM sys_metadata WHERE 1 = 0` — reads no row, writes
 * nothing, and is refused on a table an earlier version created.
 */
export function buildOverlayMemberPresenceSql(): string {
    return `SELECT ${OVERLAY_MEMBER_COLUMN} FROM ${OVERLAY_TABLE} WHERE 1 = 0`;
}

/**
 * [#22877] {@link buildOverlayDuplicateProbeSql} for a store whose table
 * predates {@link OVERLAY_MEMBER_COLUMN} — the shape `os migrate duplicates`
 * meets, because it boots read-only and the column arrives with the next
 * SERVING boot's schema sync.
 *
 * Every row there reads as the EMPTY member: the column is added NULL, and
 * the member part folds NULL to the `''` bucket, so the key the rebuild will
 * judge those rows by is the four columns plus `''`. The listing therefore
 * groups by the other key parts and projects the member as the constant
 * `bundle_member_key = ''`, the same projection names as the full listing, so
 * a group reads the same whichever statement found it. A row of a bundled type
 * whose body names a non-canonical member is backfilled to that member on the
 * serving boot, so such a pair can be reported here and then not block — the
 * strict direction, and the population the backfill measures at boot.
 */
export function buildOverlayDuplicateProbeSqlWithoutMember(state: OverlayIndexState): string {
    const columns = OVERLAY_INDEX_COLUMNS.filter((column) => column !== OVERLAY_MEMBER_COLUMN);
    const projected = columns.map((column) => {
        const sentinel = OVERLAY_NULL_SENTINELS[column];
        return sentinel === undefined ? column : `COALESCE(${column}, '${sentinel}') AS ${column}_key`;
    });
    const grouped = columns.map((column) => {
        const sentinel = OVERLAY_NULL_SENTINELS[column];
        return sentinel === undefined ? column : `COALESCE(${column}, '${sentinel}')`;
    });
    return (
        `SELECT ${projected.join(', ')}, '${OVERLAY_NULL_SENTINELS[OVERLAY_MEMBER_COLUMN]}' AS ${OVERLAY_MEMBER_COLUMN}_key, ` +
        `COUNT(*) AS duplicate_rows ` +
        `FROM ${OVERLAY_TABLE} WHERE state = '${state}' ` +
        `GROUP BY ${grouped.join(', ')} HAVING COUNT(*) > 1`
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
            `(${overlayIndexKeyParts().join(', ')}) among state='${state}' rows. Restart to retry.`,
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
            `dialect: package-less ${state} rows (package_id NULL) and canonical bundle members ` +
            `(${OVERLAY_MEMBER_COLUMN} NULL) stay NULL-distinct and can duplicate ` +
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
            `"os migrate duplicates" — then restart (ADR-0120 D4).`,
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
        `Fix the cause below and restart.`,
        detail,
    );
}

// ── The member part (#22877) ────────────────────────────────────────────────

/**
 * The discriminator `type` declares, under either spelling of the type.
 * `undefined` for every type whose identity is `name` alone.
 */
function overlayDiscriminatorOf(type: string): { field: string; canonical: string } | undefined {
    return ITEM_KEY_DISCRIMINATORS[PLURAL_TO_SINGULAR[type] ?? type];
}

/**
 * The value {@link OVERLAY_MEMBER_COLUMN} holds for the member a caller names.
 *
 *  - `undefined` — `type` declares no discriminator. The load-bearing answer:
 *    every caller adds the column to a key, a row or a `where` ONLY when it is
 *    defined, so an undiscriminated type's writes and reads stay byte-identical
 *    to what they were before the column existed (the `itemDiscriminator`
 *    contract, one layer down).
 *  - `null` — the canonical member: no member named, an empty one, or the
 *    canonical value itself. ONE spelling for it, never the canonical value,
 *    so a row written before the column existed and a row written after it
 *    cannot hold the same member under two keys.
 *  - the trimmed value — any other member.
 */
export function overlayMemberValue(type: string, member?: string | null): string | null | undefined {
    const disc = overlayDiscriminatorOf(type);
    if (!disc) return undefined;
    const value = typeof member === 'string' ? member.trim() : '';
    return value === '' || value === disc.canonical ? null : value;
}

/**
 * The member a metadata BODY belongs to, as {@link OVERLAY_MEMBER_COLUMN}
 * stores it — read through `itemDiscriminator`, the one place a type declares
 * what else is part of its identity. Same three answers as
 * {@link overlayMemberValue}.
 */
export function overlayMemberOfBody(type: string, body: unknown): string | null | undefined {
    const singular = PLURAL_TO_SINGULAR[type] ?? type;
    const declared = itemDiscriminator(singular, body);
    if (declared === undefined) return undefined;
    return overlayMemberValue(singular, declared);
}

/**
 * The `where` fragment that addresses one member of `type`: `{}` for an
 * undiscriminated type (no predicate at all), else the column pinned to the
 * member — `null` (IS NULL) for the canonical one. Spread into a row read.
 */
export function overlayMemberWhere(type: string, member?: string | null): Record<string, unknown> {
    const value = overlayMemberValue(type, member);
    return value === undefined ? {} : { [OVERLAY_MEMBER_COLUMN]: value };
}

/** The engine surface {@link backfillOverlayBundleMembers} reads and writes through. */
export interface OverlayMemberBackfillEngine {
    find(table: string, options: { where: Record<string, unknown>; context?: any }): Promise<any[] | null | undefined>;
    update(table: string, data: Record<string, unknown>, options: { where: Record<string, unknown>; context?: any }): Promise<unknown>;
}

export interface OverlayMemberBackfillResult {
    /** `'failed'` — a read or a write did not happen; `detail` says why. */
    status: 'done' | 'failed';
    /** Rows that now carry their body's member. */
    backfilled: number;
    /** Rows of a discriminated type whose stored body does not parse — left NULL. */
    unparseable: number;
    detail?: string;
}

/**
 * Give every row written before {@link OVERLAY_MEMBER_COLUMN} existed the
 * member its body declares.
 *
 * Such a row carries NULL — the canonical member — whatever its body says, so
 * a `zh-CN` overlay stored by the four-part key reads as the `en-US` one to a
 * bare-name read, and the next `zh-CN` save would mint a second row beside it
 * holding the same member. Only rows of a discriminated type whose body names
 * a NON-canonical member are written; a canonical body's NULL is already
 * right, and every other type's rows are never read here at all.
 *
 * Through the ENGINE rather than raw SQL: the member is read out of the JSON
 * body by `itemDiscriminator`, which no portable SQL expression can reproduce,
 * and the engine reaches every driver this table lives on (memory hosts
 * included, where there is no raw seam). Idempotent — a row that carries a
 * member is skipped — and safe in any order relative to the index rebuild,
 * because the new key only relaxes the old one: rows unique under the
 * four-part key stay unique when each gains its member.
 *
 * Never throws: a boot must not fail over a backfill. A failure is reported at
 * `error` (AGENTS.md "Degradation log levels": the rows it did not reach keep
 * answering bare-name reads as the canonical member while everything looks
 * healthy) with the fix, and the next boot retries.
 */
export async function backfillOverlayBundleMembers(
    engine: OverlayMemberBackfillEngine | undefined,
    logger?: IndexMigrationLogger,
): Promise<OverlayMemberBackfillResult> {
    let backfilled = 0;
    let unparseable = 0;
    if (!engine || typeof engine.find !== 'function' || typeof engine.update !== 'function') {
        return { status: 'done', backfilled, unparseable };
    }
    const context = { isSystem: true };
    try {
        for (const type of Object.keys(ITEM_KEY_DISCRIMINATORS)) {
            const rows = (await engine.find(OVERLAY_TABLE, { where: { type }, context })) ?? [];
            for (const row of rows as Array<Record<string, unknown>>) {
                if (row?.[OVERLAY_MEMBER_COLUMN] != null) continue;
                let body: unknown;
                try {
                    body = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
                } catch {
                    // Every read of this row already fails on the same bytes; it
                    // stays the canonical member until a save repairs it.
                    unparseable++;
                    continue;
                }
                const member = overlayMemberOfBody(type, body);
                if (member === null || member === undefined) continue;
                await engine.update(
                    OVERLAY_TABLE,
                    { [OVERLAY_MEMBER_COLUMN]: member },
                    { where: { id: row.id }, context },
                );
                backfilled++;
            }
        }
    } catch (error) {
        // Benign — and only benign: no table, therefore no row to backfill.
        if (isMissingTableError(error, OVERLAY_TABLE)) return { status: 'done', backfilled, unparseable };
        // The dialect's own words, read out of the `cause` a raw seam attaches
        // (see `partial-index-probe.ts`), so the report names the real refusal.
        const detail = operatorFacingErrorText(error);
        logProblem(
            logger,
            `[metadata-protocol] could not backfill "${OVERLAY_TABLE}".${OVERLAY_MEMBER_COLUMN} from the ` +
            `stored bodies (${backfilled} row(s) done before the failure). Overlay rows of a bundled type ` +
            `(${Object.keys(ITEM_KEY_DISCRIMINATORS).join(', ')}) stored before this column existed keep ` +
            `NULL, so a non-canonical member (an email template's second locale) is answered as the ` +
            `canonical one by a bare-name read, and the next save of that member stores a second row ` +
            `beside it — while everything looks healthy. Fix the cause below (the column is added by the ` +
            `schema sync of "${OVERLAY_TABLE}") and restart; the backfill runs again on every boot.`,
            detail,
        );
        return { status: 'failed', backfilled, unparseable, detail };
    }
    if (backfilled > 0) {
        logger?.info?.(
            `[metadata-protocol] backfilled ${OVERLAY_MEMBER_COLUMN} on ${backfilled} "${OVERLAY_TABLE}" ` +
            `row(s) from the member their body declares.`,
        );
    }
    return { status: 'done', backfilled, unparseable };
}
