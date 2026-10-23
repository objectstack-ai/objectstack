// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D8/D9] The one organization-reach rule, pinned on its own as a
 * table over every caller shape, wall and D9 decision. Both readers —
 * `SettingsService` and the resolver's direct localization fallback — hand
 * their facts to this rule, so these rows are what both of them answer. Their
 * own pins (`settings-organization-reach.pin.test.ts`,
 * `resolve-localization-fallback-organization.pin.test.ts`) hold each reader's
 * facts — the posture source and the failure policy; this table holds the rule.
 */

import { describe, expect, it } from 'vitest';

import {
  organizationIdOf,
  organizationReachAdmits,
  organizationReachRowOwner,
  resolveOrganizationReach,
  UNOWNED_ORGANIZATION_REACH,
  type OrganizationReach,
} from './organization-reach.js';
import type { SystemWriteOrganizationDecision } from './system-write-organization.js';
import * as securityIndex from './index.js';

const DERIVED: SystemWriteOrganizationDecision = { kind: 'derived', organizationId: 'org_only' };
const LEAN: SystemWriteOrganizationDecision = { kind: 'no-organization-object' };
const REFUSE_NONE: SystemWriteOrganizationDecision = { kind: 'refuse', reason: 'no-organization', organizationCount: 0 };
const REFUSE_SEVERAL: SystemWriteOrganizationDecision = {
  kind: 'refuse',
  reason: 'ambiguous-organization',
  organizationCount: 2,
};
const REFUSE_WALLED: SystemWriteOrganizationDecision = { kind: 'refuse', reason: 'walled-posture' };

/** The facts for one row, recording which of them the rule asked. */
function factsOf(callerOrganizationId: unknown, wall: boolean, decision: SystemWriteOrganizationDecision) {
  const asked: string[] = [];
  return {
    asked,
    facts: {
      callerOrganizationId,
      wallStands: () => {
        asked.push('wall');
        return wall;
      },
      deriveOrganization: async () => {
        asked.push('derive');
        return decision;
      },
    },
  };
}

describe('[ADR-0131 D8/D9] resolveOrganizationReach — the one reach rule', () => {
  // [caller organization, wall stands?, D9 decision, reach, facts asked]
  const table: Array<[unknown, boolean, SystemWriteOrganizationDecision, OrganizationReach, string[]]> = [
    // A caller that names an organization is that organization's, under every
    // posture, and asks nothing else.
    ['org_a', false, DERIVED, { kind: 'own', organizationId: 'org_a' }, []],
    ['org_a', true, REFUSE_WALLED, { kind: 'own', organizationId: 'org_a' }, []],
    ['org_a', false, LEAN, { kind: 'own', organizationId: 'org_a' }, []],
    // A caller that names none, behind a wall: unowned, D9 never asked.
    [undefined, true, DERIVED, UNOWNED_ORGANIZATION_REACH, ['wall']],
    ['', true, LEAN, UNOWNED_ORGANIZATION_REACH, ['wall']],
    // A caller that names none, no wall: whatever D9 decides.
    [undefined, false, DERIVED, { kind: 'own', organizationId: 'org_only' }, ['wall', 'derive']],
    [null, false, LEAN, { kind: 'no-organization-object' }, ['wall', 'derive']],
    ['', false, REFUSE_NONE, UNOWNED_ORGANIZATION_REACH, ['wall', 'derive']],
    [undefined, false, REFUSE_SEVERAL, UNOWNED_ORGANIZATION_REACH, ['wall', 'derive']],
    [undefined, false, REFUSE_WALLED, UNOWNED_ORGANIZATION_REACH, ['wall', 'derive']],
    // A non-string caller id names no organization.
    [42, false, DERIVED, { kind: 'own', organizationId: 'org_only' }, ['wall', 'derive']],
  ];

  it.each(table)('caller=%j · wall=%s · decision=%j → %j', async (caller, wall, decision, reach, askedFacts) => {
    const { asked, facts } = factsOf(caller, wall, decision);
    expect(await resolveOrganizationReach(facts)).toEqual(reach);
    expect(asked).toEqual(askedFacts);
  });

  it('a fact that throws propagates — the reader owns its failure policy', async () => {
    await expect(resolveOrganizationReach({
      callerOrganizationId: undefined,
      wallStands: () => { throw new Error('posture unreadable'); },
      deriveOrganization: async () => DERIVED,
    })).rejects.toThrow('posture unreadable');
    await expect(resolveOrganizationReach({
      callerOrganizationId: undefined,
      wallStands: async () => false,
      deriveOrganization: async () => { throw new Error('organization read failed'); },
    })).rejects.toThrow('organization read failed');
  });
});

describe('[ADR-0131 D8] organizationReachRowOwner / organizationReachAdmits — whose rows a reach reads', () => {
  const own: OrganizationReach = { kind: 'own', organizationId: 'org_a' };
  const lean: OrganizationReach = { kind: 'no-organization-object' };

  it('the row owner: the organization, NULL for the lean arm, nothing for unowned', () => {
    expect(organizationReachRowOwner(own)).toBe('org_a');
    expect(organizationReachRowOwner(lean)).toBeNull();
    expect(organizationReachRowOwner(UNOWNED_ORGANIZATION_REACH)).toBeUndefined();
  });

  // [reach, row's organization, admitted?]
  const rows: Array<[OrganizationReach, unknown, boolean]> = [
    [own, 'org_a', true],
    [own, 'org_b', false],
    // A row with no organization is never an organization's fallback.
    [own, null, false],
    [own, undefined, false],
    [own, '', false],
    // The lean arm reads the NULL rows only.
    [lean, null, true],
    [lean, undefined, true],
    [lean, '', true],
    [lean, 'org_a', false],
    // Unowned reads nothing — a NULL row included.
    [UNOWNED_ORGANIZATION_REACH, null, false],
    [UNOWNED_ORGANIZATION_REACH, 'org_a', false],
  ];

  it.each(rows)('reach=%j · row organization=%j → %s', (reach, rowOrganizationId, admitted) => {
    expect(organizationReachAdmits(reach, rowOrganizationId)).toBe(admitted);
  });

  it('"no organization" is spelled one way: a non-empty string, else null', () => {
    expect(organizationIdOf('org_a')).toBe('org_a');
    expect(organizationIdOf('')).toBeNull();
    expect(organizationIdOf(null)).toBeNull();
    expect(organizationIdOf(undefined)).toBeNull();
    expect(organizationIdOf(7)).toBeNull();
  });

  it('is exported from core security — the bindings every reader imports', () => {
    expect(securityIndex.resolveOrganizationReach).toBe(resolveOrganizationReach);
    expect(securityIndex.organizationReachAdmits).toBe(organizationReachAdmits);
    expect(securityIndex.organizationReachRowOwner).toBe(organizationReachRowOwner);
    expect(securityIndex.organizationIdOf).toBe(organizationIdOf);
    expect(securityIndex.UNOWNED_ORGANIZATION_REACH).toBe(UNOWNED_ORGANIZATION_REACH);
  });
});
