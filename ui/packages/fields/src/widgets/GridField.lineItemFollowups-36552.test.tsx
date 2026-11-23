/**
 * objectstack#36552 — the line-item grid's follow-ups to objectstack#36043:
 *
 *  - every emptied multi-value cell writes `null`: the multi-record lookup
 *    cell (it wrote `[]`) and the multi-person cell (right by reading, unpinned);
 *  - a people or lookup column draws its names with one read per referenced
 *    object, not one `findOne` per line;
 *  - in list mode a stored empty list reads as the muted em dash.
 *
 * In a file of its own rather than `GridField.test.tsx`, which another open
 * change edits; the harness is this file's.
 */
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, act, fireEvent, within } from '@testing-library/react';
import { SchemaRendererContext } from '@object-ui/react';
import { GridFieldWidget as GridField } from './grid-field/GridFieldWidget';

afterEach(cleanup);

const PRODUCTS = [
  { id: 'p1', name: 'Widget' },
  { id: 'p2', name: 'Gadget' },
];
const USERS = Array.from({ length: 20 }, (_, i) => ({ id: `u${i + 1}`, name: `Person ${i + 1}` }));

function makeSource() {
  const tables: Record<string, Record<string, unknown>[]> = { product: PRODUCTS, sys_user: USERS };
  return {
    find: vi.fn(async (object: string, params?: { $filter?: Record<string, any> }) => {
      const rows = tables[object] ?? [];
      const wanted = params?.$filter?.id?.$in as unknown[] | undefined;
      const picked = wanted ? rows.filter((r) => wanted.includes(r.id)) : rows;
      return { data: picked.map((r) => ({ ...r })), total: picked.length };
    }),
    findOne: vi.fn(async (object: string, id: string) => {
      const row = (tables[object] ?? []).find((r) => r.id === id);
      return row ? { ...row } : null;
    }),
  };
}
type Source = ReturnType<typeof makeSource>;

function Host({
  ds,
  initial,
  columns,
  onChange,
  displayMode,
  readonly,
}: {
  ds?: Source;
  initial: any[];
  columns: any[];
  onChange?: (v: any[]) => void;
  displayMode?: 'list';
  readonly?: boolean;
}) {
  const [rows, setRows] = React.useState(initial);
  const grid = (
    <GridField
      value={rows}
      onChange={(v: any[]) => {
        setRows(v);
        onChange?.(v);
      }}
      field={{ columns } as never}
      displayMode={displayMode}
      readonly={readonly}
    />
  );
  return ds ? <SchemaRendererContext.Provider value={{ dataSource: ds } as never}>{grid}</SchemaRendererContext.Provider> : grid;
}

/** The reads of `object` that reached the page's data source. */
const readsOf = (ds: Source, object: string) => ({
  findOne: ds.findOne.mock.calls.filter((c) => c[0] === object).length,
  find: ds.find.mock.calls.filter((c) => c[0] === object),
});

describe('an emptied multi-value cell writes null (objectstack#36552)', () => {
  it('a multi-record lookup cell: un-picking its last record writes null, not []', async () => {
    const onChange = vi.fn();
    render(
      <Host
        ds={makeSource()}
        initial={[{ products: ['p1'] }]}
        columns={[{ name: 'products', label: 'Products', type: 'lookup', reference: 'product', multiple: true }]}
        onChange={onChange}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getAllByTestId('lookup-trigger')[0]);
    });
    const option = await waitFor(() => {
      const el = screen.getAllByRole('option').find((o) => (o.textContent ?? '').includes('Widget'));
      if (!el) throw new Error('Widget not offered');
      return el;
    });
    await act(async () => {
      fireEvent.click(option);
    });
    expect(onChange).toHaveBeenCalled();
    expect(onChange.mock.calls.at(-1)![0][0].products).toBeNull();
  });

  it("a multi-person cell: the picker's Clear writes null, not []", async () => {
    const onChange = vi.fn();
    render(
      <Host
        initial={[{ owners: ['u1', 'u2'] }]}
        columns={[{ name: 'owners', label: 'Owners', type: 'user', multiple: true }]}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Owners' }));
    const panel = await screen.findByTestId('line-items-user-panel');
    fireEvent.click(within(panel).getByTestId('lookup-in-cell-clear'));
    await waitFor(() => expect(screen.queryByTestId('line-items-user-panel')).toBeNull());
    expect(onChange).toHaveBeenCalled();
    expect(onChange.mock.calls.at(-1)![0][0].owners).toBeNull();
  });
});

describe('a people or lookup column reads its names once, not once per line (objectstack#36552)', () => {
  const columns = [
    { name: 'owner', label: 'Owner', type: 'user' },
    { name: 'product', label: 'Product', type: 'lookup', reference: 'product' },
  ];
  // Twenty lines: twenty people, and two products named ten times each.
  const lines = USERS.map((u, i) => ({ owner: u.id, product: PRODUCTS[i % 2].id }));

  for (const mode of ['editable', 'read-only', 'list'] as const) {
    it(`${mode}: one $in read of sys_user and one of the product, no read per line, every name drawn`, async () => {
      const ds = makeSource();
      render(
        <Host ds={ds} initial={lines} columns={columns} readonly={mode === 'read-only'} displayMode={mode === 'list' ? 'list' : undefined} />,
      );
      for (const u of USERS) expect(await screen.findByText(u.name)).toBeTruthy();
      await waitFor(() => expect(screen.getAllByText('Gadget')).toHaveLength(10));
      expect(screen.getAllByText('Widget')).toHaveLength(10);

      const people = readsOf(ds, 'sys_user');
      expect(people.findOne).toBe(0);
      expect(people.find).toHaveLength(1);
      expect(people.find[0][1]).toMatchObject({ $filter: { id: { $in: USERS.map((u) => u.id) } } });

      const products = readsOf(ds, 'product');
      expect(products.findOne).toBe(0);
      expect(products.find).toHaveLength(1);
      expect(products.find[0][1]).toMatchObject({ $filter: { id: { $in: ['p1', 'p2'] } } });
    });
  }
});

describe('list mode: a stored empty list reads as the muted em dash (objectstack#36552)', () => {
  it('a multi-select and a tags cell holding [] draw — in the muted colour, as null does', () => {
    render(
      <Host
        displayMode="list"
        initial={[{ colors: [], labels: [], note: null }]}
        columns={[
          { name: 'colors', label: 'Colors', type: 'multiselect', options: [{ label: 'Red', value: 'red' }] },
          { name: 'labels', label: 'Labels', type: 'tags' },
          { name: 'note', label: 'Note', type: 'text' },
        ]}
      />,
    );
    const dashes = screen.getAllByText('—');
    expect(dashes).toHaveLength(3);
    for (const dash of dashes) expect(dash.className).toContain('text-muted-foreground');
  });
});
