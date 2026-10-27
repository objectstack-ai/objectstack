/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#26678 — a related list in the record page's related column
 * (`RelatedListCompactContext`, set by `RecordPageColumns`) draws as a card
 * that names its first rows: the identity column alone, since a second column
 * does not fit beside it in a ~20rem rail. Anywhere else the list keeps every
 * column. Pinned through the REAL `data-table`'s rendered headers.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { RelatedList } from '../RelatedList';
import { RelatedListCompactContext } from '../relatedListCompact';

// Desktop, pinned rather than inherited: below 768 px a table list renders as a gallery.
beforeAll(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
});

const fields = {
  name: { type: 'text', label: 'Name' },
  status: { type: 'text', label: 'Status' },
};
const rows = [
  { id: 't1', name: 'Call Ada', status: 'open' },
  { id: 't2', name: 'Send deck', status: 'done' },
];
const columns = [
  { field: 'name', label: 'Name' },
  { field: 'status', label: 'Status' },
];

function renderList(compact: boolean) {
  const list = (
    <RelatedList
      title="Tasks"
      type="table"
      api="task"
      objectName="task"
      columns={columns}
      data={rows}
      dataSource={{ find: vi.fn(async () => rows), getObjectSchema: vi.fn(async () => ({ name: 'task', fields })) } as any}
    />
  );
  return render(compact ? <RelatedListCompactContext.Provider value>{list}</RelatedListCompactContext.Provider> : list);
}

const headers = () =>
  Array.from(document.querySelectorAll('thead th')).map((th) => (th.textContent ?? '').trim()).filter(Boolean);

describe('RelatedList in the related column (objectstack#26678)', () => {
  it('keeps every column outside the related column', async () => {
    renderList(false);
    await waitFor(() => expect(screen.getByText('Call Ada')).toBeInTheDocument());
    expect(headers()).toEqual(['Name', 'Status']);
    expect(screen.getByText('open')).toBeInTheDocument();
  });

  it('names its rows by the identity column alone inside it', async () => {
    renderList(true);
    await waitFor(() => expect(screen.getByText('Call Ada')).toBeInTheDocument());
    expect(headers()).toEqual(['Name']);
    expect(screen.queryByText('open')).not.toBeInTheDocument();
    // Still the card: its title and its count.
    expect(screen.getByText('Tasks')).toBeInTheDocument();
    expect(screen.getByLabelText('2 records')).toBeInTheDocument();
  });
});
