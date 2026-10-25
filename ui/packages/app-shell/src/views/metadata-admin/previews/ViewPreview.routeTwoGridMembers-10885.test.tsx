// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#10885 member 1 — the Studio view preview shows a stored grid view's
 * own grid members.
 *
 * `ViewPreview` injects the stored view body as a named `listViews` entry and
 * renders it through `SchemaRenderer`, which resolves the REGISTERED
 * `object-view` renderer: `ObjectView` with no `renderListView`, so a grid view
 * lands on route 2, the `object-grid` node `ObjectView` hands `ObjectGrid`.
 * Before this card that node read `columns`, `filter`, `sort`, `grouping` and
 * `rowColor` off the named view and nothing else, so a stored view's
 * `rowHeight` and `hiddenFields` were accepted and dropped from the preview.
 *
 * Everything here is the real stack: the real `ViewPreview`, the real
 * `SchemaRenderer` and registry, the registered `object-view` renderer and the
 * real `ObjectGrid`. The readings are the rendered DOM.
 *
 *   - `rowHeight` — `ObjectGrid` draws its row-height control only when its
 *     node carries `rowHeight`, titled with the resolved mode.
 *   - `hiddenFields` — the protocol's column composition: `columns` projects
 *     and `hiddenFields` subtracts. The hidden column's header is not drawn.
 *   - Lit control — `columns` off the SAME named view was already honoured on
 *     route 2: a field the view does not project is not drawn, and a projected
 *     one is.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { SchemaRendererProvider } from '@object-ui/react';
// Module scope, not a hook: this import IS the `object-view` registration the
// preview's `SchemaRenderer` resolves.
import '@object-ui/plugin-view';
import { ViewPreview } from './ViewPreview';

const objectDef = {
  name: 'task',
  label: 'Task',
  fields: {
    name: { name: 'name', type: 'text', label: 'Task Name' },
    amount: { name: 'amount', type: 'number', label: 'Budget Amount' },
    stage: { name: 'stage', type: 'text', label: 'Pipeline Stage' },
    owner: { name: 'owner', type: 'text', label: 'Record Owner' },
  },
};

function createDataSource(): any {
  return {
    find: vi.fn(async () => ({
      data: [{ id: 't1', name: 'Alpha', amount: 5, stage: 'open', owner: 'ada' }],
      total: 1,
    })),
    findOne: vi.fn(async () => null),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
    getObjectSchema: vi.fn(async () => objectDef),
  };
}

/**
 * The host's authenticated fetch. `ObjectGrid` asks the explain engine for its
 * per-row edit and delete verdicts through it; a 501 is the engine's
 * "not implemented", which the grid reads fail-open. Handed in through the
 * provider, as the console does, so no read reaches a real socket.
 */
const apiFetch = vi.fn(async () => new Response(null, { status: 501 }));

/** Mount the Studio preview of one stored grid view, the way the editor does. */
function renderPreview(config: Record<string, unknown>) {
  render(
    <SchemaRendererProvider dataSource={createDataSource()} apiFetch={apiFetch}>
      <ViewPreview
        type="view"
        name="all_tasks"
        draft={{ name: 'task.all_tasks', object: 'task', viewKind: 'list', config }}
      />
    </SchemaRendererProvider>,
  );
}

/** The grid has drawn its headers from the object schema. */
async function gridDrawn() {
  await waitFor(() => expect(screen.getAllByText('Task Name').length).toBeGreaterThan(0));
}

afterEach(() => cleanup());

describe('objectui#10885 — the Studio view preview honours a stored grid view\'s grid members', () => {
  it('LIT CONTROL: the named view\'s `columns` projects the grid on route 2 already', async () => {
    renderPreview({ type: 'grid', columns: ['name', 'stage'] });
    await gridDrawn();
    expect(screen.getAllByText('Pipeline Stage').length).toBeGreaterThan(0);
    expect(screen.queryByText('Record Owner')).toBeNull();
  });

  it('`hiddenFields` subtracts from the projected columns — the hidden header is not drawn', async () => {
    renderPreview({ type: 'grid', columns: ['name', 'amount', 'stage'], hiddenFields: ['amount'] });
    await gridDrawn();
    expect(screen.getAllByText('Pipeline Stage').length).toBeGreaterThan(0);
    expect(screen.queryByText('Budget Amount')).toBeNull();
  });

  it('`rowHeight` reaches the grid — its row-height control is drawn in the stored mode', async () => {
    renderPreview({ type: 'grid', columns: ['name', 'stage'], rowHeight: 'compact' });
    await gridDrawn();
    expect(screen.getByTitle('Row height: compact')).toBeTruthy();
  });

  it('CONTROL: a stored view that declares neither draws every projected column and no row-height control', async () => {
    renderPreview({ type: 'grid', columns: ['name', 'amount', 'stage'] });
    await gridDrawn();
    expect(screen.getAllByText('Budget Amount').length).toBeGreaterThan(0);
    expect(screen.queryByTitle(/^Row height:/)).toBeNull();
  });
});
