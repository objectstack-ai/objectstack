/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11015 — a `page` record surface with no `onNavigate` opens create,
 * edit and view on the drawer.
 *
 * With no authored `layout`, `ObjectView` derives the record surface with
 * `deriveRecordSurface`: `page` on a mobile viewport, and on an object with at
 * least `RECORD_SURFACE_PAGE_THRESHOLD` authorable fields. A page hands the
 * record to `onNavigate`, and the registered `object-view` renderer has none:
 * a JSON schema cannot carry a function. New, a row click and Edit set the
 * form state, and no render branch drew a `page` form, so each opened nothing.
 * They now open on the drawer, the surface objectui#10975 gave create under
 * `split` / `popover` for a page.
 *
 * The fix rows mount the REGISTERED renderer through the real `SchemaRenderer`
 * and `SchemaRendererProvider`, so no `onNavigate` reaches the view. The heavy
 * object's rows also assert the object's label in the form title: the title
 * reads the loaded object schema, so the surface was chosen after the field
 * count was known, when the derived surface is `page`.
 *
 * Controls: with an `onNavigate` the same object and viewport still route every
 * verb to it and open no form, which is also the proof that the derived surface
 * is `page` there; a light object on a desktop still opens the drawer.
 *
 * `ObjectGrid` is a sink that keeps the `onRowClick` and `onEdit` route 2 hands
 * it. `ObjectForm` is a sink that shows the mode it was built for.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, act, fireEvent, within } from '@testing-library/react';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
import type { DataSource, ObjectViewSchema } from '@object-ui/types';
// Module scope, not a hook: this import IS the registration of `object-view`.
import '../index';
import { ObjectView } from '../ObjectView';
import { RECORD_SURFACE_PAGE_THRESHOLD } from '../recordSurface';

/** The handlers each mounted `ObjectGrid` received from route 2. */
type GridHandlers = { onRowClick: (record: Record<string, unknown>) => void; onEdit?: (record: Record<string, unknown>) => void };
const gridProps: GridHandlers[] = [];

vi.mock('@object-ui/plugin-grid', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ObjectGrid: ({ onRowClick, onEdit }: GridHandlers) => {
    gridProps.push({ onRowClick, onEdit });
    return <div data-testid="object-grid" />;
  },
}));
vi.mock('@object-ui/plugin-form', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ObjectForm: ({ schema }: { schema: { mode?: string } }) => <div data-testid="object-form" data-mode={schema.mode} />,
}));

const DESKTOP = 1280;
const MOBILE = 390;
const ORIGINAL_WIDTH = window.innerWidth;

function setViewport(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
}

/** An object whose authorable field count sits exactly at the page threshold. */
function heavyFields(): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (let i = 0; i < RECORD_SURFACE_PAGE_THRESHOLD; i++) fields[`f${i}`] = { type: 'text' };
  return fields;
}
const LIGHT_FIELDS = { name: { type: 'text' }, status: { type: 'text' } };

function makeDataSource(fields: Record<string, unknown>) {
  const state = { settled: false };
  const ds = {
    find: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => {
      state.settled = true;
      return { name: 'task', label: 'Tasks', fields };
    }),
  };
  return { ds: ds as unknown as DataSource, state };
}

const ROW = { id: 'r1', name: 'Alpha' };

beforeEach(() => {
  cleanup();
  gridProps.length = 0;
  setViewport(DESKTOP);
});
afterEach(() => {
  cleanup();
  setViewport(ORIGINAL_WIDTH);
});

async function settle(state: { settled: boolean }) {
  await waitFor(() => expect(gridProps.length).toBeGreaterThan(0));
  await waitFor(() => expect(state.settled, 'the object schema was never read').toBe(true));
  await act(async () => {});
}

/** The registered renderer, as a page schema reaches it: no `onNavigate`. */
async function mountRegistered(fields: Record<string, unknown>) {
  const { ds, state } = makeDataSource(fields);
  render(
    <SchemaRendererProvider dataSource={ds}>
      <SchemaRenderer schema={{ type: 'object-view', objectName: 'task' } as never} />
    </SchemaRendererProvider>,
  );
  await settle(state);
}

/** A host composition that routes, the way app-shell's `ObjectView` does. */
async function mountRouted(fields: Record<string, unknown>, onNavigate: ObjectViewSchema['onNavigate']) {
  const { ds, state } = makeDataSource(fields);
  const schema = { type: 'object-view', objectName: 'task', onNavigate } as unknown as ObjectViewSchema;
  render(<ObjectView schema={schema} dataSource={ds} />);
  await settle(state);
}

const lastGrid = () => gridProps[gridProps.length - 1];

type Verb = 'create' | 'view' | 'edit';
function run(verb: Verb) {
  if (verb === 'create') {
    fireEvent.click(screen.getByRole('button', { name: 'New' }));
  } else if (verb === 'view') {
    act(() => lastGrid().onRowClick(ROW));
  } else {
    const { onEdit } = lastGrid();
    expect(onEdit, 'route 2 handed the grid no `onEdit`').toBeTypeOf('function');
    act(() => onEdit!(ROW));
  }
}

/** The one form in the tree, built for `verb`, inside the drawer. */
async function formInDrawer(verb: Verb): Promise<HTMLElement> {
  const form = await screen.findByTestId('object-form');
  expect(form.getAttribute('data-mode')).toBe(verb);
  // The drawer is the right-hand Sheet on a desktop and vaul's bottom sheet on
  // a phone (objectui#11775).
  const drawer = (form.closest('[role="dialog"].inset-y-0.right-0') ?? form.closest('[data-vaul-drawer]')) as HTMLElement | null;
  expect(drawer, `the ${verb} form is not inside the drawer`).not.toBeNull();
  return drawer!;
}

const VERBS: Verb[] = ['create', 'view', 'edit'];
const TITLES: Record<Verb, string> = { create: 'Create Tasks', view: 'View Tasks', edit: 'Edit Tasks' };
const ROUTED: Record<Verb, [string, string]> = { create: ['new', 'edit'], view: ['r1', 'view'], edit: ['r1', 'edit'] };

describe('objectui#11015 — a derived `page` with no `onNavigate` opens each verb on the drawer', () => {
  for (const verb of VERBS) {
    it(`THE FIX: a field-heavy object on the registered renderer — ${verb} opens the drawer`, async () => {
      await mountRegistered(heavyFields());
      run(verb);
      const drawer = await formInDrawer(verb);
      expect(
        within(drawer).getByText(TITLES[verb]),
        'the title does not carry the loaded object label, so the surface was chosen before the field count was known',
      ).toBeTruthy();
    });

    it(`THE FIX: a mobile viewport on the registered renderer — ${verb} opens the drawer`, async () => {
      setViewport(MOBILE);
      await mountRegistered(LIGHT_FIELDS);
      run(verb);
      await formInDrawer(verb);
    });
  }

  it('THE FIX: an explicit `layout: \'page\'` with no `onNavigate` shares the fallback — New opens the drawer', async () => {
    const { ds, state } = makeDataSource(LIGHT_FIELDS);
    render(
      <SchemaRendererProvider dataSource={ds}>
        <SchemaRenderer schema={{ type: 'object-view', objectName: 'task', layout: 'page' } as never} />
      </SchemaRendererProvider>,
    );
    await settle(state);
    run('create');
    await formInDrawer('create');
  });

  for (const verb of VERBS) {
    it(`CONTROL: a field-heavy object with an \`onNavigate\` still routes ${verb} and opens no form`, async () => {
      const onNavigate = vi.fn();
      await mountRouted(heavyFields(), onNavigate);
      run(verb);
      await waitFor(() => expect(onNavigate).toHaveBeenCalledTimes(1));
      expect(onNavigate.mock.calls[0]).toEqual(ROUTED[verb]);
      expect(screen.queryByTestId('object-form')).toBeNull();
    });

    it(`CONTROL: a mobile viewport with an \`onNavigate\` still routes ${verb} and opens no form`, async () => {
      setViewport(MOBILE);
      const onNavigate = vi.fn();
      await mountRouted(LIGHT_FIELDS, onNavigate);
      run(verb);
      await waitFor(() => expect(onNavigate).toHaveBeenCalledTimes(1));
      expect(onNavigate.mock.calls[0]).toEqual(ROUTED[verb]);
      expect(screen.queryByTestId('object-form')).toBeNull();
    });
  }

  it('CONTROL: a light object on a desktop derives the drawer — New opens it, as before', async () => {
    await mountRegistered(LIGHT_FIELDS);
    run('create');
    await formInDrawer('create');
  });
});
