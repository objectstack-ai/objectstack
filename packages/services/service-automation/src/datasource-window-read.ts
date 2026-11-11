// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0153 D1, D2] The windowed read of a datasource source: how a pull reads
 * every row of a federated object (`mapping.datasourceSource.object`) from a
 * position, cut into half-open windows `lo <= field < hi` on the mapping's
 * `watermark.field`, and where it commits the position it reached.
 *
 * This module reads and commits; it does not resolve the mapping, project the
 * rows or write them. Its caller hands it a `find` over the source object (the
 * engine's read, as the system), a `write` that lands one batch of rows and
 * answers which of them were written, and a `commit` that stores a position.
 * So every invariant below is checkable here, against any reader.
 *
 * ## The canon step (invariants 3, 4, 5)
 *
 * Every bound is an ALIGNED value of the engine's canon: a millisecond for a
 * `datetime`, a day for a `date`, 1 for an integer field. Internally a
 * position is an integer count of steps (epoch milliseconds, epoch days, the
 * integer itself); it is spelled for the driver as the field's storage form
 * (ISO text, `YYYY-MM-DD`, a number). A value read back from a row becomes a
 * bound only after it is floored to the step ({@link canonOf}), and no
 * watermark value read back is ever a page cursor: pages are cut by key.
 *
 * ## Two read paths (D1), by the driver ruling 6487532394 gives the source
 *
 * - **`builtin`** — a built-in driver executes the whole query, so each window
 *   is read whole, with no row cap, paged by the source key (`key > lastKey`,
 *   ordered by key, the field range fixed on every page) until a short page.
 *   At run start it reads `H0`, one `max(field)` over the whole source under
 *   the organization predicate; the bounded windows tile `from <= field <
 *   floor(H0)` (invariant 12: a bounded window ends at or below a value the
 *   source has shown), and the last window, open above (`field >= floor(H0)`),
 *   is read after one more high-water read, `H1`, the (b) of invariant 9.
 * - **`floored`** — a plugin driver read through the engine's external-driver
 *   floor. Each window is ONE plain `find`; the floor sends cap + 1 and throws
 *   `ExternalRowCapExceededError` when more come back, carrying what came back
 *   (on the error object only). The open-above window `field >= lo` is read
 *   first; under the cap it is the whole tail and the run ends. Over the cap,
 *   the largest value it showed, floored, is `V`: the bounded windows tile
 *   `lo <= field < V`, each halved while it comes back over the cap, and the
 *   open-above window is tried again from `V`. Each round moves `lo` up, or
 *   refuses:
 *   - `sync_window_unsplittable` — one canon step holds more rows than the cap;
 *   - `sync_bounds_not_pushed` — a returned value lies outside the window's
 *     bounds, so the driver did not push both bounds down and halving cannot
 *     help.
 *
 * ## The commit (invariants 8, 9)
 *
 * A position is committed only when a window has been read to its end, never
 * after a page. It is the canon-step floor of the smaller of (a) the largest
 * watermark value written in the run and (b), on a `builtin` window read in
 * more than one page, the high-water value read before that window's first
 * page. A run that writes no row commits nothing, so the position stays where
 * it was. The next run reads `field >= committed`, so rows sharing the
 * committed step are read again, which the keyed upsert makes harmless.
 *
 * ## Exact values (invariant 7)
 *
 * A key read back as a number outside ±2^53 (or a fraction, or a value of no
 * key type) refuses the run (`source_key_not_exact`); so does an integer
 * watermark outside the safe range (`watermark_not_exact`), because a build-time
 * declaration can be wrong. A watermark value no rule reads as the field's kind
 * refuses the run the same way: it cannot be floored to a bound.
 *
 * Tuning this record leaves to the engine card, decided here: the built-in
 * path's bounded region starts as {@link BUILTIN_INITIAL_WINDOWS} windows of
 * equal width; a window read in one page doubles the next, and one read in more
 * than {@link BUILTIN_TARGET_PAGES} pages halves it. The floored path tries the
 * whole bounded region as one window, halves on an over-cap answer, and after a
 * window answers doubles the width it tries next.
 */

import { temporalStorageForm } from '@objectstack/core';
import { EXTERNAL_ROW_CAP_EXCEEDED_CODE } from '@objectstack/objectql';
import { EXTERNAL_ROW_CAP_CEILING, type FilterCondition, type SortNode } from '@objectstack/spec/data';
import { ConnectorPullError, type ConnectorPullRefusalReason } from './pull-refusal.js';

type Row = Record<string, unknown>;

/** The class of a watermark field (D2 invariant 1): what its canon step is. */
export type SyncWatermarkKind = 'datetime' | 'date' | 'integer';

/** Which read path the source's driver takes (D1). */
export type SyncReadPath = 'builtin' | 'floored';

/** A half-open window on the canon: `lo <= field < hi`, or `field >= lo` when `hi` is absent (open above). */
export interface SyncWindow {
    lo: number;
    hi?: number;
}

/** The read a window or a page sends to the source object. */
export interface SyncWindowQuery {
    where: FilterCondition;
    orderBy?: SortNode[];
    limit?: number;
}

/** What the windowed read reads from: one federated object, as the mapping names it. */
export interface SyncWindowSource {
    /** The mapping being pulled — named in every refusal. */
    mapping: string;
    /** The federated source object (`datasourceSource.object`). */
    object: string;
    /** Its datasource — named in a refusal that is about the driver. */
    datasource: string;
    /** `watermark.field`, a field of the source object. */
    field: string;
    kind: SyncWatermarkKind;
    /** The source object's field the `external.columnMap` maps the source key onto (invariant 6): `id`. */
    key: string;
    /**
     * [D8, invariant 10] The organization conjunct every read carries, when the
     * source states its own organization scope — e.g. `{ organization_id: X }`.
     * Absent: the source is read as configured (shared, or a `single` posture).
     */
    scope?: FilterCondition;
}

export interface SyncWindowReadDeps {
    /** Read the source object as the system. A floored read over the cap throws the floor's refusal. */
    find(query: SyncWindowQuery): Promise<Row[]>;
    /**
     * Land one batch of source rows (one page or one window). Answers, per row
     * and in order, whether it was written; a refused row is `false`.
     */
    write(rows: Row[], window: SyncWindow): Promise<boolean[]>;
    /** Store the committed position (a canon value) — called only at a window's end (invariant 8). */
    commit(position: number, window: SyncWindow): Promise<void>;
}

export interface SyncWindowReadOptions {
    path: SyncReadPath;
    /** The canon position the read starts at: the committed position, else `watermark.start` ({@link canonOfStart}). */
    from: number;
    /** `builtin` only: rows per page. */
    pageSize?: number;
}

/** What one windowed read did — the counts the run record reads (D7). */
export interface SyncWindowReadReport {
    path: SyncReadPath;
    from: number;
    /** Rows the windows answered (the rows handed to `write`). */
    read: number;
    /** Rows `write` answered written. */
    written: number;
    /** Windows read to their end. */
    windows: number;
    /** `find` calls, including refused over-cap reads. */
    reads: number;
    /** `floored`: windows halved after an over-cap answer. */
    halvings: number;
    /** The last position committed, when the run committed one. */
    committed?: number;
    /** `builtin`: the run-start high-water value `H0`, floored; absent on an empty source. */
    highWater?: number;
}

/** Rows per page on the built-in path, unless the caller says otherwise. */
export const BUILTIN_PAGE_SIZE = 1000;
/** The built-in path's bounded region starts as this many windows of equal width. */
export const BUILTIN_INITIAL_WINDOWS = 8;
/** A built-in window read in more than this many pages halves the next window's width. */
export const BUILTIN_TARGET_PAGES = 8;

const DAY_MS = 86_400_000;

/**
 * What every mid-read refusal says about the rows: windows read to their end
 * before it stay written and committed; the rest is read again from there.
 */
const STOPPED = 'The pull stopped there; the next run reads again from the last position it committed.';

/** A value read as the kind's canon: a step count, or why it cannot be one. */
type CanonReading = { ok: true; canon: number } | { ok: false; inexact: boolean };

/**
 * `value` floored to the canon step of `kind`, as an integer step count —
 * epoch milliseconds (`datetime`), epoch days (`date`), the integer itself.
 * `inexact` marks an integer the platform cannot hold exactly (outside ±2^53),
 * as against a value no rule reads as the kind at all.
 */
export function canonOf(kind: SyncWatermarkKind, value: unknown): CanonReading {
    if (value === null || value === undefined) return { ok: false, inexact: false };
    if (kind === 'integer') {
        if (typeof value === 'bigint') {
            return value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER)
                ? { ok: true, canon: Number(value) }
                : { ok: false, inexact: true };
        }
        const n = typeof value === 'number' ? value
            : typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim()) ? Number(value.trim()) : Number.NaN;
        if (!Number.isFinite(n)) return { ok: false, inexact: false };
        const floored = Math.floor(n);
        return Number.isSafeInteger(floored) ? { ok: true, canon: floored } : { ok: false, inexact: true };
    }
    if (kind === 'datetime') {
        // The storage rule every temporal face compares by (ADR-0053): it reads a
        // finer fraction to the millisecond by TRUNCATION, never rounding up.
        const iso = temporalStorageForm(value, 'datetime');
        const ms = typeof iso === 'string' ? Date.parse(iso) : Number.NaN;
        return Number.isFinite(ms) ? { ok: true, canon: ms } : { ok: false, inexact: false };
    }
    const day = temporalStorageForm(value, 'date');
    const ms = typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) ? Date.parse(`${day}T00:00:00.000Z`) : Number.NaN;
    return Number.isFinite(ms) ? { ok: true, canon: Math.floor(ms / DAY_MS) } : { ok: false, inexact: false };
}

/** A canon value spelled as the field's storage form: the comparand a bound is sent as. */
export function spellCanon(kind: SyncWatermarkKind, canon: number): string | number {
    if (kind === 'integer') return canon;
    if (kind === 'datetime') return new Date(canon).toISOString();
    return new Date(canon * DAY_MS).toISOString().slice(0, 10);
}

/** How one canon step is named in a sentence. */
function stepName(kind: SyncWatermarkKind): string {
    return kind === 'datetime' ? 'millisecond' : kind === 'date' ? 'day' : 'integer value';
}

/**
 * `watermark.start` as a canon position, floored, or a refusal: a start the
 * field's kind does not read (an ISO text for an integer field, junk for a
 * date) can bound no window.
 */
export function canonOfStart(source: Pick<SyncWindowSource, 'mapping' | 'field' | 'kind'>, start: unknown): number {
    const reading = canonOf(source.kind, start);
    if (reading.ok) return reading.canon;
    throw new ConnectorPullError(
        { code: 'VALIDATION_ERROR', status: 400, reason: 'watermark_start_invalid', mapping: source.mapping },
        `Mapping "${source.mapping}": datasourceSource.watermark.start ${JSON.stringify(start)} is not a `
        + `${source.kind === 'integer' ? 'whole number' : `${source.kind} value`} within the range the platform holds exactly, so no read window `
        + `on watermark.field '${source.field}' can start there. Nothing was pulled. Write `
        + (source.kind === 'integer' ? 'an integer' : source.kind === 'date' ? "an ISO date ('2020-01-01')" : "an ISO date or date-time ('2020-01-01T00:00:00Z')")
        + '.',
    );
}

/** The floor's over-cap refusal, read structurally (a second copy of the engine package keeps `instanceof` from answering). */
interface RowCapRefusal {
    code: string;
    details?: { cap?: unknown };
    returnedRowCount: number;
    returnedValuesOf(field: string): unknown[];
}

function rowCapRefusalOf(error: unknown): RowCapRefusal | undefined {
    const e = error as Partial<RowCapRefusal> | null | undefined;
    if (!e || e.code !== EXTERNAL_ROW_CAP_EXCEEDED_CODE) return undefined;
    if (typeof e.returnedValuesOf !== 'function' || typeof e.returnedRowCount !== 'number') return undefined;
    // A refusal that carries no returned rows (an engine built before ADR-0153)
    // shows the pull no value to cut by: it is passed on unchanged.
    return e.returnedRowCount > 0 ? e as RowCapRefusal : undefined;
}

/**
 * Read `source` from `options.from` to its end in windows, writing each page
 * or window through `deps.write` and committing at each window's end. Throws
 * {@link ConnectorPullError} on a refusal; rows of windows read before the
 * refusal stay written, and the position stays at the last commit, so the next
 * run reads from there again.
 */
export async function readSourceInWindows(
    source: SyncWindowSource,
    deps: SyncWindowReadDeps,
    options: SyncWindowReadOptions,
): Promise<SyncWindowReadReport> {
    const run = new WindowRun(source, deps, options);
    return options.path === 'builtin' ? run.builtin() : run.floored();
}

class WindowRun {
    private readonly report: SyncWindowReadReport;
    /** The largest canon watermark value written in this run — (a) of invariant 9. */
    private maxWritten: number | undefined;
    private readonly pageSize: number;

    constructor(
        private readonly source: SyncWindowSource,
        private readonly deps: SyncWindowReadDeps,
        options: SyncWindowReadOptions,
    ) {
        this.report = { path: options.path, from: options.from, read: 0, written: 0, windows: 0, reads: 0, halvings: 0 };
        const size = options.pageSize ?? BUILTIN_PAGE_SIZE;
        this.pageSize = Number.isInteger(size) && size > 0 ? size : BUILTIN_PAGE_SIZE;
    }

    // ── the built-in path ────────────────────────────────────────────────

    async builtin(): Promise<SyncWindowReadReport> {
        const from = this.report.from;
        const h0 = await this.highWater();
        if (h0 !== undefined) this.report.highWater = h0;
        let lo = from;
        if (h0 !== undefined && h0 > lo) {
            // Invariant 12: every bounded window ends at or below floor(H0), a
            // value the source showed this run. A row in one of them updated
            // while it is read moves to a value at or above H0, so the last
            // window reads it.
            const top = h0;
            let width = Math.max(1, Math.ceil((top - lo) / BUILTIN_INITIAL_WINDOWS));
            while (lo < top) {
                const window: SyncWindow = { lo, hi: Math.min(lo + width, top) };
                const pages = await this.readPaged(window);
                // (b) of invariant 9: the high-water read before this window's
                // first page is H0, which every value in the window is below.
                await this.commitWindow(window, pages > 1 ? h0 : undefined);
                width = pages <= 1 ? width * 2 : pages > BUILTIN_TARGET_PAGES ? Math.max(1, Math.floor(width / 2)) : width;
                lo = window.hi as number;
            }
        }
        // The last window, open above. One more high-water read before its
        // first page: a row behind its key cursor updated while later pages are
        // read moves to a value at or above H1, which the next run reads.
        const h1 = await this.highWater();
        const last: SyncWindow = { lo };
        const pages = await this.readPaged(last);
        // [S1] On a window read in several pages, an absent high-water value
        // (the source held no non-NULL watermark under the scope before the
        // first page) reads as the window's own `lo`: rows that arrived during
        // the read are read again by the next run, never passed by a later row's
        // higher value.
        await this.commitWindow(last, pages > 1 ? (h1 ?? last.lo) : undefined);
        return this.report;
    }

    /** One `max(field)` over the WHOLE source under the organization predicate, never within a window. */
    private async highWater(): Promise<number | undefined> {
        const { field } = this.source;
        const rows = await this.find({
            where: this.scoped({ [field]: { $ne: null } }),
            orderBy: [{ field, order: 'desc' }],
            limit: 1,
        });
        if (rows.length === 0) return undefined;
        return this.watermarkOf(rows[0]);
    }

    /** Read one window to its end, paged by key; answers the number of pages. */
    private async readPaged(window: SyncWindow): Promise<number> {
        const { key } = this.source;
        let cursor: unknown;
        let pages = 0;
        for (;;) {
            const page = await this.find({
                where: this.scoped(this.range(window), cursor === undefined ? undefined : { [key]: { $gt: cursor } }),
                orderBy: [{ field: key, order: 'asc' }],
                limit: this.pageSize,
            });
            pages++;
            this.judgeRows(page);
            await this.land(page, window);
            if (page.length < this.pageSize) return pages;
            cursor = this.cursorOf(page[page.length - 1]);
        }
    }

    // ── the floored path ─────────────────────────────────────────────────

    async floored(): Promise<SyncWindowReadReport> {
        let lo = this.report.from;
        for (;;) {
            // The open-above window first: under the cap it is the whole tail.
            const tail: SyncWindow = { lo };
            const answer = await this.readCapped(tail);
            if (answer.rows) {
                await this.land(answer.rows, tail);
                await this.commitWindow(tail, undefined);
                return this.report;
            }
            // Over the cap: the cap + 1 values it returned are values the source
            // has shown. Bounded windows stay below the largest of them, floored.
            const shown = this.judgeBounds(answer.refusal, tail);
            const v = Math.max(...shown);
            if (v <= lo) this.unsplittable(lo, answer.refusal);
            let wlo = lo;
            let width = v - lo;
            while (wlo < v) {
                let whi = Math.min(wlo + width, v);
                let rows: Row[];
                for (;;) {
                    const window: SyncWindow = { lo: wlo, hi: whi };
                    const read = await this.readCapped(window);
                    if (read.rows) { rows = read.rows; break; }
                    this.judgeBounds(read.refusal, window);
                    if (whi - wlo <= 1) this.unsplittable(wlo, read.refusal);
                    whi = wlo + Math.floor((whi - wlo) / 2);
                    this.report.halvings++;
                }
                const window: SyncWindow = { lo: wlo, hi: whi };
                await this.land(rows, window);
                await this.commitWindow(window, undefined);
                width = (whi - wlo) * 2;
                wlo = whi;
            }
            lo = v;
        }
    }

    /** One window as one plain `find` through the floor: its rows, or the floor's over-cap refusal. */
    private async readCapped(window: SyncWindow): Promise<{ rows: Row[]; refusal?: undefined } | { rows?: undefined; refusal: RowCapRefusal }> {
        try {
            const rows = await this.find({ where: this.scoped(this.range(window)) });
            this.judgeRows(rows);
            return { rows };
        } catch (error) {
            const refusal = rowCapRefusalOf(error);
            if (!refusal) throw error;
            return { refusal };
        }
    }

    /**
     * The values an over-cap answer showed, as canon, once each is judged
     * against the window's bounds. One outside them — or a row with no
     * watermark at all, which no bound admits — means the driver did not push
     * both bounds, which halving cannot fix. D8's organization equality is not
     * part of this count: only the watermark field is read.
     */
    private judgeBounds(refusal: RowCapRefusal, window: SyncWindow): number[] {
        const shown: number[] = [];
        for (const value of refusal.returnedValuesOf(this.source.field)) {
            const reading = canonOf(this.source.kind, value);
            // [N3] A value present but unreadable is the data's fault, named as
            // it is under the cap; only a row with NO watermark (NULL) is one no
            // bound admits, which blames the driver.
            if (!reading.ok && (reading.inexact || (value !== null && value !== undefined))) this.notExactWatermark(value);
            const inside = reading.ok && reading.canon >= window.lo && (window.hi === undefined || reading.canon < window.hi);
            if (!inside) this.boundsNotPushed(window, refusal);
            shown.push((reading as { canon: number }).canon);
        }
        return shown;
    }

    private unsplittable(at: number, refusal: RowCapRefusal): never {
        const { mapping, object, datasource, field, kind } = this.source;
        const cap = capOf(refusal);
        const value = spellCanon(kind, at);
        return this.refuse('EXTERNAL_ROW_CAP_EXCEEDED', 422, 'sync_window_unsplittable',
            `Mapping "${mapping}": more than ${cap} rows of '${object}' (datasource '${datasource}') share one `
            + `${stepName(kind)} of watermark.field '${field}', ${JSON.stringify(value)}, and the engine reads at most ${cap} `
            + `rows from its plugin driver for one window, so no window can be narrowed under it. ${STOPPED} `
            + (cap < EXTERNAL_ROW_CAP_CEILING
                ? `Raise the datasource's \`external.rowCap\` (at most ${EXTERNAL_ROW_CAP_CEILING}), or cut the windows on a finer watermark field.`
                : 'Cut the windows on a finer watermark field.'),
        );
    }

    private boundsNotPushed(window: SyncWindow, refusal: RowCapRefusal): never {
        const { mapping, object, datasource, field, kind } = this.source;
        const bounds = window.hi === undefined
            ? `${field} >= ${JSON.stringify(spellCanon(kind, window.lo))}`
            : `${JSON.stringify(spellCanon(kind, window.lo))} <= ${field} < ${JSON.stringify(spellCanon(kind, window.hi))}`;
        return this.refuse('EXTERNAL_ROW_CAP_EXCEEDED', 422, 'sync_bounds_not_pushed',
            `Mapping "${mapping}": the plugin driver of datasource '${datasource}' answered the read window ${bounds} `
            + `on '${object}' with more than ${capOf(refusal)} rows, some of them outside the window, so it does not `
            + 'send both of the window\'s bounds to the remote, and narrowing the window cannot bring the answer under '
            + `the cap. ${STOPPED} A pull through this datasource needs a driver that sends both \`>=\` and \`<\` on '${field}' to the remote.`,
        );
    }

    // ── shared ───────────────────────────────────────────────────────────

    private async find(query: SyncWindowQuery): Promise<Row[]> {
        this.report.reads++;
        const rows = await this.deps.find(query);
        return Array.isArray(rows) ? rows : [];
    }

    /** Hand one batch to the writer, and move (a) of invariant 9 by the rows it wrote. */
    private async land(rows: Row[], window: SyncWindow): Promise<void> {
        this.report.read += rows.length;
        if (rows.length === 0) return;
        const written = await this.deps.write(rows, window);
        rows.forEach((row, i) => {
            if (written[i] !== true) return;
            this.report.written++;
            const canon = this.watermarkOf(row);
            if (this.maxWritten === undefined || canon > this.maxWritten) this.maxWritten = canon;
        });
    }

    /**
     * Invariant 9: commit floor(min(a, b)) at a window's end — nothing when the
     * run has written no row. [S1] Never below `from`: every row the run read
     * held a value at or above it, and under invariant 2 its update does too, so
     * a high-water value read below `from` (the source's maximum sat under the
     * starting position) caps nothing the next run would miss.
     */
    private async commitWindow(window: SyncWindow, highWater: number | undefined): Promise<void> {
        this.report.windows++;
        if (this.maxWritten === undefined) return;
        const capped = highWater === undefined ? this.maxWritten : Math.min(this.maxWritten, highWater);
        const position = Math.max(capped, this.report.from);
        await this.deps.commit(position, window);
        this.report.committed = position;
    }

    /** The window's bounds as a `where`: `field >= lo`, and `field < hi` when bounded. */
    private range(window: SyncWindow): FilterCondition {
        const { field, kind } = this.source;
        const lower: FilterCondition = { [field]: { $gte: spellCanon(kind, window.lo) } };
        return window.hi === undefined ? lower : { $and: [lower, { [field]: { $lt: spellCanon(kind, window.hi) } }] };
    }

    /** `where` with the organization conjunct (invariant 10) and any extra conjunct. */
    private scoped(where: FilterCondition, extra?: FilterCondition): FilterCondition {
        const parts = [this.source.scope, where, extra].filter((p): p is FilterCondition => p !== undefined);
        return parts.length === 1 ? parts[0] : { $and: parts };
    }

    /**
     * Every row's key and watermark must read back exactly (invariant 7), before
     * the batch is written. A row with NO key is not refused here: it is the
     * writer's blank-match-key row error, as on every pull.
     */
    private judgeRows(rows: Row[]): void {
        for (const row of rows) {
            this.watermarkOf(row);
            const key = row[this.source.key];
            if (key === null || key === undefined || typeof key === 'string' || typeof key === 'bigint') continue;
            if (typeof key === 'number' && Number.isSafeInteger(key)) continue;
            this.notExactKey(key);
        }
    }

    /** A row's watermark as canon, or the refusal — a value that cannot be floored can bound nothing. */
    private watermarkOf(row: Row): number {
        const value = row[this.source.field];
        const reading = canonOf(this.source.kind, value);
        if (reading.ok) return reading.canon;
        return this.notExactWatermark(value);
    }

    /** The key a page's last row continues from — a string or an exact integer, never absent. */
    private cursorOf(row: Row): unknown {
        const key = row[this.source.key];
        if (typeof key === 'string' && key.length > 0) return key;
        if (typeof key === 'bigint') return key;
        if (typeof key === 'number' && Number.isSafeInteger(key)) return key;
        return this.notExactKey(key);
    }

    private notExactKey(value: unknown): never {
        const { mapping, object, key } = this.source;
        return this.refuse('VALIDATION_ERROR', 400, 'source_key_not_exact',
            `Mapping "${mapping}": a row of '${object}' carries ${describeValue(value)} as its key '${key}' (the source `
            + 'column external.columnMap maps onto id), and a key is a non-empty string or an integer the platform holds '
            + `exactly (inside ±2^53), so no row can be matched or paged by it. ${STOPPED} Map a unique, never-null `
            + 'string column onto id, or have the source read the integer key as text.',
        );
    }

    private notExactWatermark(value: unknown): never {
        const { mapping, object, field, kind } = this.source;
        const reading = canonOf(kind, value);
        const why = !reading.ok && reading.inexact
            ? 'an integer outside ±2^53, which no JavaScript number holds exactly'
            : `not a ${kind === 'integer' ? 'whole number' : `${kind} value`} the platform can floor to a ${stepName(kind)}`;
        return this.refuse('VALIDATION_ERROR', 400, 'watermark_not_exact',
            `Mapping "${mapping}": a row of '${object}' carries ${describeValue(value)} in watermark.field '${field}', `
            + `${why}, so it can bound no read window. ${STOPPED} Cut the windows on a datetime or date field, or on an `
            + 'integer field whose values stay inside ±2^53.',
        );
    }

    private refuse(code: string, status: number, reason: ConnectorPullRefusalReason, message: string): never {
        throw new ConnectorPullError({ code, status, reason, mapping: this.source.mapping }, message);
    }
}

function capOf(refusal: RowCapRefusal): number {
    const cap = refusal.details?.cap;
    return typeof cap === 'number' ? cap : refusal.returnedRowCount - 1;
}

function describeValue(value: unknown): string {
    if (value === null || value === undefined) return 'no value';
    if (typeof value === 'bigint') return `${value.toString()}n`;
    if (typeof value === 'string') return JSON.stringify(value);
    if (typeof value === 'number') return String(value);
    return `a ${typeof value === 'object' ? (Array.isArray(value) ? 'list' : 'structured value') : typeof value}`;
}
