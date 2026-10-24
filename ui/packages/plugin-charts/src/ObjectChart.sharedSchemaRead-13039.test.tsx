/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#13039 — every chart reads an object's metadata through the data
 * source's `getObjectSchema`, so N charts over one object make ONE request.
 *
 * The category option-colour / dimension-label effect used to read
 * `/api/v1/meta/object/NAME` with its own raw `fetch`, outside the data
 * layer's request-key cache — one request per chart, beside the cached
 * `getObjectSchema` read the same chart's groupBy label leg already made. The
 * read now joins that shared read whenever a data source that answers
 * `getObjectSchema` is in scope; the raw read stays only as the fallback for a
 * chart with no such source.
 *
 * The data source below stands in for the adapter's metadata cache: it joins
 * concurrent reads of one name onto one in-flight promise and records one
 * NETWORK read per name, which is the contract `MetadataCache.get` keeps in
 * `@object-ui/data-objectstack`. The count each pin asserts is the sum of what
 * that source sent and what reached the global `fetch` for `/meta/object`, so a
 * raw read beside the shared one is counted, wherever it goes.
 *
 * Directions on the base tree (predicted before the first run):
 *   three charts over one object ⇒ one request          RED (three raw reads beside the shared one)
 *   two objects ⇒ one request each                      RED (raw reads beside the shared ones)
 *   no data source ⇒ the raw fallback paints colours    GREEN (unchanged)
 *   dotted dataset dimension resolves through the hop   RED (both objects read raw)
 */

import type { DataSource } from '@object-ui/types';
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, act } from '@testing-library/react';
import { SchemaRendererProvider } from '@object-ui/react';

const rendered: any[] = [];

vi.mock('./ChartRenderer', () => ({
  ChartRenderer: (props: any) => {
    rendered.push(props.schema);
    return null;
  },
}));

import { ObjectChart } from './ObjectChart';

const OPPORTUNITY = {
  name: 'opportunity',
  fields: {
    stage: {
      type: 'select',
      options: [
        { value: 'won', label: 'Won', color: '#16a34a' },
        { value: 'lost', label: 'Lost', color: '#dc2626' },
      ],
    },
    account: { type: 'lookup', reference: 'account' },
  },
};

const TASK = {
  name: 'task',
  fields: {
    stage: { type: 'select', options: [{ value: 'won', label: 'Won', color: '#2563eb' }] },
  },
};

const ACCOUNT = {
  name: 'account',
  fields: {
    industry: { type: 'select', options: [{ value: 'tech', label: 'Technology' }] },
  },
};

/** A data source whose `getObjectSchema` joins concurrent reads of one name. */
function makeSharedReadSource(docs: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const network: string[] = [];
  const inflight = new Map<string, Promise<unknown>>();
  const getObjectSchema = vi.fn((name: string) => {
    let hit = inflight.get(name);
    if (!hit) {
      network.push(name);
      hit = new Promise((resolve) => setTimeout(() => resolve(docs[name] ?? { name, fields: {} }), 5));
      inflight.set(name, hit);
    }
    return hit;
  });
  const aggregate = vi.fn(async () => [
    { stage: 'won', amount: 42 },
    { stage: 'lost', amount: 7 },
  ]);
  return { source: { getObjectSchema, aggregate, ...extra }, network };
}

/** Records every global `fetch` URL and answers only the documents it is given. */
function installGlobalFetch(routes: Record<string, unknown> = {}) {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(input);
      calls.push(url);
      return { ok: true, json: async () => routes[url] ?? {} };
    }),
  );
  return calls;
}

/**
 * The raw route answers the same documents as the shared one, so the colours
 * and labels paint either way and the only thing these pins can go red on is
 * WHICH route carried the read — never a missing document.
 */
const RAW_DOCS = {
  '/api/v1/meta/object/opportunity': { item: OPPORTUNITY },
  '/api/v1/meta/object/task': { item: TASK },
  '/api/v1/meta/object/account': { item: ACCOUNT },
};

const metaObjectCalls = (calls: string[]) => calls.filter((u) => u.includes('/meta/object/'));

const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 50)));

function objectChart(id: string, objectName: string) {
  return {
    type: 'object-chart' as const,
    id,
    chartType: 'bar' as const,
    objectName,
    aggregate: { field: 'amount', function: 'sum' as const, groupBy: 'stage' },
    xAxisKey: 'stage',
    series: [{ dataKey: 'amount', label: 'Amount' }],
  };
}

beforeEach(() => {
  rendered.length = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe('ObjectChart joins the shared object-schema read (objectui#13039)', () => {
  it('three charts over one object make one metadata request', async () => {
    const globalCalls = installGlobalFetch(RAW_DOCS);
    const { source, network } = makeSharedReadSource({ opportunity: OPPORTUNITY });

    render(
      <SchemaRendererProvider dataSource={source as unknown as DataSource}>
        <ObjectChart schema={objectChart('a', 'opportunity')} />
        <ObjectChart schema={objectChart('b', 'opportunity')} />
        <ObjectChart schema={objectChart('c', 'opportunity')} />
      </SchemaRendererProvider>,
    );

    // Every chart still paints its categories from the object's options — the
    // colours arrive through the shared read, not around it.
    await waitFor(() =>
      expect(rendered.filter((s) => s?.categoryColors?.won === '#16a34a').map((s) => s.id)).toEqual(
        expect.arrayContaining(['a', 'b', 'c']),
      ),
    );
    await settle();

    expect(network).toEqual(['opportunity']);
    expect(metaObjectCalls(globalCalls)).toEqual([]);
  });

  it('CONTROL: two objects make one request each', async () => {
    const globalCalls = installGlobalFetch(RAW_DOCS);
    const { source, network } = makeSharedReadSource({ opportunity: OPPORTUNITY, task: TASK });

    render(
      <SchemaRendererProvider dataSource={source as unknown as DataSource}>
        <ObjectChart schema={objectChart('a', 'opportunity')} />
        <ObjectChart schema={objectChart('b', 'task')} />
        <ObjectChart schema={objectChart('c', 'opportunity')} />
      </SchemaRendererProvider>,
    );

    await waitFor(() => {
      const painted = rendered.filter((s) => s?.categoryColors?.won).map((s) => s.id);
      expect(painted).toEqual(expect.arrayContaining(['a', 'b', 'c']));
    });
    await settle();

    expect([...network].sort()).toEqual(['opportunity', 'task']);
    expect(metaObjectCalls(globalCalls)).toEqual([]);
    // Each object's own options, not the other's.
    expect(rendered.filter((s) => s?.id === 'b' && s.categoryColors).at(-1).categoryColors.won).toBe('#2563eb');
  });

  it('CONTROL: a chart with no data source resolves its category metadata through the raw fallback', async () => {
    const globalCalls = installGlobalFetch(RAW_DOCS);

    render(
      <ObjectChart
        schema={{
          type: 'object-chart' as const,
          chartType: 'bar' as const,
          objectName: 'opportunity',
          xAxisKey: 'stage',
          data: [
            { stage: 'won', amount: 42 },
            { stage: 'lost', amount: 7 },
          ],
        }}
      />,
    );

    await waitFor(() => expect(rendered.at(-1)?.categoryColors?.lost).toBe('#dc2626'));
    expect(metaObjectCalls(globalCalls)).toEqual(['/api/v1/meta/object/opportunity']);
  });

  it('CONTROL: a dotted dataset dimension still walks to the object that owns the field', async () => {
    const globalCalls = installGlobalFetch({
      ...RAW_DOCS,
      '/api/v1/meta/dataset/opportunity_metrics': {
        item: {
          name: 'opportunity_metrics',
          object: 'opportunity',
          dimensions: [{ name: 'industry', field: 'account.industry' }],
        },
      },
    });
    const { source, network } = makeSharedReadSource(
      { opportunity: OPPORTUNITY, account: ACCOUNT },
      {
        queryDataset: vi.fn().mockResolvedValue({
          rows: [{ industry: 'tech', total: 3 }],
          fields: [
            { name: 'industry', label: 'Industry' },
            { name: 'total', label: 'Total' },
          ],
        }),
      },
    );

    render(
      <ObjectChart
        schema={{
          type: 'object-chart' as const,
          chartType: 'bar' as const,
          dataset: 'opportunity_metrics',
          dimensions: ['industry'],
          values: ['total'],
        }}
        dataSource={source}
      />,
    );

    await waitFor(() => expect(rendered.at(-1)?.data?.[0]?.industry).toBe('Technology'));
    // The base object, then the hop's target — each once, both through the
    // shared read. The dataset definition read is not this card's and stays raw.
    expect(network).toEqual(['opportunity', 'account']);
    expect(globalCalls).toEqual(['/api/v1/meta/dataset/opportunity_metrics']);
  });
});
