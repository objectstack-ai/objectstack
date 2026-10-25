/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `filter` is the query filter — NOT a container for the map's configuration
 * (objectui#4034, source thread objectstack#7138).
 *
 * `getMapConfig` used to probe every filter for a `map` key and, on a hit, use
 * it as the MapConfig (`schema.filter.map` / `schema.filter.map.style`) — a
 * shape that predates the declared `{ name: 'map', type: 'object' }` input. Two
 * readings of `filter` in one block; the declared one is `schema.map`.
 *
 * The probe was written as `'map' in schema.filter`, and `in` walks the
 * PROTOTYPE CHAIN — so for the ordinary array-shaped filter it matched
 * `Array.prototype.map` and handed the component a *function* as its map
 * config. Spreading a function yields `{}`, so the declared `schema.map` was
 * dropped on the floor and every record failed `extractCoordinates`: a map with
 * both `filter` and `map` authored rendered ZERO markers, silently. That is the
 * live half of this card — reachable through fully documented authoring, not
 * only through the legacy shape.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ObjectMap } from './ObjectMap';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';

// Registers `object-map` + the ElementDataSourceGate wiring (objectstack#7121).
// Imported at module scope, not in a hook: the binding case below renders
// through the registry (AGENTS.md — dynamic import in a hook is lint-blocked).
import './index';
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
    <div data-testid="map-marker" data-lat={latitude} data-lng={longitude}>
      {children}
    </div>
  ),
  Popup: ({ children }: any) => <div data-testid="map-popup">{children}</div>,
}));

/**
 * Rows whose coordinates live under NON-default field names.
 *
 * ⭐ `owner: 'me'` is LOAD-BEARING since objectui#9061, and only since then.
 * Describe (d) authors `filter: [['owner', '=', 'me']]` beside the map config;
 * that filter used to be inert on an inline `value` set (the very fail-OPEN bug
 * #9061 repairs), so the row survived it by accident. Now the inline path
 * lowers `schema.filter` onto `$filter` exactly as the fetching path does, so a
 * row that does not satisfy the authored filter is correctly dropped and the
 * config assertion below would be measuring an empty set instead of the config.
 * Satisfying the filter — rather than removing it — keeps BOTH readings: the
 * filter is honoured AND it did not eat `schema.map`.
 */
const ROWS = [{ id: '1', name: 'HQ', lat: 40, lng: -74, owner: 'me' }];
/** The same place, spelled the way the DEFAULT config expects. */
const ROWS_DEFAULT_SPELLING = [{ id: '1', name: 'HQ', latitude: 40, longitude: -74 }];

const DECLARED_MAP = { latitudeField: 'lat', longitudeField: 'lng', titleField: 'name' };

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  capturedProps = null;
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
});

/**
 * `hostRows`, when given, hands the records down the `data` PROP — the path a
 * host component (`ListView`) uses, which bypasses this component's own query
 * and is therefore exempt from `filter` / `sort` / the row ceiling by design.
 *
 * ⭐ Why describe (a) needs it, post-objectui#9061: the legacy shape under test
 * there is authored under `filter`, and `filter` is the QUERY FILTER and nothing
 * else (objectui#4034) — so `{ map: DECLARED_MAP }` is now read as "the field
 * named `map` equals that object", which no row satisfies, and the inline set
 * comes back EMPTY. That is correct behaviour and the same thing the fetching
 * path has always sent on the wire; but it makes a marker count unable to say
 * anything about CONFIG resolution, which is the only thing this file grades.
 * Handing those rows down the exempt prop puts the config back as the single
 * variable. `filter` still reaches the query verbatim — describe (c) grades
 * that separately, against a mock adapter.
 */
const renderMap = async (schema: Record<string, unknown>, hostRows?: any[]) => {
  const utils = render(<ObjectMap schema={schema as any} data={hostRows} />);
  await waitFor(() => expect(screen.queryByText('Loading map...')).toBeNull());
  return utils;
};

const warnings = () => warnSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');

// ---------------------------------------------------------------------------
// (a) The legacy shape is no longer consumed — and does not vanish silently.
// ---------------------------------------------------------------------------
describe('legacy `filter.map` is not map configuration (objectui#4034)', () => {
  it('ignores a MapConfig stashed under `filter.map`, and refuses for want of a binding', async () => {
    await renderMap(
      {
        type: 'object-map',
        filter: { map: DECLARED_MAP },
      },
      ROWS,
    );

    // The stash named `lat`/`lng`; it is not read, so this schema declares no
    // coordinate binding at all and the map refuses (objectui#8169).
    //
    // ⚠️ The rows come down the exempt host prop deliberately. Read as an
    // inline `value` set this row would still assert 0 — but for the WRONG
    // reason (the stash-as-query-filter selecting nothing), and it would go on
    // passing with config resolution completely broken. Its whole job is to be
    // the 0 half of a 0/1 pair with the row below.
    expect(screen.queryAllByTestId('map-marker')).toHaveLength(0);
    expect(screen.queryByTestId('map-missing-location-binding')).not.toBeNull();
  });

  it('really is "no config at all" — rows spelled the OLD default way do not plot', async () => {
    await renderMap(
      {
        type: 'object-map',
        filter: { map: { latitudeField: 'lat', longitudeField: 'lng' } },
      },
      ROWS_DEFAULT_SPELLING,
    );

    // ⭐ The 1 half of the pair, INVERTED by objectui#8169 and load-bearing in
    // its new direction. Same legacy stash, rows spelled `latitude`/`longitude`
    // — the exact names `getMapConfig`'s deleted default branch guessed. It
    // used to place this marker, which was the proof that a DEFAULT config
    // applied rather than none. Guessing is over: an unbound map refuses, and a
    // record set that happens to carry the conventional column names is
    // precisely the population that must not plot unbound.
    //
    // This row goes red if either face of the guess comes back — the
    // component's default branch, or a relay floor that feeds it.
    expect(screen.queryAllByTestId('map-marker')).toHaveLength(0);
    expect(screen.queryByTestId('map-missing-location-binding')).not.toBeNull();
  });

  it('warns in dev, naming the legacy shape and pointing at `schema.map`', async () => {
    await renderMap({
      type: 'object-map',
      data: { provider: 'value', items: ROWS },
      filter: { map: { titleField: 'name', zoom: 4 } },
    });

    expect(warnSpy).toHaveBeenCalled();
    expect(warnings()).toContain('[ObjectMap]');
    expect(warnings()).toContain('filter.map');
    expect(warnings()).toContain('schema.map');
    expect(warnings()).toContain('objectui#4034');
  });

  it('stops reading the `filter.map.style` half too', async () => {
    await renderMap({
      type: 'object-map',
      data: { provider: 'value', items: ROWS_DEFAULT_SPELLING },
      // A declared binding, so the map MOUNTS and there is a `mapStyle` prop to
      // grade at all: since objectui#8169 an unbound map renders the refusal
      // instead of `MapGL`. It names the rows' own columns and carries no
      // `style`, so the only style this assertion can read is the demo default
      // — which is the whole question here.
      map: { latitudeField: 'latitude', longitudeField: 'longitude' },
      filter: { map: { style: 'https://legacy.example.com/style.json' } },
    });

    expect(capturedProps.mapStyle).toBe('https://demotiles.maplibre.org/style.json');
  });
});

// ---------------------------------------------------------------------------
// (b) Control — the declared shape keeps working, green on both sides.
// ---------------------------------------------------------------------------
describe('the declared `map` input is what configures the map (control)', () => {
  it('applies `schema.map` and places the marker', async () => {
    await renderMap({
      type: 'object-map',
      data: { provider: 'value', items: ROWS },
      map: DECLARED_MAP,
    });

    const markers = screen.getAllByTestId('map-marker');
    expect(markers).toHaveLength(1);
    expect(markers[0]).toHaveAttribute('data-lat', '40');
    expect(markers[0]).toHaveAttribute('data-lng', '-74');
  });

  it('reads `map.style`, and says nothing about a schema with no legacy shape', async () => {
    await renderMap({
      type: 'object-map',
      data: { provider: 'value', items: ROWS },
      map: { ...DECLARED_MAP, style: 'https://tiles.example.com/style.json' },
    });

    expect(capturedProps.mapStyle).toBe('https://tiles.example.com/style.json');
    expect(warnings()).not.toContain('[ObjectMap]');
  });

  /**
   * History — objectui#5018, maintainer ruling 2026-08-17 (「同意」).
   *
   * This pin predates that ruling, which reversed `getMapConfig`'s order: the
   * declared `map` block is now consulted FIRST and wins outright, and the flat
   * top-level spelling is the internal form (ObjectView / ListView flattening
   * `options.map`) consulted only in its absence.
   *
   * What this pin asserts is UNCHANGED by the flip and was never the precedence
   * itself: the schema below carries no `map` block, so the flat branch is the
   * only branch there is. The card that dispatched #5018 read this pin as
   * recording the old top-level-wins precedence — it does not, and no pin did;
   * the old order was unpinned. The precedence, in both directions, is now
   * pinned in `ObjectMap.schemaAlignment.test.tsx`, and the producer path that
   * makes the flip safe in `plugin-view/src/__tests__/ObjectView.mapFlatten.test.tsx`.
   *
   * Keeping this one is the point: the internal form still has to render, or
   * every ObjectView/ListView map goes blank.
   */
  it('keeps the top-level `latitudeField` branch intact (internal flat form)', async () => {
    await renderMap({
      type: 'object-map',
      data: { provider: 'value', items: ROWS },
      latitudeField: 'lat',
      longitudeField: 'lng',
      titleField: 'name',
    });

    expect(screen.getAllByTestId('map-marker')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// (c) Control — `filter` keeps its ONE meaning: it filters. Untouched by the fix.
// ---------------------------------------------------------------------------
describe('`filter` still reaches the query unchanged (control)', () => {
  const makeDataSource = () => ({
    find: vi.fn().mockResolvedValue({ data: [] }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue({ name: 'store', fields: {} }),
  });

  const sentFilter = async (filter: unknown) => {
    const ds = makeDataSource();
    render(
      <ObjectMap
        schema={{ type: 'object-map', objectName: 'store', map: DECLARED_MAP, filter } as any}
        dataSource={ds as any}
      />,
    );
    await waitFor(() => expect(ds.find).toHaveBeenCalled());
    return (ds.find.mock.calls[0] as [string, any])[1].$filter;
  };

  it('passes an array filter through verbatim', async () => {
    expect(await sentFilter([['owner', '=', 'me']])).toEqual([['owner', '=', 'me']]);
  });

  it('passes an object filter through verbatim', async () => {
    expect(await sentFilter({ status: 'active' })).toEqual({ status: 'active' });
  });

  it('does NOT strip a `map` key out of the filter — the filter is the author’s', async () => {
    // The block stops *interpreting* `filter.map` as configuration; it does not
    // rewrite the query. A field genuinely named `map` still filters on it.
    expect(await sentFilter({ map: { latitudeField: 'lat' } })).toEqual({
      map: { latitudeField: 'lat' },
    });
  });
});

// ---------------------------------------------------------------------------
// (d) The live defect + the post-#7121 merged-`and` binding path.
// ---------------------------------------------------------------------------
describe('an ordinary filter no longer eats the map config', () => {
  it('applies `schema.map` when an array filter is authored alongside it', async () => {
    await renderMap({
      type: 'object-map',
      data: { provider: 'value', items: ROWS },
      map: DECLARED_MAP,
      filter: [['owner', '=', 'me']],
    });

    // Pre-fix: `'map' in [...]` matched `Array.prototype.map`, the config became
    // the spread of a function (`{}`), and this rendered zero markers.
    const markers = screen.getAllByTestId('map-marker');
    expect(markers).toHaveLength(1);
    expect(markers[0]).toHaveAttribute('data-lat', '40');
  });

  it('does not warn about a filter that merely has array-ness (no own `map` key)', async () => {
    await renderMap({
      type: 'object-map',
      data: { provider: 'value', items: ROWS },
      map: DECLARED_MAP,
      filter: [['owner', '=', 'me']],
    });

    expect(warnings()).not.toContain('[ObjectMap]');
  });

  it('survives the merged `and` node a dataSource binding produces (objectstack#7121)', async () => {
    const adapter = {
      find: vi.fn().mockResolvedValue({ data: ROWS }),
      findOne: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      getObjectSchema: vi.fn().mockResolvedValue({
        name: 'store',
        fields: { name: { type: 'text' }, rating: { type: 'text' } },
        listViews: { hot: { name: 'hot', label: 'Hot', filter: [['rating', '=', 'hot']] } },
      }),
    };

    render(
      <SchemaRendererProvider dataSource={adapter as any}>
        <SchemaRenderer
          schema={
            {
              type: 'object-map',
              map: DECLARED_MAP,
              filter: [['owner', '=', 'me']],
              dataSource: { object: 'store', view: 'hot' },
            } as any
          }
        />
      </SchemaRendererProvider>,
    );

    await waitFor(() => expect(adapter.find).toHaveBeenCalled());
    const sent = (adapter.find.mock.calls[0] as [string, any])[1].$filter;

    // Measured shape of the merge (objectstack#7121 + `mergeFilterNodes`):
    expect(sent).toEqual(['and', [['owner', '=', 'me']], [['rating', '=', 'hot']]]);

    // Exactly why the deleted probe misfired, pinned so it cannot come back:
    // the merged node has NO own `map` key, yet `'map' in` it is true.
    expect(Object.prototype.hasOwnProperty.call(sent, 'map')).toBe(false);
    expect('map' in (sent as object)).toBe(true);

    // …and the declared config still reaches the markers.
    await waitFor(() => expect(screen.getAllByTestId('map-marker')).toHaveLength(1));
    expect(screen.getAllByTestId('map-marker')[0]).toHaveAttribute('data-lat', '40');
    expect(warnings()).not.toContain('[ObjectMap]');
  });
});
