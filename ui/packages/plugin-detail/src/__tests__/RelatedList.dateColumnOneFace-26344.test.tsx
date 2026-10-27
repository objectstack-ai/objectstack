/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#26344 — a related list's `date` column reads in ONE face, the
 * absolute short date, when its field declares no `format`.
 *
 * The record page's related lists draw their own table cells (`makeCell` in
 * `RelatedList.tsx`), apart from `ObjectGrid`'s. objectstack#25884 gave
 * `CellRendererProps` its `inGridColumn` flag and passed it on every grid
 * column cell; these cells did not pass it, so a related list's date column
 * still read "Yesterday · 3 days ago · Sep 20, 2025": the `'relative'` default
 * is relative only inside a ±7-day window and absolute outside it. The ruling
 * on #25884 holds here too: absolute in a sortable column, relative at most as
 * a tooltip.
 *
 * Every column source of the real list is driven (A object `columns`, B string
 * `columns`, C the object's declared `highlightFields`, D the field walk), so
 * a cell built down any one of them must say it sits in a column.
 *
 * CONTROLS: a field that DECLARES `format: 'relative'` keeps the relative face
 * in the same list, and a declared deadline keeps its red, its overdue wording
 * moving to the cell's tooltip.
 *
 * The real data-table renders (`SchemaRenderer` is NOT mocked) and the
 * viewport is desktop: a phone-width list swaps the table for a gallery that
 * draws none of these cells.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import * as React from 'react';

// The real data-table (and its cell renderers) must be registered: this pin
// reads what they DRAW.
import '@object-ui/components';
import { formatDate } from '@object-ui/fields';
import { RelatedList } from '../RelatedList';

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
});
afterEach(cleanup);

/** A calendar day `offset` days from today, as a `date` field stores it. */
function storedDay(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Four days inside the relative window and two outside it, one of them in a
// past year, so every branch of the old default is read in one column.
const OFFSETS = [-1, -3, -6, 2, -40, -400];

const FIELDS = {
  title: { type: 'text', label: 'Title' },
  quoted_on: { type: 'date', label: 'Quoted on' },
  expires_on: { type: 'date', label: 'Expires on', dueLike: true },
  followed_up: { type: 'date', label: 'Followed up', format: 'relative' },
};

const ROWS = OFFSETS.map((offset, i) => ({
  id: `q${i}`,
  title: `Quote ${i}`,
  account: 'a1',
  quoted_on: storedDay(offset),
  expires_on: storedDay(offset),
  followed_up: storedDay(offset),
}));

const NAMES = ['title', 'quoted_on', 'expires_on', 'followed_up'];

function makeDataSource(schemaExtra: Record<string, unknown> = {}) {
  return {
    getObjectSchema: vi.fn(async () => ({ name: 'quote', fields: FIELDS, ...schemaExtra })),
    find: vi.fn(async () => ({ data: ROWS, total: ROWS.length })),
  };
}

async function mountList(columns: unknown[] | undefined, schemaExtra: Record<string, unknown> = {}) {
  const { container } = render(
    <RelatedList
      title="Quotes"
      type="table"
      api="quote"
      objectName="quote"
      referenceField="account"
      parentId="a1"
      dataSource={makeDataSource(schemaExtra) as any}
      {...(columns ? { columns: columns as any } : {})}
    />,
  );
  await waitFor(() => expect(container.querySelector('table')).not.toBeNull());
  await waitFor(() => expect(container.textContent).toContain('Quote 5'));
  return container;
}

/** The column's cell for each row, top to bottom, keyed by the row's title. */
function columnCells(container: HTMLElement, label: string): Map<string, HTMLElement> {
  const headers = [...container.querySelectorAll('thead th')].map((th) => th.textContent ?? '');
  const index = headers.findIndex((text) => text.includes(label));
  if (index < 0) throw new Error(`no column headed ${label}; headers: ${JSON.stringify(headers)}`);
  const cells = new Map<string, HTMLElement>();
  for (const tr of container.querySelectorAll('tbody tr')) {
    const tds = tr.querySelectorAll('td');
    const title = [...tds].map((td) => td.textContent ?? '').find((text) => /^Quote \d$/.test(text));
    if (title && tds.length > index) cells.set(title, tds[index] as HTMLElement);
  }
  return cells;
}

// Every phrase the relative face writes in `en`, inside its window.
const RELATIVE_WORDING = /ago|yesterday|today|tomorrow|^in \d|overdue/i;

function expectOneAbsoluteFace(container: HTMLElement, label: string, field: 'quoted_on' | 'expires_on') {
  const cells = columnCells(container, label);
  expect(cells.size, `every row reached the ${label} column`).toBe(ROWS.length);
  ROWS.forEach((row, i) => {
    const text = cells.get(`Quote ${i}`)?.textContent ?? '';
    expect(text).not.toMatch(RELATIVE_WORDING);
    expect(text).toBe(formatDate(row[field], undefined, { locale: 'en-US' }));
  });
}

function expectListFaces(container: HTMLElement) {
  // The defect: one face per column, whatever the distance from today.
  expectOneAbsoluteFace(container, 'Quoted on', 'quoted_on');
  expectOneAbsoluteFace(container, 'Expires on', 'expires_on');

  // The deadline keeps its red on the past rows, and the overdue wording the
  // cell no longer paints is its tooltip.
  const expires = columnCells(container, 'Expires on');
  const threeDaysPast = expires.get('Quote 1')!.querySelector('span.tabular-nums')!;
  expect(threeDaysPast.className).toContain('text-red-600');
  expect(threeDaysPast.getAttribute('title')).toBe('Overdue 3d');
  const inTwoDays = expires.get('Quote 3')!.querySelector('span.tabular-nums')!;
  expect(inTwoDays.className).not.toContain('text-red-600');
  expect(inTwoDays.getAttribute('title')).toBe('In 2 days');

  // An undeclared date's relative phrase is its tooltip too.
  const yesterday = columnCells(container, 'Quoted on').get('Quote 0')!.querySelector('span.tabular-nums')!;
  expect(yesterday.getAttribute('title')).toBe('Yesterday');

  // CONTROL: a declared `format: 'relative'` keeps the relative face.
  const followed = columnCells(container, 'Followed up');
  expect(followed.get('Quote 0')?.textContent).toBe('Yesterday');
  expect(followed.get('Quote 1')?.textContent).toBe('3 days ago');
}

describe('objectstack#26344 — a related list date column reads in one absolute face', () => {
  it('A: object `columns`', async () => {
    // Spec-spelled `{ field, label }`: an object column with no display text is
    // left headerless on purpose (`RelatedList.columnHeaderLabel`).
    const columns = NAMES.map((field) => ({ field, label: FIELDS[field as keyof typeof FIELDS].label }));
    expectListFaces(await mountList(columns));
  });

  it('B: string `columns`', async () => {
    expectListFaces(await mountList(NAMES));
  });

  it("C: the object's declared `highlightFields`", async () => {
    expectListFaces(await mountList(undefined, { highlightFields: NAMES }));
  });

  it('D: the field walk (no `columns`, no `highlightFields`)', async () => {
    expectListFaces(await mountList(undefined));
  });
});
