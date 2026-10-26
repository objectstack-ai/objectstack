/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7210, half 2 — maintainer ruling a′ (2026-09-02), on the map.
 *
 * The map's own defence — it auto-clusters above 100 markers — is exactly what
 * makes a silent cut invisible here: cluster bubbles redraw at whatever counts
 * they are given, so a map of the first N of a much larger set is a plausible
 * map with plausible bubbles, and its CAMERA is fitted to a bounding box that
 * is not the data's. The footnote is the only thing that says so.
 *
 * ⚠️ Environment: jsdom, with `react-map-gl/maplibre` stubbed the way the
 * sibling ObjectMap tests stub it (no WebGL in this lane). Nothing asserted
 * here depends on container size or on the real map's viewport — the note is a
 * sibling in the component's own tree, present or absent regardless of layout.
 *
 * REVERSE VERIFICATION — MEASURED on two separate ablations (objectui#7507),
 * because this file grades two different things and one of them was missing:
 *
 *   1. Remove `...nonGridRowCeilingQuery()` from `ObjectMap`'s fetch ⇒ red
 *      at the **`$top` assertion**, and there only; 1 failed / 2 passed. NOT
 *      at the footnote, which is what this docblock used to predict. An
 *      adapter with no `$top` answers with the whole filtered set,
 *      `applyNonGridRowCeiling` slices it to the ceiling from the rows in
 *      hand, and both the marker count and the note stay correct. Losing the
 *      `$top` is a bandwidth regression, not a correctness one.
 *   2. Hand the view the RAW response instead of the capped rows
 *      (`setData(capped.rows)` → `setData(result.data ?? capped.rows)`) ⇒ red
 *      at the **marker-count assertion**, 2001 against 2000. Before #7507 that
 *      mutation left this file green at 4/4: `$top` was still sent and the
 *      footnote still rendered, while 2,001 markers were plotted. That is the
 *      hole the count case below closes, and it is the ruling's own pin text —
 *      "the DOM row count equals the ceiling".
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { NON_GRID_ROW_CEILING, nonGridRowCeilingQuery } from '@object-ui/core';
import { ObjectMap } from './ObjectMap';
import './__tests__/webgl2Available';

vi.mock('react-map-gl/maplibre', () => ({
  default: ({ children }: any) => <div aria-label="Map">{children}</div>,
  Map: ({ children }: any) => <div aria-label="Map">{children}</div>,
  NavigationControl: () => <div data-testid="nav-control" />,
  Marker: ({ children }: any) => <div data-testid="map-marker">{children}</div>,
  Popup: ({ children }: any) => <div data-testid="map-popup">{children}</div>,
}));

const TOTAL_ROWS = 6543;

function makeRows(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: String(i + 1),
    name: `Place ${i + 1}`,
    latitude: -80 + ((i * 37) % 160),
    longitude: -179 + ((i * 53) % 358),
  }));
}

function makeDataSource(storeSize: number, calls: Array<Record<string, any>>) {
  const store = makeRows(storeSize);
  return {
    find: vi.fn(async (_resource: string, params: any) => {
      calls.push({ ...(params ?? {}) });
      const top = typeof params?.$top === 'number' ? params.$top : store.length;
      return { data: store.slice(0, top), total: store.length };
    }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => ({
      name: 'store',
      fields: {
        id: { name: 'id', type: 'text' },
        name: { name: 'name', type: 'text' },
        latitude: { name: 'latitude', type: 'number' },
        longitude: { name: 'longitude', type: 'number' },
      },
    })),
  } as any;
}

const schema: any = {
  type: 'map',
  objectName: 'store',
  map: { latitudeField: 'latitude', longitudeField: 'longitude', titleField: 'name' },
  data: { provider: 'object', object: 'store' },
};

describe('objectui#7210 ruling a′ — the map caps at the platform ceiling, loudly', () => {
  it('above the ceiling: the query stops at the ceiling and BOTH numbers are named', async () => {
    const calls: Array<Record<string, any>> = [];
    const dataSource = makeDataSource(TOTAL_ROWS, calls);

    render(<ObjectMap schema={schema} dataSource={dataSource} />);

    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    for (const params of calls) {
      expect(params.$top).toBe(nonGridRowCeilingQuery().$top);
    }

    const note = await screen.findByRole('note');
    expect(note.getAttribute('data-row-ceiling-note')).toBe('non-grid');
    expect(note.textContent).toContain(String(NON_GRID_ROW_CEILING));
    expect(note.textContent).toContain(String(TOTAL_ROWS));
  });

  it('above the ceiling: exactly N markers reach the map, not N+1', async () => {
    const calls: Array<Record<string, any>> = [];
    const dataSource = makeDataSource(TOTAL_ROWS, calls);

    // ⭐ The ruling's own words — "the DOM row count equals the ceiling". The
    // `$top` and the footnote in the case above are both true of a map that
    // then plotted every row the adapter sent: measured on the merged commit,
    // replacing the capped hand-off with the raw response left this file green
    // at 4/4 with 2,001 markers on the map. This is the assertion that was
    // missing, and it is a case of its own for one reason:
    //
    // ⚠️ `enableClustering={false}` is what makes the count OBSERVABLE at all.
    // The map's default is to cluster above 100 markers, and a cluster bubble
    // is exactly a marker count folded into one DOM node — the defence the
    // file's own docblock names as what makes a silent cut invisible here.
    // Clustering is a pure function of the marker array, so turning it off
    // changes what is on screen and not what reached the view; with it on,
    // 2,000 and 2,001 markers render the same handful of bubbles.
    render(<ObjectMap schema={schema} dataSource={dataSource} enableClustering={false} />);

    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    await waitFor(() =>
      expect(screen.queryAllByTestId('map-marker').length).toBe(NON_GRID_ROW_CEILING),
    );
  });

  it('below the ceiling: every marker draws and there is NO footnote', async () => {
    const calls: Array<Record<string, any>> = [];
    const dataSource = makeDataSource(20, calls);

    render(<ObjectMap schema={schema} dataSource={dataSource} />);

    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    await waitFor(() => expect(screen.queryByText(/Loading map/i)).toBeNull());
    // 20 is under the map's own 100-marker clustering threshold, so every
    // record is its own DOM marker here with no prop needed. The other half of
    // "draws at most N": it keeps the case above from passing on a map that
    // caps everything at 2,000 unconditionally.
    expect(screen.queryAllByTestId('map-marker').length).toBe(20);
    expect(screen.queryByRole('note')).toBeNull();
  });
});
