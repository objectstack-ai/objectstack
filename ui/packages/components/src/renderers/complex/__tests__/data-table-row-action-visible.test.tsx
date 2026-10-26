/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Regression: the data-table's inline row overflow menu must honor a custom
 * row action's `visible` (and `disabled`) CEL predicate, per-row — the same
 * way ObjectGrid's `RowActionMenuItem` already does.
 *
 * Bug context: a `sys_organization` detail page's Members tab renders member
 * rows through a related list, which feeds the child object's `list_item`
 * actions into the data-table as `rowActionDefs`. `sys_member`'s
 * `transfer_ownership` action declares
 *   `visible: "record.role != 'owner' && features.organization != false"`,
 * yet the data-table used to render every custom action unconditionally, so
 * "Transfer Ownership" showed on the owner's own row. This exercises the
 * `DataTableRowActionItem` subcomponent that now evaluates the predicate.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { PredicateScopeProvider } from '@object-ui/react';
import { DataTableRowActionItem, planDataTableRowMenu } from '../data-table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '../../../ui/dropdown-menu';

// The real `sys_member` action definition — the one reported in the bug.
const TRANSFER_OWNERSHIP = {
  name: 'transfer_ownership',
  label: 'Transfer Ownership',
  visible: "record.role != 'owner' && features.organization != false",
};

/**
 * Render a single `DataTableRowActionItem` inside a controlled-open dropdown
 * menu so the portal content mounts deterministically (Radix triggers open on
 * `pointerdown`, which is flaky to synthesize in happy-dom). The
 * `PredicateScopeProvider` supplies the ambient `features` scope the app-shell
 * feeds in production, so `features.organization` resolves.
 */
function renderRowActionItem(action: any, row: any) {
  return render(
    <PredicateScopeProvider scope={{ features: { organization: true } }}>
      <DropdownMenu open modal={false}>
        <DropdownMenuTrigger>menu</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DataTableRowActionItem action={action} row={row} onActionDef={() => {}} />
        </DropdownMenuContent>
      </DropdownMenu>
    </PredicateScopeProvider>,
  );
}

describe('data-table row action — visible / disabled CEL evaluation', () => {
  it('hides an action whose `visible` predicate is false for the row (owner)', () => {
    renderRowActionItem(TRANSFER_OWNERSHIP, { id: '1', role: 'owner', name: 'Olga' });
    expect(screen.queryByTestId('row-action-transfer_ownership')).toBeNull();
    expect(screen.queryByText('Transfer Ownership')).toBeNull();
  });

  it('shows an action whose `visible` predicate is true for the row (member)', () => {
    renderRowActionItem(TRANSFER_OWNERSHIP, { id: '2', role: 'member', name: 'Mel' });
    expect(screen.getByTestId('row-action-transfer_ownership')).toBeInTheDocument();
    expect(screen.getByText('Transfer Ownership')).toBeInTheDocument();
  });

  it('no longer binds the bare-field spelling (objectui#5741) — hidden on BOTH rows, fail-closed', () => {
    // `role != 'owner'` is unbound since Phase 2 of the objectui#5330 canon: it
    // faults, and this surface's existing policy is fail-closed, so the verdict
    // is the same whichever row it meets. The `record.` spelling above is what
    // discriminates.
    const bareField = { name: 'transfer_ownership', label: 'Transfer Ownership', visible: "role != 'owner'" };
    renderRowActionItem(bareField, { id: '1', role: 'owner' });
    expect(screen.queryByTestId('row-action-transfer_ownership')).toBeNull();
    cleanup();
    renderRowActionItem(bareField, { id: '2', role: 'member' });
    expect(screen.queryByTestId('row-action-transfer_ownership')).toBeNull();
  });

  it('renders an action with no `visible` predicate unconditionally', () => {
    renderRowActionItem({ name: 'view_profile', label: 'View Profile' }, { id: '1', role: 'owner' });
    expect(screen.getByTestId('row-action-view_profile')).toBeInTheDocument();
    expect(screen.getByText('View Profile')).toBeInTheDocument();
  });

  it('evaluates a `disabled` CEL predicate against the row (disabled on owner)', () => {
    renderRowActionItem(
      { name: 'edit_member', label: 'Edit', disabled: "record.role == 'owner'" },
      { id: '1', role: 'owner' },
    );
    const item = screen.getByTestId('row-action-edit_member');
    expect(item).toBeInTheDocument();
    expect(item).toHaveAttribute('data-disabled');
  });

  it('leaves the action enabled when its `disabled` CEL is false (member)', () => {
    renderRowActionItem(
      { name: 'edit_member', label: 'Edit', disabled: "record.role == 'owner'" },
      { id: '2', role: 'member' },
    );
    const item = screen.getByTestId('row-action-edit_member');
    expect(item).toBeInTheDocument();
    expect(item).not.toHaveAttribute('data-disabled');
  });

  it('supports a boolean `disabled` flag', () => {
    renderRowActionItem(
      { name: 'locked_action', label: 'Locked', disabled: true },
      { id: '1', role: 'member' },
    );
    expect(screen.getByTestId('row-action-locked_action')).toHaveAttribute('data-disabled');
  });
});

/**
 * objectui#3758 — a DECLARED boolean `visible` is a verdict, not a missing gate.
 *
 * `isCustomRowActionVisible` used to ask truthiness (`if (!action?.visible)
 * return true`), so `visible: false` — the most explicit way to say "never show
 * this" — answered "no gate declared" and the item rendered for every row.
 * Declaration was then detected by `!= null && !== ''`, the invariant
 * objectui#3492 established for the selection bar (`hasVisibilityGate`), so a
 * declared boolean reaches the evaluator and decides. Since objectui#11294 the
 * question is the action family's `hasDeclaredVisibilityGate`, which answers
 * the same for a boolean and for `''` (see the block at the end of this file).
 *
 * The `visible: true` and empty-string cases are asserted alongside on purpose:
 * they are what separates "detect the declaration" from "hide unconditionally".
 */
describe('data-table row action — declared boolean `visible` (objectui#3758)', () => {
  it('hides an action declaring `visible: false`', () => {
    renderRowActionItem({ name: 'ghost', label: 'Ghost', visible: false }, { id: '2', role: 'member' });
    expect(screen.queryByTestId('row-action-ghost')).toBeNull();
    expect(screen.queryByText('Ghost')).toBeNull();
  });

  it('renders an action declaring `visible: true`', () => {
    renderRowActionItem({ name: 'always', label: 'Always', visible: true }, { id: '2', role: 'member' });
    expect(screen.getByTestId('row-action-always')).toBeInTheDocument();
    expect(screen.getByText('Always')).toBeInTheDocument();
  });

  it('treats an empty-string `visible` as no gate at all, matching `hasVisibilityGate`', () => {
    renderRowActionItem({ name: 'compiled_away', label: 'Compiled Away', visible: '' }, { id: '2', role: 'member' });
    expect(screen.getByTestId('row-action-compiled_away')).toBeInTheDocument();
  });
});

/**
 * objectui#11294 — a BLANK `visible` is no gate, on the row menu as on the
 * toolbar.
 *
 * `isCustomRowActionVisible` asks the action family's
 * `hasDeclaredVisibilityGate` whether a gate is declared. It used to ask
 * `pred == null || pred === ''` of its own, so a whitespace-only `visible`, or
 * an envelope whose `source` is blank, counted as declared, was evaluated, and
 * failed closed: the item was missing for every row while a related list's
 * toolbar showed the same action. The `''` case above is the control. The
 * declared `false` and the CEL cases above keep "no gate" from passing as
 * "always show".
 *
 * Both halves of the row menu read the one function: the item, and the
 * `planDataTableRowMenu` guard that decides whether the row gets a "⋮" at all.
 */
describe('data-table row action — a blank `visible` is no gate (objectui#11294)', () => {
  const BLANKS: Array<[string, unknown]> = [
    ['a whitespace-only string', '   '],
    ['an envelope whose `source` is whitespace', { dialect: 'cel', source: '   ' }],
    ['an envelope whose `source` is empty', { dialect: 'cel', source: '' }],
  ];

  it.each(BLANKS)('renders the item for %s', (_what, visible) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      renderRowActionItem({ name: 'blank_gate', label: 'Blank Gate', visible }, { id: '2', role: 'member' });
      expect(screen.getByTestId('row-action-blank_gate')).toBeInTheDocument();
    } finally {
      warn.mockRestore();
    }
  });

  it.each(BLANKS)('counts it in the "⋮" guard for %s, so the row keeps its trigger', (_what, visible) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const plan = planDataTableRowMenu({
        customActions: [{ name: 'blank_gate', visible }] as any,
        row: { id: '2', role: 'member' },
        scope: {},
      });
      expect(plan.custom.map((a) => a.name)).toEqual(['blank_gate']);
      expect(plan.count).toBe(1);
    } finally {
      warn.mockRestore();
    }
  });
});
