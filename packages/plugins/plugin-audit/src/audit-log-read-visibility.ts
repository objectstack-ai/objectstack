// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21175] sys_audit_log READ visibility: a ledger row about a record is
 * readable when that record is readable.
 *
 * ## The defect this closes
 *
 * Every door onto the compliance ledger reads it through the engine — the
 * Setup "Audit Logs" object view, the console's audit-log browser and a record
 * page's history tab all list `sys_audit_log` through the generic data API —
 * under the LEDGER's own object grant and tenant wall. The ledger has no owner
 * column and its parent is a different object on every row, so neither
 * OWD/sharing nor RLS narrows it: a reader whose sets grant the ledger read was
 * served the rows about a record the data plane answers it `404` for — the
 * record's create, update and delete rows, whose snapshots keep every field the
 * field-level redaction (`audit-log-field-redaction.ts`) does not withhold.
 *
 * ## The rule
 *
 * The activity stream's gate (`activity-read-visibility.ts`), applied to the
 * ledger through the SAME mechanism, `parent-record-read-gate.ts`: a row naming
 * a record is served exactly when the caller's own engine read of that record
 * finds it (`resolveReadableParentIds`, shared with the comment and activity
 * gates). ⛔ Nothing here derives row scope a second way.
 *
 * ## The ledger's row classes, measured per writer
 *
 *  - **Rows about a record** — they name `object_name` + `record_id`: the CRUD
 *    mirror's `create` / `update` / `delete` (`audit-writers.ts`), record-view
 *    `read` rows (`read-audit.ts`), plugin-auth's administrative `create` /
 *    `update` on a `sys_user`, and the auth-event sink's `login` / `logout`,
 *    which name the session (`auth-event-audit.ts`). Judged by the record gate.
 *    A record that no longer exists is read by no caller, so its rows are
 *    excluded for every caller that is not system context: every `delete` row,
 *    every other row about a deleted record, and every `logout` row (sign-out
 *    deletes the session it names).
 *  - **Rows about no record** — they name no `record_id` and their action is
 *    not a record action: the run-level `import` (plugin-auth's user import),
 *    `config_change` (service-settings) and `platform_admin_standing_change`
 *    (plugin-security) rows, and an auth event that carried no session id.
 *    There is no record to judge, and none carries a record's field values
 *    (the per-writer measurement in `audit-log-field-redaction.ts`), so they
 *    are OUTSIDE this gate's class and are served under the ledger's own grant
 *    exactly as before. This is where the ledger differs from the activity
 *    stream, which excludes every row naming no parent: the stream has no
 *    platform producer of such rows, while these have three, and the shipped
 *    `config_changes` list view reads two of them through the data door.
 *  - **A record action that names no record** — a `create` / `read` / `update`
 *    / `delete` row with no `record_id` (the CRUD mirror stamps `null` when it
 *    cannot derive the id): about a record the gate cannot name, so excluded
 *    (fail closed). Its snapshots may carry that record's field values.
 *  - A row naming a record under an object the engine does not know, under a
 *    name that is not a machine name, or under `sys_audit_log` itself is
 *    excluded, as in every parent-record gate.
 *
 * The field-level redaction composes with this gate unchanged: of the rows
 * this gate keeps, a snapshot still serves a parent field only to a reader the
 * security service serves that field unmasked.
 *
 * System-context reads (the platform-admin standing boot reading its last
 * roster, the writers' own reads) and context-less programmatic calls are not
 * narrowed, as for every gate in this package: every real transport carries a
 * context.
 */

import type { CommentAccessEngine, CommentAccessLogger } from './comment-access-hooks.js';
import { LEDGER_RECORD_WRITE_ACTIONS } from './audit-log-field-redaction.js';
import { READ_AUDIT_ACTION } from './read-audit.js';
import {
  PARENT_GATE_READ_OPS,
  andIntoWhere,
  computeParentRecordFilter,
  type ParentRecordGate,
} from './parent-record-read-gate.js';

const LEDGER_OBJECT = 'sys_audit_log';

/**
 * The ledger actions that are about a record: the CRUD mirror's record writes
 * and the record-view `read`. A row of one of these is always judged by the
 * record it names, and excluded when it names none.
 */
export const LEDGER_RECORD_ACTIONS = [...LEDGER_RECORD_WRITE_ACTIONS, READ_AUDIT_ACTION] as const;

const RECORD_ACTIONS = new Set<string>(LEDGER_RECORD_ACTIONS);

/**
 * Whether a ledger row that names no authorizable parent record is OUTSIDE the
 * record gate's class: it names no record at all, and its action is not a
 * record action. A row that names a record id the gate cannot authorize (no
 * or a malformed `object_name`, the ledger itself) is NOT — that is a record
 * the gate cannot judge, and it is excluded.
 */
export function isLedgerRowAboutNoRecord(row: Record<string, unknown>): boolean {
  const recordId = row.record_id;
  if (recordId !== undefined && recordId !== null && String(recordId) !== '') return false;
  const action = row.action;
  return typeof action === 'string' && action !== '' && !RECORD_ACTIONS.has(action);
}

const LEDGER_GATE: ParentRecordGate = {
  object: LEDGER_OBJECT,
  seam: 'audit log read visibility',
  denyAll: { id: '__audit_log_parent_denied__' },
  outsideClass: { fields: ['action'], test: isLedgerRowAboutNoRecord },
};

/**
 * Install the `sys_audit_log` read-visibility middleware.
 *
 * Inert on an engine without the middleware seam; `AuditPlugin` says so out
 * loud when that happens.
 */
export function installAuditLogReadVisibility(
  engine: CommentAccessEngine,
  logger: CommentAccessLogger,
): void {
  if (typeof engine.registerMiddleware !== 'function') return;

  engine.registerMiddleware(
    async (ctx, next) => {
      // Only reads carry an `ast` to constrain; the object is append-only and
      // `apiMethods: ['get', 'list']`. System / context-less reads are internal.
      if (!PARENT_GATE_READ_OPS.has(ctx.operation) || !ctx.ast || !ctx.context || ctx.context.isSystem) {
        return next();
      }
      try {
        const filter = await computeParentRecordFilter(engine, ctx, logger, LEDGER_GATE);
        if (filter) andIntoWhere(ctx, filter);
      } catch (err) {
        // A filter-compute failure must never fall open into a leak.
        logger.warn(
          `[audit] audit log read visibility: filter failed, denying all (${(err as Error)?.message ?? err})`,
        );
        andIntoWhere(ctx, LEDGER_GATE.denyAll);
      }
      return next();
    },
    { object: LEDGER_OBJECT },
  );
}
