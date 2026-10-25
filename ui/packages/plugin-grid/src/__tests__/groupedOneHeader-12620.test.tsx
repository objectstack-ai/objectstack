/**
 * objectui#12620 — a grouped grid draws ONE table with ONE header row, and a
 * group is a band row between the rows of that table.
 *
 * Before: each group rendered its own `data-table`, so a four-group list drew
 * four column headers for four rows (HotCRM Knowledge Base, grouped by
 * Category), and each header's `sticky` was bounded by its own table.
 *
 * Pinned here, on both grouped paths (client-grouped rows in memory and
 * server-grouped pages, objectui#7189):
 *   - exactly one `table` and one `thead`;
 *   - every band is a row of that table's one `tbody`, whose single cell's
 *     `colSpan` equals the header's cell count;
 *   - collapsing one band removes that band's rows and leaves the others'.
 */
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { ObjectGrid } from '../ObjectGrid';
import { ActionProvider } from '@object-ui/react';
import { registerAllFields } from '@object-ui/fields';
import { bandRowsOf } from './groupBandScope';

beforeAll(() => {
  registerAllFields();
});

afterEach(() => cleanup());

const ARTICLES = [
  { id: '1', title: 'Install the agent', category: 'Getting Started', status: 'published' },
  { id: '2', title: 'Rotate an API key', category: 'How-To', status: 'published' },
  { id: '3', title: 'Webhook retries', category: 'Troubleshooting', status: 'draft' },
  { id: '4', title: 'REST pagination', category: 'API & Integrations', status: 'published' },
  { id: '5', title: 'First login', category: 'Getting Started', status: 'draft' },
];

const COLUMNS = [
  { field: 'title', label: 'Title' },
  { field: 'category', label: 'Category' },
  { field: 'status', label: 'Status' },
];

const bands = () => [...document.querySelectorAll('tr[data-testid="data-table-group-band"]')] as HTMLTableRowElement[];
const groupRowEl = (label: string) =>
  [...document.querySelectorAll('[data-testid^="group-row-"]')]
    .find((el) => el.querySelector('.group-label')?.textContent === label)!;
const headerCellCount = () => document.querySelectorAll('thead tr th').length;
const titlesIn = (label: string) =>
  bandRowsOf(groupRowEl(label)).map((tr) => tr.textContent ?? '').filter((text) => /\S/.test(text));

/** The one-table shape, asserted the same way on both paths. */
function expectOneTable(groupCount: number) {
  expect(document.querySelectorAll('table')).toHaveLength(1);
  expect(document.querySelectorAll('thead')).toHaveLength(1);
  expect(document.querySelectorAll('tbody')).toHaveLength(1);
  const tbody = document.querySelector('tbody')!;
  expect(bands()).toHaveLength(groupCount);
  for (const band of bands()) {
    expect(band.parentElement).toBe(tbody);
    const cells = band.querySelectorAll('td');
    expect(cells).toHaveLength(1);
    expect(cells[0].colSpan).toBe(headerCellCount());
  }
}

describe('a client-grouped grid draws one header row (objectui#12620)', () => {
  const renderClientGrouped = () =>
    render(
      <ActionProvider>
        <ObjectGrid
          schema={{
            type: 'object-grid',
            objectName: 'crm_knowledge_article',
            columns: COLUMNS,
            data: { provider: 'value', items: ARTICLES },
            grouping: { fields: [{ field: 'category' }] },
          } as any}
        />
      </ActionProvider>,
    );

  it('one table, one thead, one band per group spanning every column', async () => {
    renderClientGrouped();
    await waitFor(() => expect(bands()).toHaveLength(4));
    expectOneTable(4);
    // The header names each column once, not once per group.
    expect(document.querySelectorAll('thead tr')).toHaveLength(1);
    // Each band owns its group's rows, which sit between it and the next band.
    expect(titlesIn('Getting Started').join(' ')).toContain('Install the agent');
    expect(titlesIn('Getting Started').join(' ')).toContain('First login');
    expect(titlesIn('How-To').join(' ')).toContain('Rotate an API key');
  });

  it('collapsing one band hides its rows only, and keeps its band', async () => {
    renderClientGrouped();
    await waitFor(() => expect(bands()).toHaveLength(4));
    expect(titlesIn('Getting Started')).toHaveLength(2);
    expect(titlesIn('How-To')).toHaveLength(1);

    fireEvent.click(groupRowEl('Getting Started').querySelector('button')!);

    await waitFor(() => expect(titlesIn('Getting Started')).toHaveLength(0));
    expect(groupRowEl('Getting Started').querySelector('button')).toHaveAttribute('aria-expanded', 'false');
    // The band stays, the other bands keep their rows, and it is still one table.
    expectOneTable(4);
    expect(titlesIn('How-To')).toHaveLength(1);
    expect(titlesIn('Troubleshooting')).toHaveLength(1);
    expect(titlesIn('API & Integrations')).toHaveLength(1);
    expect(document.body.textContent).not.toContain('Install the agent');

    // Expanding it again brings its rows back under the same header.
    fireEvent.click(groupRowEl('Getting Started').querySelector('button')!);
    await waitFor(() => expect(titlesIn('Getting Started')).toHaveLength(2));
    expectOneTable(4);
  });
});

describe('a server-grouped grid draws one header row too (objectui#12620, objectui#7189)', () => {
  const OBJECT = 'crm_knowledge_article';
  const makeServerDataSource = () => ({
    queryGroupHeaders: vi.fn(async () => {
      const counts = new Map<string, number>();
      for (const row of ARTICLES) counts.set(row.category, (counts.get(row.category) ?? 0) + 1);
      return [...counts.entries()].map(([category, count]) => ({ category, count }));
    }),
    find: vi.fn(async (_object: string, params: Record<string, any>) => {
      const wanted = params.$filter?.$and?.[0]?.category?.$eq;
      const rows = ARTICLES.filter((row) => wanted === undefined || row.category === wanted);
      const skip = params.$skip ?? 0;
      const top = params.$top ?? rows.length;
      return { data: rows.slice(skip, skip + top), total: rows.length };
    }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => ({
      name: OBJECT,
      fields: {
        id: { type: 'text', label: 'Id' },
        title: { type: 'text', label: 'Title' },
        category: { type: 'text', label: 'Category' },
        status: { type: 'text', label: 'Status' },
      },
    })),
  });

  it('one table, one thead, its bands and each group\'s server page under its band', async () => {
    const ds = makeServerDataSource();
    render(
      <ActionProvider>
        <ObjectGrid
          schema={{
            type: 'object-grid',
            objectName: OBJECT,
            columns: ['title', 'category', 'status'],
            grouping: { fields: [{ field: 'category' }] },
          } as any}
          dataSource={ds as any}
        />
      </ActionProvider>,
    );

    await waitFor(() => expect(bands()).toHaveLength(4));
    // It really is the server path: the header query answered the groups.
    expect(ds.queryGroupHeaders).toHaveBeenCalled();
    await waitFor(() => expect(titlesIn('Getting Started').join(' ')).toContain('First login'));
    expectOneTable(4);
    expect(titlesIn('How-To').join(' ')).toContain('Rotate an API key');

    fireEvent.click(groupRowEl('How-To').querySelector('button')!);
    await waitFor(() => expect(titlesIn('How-To')).toHaveLength(0));
    expectOneTable(4);
    expect(titlesIn('Getting Started')).toHaveLength(2);
  });
});
