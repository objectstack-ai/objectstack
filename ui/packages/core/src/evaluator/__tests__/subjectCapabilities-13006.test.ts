/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `current_user.hasCapability(name)` reaches the engine through the ONE seam
 * every predicate surface evaluates through (objectui#13006).
 *
 * The engine (`@objectstack/formula`, objectstack#24414) registers
 * `hasCapability` as a receiver method and answers it from
 * `EvalContext.systemPermissions` only. A list carried in the variable bag —
 * under a scope key, or as a string member of the subject — never reaches that
 * field, so the subject carries it under a symbol, beside the permissions map
 * `can` reads (`subjectPermissions-4421.test.ts`), and `evalFieldPredicate`
 * hands it on.
 */

import { describe, it, expect } from 'vitest';
import { ExpressionEvaluator } from '../ExpressionEvaluator';
import { evalFieldPredicate } from '../fieldRules';
import {
  SUBJECT_CAPABILITIES,
  bindSubjectCapabilities,
  bindSubjectPermissions,
  subjectCapabilitiesOf,
  subjectPermissionsOf,
} from '../subjectPermissions';

const USER = { id: 'u1', name: 'Ada', positions: ['everyone'] };
const GRANTED = { account: { allowRead: true, allowEdit: true, allowDelete: true } };

/** The predicate scope `buildExpressionScope` publishes: ONE subject, four spellings. */
function scopeFor(systemPermissions?: string[], permissions?: Record<string, Record<string, boolean>>) {
  const subject = bindSubjectCapabilities(bindSubjectPermissions(USER, permissions as never), systemPermissions);
  return { current_user: subject, user: subject, ctx: { user: subject }, os: { user: subject }, features: {} };
}

const cel = (source: string) => ({ dialect: 'cel', source });
const MANAGES = "current_user.hasCapability('manage_org_users')";

function verdict(scope: Record<string, unknown>, source = MANAGES) {
  const faults: string[] = [];
  const value = evalFieldPredicate(source, {}, false, undefined, scope, {
    warn: false,
    onFault: (r) => faults.push(r),
  });
  return { value, faults };
}

describe('bindSubjectCapabilities / subjectCapabilitiesOf (objectui#13006)', () => {
  it('returns a copy carrying the list, and never mutates the caller\'s user', () => {
    const held = ['manage_org_users'];
    const bound = bindSubjectCapabilities(USER, held);
    expect(bound).not.toBe(USER);
    expect(subjectCapabilitiesOf(bound)).toBe(held);
    expect(subjectCapabilitiesOf(USER)).toBeUndefined();
    expect(bound).toMatchObject(USER);
  });

  it('with no list, hands back the subject untouched — or strips a stale one', () => {
    expect(bindSubjectCapabilities(USER, undefined)).toBe(USER);
    const cleared = bindSubjectCapabilities(bindSubjectCapabilities(USER, ['x']), undefined);
    expect(subjectCapabilitiesOf(cleared)).toBeUndefined();
    expect(Object.getOwnPropertySymbols(cleared)).not.toContain(SUBJECT_CAPABILITIES);
  });

  it('keeps the permissions map when bound after it, and the reverse', () => {
    const a = bindSubjectCapabilities(bindSubjectPermissions(USER, GRANTED as never), ['x']);
    const b = bindSubjectPermissions(bindSubjectCapabilities(USER, ['x']), GRANTED as never);
    for (const s of [a, b]) {
      expect(subjectPermissionsOf(s)).toBe(GRANTED);
      expect(subjectCapabilitiesOf(s)).toEqual(['x']);
    }
  });

  it('is neither a CEL root nor a readable member of current_user', () => {
    const scope = scopeFor(['manage_org_users']);
    expect(Object.keys(scope)).not.toContain('systemPermissions');
    expect(Object.keys(scope.current_user)).not.toContain('systemPermissions');
    const evaluator = new ExpressionEvaluator(scope);
    expect(evaluator.evaluateCondition(cel('has(current_user.systemPermissions)'), { throwOnError: true })).toBe(false);
  });
});

describe('the engine seam answers hasCapability from the subject (objectui#13006)', () => {
  it('held: true', () => {
    expect(verdict(scopeFor(['manage_org_users']))).toEqual({ value: true, faults: [] });
  });

  it('not held: a clean false — not a fault', () => {
    expect(verdict(scopeFor(['setup.access']))).toEqual({ value: false, faults: [] });
  });

  it('CONTROL: an empty list is a real answer and evaluates to false', () => {
    expect(verdict(scopeFor([]))).toEqual({ value: false, faults: [] });
  });

  it('absent: the predicate FAULTS, naming the missing list — never a quiet false', () => {
    const { faults } = verdict(scopeFor(undefined));
    expect(faults).toHaveLength(1);
    expect(faults[0]).toMatch(/carries no capability list/);
  });

  it('answers identically on every alias of the subject', () => {
    for (const receiver of ['current_user', 'user', 'ctx.user', 'os.user']) {
      const src = `${receiver}.hasCapability('manage_org_users')`;
      expect(verdict(scopeFor(['manage_org_users']), src).value).toBe(true);
      expect(verdict(scopeFor([]), src).value).toBe(false);
    }
  });

  it('a list under a scope key or a string member is not read — only the subject\'s own carries', () => {
    const bare = scopeFor(undefined);
    const smuggled = {
      ...bare,
      systemPermissions: ['manage_org_users'],
    };
    expect(verdict(smuggled).faults[0]).toMatch(/carries no capability list/);
  });

  it('CONTROL: can() is unchanged beside it', () => {
    const scope = scopeFor(['manage_org_users'], GRANTED);
    expect(verdict(scope, "current_user.can('account', 'delete')")).toEqual({ value: true, faults: [] });
    expect(verdict(scopeFor(['manage_org_users']), "current_user.can('account', 'delete')").faults[0]).toMatch(
      /carries no permission data/,
    );
  });
});
