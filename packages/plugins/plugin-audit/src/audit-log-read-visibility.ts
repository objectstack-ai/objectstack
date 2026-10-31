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
 * under the LEDGER's own object grant and organization row scope (`tenant_id`,
 * ADR-0131 D7). The ledger has no owner column and its parent is a different
 * object on every row, so neither OWD/sharing nor RLS narrows it to the record:
 * a reader whose sets grant the ledger read was
 * served the rows about a record the data plane answers it `404` for — the
 * record's create, update and delete rows, whose snapshots keep every field the
 * field-level redaction (`audit-log-field-redaction.ts`) does not withhold.
 *
 * ## The rule
 *
 * The activity stream's gate (`activity-read-visibility.ts`), applied to the
 * ledger through the SAME mechanism, `parent-record-read-gate.ts`: a row naming
 * a record is served exactly when the caller may read that record — one
 * `ReadableIds` leaf per parent object, composed by the engine from the
 * caller's read scope (ADR-0139 D4), and the bounded probe for D5's two
 * remaining classes. ⛔ Nothing here derives row scope a second way. A composition or
 * driver refusal is the read's own failure (D3): it reaches the caller, never
 * this gate's deny-all sentinel.
 *
 * ## The ledger's row classes, measured per writer
 *
 *  - **Rows about a record** — they name `object_name` + `record_id`: the CRUD
 *    mirror's `create` / `update` / `delete` (`audit-writers.ts`), record-view
 *    `read` rows (`read-audit.ts`), plugin-auth's administrative `create` /
 *    `update` on a `sys_user`, the auth-event sink's `login` / `logout`,
 *    which name the session, and its `login_failed` / `account_locked`, which
 *    name the account's `sys_user` row (`auth-event-audit.ts`), and an
 *    `action_invocation` row whose action named a subject record
 *    (`action-invocation-audit.ts`). Judged by the record gate;
 *    the session is in the audit writer's `AUDIT_EXCLUDED_OBJECTS`, so the gate
 *    names it ({@link LEDGER_NAMED_PARENTS}) to keep judging it.
 *    A record that no longer exists is read by no caller, so its rows are
 *    excluded for every caller that is not system context and does not hold
 *    the audit capability below: every `delete` row, every other row about a
 *    deleted record, and every `logout` row (sign-out deletes the session it
 *    names).
 *  - **Rows about no record** — they name no `record_id` and their action is
 *    not a record action: the run-level `import` (plugin-auth's user import),
 *    `config_change` (service-settings) and `platform_admin_standing_change`
 *    (plugin-security) rows, an auth event that carried no session id, and an
 *    `action_invocation` row of an action invoked with no subject record.
 *    There is no record to judge, and none carries a record's field values
 *    (the per-writer measurement in `audit-log-field-redaction.ts`), so they
 *    are OUTSIDE this gate's class and are served under the ledger's own grant
 *    exactly as before — through a predicate on the ledger's own columns
 *    ({@link ledgerRowAboutNoRecordWhere}), so a broad read is served whole. This is where the ledger differs from the activity
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
 * ## The audit capability (#21260, ruling B on #21175)
 *
 * A caller holding {@link LEDGER_AUDIT_CAPABILITY} is not narrowed by this
 * gate: it is served the deletion and sign-out trail, the rows about records
 * it cannot open, and a broad read whole (nothing of the gate runs for it). It still needs the ledger's own object grant,
 * and the field redaction still narrows every snapshot it is served. Platform
 * administrators hold it by default (`ADMIN_FULL_ACCESS_CAPABILITIES` in
 * `@objectstack/spec`); every other position only by explicit grant. The
 * exemption is the shared mechanism's (`ParentRecordGate.exemptCapability`),
 * declared here and nowhere else: the activity stream's gate declares none.
 *
 * ## Deployment-level rows (#26750, ruling A)
 *
 * The ledger has no organization column (ADR-0131 D7): the organization a row
 * is about is the attribution field `tenant_id`, and a row about a
 * deployment-level action (a global settings change, the platform-admin
 * standing roster, a record of an object with no organization column) carries
 * it NULL. Those rows are served to the platform administrator alone, in every
 * tenancy posture, `single` included: every other non-system reader — an
 * organization administrator, a member whose sets grant the ledger, a holder
 * of {@link LEDGER_AUDIT_CAPABILITY} — is served only the rows about an
 * organization ({@link ledgerRowAboutAnOrganizationWhere}, ANDed into its
 * read). Under an organization wall the shipped row policy `sys_audit_log_org`
 * already excluded them for the shipped sets; this rule holds the same line
 * under `single`, where no wall is enforced and that policy is stripped, and
 * for a set that authors its own ledger row policy or the superuser read bypass
 * on the ledger, whose holder is no platform administrator.
 *
 * Which organization's rows a reader is served stays the row policy's answer
 * (`tenant_id == current_user.organization_id` under a wall); ⛔ this rule
 * derives no organization scope of its own (ADR-0131 D8).
 *
 * The platform administrator is the carried ADR-0095 D2/D3 posture rung
 * (`PLATFORM_OPERATOR_POSTURE`, `@objectstack/metadata-core`), never a held
 * capability or a position name: the rung is derived from the unscoped
 * `admin_full_access` grant, the evidence the superuser read bypass trusts, and
 * that bypass skips the security plugin's row policies but not this
 * middleware. A context that carries no rung is not the platform
 * administrator here (fail closed).
 *
 * System-context reads (the platform-admin standing boot reading its last
 * roster, the writers' own reads) and context-less programmatic calls are not
 * narrowed, as for every gate in this package: every real transport carries a
 * context.
 */

import { PLATFORM_OPERATOR_POSTURE } from '@objectstack/metadata-core';
import { SystemObjectName } from '@objectstack/spec/system';
import type { CommentAccessLogger, CommentReadMiddlewareCtx } from './comment-access-hooks.js';
import { LEDGER_RECORD_WRITE_ACTIONS } from './audit-log-field-redaction.js';
import { READ_AUDIT_ACTION } from './read-audit.js';
import {
  PARENT_GATE_READ_OPS,
  andIntoWhere,
  computeParentRecordFilter,
  type ParentObjectReadAdmissionSource,
  type ParentRecordGate,
  type ParentRecordGateEngine,
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

/**
 * [ADR-0139 D4] {@link isLedgerRowAboutNoRecord} as a WHERE on the ledger's own
 * columns — the outside class the gate ORs in beside its parent branches, so
 * the driver evaluates it, unbounded. A fresh tree per call. The two are one
 * statement in two forms, pinned row for row against a real driver in
 * `audit-log-read-visibility.integration.test.ts`.
 */
export function ledgerRowAboutNoRecordWhere(): Record<string, unknown> {
  return {
    $and: [
      // No record id: absent, null or empty.
      { $or: [{ record_id: null }, { record_id: '' }] },
      // An action, and not a record action. `$ne: null` first, so the
      // membership test is never asked of a null.
      { action: { $ne: null } },
      { action: { $nin: ['', ...LEDGER_RECORD_ACTIONS] } },
    ],
  };
}

/**
 * The compliance ledger's audit capability: its holder is exempt from this
 * gate. Declared in `PLATFORM_CAPABILITIES` (`@objectstack/spec/security`) and
 * granted by `ADMIN_FULL_ACCESS_CAPABILITIES`; this spelling is pinned against
 * both in `audit-log-read-visibility.test.ts`.
 */
export const LEDGER_AUDIT_CAPABILITY = 'view_all_audit_log';

/**
 * [#26750, ruling A] The ledger rows about an organization, as a WHERE on the
 * ledger's own attribution column: `tenant_id` present and not empty. Every
 * reader but the platform administrator reads through it (module header,
 * "Deployment-level rows"). A fresh tree per call. `$ne: null` is its own
 * clause, so the empty-string test is never asked of a null.
 */
export function ledgerRowAboutAnOrganizationWhere(): Record<string, unknown> {
  return { $and: [{ tenant_id: { $ne: null } }, { tenant_id: { $ne: '' } }] };
}

/**
 * [#26750, ruling A] Whether this caller is served the deployment-level ledger
 * rows: only the platform administrator, read as the carried posture rung
 * (module header, "Deployment-level rows"). Absent or any other rung: no.
 */
export function readsDeploymentLevelLedgerRows(context: CommentReadMiddlewareCtx['context']): boolean {
  return context?.posture === PLATFORM_OPERATOR_POSTURE;
}

/**
 * The parent the ledger's auth-event sink names (`auth-event-audit.ts`: a
 * `login` / `logout` row is about the session). It is in the audit writer's
 * `AUDIT_EXCLUDED_OBJECTS` — the CRUD mirror writes no row about a session —
 * so the gate names it, and a row about a session is served exactly when that
 * session is readable, as before ADR-0139 E5.
 */
export const LEDGER_NAMED_PARENTS: readonly string[] = [SystemObjectName.SESSION];

const LEDGER_GATE: ParentRecordGate = {
  object: LEDGER_OBJECT,
  seam: 'audit log read visibility',
  denyAll: { id: '__audit_log_parent_denied__' },
  outsideClass: { where: ledgerRowAboutNoRecordWhere },
  exemptCapability: LEDGER_AUDIT_CAPABILITY,
  namedParents: LEDGER_NAMED_PARENTS,
};

/**
 * Install the `sys_audit_log` read-visibility middleware.
 *
 * Inert on an engine without the middleware seam; `AuditPlugin` says so out
 * loud when that happens. `getAdmission` resolves, on every read, the security
 * service whose object-level read admission is asked before a parent object is
 * read as the caller (`parent-record-read-gate.ts`, "A skipped object is not
 * an access attempt").
 */
export function installAuditLogReadVisibility(
  engine: ParentRecordGateEngine,
  logger: CommentAccessLogger,
  getAdmission: ParentObjectReadAdmissionSource,
): void {
  if (typeof engine.registerMiddleware !== 'function') return;

  engine.registerMiddleware(
    async (ctx, next) => {
      // Only reads carry an `ast` to constrain; the object is append-only and
      // `apiMethods: ['get', 'list']`. System / context-less reads are internal.
      if (!PARENT_GATE_READ_OPS.has(ctx.operation) || !ctx.ast || !ctx.context || ctx.context.isSystem) {
        return next();
      }
      // [ADR-0139 D3] No catch: the gate answers its own probe's failure with
      // the deny-all sentinel, and a `ReadableIds` leaf is composed by the
      // engine after `next()`, so a composition or driver refusal is this
      // read's own failure and reaches the caller saying why — ⛔ never
      // turned into the deny-all sentinel here.
      const filter = await computeParentRecordFilter(engine, ctx, logger, LEDGER_GATE, getAdmission);
      if (filter) andIntoWhere(ctx, filter);
      // [#26750, ruling A] After the gate, which plans its parents off the
      // read's own `where`: the deployment-level rows, for the platform
      // administrator alone — the audit capability's holder included.
      if (!readsDeploymentLevelLedgerRows(ctx.context)) andIntoWhere(ctx, ledgerRowAboutAnOrganizationWhere());
      return next();
    },
    { object: LEDGER_OBJECT },
  );
}
