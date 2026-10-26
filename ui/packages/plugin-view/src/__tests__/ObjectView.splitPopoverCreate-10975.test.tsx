/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10975 — under a `split` or `popover` navigation, the New button opens
 * a create form.
 *
 * Both surfaces draw a form only beside a selected record: the `split` branch
 * renders its `NavigationOverlay` under `isFormOpen && selectedRecord`, and the
 * `popover` overlay requires `selectedRecord` too. `handleCreate` sets the form
 * mode to `create`, clears the record and opens the form, so under either mode
 * New set state that nothing rendered.
 *
 * The create form now opens on the surface `formLayout` falls back to with no
 * `navigation`: the modal for `layout: 'modal'`, the drawer otherwise. That is
 * the same whether the mode comes from the node's own `navigation` or, since
 * objectui#10885 member 4, from the active named view's. A named view's
 * `navigation` replaces the node's as a whole, so the node's own `navigation`
 * does not pick the create surface while the named view is active.
 *
 * Controls: a `drawer` navigation's New is unchanged, and an existing record,
 * opened to view by a row click or to edit through the grid, still opens
 * beside the list under `split`.
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

describe('objectui#10975 — New opens a create form under `split` and `popover`', () => {
  it('THE FIX: the node\'s own `split` — New opens the create form in the drawer', async () => {
    await clickNew(nodeSchema({ navigation: { mode: 'split' } }));
    const form = await formIn('create');
    expect(inDrawer(form), 'the create form is not inside the drawer').toBe(true);
  });

  it('THE FIX: the node\'s own `popover` with `layout: \'modal\'` — New opens the create form in the modal', async () => {
    await clickNew(nodeSchema({ navigation: { mode: 'popover' }, layout: 'modal' }));
    const form = await formIn('create');
    expect(inDialog(form), 'the create form is not inside a dialog').toBe(true);
    expect(inDrawer(form), 'the create form opened in the drawer, not the `layout` modal').toBe(false);
  });

  it('THE FIX: a named view\'s `split` — New opens the create form in the drawer, not on the node\'s replaced `modal` navigation', async () => {
    await clickNew(namedSchema({ mode: 'split' }, { navigation: { mode: 'modal' } }));
    const form = await formIn('create');
    expect(inDrawer(form), 'the create form is not inside the drawer').toBe(true);
  });

  it('CONTROL: a `drawer` navigation\'s New opens the create form in the drawer, as before', async () => {
    await clickNew(nodeSchema({ navigation: { mode: 'drawer' } }));
    const form = await formIn('create');
    expect(inDrawer(form), 'the create form is not inside the drawer').toBe(true);
  });

  it('CONTROL: under `split`, a row click still opens the existing record beside the list', async () => {
    await mount(nodeSchema({ navigation: { mode: 'split' } }));
    act(() => gridProps[gridProps.length - 1].onRowClick(ROW));
    const form = await formIn('view');
    expect(inDialog(form), 'the record opened in a dialog, not beside the list').toBe(false);
    expect(await screen.findByText('Tasks Detail')).toBeTruthy();
    expect(screen.getByTestId('object-grid')).toBeTruthy();
  });

  it('CONTROL: under `split`, Edit still opens the existing record beside the list', async () => {
    await mount(nodeSchema({ navigation: { mode: 'split' } }));
    const { onEdit } = gridProps[gridProps.length - 1];
    expect(onEdit, 'route 2 handed the grid no `onEdit`').toBeTypeOf('function');
    act(() => onEdit!(ROW));
    const form = await formIn('edit');
    expect(inDialog(form), 'the record opened in a dialog, not beside the list').toBe(false);
    expect(await screen.findByText('Tasks Detail')).toBeTruthy();
    expect(screen.getByTestId('object-grid')).toBeTruthy();
  });
});
