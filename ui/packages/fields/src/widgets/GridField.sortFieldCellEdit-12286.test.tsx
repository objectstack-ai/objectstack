/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A cell edit leaves every row's `sortField` as it was (objectui#12286).
 *
 * The grid stamped `row[sortField] = index` on EVERY change, a plain cell edit
 * included. Whenever the stored positions were not already 0, 1, 2, … in the
 * order drawn (two rows tied on one position, rows with none, gaps), editing
 * one cell gave every row a new position, and a master-detail save then wrote
 * each of those rows although the user had touched one. A cell edit moves no
 * row, so it renumbers nothing; adding, removing, duplicating and moving a row
 * still renumber (the drag-reorder row is pinned in
 * `GridField.fieldKeys-11070.test.tsx`).
 *
 * The pins read the rows the grid hands to `onChange`, which is everything a
 * host persists.
 */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import type { GridFieldMetadata } from '@object-ui/types';
import { GridField } from './GridField';

const field: GridFieldMetadata = {
  type: 'grid',
  name: 'lines',
  columns: [{ name: 'description', label: 'Description', type: 'text' }],
  sortField: 'position',
};

type Row = Record<string, unknown>;

/** Render `rows`, type `value` into row `row`'s Description cell, and return what the grid handed back. */
function typeInto(rows: Row[], row: number, value: string): Row[] {
  const onChange = vi.fn();
  render(<GridField value={rows} onChange={onChange} field={field} />);
  fireEvent.change(screen.getAllByLabelText('Description')[row], { target: { value } });
  expect(onChange).toHaveBeenCalledTimes(1);
  return onChange.mock.calls[0][0];
}

describe('GridField: a cell edit renumbers no row (objectui#12286)', () => {
  it.each([
    ['tied', [{ description: 'A', position: 0 }, { description: 'B', position: 0 }]],
    ['gapped', [{ description: 'A', position: 10 }, { description: 'B', position: 20 }]],
    ['empty', [{ description: 'A', position: null }, { description: 'B', position: null }]],
    ['absent', [{ description: 'A' }, { description: 'B' }]],
  ])('%s positions: editing row 2 changes its cell and every position stays as read', (_label, rows) => {
    const next = typeInto(rows, 1, 'B2');
    expect(next).toEqual([rows[0], { ...rows[1], description: 'B2' }]);
  });

  it('CONTROL: typing into the trailing entry row ADDS a line, and an add renumbers every row', () => {
    const next = typeInto([{ description: 'A', position: 0 }, { description: 'B', position: 0 }], 2, 'C');
    expect(next.map((r) => [r.description, r.position])).toEqual([
      ['A', 0],
      ['B', 1],
      ['C', 2],
    ]);
  });
});
