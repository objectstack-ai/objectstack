/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#4106 — coverage for ObjectChart's category option-color / dimension
 * label resolution (the "P3" effect at ObjectChart.tsx:328).
 *
 * This effect is where every real-network escape in `plugin-charts` came from:
 * it reads `/api/v1/meta/dataset/<dataset>` and `/api/v1/meta/object/<object>`
 * off the global `fetch`, and it is best-effort — any failure is swallowed and
 * leaves the theme palette in place. Under happy-dom those were REAL requests
 * that always failed, so the effect's SUCCESS path had never once executed in
 * this package's suite and nothing asserted the requests at all.
 *
 * These pins give that path its first coverage, from the component's own
 * wiring rather than the helpers' (`buildOptionColorMap` /
 * `buildDimensionLabelMap` / `relabelDimensions` are unit-tested one level
 * down in `@object-ui/core`; what is new here is that ObjectChart asks for the
 * right documents, in the right order, and feeds the results to the renderer).
 */

import type { DataSource } from '@object-ui/types';
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { SchemaRendererProvider, type ApiFetch } from '@object-ui/react';

let lastSchema: any = null;

vi.mock('./ChartRenderer', () => ({
  ChartRenderer: (props: any) => {
    lastSchema = props.schema;
    return null;
  },
}));

import { ObjectChart } from './ObjectChart';

/**
 * NOTE (objectui#7912): `SchemaRendererProvider.dataSource` — and the context
 * it feeds — declare the published `DataSource` adapter contract. The values
 * this file injects are deliberately NOT adapters —
 * they are partial stubs carrying only the members the path under test calls;
 * completing them would change which capability probes fire, and so would
 * change what these tests measure.
 * Each injection therefore crosses the contract with an explicit
 * `as unknown as DataSource`. Every injected value is byte-for-byte what it
 * was before: this marks the crossing, it changes no assertion.
 */

/**
 * Records every URL and answers only the documents it is given, so an escape
 * to any other endpoint shows up as a recorded call the assertions reject —
 * never as a swallowed rejection on the real network.
 */
function installMetaFetchDouble(routes: Record<string, unknown> = {}) {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(
        input && typeof input === 'object' && 'url' in input ? (input as { url: unknown }).url : input,
      );
      calls.push(url);
      return { ok: true, json: async () => routes[url] ?? {} };
    }),
  );
  return calls;
}

/**
 * objectui#4114 — the same recorder, but as a standalone function rather than
 * a global stub, so a host's `apiFetch` channel and the global `fetch` can be
 * recorded SEPARATELY and the probe's routing read off which one moved.
 */
function makeMetaFetchRecorder(routes: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const inits: (RequestInit | undefined)[] = [];
  const fn = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(
      input && typeof input === 'object' && 'url' in input ? (input as { url: unknown }).url : input,
    );
    calls.push(url);
    inits.push(init);
    return { ok: true, json: async () => routes[url] ?? {} };
  });
  // The double answers the two fields the probe reads (`ok` / `json()`), not a
  // whole Response — cast once here so the call sites stay `any`-free.
  return { fn: fn as unknown as ApiFetch, calls, inits };
}

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
  lastSchema = null;
});

beforeEach(() => {
  lastSchema = null;
});

describe('ObjectChart — category option colors (objectui#4106)', () => {
  it('probes the bound object once and paints categories from its field options', async () => {
    const metaCalls = installMetaFetchDouble({
      '/api/v1/meta/object/opportunity': {
        item: {
          name: 'opportunity',
          fields: {
            stage: {
              type: 'select',
              options: [
                { value: 'won', label: 'Won', color: '#16a34a' },
                { value: 'lost', label: 'Lost', color: '#dc2626' },
              ],
            },
          },
        },
      },
    });

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
        dataSource={{ find: async () => ({ data: [] }) }}
      />,
    );

    // The option colors reach the renderer as `categoryColors`, keyed by BOTH
    // the stored value and the display label (either can key a category).
    await waitFor(() => expect(lastSchema?.categoryColors).toBeTruthy());
    expect(lastSchema.categoryColors).toMatchObject({
      won: '#16a34a',
      Won: '#16a34a',
      lost: '#dc2626',
      Lost: '#dc2626',
    });

    // Exactly one document, and no second/dataset hop for an object-bound chart.
    expect(metaCalls).toEqual(['/api/v1/meta/object/opportunity']);
  });

  it('resolves a dataset chart through its definition to the underlying object', async () => {
    const metaCalls = installMetaFetchDouble({
      '/api/v1/meta/dataset/showcase_task_metrics': {
        item: {
          name: 'showcase_task_metrics',
          object: 'task',
          dimensions: [{ name: 'status', field: 'status' }],
        },
      },
      '/api/v1/meta/object/task': {
        item: {
          name: 'task',
          fields: {
            status: {
              type: 'select',
              options: [
                { value: 'todo', label: 'To do' },
                { value: 'done', label: 'Done' },
              ],
            },
          },
        },
      },
    });

    render(
      <ObjectChart
        schema={{
          type: 'object-chart' as const,
          chartType: 'bar' as const,
          dataset: 'showcase_task_metrics',
          dimensions: ['status'],
          values: ['task_count'],
        }}
        dataSource={{
          queryDataset: vi.fn().mockResolvedValue({
            rows: [{ status: 'todo', task_count: 3 }],
            fields: [
              { name: 'status', label: 'Status' },
              { name: 'task_count', label: 'Tasks' },
            ],
          }),
        }}
      />,
    );

    // Two hops, IN ORDER: the dataset definition names the object, and only
    // then can the object's field options be read. The order is the wiring —
    // reversing it would mean fetching an object nothing has named yet.
    await waitFor(() => expect(metaCalls).toHaveLength(2));
    expect(metaCalls).toEqual([
      '/api/v1/meta/dataset/showcase_task_metrics',
      '/api/v1/meta/object/task',
    ]);

    // The value→label map built from the object's options is applied to the
    // dataset rows, so the axis shows "To do" rather than the stored `todo`.
    await waitFor(() => expect(lastSchema?.data?.[0]?.status).toBe('To do'));
  });

  it('keeps the theme palette when the object document carries no options', async () => {
    // The pre-fix observable state: the probe fails (or answers nothing
    // useful), the effect swallows it, and no categoryColors are handed down.
    // Pinned so the "best-effort" contract cannot regress into a hard failure.
    const metaCalls = installMetaFetchDouble({
      '/api/v1/meta/object/opportunity': { item: { name: 'opportunity', fields: {} } },
    });

    render(
      <ObjectChart
        schema={{
          type: 'object-chart' as const,
          chartType: 'bar' as const,
          objectName: 'opportunity',
          xAxisKey: 'stage',
          data: [{ stage: 'won', amount: 42 }],
        }}
        dataSource={{ find: async () => ({ data: [] }) }}
      />,
    );

    await waitFor(() => expect(lastSchema).not.toBeNull());
    expect(lastSchema.categoryColors).toBeUndefined();
    expect(metaCalls).toEqual(['/api/v1/meta/object/opportunity']);
  });
});

/**
 * objectui#4114 — WHICH channel the two probes above ride.
 *
 * `ObjectChart` already reads `SchemaRendererContext`, but the effect used to
 * call the bare global `fetch` at both call sites, so a hosted console's
 * authenticated channel (Authorization / tenant headers, base-URL rewrite,
 * draft-preview params — `ConsoleShell.tsx:245` supplies it) was bypassed. The
 * effect swallows every failure, so the symptom was silent: option colors and
 * dataset dimension labels simply never applied.
 *
 * Both recorders answer the SAME documents here, so the data path stays green
 * either way and the only thing these pins can go red on is the routing — the
 * host recorder holding nothing, or the global recorder holding something.
 */
describe('ObjectChart — option-color probe routing (objectui#4114)', () => {
  const OPPORTUNITY_DOC = {
    '/api/v1/meta/object/opportunity': {
      item: {
        name: 'opportunity',
        fields: {
          stage: {
            type: 'select',
            options: [{ value: 'won', label: 'Won', color: '#16a34a' }],
          },
        },
      },
    },
  };

  const OBJECT_CHART_SCHEMA = {
    type: 'object-chart' as const,
    chartType: 'bar' as const,
    objectName: 'opportunity',
    xAxisKey: 'stage',
    data: [{ stage: 'won', amount: 42 }],
  };

  it('rides the host apiFetch when a provider supplies one, and never the global fetch', async () => {
    const globalCalls = installMetaFetchDouble(OPPORTUNITY_DOC);
    const host = makeMetaFetchRecorder(OPPORTUNITY_DOC);

    render(
      <SchemaRendererProvider
        dataSource={{ find: async () => ({ data: [] }) } as unknown as DataSource}
        apiFetch={host.fn}
      >
        <ObjectChart schema={OBJECT_CHART_SCHEMA} />
      </SchemaRendererProvider>,
    );

    // The object probe went through the host channel...
    await waitFor(() => expect(host.calls).toEqual(['/api/v1/meta/object/opportunity']));
    // ...and nothing escaped to the global one. This is the assertion the bug
    // failed: pre-fix the two recorders held exactly the opposite contents.
    expect(globalCalls).toEqual([]);
    // The request options survive the routing — a host that needs the accept
    // header still gets it, it is not dropped on the way to `apiFetch`.
    expect(host.inits[0]).toMatchObject({ headers: { accept: 'application/json' } });
    // And the routed answer is consumed, not merely requested.
    await waitFor(() => expect(lastSchema?.categoryColors).toMatchObject({ won: '#16a34a' }));
  });

  it('routes BOTH dataset hops through the host apiFetch', async () => {
    const routes = {
      '/api/v1/meta/dataset/showcase_task_metrics': {
        item: {
          name: 'showcase_task_metrics',
          object: 'task',
          dimensions: [{ name: 'status', field: 'status' }],
        },
      },
      '/api/v1/meta/object/task': {
        item: {
          name: 'task',
          fields: {
            status: {
              type: 'select',
              options: [
                { value: 'todo', label: 'To do' },
                { value: 'done', label: 'Done' },
              ],
            },
          },
        },
      },
    };
    const globalCalls = installMetaFetchDouble(routes);
    const host = makeMetaFetchRecorder(routes);

    render(
      <SchemaRendererProvider
        dataSource={{
          queryDataset: vi.fn().mockResolvedValue({
            rows: [{ status: 'todo', task_count: 3 }],
            fields: [{ name: 'status', label: 'Status' }, { name: 'task_count', label: 'Tasks' }],
          }),
        } as unknown as DataSource}
        apiFetch={host.fn}
      >
        <ObjectChart
          schema={{
            type: 'object-chart' as const,
            chartType: 'bar' as const,
            dataset: 'showcase_task_metrics',
            dimensions: ['status'],
            values: ['task_count'],
          }}
        />
      </SchemaRendererProvider>,
    );

    // Both call sites — the dataset definition read AND the object read it
    // names — are on the host channel, in order.
    await waitFor(() => expect(host.calls).toHaveLength(2));
    expect(host.calls).toEqual([
      '/api/v1/meta/dataset/showcase_task_metrics',
      '/api/v1/meta/object/task',
    ]);
    expect(globalCalls).toEqual([]);
    // The dimension labels resolved over the host channel reach the rows.
    await waitFor(() => expect(lastSchema?.data?.[0]?.status).toBe('To do'));
  });

  it('keeps using the global fetch for a standalone embed with no provider', async () => {
    // The documented boundary of the convention (`useRecordEditable.ts:32`):
    // no host, no `apiFetch` — the probe must still work off the global fetch
    // rather than crash or go quiet.
    const globalCalls = installMetaFetchDouble(OPPORTUNITY_DOC);

    render(<ObjectChart schema={OBJECT_CHART_SCHEMA} dataSource={{ find: async () => ({ data: [] }) }} />);

    await waitFor(() => expect(lastSchema?.categoryColors).toMatchObject({ won: '#16a34a' }));
    expect(globalCalls).toEqual(['/api/v1/meta/object/opportunity']);
  });

  it('keeps using the global fetch when a provider supplies no apiFetch', async () => {
    // A host CAN be mounted without an authenticated channel (every
    // `SchemaRendererProvider dataSource={…}` in the suites, e.g.
    // `ObjectChart.elementDataSource.test.tsx`). Presence of a provider is not
    // presence of a channel, so this must stay on the fallback.
    const globalCalls = installMetaFetchDouble(OPPORTUNITY_DOC);

    render(
      <SchemaRendererProvider dataSource={{ find: async () => ({ data: [] }) } as unknown as DataSource}>
        <ObjectChart schema={OBJECT_CHART_SCHEMA} />
      </SchemaRendererProvider>,
    );

    await waitFor(() => expect(lastSchema?.categoryColors).toMatchObject({ won: '#16a34a' }));
    expect(globalCalls).toEqual(['/api/v1/meta/object/opportunity']);
  });
});
