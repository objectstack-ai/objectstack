/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Regression: multiple `variant:'primary'` row actions must not all render as
 * inline buttons and crowd/clip the narrow actions column. Bug context: the
 * cloud `sys_environment` list declares TWO primary row actions ("Open" +
 * "Upgrade Plan"); RowActionMenu rendered both inline with `justify-end`, so
 * the leftmost ("Open") overflowed the fixed-width cell and was clipped to a
 * sliver. Only the first `maxInlineActions` primaries now stay inline; the rest
 * fold into the "⋮" overflow menu.
 *
 * The budget counts the primaries that SURVIVE their own `visible` for the row
 * (objectui#3762). Every fixture in this file is ungated, so declared order and
 * surviving order coincide and these cases pin the same behavior as before —
 * which is the point of leaving them untouched: the fix must not move the
 * clipping regression this suite exists for. The gated cases live in
 * `RowActionMenu.emptyGuard.test.tsx`.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import React from 'react';
import { PredicateScopeProvider } from '@object-ui/react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@object-ui/components';
import { Edit } from 'lucide-react';
import { RowActionMenu, BuiltinRowActionItem } from '../RowActionMenu';

const OPEN = { name: 'open', label: 'Open', variant: 'primary' as const };
const UPGRADE = { name: 'upgrade', label: 'Upgrade Plan', variant: 'primary' as const };
const ARCHIVE = { name: 'archive', label: 'Archive', variant: 'secondary' as const };

function renderMenu(props: Record<string, any>) {
  return render(
    <PredicateScopeProvider scope={{}}>
      <RowActionMenu row={{ id: 'e1' }} onActionDef={() => {}} {...props} />
    </PredicateScopeProvider>,
  );
}

describe('RowActionMenu inline overflow', () => {
  it('inlines only the first primary by default; extra primaries fold into the menu', () => {
    renderMenu({ rowActionDefs: [OPEN, UPGRADE] });
    // First primary renders as an inline button (the row's main CTA).
    expect(screen.getByTestId('row-action-inline-open')).toBeInTheDocument();
    // Second primary is NOT inline — it moved to the "⋮" overflow menu.
    expect(screen.queryByTestId('row-action-inline-upgrade')).not.toBeInTheDocument();
    // The overflow menu trigger exists to hold the folded action.
    expect(screen.getByTestId('row-action-trigger')).toBeInTheDocument();
  });

  it('honors a higher maxInlineActions so both primaries stay inline', () => {
    renderMenu({ rowActionDefs: [OPEN, UPGRADE], maxInlineActions: 2 });
    expect(screen.getByTestId('row-action-inline-open')).toBeInTheDocument();
    expect(screen.getByTestId('row-action-inline-upgrade')).toBeInTheDocument();
  });

  it('never inlines a non-primary action', () => {
    renderMenu({ rowActionDefs: [OPEN, ARCHIVE] });
    expect(screen.getByTestId('row-action-inline-open')).toBeInTheDocument();
    expect(screen.queryByTestId('row-action-inline-archive')).not.toBeInTheDocument();
  });

  it('maxInlineActions:0 folds every primary into the menu', () => {
    renderMenu({ rowActionDefs: [OPEN, UPGRADE], maxInlineActions: 0 });
    expect(screen.queryByTestId('row-action-inline-open')).not.toBeInTheDocument();
    expect(screen.queryByTestId('row-action-inline-upgrade')).not.toBeInTheDocument();
    expect(screen.getByTestId('row-action-trigger')).toBeInTheDocument();
  });
});

describe('RowActionMenu CEL visible predicate (issue #1584)', () => {
  // A `variant:'primary'` action renders as an always-mounted inline button, so
  // the `visible` gate is directly observable (menu items live in a collapsed
  // dropdown that only mounts when opened).
  const RESUME = {
    name: 'resume',
    label: 'Resume',
    variant: 'primary' as const,
    visible: "record.status in ['paused', 'stopped']",
  };

  it('honors the CEL `in` operator against the row (the legacy engine could not)', () => {
    render(
      <PredicateScopeProvider scope={{}}>
        <RowActionMenu row={{ id: 'e1', status: 'paused' }} rowActionDefs={[RESUME]} onActionDef={() => {}} />
      </PredicateScopeProvider>,
    );
    expect(screen.getByTestId('row-action-inline-resume')).toBeInTheDocument();
  });

  it('hides the action when the CEL predicate is false', () => {
    render(
      <PredicateScopeProvider scope={{}}>
        <RowActionMenu row={{ id: 'e1', status: 'running' }} rowActionDefs={[RESUME]} onActionDef={() => {}} />
      </PredicateScopeProvider>,
    );
    expect(screen.queryByTestId('row-action-inline-resume')).not.toBeInTheDocument();
  });
});

/**
 * objectui#2614 — the BUILT-IN Edit/Delete row actions honor per-record
 * `visibleWhen` / `disabledWhen` CEL predicates from the object's
 * `userActions.edit` / `delete` object form. Items are rendered inside a
 * controlled-open dropdown (same pattern as the data-table's
 * `DataTableRowActionItem` tests) because Radix mounts menu content only when
 * open — which is also why predicate evaluation is lazy and free at grid
 * render time.
 */
describe('BuiltinRowActionItem per-record CEL predicates (#2614)', () => {
  // The downstream MES case: a task_version_check_item row is frozen once its
  // parent version is published; the Edit button must grey out on frozen rows.
  const FROZEN = { id: 'r1', name: 'Check item A', frozen: true };
  const DRAFT = { id: 'r2', name: 'Check item B', frozen: false };

  function renderItem(props: { predicates?: any; row: any; onSelect?: (row: any) => void }) {
    return render(
      <PredicateScopeProvider scope={{}}>
        <DropdownMenu open modal={false}>
          <DropdownMenuTrigger>menu</DropdownMenuTrigger>
          <DropdownMenuContent>
            <BuiltinRowActionItem
              name="edit"
              icon={<Edit className="mr-2 h-4 w-4" />}
              label="Edit"
              onSelect={props.onSelect ?? (() => {})}
              predicates={props.predicates}
              row={props.row}
            />
          </DropdownMenuContent>
        </DropdownMenu>
      </PredicateScopeProvider>,
    );
  }

  it('renders enabled with no predicates (today’s behavior, zero regression)', () => {
    renderItem({ row: FROZEN });
    const item = screen.getByTestId('row-action-builtin-edit');
    expect(item).toBeInTheDocument();
    expect(item).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('disabledWhen true → rendered but disabled, and clicks do not fire', () => {
    const onSelect = vi.fn();
    renderItem({ predicates: { disabledWhen: 'record.frozen == true' }, row: FROZEN, onSelect });
    const item = screen.getByTestId('row-action-builtin-edit');
    expect(item).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(item);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('disabledWhen false → enabled, and clicks fire with the row', () => {
    const onSelect = vi.fn();
    renderItem({ predicates: { disabledWhen: 'record.frozen == true' }, row: DRAFT, onSelect });
    const item = screen.getByTestId('row-action-builtin-edit');
    expect(item).not.toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(item);
    expect(onSelect).toHaveBeenCalledWith(DRAFT);
  });

  it('visibleWhen false → the item is not rendered for that row', () => {
    renderItem({ predicates: { visibleWhen: 'record.frozen != true' }, row: FROZEN });
    expect(screen.queryByTestId('row-action-builtin-edit')).not.toBeInTheDocument();
  });

  it('visibleWhen true → the item renders', () => {
    renderItem({ predicates: { visibleWhen: 'record.frozen != true' }, row: DRAFT });
    expect(screen.getByTestId('row-action-builtin-edit')).toBeInTheDocument();
  });

  it('accepts the canonical { dialect, source } envelope', () => {
    renderItem({
      predicates: { visibleWhen: { dialect: 'cel', source: 'record.frozen != true' } },
      row: FROZEN,
    });
    expect(screen.queryByTestId('row-action-builtin-edit')).not.toBeInTheDocument();
  });

  it('a faulting visibleWhen fails CLOSED (hidden), a faulting disabledWhen fails soft (enabled)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      renderItem({ predicates: { visibleWhen: 'record.nonexistent.deep == 1' }, row: DRAFT });
      expect(screen.queryByTestId('row-action-builtin-edit')).not.toBeInTheDocument();
    } finally {
      warn.mockRestore();
    }
    const warn2 = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      renderItem({ predicates: { disabledWhen: 'record.nonexistent.deep == 1' }, row: DRAFT });
      expect(screen.getByTestId('row-action-builtin-edit')).not.toHaveAttribute('aria-disabled', 'true');
    } finally {
      warn2.mockRestore();
    }
  });
});

/**
 * objectui#3758 — a DECLARED boolean `visible` is a verdict, not a missing gate.
 *
 * Both of this component's custom-action surfaces read one gate
 * (`isCustomRowActionVisible`), and that gate used to ask truthiness: `visible:
 * false` — the most explicit way to say "never show this" — answered "no gate
 * declared" and the action rendered for everyone. Declaration was then
 * detected by `!= null && !== ''`, the invariant objectui#3492 established for
 * the selection bar (`hasVisibilityGate`), so a boolean reaches the evaluator
 * and decides. Since objectui#11294 the gate asks the action family's
 * `hasDeclaredVisibilityGate`, which answers the same for a boolean and for
 * `''` (see the block at the end of this file).
 *
 * The `visible: true` and undeclared cases are asserted alongside on purpose:
 * they are what separates "detect the declaration" from "hide unconditionally",
 * a rewrite that would satisfy every `visible: false` assertion on its own.
 */
describe('declared boolean `visible` on a custom row action (objectui#3758)', () => {
  const UNGATED = { name: 'archive', label: 'Archive', variant: 'secondary' as const };
  const GHOST = { name: 'ghost', label: 'Ghost', variant: 'secondary' as const, visible: false };

  // --- surface 1: the "⋮" overflow menu item -------------------------------
  // A second, UNGATED action rides along so the "⋮" trigger survives its own
  // #3562 emptiness guard — otherwise a passing assertion could not tell "the
  // item was suppressed" from "the whole menu disappeared".

  it('visible:false → the overflow menu item does not render', async () => {
    renderMenu({ rowActionDefs: [GHOST, UNGATED] });
    await userEvent.click(screen.getByTestId('row-action-trigger'));
    expect(screen.getByTestId('row-action-archive')).toBeInTheDocument();
    expect(screen.queryByTestId('row-action-ghost')).not.toBeInTheDocument();
  });

  it('visible:true → the overflow menu item renders', async () => {
    renderMenu({ rowActionDefs: [{ ...GHOST, name: 'always', label: 'Always', visible: true }, UNGATED] });
    await userEvent.click(screen.getByTestId('row-action-trigger'));
    expect(screen.getByTestId('row-action-always')).toBeInTheDocument();
  });

  it('no `visible` at all → the overflow menu item renders (ungated stays ungated)', async () => {
    renderMenu({ rowActionDefs: [UNGATED] });
    await userEvent.click(screen.getByTestId('row-action-trigger'));
    expect(screen.getByTestId('row-action-archive')).toBeInTheDocument();
  });

  // --- surface 2: the inline `variant:'primary'` button --------------------
  // Always mounted, so it needs no menu interaction to observe.

  it('visible:false → the inline primary button does not render', () => {
    renderMenu({ rowActionDefs: [{ ...OPEN, visible: false }] });
    expect(screen.queryByTestId('row-action-inline-open')).not.toBeInTheDocument();
  });

  it('visible:true → the inline primary button renders', () => {
    renderMenu({ rowActionDefs: [{ ...OPEN, visible: true }] });
    expect(screen.getByTestId('row-action-inline-open')).toBeInTheDocument();
  });

  it('no `visible` at all → the inline primary button renders (ungated stays ungated)', () => {
    renderMenu({ rowActionDefs: [OPEN] });
    expect(screen.getByTestId('row-action-inline-open')).toBeInTheDocument();
  });

  // --- the other half of "declared": empty string is NOT a gate ------------
  // The row surfaces and the selection bar (`hasVisibilityGate`) ask the same
  // `hasDeclaredVisibilityGate`, which reads `''` as no gate — and, since
  // objectui#11294 here and objectui#11322 on the bar, blank text in either
  // spelling too (see the block below). So an action whose predicate compiled
  // away to an empty string is not silently hidden from everyone.

  it('an empty-string `visible` is not a declared gate — the action still renders', () => {
    renderMenu({ rowActionDefs: [{ ...OPEN, visible: '' }] });
    expect(screen.getByTestId('row-action-inline-open')).toBeInTheDocument();
  });
});

/**
 * objectui#11294 — a BLANK `visible` is no gate on this row menu either.
 *
 * This component used to keep its own twin of `isCustomRowActionVisible`, and
 * the twin asked "is a gate declared?" with `!= null && !== ''`: a
 * whitespace-only `visible` counted as declared, was evaluated, and failed
 * closed, so the action vanished from the row while the action family's
 * toolbars (which ask `hasDeclaredVisibilityGate`) showed it. The component now
 * reads the one function from `@object-ui/components`, which asks the family's
 * question. The `''` case above is the control; the `visible: false` cases
 * above keep "no gate" from passing as "always show".
 */
describe('a blank `visible` on a custom row action (objectui#11294)', () => {
  const quiet = () => vi.spyOn(console, 'warn').mockImplementation(() => {});

  it('a whitespace-only `visible` → the inline primary button renders', () => {
    const warn = quiet();
    try {
      renderMenu({ rowActionDefs: [{ ...OPEN, visible: '   ' }] });
      expect(screen.getByTestId('row-action-inline-open')).toBeInTheDocument();
    } finally {
      warn.mockRestore();
    }
  });

  it('a whitespace-only `visible` → the "⋮" guard keeps the trigger and the menu item renders', async () => {
    const warn = quiet();
    try {
      // The only action on the row: the trigger exists only if the guard
      // counted it.
      renderMenu({ rowActionDefs: [{ ...ARCHIVE, visible: '   ' }] });
      await userEvent.click(screen.getByTestId('row-action-trigger'));
      expect(screen.getByTestId('row-action-archive')).toBeInTheDocument();
    } finally {
      warn.mockRestore();
    }
  });

  it('an envelope whose `source` is blank → the menu item renders', async () => {
    const warn = quiet();
    try {
      renderMenu({ rowActionDefs: [{ ...ARCHIVE, visible: { dialect: 'cel', source: '   ' } }] });
      await userEvent.click(screen.getByTestId('row-action-trigger'));
      expect(screen.getByTestId('row-action-archive')).toBeInTheDocument();
    } finally {
      warn.mockRestore();
    }
  });
});

/**
 * objectui#11358 — a `visible` that is DECLARED but has no evaluable `source`
 * (an `ast`-only envelope, `0`, `{}`, an array) hides the action on this row
 * menu, as on the toolbars and the selection bar, and is reported once.
 *
 * Nothing in this component changed for it: `isCustomRowActionVisible` asks
 * the action family's definition, which since the ruling answers "declared"
 * for these, and the row fold's fault path (`fallback: false`) hides. The
 * guard and the item read the same function, so the "⋮" trigger does not
 * survive an action it then suppresses.
 */
describe('a declared but not evaluable `visible` on a custom row action (objectui#11358)', () => {
  const UNEVALUABLE = [
    ['an `ast`-only envelope', { dialect: 'cel', ast: { kind: 'call', fn: '==' } }],
    ['0', 0],
    ['{}', {}],
    ['an array', ['record.id']],
  ] as const;

  it.each(UNEVALUABLE)('%s → the action is hidden (inline and in the menu), reported once', async (label, visible) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const name = `gated_11358_${UNEVALUABLE.findIndex(([l]) => l === label)}`;
      renderMenu({ rowActionDefs: [{ name, label: name, variant: 'primary', visible }, ARCHIVE] });
      expect(screen.queryByTestId(`row-action-inline-${name}`)).toBeNull();
      await userEvent.click(screen.getByTestId('row-action-trigger'));
      expect(screen.getByTestId('row-action-archive')).toBeInTheDocument();
      expect(screen.queryByTestId(`row-action-${name}`)).toBeNull();
      const lines = warn.mock.calls.map((c) => c.map(String).join(' '));
      expect(lines.filter((l) => l.includes(name))).toHaveLength(1);
      expect(lines.filter((l) => l.includes('[unevaluable]'))).toHaveLength(1);
    } finally {
      warn.mockRestore();
    }
  });

  it('a `disabled` gated that way → the item renders DISABLED (that key\'s fault direction)', async () => {
    // The row `disabled` leg evaluates with `fallback: true` and counts the
    // verdict only where a gate is declared — which this now is.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      renderMenu({ rowActionDefs: [{ ...ARCHIVE, disabled: { dialect: 'cel', ast: { kind: 'call' } } }] });
      await userEvent.click(screen.getByTestId('row-action-trigger'));
      const item = screen.getByTestId('row-action-archive');
      expect(item).toHaveAttribute('aria-disabled', 'true');
    } finally {
      warn.mockRestore();
    }
  });

  it('the only action on the row, gated that way → no "⋮" trigger at all', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      renderMenu({ rowActionDefs: [{ ...ARCHIVE, visible: { dialect: 'cel', ast: { kind: 'call' } } }] });
      expect(screen.queryByTestId('row-action-trigger')).toBeNull();
    } finally {
      warn.mockRestore();
    }
  });

  it('controls: an absent gate shows, a real CEL `source` evaluates as before', async () => {
    const { unmount } = renderMenu({ rowActionDefs: [{ ...OPEN }] });
    expect(screen.getByTestId('row-action-inline-open')).toBeInTheDocument();
    unmount();
    renderMenu({ rowActionDefs: [{ ...OPEN, visible: { dialect: 'cel', source: 'record.id == "e1"' } }, { ...UPGRADE, visible: { dialect: 'cel', source: 'record.id == "other"' } }] });
    expect(screen.getByTestId('row-action-inline-open')).toBeInTheDocument();
    expect(screen.queryByTestId('row-action-inline-upgrade')).toBeNull();
  });
});
