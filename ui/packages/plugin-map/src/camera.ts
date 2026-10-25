/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Initial-camera derivation for ObjectMap (objectui#4941).
 *
 * A map view whose query returned records must never first-paint an empty
 * viewport. The camera is therefore derived from the records themselves: the
 * marker set's bounding box, handed to MapLibre so it fits the box with the
 * real container size (`initialViewState.bounds` -> the `bounds` /
 * `fitBoundsOptions` pair on the MapLibre `Map` constructor, which overrides
 * `center` / `zoom`).
 *
 * Two things this module deliberately does NOT do:
 *
 * 1. It does not rescue out-of-range record coordinates. The platform's
 *    `location` value is `{ lat, lng }` with longitude bounded to [-180, 180]
 *    by `@objectstack/spec` (`data/field-value.zod.ts`), so a longitude outside
 *    that range is a producer-side defect, not a dialect this renderer should
 *    learn to read. `ObjectMap` keeps rejecting such records and counting them
 *    in its "invalid coordinates" notice. The normalization here is projection
 *    arithmetic over already-valid values, applied to the CAMERA only.
 * 2. It does not introduce any authoring surface. The only camera declaration
 *    read anywhere is the documented `zoom` / `center` pair of the map config
 *    block (`content/docs/plugins/plugin-map.mdx`), and an author who declares
 *    it keeps winning over everything computed here.
 */

/**
 * `[[west, south], [east, north]]` — the two-corner form MapLibre accepts as
 * `LngLatBoundsLike`. `east` may exceed 180: that is how MapLibre expects a box
 * crossing the antimeridian to be spelled (its own `adjustAntiMeridian` produces
 * exactly this shape), and it is what keeps the fitted camera on the same world
 * copy as the markers.
 */
export type MarkerBounds = [[number, number], [number, number]];

/** Breathing room around the fitted box, in pixels. */
export const FIT_PADDING_PX = 48;

/**
 * Ceiling for the fitted zoom. A single record — or several records at one
 * address — fits a zero-width box, and an unbounded fit answers that with the
 * map's maximum zoom (22): a building-level view of a style whose tiles usually
 * stop far short of it. City scale is the useful answer instead.
 */
export const FIT_MAX_ZOOM = 12;

/** Zoom used when there is nothing to fit: the whole world, not a random sea. */
export const EMPTY_VIEW_ZOOM = 2;

/**
 * Zoom used when a partially declared camera pins the position but not the
 * scale, so the box cannot drive the fit. Same value the component used before
 * the fit existed.
 */
export const UNFITTED_CENTER_ZOOM = 3;

/**
 * Latitude ceiling for the fitted box. Web Mercator is unbounded at the poles,
 * so a record sitting exactly at +/-90 projects to infinity and takes the whole
 * camera with it. Markers themselves stay at their real latitude.
 */
export const MAX_FIT_LATITUDE = 85;

/**
 * Fold any longitude onto the [-180, 180) circle.
 *
 * In-range values return unchanged rather than through the modulo, which would
 * round-trip them into a neighbouring float (-74.006 came back as
 * -74.00599999999997) and put that drift into every fitted box.
 */
export function normalizeLongitude(lng: number): number {
  if (lng >= -180 && lng < 180) return lng;
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

const clampLatitude = (lat: number): number =>
  Math.min(MAX_FIT_LATITUDE, Math.max(-MAX_FIT_LATITUDE, lat));

/**
 * Bounding box of a marker set, along the SHORTEST arc that contains every
 * marker.
 *
 * Why the shortest arc and not `[min(lng), max(lng)]`: the naive extremes read
 * the circle as a line, so a set straddling the antimeridian (say 179 and -179,
 * two degrees apart) yields a 358-degree-wide box whose midpoint is 0 — the
 * antipode of the data, half a planet away. MapLibre then places the markers in
 * whichever world copy is nearest their previous screen position (`smartWrap`),
 * which is how a fitted-looking camera ends up showing an empty ocean with the
 * records sitting on a neighbouring copy of the world.
 *
 * The widest EMPTY gap between adjacent longitudes is the seam to cut; what
 * remains is the shortest containing arc. `west` is the first marker east of
 * that seam, and the span is measured eastward from it, so the box may extend
 * past 180.
 *
 * @param coordinates marker coordinates in MapLibre order, `[lng, lat]`
 * @returns the box, or `null` when there is nothing to fit
 */
export function computeMarkerBounds(
  coordinates: ReadonlyArray<readonly [number, number]>,
): MarkerBounds | null {
  if (coordinates.length === 0) return null;

  const lngs = coordinates.map(([lng]) => normalizeLongitude(lng)).sort((a, b) => a - b);
  const lats = coordinates.map(([, lat]) => clampLatitude(lat));

  const count = lngs.length;
  // Start from the seam that closes the circle (last -> first), then look for a
  // wider gap between neighbours.
  let widestGap = lngs[0] + 360 - lngs[count - 1];
  let firstAfterGap = 0;
  for (let i = 1; i < count; i++) {
    const gap = lngs[i] - lngs[i - 1];
    if (gap > widestGap) {
      widestGap = gap;
      firstAfterGap = i;
    }
  }

  // Both edges are marker longitudes, so the box carries the data's own values
  // instead of a sum of spans. The eastern edge is shifted a full turn only when
  // the arc runs over the antimeridian.
  const west = lngs[firstAfterGap];
  const easternmost = lngs[(firstAfterGap + count - 1) % count];
  const east = firstAfterGap === 0 ? easternmost : easternmost + 360;

  return [
    [west, Math.min(...lats)],
    [east, Math.max(...lats)],
  ];
}

/**
 * Centre of a box from {@link computeMarkerBounds}, for the paths that cannot
 * hand the box to a fit (a declared zoom with no declared centre). The
 * longitude is folded back onto the circle so a box crossing the antimeridian
 * still yields a real centre rather than a value past 180.
 */
export function boundsCenter(bounds: MarkerBounds): { longitude: number; latitude: number } {
  const [[west, south], [east, north]] = bounds;
  return {
    longitude: normalizeLongitude((west + east) / 2),
    latitude: (south + north) / 2,
  };
}
