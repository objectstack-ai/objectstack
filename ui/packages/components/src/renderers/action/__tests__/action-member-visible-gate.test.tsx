/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#3812 — a MEMBER action's declared boolean `visible` is a verdict,
 * not a missing gate.
 *
 * The three member-action gates on the action face (`action:group`'s inline
 * button and dropdown item, `action:menu`'s item) asked truthiness:
 * `if (action.visible && !isVisible) return null`. So `visible: false` — the
 * most explicit way an author can say "never show this" — answered "no gate
 * declared" and the action rendered anyway. Declaration is now detected by
 * `hasDeclaredVisibilityGate` (`!= null && !== ''`), the invariant
 * objectui#3492 established for the selection bar (`hasVisibilityGate`) and
 * objectui#3758 / PR #3816 applied to the row-action surfaces.
 *
 * The evaluation entry was never the problem and is not touched:
 * `useCondition(toPredicateInput(false))` already answers `false`, pinned in
 * `packages/react/src/hooks/__tests__/actionPredicate.parity.test.tsx:134`
 * ("literal false" → both the engine and the renderer path say hidden). Only
 * the gate in front of it refused to ask.
 *
 * Each site asserts all THREE shapes — declared-false hides, declared-true
 * renders, undeclared renders — plus `''`. The symmetry is the point: a
 * "hide the member unconditionally" rewrite satisfies every `visible: false`
 * assertion on its own and would leave the suite green.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { PredicateScopeProvider } from '@object-ui/react';
import { DropdownActionItem } from '../action-group';
import { ActionMenuItem } from '../action-menu';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '../../../ui';

/** An ungated companion — see `renderInlineGroup`. */
const COMPANION = { name: 'view', label: 'View', type: 'script' };

/**
 * Site 1 — `InlineActionButton`, through the real `action:group` host so the
 * member gate is observed where it actually runs (the group `.map()`s its own
 * `actions` array; neither `SchemaRenderer` nor `ActionEngine` is in this path).
 *
 * `COMPANION` rides along so a passing "not rendered" assertion cannot be
 * confused with "the whole group disappeared".
 */
function renderInlineGroup(actions: any[], scope: Record<string, any> = {}) {
  const Group = ComponentRegistry.get('action:group');
  if (!Group) throw new Error('action:group is not registered');
  return render(
    <PredicateScopeProvider scope={scope}>
      <Group schema={{ type: 'action:group', display: 'inline', actions: [...actions, COMPANION] }} />
    </PredicateScopeProvider>,
  );
}

/**
 * Sites 2 and 3 — the two dropdown leaves, each rendered inside a
 * controlled-open menu so the portal content mounts deterministically (Radix
 * opens on pointerdown, flaky to synthesize in happy-dom). Same harness as
 * `action-group-dropdown-visible.test.tsx`, which pinned this leaf's predicate
 * handling for #1885.
 */
function renderInMenu(node: React.ReactNode, scope: Record<string, any> = {}) {
  return render(
    <PredicateScopeProvider scope={scope}>
      <DropdownMenu open modal={false}>
        <DropdownMenuTrigger>menu</DropdownMenuTrigger>
        <DropdownMenuContent>{node}</DropdownMenuContent>
      </DropdownMenu>
    </PredicateScopeProvider>,
  );
}

const renderDropdownItem = (action: any, scope: Record<string, any> = {}) =>
  renderInMenu(<DropdownActionItem action={action} index={0} onSelect={() => {}} />, scope);

const renderMenuItem = (action: any, scope: Record<string, any> = {}) =>
  renderInMenu(<ActionMenuItem action={action} onExecute={async () => {}} />, scope);

describe('action:group inline member — declared boolean `visible` (objectui#3812)', () => {
  it('visible:false → the inline button does not render', () => {
    renderInlineGroup([{ name: 'ghost', label: 'Ghost', type: 'script', visible: false }]);
    expect(screen.getByText('View')).toBeInTheDocument();
    expect(screen.queryByText('Ghost')).not.toBeInTheDocument();
  });

  it('visible:true → the inline button renders', () => {
    renderInlineGroup([{ name: 'always', label: 'Always', type: 'script', visible: true }]);
    expect(screen.getByText('Always')).toBeInTheDocument();
  });

  it('no `visible` at all → the inline button renders (ungated stays ungated)', () => {
    renderInlineGroup([{ name: 'plain', label: 'Plain', type: 'script' }]);
    expect(screen.getByText('Plain')).toBeInTheDocument();
  });

  it("an empty-string `visible` is not a declared gate — the button still renders", () => {
    renderInlineGroup([{ name: 'empty', label: 'Empty', type: 'script', visible: '' }]);
    expect(screen.getByText('Empty')).toBeInTheDocument();
  });

  it('an expression-valued `visible` keeps its verdict — false hides, true shows', () => {
    const { unmount } = renderInlineGroup(
      [{ name: 'expr', label: 'Expr', type: 'script', visible: 'features.canRun == true' }],
      { features: { canRun: false } },
    );
    expect(screen.queryByText('Expr')).not.toBeInTheDocument();
    unmount();
    renderInlineGroup(
      [{ name: 'expr', label: 'Expr', type: 'script', visible: 'features.canRun == true' }],
      { features: { canRun: true } },
    );
    expect(screen.getByText('Expr')).toBeInTheDocument();
  });
});

describe('action:group dropdown member — declared boolean `visible` (objectui#3812)', () => {
  it('visible:false → the dropdown item does not render', () => {
    renderDropdownItem({ name: 'ghost', label: 'Ghost', visible: false });
    expect(screen.queryByText('Ghost')).toBeNull();
  });

  it('visible:true → the dropdown item renders', () => {
    renderDropdownItem({ name: 'always', label: 'Always', visible: true });
    expect(screen.getByText('Always')).toBeInTheDocument();
  });

  it('no `visible` at all → the dropdown item renders (ungated stays ungated)', () => {
    renderDropdownItem({ name: 'plain', label: 'Plain' });
    expect(screen.getByText('Plain')).toBeInTheDocument();
  });

  it("an empty-string `visible` is not a declared gate — the item still renders", () => {
    renderDropdownItem({ name: 'empty', label: 'Empty', visible: '' });
    expect(screen.getByText('Empty')).toBeInTheDocument();
  });
});

describe('action:menu member — declared boolean `visible` (objectui#3812)', () => {
  it('visible:false → the menu item does not render', () => {
    renderMenuItem({ name: 'ghost', label: 'Ghost', visible: false });
    expect(screen.queryByText('Ghost')).toBeNull();
  });

  it('visible:true → the menu item renders', () => {
    renderMenuItem({ name: 'always', label: 'Always', visible: true });
    expect(screen.getByText('Always')).toBeInTheDocument();
  });

  it('no `visible` at all → the menu item renders (ungated stays ungated)', () => {
    renderMenuItem({ name: 'plain', label: 'Plain' });
    expect(screen.getByText('Plain')).toBeInTheDocument();
  });

  it("an empty-string `visible` is not a declared gate — the item still renders", () => {
    renderMenuItem({ name: 'empty', label: 'Empty', visible: '' });
    expect(screen.getByText('Empty')).toBeInTheDocument();
  });

  it('an expression-valued `visible` keeps its verdict — false hides, true shows', () => {
    const { unmount } = renderMenuItem(
      { name: 'expr', label: 'Expr', visible: 'features.canRun == true' },
      { features: { canRun: false } },
    );
    expect(screen.queryByText('Expr')).toBeNull();
    unmount();
    renderMenuItem(
      { name: 'expr', label: 'Expr', visible: 'features.canRun == true' },
      { features: { canRun: true } },
    );
    expect(screen.getByText('Expr')).toBeInTheDocument();
  });
});
