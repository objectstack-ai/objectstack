// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#29311 — the Studio form view canvas shows the view's served
 * warnings at the section they point into.
 *
 * Since objectstack#29196 the view read adds the lint's `form-field-unknown`
 * finding to `_diagnostics.warnings` (`{ path, message }`, the path
 * item-relative: `config.sections.0.fields.1`). The editors hand a canvas its
 * verdict through the preview contract's `diagnostics`; `ViewPreview`'s form
 * route ignored it, so an author designing a form never saw that a section
 * names a field its object lacks.
 *
 * The cases:
 *   - a warning into a section is shown with that section's authored label
 *     and the server's message as served, under the existing warn-block
 *     heading;
 *   - a section with no label is named by its `name`; a path into no section
 *     is shown as the server wrote it;
 *   - no warnings (an empty list, or none passed) draws no block;
 *   - errors are not this block's: an error-only list draws none.
 *
 * objectstack#31938 — the list branch (the last `describe`): since
 * objectstack#31866 the read adds `list-view-field-unknown` for a column naming
 * a field its object lacks (`config.columns.1.field`). The list canvas drew
 * none of it, and its own query was refused for that column. The block now
 * names each column, and a warning on a column holds the canvas, so the
 * refusal is not drawn a second time.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { SchemaRendererProvider } from '@object-ui/react';
// Module scope, not a hook: this import IS the `object-view` registration the
// list branch's canvas resolves (the last `describe`).
import '@object-ui/plugin-view';
import type { DataSource } from '@object-ui/types';
import { ViewPreview } from './ViewPreview';
import type { MetadataPreviewProps } from '../preview-registry';

afterEach(cleanup);

/** A stub adapter: the form route asks for the object, nothing else. */
function createDataSource(): DataSource {
  return {
    find: vi.fn(async () => ({ data: [], total: 0 })),
    findOne: vi.fn(async () => null),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
    getObjectSchema: vi.fn(async () => ({ name: 'task', fields: { title: { name: 'title', type: 'text' } } })),
  } as unknown as DataSource;
}

/** The lint's wording, as the server serves it (objectstack#29196). */
const MESSAGE =
  'task.form: field "no_such_field" is not a field on object "task" — it is silently skipped and never renders on the form';

const formView = {
  name: 'task.form',
  object: 'task',
  viewKind: 'form',
  label: 'Task intake',
  config: {
    type: 'simple',
    sections: [
      { name: 'overview', label: 'Overview', fields: ['title', 'no_such_field'] },
      { name: 'details', fields: [{ field: 'no_such_field_2' }] },
    ],
  },
};

function renderForm(diagnostics: MetadataPreviewProps['diagnostics']) {
  render(
    <SchemaRendererProvider dataSource={createDataSource()}>
      <ViewPreview type="view" name="task.form" draft={formView} locale="en-US" diagnostics={diagnostics} />
    </SchemaRendererProvider>,
  );
}

const items = () => screen.queryAllByTestId('view-form-warning');

describe('objectstack#29311 — the form view canvas shows its served warnings', () => {
  it('a warning into a section names the section by its label, with the server message as served', () => {
    renderForm([{ path: 'config.sections.0.fields.1', message: MESSAGE, severity: 'warning' }]);
    const block = screen.getByTestId('view-form-warnings');
    expect(block).toHaveTextContent('1 warning(s)');
    expect(items()).toHaveLength(1);
    expect(items()[0].textContent).toBe(`Overview: ${MESSAGE}`);
    expect(items()[0].getAttribute('data-path')).toBe('config.sections.0.fields.1');
  });

  it('a label-less section is named by its name; a path into no section is shown as written', () => {
    renderForm([
      { path: 'config.sections.1.fields.0', message: 'second', severity: 'warning' },
      { path: 'config.type', message: 'third', severity: 'warning' },
    ]);
    expect(items().map((li) => li.textContent)).toEqual(['details: second', 'config.type: third']);
  });

  it('no warnings, no block: an empty list and an absent one alike', () => {
    renderForm([]);
    expect(screen.queryByTestId('view-form-warnings')).toBeNull();
    cleanup();
    renderForm(undefined);
    expect(screen.queryByTestId('view-form-warnings')).toBeNull();
    // The form route itself is up: its heading is drawn.
    expect(screen.getByRole('heading', { name: 'Task intake' })).toBeTruthy();
  });

  it('errors are not this block\'s: an error-only list draws none', () => {
    renderForm([{ path: 'config.sections.0', message: 'refused', severity: 'error' }]);
    expect(screen.queryByTestId('view-form-warnings')).toBeNull();
  });
});


// ---------------------------------------------------------------------------
// objectstack#31938 — the list branch
// ---------------------------------------------------------------------------

/** The card's object: it declares `total_cost`; the shipped view names `cost_total`. */
const aiTraces = {
  name: 'ai_traces',
  label: 'AI Traces',
  fields: {
    model: { name: 'model', type: 'text', label: 'Model' },
    total_cost: { name: 'total_cost', type: 'number', label: 'Total Cost' },
  },
};

/** A server sentence, as served. The block shows it verbatim and nothing parses it. */
const COLUMN_MESSAGE = 'field "cost_total" does not exist on object "ai_traces". Did you mean "total_cost"?';

function createListDataSource() {
  return {
    find: vi.fn(async () => ({ data: [{ id: 'r1', model: 'm1', total_cost: 2 }], total: 1 })),
    findOne: vi.fn(async () => null),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
    getObjectSchema: vi.fn(async () => aiTraces),
  };
}

/** The host's authenticated fetch; a 501 is the explain engine's "not implemented", read fail-open. */
const apiFetch = vi.fn(async () => new Response(null, { status: 501 }));

function renderList(columns: unknown[], diagnostics: MetadataPreviewProps['diagnostics']) {
  const dataSource = createListDataSource();
  render(
    <SchemaRendererProvider dataSource={dataSource as unknown as DataSource} apiFetch={apiFetch}>
      <ViewPreview
        type="view"
        name="ai_traces.all"
        draft={{ name: 'ai_traces.all', object: 'ai_traces', viewKind: 'list', config: { type: 'grid', columns } }}
        locale="en-US"
        diagnostics={diagnostics}
      />
    </SchemaRendererProvider>,
  );
  return dataSource;
}

const listItems = () => screen.queryAllByTestId('view-list-warning');

/** Let every effect a mounted canvas would run settle, so "never asked" is a reading. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

describe('objectstack#31938 — the list view canvas shows its served column warnings and holds its refused query', () => {
  it('the cost_total reproduction: the column is named by its label, and the canvas is held', async () => {
    const dataSource = renderList(
      [{ field: 'model', label: 'Model' }, { field: 'cost_total', label: 'Cost' }],
      [{ path: 'config.columns.1.field', message: COLUMN_MESSAGE, severity: 'warning' }],
    );
    expect(screen.getByTestId('view-list-warnings')).toHaveTextContent('1 warning(s)');
    expect(listItems().map((li) => li.textContent)).toEqual([`Cost: ${COLUMN_MESSAGE}`]);
    expect(listItems()[0].getAttribute('data-path')).toBe('config.columns.1.field');
    expect(screen.getByTestId('view-list-preview-held')).toHaveTextContent('The list preview is held');
    await settle();
    // The canvas is not mounted: no query that the server would refuse is sent.
    expect(dataSource.find).not.toHaveBeenCalled();
    expect(dataSource.getObjectSchema).not.toHaveBeenCalled();
  });

  it('a bare-string column is named by its field, and holds the canvas too', async () => {
    const dataSource = renderList(
      ['model', 'cost_total'],
      [{ path: 'config.columns.1', message: COLUMN_MESSAGE, severity: 'warning' }],
    );
    expect(listItems().map((li) => li.textContent)).toEqual([`cost_total: ${COLUMN_MESSAGE}`]);
    expect(screen.getByTestId('view-list-preview-held')).toBeTruthy();
    await settle();
    expect(dataSource.find).not.toHaveBeenCalled();
  });

  it('a warning off the columns draws above a mounted canvas: a position nested in a column is not its field', async () => {
    const dataSource = renderList(
      ['model'],
      [
        { path: 'config.columns.0.summary.field', message: 'nested', severity: 'warning' },
        { path: 'config.rowColor.field', message: 'row colour', severity: 'warning' },
      ],
    );
    expect(listItems().map((li) => li.textContent)).toEqual([
      'config.columns.0.summary.field: nested',
      'config.rowColor.field: row colour',
    ]);
    expect(screen.queryByTestId('view-list-preview-held')).toBeNull();
    await waitFor(() => expect(dataSource.find).toHaveBeenCalled());
  });

  it('CONTROL: no warning draws no block, and the canvas mounts and queries as before', async () => {
    const dataSource = renderList(['model', 'total_cost'], undefined);
    expect(screen.queryByTestId('view-list-warnings')).toBeNull();
    expect(screen.queryByTestId('view-list-preview-held')).toBeNull();
    await waitFor(() => expect(dataSource.find).toHaveBeenCalled());
  });

  it('CONTROL: an error on a column is not this block\'s and holds nothing', async () => {
    const dataSource = renderList(
      ['model', 'cost_total'],
      [{ path: 'config.columns.1', message: 'refused', severity: 'error' }],
    );
    expect(screen.queryByTestId('view-list-warnings')).toBeNull();
    await waitFor(() => expect(dataSource.find).toHaveBeenCalled());
  });
});
