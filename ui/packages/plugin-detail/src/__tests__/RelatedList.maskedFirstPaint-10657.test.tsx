/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `RelatedList` WITHHOLDS every cell it would draw from the object definition
 * while that definition is unknown (objectui#10657 — the objectui#10706 class
 * at this producer).
 *
 * ## The defect
 *
 * This list draws a cell from the OBJECT's field type (`makeCell`), never from
 * a column's authored `type`. While `getObjectSchema` was pending, and for good
 * after it rejected, no column had a cell, so the table drew every value as
 * text: a `password` field in the clear. PR 1 of this card stamped every
 * column `masked` in that window (no copy, tooltip, sort), but the stamp
 * withholds, it does not draw.
 *
 * ## The contract pinned here
 *
 * - HELD and REJECTED: the declared `password` column (and every other column
 *   with no cell of its own) draws the mask; the raw value is nowhere in the
 *   DOM, text or attribute.
 * - SETTLED: the withholding lifts — the declared `text` field draws its value
 *   — and the declared `password` field keeps the mask.
 *
 * ## Controls
 *
 * Each mount carries `Label`, a column whose `cell` the AUTHOR supplied: the
 * list attaches nothing to it, so it draws its value in every arm, which makes
 * the absence of the raw credential a reading and not a table that drew
 * nothing. Both authored column shapes are driven (bare strings and objects);
 * the auto-derived walk derives nothing without a definition, so it has no
 * window to pin.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, waitFor, cleanup, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import * as React from 'react';

// The real data-table (and its cell renderers) must be registered: this pin
// reads what they DRAW.
import '@object-ui/components';
import { RelatedList } from '../RelatedList';

const MASK = '••••••';
const RAW_KEY = 'RAW-ZULU-10657';
const CONTROL_VALUE = 'LABEL-ADA-10657';

const FIELDS = {
  name: { type: 'text', label: 'Name' },
  api_key: { type: 'password', label: 'API Key' },
};

const ROWS = [{ id: 'v1', name: 'Ada', label: CONTROL_VALUE, api_key: RAW_KEY }];

/** The author's own cell: this list attaches nothing to it. */
const LABEL_COLUMN = { field: 'label', label: 'Label', cell: (value: unknown) => String(value) };

type SchemaMode = 'held' | 'rejected';

function makeDataSource(mode: SchemaMode) {
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  return {
    release: () => release(),
    find: vi.fn(async () => ({ data: ROWS, total: ROWS.length })),
    getObjectSchema: vi.fn(async () => {
      if (mode === 'held') await held;
      if (mode === 'rejected') throw new Error('metadata unavailable');
      return { name: 'vault', fields: FIELDS };
    }),
  };
}

const SHAPES: Array<{ shape: string; columns: unknown[] }> = [
  { shape: 'bare-string columns', columns: ['name', 'api_key', LABEL_COLUMN] },
  {
    shape: 'authored object columns',
    columns: [{ field: 'name', label: 'Name' }, { field: 'api_key', label: 'API Key' }, LABEL_COLUMN],
  },
];

function mount(ds: ReturnType<typeof makeDataSource>, columns: unknown[]) {
  return render(
    <RelatedList
      title="Vault"
      type="table"
      api="vault"
      objectName="vault"
      data={ROWS}
      dataSource={ds as any}
      columns={columns as any}
    />,
  );
}

/** The body cell under the column at `index` in the first row. */
const cellAt = (index: number) => document.querySelectorAll('tbody tr')[0]!.children[index] as HTMLElement;

beforeEach(() => {
  // Desktop: below 768px this list renders an `object-gallery`, not a table.
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
});

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

/** CONTROL, then the withheld reading: the author's cell drew, the rest are masks. */
async function expectWithheld() {
  await waitFor(() => expect(cellAt(2)?.textContent, 'CONTROL: the author-supplied cell draws its value').toBe(CONTROL_VALUE));
  expect(cellAt(0).textContent, 'the `name` column is withheld too: its type is unknown').toContain(MASK);
  expect(cellAt(1).textContent, 'the `password` column draws the mask').toContain(MASK);
  // Text OR attribute: nowhere in the DOM.
  expect(document.body.innerHTML, 'the raw credential is nowhere in the DOM').not.toContain(RAW_KEY);
}

describe('RelatedList — a cell is withheld while the object definition is unknown (objectui#10657)', () => {
  for (const { shape, columns } of SHAPES) {
    describe(shape, () => {
      it('HELD: every definition-drawn cell is the mask; the author cell draws', async () => {
        const ds = makeDataSource('held');
        mount(ds, columns);
        await waitFor(() => expect(ds.getObjectSchema).toHaveBeenCalled());
        await expectWithheld();
      });

      it('REJECTED: a failed read keeps them withheld — fail closed, never back to text', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        const ds = makeDataSource('rejected');
        mount(ds, columns);
        // `useSettledSchema` reports the failed read: the settle has happened.
        await waitFor(() => expect(error).toHaveBeenCalled());
        await act(async () => {});
        await expectWithheld();
      });

      it('SETTLED: the declared text field draws; the declared password keeps the mask', async () => {
        const ds = makeDataSource('held');
        mount(ds, columns);
        await expectWithheld();
        await act(async () => { ds.release(); });
        // CONTROL — the withholding lifts for a field the object declares `text`.
        await waitFor(() => expect(cellAt(0).textContent).toBe('Ada'));
        expect(cellAt(1).textContent, 'the declared password is masked').toContain(MASK);
        expect(cellAt(2).textContent).toBe(CONTROL_VALUE);
        expect(document.body.innerHTML).not.toContain(RAW_KEY);
      });
    });
  }
});
