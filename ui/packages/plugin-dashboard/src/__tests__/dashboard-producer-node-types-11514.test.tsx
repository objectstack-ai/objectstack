/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11514 — the dashboard's `object-chart` producers name the node type
 * they build, and every dashboard surface reads a `widgets[]` entry by the
 * slot's element type.
 *
 * ## What is pinned
 *
 *   1. TYPE LEVEL: a `series` dispatch carries `SeriesChartFamily`, and every
 *      member is a family `ObjectChartSchema.chartType` declares
 *      (objectui#11513), so both producers build an `object-chart` node that
 *      `satisfies ObjectChartSchema` with no cast. The slot-entry read type is
 *      the slot's own element type, and `onWidgetsReorder` hands back the
 *      slot's own array type.
 *   2. RUNTIME: for every family the dispatch routes as a series, the
 *      `object-chart` node each surface hands the renderer is accepted by the
 *      Zod face of that node, `ObjectChartSchema` in `@object-ui/types/zod`,
 *      and carries the dispatched family as its `chartType`.
 *
 * The node is read the way `DashboardChart.countSeriesKey-8266.test.tsx` reads
 * it: a recorder registered for `object-chart` receives the node from the real
 * render path of each surface.
 */

import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { SchemaRendererProvider } from '@object-ui/react';
import { ComponentRegistry } from '@object-ui/core';
import '@object-ui/components';
// Registers the real `object-chart` entry this file then overrides, so the
// override is measured against the production registration order.
import '@object-ui/plugin-charts';
import '../index';
import { DashboardRenderer, type DashboardRendererProps } from '../DashboardRenderer';
import { DashboardGridLayout } from '../DashboardGridLayout';
import {
  classifyWidgetType,
  SERIES_CHART_TYPES,
  type DashboardWidgetSlotEntry,
  type SeriesChartFamily,
  type WidgetDispatch,
} from '../widgetDispatch';
import type { DashboardComponentSchema, DataSource, ObjectChartSchema } from '@object-ui/types';
import { ObjectChartSchema as ObjectChartZod } from '@object-ui/types/zod';

type Equal< A, B > =
  (< T >() => T extends A ? 1 : 2) extends (< T >() => T extends B ? 1 : 2) ? true : false;

/* ── 1. type level ───────────────────────────────────────────────────────── */

describe('objectui#11514 — the producers\' declared types', () => {
  it('every series family is a family `ObjectChartSchema.chartType` declares', () => {
    const declared: SeriesChartFamily extends NonNullable< ObjectChartSchema['chartType'] > ? true : false = true;
    const dispatched: Equal< WidgetDispatch['chartType'], SeriesChartFamily | undefined > = true;
    expect([declared, dispatched]).toEqual([true, true]);
  });

  it('a slot entry is read by the slot\'s element type, and the reorder callback takes the slot\'s array', () => {
    const entry: Equal< DashboardWidgetSlotEntry, DashboardComponentSchema['widgets'][number] > = true;
    const reorder: Equal<
      Parameters< NonNullable< DashboardRendererProps['onWidgetsReorder'] > >[0],
      DashboardComponentSchema['widgets']
    > = true;
    expect([entry, reorder]).toEqual([true, true]);
  });
});

/* ── 2. runtime: the Zod face judges the node each surface builds ────────── */

/** Every `object-chart` node a surface handed the renderer, in order. */
const composed: any[] = [];
const recorder = (props: any) => {
  composed.push(props.schema ?? props);
  return null;
};
ComponentRegistry.register('object-chart', recorder as any, {
  namespace: 'test',
  label: 'recorder',
  category: 'plugin',
} as any);

afterEach(cleanup);

/** A stub carrying only the members the path calls (see the 8266 file's NOTE on objectui#7912). */
const dataSource = { aggregate: async () => [], find: async () => [] };

const composeVia = async (surface: 'grid' | 'renderer', widget: Record<string, unknown>) => {
  composed.length = 0;
  render(
    <SchemaRendererProvider dataSource={dataSource as unknown as DataSource}>
      {surface === 'grid' ? (
        <DashboardGridLayout schema={{ widgets: [widget] } as any} />
      ) : (
        <DashboardRenderer schema={{ widgets: [widget] } as any} />
      )}
    </SchemaRendererProvider>,
  );
  await waitFor(() => expect(composed.length).toBeGreaterThan(0));
  const node = composed[composed.length - 1];
  cleanup();
  return node;
};

const FAMILIES = [...SERIES_CHART_TYPES];
const SURFACES = ['grid', 'renderer'] as const;

describe.each(SURFACES)('%s surface — the object-chart node is the declared node (objectui#11514)', (surface) => {
  it('routes a non-empty set of series families (non-vacuity)', () => {
    expect(FAMILIES.length).toBeGreaterThan(0);
    for (const family of FAMILIES) expect(classifyWidgetType(family).family).toBe('series');
  });

  it.each(FAMILIES)('`%s`: the Zod face accepts the node, and its chartType is the dispatched family', async (family) => {
    const node = await composeVia(surface, {
      id: 'w1',
      type: family,
      title: 'Cases',
      options: { xField: 'status' },
      data: { provider: 'object', object: 'crm_case', aggregate: { function: 'count', groupBy: 'status' } },
    });
    expect(node.type).toBe('object-chart');
    expect(node.chartType).toBe(classifyWidgetType(family).chartType);
    const verdict = ObjectChartZod.safeParse(node);
    expect(verdict.success, verdict.success ? '' : JSON.stringify(verdict.error.issues)).toBe(true);
  });
});

/*
 * ⚠️ Dated note, 2026-10-12 — section 3 retired — objectui#12254. It pinned
 * that a number or `true` in a widget's legacy `component` envelope drew its
 * text, bridged through `toRenderableSchema`. The envelope now draws a
 * `metric-card` and nothing else, so a primitive there draws the
 * retired-format placeholder under the card heading; that is pinned in
 * `envelopeDrawRetired-12254.test.tsx`.
 */
