/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#29219 — on a phone the record link inside a grid card is not a
 * tap target of its own: the card around it takes the tap.
 *
 * Below 768 px `ObjectGrid` draws every row as a phone card, and a view whose
 * first column is not the object's name field shows that column's record link
 * in the card's subtitle: one text line, far under 44 px tall (a related list's
 * Activities tab on a record page). The card opens the same record through the
 * same `navigation.handleClick`, so the link carries `max-md:pointer-events-none`
 * and a tap on its text reaches the card.
 *
 * Pinned on the real ObjectGrid at 375 px:
 *   - the subtitle's link carries the token (both faces: the anchor a routing
 *     host gets, and the wrapping variant of an authored `wrap: true`);
 *   - a click on the card opens the row, exactly once;
 *   - the link stays focusable and Space still opens the row from the keyboard.
 * The token is a `max-md:` variant on purpose: the card face starts below
 * 768 px, the same width `md:` starts at, so the desktop table never sees it.
 * The card may carry other controls; nothing here assumes it does not.
 */

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { ObjectGrid } from '../ObjectGrid';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider, RelatedRecordActionsProvider, SchemaRendererProvider } from '@object-ui/react';

registerAllFields();

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as any;
  }
});

const ORIGINAL_INNER_WIDTH = window.innerWidth;

afterEach(() => {
  cleanup();
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: ORIGINAL_INNER_WIDTH });
});

const OBJECT = 'test_activity';

const FIELDS = {
  id: { type: 'text' },
  subject: { type: 'text', label: 'Subject' },
  kind: { type: 'text', label: 'Kind' },
  due: { type: 'text', label: 'Due' },
};

const ROWS = [
  { id: 'a1', subject: 'Quarterly Business Review', kind: 'Meeting', due: 'Nov 16' },
  { id: 'a2', subject: 'Discovery Call', kind: 'Call', due: 'Oct 30' },
];

const host = {
  resolve: () => ({}),
  recordHref: (objectName: string, recordId: string | number) =>
    objectName === OBJECT ? `/apps/demo/${objectName}/record/${encodeURIComponent(String(recordId))}` : null,
  openRecord: vi.fn(),
} as any;

function renderPhoneGrid(opts: { wrap?: boolean; onRowClick?: (row: any) => void } = {}) {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 375 });
  const dataSource = {
    find: vi.fn(async () => ({ data: ROWS, total: ROWS.length, hasMore: false, pageSize: 50 })),
    getObjectSchema: async (name: string) => ({ name, nameField: 'subject', fields: FIELDS }),
  } as any;
  // The view leads with Kind, as the CRM Activities related tab does, so the
  // card is titled by the name field and the link lands in the subtitle.
  const schema: any = {
    type: 'object-grid',
    objectName: OBJECT,
    columns: [
      { field: 'kind', label: 'Kind', ...(opts.wrap ? { wrap: true } : {}) },
      { field: 'subject', label: 'Subject' },
      { field: 'due', label: 'Due' },
    ],
    pagination: { pageSize: 50 },
  };
  render(
    <ActionProvider>
      <SchemaRendererProvider dataSource={dataSource}>
        <RelatedRecordActionsProvider value={host}>
          <ObjectGrid schema={schema} dataSource={dataSource} onRowClick={opts.onRowClick} />
        </RelatedRecordActionsProvider>
      </SchemaRendererProvider>
    </ActionProvider>,
  );
}

/** The first card and the record link in it. */
async function firstCardLink() {
  const cards = await screen.findAllByTestId('grid-mobile-card');
  const card = cards[0] as HTMLElement;
  const link = card.querySelector('[data-testid="primary-field-link"]') as HTMLElement | null;
  expect(link, 'the card subtitle draws the first column as the record link').not.toBeNull();
  return { card, link: link as HTMLElement };
}

describe('ObjectGrid phone card — the card, not the one-line link, takes the tap (objectstack#29219)', () => {
  it('the subtitle link hands the tap to the card below the card breakpoint', async () => {
    renderPhoneGrid();
    const { card, link } = await firstCardLink();

    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute('href', '/apps/demo/test_activity/record/a1');
    expect(link.textContent).toBe('Meeting');
    expect(link.classList.contains('max-md:pointer-events-none')).toBe(true);
    // Not a `max-sm:` variant: between 640 and 767 px the grid still draws cards.
    expect([...link.classList].some((c) => c.startsWith('max-sm:pointer-events'))).toBe(false);
    expect(card.contains(link)).toBe(true);
  });

  it('a column authored `wrap: true` keeps the token in its wrapping variant', async () => {
    renderPhoneGrid({ wrap: true });
    const { link } = await firstCardLink();

    expect(link.classList.contains('whitespace-normal')).toBe(true);
    expect(link.classList.contains('max-md:pointer-events-none')).toBe(true);
  });

  it('a tap on the card opens that row, exactly once', async () => {
    const onRowClick = vi.fn();
    renderPhoneGrid({ onRowClick });
    const { card } = await firstCardLink();

    fireEvent.click(card);
    expect(onRowClick).toHaveBeenCalledTimes(1);
    expect(onRowClick.mock.calls[0][0]).toMatchObject({ id: 'a1' });
  });

  it('the link keeps its keyboard face: it takes focus, and Space opens the row', async () => {
    const onRowClick = vi.fn();
    renderPhoneGrid({ onRowClick });
    const { link } = await firstCardLink();

    link.focus();
    expect(document.activeElement).toBe(link);
    fireEvent.keyDown(link, { key: ' ' });
    expect(onRowClick).toHaveBeenCalledTimes(1);
    expect(onRowClick.mock.calls[0][0]).toMatchObject({ id: 'a1' });
  });
});
