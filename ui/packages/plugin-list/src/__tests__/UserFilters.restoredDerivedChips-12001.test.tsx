/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12001 — a URL-restored quick-filter selection must survive the
 * object definition loading AFTER the list mounts.
 *
 * THE DEFECT. `userFilters: { element: 'dropdown' }` with no `fields` is the
 * shorthand `ListView` fills from the object definition (its
 * `resolvedUserFilters` memo). The definition is fetched after mount, so
 * `DropdownFilters` first renders with NO fields. It used to read the restored
 * selection (`initialSelections`, the host's `uf_*` URL params) only in its
 * `useState` initializer, which ran against that empty field list, so a link
 * such as `?uf_status=open` opened unfiltered while the address bar still
 * carried the filter.
 *
 * WHY THE DEFINITION IS GATED. `getObjectSchema` waits on a promise this file
 * releases by hand, and each derived case first asserts the bar is still
 * empty. Without that precondition an immediately-resolving definition could
 * let the chips derive before `DropdownFilters` ever rendered empty, and the
 * case would be green on the defect.
 *
 * WHAT IS PINNED:
 * - DERIVED: the chip shows the restored selection and the LAST `find`
 *   carries it, with the same `$filter` the declared-fields control sends.
 * - CONTROL: the declared-fields list behaves as before.
 * - ONCE PER FIELD: a user's clear survives the derived field list being
 *   rebuilt; a restored value is adopted when its field first appears, never
 *   again.
 * - ARRIVAL USES THE MOUNT RULES: URL strings are coerced to typed option
 *   values, and a single-choice field keeps one value.
 * - TABS (measured, not a defect): presets are never derived from the
 *   definition, so a restored tab already applies under the same late load.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup, act } from '@testing-library/react';
import { SchemaRendererProvider } from '@object-ui/react';
import { ListView } from '../ListView';
import { UserFilters } from '../UserFilters';

const objectDef = {
  name: 'ticket',
  label: 'Ticket',
  fields: {
    id: { name: 'id', type: 'text' },
    subject: { name: 'subject', type: 'text', label: 'Subject' },
    status: {
      name: 'status',
      type: 'select',
      label: 'Status',
      options: [
        { value: 'open', label: 'Open' },
        { value: 'closed', label: 'Closed' },
      ],
    },
    is_active: { name: 'is_active', type: 'boolean', label: 'Active' },
  },
};

const rows = [{ id: '1', subject: 'First', status: 'open', is_active: true }];

/** A data source whose definition answers only once `release()` is called. */
function makeGatedDataSource() {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const dataSource = {
    find: vi.fn(async () => ({ data: rows, total: rows.length })),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => {
      await gate;
      return objectDef;
    }),
  } as any;
  return { dataSource, release: () => act(async () => release()) };
}

const BASE = {
  type: 'list-view',
  objectName: 'ticket',
  viewType: 'grid',
  columns: ['subject', 'status'],
} as const;

const RESTORED = { status: ['open'] };

function mountList(userFilters: Record<string, unknown>, selections: Record<string, any[]>) {
  const { dataSource, release } = makeGatedDataSource();
  const ui = (schema: Record<string, unknown>) => (
    <SchemaRendererProvider dataSource={dataSource}>
      <ListView schema={schema as never} dataSource={dataSource} userFilterSelections={selections} />
    </SchemaRendererProvider>
  );
  const schema = { ...BASE, userFilters };
  const utils = render(ui(schema));
  return {
    dataSource,
    release,
    schema,
    rerender: (next: Record<string, unknown>) => utils.rerender(ui(next)),
  };
}

const lastFilter = (dataSource: any) => dataSource.find.mock.calls.at(-1)?.[1]?.$filter;

afterEach(cleanup);

describe('a URL-restored quick filter survives a late object definition (objectui#12001)', () => {
  it('CONTROL: declared fields restore the chip and the query, as before', async () => {
    const { dataSource, release } = mountList(
      { element: 'dropdown', fields: [{ field: 'status', type: 'select' }] },
      RESTORED,
    );
    // Declared chips exist before the definition does.
    expect(screen.getByTestId('filter-badge-status')).toBeTruthy();
    await release();
    await waitFor(() => expect(dataSource.find).toHaveBeenCalled());
    expect(screen.getByTestId('filter-clear-status')).toBeTruthy();
    expect(lastFilter(dataSource)).toEqual(['status', '=', 'open']);
  });

  it('DERIVED: the chip shows the restored selection and the last find carries its $filter', async () => {
    const { dataSource, release } = mountList({ element: 'dropdown' }, RESTORED);
    // Precondition: the bar mounted before the definition, with nothing to
    // attach the restored selection to.
    expect(screen.getByTestId('user-filters-empty')).toBeTruthy();
    await release();
    await waitFor(() => expect(screen.getByTestId('filter-badge-status')).toBeTruthy());
    expect(screen.getByTestId('filter-clear-status')).toBeTruthy();
    expect(screen.getByTestId('filter-badge-status').textContent).toContain('1');
    // The same `$filter` the declared control sends.
    await waitFor(() => expect(lastFilter(dataSource)).toEqual(['status', '=', 'open']));
  });

  it('ONCE PER FIELD: a user clear survives the derived field list being rebuilt', async () => {
    const { dataSource, release, schema, rerender } = mountList({ element: 'dropdown' }, RESTORED);
    await release();
    await waitFor(() => expect(lastFilter(dataSource)).toEqual(['status', '=', 'open']));

    fireEvent.click(screen.getByTestId('filter-clear-status'));
    await waitFor(() => expect(lastFilter(dataSource)).toBeUndefined());
    const settled = dataSource.find.mock.calls.length;

    // A new-but-equal `userFilters` object makes `ListView` derive the field
    // list again: fresh field objects under the same names, while the host
    // still hands down the selections it restored at mount.
    rerender({ ...schema, userFilters: { element: 'dropdown' } });
    await new Promise((r) => setTimeout(r, 50));

    expect(screen.getByTestId('filter-badge-status')).toBeTruthy();
    expect(screen.queryByTestId('filter-clear-status')).toBeNull();
    expect(dataSource.find.mock.calls.length).toBe(settled);
    expect(lastFilter(dataSource)).toBeUndefined();
  });

  it('TABS (measured, not a defect): a restored tab applies under the same late definition', async () => {
    const { dataSource, release } = mountList(
      {
        element: 'tabs',
        tabs: [
          { name: 'all', label: 'All', isDefault: true },
          { name: 'open', label: 'Open', filter: [{ field: 'status', operator: 'equals', value: 'open' }] },
        ],
      },
      { _tab: ['open'] },
    );
    await release();
    await waitFor(() => expect(dataSource.find).toHaveBeenCalled());
    expect(JSON.stringify(lastFilter(dataSource))).toContain('"open"');
  });
});

describe('DropdownFilters adopts a restored value when its field first appears (objectui#12001)', () => {
  const mountBar = (fields: Array<{ field: string; type?: string }>, def: unknown, props: Record<string, any>) => (
    <UserFilters
      config={{ element: 'dropdown', fields } as never}
      objectDef={def}
      data={[]}
      onFilterChange={props.onFilterChange}
      initialSelections={props.initialSelections}
    />
  );

  it('ARRIVAL USES THE MOUNT RULES: URL strings are coerced and single-choice keeps one value', () => {
    const onFilterChange = vi.fn();
    const initialSelections = { status: ['open', 'closed'], is_active: ['true'] };
    const { rerender } = render(mountBar([], undefined, { onFilterChange, initialSelections }));
    expect(onFilterChange).not.toHaveBeenCalled();

    rerender(
      mountBar(
        [
          { field: 'status', type: 'select' },
          { field: 'is_active', type: 'boolean' },
        ],
        objectDef,
        { onFilterChange, initialSelections },
      ),
    );

    expect(onFilterChange).toHaveBeenLastCalledWith([
      ['status', 'in', ['open']],
      ['is_active', 'in', [true]],
    ]);
  });

  it('ONCE PER FIELD: a field present at mount is not re-adopted when the list is rebuilt', () => {
    const onFilterChange = vi.fn();
    const initialSelections = { status: ['open'] };
    const fields = [{ field: 'status', type: 'select' }];
    const { rerender } = render(mountBar(fields, objectDef, { onFilterChange, initialSelections }));
    fireEvent.click(screen.getByTestId('filter-clear-status'));
    expect(onFilterChange).toHaveBeenLastCalledWith([]);
    const settled = onFilterChange.mock.calls.length;

    rerender(mountBar([{ field: 'status', type: 'select' }], { ...objectDef }, { onFilterChange, initialSelections }));

    expect(screen.queryByTestId('filter-clear-status')).toBeNull();
    expect(onFilterChange.mock.calls.length).toBe(settled);
  });
});
