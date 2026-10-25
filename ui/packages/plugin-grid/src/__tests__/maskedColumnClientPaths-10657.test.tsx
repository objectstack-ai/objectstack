/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The `ObjectGrid` row of objectui#10657's enumeration: the table's OWN client
 * paths, reached through the grid.
 *
 * `ObjectGrid` already stamps `TableColumn.masked` (objectui#10583), and its
 * copy, tooltip and export rows are pinned by `maskedCellCopyRefusal-10583` and
 * `maskedColumnSurfaces-10583`: they are this row's control, and this file
 * does not restate them. What those pins could not cover is where the grid
 * hands its rows to `data-table` for CLIENT search and sort: inline data
 * (`provider: 'value'`), where `manualSearch` and `manualSorting` are off. There
 * the search box matched a term against the raw credential, a header click
 * ordered the rows by it, and the auto width grew with it (objectui#10658,
 * folded into objectui#10657).
 *
 * Each case carries a `text` column in the same mounted tree as its control.
 * The masked column's type is authored on the view column, so the flag is
 * known at first paint; the object-schema window is objectui#10706's row,
 * which this file does not cover.
 */
import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ActionProvider } from '@object-ui/react';
import { registerAllFields } from '@object-ui/fields';
import { ObjectGrid } from '../ObjectGrid';

registerAllFields();

const MASK = '••••••';

// The raw keys order the rows OPPOSITE to the names.
const ROWS = [
  { id: 'r1', name: 'Ada', api_key: 'RAW-ZULU-10657' },
  { id: 'r2', name: 'Bob', api_key: 'RAW-MIKE-10657' },
  { id: 'r3', name: 'Cyd', api_key: 'RAW-ALFA-10657' },
];

const COLUMNS = [
  { field: 'name', label: 'Name' },
  { field: 'api_key', label: 'API Key', type: 'password' },
];

const ORIGINAL_INNER_WIDTH = window.innerWidth;

beforeEach(() => {
  // Desktop: the sub-768px layout is the card list, which has no data-table.
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1280 });
});

afterEach(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: ORIGINAL_INNER_WIDTH });
  cleanup();
});

function renderGrid(rows = ROWS) {
  return render(
    <ActionProvider>
      <ObjectGrid
        schema={{
          type: 'object-grid',
          objectName: 'masked_probe',
          columns: COLUMNS,
          data: { provider: 'value', items: rows },
        } as any}
      />
    </ActionProvider>,
  );
}

const header = (label: string): HTMLElement => {
  const th = Array.from(document.querySelectorAll('thead th')).find(
    (el) => (el.textContent ?? '').trim() === label,
  );
  expect(th, `CONTROL: a "${label}" header rendered`).toBeTruthy();
  return th as HTMLElement;
};

const drawnNames = () =>
  Array.from(document.querySelectorAll('tbody tr'))
    .map((tr) => ['Ada', 'Bob', 'Cyd'].find((n) => (tr.textContent ?? '').includes(n)))
    .filter(Boolean);

async function drawn() {
  await waitFor(() => expect(document.querySelector('tbody')?.textContent ?? '').toContain(MASK));
}

describe('ObjectGrid inline data — the table client paths skip a masked column (objectui#10657)', () => {
  it('the client search does not match the masked raw value; a name still matches', async () => {
    renderGrid();
    await drawn();
    const box = screen.getByPlaceholderText('Search…');
    fireEvent.change(box, { target: { value: 'Bob' } });
    expect(drawnNames(), 'CONTROL: the text column is searched').toEqual(['Bob']);
    fireEvent.change(box, { target: { value: 'ZULU' } });
    expect(drawnNames(), 'the masked raw value is not searched').toEqual([]);
  });

  it('a click on the masked header orders nothing; the text header sorts', async () => {
    renderGrid();
    await drawn();
    expect(drawnNames(), 'CONTROL: rows in their incoming order').toEqual(['Ada', 'Bob', 'Cyd']);
    fireEvent.click(header('API Key'));
    expect(drawnNames(), 'the masked header orders nothing').toEqual(['Ada', 'Bob', 'Cyd']);
    fireEvent.click(header('Name'));
    fireEvent.click(header('Name'));
    expect(drawnNames(), 'CONTROL: the text header sorts (desc)').toEqual(['Cyd', 'Bob', 'Ada']);
  });

  it('the masked column is the same width whatever its raw value; the text column still grows', async () => {
    const widthsFor = async (rows: typeof ROWS) => {
      const { unmount } = renderGrid(rows);
      await drawn();
      const out = { name: header('Name').style.width, key: header('API Key').style.width };
      unmount();
      return out;
    };
    const short = await widthsFor([{ id: 'r1', name: 'Ada', api_key: 'x' }]);
    const long = await widthsFor([
      { id: 'r1', name: 'Ada Lovelace-Byron, Countess', api_key: 'RAW-A-VERY-LONG-CREDENTIAL-10657' },
    ]);
    expect(long.name, 'CONTROL: the text column is sized from its values').not.toBe(short.name);
    expect(long.key, 'the masked column width does not follow the raw value').toBe(short.key);
  });
});
