// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// The `external` organization role (ruling of record 6355206139, letter B,
// stage 1): the contract face — the closed vocabulary carries it, its
// projection is the reserved `org_external` identity, and its grant row lets
// any issuer confer it.

import { describe, expect, it } from 'vitest';
import {
  BUILTIN_MEMBERSHIP_ROLES,
  BUILTIN_MEMBERSHIP_ROLE_OPTIONS,
  MEMBERSHIP_ROLE_EXTERNAL,
} from './membership-role';
import {
  BUILTIN_IDENTITY_METADATA,
  BUILTIN_IDENTITY_NAMES,
  BUILTIN_IDENTITY_ORG_EXTERNAL,
  mapMembershipRole,
} from './eval-user.zod';
import {
  INVITATION_ROLE_ANY_ISSUER,
  INVITATION_ROLE_OPTIONS,
  invitationRoleGrantPredicate,
  invitationRoleGrantors,
} from './invitation-role-grant';

describe('the external membership role', () => {
  it('is one value of the closed vocabulary, offered under its own label', () => {
    expect(BUILTIN_MEMBERSHIP_ROLES).toContain(MEMBERSHIP_ROLE_EXTERNAL);
    expect(BUILTIN_MEMBERSHIP_ROLE_OPTIONS).toContainEqual({ label: 'External', value: MEMBERSHIP_ROLE_EXTERNAL });
  });

  it('projects to the reserved org_external identity, whatever its spelling', () => {
    for (const raw of ['external', ' External ', 'EXTERNAL']) {
      expect(mapMembershipRole(raw), raw).toBe(BUILTIN_IDENTITY_ORG_EXTERNAL);
    }
    expect(BUILTIN_IDENTITY_NAMES).toContain(BUILTIN_IDENTITY_ORG_EXTERNAL);
    expect(BUILTIN_IDENTITY_METADATA[BUILTIN_IDENTITY_ORG_EXTERNAL].label).toBeTruthy();
  });

  it('any issuer may confer it, so the invite dialog offers it ungated', () => {
    expect(invitationRoleGrantors(MEMBERSHIP_ROLE_EXTERNAL)).toBe(INVITATION_ROLE_ANY_ISSUER);
    expect(invitationRoleGrantPredicate(MEMBERSHIP_ROLE_EXTERNAL)).toBeUndefined();
    const option = INVITATION_ROLE_OPTIONS.find((o) => o.value === MEMBERSHIP_ROLE_EXTERNAL);
    expect(option).toBeDefined();
    expect(option).not.toHaveProperty('visibleWhen');
  });
});
