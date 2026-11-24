/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#2614 — the data-table's BUILT-IN row Edit/Delete items honor the
 * per-record `visibleWhen` / `disabledWhen` CEL predicates carried on
 * `schema.rowEditPredicates` / `rowDeletePredicates` (sourced from the
 * object's `userActions.edit` / `delete` object form). This is the path a
 * detail page's related list renders through — the master-detail scenario
 * from the downstream report (a frozen `task_version_check_item` row must
 * grey out its Edit button instead of letting the user discover the freeze
 * on Save).
 *
 * The subcomponent is rendered inside a controlled-open dropdown, same as
 * the `DataTableRowActionItem` tests, because Radix mounts menu content only
 * when open (which is also why predicate evaluation costs nothing at table
 * render time).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { PredicateScopeProvider } from '@object-ui/react';
import { Edit } from 'lucide-react';
import { DataTableBuiltinRowActionItem } from '../data-table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '../../../ui/dropdown-menu';

const FROZEN = { id: 'r1', name: 'Check item A', frozen: true };
const DRAFT = { id: 'r2', name: 'Check item B', frozen: false };

function renderItem(props: {
  predicates?: any;
  row: any;
  onSelect?: (row: any) => void;
  name?: 'edit' | 'delete';
}) {
  const name = props.name ?? 'edit';
  return render(
    <PredicateScopeProvider scope={{}}>
      <DropdownMenu open modal={false}>
        <DropdownMenuTrigger>menu</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DataTableBuiltinRowActionItem
            name={name}
            icon={<Edit className="mr-2 h-4 w-4" />}
            label={name === 'edit' ? 'Edit' : 'Delete'}
            onSelect={props.onSelect ?? (() => {})}
            predicates={props.predicates}
            row={props.row}
          />
        </DropdownMenuContent>
      </DropdownMenu>
    </PredicateScopeProvider>,
  );
}

describe('data-table built-in row action — per-record CEL predicates (#2614)', () => {
  it('renders enabled with no predicates (zero regression)', () => {
    renderItem({ row: FROZEN });
    const item = screen.getByTestId('row-action-builtin-edit');
    expect(item).toBeInTheDocument();
    expect(item).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('disabledWhen true → rendered but disabled; clicks do not fire', () => {
    const onSelect = vi.fn();
    renderItem({ predicates: { disabledWhen: 'record.frozen == true' }, row: FROZEN, onSelect });
    const item = screen.getByTestId('row-action-builtin-edit');
    expect(item).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(item);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('disabledWhen false → enabled; clicks fire with the row', () => {
    const onSelect = vi.fn();
    renderItem({ predicates: { disabledWhen: 'record.frozen == true' }, row: DRAFT, onSelect });
    fireEvent.click(screen.getByTestId('row-action-builtin-edit'));
    expect(onSelect).toHaveBeenCalledWith(DRAFT);
  });

  it('visibleWhen false → the item is not rendered for that row', () => {
    renderItem({ predicates: { visibleWhen: 'record.frozen != true' }, row: FROZEN });
    expect(screen.queryByTestId('row-action-builtin-edit')).not.toBeInTheDocument();
  });

  it('accepts the canonical { dialect, source } envelope', () => {
    renderItem({
      predicates: { visibleWhen: { dialect: 'cel', source: 'record.frozen != true' } },
      row: DRAFT,
    });
    expect(screen.getByTestId('row-action-builtin-edit')).toBeInTheDocument();
  });
});

/**
 * objectstack#35293 — a built-in row Edit / Delete greyed by its declared
 * `disabledWhen` says why, the way the record page's Edit / Delete do: the
 * generic `actions.notAvailableForRecord` sentence (`userActions` declares no
 * reason key) as the item's visible second line and its accessible
 * description, while the item's name stays its label. An item that is on —
 * no predicate, or a predicate that does not hold — gives no reason.
 */
describe('data-table built-in row action — a disabledWhen-greyed item says why (objectstack#35293)', () => {
  const REASON = 'Not available for this record';
  const describedBy = (el: HTMLElement) => {
    const id = el.getAttribute('aria-describedby');
    return id ? document.getElementById(id) : null;
  };

  it.each(['edit', 'delete'] as const)('%s greyed by disabledWhen shows the reason as its second line and description', (name) => {
    renderItem({ name, predicates: { disabledWhen: 'record.frozen == true' }, row: FROZEN });
    const item = screen.getByTestId(`row-action-builtin-${name}`);
    expect(item).toHaveAttribute('aria-disabled', 'true');
    const reason = describedBy(item);
    expect(reason).toHaveTextContent(REASON);
    expect(reason).toBeVisible();
    expect(screen.getByRole('menuitem', { name: name === 'edit' ? 'Edit' : 'Delete' })).toBe(item);
  });

  it('control — an item with no predicate gives no reason', () => {
    renderItem({ row: FROZEN });
    const item = screen.getByTestId('row-action-builtin-edit');
    expect(item).not.toHaveAttribute('aria-describedby');
    expect(screen.queryByText(REASON)).toBeNull();
  });

  it('control — an item whose disabledWhen does not hold gives no reason', () => {
    renderItem({ predicates: { disabledWhen: 'record.frozen == true' }, row: DRAFT });
    const item = screen.getByTestId('row-action-builtin-edit');
    expect(item).not.toHaveAttribute('aria-disabled', 'true');
    expect(item).not.toHaveAttribute('aria-describedby');
    expect(screen.queryByText(REASON)).toBeNull();
  });
});
