/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#26678 / objectstack#27055 — a related list in the record page's
 * related column (`RelatedListCompactContext`, set by `RecordPageColumns`)
 * draws as the v3 compact card: title + count + ＋ in one row, NO table
 * header, up to three rows of the record's name and one status / date chip,
 * no 「查看全部」 footer. Anywhere else the list keeps every column, pinned
 * through the REAL `data-table`'s rendered headers.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { RelatedList } from '../RelatedList';
import { RelatedCardChromeContext, RelatedListCompactContext, type RelatedCardChrome } from '../relatedListCompact';

// Desktop, pinned rather than inherited: below 768 px a table list renders as a gallery.
beforeAll(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
});

const fields = {
  name: { type: 'text', label: 'Name' },
  status: {
    type: 'select',
    label: 'Status',
    options: [
      { value: 'open', label: 'Open' },
      { value: 'done', label: 'Done' },
    ],
  },
};
const rows = [
  { id: 't1', name: 'Call Ada', status: 'open' },
  { id: 't2', name: 'Send deck', status: 'done' },
  { id: 't3', name: 'Book demo', status: 'open' },
  { id: 't4', name: 'Fourth task', status: 'open' },
];
const columns = [
  { field: 'name', label: 'Name' },
  { field: 'status', label: 'Status' },
];

function renderList(compact: boolean, extra: { chrome?: RelatedCardChrome; onViewAll?: () => void } = {}) {
  const list = (
    <RelatedList
      title="Tasks"
      type="table"
      api="task"
      objectName="task"
      columns={columns}
      data={rows}
      onViewAll={extra.onViewAll}
      dataSource={{ find: vi.fn(async () => rows), getObjectSchema: vi.fn(async () => ({ name: 'task', fields })) } as any}
    />
  );
  const withChrome = extra.chrome ? (
    <RelatedCardChromeContext.Provider value={extra.chrome}>{list}</RelatedCardChromeContext.Provider>
  ) : list;
  return render(compact ? <RelatedListCompactContext.Provider value>{withChrome}</RelatedListCompactContext.Provider> : withChrome);
}

const headers = () =>
  Array.from(document.querySelectorAll('thead th')).map((th) => (th.textContent ?? '').trim()).filter(Boolean);

describe('RelatedList in the related column (objectstack#26678)', () => {
  it('keeps every column outside the related column', async () => {
    renderList(false);
    await waitFor(() => expect(screen.getByText('Call Ada')).toBeInTheDocument());
    expect(headers()).toEqual(['Name', 'Status']);
    expect(screen.getAllByText('Open').length).toBeGreaterThan(0);
  });

  it('draws the compact card inside it: no table header, three named rows, one chip each', async () => {
    renderList(true);
    await waitFor(() => expect(screen.getByText('Call Ada')).toBeInTheDocument());
    expect(document.querySelector('thead')).toBeNull();
    const cardRows = Array.from(document.querySelectorAll('[data-related-card-row]'));
    expect(cardRows.map((row) => row.firstElementChild?.textContent)).toEqual(['Call Ada', 'Send deck', 'Book demo']);
    expect(screen.queryByText('Fourth task')).not.toBeInTheDocument();
    // ONE chip per row: the status, by its option label.
    expect(cardRows.map((row) => row.querySelector('[data-related-card-chip]')?.textContent)).toEqual(['Open', 'Done', 'Open']);
    // Title and count in the one header row.
    expect(screen.getByText('Tasks')).toBeInTheDocument();
    expect(document.querySelector('[data-related-card-count]')?.textContent).toBe('4');
  });

  it('draws no 「查看全部」 footer, even with a View All host hook (one path: ⤢)', async () => {
    renderList(true, { onViewAll: vi.fn() });
    await waitFor(() => expect(screen.getByText('Call Ada')).toBeInTheDocument());
    expect(screen.queryByText(/View all/i)).not.toBeInTheDocument();
  });

  it('offers the handle, the ⋯ menu and the way to the whole list only with the arranged stack\'s chrome (objectstack#27524)', async () => {
    renderList(true);
    await waitFor(() => expect(screen.getByText('Call Ada')).toBeInTheDocument());
    expect(document.querySelector('[data-related-panel-open]')).toBeNull();
    expect(document.querySelector('[data-related-panel-handle]')).toBeNull();
    expect(document.querySelector('[data-related-card-menu]')).toBeNull();
    document.body.innerHTML = '';
    const onEnlarge = vi.fn();
    renderList(true, { chrome: { id: 'task.lead_id', fresh: true, onHide: vi.fn(), onEnlarge } });
    await waitFor(() => expect(screen.getByText('Call Ada')).toBeInTheDocument());
    // No ⤢ any more: the header (title + count chip) opens the whole list.
    expect(document.querySelector('[data-related-card-enlarge]')).toBeNull();
    (document.querySelector('[data-related-panel-open]') as HTMLButtonElement).click();
    (document.querySelector('[data-related-card-count]') as HTMLElement).click();
    expect(onEnlarge).toHaveBeenCalledTimes(2);
    expect(document.querySelector('[data-related-panel-handle]')).not.toBeNull();
    expect(document.querySelector('[data-related-card-menu]')).not.toBeNull();
    expect(document.querySelector('[data-related-card-new]')).not.toBeNull();
  });
});
