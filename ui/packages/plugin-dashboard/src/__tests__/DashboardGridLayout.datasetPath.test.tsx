/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4614 — the editable grid gains the ADR-0021 dataset path it never had.
 *
 * `DashboardRenderer` has routed a dataset-bound widget through `DatasetWidget`
 * — the governed `queryDataset` path — since ADR-0021. `DashboardGridLayout`,
 * separately exported (and, until objectui#10859 batch 8, registered as the
 * `dashboard-grid` SDUI component),
 * never read `widget.dataset` at all and took no `dataSource` prop, so a widget
 * authored in the CURRENT shape fell through to the static-data branch. Measured
 * on `origin/main` (8640cec19) by spying on the node handed to `SchemaRenderer`,
 * the silence had three flavours, not the one the issue reported:
 *
 *   bar    → { type: 'chart',      chartType: 'bar', data: [], … }  → blank chart
 *   metric → { type: 'metric',     label: 'metric', value: '—' }    → em dash
 *   table  → { type: 'data-table', data: [], … }                    → empty table
 *
 * No data, no diagnostic, no path to fix — objectui#4612's defect one level up.
 * #4612 was the RETIRED authoring shape falling through this same surface; this
 * is the CURRENT one.
 *
 * ## Why the component registries are imported here
 *
 * At module scope, never in a hook (the cold transform must not be billed to a
 * bounded test budget — AGENTS.md 测试纪律, objectui#3010), and for a reason this
 * suite cannot do without: with `chart` unregistered, `SchemaRenderer` renders a
 * red "Unknown component type" box carrying `role="alert"`, and an assertion for
 * the dataset diagnostic's alert would have passed on that box — pre-fix, with
 * no dataset path in the file at all. `chart` lives in `@object-ui/plugin-charts`
 * (a declared devDependency), not in `@object-ui/components`, so BOTH are needed
 * to reproduce what a real host renders. With them, the pre-fix tile for a
 * dataset-bound widget is exactly what the issue says: empty — no alert, no
 * chart, nothing.
 *
 * ## Why no new placeholder for the no-dataSource half
 *
 * The ruling asked for a VISIBLE state — never a blank — when a dataset-bound
 * widget arrives with no data source, and asked to measure `DatasetWidget`'s own
 * no-capability rendering before inventing a second one. Measured: with
 * `dataSource={undefined}` it renders `role="alert"` carrying "This data source
 * does not support dataset queries." (`DatasetWidget.tsx:766-771` sets the error
 * state BEFORE the measures check; `:929-934` renders it). It is visible in this
 * context, so routing through `DatasetWidget` UNCONDITIONALLY is the whole fix
 * and no third diagnostic surface is declared. A host that mounts the component
 * with no `dataSource` (as the retired `dashboard-grid` SDUI registration always
 * did) hits exactly this case — pinned below.
 *
 * The negative controls are the binding half: static-data, `options.data`
 * provider, and the #4613 legacy-retired widget must all keep rendering exactly
 * as before AND must never reach the dataset query.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import type { DashboardComponentSchema } from '@object-ui/types';
import '@object-ui/components';
import '@object-ui/plugin-charts';
import { DashboardGridLayout } from '../DashboardGridLayout';

/* ────────────────────────────────────────────────────────────────────────────
 * objectui#5299 — this file's own real-network escape (same class as #5225 /
 * #5280, a DIFFERENT call site).
 *
 * `-t` bisected across all 13 cases: isolating each of the 5 negative-control
 * tests alone reproduces the escape ONLY for 'does NOT take the dataset path
 * for an options.data provider widget' (3/3). The other two suspects the card
 * named — both #4613 legacy-retired-widget cases — do NOT escape in isolation
 * (0/1 each), and neither do the dataset-bound positives, confirming the
 * card's own re-derived reading: `useDatasetDimensionMeta`'s `!object` guard
 * is a no-op here (no mocked `queryDataset` result declares `object`), so it
 * was never the site. There is exactly ONE escape in this file, not several.
 *
 * The site: the `options.data.provider: 'object'` widget maps to component
 * type `object-chart` (`DashboardGridLayout.tsx`'s `getComponentSchema`,
 * `isObjectProvider` branch) with `objectName: 'invoices'` and a defaulted
 * `xAxisKey: 'name'` (no `xField` authored). `ObjectChart` — the ORIGINAL
 * #4106 defect site, still carrying its own inline fetch rather than the
 * `useDatasetDimensionMeta` hook #4389 later extracted for the dataset path —
 * runs a category-dimension option-color probe on mount:
 *
 *   ObjectChart                        packages/plugin-charts/src/ObjectChart.tsx
 *     useEffect (~L351-415)
 *       → `const doFetch = apiFetch ?? fetch`   ← the escape (L355)
 *         → GET /api/v1/meta/object/invoices    (L376, via loadDimensionFieldMeta)
 *
 * With no `SchemaRendererProvider` in this file's render tree, `context` is
 * undefined, so `apiFetch` is undefined and the probe degrades to the GLOBAL
 * `fetch` on purpose (#4114 / #4121 — a standalone embed must keep rendering,
 * not crash). Under happy-dom that global `fetch` is a real HTTP client
 * resolving the relative URL against the default document origin
 * (`http://localhost:3000`), hence the ECONNREFUSED-on-port-3000 signature.
 * The read is wrapped in `try { … } catch { setOptionMeta(null) }`, which is
 * why the widget renders fine and all 13 tests stay green regardless.
 *
 * Answered here from the same RECORDING-double shape #5225's reference fix
 * (PR #5283) established and #5280 ported (PR #5300): NOT a blanket network
 * stub — it records every URL it is handed, `afterEach` fails on any URL that
 * is not the metadata route, and the probe's own request is pinned below.
 * ──────────────────────────────────────────────────────────────────────────── */

const META_OBJECT_ROUTE = /^\/api\/v1\/meta\/object\/(.+)$/;

let metaCalls: string[] = [];

/** Serve `/api/v1/meta/object/<name>` with an empty schema doc; record everything. */
function installMetaObjectDouble() {
  metaCalls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(
        input && typeof input === 'object' && 'url' in input ? (input as { url: unknown }).url : input,
      );
      metaCalls.push(url);
      const m = META_OBJECT_ROUTE.exec(url);
      if (!m) return { ok: false, status: 404, json: async () => ({}) };
      const name = decodeURIComponent(m[1]);
      // No fields declared: `loadDimensionFieldMeta` resolves nothing, so
      // `optionMeta` stays empty and no pre-existing assertion changes
      // meaning — this widget's colors were never asserted against the probe.
      return { ok: true, status: 200, json: async () => ({ item: { name, fields: {} } }) };
    }),
  );
}

beforeEach(() => {
  installMetaObjectDouble();
});

afterEach(() => {
  // The double is a router, not a sink: an escape to any OTHER endpoint fails
  // here instead of vanishing into ObjectChart's best-effort `catch`.
  expect(metaCalls.filter((url) => !META_OBJECT_ROUTE.test(url))).toEqual([]);
  // Unmount BEFORE restoring the real `fetch`. Vitest runs `afterEach` hooks
  // in reverse registration order, so the light DOM setup's RTL cleanup (its
  // own `afterEach`, registered before this file loads) runs AFTER this one:
  // unstubbing first would leave the tree mounted with the real global back
  // in place, and a metadata effect that settles in that window escapes again
  // (#5225 / #5280 measured this ordering flake).
  cleanup();
  vi.unstubAllGlobals();
});

/**
 * `dataset` / `values` / `dimensions` are the ADR-0021 authoring keys; `object`
 * + `categoryField` (the legacy control) were removed from the widget vocabulary
 * by framework#3320. The cast mirrors `DashboardGridLayout.legacyRetired.test.tsx`
 * — stored metadata is what a renderer actually receives.
 */
const dash = (widget: Record<string, unknown>): DashboardComponentSchema =>
  ({ type: 'dashboard', widgets: [widget] }) as unknown as DashboardComponentSchema;

/** The same stub shape `DatasetWidget`'s own suite uses for a capable source. */
const makeSource = (impl: () => Promise<Record<string, unknown>>) => ({ queryDataset: vi.fn(impl) });

/**
 * Negative-control discipline, carried over from the #4613 suite: every control
 * asserts BOTH the absence of the dataset path AND that the widget really
 * rendered — otherwise "no dataset query" would also be satisfied by a grid that
 * threw or drew nothing, and the control would pass for the wrong reason.
 */
const renderOne = (widget: Record<string, unknown>, dataSource?: unknown) => {
  const { container } = render(<DashboardGridLayout schema={dash(widget)} dataSource={dataSource} />);
  expect(container.querySelector('[data-testid="grid-layout"]')).toBeInTheDocument();
  return container;
};

describe('DashboardGridLayout dataset-bound widgets (#4614)', () => {
  // ── positives: the path that did not exist ──────────────────────────────
  it('renders the KPI value a dataset-bound metric widget queried for', async () => {
    const src = makeSource(async () => ({
      rows: [{ invoice_count: 42 }],
      fields: [{ name: 'invoice_count', type: 'number', label: 'Invoices' }],
    }));
    render(
      <DashboardGridLayout
        schema={dash({ id: 'w1', type: 'metric', dataset: 'invoices', values: ['invoice_count'] })}
        dataSource={src}
      />,
    );
    // The real DatasetWidget outcome from the canned rows. Before this change
    // the widget rendered the static-data branch's em dash — `value: '—'`.
    expect(await screen.findByText('42')).toBeInTheDocument();
    expect(screen.queryByText('—')).not.toBeInTheDocument();
    expect(src.queryDataset).toHaveBeenCalledWith('invoices', { dimensions: [], measures: ['invoice_count'] });
  });

  it('renders real table content (resolved header labels + a cell) for a dataset-bound table widget', async () => {
    const src = makeSource(async () => ({
      rows: [{ status: 'Open', invoice_count: 5 }],
      fields: [
        { name: 'status', type: 'string', label: 'Status' },
        { name: 'invoice_count', type: 'number', label: 'Invoices' },
      ],
    }));
    render(
      <DashboardGridLayout
        schema={dash({ id: 'w1', type: 'table', dataset: 'invoices', dimensions: ['status'], values: ['invoice_count'] })}
        dataSource={src}
      />,
    );
    // Header labels come from the dataset result's fields — the `data: []`
    // data-table it used to build has no headers and no cells at all.
    expect(await screen.findByText('Status')).toBeInTheDocument();
    expect(screen.getByText('Invoices')).toBeInTheDocument();
    expect(screen.getByText('Open')).toBeInTheDocument();
  });

  it('runs the governed dataset query for a dataset-bound chart widget — dimensions→dimensions, values→measures', async () => {
    const src = makeSource(async () => ({
      rows: [{ status: 'Open', invoice_count: 5 }, { status: 'Paid', invoice_count: 9 }],
      fields: [
        { name: 'status', type: 'string', label: 'Status' },
        { name: 'invoice_count', type: 'number', label: 'Invoices' },
      ],
    }));
    render(
      <DashboardGridLayout
        schema={dash({ id: 'w1', type: 'bar', dataset: 'invoices', dimensions: ['status'], values: ['invoice_count'] })}
        dataSource={src}
      />,
    );
    // The query IS the observable outcome for a chart under jsdom (recharts
    // draws nothing at zero width), and it is precisely what the grid skipped:
    // `data: []` never called anything.
    await waitFor(() =>
      expect(src.queryDataset).toHaveBeenCalledWith('invoices', { dimensions: ['status'], measures: ['invoice_count'] }),
    );
  });

  it('mounts DatasetWidget itself — a pending query shows ITS loading skeleton, which no other branch of this grid can produce', () => {
    // The `pendingSource` idiom from DatasetWidget's own suite. `dataset-loading`
    // is DatasetWidget's testid and nothing else on this surface emits it, so
    // this pins WHICH component renders the tile, independently of what the
    // query eventually resolves to.
    const src = { queryDataset: vi.fn(() => new Promise<Record<string, unknown>>(() => {})) };
    render(
      <DashboardGridLayout
        schema={dash({ id: 'w1', type: 'bar', dataset: 'invoices', dimensions: ['status'], values: ['invoice_count'] })}
        dataSource={src}
      />,
    );
    expect(screen.getByTestId('dataset-loading')).toBeInTheDocument();
  });

  it('says so VISIBLY when a dataset-bound widget arrives with NO dataSource — never a blank (the SDUI registration path)', async () => {
    // A host that mounts the grid with no adapter — the shape the retired
    // `dashboard-grid` SDUI type (objectui#10859 batch 8) always rendered in.
    // It must state the problem rather than draw nothing — measured pre-fix,
    // the tile held no alert, no chart and no text at all.
    render(<DashboardGridLayout schema={dash({ id: 'w1', type: 'bar', dataset: 'invoices', dimensions: ['status'], values: ['count'] })} />);
    // Wording pinned verbatim — the message IS the diagnostic, and it is
    // DatasetWidget's own (one condition, one wording, no third surface).
    const message = await screen.findByText('This data source does not support dataset queries.');
    expect(message).toBeInTheDocument();
    // Rendered AS an alert — asserted on the element carrying the message, not
    // by a bare role query, which `SchemaRenderer`'s own "Unknown component
    // type" box would also satisfy.
    expect(message.closest('[role="alert"]')).not.toBeNull();
  });

  it.each([
    ['metric', { id: 'w1', type: 'metric', dataset: 'invoices', values: ['count'] }],
    ['table', { id: 'w1', type: 'table', dataset: 'invoices', dimensions: ['status'], values: ['count'] }],
    ['pivot', { id: 'w1', type: 'pivot', dataset: 'invoices', dimensions: ['status'], values: ['count'] }],
  ])('cures the %s flavour of the same silence — no dataSource still says something', async (_kind, widget) => {
    // The pre-fix measurement found three different empty artifacts, one per
    // family (blank chart / em-dash metric / empty table). All three are the
    // same defect and all three take the same cure, so all three are pinned —
    // the em dash in particular reads as a rendered value, not as an error.
    render(<DashboardGridLayout schema={dash(widget)} />);
    expect(await screen.findByText('This data source does not support dataset queries.')).toBeInTheDocument();
    expect(screen.queryByText('—')).not.toBeInTheDocument();
  });

  // ── negatives: everything that must render exactly as it did ────────────
  it('does NOT take the dataset path for a static-data widget', () => {
    const src = makeSource(async () => ({ rows: [] }));
    renderOne({ id: 'w1', type: 'bar', options: { data: [{ name: 'A', value: 1 }] } }, src);
    expect(src.queryDataset).not.toHaveBeenCalled();
    expect(screen.queryByText(/does not support dataset queries/)).not.toBeInTheDocument();
  });

  it('does NOT take the dataset path for an options.data provider widget', () => {
    // The nested `{ provider: 'object', … }` config is a separate, LIVE surface
    // that carries its own `object`/`aggregate` and renders through
    // `object-chart`. Conflating it with a dataset binding would retire it.
    const src = makeSource(async () => ({ rows: [] }));
    renderOne(
      {
        id: 'w1',
        type: 'bar',
        options: { data: { provider: 'object', object: 'invoices', aggregate: { field: 'amount', function: 'sum' } } },
      },
      src,
    );
    expect(src.queryDataset).not.toHaveBeenCalled();
    expect(screen.queryByText(/does not support dataset queries/)).not.toBeInTheDocument();
  });

  it('does NOT take the dataset path for a static-data pivot widget', () => {
    const src = makeSource(async () => ({ rows: [] }));
    renderOne({ id: 'w1', type: 'pivot', options: { data: [{ region: 'EMEA', amount: 1 }] } }, src);
    expect(src.queryDataset).not.toHaveBeenCalled();
  });

  it('still shows the #4613 retired-format placeholder for a legacy widget, and runs no dataset query', () => {
    // The shared sentinel keeps its verdict: `isLegacyRetiredWidget` returns
    // false the moment a widget carries `dataset`, so the two conditions are
    // mutually exclusive and neither can capture the other's widget.
    const src = makeSource(async () => ({ rows: [] }));
    renderOne({ id: 'w1', type: 'bar', object: 'invoices', categoryField: 'month', valueField: 'amount', aggregate: 'sum' }, src);
    expect(
      screen.getByText('This widget uses a retired data format. Edit it to bind a dataset.'),
    ).toBeInTheDocument();
    expect(src.queryDataset).not.toHaveBeenCalled();
  });

  it('renders a legacy widget’s placeholder even when a dataSource IS supplied — the sentinel is not a data question', () => {
    const src = makeSource(async () => ({ rows: [{ x: 1 }] }));
    renderOne({ id: 'w1', type: 'metric', object: 'invoices', aggregate: 'count' }, src);
    expect(screen.getByText(/retired data format/i)).toBeInTheDocument();
    expect(src.queryDataset).not.toHaveBeenCalled();
  });
});

/**
 * objectui#5299 — the `options.data.provider: 'object'` widget's own
 * category-color metadata probe, pinned so a future widening of the read (or
 * a regression back onto the real network) shows up as a red test here
 * instead of a silent extra request to whatever owns port 3000.
 */
describe('DashboardGridLayout — object-chart metadata probe (objectui#5299)', () => {
  it('probes exactly the widget-declared object, once, over the metadata route', async () => {
    const src = { queryDataset: vi.fn(async () => ({ rows: [] })) };
    render(
      <DashboardGridLayout
        schema={dash({
          id: 'w1',
          type: 'bar',
          options: { data: { provider: 'object', object: 'invoices', aggregate: { field: 'amount', function: 'sum' } } },
        })}
        dataSource={src}
      />,
    );
    await waitFor(() => expect(metaCalls).toEqual(['/api/v1/meta/object/invoices']));
    // Bisected as the ONLY escape site in this file (see the block comment
    // above): the rows never touch this channel, which is why the sibling
    // `dataSource` double in the test above it could not intercept it either.
    expect(src.queryDataset).not.toHaveBeenCalled();
  });
});
