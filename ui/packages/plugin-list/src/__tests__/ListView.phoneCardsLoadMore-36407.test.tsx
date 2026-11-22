/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#36407 — on a phone, a list that declares no `pagination` loads
 * its record cards as the card list scrolls, as the table does on a desktop.
 *
 * A list with no declared `pagination` loads window by window as it scrolls
 * (objectstack#35554): no pager, and the next window is asked for as the
 * table's scroll box nears its end. At phone width the grid draws record cards
 * in a scroller of its own instead of the table, and that scroller was never
 * watched: the cards ended in a pager reading "Page 1 of 3" whose Next did
 * nothing, so with 120 records card 51 was never reachable.
 *
 * Through the real `ListView` and `ObjectGrid`, at 390 px, with 120 records:
 * scrolling the card list to its end three times reaches record 120, and no
 * pager is drawn. The control: a list that DECLARES `pagination` keeps its
 * card pager, and Next turns the page.
 *
 * happy-dom lays nothing out, so the card scroller's box is given a height and
 * a content height by hand, the way the browser would measure them.
 */
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ValueDataSource } from '@object-ui/core';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider, SchemaRendererProvider } from '@object-ui/react';
// The real grid, registered by its package's side effect.
import '@object-ui/plugin-grid';
import { ListView } from '../ListView';

type Row = Record<string, unknown>;

const TOTAL = 120;
const ROWS: Row[] = Array.from({ length: TOTAL }, (_, i) => ({ id: `r${i + 1}`, name: `Row ${i + 1}` }));
const ORIGINAL_INNER_WIDTH = window.innerWidth;

function setWidth(px: number) {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: px });
}

beforeAll(() => {
  registerAllFields();
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as unknown as Element['scrollIntoView'];
  }
});

afterEach(() => {
  cleanup();
  setWidth(ORIGINAL_INNER_WIDTH);
  window.sessionStorage.clear();
});

function source() {
  const store = new ValueDataSource<Row>({ items: ROWS });
  const calls: Array<Record<string, any>> = [];
  const ds = {
    calls,
    find: vi.fn(async (object: string, params: any) => {
      calls.push(params);
      return store.find(object, params);
    }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: async (name: string) => ({
      name,
      nameField: 'name',
      fields: { id: { type: 'text' }, name: { type: 'text', label: 'Name' } },
    }),
  };
  return ds;
}

function renderList(schema: Record<string, unknown> = {}) {
  const ds = source();
  render(
    <SchemaRendererProvider dataSource={ds as never}>
      <ActionProvider>
        <ListView
          schema={{ type: 'list-view', objectName: 'phone_row', viewType: 'grid', columns: ['name'], ...schema } as never}
          dataSource={ds as never}
        />
      </ActionProvider>
    </SchemaRendererProvider>,
  );
  return ds;
}

const cardTitles = () =>
  [...document.querySelectorAll('[data-testid="grid-card-title"]')].map((el) => el.textContent);

/** Scroll the card list to its end, as a reader's thumb does. */
function scrollCardsToEnd() {
  const scroller = screen.getByTestId('object-grid-card-scroller');
  const cards = cardTitles().length;
  Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 700 });
  Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: cards * 80 });
  scroller.scrollTop = cards * 80 - 700;
  fireEvent.scroll(scroller);
}

describe('phone record cards load more as the card list scrolls (objectstack#36407)', () => {
  it('with 120 records and no declared pagination, scrolling the cards reaches record 120 and no pager is drawn', async () => {
    setWidth(390);
    const ds = renderList();
    await waitFor(() => expect(cardTitles()).toHaveLength(50));
    expect(cardTitles()[0]).toBe('Row 1');
    // Nothing pages, so nothing offers to turn a page.
    expect(screen.queryByTestId('object-grid-card-pager')).toBeNull();

    scrollCardsToEnd();
    await waitFor(() => expect(cardTitles()).toHaveLength(100));
    expect(cardTitles()[50]).toBe('Row 51');

    scrollCardsToEnd();
    await waitFor(() => expect(cardTitles()).toHaveLength(TOTAL));
    expect(cardTitles()[TOTAL - 1]).toBe('Row 120');
    expect(screen.queryByTestId('object-grid-card-pager')).toBeNull();

    // Every window was its own read, and nothing asks past the end.
    const skips = ds.calls.map((c) => c.$skip ?? 0);
    expect(skips).toEqual(expect.arrayContaining([0, 50, 100]));
    const readsAtEnd = ds.calls.length;
    scrollCardsToEnd();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(ds.calls.length).toBe(readsAtEnd);
  });

  it('control: a list that declares pagination keeps its card pager, and Next turns the page', async () => {
    setWidth(390);
    renderList({ pagination: { pageSize: 50 } });
    await waitFor(() => expect(cardTitles()).toHaveLength(50));
    const pager = screen.getByTestId('object-grid-card-pager');
    expect(within(pager).getByTestId('object-grid-card-page-info')).toHaveTextContent('Page 1 of 3');

    fireEvent.click(within(pager).getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(cardTitles()[0]).toBe('Row 51'));
    expect(screen.getByTestId('object-grid-card-page-info')).toHaveTextContent('Page 2 of 3');
  });
});
