/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A MASKED grid cell withholds its raw value from the keyboard copy and the
 * tooltip (objectui#10583). The other grid surfaces are pinned in
 * `maskedColumnSurfaces-10583.test.tsx`.
 *
 * ## The defect
 *
 * `@object-ui/fields` draws `password` and `secret` cells as `••••••`. The
 * grid drew the mask, and `data-table`'s Ctrl+C / Cmd+C handler copied
 * `String(row[columnKey])` for EVERY focused cell anyway — so the keyboard
 * handed the raw credential to `navigator.clipboard.writeText`, silently. The
 * same cell's wrapper also carried the raw value as its `title` tooltip, so a
 * hover showed it and the DOM held it.
 *
 * The detail page closed the same class on its own surface (objectui#8440,
 * maintainer ruling 2026-09-08, option A: no copy affordance on masked field
 * types; copying the bullets was refused as a second silent wrong answer). The
 * grid follows that house shape:
 *
 * - `ObjectGrid` (the producer) asks `isMaskedFieldType()` from
 *   `@object-ui/fields` (objectui#8686) and stamps `masked: true` on the column;
 * - `data-table` (which cannot import `@object-ui/fields`) obeys the flag —
 *   nothing is written to the clipboard, and no raw `title` is drawn.
 *
 * ## Narrow-only, like the detail page
 *
 * The flag is the UNION of the view-authored type and the object-declared type
 * (`isMaskedDetailFieldType`'s shape, objectui#3355): a view authoring
 * `type: 'text'` over a `secret` column never restores the copy.
 *
 * ## Every case carries a CONTROL in the same mounted tree
 *
 * The pin is absence-shaped ("the spy was not called"), which also passes when
 * the cell never rendered or the event never landed. So each case first fires
 * the SAME keystroke on an ordinary `text` cell and requires the spy to
 * receive that cell's value, and only then requires silence from the masked
 * cell. Absence is counted AT THE SPY.
 *
 * All three column-emit shapes are exercised (configured `ListColumn[]`, a
 * string array, and the object-schema default), because the flag is stamped at
 * the one emit seam every one of them passes through.
 */

import React from 'react';
import { describe, it, expect, afterEach, beforeAll, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ActionProvider, SchemaRendererProvider } from '@object-ui/react';
import { registerAllFields } from '@object-ui/fields';
import { ObjectGrid } from '../ObjectGrid';

registerAllFields();

const RAW_PASSWORD = 'RAW-PASSWORD-10583';
const RAW_SECRET = 'RAW-SECRET-10583';
const RAW_VAULT = 'RAW-VAULT-10583';
const CONTROL_VALUE = 'Row one';
const MASK = '••••••';

const ROWS = [
  { id: 'r1', name: CONTROL_VALUE, api_key: RAW_PASSWORD, token: RAW_SECRET, vault_key: RAW_VAULT },
];

const FIELDS = {
  id: { type: 'text' },
  name: { type: 'text', label: 'Name' },
  api_key: { type: 'password', label: 'API Key' },
  token: { type: 'secret', label: 'Token' },
  vault_key: { type: 'secret', label: 'Vault Key' },
};

function makeDataSource() {
  return {
    find: vi.fn(async () => ({ data: ROWS, total: ROWS.length, hasMore: false, pageSize: 50 })),
    getObjectSchema: vi.fn(async (name: string) => ({ name, fields: FIELDS })),
  } as any;
}

let writeText: ReturnType<typeof vi.fn>;
const ORIGINAL_INNER_WIDTH = window.innerWidth;

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as any;
  }
});

beforeEach(() => {
  // Desktop: the sub-768px layout is the card list, which has no data-table.
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1280 });
  writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
});

afterEach(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: ORIGINAL_INNER_WIDTH });
  cleanup();
});

function renderGrid(columns: unknown) {
  const ds = makeDataSource();
  return render(
    <ActionProvider>
      <SchemaRendererProvider dataSource={ds}>
        <ObjectGrid
          schema={{
            type: 'object-grid',
            objectName: 'masked_probe',
            ...(columns === undefined ? {} : { columns }),
            pagination: { pageSize: 50 },
          } as any}
          dataSource={ds}
        />
      </SchemaRendererProvider>
    </ActionProvider>,
  );
}

/** The body cell under the header whose text is `label`, in the control row. */
function cellUnder(label: string): HTMLElement {
  const row = screen.getByText(CONTROL_VALUE).closest('tr');
  expect(row, 'CONTROL: the data row rendered').not.toBeNull();
  const table = row!.closest('table')!;
  const headers = Array.from(table.querySelectorAll('thead th'));
  const index = headers.findIndex((th) => (th.textContent ?? '').trim() === label);
  expect(index, `CONTROL: a "${label}" column header rendered`).toBeGreaterThanOrEqual(0);
  const cell = row!.children[index] as HTMLElement | undefined;
  expect(cell?.tagName, `CONTROL: the "${label}" body cell exists`).toBe('TD');
  return cell!;
}

const payloads = () => writeText.mock.calls.map((call) => call[0]);

const COPY_KEYS = [
  { chord: 'Ctrl+C', init: { key: 'c', ctrlKey: true } },
  { chord: 'Cmd+C', init: { key: 'c', metaKey: true } },
];

const SHAPES: Array<{ shape: string; columns: unknown; authoredTextOverSecret: boolean }> = [
  {
    shape: 'configured ListColumn[]',
    columns: [
      { field: 'name', label: 'Name' },
      { field: 'api_key', label: 'API Key' },
      { field: 'token', label: 'Token' },
      // The narrow-only case: a PRESENTATION override over a `secret` column.
      { field: 'vault_key', label: 'Vault Key', type: 'text' },
    ],
    authoredTextOverSecret: true,
  },
  { shape: 'string array', columns: ['name', 'api_key', 'token'], authoredTextOverSecret: false },
  { shape: 'object-schema default (no columns)', columns: undefined, authoredTextOverSecret: false },
];

describe('ObjectGrid — a masked cell writes nothing to the clipboard (objectui#10583)', () => {
  for (const { shape, columns, authoredTextOverSecret } of SHAPES) {
    for (const { chord, init } of COPY_KEYS) {
      it(`${shape} — ${chord} on a password / secret cell copies nothing; the text control copies its value`, async () => {
        renderGrid(columns);
        await waitFor(() => expect(screen.queryByText(CONTROL_VALUE)).not.toBeNull());

        // CONTROL — the SAME chord on an ordinary text cell reaches the spy,
        // in this same mounted tree.
        fireEvent.keyDown(cellUnder('Name'), init);
        expect(payloads(), 'CONTROL: the text cell copies its own value').toEqual([CONTROL_VALUE]);
        writeText.mockClear();

        for (const [label, raw] of [['API Key', RAW_PASSWORD], ['Token', RAW_SECRET]] as const) {
          const cell = cellUnder(label);
          // CONTROL — the masked cell rendered, and rendered the MASK.
          expect(cell.textContent, `CONTROL: the "${label}" cell drew the mask`).toContain(MASK);
          fireEvent.keyDown(cell, init);
          expect(payloads(), `${label}: ${chord} must write nothing`).toEqual([]);
          // Not in the DOM at all — text OR attribute (the `title` tooltip).
          expect(document.body.innerHTML, `${label}: the raw value is nowhere in the DOM`).not.toContain(raw);
        }

        if (authoredTextOverSecret) {
          // Narrow-only: `type: 'text'` authored over a `secret` column never
          // restores the copy.
          fireEvent.keyDown(cellUnder('Vault Key'), init);
          expect(payloads(), 'Vault Key (text over secret): the copy stays refused').toEqual([]);
        }
      });
    }
  }
});
