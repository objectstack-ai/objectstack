// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [Ruling of record 6355206139, letter B] The producer half of the EXTERNAL
 * rung's OWD seam: does a grant the external holds carry an RLS predicate for
 * this object and operation class, so that the object's own org-wide default
 * stands and that predicate bounds the rows?
 *
 * `plugin-sharing` floors the OWD of every object at owner_only for an external
 * principal unless this answer, stamped on the operation context, says a grant
 * speaks (`external-owd-floor.ts` in `@objectstack/core` carries the rule and
 * the stamp names). The CRUD middleware stamps it at step 2.6, beside the
 * access depth it already hands the sharing service.
 *
 * What counts as a grant's predicate, and what does not:
 *   - a `using` clause on a policy of a set the principal resolves (positions,
 *     permission sets, its own `external_default`), applicable to the object,
 *     the operation and the principal's positions — exactly the policies Layer 1
 *     compiles;
 *   - ⛔ NOT the object's own `defaultRowScope`: a declaration on the object is
 *     not a grant to the principal (`isObjectDefaultRowScopePolicy`);
 *   - ⛔ NOT the platform's ownership floor (`owner_only_writes` /
 *     `owner_only_deletes`), which is platform policy, not a grant, and which
 *     binds `org_member` besides;
 *   - a `check`-only policy gates the post-image, not which rows are reached,
 *     so it is no predicate here either (#8059's reading).
 *
 * The write class mirrors Layer 1's #7665 derivation: when no write-class
 * predicate applies, the write scope is derived from the read class, so a read
 * predicate speaks for the write class too. The read class never borrows from
 * the write class: an update-only predicate is no evidence for a read.
 */

import type { RowLevelSecurityPolicy } from '@objectstack/spec/security';
import { EXTERNAL_READ_GRANT_KEY, EXTERNAL_WRITE_GRANT_KEY, isExternalAudienceContext } from '@objectstack/core';
import { policyDeclaresClause } from './rls-compiler.js';
import { isObjectDefaultRowScopePolicy } from './object-default-row-scope.js';
import { isPlatformOwnershipFloorPolicy } from './platform-ownership-policies.js';

/** Collects the RLS policies Layer 1 would compile for one RLS operation. */
export type CollectGrantPolicies = (rlsOperation: string) => readonly RowLevelSecurityPolicy[];

function grantPredicateApplies(policies: readonly RowLevelSecurityPolicy[]): boolean {
  return policies.some(
    (p) =>
      policyDeclaresClause(p, 'using') &&
      !isObjectDefaultRowScopePolicy(p as object) &&
      !isPlatformOwnershipFloorPolicy(p),
  );
}

/**
 * Does a held grant's RLS speak for the operation class? `rlsOperation` is the
 * RLS operation of the write in flight (`update`, `delete`, …); unused on the
 * read class, which always asks `select`.
 */
export function grantRowPolicySpeaks(
  collect: CollectGrantPolicies,
  opClass: 'read' | 'write',
  rlsOperation?: string,
): boolean {
  if (grantPredicateApplies(collect('select'))) return true;
  if (opClass === 'read') return false;
  return rlsOperation !== undefined && rlsOperation !== 'select' && grantPredicateApplies(collect(rlsOperation));
}

/**
 * Stamp the answer for `object` on the operation context: the object's name
 * when a grant speaks, and the key REMOVED when none does — so a stamp left by
 * an earlier operation on the same envelope can never stand in for this one.
 */
export function stampExternalGrant(
  context: Record<string, unknown>,
  object: string,
  opClass: 'read' | 'write',
  speaks: boolean,
): void {
  const key = opClass === 'read' ? EXTERNAL_READ_GRANT_KEY : EXTERNAL_WRITE_GRANT_KEY;
  if (speaks) context[key] = object;
  else delete context[key];
}

/**
 * The same answer as a spreadable patch, for the helpers that hand the sharing
 * service a rebuilt context rather than the operation context (the explainer,
 * the analytics read scope, the master-detail and by-id write verdicts): the
 * stamp for an external principal — `undefined` when no grant speaks, which
 * overwrites any stamp the context brought — and nothing for anyone else.
 */
export function externalGrantPatch(
  context: unknown,
  object: string,
  opClass: 'read' | 'write',
  collect: CollectGrantPolicies,
  rlsOperation?: string,
): Record<string, string | undefined> {
  if (!isExternalAudienceContext(context)) return {};
  const key = opClass === 'read' ? EXTERNAL_READ_GRANT_KEY : EXTERNAL_WRITE_GRANT_KEY;
  return { [key]: grantRowPolicySpeaks(collect, opClass, rlsOperation) ? object : undefined };
}
