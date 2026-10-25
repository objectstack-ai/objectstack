/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12440 — `ListView` takes a host's leading toolbar node.
 *
 * The console's saved-view tabs used to sit on a bordered row of their own
 * above the list, because the list's toolbar row had no place for anything a
 * host draws: its left group held only the user-filter chips. `toolbarLeading`
 * is that place — a React HOST prop, never a schema key (the list view's own
 * `tabs` key is retired from the protocol, objectui#11073).
 *
 * WHAT IS PINNED.
 *  - With the prop, its node renders inside the toolbar row's left group,
 *    FIRST, before `user-filters`, in a `min-w-0 flex-1` wrapper, and the left
 *    group grows so that wrapper has the width the tool cluster leaves.
 *  - Without it (and with a `null`, which React draws as nothing), the left
 *    group is today's: no wrapper, the same class string.
 *  - The prop is not forwarded to the active view component through the
 *    `{...props}` spread that carries `onEdit` / `onDelete` there.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRendererProvider } from '@object-ui/react';
import { ListView } from '../ListView';

let gridProps: Array<Record<string, unknown>> = [];

ComponentRegistry.register(
  'object-grid',
  (props: Record<string, unknown>) => {
    gridProps.push(props);
    return <div data-testid="grid-standin" />;
  },
  { namespace: 'test', label: 'object-grid stand-in', category: 'view' },
);

const objectDef = {
  name: 'duly_task',
  label: 'Task',
  fields: {
    id: { name: 'id', type: 'text' },
    subject: { name: 'subject', type: 'text', label: 'Subject' },
    priority: { name: 'priority', type: 'text', label: 'Priority' },
  },
};

function makeDataSource() {
  return {
    find: vi.fn(async () => ({ data: [{ id: '1', subject: 'Task 1', priority: 'high' }], total: 1 })),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => objectDef),
  } as never;
}

/** A `UserFilters` toggle chip — rendered under `data-testid="user-filters"`. */
const TOGGLE_CHIP = { element: 'toggle', fields: [{ field: 'priority' }] };

/** The left group's class string on `main` before this card — the row's DOM without the prop. */
const LEFT_GROUP_TODAY = 'flex items-center gap-2 overflow-x-auto min-w-0';

function mount(extra: Record<string, unknown> = {}) {
  const dataSource = makeDataSource();
  const schema = { type: 'list-view', objectName: 'duly_task', columns: ['subject'], userFilters: TOGGLE_CHIP };
  render(
    <SchemaRendererProvider dataSource={dataSource}>
      <ListView schema={schema as never} dataSource={dataSource} {...extra} />
    </SchemaRendererProvider>,
  );
}

const chips = () => screen.getByTestId('user-filters');

beforeEach(() => {
  gridProps = [];
});
afterEach(cleanup);

describe('objectui#12440 — ListView draws a host node first in its toolbar row', () => {
  it('renders the node in the left group, before `user-filters`, in a `min-w-0 flex-1` wrapper', async () => {
    mount({ toolbarLeading: <div data-testid="host-tabs">tabs</div> });
    await waitFor(() => expect(chips()).toBeInTheDocument());

    const node = screen.getByTestId('host-tabs');
    const wrapper = screen.getByTestId('list-toolbar-leading');
    expect(wrapper.contains(node)).toBe(true);
    expect(wrapper.className.split(/\s+/)).toEqual(expect.arrayContaining(['min-w-0', 'flex-1']));

    // Same left group as the chips, and first in it.
    const leftGroup = wrapper.parentElement!;
    expect(leftGroup.contains(chips())).toBe(true);
    expect(leftGroup.firstElementChild).toBe(wrapper);
    expect(wrapper.compareDocumentPosition(chips()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The group grows, so the wrapper's `flex-1` has the row's free width.
    expect(leftGroup.className.split(/\s+/)).toContain('flex-1');

    // And that group is the toolbar row's: the tool cluster is its sibling.
    const row = leftGroup.parentElement!;
    expect(row.querySelector('[data-print-hide]')).not.toBeNull();
    expect(row.className.split(/\s+/)).toContain('border-b');
  });

  it('without the prop the left group is today\'s: no wrapper, the same classes', async () => {
    mount();
    await waitFor(() => expect(chips()).toBeInTheDocument());

    expect(screen.queryByTestId('list-toolbar-leading')).toBeNull();
    const leftGroup = chips().parentElement!;
    expect(leftGroup.className).toBe(LEFT_GROUP_TODAY);
    expect(leftGroup.firstElementChild).toBe(chips());
  });

  it('a `null` node draws no wrapper either', async () => {
    mount({ toolbarLeading: null });
    await waitFor(() => expect(chips()).toBeInTheDocument());

    expect(screen.queryByTestId('list-toolbar-leading')).toBeNull();
    expect(chips().parentElement!.className).toBe(LEFT_GROUP_TODAY);
  });

  it('is not forwarded to the active view component', async () => {
    mount({ toolbarLeading: <div data-testid="host-tabs">tabs</div> });
    await waitFor(() => expect(screen.getByTestId('grid-standin')).toBeInTheDocument());

    expect(gridProps.length).toBeGreaterThan(0);
    for (const props of gridProps) {
      expect(props).not.toHaveProperty('toolbarLeading');
    }
    // The node is drawn once, in the toolbar, and nowhere else.
    expect(screen.getAllByTestId('host-tabs')).toHaveLength(1);
  });
});
