// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The `dataset_query` row in the compliance ledger: one durable, run-level row
 * per query of an opted-in saved dataset that the analytics dataset door
 * (`POST /analytics/dataset/query`, and each query of its batch door) handed
 * to the read.
 *
 * ## What it answers
 *
 * 「who read which dataset, under which filter, and how many rows came back」.
 * A report or a dashboard is composed in the browser and reaches the server
 * only as dataset queries, so this row is the server's own fact about what was
 * read: it covers reports and dashboards alike, and it does NOT name a report,
 * which the server never sees. The action is named for what the row records.
 *
 * ## The scope pins (the follow-up the record-view writer reserved)
 *
 * The same three pins `read-audit.ts` carries, each a line of code here:
 *
 *   - **Per-dataset opt-in, closed, off by default.** The writer takes the
 *     opted-in dataset names ({@link DatasetQueryAuditWriterOptions.datasets},
 *     wired from `AuditPlugin`'s `datasetQueryAudit.datasets`). A query of any
 *     other dataset is dropped before anything is buffered, and an empty list
 *     builds no batcher at all. There is no global flag and no exception list,
 *     for the reason `read-audit.ts` gives for its install-time list.
 *   - **Saved datasets only.** The opt-in names a saved dataset; an inline
 *     definition (the Studio preview) carries a name the caller chose, so the
 *     door hands no event for one. That edge is a declared narrowing.
 *   - **Async batched writes off the request path.** `recordDatasetQuery`
 *     enqueues and returns; the rows land on a later tick through
 *     `createReadAuditBatcher`, the record-view writer's batcher. The query
 *     that produced the row never awaits its write.
 *
 * ## Refused and failed queries (the export door's rules)
 *
 * The door hands an event only once the query reached the read
 * (`queryDataset`): a request it refused first (identity, the body and
 * selection doors, the dataset's resolution, its parse) is no read and writes
 * no row. A query that failed after the read started writes one row with
 * outcome `failed`, the HTTP status and the error's machine code, never the
 * error's text.
 *
 * ## No queried value, ever
 *
 * The row records WHAT was asked, never what was in it: the filter is reduced
 * to its field names and operators by the export writer's own
 * `summarizeExportFilter` (every comparand dropped unread), the selection to
 * its dimension and measure names, and the answer to its row count. Nothing
 * here reads a row of the result.
 */

import type { IDataEngine } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { isMissingTableError } from '@objectstack/types';
import {
  auditFailureCauseKey,
  auditFailureCauseSummary,
  auditPerformerMetadata,
  createFieldPresenceProbe,
} from './audit-writers.js';
import { recordedField, summarizeExportFilter } from './data-export-audit.js';
import { IMPERSONATED_BY_KEY, impersonatorOf } from './impersonation-attribution.js';
import {
  createReadAuditBatcher,
  type ReadAuditBatcher,
  type ReadAuditLogger,
  type ReadAuditTimers,
} from './read-audit.js';

/** The `sys_audit_log.action` value this writer emits. */
export const DATASET_QUERY_AUDIT_ACTION = 'dataset_query' as const;

/** How the query ended: it answered, or it failed after the read started. */
export type DatasetQueryOutcome = 'succeeded' | 'failed';

/**
 * One dataset query, in the vocabulary of what HAPPENED. The door builds it;
 * this writer turns it into a row.
 */
export interface DatasetQueryAuditEvent {
  /**
   * The caller's envelope. Read for `userId`, `actor`, `tenantId`,
   * `performedBy` and `impersonatedBy` — nothing else.
   */
  context:
    | Pick<ExecutionContext, 'userId' | 'actor' | 'tenantId' | 'performedBy' | 'impersonatedBy'>
    | undefined;
  /**
   * The saved dataset's name, as the door resolved it. The opt-in is keyed on
   * it, so a name covers every package that holds a dataset of that name.
   */
  datasetName: string;
  /**
   * The package holding the dataset the door read (ADR-0150 D3: two packages
   * can hold one name), or `null` for the environment's own definition. This
   * is what tells two holders' rows apart.
   */
  datasetPackage?: string | null;
  /** The door served a draft definition (a preview read), not the published one. */
  preview?: boolean;
  /** The dataset's base object. */
  objectName?: string;
  /** The selection's dimension names. */
  dimensions?: unknown;
  /** The selection's measure names. */
  measures?: unknown;
  /** The selection's time-dimension names (never their date ranges). */
  timeDimensions?: unknown;
  /**
   * The query's filter as the door read it. Reduced to names and operators
   * before it reaches the row: the comparands are never recorded.
   */
  readQuery?: { filter?: unknown };
  /** Rows the answer carried (0 on a failure). */
  rowCount: number;
  outcome: DatasetQueryOutcome;
  /** On a failure: the HTTP status the door answered. */
  status?: number;
  /** On a failure: the error's machine code, as the door answered it. */
  errorCode?: string;
}

/** What {@link createDatasetQueryAuditWriter} returns; `recordDatasetQuery` goes on the `audit` slot. */
export interface DatasetQueryAuditWriter {
  /** The datasets this writer records — the closed opt-in set. */
  readonly auditedDatasets: readonly string[];
  /**
   * Record one query. Returns immediately — never awaits the ledger write,
   * never throws. A dataset outside the opt-in is dropped here.
   */
  recordDatasetQuery(event: DatasetQueryAuditEvent): void;
  /** Persist every buffered row now. */
  flush(): Promise<void>;
  /** Rows buffered and not yet persisted. */
  pending(): number;
  /** Cancel the timer and flush the tail. */
  stop(): Promise<void>;
}

export interface DatasetQueryAuditWriterOptions {
  /** Resolve the data engine at FLUSH time — see `AuthEventAuditSinkOptions.getEngine`. */
  getEngine(): IDataEngine | undefined;
  /**
   * The per-dataset opt-in — the closed set of saved dataset names whose
   * queries are recorded. Empty (the default) records nothing and buffers
   * nothing.
   */
  datasets?: readonly string[];
  logger?: ReadAuditLogger;
  /** Flush as soon as this many rows are buffered. Default 50. */
  maxBatchSize?: number;
  /** Flush this long after the first row of a batch. Default 2000ms. */
  flushIntervalMs?: number;
  /** Hard ceiling on the buffer. Default 10000. */
  maxBufferedEvents?: number;
  timers?: ReadAuditTimers;
  /** Clock seam — the query instant stamped on the row. Defaults to `Date`. */
  now?: () => Date;
}

/** The most dimension, measure or time-dimension names a row keeps, each. */
const DATASET_QUERY_NAMES_MAX = 32;

function nonEmpty(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}

function wholeNumber(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.trunc(v) : undefined;
}

/** A list of selection names, each a field path or `?`, bounded. */
function selectionNames(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((s): s is string => typeof s === 'string' && s.length > 0)
    .slice(0, DATASET_QUERY_NAMES_MAX)
    .map(recordedField);
}

/** A package id the row records: the id when it has a package id's shape, else `?`; absent is `null`. */
const PACKAGE_ID = /^[A-Za-z0-9@][A-Za-z0-9@._\/-]{0,127}$/;
function recordedPackage(v: unknown): string | null {
  if (typeof v !== 'string' || v === '') return null;
  return PACKAGE_ID.test(v) ? v : '?';
}

/** JSON that cannot throw on a cyclic/odd value — same rule as the CRUD writer. */
function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/**
 * The row for one query, without the conditionally-present `actor` column —
 * exported so the shape is pinned without an engine. Built at ENQUEUE time, so
 * the buffer holds names and counts only, never the caller's filter.
 */
export function buildDatasetQueryAuditRow(event: DatasetQueryAuditEvent, queriedAt: Date): Record<string, unknown> {
  const ctx = event.context ?? {};
  const userId = nonEmpty(ctx.userId);

  const metadata: Record<string, unknown> = {
    dataset: recordedField(String(event.datasetName ?? '')),
    dataset_package: recordedPackage(event.datasetPackage),
    dimensions: selectionNames(event.dimensions),
    measures: selectionNames(event.measures),
  };
  if (event.preview === true) metadata.preview = true;
  const timeDimensions = selectionNames(event.timeDimensions);
  if (timeDimensions.length > 0) metadata.time_dimensions = timeDimensions;
  const filter = event.readQuery?.filter;
  if (filter !== undefined && filter !== null) {
    const summary = summarizeExportFilter(filter);
    metadata.filter = summary.terms;
    if (summary.omitted > 0) metadata.filter_terms_omitted = summary.omitted;
  }
  metadata.row_count = wholeNumber(event.rowCount) ?? 0;
  metadata.outcome = event.outcome === 'failed' ? 'failed' : 'succeeded';
  if (event.outcome === 'failed') {
    if (typeof event.status === 'number') metadata.status = event.status;
    const errorCode = nonEmpty(event.errorCode);
    if (errorCode) metadata.error_code = errorCode;
  }
  // [ADR-0090 D10 rule 4] The delegated-call pair, as the CRUD mirror and the
  // export row write it — present only when an agent performed the call.
  // [#33694] Read by the CRUD mirror's own rule (`auditPerformerMetadata`): an
  // OAuth client or the in-product AI agent, and beside the agent only, the
  // conversation it ran in and the confirmation the person gave.
  Object.assign(metadata, auditPerformerMetadata(ctx.performedBy, userId));
  const impersonatedBy = impersonatorOf(ctx);
  if (impersonatedBy) metadata[IMPERSONATED_BY_KEY] = impersonatedBy;

  return {
    action: DATASET_QUERY_AUDIT_ACTION,
    // The QUERY instant, not the flush instant: batching moves the INSERT off
    // the request path, and `persistDatasetQueryAuditRows` writes with
    // `preserveAudit` so the stamp hook keeps it (`read-audit.ts` `buildRow`
    // carries the full reasoning).
    created_at: queriedAt,
    user_id: userId ?? null,
    object_name: nonEmpty(event.objectName) ?? null,
    // Run-level: a query is about a set of rows, so it names no record.
    record_id: null,
    old_value: null,
    new_value: null,
    // [ADR-0131 D7] The organization the query ran in.
    tenant_id: nonEmpty(ctx.tenantId) ?? null,
    metadata: safeStringify(metadata),
  };
}

/** The principal label the `actor` column takes (ADR-0014 D2), by the CRUD mirror's rule. */
function actorOf(event: DatasetQueryAuditEvent): string | null {
  const ctx = event.context ?? {};
  return nonEmpty(ctx.userId) ?? nonEmpty(ctx.actor) ?? null;
}

interface PendingDatasetQueryRow {
  row: Record<string, unknown>;
  actor: string | null;
}

/** Create the `dataset_query` writer; `AuditPlugin` puts its `recordDatasetQuery` on the `audit` slot. */
export function createDatasetQueryAuditWriter(opts: DatasetQueryAuditWriterOptions): DatasetQueryAuditWriter {
  const { getEngine, logger, now = () => new Date() } = opts;

  const auditedDatasets = [...new Set(opts.datasets ?? [])].filter(
    (name): name is string => typeof name === 'string' && name.trim().length > 0,
  );
  const opted = new Set(auditedDatasets);

  let probe: ((objectName: string, field: string) => boolean) | undefined;
  let probedEngine: IDataEngine | undefined;

  /**
   * Write one batch of ledger rows. A NAMED callee so
   * `pnpm check:durability-log-level` anchors on it
   * (`DURABILITY_CRITICAL_CALLEES`). The two context keys are the record-view
   * writer's, for its reasons (`persistReadAuditRows`): `isSystem` for the
   * readonly strip, `preserveAudit` so the stamp hook keeps the query instant.
   */
  const persistDatasetQueryAuditRows = async (
    engine: IDataEngine,
    rows: Record<string, unknown>[],
  ): Promise<void> => {
    await engine.insert('sys_audit_log', rows, { context: { isSystem: true, preserveAudit: true } });
  };

  /**
   * Report a lost batch — once per CAUSE (`auditFailureCauseKey`), the rule
   * every writer in this package follows. A durability degradation, so
   * `error`, falling back to `warn`, never to silence. Names the count and the
   * cause; never a query.
   */
  const reportedCauses = new Set<string>();
  const reportWriteFailure = (count: number, err: unknown): void => {
    const detail = String((err as any)?.message ?? err);
    try {
      const cause = auditFailureCauseKey('sys_audit_log', err);
      if (reportedCauses.has(cause)) {
        logger?.debug?.('Dataset-query audit write failed (already reported)', { count, err: detail, cause });
        return;
      }
      reportedCauses.add(cause);
      const message =
        `Dataset-query audit write FAILED (${auditFailureCauseSummary(err, detail)}) — ${count} dataset_query ` +
        'row(s) were LOST and the compliance trail is now INCOMPLETE. The queries themselves were answered ' +
        'exactly as they would have been without the ledger, so every report, dashboard and counter reads ' +
        'clean; only the `sys_audit_log` rows recording WHO read WHICH dataset, under which filter and how many ' +
        'rows, never landed, and nothing retries them. Every later batch failing THIS WAY is lost the same way ' +
        '(this CAUSE is reported ONCE — raise the log level to `debug` to see the rest; a DIFFERENT cause gets ' +
        'its own `error` line). ' +
        (isMissingTableError(err, 'sys_audit_log')
          ? 'Fix: confirm `sys_audit_log` is reachable from the connection this write ran on — its ADR-0057 ' +
            '§3.6 lifecycle class routes it to the dedicated `telemetry` datasource whenever one is registered, ' +
            'so a "no such table" here usually means the write ran against a DIFFERENT datasource than the ' +
            'one the table was created in. Set `OS_TELEMETRY_DB=0` to keep every lifecycle-classed object on ' +
            'the primary datasource.'
          : 'Fix: resolve the driver fault quoted at the head of this line on the connection this write ran ' +
            'on — every batch that hits it loses its rows until it is resolved.');
      if (logger?.error) {
        logger.error(message, err instanceof Error ? err : new Error(detail), { count });
      } else {
        logger?.warn?.(message, { count, err: detail });
      }
    } catch {
      /* logging must never break a query's answer */
    }
  };

  const batcher: ReadAuditBatcher<PendingDatasetQueryRow> | null = auditedDatasets.length === 0
    ? null
    : createReadAuditBatcher<PendingDatasetQueryRow>({
        async persist(pending) {
          const engine = getEngine();
          if (!engine) return;
          try {
            if (probe === undefined || probedEngine !== engine) {
              probe = createFieldPresenceProbe(engine);
              probedEngine = engine;
            }
            const hasActor = probe('sys_audit_log', 'actor');
            const rows = pending.map(({ row, actor }) => (hasActor ? { ...row, actor } : row));
            await persistDatasetQueryAuditRows(engine, rows);
          } catch (err) {
            reportWriteFailure(pending.length, err);
          }
        },
        overflowMessage:
          'Dataset-query audit buffer OVERFLOWED — dataset_query rows are being DROPPED, so the compliance trail ' +
          'now has holes that no error anywhere else will show: every query still answered. The buffer only ' +
          'grows this far when ledger writes are not draining (an unreachable `sys_audit_log`, or a query rate ' +
          'above what the datasource can absorb). This is reported ONCE — raise the log level to `debug` to see ' +
          'the rest. Fix: confirm `sys_audit_log` is writable from this process, then lower `flushIntervalMs` or ' +
          'raise `maxBatchSize` so batches drain faster than queries arrive.',
        ...(opts.maxBatchSize !== undefined ? { maxBatchSize: opts.maxBatchSize } : {}),
        ...(opts.flushIntervalMs !== undefined ? { flushIntervalMs: opts.flushIntervalMs } : {}),
        ...(opts.maxBufferedEvents !== undefined ? { maxBufferedEvents: opts.maxBufferedEvents } : {}),
        ...(logger !== undefined ? { logger } : {}),
        ...(opts.timers !== undefined ? { timers: opts.timers } : {}),
      });

  return {
    auditedDatasets,
    recordDatasetQuery(event: DatasetQueryAuditEvent): void {
      if (!batcher) return;
      try {
        if (!event || typeof event.datasetName !== 'string' || !opted.has(event.datasetName)) return;
        batcher.enqueue({ row: buildDatasetQueryAuditRow(event, now()), actor: actorOf(event) });
      } catch (err) {
        // A row that cannot be built is a row that does not land: reported as one.
        reportWriteFailure(1, err);
      }
    },
    flush: () => batcher?.flush() ?? Promise.resolve(),
    pending: () => batcher?.pending() ?? 0,
    stop: () => batcher?.stop() ?? Promise.resolve(),
  };
}
