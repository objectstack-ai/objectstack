// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The SCIM Enterprise User `manager` attribute, projected onto
 * `sys_user.manager_id`. PACKAGE-INTERNAL.
 *
 * ## The gap this closes
 *
 * `admin-set-user-manager` refuses an identity a SCIM directory holds ("change
 * it in your directory"; maintainer ruling record 6895645364, option A), and
 * until this module no code carried the directory's own answer to the column:
 * `@better-auth/scim` validates and stores
 * `urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:manager` and
 * echoes it back, but writes nothing of it onto the user. So for a SCIM-held
 * user neither side could set the manager, and the approvals `manager` rung
 * and the `own_and_reports` scope (ADR-0057) read a column nobody could write.
 *
 * ## The seam, and why it is this one
 *
 * The vendor hands the host three callbacks inside its SCIM transaction, and
 * none receives the resource: `identity.resolveUser` sees it on a create only
 * and runs BEFORE the transaction; `projection.reconcileUser` and
 * `identity.reconcileUser` see the user's state. So the projection reads what
 * the vendor has just stored — the profile source's `scimUser` row, whose
 * `serializedAttributes` hold the canonical attributes the request left — on
 * `identity.reconcileUser`, which the vendor calls after every user create,
 * replace, patch, reprovision and delete. It runs after the lifecycle
 * reconcile (`reconcileScimUserLifecycle`, the ADR-0135 D4 stamp, untouched),
 * through the data engine, whose writes join the SCIM request's transaction
 * (`scimRequestScope`), so a refusal rolls the whole SCIM mutation back and
 * the identity provider reads a SCIM error with nothing written.
 *
 * ## When it writes, and why each other case writes nothing
 *
 * - Only on a write that NAMES the attribute ({@link scimUserManagerIntentOf},
 *   read off the request before the vendor runs): a create or PATCH that
 *   carries or removes it, and every replace, since a replace without it is a
 *   clear. A write that does not name it leaves `manager_id` as it is: silence
 *   is not a clear (seat ruling 6907953084, item a).
 * - Only on an identity the directory OWNS the manager of — the exact set the
 *   admin endpoint refuses, read through the one predicate both doors share,
 *   `directoryOwnsUserManager` (seat ruling 6907953084, item b). On any other
 *   identity the admin endpoint owns the column and the projection writes
 *   nothing, so neither door overwrites the other.
 * - Only inside an authenticated SCIM protocol request, for the connection it
 *   verified as. The vendor also calls this callback while it decommissions a
 *   connection or replays a provisioning domain; neither is a write the
 *   directory made, and a decommission must never be refused over an
 *   org-chart reference.
 * - Only from the user's PROFILE source (the vendor's `profileSourceId`, the
 *   same rule that decides whose name and email the user carries), and only
 *   when it belongs to the request's connection: another connection's request
 *   does not author this user's profile, so its manager is not this user's.
 * - Only on an active state: a deprovision is never refused over the org
 *   chart. A manager named while the user is inactive stays in the
 *   directory's resource and is not applied on re-activation alone; it lands
 *   on the next replace, or on a patch that changes it. (The vendor calls
 *   back only when a PATCH changes what it stores, so a patch re-sending the
 *   same value, or removing an attribute the resource never carried, reaches
 *   no host code; a replace always calls back.)
 * - Only when the manager CHANGES: a reference that resolves to the manager
 *   the user already has is not judged again, so a write is never refused
 *   over a chain other links have since reshaped.
 *
 * ## What `manager.value` is matched against
 *
 * The manager's SCIM resource `id` — RFC 7643 §4.3 defines `manager.value` as
 * "the id of the SCIM resource representing the User's manager" — among the
 * Users the SAME connection provisioned (a resource id means something only to
 * the connection that issued it, which is also how `GET /Users/{id}` scopes
 * it). A `$ref` alone is read by its final `/Users/{id}` path segment. ⛔ Never
 * the `externalId`, the `userName` or an email as a second dialect.
 *
 * ## A reference that names no User is served; a structural one is refused
 *
 * Maintainer ruling record 6909383114: a reference that cannot be resolved —
 * an unknown id, an `externalId`-style value, another connection's id, a
 * `$ref` with no readable `/Users/{id}` segment, this connection's own User
 * whose platform user no longer exists — does not refuse the user
 * write. The write lands, `manager_id` stays as it was, and an operator warn
 * names the connection, bounded per connection
 * ({@link SCIM_MANAGER_UNRESOLVED_WARNS_PER_WINDOW} per window, with the count
 * it dropped). The same admission records the event once in the compliance
 * ledger: the projection notes it on the request's scope, and
 * {@link observeScimManagerUnresolved} hands it to the `audit` slot's
 * `recordScimManagerUnresolved` after the response, outside the SCIM
 * transaction, and only for a request answered below 400 — one
 * `scim_manager_unresolved` row per warn, carrying the warn's dropped count,
 * the user's id and the reference capped at
 * {@link SCIM_MANAGER_REFERENCE_AUDIT_LIMIT} characters, and nothing else of
 * the request. No `audit` slot, or one without the member: no row, and the
 * answer is the same. The check runs after the unchanged-manager short-circuit, and a
 * write that does not name the attribute never reaches it, so a report whose
 * manager was deleted keeps working. The four structural refusals are the
 * admin endpoint's own, from {@link screenUserManagerLink} (self-assignment,
 * cycle, depth cap, cross-organization), imported: one derivation, never a
 * copy. Each is a SCIM error in RFC 7644 §3.12 shape: status 400,
 * `scimType: invalidValue`, the refusal's sentence as `detail`, and the admin
 * endpoint's ADR-0112 `code` for the same refusal. The refusal ledger
 * (`scim-refusal-audit.ts`) records it like any other SCIM refusal.
 */

import type { SCIMIdentityState, SCIMTransactionContext } from '@better-auth/scim';
import {
  directoryOwnedUser,
  screenUserManagerLink,
  writeUserManagerLink,
  type SetUserManagerDeps,
  type SetUserManagerRefusal,
} from './admin-set-user-manager.js';
import type { AuthEventAuditSurface } from './auth-session-audit.js';
import { runAfterResponse } from './run-after-response.js';
import { scimRequestScope, type ScimManagerUnresolvedNote, type ScimRequestScope } from './scim-connection-service.js';
import { ScimRefusalAuditBound } from './scim-refusal-audit.js';

/** The SCIM Enterprise User extension the attribute lives in. */
export const SCIM_ENTERPRISE_USER_SCHEMA = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User';

const SCIM_ERROR_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:Error';

/** Operator warns one connection gets per 10-minute window for unresolvable references. */
export const SCIM_MANAGER_UNRESOLVED_WARNS_PER_WINDOW = 1;

/** The most characters of an unresolvable reference handed to the ledger. */
export const SCIM_MANAGER_REFERENCE_AUDIT_LIMIT = 256;

/** The vendor-side `scimUser` row fields this module reads. */
interface ScimUserRow {
  id?: unknown;
  userId?: unknown;
  connectionId?: unknown;
  serializedAttributes?: unknown;
}

// ---------------------------------------------------------------------------
// Does the request NAME the attribute? Read before the vendor runs.
// ---------------------------------------------------------------------------

const ENTERPRISE_LOWER = SCIM_ENTERPRISE_USER_SCHEMA.toLowerCase();
const MANAGER_PATH_LOWER = `${ENTERPRISE_LOWER}:manager`;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The value under `key` in `obj`, matched case-insensitively (SCIM attribute names are). */
function keyed(obj: Record<string, unknown>, key: string): { found: boolean; value?: unknown } {
  for (const [k, v] of Object.entries(obj)) if (k.toLowerCase() === key) return { found: true, value: v };
  return { found: false };
}

/** Does a resource-shaped object (a create body, a pathless PATCH value) carry the attribute? */
function objectNamesManager(obj: Record<string, unknown>): boolean {
  if (keyed(obj, MANAGER_PATH_LOWER).found || keyed(obj, 'manager').found) return true;
  const extension = keyed(obj, ENTERPRISE_LOWER);
  return extension.found && isRecord(extension.value) && keyed(extension.value, 'manager').found;
}

/** Does one PATCH path address the attribute (or the extension holding it)? */
function pathNamesManager(path: string, op: string, value: unknown): boolean {
  const p = path.trim().toLowerCase();
  if (p === 'manager' || p.startsWith('manager.') || p === MANAGER_PATH_LOWER || p.startsWith(`${MANAGER_PATH_LOWER}.`)) {
    return true;
  }
  // The whole extension: removing it removes the manager; replacing it names
  // the manager only when the new value carries one.
  if (p === ENTERPRISE_LOWER) return op === 'remove' || (isRecord(value) && keyed(value, 'manager').found);
  return false;
}

/**
 * Whether a SCIM user write NAMES the Enterprise `manager` attribute, from its
 * kind and parsed body: a create that carries it, a PATCH with an operation
 * that addresses or carries it, and every replace (a replace without it is a
 * clear).
 */
export function scimBodyNamesManager(kind: 'create' | 'replace' | 'patch', body: unknown): boolean {
  if (kind === 'replace') return true;
  if (!isRecord(body)) return false;
  if (kind === 'create') return objectNamesManager(body);
  const operations = keyed(body, 'operations').value;
  if (!Array.isArray(operations)) return false;
  return operations.some((operation) => {
    if (!isRecord(operation)) return false;
    const op = String(keyed(operation, 'op').value ?? '').toLowerCase();
    const path = keyed(operation, 'path').value;
    const value = keyed(operation, 'value').value;
    if (typeof path === 'string' && path.trim() !== '') return pathNamesManager(path, op, value);
    return isRecord(value) && objectNamesManager(value);
  });
}

/**
 * The manager intent of one SCIM request, for `ScimRequestScope.userManagerIntent`:
 * `named` / `silent` for a user create, replace or patch, `undefined` for any
 * other request. The body is read from a clone, so the vendor still reads its
 * own; a body that does not parse is `silent`, and the vendor refuses it.
 */
export async function scimUserManagerIntentOf(
  request: Request,
  endpointPath: string | undefined,
): Promise<'named' | 'silent' | undefined> {
  const path = endpointPath ?? '';
  const method = request.method.toUpperCase();
  const kind = method === 'POST' && /^\/scim\/v2\/Users\/?$/.test(path)
    ? 'create'
    : method === 'PUT' && /^\/scim\/v2\/Users\/[^/]+$/.test(path)
      ? 'replace'
      : method === 'PATCH' && /^\/scim\/v2\/Users\/[^/]+$/.test(path)
        ? 'patch'
        : undefined;
  if (!kind) return undefined;
  if (kind === 'replace') return 'named';
  let body: unknown;
  try {
    body = JSON.parse(await request.clone().text());
  } catch {
    return 'silent';
  }
  return scimBodyNamesManager(kind, body) ? 'named' : 'silent';
}

// ---------------------------------------------------------------------------
// The reference the stored attributes carry
// ---------------------------------------------------------------------------

/** What the stored attributes say about the manager. */
export type ScimManagerReference =
  | { kind: 'none' }
  | { kind: 'id'; id: string }
  | { kind: 'unreadable'; ref: string };

/**
 * The manager reference in a `scimUser` row's stored canonical attributes:
 * `enterprise.manager.value`, else the final `/Users/{id}` segment of
 * `enterprise.manager.$ref`. A row stored before the vendor kept attributes,
 * or one with no manager, names none; a `$ref` with no readable segment
 * (none, or one that does not decode) is unreadable.
 */
export function readScimManagerReference(serializedAttributes: unknown): ScimManagerReference {
  if (typeof serializedAttributes !== 'string' || serializedAttributes === '') return { kind: 'none' };
  // The vendor validated this payload before storing it and validates it again
  // on every read, so a parse failure here is the vendor's state, not input —
  // it propagates, and the vendor answers it as a SCIM 500 that writes nothing.
  const attributes = JSON.parse(serializedAttributes) as { enterprise?: { manager?: { value?: unknown; $ref?: unknown } } };
  const manager = attributes?.enterprise?.manager;
  if (!manager || typeof manager !== 'object') return { kind: 'none' };
  if (typeof manager.value === 'string' && manager.value !== '') return { kind: 'id', id: manager.value };
  if (typeof manager.$ref === 'string' && manager.$ref !== '') {
    const match = /\/Users\/([^/?#]+)\/?$/.exec(manager.$ref);
    if (!match) return { kind: 'unreadable', ref: manager.$ref };
    try {
      return { kind: 'id', id: decodeURIComponent(match[1]) };
    } catch {
      return { kind: 'unreadable', ref: manager.$ref };
    }
  }
  return { kind: 'none' };
}

/**
 * A SCIM 400 `invalidValue` error, in the body the vendor builds its own in
 * (RFC 7644 §3.12), plus the ADR-0112 `code` of the refusal it carries — the
 * admin endpoint's code for the same refusal — which the refusal ledger
 * records beside the `scimType`. A body already in SCIM shape passes the
 * vendor's after-hook unchanged.
 */
async function scimInvalidValue(code: string, detail: string): Promise<Error> {
  const { APIError } = await import('better-auth/api');
  const error = new APIError('BAD_REQUEST', {
    schemas: [SCIM_ERROR_SCHEMA],
    status: '400',
    scimType: 'invalidValue',
    code,
    detail,
  });
  error.message = detail;
  return error;
}

/**
 * The SCIM error for one of the admin endpoint's structural refusals. Switched
 * on the refusal's OWN code, so nothing is re-derived here; each code is
 * spelled as a literal at its stamp, so `check:dispatcher-error-vocabulary`
 * reads exactly which codes this door answers. A code the screen does not
 * stamp today has no SCIM mapping and fails loudly (the vendor answers a 500
 * and writes nothing) rather than being answered under another code.
 */
async function scimRefusalError(refusal: SetUserManagerRefusal): Promise<Error> {
  switch (refusal.code) {
    case 'INVALID_FIELD':
      return scimInvalidValue('INVALID_FIELD', refusal.message);
    case 'INVALID_REFERENCE':
      return scimInvalidValue('INVALID_REFERENCE', refusal.message);
    case 'RESOURCE_CONFLICT':
      return scimInvalidValue('RESOURCE_CONFLICT', refusal.message);
    case 'VALUE_OUT_OF_RANGE':
      return scimInvalidValue('VALUE_OUT_OF_RANGE', refusal.message);
    default:
      return new Error(
        `[auth] SCIM manager projection: the manager refusal code '${refusal.code}' has no SCIM mapping`,
      );
  }
}

const text = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

/** The admin endpoint's own dependencies (the engine), plus the operator channel. */
export interface ScimManagerProjectionDeps extends SetUserManagerDeps {
  /** Overrides the warn bound's clock and window, for tests. */
  warnBound?: ScimRefusalAuditBound;
}

/** The `identity.reconcileUser` half that projects the manager. */
export type ScimManagerProjection = (state: SCIMIdentityState, context: SCIMTransactionContext) => Promise<void>;

/**
 * Build the projection, with its own per-connection bound on the operator
 * warn for an unresolvable reference.
 */
export function createScimManagerProjection(deps: ScimManagerProjectionDeps): ScimManagerProjection {
  const bound = deps.warnBound ?? new ScimRefusalAuditBound({ rowsPerKey: SCIM_MANAGER_UNRESOLVED_WARNS_PER_WINDOW });

  const warnUnresolved = (
    scope: ScimRequestScope,
    connectionId: string,
    userId: string,
    reference: Exclude<ScimManagerReference, { kind: 'none' }>,
  ): void => {
    const admitted = bound.admit(connectionId);
    if (!admitted) return;
    // The ledger row rides the same admission, so it follows the warn's rate.
    const raw = reference.kind === 'id' ? reference.id : reference.ref;
    scope.userManagerUnresolved = {
      userId,
      referenceKind: reference.kind,
      // One character past the cap survives, so the writer can say the row's copy was truncated.
      reference: raw.slice(0, SCIM_MANAGER_REFERENCE_AUDIT_LIMIT + 1),
      suppressed: admitted.suppressed,
    };
    deps.logger?.warn(
      `[auth] SCIM connection '${connectionId}' sent an Enterprise User manager reference that names no User `
        + `it provisioned (user '${userId}'): the user write was served and sys_user.manager_id was left as it `
        + 'was. manager.value must be the manager\'s SCIM resource id, the id this service returned when the '
        + 'manager was created. Fix the identity provider\'s manager mapping, or provision the manager first. '
        + `Said once per connection per window${admitted.suppressed > 0 ? `; ${admitted.suppressed} more since the last notice` : ''}.`,
      { connectionId, userId, suppressed: admitted.suppressed },
    );
  };

  return async (state, context) => {
    const scope = scimRequestScope.getStore();
    const connectionId = scope?.scim === true ? scope.connectionId : undefined;
    if (!connectionId || scope?.userManagerIntent !== 'named') return;
    if (!state.active || !state.profileSourceId) return;

    const db = context.database;
    const source = await db.findOne<ScimUserRow>({
      model: 'scimUser',
      where: [{ field: 'id', value: state.profileSourceId }],
    });
    if (!source || text(source.connectionId) !== connectionId) return;

    const engine = deps.getDataEngine();
    if (!engine) {
      throw new Error(
        `[auth] SCIM manager projection: no data engine to write sys_user.manager_id for user '${state.userId}'`,
      );
    }
    // The one ownership predicate the admin endpoint's refusal 5 reads; the
    // row it answers with carries the column's current value.
    const owned = await directoryOwnedUser(engine, state.userId);
    if (!owned) return;

    const reference = readScimManagerReference(source.serializedAttributes);
    let managerId: string | null | undefined = null; // `undefined` = unresolvable
    if (reference.kind === 'unreadable') {
      managerId = undefined;
    } else if (reference.kind === 'id') {
      const managerSource = await db.findOne<ScimUserRow>({
        model: 'scimUser',
        where: [
          { field: 'id', value: reference.id },
          { field: 'connectionId', value: connectionId },
        ],
      });
      managerId = managerSource && text(managerSource.userId) ? text(managerSource.userId) : undefined;
    }

    const current = text(owned.manager_id);
    if (managerId !== undefined && current === (managerId ?? '')) return;
    const named = reference as Exclude<ScimManagerReference, { kind: 'none' }>;
    if (managerId === undefined) {
      warnUnresolved(scope, connectionId, state.userId, named);
      return;
    }

    if (managerId !== null) {
      const refusal = await screenUserManagerLink(deps, engine, state.userId, managerId);
      // A connection's own SCIM row whose user no longer exists names no User
      // either: served, like any unresolvable reference (ruling 6909383114).
      // Only the four structural refusals answer 400.
      if (refusal?.reason === 'manager_not_found') {
        warnUnresolved(scope, connectionId, state.userId, named);
        return;
      }
      if (refusal) throw await scimRefusalError(refusal);
    }

    // Attributed to the connection (`svc:scim:CONNECTION_ID`) inside a SCIM
    // request, and joined to its transaction.
    await writeUserManagerLink(engine, state.userId, managerId);
  };
}

// ---------------------------------------------------------------------------
// The ledger row of an unresolvable reference, after the response
// ---------------------------------------------------------------------------

/** The `audit` slot member this module hands its event to, declared locally (`AuthEventAuditSurface` note). */
interface ScimManagerUnresolvedAuditSurface {
  recordScimManagerUnresolved?(event: {
    connectionId: string;
    organizationId?: string;
    userId: string;
    referenceKind: 'id' | 'unreadable';
    reference: string;
    suppressed?: number;
  }): Promise<unknown>;
}

/**
 * Hand the request's noted unresolvable reference, if any, to the sink's
 * `recordScimManagerUnresolved`, after the response. Only a request answered
 * below 400 records one: a refused request rolled its write back. Called by
 * `handleRequest` outside `scimRequestScope`, so the row is never written
 * inside the vendor's transaction. Never throws, and never delays or changes
 * the answer.
 */
export function observeScimManagerUnresolved(
  sink: AuthEventAuditSurface | undefined,
  status: number,
  scope: Pick<ScimRequestScope, 'connectionId' | 'organizationId' | 'userManagerUnresolved'>,
): void {
  try {
    const note: ScimManagerUnresolvedNote | undefined = scope.userManagerUnresolved;
    if (!note || status >= 400 || !scope.connectionId) return;
    const writer = (sink as ScimManagerUnresolvedAuditSurface | undefined)?.recordScimManagerUnresolved;
    if (typeof writer !== 'function') return;
    const event = {
      connectionId: scope.connectionId,
      ...(scope.organizationId ? { organizationId: scope.organizationId } : {}),
      userId: note.userId,
      referenceKind: note.referenceKind,
      reference: note.reference,
      ...(note.suppressed > 0 ? { suppressed: note.suppressed } : {}),
    };
    runAfterResponse(
      () => writer.call(sink, event),
      () => {
        /* the writer reports its own lost rows; the SCIM answer is already given */
      },
    );
  } catch {
    /* bookkeeping never changes a SCIM answer */
  }
}
