/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * ObjectGrid persisted column width — the INBOUND half (objectui#6457).
 *
 * ⚠️ This file exists because the OUTBOUND half was already pinned and the bug
 * shipped anyway. `columnStatePersistence.test.tsx` asserts that a resize is
 * written to localStorage and reported to the host, and its own docblock warns
 * that it "deliberately observe[s] the WRITE, never the read-back". That is
 * exactly the wrong half for this defect: the write was correct, and the value
 * came back correctly — `persistedColumns` then stamped it onto the column as
 * `size`, a key nothing downstream reads. `TableColumn` declares `width`, and
 * `data-table` resolves every column's width as
 * `columnWidths[accessorKey] || col.width || autoSizedWidths[accessorKey]`.
 * So an outbound assertion PASSES on the broken code — the write is what was
 * wrong — and the user-visible symptom (resize a column, reload, the width is
 * gone) was invisible to the suite.
 *
 * ⭐ Every case here therefore starts from a value that is ALREADY persisted
 * and ends at the RENDERED column: `style.width` on the header cell in the
 * DOM, which is the last hop the key has to survive. Nothing here observes the
 * write.
 *
 * The seeded widths (321, 277) are deliberately unreachable by `data-table`'s
 * auto-size heuristic, which only ever yields `min(400, max(80, maxLen*8+48))`
 * — i.e. 80, 400, or a value ≡ 48 (mod 8). Neither 321−48=273 nor 277−48=229
 * is divisible by 8, so a matching assertion cannot be satisfied by the
 * fallback that runs when the persisted width is dropped.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { ObjectGrid } from '../ObjectGrid';
import { __clearRecordCrudVerdictCache } from '../hooks/useRecordCrudVerdicts';
import { installExplainDouble } from './explainDouble';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider } from '@object-ui/react';

registerAllFields();

const STORAGE_KEY = 'grid-columns-test_object';

const rows = [
  { id: '1', name: 'Alice', amount: 100, category: 'West' },
  { id: '2', name: 'Bob', amount: 200, category: 'West' },
];

beforeEach(() => {
  __clearRecordCrudVerdictCache();
  installExplainDouble();
  localStorage.clear();
});
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

function renderGrid(opts?: Record<string, any>) {
  const schema: any = {
    type: 'object-grid',
    objectName: 'test_object',
    columns: [
      { field: 'name', label: 'Name' },
      { field: 'amount', label: 'Amount', type: 'number' },
    ],
    data: { provider: 'value', items: rows },
    ...opts,
  };
  return render(
    <ActionProvider>
      <ObjectGrid schema={schema} />
    </ActionProvider>
  );
}

/**
 * The rendered width of a column, read off the header cell in the DOM — the
 * far end of the round trip. `getAllByText` because grouped mode renders one
 * sub-table (and therefore one header row) per group.
 */
function renderedWidths(header: string): string[] {
  return screen.getAllByText(header)
    .map(el => el.closest('th') as HTMLElement)
    .filter(Boolean)
    .map(th => th.style.width);
}

describe('ObjectGrid persisted column width (inbound half)', () => {
  it('applies a width persisted in localStorage to the rendered column', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ widths: { name: 321 } }));

    renderGrid();
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());

    // The seeded column reaches the DOM with the persisted width.
    expect(renderedWidths('Name')).toEqual(['321px']);

    // …and only that column: the unseeded sibling still auto-sizes, so the
    // assertion above cannot be satisfied by a blanket width applied to every
    // header cell.
    const amount = renderedWidths('Amount');
    expect(amount).toHaveLength(1);
    expect(amount[0]).not.toBe('321px');
    expect(amount[0]).toMatch(/^\d+px$/);
  });

  it('applies a width handed in by the host via columnState to the rendered column', async () => {
    // The product path: ObjectView reads the saved layout off the view def and
    // passes it down, rather than relying on the per-browser localStorage copy.
    renderGrid({ columnState: { widths: { name: 321, amount: 277 } } });
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());

    expect(renderedWidths('Name')).toEqual(['321px']);
    expect(renderedWidths('Amount')).toEqual(['277px']);
  });

  it('applies a persisted width in grouped mode too (the sibling path that always worked)', async () => {
    // The control that identified `width` as the correct key: the grouped path
    // reads the SAME `columnState.widths` and has always stamped `width`. It is
    // pinned here so the two paths cannot drift apart again in either
    // direction.
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ widths: { name: 321 } }));

    renderGrid({ grouping: { fields: [{ field: 'category' }] } });
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());

    const widths = renderedWidths('Name');
    expect(widths.length).toBeGreaterThan(0);
    for (const w of widths) expect(w).toBe('321px');
  });
});
