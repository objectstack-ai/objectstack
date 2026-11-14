/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#33215 — a `record_related` row action's declared `disabled`
 * predicate, on the record page's related list, reads as it does on the record
 * header: the item greys for the row whose record makes it true, a faulting
 * predicate greys it too, and the action's `disabledReason` describes it.
 *
 * Driven through the real chain the default (card) face draws: `RelatedList` →
 * `data-table` → the row's "⋮" menu. The enlarged face (`object-grid`) is
 * pinned in plugin-grid's `relatedListRowActionDisabled-33215.test.tsx`.
 */

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import * as React from 'react';

// Registers `data-table`, the default face of a `type="table"` related list.
import '@object-ui/components';
import { ActionProvider } from '@object-ui/react';
import { RelatedList } from '../RelatedList';

beforeAll(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1280 });
});

afterEach(() => {
  cleanup();
});

const ROWS = [
  { id: 'p1', name: 'Plan locked', status: 'locked' },
  { id: 'p2', name: 'Plan open', status: 'open' },
];

const REASON = 'Locked plans cannot be allocated';

const ALLOCATE = {
  name: 'allocate',
  label: 'Allocate',
  locations: ['record_header', 'record_related'],
  disabled: "record.status == 'locked'",
  disabledReason: REASON,
};

function renderList(rowActions: unknown[], onRowAction = vi.fn()) {
  render(
    <ActionProvider>
      <RelatedList
        title="Allocation plans"
        type="table"
        api="allocation_plan"
        objectName="allocation_plan"
        data={ROWS}
        columns={[{ accessorKey: 'name', header: 'Name' }, { accessorKey: 'status', header: 'Status' }]}
        rowActions={rowActions as never}
        onRowAction={onRowAction as never}
      />
    </ActionProvider>,
  );
  return { onRowAction };
}

async function openRowMenu(rowName: string): Promise<HTMLElement> {
  const row = await waitFor(() => {
    const tr = screen.getByText(rowName).closest('tr');
    expect(tr).toBeTruthy();
    return tr as HTMLElement;
  });
  await userEvent.click(within(row).getByTestId('data-table-row-actions'));
  return waitFor(() => screen.getByTestId('row-action-allocate'));
}

describe('related list — row action honours `disabled` with its reason (objectstack#33215)', () => {
  it('greys the item and describes it with the reason on a row whose record makes `disabled` true', async () => {
    const { onRowAction } = renderList([ALLOCATE]);
    const item = await openRowMenu('Plan locked');
    expect(item).toHaveAttribute('data-disabled');
    const describedBy = item.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toHaveTextContent(REASON);
    await userEvent.click(item, { pointerEventsCheck: 0 });
    expect(onRowAction).not.toHaveBeenCalled();
  });

  it('CONTROL: leaves the item enabled, with no reason, on a row where `disabled` is false', async () => {
    const { onRowAction } = renderList([ALLOCATE]);
    const item = await openRowMenu('Plan open');
    expect(item).not.toHaveAttribute('data-disabled');
    expect(item).not.toHaveAttribute('aria-describedby');
    expect(screen.queryByText(REASON)).toBeNull();
    await userEvent.click(item);
    expect(onRowAction).toHaveBeenCalledTimes(1);
    expect(onRowAction.mock.calls[0][1]).toMatchObject({ id: 'p2' });
  });

  it('greys the item when the `disabled` predicate faults (fail-closed), and gives the reason', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      renderList([{ ...ALLOCATE, disabled: 'record.nonexistent.deep == 1' }]);
      const item = await openRowMenu('Plan open');
      expect(item).toHaveAttribute('data-disabled');
      expect(document.getElementById(item.getAttribute('aria-describedby')!)).toHaveTextContent(REASON);
    } finally {
      warn.mockRestore();
    }
  });
});
