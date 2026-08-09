// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @objectstack/spec/contracts/report-service
 *
 * Cross-package contract for the saved-reports + scheduled-email
 * subsystem. The default implementation lives in
 * `@objectstack/plugin-reports`.
 *
 * The contract is intentionally narrow: a report is a persisted
 * ObjectQL query envelope plus a rendering format, and a schedule is
 * a recurrence rule plus a recipient list. Anything richer (drill-in,
 * pivots, charts) layers on top of these primitives.
 */

// [#6523 / #6206 ruling default] Reports are read UNDER the caller's context —
// row visibility, the saved-report gate and the schedule owner check all read
// it — so every method takes the complete `resolveAuthzContext` envelope rather
// than the six-field `SharingExecutionContext` this contract used to borrow
// from `sharing-service`. See `SharingExecutionContext` in
// `./sharing-service.js` for the boundary.
import type { ExecutionContext } from '../kernel/execution-context.zod.js';

/** Render format supported by `IReportService.run()`. */
export type ReportFormat = 'csv' | 'json' | 'html_table';

/**
 * ObjectQL query envelope persisted on `sys_saved_report.query_json`.
 * Mirrors `DataEngineQueryOptions` but only the fields that make sense
 * for a report definition.
 */
export interface ReportQuery {
  filter?: unknown;
  fields?: string[];
  orderBy?: Array<{ field: string; direction?: 'asc' | 'desc' }>;
  limit?: number;
  groupBy?: string[];
}

/** Definition row. */
export interface SavedReport {
  id: string;
  name: string;
  description?: string;
  object_name: string;
  query: ReportQuery;
  format: ReportFormat;
  owner_id?: string;
  last_run_at?: string;
  last_row_count?: number;
  created_at?: string;
  updated_at?: string;
}

/** Schedule row. */
export interface ReportSchedule {
  id: string;
  report_id: string;
  name?: string;
  interval_minutes?: number;
  cron_expression?: string;
  timezone?: string;
  active: boolean;
  recipients: string;
  format?: 'csv' | 'html_table';
  subject_template?: string;
  owner_id?: string;
  next_run_at?: string;
  last_sent_at?: string;
  last_status?: 'ok' | 'failed' | 'skipped';
  last_error?: string;
}

/** Result of `IReportService.run()`. */
export interface ReportRunResult {
  reportId: string;
  rowCount: number;
  format: ReportFormat;
  /** Rendered body — CSV string, HTML fragment, or JSON-encoded rows. */
  body: string;
  /** Raw rows (always provided so callers can re-render if needed). */
  rows: unknown[];
  /** ISO timestamp of execution. */
  ranAt: string;
}

/** Input for `IReportService.saveReport`. */
export interface SaveReportInput {
  id?: string;
  name: string;
  description?: string;
  object: string;
  query: ReportQuery;
  format?: ReportFormat;
  ownerId?: string;
}

/** Input for `IReportService.scheduleReport`. */
export interface ScheduleReportInput {
  reportId: string;
  recipients: string[];
  name?: string;
  intervalMinutes?: number;
  cronExpression?: string;
  timezone?: string;
  format?: 'csv' | 'html_table';
  subjectTemplate?: string;
  ownerId?: string;
  active?: boolean;
}

/**
 * Public contract.
 *
 * The dispatcher loop (started by the plugin) periodically calls
 * `dispatchDue()`. Implementations are expected to:
 *   1. Load every active schedule with `next_run_at <= now`.
 *   2. Run the linked report.
 *   3. Email the rendered body to each recipient via the
 *      `email` service (or no-op when not configured).
 *   4. Advance `next_run_at` by `interval_minutes` and stamp
 *      `last_sent_at` / `last_status` / `last_error`.
 */
export interface IReportService {
  /** Execute a report by id. */
  run(reportId: string, context: ExecutionContext): Promise<ReportRunResult>;

  /** Execute an ad-hoc report from an in-memory definition. */
  runAdHoc(input: SaveReportInput, context: ExecutionContext): Promise<ReportRunResult>;

  /** Upsert a saved report. Returns the persisted row. */
  saveReport(input: SaveReportInput, context: ExecutionContext): Promise<SavedReport>;

  /** List saved reports — optionally filtered by object. */
  listReports(
    filter: { object?: string; ownerId?: string } | undefined,
    context: ExecutionContext,
  ): Promise<SavedReport[]>;

  /** Get a saved report by id. */
  getReport(reportId: string, context: ExecutionContext): Promise<SavedReport | null>;

  /** Delete a saved report by id (and any attached schedules). */
  deleteReport(reportId: string, context: ExecutionContext): Promise<void>;

  /** Create or update a schedule. */
  scheduleReport(input: ScheduleReportInput, context: ExecutionContext): Promise<ReportSchedule>;

  /** Remove a schedule by id. */
  unscheduleReport(scheduleId: string, context: ExecutionContext): Promise<void>;

  /** List schedules — optionally filtered by report. */
  listSchedules(
    filter: { reportId?: string } | undefined,
    context: ExecutionContext,
  ): Promise<ReportSchedule[]>;

  /**
   * Fire any schedules whose `next_run_at <= now`. The plugin invokes
   * this from a tick job; integrators can also call it manually from
   * a test or admin endpoint.
   */
  dispatchDue(now?: Date): Promise<{
    fired: number;
    failed: number;
    skipped: number;
  }>;
}
