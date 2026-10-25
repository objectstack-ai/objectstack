// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Regression for cloud#667: a dataset chart grouped by a `select` field whose
 * stored value is English (active/lost/potential) but whose option labels are
 * localized (合作中/已流失/潜在) rendered every bar at 0 — the value-keyed groups
 * never lined up with the label axis. The widget must resolve value→label from
 * the object field options BEFORE charting, keying by value so each count lands
 * on the right (now label-displayed) category.
 *
 * We register a stub `chart` component to capture the schema the widget hands
 * the renderer, rather than asserting on Recharts' SVG (which doesn't lay out
 * in jsdom). This exercises the REAL DatasetWidget + SchemaRenderer.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRendererProvider, type ApiFetch } from '@object-ui/react';
import { DatasetWidget } from '../DatasetWidget';
import type { DataSource } from '@object-ui/types';

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

let capturedChartSchema: any = null;
beforeAll(() => {
  ComponentRegistry.register('chart', (props: any) => {
    capturedChartSchema = props?.schema;
    return null;
  });
});
afterEach(() => {
  cleanup();
  capturedChartSchema = null;
  vi.restoreAllMocks();
});

const valueKeyedSource = () => ({
  // The analytics layer grouped by the stored VALUE (English enum).
  queryDataset: vi.fn(async () => ({
    rows: [
      { status: 'active', count: 6 },
      { status: 'lost', count: 2 },
      { status: 'potential', count: 4 },
    ],
    fields: [
      { name: 'status', type: 'select', label: '状态' },
      { name: 'count', type: 'number', label: '数量' },
    ],
    object: 'tk5f_customer',
    dimensionFields: { status: 'status' },
  })),
});

describe('DatasetWidget select-dimension relabeling (cloud#667)', () => {
  it('shows the option LABEL on the axis while the value-keyed count stays attached', async () => {
    const src = valueKeyedSource();
    // The object field: English values + localized labels (AI-build default).
    const objectSchema = {
      item: {
        name: 'tk5f_customer',
        fields: {
          status: {
            type: 'select',
            options: [
              { value: 'active', label: '合作中' },
              { value: 'lost', label: '已流失' },
              { value: 'potential', label: '潜在' },
            ],
          },
        },
      },
    };
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => objectSchema })) as any;

    render(
      <DatasetWidget
        widget={{ type: 'bar', dataset: 'tk5f_customer_ds', dimensions: ['status'], values: ['count'] }}
        dataSource={src}
      />,
    );

    // The object-schema fetch resolves → dimensionLabels → relabel re-render.
    await waitFor(() => {
      expect(capturedChartSchema).toBeTruthy();
      const byCategory = Object.fromEntries(
        (capturedChartSchema.data || []).map((r: any) => [r.status, r.count]),
      );
      // Every count lands on its LABEL category — the bug zeroed all of these.
      expect(byCategory).toEqual({ 合作中: 6, 已流失: 2, 潜在: 4 });
    });
    // The raw English value must not leak onto the axis.
    const categories = (capturedChartSchema.data || []).map((r: any) => r.status);
    expect(categories).not.toContain('active');
    expect(capturedChartSchema.xAxisKey).toBe('status');
    // The object field options were fetched to build the value→label map.
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/v1/meta/object/tk5f_customer',
      expect.anything(),
    );
  });

  it('passes raw rows through unchanged (no crash) when the object schema is unavailable', async () => {
    const src = valueKeyedSource();
    global.fetch = vi.fn(async () => ({ ok: false, json: async () => ({}) })) as any;

    render(
      <DatasetWidget
        widget={{ type: 'bar', dataset: 'tk5f_customer_ds', dimensions: ['status'], values: ['count'] }}
        dataSource={src}
      />,
    );

    // First chart render carries the raw value-keyed rows; with no options the
    // relabel is a no-op, so the widget never crashes and still plots a value.
    await waitFor(() => {
      expect(capturedChartSchema).toBeTruthy();
      expect(capturedChartSchema.data?.[0]).toMatchObject({ status: 'active', count: 6 });
    });
  });
});

/**
 * objectui#4121 — WHICH channel the probe above rides.
 *
 * The same `GET /api/v1/meta/object/{object}` read the relabeling tests already
 * double went out on the bare global `fetch`, so a hosted console's
 * authenticated channel (Authorization / tenant headers, base-URL rewrite,
 * draft-preview params — `ConsoleShell.tsx:245` supplies it) was bypassed. The
 * effect swallows every failure, so the symptom was silent: the semantic option
 * colors AND the value→label maps the tests above pin simply never applied, and
 * the chart fell back to the positional theme palette and raw stored values.
 * The plugin-dashboard twin of objectui#4114 / PR #4122.
 *
 * Read off TWO recorders — the global `fetch` stub this file already installs,
 * plus a standalone recorder handed in as the provider's `apiFetch`. Both answer
 * the SAME document, so the data path stays green either way and the only thing
 * these pins can go red on is the routing itself: the host recorder holding
 * nothing, or the global recorder holding something.
 */
describe('DatasetWidget option-color / dimension-label probe routing (objectui#4121)', () => {
  const CUSTOMER_DOC = {
    item: {
      name: 'tk5f_customer',
      fields: {
        status: {
          type: 'select',
          options: [
            { value: 'active', label: '合作中', color: '#16a34a' },
            { value: 'lost', label: '已流失' },
            { value: 'potential', label: '潜在' },
          ],
        },
      },
    },
  };

  /**
   * The same recorder shape as the global stub at the top of this file, but as
   * a standalone function so the host channel and the global one can be
   * recorded SEPARATELY and the probe's routing read off which one moved.
   */
  function makeMetaFetchRecorder() {
    const calls: string[] = [];
    const inits: (RequestInit | undefined)[] = [];
    const fn = vi.fn(async (input: unknown, init?: RequestInit) => {
      calls.push(String(input));
      inits.push(init);
      return { ok: true, json: async () => CUSTOMER_DOC };
    });
    // The double answers the two fields the probe reads (`ok` / `json()`), not
    // a whole Response — cast once here so the call sites stay `any`-free.
    return { fn: fn as unknown as ApiFetch, calls, inits };
  }

  const WIDGET = { type: 'bar', dataset: 'tk5f_customer_ds', dimensions: ['status'], values: ['count'] };

  /** The captured schema is `any`; narrow ONCE here so the pins stay `any`-free. */
  const chartRows = (): Array<Record<string, unknown>> =>
    (capturedChartSchema?.data ?? []) as Array<Record<string, unknown>>;

  let originalFetch: typeof globalThis.fetch;
  let globalRecorder: ReturnType<typeof makeMetaFetchRecorder>;
  beforeEach(() => {
    originalFetch = global.fetch;
    globalRecorder = makeMetaFetchRecorder();
    global.fetch = globalRecorder.fn as unknown as typeof globalThis.fetch;
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('rides the host apiFetch when a provider supplies one, and never the global fetch', async () => {
    const host = makeMetaFetchRecorder();

    render(
      <SchemaRendererProvider dataSource={valueKeyedSource() as unknown as DataSource} apiFetch={host.fn}>
        <DatasetWidget widget={WIDGET} dataSource={valueKeyedSource()} />
      </SchemaRendererProvider>,
    );

    // The object probe went through the host channel...
    await waitFor(() => expect(host.calls).toEqual(['/api/v1/meta/object/tk5f_customer']));
    // ...and nothing escaped to the global one. This is the assertion the bug
    // failed: pre-fix the two recorders held exactly the opposite contents.
    expect(globalRecorder.calls).toEqual([]);
    // The request options survive the routing — a host that needs the accept
    // header still gets it, it is not dropped on the way to `apiFetch`.
    expect(host.inits[0]).toMatchObject({ headers: { accept: 'application/json' } });
    // And the routed answer is CONSUMED, not merely requested: both products of
    // this one document reach the renderer over the host channel — the value→
    // label relabeling and the first dimension's semantic category color.
    await waitFor(() => {
      const byCategory = Object.fromEntries(chartRows().map((r) => [r.status, r.count]));
      expect(byCategory).toEqual({ 合作中: 6, 已流失: 2, 潜在: 4 });
    });
    expect(capturedChartSchema?.categoryColors).toMatchObject({ 合作中: '#16a34a' });
  });

  it('keeps using the global fetch for a standalone widget with no provider', async () => {
    // The documented boundary of the convention (`useRecordEditable.ts:32`): no
    // host, no `apiFetch` — the probe must still work off the global fetch
    // rather than crash or go quiet. This is the shape every other suite in
    // this package mounts, including the two relabeling tests above.
    render(<DatasetWidget widget={WIDGET} dataSource={valueKeyedSource()} />);

    await waitFor(() => expect(globalRecorder.calls).toEqual(['/api/v1/meta/object/tk5f_customer']));
    await waitFor(() =>
      expect(chartRows().map((r) => r.status)).toContain('合作中'),
    );
  });

  it('keeps using the global fetch when a provider supplies no apiFetch', async () => {
    // A host CAN be mounted without an authenticated channel. Presence of a
    // provider is not presence of a channel, so this must stay on the fallback
    // rather than resolve to `undefined` and skip the read.
    render(
      <SchemaRendererProvider dataSource={valueKeyedSource() as unknown as DataSource}>
        <DatasetWidget widget={WIDGET} dataSource={valueKeyedSource()} />
      </SchemaRendererProvider>,
    );

    await waitFor(() => expect(globalRecorder.calls).toEqual(['/api/v1/meta/object/tk5f_customer']));
    await waitFor(() =>
      expect(chartRows().map((r) => r.status)).toContain('合作中'),
    );
  });
});
