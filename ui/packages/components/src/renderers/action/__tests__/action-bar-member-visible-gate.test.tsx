/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#3823 — the `action:bar` member path reaches the COMPONENT-level
 * truthiness gate, so `action:button` / `action:icon` declaring
 * `visible: false` rendered anyway.
 *
 * objectui#3812 fixed the three member-action leaves that `action:group` /
 * `action:menu` map themselves, and its triage judged the five component-level
 * `schema.visible` gates a dormant defensive layer — `packages/react`'s
 * `SchemaRenderer` evaluates `newSchema.visible !== undefined` and hides the
 * node before the component ever mounts (pinned in
 * `packages/react/src/__tests__/SchemaRenderer.expressions.test.tsx`). Two of
 * those five are NOT dormant, which is this issue:
 *
 *   `action:bar` does not route through `SchemaRenderer`. It pulls the member's
 *   renderer out of the registry itself and spreads the whole member action
 *   into that renderer's schema (`action-bar.tsx`: `schema={{ ...action, type:
 *   componentType, actionType: action.type, … }}`). So an author's `visible`
 *   on a member arrives as the child's OWN `schema.visible`, and the child's
 *   `if (schema.visible && !isVisible) return null` asks truthiness: `false &&
 *   …` is falsy, the gate is skipped, and the most explicit "never show this"
 *   an author can write renders for everyone.
 *
 * `action:bar` is also the only gate on that path by design — its
 * `filteredActions` deliberately filters only on `requiredPermissions` and
 * `actionRendersAt`, leaving `visible` to the member renderer.
 *
 * Both gates now ask `hasDeclaredVisibilityGate` (`!= null && !== ''`), the one
 * definition objectui#3492 established for the selection bar and #3758 / PR
 * #3816 applied to the row-action surfaces. The verdict stays with the
 * evaluation entry, which short-circuits a boolean instead of calling the CEL
 * engine (`packages/react/src/hooks/__tests__/actionPredicate.parity.test.tsx`
 * pins `literal false` → hidden on both the engine and the renderer path).
 * Nothing about evaluation changes here — only the gate that refused to ask.
 *
 * Each gate asserts all THREE shapes (declared-false hides / declared-true
 * renders / undeclared renders) plus `''`. The symmetry is the point: a "hide
 * the member unconditionally" rewrite satisfies every `visible: false`
 * assertion on its own and would leave the suite green. The last block drives
 * the real `action:bar` host end-to-end, so the reachability this issue had to
 * prove with a throwaway probe does not have to be argued again.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { PredicateScopeProvider } from '@object-ui/react';
// Module-scope side-effect imports so the three renderers are in the registry
// when `ComponentRegistry.get` runs — the light `dom` project deliberately does
// not load `@object-ui/components`, and `action:bar` resolves its members
// through the registry at render time. Module scope (not a `beforeAll`) per
// AGENTS.md §测试纪律: the cost lands in the import phase, unbounded by any
// hook timeout.
import '../action-button';
import '../action-icon';
import '../action-bar';

function getRenderer(type: string) {
  const R = ComponentRegistry.get(type);
  if (!R) throw new Error(`${type} is not registered`);
  return R;
}

/** Mount a leaf renderer the way `action:bar` mounts it: whole action spread onto `schema`. */
function renderLeaf(type: string, action: any, scope: Record<string, any> = {}) {
  const Renderer = getRenderer(type);
  return render(
    <PredicateScopeProvider scope={scope}>
      <Renderer schema={{ ...action, type, actionType: action.type }} />
    </PredicateScopeProvider>,
  );
}

/** An ungated companion — a passing "not rendered" must not mean "the bar vanished". */
const COMPANION = { name: 'view', label: 'View', type: 'script', component: 'action:button' };

/**
 * The real `action:bar` host. `maxVisible` is pinned high so no member is
 * pushed into the overflow `action:menu` — the assertion is about the inline
 * member gate, and the inline/overflow split otherwise depends on
 * `useIsMobile()` (whose `mobileMaxVisible` default is 1).
 */
function renderBar(actions: any[], scope: Record<string, any> = {}) {
  const Bar = getRenderer('action:bar');
  return render(
    <PredicateScopeProvider scope={scope}>
      <Bar schema={{ type: 'action:bar', maxVisible: 10, actions: [...actions, COMPANION] }} />
    </PredicateScopeProvider>,
  );
}

describe('action:button — declared boolean `visible` (objectui#3823)', () => {
  it('visible:false → the button does not render', () => {
    renderLeaf('action:button', { name: 'ghost', label: 'Ghost', type: 'script', visible: false });
    expect(screen.queryByText('Ghost')).toBeNull();
  });

  it('visible:true → the button renders', () => {
    renderLeaf('action:button', { name: 'always', label: 'Always', type: 'script', visible: true });
    expect(screen.getByText('Always')).toBeInTheDocument();
  });

  it('no `visible` at all → the button renders (ungated stays ungated)', () => {
    renderLeaf('action:button', { name: 'plain', label: 'Plain', type: 'script' });
    expect(screen.getByText('Plain')).toBeInTheDocument();
  });

  it('an empty-string `visible` is not a declared gate — the button still renders', () => {
    renderLeaf('action:button', { name: 'empty', label: 'Empty', type: 'script', visible: '' });
    expect(screen.getByText('Empty')).toBeInTheDocument();
  });

  it('an expression-valued `visible` keeps its verdict — false hides, true shows', () => {
    const { unmount } = renderLeaf(
      'action:button',
      { name: 'expr', label: 'Expr', type: 'script', visible: 'features.canRun == true' },
      { features: { canRun: false } },
    );
    expect(screen.queryByText('Expr')).toBeNull();
    unmount();
    renderLeaf(
      'action:button',
      { name: 'expr', label: 'Expr', type: 'script', visible: 'features.canRun == true' },
      { features: { canRun: true } },
    );
    expect(screen.getByText('Expr')).toBeInTheDocument();
  });
});

// `action:icon` is icon-only: its accessible name is the `aria-label` the
// renderer builds from `label ?? name`, not text content.
describe('action:icon — declared boolean `visible` (objectui#3823)', () => {
  it('visible:false → the icon button does not render', () => {
    renderLeaf('action:icon', { name: 'ghost', label: 'Ghost', type: 'script', visible: false });
    expect(screen.queryByLabelText('Ghost')).toBeNull();
  });

  it('visible:true → the icon button renders', () => {
    renderLeaf('action:icon', { name: 'always', label: 'Always', type: 'script', visible: true });
    expect(screen.getByLabelText('Always')).toBeInTheDocument();
  });

  it('no `visible` at all → the icon button renders (ungated stays ungated)', () => {
    renderLeaf('action:icon', { name: 'plain', label: 'Plain', type: 'script' });
    expect(screen.getByLabelText('Plain')).toBeInTheDocument();
  });

  it('an empty-string `visible` is not a declared gate — the icon button still renders', () => {
    renderLeaf('action:icon', { name: 'empty', label: 'Empty', type: 'script', visible: '' });
    expect(screen.getByLabelText('Empty')).toBeInTheDocument();
  });

  it('an expression-valued `visible` keeps its verdict — false hides, true shows', () => {
    const { unmount } = renderLeaf(
      'action:icon',
      { name: 'expr', label: 'Expr', type: 'script', visible: 'features.canRun == true' },
      { features: { canRun: false } },
    );
    expect(screen.queryByLabelText('Expr')).toBeNull();
    unmount();
    renderLeaf(
      'action:icon',
      { name: 'expr', label: 'Expr', type: 'script', visible: 'features.canRun == true' },
      { features: { canRun: true } },
    );
    expect(screen.getByLabelText('Expr')).toBeInTheDocument();
  });
});

/**
 * The reachability pin. This is the path objectui#3823 had to demonstrate with
 * a throwaway probe: the registry-mounted `action:bar` spreads the member onto
 * the child's schema, so the component-level gate is the only one that runs.
 */
describe('action:bar member end-to-end — declared boolean `visible` (objectui#3823)', () => {
  it('an action:button member declaring visible:false is not rendered by the bar', () => {
    renderBar([
      { name: 'ghost', label: 'Ghost', type: 'script', component: 'action:button', visible: false },
    ]);
    expect(screen.getByText('View')).toBeInTheDocument(); // the bar itself rendered
    expect(screen.queryByText('Ghost')).toBeNull();
  });

  it('an action:icon member declaring visible:false is not rendered by the bar', () => {
    renderBar([
      { name: 'ghost', label: 'Ghost', type: 'script', component: 'action:icon', visible: false },
    ]);
    expect(screen.getByText('View')).toBeInTheDocument();
    expect(screen.queryByLabelText('Ghost')).toBeNull();
  });

  it('members declaring visible:true still render (the bar did not start hiding everything)', () => {
    renderBar([
      { name: 'btn', label: 'Btn', type: 'script', component: 'action:button', visible: true },
      { name: 'ico', label: 'Ico', type: 'script', component: 'action:icon', visible: true },
    ]);
    expect(screen.getByText('Btn')).toBeInTheDocument();
    expect(screen.getByLabelText('Ico')).toBeInTheDocument();
  });

  it('members with no `visible` at all still render', () => {
    renderBar([
      { name: 'btn', label: 'Btn', type: 'script', component: 'action:button' },
      { name: 'ico', label: 'Ico', type: 'script', component: 'action:icon' },
    ]);
    expect(screen.getByText('Btn')).toBeInTheDocument();
    expect(screen.getByLabelText('Ico')).toBeInTheDocument();
  });

  it('an expression-valued member `visible` keeps its verdict through the bar', () => {
    const member = {
      name: 'expr',
      label: 'Expr',
      type: 'script',
      component: 'action:button',
      visible: 'features.canRun == true',
    };
    const { unmount } = renderBar([member], { features: { canRun: false } });
    expect(screen.queryByText('Expr')).toBeNull();
    unmount();
    renderBar([member], { features: { canRun: true } });
    expect(screen.getByText('Expr')).toBeInTheDocument();
  });
});

/**
 * objectui#11358 — the toolbar, end to end, for a `visible` that is DECLARED
 * but has no evaluable `source` (the `ast`-only envelope the card was filed
 * on). A member gated that way is not rendered by the bar, beside an ungated
 * companion that is.
 *
 * The bar's OWN `visible` is the one reader here that does not ask the
 * declared-gate definition at all: it evaluates `toPredicateInput(visible)`
 * directly (`throwOnError`). It moves with the normalizer — an `ast`-only own
 * `visible` hides the whole bar now, where it used to fold into "absent" and
 * show it — which is the bar's existing fault direction for its own gate.
 */
describe('action:bar — a declared but not evaluable `visible` (objectui#11358)', () => {
  const AST_ONLY = { dialect: 'cel', ast: { kind: 'call', fn: '==' } };

  it('a member gated by an `ast`-only envelope is not rendered; the bar and its companion are', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      renderBar([{ name: 'ast_member_11358', label: 'Ghost', type: 'script', component: 'action:button', visible: AST_ONLY }]);
      expect(screen.getByText('View')).toBeInTheDocument();
      expect(screen.queryByText('Ghost')).toBeNull();
      const lines = warn.mock.calls.map((c) => c.map(String).join(' '));
      expect(lines.filter((l) => l.includes('ast_member_11358'))).toHaveLength(1);
    } finally {
      warn.mockRestore();
    }
  });

  it('the bar\'s own `ast`-only `visible` hides the bar (its fault direction), reported', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const Bar = getRenderer('action:bar');
      render(
        <PredicateScopeProvider scope={{}}>
          <Bar schema={{ type: 'action:bar', location: 'bar_11358', maxVisible: 10, visible: AST_ONLY, actions: [COMPANION] }} />
        </PredicateScopeProvider>,
      );
      expect(screen.queryByText('View')).toBeNull();
      const lines = warn.mock.calls.map((c) => c.map(String).join(' '));
      expect(lines.filter((l) => l.includes('[unevaluable]'))).toHaveLength(1);
    } finally {
      warn.mockRestore();
    }
  });
});
