/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12700 — the navigation gate withholds an entry whose `visible`
 * predicate cannot be evaluated; the object-field gate keeps its fail-open
 * answer for the very same fault.
 *
 * The evaluators are built through the shell's own builder, so the bag is the
 * one `ExpressionProvider` publishes, with and without a permissions payload.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { toEvalPermissions } from '@objectstack/formula';
import { __resetVisibilityPredicateWarnings } from '@object-ui/react';
import {
  createExpressionEvaluator,
  evaluateNavigationVisibility,
  evaluateVisibility,
  isObjectFieldVisible,
} from '../ExpressionProvider';

const CAN_READ = { dialect: 'cel', source: "current_user.can('crm_opportunity', 'read')" };
const USER = { id: 'u1', name: 'Ada' };

const withPermissions = (allowRead: boolean) =>
  createExpressionEvaluator({
    user: USER,
    permissions: toEvalPermissions({ crm_opportunity: { allowRead } }),
  });
const unbound = () => createExpressionEvaluator({ user: USER });

let warn: MockInstance<typeof console.warn>;
beforeEach(() => {
  __resetVisibilityPredicateWarnings();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());

const appShellLines = () =>
  warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('app-shell:visible'));

describe('evaluateNavigationVisibility (objectui#12700)', () => {
  it('answers from the bound payload: granted shown, denied hidden, silently', () => {
    expect(evaluateNavigationVisibility(CAN_READ, withPermissions(true))).toBe(true);
    expect(evaluateNavigationVisibility(CAN_READ, withPermissions(false))).toBe(false);
    expect(appShellLines()).toHaveLength(0);
  });

  it('withholds the entry when no payload is bound, and reports once per predicate with the withholding consequence', () => {
    const evaluator = unbound();
    expect(evaluateNavigationVisibility(CAN_READ, evaluator)).toBe(false);
    expect(evaluateNavigationVisibility(CAN_READ, evaluator)).toBe(false);
    const lines = appShellLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/carries no permission data/);
    expect(lines[0]).toMatch(/WITHHELD/);
  });

  it('withholds on a fault of any other kind too (an unknown root)', () => {
    expect(evaluateNavigationVisibility({ dialect: 'cel', source: 'nosuchroot.flag == true' }, unbound())).toBe(false);
    expect(appShellLines()).toHaveLength(1);
  });

  it('CONTROL: literals and an absent gate keep their answers', () => {
    expect(evaluateNavigationVisibility(undefined, unbound())).toBe(true);
    expect(evaluateNavigationVisibility(true, unbound())).toBe(true);
    expect(evaluateNavigationVisibility(false, unbound())).toBe(false);
    expect(evaluateNavigationVisibility({ dialect: 'cel', source: "current_user.id == 'u1'" }, unbound())).toBe(true);
    expect(appShellLines()).toHaveLength(0);
  });

  it('CONTROL: a blank gate is "no gate" and is still drawn', () => {
    expect(evaluateNavigationVisibility({ dialect: 'cel', source: '  ' }, unbound())).toBe(true);
  });

  it('CONTROL: the object-field gate and the published `evaluateVisibility` stay fail-open on the same fault', () => {
    expect(evaluateVisibility(CAN_READ, unbound())).toBe(true);
    expect(isObjectFieldVisible({ visibleWhen: CAN_READ }, unbound())).toBe(true);
  });
});
