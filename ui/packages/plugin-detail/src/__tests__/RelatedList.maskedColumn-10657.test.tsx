/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `RelatedList` stamps `TableColumn.masked` on the columns it hands its
 * data-table (objectui#10657).
 *
 * This list draws a `password` / `secret` cell as `••••••` through
 * `getCellRenderer`. It never set the flag, so the table it feeds (which
 * cannot import `@object-ui/fields`) handed the raw value out anyway:
 *
 *  - Ctrl+C / Cmd+C on the masked cell wrote the raw credential;
 *  - the cell's `title` tooltip carried it into the DOM;
 *  - the table's headers drive THIS list's sort, so a click on the masked
 *    column's header ordered the rows by the credential;
 *  - the column's auto width grew with the credential's length.
 *
 * The table's CSV export is not reachable here: this list hands the table
 * `exportable: false`, which the last case pins so the row is not silently
 * vacuous.
 *
 * Every case drives the REAL renderers (`SchemaRenderer` is not mocked) and
 * carries a `text` column in the same mounted tree as its control: an absence
 * assertion also passes when the cell never rendered or the event never
 * landed, so the control has to answer first.
 *
 * The fail-closed arm: while the object definition is in flight, or after its
 * read failed, the list cannot tell a masked column from any other, so every
 * column is stamped.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import * as React from 'react';

// The real data-table (and its cell renderers) must be registered: this pin
// reads what they DRAW and what they hand out.
import '@object-ui/components';
import { RelatedList } from '../RelatedList';

const MASK = '••••••';
const RAW_PASSWORD = 'RAW-PASSWORD-10657';

const FIELDS = {
  name: { type: 'text', label: 'Name' },
  api_key: { type: 'password', label: 'API Key' },
  token: { type: 'secret', label: 'Token' },
};

// The raw keys order the rows OPPOSITE to the names, so a sort by either
// column is visible in the drawn order.
const ROWS = [
  { id: 'v1', name: 'Ada', api_key: 'RAW-ZULU-10657', token: 'RAW-TOKEN-A' },
  { id: 'v2', name: 'Bob', api_key: RAW_PASSWORD, token: 'RAW-TOKEN-B' },
  { id: 'v3', name: 'Cyd', api_key: 'RAW-ALFA-10657', token: 'RAW-TOKEN-C' },
];

let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  // Desktop: below 768px this list renders an `object-gallery`, not a table.
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
  writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
});

afterEach(() => {
  cleanup();
});

type SchemaMode = 'settled' | 'held' | 'rejected';

function makeDataSource(mode: SchemaMode = 'settled') {
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

function mount(ds: ReturnType<typeof makeDataSource>, props: Record<string, unknown> = {}) {
  return render(
    <RelatedList
      title="Vault"
      type="table"
      api="vault"
      objectName="vault"
      data={ROWS}
      dataSource={ds as any}
      {...props}
    />,
  );
}

const headers = () =>
  Array.from(document.querySelectorAll('thead th')).map((th) => (th.textContent ?? '').trim());

const header = (label: string): HTMLElement => {
  const th = Array.from(document.querySelectorAll('thead th')).find(
    (el) => (el.textContent ?? '').trim() === label,
  );
  expect(th, `CONTROL: a "${label}" header rendered (headers: ${headers().join(' | ')})`).toBeTruthy();
  return th as HTMLElement;
};

/** The body cell under the header `label`, in the row whose name is `name`. */
function cellUnder(label: string, name = 'Ada'): HTMLElement {
  const index = headers().indexOf(label);
  expect(index, `CONTROL: a "${label}" header rendered`).toBeGreaterThanOrEqual(0);
  const row = Array.from(document.querySelectorAll('tbody tr')).find((tr) =>
    (tr.textContent ?? '').includes(name),
  );
  expect(row, `CONTROL: the "${name}" row rendered`).toBeTruthy();
  const cell = row!.children[index] as HTMLElement | undefined;
  expect(cell?.tagName, `CONTROL: the "${label}" body cell exists`).toBe('TD');
  return cell!;
}

/** Names of the body rows, in the order they are drawn. */
const drawnNames = () =>
  Array.from(document.querySelectorAll('tbody tr'))
    .map((tr) => ['Ada', 'Bob', 'Cyd'].find((n) => (tr.textContent ?? '').includes(n)))
    .filter(Boolean);

const payloads = () => writeText.mock.calls.map((call) => call[0]);

/**
 * Wait until the object definition has settled and the mask is drawn.
 *
 * The drawn NAME is what says "settled": since objectui#10657 PR 2 every cell
 * is withheld (drawn as the mask) while the definition is unknown, so a mask
 * alone no longer tells the two windows apart.
 */
async function settledWithMask() {
  await waitFor(() => {
    const body = document.querySelector('tbody')?.textContent ?? '';
    expect(body).toContain(MASK);
    expect(body).toContain('Ada');
  });
}

/** Wait until the rows have painted WITHHELD: masks, and no name drawn yet. */
async function withheldWithMask() {
  await waitFor(() => expect(document.querySelector('tbody')?.textContent ?? '').toContain(MASK));
  expect(document.querySelector('tbody')?.textContent ?? '').not.toContain('Ada');
}

const SHAPES: Array<{ shape: string; props: Record<string, unknown> }> = [
  { shape: 'bare-string columns', props: { columns: ['name', 'api_key', 'token'] } },
  {
    shape: 'authored object columns',
    props: { columns: [{ field: 'name', label: 'Name' }, { field: 'api_key', label: 'API Key' }, { field: 'token', label: 'Token' }] },
  },
  { shape: 'the auto-derived walk', props: {} },
];

describe('RelatedList — a masked column is withheld on the table it feeds (objectui#10657)', () => {
  for (const { shape, props } of SHAPES) {
    describe(shape, () => {
      it('Ctrl+C / Cmd+C on the masked cell writes nothing; the text cell copies', async () => {
        mount(makeDataSource(), props);
        await settledWithMask();
        for (const init of [{ key: 'c', ctrlKey: true }, { key: 'c', metaKey: true }]) {
          writeText.mockClear();
          fireEvent.keyDown(cellUnder('Name'), init);
          expect(payloads(), 'CONTROL: the text cell copies').toEqual(['Ada']);
          writeText.mockClear();
          const masked = cellUnder('API Key');
          expect(masked.textContent, 'CONTROL: the list drew the mask').toContain(MASK);
          fireEvent.keyDown(masked, init);
          fireEvent.keyDown(cellUnder('Token'), init);
          expect(payloads(), 'the masked cells write nothing').toEqual([]);
        }
      });

      it('the masked cell has no `title` tooltip; the raw value is nowhere in the DOM', async () => {
        mount(makeDataSource(), props);
        await settledWithMask();
        expect(
          cellUnder('Name').querySelector('[title]')?.getAttribute('title'),
          'CONTROL: the text cell keeps its tooltip',
        ).toBe('Ada');
        expect(cellUnder('API Key').querySelector('[title]'), 'the masked cell carries no tooltip').toBeNull();
        expect(document.body.innerHTML).not.toContain('RAW-ZULU-10657');
        expect(document.body.innerHTML).not.toContain('RAW-TOKEN-A');
      });

      it('a click on the masked header orders nothing; the text header sorts the list', async () => {
        mount(makeDataSource(), props);
        await settledWithMask();
        expect(drawnNames(), 'CONTROL: rows in their incoming order').toEqual(['Ada', 'Bob', 'Cyd']);
        const keyHeader = header('API Key');
        expect(keyHeader.className, 'the masked header does not read as sortable').not.toContain('cursor-pointer');
        fireEvent.click(keyHeader);
        await act(async () => {});
        expect(drawnNames(), 'the masked header orders nothing').toEqual(['Ada', 'Bob', 'Cyd']);

        fireEvent.click(header('Name'));
        fireEvent.click(header('Name'));
        await waitFor(() => expect(drawnNames(), 'CONTROL: the text header sorts (desc)').toEqual(['Cyd', 'Bob', 'Ada']));
      });
    });
  }

  it('the masked column is the same width whatever its raw value; the text column still grows', async () => {
    const widthsFor = async (rows: typeof ROWS) => {
      const { unmount } = mount(makeDataSource(), { data: rows, columns: ['name', 'api_key'] });
      await settledWithMask();
      const out = { name: header('Name').style.width, key: header('API Key').style.width };
      unmount();
      return out;
    };
    const short = await widthsFor([{ id: 'v1', name: 'Ada', api_key: 'x', token: '' }]);
    const long = await widthsFor([
      { id: 'v1', name: 'Ada Lovelace-Byron, Countess', api_key: 'RAW-A-VERY-LONG-CREDENTIAL-10657', token: '' },
    ]);
    expect(long.name, 'CONTROL: the text column is sized from its values').not.toBe(short.name);
    expect(long.key, 'the masked column width does not follow the raw value').toBe(short.key);
  });

  it('the table export is not offered by this list, so it has no masked row to withhold', async () => {
    mount(makeDataSource(), { columns: ['name', 'api_key'] });
    await settledWithMask();
    expect(screen.queryByRole('button', { name: /Export CSV/ })).toBeNull();
  });
});

describe('RelatedList — fail closed while the object types are unknown (objectui#10657)', () => {
  it('while the definition is in flight no cell copies; once it lands the text cell does', async () => {
    const ds = makeDataSource('held');
    mount(ds, { columns: ['name', 'api_key'] });
    // objectui#10657 PR 2: in this window every cell is also WITHHELD from the
    // draw (the mask, never the value; `RelatedList.maskedFirstPaint-10657`),
    // so the row is found by position, not by the name it no longer prints.
    await withheldWithMask();
    const nameCell = () => document.querySelectorAll('tbody tr')[0]!.children[0] as HTMLElement;
    const keyCell = () => document.querySelectorAll('tbody tr')[0]!.children[1] as HTMLElement;

    fireEvent.keyDown(nameCell(), { key: 'c', ctrlKey: true });
    fireEvent.keyDown(keyCell(), { key: 'c', ctrlKey: true });
    expect(payloads(), 'no column can be told apart from a masked one yet').toEqual([]);

    await act(async () => { ds.release(); });
    await settledWithMask();
    fireEvent.keyDown(cellUnder('Name'), { key: 'c', ctrlKey: true });
    fireEvent.keyDown(cellUnder('API Key'), { key: 'c', ctrlKey: true });
    expect(payloads(), 'CONTROL: the text cell copies once the types are known').toEqual(['Ada']);
  });

  it('after a failed definition read no cell copies', async () => {
    const ds = makeDataSource('rejected');
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    mount(ds, { columns: ['name', 'api_key'] });
    await waitFor(() => expect(ds.getObjectSchema).toHaveBeenCalled());
    // Withheld from the draw as well (objectui#10657 PR 2): wait for the mask.
    await withheldWithMask();
    await act(async () => {});
    const row = document.querySelectorAll('tbody tr')[0]!;
    fireEvent.keyDown(row.children[0] as HTMLElement, { key: 'c', ctrlKey: true });
    fireEvent.keyDown(row.children[1] as HTMLElement, { key: 'c', ctrlKey: true });
    expect(payloads(), 'a failed read leaves every column withheld').toEqual([]);
    error.mockRestore();
  });
});
