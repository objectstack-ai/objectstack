// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The analytics dataset door's half of the ledger's `dataset_query` row: the
 * event this door hands the `audit` slot's `recordDatasetQuery`
 * (plugin-audit's `dataset-query-audit.ts`, which owns the row, the
 * per-dataset opt-in and the batching, and declares the same shape).
 * Declared here structurally, so neither package depends on the other — the
 * export door's `recordDataExport` reaches the same slot the same way
 * (`data-action-routes.ts`).
 *
 * ## Which queries hand an event
 *
 * One event per query of a SAVED dataset that reached the read
 * (`queryDataset`), whether it answered or failed; the export door's rules:
 *
 *  - a request the door refused before the read (identity, the body and
 *    selection doors, the dataset's resolution, its parse) is no read and
 *    hands none — {@link runAuditedDatasetQuery} only wraps the read itself;
 *  - a read that threw hands one event with outcome `failed`, the status and
 *    machine code the shared resolver reads off the error, never its text,
 *    which a driver can fill with a comparand;
 *  - an inline definition (the Studio preview) hands none: the opt-in names a
 *    saved dataset, and an inline definition's name is the caller's text.
 *
 * `readQuery` is the filter AS READ: the writer reduces it to field names and
 * operators before anything reaches the ledger. It is not spelled `query` for
 * the reason `data-action-routes.ts` gives.
 *
 * Whether the dataset is audited at all is the writer's to answer (its
 * opt-in list); the door hands every saved-dataset query and the writer drops
 * the ones it was not asked to record, before buffering anything.
 */

import { resolveThrownHttpError } from '@objectstack/types';

/** One dataset query, as the door hands it to the `audit` slot. */
interface DatasetQueryAuditEvent {
    context: unknown;
    datasetName: string;
    objectName?: string;
    dimensions?: unknown;
    measures?: unknown;
    timeDimensions?: unknown;
    readQuery: { filter?: unknown };
    rowCount: number;
    outcome: 'succeeded' | 'failed';
    status?: number;
    errorCode?: string;
}

/** The `audit` slot member this door calls — declared locally, structurally. */
interface DatasetQueryAuditSurface {
    recordDatasetQuery(event: DatasetQueryAuditEvent): void | Promise<void>;
}

/** What {@link runAuditedDatasetQuery} reads from the server: the audit slot's resolver. */
export interface DatasetQueryAuditHost {
    resolveAuditService(environmentId?: string, req?: any): Promise<unknown>;
}

/** The query being read, as the door judged it. */
export interface AuditedDatasetQuery {
    readonly req: unknown;
    readonly environmentId: string | undefined;
    readonly context: unknown;
    /** The saved dataset's name; `undefined` for an inline definition, which hands no event. */
    readonly datasetName: string | undefined;
    /** The parsed dataset definition (read for its base object). */
    readonly dataset: unknown;
    /** The caller's selection (read for its names and its filter). */
    readonly selection: unknown;
}

const asRecord = (v: unknown): Record<string, unknown> =>
    v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/** The selection's time-dimension names, never their date ranges. */
function timeDimensionNames(v: unknown): string[] | undefined {
    if (!Array.isArray(v)) return undefined;
    return v.map((t) => asRecord(t).dimension).filter((d): d is string => typeof d === 'string');
}

/**
 * Hand one query to the `audit` slot. Never throws and never waits for the
 * ledger write — the writer enqueues and returns, and reports its own lost
 * rows. A host with no audit plugin has no ledger, so the call is skipped.
 */
async function recordDatasetQuery(
    host: DatasetQueryAuditHost,
    query: AuditedDatasetQuery,
    event: DatasetQueryAuditEvent,
): Promise<void> {
    let sink: Partial<DatasetQueryAuditSurface> | undefined;
    try {
        sink = (await host.resolveAuditService(query.environmentId, query.req)) as Partial<DatasetQueryAuditSurface> | undefined;
    } catch {
        return; // no audit slot on this kernel: no ledger to write to
    }
    if (!sink || typeof sink.recordDatasetQuery !== 'function') return;
    try {
        const pending = sink.recordDatasetQuery(event);
        // A host's own sink that answers a promise is not awaited: the
        // ledger write stays off the request path, and its rejection is
        // never the caller's.
        if (pending && typeof (pending as Promise<void>).catch === 'function') {
            (pending as Promise<void>).catch(() => undefined);
        }
    } catch {
        // The writer never throws by contract; a sink that does must not turn
        // an answered query into a failed request.
    }
}

/**
 * Run the dataset read and hand the ledger its event: one per saved-dataset
 * query that reached the read, answered or failed. The read's own answer and
 * its own throw pass through unchanged.
 */
export async function runAuditedDatasetQuery<T>(
    host: DatasetQueryAuditHost,
    query: AuditedDatasetQuery,
    read: () => Promise<T>,
): Promise<T> {
    if (typeof query.datasetName !== 'string' || query.datasetName === '') return read();
    const selection = asRecord(query.selection);
    const base = {
        context: query.context,
        datasetName: query.datasetName,
        ...(typeof asRecord(query.dataset).object === 'string' ? { objectName: asRecord(query.dataset).object as string } : {}),
        dimensions: selection.dimensions,
        measures: selection.measures,
        ...(selection.timeDimensions !== undefined ? { timeDimensions: timeDimensionNames(selection.timeDimensions) } : {}),
        readQuery: { filter: selection.runtimeFilter },
    };
    let result: T;
    try {
        result = await read();
    } catch (error) {
        const { status, code } = resolveThrownHttpError(error, 500);
        await recordDatasetQuery(host, query, {
            ...base,
            rowCount: 0,
            outcome: 'failed',
            status,
            ...(typeof code === 'string' && code.length > 0 ? { errorCode: code } : {}),
        });
        throw error;
    }
    const rows = asRecord(result).rows;
    await recordDatasetQuery(host, query, {
        ...base,
        rowCount: Array.isArray(rows) ? rows.length : 0,
        outcome: 'succeeded',
    });
    return result;
}
