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
  INVITE_ISSUER_MEMBER_ONLY_CODE,
  INVITE_ISSUER_UNVERIFIED_CODE,
  INVITE_ROLE_ABOVE_ISSUER_CODE,
  invitationRoleCapFailure,
  isPlainMemberInvitation,
  orgRoleGrade,
  parseOrgRoles,
} from './invitation-role-cap.js';

const DELEGATE = 'delegated_admin';

/** The refusal's ADR-0112 code — what a client branches on (#23945). */
const codeOf = (requested: unknown, issuer: unknown) => invitationRoleCapFailure(requested, issuer)?.code;

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
    expect(codeOf('admin', DELEGATE)).toBe(INVITE_ROLE_ABOVE_ISSUER_CODE);
  });

  it('REFUSES a delegate inviting an owner', () => {
    expect(codeOf('owner', DELEGATE)).toBe(INVITE_ROLE_ABOVE_ISSUER_CODE);
  });

  it('REFUSES admin smuggled inside a comma list', () => {
    expect(codeOf('member,admin', DELEGATE)).toBe(INVITE_ROLE_ABOVE_ISSUER_CODE);
  });

  it('REFUSES a delegate inviting an app role — membership roles are a capability channel too', () => {
    // `mapMembershipRole` passes an unknown role through as a position name; if
    // the deployment bound sets to `sales_manager`, the invitee would inherit
    // them with nothing gating the hand-out. A delegate's channel for
    // capability is the invitation's PLACEMENT intent, which the D12 gate
    // allowlists position-by-position.
    expect(codeOf('sales_manager', DELEGATE)).toBe(INVITE_ISSUER_MEMBER_ONLY_CODE);
  });

  it('REFUSES a delegate minting another delegate', () => {
    expect(codeOf(DELEGATE, DELEGATE)).toBe(INVITE_ISSUER_MEMBER_ONLY_CODE);
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
    expect(codeOf('owner', 'admin')).toBe(INVITE_ROLE_ABOVE_ISSUER_CODE);
  });

  it('an issuer holding both roles is judged on the higher one', () => {
    expect(invitationRoleCapFailure('owner', 'member,owner')).toBeNull();
  });
});

describe('invitationRoleCapFailure — each refusal answers its own code (#23945)', () => {
  it('the three codes, by value — the strings the error-code ledger registers under plugin-auth', () => {
    expect([INVITE_ROLE_ABOVE_ISSUER_CODE, INVITE_ISSUER_MEMBER_ONLY_CODE, INVITE_ISSUER_UNVERIFIED_CODE]).toEqual([
      'INVITE_ROLE_ABOVE_ISSUER',
      'INVITE_ISSUER_MEMBER_ONLY',
      'INVITE_ISSUER_UNVERIFIED',
    ]);
  });

  it('a refusal carries its reason beside the code', () => {
    for (const [requested, issuer] of [['admin', DELEGATE], [DELEGATE, DELEGATE], ['admin', null]] as const) {
      const refusal = invitationRoleCapFailure(requested, issuer);
      expect(refusal?.message, `${requested} by ${issuer}`).toEqual(expect.any(String));
      expect(refusal?.message.length).toBeGreaterThan(0);
    }
  });
});

describe('invitationRoleCapFailure — fail-closed', () => {
  it('an unresolvable issuer role confers nothing above a plain member', () => {
    for (const unresolved of [null, undefined, '']) {
      // Reported as what it is — unverified, not outranked.
      expect(codeOf('admin', unresolved)).toBe(INVITE_ISSUER_UNVERIFIED_CODE);
      expect(codeOf('sales_manager', unresolved)).toBe(INVITE_ISSUER_UNVERIFIED_CODE);
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
