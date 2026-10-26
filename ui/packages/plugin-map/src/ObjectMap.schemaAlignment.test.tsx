/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `ObjectMapSchema` declares what `ObjectMap` reads, and the `map` block wins
 * over the internal flat spelling (objectui#5018).
 *
 * Before this card the component had three disagreeing shapes for one thing:
 * `ObjectMapSchema` declared four keys, the renderer read about fifteen, and
 * `ObjectMapProps.schema` was typed `ObjectGridSchema` — so every map-specific
 * read went through `(schema as any)`. A TypeScript author could not write the
 * `map` block the docs teach, and misspelling `latitudeField` as
 * `latitudeFieId` was caught by nothing at all: the map rendered, empty, and
 * looked like bad data.
 *
 * Two halves are pinned here:
 *
 *  (a) TYPE — the `map` block exists on the declared surface and is CLOSED, so
 *      the misspelling is a compile error. These are `@ts-expect-error` pins:
 *      they fail loudly (TS2578, "Unused '@ts-expect-error' directive") the day
 *      the type stops rejecting what it must reject. `tsconfig.test.json`
 *      compiles this file, which is what makes them enforcement rather than
 *      decoration. The boundary of what (a) can promise — `BaseSchema`'s index
 *      signature leaves the TOP level open — is measured and pinned too, rather
 *      than claimed.
 *
 *  (b) RUNTIME — precedence. Maintainer ruling, 2026-08-17 (「同意」, recorded
 *      on objectui#5018): the `map` block is the author face, the flat
 *      top-level spelling is the internal form ObjectView/ListView produce when
 *      they flatten `options.map`, and when both are present the block wins —
 *      what the author wrote outranks what internal flattening produced — with
 *      a dev-mode warning naming the top-level keys that were ignored.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ObjectMapSchema, ObjectMapConfig } from '@object-ui/types';
import { ObjectMap } from './ObjectMap';
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
 * One record carrying BOTH spellings' coordinates, at places far enough apart
 * that the rendered marker says which configuration was consulted.
 */
const ROWS = [
  { id: '1', name: 'Authored', lat: 40, lng: -74, flat_lat: 1, flat_lng: 2 },
];

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  capturedProps = null;
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
});

const renderMap = async (schema: Record<string, unknown>) => {
  const utils = render(<ObjectMap schema={schema as unknown as ObjectMapSchema} />);
  await waitFor(() => expect(screen.queryByText('Loading map...')).toBeNull());
  return utils;
};

const warnings = () => warnSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');

// ---------------------------------------------------------------------------
// (a) The declared surface — compile-time pins.
// ---------------------------------------------------------------------------
describe('ObjectMapSchema declares what the renderer reads (type pins)', () => {
  it('accepts every key ObjectMap.tsx actually consumes', () => {
    const schema: ObjectMapSchema = {
      type: 'object-map',
      objectName: 'stores',
      staticData: [{ id: '1' }],
      data: { provider: 'value', items: [{ id: '1' }] },
      // objectui#6152 round 10: `filter` is the `object-map` row's `ViewFilterRule` array
      // (it was `any[]`; this cell carried the AST tuple array the row refuses).
      filter: [{ field: 'status', operator: 'equals', value: 'open' }],
      sort: [{ field: 'name', order: 'desc' }],
      map: {
        latitudeField: 'lat',
        longitudeField: 'lng',
        locationField: 'location',
        titleField: 'name',
        descriptionField: 'address',
        zoom: 12,
        center: [37.7749, -122.4194],
        style: 'https://tiles.example.com/style.json',
      },
      enableClustering: true,
      navigation: { mode: 'drawer' },
      mapStyle: 'https://tiles.example.com/style.json',
    };

    expect(schema.map?.latitudeField).toBe('lat');
  });

  it('REJECTS a misspelled key inside the `map` block', () => {
    const config: ObjectMapConfig = {
      longitudeField: 'lng',
      // @ts-expect-error `latitudeFieId` (capital i, not l) is not an ObjectMapConfig key.
      // This exact typo is objectui#5018's headline symptom: before the block was
      // declared it reached the renderer unchallenged and painted an empty map.
      latitudeFieId: 'lat',
    };

    expect(config.longitudeField).toBe('lng');
  });

  /**
   * The bound on (a), measured rather than assumed — the first draft of this
   * file pinned the opposite and `tsc` said otherwise (TS2578 on both).
   *
   * `BaseSchema` carried `[key: string]: any` ("additional properties specific
   * to the component type"), and `ObjectMapSchema extends BaseSchema`. So a
   * misspelled key at the TOP level type-checked — for every component schema
   * in the repo, not just this one. That index signature was a platform-wide
   * decision well outside objectui#5018; objectui#8347 removed it, and the row
   * below flipped with it: the top level is closed now too.
   *
   * What #5018 buys is the half that matters for the card's symptom: `ObjectMapConfig`
   * is a plain interface with no index signature, so the `map` BLOCK is closed
   * and `latitudeFieId` is rejected — the exact typo that rendered a silent
   * empty map. Pinning the real boundary keeps the next reader from believing
   * the whole surface is closed.
   */
  it('rejects a misspelled TOP-LEVEL key since objectui#8347 closed `BaseSchema`', () => {
    const schema: ObjectMapSchema = {
      type: 'object-map',
      objectName: 'stores',
      // This row carried no directive while `BaseSchema`'s index signature
      // admitted the key (the first draft of this file pinned the opposite too
      // early); objectui#8347 removed the signature.
      // @ts-expect-error — `enableClusterng` is no member; the key is `enableClustering`
      enableClusterng: true,
    };

    expect(schema.objectName).toBe('stores');
  });

  it('leaves the internal flat spelling undeclared (documented, not enforced)', () => {
    // `latitudeField` is deliberately absent from `ObjectMapSchema`: it is the
    // ObjectView/ListView flatten product, not an authoring surface (maintainer
    // ruling on objectui#5018, 2026-08-17). The index signature above means the
    // omission is documentation rather than a compile error, so what is pinned
    // is the declaration itself — `map.latitudeField` is the typed spelling.
    const authored: ObjectMapConfig = { latitudeField: 'lat' };
    expect(authored.latitudeField).toBe('lat');

    // `map` is genuinely typed as `ObjectMapConfig`, not widened to `any` by the
    // index signature — a wrong VALUE type is rejected too, not just a wrong key.
    const block: NonNullable< ObjectMapSchema['map'] > = {
      // @ts-expect-error `zoom` is a number.
      zoom: 'far',
    };
    expect(block).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// (b) Precedence — the ruled behaviour.
// ---------------------------------------------------------------------------
describe('the `map` block outranks the internal flat spelling (objectui#5018)', () => {
  it('reads the `map` block when both spellings are present', async () => {
    await renderMap({
      type: 'object-map',
      data: { provider: 'value', items: ROWS },
      map: { latitudeField: 'lat', longitudeField: 'lng', titleField: 'name' },
      // The internal form, pointing somewhere else entirely.
      latitudeField: 'flat_lat',
      longitudeField: 'flat_lng',
    });

    const markers = screen.getAllByTestId('map-marker');
    expect(markers).toHaveLength(1);
    // 40 / -74 is the `map` block's answer; 1 / 2 would be the flat one's.
    expect(markers[0]).toHaveAttribute('data-lat', '40');
    expect(markers[0]).toHaveAttribute('data-lng', '-74');
  });

  it('names the ignored top-level keys in a dev-mode warning', async () => {
    await renderMap({
      type: 'object-map',
      objectName: 'stores',
      data: { provider: 'value', items: ROWS },
      map: { latitudeField: 'lat', longitudeField: 'lng', titleField: 'name' },
      latitudeField: 'flat_lat',
      longitudeField: 'flat_lng',
      zoom: 3,
    });

    const text = warnings();
    expect(text).toContain('[ObjectMap]');
    expect(text).toContain('latitudeField');
    expect(text).toContain('longitudeField');
    expect(text).toContain('zoom');
    expect(text).toContain('objectui#5018');
    // A key that was NOT authored must not be named — the diagnostic reports
    // what happened, it does not recite the key list.
    expect(text).not.toContain('descriptionField');
  });

  it('says nothing when only the `map` block is present', async () => {
    await renderMap({
      type: 'object-map',
      data: { provider: 'value', items: ROWS },
      map: { latitudeField: 'lat', longitudeField: 'lng', titleField: 'name' },
    });

    expect(screen.getAllByTestId('map-marker')).toHaveLength(1);
    expect(warnings()).not.toContain('[ObjectMap]');
  });

  it('still honours a `map.style` alongside the shadowed flat keys', async () => {
    await renderMap({
      type: 'object-map',
      data: { provider: 'value', items: ROWS },
      map: {
        latitudeField: 'lat',
        longitudeField: 'lng',
        style: 'https://tiles.example.com/style.json',
      },
      latitudeField: 'flat_lat',
    });

    expect(capturedProps.mapStyle).toBe('https://tiles.example.com/style.json');
  });
});

// ---------------------------------------------------------------------------
// (c) The producer path — what the precedence flip is allowed to leave alone.
// ---------------------------------------------------------------------------
describe('the ObjectView / ListView flatten product still renders (control)', () => {
  /**
   * Byte-for-byte the shape `plugin-view/src/ObjectView.tsx` `case 'map'` and
   * `plugin-list/src/ListView.tsx` `case 'map'` build: `...baseProps`, a
   * `locationField` that always defaults to `'location'`, then the CONTENTS of
   * `options.map` spread flat. There is no `map` key in it, which is exactly
   * why flipping the precedence cannot change what these views render — the
   * companion pin lives in `plugin-view/src/__tests__/`.
   */
  it('reads the flat keys when no `map` block is present', async () => {
    await renderMap({
      type: 'object-map',
      objectName: 'stores',
      className: 'h-full w-full',
      data: { provider: 'value', items: ROWS },
      locationField: 'location',
      latitudeField: 'flat_lat',
      longitudeField: 'flat_lng',
      titleField: 'name',
    });

    const markers = screen.getAllByTestId('map-marker');
    expect(markers).toHaveLength(1);
    expect(markers[0]).toHaveAttribute('data-lat', '1');
    expect(markers[0]).toHaveAttribute('data-lng', '2');
    // No block, nothing shadowed, nothing to say.
    expect(warnings()).not.toContain('[ObjectMap]');
  });
});
