/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#25892 — a frame that mounts no `ExpressionProvider` (the Studio,
 * whose header bell walks every app's navigation for its activity roster) does
 * not print a warning per navigation predicate it cannot answer.
 *
 * Before: on `/studio`, each HotCRM entry gated on `current_user.positions` or
 * `current_user.can(...)` printed "A visibility predicate could not be
 * evaluated - node app-shell:visible", because the frame's `current_user` is
 * the empty default and no permissions are bound. The verdict (withheld) was
 * right; the warning blamed the author for a scope the frame never built.
 *
 * After: same verdict, and nothing printed. A frame that DOES mount the scope
 * still reports a real fault (control).
 */

import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import React from 'react';
import { renderHook } from '@testing-library/react';
import { __resetVisibilityPredicateWarnings } from '@object-ui/react';
import {
  ExpressionProvider,
  createExpressionEvaluator,
  evaluateNavigationVisibility,
  useHasExpressionScope,
} from '../ExpressionProvider';
import { useNavVisibility } from '../../hooks/useNavMemberGates';

/** HotCRM's two gate shapes, as the server serves them (CEL envelopes). */
const NOT_SALES_REP = { dialect: 'cel', source: '!("sales_rep" in current_user.positions)' };
const CAN_READ_LEAD = { dialect: 'cel', source: 'current_user.can("crm_lead", "read")' };

let warn: MockInstance<typeof console.warn>;
beforeEach(() => {
  __resetVisibilityPredicateWarnings();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());

const appShellWarnings = () =>
  warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('app-shell:visible'));

describe('evaluateNavigationVisibility on a frame with no predicate scope (objectstack#25892)', () => {
  const empty = () => createExpressionEvaluator({ user: {}, features: {} });

  it('withholds the entries and prints no app-shell:visible warning', () => {
    const evaluator = empty();
    expect(evaluateNavigationVisibility(NOT_SALES_REP, evaluator, false)).toBe(false);
    expect(evaluateNavigationVisibility(CAN_READ_LEAD, evaluator, false)).toBe(false);
    expect(evaluateNavigationVisibility(NOT_SALES_REP, evaluator, false)).toBe(false);
    expect(appShellWarnings()).toEqual([]);
  });

  it('CONTROL: the same predicates on a bound frame still report, once each', () => {
    const evaluator = empty();
    expect(evaluateNavigationVisibility(NOT_SALES_REP, evaluator)).toBe(false);
    expect(evaluateNavigationVisibility(CAN_READ_LEAD, evaluator)).toBe(false);
    expect(appShellWarnings()).toHaveLength(2);
  });

  it('CONTROL: literals, an absent gate and a predicate that evaluates keep their answers', () => {
    const evaluator = empty();
    expect(evaluateNavigationVisibility(undefined, evaluator, false)).toBe(true);
    expect(evaluateNavigationVisibility(true, evaluator, false)).toBe(true);
    expect(evaluateNavigationVisibility(false, evaluator, false)).toBe(false);
    expect(evaluateNavigationVisibility({ dialect: 'cel', source: '1 == 1' }, evaluator, false)).toBe(true);
    expect(evaluateNavigationVisibility({ dialect: 'cel', source: '1 == 2' }, evaluator, false)).toBe(false);
    expect(appShellWarnings()).toEqual([]);
  });

  it('CONTROL: a blank gate is still drawn and still reported, since it is blank whatever the scope', () => {
    expect(evaluateNavigationVisibility({ dialect: 'cel', source: '  ' }, empty(), false)).toBe(true);
    expect(appShellWarnings()).toHaveLength(1);
  });
});

describe('useNavVisibility picks the frame from the mounted provider (objectstack#25892)', () => {
  it('no ExpressionProvider: withheld, and silent', () => {
    const { result } = renderHook(() => ({ evaluate: useNavVisibility(undefined), scoped: useHasExpressionScope() }));
    expect(result.current.scoped).toBe(false);
    expect(result.current.evaluate(NOT_SALES_REP as never)).toBe(false);
    expect(result.current.evaluate(CAN_READ_LEAD as never)).toBe(false);
    expect(appShellWarnings()).toEqual([]);
  });

  it('under ExpressionProvider: the signed-in user answers `positions`, and an unbound `can()` is still reported', () => {
    const user = { id: 'u_rep', positions: ['sales_rep'] };
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ExpressionProvider user={user}>{children}</ExpressionProvider>
    );
    const { result } = renderHook(() => ({ evaluate: useNavVisibility(undefined), scoped: useHasExpressionScope() }), {
      wrapper,
    });
    expect(result.current.scoped).toBe(true);
    // Evaluates: the rep holds `sales_rep`, so the entry is hidden as a verdict, not a fault.
    expect(result.current.evaluate(NOT_SALES_REP as never)).toBe(false);
    expect(appShellWarnings()).toEqual([]);
    // No permissions provider above: the fault is real on this frame, and stays loud.
    expect(result.current.evaluate(CAN_READ_LEAD as never)).toBe(false);
    expect(appShellWarnings()).toHaveLength(1);
  });
});
