/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * Regression (objectui#4941): the initial camera of a map view with records was
 * never derived from those records — the zoom came from a synthesized default
 * and the centre from the naive longitude extremes, so a view with data could
 * first-paint an empty viewport. These pin the derivation itself; the component
 * wiring is pinned in `ObjectMap.camera.test.tsx`.
 */
import { describe, it, expect } from 'vitest';
import {
  computeMarkerBounds,
  boundsCenter,
  normalizeLongitude,
  MAX_FIT_LATITUDE,
} from './camera';

describe('normalizeLongitude', () => {
  it('leaves in-range longitudes untouched', () => {
    expect(normalizeLongitude(0)).toBe(0);
    expect(normalizeLongitude(-122.3321)).toBeCloseTo(-122.3321, 10);
    expect(normalizeLongitude(179.5)).toBeCloseTo(179.5, 10);
  });

  it('folds wrapped longitudes back onto the circle', () => {
    expect(normalizeLongitude(190)).toBeCloseTo(-170, 10);
    expect(normalizeLongitude(-190)).toBeCloseTo(170, 10);
    expect(normalizeLongitude(540)).toBeCloseTo(180 - 360, 10);
    expect(normalizeLongitude(180)).toBe(-180);
  });
});

describe('computeMarkerBounds', () => {
  it('returns null for an empty record set — nothing to fit', () => {
    expect(computeMarkerBounds([])).toBeNull();
  });

  it('fits a continent-wide set to its own extent', () => {
    // The showcase `task` seed: US cities, [lng, lat] as markers carry them.
    const bounds = computeMarkerBounds([
      [-122.3321, 47.6062], // Seattle
      [-122.4194, 37.7749], // San Francisco
      [-74.006, 40.7128], // New York
      [-97.7431, 30.2672], // Austin
      [-71.0589, 42.3601], // Boston
    ]);

    expect(bounds).not.toBeNull();
    const [[west, south], [east, north]] = bounds!;
    expect(west).toBeCloseTo(-122.4194, 6);
    expect(east).toBeCloseTo(-71.0589, 6);
    expect(south).toBeCloseTo(30.2672, 6);
    expect(north).toBeCloseTo(47.6062, 6);

    // The box is the data's own extent, so its centre is inside it — not the
    // fabricated zoom-10 origin the component used to open on.
    const { longitude, latitude } = boundsCenter(bounds!);
    expect(longitude).toBeGreaterThan(west);
    expect(longitude).toBeLessThan(east);
    expect(latitude).toBeGreaterThan(south);
    expect(latitude).toBeLessThan(north);
  });

  it('takes the SHORT arc across the antimeridian, not the naive extremes', () => {
    // Two markers two degrees apart, straddling 180. Naive min/max longitude
    // would describe a 358-degree box centred on 0 — the antipode of the data,
    // which is how markers end up on a neighbouring world copy.
    const bounds = computeMarkerBounds([
      [179, -16], // Fiji side
      [-179, -18], // just east of the line
    ]);

    const [[west, south], [east, north]] = bounds!;
    expect(west).toBeCloseTo(179, 6);
    expect(east).toBeCloseTo(181, 6); // past 180 on purpose: MapLibre's own spelling
    expect(east - west).toBeCloseTo(2, 6);
    expect(south).toBeCloseTo(-18, 6);
    expect(north).toBeCloseTo(-16, 6);

    // ...and the centre lands ON the data, folded back onto the circle.
    expect(boundsCenter(bounds!).longitude).toBeCloseTo(-180, 6);
  });

  it('keeps a genuinely global set on the long span', () => {
    // Nothing to shorten here: the widest empty gap is the 120 degrees between
    // 120 and -120, so the box spans the other 240.
    const bounds = computeMarkerBounds([
      [-120, 0],
      [0, 10],
      [120, -10],
    ]);

    const [[west], [east]] = bounds!;
    expect(west).toBeCloseTo(-120, 6);
    expect(east).toBeCloseTo(120, 6);
  });

  it('yields a degenerate box for a single record', () => {
    // Zero-width: the fit's maxZoom is what stops this becoming a rooftop view.
    const bounds = computeMarkerBounds([[-122.4194, 37.7749]]);
    expect(bounds).toEqual([
      [-122.4194, 37.7749],
      [-122.4194, 37.7749],
    ]);
    expect(boundsCenter(bounds!)).toEqual({ longitude: -122.4194, latitude: 37.7749 });
  });

  it('yields a degenerate box when several records share one address', () => {
    const bounds = computeMarkerBounds([
      [8.5417, 47.3769],
      [8.5417, 47.3769],
      [8.5417, 47.3769],
    ]);
    expect(bounds).toEqual([
      [8.5417, 47.3769],
      [8.5417, 47.3769],
    ]);
  });

  it('folds an out-of-range longitude onto the circle for the camera only', () => {
    // `ObjectMap` rejects such a record before it can become a marker (the
    // platform bounds longitude to [-180, 180]); this pins the arithmetic, not
    // an intake path.
    const bounds = computeMarkerBounds([
      [190, 10],
      [-170, 12],
    ]);
    const [[west], [east]] = bounds!;
    expect(west).toBeCloseTo(-170, 6);
    expect(east).toBeCloseTo(-170, 6);
  });

  it('clamps the box to the Mercator-safe latitude band', () => {
    const bounds = computeMarkerBounds([
      [10, 89.9],
      [12, -89.9],
    ]);
    const [[, south], [, north]] = bounds!;
    expect(south).toBe(-MAX_FIT_LATITUDE);
    expect(north).toBe(MAX_FIT_LATITUDE);
  });
});
