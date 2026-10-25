/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#5451 — the height chain through ObjectChart's wrapper.
 *
 * A dashboard grid cell declares a definite height and sends
 * `className: "h-full"` down the widget schema; that class lands on
 * ChartContainer, whose `height: 100%` resolves against ObjectChart's OWN
 * wrapper div. When that wrapper is a plain auto-height block the chain dies
 * there: the container computes to `auto`, recharts measures a permanent
 * zero, and only the CHART_MIN_HEIGHT floor (#5503) keeps the chart from
 * rendering blank — at a fixed floor height instead of filling the cell.
 *
 * Pinned here: the wrapper carries `h-full` so a parent-declared height
 * actually reaches the measured element. (Under auto-height parents `h-full`
 * resolves to `auto`, so non-dashboard hosts are unaffected — that is why
 * this is safe unconditionally.)
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

vi.mock('./ChartRenderer', () => ({
  ChartRenderer: () => null,
}));

import { ObjectChart } from './ObjectChart';

/* ────────────────────────────────────────────────────────────────────────────
 * objectui#7307 — this file's `/api/v1/meta/object/task` escape, served here.
 *
 * Nothing below asks for metadata, yet every run opened a REAL TCP connection
 * to `http://localhost:3000`. Traced with a stack probe on the network-escape
 * guard's attribution point:
 *
 *   ObjectChart (option-colour effect)   packages/plugin-charts/src/ObjectChart.tsx:390
 *     -> `const doFetch = apiFetch ?? fetch`        <- the escape
 *       -> loadObjectSchema              ObjectChart.tsx:411
 *         -> loadDimensionFieldMeta      packages/core/src/utils/chart-series.ts
 *           GET /api/v1/meta/object/task
 *
 * That effect reads the host's AUTHENTICATED `apiFetch` off
 * `SchemaRendererContext` and, with no `SchemaRendererProvider` in this tree,
 * degrades to the GLOBAL `fetch` by design — a standalone embed must keep
 * rendering rather than crash. Under happy-dom that global is a real HTTP
 * client and the document URL defaults to `http://localhost:3000`, so the
 * relative path resolved to a live request. The read is best-effort (every
 * failure leaves `optionMeta` null and the chart on the theme palette), which
 * is why the assertion below stayed green while the request always failed.
 *
 * Answered from a RECORDING double — the shape objectui#5225 settled on and
 * `packages/plugin-report/src/__tests__/DatasetReportRenderer.test.tsx`
 * carries. Deliberately NOT a blanket network stub: it records every URL it is
 * handed and `afterEach` fails on any URL that is not the metadata route, so an
 * escape to somewhere else reds here instead of vanishing into that `catch`.
 *
 * The served document declares no fields, so nothing resolves and `optionMeta`
 * settles null — the state the failing request already produced. The height
 * assertion cannot see it either way: `ChartRenderer` is mocked to null.
 * ──────────────────────────────────────────────────────────────────────────── */

const META_OBJECT_ROUTE = /^\/api\/v1\/meta\/object\/(.+)$/;

/** Every URL this render handed the global `fetch`, in request order. */
let metaCalls: string[] = [];

/** Serve `/api/v1/meta/object/<name>` with a field-less doc; record everything. */
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
      return {
        ok: true,
        status: 200,
        json: async () => ({ item: { name: decodeURIComponent(m[1]), fields: {} } }),
      };
    }),
  );
}

beforeEach(() => {
  installMetaObjectDouble();
});

afterEach(() => {
  // The double is a router, not a sink: an escape to any OTHER endpoint fails
  // here instead of vanishing into the effect's best-effort `catch`.
  expect(metaCalls.filter((url) => !META_OBJECT_ROUTE.test(url))).toEqual([]);
  // Unmount BEFORE restoring the real `fetch`. Vitest runs `afterEach` hooks in
  // reverse registration order, so this file's teardown runs before the root
  // setup's RTL cleanup: unstubbing first would leave the tree mounted with the
  // real global back in place, and a metadata effect settling in that window
  // escapes again (objectui#7439).
  cleanup();
  vi.unstubAllGlobals();
});

describe('ObjectChart wrapper height chain (objectui#5451)', () => {
  it('the wrapper div propagates parent height (h-full), so a grid cell height reaches ChartContainer', () => {
    const { container } = render(
      <ObjectChart
        schema={{
          type: 'object-chart',
          chartType: 'bar',
          objectName: 'task',
          xAxisKey: 'status',
          className: 'h-full',
          data: [{ status: 'open', count: 3 }],
        }}
        dataSource={{ find: async () => ({ data: [] }) }}
      />,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper).toBeTruthy();
    expect(wrapper.className).toContain('h-full');
  });
});
