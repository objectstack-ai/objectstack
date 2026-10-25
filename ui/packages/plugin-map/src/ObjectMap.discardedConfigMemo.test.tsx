/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6592 — the fetch effects must not read `dataConfig`'s OBJECT
 * IDENTITY, because `useMemo` carries no semantic guarantee.
 *
 * `ObjectMap.dataConfigMemo.test.tsx` (objectui#6018) pins that `dataConfig`
 * does not get a fresh identity on an UNCHANGED `schema` reference. That is
 * a real and necessary property, but it is not what this card is about:
 * React is permitted to discard a `useMemo` cache and recompute it even when
 * its dependency array compares equal to the previous render — the deps
 * array only decides whether the FACTORY reruns, never whether the cache is
 * kept. So "same `schema` in ⇒ same `dataConfig` out" is not guaranteed to
 * hold across a discard, and a fetch effect keyed on `dataConfig` itself
 * would refetch on every discard even though nothing an author or caller
 * controls changed.
 *
 * There is no public API to force React's internal memo-discard path, so
 * this file drives the same failure mode the discard hazard produces: a
 * `dataConfig` recompute that yields a NEW object reference carrying the
 * SAME primitive fields (`provider`, `object`). `getDataConfig(schema)`
 * builds a fresh `{ provider, object }` / `{ provider, items }` wrapper on
 * every call — so any recompute (whether from a discard or, as here, from
 * `schema` itself getting a new but value-equal reference) produces exactly
 * this shape of "different identity, same content" `dataConfig`. From the
 * fetch effect's perspective the two triggers are indistinguishable: what
 * matters is whether ITS dependency array reacts to the identity change or
 * only to the primitives.
 *
 * Before objectui#6592 both effects listed bare `dataConfig` and re-fired
 * (extra `dataSource.find` / `dataSource.getObjectSchema` calls, pinned RED
 * against pre-fix source further below). After it, they list
 * `dataProvider` / `dataObjectName` / `dataItems` and do not.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('react-map-gl/maplibre', () => ({
  default: ({ children }: any) => <div aria-label="Map">{children}</div>,
  Map: ({ children }: any) => <div aria-label="Map">{children}</div>,
  NavigationControl: () => <div data-testid="nav-control" />,
  Marker: ({ children, longitude, latitude }: any) => (
    <div data-testid="map-marker" data-lat={latitude} data-lng={longitude}>
      {children}
    </div>
  ),
  Popup: ({ children }: any) => <div data-testid="map-popup">{children}</div>,
}));

import { ObjectMap } from './ObjectMap';
import './__tests__/webgl2Available';

const MAP = { latitudeField: 'latitude', longitudeField: 'longitude', titleField: 'name' };

const ROWS = [
  { id: '1', name: 'Harbour Depot', latitude: 47.6062, longitude: -122.3321 },
  { id: '2', name: 'Ridge Yard', latitude: 37.7749, longitude: -122.4194 },
];

function makeAdapter() {
  return {
    find: vi.fn().mockResolvedValue({ data: ROWS }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue({
      name: 'store',
      fields: { name: { type: 'text' } },
    }),
  };
}

const settle = async (adapter: ReturnType<typeof makeAdapter>) => {
  await waitFor(() => expect(screen.queryByText('Loading map...')).toBeNull());
  await waitFor(() => expect(screen.getAllByTestId('map-marker')).toHaveLength(2));
  await waitFor(() => expect(adapter.getObjectSchema).toHaveBeenCalled());
  const seen = adapter.find.mock.calls.length;
  await new Promise((r) => setTimeout(r, 0));
  expect(adapter.find.mock.calls.length).toBe(seen);
};

describe('ObjectMap — fetch effects survive a discarded `dataConfig` memo (objectui#6592)', () => {
  it('does not re-fire either fetch effect when `schema` gets a new reference with the SAME primitive fields', async () => {
    const adapter = makeAdapter();

    // Two DIFFERENT object literals — new reference each — with identical
    // `objectName`/`map` content. `dataConfig = useMemo(() => getDataConfig(schema), [schema])`
    // sees `schema` change (Object.is fails) and calls `getDataConfig` again,
    // which returns a brand-new `{ provider: 'object', object: 'store' }`
    // wrapper: the same failure shape a discarded-and-recomputed cache would
    // produce with schema held constant.
    const schemaA: any = { type: 'object-map', map: MAP, objectName: 'store' };
    const schemaB: any = { type: 'object-map', map: MAP, objectName: 'store' };
    expect(schemaA).not.toBe(schemaB);
    expect(schemaA).toEqual(schemaB);

    const { rerender } = render(<ObjectMap schema={schemaA} dataSource={adapter as any} />);
    await settle(adapter);

    const findCallsAtRest = adapter.find.mock.calls.length;
    const schemaCallsAtRest = adapter.getObjectSchema.mock.calls.length;
    expect(findCallsAtRest).toBeGreaterThan(0);

    rerender(<ObjectMap schema={schemaB} dataSource={adapter as any} />);
    await new Promise((r) => setTimeout(r, 0));

    // The review question this card is about: neither effect re-fired
    // against the recomputed-but-equivalent `dataConfig`.
    expect(adapter.find.mock.calls.length).toBe(findCallsAtRest);
    expect(adapter.getObjectSchema.mock.calls.length).toBe(schemaCallsAtRest);
  });

  it('still DOES re-fire when the recomputed `dataConfig` carries a genuinely different `object`', async () => {
    // Counter-probe, same purpose as the #6018 file's: "immune to identity
    // churn" must not be satisfiable by "never reacts to real changes either".
    const adapter = makeAdapter();
    const schemaA: any = { type: 'object-map', map: MAP, objectName: 'store' };
    const schemaB: any = { type: 'object-map', map: MAP, objectName: 'warehouse' };

    const { rerender } = render(<ObjectMap schema={schemaA} dataSource={adapter as any} />);
    await settle(adapter);
    expect(adapter.find.mock.calls.map((c) => c[0])).toContain('store');
    const callsBefore = adapter.find.mock.calls.length;

    rerender(<ObjectMap schema={schemaB} dataSource={adapter as any} />);

    await waitFor(() => expect(adapter.find.mock.calls.length).toBeGreaterThan(callsBefore));
    expect(adapter.find.mock.calls.map((c) => c[0])).toContain('warehouse');
  });
});
