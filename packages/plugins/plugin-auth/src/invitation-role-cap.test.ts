// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0105 D8 / #3697] The invitation role cap — the half of the fix that
 * keeps `delegated_admin` from being a privilege-escalation ladder.
 *
 * The chain this closes, verbatim from the issue: a subtree-scoped delegate
 * invites someone as `admin` → better-auth's `creatorRole` guard (default
 * `owner`) does not object → acceptance writes `sys_member(role='admin')` →
 * `auto-org-admin-grant.ts` auto-elevates it to `organization_admin` →
 * wildcard `modifyAllRecords` → `isTenantAdmin()`. A delegate would have
 * manufactured authority strictly greater than their own.
 */

import { describe, expect, it } from 'vitest';
import {
  invitationRoleCapFailure,
  isPlainMemberInvitation,
  orgRoleGrade,
  parseOrgRoles,
} from './invitation-role-cap.js';

const DELEGATE = 'delegated_admin';

describe('parseOrgRoles', () => {
  it('accepts better-auth’s three role shapes', () => {
    expect(parseOrgRoles('admin')).toEqual(['admin']);
    expect(parseOrgRoles('owner,admin')).toEqual(['owner', 'admin']);
    expect(parseOrgRoles(['owner', 'admin'])).toEqual(['owner', 'admin']);
  });

  it('normalizes case and whitespace — a padded role is the same role', () => {
    expect(parseOrgRoles('  Admin , MEMBER ')).toEqual(['admin', 'member']);
  });

  it('non-string, empty and blank values parse to nothing', () => {
    for (const v of [undefined, null, 42, {}, '', '  ', ',,']) {
      expect(parseOrgRoles(v)).toEqual([]);
    }
  });
});

describe('orgRoleGrade', () => {
  it('ranks owner above admin above everything else', () => {
    expect(orgRoleGrade('owner')).toBeGreaterThan(orgRoleGrade('admin'));
    expect(orgRoleGrade('admin')).toBeGreaterThan(orgRoleGrade('member'));
  });

  it('an app role and the delegate role grade as ordinary members', () => {
    expect(orgRoleGrade(DELEGATE)).toBe(orgRoleGrade('member'));
    expect(orgRoleGrade('sales_manager')).toBe(orgRoleGrade('member'));
  });

  it('a comma list takes the HIGHEST grade — smuggling admin in a list gains nothing', () => {
    expect(orgRoleGrade('member,admin')).toBe(orgRoleGrade('admin'));
    expect(orgRoleGrade(`${DELEGATE},owner`)).toBe(orgRoleGrade('owner'));
  });

  it('an unresolvable role grades BELOW a plain member (fail-closed floor)', () => {
    expect(orgRoleGrade(null)).toBeLessThan(orgRoleGrade('member'));
    expect(orgRoleGrade('')).toBeLessThan(orgRoleGrade('member'));
  });
});

describe('isPlainMemberInvitation', () => {
  it('is true only for exactly one plain member role', () => {
    expect(isPlainMemberInvitation('member')).toBe(true);
    expect(isPlainMemberInvitation(['member'])).toBe(true);
    expect(isPlainMemberInvitation(' Member ')).toBe(true);
  });

  it('is false for anything that could carry capability', () => {
    expect(isPlainMemberInvitation('admin')).toBe(false);
    expect(isPlainMemberInvitation('member,sales_manager')).toBe(false);
    expect(isPlainMemberInvitation(DELEGATE)).toBe(false);
    expect(isPlainMemberInvitation(undefined)).toBe(false);
  });
});

describe('invitationRoleCapFailure — the escalation chain', () => {
  it('REFUSES the chain: a delegate inviting an admin', () => {
    const failure = invitationRoleCapFailure('admin', DELEGATE);
    expect(failure).toMatch(/never confer a role above the issuer/);
  });

  it('REFUSES a delegate inviting an owner', () => {
    expect(invitationRoleCapFailure('owner', DELEGATE)).toMatch(/above the issuer/);
  });

  it('REFUSES admin smuggled inside a comma list', () => {
    expect(invitationRoleCapFailure('member,admin', DELEGATE)).toMatch(/above the issuer/);
  });

  it('REFUSES a delegate inviting an app role — membership roles are a capability channel too', () => {
    // `mapMembershipRole` passes an unknown role through as a position name; if
    // the deployment bound sets to `sales_manager`, the invitee would inherit
    // them with nothing gating the hand-out. A delegate's channel for
    // capability is the invitation's PLACEMENT intent, which the D12 gate
    // allowlists position-by-position.
    expect(invitationRoleCapFailure('sales_manager', DELEGATE)).toMatch(
      /may invite only as 'member'/,
    );
  });

  it('REFUSES a delegate minting another delegate', () => {
    expect(invitationRoleCapFailure(DELEGATE, DELEGATE)).toMatch(/may invite only as 'member'/);
  });

  it('ALLOWS a delegate inviting a plain member — the capability the fix exists to grant', () => {
    expect(invitationRoleCapFailure('member', DELEGATE)).toBeNull();
  });
});

describe('invitationRoleCapFailure — org owners and admins are unaffected', () => {
  it('an owner may invite any grade', () => {
    expect(invitationRoleCapFailure('owner', 'owner')).toBeNull();
    expect(invitationRoleCapFailure('admin', 'owner')).toBeNull();
    expect(invitationRoleCapFailure('member', 'owner')).toBeNull();
    expect(invitationRoleCapFailure(DELEGATE, 'owner')).toBeNull();
  });

  it('an admin may invite an admin, a delegate and app roles — but never an owner', () => {
    expect(invitationRoleCapFailure('admin', 'admin')).toBeNull();
    expect(invitationRoleCapFailure(DELEGATE, 'admin')).toBeNull();
    expect(invitationRoleCapFailure('sales_manager', 'admin')).toBeNull();
    expect(invitationRoleCapFailure('owner', 'admin')).toMatch(/above the issuer/);
  });

  it('an issuer holding both roles is judged on the higher one', () => {
    expect(invitationRoleCapFailure('owner', 'member,owner')).toBeNull();
  });
});

describe('invitationRoleCapFailure — fail-closed', () => {
  it('an unresolvable issuer role confers nothing above a plain member', () => {
    for (const unresolved of [null, undefined, '']) {
      // Reported as what it is — unverified, not outranked.
      expect(invitationRoleCapFailure('admin', unresolved)).toMatch(/could not be verified/);
      expect(invitationRoleCapFailure('sales_manager', unresolved)).toMatch(
        /could not be verified/,
      );
      // …but the ordinary invitation still works: an unreadable membership row
      // must not take the whole invite surface down with it.
      expect(invitationRoleCapFailure('member', unresolved)).toBeNull();
    }
  });

  it('an invitation with no role at all is left to better-auth’s required-field check', () => {
    expect(invitationRoleCapFailure(undefined, 'owner')).toBeNull();
    expect(invitationRoleCapFailure('', DELEGATE)).toBeNull();
  });
});
