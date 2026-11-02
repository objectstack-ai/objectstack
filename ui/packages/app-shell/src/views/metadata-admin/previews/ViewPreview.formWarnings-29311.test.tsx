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
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { SchemaRendererProvider } from '@object-ui/react';
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
