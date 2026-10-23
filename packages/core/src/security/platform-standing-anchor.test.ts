// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D5] The one anchor rule, pinned on its own as a table over every
 * posture and grant-owner shape. Both readers — the resolver's §6b
 * (`resolve-authz-context.ts`) and plugin-auth's last-administrator guard —
 * hand their facts to this rule, so these rows are what both of them answer.
 * Their own pins (`resolve-authz-context*.test.ts`, `last-admin-guard*.test.ts`)
 * hold each reader's facts; this table holds the rule.
 */

import { describe, expect, it } from 'vitest';

import { organizationAnchorsPlatformStanding } from './platform-standing-anchor.js';
import * as securityIndex from './index.js';

const DEFAULT_ORG = 'org_default';

describe('[ADR-0131 D5] organizationAnchorsPlatformStanding — the one anchor rule', () => {
  // [posture walled?, Default Organization, grant's organization, anchors?]
  const table: Array<[boolean, string | undefined, string | null | undefined, boolean]> = [
    // single: the Default Organization's grant anchors, nothing else does.
    [false, DEFAULT_ORG, DEFAULT_ORG, true],
    [false, DEFAULT_ORG, 'org_acme', false],
    [false, DEFAULT_ORG, null, false],
    [false, DEFAULT_ORG, undefined, false],
    // single, no Default Organization nameable (none, several none `default`,
    // or no organization object): nothing anchors — an organization-less
    // grant included, which must not match an absent id.
    [false, undefined, DEFAULT_ORG, false],
    [false, undefined, null, false],
    [false, undefined, undefined, false],
    // walled (`group` / `isolated`): no grant anchors, the Default
    // Organization's own included.
    [true, DEFAULT_ORG, DEFAULT_ORG, false],
    [true, DEFAULT_ORG, 'org_acme', false],
    [true, DEFAULT_ORG, null, false],
    [true, undefined, undefined, false],
  ];

  it.each(table)('walled=%s · default=%s · grant owner=%s → %s', (walled, defaultOrganizationId, owner, anchors) => {
    expect(organizationAnchorsPlatformStanding(owner, { walled, defaultOrganizationId })).toBe(anchors);
  });

  it('is exported from core security — the binding every reader imports', () => {
    expect(securityIndex.organizationAnchorsPlatformStanding).toBe(organizationAnchorsPlatformStanding);
  });
});
