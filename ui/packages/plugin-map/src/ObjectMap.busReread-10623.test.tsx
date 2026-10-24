/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10623, round 2 — how `ObjectMap`'s fetch effect answers a
 * data-invalidation re-read, measured against the `ObjectGantt` precedent
 * (`reloadSeqRef` / `isCurrent()`, the objectui#7237 silent mode, the
 * objectui#10578 error clear).
 *
 *   A. A run is silent only when the bus moved AND the query is the one whose
 *      rows are on screen. A query change that lands in the same commit as a
 *      bus event still goes through the loading gate, so the camera re-fits.
 *   B. Only the newest run may commit rows, an error or the loading flag. A
 *      slow older answer can't overwrite a newer one.
 *   C. A silent run that fails keeps the last good rows and the mounted map,
 *      and logs the failure — what `ObjectGantt`'s silent reload does.
 *   D. A run that commits rows clears an earlier error.
 *
 * Plus the control: a plain query change, with no bus event, re-fits.
 *
 * "Re-fits" is read the only way this component can do it. `initialViewState`
 * is read by `MapGL` once, at mount, and the loading gate unmounts `MapGL`, so a
 * re-fit is a NEW map node mounted with the new records' bounds. The stub below
 * records the camera each map mounts with.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup, screen, waitFor } from '@testing-library/react';
import { notifyDataChanged } from '@object-ui/react';
import { ObjectMap } from './ObjectMap';
import './__tests__/webgl2Available';

/** The camera each `MapGL` mount was handed, in mount order. */
let mountedCameras: any[] = [];

// No WebGL in the test env. The stub records `initialViewState` once per MOUNT
// (a ref, so a re-render of the same map adds nothing).
vi.mock('react-map-gl/maplibre', () => ({
  default: function MapStub(props: any) {
    const seen = React.useRef(false);
    if (!seen.current) {
      seen.current = true;
      mountedCameras.push(props.initialViewState);
    }
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

type Row = { id: string; name: string; lat: number; lng: number };

const NORTH = [['zone', '=', 'north']];
const SOUTH = [['zone', '=', 'south']];
const EAST = [['zone', '=', 'east']];

const ROWS: Record<string, Row[]> = {
  north: [{ id: 'n1', name: 'Oslo', lat: 59.9, lng: 10.7 }],
  south: [{ id: 's1', name: 'Cape Town', lat: -33.9, lng: 18.4 }],
  east: [{ id: 'e1', name: 'Tokyo', lat: 35.7, lng: 139.7 }],
};

const zoneOf = (filter: unknown) => (JSON.stringify(filter).match(/north|south|east/) ?? ['north'])[0];

/**
 * A data source whose answer per zone can be HELD. `hold(zone)` makes the next
 * `find` for that zone wait until `release(zone)` or `fail(zone)`.
 */
function makeDataSource() {
  type Gate = { promise: Promise<void>; resolve: () => void; reject: (e: Error) => void };
  /** Gates the next `find` per zone will wait on (consumed by that call). */
  const holds = new Map<string, Gate>();
  /** Every gate ever set, so a test can release one after `find` consumed it. */
  const controls = new Map<string, Gate>();
  let failNextFor: string | null = null;
  return {
    hold(zone: string) {
      let resolve!: () => void;
      let reject!: (e: Error) => void;
      const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
      holds.set(zone, { promise, resolve, reject });
      controls.set(zone, { promise, resolve, reject });
    },
    release(zone: string) { controls.get(zone)!.resolve(); },
    fail(zone: string) { controls.get(zone)!.reject(new Error(`the ${zone} query failed`)); },
    failNext(zone: string) { failNextFor = zone; },
    find: vi.fn(async (_object: string, q: any) => {
      const zone = zoneOf(q?.$filter);
      const held = holds.get(zone);
      if (held) {
        holds.delete(zone);
        await held.promise;
      }
      if (failNextFor === zone) {
        failNextFor = null;
        throw new Error(`the ${zone} query failed`);
      }
      return { data: ROWS[zone], total: ROWS[zone].length };
    }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => ({
      name: 'store',
      fields: { name: { type: 'text' }, lat: { type: 'number' }, lng: { type: 'number' } },
    })),
  };
}

const MAP = { latitudeField: 'lat', longitudeField: 'lng', titleField: 'name' };

type HostHandle = { setFilter: (f: unknown) => void };

/** Holds the map's `filter` as state, so a test can change the query in one commit. */
const Host = React.forwardRef<HostHandle, { ds: ReturnType<typeof makeDataSource> }>(function Host({ ds }, ref) {
  const [filter, set] = React.useState<unknown>(NORTH);
  React.useImperativeHandle(ref, () => ({ setFilter: set }), []);
  const schema = React.useMemo(() => ({ type: 'object-map', objectName: 'store', map: MAP, filter }), [filter]);
  return <ObjectMap schema={schema as any} dataSource={ds as any} />;
});

const host = React.createRef<HostHandle>();
const setFilter = (f: unknown) => host.current!.setFilter(f);

const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 100)));

const markerLats = () => screen.queryAllByTestId('map-marker').map((m) => Number(m.getAttribute('data-lat')));

/** The latitude the camera of the NEWEST map mount was fitted to (single-record bounds). */
const lastFittedLat = () => mountedCameras[mountedCameras.length - 1]?.bounds?.[0]?.[1];

async function mountSettled(ds: ReturnType<typeof makeDataSource>) {
  render(<Host ref={host} ds={ds} />);
  await waitFor(() => expect(markerLats()).toEqual([59.9]));
  await settle();
  return screen.getByLabelText('Map');
}

beforeEach(() => {
  mountedCameras = [];
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '{}' })));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  cleanup();
});

describe('object-map: a query change re-fits the camera (control, objectui#10623)', () => {
  it('a plain query change goes through the loading gate and mounts a map fitted to the new rows', async () => {
    const ds = makeDataSource();
    const before = await mountSettled(ds);

    await act(async () => { setFilter(SOUTH); });
    await waitFor(() => expect(markerLats()).toEqual([-33.9]));

    expect(screen.getByLabelText('Map'), 'a changed query kept the old map, so it did not re-fit').not.toBe(before);
    expect(lastFittedLat()).toBe(-33.9);
  });
});

describe('object-map: A, a run is silent only for a bus-only re-read (objectui#10623)', () => {
  it('a query change landing in the same commit as a bus event still re-fits', async () => {
    const ds = makeDataSource();
    const before = await mountSettled(ds);

    await act(async () => {
      setFilter(SOUTH);
      notifyDataChanged({ objectName: 'store' });
    });
    await waitFor(() => expect(markerLats()).toEqual([-33.9]));

    expect(screen.getByLabelText('Map'), 'the bus event made a changed query silent, so the map kept the old camera').not.toBe(before);
    expect(lastFittedLat()).toBe(-33.9);
  });
});

describe('object-map: B, only the newest run commits (objectui#10623)', () => {
  it('a slow older answer does not overwrite a newer one', async () => {
    const ds = makeDataSource();
    await mountSettled(ds);

    ds.hold('south');
    await act(async () => { setFilter(SOUTH); });
    await act(async () => { setFilter(EAST); });
    await waitFor(() => expect(markerLats()).toEqual([35.7]));

    await act(async () => { ds.release('south'); });
    await settle();

    expect(markerLats(), 'the superseded south answer overwrote the east rows').toEqual([35.7]);
  });

  it('a slow older failure does not put the map on its error screen', async () => {
    const ds = makeDataSource();
    await mountSettled(ds);

    ds.hold('south');
    await act(async () => { setFilter(SOUTH); });
    await act(async () => { setFilter(EAST); });
    await waitFor(() => expect(markerLats()).toEqual([35.7]));

    await act(async () => { ds.fail('south'); });
    await settle();

    expect(screen.queryByText(/Error:/), 'a superseded failure replaced the current rows').toBeNull();
    expect(markerLats()).toEqual([35.7]);
  });

  it('a superseded answer does not release the loading gate while the newest query is in flight', async () => {
    const ds = makeDataSource();
    await mountSettled(ds);

    ds.hold('south');
    ds.hold('east');
    await act(async () => { setFilter(SOUTH); });
    await act(async () => { setFilter(EAST); });

    await act(async () => { ds.release('south'); });
    await settle();
    expect(screen.queryByText('Loading map...'), 'the superseded run cleared the loading gate').not.toBeNull();
    expect(markerLats()).toEqual([]);

    await act(async () => { ds.release('east'); });
    await waitFor(() => expect(markerLats()).toEqual([35.7]));
  });
});

describe('object-map: C, a failed silent re-read keeps the map (objectui#10623)', () => {
  it('keeps the last good rows and the same map node, and logs the failure', async () => {
    const ds = makeDataSource();
    const before = await mountSettled(ds);
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    ds.failNext('north');
    await act(async () => { notifyDataChanged({ objectName: 'store' }); });
    await settle();

    expect(screen.queryByText(/Error:/), 'a failed bus re-read put the map on its error screen').toBeNull();
    expect(screen.getByLabelText('Map'), 'a failed bus re-read unmounted the map').toBe(before);
    expect(markerLats()).toEqual([59.9]);
    expect(logged.mock.calls.some((c) => String(c[0]).includes('[ObjectMap] Failed to refresh data'))).toBe(true);
  });
});

describe('object-map: D, committed rows clear an earlier error (objectui#10623)', () => {
  it('a later query that succeeds takes the map off its error screen', async () => {
    const ds = makeDataSource();
    await mountSettled(ds);

    ds.failNext('south');
    await act(async () => { setFilter(SOUTH); });
    await waitFor(() => expect(screen.queryByText(/Error:/)).not.toBeNull());

    await act(async () => { setFilter(EAST); });
    await settle();

    expect(screen.queryByText(/Error:/), 'the map stayed on the error screen after a query succeeded').toBeNull();
    expect(markerLats()).toEqual([35.7]);
  });

  it('a bus re-read after a reported failure retries through the gate and clears the error', async () => {
    const ds = makeDataSource();
    await mountSettled(ds);

    ds.failNext('south');
    await act(async () => { setFilter(SOUTH); });
    await waitFor(() => expect(screen.queryByText(/Error:/)).not.toBeNull());

    await act(async () => { notifyDataChanged({ objectName: 'store' }); });
    await settle();

    expect(screen.queryByText(/Error:/), 'the map stayed on the error screen after the re-read succeeded').toBeNull();
    expect(markerLats()).toEqual([-33.9]);
    expect(lastFittedLat()).toBe(-33.9);
  });
});
