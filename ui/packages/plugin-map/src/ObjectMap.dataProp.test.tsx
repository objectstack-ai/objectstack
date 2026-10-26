/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Regression (objectui#5003): `props.data` was read by the fetch effect (via
 * the `rest` spread) but was not one of its dependencies. A host rendering
 * `<ObjectMap data={[]} .../>` while its own query is in flight, then passing
 * the resolved rows, saw the effect's copy of `data` stay empty forever — the
 * prop changed, but the effect never re-ran to notice.
 *
 * This is UNREACHABLE through the console path: `ElementDataSourceGate` (see
 * `ObjectMap.elementDataSource.test.tsx`) always drives the map through its
 * own `dataSource.find`, never through this prop. So the tests below mount
 * with `data` directly — the only way to exercise the buggy dependency list.
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ObjectMap } from './ObjectMap';
import './__tests__/webgl2Available';

// Mock react-map-gl/maplibre the same way the sibling ObjectMap tests do — no
// WebGL canvas in the test env, and every assertion here is about the marker
// count reaching the DOM, not the map surface itself.
vi.mock('react-map-gl/maplibre', () => ({
  default: (props: any) => <div aria-label="Map">{props.children}</div>,
  Map: ({ children }: any) => <div aria-label="Map">{children}</div>,
  NavigationControl: () => <div data-testid="nav-control" />,
  Marker: ({ children, longitude, latitude }: any) => (
    <div data-testid="map-marker" data-lat={latitude} data-lng={longitude}>
      {children}
    </div>
  ),
  Popup: ({ children }: any) => <div data-testid="map-popup">{children}</div>,
}));

const MAP_CONFIG = { latitudeField: 'latitude', longitudeField: 'longitude', titleField: 'name' };

const rows = [
  { id: '1', name: 'Loc 1', latitude: 40, longitude: -74 },
  { id: '2', name: 'Loc 2', latitude: 41, longitude: -75 },
];

describe('ObjectMap — props.data threading (objectui#5003)', () => {
  it('picks up rows passed as a prop AFTER mount, not just at mount', async () => {
    const schema: any = { type: 'map', map: MAP_CONFIG };

    const { rerender } = render(<ObjectMap schema={schema} data={[]} />);

    await waitFor(() => expect(screen.queryByText('Loading map...')).toBeNull());
    expect(screen.queryAllByTestId('map-marker')).toHaveLength(0);

    // The host's own query resolves later and re-renders with the rows —
    // exactly the sequence the issue describes (a query in flight at first
    // paint). Nothing else about the schema changes.
    rerender(<ObjectMap schema={schema} data={rows} />);

    await waitFor(() => {
      expect(screen.getAllByTestId('map-marker')).toHaveLength(2);
    });
    const markers = screen.getAllByTestId('map-marker');
    expect(markers[0]).toHaveAttribute('data-lat', '40');
    expect(markers[1]).toHaveAttribute('data-lat', '41');
  });

  it('does not refetch on every render — a stable `data` prop is read once', async () => {
    const schema: any = { type: 'map', map: MAP_CONFIG };

    const { rerender } = render(<ObjectMap schema={schema} data={rows} className="a" />);
    await waitFor(() => expect(screen.getAllByTestId('map-marker')).toHaveLength(2));

    // Re-render with the SAME `data` array identity but a different unrelated
    // prop. If the effect depended on the whole `rest` object (a fresh object
    // every render) instead of the declared `data` prop, this would be
    // indistinguishable from a genuine data change and would flip back
    // through the `loading` gate, unmounting `MapGL` for a beat.
    rerender(<ObjectMap schema={schema} data={rows} className="b" />);

    // Give any spurious effect a tick to fire before asserting steady state.
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText('Loading map...')).toBeNull();
    expect(screen.getAllByTestId('map-marker')).toHaveLength(2);
  });
});
