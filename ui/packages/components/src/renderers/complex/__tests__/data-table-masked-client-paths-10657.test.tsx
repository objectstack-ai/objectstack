/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `TableColumn.masked` on the table's OWN client paths (objectui#10657, which
 * folded objectui#10658).
 *
 * objectui#10583 made the table withhold a masked column's raw value from the
 * keyboard copy, the `title` tooltip, the CSV export and inline edit
 * (`data-table-masked-column-10583.test.tsx`). Three more paths read it:
 *
 *  1. the client search matched a term against the raw value, so typing a
 *     substring answered "does the credential contain this?";
 *  2. the client sort ordered the rows by it, from the header and from the
 *     header's context menu, so the order said how it compared with every
 *     other row's; a manual (host-driven) sort asked the host to do the same;
 *  3. the auto width was estimated from its length, so the column grew with
 *     the credential.
 *
 * Each case is pinned three ways in the same mounted tree: the masked column
 * refuses; an ordinary `text` column behaves as before (the control that the
 * path ran at all); and, where the path has one, the SAME column with the flag
 * ABSENT answers from the raw value, so the flag is what refuses.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import '../data-table';

const MASK = '••••••';

// The raw keys order the rows OPPOSITE to the names, so a sort by either
// column is visible, and a search term that only a raw key contains is
// distinguishable from one a name contains.
const ROWS = [
  { id: '1', name: 'Ada', key: 'RAW-ZULU-10657' },
  { id: '2', name: 'Bob', key: 'RAW-MIKE-10657' },
  { id: '3', name: 'Cyd', key: 'RAW-ALFA-10657' },
];

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

type KeyColumn = { masked?: boolean; width?: number };

function tableSchema(key: KeyColumn | undefined, extra: Record<string, unknown> = {}, rows = ROWS) {
  return {
    type: 'data-table',
    data: rows,
    columns: [
      { header: 'Name', accessorKey: 'name' },
      // The producer's shape: it draws the mask through `cell` and sets the flag.
      {
        header: 'Key',
        accessorKey: 'key',
        cell: () => MASK,
        ...(key?.masked === undefined ? {} : { masked: key.masked }),
        ...(key?.width === undefined ? {} : { width: key.width }),
      },
    ],
    pagination: false,
    searchable: true,
    ...extra,
  };
}

function DataTable(props: { schema: Record<string, unknown> }) {
  const Impl = ComponentRegistry.get('data-table') as any;
  if (!Impl) throw new Error('data-table not registered');
  return <Impl schema={props.schema} />;
}

/** Names of the body rows, in the order they are drawn. */
const drawnNames = () =>
  Array.from(document.querySelectorAll('tbody tr')).map(
    (tr) => (tr.querySelector('td')?.textContent ?? '').trim(),
  );

const header = (label: string): HTMLElement => {
  const th = Array.from(document.querySelectorAll('thead th')).find(
    (el) => (el.textContent ?? '').trim() === label,
  );
  expect(th, `CONTROL: a "${label}" header rendered`).toBeTruthy();
  return th as HTMLElement;
};

const search = (term: string) =>
  fireEvent.change(screen.getByPlaceholderText('Search…'), { target: { value: term } });

describe('data-table client search leaves a masked column out (objectui#10657)', () => {
  it('a term only the masked raw value contains matches no row; a name term still matches', () => {
    render(<DataTable schema={tableSchema({ masked: true })} />);
    expect(drawnNames(), 'CONTROL: all rows drawn').toEqual(['Ada', 'Bob', 'Cyd']);

    search('Bob');
    expect(drawnNames(), 'CONTROL: the text column is searched').toEqual(['Bob']);

    search('ZULU');
    expect(screen.getByText('No results found'), 'the masked raw value is not searched').toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain('RAW-ZULU-10657');
  });

  it('CONTROL: with the flag absent the same term matches the raw value', () => {
    render(<DataTable schema={tableSchema(undefined)} />);
    search('ZULU');
    expect(drawnNames()).toEqual(['Ada']);
  });
});

describe('data-table sort is disabled on a masked column (objectui#10657)', () => {
  it('a header click on the masked column orders nothing; the name header still sorts', () => {
    render(<DataTable schema={tableSchema({ masked: true })} />);
    const keyHeader = header('Key');
    expect(keyHeader.className, 'the masked header does not read as sortable').not.toContain('cursor-pointer');
    fireEvent.click(keyHeader);
    expect(drawnNames(), 'the masked column orders nothing').toEqual(['Ada', 'Bob', 'Cyd']);

    const nameHeader = header('Name');
    expect(nameHeader.className, 'CONTROL: the text header reads as sortable').toContain('cursor-pointer');
    fireEvent.click(nameHeader);
    fireEvent.click(nameHeader);
    expect(drawnNames(), 'CONTROL: the text header sorts (desc)').toEqual(['Cyd', 'Bob', 'Ada']);
  });

  it('CONTROL: with the flag absent a header click orders the rows by the raw value', () => {
    render(<DataTable schema={tableSchema(undefined)} />);
    fireEvent.click(header('Key'));
    expect(drawnNames()).toEqual(['Cyd', 'Bob', 'Ada']);
  });

  it('the header context menu offers no sort for the masked column; it does for the text column', () => {
    render(<DataTable schema={tableSchema({ masked: true })} />);
    fireEvent.contextMenu(header('Name'));
    expect(
      within(screen.getByTestId('column-context-menu')).queryByText('Sort ascending'),
      'CONTROL: the text column offers a sort',
    ).not.toBeNull();
    fireEvent.click(document.body);

    fireEvent.contextMenu(header('Key'));
    const menu = screen.getByTestId('column-context-menu');
    expect(within(menu).queryByText('Sort ascending'), 'no sort entry for the masked column').toBeNull();
    expect(within(menu).queryByText('Sort descending')).toBeNull();
  });

  it('a sort set before the producer stamped the flag stops ordering the rows', () => {
    const { rerender } = render(<DataTable schema={tableSchema(undefined)} />);
    fireEvent.click(header('Key'));
    expect(drawnNames(), 'CONTROL: sorted by the raw value while unflagged').toEqual(['Cyd', 'Bob', 'Ada']);

    rerender(<DataTable schema={tableSchema({ masked: true })} />);
    expect(drawnNames(), 'the flag withdraws the order').toEqual(['Ada', 'Bob', 'Cyd']);
  });

  it('under manual sorting a header click asks the host for nothing on the masked column', () => {
    const onSortChange = vi.fn();
    render(<DataTable schema={tableSchema({ masked: true }, { manualSorting: true, sort: [], onSortChange })} />);
    fireEvent.click(header('Name'));
    expect(onSortChange, 'CONTROL: the text header reports its sort').toHaveBeenCalledWith([{ field: 'name', order: 'asc' }]);
    onSortChange.mockClear();

    fireEvent.click(header('Key'));
    expect(onSortChange, 'the masked header reports nothing').not.toHaveBeenCalled();
  });
});

describe('data-table sizes a masked column without reading its values (objectui#10657)', () => {
  const SHORT = [{ id: '1', name: 'Ada', key: 'x' }];
  const LONG = [{ id: '1', name: 'Ada Lovelace-Byron, Countess', key: 'RAW-A-VERY-LONG-CREDENTIAL-10657' }];

  const widthOf = (label: string) => header(label).style.width;

  function widths(key: KeyColumn | undefined, rows: typeof SHORT) {
    const { unmount } = render(<DataTable schema={tableSchema(key, {}, rows)} />);
    const out = { name: widthOf('Name'), key: widthOf('Key') };
    unmount();
    return out;
  }

  it('the masked column is the same width whatever its raw value; the text column still grows', () => {
    const short = widths({ masked: true }, SHORT);
    const long = widths({ masked: true }, LONG);
    expect(long.name, 'CONTROL: the text column is sized from its values').not.toBe(short.name);
    expect(long.key, 'the masked column width does not follow the raw value').toBe(short.key);
  });

  it('CONTROL: with the flag absent the same column is sized from the mask its cells draw', () => {
    // objectui#11682 moved every unmasked column from its stored value to what
    // its cells DRAW, so this control no longer grows with the raw value: the
    // cell draws the producer's mask whatever the value is. What still tells
    // the flag apart is the read itself: unflagged, the drawn mask sizes the
    // column; flagged, nothing in its cells is read and the header alone does.
    const short = widths(undefined, SHORT);
    const long = widths(undefined, LONG);
    expect(long.key, 'the drawn mask, not the raw value, sizes the column').toBe(short.key);
    const masked = widths({ masked: true }, SHORT);
    expect(short.key, 'the flag is what keeps the cells out of the read').not.toBe(masked.key);
  });

  it('an explicit width on a masked column is kept', () => {
    render(<DataTable schema={tableSchema({ masked: true, width: 222 })} />);
    expect(widthOf('Key')).toBe('222px');
  });
});
