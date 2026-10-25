/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7544 — the ListView capability gate never resolved `chart`.
 *
 * `availableViews` builds `resolvable` from each visualization's binding and
 * then intersects it with `appearance.allowedVisualizations` (ADR-0047:
 * whitelist ∩ resolvable). Seven visualizations had a capability check there —
 * kanban, gallery, calendar, timeline, gantt, map, tree — and `chart` had none,
 * so a `grid` view that declared a complete `chart:` block and whitelisted
 * `['grid', 'chart']` had its own whitelist filtered down to nothing and fell
 * back to `['grid']`. The block was spec-legal and authorable on both sides
 * (`VisualizationTypeSchema` lists `chart`, `ListChartConfigSchema` is the
 * `chart:` key); only the gate never asked.
 *
 * Same shape as objectui#5042 for `map`, and fixed the same way: the gate asks
 * the render branch's own resolver rather than carrying a second copy of the
 * condition. `resolveListChartBinding` is that one source — `case 'chart'`
 * routes on its `shape` and reads its fields, the gate reads its `resolves`.
 *
 * BOTH HALVES ARE PINNED HERE ON PURPOSE. Offering `chart` whenever it is
 * whitelisted would pass the first half and is worse than the bug: with no
 * block the render branch has nothing an author declared to plot. The gate
 * must offer exactly the blocks that render from the author's own names, and
 * the last describe below pins that equivalence against the render branch
 * itself.
 *
 * ⚠️ objectui#6152 round 15: the pre-ADR-0021 inline axes (`xAxisField` /
 * `categoryField`, `yAxisFields` / `valueField`, `aggregation`) were a second,
 * LEGACY shape here, offered and drawn. Every door refuses them by name, and
 * the resolver's legacy leg retired with the render path it fed (and its
 * `'name'` / `'value'` floors, objectui#7547's remainder). Their arms below
 * were TURNED, not deleted: a block spelled that way is now withheld, and a
 * view that forces `chart` renders the unbound node, which `ObjectChart`
 * refuses on screen (objectui#8168).
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ComponentRegistry } from '@object-ui/core';
import { render, waitFor, screen, fireEvent } from '@testing-library/react';
import { ListView } from '../ListView';
import { SchemaRendererProvider } from '@object-ui/react';


/** objectui#12423 — Display is the toolbar default; this file drives the WIDE form's buttons. */
const WIDE_TOOLBAR = { compactToolbar: false } as const;

let captured: Array<Record<string, any>> = [];

ComponentRegistry.register(
  'object-chart',
  (props: Record<string, any>) => {
    captured.push(props);
    return <div data-testid="chart-spy" />;
  },
  { namespace: 'test', label: 'Chart spy', category: 'view' },
);

const makeDataSource = () => ({
  find: vi.fn().mockResolvedValue([]),
  findOne: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getObjectSchema: vi.fn().mockResolvedValue({ name: 'task', fields: {} }),
});

const BASE = {
  type: 'list-view',
  objectName: 'task',
  viewType: 'grid',
  columns: ['name'],
} as const;

/** Mount a grid-typed view with the switcher shown, then open the dropdown form. */
const renderSwitcher = (view: Record<string, unknown>) => {
  const dataSource = makeDataSource() as any;
  const utils = render(
    <SchemaRendererProvider dataSource={dataSource}>
      <ListView schema={{ ...WIDE_TOOLBAR, ...BASE, ...view } as never} dataSource={dataSource} showViewSwitcher />
    </SchemaRendererProvider>,
  );
  const trigger = screen.queryByTestId('view-switcher-dropdown');
  if (trigger) fireEvent.click(trigger);
  return { ...utils, dataSource };
};

/**
 * Find a visualization option by accessible name, in either switcher form —
 * the inline segmented control exposes `role="tab"`, the collapsed dropdown
 * plain buttons. Mirrors the helper in `ListView.mapViewLevelConfig.test.tsx`.
 */
const queryViewOption = (name: string) =>
  screen.queryByRole('tab', { name }) ?? screen.queryByRole('button', { name });

/** Is `chart` offered for a view whitelisting exactly `['grid', 'chart']`? */
const chartOffered = (view: Record<string, unknown>) => {
  renderSwitcher({ appearance: { allowedVisualizations: ['grid', 'chart'] }, ...view });
  return Boolean(queryViewOption('Chart'));
};

describe('the capability gate resolves `chart` from a declared chart block (objectui#7544)', () => {
  beforeEach(() => {
    captured = [];
  });

  // THE DISCRIMINATING ARM — the card's probe, verbatim. Before the fix this
  // read `false`: the whitelist was filtered to `['grid']`.
  it('offers Chart for a complete ADR-0021 block', () => {
    expect(chartOffered({ chart: { dataset: 'ds', dimensions: ['status'], values: ['n'] } })).toBe(true);
  });

  // TURNED (objectui#6152 round 15): these two read `true` while the resolver
  // had a legacy leg. The render branch reads neither spelling now, and the
  // gate asks the same resolver, so it offers neither.
  it('does NOT offer Chart for the retired `xAxisField` / `yAxisFields` block (objectui#6152 round 15)', () => {
    expect(chartOffered({ chart: { xAxisField: 'status', yAxisFields: ['hours'] } })).toBe(false);
  });

  it('does NOT offer Chart for the retired `categoryField` / `valueField` spelling (objectui#6152 round 15)', () => {
    expect(chartOffered({ chart: { categoryField: 'status', valueField: 'hours' } })).toBe(false);
  });

  it('does NOT offer Chart for the retired axes in the `options.chart` bag either (objectui#6152 round 15)', () => {
    expect(chartOffered({ options: { chart: { xAxisField: 'status', yAxisFields: ['hours'], aggregation: 'sum' } } })).toBe(false);
  });

  // These two pinned the legacy leg's PARTIAL declarations (a category with no
  // measure, and the reverse). Kept, renamed: with the leg retired, a lone
  // retired axis is withheld for the same reason a complete set is.
  it('does NOT offer Chart for a retired axis written alone — category only', () => {
    expect(chartOffered({ chart: { xAxisField: 'status' } })).toBe(false);
  });

  it('does NOT offer Chart for a retired axis written alone — measure only', () => {
    expect(chartOffered({ chart: { yAxisFields: ['hours'] } })).toBe(false);
  });

  it('CONTROL: the legacy `options.chart` bag resolves the capability too', () => {
    expect(chartOffered({ options: { chart: { dataset: 'ds', values: ['n'] } } })).toBe(true);
  });

  it('CONTROL: the view-level block wins over the bag, as the render branch resolves it', () => {
    // Whole-block replacement (`schema.chart || schema.options.chart`) is the
    // render branch's existing precedence for `chart` and `tree`; the gate
    // inherits it rather than inventing a merge.
    expect(chartOffered({ chart: { dataset: 'ds', values: ['n'] }, options: { chart: {} } })).toBe(true);
  });

  // THE OTHER HALF. Pinning only the arms above would let the fix degrade into
  // "always allow", which is worse than the bug it closes.
  it('does NOT offer Chart with no chart block anywhere', () => {
    expect(chartOffered({})).toBe(false);
  });

  it('does NOT offer Chart for an empty block', () => {
    expect(chartOffered({ chart: {} })).toBe(false);
  });

  it('does NOT offer Chart for a block that declares no binding at all', () => {
    expect(chartOffered({ chart: { chartType: 'pie' } })).toBe(false);
  });

  it('does NOT offer Chart for a `dataset` with no measure', () => {
    // The card's question is `dataset` WITH `values`. A dataset block with no
    // measure selects nothing to plot, so it is not a resolved capability.
    expect(chartOffered({ chart: { dataset: 'ds', dimensions: ['status'] } })).toBe(false);
  });


  it('CONTROL: `viewType: "chart"` is still offered with no block — the schema-viewType leg is untouched', () => {
    // The "always allow switching back to the viewType defined in schema" leg
    // is how an unbound chart view was reachable before this card, and it stays
    // exactly as it was.
    renderSwitcher({ viewType: 'chart', appearance: { allowedVisualizations: ['grid', 'chart'] } });
    expect(queryViewOption('Chart')).toBeTruthy();
  });

  it('recomputes when the chart block arrives on a later render', () => {
    // The memo's dependency array is part of the fix: a capability check whose
    // input is absent from the deps keeps answering with the first render's
    // schema, and the bug survives in a harder-to-see form.
    const dataSource = makeDataSource() as any;
    const view = (extra: Record<string, unknown>) => ({
      ...BASE,
      appearance: { allowedVisualizations: ['grid', 'chart'] },
      ...extra,
    });
    const { rerender } = render(
      <SchemaRendererProvider dataSource={dataSource}>
        <ListView schema={{ ...WIDE_TOOLBAR, ...view({}) } as never} dataSource={dataSource} showViewSwitcher />
      </SchemaRendererProvider>,
    );
    expect(queryViewOption('Chart')).toBeNull();

    rerender(
      <SchemaRendererProvider dataSource={dataSource}>
        <ListView
          schema={{ ...WIDE_TOOLBAR, ...view({ chart: { dataset: 'ds', values: ['n'] } }) } as never}
          dataSource={dataSource}
          showViewSwitcher
        />
      </SchemaRendererProvider>,
    );
    const trigger = screen.queryByTestId('view-switcher-dropdown');
    if (trigger) fireEvent.click(trigger);
    expect(queryViewOption('Chart')).toBeTruthy();
  });
});

/**
 * The seven positive controls from the card's probe table, kept as the
 * regression net that makes `chart`'s absence a reading rather than an
 * anecdote: every sibling visualization is offered with its binding declared
 * and withheld without it, in both directions.
 */
describe('positive controls — the seven siblings answer in both directions (objectui#7544)', () => {
  const SIBLINGS: Array<{ view: string; label: string; block: Record<string, unknown> }> = [
    { view: 'kanban', label: 'Kanban', block: { kanban: { groupByField: 'status' } } },
    { view: 'gallery', label: 'Gallery', block: { gallery: { coverField: 'cover' } } },
    { view: 'calendar', label: 'Calendar', block: { calendar: { startDateField: 'start' } } },
    { view: 'timeline', label: 'Timeline', block: { timeline: { startDateField: 'start' } } },
    { view: 'gantt', label: 'Gantt', block: { gantt: { startDateField: 'start' } } },
    { view: 'map', label: 'Map', block: { map: { locationField: 'geo' } } },
    { view: 'tree', label: 'Tree', block: { tree: { parentField: 'parent' } } },
  ];

  it.each(SIBLINGS)('offers $label with its binding declared', ({ view, label, block }) => {
    renderSwitcher({ appearance: { allowedVisualizations: ['grid', view] }, ...block });
    expect(queryViewOption(label)).toBeTruthy();
  });

  it.each(SIBLINGS)('does NOT offer $label with no binding', ({ view, label }) => {
    renderSwitcher({ appearance: { allowedVisualizations: ['grid', view] } });
    expect(queryViewOption(label)).toBeNull();
  });
});

/**
 * ONE SOURCE, pinned against the render branch — the requirement that this fix
 * not become a second copy of "what counts as a usable chart block".
 *
 * `resolveListChartBinding` is shared in place, so this is not a stand-in for
 * sharing; it is the equivalence that sharing buys, stated where a future edit
 * to either site would break it: the gate offers exactly those blocks the
 * render branch binds from the author's own names, and withholds exactly those
 * it would have to invent a binding for.
 */
describe('the gate and the render branch answer from one source (objectui#7544)', () => {
  beforeEach(() => {
    captured = [];
  });

  /** Mount a `chart` view and return the schema handed to `object-chart`. */
  async function chartSchemaFor(view: Record<string, unknown>) {
    captured = [];
    const dataSource = makeDataSource() as any;
    render(
      <SchemaRendererProvider dataSource={dataSource}>
        <ListView schema={{ ...WIDE_TOOLBAR, ...BASE, viewType: 'chart', ...view } as never} dataSource={dataSource} />
      </SchemaRendererProvider>,
    );
    await waitFor(() => expect(captured.length).toBeGreaterThan(0));
    return captured[captured.length - 1].schema as Record<string, unknown>;
  }

  it('an offered ADR-0021 block renders from the author names', async () => {
    const block = { chart: { dataset: 'ds', dimensions: ['status'], values: ['n'] } };
    expect(chartOffered(block)).toBe(true);

    const schema = await chartSchemaFor(block);
    expect(schema.dataset).toBe('ds');
    expect(schema.dimensions).toEqual(['status']);
    expect(schema.values).toEqual(['n']);
    expect(schema.xAxisKey).toBe('status');
  });

  // TURNED (objectui#6152 round 15). This arm read "an offered legacy block
  // renders from the author names": the block was offered and its axes became
  // the node's `aggregate` / `xAxisKey`. The axes are read by nothing now, so
  // the block is withheld AND, on a view that forces `chart`, binds nothing.
  it('a retired legacy block is withheld, and a forced chart view binds none of its axes', async () => {
    const block = { chart: { xAxisField: 'status', yAxisFields: ['hours'], aggregation: 'sum' } };
    expect(chartOffered(block)).toBe(false);

    const schema = await chartSchemaFor(block);
    expect(schema.type).toBe('object-chart');
    expect(schema.objectName).toBe('task');
    expect(schema.aggregate).toBeUndefined();
    expect(schema.xAxisKey).toBeUndefined();
    expect(schema.series).toBeUndefined();
  });

  it('the block the gate withholds is exactly the one the render branch binds nothing for', async () => {
    // Documents WHY the negative half is not cosmetic. With no block the
    // render branch used to return a chart bound to names no author wrote
    // (`xAxisKey: 'name'`, measure `'value'`, objectui#7547's floors). Those
    // floors retired in objectui#6152 round 15: the node now names no category,
    // which `ObjectChart` refuses on screen (objectui#8168) — the gate and the
    // branch still agree that nothing here is plottable.
    expect(chartOffered({})).toBe(false);

    const schema = await chartSchemaFor({});
    expect(schema.type).toBe('object-chart');
    expect(schema.objectName).toBe('task');
    expect(schema.aggregate).toBeUndefined();
    expect(schema.xAxisKey).toBeUndefined();
  });
});
