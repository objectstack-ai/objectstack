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
