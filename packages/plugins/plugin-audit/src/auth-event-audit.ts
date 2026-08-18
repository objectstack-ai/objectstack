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
 * {@link AuthSessionAuditAction} is a closed literal union rather than
 * `string`, and why the caller hands over an EVENT (what happened) instead of a
 * row (what to store).
 *
 * ## Who calls it
 *
 * `AuditPlugin` registers this sink under the `audit` service slot; plugin-auth
 * resolves it lazily through a locally-declared structural surface and calls it
 * from better-auth's session lifecycle hooks. Neither package depends on the
 * other — the same shape `audit-writers.ts` uses to reach messaging/i18n
 * without depending on those services.
 */

import type { IDataEngine } from '@objectstack/spec/contracts';
import { createFieldPresenceProbe } from './audit-writers.js';

/** The two auth session events the ledger records (`sys_audit_log.action`). */
export type AuthSessionAuditAction = 'login' | 'logout';

/**
 * One auth session event, in the vocabulary of what HAPPENED rather than of
 * what to store. Everything but `action` and `userId` is optional: an event
 * missing its client fingerprint is still worth recording, and a partial row
 * beats no row on a compliance ledger.
 */
export interface AuthSessionAuditEvent {
  /** Which event. Closed union — see the module note on the unvalidated enum. */
  action: AuthSessionAuditAction;
  /** The session's subject — a real `sys_user` id (the `user_id` lookup). */
  userId: string;
  /** The `sys_session` row this event is about, when known. */
  sessionId?: string;
  /** Tenant context — the session's active organization, when it has one. */
  organizationId?: string;
  /** Client fingerprint, as better-auth recorded it on the session row. */
  ipAddress?: string;
  userAgent?: string;
  /**
   * The principal that CAUSED the event, when it is not the subject — an
   * admin's user id on an impersonation session. Lands on `actor`, which the
   * schema defines as "Principal that performed the action", independent of the
   * `user_id` lookup. Absent → the subject acted for themselves.
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
   * The fallback channel for the durability report below. `error` is optional
   * here, so a sink that has none must still have somewhere to put a lost audit
   * row — reaching for `error` and finding nothing must degrade to `warn`,
   * never to silence (#9657). Signature and optionality mirror
   * `ReadAuditLogger` in `read-audit.ts`, which already declared it.
   */
  warn?(msg: string, meta?: Record<string, any>): void;
  debug?(msg: string, meta?: Record<string, any>): void;
}

/** What {@link createAuthEventAuditSink} registers under the `audit` slot. */
export interface AuthEventAuditSink {
  /**
   * Record one auth session event in `sys_audit_log`. Never throws — an audit
   * write must never turn a valid sign-in into an error — and reports a lost
   * row loudly (see {@link createAuthEventAuditSink}).
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

/** The object the auth-event rows name as their target. */
const SESSION_OBJECT = 'sys_session';

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
   * Report a lost auth-event row — once per process, not once per failure.
   *
   * Same discipline, and the same reason, as `reportAuditWriteFailure` in
   * `audit-writers.ts`: a systemic cause (the table is unreachable from this
   * connection) would otherwise emit one `error` per sign-in and train everyone
   * to skim the channel.
   */
  let failureReported = false;
  const reportAuthEventWriteFailure = (action: string, err: unknown): void => {
    const detail = String((err as any)?.message ?? err);
    try {
      if (failureReported) {
        logger?.debug?.('Auth-event audit write failed (already reported)', { action, err: detail });
        return;
      }
      failureReported = true;
      const message =
        'Auth-event audit write FAILED — the compliance trail is now INCOMPLETE. The sign-in/sign-out itself ' +
          'SUCCEEDED and the user holds a valid session, so the API returned 200 and nothing downstream looks ' +
          `broken; only the \`sys_audit_log\` row recording the ${action} never landed, and nothing retries it. ` +
          'Every subsequent auth event is likely losing its row the same way (this is reported ONCE — raise the ' +
          'log level to `debug` to see the rest). The shipped `auth_events` list view and the system-overview ' +
          'widgets read exactly these rows, so they will keep showing an empty, healthy-looking screen. ' +
          'Fix: confirm `sys_audit_log` is reachable from the connection this write ran on — its ADR-0057 §3.6 ' +
          'lifecycle class routes it to the dedicated `telemetry` datasource whenever one is registered (`os dev` ' +
          'provisions one by default as a SIBLING SQLite file), so a "no such table" here usually means the write ' +
          'executed against a DIFFERENT datasource than the one the table was created in. Set `OS_TELEMETRY_DB=0` ' +
          'to keep every lifecycle-classed object on the primary datasource.';
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
      const row: Record<string, unknown> = {
        action: event.action,
        // The whole point of the card: the event names its actor. `user_id` is
        // a strict `sys_user` lookup, and a session always has a real subject.
        user_id: event.userId,
        // The session this event is about, so the row is navigable from the
        // ledger to the session row (and back) rather than being a bare verb.
        object_name: SESSION_OBJECT,
        record_id: event.sessionId ?? null,
        // No before/after state: an auth event is not a field diff. Recording
        // `{}` here would be a claim about a record that never changed.
        old_value: null,
        new_value: null,
        ip_address: event.ipAddress ?? null,
        user_agent: event.userAgent ?? null,
        tenant_id: tenantId,
        metadata:
          event.context && Object.keys(event.context).length > 0 ? safeStringify(event.context) : null,
      };
      // Both columns are conditionally present — see `createFieldPresenceProbe`.
      // `organization_id` is what the SecurityPlugin's RLS predicate gates on,
      // so an unstamped row is a row non-admin members can never see.
      if (objectHasField('sys_audit_log', 'organization_id')) {
        row.organization_id = tenantId;
      }
      if (objectHasField('sys_audit_log', 'actor')) {
        // ADR-0014 D2's principal label. For an ordinary sign-in the subject IS
        // the principal; for an impersonation session the admin who started it
        // is, and recording the impersonated user as the sole principal there
        // would be a WRONG record rather than a vague one.
        row.actor = event.actor ?? event.userId;
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
