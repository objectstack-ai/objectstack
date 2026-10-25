/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10767 — an `object-map` with inline rows renders the rows a spec
 * `ViewFilterRule[]` `filter` selects.
 *
 * ## What was wrong
 *
 * The inline arm hands `schema.filter` to an in-memory `ValueDataSource`
 * unlowered (objectui#9061 routed it there so `filter` / `sort` / the ceiling
 * are honoured). That adapter read a MongoDB-style record and an AST array,
 * but refused a rule OBJECT node by node — so the one filter form the spec's
 * converged `filter` doors accept (objectui#6206 B) plotted NO markers, with
 * one `console.warn` as the only signal. The record form and the AST form
 * plotted the three; they are the controls here.
 *
 * The repair is in `@object-ui/core`'s `ValueDataSource` (the array arm lowers
 * through `toFilterNode`), so this file changes nothing in `ObjectMap.tsx`; it
 * pins the consequence on THIS block, through its own inline spellings.
 *
 * ## HOW THE INLINE ROWS ARE SPELLED HERE
 *
 * `{ provider: 'value', items }` under `data`, or `staticData` — the two rungs
 * `object-map`'s published `ViewData` row admits (objectui#8348, decision batch
 * #83). A BARE ARRAY under `data` reaches no inline source on this block, and a
 * `data` PROP is the host-data passthrough above the query, so neither is a
 * rule-array case; `ObjectMap.inlineQueryKeys-9061.test.tsx` pins the former.
 *
 * ## `enableClustering={false}` is what makes the count observable
 *
 * The map clusters above 100 markers by default; same reason the sibling pins
 * pass the prop.
 *
 * REVERSE VERIFICATION — direction predicted BEFORE running, from the committed
 * fix, by restoring the unlowered array arm in `ValueDataSource.find`:
 * `ruleArrayFilter` and `ruleArrayFilterStaticData` go RED; `recordFormControl`
 * and `astControl` stay GREEN — they plot the same three either way, which is
 * what makes them controls.
 */

import React from 'react';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ObjectMap } from './ObjectMap';
import './__tests__/webgl2Available';

// Same stub the sibling ObjectMap pins use (no WebGL in this lane), widened on
// `Marker` by the longitude it is handed: the marker array carries `[lng, lat]`
// straight from the record, so the longitude sequence IS the row identity.
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
  { id: '1', name: 'Alpha', status: 'open', latitude: 10, longitude: 1 },
  { id: '2', name: 'Bravo', status: 'closed', latitude: 11, longitude: 2 },
  { id: '3', name: 'Charlie', status: 'open', latitude: 12, longitude: 3 },
  { id: '4', name: 'Delta', status: 'closed', latitude: 13, longitude: 4 },
  { id: '5', name: 'Echo', status: 'open', latitude: 14, longitude: 5 },
];

/** The three rows a `status = open` filter declares, in every spelling. */
const OPEN_LNGS = '1,3,5';
const RULE_ARRAY_FILTER = [{ field: 'status', operator: 'equals', value: 'open' }];
const RECORD_FORM_FILTER = { status: 'open' };
const AST_FILTER = [['status', '=', 'open']];

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

describe('objectui#10767 — the map plots the rows a rule-array `filter` selects on inline `value` data', () => {
  it('ruleArrayFilter: the spec’s rule array plots the three declared rows', async () => {
    render(
      <ObjectMap
        schema={{ ...base, data: { provider: 'value', items: ROWS }, filter: RULE_ARRAY_FILTER }}
        enableClustering={false}
      />,
    );
    await waitFor(() => expect(drawn().count).toBe('3'));
    expect(drawn().lngs).toBe(OPEN_LNGS);
  });

  it('ruleArrayFilterStaticData: the `staticData` rung reaches the same repair', async () => {
    render(
      <ObjectMap
        schema={{ ...base, staticData: ROWS, filter: RULE_ARRAY_FILTER }}
        enableClustering={false}
      />,
    );
    await waitFor(() => expect(drawn().count).toBe('3'));
    expect(drawn().lngs).toBe(OPEN_LNGS);
  });

  it('recordFormControl: the record form plots the same three (green on both trees)', async () => {
    render(
      <ObjectMap
        schema={{ ...base, data: { provider: 'value', items: ROWS }, filter: RECORD_FORM_FILTER }}
        enableClustering={false}
      />,
    );
    await waitFor(() => expect(drawn().count).toBe('3'));
    expect(drawn().lngs).toBe(OPEN_LNGS);
  });

  it('astControl: the AST form plots the same three (green on both trees)', async () => {
    render(
      <ObjectMap
        schema={{ ...base, data: { provider: 'value', items: ROWS }, filter: AST_FILTER }}
        enableClustering={false}
      />,
    );
    await waitFor(() => expect(drawn().count).toBe('3'));
    expect(drawn().lngs).toBe(OPEN_LNGS);
  });
});
