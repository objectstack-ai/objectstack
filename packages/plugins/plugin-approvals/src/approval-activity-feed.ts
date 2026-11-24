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
 * `reject`, `recall` — the hook appends one `sys_activity` row about that
 * record. Reading the decision log rather than calling in from each decision
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
 *    with the step's action kind and step label beside it;
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

/**
 * The approval steps the stream shows, each with the one-line summary its
 * entry is written with. A kind not listed (a reminder, a reassignment, a
 * thread comment, …) writes no entry.
 */
export const APPROVAL_ACTIVITY_STEPS: Readonly<Partial<Record<ApprovalActionKind, string>>> = Object.freeze({
  submit: 'Submitted for approval',
  approve: 'Approved',
  reject: 'Rejected',
  recall: 'Recalled the approval request',
});

/** `sys_activity.summary` holds at most this many characters. */
const SUMMARY_MAX = 500;

type Logger = {
  warn?: (msg: string, meta?: Record<string, unknown>) => void;
  error?: (msg: string, meta?: Record<string, unknown>) => void;
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
 * The summary an approval entry is written with: the step's line, then the
 * step's label where the step has one (`Approved · Manager review`).
 */
export function approvalActivitySummary(kind: string, stepLabel: unknown): string | null {
  const line = APPROVAL_ACTIVITY_STEPS[kind as ApprovalActionKind];
  if (!line) return null;
  const label = kind === 'approve' || kind === 'reject' ? text(stepLabel) : null;
  return (label ? `${line} · ${label}` : line).slice(0, SUMMARY_MAX);
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

  engine.registerHook('afterInsert', async (ctx: any) => {
    const action = ctx?.result as Record<string, unknown> | undefined;
    if (!action || typeof action !== 'object') return;
    // No activity stream on this deployment (no plugin-audit): nothing to write.
    if (!has(ACTIVITY_OBJECT, 'type')) return;
    const actorId = text(action.actor_id);
    const row = approvalActivityRow(action, actorId ? await actorOf(actorId) : { name: null, avatarUrl: null });
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
        { action: action.action, request: action.request_id, error: err?.message ?? String(err) },
      );
    }
  }, { object: APPROVAL_ACTION_OBJECT, packageId: APPROVAL_ACTIVITY_HOOK_PACKAGE, priority: 100 });
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
