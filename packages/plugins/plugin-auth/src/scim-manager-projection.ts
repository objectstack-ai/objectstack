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
 * ## When it projects, and when it does not
 *
 * - Only inside an authenticated SCIM protocol request, and only for the
 *   connection that request verified as. The vendor also calls this callback
 *   while it decommissions a connection or replays a provisioning domain; a
 *   decommission must never be refused over an org-chart reference, so those
 *   runs project nothing.
 * - Only from the user's PROFILE source (the vendor's `profileSourceId`, the
 *   same rule that decides whose name and email the user carries), and only
 *   when that source belongs to the request's connection.
 * - Only on an active state. A deprovision is never refused over the manager;
 *   a user re-activated later projects the manager its source then holds.
 * - Only when the manager CHANGES. A stored reference that resolves to the
 *   manager the user already has is not judged again, so an unrelated PATCH is
 *   never refused over a chain other links have since reshaped.
 *
 * ## What `manager.value` is matched against
 *
 * The manager's SCIM resource `id` — RFC 7643 §4.3 defines `manager.value` as
 * "the id of the SCIM resource representing the User's manager" — among the
 * Users the SAME connection provisioned (a resource id means something only to
 * the connection that issued it, which is also how `GET /Users/{id}` scopes
 * it). A `$ref` alone is read the same way, by its final `/Users/{id}` path
 * segment. ⛔ Never the `externalId`, the `userName` or an email as a second
 * dialect: one reading, so a reference either names a User or is refused.
 *
 * ## The refusals
 *
 * A reference that names no User this connection provisioned is refused —
 * never dropped, so the directory learns its reference did not land. Every
 * other refusal is the admin endpoint's own, from
 * {@link screenUserManagerLink} (self-assignment, cycle, depth cap,
 * cross-organization), imported: one derivation, never a copy. Each is a SCIM
 * error in RFC 7644 §3.12 shape: status 400, `scimType: invalidValue` — the
 * vendor's own answer to a value it refuses — the refusal's sentence as
 * `detail`, and the admin endpoint's ADR-0112 `code` for the same refusal. The refusal ledger (`scim-refusal-audit.ts`) records it like any
 * other SCIM refusal. A cleared or absent attribute clears the column.
 */

import type { SCIMIdentityState, SCIMTransactionContext } from '@better-auth/scim';
import { authSystemWriteContext } from './auth-actor-attribution.js';
import { screenUserManagerLink, type SetUserManagerDeps } from './admin-set-user-manager.js';
import { scimRequestConnectionId } from './scim-connection-service.js';

/** The SCIM Enterprise User extension the attribute lives in. */
export const SCIM_ENTERPRISE_USER_SCHEMA = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User';

const SCIM_ERROR_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:Error';

const SYSTEM_READ_CTX = { isSystem: true, positions: [], permissions: [] } as const;

/** The vendor-side `scimUser` row fields this module reads. */
interface ScimUserRow {
  id?: unknown;
  userId?: unknown;
  connectionId?: unknown;
  serializedAttributes?: unknown;
}

/** What the stored attributes say about the manager. */
export type ScimManagerReference =
  | { kind: 'none' }
  | { kind: 'id'; id: string }
  | { kind: 'unreadable'; ref: string };

/**
 * The manager reference in a `scimUser` row's stored canonical attributes:
 * `enterprise.manager.value`, else the final `/Users/{id}` segment of
 * `enterprise.manager.$ref`. A row stored before the vendor kept attributes,
 * or one with no manager, names none.
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
    return match ? { kind: 'id', id: decodeURIComponent(match[1]) } : { kind: 'unreadable', ref: manager.$ref };
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
  } as never);
  error.message = detail;
  return error;
}

const text = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

/** The admin endpoint's own dependencies: the engine, and its degradation channel. */
export type ScimManagerProjectionDeps = SetUserManagerDeps;

/**
 * Project the profile source's `manager` onto `sys_user.manager_id` for the
 * user in `state`, inside the SCIM transaction `context` belongs to. Resolves
 * when the column already agrees or was written; throws the SCIM error the
 * identity provider reads when the reference is refused.
 */
export async function projectScimManager(
  deps: ScimManagerProjectionDeps,
  state: SCIMIdentityState,
  context: SCIMTransactionContext,
): Promise<void> {
  const connectionId = scimRequestConnectionId();
  if (!connectionId || !state.active || !state.profileSourceId) return;

  const db = context.database;
  const source = await db.findOne<ScimUserRow>({
    model: 'scimUser',
    where: [{ field: 'id', value: state.profileSourceId }],
  });
  if (!source || text(source.connectionId) !== connectionId) return;

  const reference = readScimManagerReference(source.serializedAttributes);
  if (reference.kind === 'unreadable') {
    throw await scimInvalidValue(
      'INVALID_REFERENCE',
      `${SCIM_ENTERPRISE_USER_SCHEMA}:manager names no User: its $ref '${reference.ref}' does not end in `
        + `/Users/{id}, and it carries no value. Send the manager's SCIM resource id as manager.value.`,
    );
  }

  let managerId: string | null = null;
  if (reference.kind === 'id') {
    const managerSource = await db.findOne<ScimUserRow>({
      model: 'scimUser',
      where: [
        { field: 'id', value: reference.id },
        { field: 'connectionId', value: connectionId },
      ],
    });
    if (!managerSource || !text(managerSource.userId)) {
      throw await scimInvalidValue(
        'INVALID_REFERENCE',
        `${SCIM_ENTERPRISE_USER_SCHEMA}:manager.value '${reference.id}' names no User this connection `
          + `provisioned. manager.value is the manager's SCIM resource id (the id this service returned when `
          + `the manager was created), not an externalId, userName or email. Provision the manager first, or `
          + `send the right id; nothing of this request was written.`,
      );
    }
    managerId = text(managerSource.userId);
  }

  const engine = deps.getDataEngine();
  if (!engine) {
    throw new Error(
      `[auth] SCIM manager projection: no data engine to write sys_user.manager_id for user '${state.userId}'`,
    );
  }
  const rows = await engine.find('sys_user', {
    where: { id: state.userId },
    fields: ['id', 'manager_id'],
    limit: 1,
    context: SYSTEM_READ_CTX,
  });
  const current = text((Array.isArray(rows) ? (rows[0] as { manager_id?: unknown } | undefined) : undefined)?.manager_id);
  if (current === (managerId ?? '')) return;

  if (managerId !== null) {
    const refusal = await screenUserManagerLink(deps, engine, state.userId, managerId);
    if (refusal) throw await scimInvalidValue(refusal.code, refusal.message);
  }

  // Attributed to the connection (`svc:scim:CONNECTION_ID`) inside a SCIM
  // request, and joined to its transaction.
  await engine.update('sys_user', { id: state.userId, manager_id: managerId }, { context: await authSystemWriteContext() });
}
