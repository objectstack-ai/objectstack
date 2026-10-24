// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25251, ruling 6354966423, letter B] A flow's system elevation does not
 * reach identity assignment.
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
 * The answer is the standard catalog's `PERMISSION_DENIED` (403), the code the
 * D12 gate and the identity write guard answer the same writes with; no code is
 * minted. The flow's write node fails with it, and the run's result hands it to
 * the run's caller as its inner refusal (`code` and `message`).
 */

import { GOVERNED_OPERATIONS } from './delegated-admin-gate.js';
import { PermissionDeniedError } from './errors.js';

/** The identity-assignment objects a flow run's system context may not write. */
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

const ASSIGNMENT_PRESCRIPTION =
  "Set the flow's runAs to 'user': the delegated-administration gate then judges the user the run acts for, "
  + 'and records that user as the grant\'s granted_by.';

const MEMBERSHIP_PRESCRIPTION =
  'Invitations and memberships change through the organization endpoints (POST /api/v1/auth/organization/'
  + 'invite-member, cancel-invitation, update-member-role, remove-member), which apply the invitation\'s '
  + 'placement and role-cap checks.';

/**
 * Refuse a governed write to {@link FLOW_SYSTEM_IDENTITY_WRITE_OBJECTS} from a
 * system context a flow run opened; return for every other operation.
 *
 * Called by the data middleware immediately before its `isSystem` bypass, so
 * the refused write never reaches the engine's write path.
 */
export function assertFlowSystemIdentityWriteAllowed(opCtx: {
  object?: unknown;
  operation?: unknown;
  context?: { isSystem?: unknown; flowRunId?: unknown } | null;
}): void {
  const context = opCtx?.context;
  if (!context?.isSystem || !context.flowRunId) return;
  const object = typeof opCtx.object === 'string' ? opCtx.object : '';
  if (!FLOW_SYSTEM_IDENTITY_WRITE_OBJECTS.has(object)) return;
  const operation = typeof opCtx.operation === 'string' ? opCtx.operation : '';
  if (!GOVERNED_OPERATIONS.has(operation)) return;
  throw new PermissionDeniedError(
    `[Security] Access denied: '${operation}' on '${object}' from a flow that runs as system ` +
      "(runAs: 'system') is refused — position holdings, permission-set grants, invitations and " +
      "memberships are governed identity writes, and a flow's system elevation does not lift that. " +
      (ASSIGNMENT_OBJECTS.has(object) ? ASSIGNMENT_PRESCRIPTION : MEMBERSHIP_PRESCRIPTION),
    { operation, object },
  );
}
