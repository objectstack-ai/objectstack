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
  owdDeclaresOpenRowWrites,
  owdOpenWritesCoversOperation,
  OWNERSHIP_FLOOR_PREDICATE,
  OWD_OPENING_ROW_WRITES,
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

// [#8023] The OWD condition on the floor. The headline case is proven
// end-to-end over HTTP by
// `packages/qa/dogfood/test/owd-public-read-write-write-floor.dogfood.test.ts`;
// what belongs HERE is the vocabulary boundary — which spellings open writes
// and which look like they might but must not.
describe('[#8023] owdDeclaresOpenRowWrites — the DECLARED model, never the effective bucket', () => {
  it('the one canonical spelling opens writes, in both the flat and the nested spot', () => {
    expect(owdDeclaresOpenRowWrites({ sharingModel: 'public_read_write' })).toBe(true);
    expect(owdDeclaresOpenRowWrites({ security: { sharingModel: 'public_read_write' } })).toBe(true);
    expect(OWD_OPENING_ROW_WRITES).toBe('public_read_write');
  });

  it('every OWD that does NOT declare open writes keeps the floor', () => {
    for (const model of ['private', 'public_read', 'controlled_by_parent']) {
      expect(owdDeclaresOpenRowWrites({ sharingModel: model }), `${model} must keep the floor`).toBe(false);
    }
  });

  it('⚠️ `controlled_by_parent` and an UNSET model on a system object must NOT open writes', () => {
    // Both collapse into plugin-sharing's `'public'` bucket
    // (`effectiveSharingModel`), which is why reading THAT here would have been
    // the bug: `controlled_by_parent` derives access from its master (which has
    // its own OWD and its own gate) and declares nothing about its own writers,
    // while an unset model on a `sys_*` table is a legacy default rather than
    // an author's statement — opening writes there would hand every member
    // cross-creator writes on the platform's identity tables.
    expect(owdDeclaresOpenRowWrites({ name: 'owdw_detail', sharingModel: 'controlled_by_parent' })).toBe(false);
    expect(owdDeclaresOpenRowWrites({ name: 'sys_user_position', isSystem: true })).toBe(false);
    expect(owdDeclaresOpenRowWrites({ name: 'sys_user_position' })).toBe(false);
  });

  it('an unresolvable or malformed schema fails CLOSED (the floor stays)', () => {
    for (const schema of [null, undefined, {}, { sharingModel: null }, { sharingModel: 'read_write' }]) {
      expect(owdDeclaresOpenRowWrites(schema)).toBe(false);
    }
    // `read_write` above is the ADR-0090 D4 LEGACY alias. It no longer parses at
    // authoring, and a stored value the platform does not recognise must never
    // be read as the wider posture.
  });

  it('the opened write class is `update` alone — `owner_only_deletes` survives', () => {
    expect(owdOpenWritesCoversOperation('update')).toBe(true);
    for (const operation of ['delete', 'select', 'insert', 'all']) {
      expect(owdOpenWritesCoversOperation(operation), `${operation} must not be opened`).toBe(false);
    }
  });
});
