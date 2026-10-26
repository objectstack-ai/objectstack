// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11823 (step 1) — an `object` leaf's Properties panel edits the list
 * view its canvas shows: columns, filter and sort, saved to the package draft.
 *
 * Pinned here, through the mounted Interfaces pillar:
 *
 *  - the panel of an `object` leaf shows Columns, Filter and Sort, and no
 *    longer the studio-canvas "nothing here is edited" statement;
 *  - an edit writes the view item to the package draft through the metadata
 *    draft door, and what it writes parses with the spec's `ViewItemSchema`;
 *  - the canvas beside it (the real `StudioObjectRecordsCanvas`, with a
 *    recorder standing in for `object-view`) is handed the edited view;
 *  - a view that does not exist yet is created by the first edit, at
 *    `<object>.default`, seeded with the running app's default columns,
 *    which the canvas shows until then;
 *  - a read-only package shows the panel read-only and writes nothing;
 *  - CONTROL: a studio-canvas leaf of another type keeps the statement.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ComponentRegistry } from '@object-ui/core';
import { MetadataCtx, type MetadataContextValue } from '@object-ui/react';
import { ViewItemSchema } from '@objectstack/spec/ui';

const OBJECT_DEF = {
  name: 'showcase_task',
  label: 'Task',
  fields: {
    title: { name: 'title', label: 'Title', type: 'text' },
    status: { name: 'status', label: 'Status', type: 'text' },
    priority: { name: 'priority', label: 'Priority', type: 'number' },
  },
};

const NAV = [
  { id: 'nav_obj', type: 'object', label: 'Tasks', objectName: 'showcase_task' },
  { id: 'nav_report', type: 'report', label: 'Pipeline', reportName: 'pipeline_report' },
];

/** The object's default list view, as a 17.7.0 server serves it (a ViewItem record). */
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
    filter: [{ field: 'status', operator: 'equals', value: 'open' }],
  },
};

let views: Record<string, Record<string, unknown>> = {};

const mockClient = {
  save: vi.fn(async (..._args: unknown[]) => ({ success: true, version: 'v1', state: 'draft' })),
  list: vi.fn(async (type: string) => {
    if (type === 'app') return [{ name: 'acme_app', label: 'Acme' }];
    if (type === 'object') return [{ name: 'showcase_task', label: 'Task' }];
    return [];
  }),
  listDrafts: vi.fn(async () => []),
  layered: vi.fn(async (type: string, name: string) => {
    if (type === 'app') return { effective: { name: 'acme_app', label: 'Acme', navigation: NAV } };
    if (type === 'object') return { effective: OBJECT_DEF, code: OBJECT_DEF };
    if (type === 'view') {
      const row = views[name];
      return row ? { code: null, overlay: row, overlayScope: 'env', effective: row } : { code: null, overlay: null, overlayScope: null, effective: null };
    }
    return { effective: { name } };
  }),
  getDraft: vi.fn(async () => null),
  get: vi.fn(async (type: string) => (type === 'object' ? OBJECT_DEF : undefined)),
  withPreviewDrafts() { return this; },
};

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
  return { ...mod, useAdapter: () => ({}) };
});

import { InterfacesPillar } from './StudioDesignSurface';
import { registerStudioCanvasPreview } from './studio-canvas-preview';
import { t } from '../metadata-admin/i18n';

/** Stands in for `plugin-view`'s `object-view`, recording the schema the canvas hands it. */
function ObjectViewRecorder({ schema }: { schema: Record<string, unknown> }) {
  return <pre data-testid="object-view-schema">{JSON.stringify(schema)}</pre>;
}

/** A studio canvas for a type other than `object`: the control leaf. */
function StubReportCanvas() {
  return <div data-testid="stub-report-canvas" />;
}
registerStudioCanvasPreview('report', StubReportCanvas);

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

beforeAll(() => {
  ComponentRegistry.register('object-view', ObjectViewRecorder as never, { namespace: 'plugin-view' });
});
beforeEach(() => {
  views = { 'showcase_task.default': DEFAULT_VIEW };
  mockClient.save.mockClear();
});
afterEach(cleanup);

function mountPillar(readOnly = false) {
  return render(
    <MemoryRouter initialEntries={['/studio/com.acme.app/interfaces']}>
      <MetadataCtx.Provider value={METADATA}>
        <InterfacesPillar packageId="com.acme.app" readOnly={readOnly} />
      </MetadataCtx.Provider>
    </MemoryRouter>,
  );
}

async function openObjectLeaf(readOnly = false) {
  mountPillar(readOnly);
  fireEvent.click(await screen.findByTitle('object · showcase_task'));
  return screen.findByTestId('studio-list-view-inspector', undefined, { timeout: 8000 });
}

const NO_BLOCKS = 'This canvas renders the running app, not a block tree';

function canvasSchema(): Record<string, unknown> {
  return JSON.parse(screen.getByTestId('object-view-schema').textContent ?? 'null');
}

function viewSaves(): Array<[string, string, Record<string, unknown>, Record<string, unknown>]> {
  return mockClient.save.mock.calls.filter((c) => c[0] === 'view') as never;
}

async function addSortOnFirstField(panel: HTMLElement) {
  fireEvent.click(within(panel).getByTestId('list-view-sort-trigger'));
  fireEvent.click(await screen.findByRole('button', { name: /Add sort/ }));
}

describe('an object leaf\'s Properties panel edits its list view (objectui#11823)', () => {
  it('shows Columns, Filter and Sort for the view the canvas shows, and not the no-blocks statement', async () => {
    const panel = await openObjectLeaf();

    await waitFor(() => expect(within(panel).getByTestId('list-view-columns')).toHaveTextContent('Columns'));
    expect(within(panel).getByTestId('list-view-filter')).toHaveTextContent('Filter');
    expect(within(panel).getByTestId('list-view-sort')).toHaveTextContent('Sort');
    // The loaded view: its two columns, and its filter summarised by field.
    expect(within(panel).getByTestId('list-view-columns')).toHaveTextContent('title');
    expect(within(panel).getByTestId('list-view-columns')).toHaveTextContent('status');
    expect(within(panel).getByTestId('filter-builder-trigger')).toHaveTextContent('Status');
    expect(document.body.textContent).not.toContain(NO_BLOCKS);
  });

  it('writes an edit to the package draft as a spec-valid view item, and the canvas shows it', async () => {
    const panel = await openObjectLeaf();
    await waitFor(() => expect(within(panel).getByTestId('list-view-columns')).toHaveTextContent('status'));

    // objectui#12693 — the row, and so its remove control, is named by the field's label.
    fireEvent.click(within(panel).getByRole('button', { name: 'Remove Status' }));
    await addSortOnFirstField(panel);

    await waitFor(() => expect(viewSaves().length).toBeGreaterThan(0), { timeout: 8000 });
    const [, name, body] = viewSaves().at(-1)!;
    expect(name).toBe('showcase_task.default');
    // objectui#11773 — the view had no pending draft when the panel loaded it,
    // so its first save is the first-write pin; a later one is pinned to the
    // receipt before it.
    const sentOptions = viewSaves().map((call) => call[3]);
    expect(sentOptions[0]).toEqual({ mode: 'draft', packageId: 'com.acme.app', ifNoneMatch: '*', surface: 'studio' });
    for (const later of sentOptions.slice(1)) {
      expect(later).toEqual({ mode: 'draft', packageId: 'com.acme.app', ifMatch: 'v1', surface: 'studio' });
    }
    const parsed = ViewItemSchema.safeParse(body);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect(body).toMatchObject({
      name: 'showcase_task.default',
      object: 'showcase_task',
      viewKind: 'list',
      isDefault: true,
      config: {
        columns: [{ field: 'title' }],
        // The loaded filter rides along untouched.
        filter: [{ field: 'status', operator: 'equals', value: 'open' }],
        sort: [{ field: 'title', order: 'asc' }],
      },
    });

    // Preview = runtime: the canvas is handed the edited view, opened.
    const schema = canvasSchema();
    expect(schema.defaultListView).toBe('showcase_task.default');
    expect((schema.listViews as Record<string, Record<string, unknown>>)['showcase_task.default']).toMatchObject({
      columns: [{ field: 'title' }],
      sort: [{ field: 'title', order: 'asc' }],
    });
  });

  it('creates a view the object does not have yet at the first edit, seeded with the default columns', async () => {
    views = {};
    const panel = await openObjectLeaf();
    // objectui#13151 — the notice names the view by the object's label and its
    // role (the object is "Task", its nav entry "Tasks"), never `<object>.<key>`.
    await waitFor(() => expect(within(panel).getByTestId('list-view-not-created')).toHaveTextContent('“Task · Default view”'));
    expect(within(panel).getByTestId('list-view-not-created')).not.toHaveTextContent('showcase_task.default');
    // Nothing is saved yet, and the canvas shows the list the running app
    // shows an object with no view: its default columns.
    await waitFor(() => expect(canvasSchema().defaultListView).toBe('showcase_task.default'));
    expect((canvasSchema().listViews as Record<string, unknown>)['showcase_task.default']).toEqual({
      type: 'grid',
      data: { provider: 'object', object: 'showcase_task' },
      columns: ['title', 'status', 'priority'],
    });
    expect(viewSaves()).toEqual([]);

    await addSortOnFirstField(panel);

    await waitFor(() => expect(viewSaves().length).toBeGreaterThan(0), { timeout: 8000 });
    const [, name, body] = viewSaves().at(-1)!;
    expect(name).toBe('showcase_task.default');
    const parsed = ViewItemSchema.safeParse(body);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect(body).toEqual({
      name: 'showcase_task.default',
      object: 'showcase_task',
      viewKind: 'list',
      isDefault: true,
      config: {
        type: 'grid',
        data: { provider: 'object', object: 'showcase_task' },
        columns: ['title', 'status', 'priority'],
        sort: [{ field: 'title', order: 'asc' }],
      },
    });
  });

  it('shows the panel read-only on a read-only package, and writes nothing', async () => {
    const panel = await openObjectLeaf(true);
    await waitFor(() => expect(within(panel).getByTestId('list-view-columns')).toHaveTextContent('status'));

    expect(within(panel).getByTestId('list-view-read-only')).toBeInTheDocument();
    // objectui#12693 — the name the remove control would carry is the field's label.
    expect(within(panel).queryByRole('button', { name: 'Remove Status' })).not.toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: /Add field/ })).not.toBeInTheDocument();
    expect(within(panel).getByTestId('filter-builder-trigger')).toBeDisabled();
    expect(within(panel).getByTestId('list-view-sort-trigger')).toBeDisabled();

    fireEvent.click(within(panel).getByTestId('list-view-sort-trigger'));
    await new Promise((r) => setTimeout(r, 2500));
    expect(viewSaves()).toEqual([]);
  });

  it('a refused save is said in the panel, as the pillar says a refusal: a sentence over its raw text', async () => {
    const refusal = Object.assign(new Error('view/showcase_task.default failed spec validation: 1 issue'), {
      status: 422,
      code: 'INVALID_METADATA',
      issues: [{ path: 'config.sort.0.order', message: 'Invalid option', code: 'invalid_value' }],
    });
    mockClient.save.mockRejectedValueOnce(refusal);
    const panel = await openObjectLeaf();
    await waitFor(() => expect(within(panel).getByTestId('list-view-columns')).toHaveTextContent('status'));
    await addSortOnFirstField(panel);

    const strip = await within(panel).findByTestId('list-view-refusal', undefined, { timeout: 8000 });
    expect(strip).toHaveTextContent(t('engine.studio.refusal.unlocated', 'en'));
    expect(within(strip).getByText('Details')).toBeInTheDocument();
    // The raw refusal (its issue paths) stays behind the disclosure.
    expect(strip).toHaveTextContent('config.sort.0.order');
  });

  it('a form view at the view\'s name is shown as such, never edited, and the canvas keeps its own copy', async () => {
    views = {
      'showcase_task.default': {
        name: 'showcase_task.default',
        object: 'showcase_task',
        viewKind: 'form',
        config: { type: 'simple', sections: [] },
      },
    };
    const panel = await openObjectLeaf();
    await waitFor(() => expect(within(panel).getByTestId('list-view-not-list')).toHaveTextContent('“Task · Default view”'));
    expect(within(panel).getByTestId('list-view-not-list')).not.toHaveTextContent('showcase_task.default');
    expect(within(panel).queryByTestId('list-view-columns')).not.toBeInTheDocument();
    expect(canvasSchema()).toEqual({ type: 'object-view', objectName: 'showcase_task' });
    await new Promise((r) => setTimeout(r, 2000));
    expect(viewSaves()).toEqual([]);
  });

  it('CONTROL: a studio-canvas leaf of another type still says nothing is edited from its panel', async () => {
    mountPillar();
    fireEvent.click(await screen.findByTitle('report · pipeline_report'));
    await screen.findByTestId('stub-report-canvas', undefined, { timeout: 8000 });

    await waitFor(() => expect(document.body.textContent).toContain(NO_BLOCKS));
    expect(screen.queryByTestId('studio-list-view-inspector')).not.toBeInTheDocument();
  });
});
