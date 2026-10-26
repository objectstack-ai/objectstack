/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#3849 — the declared-`disabled` gate on the four remaining action-face
 * sites. objectui#3842 / PR #3851 fixed `action:button` (and app-shell's
 * `DeclaredActionsBar`); these four stayed on `!= null`, so the same component
 * asked "is a gate DECLARED?" one way for `visible` and another for `disabled`.
 *
 * The mechanism is #3842's, verbatim: `toPredicateInput('')` is `undefined` and
 * `evaluateCondition(undefined)` is `true`. On `visible` that `true` means SHOW,
 * so an over-broad "declared" test and a permissive empty predicate cancel out.
 * On `disabled` the same `true` means DISABLE, so they compound — `disabled: ''`
 * (an empty predicate, i.e. nothing declared) became "greyed out forever", with
 * nothing the author could write to un-grey it. All four now read
 * `hasDeclaredVisibilityGate` (`!= null && !== ''`), imported rather than
 * re-spelled; historic name kept per the #3842 ruling.
 *
 * ## What each case detects
 *
 *   • `disabled: ''` → NOT disabled. THE defect, and a genuine mutation
 *     detector on this key: restore `!= null` at one site and that site's `''`
 *     case alone goes red (the reverse-verification this PR ran).
 *   • `disabled: true` → disabled; `disabled: false` / undeclared → not
 *     disabled. Anti-mutation guards: "never disable anything" satisfies three
 *     of the four shapes on its own, and `true` is what refuses it.
 *   • expression-valued `disabled` → the verdict still decides, both ways. The
 *     gate narrowed; evaluation did not change.
 *
 * ## The legacy `enabled` leg — four cases that are documentation, one that moves
 *
 * The leg is NEGATED (`disabled = !isEnabled`), so an empty predicate's `true`
 * arrives as `!true` = "not disabled", which is exactly what "no gate declared"
 * produces. Every shape reaches the same verdict under either test, so the
 * tightening is behaviour-preserving by derivation (#3842's table):
 *
 *   | `enabled`   | `!= null` (old)           | `hasDeclaredVisibilityGate` (new) |
 *   |-------------|---------------------------|-----------------------------------|
 *   | `''`        | gate → `!true`  = enabled | no gate → `false` = enabled       |
 *   | `true`      | gate → `!true`  = enabled | gate → `!true`  = enabled         |
 *   | `false`     | gate → `!false` = DISABLED| gate → `!false` = DISABLED        |
 *   | undeclared  | no gate → `false`         | no gate → `false`                 |
 *
 * Stated plainly rather than dressed up as coverage: no `enabled` case here can
 * go red by reverting the `enabled` leg. They are kept because they pin the
 * semantics the derivation asserts (`enabled: false` must still disable), which
 * a future rewrite of this chain would otherwise break silently. The case that
 * DOES move is precedence: with `disabled: ''` no longer a gate, the chain falls
 * through to the legacy leg instead of short-circuiting on an empty predicate.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { PredicateScopeProvider } from '@object-ui/react';
// Module-scope side-effect imports so the two hosts are in the registry when
// `ComponentRegistry.get` runs — the light `dom` project deliberately does not
// load the `@object-ui/components` graph. Module scope, not a `beforeAll`, per
// AGENTS.md §测试纪律: the cost lands in the import phase, unbounded by any
// hook timeout.
import '../action-icon';
import { DropdownActionItem } from '../action-group';
import { ActionMenuItem } from '../action-menu';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '../../../ui';

const LABEL = 'Act';
const ACT = { name: 'act', label: LABEL, type: 'script' };

/** An ungated companion — a passing assertion must not mean "the host vanished". */
const COMPANION = { name: 'view', label: 'View', type: 'script' };

function getRenderer(type: string) {
  const R = ComponentRegistry.get(type);
  if (!R) throw new Error(`${type} is not registered`);
  return R;
}

/**
 * Site 1 — `action:icon`, mounted the way `action:bar` mounts a member: the
 * whole action spread onto the leaf's own `schema` (`action-bar.tsx` resolves
 * the renderer from the registry itself, so this gate is the only one on that
 * path — the reachability #3823 established for the `visible` half of the same
 * two lines).
 */
function mountIcon(action: any, scope: Record<string, any> = {}) {
  const Renderer = getRenderer('action:icon');
  return render(
    <PredicateScopeProvider scope={scope}>
      <Renderer schema={{ ...action, type: 'action:icon', actionType: action.type }} />
    </PredicateScopeProvider>,
  );
}

/**
 * Site 2 — `InlineActionButton`, through the real `action:group` host so the
 * member gate is observed where it runs (the group `.map()`s its own `actions`;
 * neither `SchemaRenderer` nor `ActionEngine` is in this path).
 */
function mountInlineGroup(action: any, scope: Record<string, any> = {}) {
  const Group = getRenderer('action:group');
  return render(
    <PredicateScopeProvider scope={scope}>
      <Group schema={{ type: 'action:group', display: 'inline', actions: [action, COMPANION] }} />
    </PredicateScopeProvider>,
  );
}

/**
 * Sites 3 and 4 — the two dropdown leaves, each inside a controlled-open menu so
 * the portal content mounts deterministically (Radix opens on pointerdown, flaky
 * to synthesize in happy-dom). Same harness as
 * `action-group-dropdown-visible.test.tsx` and `action-member-visible-gate.test.tsx`.
 */
function mountInMenu(node: React.ReactNode, scope: Record<string, any> = {}) {
  return render(
    <PredicateScopeProvider scope={scope}>
      <DropdownMenu open modal={false}>
        <DropdownMenuTrigger>menu</DropdownMenuTrigger>
        <DropdownMenuContent>{node}</DropdownMenuContent>
      </DropdownMenu>
    </PredicateScopeProvider>,
  );
}

/** A `<button disabled>` leaf: the DOM property is the verdict. */
const buttonIsDisabled = (label: string) =>
  (screen.getByRole('button', { name: label }) as HTMLButtonElement).disabled;

/**
 * A Radix `DropdownMenuItem` leaf: it is a `role="menuitem"` div, so a disabled
 * item carries `data-disabled` rather than the `disabled` attribute (the probe
 * `action-group-dropdown-visible.test.tsx` established for #1885).
 */
const menuItemIsDisabled = (label: string) => {
  const item = screen.getByText(label).closest('[role="menuitem"]');
  if (!item) throw new Error(`no menuitem found for "${label}"`);
  return item.hasAttribute('data-disabled');
};

interface Site {
  /** Site name, as it reads in the test output. */
  id: string;
  mount: (action: any, scope?: Record<string, any>) => { unmount: () => void };
  isDisabled: (label: string) => boolean;
}

const SITES: Site[] = [
  { id: 'action:icon', mount: mountIcon, isDisabled: buttonIsDisabled },
  { id: 'action:group inline member', mount: mountInlineGroup, isDisabled: buttonIsDisabled },
  {
    id: 'action:group dropdown member',
    mount: (action, scope) =>
      mountInMenu(<DropdownActionItem action={action} index={0} onSelect={() => {}} />, scope),
    isDisabled: menuItemIsDisabled,
  },
  {
    id: 'action:menu member',
    mount: (action, scope) =>
      mountInMenu(<ActionMenuItem action={action} onExecute={async () => {}} />, scope),
    isDisabled: menuItemIsDisabled,
  },
];

describe.each(SITES)('$id — declared `disabled` gate (objectui#3849)', ({ mount, isDisabled }) => {
  it("an empty-string `disabled` is not a declared gate — the action stays clickable", () => {
    mount({ ...ACT, disabled: '' });
    expect(isDisabled(LABEL)).toBe(false);
  });

  it('disabled:true → the action is disabled', () => {
    mount({ ...ACT, disabled: true });
    expect(isDisabled(LABEL)).toBe(true);
  });

  it('disabled:false → the action is not disabled', () => {
    mount({ ...ACT, disabled: false });
    expect(isDisabled(LABEL)).toBe(false);
  });

  it('no `disabled` at all → the action is not disabled (ungated stays ungated)', () => {
    mount({ ...ACT });
    expect(isDisabled(LABEL)).toBe(false);
  });

  it('an expression-valued `disabled` keeps its verdict — true disables, false does not', () => {
    const gated = { ...ACT, disabled: 'features.locked == true' };
    const { unmount } = mount(gated, { features: { locked: true } });
    expect(isDisabled(LABEL)).toBe(true);
    unmount();
    mount(gated, { features: { locked: false } });
    expect(isDisabled(LABEL)).toBe(false);
  });
});

describe.each(SITES)('$id — legacy `enabled` leg (objectui#3849)', ({ mount, isDisabled }) => {
  it("an empty-string `enabled` is not a declared gate — the action stays clickable", () => {
    mount({ ...ACT, enabled: '' });
    expect(isDisabled(LABEL)).toBe(false);
  });

  it('enabled:false → the action is disabled (the legacy leg still decides)', () => {
    mount({ ...ACT, enabled: false });
    expect(isDisabled(LABEL)).toBe(true);
  });

  it('enabled:true → the action is not disabled', () => {
    mount({ ...ACT, enabled: true });
    expect(isDisabled(LABEL)).toBe(false);
  });

  it('an empty `disabled` falls THROUGH to the legacy `enabled` leg', () => {
    // The precedence case, and the second one the narrowing moves: `disabled:
    // ''` used to short-circuit the chain on an empty predicate (→ disabled), so
    // the author's `enabled: true` was never consulted. With `''` no longer a
    // gate, the legacy leg decides — "no `disabled` declared" means exactly
    // that, whatever else the action declares.
    mount({ ...ACT, disabled: '', enabled: true });
    expect(isDisabled(LABEL)).toBe(false);
  });

  it('an empty `disabled` does not mask a legacy `enabled: false`', () => {
    // Same fall-through, opposite verdict: the legacy leg is reached and says
    // disabled. Green before and after (the old chain also disabled, for the
    // wrong reason) — it is here so the fall-through cannot degrade into "read
    // the `enabled` leg only when it agrees with not-disabled".
    mount({ ...ACT, disabled: '', enabled: false });
    expect(isDisabled(LABEL)).toBe(true);
  });
});
