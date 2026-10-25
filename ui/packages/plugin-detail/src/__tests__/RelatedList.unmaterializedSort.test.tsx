/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#3950 — a related list must not offer a sort the platform refuses.
 *
 * A `formula` value is computed on read and no driver materialises a column for
 * it, so a windowed sort — which leaves as a server `$orderby` on the flat field
 * name — has nothing to order by. Silently unordered rows under a `200` before
 * objectstack#6994; `400 INVALID_SORT` after it.
 *
 * The rule is applied at BOTH of this card's sort entry points, because they do
 * not share a derivation: the embedded table's column headers (`table` / `grid`)
 * and the sort-button row that survives for `data-list`. Missing either one
 * leaves the same refused sort reachable through the other control.
 *
 * Client mode is deliberately left alone: the rows are all in memory and the
 * formula value is the one the server hydrated on read, so ordering by what the
 * cell shows is honest — the same split #3096 made for relational columns.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, waitFor, screen } from '@testing-library/react';
import * as React from 'react';
import { RelatedList } from '../RelatedList';

/**
 * Desktop, pinned rather than inherited (objectui#8399). `RelatedList` reads
 * `useIsMobile` (breakpoint 768): above it a `type="table"` list renders a real
 * `data-table`, below it an `object-gallery` card layout with no headers, no
 * cells and no sort.
 *
 * The `column headers` describe reads the table HEADERS and needs this branch.
 * The `data-list` describe exercises `type='list'`, which the mobile carve-out
 * never touches (it applies to `grid`/`table` only), so the pin states the
 * branch without changing it.
 *
 * happy-dom's ambient `innerWidth` is 1024, so the desktop branch was inherited
 * here rather than chosen.
 */
beforeAll(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
});

// Capture the schema RelatedList hands to SchemaRenderer (the data-table), so
// the column's own `sortable` flag can be read without the table in the way.
const h = vi.hoisted(() => ({ schema: null as any }));
vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    SchemaRenderer: (props: any) => {
      h.schema = props.schema;
      return null;
    },
  };
});

/**
 * Shaped after `crm_opportunity_line_item`: `quantity` and `unit_price` are
 * stored, `total` is their product computed on read. `sequence` is an
 * `autonumber` — same "computed" reputation as a formula field, a real stored
 * column, so it belongs with the controls.
 */
const objectSchema = {
  name: 'line_item',
  fields: {
    name: { type: 'text', label: 'Name' },
    quantity: { type: 'number', label: 'Quantity' },
    unit_price: { type: 'currency', label: 'Unit Price' },
    total: { type: 'formula', label: 'Total' },
    sequence: { type: 'autonumber', label: 'Sequence' },
  },
};

const columns = [
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: 'quantity', header: 'Quantity' },
  { accessorKey: 'unit_price', header: 'Unit Price' },
  { accessorKey: 'total', header: 'Total' },
  { accessorKey: 'sequence', header: 'Sequence' },
];

const items = Array.from({ length: 9 }, (_, i) => ({
  id: `li${i}`,
  name: `Item ${i}`,
  quantity: i + 1,
  unit_price: 100,
  total: (i + 1) * 100,
  sequence: i,
}));

const makeDataSource = () => ({
  getObjectSchema: vi.fn(async () => objectSchema),
  find: vi.fn(async (_api: string, params: any) => {
    const skip = params?.$skip ?? 0;
    const top = params?.$top ?? items.length;
    return { data: items.slice(skip, skip + top), total: items.length };
  }),
});

/** Whether the embedded table offers a sort on this column. */
const columnSortable = (accessorKey: string) => {
  const col = h.schema?.columns?.find((c: any) => c.accessorKey === accessorKey);
  return col ? col.sortable !== false : undefined;
};

function renderList(props?: Record<string, unknown>) {
  const dataSource = makeDataSource();
  render(
    <RelatedList
      title="Line Items"
      type="table"
      api="line_item"
      objectName="line_item"
      referenceField="opportunity"
      parentId="OPP-1"
      pageSize={4}
      columns={columns}
      sortable
      dataSource={dataSource as any}
      {...props}
    />,
  );
  return dataSource;
}

/**
 * Gate 2 — the `getObjectSchema` chain (objectui#7007).
 *
 * Every verdict this file measures is a function of the FETCHED object schema:
 * `withheldFromServerSort` reads `objectSchema.fields[field]`, and with nothing
 * there it falls through to `isUnmaterializedFieldType(undefined)` — `false`,
 * i.e. "offer the sort". So a block that has only settled the FETCH chain is
 * reading the value one promise resolution too early: the row/table is
 * committed and populated, and the schema-dependent half of it is not.
 *
 * Measured, not assumed: with the timing fact mutated and nothing else — the
 * mock schema resolving after a 50ms delay instead of on the first microtask —
 * the block's own gate passes, `Quantity`/`Unit Price`/`Sequence` are present,
 * and `Total` is present too, so the assertions below go red. It is green on
 * `main` only because that effect is declared before the fetch effect and both
 * mocks resolve on the same microtask; nothing pins that ordering.
 *
 * ⚠️ The blocks KEEP their existing gate (objectui#6959's precedent, and its
 * trap). The two gates prove different facts — the first that the view
 * committed with rows at all, which is what makes a `queryBy…(…)).toBeNull()`
 * below non-vacuous; the second that the schema the verdict is derived from has
 * landed. Trading one for the other would leave the block blind on whichever
 * side it dropped.
 *
 * ⛔ `expect(getObjectSchema).toHaveBeenCalled()` is NOT this gate, for the
 * reason #6959 records: a mock CALL is ISSUED one resolution before its value
 * reaches state. It is used here only to get hold of the promise; the gate is
 * awaiting that same promise — the component registered its
 * `.then(setObjectSchema)` on it first, so our continuation runs after that
 * setter — and flushing the commit through `act`.
 */
async function settleObjectSchema(ds: ReturnType<typeof makeDataSource>) {
  await waitFor(() => expect(ds.getObjectSchema).toHaveBeenCalled());
  await React.act(async () => {
    await Promise.all(ds.getObjectSchema.mock.results.map((r) => r.value));
  });
}

beforeEach(() => {
  h.schema = null;
});

describe('RelatedList — column headers (#3950)', () => {
  it('withholds the header from a formula column while windowed', async () => {
    const dataSource = renderList();
    // A stored column stays sortable — which also proves the table rendered.
    await waitFor(() => expect(columnSortable('name')).toBe(true));
    // …and `total`'s verdict rides the schema chain, which that gate does not
    // cover (#7007). `name` is sortable either way, so it cannot stand in.
    await settleObjectSchema(dataSource);
    expect(columnSortable('total')).toBe(false);
  });

  it('leaves every stored column sortable — including the autonumber (collateral control)', async () => {
    renderList();
    await waitFor(() => expect(h.schema?.type).toBe('data-table'));

    expect(columnSortable('quantity')).toBe(true);
    expect(columnSortable('unit_price')).toBe(true);
    expect(columnSortable('sequence')).toBe(true);
  });

  it('keeps the formula header live in client mode, where the key is the hydrated value', async () => {
    renderList({ data: items });
    await waitFor(() => expect(h.schema?.type).toBe('data-table'));

    expect(columnSortable('total')).toBe(true);
  });
});

describe('RelatedList — the sort-button row for a `list` card (#3950)', () => {
  it('offers no button for a formula field while windowed', async () => {
    const dataSource = renderList({ type: 'list' });
    await waitFor(() => expect(h.schema?.type).toBe('data-list'));
    // Second gate, second chain: `Total`'s absence is derived from the fetched
    // schema, which the gate above does not settle (#7007).
    await settleObjectSchema(dataSource);

    // Controls first: the row exists and carries the stored columns.
    expect(screen.getByRole('button', { name: /Quantity/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Unit Price/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Sequence/ })).toBeTruthy();

    expect(screen.queryByRole('button', { name: /Total/ })).toBeNull();
  });

  it('keeps that button in client mode', async () => {
    const dataSource = renderList({ type: 'list', data: items });
    await waitFor(() => expect(h.schema?.type).toBe('data-list'));
    // Since objectui#10728 the sort-button row reads the masked stamp, which
    // covers every column until the object schema lands (#7007).
    await settleObjectSchema(dataSource);

    expect(screen.getByRole('button', { name: /Total/ })).toBeTruthy();
  });
});
