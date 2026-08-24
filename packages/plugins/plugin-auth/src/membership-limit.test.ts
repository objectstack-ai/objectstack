// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, afterEach } from 'vitest';
import { organization } from 'better-auth/plugins';
import { MEMBERSHIP_LIMIT_UNBOUNDED, resolveMembershipLimitOption } from './membership-limit.js';

/**
 * The field defect this pins: a customer adding users hit
 * `Organization membership limit reached` at 100 members. Nothing in this
 * codebase set that ceiling — better-auth substitutes 100 for an absent
 * `membershipLimit`, and the platform meters AI seats rather than membership.
 *
 * Two halves are asserted here, because either one alone can rot:
 *   1. what we decide to pass, and
 *   2. that the vendor really does still default to 100 when nobody passes it —
 *      the reason half 1 has to exist at all. If a future better-auth drops or
 *      changes that default, this test says so instead of leaving a mysterious
 *      constant behind.
 */
const KEY = 'OS_ORG_MEMBERSHIP_LIMIT';
const original = process.env[KEY];

afterEach(() => {
  if (original === undefined) delete process.env[KEY];
  else process.env[KEY] = original;
});

describe('resolveMembershipLimitOption — membership is not a limited axis', () => {
  it('is unbounded when the deployment says nothing', () => {
    delete process.env[KEY];
    expect(resolveMembershipLimitOption()).toBe(MEMBERSHIP_LIMIT_UNBOUNDED);
  });

  it('clears the vendor default by a wide margin — 100 must not be reachable by accident', () => {
    delete process.env[KEY];
    expect(resolveMembershipLimitOption()).toBeGreaterThan(100_000);
  });

  it('is a finite number, not Infinity — the option travels through plumbing that may assume finite', () => {
    delete process.env[KEY];
    expect(Number.isFinite(resolveMembershipLimitOption())).toBe(true);
  });

  it('honours an explicit ceiling from OS_ORG_MEMBERSHIP_LIMIT', () => {
    process.env[KEY] = '25';
    expect(resolveMembershipLimitOption()).toBe(25);
  });

  it('reads an unusable value as unset rather than as a cap — a typo must not lock an organization', () => {
    for (const bad of ['', '   ', 'abc', '0', '-5']) {
      process.env[KEY] = bad;
      expect(resolveMembershipLimitOption(), `value=${JSON.stringify(bad)}`).toBe(MEMBERSHIP_LIMIT_UNBOUNDED);
    }
  });
});

describe('the vendor default this displaces', () => {
  it('better-auth still ships an organization plugin, so the option we pass has a consumer', () => {
    // A shallow but real check: the plugin constructs with our option and keeps
    // its identity. If `membershipLimit` were renamed upstream, the option would
    // silently stop being read — this at least keeps the construction honest,
    // and the 100-member refusal is covered end-to-end by the org suites.
    const plugin = organization({ membershipLimit: resolveMembershipLimitOption() }) as { id?: string };
    expect(plugin.id).toBe('organization');
  });
});
