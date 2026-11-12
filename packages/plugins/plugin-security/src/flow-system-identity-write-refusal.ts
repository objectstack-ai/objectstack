// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25251, ruling 6354966423, letter B] A flow's system elevation does not
 * reach identity assignment. [#25653, the same principle for the whole
 * family] Nor does a hook's `runAs: 'system'`, nor an action body's elevation.
 *
 * A `runAs: 'system'` run hands its data nodes the context
 * `{ isSystem: true, actor: 'svc:flow:NAME', flowRunId, … }`
 * (`resolveRunDataContext` in service-automation's `runtime-identity.ts`), and
 * the data middleware returns `next()` for `isSystem` ahead of every gate below
 * it — the ADR-0090 D12 delegated-administration gate among them. So such a run
 * wrote position holdings and permission-set grants that no gate judged and
 * that carry no `granted_by`, and invitation and membership rows that never
 * passed the invitation door's placement and role-cap checks.
 *
 * The rows of these four objects decide who holds which authority, and each
 * family has a door that judges a person: the D12 gate for the two assignment
 * tables, the organization endpoints for invitations and memberships. A flow is
 * app-authored automation, and `runAs` declares its authorization posture, not
 * an identity (ADR-0073 D2), so elevation does not lift those doors — the same
 * carve-out the maintainer made for the stored-metadata tables, whose
 * prescription says "Elevation (`runAs`, a system context) does not change
 * this."
 *
 * ## The predicate is the ruling's: `isSystem` AND `flowRunId`
 *
 * `flowRunId` is provenance, never a principal (`ExecutionContext.flowRunId`),
 * and the automation engine stamps it on every run's context. The platform's
 * own writers — the seeders, the publish materializer, better-auth and its
 * reconciliation, invitation placement, the organization-administrator grant —
 * each write under a `{ isSystem: true }` of their own that carries none, so
 * their path is unchanged. Truthiness on both, exactly as the bypass reads
 * `isSystem`: every context the bypass would admit and a run opened is judged.
 *
 * ## What is judged
 *
 * The verbs the D12 gate governs ({@link GOVERNED_OPERATIONS}) on the four
 * objects; reads are not judged, so a system flow still reads holdings
 * (approval routing does). The operation is judged as the engine hands it to
 * the middleware, at any depth: a write that the flow's own write sets off under
 * the same context — the `set_null` / `cascade` leg of a delete, an app-authored
 * hook body's `ctx.api` write — is the flow's write too, and is refused the same
 * way.
 *
 * A `runAs: 'user'` run carries `flowRunId` WITHOUT `isSystem`. It is not judged
 * here: it reaches the D12 gate as the user it acts for, which admits it and
 * stamps `granted_by`, or refuses it — the path the prescription names.
 *
 * ## The family: a hook that runs as system, and an action body
 *
 * Two other app-authored elevations carry `isSystem` and no run: a hook's
 * `runAs: 'system'` api (`ScopedContext.withRunAs`, objectql) and an action
 * body's `ctx.api` / `ctx.engine` (`buildActionExecutionContext`, runtime).
 * Each is derived with the app-automation elevation mark
 * (`appAutomationElevationOf`, `@objectstack/core`), and this predicate reads
 * it beside `flowRunId`: `isSystem` AND (`flowRunId` OR the mark).
 *
 * The same mark covers an app-authored hook's other elevations: a system
 * context it inherits when it declares no `runAs`, and its in-process
 * `ctx.api.sudo()` (`ScopedContext[APP_AUTHORED_HOOK_API]`, objectql), and an
 * action reached through `ctx.api.object(x).execute(y)` (`'action'`). A hook is
 * app-authored when it is bound through the hook binder (a metadata binding,
 * the line `skipAutomations` draws); a hook registered in code (audit,
 * security, any plugin's) is platform code. Platform code's `sudo()` and a
 * platform writer's bare system context carry no mark and pass as before. Under a hook's `runAs: 'user'` the context loses `isSystem`, and the
 * D12 gate judges the user it acts for, as for a `runAs: 'user'` run.
 *
 * A context carrying both a run and a mark (a `runAs: 'system'` hook fired by a
 * system flow's write) is answered as the flow, exactly as before the family
 * was added. Each source has its own prescription for the two assignment
 * tables: a flow and a hook set `runAs: 'user'`; an action body has no `runAs`,
 * so its grant moves to a `runAs: 'user'` flow, which an action of type `flow`
 * runs as the invoking user.
 *
 * The answer is the standard catalog's `PERMISSION_DENIED` (403), the code the
 * D12 gate and the identity write guard answer the same writes with; no code is
 * minted. The flow's write node fails with it, and the run's result hands it to
 * the run's caller as its inner refusal (`code` and `message`).
 */

import { appAutomationElevationOf, type AppAutomationElevation } from '@objectstack/core';

import { GOVERNED_OPERATIONS } from './delegated-admin-gate.js';
import { PermissionDeniedError } from './errors.js';

/** The identity-assignment objects app-authored automation's system elevation may not write. */
export const FLOW_SYSTEM_IDENTITY_WRITE_OBJECTS: ReadonlySet<string> = new Set([
  'sys_user_position',
  'sys_user_permission_set',
  'sys_invitation',
  'sys_member',
]);

/**
 * The two whose door is the D12 gate, so the remedy is `runAs: 'user'`. The
 * other two are better-auth's tables: the identity write guard refuses a user
 * context's write to them as well, so their remedy is the organization doors.
 */
const ASSIGNMENT_OBJECTS: ReadonlySet<string> = new Set(['sys_user_position', 'sys_user_permission_set']);

/** Which elevation wrote: a flow run, or an app-automation mark. */
type ElevationSource = 'flow' | AppAutomationElevation;

/** How each source is named in the refusal. */
const SUBJECT: Readonly<Record<ElevationSource, string>> = {
  flow: "a flow that runs as system (runAs: 'system')",
  hook: "a hook that runs as system (runAs: 'system', a system context it inherits, or ctx.api.sudo())",
  action: 'an action body (an action body runs as system)',
};

/** Whose elevation the refusal says does not lift the door. */
const ELEVATION: Readonly<Record<ElevationSource, string>> = {
  flow: "a flow's system elevation",
  hook: "a hook's system elevation",
  action: "an action body's system elevation",
};

const ASSIGNMENT_PRESCRIPTION: Readonly<Record<ElevationSource, string>> = {
  flow:
    "Set the flow's runAs to 'user': the delegated-administration gate then judges the user the run acts for, "
    + 'and records that user as the grant\'s granted_by.',
  hook:
    "Set the hook's runAs to 'user' and leave ctx.api.sudo() out: the delegated-administration gate then judges the user the hook acts for, "
    + 'and records that user as the grant\'s granted_by.',
  action:
    "Make the grant from a flow whose runAs is 'user', which an action of type 'flow' runs as the invoking user: "
    + 'the delegated-administration gate then judges that user, and records them as the grant\'s granted_by.',
};

const MEMBERSHIP_PRESCRIPTION =
  'Invitations and memberships change through the organization endpoints (POST /api/v1/auth/organization/'
  + 'invite-member, cancel-invitation, update-member-role, remove-member), which apply the invitation\'s '
  + 'placement and role-cap checks.';

/**
 * The elevation a system context's write comes from — a flow run, a hook's
 * `runAs: 'system'`, an action body — or `undefined` for every other context
 * (a platform writer's, a user's).
 */
function elevationSource(context: { isSystem?: unknown; flowRunId?: unknown } | null | undefined): ElevationSource | undefined {
  if (!context?.isSystem) return undefined;
  if (context.flowRunId) return 'flow';
  return appAutomationElevationOf(context);
}

/**
 * Refuse a governed write to {@link FLOW_SYSTEM_IDENTITY_WRITE_OBJECTS} from a
 * system context a flow run opened, an app-authored hook elevated, or an action
 * body runs under; return for every other operation.
 *
 * Called by the data middleware immediately before its `isSystem` bypass, so
 * the refused write never reaches the engine's write path.
 */
export function assertFlowSystemIdentityWriteAllowed(opCtx: {
  object?: unknown;
  operation?: unknown;
  context?: { isSystem?: unknown; flowRunId?: unknown } | null;
}): void {
  const source = elevationSource(opCtx?.context);
  if (!source) return;
  const object = typeof opCtx.object === 'string' ? opCtx.object : '';
  if (!FLOW_SYSTEM_IDENTITY_WRITE_OBJECTS.has(object)) return;
  const operation = typeof opCtx.operation === 'string' ? opCtx.operation : '';
  if (!GOVERNED_OPERATIONS.has(operation)) return;
  throw new PermissionDeniedError(
    `[Security] Access denied: '${operation}' on '${object}' from ${SUBJECT[source]} is refused — ` +
      'position holdings, permission-set grants, invitations and memberships are governed identity writes, ' +
      `and ${ELEVATION[source]} does not lift that. ` +
      (ASSIGNMENT_OBJECTS.has(object) ? ASSIGNMENT_PRESCRIPTION[source] : MEMBERSHIP_PRESCRIPTION),
    { operation, object },
  );
}

/**
 * [Ruling record 6787890900] App-authored automation's system elevation does
 * not change or delete the rows of an append-only object.
 *
 * An object declared `managedBy: 'append-only'` is a ledger: its rows record
 * what happened, and the platform service that owns the object writes them
 * (the audit and activity writers, the mail log, the job runner, the approval
 * engine). A flow that runs as system, a hook that runs as system and an
 * action body are app-authored, and their elevation is the one the identity
 * refusal above judges, read by the same predicate ({@link elevationSource}):
 * `isSystem` AND (`flowRunId` OR the app-automation mark). The set is the live
 * registry's `managedBy`, never a list of names, so an append-only object a
 * plugin registers tomorrow is covered the day it registers.
 *
 * ## What is judged
 *
 * This check covers the update, transfer, delete, purge and restore of an
 * append-only object's rows ({@link APPEND_ONLY_REFUSED_OPERATIONS}); an
 * insert is not judged by it, and reads are not judged. As with the identity
 * refusal, the operation is judged as the engine hands it to the middleware,
 * at any depth: a write the automation's own write sets off under the same
 * context is its write too.
 *
 * ## The reference clean-up leg (seat decision on the contract review)
 *
 * Deleting a record that a ledger row references makes the engine clear that
 * reference on the ledger row (the `set_null` leg), under the deleting
 * context and marked `__referentialFieldClear`. That leg is a change to an
 * append-only object made under the automation's elevation, so it is refused,
 * and the delete it serves is refused whole: nothing is written. The refusal
 * then names the delete, not the ledger write the author never wrote, and its
 * remedy is to keep the record rather than delete it.
 *
 * ## What is not
 *
 * The platform's own writers — the retention sweeper, the migrations and
 * backfills, the audit seal, every service writing under a system context of
 * its own — carry neither a run nor the mark, and pass as before.
 *
 * The answer is the standard catalog's `PERMISSION_DENIED` (403), the code
 * and status the identity refusal answers with; no code is minted.
 */
export const APPEND_ONLY_REFUSED_OPERATIONS: ReadonlySet<string> = new Set([
  'update',
  'transfer',
  'delete',
  'purge',
  'restore',
]);

/** The bucket {@link assertAppAutomationAppendOnlyWriteAllowed} reads. */
const APPEND_ONLY_BUCKET = 'append-only';

/**
 * Refuse a change or a delete of an append-only object's rows from a system
 * context a flow run opened, an app-authored hook elevated, or an action body
 * runs under; return for every other operation.
 *
 * `schemaOf` is asked only once the context is such an elevation and the verb
 * is judged, so the platform's own writes and every user's write cost no
 * registry lookup. Called by the data middleware beside
 * {@link assertFlowSystemIdentityWriteAllowed}, ahead of its `isSystem`
 * bypass, so the refused write never reaches the engine's write path.
 */
export function assertAppAutomationAppendOnlyWriteAllowed(
  opCtx: {
    object?: unknown;
    operation?: unknown;
    context?: { isSystem?: unknown; flowRunId?: unknown } | null;
  },
  schemaOf: (object: string) => { managedBy?: unknown } | null | undefined,
): void {
  const source = elevationSource(opCtx?.context);
  if (!source) return;
  const operation = typeof opCtx.operation === 'string' ? opCtx.operation : '';
  if (!APPEND_ONLY_REFUSED_OPERATIONS.has(operation)) return;
  const object = typeof opCtx.object === 'string' ? opCtx.object : '';
  if (!object || schemaOf(object)?.managedBy !== APPEND_ONLY_BUCKET) return;
  const cleanup = referenceCleanupOf(opCtx);
  if (cleanup) {
    throw new PermissionDeniedError(
      `[Security] Access denied: deleting ${cleanup.deleted ? `a '${cleanup.deleted}' record` : 'a record'} from ${SUBJECT[source]} is refused — ` +
        `deleting this record would change a record in an append-only ledger that references it ` +
        `('${object}'${cleanup.field ? `.${cleanup.field}` : ''}), and ${ELEVATION[source]} does not lift that. ` +
        `${APPEND_ONLY_SCOPE} Keep the record, and retire it (for example by marking it inactive) instead of deleting it.`,
      {
        operation: 'delete',
        ...(cleanup.deleted ? { object: cleanup.deleted } : {}),
        referencingObject: object,
        ...(cleanup.field ? { field: cleanup.field } : {}),
        managedBy: APPEND_ONLY_BUCKET,
      },
    );
  }
  throw new PermissionDeniedError(
    `[Security] Access denied: '${operation}' on '${object}' from ${SUBJECT[source]} is refused — ` +
      `'${object}' is append-only (managedBy: 'append-only'): its rows are a record of what happened, written ` +
      `by the platform service that owns it, and ${ELEVATION[source]} does not lift that. ` +
      `${APPEND_ONLY_SCOPE} Keep a value the automation must change on an object of its own.`,
    { operation, object, managedBy: APPEND_ONLY_BUCKET },
  );
}

/** The elevations and objects already told about, so each is said once per process. */
const appendOnlyInsertWarned = new Set<string>();

/**
 * The notice for an insert into an append-only object from app-authored
 * automation's system elevation (the elevation {@link elevationSource} names):
 * accepted for now, and to be refused when the insert half of the rule lands.
 * Said once per elevation kind and object per process, at `warn`: the write
 * still lands, so nothing is lost today, and the line names the doors that
 * replace the insert. Answers the line it logged, or `undefined`.
 */
export function warnAppAutomationAppendOnlyInsert(
  opCtx: {
    object?: unknown;
    operation?: unknown;
    context?: { isSystem?: unknown; flowRunId?: unknown } | null;
  },
  schemaOf: (object: string) => { managedBy?: unknown } | null | undefined,
  warn: (message: string) => void,
): string | undefined {
  const source = elevationSource(opCtx?.context);
  if (!source) return undefined;
  if (opCtx.operation !== 'insert') return undefined;
  const object = typeof opCtx.object === 'string' ? opCtx.object : '';
  if (!object || schemaOf(object)?.managedBy !== APPEND_ONLY_BUCKET) return undefined;
  const key = `${source}:${object}`;
  if (appendOnlyInsertWarned.has(key)) return undefined;
  appendOnlyInsertWarned.add(key);
  const line =
    `[Security] Deprecated: an insert into '${object}' from ${SUBJECT[source]} is accepted now and will be ` +
    `refused in a coming release — '${object}' is append-only, written by the platform service that owns it. ` +
    'Send mail with ctx.email.send (capability email.send) and add timeline entries with ctx.activity.append ' +
    '(capability activity.append) instead.';
  warn(line);
  return line;
}

/** Forget which elevations were told (tests). */
export function resetAppAutomationAppendOnlyInsertWarnings(): void {
  appendOnlyInsertWarned.clear();
}

/** The rule's reach, stated in every answer it gives. */
const APPEND_ONLY_SCOPE =
  'This check covers the update, transfer, delete, purge and restore of an append-only object; an insert is not judged by it.';

/**
 * When the judged write is the engine's reference clean-up for a delete (an
 * `update` marked `__referentialFieldClear`, the marker the data middleware
 * already reads for that leg), the object whose delete it serves and the
 * referencing field; `undefined` for every other write. The cause's ids never
 * reach the answer.
 */
function referenceCleanupOf(opCtx: {
  operation?: unknown;
  context?: unknown;
}): { deleted?: string; field?: string } | undefined {
  if (opCtx.operation !== 'update') return undefined;
  const context = opCtx.context as { __referentialFieldClear?: unknown; __referentialFieldClearCause?: unknown } | null | undefined;
  if (context?.__referentialFieldClear !== true) return undefined;
  const cause = (context.__referentialFieldClearCause ?? {}) as { object?: unknown; field?: unknown };
  return {
    ...(typeof cause.object === 'string' && cause.object ? { deleted: cause.object } : {}),
    ...(typeof cause.field === 'string' && cause.field ? { field: cause.field } : {}),
  };
}
