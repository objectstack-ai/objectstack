/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8169 — an unbound map REFUSES; coordinates are never guessed.
 *
 * Maintainer ruling 2026-09-07 (decision batch #67, option B, 「同意」): the
 * principle behind objectui#7070 (「日期轴永不虚构」) and the objectui#5953 title
 * ruling generalise to coordinates. `getMapConfig`'s third branch — the
 * `latitude` / `longitude` / `location` / `description` guesses — is gone, and
 * the two relay floors that used to hand this component a fabricated
 * `locationField: 'location'` (`plugin-list/src/ListView.tsx`,
 * `plugin-view/src/ObjectView.tsx`) went with it in the same change.
 *
 * ## The three arms the ruling's execution notes require, and why the third is
 * the one that measures it
 *
 *   1. an undeclared map renders the refusal state;
 *   2. a declared `map` block renders markers (the control — without it, a
 *      component that refused everything would pass arm 1 and arm 3);
 *   3. ⭐ a record set carrying REAL `latitude` / `longitude` columns, on a view
 *      that declared nothing, does **not** plot.
 *
 * Arm 3 is the discriminating one. Arms 1 and 2 pass identically on a tree that
 * only deleted the relay floors — that reading of objectui#7547 was measured on
 * objectui#8169 and rejected precisely because it widens the guess from one
 * field name to three: the floor forced `getMapConfig`'s FLAT branch, which
 * returns `locationField` with no `latitudeField` / `longitudeField` beside it,
 * so deleting the floor alone would have made these very records start
 * plotting. `extractCoordinates` tries the lat/lng pair BEFORE the location
 * field, so this arm goes red the moment either face is restored.
 *
 * Arm 3 runs through the real `ListView` rather than against `getMapConfig`,
 * because "an undeclared view" is a statement about the producer path: the two
 * faces have to be measured joined, which is the shape of the defect the card
 * reported. `@object-ui/plugin-list` is a devDependency of this package for
 * exactly this kind of file — see `ObjectMap.listViewMapConfigReach.test.tsx`,
 * whose harness this one mirrors.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRendererProvider } from '@object-ui/react';
import { ListView } from '@object-ui/plugin-list';
import { ObjectMap } from './ObjectMap';
import './__tests__/webgl2Available';

vi.mock('react-map-gl/maplibre', () => ({
  default: ({ children }: any) => <div aria-label="Map">{children}</div>,
  Map: ({ children }: any) => <div aria-label="Map">{children}</div>,
  NavigationControl: () => <div data-testid="nav-control" />,
  Marker: ({ children, longitude, latitude }: any) => (
    <div data-testid="map-marker" data-lng={longitude} data-lat={latitude}>
      {children}
    </div>
  ),
  Popup: ({ children }: any) => <div data-testid="map-popup">{children}</div>,
}));

// The real renderer, under the tag `ListView`'s `case 'map'` emits.
ComponentRegistry.register('object-map', ObjectMap as any, {
  namespace: 'test',
  label: 'Object Map',
  category: 'view',
});

/**
 * Records spelled the way the deleted guesses expected: real `latitude` /
 * `longitude` columns, the population arm 3 is about. Nothing here is
 * malformed — plotting them is exactly what must NOT happen unbound.
 */
const COORDINATE_RECORDS = [
  { id: '1', name: 'Seattle depot', latitude: 47.6062, longitude: -122.3321 },
  { id: '2', name: 'SF depot', latitude: 37.7749, longitude: -122.4194 },
];

const REFUSAL = 'map-missing-location-binding';

const makeDataSource = () => ({
  find: vi.fn().mockResolvedValue(COORDINATE_RECORDS),
  findOne: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getObjectSchema: vi.fn().mockResolvedValue({
    name: 'depot',
    fields: {
      name: { type: 'text' },
      latitude: { type: 'number' },
      longitude: { type: 'number' },
    },
  }),
});

/** Mount the component directly, with the records on the host `data` prop. */
const renderMap = async (schema: Record<string, unknown>) => {
  const utils = render(<ObjectMap schema={schema as any} data={COORDINATE_RECORDS} />);
  await waitFor(() => expect(screen.queryByText('Loading map...')).toBeNull());
  return utils;
};

/** Mount a `map` list view — the producer path, with no map config at all. */
async function renderListViewMap(view: Record<string, unknown>) {
  const dataSource = makeDataSource() as any;
  render(
    <SchemaRendererProvider dataSource={dataSource}>
      <ListView
        schema={
          {
            type: 'list-view',
            objectName: 'depot',
            viewType: 'map',
            columns: ['name'],
            ...view,
          } as never
        }
        dataSource={dataSource}
      />
    </SchemaRendererProvider>,
  );
}

describe('objectui#8169 — arm 1: an undeclared map refuses', () => {
  it('renders the refusal state, not an empty map', async () => {
    await renderMap({ type: 'object-map' });

    const refusal = await screen.findByTestId(REFUSAL);
    // The ruling's copy, verbatim. The key names render as `code` spans, so the
    // sentence is read off `textContent` rather than matched as one text node.
    expect(refusal.textContent).toContain('Map configuration required');
    expect(refusal.textContent).toContain('map.locationField');
    expect(refusal.textContent).toContain('map.latitudeField');
    expect(refusal.textContent).toContain('map.longitudeField');

    // ⭐ The refusal REPLACES the map — the silent-credible-wrong shape
    // objectstack#13748 ruled against was an empty map, not a missing one.
    expect(screen.queryByLabelText('Map')).toBeNull();
    expect(screen.queryAllByTestId('map-marker')).toHaveLength(0);
  });

  it('refuses a declared `map` block that binds no coordinate field either', async () => {
    // `map: { titleField }` used to render an empty map under the
    // excluded-records notice: the block replaced the defaults and named no
    // coordinate field, so nothing could ever place. Unbound is unbound,
    // whichever branch produced the config.
    await renderMap({ type: 'object-map', map: { titleField: 'name' } });

    expect(await screen.findByTestId(REFUSAL)).toBeTruthy();
  });

  it('refuses a HALF pair — `latitudeField` with no `longitudeField`', async () => {
    // `extractCoordinates` reads the pair or nothing, so a half pair places no
    // marker. It reaches `getMapConfig`'s flat branch (that gate is
    // `locationField || latitudeField`), which is why this arm is worth its own
    // row: the config is non-empty and still unbound.
    await renderMap({ type: 'object-map', latitudeField: 'latitude' });

    expect(await screen.findByTestId(REFUSAL)).toBeTruthy();
  });
});

describe('objectui#8169 — arm 2: a declared `map` block still renders markers', () => {
  it('plots the records the block binds (CONTROL for arms 1 and 3)', async () => {
    await renderMap({
      type: 'object-map',
      map: { latitudeField: 'latitude', longitudeField: 'longitude', titleField: 'name' },
    });

    await waitFor(() => expect(screen.getAllByTestId('map-marker')).toHaveLength(2));
    expect(screen.queryByTestId(REFUSAL)).toBeNull();
  });

  it('plots on a `locationField` binding too — the other accepted spelling', async () => {
    render(
      <ObjectMap
        schema={{ type: 'object-map', map: { locationField: 'site' } } as any}
        data={[{ id: '1', name: 'HQ', site: { lat: 40, lng: -74 } }]}
      />,
    );

    await waitFor(() => expect(screen.getAllByTestId('map-marker')).toHaveLength(1));
    expect(screen.queryByTestId(REFUSAL)).toBeNull();
  });
});

describe('objectui#8169 — arm 3: real lat/lng columns on an undeclared view do NOT plot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('refuses through the real ListView relay, records and all', async () => {
    await renderListViewMap({});

    // The relay no longer floors `locationField: 'location'`, and the component
    // no longer guesses `latitude` / `longitude` — so the two faces agree and
    // the records stay unplotted even though they carry the exact columns the
    // deleted guesses named.
    expect(await screen.findByTestId(REFUSAL)).toBeTruthy();
    expect(screen.queryAllByTestId('map-marker')).toHaveLength(0);
    expect(screen.queryByLabelText('Map')).toBeNull();
  });

  it('CONTROL: the same view, same records, WITH a declared block — plots both', async () => {
    // Without this row the arm above is unfalsifiable: a ListView that never
    // reached `ObjectMap` at all would satisfy it.
    await renderListViewMap({
      map: { latitudeField: 'latitude', longitudeField: 'longitude', titleField: 'name' },
    });

    await waitFor(() => expect(screen.getAllByTestId('map-marker')).toHaveLength(2));
    expect(screen.queryByTestId(REFUSAL)).toBeNull();
  });
});
