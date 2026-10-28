/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10975, re-pinned by objectstack#26677 — `split` and `popover` left
 * the spec's `NavigationMode`, and with them the faces that drew a form beside
 * the list or in a popover.
 *
 * objectui#10975 fixed New under those two modes: both faces drew a form only
 * beside a selected record, so the create form opened on the surface
 * `formLayout` falls back to — the modal for `layout: 'modal'`, the drawer
 * otherwise. objectstack#26677 retired both values (a side-by-side pane is a
 * reader's own preference, drawn by the console's object page, not metadata),
 * so an authored one is refused at parse and a stored one is converted before
 * it reaches a renderer. These rows pin what a body still carrying one does
 * when it reaches this component past a cast: every verb — New, a row click,
 * Edit — opens on that same fallback surface, and NOTHING opens beside the
 * list any more. The rows that pinned the beside-the-list face are FLIPPED.
 *
 * Control: a `drawer` navigation's New opens the drawer, as before.
 *
 * `ObjectGrid` is a sink that keeps the `onRowClick` and `onEdit` route 2 hands
 * it. `ObjectForm` is a sink that shows the mode it was built for.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, cleanup, act, fireEvent } from '@testing-library/react';
import { ObjectView } from '../ObjectView';
import type { DataSource, ObjectViewSchema } from '@object-ui/types';

/** The handlers each mounted `ObjectGrid` received from route 2. */
const gridProps: Array<{ onRowClick: (record: Record<string, unknown>) => void; onEdit?: (record: Record<string, unknown>) => void }> = [];

vi.mock('@object-ui/plugin-grid', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ObjectGrid: ({ onRowClick, onEdit }: any) => {
    gridProps.push({ onRowClick, onEdit });
    return <div data-testid="object-grid" />;
  },
}));
vi.mock('@object-ui/plugin-form', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ObjectForm: ({ schema }: any) => <div data-testid="object-form" data-mode={schema.mode} />,
}));

const dataSource = (): DataSource => ({
  find: vi.fn().mockResolvedValue({ data: [], total: 0 }),
  findOne: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getObjectSchema: vi.fn().mockResolvedValue({ name: 'task', label: 'Tasks', fields: {} }),
} as unknown as DataSource);

const ROW = { id: 'r1', name: 'Alpha' };

beforeEach(() => {
  cleanup();
  gridProps.length = 0;
});

function nodeSchema(node: Record<string, unknown>): ObjectViewSchema {
  return { type: 'object-view', objectName: 'task', ...node } as unknown as ObjectViewSchema;
}

/** One grid named view, `v1`, carrying the given `navigation`. */
function namedSchema(named: Record<string, unknown>, node: Record<string, unknown>): ObjectViewSchema {
  return nodeSchema({
    defaultListView: 'v1',
    listViews: { v1: { label: 'Open work', type: 'grid', columns: ['name'], navigation: named } },
    ...node,
  });
}

async function mount(schema: ObjectViewSchema) {
  render(<ObjectView schema={schema} dataSource={dataSource()} />);
  await waitFor(() => expect(gridProps.length).toBeGreaterThan(0));
}

async function clickNew(schema: ObjectViewSchema) {
  await mount(schema);
  fireEvent.click(screen.getByRole('button', { name: 'New' }));
}

/** The one form in the tree, built for `mode`. */
async function formIn(mode: string): Promise<HTMLElement> {
  const form = await screen.findByTestId('object-form');
  expect(form.getAttribute('data-mode')).toBe(mode);
  return form;
}

// The drawer is the right-hand Sheet on a desktop and vaul's bottom sheet on a
// phone (objectui#11775); the modal is a centred dialog, neither of the two.
const inDrawer = (el: HTMLElement) =>
  el.closest('[role="dialog"].inset-y-0.right-0') !== null || el.closest('[data-vaul-drawer]') !== null;
const inDialog = (el: HTMLElement) => el.closest('[role="dialog"]') !== null;

describe('objectstack#26677 — a stale `split` / `popover` opens on the fallback surface, never beside the list', () => {
  it('a node\'s stale `split` — New opens the create form in the drawer', async () => {
    await clickNew(nodeSchema({ navigation: { mode: 'split' } }));
    const form = await formIn('create');
    expect(inDrawer(form), 'the create form is not inside the drawer').toBe(true);
  });

  it('a node\'s stale `popover` with `layout: \'modal\'` — New opens the create form in the modal', async () => {
    await clickNew(nodeSchema({ navigation: { mode: 'popover' }, layout: 'modal' }));
    const form = await formIn('create');
    expect(inDialog(form), 'the create form is not inside a dialog').toBe(true);
    expect(inDrawer(form), 'the create form opened in the drawer, not the `layout` modal').toBe(false);
  });

  it('a named view\'s stale `split` — New opens the create form in the drawer', async () => {
    await clickNew(namedSchema({ mode: 'split' }, { navigation: { mode: 'drawer' } }));
    const form = await formIn('create');
    expect(inDrawer(form), 'the create form is not inside the drawer').toBe(true);
  });

  it('CONTROL: a `drawer` navigation\'s New opens the create form in the drawer, as before', async () => {
    await clickNew(nodeSchema({ navigation: { mode: 'drawer' } }));
    const form = await formIn('create');
    expect(inDrawer(form), 'the create form is not inside the drawer').toBe(true);
  });

  it('FLIPPED: under a stale `split`, a row click opens the record in the drawer — not beside the list', async () => {
    await mount(nodeSchema({ navigation: { mode: 'split' } }));
    act(() => gridProps[gridProps.length - 1].onRowClick(ROW));
    const form = await formIn('view');
    expect(inDrawer(form), 'the record did not open in the drawer').toBe(true);
    // The split panel's heading and close control are gone with the face.
    expect(screen.queryByText('Tasks Detail')).toBeNull();
    expect(screen.queryByLabelText('Close panel')).toBeNull();
  });

  it('FLIPPED: under a stale `split`, Edit opens the record in the drawer — not beside the list', async () => {
    await mount(nodeSchema({ navigation: { mode: 'split' } }));
    const { onEdit } = gridProps[gridProps.length - 1];
    expect(onEdit, 'route 2 handed the grid no `onEdit`').toBeTypeOf('function');
    act(() => onEdit!(ROW));
    const form = await formIn('edit');
    expect(inDrawer(form), 'the record did not open in the drawer').toBe(true);
    expect(screen.queryByText('Tasks Detail')).toBeNull();
  });
});
