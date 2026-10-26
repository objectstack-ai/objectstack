// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#13039 — N dataset widgets over one object make ONE
 * `meta/object/NAME` request between them.
 *
 * This is the route the card measured (HotCRM's sales dashboard: every widget
 * is dataset-bound). `DatasetWidget` resolves its dimension labels through
 * `@object-ui/react`'s `useDatasetDimensionMeta`, which read the object with
 * its own raw `fetch`, one request per non-metric widget. The hook now reads
 * through `SchemaRendererContext`'s `dataSource.getObjectSchema` when the
 * source answers it, which is the data layer's shared request-key cache; the
 * raw read stays the fallback.
 *
 * The data source below stands in for the adapter's metadata cache: it joins
 * concurrent reads of one name onto one in-flight promise and records one
 * NETWORK read per name, the contract `MetadataCache.get` keeps. Each pin
 * counts what that source sent PLUS every `/meta/object/` URL that reached the
 * global `fetch`. The raw route answers the same documents, so a pin can go
 * red only on which route carried the read, never on a missing document.
 *
 * Directions on the base tree (predicted before the first run):
 *   three widgets over one object ⇒ one request        RED (three raw reads)
 *   two objects ⇒ one request each                     RED (raw reads)
 *   no data source in context ⇒ raw fallback relabels  GREEN (unchanged)
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import * as React from 'react';
import { render, cleanup, waitFor, act } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRendererProvider } from '@object-ui/react';
import type { DataSource } from '@object-ui/types';
import { DatasetWidget } from '../DatasetWidget';

const captured: Array<{ data?: Array<Record<string, unknown>> }> = [];
beforeAll(() => {
  ComponentRegistry.register('chart', (props: { schema?: { data?: Array<Record<string, unknown>> } }) => {
    if (props?.schema) captured.push(props.schema);
    return null;
  });
});

const DOCS: Record<string, unknown> = {
  crm_opportunity: {
    name: 'crm_opportunity',
    fields: {
      stage: {
        type: 'select',
        options: [
          { value: 'won', label: 'Closed Won' },
          { value: 'lost', label: 'Closed Lost' },
        ],
      },
    },
  },
  crm_forecast: {
    name: 'crm_forecast',
    fields: { stage: { type: 'select', options: [{ value: 'won', label: 'Committed' }] } },
  },
};

/** Which object each dataset is over, as the query result names it. */
const DATASET_OBJECT: Record<string, string> = {
  opportunity_metrics: 'crm_opportunity',
  forecast_metrics: 'crm_forecast',
};

function makeSource() {
  const network: string[] = [];
  const inflight = new Map<string, Promise<unknown>>();
  const getObjectSchema = vi.fn((name: string) => {
    let hit = inflight.get(name);
    if (!hit) {
      network.push(name);
      hit = new Promise((resolve) => setTimeout(() => resolve(DOCS[name]), 5));
      inflight.set(name, hit);
    }
    return hit;
  });
  const queryDataset = vi.fn(async (dataset: string) => ({
    rows: [
      { stage: 'won', total: 6 },
      { stage: 'lost', total: 2 },
    ],
    fields: [
      { name: 'stage', type: 'string', label: 'Stage' },
      { name: 'total', type: 'number', label: 'Total' },
    ],
    object: DATASET_OBJECT[dataset],
    dimensionFields: { stage: 'stage' },
  }));
  return { source: { getObjectSchema, queryDataset }, network };
}

let globalCalls: string[] = [];
beforeEach(() => {
  captured.length = 0;
  globalCalls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(input);
      globalCalls.push(url);
      const m = /\/meta\/object\/(.+)$/.exec(url);
      const doc = m ? DOCS[decodeURIComponent(m[1])] : undefined;
      return { ok: !!doc, json: async () => (doc ? { item: doc } : {}) };
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

const metaObjectCalls = () => globalCalls.filter((u) => u.includes('/meta/object/'));
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 50)));
const widget = (id: string, dataset: string) => ({
  id,
  type: 'bar',
  dataset,
  dimensions: ['stage'],
  values: ['total'],
});
const relabeled = (label: string) =>
  captured.filter((s) => (s.data ?? []).some((r) => r.stage === label)).length;

describe('dataset widgets share the object-schema read (objectui#13039)', () => {
  it('three widgets over one object make one metadata request', async () => {
    const { source, network } = makeSource();
    render(
      <SchemaRendererProvider dataSource={source as unknown as DataSource}>
        <DatasetWidget widget={widget('a', 'opportunity_metrics')} dataSource={source} />
        <DatasetWidget widget={widget('b', 'opportunity_metrics')} dataSource={source} />
        <DatasetWidget widget={widget('c', 'opportunity_metrics')} dataSource={source} />
      </SchemaRendererProvider>,
    );

    // Labels are unchanged: every widget's axis reads the option label.
    await waitFor(() => expect(relabeled('Closed Won')).toBeGreaterThanOrEqual(3));
    await settle();

    expect({ network, raw: metaObjectCalls() }).toEqual({ network: ['crm_opportunity'], raw: [] });
  });

  it('CONTROL: two objects make one request each', async () => {
    const { source, network } = makeSource();
    render(
      <SchemaRendererProvider dataSource={source as unknown as DataSource}>
        <DatasetWidget widget={widget('a', 'opportunity_metrics')} dataSource={source} />
        <DatasetWidget widget={widget('b', 'forecast_metrics')} dataSource={source} />
        <DatasetWidget widget={widget('c', 'opportunity_metrics')} dataSource={source} />
      </SchemaRendererProvider>,
    );

    await waitFor(() => {
      expect(relabeled('Closed Won')).toBeGreaterThanOrEqual(2);
      expect(relabeled('Committed')).toBeGreaterThanOrEqual(1);
    });
    await settle();

    expect({ network: [...network].sort(), raw: metaObjectCalls() }).toEqual({
      network: ['crm_forecast', 'crm_opportunity'],
      raw: [],
    });
  });

  it('CONTROL: with no data source in context the raw fallback still relabels', async () => {
    const { source, network } = makeSource();
    render(<DatasetWidget widget={widget('a', 'opportunity_metrics')} dataSource={source} />);

    await waitFor(() => expect(relabeled('Closed Won')).toBeGreaterThanOrEqual(1));
    expect(network).toEqual([]);
    expect(metaObjectCalls()).toEqual(['/api/v1/meta/object/crm_opportunity']);
  });
});
