// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The `kernel:ready` index migrations' duplicate pre-flight, read-only (#8725).
 *
 * ## The gap this closes
 *
 * Three migrations in this directory tighten an existing UNIQUE index into a
 * NULL-safe (and sometimes row-scoped) form at `kernel:ready`:
 *
 * | migration | table | index(es) |
 * |---|---|---|
 * | `ensureMetadataOverlayIndexes` | `sys_metadata` | active + draft |
 * | `ensureViewDefinitionActiveIndex` | `sys_view_definition` | active |
 * | `ensureSysSettingIdentityIndex` | `sys_setting` | row identity |
 *
 * Each is a **tightening**, so rows the previous index admitted can block the
 * build. When that happens the migration refuses (ADR-0120 D4: the previous
 * index stays, no row is touched) and reports at `error` on the boot channel.
 *
 * That report was the ONLY channel. `os migrate plan` cannot carry it, and not
 * by omission — by construction, twice over:
 *
 *  - **after** the tightening runs, `isRuntimeManagedIndex` in
 *    `driver-sql`'s `schema-drift.ts` excludes the index, because
 *    `isSyncReproducibleIndex` is false for a partial index and for any key
 *    part that is a `COALESCE` over a NON-tenant column. That exclusion is
 *    correct — without it a boot would propose rebuilding away the guarantee it
 *    had just created;
 *  - **before** it runs, there is no drift to see either: each migration
 *    deliberately REUSES the declared index's name (see each module's "Why the
 *    index REUSES the declared name"), so the differ's name-matched slot reads
 *    as filled whichever physical form is actually there.
 *
 * Measured end to end before this module existed: a database carrying the same
 * duplicate damage twice — once under a DECLARED organization-unique index and
 * once under `sys_view_definition`'s runtime one — produced an `os migrate
 * plan` that named the declared one in full and said nothing whatsoever about
 * the runtime one. The control is what makes that evidence rather than a
 * reading: a fixture that simply failed to carry damage would have been silent
 * on both.
 *
 * ## Why the reporting path is `os migrate duplicates`
 *
 * Maintainer ruling, 2026-08-22 — a probe on `os migrate duplicates`, "which
 * already boots read-only and owns the 'inventory, never repair' contract",
 * surfaces the blocking rows before the operator restarts the server, **keeping
 * `os migrate plan`'s drift contract untouched**. `plan` describes work
 * `os migrate apply` will do; this work is applied by the next SERVING boot, by
 * a different applier, and a `plan` line an operator reads as "apply will
 * handle it" would be a promise `apply` cannot keep.
 *
 * ## What this module is, and what it deliberately is not
 *
 * It **describes and reads**. Every statement it issues is a `SELECT`; it
 * creates nothing, drops nothing and repairs nothing — the same "inventory,
 * never repair" contract the command it feeds already carries, and the reason
 * the whole run is safe to point at production.
 *
 * ⚠️ It also changes **nothing** about when a migration runs or what it does.
 * A pre-flight that armed, deferred or altered a tightening would be a
 * different decision with a different ceremony; this one only makes the
 * refusal's evidence readable one command earlier.
 *
 * Every probe statement comes from the migration that owns the index — never a
 * copy. That is the whole reason the descriptors below are assembled here
 * rather than in the CLI: a second spelling of a key is a second definition of
 * what "duplicate" means for that index, and the two would drift apart on the
 * first re-keying.
 */

import { isResultSet, normalizeRows } from './seed-tenancy-backfill.js';
import type { IndexExec } from './partial-index-probe.js';
import {
    OVERLAY_INDEX_NAMES,
    OVERLAY_TABLE,
    buildOverlayDuplicateProbeSql,
    overlayIndexKeyParts,
    type OverlayIndexState,
} from './overlay-index.js';
import {
    SYS_SETTING_IDENTITY_INDEX_NAME,
    SYS_SETTING_TABLE,
    buildSysSettingDuplicateProbeSql,
    buildSysSettingDuplicateProbeSqlMysql,
    buildSysSettingPresenceSql,
    sysSettingIdentityKeyParts,
} from './sys-setting-identity-index.js';
import {
    VIEW_ACTIVE_INDEX_NAME,
    VIEW_DEFINITION_TABLE,
    buildDuplicateProbeSql as buildViewActiveDuplicateProbeSql,
    viewActiveIndexKeyParts,
} from './view-definition-active-index.js';

/** The column every one of the three duplicate-listing queries counts into. */
const DUPLICATE_ROWS_COLUMN = 'duplicate_rows';

/**
 * One index a `kernel:ready` migration tightens, and how to ask a database
 * whether anything currently blocks it.
 *
 * Everything here is derived from the owning migration's own exported builders,
 * so this descriptor cannot describe a key the migration does not build.
 */
export interface RuntimeIndexProbe {
    /** The exported migration function that builds this index. */
    migration: string;
    table: string;
    /** The index name — the DECLARED one, which each migration reuses on purpose. */
    index: string;
    /** The index's key parts, in key order, in the NULL-safe spelling it is built with. */
    keyParts: string[];
    /** The row subset the index covers, or `null` when it covers every row. */
    rowScope: string | null;
    /** Cheapest statement that answers "is this table here?" without reading a row. */
    presenceSql: string;
    /** The migration's own `GROUP BY … HAVING COUNT(*) > 1` listing. */
    duplicateSql: string;
}

/**
 * What a pre-flight found for one index.
 *
 * `status` separates the four outcomes that must never read the same:
 *
 *  - `blocked` — rows collide under the key. The migration will refuse on the
 *    next serving boot and leave the previous index in place.
 *  - `clear` — the probe ran and nothing collides.
 *  - `table-absent` — the table is not on this install. A no-op, never a
 *    finding: `sys_setting` is registered by the OPTIONAL `service-settings`,
 *    so an ordinary kernel reaches `kernel:ready` with no such table and the
 *    migration itself treats that as a silent no-op.
 *  - `unreadable` — the probe could not run, and `detail` says why. Reported
 *    because "found nothing" and "never looked" must not read the same — the
 *    rule `os migrate duplicates` already applies to its own `skipped` list.
 */
export interface RuntimeIndexPreflight extends RuntimeIndexProbe {
    status: 'blocked' | 'clear' | 'table-absent' | 'unreadable';
    /** One entry per colliding key group; empty unless `status` is `blocked`. */
    groups: RuntimeIndexDuplicateGroup[];
    /** The driver's own message, when the probe could not run. */
    detail?: string;
}

/** One key value held by more rows than the tightened index would admit. */
export interface RuntimeIndexDuplicateGroup {
    /**
     * The key, exactly as the migration's query projects it: a bare column
     * name, or `<column>_key` for a column whose NULLs the index folds into a
     * sentinel bucket. Neither sentinel can occur in real data, so
     * `organization_id_key = '__global__'` reads as "organization_id IS NULL".
     */
    key: Record<string, string | null>;
    /** How many rows hold it. */
    rowCount: number;
}

/** `SELECT 1 FROM <table> WHERE 1 = 0` — reads no row, writes nothing. */
function buildPresenceSql(table: string): string {
    return `SELECT 1 FROM ${table} WHERE 1 = 0`;
}

/** MySQL and MariaDB, the one dialect that needs a differently-spelled probe. */
function isMysqlClient(client?: string): boolean {
    const c = String(client ?? '').toLowerCase();
    return c === 'mysql' || c === 'mysql2';
}

/**
 * Every index the three `kernel:ready` migrations tighten — FOUR, from three
 * migrations, because `ensureMetadataOverlayIndexes` builds one index per
 * overlay state and either can be blocked independently.
 *
 * ## Why one arm takes a dialect and three do not
 *
 * `sys_setting`'s listing query is the only one whose bare spelling is not
 * merely unidiomatic on MySQL but a parse error: `key` is a RESERVED word
 * there, measured as `ERROR 1064` on MySQL 8.0.46 (#9434), which is why the
 * migration already ships a MySQL-spelled variant. The other three queries name
 * no MySQL-reserved identifier, so the platform's own spelling — the one the
 * migration prints in its boot report — runs on all three dialects, and
 * compiling a second variant of them would buy nothing and add a second
 * spelling of the same key.
 */
export function runtimeIndexProbes(opts: { client?: string } = {}): RuntimeIndexProbe[] {
    const overlay = (state: OverlayIndexState): RuntimeIndexProbe => ({
        migration: 'ensureMetadataOverlayIndexes',
        table: OVERLAY_TABLE,
        index: OVERLAY_INDEX_NAMES[state],
        keyParts: overlayIndexKeyParts(),
        rowScope: `state = '${state}'`,
        presenceSql: buildPresenceSql(OVERLAY_TABLE),
        duplicateSql: buildOverlayDuplicateProbeSql(state),
    });
    return [
        overlay('active'),
        overlay('draft'),
        {
            migration: 'ensureViewDefinitionActiveIndex',
            table: VIEW_DEFINITION_TABLE,
            index: VIEW_ACTIVE_INDEX_NAME,
            keyParts: viewActiveIndexKeyParts(),
            rowScope: "state = 'active'",
            presenceSql: buildPresenceSql(VIEW_DEFINITION_TABLE),
            duplicateSql: buildViewActiveDuplicateProbeSql(),
        },
        {
            migration: 'ensureSysSettingIdentityIndex',
            table: SYS_SETTING_TABLE,
            index: SYS_SETTING_IDENTITY_INDEX_NAME,
            keyParts: sysSettingIdentityKeyParts(),
            // No `WHERE`: `sys_setting` has no lifecycle column and the
            // declaration means every row.
            rowScope: null,
            // The migration's OWN presence statement, not a local rebuild of the
            // same shape — it is the question `ensureSysSettingIdentityIndex`
            // asks before it does anything, and asking a different one here
            // could classify a table it can see as absent, or the reverse.
            presenceSql: buildSysSettingPresenceSql(),
            duplicateSql: isMysqlClient(opts.client)
                ? buildSysSettingDuplicateProbeSqlMysql()
                : buildSysSettingDuplicateProbeSql(),
        },
    ];
}

/**
 * Sort key for one group, so an archived report diffs against the next one.
 *
 * `JSON.stringify` over the entry pairs rather than a joined string with a
 * separator literal: the key values are user data, and any separator character
 * chosen here could occur inside one of them and reorder two groups that differ.
 */
function groupSortKey(group: RuntimeIndexDuplicateGroup): string {
    return JSON.stringify(Object.entries(group.key));
}

/**
 * The one statement every working SQL seam answers, on every dialect this
 * platform supports — no table, no row, nothing written.
 *
 * It separates the two failures the per-probe presence question below cannot
 * tell apart. Reading "the presence SELECT did not answer" as "the table is not
 * here" is right when the seam works, and catastrophic when it does not: a seam
 * that accepts every statement and answers none of them would report all four
 * tightenings as `table-absent` — a clean bill of health from a probe that never
 * ran, which is the #10677 defect `os migrate duplicates` already closed on its
 * own scan. So liveness is established once, first, against a statement whose
 * failure cannot mean "absent".
 */
const SEAM_LIVENESS_SQL = 'SELECT 1 AS os_preflight_probe';

/**
 * The #10677 discriminator, applied here: a seam that ANSWERS returns a result
 * set, and a seam that cannot answer returns no result set at all — it need not
 * throw, and the one measured in this repo does not (`InMemoryDriver.execute()`
 * logs and returns `null`). {@link isResultSet} is the sibling migration's own
 * test for that, imported rather than copied: this is its third caller inside
 * this package and a second spelling of "did the driver answer" is exactly what
 * lets one of them drift into reading `null` as zero rows.
 */
const SEAM_NO_ANSWER_DETAIL =
    'the raw-SQL seam returned no result set — a seam that cannot answer is not a seam that answered "no rows"';

/**
 * Run one probe.
 *
 * The presence question is asked FIRST and its refusal is read as absence — the
 * same width `ensureSysSettingIdentityIndex` uses, and for the same reason: on a
 * host where the framework cannot even `SELECT` from the table it certainly
 * cannot rebuild that table's index, and one unactionable finding per run is how
 * the actionable ones stop being read. The seam itself has already been proved
 * live by {@link SEAM_LIVENESS_SQL}, so "absent" here really is about the table.
 */
async function runProbe(exec: IndexExec, probe: RuntimeIndexProbe): Promise<RuntimeIndexPreflight> {
    const unreadable = (detail: string): RuntimeIndexPreflight => ({
        ...probe,
        status: 'unreadable',
        groups: [],
        detail,
    });

    try {
        // A seam already proved live that now answers nothing for THIS statement
        // is a seam that stopped answering, not a table that is not there.
        if (!isResultSet(await exec(probe.presenceSql))) return unreadable(SEAM_NO_ANSWER_DETAIL);
    } catch {
        return { ...probe, status: 'table-absent', groups: [] };
    }

    let rows: Array<Record<string, unknown>>;
    try {
        const result = await exec(probe.duplicateSql);
        if (!isResultSet(result)) return unreadable(SEAM_NO_ANSWER_DETAIL);
        rows = normalizeRows(result);
    } catch (error) {
        return unreadable(error instanceof Error ? error.message : String(error));
    }

    const groups: RuntimeIndexDuplicateGroup[] = rows.map((row) => {
        const key: Record<string, string | null> = {};
        for (const [column, value] of Object.entries(row)) {
            if (column === DUPLICATE_ROWS_COLUMN) continue;
            key[column] = value == null ? null : String(value);
        }
        const count = Number(row[DUPLICATE_ROWS_COLUMN]);
        return { key, rowCount: Number.isFinite(count) ? count : 0 };
    });
    groups.sort((a, b) => groupSortKey(a).localeCompare(groupSortKey(b)));

    return { ...probe, status: groups.length > 0 ? 'blocked' : 'clear', groups };
}

/**
 * Pre-flight every `kernel:ready` index tightening against a live database.
 *
 * Read-only from end to end, and sequential on purpose: this runs inside a
 * command an operator may point at production, and four `SELECT`s in a row cost
 * nothing worth parallelising a shared seam for.
 *
 * A probe that fails never aborts the run — an inventory that stopped at the
 * first unreadable table would be one the operator cannot trust to be complete,
 * which is the same rule `collectDuplicateIdentifierReport` applies to its own
 * targets.
 */
export async function collectRuntimeIndexPreflight(
    exec: IndexExec,
    opts: { client?: string } = {},
): Promise<RuntimeIndexPreflight[]> {
    const probes = runtimeIndexProbes(opts);

    let seamFailure: string | undefined;
    try {
        if (!isResultSet(await exec(SEAM_LIVENESS_SQL))) seamFailure = SEAM_NO_ANSWER_DETAIL;
    } catch (error) {
        seamFailure = error instanceof Error ? error.message : String(error);
    }
    if (seamFailure !== undefined) {
        return probes.map((probe) => ({
            ...probe,
            status: 'unreadable' as const,
            groups: [],
            detail: seamFailure,
        }));
    }

    const results: RuntimeIndexPreflight[] = [];
    for (const probe of probes) {
        results.push(await runProbe(exec, probe));
    }
    return results;
}
