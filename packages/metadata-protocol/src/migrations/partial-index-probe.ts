// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Probe-first partial-index replacement — the one description of an order two
 * runtime migrations in this directory both need (#6418).
 *
 * ## The order, and why it is the whole point
 *
 * Both migrations here replace an index that is ALREADY protecting a table
 * with a tighter one (a `WHERE`-scoped UNIQUE, NULL-safe key parts, or both).
 * The obvious sequence — `DROP` the old, `CREATE` the new — has a failure mode
 * with no recovery: the drop always succeeds, and if the create then fails
 * (dialect cannot express the form, or existing rows violate the tighter key)
 * the table is left with NO index under that name at all. Nothing restores it,
 * and on the dialects that DO support the form the loss is silent.
 *
 * That was `ensureOverlayIndex`'s shape until #6418, and it is the exact defect
 * `view-definition-active-index.ts` was written to avoid (see its "Why it
 * PROBES before dropping anything"). The order this module implements:
 *
 * 1. build the tighter index under a THROWAWAY probe name — nothing that is
 *    currently enforcing is touched, so a failure here costs nothing;
 * 2. drop the probe;
 * 3. only now drop the real name and rebuild it with the tighter definition.
 *
 * The cost is building a small index twice on the boot that migrates. The
 * benefit is that no failure mode can destroy a live constraint: on any dialect
 * or dataset that cannot take the tighter form, what was there stays there —
 * degraded to yesterday's behaviour, never below it.
 *
 * ## What this module deliberately does NOT do
 *
 * It does not report. Each caller owns its own wording, because what is lost
 * when a tightening fails differs per table (ADR-0120 D4 requires naming the
 * key that is not enforced and the consequence of it not being enforced), and
 * one generic sentence would be true of neither table. This module hands back
 * a classified status plus the driver's own text and stays out of the way.
 */

import { isUniqueViolationError } from '@objectstack/types';

/** Raw-SQL seam. Mirrors `ensureOverlayIndex`: `raw()` first, `execute()` second. */
export type IndexExec = (sql: string) => Promise<unknown>;

/**
 * Minimal logger surface, structurally compatible with `@objectstack/spec`'s
 * `Logger` (every method optional so a bare console or a test double fits).
 * Signatures mirror that contract exactly — notably `error(msg, Error, meta)`
 * versus `warn(msg, meta)` — so a host `Logger` is assignable as-is.
 */
export interface IndexMigrationLogger {
    info?(message: string, meta?: Record<string, any>): void;
    warn?(message: string, meta?: Record<string, any>): void;
    error?(message: string, error?: Error, meta?: Record<string, any>): void;
}

/**
 * Report a problem at the loudest level the host offers, bridging the two
 * different shapes (`error` takes an Error, `warn` takes metadata) so callers
 * never have to care which one exists.
 */
export function logProblem(
    logger: IndexMigrationLogger | undefined,
    message: string,
    detail: string,
): void {
    if (logger?.error) {
        logger.error(message, new Error(detail));
        return;
    }
    logger?.warn?.(message, { detail });
}

export type PartialIndexStatus =
    /** The tighter index is in place under its real name. */
    | 'created'
    /**
     * The dialect rejects the form — `CREATE INDEX … WHERE` (no dialect of
     * MySQL has partial indexes) or `COALESCE` functional key parts
     * (MySQL < 8.0.13 / MariaDB). Previous index kept.
     */
    | 'unsupported'
    /** Existing rows violate the tighter key. Previous index kept, operator told. */
    | 'conflict'
    /** No raw-SQL-capable driver reachable (memory/mock hosts). No-op. */
    | 'no-driver'
    /** Anything else, best-effort. Previous index kept. */
    | 'failed';

/**
 * How far to follow an `error.cause` chain — deliberately the same bound as
 * `isUniqueViolationError`'s `MAX_CAUSE_DEPTH` in `@objectstack/types` (#6848).
 *
 * Counted the same way too: the thrown value itself is depth 0, so this admits
 * the outer error plus four wrapper levels below it. The two arms of {@link
 * classifyIndexFailure} reading the SAME depth is the whole point — see that
 * function's "Why both arms walk" note.
 *
 * It is also the only cycle guard, again matching the predicate: a `cause`
 * chain that loops back on itself is bounded rather than detected, because a
 * bound terminates a cycle just as well as a visited-set does and the predicate
 * this mirrors has no visited-set to mirror.
 */
const MAX_CAUSE_DEPTH = 4;

/**
 * Every message channel on one thrown value and its `cause` chain, in order.
 *
 * Deliberately a local walk. `@objectstack/types` owns the *conflict* question
 * and exports a predicate for it, but it exposes no reusable message-collecting
 * helper — its own chain walkers (`matchesUniqueViolation`,
 * `findUniqueViolationColumn`) are private and each answers its own question
 * rather than handing back text. Hoisting a shared collector there would widen
 * that package's contract for a single consumer, so this stays here and stays
 * pinned to the bound above.
 */
function collectIndexFailureText(error: unknown, depth: number, into: string[]): void {
    if (error === null || error === undefined || depth > MAX_CAUSE_DEPTH) return;
    if (typeof error === 'string') {
        into.push(error);
        return;
    }
    if (typeof error !== 'object') {
        into.push(String(error));
        return;
    }
    const err = error as { message?: unknown; cause?: unknown };
    if (typeof err.message === 'string') into.push(err.message);
    collectIndexFailureText(err.cause, depth + 1, into);
}

/**
 * The text the DIALECT arm judges, from a thrown value of any shape.
 *
 * `message` first, because that is the channel a driver writes its refusal on;
 * then the same channel one step at a time down `cause`, because pool and
 * query-builder layers re-throw with the original attached and the refusal is
 * then the ONLY copy of the dialect's answer (#6848). `String()` only as the
 * last resort — which is what a bare string resolves to unchanged, so a caller
 * holding nothing but prose is judged exactly as before.
 *
 * ⚠️ The levels are joined with a NEWLINE, never a space. Two of the dialect
 * vocabulary's alternatives are multi-word (`where clause`, `near "where"`), so
 * a space would let a phrase be synthesised across a wrapper boundary that no
 * single driver ever wrote — an outer message ending in `where` above a cause
 * beginning with `clause` would read as a dialect refusal. A newline cannot
 * match the literal space in those alternatives, so each level is still judged
 * on text some layer actually emitted.
 */
function indexFailureText(error: unknown): string {
    const texts: string[] = [];
    collectIndexFailureText(error, 0, texts);
    return texts.length > 0 ? texts.join('\n') : String(error);
}

/**
 * Classify a failed `CREATE UNIQUE INDEX`, from the thrown ERROR (#6699).
 *
 * ## The two arms, and why the order is load-bearing
 *
 * Duplicate-row wording is checked BEFORE dialect wording: MySQL's duplicate
 * error mentions the key, and some drivers wrap both facts in one string, so
 * the more specific verdict has to win or a real data conflict would be
 * misreported as "this dialect cannot build this index".
 *
 * The dialect arm covers both refusals a single `unsupported` verdict has to
 * stand for, because MySQL hits them together and one error string cannot be
 * split: no partial indexes at all, and (before 8.0.13 / on MariaDB) no
 * functional key parts for `COALESCE` parts. Both leave the same outcome — the
 * previous index stays — so one verdict is enough.
 *
 * ## Why the first arm is not this module's own regex any more
 *
 * "Is this a unique-constraint violation?" is one question, and #6250 gave it
 * one named answer — `isUniqueViolationError` in `@objectstack/types`. This
 * function carried a **fifth** private vocabulary for it (#6699, missed by that
 * inventory because it lives in a package none of the other four touched), and
 * the copy was strictly weaker in the way that inventory was about: it read the
 * **message channel only**. A driver that reports the conflict on `code` /
 * `errno` — SQLite's `SQLITE_CONSTRAINT_UNIQUE`, MySQL's `ER_DUP_ENTRY` /
 * errno `1062`, Postgres' SQLSTATE `23505` — while giving unhelpful prose
 * (`insert failed`, a pooled wrapper's `Write failed`, or the condition one step
 * down `error.cause`) was classified `failed` here, where the shared predicate
 * answers `true`. Same shape as the hole that made every MySQL conflict a 500
 * in `mapDataError` before #6541.
 *
 * The predicate answers the FIRST arm only. It has no opinion about dialect
 * support, so the second arm stays this module's own — and stays second.
 *
 * ## Why both arms walk `cause` (#6848)
 *
 * They read the same depth because they are asked the same way. #6699 gave the
 * first arm the shared predicate's four-level `cause` walk and left the second
 * on the outer message alone; the two then disagreed about how deeply a driver
 * is allowed to wrap. A dialect refusal arriving behind a pooled wrapper —
 * outer prose `Write failed`, the real `near "WHERE": syntax error` one step
 * down — was graded `failed` rather than `unsupported`.
 *
 * That gap is **not** a wording difference, which is why it was worth closing
 * rather than documenting. `view-definition-active-index.ts` disposes of the
 * two verdicts identically (keep the previous index, report at `error`), but
 * `overlay-index.ts` builds the composite **fallback lookup index** on
 * `unsupported` and only there — offered precisely because a dialect that
 * cannot take the partial form should still get the lookup. Under a `failed`
 * verdict that branch never runs and the fallback is reported `not-attempted`
 * instead of `ensured` / `refused`, so the wrap depth silently decides whether
 * the degradation target is built at all.
 *
 * No driver shipped today produces that shape — every one hands knex's error
 * back with the dialect text on the outer message, which is why every case here
 * matched on the first read. This closes a dormant asymmetry, not a live defect.
 *
 * ⚠️ Pass the **error**, not `err.message`. A string still works (the predicate
 * reads it on the message channel, and so does {@link indexFailureText}), but a
 * caller that unwraps first throws away the `code` / `errno` / `cause` channels
 * that are the whole reason this reads the object — and, since #6848, the
 * dialect answer too when a wrapper holds the useless half.
 */
export function classifyIndexFailure(error: unknown): PartialIndexStatus {
    if (isUniqueViolationError(error)) {
        return 'conflict';
    }
    if (/partial|where clause|near "where"|near 'where'|functional|syntax/i.test(indexFailureText(error))) {
        return 'unsupported';
    }
    return 'failed';
}

/**
 * `DROP INDEX IF EXISTS`, swallowing everything.
 *
 * Best-effort by contract. MySQL has no `DROP INDEX IF EXISTS <name>` form at
 * all, so this throws there on every call — which is harmless precisely because
 * the probe has already decided whether anything is allowed to be dropped.
 */
export async function dropIndexQuietly(exec: IndexExec, indexName: string): Promise<void> {
    try {
        await exec(`DROP INDEX IF EXISTS ${indexName}`);
    } catch {
        // Best-effort — see above.
    }
}

export interface ProbeThenReplaceOptions {
    /** The real index name, which the rebuilt index must claim. */
    indexName: string;
    /** Throwaway name used to prove the form is possible before dropping anything. */
    probeIndexName: string;
    /** Builds the tighter `CREATE …` statement for a given index name. */
    buildSql: (indexName: string) => string;
}

export interface ProbeThenReplaceOutcome {
    status: PartialIndexStatus;
    /** Driver error text, when there was one. */
    detail?: string;
    /**
     * Which step failed, when one did.
     *
     * `'probe'` — nothing was touched; whatever index held {@link
     * ProbeThenReplaceOptions.indexName} is exactly as it was.
     *
     * `'replace'` — the probe had already proven the form buildable, so the
     * real name was dropped and the rebuild then failed anyway (a race with
     * another process is the only way to get here). The caller owes the loudest
     * report it has: this is the one branch where the name may now hold nothing.
     */
    failedAt?: 'probe' | 'replace';
}

/**
 * Build `indexName`'s tighter definition without ever leaving the table
 * unprotected. See the module header for the order and its rationale.
 *
 * Never throws: a boot must not fail because an index could not be tightened,
 * so every branch returns a status instead.
 */
export async function probeThenReplaceIndex(
    exec: IndexExec,
    { indexName, probeIndexName, buildSql }: ProbeThenReplaceOptions,
): Promise<ProbeThenReplaceOutcome> {
    // ── Step 1: prove the form is possible WITHOUT touching the index that is
    // currently protecting the table. The leading drop clears residue from a
    // process that died mid-probe on an earlier boot. ─────────────────────────
    await dropIndexQuietly(exec, probeIndexName);
    try {
        await exec(buildSql(probeIndexName));
    } catch (err: unknown) {
        // `detail` is the OPERATOR-facing text and stays the driver's own prose.
        // The VERDICT is taken from the error object itself, so a conflict
        // reported on `code` / `errno` / `cause` with unhelpful prose is still
        // classified as one (#6699) — unwrapping first is exactly what the
        // migration onto the shared predicate exists to stop.
        const detail = err instanceof Error ? err.message : String(err);
        await dropIndexQuietly(exec, probeIndexName);
        return { status: classifyIndexFailure(err), detail, failedAt: 'probe' };
    }
    await dropIndexQuietly(exec, probeIndexName);

    // ── Step 2: the form is known-buildable on this dialect, over this data.
    // Claim the real name. ────────────────────────────────────────────────────
    await dropIndexQuietly(exec, indexName);
    try {
        await exec(buildSql(indexName));
    } catch (err: unknown) {
        const detail = err instanceof Error ? err.message : String(err);
        return { status: 'failed', detail, failedAt: 'replace' };
    }
    return { status: 'created' };
}
