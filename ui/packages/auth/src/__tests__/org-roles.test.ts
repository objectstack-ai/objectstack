// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Organization role vocabulary + narrowing helpers.
 *
 * These MIRROR two different server gates, and the tests are written to fail
 * loudly if either drifts:
 *
 *  - `invitableOrgRoles` ↔ the framework's `beforeCreateInvitation` role cap
 *    (framework#3697): never above your own grade, and a below-admin issuer may
 *    invite as `member` or `external` only — the rows of the spec's grant table
 *    that any issuer may confer (pinned to that table below).
 *  - `assignableOrgRoles` ↔ better-auth's `update-member-role` route: needs
 *    `member:["update"]` (owner/admin only), and only an owner may set `owner`
 *    or re-role an existing owner.
 *
 * Both NARROW; neither decides. The server re-checks, so the only failure the
 * console can cause is offering something that then 403s — which is exactly
 * what these pin.
 */

import { describe, it, expect } from 'vitest';
import { INVITATION_ROLE_ANY_ISSUER, INVITATION_ROLE_GRANTORS } from '@objectstack/spec/identity';
import {
  ORG_ROLES,
  ORG_ROLE_LABELS,
  ORG_ROLE_DELEGATED_ADMIN,
  ORG_ROLE_EXTERNAL,
  orgRoleGrade,
  invitableOrgRoles,
  assignableOrgRoles,
} from '../org-roles';

/**
 * What the framework's invitation cap admits for one issuer role, read off the
 * spec's grant table: a below-admin issuer gets the `'any'` rows only, an
 * administrative issuer every row that is `'any'` or names its role.
 */
function grantTableOffer(issuer: 'owner' | 'admin' | 'below-admin'): string[] {
  return ORG_ROLES.filter((role) => {
    const grantors = (INVITATION_ROLE_GRANTORS as Record<string, unknown>)[role];
    if (grantors === INVITATION_ROLE_ANY_ISSUER) return true;
    return issuer !== 'below-admin' && (grantors as readonly string[]).includes(issuer);
  });
}

describe('vocabulary', () => {
  it('offers the spec vocabulary WHOLE — including the delegated issuer grade', () => {
    // The names themselves derive from `@objectstack/spec`
    // (`BUILTIN_MEMBERSHIP_ROLES`), so there is no drift to guard against any
    // more — #2907's exact-list assertion is gone with the mirror. What this
    // pins is a console decision: `ORG_ROLES` is the spec list UNFILTERED.
    // Hiding a grade from the screens belongs in the narrowing helpers below,
    // never in the vocabulary.
    expect(ORG_ROLES).toContain(ORG_ROLE_DELEGATED_ADMIN);
  });

  it('every role has a label — a role with no label renders as a raw key', () => {
    for (const role of ORG_ROLES) {
      expect(ORG_ROLE_LABELS[role]?.key).toBeTruthy();
      expect(ORG_ROLE_LABELS[role]?.defaultValue).toBeTruthy();
    }
  });

  it('labels the external grade (objectui#13427)', () => {
    // objectstack#25515 added `external` to BUILTIN_MEMBERSHIP_ROLES; the
    // exhaustive label table is what stopped the console compiling there.
    expect(ORG_ROLE_EXTERNAL).toBe('external');
    expect(ORG_ROLE_LABELS[ORG_ROLE_EXTERNAL]).toEqual({
      key: 'organization.roles.external',
      defaultValue: 'External',
    });
  });
});

describe('orgRoleGrade', () => {
  it('ranks owner above admin above everything else', () => {
    expect(orgRoleGrade('owner')).toBeGreaterThan(orgRoleGrade('admin'));
    expect(orgRoleGrade('admin')).toBeGreaterThan(orgRoleGrade('member'));
  });

  it('the delegate grade and app roles are ordinary members', () => {
    expect(orgRoleGrade(ORG_ROLE_DELEGATED_ADMIN)).toBe(orgRoleGrade('member'));
    expect(orgRoleGrade('sales_manager')).toBe(orgRoleGrade('member'));
  });

  it('external grades no higher than a member — never an administrative grade', () => {
    // The framework cap's ladder grades it as `member`; what it reaches below a
    // member is enforced server-side, not on this ladder.
    expect(orgRoleGrade(ORG_ROLE_EXTERNAL)).toBe(orgRoleGrade('member'));
    expect(orgRoleGrade(ORG_ROLE_EXTERNAL)).toBeLessThan(orgRoleGrade('admin'));
  });

  it('a comma list takes the HIGHEST grade', () => {
    expect(orgRoleGrade('member,admin')).toBe(orgRoleGrade('admin'));
  });

  it('an unresolvable role grades BELOW a plain member (fail-closed floor)', () => {
    for (const v of [null, undefined, '', 42, {}]) {
      expect(orgRoleGrade(v)).toBeLessThan(orgRoleGrade('member'));
    }
  });
});

describe('invitableOrgRoles — mirrors the invitation role cap', () => {
  it('an owner may invite every grade', () => {
    expect(invitableOrgRoles('owner')).toEqual([...ORG_ROLES]);
  });

  it('an admin may invite everything except owner', () => {
    const roles = invitableOrgRoles('admin');
    expect(roles).toContain('admin');
    expect(roles).toContain(ORG_ROLE_DELEGATED_ADMIN);
    expect(roles).toContain('member');
    expect(roles).not.toContain('owner');
  });

  it('a DELEGATE may invite as member, and as nothing that carries authority — the escalation chain, closed in the UI too', () => {
    const roles = invitableOrgRoles(ORG_ROLE_DELEGATED_ADMIN);
    expect(roles).toContain('member');
    for (const r of ['owner', 'admin', ORG_ROLE_DELEGATED_ADMIN]) expect(roles).not.toContain(r);
  });

  it('an unresolvable caller is offered the any-issuer roles alone, never nothing', () => {
    // Offering nothing would break the ordinary invite for a caller whose
    // membership simply has not loaded yet; the cap still admits a single
    // `member` (or, once the spec lists it, `external`) invitation from an
    // unverified issuer.
    for (const v of [null, undefined, '']) {
      expect(invitableOrgRoles(v)).toContain('member');
      expect(invitableOrgRoles(v)).toEqual(invitableOrgRoles(ORG_ROLE_DELEGATED_ADMIN));
    }
  });

  it('offers exactly what the spec grant table admits, for every issuer grade', () => {
    // The table the framework cap reads (`@objectstack/spec/identity`). A row
    // the spec adds or moves turns this red before the console offers a role
    // the server refuses, or hides one it admits.
    expect(invitableOrgRoles('owner')).toEqual(grantTableOffer('owner'));
    expect(invitableOrgRoles('admin')).toEqual(grantTableOffer('admin'));
    for (const issuer of [ORG_ROLE_DELEGATED_ADMIN, 'member', ORG_ROLE_EXTERNAL, null]) {
      expect(invitableOrgRoles(issuer)).toEqual(grantTableOffer('below-admin'));
    }
  });
});

describe('assignableOrgRoles — mirrors update-member-role', () => {
  it('an owner may set anything, including owner', () => {
    expect(assignableOrgRoles('owner', 'member')).toEqual([...ORG_ROLES]);
  });

  it('an admin may set the delegate grade but never owner', () => {
    const roles = assignableOrgRoles('admin', 'member');
    expect(roles).toContain(ORG_ROLE_DELEGATED_ADMIN);
    expect(roles).not.toContain('owner');
  });

  it('an admin may not re-role an existing owner at all', () => {
    expect(assignableOrgRoles('admin', 'owner')).toEqual([]);
  });

  it('an admin may re-role an existing external to anything but owner', () => {
    expect(assignableOrgRoles('admin', ORG_ROLE_EXTERNAL)).toEqual(
      ORG_ROLES.filter((r) => r !== 'owner'),
    );
  });

  it('an external may re-role NOBODY — it holds no organization permission at all', () => {
    expect(assignableOrgRoles(ORG_ROLE_EXTERNAL, 'member')).toEqual([]);
    expect(assignableOrgRoles(ORG_ROLE_EXTERNAL, ORG_ROLE_EXTERNAL)).toEqual([]);
  });

  it('a delegate may re-role NOBODY — they hold no member:update permission', () => {
    expect(assignableOrgRoles(ORG_ROLE_DELEGATED_ADMIN, 'member')).toEqual([]);
    expect(assignableOrgRoles('member', 'member')).toEqual([]);
  });

  it('an unresolvable actor may re-role nobody (fail closed)', () => {
    for (const v of [null, undefined, '']) {
      expect(assignableOrgRoles(v, 'member')).toEqual([]);
    }
  });
});
