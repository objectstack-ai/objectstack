// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#34794 — the Data pillar's Records tab, on the REAL records grid
 * (plugin-view's ObjectView, plugin-list's ListView, the components data
 * table), so every assertion reads what an author sees:
 *
 * - an "Add field" in the grid's own toolbar row, always on screen, opening
 *   the Add field popover; offered exactly where the grid's trailing "+"
 *   column is (not on a read-only package);
 * - a click on a field's column header selects that field (its properties
 *   open) and does not sort; sort and hide are in the header's column menu,
 *   one caret away;
 * - the object's name field is the first column and the served-only columns
 *   (`owner_id`) follow the author's fields;
 * - the object's machine name is the title's tooltip, not a chip.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Module scope: the cold transform is paid during collection, which no test or
// hook timeout clocks (ui/AGENTS.md, flaky-test discipline).
import '@object-ui/components';
import { render, screen, cleanup, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const OBJECT = 'showcase_meeting';

/** The object as its author wrote it: the name field is not declared first. */
const AUTHORED = {
  name: OBJECT,
  label: 'Meeting',
  fields: {
    place: { type: 'text', label: 'Place' },
    title: { type: 'text', label: 'Meeting name' },
    held_on: { type: 'date', label: 'Held on' },
  },
};

/** What the server serves: its injected owner column leads. */
const SERVED = {
  ...AUTHORED,
  fields: {
    owner_id: { type: 'lookup', reference: 'sys_user', label: 'Owner', system: true, readonly: false },
    ...AUTHORED.fields,
  },
};

const mockClient = {
  list: vi.fn(async (type: string) => (type === 'object' ? [{ name: OBJECT, label: 'Meeting' }] : [])),
  listDrafts: vi.fn(async () => []),
  layered: vi.fn(async () => ({ effective: SERVED, code: AUTHORED })),
  getDraft: vi.fn(async () => null),
  save: vi.fn(async () => ({})),
};

const ROWS = [
  { id: 'm2', title: 'Budget review', place: 'Room B', held_on: '2026-11-24', owner_id: null },
  { id: 'm1', title: 'All hands', place: 'Room A', held_on: '2026-11-20', owner_id: null },
];

function createDataSource() {
  return {
    find: vi.fn(async () => ROWS),
    findOne: vi.fn(async () => null),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
    getObjectSchema: vi.fn(async () => SERVED),
  };
}
let dataSource = createDataSource();

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return { ...mod, useMetadataClient: () => mockClient, useMetadataTypes: () => ({ entries: [] }) };
});

vi.mock('./packages-io', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./packages-io')>();
  return { ...mod, fetchPackages: vi.fn(async () => []) };
});

vi.mock('@object-ui/react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/react')>();
  return { ...mod, useAdapter: () => dataSource };
});

// The source under test reaches a dynamic import of `@objectstack/lint`: its first
// load is paid here, at collection, never inside a case's clock (`check:test-source-alias`).
import '@objectstack/lint';
import { DataPillar } from './StudioDesignSurface';
import { t } from '../metadata-admin/i18n';
import { registerMetadataInspector } from '../metadata-admin/inspector-registry';
import { ObjectFieldInspector } from '../metadata-admin/inspectors/ObjectFieldInspector';
import { completeAddFieldPopover } from './__tests__/dataPillarAddField';

registerMetadataInspector('object', ObjectFieldInspector);

const ADD_FIELD = t('engine.studio.data.addField', 'en');
const COLUMN_MENU = t('engine.studio.data.columnMenu', 'en');

beforeEach(() => {
  dataSource = createDataSource();
  for (const m of ['hasPointerCapture', 'setPointerCapture', 'releasePointerCapture'] as const) {
    if (!(m in Element.prototype)) {
      (Element.prototype as unknown as Record<string, unknown>)[m] = m === 'hasPointerCapture' ? () => false : () => {};
    }
  }
  if (!('scrollIntoView' in Element.prototype)) {
    (Element.prototype as unknown as Record<string, unknown>).scrollIntoView = () => {};
  }
  // A grid with rows asks for their edit verdicts; answer from a double.
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

async function renderGrid(props: { readOnly?: boolean } = {}) {
  render(
    <MemoryRouter initialEntries={['/studio/com.example.showcase/data']}>
      <DataPillar packageId="com.example.showcase" readOnly={props.readOnly} />
    </MemoryRouter>,
  );
  await waitFor(() => expect(document.querySelector('thead th[data-column-key="title"]')).not.toBeNull(), {
    timeout: 8000,
  });
}

const header = (key: string) => document.querySelector(`thead th[data-column-key="${key}"]`) as HTMLElement;
const columnOrder = () =>
  Array.from(document.querySelectorAll('thead th[data-column-key]'))
    .map((th) => th.getAttribute('data-column-key'))
    .filter((k) => k !== '_actions');
/** The rows' order, read off the body's text: the served order puts Budget review first. */
const firstTitles = () => {
  const text = document.querySelector('tbody')?.textContent ?? '';
  return ['Budget review', 'All hands'].sort((a, b) => text.indexOf(a) - text.indexOf(b));
};

describe('Data pillar Records tab (objectstack#34794)', () => {
  it("the name field leads and is the frozen first column; the served owner column follows the author's fields", async () => {
    await renderGrid();
    expect(columnOrder()).toEqual(['title', 'place', 'held_on', 'owner_id']);
    expect(header('title').className).toContain('sticky');
  });

  it("Add field sits in the grid's toolbar row and opens the Add field popover there", async () => {
    await renderGrid();
    const toolbarAdd = within(screen.getByTestId('list-toolbar-leading')).getByTestId('data-records-add-field');
    expect(toolbarAdd).toHaveTextContent(ADD_FIELD);
    // The trailing "+" column is kept.
    expect(screen.getByTestId('grid-add-column')).toBeInTheDocument();
    await userEvent.click(toolbarAdd);
    await completeAddFieldPopover({ label: 'Agenda' });
    await waitFor(() => expect(mockClient.save).toHaveBeenCalled(), { timeout: 8000 });
    const calls = mockClient.save.mock.calls as unknown as Array<[string, string, { fields: Record<string, unknown> }]>;
    expect(Object.keys(calls.at(-1)![2].fields)).toContain('agenda');
  });

  it('a read-only package offers neither Add field entry', async () => {
    await renderGrid({ readOnly: true });
    expect(screen.queryByTestId('data-records-add-field')).not.toBeInTheDocument();
    expect(screen.queryByTestId('grid-add-column')).not.toBeInTheDocument();
  });

  it("a header click selects the field and opens its properties, and does not sort; the caret's menu sorts and hides", async () => {
    await renderGrid();
    const before = firstTitles();
    await userEvent.click(within(header('title')).getByText('Meeting name'));
    // The field's properties are open: its label box holds the field's label.
    expect(await screen.findByTestId('field-label-input')).toHaveValue('Meeting name');
    expect(firstTitles()).toEqual(before);

    const caret = within(header('title')).getByRole('button', { name: COLUMN_MENU });
    await userEvent.click(caret);
    const menu = screen.getByTestId('column-context-menu');
    expect(within(menu).getAllByRole('menuitem')).toHaveLength(3);
    // The caret's click selected nothing else and did not sort either.
    expect(firstTitles()).toEqual(before);
  });

  it("a click on a column the author's buffer does not declare (the served owner column) selects nothing", async () => {
    await renderGrid();
    await userEvent.click(within(header('owner_id')).getByText('Owner'));
    expect(screen.queryByTestId('field-label-input')).not.toBeInTheDocument();
  });

  it("the object's machine name is the title's tooltip, not a chip beside it", async () => {
    await renderGrid();
    const head = screen.getByTestId('data-object-header');
    expect(within(head).getByRole('heading', { level: 1 })).toHaveAttribute('title', OBJECT);
    expect(within(head).queryByTestId('studio-item-api-name')).not.toBeInTheDocument();
  });
});
