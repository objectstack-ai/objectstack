// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#5492] Provenance for the platform's row-level write ownership floor.
//
// The pre-image gate lets a declared write authority REPLACE this floor. What
// makes that safe is that only the PLATFORM's own floor is replaceable — the
// same rule ADR-0105 D3 records for tenant policies, and for the same reason:
// its predecessor matched on a substring of the public RLS grammar and
// swallowed app-authored policies with it (finding F1), silently unenforcing a
// declared security property.
import { describe, it, expect } from 'vitest';
import {
  isPlatformOwnershipFloorPolicy,
  platformOwnershipFloorPolicyCount,
  OWNERSHIP_FLOOR_PREDICATE,
} from './platform-ownership-policies.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';

const shippedFloorPolicies = defaultPermissionSets
  .flatMap((ps) => ps.rowLevelSecurity ?? [])
  .filter((p) => typeof p.using === 'string' && p.using.trim() === OWNERSHIP_FLOOR_PREDICATE);

describe('[#5492] platform ownership-floor provenance', () => {
  it('recognises exactly the shipped write-class floor policies (non-vacuous)', () => {
    // Guard against a broken derivation passing every case below by matching
    // nothing at all.
    expect(platformOwnershipFloorPolicyCount()).toBeGreaterThan(0);
    expect(platformOwnershipFloorPolicyCount()).toBe(shippedFloorPolicies.length);
  });

  it('the shipped set is `owner_only_writes` (update) + `owner_only_deletes` (delete)', () => {
    expect(shippedFloorPolicies.map((p) => `${p.name}:${p.operation}`).sort()).toEqual([
      'owner_only_deletes:delete',
      'owner_only_writes:update',
    ]);
    for (const policy of shippedFloorPolicies) {
      expect(isPlatformOwnershipFloorPolicy(policy)).toBe(true);
    }
  });

  it('an APP-AUTHORED policy spelling the same predicate is NOT the platform floor', () => {
    // The ADR-0105 F1 shape: `created_by == current_user.id` is public grammar,
    // so an app writes it too. Its policy must reach the compiler untouched —
    // no composition may drop a declared security property (ADR-0049).
    expect(
      isPlatformOwnershipFloorPolicy({
        object: 'crm_opportunity',
        name: 'app_owner_only',
        using: OWNERSHIP_FLOOR_PREDICATE,
      }),
    ).toBe(false);
    // Same object as the shipped wildcard, different name → still authored.
    expect(
      isPlatformOwnershipFloorPolicy({
        object: '*',
        name: 'my_owner_rule',
        using: OWNERSHIP_FLOOR_PREDICATE,
      }),
    ).toBe(false);
    // Same name, different predicate → still authored.
    expect(
      isPlatformOwnershipFloorPolicy({
        object: '*',
        name: 'owner_only_writes',
        using: 'owner_id == current_user.id',
      }),
    ).toBe(false);
  });

  it('an unrelated shipped policy is not the floor (the `_self` identity carve-outs)', () => {
    const selfPolicy = defaultPermissionSets
      .flatMap((ps) => ps.rowLevelSecurity ?? [])
      .find((p) => p.name === 'sys_user_self')!;
    expect(selfPolicy, 'the carve-out is still shipped').toBeTruthy();
    expect(isPlatformOwnershipFloorPolicy(selfPolicy)).toBe(false);
  });

  it('the derivation only admits WRITE-class shipped policies', () => {
    // The floor is a write-side construct. If a future seed ever ships a
    // `select` policy carrying this predicate it must NOT enter the set — a
    // write-gate composition dropping it would be widening reads it never
    // consulted. Asserted as a property of the whole recognised set rather than
    // against a hypothetical policy, because the identity key is
    // `(object, name, using)` and would not carry the operation.
    for (const policy of shippedFloorPolicies) {
      if (isPlatformOwnershipFloorPolicy(policy)) {
        expect(['update', 'delete', 'all']).toContain(String(policy.operation));
      }
    }
    // …and every shipped write-class policy with the predicate IS recognised,
    // so the loop above can never pass by recognising nothing.
    const writeClass = shippedFloorPolicies.filter((p) =>
      ['update', 'delete', 'all'].includes(String(p.operation)),
    );
    expect(writeClass.length).toBe(platformOwnershipFloorPolicyCount());
  });
});
