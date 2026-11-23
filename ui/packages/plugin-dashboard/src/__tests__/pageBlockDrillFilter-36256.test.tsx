/**
 * objectstack-ai/objectstack#36256 — a page block's drill keeps its filter.
 *
 * A page block's `filter` is authored in the spec's rule-array form
 * (`[{ field, operator, value }]`; HotCRM's 销售主页 KPI tiles). The
 * `object-metric` block hands it to the drill as written. The `object-pivot`
 * block composes it with the clicked cell through `composeDrillFilter` first.
 * Either way, every condition must reach the drill list: as one of its chips,
 * or as its base filter.
 *
 * The registered `list-view` is a stub that records the props it is handed.
 * What the real list reads with them is pinned in app-shell
 * (`pageBlockDrillFilter-36256.test.tsx` there).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
import '../index';

const seen = vi.fn();
const StubList = (props: Record<string, unknown>) => {
  seen(props);
  return null;
};
const last = () => seen.mock.calls.at(-1)?.[0] as
  | { schema: { filter?: unknown }; initialFilters?: { conditions: Array<{ field: string; operator: string; value?: unknown }> } }
  | undefined;

/** The drill list's conditions: its chips and its base filter. */
const conditionsSeen = () => ({
  chips: (last()?.initialFilters?.conditions ?? []).map(({ field, operator, value }) => ({ field, operator, value })),
  base: last()?.schema.filter,
});

beforeEach(() => {
  seen.mockClear();
  ComponentRegistry.register('list-view', StubList as never);
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })));
});
afterEach(() => {
  cleanup();
  ComponentRegistry.unregister('list-view');
  vi.unstubAllGlobals();
});

const adapter = () => ({
  aggregate: vi.fn(async () => [{ amount_sum: 1290000 }]),
  find: vi.fn(async () => ({ data: [] })),
  getObjectSchema: vi.fn(async () => ({
    name: 'crm_opportunity',
    nameField: 'name',
    fields: { name: { type: 'text' }, stage: { type: 'text' }, lead_source: { type: 'text' }, amount: { type: 'number' } },
  })),
});

const mount = (schema: Record<string, unknown>) =>
  render(
    <SchemaRendererProvider dataSource={adapter() as never}>
      <SchemaRenderer schema={schema as never} />
    </SchemaRendererProvider>,
  );

describe("a page block's drill keeps its rule-array filter (#36256)", () => {
  it('object-metric: the tile\'s `stage = closed_won` reaches the drill list', async () => {
    mount({
      type: 'object-metric',
      objectName: 'crm_opportunity',
      label: 'Revenue won',
      aggregate: { field: 'amount', function: 'sum' },
      filter: [{ field: 'stage', operator: 'equals', value: 'closed_won' }],
      drillDown: { enabled: true, target: 'dialog' },
    });
    fireEvent.click(await screen.findByRole('button', { name: /revenue won|1,290,000/i }));
    await waitFor(() => expect(last()).toBeDefined());
    expect(conditionsSeen()).toEqual({
      chips: [{ field: 'stage', operator: 'equals', value: 'closed_won' }],
      base: undefined,
    });
  });

  it('object-pivot: the block\'s filter and the clicked cell both reach the drill list', async () => {
    mount({
      type: 'object-pivot',
      objectName: 'crm_opportunity',
      rowField: 'stage',
      columnField: 'lead_source',
      valueField: 'amount',
      aggregation: 'sum',
      data: [
        { id: 'a', stage: 'closed_won', lead_source: 'web', amount: 10 },
        { id: 'b', stage: 'prospecting', lead_source: 'web', amount: 20 },
      ],
      filter: [{ field: 'stage', operator: 'equals', value: 'closed_won' }],
      drillDown: { enabled: true, target: 'dialog' },
    });
    fireEvent.click(await screen.findByLabelText('Drill into stage=closed_won, lead_source=web'));
    await waitFor(() => expect(last()).toBeDefined());
    const { chips, base } = conditionsSeen();
    expect(base).toBeUndefined();
    expect(chips).toEqual(expect.arrayContaining([
      { field: 'stage', operator: 'equals', value: 'closed_won' },
      { field: 'lead_source', operator: 'equals', value: 'web' },
    ]));
  });
});
