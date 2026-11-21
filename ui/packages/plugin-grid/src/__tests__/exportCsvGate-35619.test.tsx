/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#35619 — the object's `userActions.exportCsv: false` hides the
 * grid's export entries: the toolbar's Export menu (every format) and the
 * table's own CSV button that `operations.export: true` turns on. Both read
 * the object's resolved export verdict, `resolveEffectiveCrudAffordances`'s
 * `exportCsv`, which is the authored bit over the `managedBy` default ANDed
 * with the server's effective `export` operation.
 *
 * The verdict is read off the object definition the grid fetches, so every
 * case waits for the first row to draw: an untyped column is withheld until
 * that definition lands, so a drawn row means the verdict is the settled one.
 * The CONTROLS render the same grid over an object that does not author the
 * key, and over one that authors `true`, and find both entries — the probe
 * can see them, so the absence below is a reading and not a blind instrument.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { ObjectGrid } from '../ObjectGrid';
import { __clearRecordCrudVerdictCache } from '../hooks/useRecordCrudVerdicts';
import { installExplainDouble } from './explainDouble';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider, SchemaRendererProvider } from '@object-ui/react';
import type { DataSource, ObjectGridSchema } from '@object-ui/types';

registerAllFields();

const ROWS = [
  { id: '1', name: 'Alice' },
  { id: '2', name: 'Bob' },
];

async function renderGrid(userActions?: Record<string, unknown>) {
  const getObjectSchema = vi.fn(async (name: string) => ({
    name,
    fields: { id: { type: 'text' }, name: { type: 'text', label: 'Name' } },
    ...(userActions ? { userActions } : {}),
  }));
  // Only the definition read is answered: the rows are inline.
  const dataSource = { getObjectSchema } as unknown as DataSource;
  const schema = {
    type: 'object-grid',
    objectName: 'test_object',
    columns: [{ field: 'name', label: 'Name' }],
    data: { provider: 'value', items: ROWS },
    exportOptions: { formats: ['csv', 'json'] },
    // Turns on the table's own CSV button beside the toolbar menu.
    operations: { export: true },
  } as unknown as ObjectGridSchema;
  render(
    <ActionProvider>
      <SchemaRendererProvider dataSource={dataSource}>
        <ObjectGrid schema={schema} dataSource={dataSource} />
      </SchemaRendererProvider>
    </ActionProvider>,
  );
  await waitFor(() => expect(getObjectSchema).toHaveBeenCalledWith('test_object'));
  await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());
}

const toolbarExport = () => screen.queryByRole('button', { name: /^export$/i });
const tableCsvExport = () => screen.queryByRole('button', { name: /^export csv$/i });

beforeEach(() => {
  __clearRecordCrudVerdictCache();
  installExplainDouble();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ObjectGrid — userActions.exportCsv gates every export entry (objectstack#35619)', () => {
  it('exportCsv false: no toolbar Export menu and no table CSV button', async () => {
    await renderGrid({ exportCsv: false });
    expect(toolbarExport()).toBeNull();
    expect(tableCsvExport()).toBeNull();
  });

  it('CONTROL: an object that does not author exportCsv keeps both entries', async () => {
    await renderGrid();
    expect(toolbarExport()).toBeInTheDocument();
    expect(tableCsvExport()).toBeInTheDocument();
  });

  it('CONTROL: exportCsv true keeps both entries', async () => {
    await renderGrid({ exportCsv: true });
    expect(toolbarExport()).toBeInTheDocument();
    expect(tableCsvExport()).toBeInTheDocument();
  });

  it('a closing userActions on another verb leaves export open', async () => {
    // The bit is read on its own: closing edit and delete is no export verdict.
    await renderGrid({ edit: false, delete: false });
    expect(toolbarExport()).toBeInTheDocument();
  });
});
