/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#25884 — a grid's `date` column reads in ONE face, the absolute
 * short date, when its field declares no `format`.
 *
 * Measured on a CRM's quote list sorted by its quote date: the column read
 * "Yesterday · 3 days ago · 7 days ago · Sep 25 · Sep 10", because the cell's
 * default face was `'relative'`, and `formatRelativeDate` is relative only
 * inside a ±7-day window and absolute outside it. Three faces in one column:
 * the eye cannot scan it and a sorted column does not look sorted. The ruling
 * on the card: absolute in a sortable column, relative at most as a tooltip.
 *
 * Every column path of the real `ObjectGrid` is driven (A object `columns`,
 * B string `columns`, C the inline-data projection, D the object-schema
 * default columns), because each builds its own cell and each must say the
 * cell sits in a column.
 *
 * CONTROLS: a field that DECLARES `format: 'relative'` keeps the relative face
 * in the same grid, and a declared deadline keeps its red, its overdue
 * wording moving to the cell's tooltip.
 */
import React from 'react';
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import {
  assertNoOtherNetworkEscape,
  installRecordSecurityExplainDouble,
} from '@object-ui/test-support';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { registerAllFields, formatDate } from '@object-ui/fields';
import { ActionProvider } from '@object-ui/react';
import { ObjectGrid } from '../ObjectGrid';

registerAllFields();

beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = vi.fn(() => false) as any;
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as any;
  }
});

beforeEach(() => installRecordSecurityExplainDouble(vi));
afterEach(() => {
  assertNoOtherNetworkEscape(expect);
  cleanup();
  vi.unstubAllGlobals();
});

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

const QUOTE_SCHEMA = {
  name: 'quote',
  label: 'Quote',
  fields: {
    title: { type: 'text', label: 'Title' },
    quoted_on: { type: 'date', label: 'Quoted on' },
    expires_on: { type: 'date', label: 'Expires on', dueLike: true },
    followed_up: { type: 'date', label: 'Followed up', format: 'relative' },
  },
};

const ROWS = OFFSETS.map((offset, i) => ({
  id: `q${i}`,
  title: `Quote ${i}`,
  quoted_on: storedDay(offset),
  expires_on: storedDay(offset),
  followed_up: storedDay(offset),
}));

const NAMES = ['title', 'quoted_on', 'expires_on', 'followed_up'];

function makeDataSource() {
  return {
    find: vi.fn(async () => ({ data: ROWS, total: ROWS.length })),
    getObjectSchema: vi.fn(async () => QUOTE_SCHEMA),
  } as any;
}

function renderGrid(schemaOverrides: Record<string, unknown>, props: Record<string, unknown> = {}) {
  render(
    <ActionProvider>
      <ObjectGrid
        schema={{ type: 'object-grid', objectName: 'quote', ...schemaOverrides } as never}
        dataSource={makeDataSource()}
        {...props}
      />
    </ActionProvider>,
  );
}

/** The column's index among the header cells, by its label. */
function columnIndex(label: string): number {
  const headers = [...document.querySelectorAll('thead tr th')].map((th) => th.textContent ?? '');
  const index = headers.findIndex((text) => text.includes(label));
  if (index < 0) throw new Error(`no column headed ${label}; headers: ${JSON.stringify(headers)}`);
  return index;
}

/** The column's cell for each row, top to bottom, keyed by the row's title. */
function columnCells(label: string): Map<string, HTMLElement> {
  const index = columnIndex(label);
  const cells = new Map<string, HTMLElement>();
  for (const tr of document.querySelectorAll('tbody tr')) {
    const tds = tr.querySelectorAll('td');
    const title = [...tds].map((td) => td.textContent ?? '').find((text) => /^Quote \d$/.test(text));
    if (title && tds.length > index) cells.set(title, tds[index] as HTMLElement);
  }
  return cells;
}

// Every phrase the relative face writes in `en`, inside its window.
const RELATIVE_WORDING = /ago|yesterday|today|tomorrow|^in \d|overdue/i;

async function settled() {
  await waitFor(() => expect(screen.getAllByText(/^Quote \d$/)).toHaveLength(ROWS.length));
  await waitFor(() => expect(columnCells('Quoted on').size).toBe(ROWS.length));
}

function expectOneAbsoluteFace(label: string, field: 'quoted_on' | 'expires_on') {
  const cells = columnCells(label);
  ROWS.forEach((row, i) => {
    const text = cells.get(`Quote ${i}`)?.textContent ?? '';
    expect(text).not.toMatch(RELATIVE_WORDING);
    expect(text).toBe(formatDate(row[field], undefined, { locale: 'en-US' }));
  });
}

async function expectGridFaces() {
  await settled();
  // The defect: one face per column, whatever the distance from today.
  expectOneAbsoluteFace('Quoted on', 'quoted_on');
  expectOneAbsoluteFace('Expires on', 'expires_on');

  // The deadline keeps its red on the past rows, and the overdue wording the
  // cell no longer paints is its tooltip.
  const expires = columnCells('Expires on');
  const threeDaysPast = expires.get('Quote 1')!.querySelector('span.tabular-nums')!;
  expect(threeDaysPast.className).toContain('text-red-600');
  expect(threeDaysPast.getAttribute('title')).toBe('Overdue 3d');
  const inTwoDays = expires.get('Quote 3')!.querySelector('span.tabular-nums')!;
  expect(inTwoDays.className).not.toContain('text-red-600');
  expect(inTwoDays.getAttribute('title')).toBe('In 2 days');

  // An undeclared date's relative phrase is its tooltip too.
  const yesterday = columnCells('Quoted on').get('Quote 0')!.querySelector('span.tabular-nums')!;
  expect(yesterday.getAttribute('title')).toBe('Yesterday');

  // CONTROL: a declared `format: 'relative'` keeps the relative face.
  const followed = columnCells('Followed up');
  expect(followed.get('Quote 0')?.textContent).toBe('Yesterday');
  expect(followed.get('Quote 1')?.textContent).toBe('3 days ago');
}

describe('objectstack#25884 — a grid date column reads in one absolute face', () => {
  it('A: object `columns`', async () => {
    renderGrid({ columns: NAMES.map((field) => ({ field })), data: { provider: 'value', items: ROWS } });
    await expectGridFaces();
  });

  it('B: string `columns`', async () => {
    renderGrid({ columns: NAMES, data: { provider: 'value', items: ROWS } });
    await expectGridFaces();
  });

  it('C: inline-data projection (`fields`, no `columns`)', async () => {
    renderGrid({ fields: NAMES, data: { provider: 'value', items: ROWS } });
    await expectGridFaces();
  });

  it('D: object-schema default columns (rows handed down)', async () => {
    renderGrid({}, { data: ROWS });
    await expectGridFaces();
  });
});
