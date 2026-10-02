// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The one position-address equivalence (`approver-address.ts`).
 *
 * Three readers take it from here — `resolveActor`, the "My Pending" filter
 * (`approverRequestIds`) and the participant gate (`visibleRequestIds`) — so
 * these pins are on the equivalence itself: exactly the two spellings the
 * acting path has always admitted, and nothing else folds. The service-level
 * pins (both spellings list, the acting path unchanged) live beside the other
 * participant-visibility pins in `approval-service.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { equivalentApproverAddresses, positionAddresses } from './approver-address.js';

describe('approver-address — the position-address equivalence', () => {
  it('spells a position under exactly the two prefixes the acting path admits, canonical first', () => {
    expect(positionAddresses('sales_manager')).toEqual(['position:sales_manager', 'role:sales_manager']);
  });

  it('folds either spelling of a position onto both', () => {
    const both = ['position:sales_manager', 'role:sales_manager'];
    expect(equivalentApproverAddresses('position:sales_manager')).toEqual(both);
    expect(equivalentApproverAddresses('role:sales_manager')).toEqual(both);
  });

  it('splits on the FIRST accepted prefix only, so a position name may itself contain a colon', () => {
    expect(equivalentApproverAddresses('role:position:x')).toEqual(['position:position:x', 'role:position:x']);
    expect(equivalentApproverAddresses('position:role:x')).toEqual(['position:role:x', 'role:role:x']);
  });

  // The negative control: a fold wider than the acting path would list
  // requests the caller cannot decide.
  it.each([
    ['a user id', 'u_reviewer'],
    ['an email', 'reviewer@example.com'],
    ['a team literal', 'team:sales_manager'],
    ['a membership-level literal', 'org_membership_level:sales_manager'],
    ['a department literal', 'department:sales_manager'],
    ['a near-miss prefix', 'positions:sales_manager'],
    ['a differently-cased prefix', 'Position:sales_manager'],
    ['a prefix not at the start', 'x-role:sales_manager'],
  ])('treats %s as equivalent only to itself', (_label, address) => {
    expect(equivalentApproverAddresses(address)).toEqual([address]);
  });
});
