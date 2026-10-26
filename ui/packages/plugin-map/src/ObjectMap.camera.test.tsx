/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * Regression (objectui#4941): a map list view with records first-painted a
 * viewport that did not contain them. The camera never fitted the data — the
 * zoom came from a synthesized default (10, a city-block scale) and the centre
 * from the naive longitude extremes — so the showcase `task` map opened on empty
 * sea and the records had to be found by hand.
 *
 * These pin what `MapGL` is actually mounted with. The derivation itself is
 * pinned in `camera.test.ts`.
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ObjectMap } from './ObjectMap';
import { FIT_MAX_ZOOM, FIT_PADDING_PX, EMPTY_VIEW_ZOOM, UNFITTED_CENTER_ZOOM } from './camera';
import './__tests__/webgl2Available';

let capturedProps: any = null;

vi.mock('react-map-gl/maplibre', () => ({
  default: (props: any) => {
    capturedProps = props;
    return <div aria-label="Map">{props.children}</div>;
  },
  Map: ({ children }: any) => <div aria-label="Map">{children}</div>,
  NavigationControl: () => <div data-testid="nav-control" />,
  Marker: ({ children, longitude, latitude }: any) => (
    <div data-testid="map-marker" data-lng={longitude} data-lat={latitude}>
      {children}
    </div>
  ),
  Popup: ({ children }: any) => <div data-testid="map-popup">{children}</div>,
}));

/**
 * Showcase-shaped records: the platform's `location` value is `{ lat, lng }` —
 * half of the pair of facts that produced the reported empty first paint. The
 * other half was that the showcase map view declared no map config at all, and
 * `getMapConfig` guessed `location` for it.
 *
 * ⚠️ That half is no longer reachable (objectui#8169, ruled 2026-09-07): an
 * unbound map REFUSES and never mounts `MapGL`, so a camera assertion over an
 * unconfigured view would be measuring the refusal, not the camera. Every arm
 * below therefore DECLARES the binding these records genuinely carry — the
 * default below — which is what the guess used to supply and leaves each
 * camera fact, and every number in this file, exactly as objectui#4941 pinned
 * it. The camera is what this file grades; the binding is now a premise.
 */
const usCities = [
  { id: '1', name: 'Seattle', location: { lat: 47.6062, lng: -122.3321 } },
  { id: '2', name: 'San Francisco', location: { lat: 37.7749, lng: -122.4194 } },
  { id: '3', name: 'New York', location: { lat: 40.7128, lng: -74.006 } },
  { id: '4', name: 'Austin', location: { lat: 30.2672, lng: -97.7431 } },
];

const valueView = (
  items: any[],
  map: Record<string, unknown> = { locationField: 'location' },
): any => ({
  type: 'map',
  map,
  data: { provider: 'value', items },
});

const renderMap = async (schema: any) => {
  render(<ObjectMap schema={schema} />);
  await waitFor(() => expect(screen.queryByText('Loading map...')).toBeNull());
  await waitFor(() => expect(capturedProps).not.toBeNull());
};

describe('ObjectMap — initial camera', () => {
  beforeEach(() => {
    capturedProps = null;
  });

  it('fits the queried records when no camera is declared', async () => {
    await renderMap(valueView(usCities));

    const { bounds, fitBoundsOptions, zoom, longitude, latitude } = capturedProps.initialViewState;

    expect(bounds).toEqual([
      [-122.4194, 30.2672],
      [-74.006, 47.6062],
    ]);
    expect(fitBoundsOptions).toEqual({ padding: FIT_PADDING_PX, maxZoom: FIT_MAX_ZOOM });
    // The fit owns the camera: no synthesized centre/zoom rides along. A zoom of
    // 10 here is the bug — a viewport ~30km wide, on a set spanning ~4000km.
    expect(zoom).toBeUndefined();
    expect(longitude).toBeUndefined();
    expect(latitude).toBeUndefined();

    expect(screen.getAllByTestId('map-marker')).toHaveLength(4);
  });

  it('fits across the antimeridian along the short arc', async () => {
    await renderMap(
      valueView([
        { id: '1', name: 'west of the line', location: { lat: -16, lng: 179 } },
        { id: '2', name: 'east of the line', location: { lat: -18, lng: -179 } },
      ]),
    );

    // 179 -> 181 keeps the box on one world copy. The naive extremes would give
    // [-179, 179]: a box centred on 0, half a planet from both records.
    expect(capturedProps.initialViewState.bounds).toEqual([
      [179, -18],
      [181, -16],
    ]);
  });

  it('fits a single record without zooming to rooftop scale', async () => {
    await renderMap(valueView([usCities[1]]));

    const { bounds, fitBoundsOptions } = capturedProps.initialViewState;
    expect(bounds).toEqual([
      [-122.4194, 37.7749],
      [-122.4194, 37.7749],
    ]);
    expect(fitBoundsOptions.maxZoom).toBe(FIT_MAX_ZOOM);
  });

  it('does not fit an empty record set — the world, not a random sea', async () => {
    await renderMap(valueView([]));

    expect(capturedProps.initialViewState).toEqual({
      longitude: 0,
      latitude: 0,
      zoom: EMPTY_VIEW_ZOOM,
    });
    expect(capturedProps.initialViewState.bounds).toBeUndefined();
  });

  it('lets a declared camera win over the fit', async () => {
    await renderMap(
      valueView(usCities, {
        latitudeField: 'latitude',
        longitudeField: 'longitude',
        locationField: 'location',
        titleField: 'name',
        // Declared as [lat, lng], the documented order for this block.
        center: [51.5074, -0.1278],
        zoom: 12,
      }),
    );

    expect(capturedProps.initialViewState.bounds).toBeUndefined();
    expect(capturedProps.initialViewState).toEqual({
      longitude: -0.1278,
      latitude: 51.5074,
      zoom: 12,
    });
  });

  it('keeps a declared zoom and takes the centre from the records', async () => {
    await renderMap(
      valueView(usCities, { locationField: 'location', titleField: 'name', zoom: 6 }),
    );

    const { bounds, longitude, latitude, zoom } = capturedProps.initialViewState;
    expect(bounds).toBeUndefined();
    expect(zoom).toBe(6);
    // Centre of the fitted box, not the origin.
    expect(longitude).toBeCloseTo((-122.4194 + -74.006) / 2, 6);
    expect(latitude).toBeCloseTo((30.2672 + 47.6062) / 2, 6);
  });

  it('keeps a declared centre and falls back to a continental zoom', async () => {
    await renderMap(
      valueView(usCities, {
        locationField: 'location',
        titleField: 'name',
        center: [51.5074, -0.1278],
      }),
    );

    expect(capturedProps.initialViewState).toEqual({
      longitude: -0.1278,
      latitude: 51.5074,
      zoom: UNFITTED_CENTER_ZOOM,
    });
  });

  it('still fits when the declared camera cannot be read', async () => {
    // The shape a reader of the package README would write. It is diagnosed by
    // `MapConfigSchema`, not adapted — and it must not cost the view its fit.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await renderMap(
        valueView(usCities, {
          locationField: 'location',
          titleField: 'name',
          center: { lat: 51.5074, lng: -0.1278 } as unknown as [number, number],
        }),
      );

      expect(capturedProps.initialViewState.bounds).toEqual([
        [-122.4194, 30.2672],
        [-74.006, 47.6062],
      ]);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
