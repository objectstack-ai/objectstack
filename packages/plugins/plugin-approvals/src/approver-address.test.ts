// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The one position-address equivalence (`approver-address.ts`).
 *
 * Every reader that compares a slot address with a caller's identity takes it
 * from here (`approver-address-readers.test.ts` enumerates them), so these
 * pins are on the equivalence itself: exactly the one spelling the acting
 * path admits (`position:<p>` — ADR-0090 D3 retired `role:<p>` with no alias
 * window), nothing else folds, and the default actor acts under exactly the
 * caller's server-resolved addresses. The service-level pins
 * (one per reader) live beside the other participant-visibility pins in
 * `approval-service.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import {
  actingAddresses,
  actorAddresses,
  equivalentApproverAddresses,
  heldSlot,
  positionAddresses,
} from './approver-address.js';

describe('approver-address — the position-address equivalence', () => {
  it('spells a position under exactly the one prefix the acting path admits: position:', () => {
    expect(positionAddresses('sales_manager')).toEqual(['position:sales_manager']);
  });

  it('a position: address names its position; the retired role: spelling is no longer an address of it (ADR-0090 D3)', () => {
    expect(equivalentApproverAddresses('position:sales_manager')).toEqual(['position:sales_manager']);
    expect(equivalentApproverAddresses('role:sales_manager')).toEqual(['role:sales_manager']);
  });

  it('splits on the accepted prefix at the start only, so a position name may itself contain a colon', () => {
    expect(equivalentApproverAddresses('role:position:x')).toEqual(['role:position:x']);
    expect(equivalentApproverAddresses('position:role:x')).toEqual(['position:role:x']);
  });

  // The negative control: a fold wider than the acting path would list
  // requests the caller cannot decide.
  it.each([
    ['a user id', 'u_reviewer'],
    ['an email', 'reviewer@example.com'],
    ['the retired role: spelling (ADR-0090 D3)', 'role:sales_manager'],
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

describe('approver-address — the caller\'s acting addresses and the one slot test (#21379)', () => {
  const caller = { userId: 'u_holder', email: 'holder@example.com', positions: ['sales_manager', 'finance'] };

  it('the default actor acts under the user id, the account email and the position: address of each held position, in that order', () => {
    expect(actingAddresses(caller)).toEqual([
      'u_holder', 'holder@example.com',
      'position:sales_manager', 'position:finance',
    ]);
    expect(actingAddresses({ userId: 'u_bare' })).toEqual(['u_bare']);
    expect(actingAddresses({ userId: 'u_bare', email: null, positions: [] })).toEqual(['u_bare']);
  });

  it('a named actor acts under itself, never under the caller\'s other addresses — and role: folds onto no position', () => {
    expect(actorAddresses('u_holder', caller)).toEqual(actingAddresses(caller));
    expect(actorAddresses('role:sales_manager', caller)).toEqual(['role:sales_manager']);
    expect(actorAddresses('position:sales_manager', caller)).toEqual(['position:sales_manager']);
    expect(actorAddresses('holder@example.com', caller)).toEqual(['holder@example.com']);
    // A machine caller (no resolved caller) keeps its minted actor literally.
    expect(actorAddresses('system:sla', null)).toEqual(['system:sla']);
  });

  it('heldSlot takes the first acting address the slate holds, and nothing a different position spells', () => {
    expect(heldSlot(['position:sales_manager'], 'u_holder', caller)).toBe('position:sales_manager');
    // A stored role: slot is not the position's: its holder takes nothing there.
    expect(heldSlot(['role:sales_manager'], 'u_holder', caller)).toBeUndefined();
    expect(heldSlot(['holder@example.com'], 'u_holder', caller)).toBe('holder@example.com');
    expect(heldSlot(['position:sales_manager', 'u_holder'], 'u_holder', caller)).toBe('u_holder');
    expect(heldSlot(['position:sales_manager'], 'role:sales_manager', caller)).toBeUndefined();
    // Negative controls: another position, another person, a non-position literal.
    expect(heldSlot(['position:cfo'], 'u_holder', caller)).toBeUndefined();
    expect(heldSlot(['u_other', 'other@example.com'], 'u_holder', caller)).toBeUndefined();
    expect(heldSlot(['team:sales_manager'], 'u_holder', caller)).toBeUndefined();
    expect(heldSlot(['position:sales_manager'], 'u_holder', null)).toBeUndefined();
  });
});
