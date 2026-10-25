/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#5976 — the marker `useMemo` declares memoization that never happened.
 *
 * `getMapConfig(schema)` was called straight in the render body, so `mapConfig`
 * carried a FRESH OBJECT IDENTITY on every render. The marker transform names
 * it in its dependency array (`[data, mapConfig, objectSchema]`), so that memo
 * recomputed on every single render while declaring that it does not — a
 * `useMemo` in spelling only. The invalidation then cascaded: `filteredMarkers`
 * → `clusteredData` / `markerBounds` → `initialViewState` all key on the array
 * it produces, so the whole marker pipeline rebuilt per render.
 *
 * ## Why these assertions, and not a render count
 *
 * The defect is about IDENTITY, so it is measured as identity — at the two
 * module boundaries this component actually crosses:
 *
 *  - `getRecordDisplayName` (`@object-ui/core`) is called once per record from
 *    INSIDE the marker memo, so its call count is a direct read of how many
 *    times that memo evaluated. This is the memo the card names.
 *  - `initialViewState` is handed to `MapGL` as a prop, and it sits at the tail
 *    of the cascade (`markers` → `filteredMarkers` → `markerBounds` →
 *    `initialViewState`). A `toBe` assertion on it therefore pins the whole
 *    chain, not just the first link.
 *
 * ## The counter-probe is load-bearing
 *
 * "Identity is stable" is also satisfiable by freezing a stale config forever,
 * which is a worse bug than the one being fixed and is invisible to the
 * positive assertion alone. So every stability assertion here is paired with
 * one that the identity DOES change when the schema genuinely changes — with a
 * visible consequence (the marker title actually re-resolves through the new
 * binding, the camera actually moves to the newly declared centre).
 */

import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const probe = vi.hoisted(() => ({
  displayNameCalls: 0,
  viewStates: [] as unknown[],
}));

vi.mock('@object-ui/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/core')>();
  return {
    ...actual,
    getRecordDisplayName: (...args: Parameters<typeof actual.getRecordDisplayName>) => {
      probe.displayNameCalls += 1;
      return actual.getRecordDisplayName(...args);
    },
  };
});

vi.mock('react-map-gl/maplibre', () => {
  const MapImpl = ({ children, initialViewState }: any) => {
    probe.viewStates.push(initialViewState);
    return <div aria-label="Map">{children}</div>;
  };
  return {
    default: MapImpl,
    Map: MapImpl,
    NavigationControl: () => <div data-testid="nav-control" />,
    Marker: ({ children, longitude, latitude, onClick }: any) => (
      <div
        data-testid="map-marker"
        data-lat={latitude}
        data-lng={longitude}
        onClick={() => onClick?.({ originalEvent: { stopPropagation() {} } })}
      >
        {children}
      </div>
    ),
    Popup: ({ children }: any) => <div data-testid="map-popup">{children}</div>,
  };
});

import { ObjectMap } from './ObjectMap';
import './__tests__/webgl2Available';

/**
 * Inline rows via the array shorthand: the `value` provider settles in one
 * effect and never fetches an object definition, so nothing async churns the
 * marker memo behind the measurement.
 */
const ROWS = [
  { id: '1', name: 'Harbour Depot', code: 'HD-01', latitude: 47.6062, longitude: -122.3321 },
  { id: '2', name: 'Ridge Yard', code: 'RY-02', latitude: 37.7749, longitude: -122.4194 },
];

const baseSchema = (map: Record<string, unknown>): any => ({
  type: 'object-map',
  map: { latitudeField: 'latitude', longitudeField: 'longitude', ...map },
  // The DECLARED inline-rows spelling, not the bare array this file used to
  // write. Since objectui#8348 `getDataConfig` honours `data` only on the arm
  // this block's published row declares — `ObjectMapSchema.data` is
  // `ViewDataSchema.optional()` — so the array shorthand is no longer lifted
  // and would leave this map empty. The resolved config is identical, which is
  // why this file's subject (memo identity) is untouched.
  data: { provider: 'value', items: ROWS },
});

/** `Array.prototype.at` is outside this package's configured `lib` target. */
const lastCamera = (): unknown => probe.viewStates[probe.viewStates.length - 1];

const settle = async () => {
  await waitFor(() => expect(screen.queryByText('Loading map...')).toBeNull());
  await waitFor(() => expect(screen.getAllByTestId('map-marker')).toHaveLength(2));
};

beforeEach(() => {
  probe.displayNameCalls = 0;
  probe.viewStates.length = 0;
});

describe('ObjectMap — `mapConfig` identity (objectui#5976)', () => {
  it('holds the marker memo across a re-render with unchanged inputs', async () => {
    const schema = baseSchema({ titleField: 'name' });

    const { rerender } = render(<ObjectMap schema={schema} />);
    await settle();

    const callsAtRest = probe.displayNameCalls;
    expect(callsAtRest).toBeGreaterThan(0);

    rerender(<ObjectMap schema={schema} />);

    // The memo's declared intent, asserted: same inputs in, no re-evaluation.
    expect(probe.displayNameCalls).toBe(callsAtRest);
  });

  it('holds the whole downstream cascade — `initialViewState` keeps its identity', async () => {
    const schema = baseSchema({ titleField: 'name' });

    const { rerender } = render(<ObjectMap schema={schema} />);
    await settle();

    const cameraAtRest = lastCamera();
    expect(cameraAtRest).toBeDefined();

    rerender(<ObjectMap schema={schema} />);

    // `markers` → `filteredMarkers` → `markerBounds` → `initialViewState`:
    // a fresh `mapConfig` invalidates every link, so this identity is a read
    // of the entire chain.
    expect(lastCamera()).toBe(cameraAtRest);
  });

  it('holds the marker memo across a state-driven re-render (search typing)', async () => {
    const schema = baseSchema({ titleField: 'name' });

    render(<ObjectMap schema={schema} />);
    await settle();

    const callsAtRest = probe.displayNameCalls;

    // A re-render this component causes ITSELF — the dominant case, and the
    // one where the `schema` prop identity is unchanged by construction.
    fireEvent.change(screen.getByPlaceholderText('Search locations…'), {
      target: { value: 'Harbour' },
    });
    await waitFor(() => expect(screen.getAllByTestId('map-marker')).toHaveLength(1));

    // `filteredMarkers` legitimately re-runs on the query; `markers` must not.
    expect(probe.displayNameCalls).toBe(callsAtRest);
  });

  // ---------------------------------------------------------------------
  // Counter-probes: the identity MUST change when the schema genuinely does.
  // Without these, "stable identity" is satisfiable by a frozen stale config.
  // ---------------------------------------------------------------------

  it('re-resolves marker titles when the declared `titleField` changes', async () => {
    const { rerender } = render(<ObjectMap schema={baseSchema({ titleField: 'name' })} />);
    await settle();

    fireEvent.click(screen.getAllByTestId('map-marker')[0]);
    expect(screen.getByTestId('map-popup').textContent).toContain('Harbour Depot');

    const callsBefore = probe.displayNameCalls;

    rerender(<ObjectMap schema={baseSchema({ titleField: 'code' })} />);
    await waitFor(() => expect(screen.getAllByTestId('map-marker')).toHaveLength(2));

    // Recomputed, and visibly so: the new binding reached the rendered title.
    expect(probe.displayNameCalls).toBeGreaterThan(callsBefore);
    await waitFor(() =>
      expect(screen.getByTestId('map-popup').textContent).toContain('HD-01'),
    );
  });

  it('rebuilds the camera when the declared centre/zoom changes', async () => {
    const { rerender } = render(<ObjectMap schema={baseSchema({ titleField: 'name' })} />);
    await settle();

    const cameraBefore = lastCamera() as Record<string, unknown>;

    rerender(<ObjectMap schema={baseSchema({ titleField: 'name', center: [10, 20], zoom: 7 })} />);
    await waitFor(() => expect(screen.getAllByTestId('map-marker')).toHaveLength(2));

    const cameraAfter = lastCamera() as Record<string, unknown>;
    expect(cameraAfter).not.toBe(cameraBefore);
    expect(cameraAfter).toMatchObject({ latitude: 10, longitude: 20, zoom: 7 });
  });
});
