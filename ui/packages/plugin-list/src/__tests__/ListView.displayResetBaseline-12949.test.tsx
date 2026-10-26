/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12949 — the Display control's "Reset to view default" and its
 * trigger count compare hidden fields and density against the VIEW'S OWN
 * value, not against the user's preference a host lays over it in `schema`.
 *
 * The console relays the user's stored hidden fields and row height into
 * `schema` (objectui#12474). Compared against `schema`, a mount after a reload
 * (each fixture here is one) read "nothing to reset" although the list differs
 * from the view. A host that persists them that way hands the view's own in
 * `viewDefaults`; a host that does not keeps the old comparison against
 * `schema` (the CONTROL describe).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRendererProvider } from '@object-ui/react';
import type { ListViewSchema } from '@object-ui/types';
import { ListView, type ListViewProps } from '../ListView';

const RECORDS = [{ id: '1', name: 'Acme', stage: 'won', amount: 3 }];

function makeDataSource() {
  return {
    find: vi.fn().mockResolvedValue({ data: RECORDS, total: 1 }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue({ name: 'account', fields: {} }),
  };
}

const BASE: ListViewSchema = {
  type: 'list-view',
  objectName: 'account',
  viewType: 'grid',
  fields: ['name', 'stage', 'amount'],
  userActions: { hideFields: true },
} as ListViewSchema;

let previousGrid: ReturnType<typeof ComponentRegistry.get>;

function mount(schema: Partial<ListViewSchema>, props: Partial<ListViewProps> = {}) {
  const dataSource = makeDataSource();
  render(
    <SchemaRendererProvider dataSource={dataSource as never}>
      <ListView schema={{ ...BASE, ...schema } as ListViewSchema} dataSource={dataSource as never} {...props} />
    </SchemaRendererProvider>,
  );
}

async function openDisplay(): Promise<HTMLElement> {
  await screen.findByTestId('grid-stub');
  fireEvent.click(screen.getByTestId('toolbar-display-trigger'));
  return screen.findByTestId('view-settings-content');
}

beforeEach(() => {
  previousGrid = ComponentRegistry.get('object-grid');
  ComponentRegistry.register('object-grid', () => <div data-testid="grid-stub" />);
});

afterEach(() => {
  cleanup();
  if (previousGrid) ComponentRegistry.register('object-grid', previousGrid as any);
});

describe('a host that lays the user\'s preference over the view resets to the view\'s own (objectui#12949)', () => {
  it('a hidden column the view shows: the reset is enabled on mount, counts, and writes the view\'s set', async () => {
    const onHiddenFieldsChange = vi.fn();
    mount(
      { hiddenFields: ['amount', 'stage'] },
      { viewDefaults: { hiddenFields: ['amount'] }, onHiddenFieldsChange },
    );
    const content = await openDisplay();
    expect(screen.getByTestId('toolbar-display-count')).toHaveTextContent('1');
    const reset = within(content).getByTestId('display-reset-button');
    expect(reset).toBeEnabled();

    fireEvent.click(reset);
    expect(onHiddenFieldsChange).toHaveBeenCalledTimes(1);
    expect(onHiddenFieldsChange).toHaveBeenCalledWith(['amount']);
    await waitFor(() => expect(screen.queryByTestId('toolbar-display-count')).toBeNull());
    expect(within(content).getByTestId('display-reset-button')).toBeDisabled();
  });

  it('a view that hides nothing: an absent `viewDefaults.hiddenFields` is the empty set', async () => {
    const onHiddenFieldsChange = vi.fn();
    mount({ hiddenFields: ['stage'] }, { viewDefaults: {}, onHiddenFieldsChange });
    const content = await openDisplay();
    expect(screen.getByTestId('toolbar-display-count')).toHaveTextContent('1');

    fireEvent.click(within(content).getByTestId('display-reset-button'));
    expect(onHiddenFieldsChange).toHaveBeenCalledWith([]);
  });

  it('a density other than the view\'s: the reset is enabled on mount, counts, and writes the view\'s density', async () => {
    const onDensityChange = vi.fn();
    mount(
      { rowHeight: 'compact', onDensityChange } as Partial<ListViewSchema>,
      { viewDefaults: { rowHeight: 'tall' } },
    );
    const content = await openDisplay();
    expect(within(content).getByTestId('view-settings-density-cycle')).toHaveTextContent('Compact');
    expect(screen.getByTestId('toolbar-display-count')).toHaveTextContent('1');
    const reset = within(content).getByTestId('display-reset-button');
    expect(reset).toBeEnabled();

    fireEvent.click(reset);
    await waitFor(() => expect(onDensityChange).toHaveBeenCalledWith('spacious'));
    expect(onDensityChange).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByTestId('toolbar-display-count')).toBeNull());
    expect(within(content).getByTestId('view-settings-density-cycle')).toHaveTextContent('Spacious');
  });

  it('both differ: the count reads 2', async () => {
    mount(
      { hiddenFields: ['stage'], rowHeight: 'compact' } as Partial<ListViewSchema>,
      { viewDefaults: { rowHeight: 'medium' }, onHiddenFieldsChange: vi.fn() },
    );
    await openDisplay();
    expect(screen.getByTestId('toolbar-display-count')).toHaveTextContent('2');
  });

  it('CONTROL: a preference equal to the view\'s own leaves the reset disabled and nothing counted', async () => {
    mount(
      { hiddenFields: ['stage', 'amount'], rowHeight: 'tall' } as Partial<ListViewSchema>,
      { viewDefaults: { hiddenFields: ['amount', 'stage'], rowHeight: 'tall' }, onHiddenFieldsChange: vi.fn() },
    );
    const content = await openDisplay();
    expect(screen.queryByTestId('toolbar-display-count')).toBeNull();
    expect(within(content).getByTestId('display-reset-button')).toBeDisabled();
  });
});

describe('CONTROL: a host passing no `viewDefaults` compares against `schema`, as before (objectui#12949)', () => {
  it('hidden fields and density handed in `schema` are the view\'s own: nothing to reset', async () => {
    mount({ hiddenFields: ['stage'], rowHeight: 'tall' } as Partial<ListViewSchema>, { onHiddenFieldsChange: vi.fn() });
    const content = await openDisplay();
    expect(screen.queryByTestId('toolbar-display-count')).toBeNull();
    expect(within(content).getByTestId('display-reset-button')).toBeDisabled();
  });

  it('a density change made in the list counts, and the reset hands back the density `schema` carried', async () => {
    const onDensityChange = vi.fn();
    mount({ rowHeight: 'tall', onDensityChange } as Partial<ListViewSchema>);
    const content = await openDisplay();
    fireEvent.click(within(content).getByTestId('view-settings-density-cycle'));
    await waitFor(() => expect(screen.getByTestId('toolbar-display-count')).toHaveTextContent('1'));
    await waitFor(() => expect(onDensityChange).toHaveBeenCalledTimes(1));
    expect(onDensityChange).not.toHaveBeenLastCalledWith('spacious');

    fireEvent.click(within(content).getByTestId('display-reset-button'));
    await waitFor(() => expect(onDensityChange).toHaveBeenLastCalledWith('spacious'));
    await waitFor(() => expect(screen.queryByTestId('toolbar-display-count')).toBeNull());
  });
});
