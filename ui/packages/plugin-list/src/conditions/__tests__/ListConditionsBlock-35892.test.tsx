/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#35892 — the list page's condition row for a host that is not a
 * `ListView` (a record page's related tab): registered as `list-conditions`,
 * reached through the registry with React props, controlled by the host. It
 * is the list page's own row, so its field lists follow the list page's rules,
 * a filter reaches the host as the query node the list page sends, and its
 * 「Discard」 is the list page's button.
 */

import { describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ComponentRegistry } from '@object-ui/core';
import type { FilterBuilderRowGroup } from '@object-ui/components';
import { ListConditionsBlock } from '../ListConditionsBlock';
import { ConditionDiscardButton } from '../ListConditionControls';
import '../../index';

const OBJECT = {
  name: 'quote',
  fields: {
    name: { type: 'text', label: 'Name' },
    amount: { type: 'currency', label: 'Amount' },
    status: {
      type: 'select',
      label: 'Status',
      options: [
        { value: 'draft', label: 'Draft' },
        { value: 'sent', label: 'Sent' },
      ],
    },
    secret_note: { type: 'text', label: 'Secret', hidden: true },
  },
};
const EMPTY: FilterBuilderRowGroup = { id: 'root', logic: 'and', conditions: [] };

function Host(props: Partial<React.ComponentProps<typeof ListConditionsBlock>>) {
  return (
    <ListConditionsBlock
      objectName="quote"
      objectDef={OBJECT}
      shownFields={['name', 'amount', 'status']}
      sort={[]}
      onSortChange={() => {}}
      filters={EMPTY}
      onFiltersChange={() => {}}
      {...props}
    />
  );
}

describe('list-conditions (objectstack#35892)', () => {
  it('is registered, for the hosts below plugin-list', () => {
    expect(ComponentRegistry.has('list-conditions')).toBe(true);
  });

  it('draws the list page\'s Sort and Filter, and no view switch, view settings or search', () => {
    render(<Host />);
    expect(screen.getByTestId('condition-chips')).toBeInTheDocument();
    expect(screen.getAllByTestId('condition-sort').length).toBeGreaterThan(0);
    expect(screen.getAllByTestId('condition-add-filter').length).toBeGreaterThan(0);
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.queryByTestId('view-switcher')).toBeNull();
  });

  it('hands the host the filter as the query node the list page sends, finished rows only', () => {
    const onFiltersChange = vi.fn();
    const draft: FilterBuilderRowGroup = {
      id: 'root',
      logic: 'and',
      conditions: [{ id: 'r1', field: 'status', operator: 'in', value: ['draft'] }],
    };
    render(<Host filters={draft} onFiltersChange={onFiltersChange} />);
    fireEvent.click(screen.getByTestId('filter-chip-remove-status'));
    expect(onFiltersChange).toHaveBeenCalledWith(expect.objectContaining({ conditions: [] }), undefined);
  });

  it('draws 「Discard」 only while the host passes it, and it is the list page\'s button', () => {
    const onDiscard = vi.fn();
    const { rerender } = render(<Host />);
    expect(screen.queryByTestId('condition-discard')).toBeNull();
    rerender(<Host onDiscard={onDiscard} />);
    fireEvent.click(screen.getByTestId('condition-discard'));
    expect(onDiscard).toHaveBeenCalledTimes(1);
    const { container } = render(<ConditionDiscardButton onDiscard={() => {}} data-testid="list-page-discard" />);
    const listPage = container.querySelector('[data-testid="list-page-discard"]')!;
    const block = screen.getByTestId('condition-discard');
    for (const cls of ['h-6', 'text-[13px]', 'font-normal', 'text-muted-foreground']) {
      expect(listPage.classList.contains(cls)).toBe(true);
      expect(block.classList.contains(cls)).toBe(true);
    }
  });

  it('collapses its labels to icons by the row\'s own width: the empty Sort button keeps an accessible name', () => {
    render(<Host />);
    const sort = screen.getAllByTestId('condition-sort')[0];
    expect(sort.getAttribute('aria-label')).toBeTruthy();
    expect(screen.getByTestId('condition-chips').className).toContain('@container/conditions');
  });
});
