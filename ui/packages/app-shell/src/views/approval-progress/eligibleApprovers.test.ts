/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `eligibleApproverCount` counts the distinct principals of a served slate,
 * not its slots (objectui#12781). The callers' labels are pinned beside each
 * caller; this pins the count itself, including the slates with nothing to
 * count.
 */

import { describe, it, expect } from 'vitest';
import { eligibleApproverCount } from './eligibleApprovers';

describe('eligibleApproverCount (objectui#12781)', () => {
  it('one address in several slots counts once', () => {
    expect(eligibleApproverCount({ pending_approvers: ['u_a', 'u_b', 'u_a', 'u_c'] })).toBe(3);
    expect(eligibleApproverCount({ pending_approvers: ['u_a', 'u_a', 'u_a'] })).toBe(1);
  });

  it('distinct addresses count as the slots do', () => {
    expect(eligibleApproverCount({ pending_approvers: ['u_a', 'u_b', 'u_c'] })).toBe(3);
  });

  it('addresses are counted as served and never resolved: a position and a user id stay two', () => {
    expect(eligibleApproverCount({ pending_approvers: ['position:finance', 'u_a'] })).toBe(2);
  });

  it('no request, or no slate, is zero', () => {
    expect(eligibleApproverCount(null)).toBe(0);
    expect(eligibleApproverCount(undefined)).toBe(0);
    expect(eligibleApproverCount({ pending_approvers: null })).toBe(0);
    expect(eligibleApproverCount({})).toBe(0);
  });
});
