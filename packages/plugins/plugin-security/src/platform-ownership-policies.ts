// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5492] Provenance for the platform's OWN row-level WRITE ownership floor.
 *
 * `member_default` — the additive `everyone` baseline every authenticated
 * member resolves — ships two wildcard write policies keyed on the column the
 * engine stamps on every record:
 *
 * ```
 *   owner_only_writes   object '*'  operation 'update'  created_by == current_user.id
 *   owner_only_deletes  object '*'  operation 'delete'  created_by == current_user.id
 * ```
 *
 * They are the platform's answer to #1985 (a by-id write builds no `ast`, so a
 * row predicate would never be applied), and they are a **second implementation
 * of "ownership"** — the one that knows nothing about the wideners the platform
 * also declares. `ISharingService` is the other, and the only one that reads
 * write DEPTH, `sys_record_share.access_level` and the `modifyAllRecords`
 * bypass. While both ran as an unconditional AND, the widener-blind copy always
 * won: every `member_default` + `org_member` principal — which is *every*
 * member, a manager included — was pinned to `created_by == me` no matter what
 * their profile or their shares declared (#5492's measurement: 403 on every
 * cross-owner UPDATE and DELETE, and on every `edit`-level share).
 *
 * The composition that fixes it needs to name these two policies WITHOUT
 * naming them by string: the pre-image gate lets the declared write authority
 * REPLACE this floor (see `SecurityPlugin.computeLayeredRlsFilter`'s
 * `dropPlatformOwnershipFloor`), and it may only replace the floor the
 * PLATFORM shipped — an app-authored policy is a declared security property
 * and must always reach the compiler (ADR-0049; the same reasoning
 * {@link ./platform-tenant-policies.ts} records for ADR-0105 finding F1, where
 * a substring match on a public grammar token silently swallowed authored
 * policies).
 *
 * So provenance, not pattern-matching, exactly as ADR-0105 D3 does it: the
 * identity key is `(object, name, using)`, built from the shipped declaration
 * itself. An app policy can only collide by being byte-identical to a shipped
 * one on the same object, in which case treating it as the floor is the same
 * decision the platform already made for its own copy.
 *
 * Deliberately NOT an authorable "this is a floor" flag on the RLS schema:
 * provenance is a fact about who shipped a policy, and letting metadata claim
 * it would hand authors a switch that turns their own policy off.
 */

import type { RowLevelSecurityPolicy } from '@objectstack/spec/security';

import { defaultPermissionSets } from './objects/default-permission-sets.js';

/**
 * The predicate that makes a shipped policy an OWNERSHIP floor. Used ONLY to
 * select which shipped policies enter the provenance set — never as a matcher
 * against authored input (that is ADR-0105 finding F1's mistake).
 */
export const OWNERSHIP_FLOOR_PREDICATE = 'created_by == current_user.id';

/**
 * RLS operations that are WRITE classes. The floor is a write-side construct:
 * a shipped `select` policy carrying the same predicate would be read scoping
 * and must never be dropped by a write-gate composition.
 */
const WRITE_RLS_OPERATIONS: ReadonlySet<string> = new Set(['update', 'delete', 'all']);

/** `\u0000` cannot appear in an object/policy name or a `using` expression. */
function provenanceKey(policy: Pick<RowLevelSecurityPolicy, 'object' | 'name' | 'using'>): string {
  return `${policy.object ?? ''}\u0000${policy.name ?? ''}\u0000${policy.using ?? ''}`;
}

/**
 * Identity keys of every write-side ownership-floor policy the platform itself
 * ships. Built once from the compiled declaration — the same constant
 * `bootstrapPlatformAdmin` seeds `sys_permission_set` rows from, so a policy
 * read back from the database matches its shipped original.
 */
const PLATFORM_OWNERSHIP_FLOOR_KEYS: ReadonlySet<string> = (() => {
  const keys = new Set<string>();
  for (const ps of defaultPermissionSets) {
    for (const policy of ps.rowLevelSecurity ?? []) {
      if (typeof policy.using !== 'string') continue;
      if (policy.using.trim() !== OWNERSHIP_FLOOR_PREDICATE) continue;
      if (!WRITE_RLS_OPERATIONS.has(String(policy.operation ?? ''))) continue;
      keys.add(provenanceKey(policy));
    }
  }
  return keys;
})();

/**
 * True iff this policy is one the PLATFORM ships as its row-level write
 * ownership floor — the only policies the pre-image gate may let a declared
 * write authority replace.
 */
export function isPlatformOwnershipFloorPolicy(
  policy: Pick<RowLevelSecurityPolicy, 'object' | 'name' | 'using'>,
): boolean {
  return PLATFORM_OWNERSHIP_FLOOR_KEYS.has(provenanceKey(policy));
}

/** Test/diagnostic accessor — the number of shipped floor policies recognized. */
export function platformOwnershipFloorPolicyCount(): number {
  return PLATFORM_OWNERSHIP_FLOOR_KEYS.size;
}
