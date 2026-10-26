/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11860 — `ListView` tells its host when the USER changes the
 * grouping, so a host can keep the grouping in the URL the way it keeps the
 * sort and the Filter panel.
 *
 * Every door a user has onto the grouping is pinned, plus the one door that is
 * NOT the user's:
 *
 *   - the toolbar's Group panel: a level added, changed, removed, and Clear;
 *   - the compact toolbar's View settings popover: a level added, and its Clear;
 *   - a changed `schema.grouping` re-read by the list — the HOST's own value —
 *     is not reported back, the way `onSortChange` does not echo a view's
 *     declared sort.
 *
 * Each reported value is the spec's `GroupingConfig`: `GroupingConfigSchema`
 * parses it unchanged, so the host can hand it straight back through
 * `schema.grouping`.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { GroupingConfigSchema } from '@objectstack/spec/ui';
import type { GroupingConfig } from '@objectstack/spec/ui';
import type { DataSource, ListViewSchema } from '@object-ui/types';
import { SchemaRendererProvider } from '@object-ui/react';
import { ListView } from '../ListView';

/** A partial stub: only the members the list's mount path calls. */
const dataSource = {
  find: vi.fn().mockResolvedValue([]),
  findOne: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
} as unknown as DataSource;

function schemaWith(extra: Partial<ListViewSchema> = {}): ListViewSchema {
  return {
    type: 'list-view',
    objectName: 'contacts',
    viewType: 'grid',
    fields: ['name', 'email', 'status'],
    // objectui#12423 — the WIDE toolbar's Group panel, unless a case asks for
    // the Display form (the default) with `compactToolbar: true`.
    compactToolbar: false,
    ...extra,
  } as ListViewSchema;
}

function mount(schema: ListViewSchema, onGroupingChange: (g: GroupingConfig | undefined) => void) {
  const view = (s: ListViewSchema) => (
    <SchemaRendererProvider dataSource={dataSource}>
      <ListView schema={s} onGroupingChange={onGroupingChange} />
    </SchemaRendererProvider>
  );
  const result = render(view(schema));
  return { rerender: (next: ListViewSchema) => result.rerender(view(next)) };
}

/** Every value reported must be the spec shape, unchanged by a parse. */
function expectSpecShape(value: GroupingConfig | undefined) {
  expect(value).toBeDefined();
  const parsed = GroupingConfigSchema.safeParse(value);
  expect(parsed.success).toBe(true);
  expect(parsed.data).toEqual(value);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ListView reports a user grouping change to its host (objectui#11860)', () => {
  it('the toolbar Group panel: adding, changing and removing a level each report the spec `GroupingConfig`', async () => {
    const onGroupingChange = vi.fn();
    mount(schemaWith(), onGroupingChange);
    fireEvent.click(screen.getByRole('button', { name: /group/i }));
    await vi.waitFor(() => expect(screen.getByTestId('group-field-list')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('grouping-add'));
    expect(onGroupingChange).toHaveBeenCalledTimes(1);
    const added = onGroupingChange.mock.calls[0][0] as GroupingConfig;
    expectSpecShape(added);
    expect(added.fields).toHaveLength(1);

    fireEvent.click(screen.getByTestId('grouping-order-0'));
    expect(onGroupingChange).toHaveBeenCalledTimes(2);
    const flipped = onGroupingChange.mock.calls[1][0] as GroupingConfig;
    expectSpecShape(flipped);
    expect(flipped.fields[0]).toEqual({ ...added.fields[0], order: 'desc' });

    fireEvent.click(screen.getByTestId('grouping-remove-0'));
    expect(onGroupingChange).toHaveBeenCalledTimes(3);
    // The editor's own empty value: no level left is no grouping.
    expect(onGroupingChange.mock.calls[2][0]).toBeUndefined();
  });

  it('the toolbar Group panel: Clear reports `undefined`', async () => {
    const onGroupingChange = vi.fn();
    mount(schemaWith({ grouping: { fields: [{ field: 'status', order: 'asc', collapsed: false }] } }), onGroupingChange);
    fireEvent.click(screen.getByRole('button', { name: /group/i }));
    await vi.waitFor(() => expect(screen.getByTestId('clear-grouping')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('clear-grouping'));
    expect(onGroupingChange).toHaveBeenCalledTimes(1);
    expect(onGroupingChange).toHaveBeenCalledWith(undefined);
  });

  it('the compact Display popover: adding a level and its Clear report the same way', async () => {
    const onGroupingChange = vi.fn();
    mount(schemaWith({ compactToolbar: true }), onGroupingChange);
    // The compact toolbar draws no Group button of its own.
    expect(screen.queryByTestId('group-field-list')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('toolbar-display-trigger'));
    await vi.waitFor(() => expect(screen.getByTestId('view-settings-content')).toBeInTheDocument());

    const content = screen.getByTestId('view-settings-content');
    fireEvent.click(content.querySelector('[data-testid="grouping-add"]')!);
    expect(onGroupingChange).toHaveBeenCalledTimes(1);
    expectSpecShape(onGroupingChange.mock.calls[0][0]);

    const clear = Array.from(content.querySelectorAll('button')).find((b) => b.textContent === 'Clear');
    expect(clear).toBeDefined();
    fireEvent.click(clear!);
    expect(onGroupingChange).toHaveBeenCalledTimes(2);
    expect(onGroupingChange.mock.calls[1][0]).toBeUndefined();
  });

  it('a changed `schema.grouping` is re-read and NOT reported: it is the host\'s own value', async () => {
    const onGroupingChange = vi.fn();
    const { rerender } = mount(
      schemaWith({ grouping: { fields: [{ field: 'status', order: 'asc', collapsed: false }] } }),
      onGroupingChange,
    );
    await act(async () => {
      rerender(schemaWith({ grouping: { fields: [{ field: 'email', order: 'desc', collapsed: false }] } }));
    });
    // The list did take the host's new grouping (the badge counts its levels)…
    fireEvent.click(screen.getByRole('button', { name: /group/i }));
    await vi.waitFor(() => expect(screen.getByTestId('grouping-order-0')).toBeInTheDocument());
    expect(screen.getByTestId('grouping-order-0').getAttribute('title')).toBe('Descending');
    // …and told the host nothing about it.
    expect(onGroupingChange).not.toHaveBeenCalled();
  });
});
