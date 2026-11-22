/**
 * objectstack-ai/objectstack#36256 — a page block's drill lists the records
 * its number counts.
 *
 * HotCRM's 销售主页 KPI tile is an `object-metric` block whose `filter` is the
 * spec's rule-array form, `[{ field: 'stage', operator: 'equals', value:
 * 'closed_won' }]`, handed to the drill as written. The drill draws the REAL
 * standard list (`@object-ui/plugin-list`) over an in-memory matcher
 * (`ValueDataSource`), so the read it sends is judged as a server would judge
 * it. The tile counts the won deals. The drill must read with that condition
 * and list exactly those deals, never every record of the object.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
import { ValueDataSource } from '@object-ui/core';
import '@object-ui/plugin-dashboard';
import '@object-ui/plugin-list';

const DEFINITION = {
  name: 'opp_36256',
  label: 'Opportunity',
  nameField: 'name',
  fields: {
    name: { type: 'text', label: 'Name' },
    stage: { type: 'text', label: 'Stage' },
    amount: { type: 'number', label: 'Amount' },
  },
};

const ROWS = [
  { id: 'o1', name: 'Initech Phase 1', stage: 'closed_won', amount: 90000 },
  { id: 'o2', name: 'Wayne Q1 Expansion', stage: 'closed_won', amount: 380000 },
  { id: 'o3', name: 'Apex Logistics Data Hub', stage: 'needs_analysis', amount: 93000 },
];
const WON = ROWS.filter((r) => r.stage === 'closed_won');

function mount(filter: unknown = [{ field: 'stage', operator: 'equals', value: 'closed_won' }]) {
  const matcher = new ValueDataSource({ items: ROWS });
  const ds = {
    find: vi.fn((object: string, params?: Record<string, unknown>) => matcher.find(object, params as never)),
    // The tile's own number: the won deals' sum.
    aggregate: vi.fn(async (_object: string, _params: Record<string, unknown>) => [{ amount_sum: WON.reduce((a, r) => a + r.amount, 0) }]),
    getObjectSchema: vi.fn(async () => structuredClone(DEFINITION)),
  };
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })));
  render(
    <SchemaRendererProvider dataSource={ds as never}>
      <SchemaRenderer
        schema={{
          type: 'object-metric',
          objectName: 'opp_36256',
          label: 'Revenue won',
          aggregate: { field: 'amount', function: 'sum' },
          filter,
          drillDown: { enabled: true, target: 'dialog', columns: ['name', 'stage', 'amount'] },
        } as never}
      />
    </SchemaRendererProvider>,
  );
  return ds;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("a page block's rule-array filter reaches its drill's read (#36256)", () => {
  it('lists exactly the records the tile counts, and the read carries the condition', async () => {
    const ds = mount();
    fireEvent.click(await screen.findByRole('button', { name: /revenue won|470,000/i }));
    const dialog = await screen.findByTestId('drill-down-dialog');
    for (const won of WON) expect(await within(dialog).findByText(won.name)).toBeInTheDocument();
    await waitFor(() => expect(within(dialog).queryByText('Apex Logistics Data Hub')).toBeNull());
    // The read the list sent, and the condition it carries.
    const reads = ds.find.mock.calls.filter(([object]) => object === 'opp_36256');
    expect(reads.length).toBeGreaterThan(0);
    expect(JSON.stringify(reads.at(-1)?.[1]?.$filter)).toContain('closed_won');
  });

  it.each([
    ['an array that is neither rules nor AST', [{ stage: 'closed_won' }]],
    ['a rule with a blank field', [{ field: '', operator: 'equals', value: 'closed_won' }]],
    ['a valid rule beside a malformed one', [{ field: 'stage', operator: 'equals', value: 'closed_won' }, { stage: 'x' }]],
  ])('hands a filter the conversion answers nothing for to the list as its base filter, never an unfiltered read: %s', async (_, filter) => {
    const ds = mount(filter);
    fireEvent.click(await screen.findByRole('button', { name: /revenue won|470,000/i }));
    const dialog = await screen.findByTestId('drill-down-dialog');
    await waitFor(() => expect(ds.find.mock.calls.some(([object]) => object === 'opp_36256')).toBe(true));
    // Every read carries the filter (a server refuses it as malformed; it is
    // never read as no filter).
    for (const [object, params] of ds.find.mock.calls) {
      if (object === 'opp_36256') expect(params?.$filter).toBeDefined();
    }
    await waitFor(() => expect(within(dialog).queryByText('Apex Logistics Data Hub')).toBeNull());
  });

  it.each([
    ['a string', 'stage = closed_won'],
    ['a number', 7],
  ])('lists nothing for a filter no read can carry, and sends no read: %s', async (_, filter) => {
    const ds = mount(filter);
    fireEvent.click(await screen.findByRole('button', { name: /revenue won|470,000/i }));
    const dialog = await screen.findByTestId('drill-down-dialog');
    expect(within(dialog).getByTestId('drill-down-notice')).toHaveAttribute('data-notice', 'unavailable');
    await new Promise((r) => setTimeout(r, 50));
    expect(ds.find.mock.calls.filter(([object]) => object === 'opp_36256')).toEqual([]);
  });
});
