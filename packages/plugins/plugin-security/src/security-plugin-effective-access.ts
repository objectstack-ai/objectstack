// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0090 D6/D12] `SecurityPlugin#describeEffectiveAccess`: one user's
 * effective permission sets, each with where it comes from — a default
 * binding, a held position, a direct grant, or a name the resolver derives
 * from the user's standing. The contract is the spec's
 * `ISecurityService.describeEffectiveAccess` docblock; this module implements
 * exactly that.
 *
 * ## One gate, and the one place it departs from explain
 *
 * Who may read whom is explain's caller gate itself
 * ({@link mayDescribeAnotherUser}, `security-plugin-explain-access.ts`), asked
 * the same way for any id that is not the caller's own. Then the user must
 * exist (`readSysUserRow`, the explainer's one existence read). An id no user
 * row has is refused with the SAME `PermissionDeniedError` — same message,
 * same details — as one the caller may not manage, for every caller,
 * `manage_users` included, so the answer says nothing about which ids exist.
 * That is the departure the contract names: explain answers an admitted caller
 * `404` there, and this read must not.
 *
 * ## One reading of the origins
 *
 * The positions and permission-set names are the resolver's own
 * (`resolveUserAuthzGrants`, `@objectstack/core`), and so are the origins: the
 * resolution records them at its derivation sites when asked
 * (`withPermissionOrigins`), so a set here can never carry an origin the
 * resolution did not derive it by. The one channel the resolver does not own
 * is the human baseline the security service adds for every authenticated
 * member (`humanBaselineFor`, the helper the set resolution and the explainer
 * read): those sets join last, as `default`, and a set already listed keeps
 * its place and gains the origin.
 *
 * The organization is explain's: the caller's active one, kept only while the
 * described user could be resolved in it (`vetOrganizationClaim`, the session
 * arm of `resolveAuthzContext`), else none.
 */
import { resolveUserAuthzGrants, vetOrganizationClaim } from '@objectstack/core';
import type { EffectiveAccess, EffectivePermissionSet, EffectivePermissionSetOrigin } from '@objectstack/spec/contracts';
import type { SecurityPlugin } from './security-plugin.js';
import { PermissionDeniedError } from './errors.js';
import { readSysUserRow } from './explain-engine.js';
import { humanBaselineFor } from './external-baseline.js';
import { mayDescribeAnotherUser } from './security-plugin-explain-access.js';

/**
 * The `SecurityPlugin` members {@link describeEffectiveAccess} reads — every
 * one of them, and no other. Each is typed AS the class member, so a change to
 * a member's signature on the class is a change here too.
 */
export interface EffectiveAccessHost {
  readonly baselinePermissionSets: SecurityPlugin['baselinePermissionSets'];
  readonly delegatedAdminGate: SecurityPlugin['delegatedAdminGate'];
  readonly permissionEvaluator: SecurityPlugin['permissionEvaluator'];
  readonly ql: SecurityPlugin['ql'];
  readonly tenancyPosture: SecurityPlugin['tenancyPosture'];
  resolvePermissionSetsForContext: SecurityPlugin['resolvePermissionSetsForContext'];
}

/**
 * The refusal for a user the caller may not describe AND for an id no user
 * has: one constructor, so the two cannot drift apart. It names no id.
 */
function effectiveAccessRefusal(): PermissionDeniedError {
  return new PermissionDeniedError(
    `[Security] Access denied: reading another user's effective access requires the 'manage_users' ` +
      `capability, organization administration of an organization that user is a member of, ` +
      `or a delegated adminScope covering that user (ADR-0090 D6/D12).`,
  );
}

/** The body of `SecurityPlugin#describeEffectiveAccess`; the spec member's docblock is its contract. */
export async function describeEffectiveAccess(
  this: EffectiveAccessHost,
  userId: string,
  callerContext?: any,
): Promise<EffectiveAccess> {
  const target = typeof userId === 'string' ? userId : '';
  // An empty id names nobody: refused as an unknown one, never read as the caller.
  if (target === '') throw effectiveAccessRefusal();
  if (target !== callerContext?.userId && !(await mayDescribeAnotherUser.call(this, target, callerContext))) {
    throw effectiveAccessRefusal();
  }
  // Asked only after the gate, so a caller it refuses learns nothing about ids.
  // A read that throws propagates as a fault; it is not "no such user".
  if (!(await readSysUserRow(this.ql, target))) throw effectiveAccessRefusal();

  const callerTenantId = typeof callerContext?.tenantId === 'string' && callerContext.tenantId !== ''
    ? callerContext.tenantId
    : undefined;
  const nowMs = Date.now();
  const resolveIn = (tenantId: string | undefined) =>
    resolveUserAuthzGrants(this.ql, target, { tenantId, nowMs, withPermissionOrigins: true });
  let grants = await resolveIn(callerTenantId);
  const organizationId = vetOrganizationClaim(callerTenantId, grants.accessible_org_ids ?? [], this.tenancyPosture);
  if (organizationId !== callerTenantId) grants = await resolveIn(organizationId);

  const origins = grants.permissionOrigins ?? {};
  const permissionSets: EffectivePermissionSet[] = [];
  const byName = new Map<string, EffectivePermissionSet>();
  const add = (name: string, origin: EffectivePermissionSetOrigin): void => {
    let entry = byName.get(name);
    if (!entry) {
      entry = { name, origins: [] };
      byName.set(name, entry);
      permissionSets.push(entry);
    }
    if (!entry.origins.some((o) => JSON.stringify(o) === JSON.stringify(origin))) entry.origins.push(origin);
  };
  for (const name of grants.permissions) {
    const derivedBy = origins[name];
    // Every name this resolution derived carries an origin; one without is a
    // resolver defect, said as one rather than listed with an invented origin.
    if (!derivedBy || derivedBy.length === 0) {
      throw new Error(`[Security] describeEffectiveAccess: the resolution named permission set '${name}' without an origin.`);
    }
    for (const origin of derivedBy) add(name, origin);
  }
  for (const name of humanBaselineFor(grants.positions, this.baselinePermissionSets)) {
    add(name, { kind: 'default' });
  }

  return {
    userId: target,
    organizationId: organizationId ?? null,
    positions: [...grants.positions],
    permissionSets,
  };
}
