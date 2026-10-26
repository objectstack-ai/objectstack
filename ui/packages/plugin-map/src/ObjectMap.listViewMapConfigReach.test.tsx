/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#5042 — the END of the chain: a view-level `map` block authored on a
 * list view reaches `getMapConfig` intact and drives its reads.
 *
 * `ListView.mapViewLevelConfig.test.tsx` (plugin-list) pins the forward itself,
 * against a spy. A spy can only ever show that a prop was PASSED, and this card
 * is not about a prop — the reported symptom was `undefined` marker titles, one
 * read site downstream of a config that never arrived. So this file drives the
 * real `ListView` into the real `ObjectMap` and asserts what an author would
 * see: the markers, their titles, and the camera.
 *
 * Two things make that seam worth its own test rather than an assumed join:
 *
 *   - `getMapConfig` reaches the flat form ONLY through
 *     `if (schema.locationField || schema.latitudeField)`. `ListView` satisfies
 *     that gate today via its `locationField: … || 'location'` default; drop the
 *     default and every other flat key — `titleField` included — is silently
 *     ignored, with no type error and no failing unit test on either side.
 *   - The two packages agree on the FLAT spelling, and nothing but a test
 *     holds them to it: a nested `map` key would win outright here
 *     (objectui#5018) and quietly change the precedence the forward implements.
 *
 * `@object-ui/plugin-list` is a devDependency of this package for exactly this
 * file — dev-only (no runtime source here imports it) and acyclic
 * (`plugin-list` does not depend on `plugin-map`). The alternative homes cannot
 * host it: `plugin-list` cannot resolve `react-map-gl` to mock it, and
 * `apps/console`, which declares both plugins, cannot either.
 */

import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRendererProvider } from '@object-ui/react';
import { ListView } from '@object-ui/plugin-list';
import { ObjectMap } from './ObjectMap';
import { FIT_MAX_ZOOM, FIT_PADDING_PX } from './camera';
import './__tests__/webgl2Available';

let capturedProps: any = null;

vi.mock('react-map-gl/maplibre', () => ({
  default: (props: any) => {
    capturedProps = props;
    return <div aria-label="Map">{props.children}</div>;
  },
  Map: ({ children }: any) => <div aria-label="Map">{children}</div>,
  NavigationControl: () => <div data-testid="nav-control" />,
  Marker: ({ children, longitude, latitude, onClick }: any) => (
    <div
      data-testid="map-marker"
      data-lng={longitude}
      data-lat={latitude}
      onClick={() => onClick?.({ originalEvent: { stopPropagation() {} } })}
    >
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
 * Showcase-shaped records: the platform's `location` value is `{ lat, lng }`,
 * and the marker text field is `title` — the pair the card names.
 */
const records = [
  { id: '1', title: 'Install rooftop unit', blurb: 'Bldg A', location: { lat: 47.6062, lng: -122.3321 } },
  { id: '2', title: 'Replace filters', blurb: 'Bldg B', location: { lat: 37.7749, lng: -122.4194 } },
];

const makeDataSource = () => ({
  find: vi.fn().mockResolvedValue(records),
  findOne: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getObjectSchema: vi.fn().mockResolvedValue({
    name: 'showcase_task',
    fields: {
      title: { type: 'text' },
      blurb: { type: 'text' },
      location: { type: 'location' },
    },
  }),
});

/** Mount a `map` list view and settle both the ListView fetch and the map. */
async function renderListViewMap(view: Record<string, unknown>) {
  capturedProps = null;
  const dataSource = makeDataSource() as any;
  render(
    <SchemaRendererProvider dataSource={dataSource}>
      <ListView
        schema={
          {
            type: 'list-view',
            objectName: 'showcase_task',
            viewType: 'map',
            columns: ['title'],
            ...view,
          } as never
        }
        dataSource={dataSource}
      />
    </SchemaRendererProvider>,
  );
  await waitFor(() => expect(screen.queryByLabelText('Map')).not.toBeNull());
  await waitFor(() => expect(capturedProps).not.toBeNull());
}

describe('a view-level `map` block reaches getMapConfig through ListView (objectui#5042)', () => {
  beforeEach(() => {
    capturedProps = null;
  });

  // THE DISCRIMINATING ARM — `titleField`, the card's own symptom.
  it('renders marker titles from the declared `titleField`', async () => {
    await renderListViewMap({ map: { locationField: 'location', titleField: 'title' } });

    await waitFor(() => expect(screen.getAllByTestId('map-marker').length).toBe(2));

    // The title is a real read, not a forwarded prop: `getMapConfig` resolves
    // the declared `titleField`, the marker transform hands it to
    // `getRecordDisplayName` as `options.titleField` — step 0 of that resolver,
    // so a declared binding still wins outright — and the popup renders it.
    // Before the forward landed the block never reached `getMapConfig` at all:
    // the flat branch forged `titleField: 'name'` (dropped by objectui#5953)
    // and these records carry no `name`, so this read `undefined` — the
    // marker-title symptom the card was filed for. `'Marker'` is not a
    // `getMapConfig` literal and never was: it is `getRecordDisplayName`'s
    // `fallback` option in the marker transform, reached now only by an
    // id-less record.
    fireEvent.click(screen.getAllByTestId('map-marker')[0]);
    await waitFor(() => expect(screen.queryByTestId('map-popup')).not.toBeNull());
    expect(screen.getByText('Install rooftop unit')).toBeTruthy();
  });

  it('renders the marker description from the declared `descriptionField`', async () => {
    await renderListViewMap({
      map: { locationField: 'location', titleField: 'title', descriptionField: 'blurb' },
    });

    await waitFor(() => expect(screen.getAllByTestId('map-marker').length).toBe(2));
    fireEvent.click(screen.getAllByTestId('map-marker')[0]);
    await waitFor(() => expect(screen.queryByTestId('map-popup')).not.toBeNull());
    expect(screen.getByText('Bldg A')).toBeTruthy();
  });

  it('honours a declared camera — the declaration suppresses the fit', async () => {
    await renderListViewMap({
      map: { locationField: 'location', titleField: 'title', zoom: 12, center: [40.7128, -74.006] },
    });

    const { bounds, zoom, longitude, latitude } = capturedProps.initialViewState;

    // `center` is `[lat, lng]` (ObjectMapConfigSchema's own description).
    expect(latitude).toBe(40.7128);
    expect(longitude).toBe(-74.006);
    expect(zoom).toBe(12);
    // The whole point of carrying no spec default for `zoom`/`center`
    // (objectui#5000): a DECLARED camera opts out of the fit. If the block had
    // not reached here, `bounds` would be set and these three would be the
    // fitted values instead.
    expect(bounds).toBeUndefined();
  });

  it('CONTROL: with no camera declared, the map still fits the queried records', async () => {
    await renderListViewMap({ map: { locationField: 'location', titleField: 'title' } });

    const { bounds, fitBoundsOptions } = capturedProps.initialViewState;

    expect(bounds).toBeDefined();
    expect(fitBoundsOptions).toEqual({ padding: FIT_PADDING_PX, maxZoom: FIT_MAX_ZOOM });
  });

  it('CONTROL: the legacy `options.map` bag still reaches the same reads', async () => {
    await renderListViewMap({ options: { map: { locationField: 'location', titleField: 'title' } } });

    await waitFor(() => expect(screen.getAllByTestId('map-marker').length).toBe(2));
    fireEvent.click(screen.getAllByTestId('map-marker')[0]);
    await waitFor(() => expect(screen.queryByTestId('map-popup')).not.toBeNull());
    expect(screen.getByText('Install rooftop unit')).toBeTruthy();
  });

  it('precedence: the view-level block wins over the bag at the READ site', async () => {
    // Both name a marker-title field; the records carry distinct values, so the
    // rendered popup says which config actually drove the read.
    await renderListViewMap({
      options: { map: { locationField: 'location', titleField: 'blurb' } },
      map: { titleField: 'title' },
    });

    await waitFor(() => expect(screen.getAllByTestId('map-marker').length).toBe(2));
    fireEvent.click(screen.getAllByTestId('map-marker')[0]);
    await waitFor(() => expect(screen.queryByTestId('map-popup')).not.toBeNull());

    expect(screen.getByText('Install rooftop unit')).toBeTruthy();
    // …and the coordinate binding the bag alone supplied still worked, which is
    // what makes this a per-key merge rather than a replacement: markers exist
    // at all only because `locationField` survived from the bag.
    expect(screen.getAllByTestId('map-marker').length).toBe(2);
  });
});
