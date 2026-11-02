/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#29052 — a host can clear the user-filter chips through the
 * bar's handle, without remounting it.
 *
 * Pinned:
 * - dropdown: `clear()` empties every chip, author defaults included; the bar
 *   emits no conditions and reports EVERY chip field empty, held or not, so a
 *   host that persists per field drops each one;
 * - toggle (stored, spec-deprecated): `clear()` turns every toggle off;
 * - tabs: no handle is set — a preset tab is not a filter the reader added;
 * - a host that passes no ref gets today's bar: the restored selection, the
 *   chip's × clearing in place.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { UserFilters, type UserFiltersHandle } from '../UserFilters';

afterEach(cleanup);

const objectDef = {
  name: 'tasks',
  fields: {
    status: {
      type: 'select',
      label: 'Status',
      options: [
        { label: 'To Do', value: 'todo' },
        { label: 'Done', value: 'done' },
      ],
    },
    priority: {
      type: 'select',
      label: 'Priority',
      options: [
        { label: 'High', value: 'high' },
        { label: 'Low', value: 'low' },
      ],
    },
    owner: { type: 'text', label: 'Owner' },
  },
};

describe('UserFilters clear handle (objectstack#29052)', () => {
  it('dropdown: clear() empties every chip and reports every chip field empty', () => {
    const ref = React.createRef<UserFiltersHandle>();
    const onFilterChange = vi.fn();
    const onSelectionsChange = vi.fn();
    render(
      <UserFilters
        ref={ref}
        config={{
          element: 'dropdown',
          fields: [
            { field: 'status' },
            { field: 'priority', defaultValues: ['high'] },
            { field: 'owner' },
          ],
        }}
        objectDef={objectDef}
        data={[]}
        onFilterChange={onFilterChange}
        onSelectionsChange={onSelectionsChange}
        initialSelections={{ status: ['todo'] }}
      />,
    );
    expect(onFilterChange).toHaveBeenLastCalledWith([
      ['status', 'in', ['todo']],
      ['priority', 'in', ['high']],
    ]);
    expect(screen.getByTestId('filter-clear-status')).toBeTruthy();
    expect(screen.getByTestId('filter-clear-priority')).toBeTruthy();

    act(() => ref.current!.clear());

    expect(onFilterChange).toHaveBeenLastCalledWith([]);
    // `owner` held nothing and is reported all the same.
    expect(onSelectionsChange).toHaveBeenLastCalledWith({ status: [], priority: [], owner: [] });
    expect(screen.queryByTestId('filter-clear-status')).toBeNull();
    expect(screen.queryByTestId('filter-clear-priority')).toBeNull();
    expect(screen.getByTestId('filter-badge-status').textContent).not.toMatch(/\d/);
  });

  it('dropdown: a chip picked after a clear applies on its own', () => {
    const ref = React.createRef<UserFiltersHandle>();
    const onFilterChange = vi.fn();
    render(
      <UserFilters
        ref={ref}
        config={{ element: 'dropdown', fields: [{ field: 'status' }, { field: 'priority' }] }}
        objectDef={objectDef}
        data={[]}
        onFilterChange={onFilterChange}
        initialSelections={{ status: ['todo'], priority: ['low'] }}
      />,
    );

    act(() => ref.current!.clear());
    fireEvent.click(screen.getByTestId('filter-badge-priority'));
    fireEvent.click(screen.getByText('High'));

    expect(onFilterChange).toHaveBeenLastCalledWith([['priority', 'in', ['high']]]);
  });

  it('toggle: clear() turns every toggle off', () => {
    const ref = React.createRef<UserFiltersHandle>();
    const onFilterChange = vi.fn();
    render(
      <UserFilters
        ref={ref}
        config={{ element: 'toggle', fields: [{ field: 'status', label: 'Open', defaultValues: ['todo'] }] } as never}
        data={[]}
        onFilterChange={onFilterChange}
      />,
    );
    expect(onFilterChange).toHaveBeenLastCalledWith([['status', 'in', ['todo']]]);

    act(() => ref.current!.clear());

    expect(onFilterChange).toHaveBeenLastCalledWith([]);
  });

  it('tabs: no handle is set', () => {
    const ref = React.createRef<UserFiltersHandle>();
    render(
      <UserFilters
        ref={ref}
        config={{ element: 'tabs', tabs: [{ id: 'mine', label: 'Mine', filters: [['owner', '=', 'me']], default: true }] } as never}
        data={[]}
        onFilterChange={() => {}}
      />,
    );

    expect(screen.getByTestId('filter-tab-mine')).toBeTruthy();
    expect(ref.current).toBeNull();
  });

  it('without a ref the bar behaves as before: restored selection, the chip × clears in place', () => {
    const onFilterChange = vi.fn();
    const onSelectionsChange = vi.fn();
    render(
      <UserFilters
        config={{ element: 'dropdown', fields: [{ field: 'status' }, { field: 'priority' }] }}
        objectDef={objectDef}
        data={[]}
        onFilterChange={onFilterChange}
        onSelectionsChange={onSelectionsChange}
        initialSelections={{ status: ['todo'] }}
      />,
    );
    expect(onFilterChange).toHaveBeenLastCalledWith([['status', 'in', ['todo']]]);
    expect(onSelectionsChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('filter-clear-status'));

    expect(onFilterChange).toHaveBeenLastCalledWith([]);
    expect(onSelectionsChange).toHaveBeenLastCalledWith({ status: [] });
  });
});
