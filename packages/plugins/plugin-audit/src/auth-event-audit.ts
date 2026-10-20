// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8144, sub-issue A of #7675] `login` / `logout` rows in the compliance
 * ledger — the writer half.
 *
 * ## The gap this closes
 *
 * `sys_audit_log.action` declared ten values when this landed. `audit-writers.ts`
 * subscribes to the ObjectQL wildcard `before*`/`after*` CRUD lifecycle, and its
 * `actionFor()` returns `'create' | 'update' | 'delete' | null` — so it emits
 * exactly those three and nothing else. Several of the declared values had no
 * writer anywhere in the repo. Two of them are auth session events, and the
 * whole trace a sign-in left behind was an **unattributed** `update sys_user`
 * row diffing `last_login_at` (`user_id` null). The shipped `auth_events` list
 * view and two `system_overview` dashboard widgets were therefore permanently
 * empty, by construction.
 *
 * ⚠ CORRECTION (#8315). This paragraph used to read that `audit-writers.ts`
 * "can emit `create`/`update`/`delete`/`restore` and nothing else". The
 * `restore` in that list was never true: `actionFor()`'s return type has no
 * `restore` arm and the caller early-returns on `null`, so the record-level
 * writer structurally cannot produce it, and no other writer in the repo did
 * either. The claim survived because it is a COMMENT — the exact #8011 shape,
 * a declaration sitting next to a mechanism with nothing enforcing it — and a
 * declaration-reading audit stopped here and scored `restore` as covered.
 * `restore` has since been retired from the enum (#8315); the sentence above
 * now names what `actionFor()`'s signature actually says.
 *
 * The enum-side invariant this paragraph is really about — every declared
 * action has a writer — is pinned mechanically in
 * `objects/sys-audit-log-retired-actions.test.ts`, not asserted here. A comment
 * is not a control; that is the whole lesson of this correction.
 *
 * ## Why the row is built HERE and not at the auth seam
 *
 * plugin-audit owns the `sys_audit_log` row shape — `packages/spec/src/system/
 * index.ts` records that explicitly when it retired `audit.zod`: "the LIVE
 * audit path (plugin-audit) captures unconditionally via engine hooks and
 * defines its own sys_audit_log row shape". A second package hand-assembling
 * ledger rows would be a second de-facto definition of that shape, drifting on
 * the day either side is fixed — the argument `audit-writers.ts` makes for
 * importing `SECRET_MASK` and `resolveDisplayField` rather than re-typing them.
 *
 * That matters more than usual on THIS object. Every `sys_audit_log` field is
 * `readonly`, and `validateRecord` skips readonly/system fields on both
 * branches (#8203), so **the `action` enum is a vocabulary nothing validates in
 * either direction**: a row with a misspelled action is accepted silently and
 * no test that merely watches for a throw can see it. The only structural
 * protection available is at authoring time, which is why
 * {@link AuthEventAuditAction} is a closed literal union rather than
 * `string`, and why the caller hands over an EVENT (what happened) instead of a
 * row (what to store).
 *
 * ## Who calls it
 *
 * `AuditPlugin` registers this sink under the `audit` service slot; plugin-auth
 * resolves it lazily through a locally-declared structural surface and calls it
 * from better-auth's session lifecycle hooks and from its password sign-in
 * outcome. Neither package depends on the other — the same shape
 * `audit-writers.ts` uses to reach messaging/i18n without depending on those
 * services.
 *
 * ## Two classes of auth event, two row targets
 *
 *  - **Session events** (`login`, `logout`) are about a SESSION: the row names
 *    `sys_session` and the session id, and `actor` defaults to the subject,
 *    who acted for themselves unless an impersonating admin is named.
 *  - **Account events** (`login_failed`, `account_locked`) are about an
 *    ACCOUNT and exist without any session: a refused sign-in mints none, and
 *    a lockout is a state of the `sys_user` row. The row names `sys_user` and
 *    the account's id, so it is navigable to the account and judged by the
 *    ledger's record read gate exactly as any row about a user is. `actor` is
 *    left null: a refused attempt authenticated nobody, so no principal can be
 *    credited with it, and recording the account holder there would claim
 *    they made the attempt.
 *
 * ⛔ An account event never carries the attempted credential, in any form.
 * Its `context` is the endpoint, the refusal's machine code and, for a
 * lockout, the lock's expiry and threshold — nothing the caller typed.
 */

import type { IDataEngine } from '@objectstack/spec/contracts';
import { isMissingTableError } from '@objectstack/types';
import {
  auditFailureCauseKey,
  auditFailureCauseSummary,
  createFieldPresenceProbe,
} from './audit-writers.js';

/** The two auth session events the ledger records (`sys_audit_log.action`). */
export type AuthSessionAuditAction = 'login' | 'logout';

/**
 * The two sign-in outcome events on an account (`sys_audit_log.action`): a
 * password sign-in that was refused, and the transition of an account into
 * the ADR-0069 D2 lockout.
 */
export type AuthAccountAuditAction = 'login_failed' | 'account_locked';

/** Every action this sink writes. */
export type AuthEventAuditAction = AuthSessionAuditAction | AuthAccountAuditAction;

/**
 * The account-event actions, as a value — the one place that decides which
 * actions take the account row target described in the module note.
 */
export const AUTH_ACCOUNT_AUDIT_ACTIONS: readonly AuthAccountAuditAction[] = [
  'login_failed',
  'account_locked',
];

const ACCOUNT_ACTIONS = new Set<string>(AUTH_ACCOUNT_AUDIT_ACTIONS);

/** Whether `action` is an account event (module note: "two row targets"). */
export function isAuthAccountAuditAction(action: unknown): action is AuthAccountAuditAction {
  return typeof action === 'string' && ACCOUNT_ACTIONS.has(action);
}

/**
 * One auth event, in the vocabulary of what HAPPENED rather than of what to
 * store. Everything but `action` and `userId` is optional: an event missing
 * its client fingerprint is still worth recording, and a partial row beats no
 * row on a compliance ledger.
 */
export interface AuthSessionAuditEvent {
  /** Which event. Closed union — see the module note on the unvalidated enum. */
  action: AuthEventAuditAction;
  /**
   * The event's subject — a real `sys_user` id (the `user_id` lookup): the
   * session's owner for a session event, the account the sign-in named for an
   * account event.
   */
  userId: string;
  /**
   * The `sys_session` row a SESSION event is about, when known. An account
   * event names its account instead (module note), so this is not read for
   * one.
   */
  sessionId?: string;
  /** Tenant context — the session's active organization, when it has one. */
  organizationId?: string;
  /**
   * Client fingerprint, by better-auth's own rule: the session row's values
   * for a session event, and the same resolution applied to the sign-in
   * request for an account event, which has no session row.
   */
  ipAddress?: string;
  userAgent?: string;
  /**
   * The principal that CAUSED the event, when it is not the subject — an
   * admin's user id on an impersonation session. Lands on `actor`, which the
   * schema defines as "Principal that performed the action", independent of the
   * `user_id` lookup. Absent → the subject acted for themselves on a session
   * event, and no principal is recorded on an account event (module note).
   */
  actor?: string;
  /**
   * Free-form context recorded in `metadata`, e.g. the better-auth endpoint
   * that produced the event (`/sign-in/email`, `/sign-out`).
   */
  context?: Record<string, unknown>;
}

/**
 * Minimal logger surface — structurally the kernel `ctx.logger` (`ILogger`),
 * declared locally so this module needs no import for two optional methods.
 */
export interface AuthEventAuditLogger {
  error?(msg: string, err?: Error, meta?: Record<string, any>): void;
  /**
   * The GUARANTEED fallback channel for the durability report below. `error` is
   * optional here, so a sink that has none must still have somewhere to put a
   * lost audit row — reaching for `error` and finding nothing must degrade to
   * `warn`, never to silence (#9657).
   *
   * This is the sink #9754's body calls the sharpest instance: it declared
   * `error?` and `debug?` and NO `warn` at all, so the call site below COULD NOT
   * have been written correctly against the contract it was given. #9750 added
   * `warn?`, which gave it something to reach for and still no guarantee it was
   * there; non-optional (#9754) is what makes the silence unrepresentable.
   * Signature and optionality mirror `ReadAuditLogger` in `read-audit.ts`.
   */
  warn(msg: string, meta?: Record<string, any>): void;
  debug?(msg: string, meta?: Record<string, any>): void;
}

/** What {@link createAuthEventAuditSink} registers under the `audit` slot. */
export interface AuthEventAuditSink {
  /**
   * Record one auth event in `sys_audit_log`. Never throws — an audit write
   * must never change the answer a sign-in gets — and reports a lost row
   * loudly (see {@link createAuthEventAuditSink}).
   */
  recordAuthEvent(event: AuthSessionAuditEvent): Promise<void>;
}

export interface AuthEventAuditSinkOptions {
  /**
   * Resolve the data engine at CALL time. Lazy because the sink is registered
   * during `init()` (that is what `providesServices` means) while the engine
   * only resolves at `kernel:ready`; every call happens at request time, long
   * after both.
   */
  getEngine(): IDataEngine | undefined;
  logger?: AuthEventAuditLogger;
}

/** The object a session event's row names as its target. */
const SESSION_OBJECT = 'sys_session';

/** The object an account event's row names as its target (module note). */
const ACCOUNT_OBJECT = 'sys_user';

/** The object the row for `action` is about. */
function targetObjectFor(action: unknown): string {
  return isAuthAccountAuditAction(action) ? ACCOUNT_OBJECT : SESSION_OBJECT;
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
 * Create the auth-event sink.
 *
 * The write goes through the engine under a system context: `sys_audit_log`
 * exposes only `get`/`list` on the API (creation happens via internal system
 * hooks only) and every field is `readonly`, so a user-context write would be
 * refused. This is the same posture `audit-writers.ts` takes with
 * `api.sudo()`.
 */
export function createAuthEventAuditSink(opts: AuthEventAuditSinkOptions): AuthEventAuditSink {
  const { getEngine, logger } = opts;
  let probe: ((objectName: string, field: string) => boolean) | undefined;
  let probedEngine: IDataEngine | undefined;

  /**
   * Report a lost auth-event row — once per CAUSE, not once per failed write.
   *
   * Same discipline, and the same reason, as `reportAuditWriteFailure` in
   * `audit-writers.ts`: a systemic cause (the table is unreachable from this
   * connection) would otherwise emit one `error` per sign-in and train everyone
   * to skim the channel. That much is unchanged, and ⛔ must stay — AGENTS.md
   * records the once-per-degradation rule as a deliberate anti-noise choice and
   * names 「log every failure at `error`」 as its falsifier.
   *
   * [#17452] What changed is the COUNTING UNIT, and it changed here for the
   * second time in this package: this file carried its OWN copy of the
   * process-wide boolean and its OWN fixed message literal, so #15166's fix to
   * `audit-writers.ts` did not reach it. Both copies had the same two defects.
   *
   *  1. One process-wide boolean means the first failure of ANY cause silences
   *     every later failure of every OTHER cause for the life of the process.
   *     The rule's unit is a DEGRADATION and a second cause is a second
   *     degradation, so the key is now the failure's identity —
   *     {@link auditFailureCauseKey}, imported rather than re-spelled. A repeat
   *     of an already-reported cause still degrades to `debug`, exactly as
   *     before; a NEW cause gets its own `error` line, once.
   *  2. The fixed literal printed the ADR-0057 §3.6 telemetry-datasource
   *     remedy for every cause, so a fault that had nothing to do with
   *     datasource routing sent its operator to check something that was
   *     working. ⛔ The guidance is not deleted and not weakened — it is the
   *     right remedy for the missing-table cause it was written for, and is now
   *     printed for exactly that cause, asked through the shared
   *     `isMissingTableError` predicate.
   *
   * ⛔ The key is built from the error's `code`, NEVER its message — see
   * {@link auditFailureCauseKey} for why that is what keeps the cause set
   * bounded by boot-declared vocabularies instead of by traffic.
   */
  const reportedAuthEventFailureCauses = new Set<string>();
  const reportAuthEventWriteFailure = (action: string, err: unknown): void => {
    const detail = String((err as any)?.message ?? err);
    try {
      // The object dimension of the shared key is the object these rows are
      // ABOUT (`object_name`), which is what `audit-writers.ts` passes too
      // (`ctx.object`). It takes two values on this seam (`sys_session` for a
      // session event, `sys_user` for an account event), so the key reduces to
      // the driver's code vocabulary twice over: bounded by construction, and
      // still the same key shape rather than a second one.
      const cause = auditFailureCauseKey(targetObjectFor(action), err);
      if (reportedAuthEventFailureCauses.has(cause)) {
        logger?.debug?.('Auth-event audit write failed (already reported)', {
          action,
          err: detail,
          cause,
        });
        return;
      }
      reportedAuthEventFailureCauses.add(cause);
      // `persistAuthEventAuditRow` writes ONE table, so the missing-table
      // question is asked about that one — unlike `persistAuditTrailRow`, which
      // writes the ledger row and its `sys_activity` mirror and asks about both.
      const missingTable = isMissingTableError(err, 'sys_audit_log');
      // What the caller saw is different for the two classes, and the line
      // must not tell an operator a refused sign-in "succeeded".
      const callerSaw = isAuthAccountAuditAction(action)
        ? 'The sign-in attempt itself was answered exactly as it would have been without the ledger, so ' +
          'nothing downstream looks broken'
        : 'The sign-in/sign-out itself SUCCEEDED and the user holds a valid session, so the API returned 200 ' +
          'and nothing downstream looks broken';
      const message =
        `Auth-event audit write FAILED (${auditFailureCauseSummary(err, detail)}) — the compliance trail is ` +
          `now INCOMPLETE. ${callerSaw}; only the \`sys_audit_log\` row recording the ` +
          `${action} never landed, and nothing retries it. Every subsequent auth event failing THIS WAY is ` +
          'losing its row the same way (this CAUSE is reported ONCE — raise the log level to `debug` to see ' +
          'the rest; a DIFFERENT cause gets its own `error` line). The shipped `auth_events` list view and the ' +
          'system-overview widgets read exactly these rows, so they will keep showing an empty, healthy-looking ' +
          'screen. ' +
          (missingTable
            ? 'Fix: confirm `sys_audit_log` is reachable from the connection this write ran on — its ADR-0057 ' +
              '§3.6 lifecycle class routes it to the dedicated `telemetry` datasource whenever one is registered ' +
              '(`os dev` provisions one by default as a SIBLING SQLite file), so a "no such table" here usually ' +
              'means the write executed against a DIFFERENT datasource than the one the table was created in. ' +
              'Set `OS_TELEMETRY_DB=0` to keep every lifecycle-classed object on the primary datasource.'
            : 'Fix: resolve the driver fault quoted at the head of this line on the connection this write ran ' +
              'on — every auth event that hits it loses its row until it is resolved.');
      // `error` is OPTIONAL on this sink, so `logger?.error?.(…)` printed
      // NOTHING when the host injected one without it — the durability
      // degradation this text describes would then be reported by nobody at
      // all (#9657). Reach for `error`, fall back to `warn`, never to silence.
      if (logger?.error) {
        logger.error(message, err instanceof Error ? err : new Error(detail), { action });
      } else {
        logger?.warn?.(message, { action, err: detail });
      }
    } catch {
      /* logging must never break the auth response */
    }
  };

  /**
   * Write the ledger row.
   *
   * Extracted as a NAMED callee so `pnpm check:durability-log-level` can anchor
   * on it — it is declared in that gate's `DURABILITY_CRITICAL_CALLEES` in the
   * same PR, so a future edit cannot quietly walk the failure report back down
   * to `warn`. A bare `.insert()` is far too generic a name to put in a
   * repo-wide vocabulary.
   */
  const persistAuthEventAuditRow = async (
    engine: IDataEngine,
    row: Record<string, unknown>,
  ): Promise<void> => {
    await engine.insert('sys_audit_log', row, { context: { isSystem: true } } as any);
  };

  return {
    async recordAuthEvent(event: AuthSessionAuditEvent): Promise<void> {
      const engine = getEngine();
      if (!engine || !event?.userId) return;
      if (probe === undefined || probedEngine !== engine) {
        probe = createFieldPresenceProbe(engine);
        probedEngine = engine;
      }
      const objectHasField = probe;

      const tenantId = event.organizationId ?? null;
      const accountEvent = isAuthAccountAuditAction(event.action);
      const row: Record<string, unknown> = {
        action: event.action,
        // The whole point of the card: the event names its actor. `user_id` is
        // a strict `sys_user` lookup, and a session always has a real subject.
        // On an account event it is the account the sign-in named.
        user_id: event.userId,
        // The record this event is about, so the row is navigable from the
        // ledger to it (and back) rather than being a bare verb: the session
        // for a session event, the account for an account event.
        object_name: targetObjectFor(event.action),
        record_id: accountEvent ? event.userId : (event.sessionId ?? null),
        // No before/after state: an auth event is not a field diff. Recording
        // `{}` here would be a claim about a record that never changed.
        old_value: null,
        new_value: null,
        ip_address: event.ipAddress ?? null,
        user_agent: event.userAgent ?? null,
        // [ADR-0131 D7] The ledger's attribution field, and the column its
        // `sys_audit_log_org` row policy scopes organization readers on.
        tenant_id: tenantId,
        metadata:
          event.context && Object.keys(event.context).length > 0 ? safeStringify(event.context) : null,
      };
      // `actor` is conditionally present — see `createFieldPresenceProbe`.
      if (objectHasField('sys_audit_log', 'actor')) {
        // ADR-0014 D2's principal label. For an ordinary sign-in the subject IS
        // the principal; for an impersonation session the admin who started it
        // is, and recording the impersonated user as the sole principal there
        // would be a WRONG record rather than a vague one. An account event
        // authenticated nobody, so it credits no principal (module note).
        row.actor = event.actor ?? (accountEvent ? null : event.userId);
      }

      try {
        await persistAuthEventAuditRow(engine, row);
      } catch (err) {
        // #5226's class, on the auth seam: a DURABILITY degradation, not a
        // functional one — the sign-in returned 200 and the session is on disk,
        // so the system looks completely normal from the outside while the
        // ledger entry that records WHO signed in is simply absent.
        reportAuthEventWriteFailure(event.action, err);
      }
    },
  };
}
