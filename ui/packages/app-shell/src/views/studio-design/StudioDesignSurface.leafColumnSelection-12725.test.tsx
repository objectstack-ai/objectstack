// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12725 — target 2 on an `object` leaf: a click on a canvas element
 * switches the right slot to 属性 for that element. On the records list the
 * element is a column, and its properties are its row in the view's column
 * list (`ObjectListViewInspector`).
 *
 * Pinned here, through the mounted surface with its right slot:
 *
 *  - a click on a listed column's header selects that column in the panel,
 *    switches the slot to 属性 with the copilot a strip at its foot, outlines
 *    the header, and does not sort;
 *  - Esc, and a click on empty canvas, clear the column selection, and the
 *    slot keeps showing the view's properties;
 *  - a column picked in the panel is the one outlined on the canvas;
 *  - a header the view does not list keeps the runtime's click, which sorts;
 *  - CONTROLS: the data table outside Studio sorts on a header click; a canvas
 *    registered over the default gets no channel, so its headers sort and the
 *    slot keeps the copilot (the dashboard pins stay in `rightSlot-12725`).
 *
 * The canvas is the real `StudioObjectRecordsCanvas`; `object-view` is a stub
 * that draws the real `data-table` with the columns of the view it is handed,
 * plus one column the view does not list. The copilot is the stub
 * `rightSlot-12725` uses.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ComponentRegistry } from '@object-ui/core';
import { MetadataCtx, SchemaRenderer, type MetadataContextValue } from '@object-ui/react';
import '@object-ui/components';

const PACKAGE_ID = 'com.acme.app';
const NAV = [{ id: 'nav_obj', type: 'object', label: 'Tasks', objectName: 'showcase_task' }];

const OBJECT_DEF = {
  name: 'showcase_task',
  label: 'Task',
  fields: {
    title: { name: 'title', label: 'Title', type: 'text' },
    status: { name: 'status', label: 'Status', type: 'text' },
    priority: { name: 'priority', label: 'Priority', type: 'number' },
  },
};

/** The object's default list view: two of its three fields listed. */
const DEFAULT_VIEW = {
  name: 'showcase_task.default',
  object: 'showcase_task',
  viewKind: 'list',
  label: 'All tasks',
  isDefault: true,
  config: {
    type: 'grid',
    data: { provider: 'object', object: 'showcase_task' },
    columns: [{ field: 'title' }, { field: 'status' }],
  },
};

// In no column's order, so a client sort by any one of them is visible.
const ROWS = [
  { id: '1', title: 'Bob', status: 'open', priority: 2 },
  { id: '2', title: 'Ada', status: 'done', priority: 3 },
  { id: '3', title: 'Cyd', status: 'hold', priority: 1 },
];

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn(), dismiss: vi.fn() },
  Toaster: () => null,
}));

const mockClient = {
  save: vi.fn(async () => ({ success: true, version: 'v1', state: 'draft' })),
  list: vi.fn(async (type: string) => {
    if (type === 'app') return [{ name: 'acme_app', label: 'Acme' }];
    if (type === 'object') return [{ name: 'showcase_task', label: 'Task' }];
    return [];
  }),
  listDrafts: vi.fn(async () => []),
  listTypes: vi.fn(async () => ({ entries: [] })),
  layered: vi.fn(async (type: string, name: string) => {
    if (type === 'app') return { effective: { name: 'acme_app', label: 'Acme', navigation: NAV } };
    if (type === 'object') return { effective: OBJECT_DEF, code: OBJECT_DEF };
    if (type === 'view' && name === DEFAULT_VIEW.name) {
      return { code: null, overlay: DEFAULT_VIEW, overlayScope: 'env', effective: DEFAULT_VIEW };
    }
    return { effective: { name } };
  }),
  getDraft: vi.fn(async () => null),
  get: vi.fn(async (type: string) => (type === 'object' ? OBJECT_DEF : undefined)),
  references: vi.fn(async () => []),
  withPreviewDrafts() {
    return this;
  },
};

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useMetadataClient: () => mockClient,
    useMetadataTypes: () => ({ loading: false, error: null, entries: [] }),
  };
});

vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useAdapter: () => ({}) };
});

vi.mock('../../components/SuggestedBindingsPanel', () => ({ SuggestedBindingsPanel: () => null }));
vi.mock('../metadata-admin/AccessExplainPanel', () => ({ AccessExplainPanel: () => null }));
vi.mock('../../preview/DraftChangesPanel', () => ({ DraftChangesPanel: () => null }));

vi.mock('./StudioAiCopilot', () => ({
  StudioChatDock: ({ onStatusChange }: { onStatusChange?: (s: { available: boolean; planPending: boolean }) => void }) => {
    React.useEffect(() => {
      onStatusChange?.({ available: true, planPending: false });
    }, [onStatusChange]);
    return <div data-testid="copilot-body">conversation</div>;
  },
}));

import { StudioDesignSurface } from './StudioDesignSurface';
import { registerStudioCanvasPreview, StudioObjectRecordsCanvas } from './studio-canvas-preview';
import { t, tFormat } from '../metadata-admin/i18n';

/** The real data table, as the object grid hands it columns: `accessorKey` is the field. */
function gridSchema(fields: string[]) {
  return {
    type: 'data-table',
    data: ROWS,
    pagination: false,
    columns: fields.map((field) => ({
      header: OBJECT_DEF.fields[field as keyof typeof OBJECT_DEF.fields]?.label ?? field,
      accessorKey: field,
    })),
  };
}

/**
 * Stands in for `plugin-view`'s `object-view`: the real data table, with the
 * columns of the view the canvas hands it, then `priority`, which the view
 * does not list.
 */
function ObjectViewGrid({ schema }: { schema: Record<string, unknown> }) {
  const views = (schema.listViews ?? {}) as Record<string, { columns?: Array<{ field: string }> }>;
  const listed = (views[String(schema.defaultListView)]?.columns ?? []).map((c) => c.field);
  return <SchemaRenderer schema={gridSchema([...listed, 'priority']) as never} />;
}

const METADATA: MetadataContextValue = {
  apps: [],
  objects: [OBJECT_DEF],
  dashboards: [],
  reports: [],
  pages: [],
  loading: false,
  error: null,
  refresh: async () => {},
  invalidate: () => {},
  ensureType: async () => [],
  getItem: async () => null,
  getItemsByType: () => [],
};

const answer = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

beforeAll(() => {
  ComponentRegistry.register('object-view', ObjectViewGrid as never, { namespace: 'plugin-view' });
});

beforeEach(() => {
  window.sessionStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) =>
      String(input) === '/api/v1/packages'
        ? answer({ success: true, data: { packages: [{ manifest: { id: PACKAGE_ID, name: 'Acme' }, writable: true }] } })
        : answer([]),
    ),
  );
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  registerStudioCanvasPreview('object', StudioObjectRecordsCanvas);
});

function renderSurface() {
  render(
    <MemoryRouter initialEntries={[`/studio/${PACKAGE_ID}/interfaces`]}>
      <MetadataCtx.Provider value={METADATA}>
        <Routes>
          <Route path="/studio/:packageId/:tab" element={<StudioDesignSurface />} />
        </Routes>
      </MetadataCtx.Provider>
    </MemoryRouter>,
  );
}

const slot = () => screen.getByTestId('studio-right-slot');
const slotProps = () => screen.getByTestId('studio-slot-props');
const canvas = () => screen.getByTestId('if-canvas-main');

/** The canvas's header cell for a column, by the label it draws. */
function header(label: string): HTMLElement {
  return within(canvas()).getByText(label, { selector: 'thead th span' }).closest('th') as HTMLElement;
}

/** The first column's values, top to bottom: the rows' drawn order. */
function drawnTitles(): string[] {
  return within(canvas())
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell')[0]?.textContent ?? '');
}

/** The panel's column rows that are pressed (selected), by their text. */
function selectedColumnRows(): string[] {
  const columns = within(slotProps()).getByTestId('list-view-columns');
  return within(columns)
    .queryAllByRole('button', { pressed: true })
    .map((row) => row.textContent ?? '');
}

/** The outline rule the canvas draws for its selected column, or `null`. */
function outlinedColumn(): string | null {
  const rule = within(canvas()).getByTestId('studio-canvas-columns').querySelector('style')?.textContent ?? '';
  return /data-column-key="([^"]+)"/.exec(rule)?.[1] ?? null;
}

async function openObjectLeaf() {
  renderSurface();
  fireEvent.click(await screen.findByTitle('object · showcase_task', undefined, { timeout: 4000 }));
  await waitFor(() => expect(within(slotProps()).getByTestId('list-view-columns')).toHaveTextContent('Status'), {
    timeout: 8000,
  });
  await waitFor(() => expect(header('Status')).toBeTruthy());
  await waitFor(() => expect(slot()).toHaveAttribute('data-mode', 'copilot'));
}

describe("a column header on an object leaf's canvas selects that column (objectui#12725)", () => {
  it('a click on a listed header switches the slot to 属性 with that column selected, and does not sort', async () => {
    await openObjectLeaf();
    expect(drawnTitles()).toEqual(['Bob', 'Ada', 'Cyd']);
    // While the copilot shows, the canvas says what a click does.
    expect(screen.getByTestId('if-canvas-hint')).toHaveTextContent(t('engine.studio.if.canvasHint.pick', 'en'));
    expect(selectedColumnRows()).toEqual([]);

    fireEvent.click(header('Status'));

    await waitFor(() => expect(slot()).toHaveAttribute('data-mode', 'props'));
    expect(within(slotProps()).getByTestId('studio-list-view-inspector')).toBeVisible();
    expect(selectedColumnRows()).toHaveLength(1);
    expect(selectedColumnRows()[0]).toContain('Status');
    expect(outlinedColumn()).toBe('status');
    expect(screen.getByTestId('if-canvas-hint')).toHaveTextContent(
      tFormat('engine.studio.if.canvasHint.selected', 'en', { label: 'Status' }),
    );
    // Selected, not sorted.
    expect(drawnTitles()).toEqual(['Bob', 'Ada', 'Cyd']);
    // The copilot stays, folded to the strip at the slot's foot.
    const strip = screen.getByTestId('studio-slot-copilot-strip');
    expect(slot().lastElementChild).toBe(strip);
    expect(screen.getByTestId('copilot-body')).not.toBeVisible();

    // Another listed header moves the selection; still no sort.
    fireEvent.click(header('Title'));
    await waitFor(() => expect(outlinedColumn()).toBe('title'));
    expect(selectedColumnRows()[0]).toContain('Title');
    expect(drawnTitles()).toEqual(['Bob', 'Ada', 'Cyd']);
  });

  it('Esc clears the column selection, and the slot keeps the view\'s properties', async () => {
    await openObjectLeaf();
    fireEvent.click(header('Status'));
    await waitFor(() => expect(outlinedColumn()).toBe('status'));

    fireEvent.keyDown(document.body, { key: 'Escape' });

    await waitFor(() => expect(outlinedColumn()).toBeNull());
    expect(selectedColumnRows()).toEqual([]);
    expect(slot()).toHaveAttribute('data-mode', 'props');
    expect(within(slotProps()).getByTestId('studio-list-view-inspector')).toBeVisible();
    // The status line no longer names a selection.
    expect(screen.queryByTestId('if-canvas-hint')).toBeNull();
  });

  it('a click on empty canvas clears the column selection', async () => {
    await openObjectLeaf();
    fireEvent.click(header('Title'));
    await waitFor(() => expect(outlinedColumn()).toBe('title'));

    // A click inside the grid is not empty canvas.
    fireEvent.click(within(canvas()).getByText('Ada'));
    expect(outlinedColumn()).toBe('title');

    fireEvent.click(canvas());

    await waitFor(() => expect(outlinedColumn()).toBeNull());
    expect(selectedColumnRows()).toEqual([]);
    expect(slot()).toHaveAttribute('data-mode', 'props');
  });

  it('a column picked in the panel is the one outlined on the canvas', async () => {
    await openObjectLeaf();
    const columns = within(slotProps()).getByTestId('list-view-columns');

    const titleRow = Array.from(columns.querySelectorAll<HTMLElement>('[role="button"][aria-pressed]')).find((row) =>
      row.textContent?.includes('Title'),
    );
    fireEvent.click(titleRow as HTMLElement);

    await waitFor(() => expect(outlinedColumn()).toBe('title'));
    expect(selectedColumnRows()[0]).toContain('Title');
  });

  it('a header the view does not list keeps the runtime click, which sorts', async () => {
    await openObjectLeaf();

    fireEvent.click(header('Priority'));

    await waitFor(() => expect(drawnTitles()).toEqual(['Cyd', 'Bob', 'Ada']));
    expect(outlinedColumn()).toBeNull();
    expect(selectedColumnRows()).toEqual([]);
    expect(slot()).toHaveAttribute('data-mode', 'copilot');
  });
});

describe('CONTROLS (objectui#12725)', () => {
  it('outside Studio, a header click on the data table sorts, and the header names its column', () => {
    render(<SchemaRenderer schema={gridSchema(['title', 'status']) as never} />);
    const th = screen.getByText('Status', { selector: 'thead th span' }).closest('th') as HTMLElement;
    expect(th).toHaveAttribute('data-column-key', 'status');
    const titles = () =>
      screen
        .getAllByRole('row')
        .slice(1)
        .map((row) => within(row).getAllByRole('cell')[0]?.textContent ?? '');
    expect(titles()).toEqual(['Bob', 'Ada', 'Cyd']);

    fireEvent.click(screen.getByText('Title', { selector: 'thead th span' }).closest('th') as HTMLElement);

    expect(titles()).toEqual(['Ada', 'Bob', 'Cyd']);
  });

  it('a canvas registered over the default gets no channel: its headers sort and the slot keeps the copilot', async () => {
    function CustomObjectCanvas() {
      return <SchemaRenderer schema={gridSchema(['title', 'status']) as never} />;
    }
    registerStudioCanvasPreview('object', CustomObjectCanvas);
    renderSurface();
    fireEvent.click(await screen.findByTitle('object · showcase_task', undefined, { timeout: 4000 }));
    await waitFor(() => expect(within(slotProps()).getByTestId('list-view-columns')).toHaveTextContent('Status'), {
      timeout: 8000,
    });
    await waitFor(() => expect(slot()).toHaveAttribute('data-mode', 'copilot'));
    expect(within(canvas()).queryByTestId('studio-canvas-columns')).toBeNull();
    // Nor does the canvas promise a click it cannot answer.
    expect(screen.queryByTestId('if-canvas-hint')).toBeNull();

    fireEvent.click(header('Title'));

    await waitFor(() => expect(drawnTitles()).toEqual(['Ada', 'Bob', 'Cyd']));
    expect(slot()).toHaveAttribute('data-mode', 'copilot');
    expect(selectedColumnRows()).toEqual([]);
  });
});
