/**
 * objectstack-ai/objectstack#36256 items 3, 5 and 8 — the drill dialog draws
 * the REAL standard list (`@object-ui/plugin-list`'s `list-view`): the
 * drill's conditions are the list's own chips, removable; the default
 * columns are the record's name and the drilled fields; and nothing the
 * reader does in it writes anything — no record write through the data
 * source, no request that is not a read, no stored preference.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { DrillNavigationProvider, SchemaRendererProvider } from '@object-ui/react';
import { DrillDownDrawer } from '@object-ui/plugin-dashboard';
import '@object-ui/plugin-list';

const DEFINITION = {
  name: 'deal_36256',
  label: 'Deal',
  nameField: 'name',
  fields: {
    name: { type: 'text', label: 'Name' },
    stage: {
      type: 'select',
      label: 'Stage',
      options: [
        { value: 'proposal', label: 'Proposal' },
        { value: 'negotiation', label: 'Negotiation' },
      ],
    },
    amount: { type: 'number', label: 'Amount' },
    owner: { type: 'text', label: 'Owner' },
  },
};

function mount() {
  const ds = {
    find: vi.fn().mockResolvedValue({ data: [{ id: 'd1', name: 'Acme', stage: 'negotiation', amount: 3 }], total: 1 }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    bulk: vi.fn(),
    getObjectSchema: vi.fn(async () => structuredClone(DEFINITION)),
  };
  const fetchSpy = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
  vi.stubGlobal('fetch', fetchSpy);
  const setItem = vi.spyOn(Storage.prototype, 'setItem');
  const openRecord = vi.fn();
  render(
    <SchemaRendererProvider dataSource={ds as any}>
      <DrillNavigationProvider value={{ openRecord }}>
        <DrillDownDrawer
          open
          target="dialog"
          onClose={vi.fn()}
          title="Negotiation"
          objectName="deal_36256"
          filter={{ stage: 'negotiation', amount: { $null: false } }}
          defaultColumns={['stage', 'amount']}
          dataSource={ds}
        />
      </DrillNavigationProvider>
    </SchemaRendererProvider>,
  );
  return { ds, fetchSpy, setItem, openRecord };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the drill dialog draws the standard list (#36256)', () => {
  it('shows the drill conditions as removable chips, and removing one re-reads without writing', async () => {
    const { ds, fetchSpy, setItem } = mount();
    const dialog = await screen.findByTestId('drill-down-dialog');
    const chip = await within(dialog).findByTestId('filter-chip-stage');
    expect(chip).toHaveTextContent('Stage: Negotiation');
    await waitFor(() => expect(ds.find).toHaveBeenCalled());
    const firstQuery = JSON.stringify(ds.find.mock.calls.at(-1));
    expect(firstQuery).toContain('negotiation');

    const reads = ds.find.mock.calls.length;
    await act(async () => fireEvent.click(within(dialog).getByTestId('filter-chip-remove-stage')));
    await waitFor(() => expect(ds.find.mock.calls.length).toBeGreaterThan(reads));
    expect(JSON.stringify(ds.find.mock.calls.at(-1))).not.toContain('negotiation');

    for (const write of [ds.create, ds.update, ds.delete, ds.bulk]) expect(write).not.toHaveBeenCalled();
    for (const [, init] of fetchSpy.mock.calls as unknown as Array<[unknown, { method?: string } | undefined]>) {
      expect((init?.method ?? 'GET').toUpperCase()).toBe('GET');
    }
    expect(setItem).not.toHaveBeenCalled();
  });

  it("leads with the record's name, then the drilled fields", async () => {
    mount();
    const dialog = await screen.findByTestId('drill-down-dialog');
    await within(dialog).findByText('Acme');
    const headers = within(dialog).getAllByRole('columnheader').map((h) => h.textContent?.trim()).filter(Boolean);
    expect(headers.slice(0, 3)).toEqual(['Name', 'Stage', 'Amount']);
  });
});

/**
 * objectstack-ai/objectstack#36554 — a record opened from a drill steps
 * through the drill's whole result. The real list draws one page of the
 * drill (2 of 40 rows); the record page the host opens is handed all 40 ids,
 * read with the drill list's own query (its filter and sort, ids only), and
 * the count the list matched, so it reads 「1 of 40」 and ↑ ↓ walk every
 * record. A drill whose result is all drawn reads nothing more.
 */
describe('a record opened from a drill steps through the whole drill (#36554)', () => {
  const ALL = Array.from({ length: 40 }, (_, i) => ({
    id: `d${i + 1}`,
    name: i === 0 ? 'Acme' : `Deal ${i + 1}`,
    stage: 'negotiation',
    amount: i + 1,
  }));

  function mountPaged(rows: typeof ALL, pageSize: number) {
    const ds = {
      find: vi.fn(async (_object: string, params: { $top?: number; $skip?: number; $select?: string[] } = {}) => {
        const skip = params.$skip ?? 0;
        const top = params.$top ?? rows.length;
        const page = rows.slice(skip, skip + top);
        const select = params.$select;
        return {
          data: select ? page.map((row) => Object.fromEntries(select.map((f) => [f, (row as Record<string, unknown>)[f]]))) : page,
          total: rows.length,
        };
      }),
      findOne: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      bulk: vi.fn(),
      getObjectSchema: vi.fn(async () => structuredClone(DEFINITION)),
    };
    const openRecord = vi.fn();
    render(
      <SchemaRendererProvider dataSource={ds as any}>
        <DrillNavigationProvider value={{ openRecord }}>
          <DrillDownDrawer
            open
            target="dialog"
            onClose={vi.fn()}
            title="Negotiation"
            objectName="deal_36256"
            filter={{ stage: 'negotiation' }}
            defaultColumns={['stage', 'amount']}
            maxRows={pageSize}
            dataSource={ds}
          />
        </DrillNavigationProvider>
      </SchemaRendererProvider>,
    );
    return { ds, openRecord };
  }

  const idReads = (ds: { find: ReturnType<typeof vi.fn> }) =>
    ds.find.mock.calls.filter(([, params]) => JSON.stringify((params as { $select?: unknown })?.$select) === '["id"]');

  it('hands the record page every record the drill matched, with its count, read by the drill list\'s own query', async () => {
    const { ds, openRecord } = mountPaged(ALL, 2);
    const dialog = await screen.findByTestId('drill-down-dialog');
    await within(dialog).findByText('Acme');
    // The list drew one page: 2 of the 40 rows.
    expect(within(dialog).queryByText('Deal 3')).toBeNull();
    await act(async () => fireEvent.click(within(dialog).getByText('Acme')));
    await waitFor(() => expect(openRecord).toHaveBeenCalledTimes(1));

    const [objectName, recordId, origin] = openRecord.mock.calls[0];
    expect(objectName).toBe('deal_36256');
    expect(recordId).toBe('d1');
    expect(origin.total).toBe(40);
    expect(origin.siblings).toEqual(ALL.map((row) => row.id));

    // The ids came from the drill's query: its condition, no other read shape.
    const reads = idReads(ds);
    expect(reads.length).toBeGreaterThan(0);
    for (const [object, params] of reads) {
      expect(object).toBe('deal_36256');
      expect(JSON.stringify((params as { $filter?: unknown }).$filter)).toContain('negotiation');
    }
    for (const write of [ds.create, ds.update, ds.delete, ds.bulk]) expect(write).not.toHaveBeenCalled();
  });

  it('control: a drill whose result is all drawn hands those rows and reads nothing more', async () => {
    const { ds, openRecord } = mountPaged(ALL.slice(0, 3), 10);
    const dialog = await screen.findByTestId('drill-down-dialog');
    await within(dialog).findByText('Deal 3');
    await act(async () => fireEvent.click(within(dialog).getByText('Acme')));
    await waitFor(() => expect(openRecord).toHaveBeenCalledTimes(1));
    expect(openRecord.mock.calls[0][2]).toEqual({ siblings: ['d1', 'd2', 'd3'], total: 3 });
    expect(idReads(ds)).toHaveLength(0);
  });
});
