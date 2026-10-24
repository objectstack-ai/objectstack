/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12480 — a rich-content cell keeps the grid's one-line row.
 *
 * The Studio Data pillar's Records grid on HotCRM's `crm_account` (10 records)
 * drew rows 1–8, a tall empty band, row 9, and no row 10, under a footer
 * reading "10 records". Root cause: `data-table`'s one-line clamp is
 * `truncate`, which bounds INLINE content only. The `markdown` / `html` /
 * `richtext` cell renderers draw a block document, and blocks stack under
 * nowrap, so the one record with a long `description` grew its row to the
 * document's height (456 px in Chromium) and pushed row 10 below the scroll
 * box's fold. The console list pages render through the same `ObjectGrid`, so
 * they did the same.
 *
 * The fix wraps a rich-content column's renderer in a one-line clamp unless the
 * column is authored `wrap: true`. jsdom does no layout, so these pins read the
 * class contract and the row count; the pixel readings (before and after, 8 /
 * 9 / 10 rows, Studio and the console list body) are in the PR body.
 */

import React from 'react';
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ActionProvider, SchemaRendererProvider } from '@object-ui/react';
import { registerAllFields } from '@object-ui/fields';
import { ObjectGrid } from '../ObjectGrid';

registerAllFields();

const DOC = '**Strategic Customer**\n\nA long account history.\n\n- one\n- two\n- three';

const FIELDS = {
  id: { type: 'text' },
  name: { type: 'text', label: 'Name' },
  description: { type: 'markdown', label: 'Description' },
  notes_html: { type: 'html', label: 'Html' },
  notes_rich: { type: 'richtext', label: 'Rich' },
};

function makeRows(n: number, rich: boolean) {
  return Array.from({ length: n }, (_, i) => ({
    id: `r${i + 1}`,
    name: `Account ${i + 1}`,
    ...(rich && i === n - 2
      ? {
          description: DOC,
          notes_html: '<h2>Title</h2><p>one</p><p>two</p>',
          notes_rich: '<p>Rich <strong>text</strong></p><p>second</p>',
        }
      : {}),
  }));
}

function renderGrid(rows: Record<string, unknown>[], columns: any[]) {
  const ds = {
    find: vi.fn(async () => ({ data: rows, total: rows.length, hasMore: false, pageSize: 50 })),
    getObjectSchema: vi.fn(async (name: string) => ({ name, fields: FIELDS })),
  } as any;
  return render(
    <ActionProvider>
      <SchemaRendererProvider dataSource={ds}>
        <ObjectGrid
          schema={{
            type: 'object-grid',
            objectName: 'test_object',
            columns,
            pagination: { pageSize: 50 },
          } as any}
          dataSource={ds}
        />
      </SchemaRendererProvider>
    </ActionProvider>,
  );
}

const bodyRows = () =>
  Array.from(document.querySelectorAll('tbody > tr')).filter(
    (tr) => tr.getAttribute('data-testid') !== 'add-record-row',
  );

const clamps = () => Array.from(document.querySelectorAll<HTMLElement>('[data-testid="grid-rich-text-one-line"]'));

const ORIGINAL_INNER_WIDTH = window.innerWidth;

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as any;
  }
});

afterEach(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: ORIGINAL_INNER_WIDTH });
  cleanup();
});

function desktop() {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1280 });
}

describe('objectui#12480 — a rich-content cell keeps the one-line row', () => {
  it('10 rows with a markdown, an html and a richtext column: 10 rows drawn, each rich cell inside a one-line clamp', async () => {
    desktop();
    renderGrid(makeRows(10, true), [
      { field: 'name', label: 'Name' },
      { field: 'description', label: 'Description' },
      { field: 'notes_html', label: 'Html' },
      { field: 'notes_rich', label: 'Rich' },
    ]);
    await waitFor(() => expect(screen.getByText('Account 10')).toBeInTheDocument());
    expect(bodyRows()).toHaveLength(10);

    // One clamp per rich-content cell: three rich columns x ten rows.
    await waitFor(() => expect(clamps()).toHaveLength(30));
    for (const el of clamps()) {
      expect(el).toHaveClass('line-clamp-1');
      expect(el.closest('td')).not.toBeNull();
    }

    // The documents themselves are drawn INSIDE the clamp, not beside it.
    const row9 = bodyRows()[8] as HTMLElement;
    const rowClamps = Array.from(row9.querySelectorAll<HTMLElement>('[data-testid="grid-rich-text-one-line"]'));
    expect(rowClamps).toHaveLength(3);
    await waitFor(() => expect(rowClamps[0].querySelector('ul')).not.toBeNull());
    expect(rowClamps[1].querySelector('h2')).not.toBeNull();
    expect(rowClamps[2].querySelector('strong')).not.toBeNull();

    // Over-correction control: the plain text column is not clamped this way.
    expect(screen.getByText('Account 9').closest('[data-testid="grid-rich-text-one-line"]')).toBeNull();
  });

  it('a rich-content column authored `wrap: true` keeps the whole document (no clamp)', async () => {
    desktop();
    renderGrid(makeRows(10, true), [
      { field: 'name', label: 'Name' },
      { field: 'description', label: 'Description', wrap: true },
    ]);
    await waitFor(() => expect(screen.getByText('Account 10')).toBeInTheDocument());
    expect(bodyRows()).toHaveLength(10);
    await waitFor(() => expect((bodyRows()[8] as HTMLElement).querySelector('ul')).not.toBeNull());
    expect(clamps()).toHaveLength(0);
  });

  it('CONTROL — an 8-row object with no rich-content column is unchanged: 8 rows, no clamp, cells still truncate', async () => {
    desktop();
    renderGrid(makeRows(8, false), [{ field: 'name', label: 'Name' }]);
    await waitFor(() => expect(screen.getByText('Account 8')).toBeInTheDocument());
    expect(bodyRows()).toHaveLength(8);
    expect(clamps()).toHaveLength(0);
    expect(screen.getByText('Account 8').closest('td')?.querySelector('.truncate')).not.toBeNull();
  });
});
