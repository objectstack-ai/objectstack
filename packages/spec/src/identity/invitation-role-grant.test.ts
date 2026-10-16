// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import {
  INVITATION_ROLE_ANY_ISSUER,
  INVITATION_ROLE_GRANTORS,
  INVITATION_ROLE_OPTIONS,
  invitationRoleGrantPredicate,
  invitationRoleGrantors,
} from './invitation-role-grant';
import { BUILTIN_MEMBERSHIP_ROLES, BUILTIN_MEMBERSHIP_ROLE_OPTIONS } from './membership-role';

describe('INVITATION_ROLE_GRANTORS', () => {
  it('has one row per role in the closed membership vocabulary', () => {
    expect(Object.keys(INVITATION_ROLE_GRANTORS).sort()).toEqual([...BUILTIN_MEMBERSHIP_ROLES].sort());
  });

  it('an unlisted role takes the administrative row', () => {
    expect(invitationRoleGrantors('sales_manager')).toEqual(['owner', 'admin']);
    expect(invitationRoleGrantors('member')).toBe(INVITATION_ROLE_ANY_ISSUER);
  });
});

describe('invitationRoleGrantPredicate', () => {
  it('projects each grantor grade through mapMembershipRole', () => {
    expect(invitationRoleGrantPredicate('owner')).toBe("'org_owner' in current_user.positions");
    expect(invitationRoleGrantPredicate('admin')).toBe(
      "'org_owner' in current_user.positions || 'org_admin' in current_user.positions",
    );
    expect(invitationRoleGrantPredicate('delegated_admin')).toBe(
      "'org_owner' in current_user.positions || 'org_admin' in current_user.positions",
    );
  });

  it('an any-issuer row has no gate', () => {
    expect(invitationRoleGrantPredicate('member')).toBeUndefined();
  });
});

describe('INVITATION_ROLE_OPTIONS', () => {
  it('keeps the vocabulary’s values, labels and order', () => {
    expect(INVITATION_ROLE_OPTIONS.map(({ label, value }) => ({ label, value }))).toEqual(
      BUILTIN_MEMBERSHIP_ROLE_OPTIONS.map(({ label, value }) => ({ label, value })),
    );
  });

  it('gates each option by its grant row, and leaves member ungated', () => {
    for (const option of INVITATION_ROLE_OPTIONS) {
      expect(option.visibleWhen).toBe(
        invitationRoleGrantPredicate(option.value as (typeof BUILTIN_MEMBERSHIP_ROLES)[number]),
      );
    }
    expect(INVITATION_ROLE_OPTIONS.find((o) => o.value === 'member')).not.toHaveProperty('visibleWhen');
  });
});
