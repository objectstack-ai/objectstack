/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9061 — a `provider: 'value'` map honours the three query keys the
 * fetching path honours: `filter`, `sort`, and the objectui#7210 row ceiling.
 * The port of objectui#8769, which removed the same short-circuit from
 * `ObjectGantt`; `ObjectCalendar.inlineQueryKeys-9061.test.tsx` is the twin.
 *
 * ## What was wrong
 *
 * The fetch effect short-circuited the inline provider (`setData(dataItems)`;
 * return) BEFORE the `find` below it, which is the ONE site in the file that
 * lowers `schema.filter` to `$filter`, `schema.sort` to `$orderby` and the
 * ceiling to `$top`. An authored `filter` therefore reached nothing and every
 * inline row was plotted — the fail-OPEN direction: the key that was ignored is
 * the key that NARROWS, so the author saw MORE markers than declared, with no
 * diagnostic.
 *
 * ⛔ Not a data-exposure boundary. The rows are already in the authored schema;
 * what is wrong is that the map answers a question nobody asked.
 *
 * ## The two-sided reading is the finding
 *
 * A one-sided reproduction cannot tell "the filter was ignored" from "the
 * filter matched everything", so `twoSidedFilter` renders the SAME rows and the
 * SAME filter twice — once inline, once through a context adapter that is
 * itself a `ValueDataSource` over those rows — and reads the DISAGREEMENT.
 *
 * ## ORDER: filter first, ceiling second (objectui#7210 ruling a′)
 *
 * The ceiling is applied to the FILTERED set, matching the fetching path.
 * `ceilingOrder` pins it from the observable side: a set that is over the
 * ceiling BEFORE filtering and under it after plots every matching row and
 * shows NO footnote.
 *
 * ## ⚠️ `enableClustering={false}` is what makes the count observable at all
 *
 * The map clusters above 100 markers by default, and a cluster bubble is
 * exactly a marker count folded into one DOM node — the same reason
 * `ObjectMap.rowCeiling-7210.test.tsx` passes the prop. Clustering is a pure
 * function of the marker array, so turning it off changes what is on screen and
 * not what reached the view.
 *
 * ## What this repair does NOT inherit from the gantt
 *
 * `ObjectGantt` had a standing pin asserting an inline set is never capped and
 * never footnoted, which objectui#8769 had to invert. `ObjectMap` has no such
 * pin — `ObjectMap.rowCeiling-7210.test.tsx` grades the `object` provider only
 * — so the ceiling rows below are NEW coverage rather than an inversion.
 * Verified by reading that file's case list before writing this one.
 *
 * ⚠️ MEASURED CONSEQUENCE, reported rather than hidden: an author who supplies
 * more than `NON_GRID_ROW_CEILING` inline rows now sees fewer markers than they
 * supplied. `ceilingCap` and `ceilingNote` are that measurement. It is the
 * ruled behaviour rather than a silent loss — ruling a′'s budget is measured in
 * DOM ELEMENTS PER RECORD and its own table was taken over the inline `value`
 * provider, and `NonGridRowCeilingNote` names BOTH numbers on screen. On a map
 * the footnote carries a second fact the picture cannot: the CAMERA is fitted
 * to the drawn box, which is not the authored set's box once the ceiling bites.
 *
 * REVERSE VERIFICATION — direction predicted BEFORE running, from the committed
 * fix, by restoring the short-circuit in `ObjectMap.tsx` ONLY (the calendar's
 * fix left in place): `twoSidedFilter`, `inlineSort`, `staticDataSpelling`,
 * `ceilingCap`, `ceilingNote` and `ceilingOrder` go RED; `control`,
 * `offArmDataSpelling` and `providerBackedControl` stay GREEN — the first plots
 * the same rows in the same order either way, the second never reaches the
 * inline branch, and the third never touches the inline path at all, which is
 * what makes them controls.
 *
 * ## HOW THE INLINE ROWS ARE SPELLED HERE (objectui#8348, decision batch #83)
 *
 * `{ provider: 'value', items }` under `data`, or `staticData` — the two rungs
 * `object-map`'s published `ViewData` row admits. A BARE ARRAY under `data` is
 * refused by kind on this block and reaches no inline source at all;
 * `offArmDataSpelling` pins that, with a lit control beside it. The twin file
 * `ObjectCalendar.inlineQueryKeys-9061.test.tsx` is the MIRROR IMAGE — that
 * block's row is an array, so there the spellings are swapped.
 */

import React from 'react';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { NON_GRID_ROW_CEILING, nonGridRowCeilingQuery, ValueDataSource } from '@object-ui/core';
import { ObjectMap } from './ObjectMap';
import './__tests__/webgl2Available';

// Same stub the sibling ObjectMap pins use (no WebGL in this lane), widened on
// `Marker` by the longitude it is handed: `sort` is unreadable from a count,
// and the marker array carries `[lng, lat]` straight from the record, so the
// longitude sequence IS the row order.
vi.mock('react-map-gl/maplibre', () => ({
  default: ({ children }: any) => <div aria-label="Map">{children}</div>,
  Map: ({ children }: any) => <div aria-label="Map">{children}</div>,
  NavigationControl: () => <div data-testid="nav-control" />,
  Marker: ({ children, longitude }: any) => (
    <div data-testid="map-marker" data-lng={String(longitude)}>
      {children}
    </div>
  ),
  Popup: ({ children }: any) => <div data-testid="map-popup">{children}</div>,
}));

afterEach(cleanup);

/** `longitude` doubles as the row's identity — see the `Marker` stub above. */
const ROWS = [
  { id: '1', name: 'Alpha', status: 'open', rank: 30, latitude: 10, longitude: 1 },
  { id: '2', name: 'Bravo', status: 'closed', rank: 10, latitude: 11, longitude: 2 },
  { id: '3', name: 'Charlie', status: 'open', rank: 40, latitude: 12, longitude: 3 },
  { id: '4', name: 'Delta', status: 'closed', rank: 20, latitude: 13, longitude: 4 },
  { id: '5', name: 'Echo', status: 'open', rank: 50, latitude: 14, longitude: 5 },
];

/** The three rows an authored `status = open` filter declares. */
const OPEN_LNGS = '1,3,5';
const OPEN_FILTER = [['status', '=', 'open']];

const base: any = {
  type: 'map',
  map: { latitudeField: 'latitude', longitudeField: 'longitude', titleField: 'name' },
};

function drawn() {
  const els = screen.queryAllByTestId('map-marker');
  return {
    count: String(els.length),
    lngs: els.map((el) => el.getAttribute('data-lng')).join(','),
  };
}

function makeRows(n: number, status: (i: number) => string = () => 'open') {
  return Array.from({ length: n }, (_, i) => ({
    id: String(i + 1),
    name: `Place ${i + 1}`,
    status: status(i),
    latitude: -80 + ((i * 37) % 160),
    longitude: -179 + ((i * 53) % 358),
  }));
}

describe('objectui#9061 — the map honours filter / sort / the row ceiling on inline `value` data', () => {
  it('twoSidedFilter: the inline path and the fetching path agree on the SAME rows and the SAME filter', async () => {
    // One matcher, two branches of the fetch effect. Any disagreement here is
    // the short-circuit and nothing else.
    const dataSource = new ValueDataSource({ items: ROWS }) as any;

    const { unmount } = render(
      <ObjectMap
        schema={{ ...base, data: { provider: 'value', items: ROWS }, filter: OPEN_FILTER }}
        enableClustering={false}
      />,
    );
    await waitFor(() => expect(drawn().count).toBe('3'));
    const inline = drawn();
    unmount();

    render(
      <ObjectMap
        schema={{ ...base, objectName: 'place', filter: OPEN_FILTER }}
        dataSource={dataSource}
        enableClustering={false}
      />,
    );
    await waitFor(() => expect(drawn().count).toBe('3'));
    const fetching = drawn();

    expect(inline.lngs).toBe(OPEN_LNGS);
    expect(fetching.lngs).toBe(OPEN_LNGS);
    // The finding, stated as the two paths agreeing.
    expect(inline.lngs).toBe(fetching.lngs);
  });

  it('inlineSort: an authored `sort` orders the inline rows', async () => {
    render(
      <ObjectMap
        schema={{
          ...base,
          data: { provider: 'value', items: ROWS },
          sort: [{ field: 'rank', order: 'desc' }],
        }}
        enableClustering={false}
      />,
    );
    await waitFor(() => expect(drawn().count).toBe('5'));
    // rank 50,40,30,20,10 → Echo, Charlie, Alpha, Delta, Bravo
    expect(drawn().lngs).toBe('5,3,1,4,2');
  });

  it('staticDataSpelling: the `staticData` rung reaches the same repair', async () => {
    // `resolveRecordSourceConfig` wraps `staticData` into
    // `{ provider: 'value', items }`, so it lands on exactly this path.
    render(
      <ObjectMap
        schema={{ ...base, staticData: ROWS, filter: OPEN_FILTER }}
        enableClustering={false}
      />,
    );
    await waitFor(() => expect(drawn().count).toBe('3'));
    expect(drawn().lngs).toBe(OPEN_LNGS);
  });

  it('offArmDataSpelling: a bare ARRAY under `data` is NOT an inline source here', async () => {
    // ⭐ The rung ruling, pinned on the block it actually bites (objectui#8348,
    // decision batch #83 — "the row decides"). This row used to assert the
    // opposite: that `getDataConfig` normalizes a bare array under `data` into
    // `{ provider: 'value', items }` (objectui#5305). That normalizing head is
    // GONE — `getDataConfig` now delegates to `resolveRecordSourceConfig(schema,
    // 'view-data')`, and `object-map`'s published `data` row is `ViewData`, so a
    // bare array is refused BY KIND. With no `staticData` and no `objectName`
    // to fall to, the ladder returns null and the map has no record source.
    //
    // ⛔ The mirror image of `ObjectCalendar.inlineQueryKeys-9061`'s row of the
    // same name, and deliberately so: there the ARRAY is the honoured spelling
    // and the config object is refused. Copying either file's `data:` line into
    // the other is the defect these two rows exist to catch.
    render(
      <ObjectMap schema={{ ...base, data: ROWS, filter: OPEN_FILTER }} enableClustering={false} />,
    );
    await waitFor(() => expect(screen.queryByText(/Loading map/)).toBeNull());
    expect(drawn().count).toBe('0');

    // The LIT CONTROL, so the line above is a reading about the SPELLING and
    // not about these rows, this stub or this harness: the same rows, same
    // filter, same component, on the arm the row does declare, plot the three.
    cleanup();
    render(
      <ObjectMap
        schema={{ ...base, data: { provider: 'value', items: ROWS }, filter: OPEN_FILTER }}
        enableClustering={false}
      />,
    );
    await waitFor(() => expect(drawn().count).toBe('3'));
    expect(drawn().lngs).toBe(OPEN_LNGS);
  });

  it('ceilingCap: an inline set past the ceiling plots exactly the ceiling', async () => {
    render(
      <ObjectMap
        schema={{
          ...base,
          data: { provider: 'value', items: makeRows(nonGridRowCeilingQuery().$top + 500) },
        }}
        enableClustering={false}
      />,
    );
    await waitFor(() => expect(drawn().count).toBe(String(NON_GRID_ROW_CEILING)));
  });

  it('ceilingNote: the cut is LOUD — the footnote names both numbers', async () => {
    const total = nonGridRowCeilingQuery().$top + 500;
    render(
      <ObjectMap
        schema={{ ...base, data: { provider: 'value', items: makeRows(total) } }}
        enableClustering={false}
      />,
    );
    await waitFor(() => expect(drawn().count).toBe(String(NON_GRID_ROW_CEILING)));

    const note = await screen.findByRole('note');
    expect(note.getAttribute('data-row-ceiling-note')).toBe('non-grid');
    expect(note.textContent).toContain(String(NON_GRID_ROW_CEILING));
    expect(note.textContent).toContain(String(total));
  });

  it('ceilingOrder: the ceiling is applied to the FILTERED set, not to the raw one', async () => {
    // Over the ceiling before filtering, under it after: 2,400 rows of which
    // only every third is `open` (800). Filter-then-ceiling plots all 800 and
    // stays quiet; ceiling-then-filter could not.
    const rows = makeRows(2400, (i) => (i % 3 === 0 ? 'open' : 'closed'));
    render(
      <ObjectMap
        schema={{ ...base, data: { provider: 'value', items: rows }, filter: OPEN_FILTER }}
        enableClustering={false}
      />,
    );
    await waitFor(() => expect(drawn().count).toBe('800'));
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('control: an inline map with NO filter, NO sort and under the ceiling is unchanged', async () => {
    // ⭐ Green on BOTH ablation legs by construction. Without it a reviewer
    // cannot tell this repair from "the inline path now drops rows".
    render(
      <ObjectMap
        schema={{ ...base, data: { provider: 'value', items: ROWS } }}
        enableClustering={false}
      />,
    );
    await waitFor(() => expect(drawn().count).toBe('5'));
    expect(drawn().lngs).toBe('1,2,3,4,5');
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('providerBackedControl: a NON-inline view is untouched by this repair', async () => {
    // ⭐ The control that BOUNDS the change to the inline path: same filter,
    // same sort, same rows, resolved through the context adapter. Green before
    // this repair, green after it, and green on both ablation legs.
    const dataSource = new ValueDataSource({ items: ROWS }) as any;

    render(
      <ObjectMap
        schema={{
          ...base,
          objectName: 'place',
          filter: OPEN_FILTER,
          sort: [{ field: 'rank', order: 'desc' }],
        }}
        dataSource={dataSource}
        enableClustering={false}
      />,
    );
    await waitFor(() => expect(drawn().count).toBe('3'));
    // rank 50,40,30 → Echo, Charlie, Alpha
    expect(drawn().lngs).toBe('5,3,1');
    expect(screen.queryByRole('note')).toBeNull();
  });
});
