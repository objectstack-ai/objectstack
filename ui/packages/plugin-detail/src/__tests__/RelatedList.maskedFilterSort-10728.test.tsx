/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `RelatedList`'s OWN filter box and sort read the `masked` stamp its
 * `tableColumns` puts on each column (objectui#10728).
 *
 * objectui#10657 stamped the flag and taught the embedded `data-table` to
 * leave a masked column out of ITS search and sort. This list does not use
 * that search (it hands the table `searchable: false` and draws its own box),
 * and it drives the sort itself, so two paths of its own still read the raw
 * value of a `password` / `secret` column whose cell draws `••••••`:
 *
 *  - the opt-in `filterable` box swept `Object.values(row)`, so the term
 *    `ZULU` kept the row whose `api_key` is `RAW-ZULU-10657`;
 *  - the `list` card's sort buttons ordered the rows by any column, masked
 *    ones included.
 *
 * The contract pinned here, the same answer the table gives for its own
 * search and sort:
 *
 *  - the filter sweeps the unmasked columns the list shows, and nothing else.
 *    A term matching only a masked value keeps no row, and neither does a term
 *    matching only a field no column shows (the stated narrowing);
 *  - a masked column offers no sort button, `handleSort` and the table's
 *    `onSortChange` refuse its key (the latter is a server `$orderby` in
 *    windowed mode), and a sort set before the stamp orders nothing;
 *  - while the object's types are unknown every column is withheld, so the
 *    filter keeps no row and no sort button is offered.
 *
 * Every absence is read after a control in the same mounted tree has answered:
 * an unmasked column's term keeps its row, its button renders and its sort
 * orders the rows. The real renderers draw the table; the `SchemaRenderer`
 * wrapper below only records the schema it is handed.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import * as React from 'react';

// The real data-table (and its cell renderers) must be registered: the filter
// pins read the rows it DRAWS.
import '@object-ui/components';
import { RelatedList } from '../RelatedList';

// Record the list's view schema (`data-table` / `data-list`) and render the
// real `SchemaRenderer` underneath. The `data-list` order and the table's
// `onSortChange` are read off it.
const h = vi.hoisted(() => ({ schema: null as any }));
vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, any>>();
  const React = await import('react');
  return {
    ...actual,
    SchemaRenderer: (props: any) => {
      const type = props?.schema?.type;
      if (type === 'data-table' || type === 'data-list') h.schema = props.schema;
      return React.createElement(actual.SchemaRenderer, props);
    },
  };
});

const MASK = '••••••';

const FIELDS = {
  name: { type: 'text', label: 'Name' },
  code: { type: 'text', label: 'Code' },
  api_key: { type: 'password', label: 'API Key' },
  token: { type: 'secret', label: 'Token' },
};

// `code` and `api_key` order the rows OPPOSITE to the names, so a sort by
// either is visible in the drawn order. `remark` is on every row and in no
// column: no field declares it, and no authored column names it.
const ROWS = [
  { id: 'v1', name: 'Ada', code: 'C3', api_key: 'RAW-ZULU-10728', token: 'RAW-TOKEN-A', remark: 'REMARK-ECHO' },
  { id: 'v2', name: 'Bob', code: 'C2', api_key: 'RAW-MIKE-10728', token: 'RAW-TOKEN-B', remark: 'REMARK-FOXTROT' },
  { id: 'v3', name: 'Cyd', code: 'C1', api_key: 'RAW-ALFA-10728', token: 'RAW-TOKEN-C', remark: 'REMARK-GOLF' },
];

beforeEach(() => {
  h.schema = null;
  // Desktop: below 768px a table list renders an `object-gallery`.
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
});

afterEach(() => {
  cleanup();
});

type SchemaMode = 'settled' | 'held';

function makeDataSource(mode: SchemaMode = 'settled') {
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  return {
    release: () => release(),
    find: vi.fn(async () => ({ data: ROWS, total: ROWS.length })),
    getObjectSchema: vi.fn(async () => {
      if (mode === 'held') await held;
      return { name: 'vault', fields: FIELDS };
    }),
  };
}

function mount(ds: ReturnType<typeof makeDataSource>, props: Record<string, unknown> = {}) {
  const element = (extra: Record<string, unknown> = {}) => (
    <RelatedList
      title="Vault"
      type="table"
      api="vault"
      objectName="vault"
      data={ROWS}
      dataSource={ds as any}
      {...props}
      {...extra}
    />
  );
  const utils = render(element());
  return { ...utils, rerenderWith: (extra: Record<string, unknown>) => utils.rerender(element(extra)) };
}

const typeTerm = (term: string) =>
  fireEvent.change(screen.getByPlaceholderText('Filter…'), { target: { value: term } });

/** Names of the body rows the table draws, in the order it draws them. */
const drawnNames = () =>
  Array.from(document.querySelectorAll('tbody tr'))
    .map((tr) => ['Ada', 'Bob', 'Cyd'].find((n) => (tr.textContent ?? '').includes(n)))
    .filter(Boolean);

/** Body rows drawing the mask: in the withheld window no name is drawn. */
const maskedRowCount = () =>
  Array.from(document.querySelectorAll('tbody tr')).filter((tr) => (tr.textContent ?? '').includes(MASK)).length;

/** Names of the rows the `data-list` is handed, in order. */
const listedNames = () => (h.schema?.data ?? []).map((r: any) => r.name);

/**
 * The labels of the sort-button row. A sort button is found by its glyph, not
 * by its label: before the object definition lands a bare-string column's
 * header is not its declared label, and a label filter would read an empty
 * row there whatever the list offered.
 */
const sortButtons = () =>
  screen
    .queryAllByRole('button')
    .filter((b) => b.querySelector('.lucide-arrow-up-down'))
    .map((b) => (b.textContent ?? '').replace(/[↑↓]/g, '').trim());

async function settled() {
  await waitFor(() => {
    const body = document.querySelector('tbody')?.textContent ?? '';
    expect(body).toContain(MASK);
    expect(body).toContain('Ada');
  });
}

const SHAPES: Array<{ shape: string; props: Record<string, unknown> }> = [
  { shape: 'bare-string columns', props: { columns: ['name', 'api_key', 'token'] } },
  {
    shape: 'authored object columns',
    props: {
      columns: [
        { field: 'name', label: 'Name' },
        { field: 'api_key', label: 'API Key' },
        { field: 'token', label: 'Token' },
      ],
    },
  },
  { shape: 'the auto-derived walk', props: {} },
];

describe('RelatedList — the filter box leaves a masked column out (objectui#10728)', () => {
  for (const { shape, props } of SHAPES) {
    it(`${shape}: a term matching only a masked value keeps no row; a name term keeps its row`, async () => {
      mount(makeDataSource(), { filterable: true, ...props });
      await settled();
      expect(drawnNames(), 'CONTROL: every row before a term').toEqual(['Ada', 'Bob', 'Cyd']);

      typeTerm('Ada');
      await waitFor(() => expect(drawnNames(), 'CONTROL: an unmasked column matches').toEqual(['Ada']));

      typeTerm('ZULU');
      await waitFor(() => expect(drawnNames(), 'the password value is not searched').toEqual([]));
      typeTerm('TOKEN-B');
      await waitFor(() => expect(drawnNames(), 'the secret value is not searched').toEqual([]));

      typeTerm('Cyd');
      await waitFor(() => expect(drawnNames(), 'CONTROL: the box still filters').toEqual(['Cyd']));
    });
  }

  it('a term matching only a field no column shows keeps no row (the stated narrowing)', async () => {
    mount(makeDataSource(), { filterable: true, columns: ['name', 'api_key'] });
    await settled();
    typeTerm('Bob');
    await waitFor(() => expect(drawnNames(), 'CONTROL: an unmasked column matches').toEqual(['Bob']));

    // `remark` rides on every row and no column shows it; `token` is a
    // declared `secret` field this authored list does not show.
    typeTerm('ECHO');
    await waitFor(() => expect(drawnNames(), 'a field no column shows is not searched').toEqual([]));
    typeTerm('TOKEN-C');
    await waitFor(() => expect(drawnNames(), 'a hidden secret field is not searched').toEqual([]));
  });

  it('while the object types are unknown the box keeps no row; once they land a name term keeps its row', async () => {
    const ds = makeDataSource('held');
    mount(ds, { filterable: true, columns: ['name', 'api_key'] });
    await waitFor(() => expect(maskedRowCount(), 'CONTROL: the withheld rows are drawn').toBe(3));
    expect(document.querySelector('tbody')?.textContent ?? '').not.toContain('Ada');

    typeTerm('ZULU');
    await waitFor(() => expect(maskedRowCount(), 'no column can be told apart from a masked one').toBe(0));
    typeTerm('Ada');
    await act(async () => {});
    expect(maskedRowCount(), 'every column is withheld, the name column included').toBe(0);

    await act(async () => { ds.release(); });
    await waitFor(() => expect(drawnNames(), 'CONTROL: the same term keeps its row once the types are known').toEqual(['Ada']));
    typeTerm('ZULU');
    await waitFor(() => expect(drawnNames(), 'the password value is still not searched').toEqual([]));
  });
});

describe('RelatedList — the `list` card offers no sort on a masked column (objectui#10728)', () => {
  for (const { shape, props } of SHAPES) {
    it(`${shape}: no button on the masked columns; the name button sorts`, async () => {
      mount(makeDataSource(), { type: 'list', sortable: true, ...props });
      await waitFor(() => expect(sortButtons(), 'CONTROL: the unmasked column has a button').toContain('Name'));
      expect(sortButtons(), 'no button on the password column').not.toContain('API Key');
      expect(sortButtons(), 'no button on the secret column').not.toContain('Token');

      fireEvent.click(screen.getByRole('button', { name: /Name/ }));
      fireEvent.click(screen.getByRole('button', { name: /Name/ }));
      await waitFor(() => expect(listedNames(), 'CONTROL: the name button sorts (desc)').toEqual(['Cyd', 'Bob', 'Ada']));
    });
  }

  it('while the object types are unknown no sort button is offered; once they land the name button is', async () => {
    const ds = makeDataSource('held');
    mount(ds, { type: 'list', sortable: true, columns: ['name', 'api_key'] });
    await waitFor(() => expect(h.schema?.type).toBe('data-list'));
    expect(listedNames(), 'CONTROL: the rows are in hand').toEqual(['Ada', 'Bob', 'Cyd']);
    expect(sortButtons(), 'every column is withheld').toEqual([]);

    await act(async () => { ds.release(); });
    await waitFor(() => expect(sortButtons(), 'CONTROL: the unmasked column gets its button').toEqual(['Name']));
  });

  it('a sort set before its column was stamped orders nothing', async () => {
    const plain = [{ field: 'name', label: 'Name' }, { field: 'code', label: 'Code' }];
    const { rerenderWith } = mount(makeDataSource(), { type: 'list', sortable: true, columns: plain });
    await waitFor(() => expect(sortButtons()).toContain('Code'));

    fireEvent.click(screen.getByRole('button', { name: /Code/ }));
    await waitFor(() => expect(listedNames(), 'CONTROL: the code button sorts').toEqual(['Cyd', 'Bob', 'Ada']));

    // The author re-types the column `password`: the narrow-only union stamps it.
    rerenderWith({ columns: [plain[0], { ...plain[1], type: 'password' }] });
    await waitFor(() => expect(sortButtons(), 'the stamped column loses its button').not.toContain('Code'));
    expect(listedNames(), 'the sort on it orders nothing').toEqual(['Ada', 'Bob', 'Cyd']);
  });

  it('a table header sort set before its column was stamped orders nothing', async () => {
    const plain = [{ field: 'name', label: 'Name' }, { field: 'code', label: 'Code' }];
    const { rerenderWith } = mount(makeDataSource(), { columns: plain });
    await waitFor(() => expect(drawnNames()).toEqual(['Ada', 'Bob', 'Cyd']));

    await act(async () => { h.schema.onSortChange([{ field: 'code', order: 'asc' }]); });
    await waitFor(() => expect(drawnNames(), 'CONTROL: the code sort orders the rows').toEqual(['Cyd', 'Bob', 'Ada']));

    rerenderWith({ columns: [plain[0], { ...plain[1], type: 'password' }] });
    await waitFor(() => expect(drawnNames(), 'the sort on the stamped column orders nothing').toEqual(['Ada', 'Bob', 'Cyd']));
  });
});

describe('RelatedList — a windowed list never sends a masked key as `$orderby` (objectui#10728)', () => {
  it('the table asking to sort by the masked column sends no `$orderby`; the name column does', async () => {
    const ds = makeDataSource();
    render(
      <RelatedList
        title="Vault"
        type="table"
        api="vault"
        objectName="vault"
        referenceField="owner"
        parentId="P-1"
        pageSize={10}
        columns={['name', 'api_key']}
        dataSource={ds as any}
      />,
    );
    await settled();
    const orderbys = () => ds.find.mock.calls.map((call: any[]) => call[1]?.$orderby);
    const sortedFields = () => orderbys().flat().filter(Boolean).map((s: any) => s.field);

    await act(async () => { h.schema.onSortChange([{ field: 'api_key', order: 'asc' }]); });
    expect(sortedFields(), 'the masked key is never sent as `$orderby`').not.toContain('api_key');

    await act(async () => { h.schema.onSortChange([{ field: 'name', order: 'desc' }]); });
    await waitFor(() => {
      const calls = orderbys();
      expect(calls[calls.length - 1], 'CONTROL: the name sort reaches the server').toEqual([{ field: 'name', order: 'desc' }]);
    });
    expect(sortedFields(), 'and still no masked key').not.toContain('api_key');
  });
});
