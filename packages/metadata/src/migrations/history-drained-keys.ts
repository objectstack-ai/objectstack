// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * One-time scrub of `sys_metadata_history` snapshots written BEFORE history
 * started withholding what a save drains (ruling 6677709817, step (b)). This
 * module ships the scrub's COUNT mode only: a read-only pass that reports how
 * many stored snapshots the scrub would rewrite. The rewrite itself is the
 * second half of step (b) and waits on the maintainer's confirmation of the
 * count; until it lands, every other mode is refused before any read.
 *
 * ## What "would be rewritten" means — one predicate
 *
 * Step (c) made both history writers store `historySnapshotBody(type, body)`
 * (`../utils/history-snapshot-body.ts`): the body without every position the
 * type's read-path redactor marks withheld AND not carried forward (a
 * connector's undeclared `auth` keys, the positions a save of the served form
 * drains from the live row). A stored snapshot is affected exactly when that
 * same helper, applied to it today, returns a different body — the helper
 * returns every untouched body BY REFERENCE, so identity is the test. The
 * count therefore cannot disagree with the write-time withholding, and the
 * rewrite will store the very body this pass judges: nothing here names a key
 * or a type. A row written after step (c) already holds the withheld body, so
 * it is never counted.
 *
 * ## What it reads, and what it never does
 *
 * It takes a driver's `find` and nothing else, so it cannot write through the
 * handle it is given. It pages the table by primary key (keyset, ascending)
 * and reads `id`, `type`, `name` and `metadata` only. Delete events carry no
 * body and are scanned, never counted.
 *
 * Nothing is silently skipped: a body that is not JSON, or a row without a
 * type, is listed in `unreadable`; a body the snapshot helper refuses to
 * reduce (a position it cannot remove — the write path refuses the same body)
 * is listed in `unscrubbable`. Both are reported beside the count, never
 * folded into it.
 *
 * ⛔ The result holds row ids (opaque handles) and numbers only — never a key
 * name, a value or a body. Treat a run against real history as a security
 * reading: run it on a copy of the database, and hand its numbers to the
 * maintainer through the advisory channel, never a public tracker.
 *
 * Usage (on a restored copy):
 *   import { scrubHistoryDrainedKeys } from '@objectstack/metadata/migrations';
 *   const report = await scrubHistoryDrainedKeys(driver, { mode: 'count' });
 */

import type { IDataDriver } from '@objectstack/spec/contracts';

import { historySnapshotBody } from '../utils/history-snapshot-body.js';

/** The table the scrub reads (and, in its second half, rewrites). */
const HISTORY_TABLE = 'sys_metadata_history';

/** Rows per keyset page when the caller names none. */
const DEFAULT_PAGE_SIZE = 500;

/** The one mode this release carries. */
export type HistoryDrainedKeysMode = 'count';

export interface HistoryDrainedKeysOptions {
    /** `'count'`: read-only. The rewrite mode lands with the scrub's second half. */
    mode: HistoryDrainedKeysMode;
    /** Rows per page (default 500). */
    pageSize?: number;
}

export interface HistoryDrainedKeysCount {
    mode: 'count';
    /** History rows read, delete events included. */
    scanned: number;
    /** Rows whose stored snapshot the scrub would rewrite. */
    affectedRows: number;
    /** Distinct `(type, name)` items those rows belong to. */
    distinctItems: number;
    /** The affected rows' ids, ascending: opaque handles for a private report. */
    handles: string[];
    /** Rows whose body is not JSON, or that carry no type: not judged, not counted. */
    unreadable: string[];
    /** Rows whose body the snapshot helper refuses to reduce: affected, but not rewritable as-is. */
    unscrubbable: string[];
}

type HistoryRow = Record<string, unknown>;

/** The stored body as an object, `null` for a body-less (delete) row, `undefined` when unreadable. */
function storedBodyOf(row: HistoryRow): unknown {
    const stored = row.metadata;
    if (stored === null || stored === undefined) return null;
    if (typeof stored !== 'string') return stored;
    try {
        return JSON.parse(stored) as unknown;
    } catch {
        return undefined;
    }
}

/**
 * The scrub of drained connector keys from existing `sys_metadata_history`
 * snapshots, in its read-only count mode (see the module note).
 *
 * @param reader  a driver (or any reader) of the database COPY: only its
 *                `find` is ever called.
 * @param options `{ mode: 'count' }` — the only mode this release accepts.
 */
export async function scrubHistoryDrainedKeys(
    reader: Pick<IDataDriver, 'find'>,
    options: HistoryDrainedKeysOptions,
): Promise<HistoryDrainedKeysCount> {
    if (options?.mode !== 'count') {
        throw new Error(
            `[Metadata] scrubHistoryDrainedKeys: mode ${JSON.stringify(options?.mode)} is not available — this ` +
                `release carries the read-only 'count' mode only. The rewrite of stored history snapshots runs ` +
                `only after the maintainer confirms the count. Fix: pass { mode: 'count' }.`,
        );
    }
    const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
    if (!Number.isInteger(pageSize) || pageSize < 1) {
        throw new Error(`[Metadata] scrubHistoryDrainedKeys: pageSize must be a positive integer, got ${String(pageSize)}.`);
    }

    let scanned = 0;
    const handles: string[] = [];
    const unreadable: string[] = [];
    const unscrubbable: string[] = [];
    const items = new Set<string>();

    let after: string | undefined;
    for (;;) {
        const page = await reader.find(HISTORY_TABLE, {
            fields: ['id', 'type', 'name', 'metadata'],
            ...(after === undefined ? {} : { where: { id: { $gt: after } } }),
            orderBy: [{ field: 'id', order: 'asc' }],
            limit: pageSize,
        });
        for (const row of page) {
            const id = row.id;
            // A keyset page that does not advance would loop forever or skip rows:
            // refuse a reader that ignores the bound or the order.
            if (typeof id !== 'string' || (after !== undefined && !(id > after))) {
                throw new Error(
                    `[Metadata] scrubHistoryDrainedKeys: the reader returned ${HISTORY_TABLE} rows out of primary-key ` +
                        `order (or without a string id), so the count would be wrong. Fix: use a driver whose find ` +
                        `honours where/orderBy/limit.`,
                );
            }
            after = id;
            scanned += 1;

            const body = storedBodyOf(row);
            if (body === null) continue;
            if (body === undefined || typeof row.type !== 'string') {
                unreadable.push(id);
                continue;
            }
            let affected: boolean;
            try {
                affected = historySnapshotBody(row.type, body) !== body;
            } catch {
                unscrubbable.push(id);
                continue;
            }
            if (!affected) continue;
            handles.push(id);
            items.add(JSON.stringify([row.type, row.name ?? null]));
        }
        if (page.length < pageSize) break;
    }

    return {
        mode: 'count',
        scanned,
        affectedRows: handles.length,
        distinctItems: items.size,
        handles,
        unreadable,
        unscrubbable,
    };
}
