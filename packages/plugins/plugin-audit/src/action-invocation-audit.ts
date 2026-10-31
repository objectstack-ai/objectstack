// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27908 — maintainer ruling 6513869839 on #27681, parameter 3] The
 * `action_invocation` row in the compliance ledger: one durable row per
 * business-action invocation, naming the door it came through.
 *
 * ## The gap this closes
 *
 * The ruling's sentence: "The audit row of an action run through MCP records
 * the surface, so an administrator can tell an agent's call from a click
 * without a second log." Before this writer, neither action door wrote a row
 * for the invocation itself. The script branch printed a `console.info
 * [action-audit]` line (a log line, not a ledger row), and the api, flow and
 * declarative-update branches printed nothing; `sys_audit_log` only held the
 * CRUD mirror's rows for whatever the action's body wrote, and those rows do
 * not say which door started the action.
 *
 * ## Who calls it
 *
 * The two action doors in `@objectstack/runtime` — the REST
 * `POST /actions/:object/:action` door and the `/mcp` bridge's `run_action` /
 * `resume_run` tools — on every branch (script, api, flow, declarative update),
 * once each call has cleared the door's admission gates and reached its
 * branch, whether the branch then succeeds or refuses. They resolve this
 * writer through the `audit` service slot (beside `recordAuthEvent`) and
 * hand over an EVENT, never a row: the row shape is this package's, for the
 * reason `auth-event-audit.ts` gives ("a second package hand-assembling
 * ledger rows would be a second de-facto definition of that shape").
 *
 * ## Where the surface comes from
 *
 * `event.context.surface` — `ExecutionContext.surface`, which the door sets
 * on the invocation's envelope from its own identity. This writer copies it
 * and never infers it: a row whose envelope names no surface records none
 * rather than guessing one from the principal (an MCP caller may hold a
 * human's API key or session, so `principalKind` cannot tell the doors apart).
 *
 * ## The row
 *
 *  - `action: 'action_invocation'`; `user_id` / `actor` / `tenant_id` from the
 *    invocation's envelope, with the CRUD mirror's rules (`actor` stays
 *    two-valued, ADR-0118 D1/D5);
 *  - `object_name` + `record_id`: the action's object and subject record when
 *    it has one, so the ledger's record read gate judges the row by the record
 *    (`audit-log-read-visibility.ts`); an object-less action names neither;
 *  - no `old_value` / `new_value`: an invocation is not a field diff, and the
 *    params the caller sent are not recorded (a param can carry a credential);
 *  - `metadata`: `surface`, `action_name`, `branch`, `outcome`, and on a
 *    failure the HTTP `status` and the error's machine code; `run_id` for a
 *    `resume_run`; and `performed_by` / `on_behalf_of` when an agent performed
 *    the call (ADR-0090 D10 rule 4, the same pair the CRUD mirror writes).
 */

import type { IDataEngine } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { isMissingTableError } from '@objectstack/types';
import {
  auditFailureCauseKey,
  auditFailureCauseSummary,
  createFieldPresenceProbe,
} from './audit-writers.js';
import type { AuthEventAuditLogger } from './auth-event-audit.js';

/** The `sys_audit_log.action` value this writer emits. */
export const ACTION_INVOCATION_AUDIT_ACTION = 'action_invocation' as const;

/**
 * Which dispatcher the invocation reached — the four branches both action
 * doors share. `update` is the declarative single-record write
 * (`operation: 'update'`).
 */
export type ActionInvocationBranch = 'script' | 'api' | 'flow' | 'update';

/** How the branch ended: it answered, or it threw / answered a refusal. */
export type ActionInvocationOutcome = 'succeeded' | 'failed';

/**
 * One action invocation, in the vocabulary of what HAPPENED. The door builds
 * it; this writer turns it into a row.
 */
export interface ActionInvocationAuditEvent {
  /**
   * The invocation's envelope: the caller's `ExecutionContext` with
   * `surface` set by the door. Read for `surface`, `userId`, `actor`,
   * `tenantId` and `performedBy` — nothing else.
   */
  context: Pick<ExecutionContext, 'surface' | 'userId' | 'actor' | 'tenantId' | 'performedBy'> | undefined;
  /** The action's declared name (the routed name for an undeclared one). */
  actionName: string;
  /** The action's object; absent for an object-less (global) action. */
  objectName?: string;
  /** The subject record, when the call named one. */
  recordId?: string;
  branch: ActionInvocationBranch;
  outcome: ActionInvocationOutcome;
  /** On a failure: the HTTP status the door answered. */
  status?: number;
  /** On a failure: the error's machine code, as the door answered it. */
  errorCode?: string;
  /** `resume_run` only: the paused run the call continued. */
  runId?: string;
}

/** What {@link createActionInvocationAuditWriter} adds to the `audit` slot. */
export interface ActionInvocationAuditWriter {
  /**
   * Record one invocation in `sys_audit_log`. Never throws — an audit write
   * must never change the answer an action call gets — and reports a lost row
   * loudly, once per cause.
   */
  recordActionInvocation(event: ActionInvocationAuditEvent): Promise<void>;
}

export interface ActionInvocationAuditWriterOptions {
  /** Resolve the data engine at CALL time — see `AuthEventAuditSinkOptions.getEngine`. */
  getEngine(): IDataEngine | undefined;
  logger?: AuthEventAuditLogger;
}

/** JSON that cannot throw on a cyclic/odd value — same rule as the CRUD writer. */
function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function nonEmpty(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}

/**
 * The row for one invocation — exported so the shape is pinned without an
 * engine. `objectHasField` answers whether the deployed ledger has the
 * conditionally-present `actor` column (`createFieldPresenceProbe`).
 */
export function buildActionInvocationAuditRow(
  event: ActionInvocationAuditEvent,
  objectHasField: (objectName: string, field: string) => boolean = () => true,
): Record<string, unknown> {
  const ctx = event.context ?? {};
  const userId = nonEmpty(ctx.userId);
  const performedBy = nonEmpty(ctx.performedBy?.clientId);
  const surface = ctx.surface === 'rest' || ctx.surface === 'mcp' ? ctx.surface : null;

  const metadata: Record<string, unknown> = {
    surface,
    action_name: event.actionName,
    branch: event.branch,
    outcome: event.outcome,
  };
  if (event.outcome === 'failed') {
    if (typeof event.status === 'number') metadata.status = event.status;
    const errorCode = nonEmpty(event.errorCode);
    if (errorCode) metadata.error_code = errorCode;
  }
  const runId = nonEmpty(event.runId);
  if (runId) metadata.run_id = runId;
  // [ADR-0090 D10 rule 4] The same pair, under the same names, the CRUD mirror
  // writes for a delegated write — present only when an agent performed the
  // call, so the two shapes stay distinguishable by absence.
  if (performedBy) {
    metadata.performed_by = performedBy;
    metadata.on_behalf_of = userId ?? null;
  }

  const objectName = nonEmpty(event.objectName);
  const row: Record<string, unknown> = {
    action: ACTION_INVOCATION_AUDIT_ACTION,
    user_id: userId ?? null,
    object_name: objectName ?? null,
    // A record id with no object to read it under is a pointer nobody can
    // judge, so it is dropped with the object.
    record_id: objectName ? (nonEmpty(event.recordId) ?? null) : null,
    old_value: null,
    new_value: null,
    // [ADR-0131 D7] The organization the invocation ran in — the attribution
    // column the `sys_audit_log_org` row policy scopes readers on.
    tenant_id: nonEmpty(ctx.tenantId) ?? null,
    metadata: safeStringify(metadata),
  };
  if (objectHasField('sys_audit_log', 'actor')) {
    // ADR-0014 D2's principal label, by the CRUD mirror's rule: the user, else
    // a service principal the host put on the envelope, else null.
    row.actor = userId ?? nonEmpty(ctx.actor) ?? null;
  }
  return row;
}

/** Create the action-invocation writer for the `audit` service slot. */
export function createActionInvocationAuditWriter(
  opts: ActionInvocationAuditWriterOptions,
): ActionInvocationAuditWriter {
  const { getEngine, logger } = opts;
  let probe: ((objectName: string, field: string) => boolean) | undefined;
  let probedEngine: IDataEngine | undefined;

  /**
   * Report a lost row — once per CAUSE (`auditFailureCauseKey`), the rule and
   * the reasons `auth-event-audit.ts` records for its own sink. A durability
   * degradation, so `error`, falling back to `warn`, never to silence.
   */
  const reportedCauses = new Set<string>();
  const reportWriteFailure = (event: ActionInvocationAuditEvent, err: unknown): void => {
    const detail = String((err as any)?.message ?? err);
    try {
      const cause = auditFailureCauseKey('sys_audit_log', err);
      if (reportedCauses.has(cause)) {
        logger?.debug?.('Action-invocation audit write failed (already reported)', {
          action: event.actionName,
          err: detail,
          cause,
        });
        return;
      }
      reportedCauses.add(cause);
      const message =
        `Action-invocation audit write FAILED (${auditFailureCauseSummary(err, detail)}) — the compliance trail ` +
        'is now INCOMPLETE. The action call itself was answered exactly as it would have been without the ' +
        'ledger, so nothing downstream looks broken; only the `sys_audit_log` row recording WHICH DOOR ' +
        '(REST or MCP) invoked the action, and who called it, never landed, and nothing retries it. Every ' +
        'later invocation failing THIS WAY loses its row the same way (this CAUSE is reported ONCE — raise ' +
        'the log level to `debug` to see the rest; a DIFFERENT cause gets its own `error` line). ' +
        (isMissingTableError(err, 'sys_audit_log')
          ? 'Fix: confirm `sys_audit_log` is reachable from the connection this write ran on — its ADR-0057 ' +
            '§3.6 lifecycle class routes it to the dedicated `telemetry` datasource whenever one is registered, ' +
            'so a "no such table" here usually means the write ran against a DIFFERENT datasource than the ' +
            'one the table was created in. Set `OS_TELEMETRY_DB=0` to keep every lifecycle-classed object on ' +
            'the primary datasource.'
          : 'Fix: resolve the driver fault quoted at the head of this line on the connection this write ran ' +
            'on — every action invocation that hits it loses its row until it is resolved.');
      if (logger?.error) {
        logger.error(message, err instanceof Error ? err : new Error(detail), { action: event.actionName });
      } else {
        logger?.warn?.(message, { action: event.actionName, err: detail });
      }
    } catch {
      /* logging must never break the action's answer */
    }
  };

  /**
   * Write the ledger row. A NAMED callee so `pnpm check:durability-log-level`
   * anchors on it (`DURABILITY_CRITICAL_CALLEES`): a later edit cannot walk
   * the failure report above back down to `warn`.
   */
  const persistActionInvocationAuditRow = async (
    engine: IDataEngine,
    row: Record<string, unknown>,
  ): Promise<void> => {
    await engine.insert('sys_audit_log', row, { context: { isSystem: true } });
  };

  return {
    async recordActionInvocation(event: ActionInvocationAuditEvent): Promise<void> {
      if (!event || typeof event.actionName !== 'string' || event.actionName === '') return;
      const engine = getEngine();
      if (!engine) return;
      if (probe === undefined || probedEngine !== engine) {
        probe = createFieldPresenceProbe(engine);
        probedEngine = engine;
      }
      const row = buildActionInvocationAuditRow(event, probe);
      try {
        await persistActionInvocationAuditRow(engine, row);
      } catch (err) {
        // #5226's class on the action seam: a DURABILITY degradation — the
        // action answered, the system looks normal, and the row that says
        // which door invoked it is simply absent.
        reportWriteFailure(event, err);
      }
    },
  };
}
