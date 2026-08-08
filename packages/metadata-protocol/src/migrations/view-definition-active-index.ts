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
 * ## Why a conflict is not expected (and is still reported)
 *
 * The partial index is strictly WEAKER than the unrestricted one it replaces —
 * its active rows are a subset of all rows — so any database that satisfied
 * the old constraint necessarily satisfies the new one. Existing "archived row
 * occupies the slot" duplicates cannot exist yet, precisely because the old
 * index rejected them. A conflict is therefore only reachable on a table whose
 * unique index was never in force (created out-of-band, or an earlier sync
 * that skipped it). That case is reported the way ADR-0120 D4 reports its own:
 * at `error`, naming the columns that are not enforced and the command that
 * lists the offending rows — and the boot continues.
 */

/** The one table this migration touches. */
export const VIEW_DEFINITION_TABLE = 'sys_view_definition';

/**
 * The index name — deliberately the SAME one `sys-view-definition.object.ts`
 * declares, so `syncDeclaredIndexes` treats the slot as filled forever after.
 */
export const VIEW_ACTIVE_INDEX_NAME = 'idx_sys_view_def_active';

/** Throwaway name used to prove the partial form is possible before dropping. */
export const VIEW_ACTIVE_PROBE_INDEX_NAME = 'idx_sys_view_def_active_probe';

/** The key the declaration promises, unchanged — only its ROW SCOPE changes. */
export const VIEW_ACTIVE_INDEX_COLUMNS = ['name', 'organization_id', 'owner'] as const;

/** Raw-SQL seam. Mirrors `ensureOverlayIndex`: `raw()` first, `execute()` second. */
export type IndexExec = (sql: string) => Promise<unknown>;

/**
 * Minimal logger surface, structurally compatible with `@objectstack/spec`'s
 * `Logger` (every method optional so a bare console or a test double fits).
 * Signatures mirror that contract exactly — notably `error(msg, Error, meta)`
 * versus `warn(msg, meta)` — so a host `Logger` is assignable as-is.
 */
export interface EnsureViewIndexLogger {
    info?(message: string, meta?: Record<string, any>): void;
    warn?(message: string, meta?: Record<string, any>): void;
    error?(message: string, error?: Error, meta?: Record<string, any>): void;
}

/**
 * Report a problem at the loudest level the host offers, bridging the two
 * different shapes (`error` takes an Error, `warn` takes metadata) so callers
 * never have to care which one exists.
 */
function logProblem(
    logger: EnsureViewIndexLogger | undefined,
    message: string,
    detail: string,
): void {
    if (logger?.error) {
        logger.error(message, new Error(detail));
        return;
    }
    logger?.warn?.(message, { detail });
}

export type EnsureViewIndexStatus =
    /** The partial UNIQUE index is in place under the declared name. */
    | 'created'
    /** The dialect rejects `CREATE INDEX … WHERE` (MySQL). Legacy index kept. */
    | 'unsupported'
    /** Existing rows violate the key. Legacy index kept, operator told. */
    | 'conflict'
    /** No raw-SQL-capable driver reachable (memory/mock hosts). No-op. */
    | 'no-driver'
    /** Anything else, best-effort. Legacy index kept. */
    | 'failed';

export interface EnsureViewIndexResult {
    status: EnsureViewIndexStatus;
    /** Driver error text, when there was one. */
    detail?: string;
}

/** `CREATE UNIQUE INDEX … WHERE state = 'active'` under the given name. */
export function buildActiveIndexSql(indexName: string): string {
    return (
        `CREATE UNIQUE INDEX IF NOT EXISTS ${indexName} ` +
        `ON ${VIEW_DEFINITION_TABLE} (${VIEW_ACTIVE_INDEX_COLUMNS.join(', ')}) ` +
        `WHERE state = 'active'`
    );
}

/**
 * Classify a failed `CREATE UNIQUE INDEX … WHERE`.
 *
 * Duplicate-row wording is checked BEFORE predicate wording: MySQL's duplicate
 * error mentions the key, and some drivers wrap both facts in one string, so
 * the more specific verdict has to win or a real data conflict would be
 * misreported as "this dialect has no partial indexes".
 */
export function classifyIndexFailure(message: string): EnsureViewIndexStatus {
    if (/unique constraint failed|duplicate entry|duplicate key value|violates unique/i.test(message)) {
        return 'conflict';
    }
    if (/partial|where clause|near "where"|near 'where'|syntax/i.test(message)) return 'unsupported';
    return 'failed';
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
 * Replace `sys_view_definition`'s unrestricted UNIQUE index with the
 * active-row-scoped partial UNIQUE the declaration has always described.
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

    const drop = async (indexName: string): Promise<void> => {
        try {
            await exec(`DROP INDEX IF EXISTS ${indexName}`);
        } catch {
            // Best-effort. MySQL has no `DROP INDEX IF EXISTS <name>` form at
            // all; on that path the probe below has already bailed out.
        }
    };

    // ── Step 1: prove the partial form is possible WITHOUT touching the
    // constraint that is currently protecting the table. ──────────────────
    await drop(VIEW_ACTIVE_PROBE_INDEX_NAME);
    try {
        await exec(buildActiveIndexSql(VIEW_ACTIVE_PROBE_INDEX_NAME));
    } catch (err: unknown) {
        const detail = err instanceof Error ? err.message : String(err);
        const status = classifyIndexFailure(detail);
        await drop(VIEW_ACTIVE_PROBE_INDEX_NAME);
        reportDegradation(status, detail, logger);
        return { status, detail };
    }
    await drop(VIEW_ACTIVE_PROBE_INDEX_NAME);

    // ── Step 2: the partial index is known-buildable here. Claim the
    // DECLARED name so `syncDeclaredIndexes` never re-imposes the full one. ─
    await drop(VIEW_ACTIVE_INDEX_NAME);
    try {
        await exec(buildActiveIndexSql(VIEW_ACTIVE_INDEX_NAME));
    } catch (err: unknown) {
        // Only reachable on a race with another process between the drop and
        // the create — the probe already cleared dialect and data. Say so
        // rather than leaving a table that now has no unique index at all.
        const detail = err instanceof Error ? err.message : String(err);
        logProblem(
            logger,
            `[metadata-protocol] could not create '${VIEW_ACTIVE_INDEX_NAME}' on ` +
            `"${VIEW_DEFINITION_TABLE}" after the probe succeeded — the table may currently have NO ` +
            `unique index on (${VIEW_ACTIVE_INDEX_COLUMNS.join(', ')}). Restart to retry (#5839).`,
            detail,
        );
        return { status: 'failed', detail };
    }
    return { status: 'created' };
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
    if (status === 'unsupported') {
        // Expected on MySQL/MariaDB — no partial indexes. Not an operator
        // error and not a regression: the unrestricted UNIQUE is still there,
        // which is exactly the behaviour every dialect had before #5839.
        logger?.info?.(
            `[metadata-protocol] this database has no partial indexes — '${VIEW_ACTIVE_INDEX_NAME}' on ` +
            `"${VIEW_DEFINITION_TABLE}" stays UNRESTRICTED over (${columns}). An archived view keeps ` +
            `occupying its name slot on this dialect (#5839).`,
        );
        return;
    }
    if (status === 'conflict') {
        logProblem(
            logger,
            `[metadata-protocol] cannot scope '${VIEW_ACTIVE_INDEX_NAME}' on "${VIEW_DEFINITION_TABLE}" to ` +
            `active rows — existing rows violate (${columns}) among state='active'. The previous index is ` +
            `left in place; run "os migrate plan" for the conflicting rows, then restart (ADR-0120 D4, #5839).`,
            detail,
        );
        return;
    }
    logger?.warn?.(
        `[metadata-protocol] could not scope '${VIEW_ACTIVE_INDEX_NAME}' on "${VIEW_DEFINITION_TABLE}" to ` +
        `active rows; the existing index is unchanged (#5839).`,
        { detail },
    );
}
