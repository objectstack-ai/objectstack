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

function Host({ ds, initial, columns, onChange, displayMode }: { ds: ReturnType<typeof makeSource>; initial: any[]; columns: any[]; onChange?: (v: any[]) => void; displayMode?: 'list' }) {
  const [rows, setRows] = React.useState(initial);
  return (
    <SchemaRendererContext.Provider value={{ dataSource: ds } as never}>
      <GridField
        value={rows}
        onChange={(v: any[]) => {
          setRows(v);
          onChange?.(v);
        }}
        field={{ columns } as never}
        displayMode={displayMode}
      />
    </SchemaRendererContext.Provider>
  );
}

const readsOf = (ds: ReturnType<typeof makeSource>, object: string) => ({
  findOne: ds.findOne.mock.calls.filter((c) => c[0] === object).length,
  find: ds.find.mock.calls.filter((c) => c[0] === object).length,
});

describe('PROBE (premise) — objectstack#36552', () => {
  it('a cleared multi-record lookup cell', async () => {
    const ds = makeSource();
    const onChange = vi.fn();
    render(<Host ds={ds} initial={[{ products: ['p1'] }]} columns={[{ name: 'products', label: 'Products', type: 'lookup', reference: 'product', multiple: true }]} onChange={onChange} />);
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
    console.log('PROBE item1 written:', JSON.stringify(onChange.mock.calls.at(-1)?.[0]));
  });

  it('reads per line', async () => {
    const ds = makeSource();
    render(
      <Host
        ds={ds}
        initial={USERS.map((u, i) => ({ owner: u.id, product: PRODUCTS[i % 2].id }))}
        columns={[
          { name: 'owner', label: 'Owner', type: 'user' },
          { name: 'product', label: 'Product', type: 'lookup', reference: 'product' },
        ]}
      />,
    );
    await waitFor(() => expect(screen.getAllByText(/Person/).length).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 50));
    console.log('PROBE item2 sys_user:', JSON.stringify(readsOf(ds, 'sys_user')), 'product:', JSON.stringify(readsOf(ds, 'product')));
  });
});
