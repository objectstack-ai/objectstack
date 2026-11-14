/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#33215 — a `record_related` row action's declared `disabled`
 * predicate, on the related list's rows, reads as it does on the record
 * header: the same evaluator, a faulting predicate DISABLES the control, and
 * the action's `disabledReason` is attached to it.
 *
 * Driven through the real chain the enlarged related list draws:
 * `RelatedList` → `object-grid` → `RowActionMenu`. A `variant: 'primary'`
 * action is the row's inline button; a secondary one is a "⋮" item.
 */

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import React from 'react';

vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  return {
    ...actual,
    usePermissions: () => ({ isLoaded: false, checkField: () => true, getObjectApiOperations: () => undefined, can: () => true }),
  };
});

// Registers `object-grid`, the enlarged related list's face.
import '../index';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider, SchemaRendererProvider } from '@object-ui/react';
import { RelatedList } from '../../../plugin-detail/src/RelatedList';
import { RelatedListEnlargedContext } from '../../../plugin-detail/src/relatedListCompact';

registerAllFields();

beforeAll(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1440 });
});

afterEach(() => {
  cleanup();
});

const ROWS = [
  { id: 'p1', name: 'Plan locked', status: 'locked' },
  { id: 'p2', name: 'Plan open', status: 'open' },
];

const REASON = 'Locked plans cannot be allocated';

function renderEnlarged(rowActions: unknown[], onRowAction = vi.fn()) {
  const dataSource: any = {
    find: vi.fn(async () => ({ data: ROWS, total: ROWS.length })),
    getObjectSchema: vi.fn(async (name: string) => ({
      name,
      fields: { id: { type: 'text' }, name: { type: 'text', label: 'Name' }, status: { type: 'text', label: 'Status' } },
    })),
  };
  render(
    <ActionProvider>
      <SchemaRendererProvider dataSource={dataSource}>
        <RelatedListEnlargedContext.Provider value>
          <RelatedList
            title="Allocation plans"
            type="table"
            api="allocation_plan"
            objectName="allocation_plan"
            data={ROWS}
            columns={[{ field: 'name', label: 'Name' }, { field: 'status', label: 'Status' }]}
            rowActions={rowActions as never}
            onRowAction={onRowAction as never}
          />
        </RelatedListEnlargedContext.Provider>
      </SchemaRendererProvider>
    </ActionProvider>,
  );
  return { onRowAction };
}

/** The inline buttons of the given action, one per row, in row order. */
async function inlineButtons(name: string): Promise<HTMLElement[]> {
  return waitFor(() => {
    const buttons = screen.getAllByTestId(`row-action-inline-${name}`);
    expect(buttons).toHaveLength(ROWS.length);
    return buttons;
  });
}

describe('enlarged related list — inline primary row action honours `disabled` (objectstack#33215)', () => {
  const ALLOCATE = {
    name: 'allocate',
    label: 'Allocate',
    variant: 'primary',
    locations: ['record_header', 'record_related'],
    disabled: "record.status == 'locked'",
    disabledReason: REASON,
  };

  it('renders the button disabled, with its reason attached, on a row whose record makes `disabled` true', async () => {
    const { onRowAction } = renderEnlarged([ALLOCATE]);
    const [locked] = await inlineButtons('allocate');
    expect(locked).toBeDisabled();
    const describedBy = locked.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toHaveTextContent(REASON);
    await userEvent.click(locked, { pointerEventsCheck: 0 });
    expect(onRowAction).not.toHaveBeenCalled();
  });

  it('CONTROL: leaves the button enabled, with no reason, on a row where `disabled` is false', async () => {
    const { onRowAction } = renderEnlarged([ALLOCATE]);
    const [, open] = await inlineButtons('allocate');
    expect(open).toBeEnabled();
    expect(open).not.toHaveAttribute('aria-describedby');
    await userEvent.click(open);
    expect(onRowAction).toHaveBeenCalledTimes(1);
    expect(onRowAction.mock.calls[0][1]).toMatchObject({ id: 'p2' });
  });

  it('renders the button disabled when the `disabled` predicate faults (fail-closed)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      renderEnlarged([{ ...ALLOCATE, disabled: 'record.nonexistent.deep == 1' }]);
      const buttons = await inlineButtons('allocate');
      for (const button of buttons) expect(button).toBeDisabled();
    } finally {
      warn.mockRestore();
    }
  });
});

describe('enlarged related list — "⋮" row action attaches its `disabledReason` (objectstack#33215)', () => {
  const ARCHIVE = {
    name: 'archive_plan',
    label: 'Archive',
    locations: ['record_related'],
    disabled: "record.status == 'locked'",
    disabledReason: REASON,
  };

  async function openRowMenu(rowName: string) {
    const row = await waitFor(() => {
      const cell = screen.getByText(rowName);
      const tr = cell.closest('tr');
      expect(tr).toBeTruthy();
      return tr as HTMLElement;
    });
    await userEvent.click(within(row).getByTestId('row-action-trigger'));
    return waitFor(() => screen.getByTestId('row-action-archive_plan'));
  }

  it('greys the item and describes it with the reason on a row whose record makes `disabled` true', async () => {
    renderEnlarged([ARCHIVE]);
    const item = await openRowMenu('Plan locked');
    expect(item).toHaveAttribute('aria-disabled', 'true');
    const describedBy = item.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toHaveTextContent(REASON);
  });

  it('CONTROL: leaves the item enabled with no reason on a row where `disabled` is false', async () => {
    renderEnlarged([ARCHIVE]);
    const item = await openRowMenu('Plan open');
    expect(item).not.toHaveAttribute('aria-disabled', 'true');
    expect(item).not.toHaveAttribute('aria-describedby');
    expect(screen.queryByText(REASON)).toBeNull();
  });
});
