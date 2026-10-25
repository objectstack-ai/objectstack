/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6018 — `dataConfig` bought its identity with a per-render serialize.
 *
 * ```ts
 * const rawDataConfig = getDataConfig(schema);          // bare call, every render
 * const dataConfig = useMemo(() => rawDataConfig, [JSON.stringify(rawDataConfig)]);
 * ```
 *
 * `dataConfig` is a dependency of the fetch effect, and that effect calls
 * `setData` — so a fresh identity there is a refetch loop, not merely waste.
 * That hazard is what the deleted "prevent infinite loops" comment recorded,
 * and it is why this file exists: the serialize is only removable if the
 * identity contract it was standing in for survives without it.
 *
 * The replacement is the shape objectui#5976 landed one line below for
 * `mapConfig`: `useMemo(() => getDataConfig(schema), [schema])`. `getDataConfig`
 * is a pure function of `schema` and reads nothing else (it reads exactly
 * `schema.data`, `schema.staticData`, `schema.objectName`), so `[schema]` is the
 * whole dependency rather than a shorthand for one.
 *
 * ## What is asserted, and what is deliberately NOT
 *
 * This is a performance card, so the pin is the IDENTITY CONTRACT, not the
 * timing. Nothing here counts renders as a proxy for speed and nothing measures
 * how long a serialize takes — both are unfalsifiable on a loaded CI box. What
 * is measured is the one observable the contract is about: **how many times the
 * fetch effect fired**, read at the module boundary it crosses (`dataSource.find`).
 *
 * Both directions are pinned, because "stable identity" is equally satisfiable
 * by freezing a stale config forever — a worse bug, and invisible to the
 * stability assertion alone:
 *
 *  - unchanged `schema` in ⇒ the effect does NOT re-fire;
 *  - genuinely changed `schema` in ⇒ it DOES, against the new object.
 *
 * ## Which of these survive a revert (measured, not assumed)
 *
 * The two identity-contract tests pass on the serialize form as well: the
 * stringify key really did buy a stable identity, which is why objectui#6018 is
 * a cost card and not a correctness card. They are regression pins for the
 * replacement, and they are the tests the ruling asked to be verified against —
 * their value is that they FAIL if the memo is ever re-keyed on something
 * render-fresh again (which is the objectui#5976 defect, one line up).
 *
 * The third test is the one that is RED before the fix. `JSON.stringify` is not
 * a total function: it throws on a value it cannot serialize. Sited in the
 * render body, over a config that in the passthrough branch is the author's own
 * `schema.data` object — inline `value` rows included, verbatim — that throw
 * takes down the whole map subtree. A record graph carrying a back-reference
 * (an `$expand`-ed lookup handed to the block as inline data) is the reachable
 * shape; a `BigInt` id from an adapter is a second one. `[schema]` compares
 * identities and never serializes, so the value never has to be serializable at
 * all.
 */

import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
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
      fields: {
        name: { type: 'text' },
        latitude: { type: 'number' },
        longitude: { type: 'number' },
      },
    }),
  };
}

/**
 * Settle to the steady state: the map has painted its markers AND the second
 * effect's `objectSchema` has landed. That second effect writes state which is
 * itself a dependency of the fetch effect, so the resting call count is only
 * meaningful once it has stopped moving.
 */
const settle = async (adapter: ReturnType<typeof makeAdapter>) => {
  await waitFor(() => expect(screen.queryByText('Loading map...')).toBeNull());
  await waitFor(() => expect(screen.getAllByTestId('map-marker')).toHaveLength(2));
  await waitFor(() => expect(adapter.getObjectSchema).toHaveBeenCalled());
  const seen = adapter.find.mock.calls.length;
  await new Promise((r) => setTimeout(r, 0));
  expect(adapter.find.mock.calls.length).toBe(seen);
};

describe('ObjectMap — `dataConfig` identity contract (objectui#6018)', () => {
  it('does not re-fire the fetch effect on a re-render with an unchanged `schema`', async () => {
    const adapter = makeAdapter();
    const schema: any = { type: 'object-map', map: MAP, objectName: 'store' };

    const { rerender } = render(<ObjectMap schema={schema} dataSource={adapter as any} />);
    await settle(adapter);

    const callsAtRest = adapter.find.mock.calls.length;
    expect(callsAtRest).toBeGreaterThan(0);

    // The prop identity is unchanged — which is what every re-render this
    // component causes ITSELF looks like, and what all three upstream callers
    // hand over (a memoized node in each case).
    rerender(<ObjectMap schema={schema} dataSource={adapter as any} className="changed" />);
    await new Promise((r) => setTimeout(r, 0));

    expect(adapter.find.mock.calls.length).toBe(callsAtRest);
  });

  it('does not re-fire the fetch effect on a state-driven re-render (search typing)', async () => {
    const adapter = makeAdapter();
    const schema: any = { type: 'object-map', map: MAP, objectName: 'store' };

    render(<ObjectMap schema={schema} dataSource={adapter as any} />);
    await settle(adapter);

    const callsAtRest = adapter.find.mock.calls.length;

    // The dominant case: a re-render driven by this component's own state, with
    // the `schema` prop untouched by construction. A render-fresh `dataConfig`
    // makes this a refetch — and each refetch's `setData` drives another render.
    fireEvent.change(screen.getByPlaceholderText('Search locations…'), {
      target: { value: 'Harbour' },
    });
    await waitFor(() => expect(screen.getAllByTestId('map-marker')).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 0));

    expect(adapter.find.mock.calls.length).toBe(callsAtRest);
  });

  // ------------------------------------------------------------------
  // Counter-probe. Without it, "stable identity" is satisfiable by never
  // recomputing at all, which is a worse bug than the one being fixed.
  // ------------------------------------------------------------------

  it('DOES re-fire against the new object when `schema` genuinely changes', async () => {
    const adapter = makeAdapter();

    const { rerender } = render(
      <ObjectMap
        schema={{ type: 'object-map', map: MAP, objectName: 'store' } as any}
        dataSource={adapter as any}
      />,
    );
    await settle(adapter);

    expect(adapter.find.mock.calls.map((c) => c[0])).toContain('store');
    const callsBefore = adapter.find.mock.calls.length;

    rerender(
      <ObjectMap
        schema={{ type: 'object-map', map: MAP, objectName: 'warehouse' } as any}
        dataSource={adapter as any}
      />,
    );

    await waitFor(() => {
      expect(adapter.find.mock.calls.length).toBeGreaterThan(callsBefore);
    });
    // Recomputed, and visibly so: the query actually went to the new object.
    expect(adapter.find.mock.calls.map((c) => c[0])).toContain('warehouse');
  });

  // ------------------------------------------------------------------
  // The direction that is RED before the fix.
  // ------------------------------------------------------------------

  it('renders inline data the serializer cannot handle — identity needs no round-trip', async () => {
    // A record carrying a back-reference to its own graph: what an `$expand`-ed
    // lookup looks like once a host hands the resolved rows to the block as
    // inline data. `getDataConfig`'s passthrough branch returns `schema.data`
    // VERBATIM, so a per-render `JSON.stringify` over it runs over these rows —
    // and throws `TypeError: Converting circular structure to JSON` from the
    // render body, taking the whole map subtree down with it.
    const depot: any = { id: '1', name: 'Harbour Depot', latitude: 47.6062, longitude: -122.3321 };
    depot.parent = depot;

    const schema: any = {
      type: 'object-map',
      map: MAP,
      data: { provider: 'value', items: [depot] },
    };

    expect(() => render(<ObjectMap schema={schema} />)).not.toThrow();
    await waitFor(() => expect(screen.getAllByTestId('map-marker')).toHaveLength(1));
  });
});
