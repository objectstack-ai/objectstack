// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#35723] Approval steps on the record's activity stream.
 *
 * The record page's 动态 stream draws `sys_activity` rows. Until this module
 * nothing wrote one for an approval, so a record under approval showed no
 * approval in its activity: the stream's one-line approval entry (the
 * `approval` feed kind, with 「看审批」 opening the record's approvals) was
 * reachable only from items a host supplied by hand.
 *
 * ## The producer
 *
 * {@link bindApprovalActivityFeed}: an `afterInsert` hook on the decision log,
 * `sys_approval_action`. Every approval step already lands there, one row per
 * step, written by `ApprovalService` with the record it governs copied onto
 * the row (`object_name` + `record_id`, the request's pointer pair). For each
 * row of a kind in {@link APPROVAL_ACTIVITY_STEPS} — `submit`, `approve`,
 * `reject`, `recall`, `revise` (sent back for revision), `resubmit` and
 * `cancel` — the hook appends one `sys_activity` row about that record. Reading the decision log rather than calling in from each decision
 * method keeps `approval-service.ts` untouched, and a step the service learns
 * to record in a new place reaches the stream with no second call site.
 *
 * The row is shaped as ADR-0052 §5 says a domain event rides the ActivityPointer
 * model, so no published vocabulary moves:
 *
 *  - `type` stays domain-NEUTRAL: `system`, a built-in value only the platform
 *    may write (`SYS_ACTIVITY_PLATFORM_TYPES`; the app activity door refuses
 *    it), so an app cannot write a row that reads as an approval step;
 *  - the domain kind rides in `metadata.kind` ({@link APPROVAL_ACTIVITY_KIND}),
 *    with the step's action kind, its stored label, and the two machine names
 *    the label is translated by (`flow_name`, `step_name`) beside it;
 *  - `source_object` / `source_id` point at the request
 *    (`sys_approval_request`), the entity the entry drills to.
 *
 * The console reads exactly that triple as the `approval` feed kind
 * (`recordActivityFeed.ts` in `@object-ui/plugin-detail`, which restates the
 * three values because it cannot depend on this server plugin).
 *
 * The row carries no decision comment and no snapshot value: it is the one
 * line the stream draws, and the request's detail stays on the approvals tab.
 *
 * [#35723 L1 N2] An object with `enable.activities: false` gets no entry, as
 * the CRUD mirror writes none for it (`audit-writers.ts`): that flag stops
 * mirroring into the object's timeline and hides the timeline, so an entry
 * there would be written for no reader.
 *
 * ## In the reader's language
 *
 * `summary` is the line composed in English from this plugin's catalog
 * (`approvalActivity*` in `translations/messages.ts`, {@link APPROVAL_ACTIVITY_STEPS}),
 * the text every reader of the column without a locale is served — the shape
 * #26167 gave the CRUD mirror (`activity-summary-message.ts` in plugin-audit):
 * the sentence is stored with its CODE beside it (here the step's `action` and
 * the step's machine names in `metadata`), and a read re-composes it per
 * reader. {@link bindApprovalActivityLocale}, an engine middleware on
 * `sys_activity`, does that for a non-system read that carries a locale, with
 * the approvals door's own lookup (`readerLabelsFor`, `reader-locale-labels.ts`):
 * the sentence is `messages.approvalActivity*` in the reader's locale, and the
 * step label is `flows.<flow>.approvals.<node_id>.label` read the way the
 * approvals door reads it, else the stored label. ⛔ Nothing here is a second
 * negotiation or a second label rule. Nothing is re-composed for a system read,
 * a read with no locale or no `i18n` service, a key the locale's pack misses,
 * or a row whose `summary` the read was not served — the stored line stands.
 *
 * ## Who reads it
 *
 * The card's rule: an approval entry is read by the same users who can read
 * the record's approvals. `sys_activity`'s own gate (plugin-audit's
 * parent-record gate) keeps a row whenever its record is readable, which here
 * would switch the record-reader tier on for every object, against its default
 * OFF (`request-read-gate.ts` says why that gate is not this one).
 *
 * {@link bindApprovalActivityReadGate} therefore narrows `sys_activity` reads
 * once more, for the approval rows alone: a row whose `source_object` is
 * `sys_approval_request` is kept only when its `source_id` is a request the
 * approvals door would serve the caller. ⛔ Nothing here decides who may see a
 * request: the answer is the approvals service's own
 * ({@link RequestVisibilitySource}, the same source the generic door's gates on
 * the request tables read), and a read that names the record (`object_name` +
 * `record_id` both pinned, as the record page reads its stream) is asked with
 * that record, so an object that opted into the record-reader tier serves its
 * readers there too. Every other row passes untouched; plugin-audit's gate
 * still applies on top, so a reader must also be able to read the record.
 *
 * Added as a conjunct of `ast.where` on `find`, `findOne`, `count` and
 * `aggregate`, so the record page's `timeline` count and its rows agree. Fails
 * CLOSED for the approval rows only: when the source cannot answer, the read
 * keeps every other row and no approval row.
 *
 * ## What stays as it was
 *
 * A deployment without plugin-audit has no `sys_activity`; the hook then writes
 * nothing. A failed append never fails the approval step: the decision log row
 * is the record of the step, and the activity row a projection of it. The
 * failure is logged at `error` once, with what is lost and the fix.
 * `sys_activity` keeps its own lifecycle (entries are reaped after 14 days);
 * the approvals tab keeps the full history.
 */

import { createFieldPresenceProbe } from '@objectstack/metadata-core';
import type { ApprovalActionKind } from '@objectstack/spec/contracts';
import { pinnedEquality } from './payload-predicate-guard.js';
import { APPROVAL_REQUEST_OBJECT, type MiddlewareEngine } from './payload-redaction-middleware.js';
import { REQUEST_READ_OPS, type RequestVisibilitySource } from './request-read-gate.js';
import { approvalMessageKey, interpolate } from './approval-notification-text.js';
import { flowNameOfProcess, readerLabelsFor, type ReaderLabelI18n, type ReaderLabels } from './reader-locale-labels.js';
import { enMessages, type ApprovalMessageId } from './translations/messages.js';

/** The activity stream's table (plugin-audit's). */
export const ACTIVITY_OBJECT = 'sys_activity';

/** The decision log the producer reads. */
export const APPROVAL_ACTION_OBJECT = 'sys_approval_action';

/** `sys_activity.type` of an approval entry: domain-neutral and platform-only (ADR-0052 §5). */
export const APPROVAL_ACTIVITY_TYPE = 'system';

/** `metadata.kind` of an approval entry: the domain kind (ADR-0052 §5). */
export const APPROVAL_ACTIVITY_KIND = 'approval';

/** `sys_activity.source_object` of an approval entry: the request it drills to. */
export const APPROVAL_ACTIVITY_SOURCE_OBJECT = APPROVAL_REQUEST_OBJECT;

/** The hook package the producer binds under, so a second `start()` replaces it. */
export const APPROVAL_ACTIVITY_HOOK_PACKAGE = 'plugin-approvals:activity';

/** The catalog sentences of one step kind: its line, and for a decision at a step the twin naming the step. */
export interface ApprovalActivityStep {
  line: ApprovalMessageId;
  stepped?: ApprovalMessageId;
}

/**
 * The approval steps the stream shows, each with the catalog sentence its
 * entry is written with (`translations/messages.ts`). A kind not listed (a
 * reminder, a reassignment, a thread comment, …) writes no entry.
 */
export const APPROVAL_ACTIVITY_STEPS: Readonly<Partial<Record<ApprovalActionKind, ApprovalActivityStep>>> = Object.freeze({
  submit: { line: 'approvalActivitySubmitted' },
  approve: { line: 'approvalActivityApproved', stepped: 'approvalActivityApprovedStep' },
  reject: { line: 'approvalActivityRejected', stepped: 'approvalActivityRejectedStep' },
  recall: { line: 'approvalActivityRecalled' },
  revise: { line: 'approvalActivitySentBack', stepped: 'approvalActivitySentBackStep' },
  resubmit: { line: 'approvalActivityResubmitted' },
  cancel: { line: 'approvalActivityCancelled' },
});

/** `sys_activity.summary` holds at most this many characters. */
const SUMMARY_MAX = 500;

/** The kernel logger's slice used here (`Logger` in `@objectstack/spec/contracts`). */
type Logger = {
  warn: (message: string, meta?: Record<string, any>) => void;
  error?: (message: string, error?: Error, meta?: Record<string, any>) => void;
};

/** The engine slice the producer needs. */
export interface ApprovalActivityEngine {
  registerHook(event: string, handler: (ctx: any) => unknown, options?: Record<string, unknown>): void;
  unregisterHooksByPackage?(packageId: string): number;
  insert(object: string, data: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
  find(object: string, options?: Record<string, unknown>): Promise<unknown>;
  getSchema?(object: string): unknown;
}

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

/**
 * The catalog sentence of a step and its params: the step's twin naming the
 * step's label where the kind has one and a label is known
 * (`Approved · Manager review`), else its line. `null` for a kind the stream
 * does not show.
 */
export function approvalActivityMessage(
  kind: string,
  stepLabel: unknown,
): { id: ApprovalMessageId; params: Record<string, string> } | null {
  const step = Object.prototype.hasOwnProperty.call(APPROVAL_ACTIVITY_STEPS, kind)
    ? APPROVAL_ACTIVITY_STEPS[kind as ApprovalActionKind]
    : undefined;
  if (!step) return null;
  const label = step.stepped ? text(stepLabel) : null;
  return label && step.stepped ? { id: step.stepped, params: { step: label } } : { id: step.line, params: {} };
}

/** The summary an approval entry is written with: its catalog sentence in English ({@link approvalActivityMessage}). */
export function approvalActivitySummary(kind: string, stepLabel: unknown): string | null {
  const message = approvalActivityMessage(kind, stepLabel);
  return message ? interpolate(enMessages[message.id], message.params).slice(0, SUMMARY_MAX) : null;
}

/** What the entry names of the person who took the step. */
export interface ApprovalActivityActor {
  name: string | null;
  avatarUrl: string | null;
}

/**
 * The `sys_activity` row for one decision-log row, or `null` when the row is
 * not a step the stream shows or names no record.
 */
export function approvalActivityRow(
  action: Record<string, unknown>,
  actor: ApprovalActivityActor,
  flowName?: string | null,
): Record<string, unknown> | null {
  const kind = text(action.action);
  const object = text(action.object_name);
  const recordId = action.record_id == null ? null : String(action.record_id);
  const requestId = action.request_id == null ? null : String(action.request_id);
  if (!kind || !object || !recordId || !requestId) return null;
  const summary = approvalActivitySummary(kind, action.step_label);
  if (!summary) return null;
  const actorId = text(action.actor_id);
  const stepLabel = text(action.step_label);
  const stepName = text(action.step_name);
  const flow = text(flowName);
  return {
    type: APPROVAL_ACTIVITY_TYPE,
    timestamp: text(action.created_at) ?? new Date().toISOString(),
    summary,
    actor_id: actorId,
    ...(actorId && actor.name ? { actor_name: actor.name } : {}),
    ...(actorId && actor.avatarUrl ? { actor_avatar_url: actor.avatarUrl } : {}),
    object_name: object,
    record_id: recordId,
    source_object: APPROVAL_ACTIVITY_SOURCE_OBJECT,
    source_id: requestId,
    metadata: JSON.stringify({
      kind: APPROVAL_ACTIVITY_KIND,
      action: kind,
      ...(stepLabel ? { step_label: stepLabel } : {}),
      ...(flow && stepName ? { flow_name: flow, step_name: stepName } : {}),
    }),
  };
}

/**
 * Bind the producer: one `sys_activity` row per approval step written to
 * `sys_approval_action` (see the header).
 */
export function bindApprovalActivityFeed(engine: ApprovalActivityEngine, logger?: Logger): void {
  engine.unregisterHooksByPackage?.(APPROVAL_ACTIVITY_HOOK_PACKAGE);
  const has = createFieldPresenceProbe(engine);
  let reported = false;

  const actorOf = async (userId: string): Promise<ApprovalActivityActor> => {
    const none = { name: null, avatarUrl: null };
    try {
      const schema: any = engine.getSchema?.('sys_user');
      const titleField = typeof schema?.nameField === 'string' && has('sys_user', schema.nameField)
        ? schema.nameField
        : has('sys_user', 'name') ? 'name' : null;
      const avatarField = has('sys_user', 'image') ? 'image' : null;
      if (!titleField && !avatarField) return none;
      const rows = await engine.find('sys_user', {
        where: { id: userId },
        fields: ['id', ...(titleField ? [titleField] : []), ...(avatarField ? [avatarField] : [])],
        limit: 1,
        context: { isSystem: true },
      });
      const row: any = Array.isArray(rows) ? rows[0] : undefined;
      if (!row) return none;
      return {
        name: titleField ? text(row[titleField]) : null,
        avatarUrl: avatarField ? text(row[avatarField]) : null,
      };
    } catch {
      return none;
    }
  };

  /** The flow a request runs (`process_name` without `flow:`), the key its step label is translated by. */
  const flowOf = async (requestId: unknown, transaction: unknown): Promise<string | null> => {
    if (requestId == null) return null;
    try {
      const rows = await engine.find(APPROVAL_ACTIVITY_SOURCE_OBJECT, {
        where: { id: String(requestId) },
        fields: ['id', 'process_name'],
        limit: 1,
        context: { isSystem: true, ...(transaction != null ? { transaction } : {}) },
      });
      const row: any = Array.isArray(rows) ? rows[0] : undefined;
      return flowNameOfProcess(row?.process_name) ?? null;
    } catch {
      // The entry is still written, in its stored label only.
      return null;
    }
  };

  engine.registerHook('afterInsert', async (ctx: any) => {
    const action = ctx?.result as Record<string, unknown> | undefined;
    if (!action || typeof action !== 'object') return;
    // No activity stream on this deployment (no plugin-audit): nothing to write.
    if (!has(ACTIVITY_OBJECT, 'type')) return;
    if (!approvalActivityMessage(text(action.action) ?? '', null)) return;
    // [L1 N2] An object that opts out of its timeline gets no entry, as the CRUD mirror writes none.
    const governed = text(action.object_name);
    if (!governed || objectMutesActivities(engine, governed)) return;
    const actorId = text(action.actor_id);
    const row = approvalActivityRow(
      action,
      actorId ? await actorOf(actorId) : { name: null, avatarUrl: null },
      await flowOf(action.request_id, ctx?.transaction),
    );
    if (!row) return;
    const organizationId = text(action.organization_id);
    if (organizationId && has(ACTIVITY_OBJECT, 'organization_id')) row.organization_id = organizationId;
    try {
      await engine.insert(ACTIVITY_OBJECT, row, {
        context: {
          isSystem: true,
          ...(organizationId ? { tenantId: organizationId } : {}),
          ...(ctx?.transaction != null ? { transaction: ctx.transaction } : {}),
        },
      });
    } catch (err: any) {
      if (reported) return;
      reported = true;
      logger?.error?.(
        '[approvals] an approval step was recorded but its entry on the record\'s activity stream was not written — '
          + 'the approval itself stands and the approvals tab shows it, but the record\'s activity will keep looking '
          + 'complete without it; later failures are not logged again. Check that sys_activity (plugin-audit) is '
          + 'provisioned and writable on this datasource.',
        err instanceof Error ? err : undefined,
        { action: action.action, request: action.request_id, error: err?.message ?? String(err) },
      );
    }
  }, { object: APPROVAL_ACTION_OBJECT, packageId: APPROVAL_ACTIVITY_HOOK_PACKAGE, priority: 100 });
}

/** Whether `object` declares `enable.activities: false` (the spec default is on). */
function objectMutesActivities(engine: ApprovalActivityEngine, object: string): boolean {
  try {
    const def: any = engine.getSchema?.(object);
    return def?.enable?.activities === false;
  } catch {
    return false;
  }
}

/**
 * The conjunct that keeps every non-approval row and, of the approval rows,
 * those whose request is in `visible`; `null` (every request in scope) adds
 * none.
 */
export function approvalActivityVisibilityFilter(
  visible: ReadonlySet<string> | null,
): Readonly<Record<string, unknown>> | null {
  if (visible === null) return null;
  const notApproval = [
    { source_object: null },
    { source_object: { $ne: APPROVAL_ACTIVITY_SOURCE_OBJECT } },
  ];
  if (visible.size === 0) return { $or: notApproval };
  const ids = [...visible];
  return { $or: [...notApproval, { source_id: ids.length === 1 ? ids[0] : { $in: ids } }] };
}

/**
 * Bind the read gate on `sys_activity` that serves an approval entry only to a
 * caller the approvals door serves its request (see the header).
 */
export function bindApprovalActivityReadGate(
  engine: MiddlewareEngine,
  source: RequestVisibilitySource,
  logger?: Logger,
): void {
  engine.registerMiddleware(async (opCtx: any, next: () => Promise<void>) => {
    const ast = opCtx?.ast as { where?: unknown } | undefined;
    const context = opCtx?.context;
    if (!REQUEST_READ_OPS.has(opCtx?.operation) || !ast || !context) return next();
    let filter: Readonly<Record<string, unknown>> | null;
    try {
      const object = pinnedEquality(ast.where, 'object_name');
      const recordId = pinnedEquality(ast.where, 'record_id');
      const target = object !== null && recordId !== null ? { object, recordId } : undefined;
      filter = approvalActivityVisibilityFilter(await source.visibleRequestIdsFor(context, target));
    } catch (err: any) {
      logger?.warn?.(
        '[approvals] activity read gate could not resolve which approval requests the caller may see — '
          + 'the read is served without its approval entries (fail closed)',
        { operation: opCtx.operation, error: err?.message ?? String(err) },
      );
      filter = approvalActivityVisibilityFilter(new Set());
    }
    if (filter) ast.where = ast.where ? { $and: [ast.where, filter] } : filter;
    return next();
  }, { object: ACTIVITY_OBJECT });
}

/** The columns {@link localizeApprovalActivityRow} recognises an approval entry by. */
const RECOGNITION_COLUMNS = ['type', 'source_object', 'metadata'] as const;

/** A stored `metadata` value: a JSON object, or `null` for anything else. */
function metadataOf(raw: unknown): Record<string, unknown> | null {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Overlay an approval entry's served `summary` with its line in the reader's
 * language, in place: the step's catalog sentence through `labels`, its
 * `{{step}}` the step's label as the approvals door reads it, else the stored
 * label. Any other row, a row served without a `summary`, and a sentence the
 * reader's pack does not hold keep what they carry.
 */
export function localizeApprovalActivityRow(row: Record<string, unknown>, labels: ReaderLabels): void {
  if (typeof row.summary !== 'string' || !row.summary) return;
  if (row.type !== APPROVAL_ACTIVITY_TYPE || row.source_object !== APPROVAL_ACTIVITY_SOURCE_OBJECT) return;
  const metadata = metadataOf(row.metadata);
  if (!metadata || metadata.kind !== APPROVAL_ACTIVITY_KIND) return;
  const flow = text(metadata.flow_name);
  const node = text(metadata.step_name);
  const step = (flow && node ? labels.stepLabel(flow, node) : undefined) ?? text(metadata.step_label);
  const message = approvalActivityMessage(text(metadata.action) ?? '', step);
  if (!message) return;
  const line = labels.sentence(approvalMessageKey(message.id), message.params);
  if (line) row.summary = line.slice(0, SUMMARY_MAX);
}

/**
 * Bind the middleware that serves an approval entry's line in the reader's
 * language (see the header). `getI18n` is resolved on each read: the `i18n`
 * service is another plugin's and may start after this one. A read that
 * projects `summary` without the columns an entry is recognised by borrows
 * them for the read and takes them off every row before the rows go back.
 */
export function bindApprovalActivityLocale(
  engine: MiddlewareEngine,
  getI18n: () => ReaderLabelI18n | undefined,
  logger?: Logger,
): void {
  engine.registerMiddleware(async (opCtx: any, next: () => Promise<void>) => {
    if (opCtx?.operation !== 'find' && opCtx?.operation !== 'findOne') return next();
    const context = opCtx?.context;
    if (!context || context.isSystem) return next();
    let labels: ReaderLabels | undefined;
    try {
      labels = readerLabelsFor(getI18n(), context.locale);
    } catch {
      // The i18n service is optional and late-bound: the stored line stands.
      labels = undefined;
    }
    if (!labels) return next();
    const fields: unknown = opCtx.ast?.fields;
    const borrowed = Array.isArray(fields) && fields.length > 0 && fields.includes('summary')
      ? RECOGNITION_COLUMNS.filter((column) => !fields.includes(column))
      : [];
    if (borrowed.length > 0) opCtx.ast.fields = [...(fields as unknown[]), ...borrowed];
    await next();
    const result = opCtx.result;
    const rows: unknown[] = Array.isArray(result) ? result : result ? [result] : [];
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      try {
        localizeApprovalActivityRow(row as Record<string, unknown>, labels);
      } catch (err: any) {
        logger?.warn('[approvals] activity entry locale middleware failed — the stored line is served', {
          error: err?.message ?? String(err),
        });
      }
      for (const column of borrowed) delete (row as Record<string, unknown>)[column];
    }
  }, { object: ACTIVITY_OBJECT });
}
