// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import {
  MEMBERSHIP_REACH,
  MEMBERSHIP_REACH_NAMES,
  lowerRequiresMembershipReach,
  membershipReachPredicate,
} from './membership-reach';
import { BUILTIN_MEMBERSHIP_ROLES } from './membership-role';

// The table's own invariants. Its equality with what better-auth's door
// actually admits lives with the producer, in plugin-auth
// (`membership-reach-table.test.ts`) — this file checks the table and the
// lowering in isolation.
describe('MEMBERSHIP_REACH table', () => {
  it('names every row in the sugar enum, and nothing else', () => {
    expect([...MEMBERSHIP_REACH_NAMES].sort()).toEqual(Object.keys(MEMBERSHIP_REACH).sort());
  });

  it('row names are snake_case machine names', () => {
    for (const name of MEMBERSHIP_REACH_NAMES) expect(name).toMatch(/^[a-z][a-z0-9_]*$/);
  });

  it('every row lists only grades from the closed membership vocabulary, without repeats', () => {
    const vocabulary: readonly string[] = BUILTIN_MEMBERSHIP_ROLES;
    for (const [name, row] of Object.entries(MEMBERSHIP_REACH)) {
      expect(row.grades.length, name).toBeGreaterThan(0);
      expect(new Set(row.grades).size, name).toBe(row.grades.length);
      for (const grade of row.grades) expect(vocabulary, `${name}: ${grade}`).toContain(grade);
    }
  });

  it('a plain member reaches no row — the grade the gate exists to exclude', () => {
    for (const [name, row] of Object.entries(MEMBERSHIP_REACH)) {
      expect(row.grades as readonly string[], name).not.toContain('member');
    }
  });

  it('every row names a better-auth organization endpoint', () => {
    for (const row of Object.values(MEMBERSHIP_REACH)) expect(row.endpoint).toMatch(/^\/organization\/[a-z-]+$/);
  });
});

describe('membershipReachPredicate', () => {
  it('projects each grade through mapMembershipRole into one positions term', () => {
    expect(membershipReachPredicate('invite_member')).toBe(
      "'org_owner' in current_user.positions || 'org_admin' in current_user.positions"
        + " || 'delegated_admin' in current_user.positions",
    );
    expect(membershipReachPredicate('remove_member')).toBe(
      "'org_owner' in current_user.positions || 'org_admin' in current_user.positions",
    );
    expect(membershipReachPredicate('transfer_ownership')).toBe("'org_owner' in current_user.positions");
  });

  it('never emits a raw better-auth grade name — positions carries the projected names', () => {
    for (const name of MEMBERSHIP_REACH_NAMES) {
      const source = membershipReachPredicate(name);
      expect(source).not.toMatch(/'(owner|admin)' in/);
    }
  });
});

describe('lowerRequiresMembershipReach', () => {
  const collect = () => {
    const issues: unknown[] = [];
    return {
      ctx: { addIssue: (i: unknown) => issues.push(i) } as never,
      issues,
    };
  };
  const ADMIN_GATE = "'org_owner' in current_user.positions || 'org_admin' in current_user.positions";
  const OWNER_GATE = "'org_owner' in current_user.positions";

  it('passes through untouched when the sugar is absent', () => {
    const { ctx, issues } = collect();
    const input = { name: 'x', visible: { dialect: 'cel', source: 'record.a == 1' } };
    expect(lowerRequiresMembershipReach(input, ctx)).toEqual(input);
    expect(issues).toHaveLength(0);
  });

  it('emits the bare gate when no visible exists, and strips the sugar key', () => {
    const { ctx, issues } = collect();
    const out = lowerRequiresMembershipReach({ name: 'x', requiresMembershipReach: 'remove_member' as const }, ctx);
    expect(out).toEqual({ name: 'x', visible: { dialect: 'cel', source: ADMIN_GATE } });
    expect('requiresMembershipReach' in out).toBe(false);
    expect(issues).toHaveLength(0);
  });

  it('treats `visible: true` as the explicit default — the gate alone', () => {
    const { ctx, issues } = collect();
    const out = lowerRequiresMembershipReach(
      { visible: true, requiresMembershipReach: 'remove_member' as const },
      ctx,
    );
    expect(out.visible).toEqual({ dialect: 'cel', source: ADMIN_GATE });
    expect(issues).toHaveLength(0);
  });

  it('composes with an existing CEL visible — existing first, a multi-term gate parenthesised last', () => {
    const { ctx, issues } = collect();
    const out = lowerRequiresMembershipReach(
      {
        requiresMembershipReach: 'remove_member' as const,
        visible: { dialect: 'cel', source: "has(record.role) && record.role != 'owner'" },
      },
      ctx,
    );
    expect(out.visible).toEqual({
      dialect: 'cel',
      source: `(has(record.role) && record.role != 'owner') && (${ADMIN_GATE})`,
    });
    expect(issues).toHaveLength(0);
  });

  it('leaves a single-term gate unparenthesised when composing', () => {
    const { ctx } = collect();
    const out = lowerRequiresMembershipReach(
      {
        requiresMembershipReach: 'transfer_ownership' as const,
        visible: { dialect: 'cel', source: "has(record.role) && record.role != 'owner'" },
      },
      ctx,
    );
    expect(out.visible).toEqual({
      dialect: 'cel',
      source: `(has(record.role) && record.role != 'owner') && ${OWNER_GATE}`,
    });
  });

  it('preserves envelope extras (meta) when composing', () => {
    const { ctx } = collect();
    const out = lowerRequiresMembershipReach(
      {
        requiresMembershipReach: 'transfer_ownership' as const,
        visible: { dialect: 'cel', source: 'a', meta: { rationale: 'r' } },
      },
      ctx,
    );
    expect(out.visible).toEqual({ dialect: 'cel', source: `(a) && ${OWNER_GATE}`, meta: { rationale: 'r' } });
  });

  it('refuses `visible: false` loudly — the gate could never take effect (ADR-0078)', () => {
    const { ctx, issues } = collect();
    const out = lowerRequiresMembershipReach(
      { visible: false, requiresMembershipReach: 'invite_member' as const },
      ctx,
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: 'custom', path: ['requiresMembershipReach'] });
    expect(out.visible).toBe(false);
    expect('requiresMembershipReach' in out).toBe(false);
  });

  it('refuses an AST-only or non-CEL visible loudly (ADR-0078)', () => {
    for (const visible of [
      { dialect: 'cel', ast: { kind: 'literal' } },
      { dialect: 'js', source: 'true' },
    ]) {
      const { ctx, issues } = collect();
      const out = lowerRequiresMembershipReach({ requiresMembershipReach: 'invite_member' as const, visible }, ctx);
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({ code: 'custom', path: ['requiresMembershipReach'] });
      expect(out.visible).toEqual(visible);
    }
  });

  it('refuses a CEL visible whose source is blank after trimming (ADR-0078)', () => {
    for (const visible of [
      { dialect: 'cel', source: '   ' },
      { dialect: 'cel', source: '' },
      { dialect: 'cel', source: '\n\t' },
    ]) {
      const { ctx, issues } = collect();
      const out = lowerRequiresMembershipReach({ requiresMembershipReach: 'invite_member' as const, visible }, ctx);
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({ code: 'custom', path: ['requiresMembershipReach'] });
      expect(out.visible).toEqual(visible);
    }
  });

  it('still composes a source padded with whitespace around real text', () => {
    const { ctx, issues } = collect();
    const out = lowerRequiresMembershipReach(
      { requiresMembershipReach: 'transfer_ownership' as const, visible: { dialect: 'cel', source: ' a ' } },
      ctx,
    );
    expect(issues).toHaveLength(0);
    expect(out.visible).toEqual({ dialect: 'cel', source: `( a ) && ${OWNER_GATE}` });
  });
});
