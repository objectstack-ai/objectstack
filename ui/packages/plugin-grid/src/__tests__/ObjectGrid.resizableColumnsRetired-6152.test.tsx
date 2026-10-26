/**
 * objectui#6152 round 7 — `ObjectGrid` reads `resizable` alone.
 *
 * `resizableColumns` was the legacy second spelling of `resizable`, read only when
 * `resizable` was absent (`schema.resizable ?? schema.resizableColumns ?? true`). It is
 * retired on both faces of `@object-ui/types` and by `@objectstack/spec` 17.7.0, which
 * refuses it in the `object-grid` row, so the fallback read went in the same change:
 * a node that still carries the old spelling (one composed in code, past the type)
 * gets the default, resizable columns, exactly as if it had written nothing.
 *
 * Observed in the DOM: each resizable header cell draws one `.cursor-col-resize` drag
 * handle (`data-table`'s own markup, the one `columnStatePersistence.test.tsx` drags).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import type { ObjectGridSchema } from '@object-ui/types';

import { ObjectGrid } from '../ObjectGrid';
import { __clearRecordCrudVerdictCache } from '../hooks/useRecordCrudVerdicts';
import { installExplainDouble } from './explainDouble';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider } from '@object-ui/react';

registerAllFields();

beforeEach(() => {
  __clearRecordCrudVerdictCache();
  installExplainDouble();
  localStorage.clear();
});

const rows = [
  { id: '1', name: 'Alice', amount: 100 },
  { id: '2', name: 'Bob', amount: 200 },
];

/** Render a two-column grid and count the header resize handles it draws. */
async function resizeHandles(extra: Record<string, unknown>): Promise<number> {
  // Cast through `unknown`: the retired spelling is a `tsc` error on `ObjectGridSchema`
  // now, and this writes it on purpose, as a node composed past the type would.
  const schema = {
    type: 'object-grid',
    objectName: 'test_object',
    columns: [
      { field: 'name', label: 'Name' },
      { field: 'amount', label: 'Amount', type: 'number' },
    ],
    data: { provider: 'value', items: rows },
    ...extra,
  } as unknown as ObjectGridSchema;
  const { container, unmount } = render(
    <ActionProvider>
      <ObjectGrid schema={schema} />
    </ActionProvider>,
  );
  await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());
  const count = container.querySelectorAll('th .cursor-col-resize').length;
  unmount();
  return count;
}

describe('objectui#6152 round 7 — `ObjectGrid` no longer reads `resizableColumns`', () => {
  it('CONTROL: with neither key, both columns draw a resize handle (on by default)', async () => {
    expect(await resizeHandles({})).toBe(2);
  });

  it('LIT CONTROL: `resizable: false` turns the handles off, so the count can move', async () => {
    expect(await resizeHandles({ resizable: false })).toBe(0);
  });

  it('`resizableColumns: false` alone is not read: the grid keeps its default handles', async () => {
    expect(await resizeHandles({ resizableColumns: false })).toBe(2);
  });

  it('`resizable: false` still wins when the retired spelling says otherwise', async () => {
    expect(await resizeHandles({ resizable: false, resizableColumns: true })).toBe(0);
  });
});
