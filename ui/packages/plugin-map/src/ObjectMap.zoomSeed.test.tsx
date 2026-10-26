/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Regression (objectui#5003): `currentZoom` — the value `clusterMarkers` uses
 * for its grid cell size — was seeded with the NOMINAL `mapConfig.zoom || 3`
 * and updated only by `onZoom`. MapLibre applies the initial camera
 * (`initialViewState`, including a `bounds` fit) via its constructor, before
 * react-map-gl attaches React's event handlers, so no `onZoom` ever fires for
 * that first camera — the seed stayed nominal until the user's first zoom.
 *
 * This was equally true before objectui#4941 (the old nominal seed was `10`);
 * that PR did not introduce it. Recorded here so it is not rediscovered as a
 * regression of that PR.
 *
 * Dormant on the console path: clustering only engages above 100 markers (or
 * explicit opt-in), so a stale seed has no visible effect on the small sets
 * in the examples. These tests opt in explicitly and use a marker pair whose
 * grid-cell membership flips between the nominal seed (3) and a zoomed-in
 * camera (12), so the cluster/no-cluster split is a direct, observable proxy
 * for what `currentZoom` actually holds.
 */
import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ObjectMap } from './ObjectMap';
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

// ~1 degree apart in both axes: at the nominal seed (zoom 3, cell size
// 50/2^3 = 6.25deg) both fall in the same grid cell and cluster into one; at
// zoom 12 (cell size 50/2^12 ≈ 0.0122deg) they land in different cells and
// render as two separate markers. The split is the observable signal.
const twoNearbyCities = [
  { id: '1', name: 'Loc 1', latitude: 40, longitude: -74 },
  { id: '2', name: 'Loc 2', latitude: 41, longitude: -75 },
];

const schema: any = {
  type: 'map',
  map: { latitudeField: 'latitude', longitudeField: 'longitude', titleField: 'name' },
  // No declared `zoom` — the nominal `mapConfig.zoom || 3` seed applies.
  data: { provider: 'value', items: twoNearbyCities },
};

describe('ObjectMap — clustering zoom seed (objectui#5003)', () => {
  beforeEach(() => {
    capturedProps = null;
  });

  it('starts clustered under the nominal seed, then splits once the applied camera is read', async () => {
    render(<ObjectMap schema={schema} enableClustering />);

    await waitFor(() => expect(screen.queryByText('Loading map...')).toBeNull());
    await waitFor(() => expect(capturedProps).not.toBeNull());

    // Before `onLoad` fires: the nominal seed (3) groups the pair into one
    // cluster — this is the bug's starting state, present on both legs. The
    // cluster pin is itself wrapped in a `Marker`, so `map-marker` reads 1
    // here too (one wrapper, holding the one `map-cluster` div).
    await waitFor(() => {
      expect(screen.getAllByTestId('map-cluster')).toHaveLength(1);
    });
    expect(screen.getAllByTestId('map-marker')).toHaveLength(1);

    // MapLibre's 'load' event: the camera has settled. `onLoad` is undefined
    // on the unfixed component (no handler wired), so this is a no-op there —
    // predicted red assertion below is what tells the two legs apart.
    act(() => {
      capturedProps.onLoad?.({ target: { getZoom: () => 12 } });
    });

    await waitFor(() => {
      expect(screen.getAllByTestId('map-marker')).toHaveLength(2);
    });
    expect(screen.queryAllByTestId('map-cluster')).toHaveLength(0);
  });

  it('ignores an onLoad event carrying no readable zoom', async () => {
    render(<ObjectMap schema={schema} enableClustering />);
    await waitFor(() => expect(capturedProps).not.toBeNull());
    await waitFor(() => expect(screen.getAllByTestId('map-cluster')).toHaveLength(1));

    // No `target`, or a `target` without `getZoom` — must not throw, and must
    // leave the seed (and therefore the clustering) unchanged.
    expect(() => act(() => { capturedProps.onLoad?.({}); })).not.toThrow();
    expect(screen.getAllByTestId('map-cluster')).toHaveLength(1);
  });
});
