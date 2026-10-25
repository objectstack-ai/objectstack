/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `current_user.can(object, verb)` reaches the engine through the ONE seam
 * every action surface evaluates through (objectui#4421).
 *
 * The engine (`@objectstack/formula` >= 17.5.0) registers `can` as a receiver
 * method and answers it from `EvalContext.permissions`. This file pins the
 * hand-off `evalFieldPredicate` makes — the subject the scope already carries
 * brings its permissions with it — across the three entries the surfaces use:
 *
 *   - `ExpressionEvaluator.evaluateCondition` with `throwOnError` — the
 *     fail-closed `useCondition` leg (`action:button` / `action:menu` /
 *     `action:bar` / `DeclaredActionsBar` `visible`), and `ActionEngine`;
 *   - the same entry WITHOUT `throwOnError` — the fail-soft `useCondition`
 *     legs (every `disabled` / `enabled`, and the renderers that evaluate
 *     `visible` fail-soft);
 *   - `evalRowPredicate` with `fallback: false` — the row menu, the record
 *     header, the selection bar, the data-table rows.
 *
 * Each is driven through the SAME three states on the SAME verb (`delete`):
 * not loaded (a subject carrying no map), loaded-and-granted, and
 * loaded-and-denied. State 1 cannot collapse into state 3 here because the two
 * are told apart by the engine itself — a denial is a clean `false`, the
 * missing payload is a FAULT — and the tests assert which one each is.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { ExpressionEvaluator } from '../ExpressionEvaluator';
import { evalRowPredicate } from '../listConditional';
import { evalFieldPredicate } from '../fieldRules';
import {
  SUBJECT_PERMISSIONS,
  bindSubjectPermissions,
  subjectPermissionsOf,
} from '../subjectPermissions';

const GRANTED = { account: { allowRead: true, allowEdit: true, allowDelete: true } };
const DENIED = { account: { allowRead: true, allowEdit: true, allowDelete: false } };

const USER = { id: 'u1', name: 'Ada', positions: ['everyone'] };

/** The predicate scope `buildExpressionScope` publishes: ONE subject, four spellings. */
function scopeFor(permissions?: Record<string, Record<string, boolean>>) {
  const subject = bindSubjectPermissions(USER, permissions as never);
  return { current_user: subject, user: subject, ctx: { user: subject }, os: { user: subject }, features: {} };
}

const cel = (source: string) => ({ dialect: 'cel', source });
const CAN_DELETE = "current_user.can('account', 'delete')";

afterEach(() => {
  vi.restoreAllMocks();
});

describe('bindSubjectPermissions / subjectPermissionsOf (objectui#4421)', () => {
  it('returns a copy carrying the map, and never mutates the caller\'s user', () => {
    const bound = bindSubjectPermissions(USER, GRANTED as never);
    expect(bound).not.toBe(USER);
    expect(subjectPermissionsOf(bound)).toBe(GRANTED);
    expect(subjectPermissionsOf(USER)).toBeUndefined();
    expect(bound).toMatchObject(USER);
  });

  it('with no map, hands back the subject untouched — or strips a stale one', () => {
    expect(bindSubjectPermissions(USER, undefined)).toBe(USER);
    const stale = bindSubjectPermissions(USER, GRANTED as never);
    const cleared = bindSubjectPermissions(stale, undefined);
    expect(subjectPermissionsOf(cleared)).toBeUndefined();
    expect(Object.getOwnPropertySymbols(cleared)).not.toContain(SUBJECT_PERMISSIONS);
  });

  it('is not a name any predicate can read: the map is data for the seam, not a root', () => {
    const scope = scopeFor(GRANTED);
    // The symbol is invisible to string-keyed access, so the map the engine
    // keeps out of the variable namespace stays out of it here too.
    expect(Object.keys(scope.current_user)).not.toContain('permissions');
    const evaluator = new ExpressionEvaluator(scope);
    expect(evaluator.evaluateCondition(cel('has(current_user.permissions)'), { throwOnError: true })).toBe(false);
  });
});

describe('the throwing useCondition leg — fail-closed `visible` (objectui#4421)', () => {
  const visible = (scope: Record<string, unknown>) =>
    new ExpressionEvaluator(scope).evaluateCondition(cel(CAN_DELETE), { throwOnError: true });

  it('not loaded: the predicate FAULTS, so the fail-closed caller hides', () => {
    expect(() => visible(scopeFor(undefined))).toThrow(/CEL predicate failed to evaluate/);
  });

  it('loaded and granted: true', () => {
    expect(visible(scopeFor(GRANTED))).toBe(true);
  });

  it('loaded and denied: a clean false — not a fault', () => {
    expect(visible(scopeFor(DENIED))).toBe(false);
  });

  it('answers identically on every alias of the subject', () => {
    for (const receiver of ['current_user', 'user', 'ctx.user', 'os.user']) {
      const src = cel(`${receiver}.can('account', 'delete')`);
      expect(new ExpressionEvaluator(scopeFor(GRANTED)).evaluateCondition(src, { throwOnError: true })).toBe(true);
      expect(new ExpressionEvaluator(scopeFor(DENIED)).evaluateCondition(src, { throwOnError: true })).toBe(false);
    }
  });

  it('survives the `{ ...scope, ...context }` merge useCondition performs', () => {
    const merged = { ...scopeFor(GRANTED), record: { id: 'r1' } };
    expect(new ExpressionEvaluator(merged).evaluateCondition(cel(CAN_DELETE), { throwOnError: true })).toBe(true);
  });
});

describe('the fail-soft useCondition legs report the missing payload (objectui#4421)', () => {
  it('not loaded: the fault goes to the caller\'s fallback AND is reported, naming the missing input', () => {
    const faults: string[] = [];
    const verdict = new ExpressionEvaluator(scopeFor(undefined)).evaluateCondition(cel(CAN_DELETE), {
      onFault: (reason) => faults.push(reason),
    });
    // The fail-soft fallback of this entry is `true`: on a `disabled` leg that
    // is DISABLED, on a fail-soft `visible` leg it is SHOWN. That is the
    // surface's fault policy, not this binding's answer.
    expect(verdict).toBe(true);
    expect(faults).toHaveLength(1);
    expect(faults[0]).toMatch(/carries no permission data/);
  });

  it('loaded: the verdict itself, with nothing reported', () => {
    const faults: string[] = [];
    const onFault = (reason: string) => faults.push(reason);
    expect(new ExpressionEvaluator(scopeFor(GRANTED)).evaluateCondition(cel(`!${CAN_DELETE}`), { onFault })).toBe(false);
    expect(new ExpressionEvaluator(scopeFor(DENIED)).evaluateCondition(cel(`!${CAN_DELETE}`), { onFault })).toBe(true);
    expect(faults).toEqual([]);
  });
});

describe('the evalRowPredicate leg — `fallback: false` (objectui#4421)', () => {
  const ROW = { id: 'r1', status: 'open' };
  // One locator per arm: the row warning is warn-once per (locator, predicate)
  // for the module's life, so a shared locator would let the not-loaded arm's
  // report silence the denied arm's — and "nothing to warn about" would pass
  // for a reason unrelated to the verdict.
  const row = (scope: Record<string, unknown>, label: string, warnOnError = false) =>
    evalRowPredicate(CAN_DELETE, ROW, { fallback: false, scope, warnOnError, label });

  it('not loaded: hidden, and the warning names the missing payload', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(row(scopeFor(undefined), 'custom_delete:not-loaded', true)).toBe(false);
    expect(warn.mock.calls.map((c) => String(c[0])).join('\n')).toMatch(/carries no permission data/);
  });

  it('loaded and granted: shown', () => {
    expect(row(scopeFor(GRANTED), 'custom_delete:granted')).toBe(true);
  });

  it('loaded and denied: hidden, with nothing to warn about', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(row(scopeFor(DENIED), 'custom_delete:denied', true)).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  it('combines with the row the way the card\'s logical-delete action needs', () => {
    const src = `record.status == 'open' && ${CAN_DELETE}`;
    expect(evalRowPredicate(src, ROW, { fallback: false, scope: scopeFor(GRANTED) })).toBe(true);
    expect(evalRowPredicate(src, { ...ROW, status: 'void' }, { fallback: false, scope: scopeFor(GRANTED) })).toBe(false);
    expect(evalRowPredicate(src, ROW, { fallback: false, scope: scopeFor(DENIED) })).toBe(false);
  });
});

describe('what the seam does NOT do (objectui#4421)', () => {
  it('a map carried under a string key is not read — only the subject\'s own carries', () => {
    const scope = { ...scopeFor(undefined), permissions: GRANTED };
    expect(evalFieldPredicate(CAN_DELETE, {}, false, undefined, scope, { warn: false })).toBe(false);
  });

  it('a receiver that is a COPY of the subject is refused, so every alias must be the one object', () => {
    const scope = scopeFor(GRANTED);
    const drifted = { ...scope, user: { ...scope.current_user } };
    const faults: string[] = [];
    expect(
      evalFieldPredicate("user.can('account', 'delete')", {}, false, undefined, drifted, {
        warn: false,
        onFault: (r) => faults.push(r),
      }),
    ).toBe(false);
    expect(faults[0]).toMatch(/ACTING SUBJECT/);
  });
});
