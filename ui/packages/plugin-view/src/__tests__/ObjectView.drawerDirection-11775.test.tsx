/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11775 — the record drawer is a right-hand panel on a desktop and a
 * bottom sheet on a phone.
 *
 * `renderDrawerForm` used to open one vaul `Drawer` with `direction="right"`
 * on every viewport. vaul honours `direction` for its slide and drag gesture
 * only: the shipped `DrawerContent` is the upstream bottom sheet and carries
 * the bottom-sheet classes whatever the direction. On a 1440×900 desktop the
 * create form therefore drew as a 672×526 bottom sheet pinned to the
 * bottom-left by `sm:max-w-2xl`, with `data-vaul-drawer-direction="right"` on
 * it (the card's browser reading).
 *
 * The desktop panel is now the right-hand `Sheet`; the phone keeps vaul's
 * bottom sheet, opened in vaul's default direction.
 *
 * jsdom-class environments do not lay out, so these pins read the classes and
 * data attributes that decide the geometry, never a measured box:
 *
 *  - THE FIX: on a desktop, create, edit and view draw the form on a
 *    `[role="dialog"]` that is right-anchored and full height
 *    (`inset-y-0 right-0 h-full`), is not a vaul drawer, and carries none of
 *    the bottom sheet's classes.
 *  - CONTROL: on a phone the same verbs draw it on vaul's bottom sheet, in the
 *    `bottom` direction, spanning the viewport (no `sm:max-w-2xl` cap).
 *  - CONTROL: the stock `DrawerContent` every other bottom-sheet user renders
 *    (`useActionModal`'s `bottom` placement, the SDUI `drawer` node) still
 *    draws the bottom sheet: the fix did not come from changing the primitive.
 *
 * `ObjectGrid` is a sink that keeps the handlers the view hands it, and
 * `ObjectForm` a sink that shows the mode it was built for.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, act, fireEvent, within } from '@testing-library/react';
import type { DataSource, ObjectViewSchema } from '@object-ui/types';
import { Drawer, DrawerContent, DrawerTitle } from '@object-ui/components';
import { ObjectView } from '../ObjectView';

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

/** The card's viewport, and a phone below `useIsMobile`'s 768px breakpoint. */
const DESKTOP = 1440;
const MOBILE = 390;
const ORIGINAL_WIDTH = window.innerWidth;

function setViewport(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
}

/** The upstream bottom sheet's geometry classes, and the right panel's. */
const BOTTOM_SHEET = ['inset-x-0', 'bottom-0', 'rounded-t-[10px]'];
const RIGHT_PANEL = ['inset-y-0', 'right-0', 'h-full'];

const ROW = { id: 'r1', name: 'Alpha' };

function makeDataSource() {
  const state = { settled: false };
  const ds = {
    find: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => {
      state.settled = true;
      return { name: 'task', label: 'Tasks', fields: { name: { type: 'text' }, status: { type: 'text' } } };
    }),
  };
  return { ds: ds as unknown as DataSource, state };
}

/** An object view whose author chose the drawer, so both viewports open it. */
async function mount() {
  const { ds, state } = makeDataSource();
  const schema = { type: 'object-view', objectName: 'task', layout: 'drawer' } as unknown as ObjectViewSchema;
  render(<ObjectView schema={schema} dataSource={ds} />);
  await waitFor(() => expect(gridProps.length).toBeGreaterThan(0));
  await waitFor(() => expect(state.settled, 'the object schema was never read').toBe(true));
  await act(async () => {});
}

type Verb = 'create' | 'edit' | 'view';
const VERBS: Verb[] = ['create', 'edit', 'view'];
const TITLES: Record<Verb, string> = { create: 'Create Tasks', edit: 'Edit Tasks', view: 'View Tasks' };

function run(verb: Verb) {
  const grid = gridProps[gridProps.length - 1];
  if (verb === 'create') {
    fireEvent.click(screen.getByRole('button', { name: 'New' }));
  } else if (verb === 'view') {
    act(() => grid.onRowClick(ROW));
  } else {
    expect(grid.onEdit, 'the grid was handed no `onEdit`').toBeTypeOf('function');
    act(() => grid.onEdit!(ROW));
  }
}

/** The dialog surface the one form in the tree, built for `verb`, is drawn on. */
async function surfaceOf(verb: Verb): Promise<HTMLElement> {
  const form = await screen.findByTestId('object-form');
  expect(form.getAttribute('data-mode')).toBe(verb);
  const surface = form.closest('[role="dialog"]') as HTMLElement | null;
  expect(surface, `the ${verb} form is not inside a dialog surface`).not.toBeNull();
  expect(within(surface!).getByText(TITLES[verb])).toBeTruthy();
  return surface!;
}

const classesOf = (el: Element) => el.getAttribute('class')?.split(/\s+/).filter(Boolean) ?? [];

beforeEach(() => {
  cleanup();
  gridProps.length = 0;
});
afterEach(() => {
  cleanup();
  setViewport(ORIGINAL_WIDTH);
});

describe('objectui#11775 — the record drawer is a right panel on a desktop, a bottom sheet on a phone', () => {
  for (const verb of VERBS) {
    it(`THE FIX: on a desktop, ${verb} draws the form in a right-anchored, full-height panel`, async () => {
      setViewport(DESKTOP);
      await mount();
      run(verb);
      const surface = await surfaceOf(verb);
      const classes = classesOf(surface);

      expect(
        surface.closest('[data-vaul-drawer]'),
        'the desktop form is still on vaul\'s drawer, whose content is styled as a bottom sheet',
      ).toBeNull();
      expect(classes, 'the panel is not right-anchored and full height').toEqual(expect.arrayContaining(RIGHT_PANEL));
      for (const bottom of BOTTOM_SHEET) {
        expect(classes, `the desktop panel still carries the bottom sheet's \`${bottom}\``).not.toContain(bottom);
      }
      // The caller's width wins over the Sheet's default `w-3/4 sm:max-w-sm`.
      expect(classes).toEqual(expect.arrayContaining(['w-full', 'sm:max-w-2xl']));
      expect(classes).not.toContain('sm:max-w-sm');
    });

    it(`CONTROL: on a phone, ${verb} draws the form on vaul's bottom sheet, across the viewport`, async () => {
      setViewport(MOBILE);
      await mount();
      run(verb);
      const surface = await surfaceOf(verb);
      const classes = classesOf(surface);

      expect(surface.hasAttribute('data-vaul-drawer'), 'the phone form is not on vaul\'s drawer').toBe(true);
      expect(
        surface.getAttribute('data-vaul-drawer-direction'),
        'the bottom sheet slides and drags in a direction other than the one it is drawn in',
      ).toBe('bottom');
      expect(classes).toEqual(expect.arrayContaining(BOTTOM_SHEET));
      expect(classes).not.toContain('right-0');
      expect(classes, 'the phone bottom sheet is capped, so it pins to the left between 640px and 768px').not.toContain('sm:max-w-2xl');
    });
  }

  it('CONTROL: the stock `DrawerContent` other bottom-sheet users render still draws the bottom sheet', () => {
    render(
      <Drawer open>
        <DrawerContent>
          <DrawerTitle>Stock bottom sheet</DrawerTitle>
        </DrawerContent>
      </Drawer>,
    );
    const surface = screen.getByText('Stock bottom sheet').closest('[data-vaul-drawer]') as HTMLElement | null;
    expect(surface).not.toBeNull();
    expect(surface!.getAttribute('data-vaul-drawer-direction')).toBe('bottom');
    expect(classesOf(surface!)).toEqual(expect.arrayContaining(BOTTOM_SHEET));
  });
});
