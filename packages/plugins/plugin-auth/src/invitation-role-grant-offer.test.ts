// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The invite dialog's role picker and the invitation role cap read one table
 * (`INVITATION_ROLE_GRANTORS`, `@objectstack/spec/identity`). Two pins:
 *
 *  1. **The offer is the door.** For each issuer grade, evaluate the per-option
 *     `visibleWhen` that the three `invite_user` mirrors declare, with the CEL
 *     engine, against the `current_user.positions` that grade projects to. The
 *     offered set must equal the set of roles the cap admits for that issuer.
 *     A static option list (no `visibleWhen`) offers a delegated_admin all
 *     four roles, of which the cap refuses three, so this goes red.
 *  2. **The cap refuses what it refused before it read the table.** A frozen
 *     copy of the pre-table cap is the oracle; every case of the grid below
 *     must give the same answer, refusal text included.
 */

import { describe, expect, it } from 'vitest';
import { celEngine } from '@objectstack/formula';
import {
  BUILTIN_MEMBERSHIP_ROLES,
  mapMembershipRole,
} from '@objectstack/spec/identity';
import { SysInvitation, SysMember, SysUser } from '@objectstack/platform-objects/identity';
import { invitationRoleCapFailure } from './invitation-role-cap.js';

type Option = { value: string; visibleWhen?: string | { source?: string } };

const MIRRORS: Array<[string, unknown]> = [
  ['sys_user', SysUser],
  ['sys_member', SysMember],
  ['sys_invitation', SysInvitation],
];

function roleOptions(object: unknown): Option[] {
  const actions = (object as { actions?: Array<{ name?: string; params?: Array<{ field?: string; options?: Option[] }> }> }).actions ?? [];
  const invite = actions.find((a) => a.name === 'invite_user');
  const role = invite?.params?.find((p) => p.field === 'role');
  expect(role?.options, 'invite_user declares its own role options').toBeDefined();
  return role?.options ?? [];
}

/** The option values a caller holding `positions` is offered. */
function offered(options: Option[], positions: string[]): string[] {
  return options
    .filter((option) => {
      if (option.visibleWhen === undefined) return true;
      const source = typeof option.visibleWhen === 'string' ? option.visibleWhen : option.visibleWhen.source;
      const result = celEngine.evaluate({ dialect: 'cel', source: source ?? '' }, {
        user: { id: 'u1', positions },
      });
      expect(result.ok, `visibleWhen of '${option.value}' evaluates`).toBe(true);
      return result.ok && result.value === true;
    })
    .map((option) => option.value);
}

describe('invite_user role picker — the offer is what the cap admits', () => {
  describe.each(MIRRORS)('%s', (_name, object) => {
    it.each([...BUILTIN_MEMBERSHIP_ROLES])('issuer %s', (issuer) => {
      const admitted = BUILTIN_MEMBERSHIP_ROLES.filter((role) => invitationRoleCapFailure(role, issuer) === null);
      expect(offered(roleOptions(object), [mapMembershipRole(issuer)])).toEqual(admitted);
    });
  });

  it('a delegated_admin is offered member alone; an owner the whole list', () => {
    const options = roleOptions(SysInvitation);
    expect(offered(options, ['delegated_admin'])).toEqual(['member']);
    expect(offered(options, ['org_admin'])).toEqual(['admin', 'delegated_admin', 'member']);
    expect(offered(options, ['org_owner'])).toEqual([...BUILTIN_MEMBERSHIP_ROLES]);
  });
});

// ── The pre-table cap, frozen as the parity oracle ─────────────────────────

function oracleParse(raw: unknown): string[] {
  const flat = Array.isArray(raw) ? raw.join(',') : raw;
  if (typeof flat !== 'string') return [];
  return flat.split(',').map((r) => r.trim().toLowerCase()).filter((r) => r.length > 0);
}

function oracleGrade(raw: unknown): number {
  const roles = oracleParse(raw);
  if (roles.length === 0) return 0;
  let grade = 1;
  for (const role of roles) {
    if (role === 'owner') grade = Math.max(grade, 3);
    else if (role === 'admin') grade = Math.max(grade, 2);
  }
  return grade;
}

function oracleCap(requestedRole: unknown, issuerRole: unknown): string | null {
  const requested = oracleParse(requestedRole);
  if (requested.length === 0) return null;
  if (requested.length === 1 && requested[0] === 'member') return null;
  const issuerGrade = oracleGrade(issuerRole);
  const requestedGrade = oracleGrade(requestedRole);
  if (issuerGrade === 0) {
    return (
      `[Security] Access denied: your organization membership could not be verified, so this ` +
      `invitation may confer no role beyond 'member' ` +
      `(ADR-0090 D12: an unverifiable issuer confers nothing).`
    );
  }
  if (requestedGrade > issuerGrade) {
    return (
      `[Security] Access denied: you may not invite a member as '${requested.join(', ')}' — ` +
      `an invitation can never confer a role above the issuer's own ` +
      `(ADR-0090 D12: administration is a scoped capability).`
    );
  }
  if (issuerGrade < 2) {
    return (
      `[Security] Access denied: a delegated issuer may invite only as ` +
      `'member' — '${requested.join(', ')}' is an organization role that can ` +
      `carry capability of its own. Grant capability through the invitation's placement ` +
      `(business unit + positions), which is authorized against your adminScope.`
    );
  }
  return null;
}

const SINGLE = ['owner', 'admin', 'delegated_admin', 'member', 'sales_manager'];
const REQUESTED: unknown[] = [
  undefined, null, '', '  ', ',,', 42, {},
  ...SINGLE,
  ' Member ', 'OWNER', ['member'], ['admin', 'member'],
  ...SINGLE.flatMap((a) => SINGLE.map((b) => `${a},${b}`)),
];
const ISSUERS: unknown[] = [
  undefined, null, '', 42,
  ...SINGLE,
  'Owner ', ['admin'], ['member', 'owner'],
  ...SINGLE.flatMap((a) => SINGLE.map((b) => `${a},${b}`)),
];

describe('invitationRoleCapFailure — unchanged by reading the grant table', () => {
  it(`agrees with the pre-table cap on all ${REQUESTED.length * ISSUERS.length} cases`, () => {
    let refused = 0;
    for (const requested of REQUESTED) {
      for (const issuer of ISSUERS) {
        const expected = oracleCap(requested, issuer);
        if (expected !== null) refused += 1;
        expect(
          invitationRoleCapFailure(requested, issuer),
          `requested ${JSON.stringify(requested)} by issuer ${JSON.stringify(issuer)}`,
        ).toBe(expected);
      }
    }
    // The grid exercises refusals and admissions both, so agreement is not
    // a grid of nulls agreeing with nulls.
    expect(refused).toBeGreaterThan(100);
    expect(refused).toBeLessThan(REQUESTED.length * ISSUERS.length);
  });
});
