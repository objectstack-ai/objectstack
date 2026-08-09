// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `sys_view_definition` — active-row uniqueness, delivered at runtime (#5839).
 *
 * ## What was broken
 *
 * `metadata-core`'s `sys-view-definition.object.ts` declares
 *
 * ```ts
 * { name: 'idx_sys_view_def_active', fields: ['name', 'organization_id', 'owner'], unique: true }
 * ```
 *
 * and its comment has always promised uniqueness **among ACTIVE rows**. It
 * never delivered that. The declaration carried `partial: "state = 'active'"`
 * until #5248 / #4943 retired the key, but no driver ever emitted the
 * predicate — `SqlDriver.syncDeclaredIndexes` builds indexes through knex's
 * `table.unique(fields, { indexName })`, which cannot express a `WHERE`. So
 * the index that has always been created is the UNRESTRICTED one, and an
 * archived view keeps occupying its `(name, organization_id, owner)` slot:
 * archive "my pipeline", try to create "my pipeline" again, and the insert is
 * rejected by a constraint about a row the user already threw away.
 *
 * Measured on real SQLite before this module existed:
 *
 * ```text
 * insert active personal view  : OK
 * archive it; re-create same   : REJECTED: UNIQUE constraint failed:
 *     sys_view_definition.name, sys_view_definition.organization_id, sys_view_definition.owner
 * ```
 *
 * `sys_metadata` never had this problem because `metadata-protocol`'s
 * `ensureOverlayIndex` issues the partial form in raw SQL at runtime. This
 * module is the same paradigm for the one other table that declared the same
 * intent and had no runtime migration behind it (maintainer ruling
 * 2026-08-06: view-name slots ARE recyclable).
 *
 * ## Why the index REUSES the declared name
 *
 * `syncDeclaredIndexes` skips by name (`if (existing.has(name)) continue`).
 * Creating the partial index under `idx_sys_view_def_active` — the same name
 * the object declares — is therefore what makes the fix durable: every later
 * boot sees the name occupied and never re-imposes the unrestricted UNIQUE.
 * A differently-named index would be silently undone on the next boot, and
 * dropping the declaration instead would leave drivers that never run this
 * migration with no uniqueness at all (the declaration is the fallback shape).
 *
 * ## Why it PROBES before dropping anything
 *
 * `ensureOverlayIndex` drops the legacy index and then creates the partial
 * one. If that create fails — no partial-index support (MySQL), or rows that
 * violate the new key — the table is left with NO unique constraint at all,
 * silently. This module inverts the order: it first builds the partial index
 * under a throwaway probe name, and only once that has demonstrably succeeded
 * does it drop the legacy index and rebuild it under the declared name. On any
 * dialect or dataset that cannot take the partial form, the existing
 * unrestricted UNIQUE is left exactly as it was — degraded to today's
 * behaviour, never below it. The cost is building a small index twice on the
 * boot that migrates; the benefit is that the failure mode cannot destroy a
 * live constraint.
 *
 * ## The KEY is NULL-safe too (#6417, maintainer ruling 2026-08-08)
 *
 * #5839 changed only the ROW SCOPE and deliberately left the key spelling
 * alone. That left the other half of the same index broken, and #6415 pinned
 * the gap honestly rather than closing it: SQL UNIQUE treats NULLs as
 * DISTINCT, `owner` is NULL for SHARED views and `organization_id` is NULL for
 * environment-level ones, so the index constrained PERSONAL views only.
 * Measured on real SQLite over the driver's own DDL, before this half landed:
 *
 * ```text
 * two ACTIVE personal views, same (name, org, owner) : REJECTED
 * two ACTIVE shared views   (owner NULL)             : OK   ← unconstrained
 * two ACTIVE env-level views(organization_id NULL)   : OK   ← unconstrained
 * ```
 *
 * The maintainer ruling forbids that: two same-name active shared (or
 * environment-level) views may not coexist, because `name` is declared as the
 * globally unique qualified view id (`<object>.<viewKey>`) and every read path
 * that locates a view by name otherwise has no defined answer.
 *
 * The mechanism copies the two in-repo precedents rather than inventing a
 * third — `COALESCE` the nullable key columns so their NULLs fold into ONE
 * bucket that is unique among itself:
 *
 * - `organization_id` is the tenant column, so it takes **ADR-0120 D3**'s
 *   exact form, `COALESCE(organization_id, '__global__')` — the same sentinel
 *   `SqlDriver`'s `GLOBAL_TENANT` / `organizationKeyPartSql` materialize, so a
 *   violation message reads "the platform bucket collided" rather than as
 *   corrupt data.
 * - `owner` is not a tenant column; it plays exactly `package_id`'s role in
 *   `ensureOverlayIndex` (a nullable discriminator whose NULL means "the one
 *   shared bucket"), so it takes THAT precedent's form,
 *   `COALESCE(owner, '')` — whose comment states this same NULL-distinct
 *   reason.
 *
 * Neither sentinel can collide with real data: an organization id may never
 * equal `'__global__'` (reserved at the organization-creation seam, ADR-0120
 * D3) and an owner is a user id, never the empty string. Storage is untouched
 * — only the INDEX folds NULL into a bucket, exactly as D3 specifies.
 *
 * ## Why a conflict IS expected now (and how it is reported)
 *
 * Under #5839 alone a conflict was near-unreachable: the partial index was
 * strictly WEAKER than the unrestricted one it replaced — its active rows are
 * a subset of all rows — so any database that satisfied the old constraint
 * necessarily satisfied the new one.
 *
 * The NULL-safe key inverts that. It is a **tightening**: rows the old index
 * admitted (two active shared views under one name) violate the new one, and
 * such rows exist in the wild today precisely because nothing rejected them.
 * So the probe-first order above stops being belt-and-braces and becomes the
 * load-bearing part — and the conflict branch is a live path, not a corner.
 * It is handled the way ADR-0120 D4 requires: the PREVIOUS index stays in
 * place (never a table with no unique index at all), the report names the key
 * that is not enforced, ships the exact query that lists the offending rows,
 * points at `os migrate plan`, and the boot continues.
 */

import {
    logProblem,
    probeThenReplaceIndex,
    type IndexExec,
    type IndexMigrationLogger,
    type PartialIndexStatus,
} from './partial-index-probe.js';

/** The one table this migration touches. */
export const VIEW_DEFINITION_TABLE = 'sys_view_definition';

/**
 * The index name — deliberately the SAME one `sys-view-definition.object.ts`
 * declares, so `syncDeclaredIndexes` treats the slot as filled forever after.
 */
export const VIEW_ACTIVE_INDEX_NAME = 'idx_sys_view_def_active';

/** Throwaway name used to prove the partial form is possible before dropping. */
export const VIEW_ACTIVE_PROBE_INDEX_NAME = 'idx_sys_view_def_active_probe';

/**
 * The key COLUMNS the declaration names, unchanged. What #6417 changes is how
 * two of them are SPELLED in the index — see {@link VIEW_ACTIVE_NULL_SENTINELS}.
 */
export const VIEW_ACTIVE_INDEX_COLUMNS = ['name', 'organization_id', 'owner'] as const;

/**
 * The nullable key columns and the sentinel each one's NULL folds to (#6417).
 *
 * A column listed here is materialized as `COALESCE(<column>, '<sentinel>')`
 * so its NULL rows form ONE bucket that is unique among itself, instead of
 * being mutually DISTINCT and therefore unconstrained. Both spellings are
 * copied from an existing in-repo precedent — neither is invented here:
 *
 * - `organization_id` → `'__global__'`, ADR-0120 D3's exact form for a tenant
 *   column (`SqlDriver`'s `GLOBAL_TENANT` / `organizationKeyPartSql`). NOT
 *   imported from `@objectstack/driver-sql`: this package must not depend on a
 *   driver. Both literals are therefore pinned as literals by the sibling
 *   test, so a silent edit here cannot re-partition every existing index.
 * - `owner` → `''`, the `ensureOverlayIndex` precedent for a NON-tenant
 *   nullable discriminator (`COALESCE(package_id, '')`), whose comment states
 *   this same NULL-distinct reason.
 *
 * `name` is `required: true` and takes no sentinel.
 *
 * ⚠️ Storage is NOT touched: the row keeps its NULL, only the index folds it.
 * `WHERE owner = ''` matches nothing, by design (ADR-0120 D3's invariant).
 */
export const VIEW_ACTIVE_NULL_SENTINELS: Readonly<Record<string, string>> = {
    organization_id: '__global__',
    owner: '',
};

/**
 * The index's key parts, in key order: a bare column, or its NULL-safe
 * `COALESCE` form when {@link VIEW_ACTIVE_NULL_SENTINELS} names one.
 *
 * One builder so the CREATE, the duplicate-listing query the conflict report
 * ships, and the degradation messages can never describe different keys.
 */
export function viewActiveIndexKeyParts(): string[] {
    return VIEW_ACTIVE_INDEX_COLUMNS.map((column) => {
        const sentinel = VIEW_ACTIVE_NULL_SENTINELS[column];
        return sentinel === undefined ? column : `COALESCE(${column}, '${sentinel}')`;
    });
}

/**
 * The raw-SQL seam, the logger surface, the status vocabulary and the failure
 * classifier all live in `partial-index-probe.ts` since #6418, when
 * `ensureOverlayIndex` adopted this module's probe-first order and the two
 * migrations stopped being able to afford separate copies of them. Re-exported
 * under this module's original names so its callers and `index.ts` see no
 * change.
 */
export type { IndexExec } from './partial-index-probe.js';
export { classifyIndexFailure } from './partial-index-probe.js';

/** @see IndexMigrationLogger */
export type EnsureViewIndexLogger = IndexMigrationLogger;

/** @see PartialIndexStatus */
export type EnsureViewIndexStatus = PartialIndexStatus;

export interface EnsureViewIndexResult {
    status: EnsureViewIndexStatus;
    /** Driver error text, when there was one. */
    detail?: string;
}

/**
 * `CREATE UNIQUE INDEX … WHERE state = 'active'` under the given name, over the
 * NULL-safe key parts (#6417).
 */
export function buildActiveIndexSql(indexName: string): string {
    return (
        `CREATE UNIQUE INDEX IF NOT EXISTS ${indexName} ` +
        `ON ${VIEW_DEFINITION_TABLE} (${viewActiveIndexKeyParts().join(', ')}) ` +
        `WHERE state = 'active'`
    );
}

/**
 * The query that lists the rows blocking the tightening — ADR-0120 D4's
 * "name the offending rows", shipped inside the conflict report so an operator
 * has it without waiting for `os migrate plan`.
 *
 * It GROUPs by exactly the index's own key parts, so what it reports and what
 * the index rejects cannot diverge — the projection and the `GROUP BY` are
 * built from the SAME array below, so they cannot drift apart either.
 *
 * ⚠️ Each folded column is projected through its OWN `COALESCE` (aliased
 * `<column>_key`), never bare. The three constructs are ANSI, but a query that
 * projects a bare column while grouping by that column only INSIDE an
 * expression is not: PostgreSQL requires every non-aggregated projection to
 * appear verbatim in `GROUP BY` and rejects the bare form with
 * `column "sys_view_definition.organization_id" must appear in the GROUP BY
 * clause`. SQLite accepts it, which is why this shipped broken (#6772) — and
 * PostgreSQL is one of exactly TWO dialects that can build the index this
 * query explains, so it must be legal on both, not on the lenient one.
 *
 * Folding costs the operator nothing here: neither sentinel can occur in real
 * data, so `organization_id_key = '__global__'` reads as "organization_id IS
 * NULL" and `owner_key = ''` as "owner IS NULL" (see
 * {@link VIEW_ACTIVE_NULL_SENTINELS}).
 *
 * Same shape as `overlay-index.ts`'s `buildOverlayDuplicateProbeSql()`, the
 * sibling migration's query for the same report (#6770).
 */
export function buildDuplicateProbeSql(): string {
    const keyParts = viewActiveIndexKeyParts();
    const projected = VIEW_ACTIVE_INDEX_COLUMNS.map((column, i) => {
        const keyPart = keyParts[i]!;
        return keyPart === column ? column : `${keyPart} AS ${column}_key`;
    });
    return (
        `SELECT ${projected.join(', ')}, COUNT(*) AS duplicate_rows ` +
        `FROM ${VIEW_DEFINITION_TABLE} WHERE state = 'active' ` +
        `GROUP BY ${keyParts.join(', ')} HAVING COUNT(*) > 1`
    );
}

/**
 * Resolve a raw-SQL seam for `sys_view_definition`.
 *
 * Asks the engine which driver OWNS this table first
 * (`getDriverForObject`) rather than grabbing the engine-wide default: on a
 * multi-datasource kernel the platform objects can sit on their own datasource,
 * and issuing this DDL to the wrong connection would either fail or tighten a
 * table in the wrong database.
 *
 * ⚠️ Deliberately does NOT use `ensureOverlayIndex`'s bare `getDriver?.()`.
 * `ObjectQL.getDriver(objectName)` is REQUIRED to take an object name and
 * THROWS `No driver available for object 'undefined'` without one; the
 * paradigm gets away with it only because its whole body sits inside a
 * swallow-everything try/catch. Every probe here is individually guarded so
 * this function returns `undefined` instead of throwing into a boot hook.
 *
 * Returns `undefined` on hosts with no raw-SQL-capable driver — memory
 * engines and test doubles, where there is no DDL to issue and nothing to
 * warn about.
 */
export function resolveIndexExec(engine: unknown): IndexExec | undefined {
    const engineAny = engine as any;
    const attempt = (fn: () => unknown): any => {
        try {
            return fn();
        } catch {
            return undefined;
        }
    };
    const canRunSql = (d: any): boolean =>
        !!d && (typeof d.raw === 'function' || typeof d.execute === 'function');

    let driver: any = attempt(() => engineAny?.getDriverForObject?.(VIEW_DEFINITION_TABLE));
    if (!canRunSql(driver)) driver = attempt(() => engineAny?.driver);
    if (!canRunSql(driver)) driver = attempt(() => engineAny?.getDriver?.(VIEW_DEFINITION_TABLE));
    if (!canRunSql(driver) && engineAny?.drivers instanceof Map) {
        driver = undefined;
        for (const candidate of engineAny.drivers.values()) {
            if (canRunSql(candidate)) {
                driver = candidate;
                break;
            }
        }
    }
    if (!canRunSql(driver)) return undefined;
    if (typeof driver.raw === 'function') return (sql: string) => driver.raw(sql);
    return (sql: string) => driver.execute(sql);
}

/**
 * Replace `sys_view_definition`'s unrestricted, NULL-distinct UNIQUE index with
 * the active-row-scoped (#5839) NULL-safe (#6417) partial UNIQUE the
 * declaration has always described.
 *
 * Idempotent: re-running rebuilds the same definition, so the resulting schema
 * is byte-identical. Best-effort by design — a boot must never fail because an
 * index could not be tightened, which is why every branch returns a status
 * instead of throwing.
 */
export async function ensureViewDefinitionActiveIndex(
    exec: IndexExec | undefined,
    logger?: EnsureViewIndexLogger,
): Promise<EnsureViewIndexResult> {
    if (!exec) return { status: 'no-driver' };

    // The probe-first order — prove the partial form is possible under a
    // throwaway name, and only THEN drop the declared name and rebuild it —
    // lives in `partial-index-probe.ts` since #6418, when `ensureOverlayIndex`
    // adopted it. Claiming the DECLARED name is what stops `syncDeclaredIndexes`
    // (which skips by name) from re-imposing the unrestricted form next boot.
    const outcome = await probeThenReplaceIndex(exec, {
        indexName: VIEW_ACTIVE_INDEX_NAME,
        probeIndexName: VIEW_ACTIVE_PROBE_INDEX_NAME,
        buildSql: buildActiveIndexSql,
    });

    if (outcome.status === 'created') return { status: 'created' };

    const detail = outcome.detail ?? '';
    if (outcome.failedAt === 'replace') {
        // Only reachable on a race with another process between the drop and
        // the create — the probe already cleared dialect and data. Say so
        // rather than leaving a table that now has no unique index at all.
        logProblem(
            logger,
            `[metadata-protocol] could not create '${VIEW_ACTIVE_INDEX_NAME}' on ` +
            `"${VIEW_DEFINITION_TABLE}" after the probe succeeded — the table may currently have NO ` +
            `unique index on (${viewActiveIndexKeyParts().join(', ')}). Restart to retry (#5839).`,
            detail,
        );
        return { status: 'failed', detail };
    }

    reportDegradation(outcome.status, detail, logger);
    return { status: outcome.status, detail };
}

/**
 * Say what is NOT enforced and what fixes it — ADR-0120 D4's wording contract,
 * which `SqlDriver.createNullSafeUniqueIndex` already follows for the same
 * class of event. Never fails the boot: from the outside everything else looks
 * normal, so silence here is what makes the gap expensive.
 */
function reportDegradation(
    status: EnsureViewIndexStatus,
    detail: string,
    logger?: EnsureViewIndexLogger,
): void {
    const columns = VIEW_ACTIVE_INDEX_COLUMNS.join(', ');
    const keyParts = viewActiveIndexKeyParts().join(', ');
    if (status === 'unsupported') {
        // Expected on MySQL/MariaDB, which has no partial indexes at all (and,
        // before 8.0.13, no functional key parts either). The outcome is
        // exactly ADR-0120 D3's degradation — the BARE composite stays in
        // force — reached by keeping the declared index rather than by
        // rebuilding it, which is also `createNullSafeUniqueIndex`'s handling.
        //
        // ⚠️ Level RAISED from `info` to `error` by #6417, and the reason is
        // that the CONSEQUENCE of the same missing DDL changed in kind, not
        // that #6415's judgment was wrong. Under #5839 alone what MySQL lost
        // was slot RECYCLING: a functional degradation, visibly smaller, the
        // next user to re-create an archived view finds out immediately — the
        // `warn`/`info` arm of AGENTS.md's rule, exactly as #6415 argued.
        // What it loses now is an INTEGRITY guarantee this platform states it
        // enforces: two same-name active shared views can coexist, nothing
        // looks broken, and the duplicate surfaces releases later to someone
        // who cannot connect it to a boot line. That is the `error` arm's own
        // description ("DDL that was supposed to run did not"), the #4420
        // class the rule exists for, and the level
        // `SqlDriver.createNullSafeUniqueIndex` uses for the same event.
        //
        // As an `error` owes: the consequence concretely, and the fix.
        logProblem(
            logger,
            `[metadata-protocol] this database cannot build the active-row NULL-safe index — ` +
            `'${VIEW_ACTIVE_INDEX_NAME}' on "${VIEW_DEFINITION_TABLE}" stays UNRESTRICTED and NULL-distinct ` +
            `over (${columns}), the bare-composite degradation of ADR-0120 D3. The system keeps looking ` +
            `healthy while two consequences hold on this dialect: an archived view keeps occupying its ` +
            `name slot (#5839), and two same-name ACTIVE shared views (owner NULL) or environment-level ` +
            `views (organization_id NULL) can still coexist even though the platform states they cannot ` +
            `(#6417). MySQL/MariaDB has no partial indexes, so there is no in-dialect fix: run this ` +
            `platform on SQLite/PostgreSQL for the guarantee, and meanwhile watch for duplicates with: ` +
            `${buildDuplicateProbeSql()}`,
            detail,
        );
        return;
    }
    if (status === 'conflict') {
        // A LIVE path since #6417: the NULL-safe key is a tightening, so rows
        // the previous index admitted — two active shared views under one name
        // — now block the build. ADR-0120 D4's disposition, in full: keep the
        // previous index (never an unconstrained table), name the key that is
        // not enforced, hand over the exact query that lists the offending
        // rows, point at `os migrate plan`, and let the boot continue.
        logProblem(
            logger,
            `[metadata-protocol] cannot tighten '${VIEW_ACTIVE_INDEX_NAME}' on "${VIEW_DEFINITION_TABLE}" — ` +
            `existing rows violate (${keyParts}) among state='active'. The previous index is left in ` +
            `place, so (${columns}) is enforced only as far as it was before; the NULL-safe key is NOT ` +
            `enforced until the duplicates are resolved. List them with: ${buildDuplicateProbeSql()} — or ` +
            `run "os migrate plan" — then restart (ADR-0120 D4, #6417).`,
            detail,
        );
        return;
    }
    // The catch-all ('failed'), raised alongside the dialect arm above and for
    // the same reason. Leaving it at `warn` would report the case we UNDERSTAND
    // (a named dialect limitation) more loudly than the one we do not, while
    // the consequence is identical: the DDL did not run, the NULL-safe key is
    // not in force, and nothing else looks wrong.
    logProblem(
        logger,
        `[metadata-protocol] could not rebuild '${VIEW_ACTIVE_INDEX_NAME}' on "${VIEW_DEFINITION_TABLE}" as ` +
        `the active-row NULL-safe index; the existing index is unchanged, so two same-name ACTIVE shared ` +
        `views can still coexist while everything else looks healthy. Fix the cause below and restart ` +
        `(#5839 / #6417).`,
        detail,
    );
}
