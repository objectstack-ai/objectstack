/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#25330 — a chart's null bucket reads the name its dataset declares.
 *
 * System Overview's "Events by User" drew the rows the platform writes itself,
 * its largest bar, under the global `chart.nullCategory` default, "(None)". The
 * audit dataset now declares `nullLabel` on its `user_id` dimension, and the
 * server carries it on that column's descriptor as `fields[].nullLabel`,
 * resolved to the request's locale the way `label` is. The widget draws the
 * bucket under that name; a column without one keeps the locale default.
 *
 * The forward call and the drill share the one label, so a click on the
 * renamed bar must still drill to the null row (#4498's dead-click rule).
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { ComponentRegistry, NULL_CATEGORY_LABEL } from '@object-ui/core';
import { I18nProvider } from '@object-ui/i18n';
import { DatasetWidget } from '../DatasetWidget';

let capturedChartProps: any = null;
beforeAll(() => {
  ComponentRegistry.register('chart', (props: any) => {
    capturedChartProps = props;
    return null;
  });
});

const drillFilters: Array<Record<string, unknown>> = [];
vi.mock('../DrillDownDrawer', () => ({
  DrillDownDrawer: ({ filter }: { filter: Record<string, unknown> }) => {
    drillFilters.push(filter);
    return null;
  },
}));

afterEach(() => {
  cleanup();
  capturedChartProps = null;
  drillFilters.length = 0;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// `user_id` is plain text here so no option list can relabel a category and
// blur which channel produced the bucket's name.
const AUDIT_LOG = { name: 'sys_audit_log', fields: { user_id: { type: 'text' }, action: { type: 'text' } } };

function installMetaRouter() {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ item: AUDIT_LOG }) })));
}

/** The audit answer, with `user_id`'s descriptor carrying `nullLabel` when given. */
const auditDataset = (userNullLabel?: string, actionNullLabel?: string) => ({
  queryDataset: vi.fn(async (_name: string, selection: { dimensions: string[] }) => {
    const pivot = selection.dimensions.length === 2;
    return {
      rows: pivot
        ? [
            { user_id: 'Dev Admin', action: 'login', event_count: 2 },
            { user_id: null, action: 'create', event_count: 740 },
          ]
        : [
            { user_id: 'Dev Admin', event_count: 2 },
            { user_id: null, event_count: 740 },
          ],
      fields: [
        { name: 'user_id', type: 'string', label: 'User', ...(userNullLabel !== undefined ? { nullLabel: userNullLabel } : {}) },
        ...(pivot
          ? [{ name: 'action', type: 'string', label: 'Action', ...(actionNullLabel !== undefined ? { nullLabel: actionNullLabel } : {}) }]
          : []),
        { name: 'event_count', type: 'number', label: 'Events' },
      ],
      object: 'sys_audit_log',
      dimensionFields: pivot ? { user_id: 'user_id', action: 'action' } : { user_id: 'user_id' },
      drillRawRows: pivot
        ? [{ user_id: 'usr_dev', action: 'login' }, { user_id: null, action: 'create' }]
        : [{ user_id: 'usr_dev' }, { user_id: null }],
    };
  }),
});

function renderIn(language: string, dataSource: { queryDataset: unknown }, dimensions: string[] = ['user_id']) {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false, resources: {} }}>
      <DatasetWidget
        widget={{
          type: 'bar',
          dataset: 'sys_audit_log_metrics',
          dimensions,
          values: ['event_count'],
          drillDown: { enabled: true },
        }}
        dataSource={dataSource as any}
      />
    </I18nProvider>,
  );
}

const categories = () => (capturedChartProps?.schema?.data ?? []).map((r: any) => r.user_id);

describe('DatasetWidget — the null bucket reads the dataset-declared nullLabel (objectstack#25330)', () => {
  it('draws the null bucket as `System` under `en`', async () => {
    installMetaRouter();
    renderIn('en', auditDataset('System'));

    await waitFor(() => expect(categories().length).toBe(2));
    expect(categories()).toEqual(['Dev Admin', 'System']);
    expect(categories()).not.toContain(NULL_CATEGORY_LABEL);
    const byCategory = Object.fromEntries(capturedChartProps.schema.data.map((r: any) => [r.user_id, r.event_count]));
    expect(byCategory).toMatchObject({ System: 740 });
  });

  it('draws the zh-CN answer\'s `系统` over the zh locale default `(未指定)`', async () => {
    installMetaRouter();
    // A zh-CN console's request resolves the dimension's map to `系统` server-side.
    renderIn('zh', auditDataset('系统'));

    await waitFor(() => expect(categories().length).toBe(2));
    expect(categories()).toContain('系统');
    expect(categories()).not.toContain('(未指定)');
  });

  it('a click on the renamed bar still drills to the null row', async () => {
    installMetaRouter();
    renderIn('en', auditDataset('System'));

    await waitFor(() => expect(categories()).toContain('System'));
    capturedChartProps.onSegmentClick({ category: 'System' });

    await waitFor(() => expect(drillFilters.length).toBeGreaterThan(0));
    expect(drillFilters[drillFilters.length - 1]).toEqual({ user_id: { $null: true } });
  });

  it('BOUNDARY — a column with no nullLabel keeps the locale default', async () => {
    installMetaRouter();
    renderIn('en', auditDataset());
    await waitFor(() => expect(categories().length).toBe(2));
    expect(categories()).toEqual(['Dev Admin', NULL_CATEGORY_LABEL]);

    cleanup();
    capturedChartProps = null;
    renderIn('zh', auditDataset());
    await waitFor(() => expect(categories().length).toBe(2));
    expect(categories()).toContain('(未指定)');
  });

  it('PIVOT — a declared name applies only when both dimensions declare the same one', async () => {
    installMetaRouter();
    // Only `user_id` declares one: the series dimension's null group would
    // otherwise read "System" too, so the pivot keeps the default.
    renderIn('en', auditDataset('System'), ['user_id', 'action']);
    await waitFor(() => expect(categories().length).toBe(2));
    expect(categories()).toContain(NULL_CATEGORY_LABEL);
    expect(categories()).not.toContain('System');

    cleanup();
    capturedChartProps = null;
    renderIn('en', auditDataset('Unknown', 'Unknown'), ['user_id', 'action']);
    await waitFor(() => expect(categories().length).toBe(2));
    expect(categories()).toContain('Unknown');
  });
});
