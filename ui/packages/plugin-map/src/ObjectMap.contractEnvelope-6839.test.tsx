/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ObjectMap` reads its `find()` answer as `QueryResult` DECLARES it — and does
 * NOT read `records` (objectui#6839).
 *
 * ⭐ This module reaches the shared reader INDIRECTLY: it does not call
 * `extractRecords` at all, it hands its `find()` answer to
 * `applyNonGridRowCeiling` (`@object-ui/react`), which unwraps it. A card
 * enumerating the helper's direct callers would not list this file, and a
 * repo-wide "nothing reads `records`" assertion would pass over it in silence.
 * The route is what is measured here, at the markers.
 *
 * ⚠️ `enableClustering={false}` is load-bearing, for the same reason
 * `ObjectMap.rowCeiling-7210.test.tsx` gives: the map clusters above 100
 * markers, and a cluster bubble is a marker count folded into one DOM node.
 * With clustering on, "two markers" and "no markers" are not reliably
 * different pictures. Clustering is a pure function of the marker array, so
 * turning it off changes what is on screen, never what reached the view.
 *
 * MEASURED for this module: no `find()` in `plugin-map`, nor in any app or
 * example mounting a map, emits a `records` envelope — the package's four
 * `records:` occurrences are two doc comments and two `mockResolvedValue(records)`
 * calls whose `records` is a local BARE ARRAY, not an envelope key. CONTROL, so
 * the zero is a reading: the same sweep finds a live `find()` double emitting
 * `{ records: [...] }` at `plugin-list`'s ObjectGallery.
 *
 * ⚠️ The refusal case is ALSO satisfied by an `extractRecords` that returns
 * `[]` for everything — an implementation strictly worse than the bug. The
 * `data` and bare-array cases refuse it: same rows, same mount.
 *
 * ## The two things this file's wait used to STAND ON without saying so (objectui#8709)
 *
 * This is the family's only ABSENCE-shaped wait, and an absence carries two
 * unstated preconditions. Both are now assertions in `markersThrough`, and both
 * were measured failing first:
 *
 *   1. **The panel was ever on screen.** An absence nothing entered is
 *      satisfied by a mount that never started. With the component mutated to
 *      `return null` unconditionally the refusal case PASSED — "render nothing,
 *      ever" is strictly worse than the bug and cleared the old bar.
 *   2. **`setData` and `setLoading(false)` commit TOGETHER.** The panel is a
 *      settle signal, not a rows signal; it is only a usable proxy for "the
 *      rows are on screen" because the two `setState` calls land in one commit.
 *      With `setData` deferred by 50ms and the `records` arm restored to
 *      `extractRecords`, the refusal case read zero markers and PASSED while
 *      the settled map plotted two.
 *
 * ⭐ Neither gate subsumes the other: (1) alone still lets a split commit
 * through, and (2) alone still passes a component that renders nothing.
 */

import React from 'react';
import { act, render, screen, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

// The MapLibre canvas, replaced by DOM the test can count. Copied from
// `ObjectMap.configMemo.test.tsx`, which is where this package's map double
// lives; `Marker` is the node the marker array actually produces.
vi.mock('react-map-gl/maplibre', () => {
  const MapImpl = ({ children }: any) => <div aria-label="Map">{children}</div>;
  return {
    default: MapImpl,
    Map: MapImpl,
    NavigationControl: () => <div data-testid="nav-control" />,
    Marker: ({ children, longitude, latitude }: any) => (
      <div data-testid="map-marker" data-lat={latitude} data-lng={longitude}>
        {children}
      </div>
    ),
    Popup: ({ children }: any) => <div data-testid="map-popup">{children}</div>,
  };
});

import { ObjectMap } from './ObjectMap';
import './__tests__/webgl2Available';

const ROWS = [
  { id: '1', name: 'Harbour Depot', latitude: 47.6062, longitude: -122.3321 },
  { id: '2', name: 'Ridge Yard', latitude: 37.7749, longitude: -122.4194 },
];

const schema: any = {
  type: 'map',
  objectName: 'store',
  map: { latitudeField: 'latitude', longitudeField: 'longitude', titleField: 'name' },
  data: { provider: 'object', object: 'store' },
};

/**
 * The window held open AFTER the loading panel clears, to prove no markers
 * arrive behind it.
 *
 * ⚠️ 50ms, not 0ms. RTL's `asyncWrapper` drains one macrotask before it
 * returns, so a commit scheduled with `setTimeout(…, 0)` lands INSIDE that
 * drain window — a 0ms window cannot tell a deferred commit from a
 * same-commit one, and reports "stable" for both (measured on objectui#8664).
 */
const POST_SETTLE_MS = 50;

/** How one case wraps its rows on the way back out of `find()`. */
type Envelope = (rows: unknown[]) => unknown;

const asData: Envelope = (rows) => ({ data: rows, total: rows.length });
const asBareArray: Envelope = (rows) => rows;
const asRecords: Envelope = (rows) => ({ records: rows, total: rows.length });

/**
 * Mount the map over a `find()` answering `envelope`, return markers plotted.
 *
 * ⛔ Call ONCE per case, never inside a `waitFor` predicate (objectui#7802):
 * it renders, and `waitFor` re-runs its callback on DOM mutations, so a
 * predicate that renders feeds itself and leaks a container div per run.
 */
async function markersThrough(envelope: Envelope): Promise<number> {
  const find = vi.fn(async () => envelope(ROWS));
  const ds: any = {
    find,
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => ({
      name: 'store',
      fields: {
        id: { name: 'id', type: 'text' },
        name: { name: 'name', type: 'text' },
        latitude: { name: 'latitude', type: 'number' },
        longitude: { name: 'longitude', type: 'number' },
      },
    })),
  };
  render(<ObjectMap schema={schema} dataSource={ds} enableClustering={false} />);
  // ① The transition's START, observed — the half an ABSENCE-shaped wait cannot
  // supply for itself. "The panel has cleared" and "nothing was ever rendered"
  // are the SAME DOM, so without this line the wait below is satisfied by a
  // mount that never started. MEASURED, not argued: with `ObjectMap` mutated to
  // `return null` unconditionally — an implementation strictly worse than the
  // bug — the refusal case below still PASSED (objectui#8709 leg B). It does
  // not survive this line.
  expect(
    screen.getByText('Loading map...'),
    'the loading panel must be on screen BEFORE the absence wait — an absence nothing entered is satisfied by never having started',
  ).toBeInTheDocument();
  await waitFor(() => expect(find).toHaveBeenCalled());
  // `find`'s OWN answer, settled — a pure read of the mock's call record that
  // touches no DOM. Without it "no markers" is satisfied by the mount's
  // initial empty state, which every arm renders identically.
  await find.mock.results[0].value;
  // The loading panel clears on EVERY arm, refused or not — a settle signal
  // rather than a rows signal, which is exactly what makes it usable as the
  // one wait shared by the live cases and the refusal case.
  await waitFor(() => expect(screen.queryByText('Loading map...')).toBeNull());
  const atPanelClear = screen.queryAllByTestId('map-marker').length;
  // ② The unstated precondition the line above STANDS ON, now pinned:
  // `setData(capped.rows)` and `setLoading(false)` reach the DOM in ONE commit.
  // React 18 batches them today because they sit in one `await` continuation —
  // true, load-bearing, and asserted by nothing else in this repo. The day they
  // split (a transition, an async boundary, a `startTransition`) the panel
  // clears over an EMPTY `data` and the count read above is the INTERMEDIATE
  // state. MEASURED: with `setData` deferred by 50ms and the `records` arm
  // restored to `extractRecords`, the refusal case read zero markers and PASSED
  // while the settled map plotted two — the bug went undetected (leg A).
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, POST_SETTLE_MS));
  });
  // A dependency landing mid-window (`objectSchema`, `perms`) re-runs the fetch
  // effect and re-raises the panel, so re-settle before re-reading: the claim is
  // about the SETTLED count, not about a moment inside a refetch.
  await waitFor(() => expect(screen.queryByText('Loading map...')).toBeNull());
  const settled = screen.queryAllByTestId('map-marker').length;
  expect(
    settled,
    'markers must not arrive AFTER the loading panel clears — the count read at the transition must already be the settled one',
  ).toBe(atPanelClear);
  return settled;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ObjectMap — the find() envelope it reads (objectui#6839)', () => {
  it("still reads the contract's `data` member", async () => {
    expect(await markersThrough(asData), 'the declared rows member must still plot').toBe(2);
  });

  it('still reads a bare array — the live non-envelope shape fakes answer with', async () => {
    expect(await markersThrough(asBareArray), 'the bare-array arm must still plot').toBe(2);
  });

  it('does NOT read `records` — not a QueryResult member', async () => {
    // Before the fix these two sites plotted off a key `QueryResult` does not
    // declare, and did so AHEAD of `data`.
    expect(
      await markersThrough(asRecords),
      'a `records` envelope must reach the map as zero markers, not as the sites it names',
    ).toBe(0);
  });
});
