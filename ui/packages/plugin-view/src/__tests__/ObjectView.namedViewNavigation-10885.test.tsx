/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10885 member 4 — a named view's `navigation` reaches the row click.
 *
 * `ObjectView` hands the SAME `handleRowClick` down both routes: route 2 passes
 * it to `ObjectGrid` as `onRowClick`, and the host delegation passes it to
 * `renderListView`. Both the grid's navigation hook and `ListView`'s obey that
 * handler first, so what the handler reads is what a row click does. It read
 * `navigationConfig`, and that was the node's `navigation` alone: a named view's
 * `navigation` was relayed into the delegation's `list-view` node and then
 * overruled by the handler, and route 2 did not read it at all.
 *
 * `navigationConfig` now reads the active named view first, as a WHOLE object
 * (no key of the node's is merged in), then the node. Its other consumers,
 * `formLayout` and the drawer width, follow it on the same read.
 *
 * `ObjectGrid` is replaced by a sink that keeps the `onRowClick` route 2 hands
 * it; the delegation is a `renderListView` that keeps the one it is handed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, cleanup, act } from '@testing-library/react';
import { ObjectView } from '../ObjectView';
import type { DataSource, ObjectViewSchema } from '@object-ui/types';

/** The `onRowClick` each mounted `ObjectGrid` received — route 2's handler. */
const gridClicks: Array<(record: Record<string, unknown>) => void> = [];

vi.mock('@object-ui/plugin-grid', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ObjectGrid: ({ onRowClick }: any) => {
    gridClicks.push(onRowClick);
    return <div data-testid="object-grid" />;
  },
}));
vi.mock('@object-ui/plugin-form', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ObjectForm: () => <div data-testid="object-form" />,
}));

const dataSource = (): DataSource => ({
  find: vi.fn().mockResolvedValue({ data: [], total: 0 }),
  findOne: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getObjectSchema: vi.fn().mockResolvedValue({ name: 'task', fields: {} }),
} as unknown as DataSource);

const ROW = { id: 'r1', name: 'Alpha' };

beforeEach(() => {
  cleanup();
  gridClicks.length = 0;
});

/** One grid named view, `v1`, carrying `navigation` when given. */
function viewSchema(named: Record<string, unknown> | undefined, node: Record<string, unknown>): ObjectViewSchema {
  return {
    type: 'object-view',
    objectName: 'task',
    defaultListView: 'v1',
    listViews: { v1: { label: 'Open work', type: 'grid', columns: ['name'], ...(named ? { navigation: named } : {}) } },
    ...node,
  } as unknown as ObjectViewSchema;
}

/** Route 2: mount, then click a row through the handler `ObjectGrid` was handed. */
async function clickOnRouteTwo(schema: ObjectViewSchema) {
  render(<ObjectView schema={schema} dataSource={dataSource()} />);
  await waitFor(() => expect(gridClicks.length).toBeGreaterThan(0));
  act(() => gridClicks[gridClicks.length - 1](ROW));
}

/** The delegation: mount with a host `renderListView`, then click through the handler it was handed. */
async function clickOnDelegation(schema: ObjectViewSchema) {
  const hostClicks: Array<(record: Record<string, unknown>) => void> = [];
  const renderListView = vi.fn(({ onRowClick }: any) => {
    hostClicks.push(onRowClick);
    return <div data-testid="host-list" />;
  });
  render(<ObjectView schema={schema} dataSource={dataSource()} renderListView={renderListView as any} />);
  await waitFor(() => expect(hostClicks.length).toBeGreaterThan(0));
  act(() => hostClicks[hostClicks.length - 1](ROW));
}

describe('objectui#10885 — the row click follows the active named view\'s `navigation` (route 2)', () => {
  it('THE FIX: a named `page` navigation wins over the node\'s `drawer` — `onNavigate` is called', async () => {
    const onNavigate = vi.fn();
    await clickOnRouteTwo(viewSchema({ mode: 'page' }, { navigation: { mode: 'drawer' }, onNavigate }));
    expect(onNavigate).toHaveBeenCalledWith('r1', 'view');
    expect(screen.queryByTestId('object-form')).toBeNull();
  });

  it('WHOLE OBJECT: no key of the node\'s `navigation` is merged into the named one', async () => {
    // A per-key merge would carry the node's `preventNavigation` into the named
    // `page` navigation, and the click would do nothing.
    const onNavigate = vi.fn();
    await clickOnRouteTwo(viewSchema({ mode: 'page' }, { navigation: { mode: 'page', preventNavigation: true }, onNavigate }));
    expect(onNavigate).toHaveBeenCalledWith('r1', 'view');
  });

  it('CONTROL: a named view that declares no `navigation` leaves the node\'s in force', async () => {
    const onNavigate = vi.fn();
    await clickOnRouteTwo(viewSchema(undefined, { navigation: { mode: 'page' }, onNavigate }));
    expect(onNavigate).toHaveBeenCalledWith('r1', 'view');
  });
});

describe('objectui#10885 — the host delegation\'s row click follows it too (one read serves both routes)', () => {
  it('THE FIX: the handler `renderListView` is handed obeys the named `page` navigation', async () => {
    const onNavigate = vi.fn();
    await clickOnDelegation(viewSchema({ mode: 'page' }, { navigation: { mode: 'drawer' }, onNavigate }));
    expect(onNavigate).toHaveBeenCalledWith('r1', 'view');
    expect(screen.queryByTestId('object-form')).toBeNull();
  });

  it('CONTROL: with no named `navigation`, the node\'s `drawer` opens the record form, as before', async () => {
    const onNavigate = vi.fn();
    await clickOnDelegation(viewSchema(undefined, { navigation: { mode: 'drawer' }, onNavigate }));
    expect(onNavigate).not.toHaveBeenCalled();
    expect(await screen.findByTestId('object-form')).toBeTruthy();
  });
});

describe('objectui#10885 — the record overlay follows the named `navigation` (`formLayout` and the drawer width)', () => {
  it('THE FIX: a named `drawer` navigation with a `width` opens the record in a drawer of that width, over the node\'s `modal` layout', async () => {
    await clickOnRouteTwo(viewSchema({ mode: 'drawer', width: 640 }, { layout: 'modal' }));
    const form = await screen.findByTestId('object-form');
    expect(form.closest('.max-w-\\[640px\\]'), 'the record form is not inside a container of the named width').not.toBeNull();
  });

  it('CONTROL: with no named `navigation`, the record opens in the node\'s layout, with no named width', async () => {
    await clickOnRouteTwo(viewSchema(undefined, { layout: 'modal' }));
    const form = await screen.findByTestId('object-form');
    expect(form.closest('.max-w-\\[640px\\]')).toBeNull();
  });
});
