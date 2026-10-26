/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#5305 / ⭐ objectui#8348 — the bare-array `data` shorthand on
 * `object-map`: first normalized, now RETIRED, and this file is the record of
 * both halves.
 *
 * ## What objectui#5305 left here
 *
 * The fetch effect used to carry a SECOND short-circuit beside the `props.data`
 * one #5003/#5297 fixed: it read `schema.data` directly and tested whether that
 * value was itself an array. #5305 moved that handling into `getDataConfig`, so
 * the array was lifted to `{ provider: 'value', items }` at one boundary. The
 * reason given for keeping it at all was that the shorthand is "a live
 * convention in six sibling blocks" — an argument from what the CODE does.
 *
 * ## What objectui#8348 rules
 *
 * Decision batch #83 (2026-09-08), maintainer verbatim 「8348 以协议为准」 — the
 * CONTRACT decides, not the convention. A renderer honours the `data` spelling
 * its block's published row declares and no other. The row is
 * `ComponentPropsMap['object-map'].data` — a `z.discriminatedUnion('provider',
 * [...])` over OBJECT variants with no array arm. ⇒ the lift is gone. When this
 * file was written the installed spec published no such row and the block was
 * judged through this repo's own `ObjectMapSchema.data`, spelled the same;
 * ruling batch #136 item 3 (Q1-C) had the protocol gain it, and
 * `ObjectMap.dataArmSpecRow-8348.test.tsx` now derives the arm from the
 * INSTALLED row, so a release that moves it turns that file red.
 *
 * ⛔ WHAT THE REMOVAL DOES AND DOES NOT REACH — measured, per CARRIER
 *
 * At the LADDER (rows 1-2, driving the component directly with no `data` prop):
 * the array is no longer a record source, so the ladder falls through to
 * `staticData`, then to `objectName`, and such a map queries its object instead
 * — or draws nothing when it names neither.
 *
 * Through `SchemaRenderer` (rows 3, 3b): the array no longer draws there
 * either, SINCE objectui#9571. When this file was written it still did:
 * `SchemaRenderer` spread every non-metadata node key as a React prop and
 * `plugin-map/src/index.tsx` forwards `{...props}`, so an authored `data` array
 * also arrived on the props channel and outranked the schema (objectui#5003
 * order). Ruling objectui#8348 Q2-C (decision batch #136 item 3, maintainer
 * 「同意」) closed that second carrier: the spread now skips an authored `data`
 * for blocks whose published row is the OBJECT arm, which is this one.
 *
 * ⛔ The PROP itself is untouched, and rows 3c and 6 are that leg — option B
 * (gating the prop on the arm) was REFUSED, because it is the channel a host
 * such as `ListView` legitimately uses for pre-fetched rows.
 *
 * ⇒ `object-calendar` is untouched throughout: its row is the ARRAY arm, so
 * neither the ladder nor the spread refuses its bare array.
 *
 * ## Why the file keeps its name and its controls
 *
 * The subject is the same fact, with the verdict reversed, so the #5305 rows
 * survive as the ⛔ CONTROLS that keep the retirement a measurement: the
 * DECLARED `{ provider: 'value', items }` form still paints, still takes the
 * no-fetch path, and still repaints on a changed row set; and the `data` PROP
 * still outranks the schema. If the retirement had broken inline rows outright
 * rather than just the shorthand, those rows go red.
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
import { ComponentRegistry, recordSourceDataArmForType } from '@object-ui/core';
import { ObjectMap } from './ObjectMap';
// Registers `object-map` — row 3 renders through it.
import './index';
import type { DataSource } from '@object-ui/types';
import './__tests__/webgl2Available';

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

const ROWS = [
  { id: '1', name: 'Loc 1', latitude: 40, longitude: -74 },
  { id: '2', name: 'Loc 2', latitude: 41, longitude: -75 },
];

const SECOND_ROWS = [{ id: '9', name: 'Loc 9', latitude: 51, longitude: -1 }];

const makeDataSource = (): DataSource =>
  ({
    find: vi.fn().mockResolvedValue({ data: [] }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue({ fields: {} }),
  }) as unknown as DataSource;

describe('ObjectMap — the bare-array `schema.data` shorthand is retired (objectui#8348)', () => {
  it('⭐ a bare array under `data` no longer draws markers — the accepted cost', async () => {
    const schema: any = { type: 'object-map', map: MAP_CONFIG, data: ROWS };

    render(<ObjectMap schema={schema} />);

    await waitFor(() => expect(screen.queryByText('Loading map...')).toBeNull());
    expect(screen.queryAllByTestId('map-marker')).toHaveLength(0);
  });

  it('⭐ …and with an `objectName` beside it, the ladder falls through and QUERIES', async () => {
    // The other face of the same removal, and the one an author actually feels:
    // the rows are not merely dropped, the block goes and asks its object
    // instead. Before objectui#8348 this schema issued no `find` at all.
    const dataSource = makeDataSource();
    const schema: any = {
      type: 'object-map',
      objectName: 'locations',
      map: MAP_CONFIG,
      data: ROWS,
    };

    render(<ObjectMap schema={schema} dataSource={dataSource} />);

    await waitFor(() => expect(dataSource.find).toHaveBeenCalled());
    expect(screen.queryAllByTestId('map-marker')).toHaveLength(0);
  });

  it('3. ⭐ through `SchemaRenderer` the array no longer draws either — the second carrier is closed (objectui#9571)', async () => {
    // Was: "REPORTED, NOT CHANGED — the array still draws, from the PROPS
    // channel". `SchemaRenderer` spread every non-metadata node key, so the
    // authored array arrived as a `data` PROP too and `dataProp` lifted it
    // above the ladder. objectui#9571 (ruling objectui#8348 Q2-C, decision
    // batch #136 item 3, maintainer 「同意」) stops that spread for blocks whose
    // published row is the OBJECT arm, which is this one — so the authored key
    // now has exactly ONE carrier and the ladder's verdict is end-to-end.
    const dataSource = makeDataSource();
    render(
      <SchemaRendererProvider dataSource={dataSource as any}>
        <SchemaRenderer
          schema={{ type: 'object-map', map: MAP_CONFIG, data: ROWS } as never}
        />
      </SchemaRendererProvider>,
    );

    await waitFor(() => expect(screen.queryByText('Loading map...')).toBeNull());
    expect(screen.queryAllByTestId('map-marker')).toHaveLength(0);
  });

  it('3b. …and with an `objectName` beside it, the block QUERIES through `SchemaRenderer` too', async () => {
    // The other face, and the one that separates "the prop stopped arriving"
    // from "the component stopped drawing anything at all".
    const dataSource = makeDataSource();
    render(
      <SchemaRendererProvider dataSource={dataSource as any}>
        <SchemaRenderer
          schema={{ type: 'object-map', objectName: 'locations', map: MAP_CONFIG, data: ROWS } as never}
        />
      </SchemaRendererProvider>,
    );

    await waitFor(() => expect(dataSource.find).toHaveBeenCalled());
    expect(screen.queryAllByTestId('map-marker')).toHaveLength(0);
  });

  it('3c. ⛔ MUST NOT CHANGE: a HOST `data` prop threaded through `SchemaRenderer` still paints', async () => {
    // `...props` is spread LAST in `SchemaRenderer`, after the schema keys, so
    // a host that renders the node and hands the window down still reaches the
    // map. Option B — gating the prop on the arm — was refused to keep this.
    const dataSource = makeDataSource();
    render(
      <SchemaRendererProvider dataSource={dataSource as any}>
        <SchemaRenderer
          schema={{ type: 'object-map', map: MAP_CONFIG } as never}
          data={ROWS as never}
        />
      </SchemaRendererProvider>,
    );

    await waitFor(() => expect(screen.getAllByTestId('map-marker')).toHaveLength(2));
    expect(dataSource.find).not.toHaveBeenCalled();
  });

  it('3d. every KEY this plugin registers onto the map renderer answers the SAME arm', () => {
    // The alias hazard `RecordSourceDataArm`'s docblock names, closed against
    // the REGISTRY and not against the table: one `register()` call produces a
    // namespaced key and a bare one, and `SchemaRenderer` looks the arm up with
    // the raw `schema.type`. A key added without a row in
    // `recordSourceDataArmForType` turns this red instead of silently answering
    // `'undeclared'` and keeping the prop seat. The bare `map` key and its
    // `view:map` twin are retired (objectui#10393), so the group is exactly the
    // one registration's two keys.
    const siblings = ComponentRegistry.getAllTypes().filter(
      (type) => ComponentRegistry.get(type) === ComponentRegistry.get('object-map'),
    );

    expect([...siblings].sort()).toEqual(['object-map', 'plugin-map:object-map']);
    for (const type of siblings) {
      expect([type, recordSourceDataArmForType(type)]).toEqual([type, 'view-data']);
    }
  });

  it('⛔ CONTROL: the declared `{ provider: value, items }` form still paints', async () => {
    const schema: any = {
      type: 'object-map',
      map: MAP_CONFIG,
      data: { provider: 'value', items: ROWS },
    };

    render(<ObjectMap schema={schema} />);

    await waitFor(() => expect(screen.queryByText('Loading map...')).toBeNull());
    await waitFor(() => expect(screen.getAllByTestId('map-marker')).toHaveLength(2));

    const markers = screen.getAllByTestId('map-marker');
    expect(markers[0]).toHaveAttribute('data-lat', '40');
    expect(markers[1]).toHaveAttribute('data-lng', '-75');
  });

  it('⛔ CONTROL: the declared form is still inline data — no `find`, no `getObjectSchema`', async () => {
    // objectui#5305's substance, kept: `{ provider: 'value' }` must take the
    // no-fetch path, and must not send the sibling effect off for object
    // metadata whose only read site is the object-provider fetch branch.
    const dataSource = makeDataSource();
    const schema: any = {
      type: 'object-map',
      objectName: 'locations',
      map: MAP_CONFIG,
      data: { provider: 'value', items: ROWS },
    };

    render(<ObjectMap schema={schema} dataSource={dataSource} />);

    await waitFor(() => expect(screen.getAllByTestId('map-marker')).toHaveLength(2));
    await new Promise((r) => setTimeout(r, 0));

    expect(dataSource.find).not.toHaveBeenCalled();
    expect(dataSource.getObjectSchema).not.toHaveBeenCalled();
  });

  it('⛔ CONTROL: the declared form does not go stale — new authored rows re-run the effect', async () => {
    // The substance behind the original `missing dependency` report. `schema.data`
    // is read only by `getDataConfig`, and reaches the effect through the
    // `dataConfig` dependency, so a changed row set must still repaint.
    const schema: any = {
      type: 'object-map',
      map: MAP_CONFIG,
      data: { provider: 'value', items: ROWS },
    };
    const { rerender } = render(<ObjectMap schema={schema} />);

    await waitFor(() => expect(screen.getAllByTestId('map-marker')).toHaveLength(2));

    rerender(
      <ObjectMap schema={{ ...schema, data: { provider: 'value', items: SECOND_ROWS } }} />,
    );

    await waitFor(() => expect(screen.getAllByTestId('map-marker')).toHaveLength(1));
    expect(screen.getAllByTestId('map-marker')[0]).toHaveAttribute('data-lat', '51');
  });

  it('⛔ CONTROL: the `data` PROP still outranks the schema (objectui#5003 order)', async () => {
    // Unchanged by the ruling, and the reason a HOSTED map (ObjectView /
    // ListView pre-fetching rows) is untouched by any of the above: the props
    // channel is a different carrier from the authored `data` key.
    const schema: any = {
      type: 'object-map',
      map: MAP_CONFIG,
      data: { provider: 'value', items: ROWS },
    };

    render(<ObjectMap schema={schema} data={SECOND_ROWS} />);

    await waitFor(() => expect(screen.getAllByTestId('map-marker')).toHaveLength(1));
    expect(screen.getAllByTestId('map-marker')[0]).toHaveAttribute('data-lat', '51');
  });
});
