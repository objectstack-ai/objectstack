// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { withoutOperationPrivateKeys } from '@objectstack/core';
import type {
  IReportService,
  SavedReport,
  ReportSchedule,
  ReportQuery,
  ReportRunResult,
  ReportFormat,
  SaveReportInput,
  ScheduleReportInput,
} from '@objectstack/spec/contracts';
// [#7135] The full `resolveAuthzContext` envelope — what `IReportService`
// declares for every one of these context parameters since #6523 (the #6206
// ruling: enforcement adjudicates on the whole envelope, never a per-site
// subset). A scheduled run resolves a REAL owner context through
// `OwnerContextResolver`; naming the retired six-field shape here made this
// file's own type say it could not see what that resolver returns.
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { Cron } from 'croner';

/**
 * Narrow engine surface — keeps the service testable without booting
 * a real ObjectQL kernel.
 */
export interface ReportEngine {
  find(object: string, options?: any): Promise<any[]>;
  findOne?(object: string, options?: any): Promise<any>;
  insert(object: string, data: any, options?: any): Promise<any>;
  update(object: string, idOrData: any, dataOrOptions?: any, options?: any): Promise<any>;
  delete(object: string, options?: any): Promise<any>;
}

/**
 * Minimum email surface — implementations may pass the full
 * `IEmailService` instance straight through.
 */
export interface ReportEmail {
  send(input: {
    to: string | string[];
    subject: string;
    text?: string;
    html?: string;
    attachments?: Array<{ filename: string; content: string; contentType?: string }>;
    relatedObject?: string;
    relatedId?: string;
  }): Promise<{ status: 'sent' | 'queued' | 'failed' }>;
}

/** Stamped only in tests / specialised callers to make `now` deterministic. */
export interface ReportClock { now(): Date }

const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] } as const;

const DEFAULT_FORMAT: ReportFormat = 'csv';
const DEFAULT_INTERVAL_MIN = 1440;
const DEFAULT_LIMIT = 1000;

function uid(prefix: string): string {
  const g: any = globalThis as any;
  if (g.crypto?.randomUUID) return `${prefix}_${g.crypto.randomUUID()}`;
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function parseQuery(raw: unknown): ReportQuery {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) as ReportQuery; }
    catch { return {}; }
  }
  if (typeof raw === 'object') return raw as ReportQuery;
  return {};
}

function rowFromSaved(row: any): SavedReport {
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    description: row.description ?? undefined,
    object_name: String(row.object_name ?? ''),
    query: parseQuery(row.query_json),
    format: (row.format as ReportFormat) ?? DEFAULT_FORMAT,
    owner_id: row.owner_id ?? undefined,
    last_run_at: row.last_run_at ?? undefined,
    last_row_count: row.last_row_count ?? undefined,
    created_at: row.created_at ?? undefined,
    updated_at: row.updated_at ?? undefined,
  };
}

function rowFromSchedule(row: any): ReportSchedule {
  return {
    id: String(row.id),
    report_id: String(row.report_id),
    name: row.name ?? undefined,
    interval_minutes: row.interval_minutes ?? undefined,
    cron_expression: row.cron_expression ?? undefined,
    timezone: row.timezone ?? undefined,
    active: row.active !== false,
    recipients: String(row.recipients ?? ''),
    format: row.format ?? undefined,
    subject_template: row.subject_template ?? undefined,
    owner_id: row.owner_id ?? undefined,
    next_run_at: row.next_run_at ?? undefined,
    last_sent_at: row.last_sent_at ?? undefined,
    last_status: row.last_status ?? undefined,
    last_error: row.last_error ?? undefined,
  };
}

// ─── Rendering ─────────────────────────────────────────────────────

function escapeCsvCell(v: unknown): string {
  if (v == null) return '';
  const s = typeof v === 'string' ? v : (typeof v === 'object' ? JSON.stringify(v) : String(v));
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function pickFields(rows: any[], explicit?: string[]): string[] {
  if (explicit && explicit.length > 0) return explicit;
  const seen = new Set<string>();
  for (const r of rows.slice(0, 50)) {
    if (r && typeof r === 'object') for (const k of Object.keys(r)) seen.add(k);
  }
  return Array.from(seen);
}

function renderCsv(rows: any[], fields?: string[]): string {
  const cols = pickFields(rows, fields);
  const head = cols.join(',');
  const body = rows.map(r => cols.map(c => escapeCsvCell(r?.[c])).join(',')).join('\r\n');
  return body.length > 0 ? `${head}\r\n${body}` : head;
}

function renderJson(rows: any[]): string {
  return JSON.stringify(rows, null, 2);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  } as Record<string, string>)[c]);
}

function renderHtmlTable(rows: any[], fields?: string[]): string {
  const cols = pickFields(rows, fields);
  const th = cols.map(c => `<th style="text-align:left;padding:4px 8px;border-bottom:1px solid #ccc;">${escapeHtml(c)}</th>`).join('');
  const trs = rows.map(r => {
    const tds = cols.map(c => {
      const v = r?.[c];
      const s = v == null ? '' : (typeof v === 'string' ? v : (typeof v === 'object' ? JSON.stringify(v) : String(v)));
      return `<td style="padding:4px 8px;border-bottom:1px solid #eee;">${escapeHtml(s)}</td>`;
    }).join('');
    return `<tr>${tds}</tr>`;
  }).join('');
  return `<table style="border-collapse:collapse;font-family:system-ui,Arial,sans-serif;font-size:13px;">`
    + `<thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`;
}

export function renderReport(rows: any[], format: ReportFormat, fields?: string[]): string {
  switch (format) {
    case 'json': return renderJson(rows);
    case 'html_table': return renderHtmlTable(rows, fields);
    case 'csv':
    default: return renderCsv(rows, fields);
  }
}

// ─── Subject templating (minimal {{var}}) ─────────────────────────

function renderSubject(template: string | undefined, vars: Record<string, string>): string {
  const tpl = template ?? '{{name}} — {{date}}';
  return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k) => vars[String(k)] ?? '');
}

// ─── Caller envelope ──────────────────────────────────────────────

/**
 * Why this module strips the operation-private keys before forwarding an
 * envelope — the LOCAL half of the argument.
 *
 * A report read asks about `report.object_name`, which is not necessarily the
 * object the caller's envelope last carried a `__`-prefixed depth for: a REST
 * request that touched another object before reaching `/reports/:id/run` hands
 * over an envelope plugin-security's middleware has already written into, and
 * that middleware only OVERWRITES `__readScope` when it resolves permission sets
 * for the new object (`if (permissionSets.length > 0)`). A stale depth therefore
 * survives into a question it was never resolved for.
 *
 * [#7204] The general rule — which keys those are, why they are dropped by
 * PREFIX rather than by a name list, and why the copy is load-bearing in both
 * directions — is `withoutOperationPrivateKeys` in `@objectstack/core`. It was
 * hand-copied into this file, `plugin-audit`'s comment kit and
 * `service-storage`'s attachment kit before #7284 gave it one owner; ⛔ import
 * it, never re-derive it locally (`operation-private-keys.pin.test.ts` catches
 * the fourth copy).
 */

// ─── Service ──────────────────────────────────────────────────────

/**
 * Resolves a saved report's owner (`owner_id`) into a real, RLS-bearing
 * `ExecutionContext` so a **scheduled** report executes under the owner's
 * authority — the same rows the owner would see interactively — instead of
 * bypassing RLS with a system context. Returns `null` when the owner cannot
 * be resolved (unknown/disabled user), in which case the scheduler fails the
 * run closed rather than running elevated (#2849 / #2980). Supplying this
 * resolver is the reports-surface consumer of ADR-0073's user-less identity
 * resolution.
 */
export type OwnerContextResolver = (
  ownerId: string,
) => Promise<ExecutionContext | null>;

export interface ReportServiceOptions {
  engine: ReportEngine;
  email?: ReportEmail;
  clock?: ReportClock;
  logger?: { info?: (msg: any, ...rest: any[]) => void; warn?: (msg: any, ...rest: any[]) => void; error?: (msg: any, ...rest: any[]) => void };
  /** Cap rows per report to protect both DB and email size. */
  maxRows?: number;
  /**
   * Resolves a report owner into an RLS-bearing context for scheduled runs
   * (see {@link OwnerContextResolver}). When omitted, scheduled reports fail
   * closed instead of running with RLS bypassed (#2980).
   */
  resolveOwnerContext?: OwnerContextResolver;
  /**
   * [#3544 / #3710] The user-level export axis —
   * `ISecurityService.canExport(object, context)`, wired by the reports plugin
   * from `getService('security')`.
   *
   * A report rendered as `csv`/`json` IS a bulk machine-readable copy of the
   * object, so it is the same privilege `GET /data/:object/export` gates.
   * Without this the axis had a side door: a caller refused at that route could
   * save a report on the same object, run it as CSV — or schedule one to their
   * own inbox — and receive the identical rows.
   *
   * Omitted (no `plugin-security`, so no permission sets exist anywhere) → the
   * axis does not apply, matching the REST export route's own fail-open.
   */
  canExport?: (object: string, context: unknown) => Promise<boolean>;
}

/**
 * [#3544 / #3710] Report formats that constitute a BULK EXPORT rather than a
 * rendering.
 *
 * `csv`/`json` are machine-readable copies — re-importable elsewhere, and
 * exactly what `GET /data/:object/export` serves. `html_table` is a PRESENTED
 * view: the report equivalent of reading rows on screen, which any caller
 * holding `allowRead` may already do. Gating it would restrict reading rather
 * than exporting and would take the axis past what it is for.
 */
const BULK_EXPORT_FORMATS: ReadonlySet<string> = new Set(['csv', 'json']);

export class ReportService implements IReportService {
  private readonly engine: ReportEngine;
  private readonly email?: ReportEmail;
  private readonly clock: ReportClock;
  private readonly logger: NonNullable<ReportServiceOptions['logger']>;
  private readonly maxRows: number;
  private readonly resolveOwnerContext?: OwnerContextResolver;
  private readonly canExportFn?: (object: string, context: unknown) => Promise<boolean>;

  constructor(opts: ReportServiceOptions) {
    this.engine = opts.engine;
    this.email = opts.email;
    this.clock = opts.clock ?? { now: () => new Date() };
    this.logger = opts.logger ?? {};
    this.maxRows = Math.max(1, opts.maxRows ?? 5000);
    this.resolveOwnerContext = opts.resolveOwnerContext;
    this.canExportFn = opts.canExport;
  }

  /**
   * [#3544 / #3710] Gate a report rendering on the user-level export axis.
   *
   * Throws `EXPORT_NOT_PERMITTED` when the principal behind `context` may not
   * take a bulk copy of `object`. A no-op for non-bulk formats (`html_table`),
   * for a system context, and when no `canExport` is wired.
   *
   * Deliberately checked HERE — one place — rather than at each of the three
   * callers (`runReport`, the ad-hoc run, and the scheduled dispatch): a gate
   * per call site is how a fourth call site later ships ungated. `dispatchDue`
   * routes through `executeReport` too, so the scheduled CSV is covered by the
   * same line. (`scheduleReport` additionally pre-checks, so an author is
   * refused when they create the schedule rather than silently at 3am — but
   * that is UX, and THIS is the enforcement: a grant revoked after the schedule
   * was created must still stop the delivery.)
   *
   * Fails CLOSED on a throw — it resolves permission sets to decide, and a
   * resolution failure must never read as a grant (ADR-0049).
   */
  private async assertExportAllowed(
    object: string,
    format: string,
    context: ExecutionContext | undefined,
  ): Promise<void> {
    if (!BULK_EXPORT_FORMATS.has(format)) return;
    if (context?.isSystem) return;
    if (!this.canExportFn) return;
    let allowed: boolean;
    try {
      allowed = await this.canExportFn(object, context);
    } catch (err) {
      this.logger.warn?.('ReportService: canExport check failed — denying export', err);
      allowed = false;
    }
    if (!allowed) {
      throw new Error(
        `EXPORT_NOT_PERMITTED: exporting '${object}' as ${format} is not permitted for this user`,
      );
    }
  }

  // ── Access control ─────────────────────────────────────────────

  /**
   * Authorization for a saved-report row. `sys_saved_report` is a
   * protection-locked system object, so its rows are *read* with
   * `SYSTEM_CTX`; the caller's right to see/mutate a specific report is
   * enforced HERE, by owner match, not by the metadata read's own RLS —
   * otherwise any authenticated caller could read/delete/overwrite any
   * report by id (#2980). An explicit elevated context (`isSystem`) — the
   * scheduler / server tooling — sees everything.
   */
  private canAccessReport(row: { owner_id?: unknown } | null | undefined, context: ExecutionContext | undefined): boolean {
    if (!row) return false;
    if (context?.isSystem) return true;
    const userId = context?.userId;
    return !!userId && row.owner_id === userId;
  }

  /** Raw metadata read of a saved report by id (no authz — callers gate). */
  private async loadReportRow(reportId: string): Promise<any | null> {
    const rows = await this.engine.find('sys_saved_report', {
      where: { id: reportId }, limit: 1, context: SYSTEM_CTX,
    });
    return Array.isArray(rows) && rows[0] ? rows[0] : null;
  }

  /** Raw metadata read of a report schedule by id (no authz — callers gate). */
  private async loadScheduleRow(scheduleId: string): Promise<any | null> {
    const rows = await this.engine.find('sys_report_schedule', {
      where: { id: scheduleId }, limit: 1, context: SYSTEM_CTX,
    });
    return Array.isArray(rows) && rows[0] ? rows[0] : null;
  }

  // ── Report CRUD ────────────────────────────────────────────────

  async saveReport(input: SaveReportInput, context: ExecutionContext): Promise<SavedReport> {
    if (!input.name) throw new Error('VALIDATION_FAILED: name is required');
    if (!input.object) throw new Error('VALIDATION_FAILED: object is required');
    if (!input.query) throw new Error('VALIDATION_FAILED: query is required');

    const now = this.clock.now().toISOString();
    // A non-system caller always owns what they create — a caller-supplied
    // ownerId cannot assign the report to someone else (#2980). Only an
    // explicit elevated context (server tooling / import) may set it.
    const ownerId = context.isSystem ? (input.ownerId ?? context.userId ?? null) : (context.userId ?? null);
    const payload: any = {
      name: input.name,
      description: input.description ?? null,
      object_name: input.object,
      query_json: JSON.stringify(input.query ?? {}),
      format: input.format ?? DEFAULT_FORMAT,
      owner_id: ownerId,
      updated_at: now,
    };

    if (input.id) {
      const existing = await this.loadReportRow(input.id);
      if (existing) {
        // An update to an existing report is a mutation — a caller may only
        // overwrite a report they own (#2980). Not-found for others so the
        // response doesn't leak that the id exists.
        if (!this.canAccessReport(existing, context)) {
          throw new Error(`REPORT_NOT_FOUND: ${input.id}`);
        }
        // Never let a non-system caller reassign ownership away from the row.
        if (!context.isSystem) payload.owner_id = existing.owner_id ?? payload.owner_id;
        await this.engine.update('sys_saved_report', { id: input.id, ...payload }, { context: SYSTEM_CTX });
        return rowFromSaved({ ...existing, ...payload, id: input.id });
      }
    }

    const id = input.id ?? uid('rpt');
    const row = { id, ...payload, created_at: now };
    await this.engine.insert('sys_saved_report', row, { context: SYSTEM_CTX });
    return rowFromSaved(row);
  }

  async listReports(
    filter: { object?: string; ownerId?: string } | undefined,
    context: ExecutionContext,
  ): Promise<SavedReport[]> {
    const f: any = {};
    if (filter?.object) f.object_name = filter.object;
    // Owner scoping (#2980): a non-system caller sees ONLY their own reports —
    // a caller-supplied ownerId can never widen past their own id. A caller
    // with no identity sees nothing (fail closed). System/tooling sees all,
    // honouring an explicit ownerId narrow.
    if (context?.isSystem) {
      if (filter?.ownerId) f.owner_id = filter.ownerId;
    } else {
      if (!context?.userId) return [];
      if (filter?.ownerId && filter.ownerId !== context.userId) return [];
      f.owner_id = context.userId;
    }
    const rows = await this.engine.find('sys_saved_report', {
      where: f, limit: 500, orderBy: [{ field: 'updated_at', order: 'desc' }], context: SYSTEM_CTX,
    });
    return Array.isArray(rows) ? rows.map(rowFromSaved) : [];
  }

  async getReport(reportId: string, context: ExecutionContext): Promise<SavedReport | null> {
    const row = await this.loadReportRow(reportId);
    // Unauthorized reads are indistinguishable from a genuine miss (#2980).
    if (!this.canAccessReport(row, context)) return null;
    return rowFromSaved(row);
  }

  async deleteReport(reportId: string, context: ExecutionContext): Promise<void> {
    if (!reportId) throw new Error('VALIDATION_FAILED: reportId is required');
    const row = await this.loadReportRow(reportId);
    if (!row) return; // idempotent — nothing to drop
    // A caller may only delete a report they own (#2980); others get a
    // not-found so the delete neither fires nor reveals the report's existence.
    if (!this.canAccessReport(row, context)) {
      throw new Error(`REPORT_NOT_FOUND: ${reportId}`);
    }
    // Cascade — drop attached schedules first.
    const schedules = await this.engine.find('sys_report_schedule', {
      where: { report_id: reportId }, limit: 500, context: SYSTEM_CTX,
    });
    for (const s of (schedules ?? [])) {
      await this.engine.delete('sys_report_schedule', { where: { id: (s as any).id }, context: SYSTEM_CTX });
    }
    await this.engine.delete('sys_saved_report', { where: { id: reportId }, context: SYSTEM_CTX });
  }

  // ── Execution ───────────────────────────────────────────────────

  async run(reportId: string, context: ExecutionContext): Promise<ReportRunResult> {
    const report = await this.getReport(reportId, context);
    if (!report) throw new Error(`REPORT_NOT_FOUND: ${reportId}`);
    return this.executeReport(report, context);
  }

  async runAdHoc(input: SaveReportInput, context: ExecutionContext): Promise<ReportRunResult> {
    if (!input.object) throw new Error('VALIDATION_FAILED: object is required');
    if (!input.query) throw new Error('VALIDATION_FAILED: query is required');
    const adhoc: SavedReport = {
      id: '__adhoc__',
      name: input.name ?? 'Ad-hoc report',
      object_name: input.object,
      query: input.query,
      format: input.format ?? DEFAULT_FORMAT,
    };
    return this.executeReport(adhoc, context, /* stamp */ false);
  }

  private async executeReport(
    report: SavedReport,
    context: ExecutionContext,
    stamp = true,
  ): Promise<ReportRunResult> {
    // [#3544 / #3710] The export axis, BEFORE any row is read — a refusal must
    // not be reachable after the data has already been pulled.
    await this.assertExportAllowed(report.object_name, report.format, context);
    const q = report.query ?? {};
    const limit = Math.min(q.limit ?? DEFAULT_LIMIT, this.maxRows);
    const rows = await this.engine.find(report.object_name, {
      where: q.filter,
      fields: q.fields,
      orderBy: q.orderBy,
      limit,
      // Reports execute with the caller's identity so sharing rules
      // (if installed) apply. Falls back to system bypass only when
      // the report definition was created by a system writer.
      //
      // [#7204] The WHOLE envelope, not a rebuilt subset of it — the #6206
      // ruling (#6523): a read that adjudicates on the caller's identity
      // adjudicates on the whole `resolveAuthzContext` envelope. The
      // five-field projection this replaced (`userId` / `tenantId` /
      // `positions` / `permissions` / `isSystem`) was doing two jobs, and
      // only one of them was correct:
      //
      //  - dropping the middleware-private keys — CORRECT, and preserved
      //    above by {@link withoutOperationPrivateKeys};
      //  - dropping the PRINCIPAL fields — the defect. `accessible_org_ids`
      //    (ADR-0105 D2) is the one that changes rows: `buildDriverOptions`
      //    reads it BY NAME to widen the driver's native tenant scope to the
      //    caller's membership union under the `group` posture, and an absent
      //    set makes drivers "fall back to equality: fail toward isolation".
      //    So the same query returned the union in an interactive list view
      //    and collapsed to active-org equality inside a saved or scheduled
      //    report — silently short rows, no error. `timezone` is read two
      //    lines up in the same engine method (`hasTz`) and again by
      //    `applyFormulaPlan` for read-time formula fields, and `posture`,
      //    `org_user_ids`, `systemPermissions` and `onBehalfOf` went the same
      //    way; they are forwarded now for the same reason — the envelope is
      //    the contract's unit.
      //
      // The three defaults below are byte-for-byte what the projection
      // produced for an envelope that omits them, and are kept so this change
      // adds fields without changing any that were already there.
      context: {
        ...withoutOperationPrivateKeys(context as unknown as Record<string, unknown>),
        positions: context.positions ?? [],
        permissions: context.permissions ?? [],
        isSystem: context.isSystem ?? false,
      },
    });
    const list = Array.isArray(rows) ? rows : [];
    const body = renderReport(list, report.format, q.fields);
    const ranAt = this.clock.now().toISOString();

    if (stamp && report.id !== '__adhoc__') {
      try {
        await this.engine.update('sys_saved_report', {
          id: report.id,
          last_run_at: ranAt,
          last_row_count: list.length,
          updated_at: ranAt,
        }, { context: SYSTEM_CTX });
      } catch (err) {
        this.logger.warn?.('ReportService: failed to stamp last_run_at', err);
      }
    }

    return {
      reportId: report.id,
      rowCount: list.length,
      format: report.format,
      body,
      rows: list,
      ranAt,
    };
  }

  // ── Schedules ──────────────────────────────────────────────────

  async scheduleReport(input: ScheduleReportInput, context: ExecutionContext): Promise<ReportSchedule> {
    if (!input.reportId) throw new Error('VALIDATION_FAILED: reportId is required');
    if (!input.recipients || input.recipients.length === 0) {
      throw new Error('VALIDATION_FAILED: recipients must be a non-empty array');
    }
    const report = await this.getReport(input.reportId, context);
    if (!report) throw new Error(`REPORT_NOT_FOUND: ${input.reportId}`);

    // [#3544 / #3710] Refuse a bulk-format schedule the author could not run
    // themselves, at CREATE time — otherwise the refusal only surfaces on the
    // first silent 3am sweep. Advisory only: `executeReport` re-checks on every
    // dispatch, which is what catches a grant revoked after this point.
    await this.assertExportAllowed(report.object_name, input.format ?? 'html_table', context);

    const now = this.clock.now();
    const interval = input.intervalMinutes ?? DEFAULT_INTERVAL_MIN;
    const cron = input.cronExpression?.trim() || null;
    if (cron) {
      // Validate eagerly so an author gets a clear error at schedule time
      // instead of a schedule that silently falls back to interval on sweep.
      try {
        new Cron(cron, { timezone: input.timezone || 'UTC' });
      } catch (err) {
        throw new Error(`VALIDATION_FAILED: invalid cron_expression '${cron}': ${(err as Error).message}`);
      }
    }
    const nextRun = this.nextRunAt(
      { cron_expression: cron, interval_minutes: interval, timezone: input.timezone ?? 'UTC' },
      now,
    ).toISOString();
    const id = uid('rsch');
    const row: any = {
      id,
      report_id: input.reportId,
      name: input.name ?? null,
      interval_minutes: interval,
      cron_expression: cron,
      timezone: input.timezone ?? 'UTC',
      active: input.active !== false,
      recipients: input.recipients.join(','),
      format: input.format ?? 'html_table',
      subject_template: input.subjectTemplate ?? null,
      owner_id: input.ownerId ?? context.userId ?? null,
      next_run_at: nextRun,
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
    };
    await this.engine.insert('sys_report_schedule', row, { context: SYSTEM_CTX });
    return rowFromSchedule(row);
  }

  async unscheduleReport(scheduleId: string, context: ExecutionContext): Promise<void> {
    if (!scheduleId) throw new Error('VALIDATION_FAILED: scheduleId is required');
    // A schedule is owned through its report (#2980): a caller may only delete
    // the schedules of a report they own. Others get a not-found so the delete
    // neither fires nor reveals the schedule's existence — deny-as-404, never a
    // cross-owner 2xx.
    //
    // [#7603] That intent used to have a hole one line wide. An id with no row
    // behind it returned early and silently — `if (!schedule) return; //
    // idempotent` — while another owner's id threw. The route maps those to 204
    // and 404, so a caller who could delete neither still learned which of the
    // two they had hit: an enumeration oracle over other owners' schedule ids,
    // the same one #7523 closed on `DELETE /reports/:id` in its 500-vs-204
    // costume. Idempotence is only harmless where every caller may see the row;
    // here it was the tell.
    //
    // Both deny arms are now ONE decision, taken before the delete fires, by the
    // predicate that is already blind to the difference between them:
    // `canAccessReport` is false for a schedule that does not exist, for one
    // whose report is gone, and for one owned by somebody else alike. A single
    // throw site means a single message, so the route's single `handleValidation`
    // call emits a single response — status and body cannot drift apart.
    //
    // Unlike `deleteReport`, this cannot be pre-empted in the route: the caller
    // presents a scheduleId, and `IReportService` exposes no by-id schedule read
    // to be blind with (`listSchedules` is keyed by reportId). The blinding has
    // to live here, which is why the contract now states it as an obligation
    // rather than leaving it to each implementation.
    const schedule = await this.loadScheduleRow(scheduleId);
    const report = schedule ? await this.loadReportRow(schedule.report_id) : null;
    if (!this.canAccessReport(report, context)) {
      throw new Error(`REPORT_NOT_FOUND: ${scheduleId}`);
    }
    await this.engine.delete('sys_report_schedule', { where: { id: scheduleId }, context: SYSTEM_CTX });
  }

  async listSchedules(
    filter: { reportId?: string } | undefined,
    context: ExecutionContext,
  ): Promise<ReportSchedule[]> {
    // Schedules are owned through their report (#2980): a non-system caller may
    // only list the schedules of a report they can access. The route always
    // supplies the parent report id; a caller who cannot see that report gets an
    // empty list — never another owner's recipients/cron — the same non-leaking
    // posture as listReports. System/tooling (the dispatcher) still sees all.
    if (!context?.isSystem) {
      if (!filter?.reportId) return [];
      if (!(await this.getReport(filter.reportId, context))) return [];
    }
    const f: any = {};
    if (filter?.reportId) f.report_id = filter.reportId;
    const rows = await this.engine.find('sys_report_schedule', {
      where: f, limit: 500, orderBy: [{ field: 'next_run_at', order: 'asc' }], context: SYSTEM_CTX,
    });
    return Array.isArray(rows) ? rows.map(rowFromSchedule) : [];
  }

  // ── Dispatcher ─────────────────────────────────────────────────

  async dispatchDue(now?: Date): Promise<{ fired: number; failed: number; skipped: number }> {
    const ts = (now ?? this.clock.now()).toISOString();
    const due = await this.engine.find('sys_report_schedule', {
      where: { active: true },
      limit: 200,
      context: SYSTEM_CTX,
    });
    const list = (Array.isArray(due) ? due : []).map(rowFromSchedule)
      .filter(s => !s.next_run_at || s.next_run_at <= ts);

    let fired = 0, failed = 0, skipped = 0;
    for (const schedule of list) {
      try {
        const row = await this.loadReportRow(schedule.report_id);
        if (!row) {
          skipped++;
          await this.markSchedule(schedule.id, {
            last_status: 'skipped',
            last_error: `report ${schedule.report_id} missing`,
          });
          continue;
        }
        const report = rowFromSaved(row);

        // Run the report under the OWNER's authority, not system (#2980).
        // A scheduled run must not read rows the report's owner cannot see —
        // that was a silent RLS bypass (a member's scheduled report emailed
        // the target object's entire table). Resolve the owner to a real
        // RLS-bearing context; if we can't (no resolver wired, or unknown/
        // disabled owner), FAIL CLOSED rather than run elevated.
        const ownerId = report.owner_id;
        const runContext = ownerId && this.resolveOwnerContext
          ? await this.resolveOwnerContext(ownerId).catch((err) => {
              this.logger.warn?.('ReportService.dispatchDue: owner context resolution failed', err);
              return null;
            })
          : null;
        if (!runContext) {
          failed++;
          await this.markSchedule(schedule.id, {
            last_status: 'failed',
            last_error: ownerId
              ? `owner '${ownerId}' context unavailable — refusing to run scheduled report with RLS bypassed (#2849/#2980)`
              : 'report has no owner — refusing to run scheduled report with RLS bypassed (#2849/#2980)',
          });
          continue;
        }

        // Force the schedule's own format so the recipient gets what
        // the admin configured (CSV attachment vs inline HTML table).
        const fmt: ReportFormat = (schedule.format ?? 'html_table') as ReportFormat;
        const result = await this.executeReport({ ...report, format: fmt }, runContext, false);

        const recipients = schedule.recipients.split(',').map(s => s.trim()).filter(Boolean);
        const subject = renderSubject(schedule.subject_template, {
          name: schedule.name ?? report.name,
          date: ts.slice(0, 10),
          rows: String(result.rowCount),
        });

        if (this.email && recipients.length > 0) {
          if (fmt === 'csv') {
            await this.email.send({
              to: recipients,
              subject,
              text: `Attached: ${result.rowCount} row(s).`,
              attachments: [{
                // Keep unicode letters (CJK schedule names) — only strip
                // filesystem-hostile characters, else 周报 becomes `__`.
                filename: `${(schedule.name ?? report.name).replace(/[^\p{L}\p{N}._-]+/gu, '_').replace(/^_+|_+$/g, '') || 'report'}-${ts.slice(0, 10)}.csv`,
                content: result.body,
                contentType: 'text/csv',
              }],
              relatedObject: 'sys_report_schedule',
              relatedId: schedule.id,
            });
          } else {
            await this.email.send({
              to: recipients,
              subject,
              html: `<p>${escapeHtml(report.name)} — ${result.rowCount} row(s)</p>${result.body}`,
              text: `${report.name} — ${result.rowCount} row(s)`,
              relatedObject: 'sys_report_schedule',
              relatedId: schedule.id,
            });
          }
        } else if (!this.email) {
          this.logger.warn?.('ReportService.dispatchDue: no email service — schedule fired but mail not sent');
        }

        await this.advanceSchedule(schedule, ts);
        fired++;
      } catch (err: any) {
        failed++;
        await this.markSchedule(schedule.id, {
          last_status: 'failed',
          last_error: String(err?.message ?? err ?? 'unknown').slice(0, 500),
        });
        this.logger.error?.('ReportService.dispatchDue: schedule failed', err);
      }
    }
    return { fired, failed, skipped };
  }

  /**
   * Compute the next fire time for a schedule. A `cron_expression` wins over
   * `interval_minutes` (the documented `sys_report_schedule` contract) and is
   * evaluated in the schedule's `timezone` (default UTC) via croner — the same
   * library the job scheduler uses. Falls back to `from + interval_minutes` for
   * interval schedules, and also if a cron expression is invalid or has no
   * future occurrence (logged; never throws into the sweep). `from` is the
   * reference instant (the injected clock), so `today()`-style boundaries honor
   * the test clock.
   */
  private nextRunAt(
    schedule: { cron_expression?: string | null; interval_minutes?: number | null; timezone?: string | null },
    from: Date,
  ): Date {
    const cron = (schedule.cron_expression ?? '').trim();
    if (cron) {
      try {
        const next = new Cron(cron, { timezone: schedule.timezone || 'UTC' }).nextRun(from);
        if (next) return next;
        this.logger.warn?.(`ReportService: cron '${cron}' has no next occurrence; falling back to interval`);
      } catch (err) {
        this.logger.warn?.(`ReportService: invalid cron '${cron}'; falling back to interval`, err);
      }
    }
    const interval = schedule.interval_minutes ?? DEFAULT_INTERVAL_MIN;
    return new Date(from.getTime() + interval * 60_000);
  }

  private async advanceSchedule(schedule: ReportSchedule, ranAt: string): Promise<void> {
    const nextRun = this.nextRunAt(schedule, this.clock.now()).toISOString();
    await this.engine.update('sys_report_schedule', {
      id: schedule.id,
      next_run_at: nextRun,
      last_sent_at: ranAt,
      last_status: 'ok',
      last_error: null,
      updated_at: ranAt,
    }, { context: SYSTEM_CTX });
  }

  private async markSchedule(id: string, patch: Record<string, unknown>): Promise<void> {
    try {
      await this.engine.update('sys_report_schedule', {
        id, ...patch, updated_at: this.clock.now().toISOString(),
      }, { context: SYSTEM_CTX });
    } catch (err) {
      this.logger.warn?.('ReportService: failed to mark schedule', err);
    }
  }
}
