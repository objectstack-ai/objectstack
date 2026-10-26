/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ObjectDataTable` stamps `TableColumn.masked` on the columns it hands its
 * data-table (objectui#10657).
 *
 * The dashboard table widget draws a `password` / `secret` cell as `••••••`
 * through `getCellRenderer`. It never set the flag, so the table (which cannot
 * import `@object-ui/fields`) handed the raw value out anyway. This widget is
 * also where the table's OWN client paths are reachable by default: it hands
 * `data-table` no `manualSearch` and no `manualSorting`, so the search box and
 * the header sort run in the browser, over the raw values (objectui#10658,
 * folded into objectui#10657). The paths pinned here:
 *
 *  - Ctrl+C / Cmd+C on the masked cell;
 *  - the cell's `title` tooltip;
 *  - the table's CSV export (the widget authors `exportable: true`);
 *  - the client search box;
 *  - the header sort;
 *  - the auto width.
 *
 * Every case drives the REAL renderers through the registry and carries a
 * `text` column in the same mounted tree as its control.
 *
 * The fail-closed arm: bound and inline rows paint before the object
 * definition lands, and a failed read settles with none. In that window the
 * widget cannot tell a masked column from any other, so every column is
 * stamped.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
// Registers `object-data-table` (and, through its imports, `data-table`).
import '../index';

const MASK = '••••••';

const FIELDS = {
  name: { type: 'text', label: 'Name' },
  api_key: { type: 'password', label: 'API Key' },
  token: { type: 'secret', label: 'Token' },
};

// The raw keys order the rows OPPOSITE to the names, so a sort by either
// column is visible, and a term only a raw key contains is distinguishable.
const ROWS = [
  { id: 'v1', name: 'Ada', api_key: 'RAW-ZULU-10657', token: 'RAW-TOKEN-A' },
  { id: 'v2', name: 'Bob', api_key: 'RAW-MIKE-10657', token: 'RAW-TOKEN-B' },
  { id: 'v3', name: 'Cyd', api_key: 'RAW-ALFA-10657', token: 'RAW-TOKEN-C' },
];

let writeText: ReturnType<typeof vi.fn>;
let createObjectURL: ReturnType<typeof vi.fn>;

beforeEach(() => {
  // Best-effort metadata probes are not what these cases are about.
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '{}' })));
  writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  createObjectURL = vi.fn(() => 'blob:objectui-10657');
  Object.defineProperty(window.URL, 'createObjectURL', { configurable: true, value: createObjectURL });
  Object.defineProperty(window.URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  cleanup();
});

type SchemaMode = 'settled' | 'held' | 'rejected';

function makeDataSource(mode: SchemaMode = 'settled', rows = ROWS) {
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  return {
    release: () => release(),
    find: vi.fn(async () => ({ data: rows, total: rows.length })),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => {
      if (mode === 'held') await held;
      if (mode === 'rejected') throw new Error('metadata unavailable');
      return { name: 'vault', fields: FIELDS };
    }),
  };
}

function mount(ds: ReturnType<typeof makeDataSource>, widget: Record<string, unknown> = {}) {
  const schema = { type: 'object-data-table', objectName: 'vault', exportable: true, ...widget };
  return render(
    <SchemaRendererProvider dataSource={ds as any}>
      <SchemaRenderer schema={schema as any} />
    </SchemaRendererProvider>,
  );
}

const headerTexts = () =>
  Array.from(document.querySelectorAll('thead th')).map((th) => (th.textContent ?? '').trim());

const header = (label: string): HTMLElement => {
  const th = Array.from(document.querySelectorAll('thead th')).find(
    (el) => (el.textContent ?? '').trim() === label,
  );
  expect(th, `CONTROL: a "${label}" header rendered (headers: ${headerTexts().join(' | ')})`).toBeTruthy();
  return th as HTMLElement;
};

function cellUnder(label: string, name = 'Ada'): HTMLElement {
  const index = headerTexts().indexOf(label);
  expect(index, `CONTROL: a "${label}" header rendered`).toBeGreaterThanOrEqual(0);
  const row = Array.from(document.querySelectorAll('tbody tr')).find((tr) =>
    (tr.textContent ?? '').includes(name),
  );
  expect(row, `CONTROL: the "${name}" row rendered`).toBeTruthy();
  const cell = row!.children[index] as HTMLElement | undefined;
  expect(cell?.tagName, `CONTROL: the "${label}" body cell exists`).toBe('TD');
  return cell!;
}

const drawnNames = () =>
  Array.from(document.querySelectorAll('tbody tr'))
    .map((tr) => ['Ada', 'Bob', 'Cyd'].find((n) => (tr.textContent ?? '').includes(n)))
    .filter(Boolean);

const payloads = () => writeText.mock.calls.map((call) => call[0]);

async function settledWithMask() {
  await waitFor(() => expect(document.querySelector('tbody')?.textContent ?? '').toContain(MASK));
}

const SHAPES: Array<{ shape: string; widget: Record<string, unknown>; key: string; token: string }> = [
  {
    shape: 'declared columns',
    widget: {
      columns: [
        { field: 'name', label: 'Name' },
        { field: 'api_key', label: 'API Key' },
        { field: 'token', label: 'Token' },
      ],
    },
    key: 'API Key',
    token: 'Token',
  },
  // Auto-derived headers are the humanized keys.
  { shape: 'auto-derived columns', widget: {}, key: 'Api Key', token: 'Token' },
];

describe('ObjectDataTable — a masked column is withheld on every table path (objectui#10657)', () => {
  for (const { shape, widget, key, token } of SHAPES) {
    describe(shape, () => {
      it('Ctrl+C / Cmd+C on the masked cells writes nothing; the text cell copies', async () => {
        mount(makeDataSource(), widget);
        await settledWithMask();
        for (const init of [{ key: 'c', ctrlKey: true }, { key: 'c', metaKey: true }]) {
          writeText.mockClear();
          fireEvent.keyDown(cellUnder('Name'), init);
          expect(payloads(), 'CONTROL: the text cell copies').toEqual(['Ada']);
          writeText.mockClear();
          expect(cellUnder(key).textContent, 'CONTROL: the widget drew the mask').toContain(MASK);
          fireEvent.keyDown(cellUnder(key), init);
          fireEvent.keyDown(cellUnder(token), init);
          expect(payloads(), 'the masked cells write nothing').toEqual([]);
        }
      });

      it('the masked cells have no `title` tooltip; the raw values are nowhere in the DOM', async () => {
        mount(makeDataSource(), widget);
        await settledWithMask();
        expect(
          cellUnder('Name').querySelector('[title]')?.getAttribute('title'),
          'CONTROL: the text cell keeps its tooltip',
        ).toBe('Ada');
        expect(cellUnder(key).querySelector('[title]'), 'no tooltip on the password cell').toBeNull();
        expect(cellUnder(token).querySelector('[title]'), 'no tooltip on the secret cell').toBeNull();
        expect(document.body.innerHTML).not.toContain('RAW-ZULU-10657');
        expect(document.body.innerHTML).not.toContain('RAW-TOKEN-A');
      });

      it('the CSV export leaves the masked columns out; the text column is exported', async () => {
        mount(makeDataSource(), widget);
        await settledWithMask();
        fireEvent.click(screen.getByRole('button', { name: /Export CSV/ }));
        expect(createObjectURL, 'CONTROL: the export produced a file').toHaveBeenCalledTimes(1);
        const csv = await (createObjectURL.mock.calls[0]![0] as Blob).text();
        expect(csv, 'CONTROL: the text column is exported').toContain('"Ada"');
        expect(csv.split('\n')[0], 'the header row names only the text column').toBe('Name');
        expect(csv).not.toContain('RAW-');
      });

      it('the client search does not match the masked raw values; a name still matches', async () => {
        mount(makeDataSource(), widget);
        await settledWithMask();
        const box = screen.getByPlaceholderText('Search…');
        fireEvent.change(box, { target: { value: 'Bob' } });
        expect(drawnNames(), 'CONTROL: the text column is searched').toEqual(['Bob']);
        fireEvent.change(box, { target: { value: 'ZULU' } });
        expect(screen.getByText('No results found'), 'the password raw value is not searched').toBeInTheDocument();
        fireEvent.change(box, { target: { value: 'RAW-TOKEN-A' } });
        expect(screen.getByText('No results found'), 'the secret raw value is not searched').toBeInTheDocument();
      });

      it('a click on the masked header orders nothing; the text header sorts', async () => {
        mount(makeDataSource(), widget);
        await settledWithMask();
        expect(drawnNames(), 'CONTROL: rows in their incoming order').toEqual(['Ada', 'Bob', 'Cyd']);
        expect(header(key).className, 'the masked header does not read as sortable').not.toContain('cursor-pointer');
        fireEvent.click(header(key));
        expect(drawnNames(), 'the masked header orders nothing').toEqual(['Ada', 'Bob', 'Cyd']);
        fireEvent.click(header('Name'));
        fireEvent.click(header('Name'));
        expect(drawnNames(), 'CONTROL: the text header sorts (desc)').toEqual(['Cyd', 'Bob', 'Ada']);
      });
    });
  }

  it('the masked column is the same width whatever its raw value; the text column still grows', async () => {
    const widthsFor = async (rows: typeof ROWS) => {
      const { unmount } = mount(makeDataSource('settled', rows), SHAPES[0]!.widget);
      await settledWithMask();
      const out = { name: header('Name').style.width, key: header('API Key').style.width };
      unmount();
      return out;
    };
    const short = await widthsFor([{ id: 'v1', name: 'Ada', api_key: 'x', token: 'y' }]);
    const long = await widthsFor([
      { id: 'v1', name: 'Ada Lovelace-Byron, Countess', api_key: 'RAW-A-VERY-LONG-CREDENTIAL-10657', token: 'y' },
    ]);
    expect(long.name, 'CONTROL: the text column is sized from its values').not.toBe(short.name);
    expect(long.key, 'the masked column width does not follow the raw value').toBe(short.key);
  });
});

describe('ObjectDataTable — fail closed while the object types are unknown (objectui#10657)', () => {
  // `Name` AUTHORS `type: 'text'`, so it draws inside the window: an untyped
  // column there is withheld from the DRAW too (objectui#10657 PR 2, pinned in
  // `ObjectDataTable.maskedFirstPaint-10657`). This file pins the FLAG, which
  // still stamps every column, typed or not, until the types are known.
  const inline = { data: ROWS, columns: [{ field: 'name', label: 'Name', type: 'text' }, { field: 'api_key', label: 'API Key' }] };

  it('inline rows paint before the definition lands: no cell copies until it does', async () => {
    const ds = makeDataSource('held');
    mount(ds, inline);
    await waitFor(() => expect(screen.getByText('Ada')).toBeInTheDocument());
    fireEvent.keyDown(cellUnder('Name'), { key: 'c', ctrlKey: true });
    fireEvent.keyDown(cellUnder('API Key'), { key: 'c', ctrlKey: true });
    expect(payloads(), 'no column can be told apart from a masked one yet').toEqual([]);

    await act(async () => { ds.release(); });
    await settledWithMask();
    fireEvent.keyDown(cellUnder('Name'), { key: 'c', ctrlKey: true });
    fireEvent.keyDown(cellUnder('API Key'), { key: 'c', ctrlKey: true });
    expect(payloads(), 'CONTROL: the text cell copies once the types are known').toEqual(['Ada']);
  });

  it('after a failed definition read no cell copies and no header sorts', async () => {
    const ds = makeDataSource('rejected');
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    mount(ds, inline);
    await waitFor(() => expect(ds.getObjectSchema).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText('Ada')).toBeInTheDocument());
    await act(async () => {});
    fireEvent.keyDown(cellUnder('Name'), { key: 'c', ctrlKey: true });
    fireEvent.keyDown(cellUnder('API Key'), { key: 'c', ctrlKey: true });
    expect(payloads(), 'a failed read leaves every column withheld').toEqual([]);
    fireEvent.click(header('API Key'));
    expect(drawnNames(), 'no order by the unknown column').toEqual(['Ada', 'Bob', 'Cyd']);
    error.mockRestore();
  });
});
