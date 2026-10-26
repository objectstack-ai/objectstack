/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#3842 — the declared-`disabled` gate. The `disabled` half of the
 * objectui#3492 family, and the half where the family's usual "`''` is
 * harmless" reasoning INVERTS.
 *
 * The gate asked `(schema as any).disabled != null`, so `disabled: ''` counted
 * as "a gate is declared" and the verdict was handed to the evaluation entry —
 * which reads an empty predicate as "nothing to evaluate → true"
 * (`toPredicateInput('')` is `undefined`, `evaluateCondition(undefined)` is
 * `true`). On `visible` that `true` means SHOW, so an over-broad "declared"
 * test and a permissive empty predicate cancel out and `visible: ''` renders
 * either way (which is why PR #3843 could only document `''` on that side, not
 * detect a mutation with it). On `disabled` the same `true` means DISABLE, so
 * the two mistakes compound instead of cancelling: an empty predicate stopped
 * meaning "no gate" and started meaning "greyed out forever".
 *
 * Both legs now ask `hasDeclaredVisibilityGate` (`!= null && !== ''`) — the one
 * definition, imported rather than re-spelled, historic name kept per the
 * objectui#3842 dispatch ruling (see the comment at the gate).
 *
 * ## What each case detects
 *
 *   • `disabled: ''` → NOT disabled. THE defect, and on this side a genuine
 *     mutation detector: restore `!= null` and this case alone goes red.
 *   • `disabled: true` → disabled, and `disabled: false` / undeclared → not
 *     disabled. Anti-mutation guards: "never disable anything" satisfies three
 *     of the four shapes on its own, and `true` is what refuses it.
 *   • expression-valued `disabled` → the verdict still decides, both ways. The
 *     gate narrowed; evaluation did not change.
 *
 * ## The legacy `enabled` leg, and why its four cases are documentation
 *
 * The leg is NEGATED (`disabled = !isEnabled`), so the empty predicate's `true`
 * arrives as `!true` = "not disabled" — which is exactly what "no gate
 * declared" produces. Every shape therefore reaches the same verdict under
 * either test, and the tightening is behaviour-preserving by derivation:
 *
 *   | `enabled`   | `!= null` (old)          | `hasDeclaredVisibilityGate` (new) |
 *   |-------------|--------------------------|-----------------------------------|
 *   | `''`        | gate → `!true`  = enabled | no gate → `false` = enabled       |
 *   | `true`      | gate → `!true`  = enabled | gate → `!true`  = enabled         |
 *   | `false`     | gate → `!false` = DISABLED| gate → `!false` = DISABLED        |
 *   | undeclared  | no gate → `false`         | no gate → `false`                 |
 *
 * So no `enabled` case here can go red by reverting the `enabled` leg — stated
 * plainly rather than dressed up as coverage. They are kept because they pin
 * the semantics the derivation asserts (`enabled: false` must still disable),
 * which is what a future rewrite of this chain would break silently. The one
 * case that DOES move is the precedence case below: with `disabled: ''` no
 * longer a gate, the chain falls through to the legacy leg instead of
 * short-circuiting on an empty predicate.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { PredicateScopeProvider } from '@object-ui/react';
// Module-scope side-effect import so the renderer is in the registry when
// `ComponentRegistry.get` runs (the light `dom` project does not load the
// `@object-ui/components` graph), per AGENTS.md §测试纪律 — the cost lands in
// the import phase, not under a hook timeout.
import '../action-button';

/** Mount the leaf the way `action:bar` mounts it: whole action spread onto `schema`. */
function renderLeaf(action: any, scope: Record<string, any> = {}) {
  const Renderer = ComponentRegistry.get('action:button');
  if (!Renderer) throw new Error('action:button is not registered');
  return render(
    <PredicateScopeProvider scope={scope}>
      <Renderer schema={{ ...action, type: 'action:button', actionType: action.type }} />
    </PredicateScopeProvider>,
  );
}

const ACT = { name: 'act', label: 'Act', type: 'script' };
const act = () => screen.getByRole('button', { name: 'Act' });

describe('action:button — declared `disabled` gate (objectui#3842)', () => {
  it("an empty-string `disabled` is not a declared gate — the button stays clickable", () => {
    renderLeaf({ ...ACT, disabled: '' });
    expect(act()).not.toBeDisabled();
  });

  it('disabled:true → the button is disabled', () => {
    renderLeaf({ ...ACT, disabled: true });
    expect(act()).toBeDisabled();
  });

  it('disabled:false → the button is not disabled', () => {
    renderLeaf({ ...ACT, disabled: false });
    expect(act()).not.toBeDisabled();
  });

  it('no `disabled` at all → the button is not disabled (ungated stays ungated)', () => {
    renderLeaf({ ...ACT });
    expect(act()).not.toBeDisabled();
  });

  it('an expression-valued `disabled` keeps its verdict — true disables, false does not', () => {
    const gated = { ...ACT, disabled: 'features.locked == true' };
    const { unmount } = renderLeaf(gated, { features: { locked: true } });
    expect(act()).toBeDisabled();
    unmount();
    renderLeaf(gated, { features: { locked: false } });
    expect(act()).not.toBeDisabled();
  });
});

describe('action:button — legacy `enabled` leg (objectui#3842)', () => {
  it("an empty-string `enabled` is not a declared gate — the button stays clickable", () => {
    renderLeaf({ ...ACT, enabled: '' });
    expect(act()).not.toBeDisabled();
  });

  it('enabled:false → the button is disabled (the legacy leg still decides)', () => {
    renderLeaf({ ...ACT, enabled: false });
    expect(act()).toBeDisabled();
  });

  it('enabled:true → the button is not disabled', () => {
    renderLeaf({ ...ACT, enabled: true });
    expect(act()).not.toBeDisabled();
  });

  it('no `enabled` at all → the button is not disabled', () => {
    renderLeaf({ ...ACT });
    expect(act()).not.toBeDisabled();
  });

  it('an empty `disabled` falls THROUGH to the legacy `enabled` leg', () => {
    // The precedence case, and the second one the narrowing moves: `disabled:
    // ''` used to short-circuit the chain on an empty predicate (→ disabled),
    // so the author's `enabled: true` was never consulted. With `''` no longer
    // a gate, the legacy leg decides — "no `disabled` declared" means exactly
    // that, whatever else the action declares.
    renderLeaf({ ...ACT, disabled: '', enabled: true });
    expect(act()).not.toBeDisabled();
  });

  it('an empty `disabled` does not mask a legacy `enabled: false`', () => {
    // Same fall-through, opposite verdict: the legacy leg is reached and says
    // disabled. Green before and after (the old chain also disabled, for the
    // wrong reason) — it is here so the fall-through cannot be "read the
    // `enabled` leg only when it agrees with not-disabled".
    renderLeaf({ ...ACT, disabled: '', enabled: false });
    expect(act()).toBeDisabled();
  });
});
