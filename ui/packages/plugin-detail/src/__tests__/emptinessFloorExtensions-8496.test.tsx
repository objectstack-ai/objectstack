/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `@object-ui/plugin-detail`'s two emptiness answers, stated as a DISAGREEMENT
 * with the shared floor (objectui#8496, option B).
 *
 * Both `hasCellValue` and `RelatedList.isValueEmpty` now call
 * `@object-ui/core`'s `isEmptyValue` for the four members they used to spell
 * privately. What this file pins is the part the floor does NOT carry:
 *
 *  - the TRIM. `'   '` is a value to the floor, and empty on both of these
 *    surfaces — objectui#8350 measured what a visually blank cell costs on
 *    `record:details`, and objectui#8459 measured the same for a grid cell;
 *  - the REFUSALS. `{}`, a `Date`, `0` and `false` are values here, so a floor
 *    that grew any of them would be red below.
 *
 * ⛔ And the two predicates stay TWO. objectui#8459 measured `RelatedList`'s as
 * the better-shaped answer for a grid and pinned it as deliberately separate; a
 * shared floor is not permission to merge them.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import * as React from 'react';
import { isEmptyValue } from '@object-ui/core';

// The real data-table and its cell renderers must be registered — the DOM case
// below reads what they DRAW.
import '@object-ui/components';
import { hasCellValue } from '../emptiness';
import { RelatedList } from '../RelatedList';

const EM_DASH = '—';

/** Desktop: `RelatedList` renders a gallery, not a table, on mobile. */
beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
});

describe('objectui#8496 — plugin-detail extends the floor, and is not flattened into it', () => {
  describe('THE FLOOR REACHED — hasCellValue answers all four members', () => {
    for (const [label, value] of [
      ['null', null],
      ['undefined', undefined],
      ["''", ''],
      ['[]', []],
    ] as Array<[string, unknown]>) {
      it(`${label} has NO cell value`, () => {
        expect(isEmptyValue(value), `CONTROL: ${label} is a floor member`).toBe(true);
        expect(hasCellValue(value), `${label}: the floor member lost its answer here`).toBe(false);
      });
    }
  });

  describe('⛔ NOT FLATTENED — the TRIM, which the floor does not have', () => {
    for (const blank of ['   ', '\t', '\n  ']) {
      it(`a whitespace-only string (${JSON.stringify(blank)}) is EMPTY here and a VALUE to the floor`, () => {
        expect(
          isEmptyValue(blank),
          'CONTROL: the floor deliberately keeps whitespace a value — the gallery and the kanban rely on that',
        ).toBe(false);
        expect(
          hasCellValue(blank),
          'the trim is this surface’s extension (objectui#8350); losing it repaints the blank cell',
        ).toBe(false);
      });
    }

    it('the extension is visible one layer up: a whitespace-only grid cell draws the em-dash', async () => {
      expect(isEmptyValue('   '), 'CONTROL: the floor says this is a value').toBe(false);

      const dataSource = {
        getObjectSchema: vi.fn(async () => ({
          name: 'line',
          fields: {
            product: { type: 'text', label: 'Product' },
            note: { type: 'text', label: 'Note' },
          },
        })),
        find: vi.fn(async () => ({
          data: [
            { id: '1', product: 'Widget', note: '   ' },
            { id: '2', product: 'Gadget', note: 'real note' },
          ],
          total: 2,
        })),
      };

      const { container } = render(
        <RelatedList
          title="Lines"
          type="table"
          api="line"
          objectName="line"
          referenceField="invoice"
          parentId="INV-1"
          dataSource={dataSource as any}
        />,
      );
      await waitFor(() => expect(container.querySelector('table')).not.toBeNull());
      await waitFor(() => expect(container.textContent).toContain('Widget'));

      const headers = Array.from(container.querySelectorAll('th')).map((th) =>
        (th.textContent ?? '').trim(),
      );
      const idx = headers.indexOf('Note');
      expect(idx, 'the Note column survives — one row has a value').toBeGreaterThanOrEqual(0);

      const rows = container.querySelectorAll('tbody tr');
      const blankCell = rows[0]?.querySelectorAll('td')[idx];
      expect(
        (blankCell?.textContent ?? '').trim(),
        'RelatedList still trims: the whitespace-only cell draws the placeholder, not a blank',
      ).toBe(EM_DASH);
      // CONTROL: the same column rendered BY VALUE for the sibling row.
      const realCell = rows[1]?.querySelectorAll('td')[idx];
      expect((realCell?.textContent ?? '').trim(), 'CONTROL: the populated cell renders').toBe(
        'real note',
      );
    });
  });

  describe('⛔ NOT FLATTENED — the members hasCellValue refuses to let the floor grow', () => {
    for (const [label, value, why] of [
      ['{}', {}, 'objectui#8474 measured it a VALUE: a type-aware renderer draws the literal'],
      ['{ a: 1 }', { a: 1 }, 'a populated object is drawn by its type-aware renderer'],
      ['[1]', [1], 'one entry is one thing to draw'],
      ['0', 0, 'a stored zero is a value'],
      ['false', false, 'a stored false is a value'],
      ['new Date(0)', new Date(0), 'Object.keys() is empty on it — the false-empty shape the docblock refuses'],
      ['a populated Map', new Map([['a', 1]]), 'same false-empty shape'],
    ] as Array<[string, unknown, string]>) {
      it(`${label} is a VALUE — ${why}`, () => {
        expect(isEmptyValue(value), `CONTROL: ${label} is not a floor member`).toBe(false);
        expect(hasCellValue(value), `${label}: ${why}`).toBe(true);
      });
    }
  });
});
