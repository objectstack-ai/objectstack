/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9172 — `DashboardGridLayout` composed `series: [{ dataKey }]` on
 * BOTH chart branches with NO `label` key at all, so `ChartRenderer`'s
 * `s.label || s.dataKey` fallback rendered the raw field key in the legend /
 * tooltip while `DashboardRenderer` — the sibling relay composing a chart node
 * for the SAME stored widget — rendered the humanized one (objectui#9055
 * fixed the label on that relay only, and deliberately did not touch this
 * one; see that card's body for why).
 *
 * The fix moves the three-arm decision (`composeSeriesLabel`, `../utils`) to
 * a single shared authority both relays call, rather than growing a second
 * copy of it here. This file is this relay's own pin (the sibling already has
 * one: `fieldKeySpellingOutsideTable-9055.test.tsx`), plus a same-widget
 * PARITY check between the two relays — the actual defect class objectui#5425
 * ruled out ("one value, two spellings, one dashboard").
 *
 * `close_date` / `unit_price` are used throughout because their humanized
 * spelling ("Close Date" / "Unit Price") differs from the raw key — a key
 * whose raw and humanized forms coincide cannot tell the fixed world from the
 * broken one.
 */

import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { SchemaRendererProvider } from '@object-ui/react';
import { ComponentRegistry } from '@object-ui/core';
import { I18nProvider } from '@object-ui/i18n';
// Registers the real `object-chart` / `chart` entries this file then
// overrides, so the override is measured against the production
// registration order rather than against an empty registry.
import '@object-ui/components';
import '@object-ui/plugin-charts';
import '../index';
import { DashboardRenderer } from '../DashboardRenderer';
// Mounted directly: its `dashboard-grid` node key was retired by objectui#10859
// batch 8, so the component, not a registry lookup, is the surface under test.
import { DashboardGridLayout } from '../DashboardGridLayout';
import { humanizeFieldKey } from '../utils';
import type { DataSource } from '@object-ui/types';

const OBJECT_NAME = 'crm_opportunity';

/** Every composed chart node either relay handed the renderer, in order. */
const composed: any[] = [];

const recorder = (props: any) => {
  composed.push(props.schema ?? props);
  return null;
};
for (const type of ['object-chart', 'chart'] as const) {
  ComponentRegistry.register(type, recorder as any, {
    namespace: 'test',
    label: 'recorder',
    category: 'plugin',
  } as any);
}

afterEach(cleanup);

const dataSource = { aggregate: async () => [], find: async () => [] };

type Wrap = (node: React.ReactElement) => React.ReactElement;

/** Render one widget through the GRID relay and return the node it composed. */
async function composeViaGrid(widget: Record<string, unknown>, wrap?: Wrap) {
  composed.length = 0;
  const node = (
    <SchemaRendererProvider dataSource={dataSource as unknown as DataSource}>
      <DashboardGridLayout schema={{ widgets: [widget] } as any} />
    </SchemaRendererProvider>
  );
  render(wrap ? wrap(node) : node);
  await waitFor(() => expect(composed.length).toBeGreaterThan(0));
  const result = composed[composed.length - 1];
  cleanup();
  return result;
}

/** Render one widget through the RENDERER relay and return the node it composed. */
async function composeViaRenderer(widget: Record<string, unknown>, wrap?: Wrap) {
  composed.length = 0;
  const node = (
    <SchemaRendererProvider dataSource={dataSource as unknown as DataSource}>
      <DashboardRenderer schema={{ widgets: [widget] } as any} />
    </SchemaRendererProvider>
  );
  render(wrap ? wrap(node) : node);
  await waitFor(() => expect(composed.length).toBeGreaterThan(0));
  const result = composed[composed.length - 1];
  cleanup();
  return result;
}

const objectBoundChart = (aggregate: Record<string, unknown>) => ({
  id: 'w-object',
  type: 'bar',
  title: 'By stage',
  options: { xField: 'stage' },
  data: { provider: 'object', object: OBJECT_NAME, aggregate },
});

const staticChart = (yField: string) => ({
  id: 'w-static',
  type: 'bar',
  title: 'Inline rows',
  options: { xField: 'name', yField },
  data: [{ name: 'Acme', [yField]: 1 }],
});

const enWrap: Wrap = (node) => (
  <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false, resources: {} }}>
    {node}
  </I18nProvider>
);

describe('objectui#9172 — DashboardGridLayout composes a series label (was: none at all)', () => {
  it('object-bound arm: legends under the humanized key, not the raw one', async () => {
    const node = await composeViaGrid(
      objectBoundChart({ function: 'max', field: 'close_date', groupBy: 'stage' }),
    );
    expect(node.series[0].label).toBe(humanizeFieldKey('close_date'));
    expect(node.series[0].label).not.toBe('close_date');
  });

  it('static-data arm: legends under the humanized key, not the raw one', async () => {
    const node = await composeViaGrid(staticChart('unit_price'));
    expect(node.series[0].label).toBe(humanizeFieldKey('unit_price'));
    expect(node.series[0].label).not.toBe('unit_price');
  });

  it('LIVE CONTROL — a fieldless count still gets the i18n aggregate name, never a humanized "count"', async () => {
    // Same arm-1 control the sibling relay's pin carries: a blind
    // "humanize everything" applied above this branch would render the
    // humanized synthetic key here and fail.
    const node = await composeViaGrid(
      objectBoundChart({ function: 'count', groupBy: 'stage' }),
      enWrap,
    );
    expect(node.series[0].label).toBe('Count');
  });

  it('BUNDLE ENTRY — a translated field label still wins over the humanized fallback', async () => {
    const resources = { zh: { crm: { fields: { [OBJECT_NAME]: { close_date: '结单日期' } } } } };
    const node = await composeViaGrid(
      objectBoundChart({ function: 'max', field: 'close_date', groupBy: 'stage' }),
      (n) => (
        <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false, resources }}>
          {n}
        </I18nProvider>
      ),
    );
    expect(node.series[0].label).toBe('结单日期');
  });
});

describe('objectui#9172 — parity between the two relays for the SAME widget', () => {
  it('object-bound arm: grid and renderer compose the IDENTICAL label', async () => {
    const widget = objectBoundChart({ function: 'max', field: 'close_date', groupBy: 'stage' });
    const gridLabel = (await composeViaGrid(widget)).series[0].label;
    const rendererLabel = (await composeViaRenderer(widget)).series[0].label;
    expect(gridLabel).toBe(rendererLabel);
    expect(gridLabel).toBe(humanizeFieldKey('close_date'));
  });

  it('static-data arm: grid and renderer compose the IDENTICAL label', async () => {
    const widget = staticChart('unit_price');
    const gridLabel = (await composeViaGrid(widget)).series[0].label;
    const rendererLabel = (await composeViaRenderer(widget)).series[0].label;
    expect(gridLabel).toBe(rendererLabel);
    expect(gridLabel).toBe(humanizeFieldKey('unit_price'));
  });
});
