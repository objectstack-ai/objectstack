/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#26896 — below the 768px card breakpoint, a GROUPED list takes
 * the plain list's card layout: each group's band, then that group's rows as
 * cards, with no table.
 *
 * Measured at 390x844 (HotCRM Knowledge, grouped by category): the grouped
 * grid kept its desktop table, so titles were cut mid-word and every other
 * column sat behind the pinned Actions column, while the plain Cases list on
 * the same console turned into cards.
 *
 * Pinned on the real ObjectGrid, on both grouped paths (client-grouped rows in
 * memory and server-grouped pages, objectui#7189):
 *   - one band per group, each followed by one card per row of that group,
 *     and no `table` at all;
 *   - collapsing a band removes its cards and keeps its band and count.
 * Control: the same grouped view at a desktop width still draws the one
 * grouped table (objectui#12620) and no card.
 *
 * The phone face (objectstack#27058): the card rows stay, and a tapped card
 * hands its row to the host's `onRowClick`, which on a phone opens the record
 * as a page (`ObjectView.phoneRecordPage-27058`).
 */
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { ObjectGrid } from '../ObjectGrid';
import { ActionProvider } from '@object-ui/react';
import { registerAllFields } from '@object-ui/fields';

beforeAll(() => {
  registerAllFields();
});

const ORIGINAL_INNER_WIDTH = window.innerWidth;

function setWidth(px: number) {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: px });
}

afterEach(() => {
  cleanup();
  setWidth(ORIGINAL_INNER_WIDTH);
});

const OBJECT = 'crm_knowledge_article';

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

const cardBands = () => [...document.querySelectorAll('[data-testid="grouped-grid-card-band"]')] as HTMLElement[];
const bandOf = (label: string) =>
  cardBands().find((band) => band.querySelector('.group-label')?.textContent === label)!;
/** The titles of the cards drawn under one group's band, in order. */
const cardTitlesIn = (label: string) =>
  [...bandOf(label).querySelectorAll('[data-testid="grid-card-title"]')].map((el) => el.textContent);

/** The phone shape: N bands, each card under the band of its own group, no table. */
function expectGroupedCards(groupCount: number) {
  expect(document.querySelector('[data-testid="grouped-grid-card-scroller"]')).not.toBeNull();
  expect(cardBands()).toHaveLength(groupCount);
  expect(document.querySelectorAll('table')).toHaveLength(0);
  expect(document.querySelector('[data-testid="grouped-grid-scroller"]')).toBeNull();
}

const renderClientGrouped = () =>
  render(
    <ActionProvider>
      <ObjectGrid
        schema={{
          type: 'object-grid',
          objectName: OBJECT,
          columns: COLUMNS,
          data: { provider: 'value', items: ARTICLES },
          grouping: { fields: [{ field: 'category' }] },
        } as any}
      />
    </ActionProvider>,
  );

describe('a client-grouped list on a phone draws bands and cards (objectstack#26896)', () => {
  it('one band per group, the group\'s rows as cards under it, and no table', async () => {
    setWidth(390);
    renderClientGrouped();
    await waitFor(() => expect(cardBands()).toHaveLength(4));
    expectGroupedCards(4);

    expect(cardTitlesIn('Getting Started')).toEqual(['Install the agent', 'First login']);
    expect(cardTitlesIn('How-To')).toEqual(['Rotate an API key']);
    expect(cardTitlesIn('Troubleshooting')).toEqual(['Webhook retries']);
    expect(cardTitlesIn('API & Integrations')).toEqual(['REST pagination']);
    // One card per row in all, each under its own band.
    expect(document.querySelectorAll('[data-testid="grid-card-title"]')).toHaveLength(ARTICLES.length);
    // The band keeps its count.
    expect(bandOf('Getting Started').querySelector('.group-count')?.textContent).toBe('2');
  });

  it('collapsing a band removes its cards and keeps its band', async () => {
    setWidth(390);
    renderClientGrouped();
    await waitFor(() => expect(cardBands()).toHaveLength(4));

    fireEvent.click(bandOf('Getting Started').querySelector('button')!);

    await waitFor(() => expect(cardTitlesIn('Getting Started')).toHaveLength(0));
    expect(bandOf('Getting Started').querySelector('button')).toHaveAttribute('aria-expanded', 'false');
    expectGroupedCards(4);
    expect(cardTitlesIn('How-To')).toEqual(['Rotate an API key']);
    expect(document.body.textContent).not.toContain('Install the agent');

    fireEvent.click(bandOf('Getting Started').querySelector('button')!);
    await waitFor(() => expect(cardTitlesIn('Getting Started')).toHaveLength(2));
  });

  it('a tapped card hands its row to the host (objectstack#27058: on a phone the record opens as a page)', async () => {
    setWidth(390);
    const onRowClick = vi.fn();
    render(
      <ActionProvider>
        <ObjectGrid
          schema={{
            type: 'object-grid',
            objectName: OBJECT,
            columns: COLUMNS,
            data: { provider: 'value', items: ARTICLES },
            grouping: { fields: [{ field: 'category' }] },
          } as any}
          onRowClick={onRowClick}
        />
      </ActionProvider>,
    );
    await waitFor(() => expect(cardBands()).toHaveLength(4));
    const card = [...bandOf('How-To').querySelectorAll('[data-testid="grid-card-title"]')][0] as HTMLElement;
    fireEvent.click(card);
    expect(onRowClick).toHaveBeenCalledTimes(1);
    expect(onRowClick.mock.calls[0][0]).toMatchObject({ id: '2', title: 'Rotate an API key' });
  });

  it('CONTROL: at a desktop width the same view still draws the one grouped table', async () => {
    setWidth(1280);
    renderClientGrouped();
    await waitFor(() =>
      expect(document.querySelectorAll('tr[data-testid="data-table-group-band"]')).toHaveLength(4),
    );
    expect(document.querySelectorAll('table')).toHaveLength(1);
    expect(document.querySelector('[data-testid="grouped-grid-scroller"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="grouped-grid-card-scroller"]')).toBeNull();
    expect(document.querySelectorAll('[data-testid="grid-card-title"]')).toHaveLength(0);
  });
});

describe('a server-grouped list on a phone draws each group\'s page as cards (objectstack#26896, objectui#7189)', () => {
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

  it('bands from the header query, each group\'s server page as cards under its band', async () => {
    setWidth(390);
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

    await waitFor(() => expect(cardBands()).toHaveLength(4));
    // It really is the server path: the header query answered the groups.
    expect(ds.queryGroupHeaders).toHaveBeenCalled();
    await waitFor(() => expect(cardTitlesIn('Getting Started')).toEqual(['Install the agent', 'First login']));
    expectGroupedCards(4);
    expect(cardTitlesIn('How-To')).toEqual(['Rotate an API key']);

    fireEvent.click(bandOf('How-To').querySelector('button')!);
    await waitFor(() => expect(cardTitlesIn('How-To')).toHaveLength(0));
    expectGroupedCards(4);
    expect(cardTitlesIn('Getting Started')).toHaveLength(2);
  });
});
