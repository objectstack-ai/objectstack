// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#13039 — a chart and a metric tile over the same object make ONE
 * metadata request between them.
 *
 * The metric tile has always read the object's schema through the data
 * source's `getObjectSchema` (the data layer's request-key cache). The chart's
 * option-colour effect read the same document with its own raw `fetch` of
 * `/api/v1/meta/object/NAME`, so a dashboard paid one cached read for every
 * tile and one extra request for every chart. The chart now joins the shared
 * read whenever a data source that answers `getObjectSchema` is in scope.
 *
 * The data source below stands in for the adapter's metadata cache: it joins
 * concurrent reads of one name onto one in-flight promise and records one
 * NETWORK read per name, the contract `MetadataCache.get` keeps. The asserted
 * total is what that source sent PLUS every `/meta/object/` URL that reached
 * the global `fetch`, so a raw read beside the shared one is counted.
 *
 * Direction on the base tree (predicted before the first run): RED, two
 * requests (the tile's shared read and the chart's raw one).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import * as React from 'react';
import { render, cleanup, waitFor, act } from '@testing-library/react';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import { SchemaRendererProvider } from '@object-ui/react';
import type { DataSource } from '@object-ui/types';
import { ObjectChart } from '@object-ui/plugin-charts';
import { ObjectMetricWidget } from '../ObjectMetricWidget';

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

const OPPORTUNITY = {
  name: 'opportunity',
  fields: {
    amount: { type: 'number' },
    stage: { type: 'select', options: [{ value: 'won', label: 'Won', color: '#16a34a' }] },
  },
};

describe('one metadata request for a chart and a metric tile over one object (objectui#13039)', () => {
  it('ObjectChart and ObjectMetricWidget share the object-schema read', async () => {
    const globalCalls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        globalCalls.push(String(input));
        return { ok: true, json: async () => ({ item: OPPORTUNITY }) };
      }),
    );

    const network: string[] = [];
    const inflight = new Map<string, Promise<unknown>>();
    const source = {
      getObjectSchema: vi.fn((name: string) => {
        let hit = inflight.get(name);
        if (!hit) {
          network.push(name);
          hit = new Promise((resolve) => setTimeout(() => resolve(OPPORTUNITY), 5));
          inflight.set(name, hit);
        }
        return hit;
      }),
      aggregate: vi.fn(async () => [{ stage: 'won', amount: 42, amount_sum: 42 }]),
    };

    render(
      <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
        <LocalizationProvider value={{ locale: 'en' }}>
          <SchemaRendererProvider dataSource={source as unknown as DataSource}>
            <ObjectMetricWidget
              objectName="opportunity"
              label="Pipeline"
              aggregate={{ field: 'amount', function: 'sum' }}
            />
            <ObjectChart
              schema={{
                type: 'object-chart',
                chartType: 'bar',
                objectName: 'opportunity',
                aggregate: { field: 'amount', function: 'sum', groupBy: 'stage' },
                xAxisKey: 'stage',
                series: [{ dataKey: 'amount', label: 'Amount' }],
              }}
            />
          </SchemaRendererProvider>
        </LocalizationProvider>
      </I18nProvider>,
    );

    // Both widgets have run their query (the chart reads the schema for its
    // option colours on mount and again for its groupBy labels after it).
    await waitFor(() => expect(source.aggregate.mock.calls.length).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(source.getObjectSchema.mock.calls.length).toBeGreaterThanOrEqual(2));
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 100)));

    const metaObjectFetches = globalCalls.filter((u) => u.includes('/meta/object/'));
    expect({ network, metaObjectFetches }).toEqual({ network: ['opportunity'], metaObjectFetches: [] });
  });
});
