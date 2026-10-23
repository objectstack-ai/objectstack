// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25223 cut 6] The CONTEXT prologue of `SecurityPlugin`'s engine
 * middleware, moved out of `security-plugin.ts`:
 *
 * - `resolveOperationPrincipals`, the prologue itself. A context the operation
 *   may not run under is refused before any gate: the ADR-0096 D5 strict mode,
 *   and on a walled posture an on-behalf-of context whose delegator's own
 *   membership does not back the organization the operation runs in
 *   (ADR-0090 D10, #25063). Every other context is resolved to the permission
 *   sets every gate composes with: the principal's, and on a delegated context
 *   the delegator's too.
 * - `refuseGuestWithoutOrganization`, the located refusal the prologue raises
 *   for a guest acting in no organization, ahead of any set resolution
 *   (ADR-0138 D4).
 *
 * A MOVE, not a redesign. Each function below is the body of the
 * `SecurityPlugin` method of the same name as it stood, re-indented one level
 * and otherwise unedited: the same refusals with the same codes and spellings,
 * in the same order, the same fail-closed resolution, the same warning once per
 * reason. What only these bodies read moved with them, also unedited: the
 * ADR-0096 D5 refusal `principalLessDenial`, docblock included, and the
 * `@objectstack/core` import the guest refusal reads, comment included. The
 * refusal now carries `export`; see below.
 *
 * ## How the moved bodies reach the class
 *
 * The shape cuts 1 to 5 used (`security-plugin-object-inputs.ts`, whose header
 * carries the reasoning). The class keeps both private methods — the published
 * `dist/*.d.ts` lists each one's name, docblock and position — and each body is
 * one literal of exactly the {@link OperationPrincipalsHost} members that
 * method reads, plus a `.call`. A method is handed over as a closure that calls
 * it on the plugin at call time, so a test double or spy set on the plugin is
 * still the one the body reaches: the prologue still asks the plugin's
 * `refuseGuestWithoutOrganization` and `resolvePermissionSetsForContext`, and
 * the middleware, `checkControlledByParentWrite` and the write preview still
 * reach the prologue through the plugin. Both methods were async and both
 * functions still are; each method now returns its function's promise.
 *
 * Each field was classified on its own declaration, by the rule cut 1 set.
 * `guestOrganizationRefusalWarned` is declared `readonly` and goes by value, so
 * the refusal records each reason it warned for in the plugin's own set. `ql`,
 * `logger` and `tenancyPosture` are not declared `readonly` (the plugin assigns
 * each after construction), so they go as GETTERS, and each read happens when
 * the body makes it.
 *
 * ## What stays in `security-plugin.ts`, and how it is read
 *
 * `isPrincipalLessContext`, the ADR-0096 D5 test, stays there: the
 * object-admission probes and the row scope read it too, and ADR-0138 anchors
 * it in that file. `isGuestEnvelope` stays too, because the middleware's
 * owner-write step and the set resolution read it. Both are exported and
 * imported here by value. Each is read only inside a function body, at call
 * time, never while either module evaluates, so the two-way import is safe
 * under ESM, and the published bundle holds one module. The test's docblock
 * there names the refusal (`principalLessDenial`), so `security-plugin.ts`
 * imports it from here type-only, which keeps that link resolving and emits
 * nothing. The refusal is not exported from `security-plugin.ts` instead,
 * because its return type then moves `PermissionDeniedError`'s declaration to
 * the top of the published `.d.ts` (measured on this cut). The delegator's
 * resolution and its organization check are imported from `explain-engine.js`,
 * and `PermissionDeniedError` from `errors.js`, as `security-plugin.ts` imports
 * them.
 *
 * Nothing re-exports this module, so the published surface does not move.
 */

import type { SecurityPlugin } from './security-plugin.js';
import { isGuestEnvelope, isPrincipalLessContext } from './security-plugin.js';
import type { PermissionSet } from '@objectstack/spec/security';
import { delegatedOrganizationRefusal, resolveDelegatorContext } from './explain-engine.js';
import { PermissionDeniedError } from './errors.js';
// [ADR-0138 D4] The guest entry's organization step, and the located refusal
// the CRUD gate raises where it refuses.
import { GuestOrganizationUnresolvedError, resolveGuestOrganization } from '@objectstack/core';

/**
 * [#21908] ADR-0096 D5 strict mode — the refusal the engine middleware throws
 * for a principal-less, non-system context ({@link isPrincipalLessContext}):
 * `PermissionDeniedError`, `403 PERMISSION_DENIED`, the engine's one deny
 * vocabulary. ⛔ Not the doors' anonymous pair (`401 UNAUTHENTICATED`): every
 * HTTP door answers that one first, so what reaches this line is in-process
 * plumbing, for which "authenticate" is a false remedy. The text names the two
 * that are true.
 */
export function principalLessDenial(operation: string, object: string): PermissionDeniedError {
  return new PermissionDeniedError(
    `[Security] Access denied: operation '${operation}' on object '${object}' was called with a ` +
      `context that carries no principal (no user, no position, no permission set) and is not a ` +
      `system context. Pass the caller's execution context, or, for platform plumbing whose own ` +
      `door already authorized the caller, the explicit system opt-in (isSystem: true).`,
    { operation, object },
  );
}

/**
 * The `SecurityPlugin` members the functions below read — every one of them,
 * and no other; each function's `this` is the `Pick` of the members IT reads.
 * Each is typed AS the class member (an indexed access on the class), so a
 * change to a member's signature on the class is a change here too, and naming
 * a member the class does not have is a compile error. See the module header
 * for which members are getters.
 */
export interface OperationPrincipalsHost {
  readonly guestOrganizationRefusalWarned: SecurityPlugin['guestOrganizationRefusalWarned'];
  readonly logger: SecurityPlugin['logger'];
  readonly ql: SecurityPlugin['ql'];
  readonly tenancyPosture: SecurityPlugin['tenancyPosture'];
  refuseGuestWithoutOrganization: SecurityPlugin['refuseGuestWithoutOrganization'];
  resolvePermissionSetsForContext: SecurityPlugin['resolvePermissionSetsForContext'];
}

/** The body of `SecurityPlugin#resolveOperationPrincipals`; the method's docblock there is its contract. */
export async function resolveOperationPrincipals(
  this: Pick<OperationPrincipalsHost, 'logger' | 'ql' | 'refuseGuestWithoutOrganization' | 'resolvePermissionSetsForContext' | 'tenancyPosture'>,
  operation: string,
  object: string,
  context: any,
): Promise<{ permissionSets: PermissionSet[]; delegatorSets: PermissionSet[] | null; delegatorContext: any }> {
  if (isPrincipalLessContext(context)) {
    throw principalLessDenial(operation, object);
  }
  await this.refuseGuestWithoutOrganization(context, operation, object);

  let permissionSets: PermissionSet[] = [];
  try {
    permissionSets = await this.resolvePermissionSetsForContext(context);
  } catch (e) {
    this.logger.error?.(
      `[security] permission resolution failed for operation '${operation}' on ` +
      `object '${object}' (user ${context?.userId ?? 'unknown'}) — ` +
      `denying request (fail-closed)`,
      e instanceof Error ? e : new Error(String(e)),
    );
    throw new PermissionDeniedError(
      `[Security] Access denied: permission subsystem unavailable for ` +
      `operation '${operation}' on object '${object}'`,
    );
  }

  let delegatorSets: PermissionSet[] | null = null;
  let delegatorContext: any = null;
  if (permissionSets.length > 0 && context?.onBehalfOf?.userId) {
    const del = await resolveDelegatorContext(this.ql, context);
    if (del.kind === 'missing') {
      throw new PermissionDeniedError(
        `[Security] Access denied: on-behalf-of principal names delegator ` +
          `'${del.userId}', who does not exist — refusing to act (ADR-0090 D10 fail-closed)`,
        { operation, object },
      );
    }
    if (del.kind === 'resolved') {
      const liveOrganization = delegatedOrganizationRefusal(context, del.context, this.tenancyPosture);
      if (liveOrganization !== undefined) {
        this.logger.warn?.(
          `[Security] on-behalf-of ${operation} '${object}' REFUSED — the delegator is not a member of the ` +
            `organization the request runs in (ADR-0090 D10, fail-closed)`,
        );
        throw new PermissionDeniedError(
          `[Security] Access denied: on-behalf-of principal acts in organization '${liveOrganization}', which ` +
            `delegator '${String(context.onBehalfOf.userId)}' is not a member of — refusing to act (ADR-0090 D10 fail-closed)`,
          { operation, object },
          `[ADR-0090 D10] tenancy posture '${this.tenancyPosture}' walls organizations, and a delegated operation is ` +
            `bounded by the delegator's scope: it runs in the live principal's active organization, which the ` +
            `delegator's own membership must back. Build the on-behalf-of context in an organization the delegator ` +
            `is a member of. System contexts and the single posture are unaffected.`,
        );
      }
      delegatorContext = del.context;
      delegatorSets = await this.resolvePermissionSetsForContext(delegatorContext);
    }
  }
  return { permissionSets, delegatorSets, delegatorContext };
}

/** The body of `SecurityPlugin#refuseGuestWithoutOrganization`; the method's docblock there is its contract. */
export async function refuseGuestWithoutOrganization(
  this: Pick<OperationPrincipalsHost, 'guestOrganizationRefusalWarned' | 'logger' | 'ql' | 'tenancyPosture'>,
  context: any,
  operation: string,
  object: string,
): Promise<void> {
  // A system context never reaches here: both callers of
  // {@link resolveOperationPrincipals} return before it for one (the
  // middleware's system short-circuit, and `checkControlledByParentWrite`'s
  // first exit), so this rule reads no elevation of its own.
  if (!isGuestEnvelope(context)) return;
  const tenantId = context?.tenantId;
  if (typeof tenantId === 'string' && tenantId !== '') return;
  const decision = await resolveGuestOrganization(this.ql, this.tenancyPosture);
  if (decision.kind !== 'refuse') return;
  if (!this.guestOrganizationRefusalWarned.has(decision.reason)) {
    this.guestOrganizationRefusalWarned.add(decision.reason);
    this.logger.warn?.(
      `[security] an anonymous request reached '${operation}' on '${object}' and was refused: this deployment ` +
        `resolves no organization for the guest (${decision.reason}, tenancy posture '${this.tenancyPosture}'` +
        `${decision.organizationCount !== undefined ? `, ${decision.organizationCount} organization(s)` : ''}). ` +
        `ADR-0138 D4 derives the guest's organization only on a single-organization deployment, and no site ` +
        `binding (D5) exists yet to name one per request, so every anonymous data operation here answers ` +
        `501 NOT_IMPLEMENTED. Serve the endpoint to signed-in callers (authRequired: true), or run it on a ` +
        `single-organization deployment. Reported once per reason.`,
      { operation, object, reason: decision.reason },
    );
  }
  throw new GuestOrganizationUnresolvedError(decision.reason);
}
