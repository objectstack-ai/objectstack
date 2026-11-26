/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `TableColumn.masked` — the table withholds a masked column's raw value on the
 * paths it owns (objectui#10583).
 *
 * The producer (`ObjectGrid`, from `isMaskedFieldType()`) draws the mask
 * through `cell` and sets the flag; this table cannot import
 * `@object-ui/fields`, so it obeys the flag on every path IT owns that put the
 * raw value somewhere else:
 *
 *  1. Ctrl+C / Cmd+C on a focused cell — wrote `String(row[accessorKey])`;
 *  2. the cell wrapper's `title` tooltip — carried the raw value into the DOM;
 *  3. the toolbar's CSV export — wrote every column's raw value;
 *  4. inline edit — `startEdit` seeded the editor with the raw row value, so
 *     any editor (built-in input or a host's `renderCellEditor`) drew it.
 *
 * Each path is pinned three ways in ONE file, so an absence can never pass by
 * never running: the masked column refuses; an ordinary column in the same
 * table behaves as before; and the SAME column with the flag ABSENT hands the
 * value out, which proves the flag — not the test's shape — is what refuses.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { GridCellSelectionProvider } from '../../../context/gridCellSelection';
import '@testing-library/jest-dom';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { TableColumnSchema } from '@object-ui/types/zod';
import '../data-table';

const RAW = 'RAW-KEY-10583';
const MASK = '••••••';
const CONTROL = 'Ada';
const ROWS = [{ id: '1', name: CONTROL, key: RAW }];

let writeText: ReturnType<typeof vi.fn>;
let createObjectURL: ReturnType<typeof vi.fn>;

beforeEach(() => {
  writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  createObjectURL = vi.fn(() => 'blob:objectui-10583');
  Object.defineProperty(window.URL, 'createObjectURL', { configurable: true, value: createObjectURL });
  Object.defineProperty(window.URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

/**
 * `masked` undefined ⇒ the key is ABSENT from the column, not `false`. An
 * editable table is mounted select-first with a per-cell save, the one way it
 * edits (objectstack#35827).
 */
function renderTable(masked: boolean | undefined, extra: Record<string, unknown> = {}) {
  const DataTable = ComponentRegistry.get('data-table') as any;
  if (!DataTable) throw new Error('data-table not registered');
  const table = (
    <DataTable
      schema={{
        type: 'data-table',
        data: ROWS,
        columns: [
          { header: 'Name', accessorKey: 'name' },
          // The producer's shape: it draws the mask through `cell` and sets the flag.
          { header: 'Key', accessorKey: 'key', cell: () => MASK, ...(masked === undefined ? {} : { masked }) },
        ],
        pagination: false,
        searchable: false,
        exportable: true,
        ...(extra.editable ? { onRowSave: () => Promise.resolve() } : {}),
        ...extra,
      }}
    />
  );
  return render(extra.editable ? <GridCellSelectionProvider value={{}}>{table}</GridCellSelectionProvider> : table);
}

/** The body cell under the header `label`. */
function cellUnder(label: string): HTMLElement {
  const headers = Array.from(document.querySelectorAll('thead th'));
  const index = headers.findIndex((th) => (th.textContent ?? '').trim() === label);
  expect(index, `CONTROL: a "${label}" header rendered`).toBeGreaterThanOrEqual(0);
  const cell = document.querySelector('tbody tr')?.children[index] as HTMLElement | undefined;
  expect(cell?.tagName, `CONTROL: the "${label}" body cell exists`).toBe('TD');
  return cell!;
}

const payloads = () => writeText.mock.calls.map((call) => call[0]);

async function exportedCsv(): Promise<string> {
  fireEvent.click(screen.getByRole('button', { name: /Export CSV/ }));
  expect(createObjectURL, 'CONTROL: the export produced a file').toHaveBeenCalledTimes(1);
  // The file opens with one UTF-8 byte-order mark (pinned at the byte level in
  // data-table-csvByteOrderMark-34420.test.tsx); these pins read the text after it.
  return (await (createObjectURL.mock.calls[0]![0] as Blob).text()).replace(/^\uFEFF/, '');
}

describe('data-table — `masked: true` withholds the raw value (objectui#10583)', () => {
  for (const [chord, init] of [
    ['Ctrl+C', { key: 'c', ctrlKey: true }],
    ['Cmd+C', { key: 'c', metaKey: true }],
  ] as const) {
    it(`${chord} on a masked cell writes nothing; the ordinary cell copies its value`, () => {
      renderTable(true);
      fireEvent.keyDown(cellUnder('Name'), init);
      expect(payloads(), 'CONTROL: the ordinary cell copies').toEqual([CONTROL]);
      writeText.mockClear();

      const masked = cellUnder('Key');
      expect(masked.textContent, 'CONTROL: the producer drew the mask').toContain(MASK);
      fireEvent.keyDown(masked, init);
      expect(payloads(), 'the masked cell writes nothing').toEqual([]);
    });
  }

  it('draws no `title` tooltip on a masked cell — the raw value is nowhere in the DOM', () => {
    renderTable(true);
    expect(
      cellUnder('Name').querySelector('[title]')?.getAttribute('title'),
      'CONTROL: an ordinary cell keeps its tooltip',
    ).toBe(CONTROL);
    expect(cellUnder('Key').querySelector('[title]'), 'the masked cell carries no tooltip').toBeNull();
    expect(document.body.innerHTML).not.toContain(RAW);
  });

  it('omits a masked column from the CSV export, header and all', async () => {
    renderTable(true);
    const csv = await exportedCsv();
    expect(csv, 'CONTROL: the ordinary column is exported').toContain(`"${CONTROL}"`);
    expect(csv.split('\n')[0], 'the header row names only the ordinary column').toBe('Name');
    expect(csv).not.toContain(RAW);
  });
});

describe('data-table — the flag ABSENT behaves exactly as before (objectui#10583 control)', () => {
  it('Ctrl+C copies the raw value, the tooltip carries it, the export writes it', async () => {
    renderTable(undefined);
    fireEvent.keyDown(cellUnder('Key'), { key: 'c', ctrlKey: true });
    expect(payloads()).toEqual([RAW]);
    expect(cellUnder('Key').querySelector('[title]')?.getAttribute('title')).toBe(RAW);
    const csv = await exportedCsv();
    expect(csv.split('\n')[0]).toBe('Name,Key');
    expect(csv).toContain(`"${RAW}"`);
  });

  it('`masked: false` is the same as absent', () => {
    renderTable(false);
    fireEvent.keyDown(cellUnder('Key'), { key: 'c', ctrlKey: true });
    expect(payloads()).toEqual([RAW]);
  });
});

describe('`masked` is declared on the rich column mirror (objectui#10583)', () => {
  it('SURVIVES the zod parse — a non-strict object would otherwise strip it silently', () => {
    const parsed = TableColumnSchema.safeParse({ header: 'Key', accessorKey: 'key', masked: true });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.masked).toBe(true);
    // A value of the wrong type is refused by name, not coerced.
    const wrong = TableColumnSchema.safeParse({ header: 'Key', accessorKey: 'key', masked: 'yes' });
    expect(wrong.success).toBe(false);
    if (!wrong.success) expect(wrong.error.issues.map((i) => String(i.path[0]))).toContain('masked');
  });
});

describe('data-table — a masked column never enters edit mode (objectui#10583)', () => {
  /** Every editor this table can draw is an input or a textarea. */
  const rawInAnEditor = () =>
    Array.from(document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')).some((el) =>
      el.value.includes(RAW),
    );

  const catcher = () => document.querySelector<HTMLInputElement>('[data-slot="cell-type-catcher"]')!;

  it('double-click, Enter and typing open no editor on a masked cell; the ordinary cell still edits', () => {
    renderTable(true, { editable: true });
    const masked = cellUnder('Key');
    expect(masked.textContent, 'CONTROL: the producer drew the mask').toContain(MASK);
    expect(masked.className, 'no edit cursor on a masked cell').not.toContain('cursor-text');

    fireEvent.click(masked);
    fireEvent.doubleClick(masked);
    fireEvent.keyDown(catcher(), { key: 'Enter' });
    fireEvent.change(catcher(), { target: { value: 'x' } });
    expect(document.querySelector('td[data-editing-cell]'), 'no editor in the masked cell').toBeNull();
    expect(rawInAnEditor(), 'no editor holds the raw value').toBe(false);
    expect(document.body.innerHTML).not.toContain(RAW);

    // CONTROL — the ordinary column in the SAME table does open its editor.
    fireEvent.click(cellUnder('Name'));
    fireEvent.doubleClick(cellUnder('Name'));
    expect(document.querySelector('td[data-editing-cell] input'), 'CONTROL: the ordinary cell edits').not.toBeNull();
  });

  // The "single-click mode" case pinned the staged arm's click-to-edit and its
  // click reaching the row; that arm is retired (objectstack#35827), and a
  // click now only selects a cell.

  it('CONTROL — the same column with the flag ABSENT edits exactly as before', () => {
    renderTable(undefined, { editable: true });
    fireEvent.click(cellUnder('Key'));
    fireEvent.doubleClick(cellUnder('Key'));
    expect(rawInAnEditor(), 'without the flag the editor is seeded with the stored value').toBe(true);
  });
});
