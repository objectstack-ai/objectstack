// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The row builder's `user.*` subjects are members of the bag the browser
 * really evaluates against (objectstack#28833).
 *
 * `CONTEXT_SUBJECTS` offered `user.isAdmin`, which `buildExpressionUser` never
 * put on the bound `user` object, and `user.role`, the legacy better-auth
 * scalar. The engine's LINT cannot see either problem: it accepts any member of
 * an accepted root, so `ConditionBuilder.contextSubjects.test.tsx` stayed green
 * on `user.isAdmin`. What can see it is the bag, so these cases read the member
 * list off `buildExpressionUser` on both branches and evaluate every offered
 * subject against `buildExpressionScope`, the one scope the app-shell binds.
 *
 * Derived, not retyped (ui AGENTS.md #9): a member renamed or dropped in
 * `expressionUser.ts` reddens here, and so does a subject added to the list
 * that the bag does not carry.
 */

import { describe, it, expect } from 'vitest';

import { CEL_EXAMPLE_CLAUSES, CONTEXT_SUBJECTS, celRootsMentioned } from './ConditionBuilder';
import { buildExpressionUser } from '../../../providers/expressionUser';
import { createExpressionEvaluator } from '../../../providers/ExpressionProvider';

const ADMIN = { id: 'u-admin', name: 'Ada', email: 'ada@example.com', isPlatformAdmin: true };
const MEMBER = { id: 'u-member', name: 'Bo', email: 'bo@example.com' };

/** The three identities a client gate meets: admin, ordinary member, signed out. */
const BRANCHES = [
  ['platform admin', buildExpressionUser(ADMIN)],
  ['member', buildExpressionUser(MEMBER)],
  ['anonymous', buildExpressionUser(null)],
] as const;

const USER_SUBJECTS = CONTEXT_SUBJECTS.map((s) => s.value).filter((v) => v.startsWith('user.'));

/** Evaluate on the evaluator's fail-closed seam: a fault throws instead of answering `true`. */
function evaluate(expr: string, user: Record<string, unknown>): boolean {
  return createExpressionEvaluator({ user }).evaluateCondition(expr, { throwOnError: true });
}

/* ── control — the instrument can FAIL ─────────────────────────────────── */

describe('the bag refuses the members this card removed (objectstack#28833)', () => {
  it('`user.isAdmin` faults on every branch: it is not a member of the bag', () => {
    // Run first: every case below is worthless if a missing member does not
    // fault. If `buildExpressionUser` ever grows an `isAdmin`, this reddens and
    // the removal gets re-read instead of outliving its reason.
    for (const [branch, user] of BRANCHES) {
      expect(Object.keys(user), branch).not.toContain('isAdmin');
      expect(() => evaluate('user.isAdmin', user), branch).toThrow();
    }
  });

  it('`user.role` is in the bag but answers no admin question: a signed-in admin reads `user`', () => {
    // Why it was dropped rather than kept: the member resolves, so the bag pin
    // alone would admit it. It is the legacy scalar, defaulted to `user` for
    // every session, platform admins included.
    expect(evaluate("user.role == 'user'", buildExpressionUser(ADMIN))).toBe(true);
    expect(USER_SUBJECTS).not.toContain('user.role');
  });
});

/* ── subject — every offered `user.*` member is in the bag ─────────────── */

describe('every `user.*` subject the dropdown offers is a member of the bag (objectstack#28833)', () => {
  it('offers some `user.*` subject at all — an empty list would satisfy the cases below', () => {
    expect(USER_SUBJECTS).toContain('user.isPlatformAdmin');
  });

  it.each(BRANCHES)('each subject is an own key of the %s identity and evaluates without a fault', (_branch, user) => {
    for (const subject of USER_SUBJECTS) {
      const member = subject.slice('user.'.length);
      expect(Object.keys(user), subject).toContain(member);
      expect(() => evaluate(`${subject} != null`, user), subject).not.toThrow();
    }
  });

  it('a row "user.isPlatformAdmin is true" opens for the platform admin and no one else', () => {
    // The row builder compiles a value-less truthy row on a context subject to
    // the bare subject; this is the gate the card's author was trying to build.
    expect(evaluate('user.isPlatformAdmin', buildExpressionUser(ADMIN))).toBe(true);
    expect(evaluate('user.isPlatformAdmin', buildExpressionUser(MEMBER))).toBe(false);
    expect(evaluate('user.isPlatformAdmin', buildExpressionUser(null))).toBe(false);
  });
});

/* ── the raw editor's worked example teaches the same members ──────────── */

describe('the placeholder example names only members the bag carries (objectstack#28833)', () => {
  it('teaches a `user` clause, and that clause evaluates on every branch', () => {
    const userClauses = CEL_EXAMPLE_CLAUSES.filter((c) => celRootsMentioned(c).includes('user'));
    expect(userClauses.length, 'the example teaches no `user` clause: dead instrument').toBeGreaterThan(0);
    for (const clause of userClauses) {
      for (const [branch, user] of BRANCHES) {
        expect(() => evaluate(clause, user), `${clause} (${branch})`).not.toThrow();
      }
    }
  });
});
