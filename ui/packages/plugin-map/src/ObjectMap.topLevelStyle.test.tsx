/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `BaseSchema.style` is inline CSS and NEVER a MapLibre style (objectui#5017).
 *
 * `getMapConfig` used to resolve the map style from three spellings with the
 * top-level `style` FIRST:
 *
 *     (schema as any).style || schema.mapStyle || schema.map?.style
 *
 * `style` is declared on the base face as a record of CSS properties
 * (`packages/types/src/zod/base.zod.ts`), which every node may legally carry, so
 * `style: { height: '400px' }` on a map node was handed to MapGL's `mapStyle`
 * prop — unvalidated (the `safeParse` only ever looked at `schema.map`) and
 * undiagnosed. `@object-ui/types` had already named the map's key `mapStyle`
 * (NOT `style`) to avoid precisely this collision, so the consumer was
 * contradicting the declaration it was named after.
 *
 * What this file pins is the invariant, not the implementation: a CSS-meaning
 * `style` is never consumed as a map style. That survives whatever
 * canonicalization objectui#5018's follow-ups settle on, because it is a
 * statement about the OTHER key.
 *
 * The string half matters just as much and is easy to lose: `ObjectView` /
 * `ListView` flatten `options.map`'s CONTENTS to the top level, so a view
 * authored with `map: { style: '<url>' }` reaches this component as a top-level
 * STRING `style`. That shape is not spec-authorable — `@objectstack/spec@17`'s
 * list-view schemas are strict and declare no `map` block at all, so a view
 * carrying one fails validation with `unrecognized_keys` — but it IS
 * runtime-reachable, which is why it gets a dev diagnostic rather than silence.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
  Marker: ({ children }: any) => <div data-testid="map-marker">{children}</div>,
  Popup: ({ children }: any) => <div data-testid="map-popup">{children}</div>,
}));

const DEMO_STYLE = 'https://demotiles.maplibre.org/style.json';
const mockData = [{ id: '1', name: 'Loc 1', latitude: 40, longitude: -74 }];
const DECLARED_MAP = {
  latitudeField: 'latitude',
  longitudeField: 'longitude',
  titleField: 'name',
};

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  capturedProps = null;
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
});

async function renderMap(schema: any) {
  render(<ObjectMap schema={schema} />);
  await waitFor(() => expect(screen.queryByText('Loading map...')).toBeNull());
}

/** The warnings this file cares about, one string per call. */
function styleWarnings(): string[] {
  return (warnSpy.mock.calls as unknown[][])
    .map((args): string => String(args[0]))
    .filter((msg: string) => msg.includes('objectui#5017'));
}

describe('ObjectMap — top-level `style` is inline CSS, not a map style (objectui#5017)', () => {
  it('never hands a CSS-meaning `style` object to MapGL', async () => {
    await renderMap({
      type: 'map',
      // Legal `BaseSchema.style`: a record of CSS properties. Every node may
      // carry it. Before #5017 this exact object became MapGL's `mapStyle`.
      style: { height: '400px', border: '1px solid red' },
      map: DECLARED_MAP,
      data: { provider: 'value', items: mockData },
    });

    expect(capturedProps.mapStyle).toBe(DEMO_STYLE);
    expect(typeof capturedProps.mapStyle).toBe('string');
  });

  it('does not let a CSS-meaning `style` outrank the declared `mapStyle`', async () => {
    await renderMap({
      type: 'map',
      style: { height: '400px' },
      mapStyle: 'https://tiles.example.com/style.json',
      map: DECLARED_MAP,
      data: { provider: 'value', items: mockData },
    });

    expect(capturedProps.mapStyle).toBe('https://tiles.example.com/style.json');
  });

  it('does not let a CSS-meaning `style` outrank the declared `map.style`', async () => {
    await renderMap({
      type: 'map',
      style: { height: '400px' },
      map: { ...DECLARED_MAP, style: 'https://tiles.example.com/style.json' },
      data: { provider: 'value', items: mockData },
    });

    expect(capturedProps.mapStyle).toBe('https://tiles.example.com/style.json');
  });

  it('says nothing about a legal inline-CSS `style` — dropping it IS the fix', async () => {
    await renderMap({
      type: 'map',
      style: { height: '400px' },
      map: DECLARED_MAP,
      data: { provider: 'value', items: mockData },
    });

    expect(styleWarnings()).toEqual([]);
  });

  it('drops a top-level STRING `style` and says so, naming both declared spellings', async () => {
    await renderMap({
      type: 'map',
      style: 'https://tiles.example.com/style.json',
      map: DECLARED_MAP,
      data: { provider: 'value', items: mockData },
    });

    expect(capturedProps.mapStyle).toBe(DEMO_STYLE);

    const warnings = styleWarnings();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('https://tiles.example.com/style.json');
    expect(warnings[0]).toContain('mapStyle');
    expect(warnings[0]).toContain('map: { style:');
  });

  it('warns once per distinct dropped URL, not once per render', async () => {
    const schema = {
      type: 'map',
      style: 'https://repeat.example.com/style.json',
      map: DECLARED_MAP,
      data: { provider: 'value', items: mockData },
    };
    await renderMap(schema);
    await renderMap(schema);

    expect(styleWarnings()).toHaveLength(1);
  });

  it('leaves the two declared spellings untouched', async () => {
    await renderMap({
      type: 'map',
      mapStyle: 'https://top.example.com/style.json',
      map: DECLARED_MAP,
      data: { provider: 'value', items: mockData },
    });
    expect(capturedProps.mapStyle).toBe('https://top.example.com/style.json');

    await renderMap({
      type: 'map',
      map: { ...DECLARED_MAP, style: 'https://block.example.com/style.json' },
      data: { provider: 'value', items: mockData },
    });
    expect(capturedProps.mapStyle).toBe('https://block.example.com/style.json');
  });
});

/**
 * The two shapes that arrive at the TOP LEVEL, pinned on the consumer side.
 *
 * `ObjectView.generateViewSchema('map')` / `ListView`'s `case 'map'` build their
 * `object-map` schema with the CONTENTS of the `map` block at the top level and
 * no `map` key at all. That product shape is pinned at the producer by
 * `ObjectView.mapFlatten.test.tsx` / `ListView.mapFlatten.test.tsx`
 * (objectui#5018).
 *
 * ⚠️ WHICH KEY EACH ONE ARRIVES AS MOVED (objectui#9950). The flatten is a
 * whitelist of the keys `ObjectMapConfigSchema` declares, each written under a
 * flat SPELLING, and `style`'s flat spelling is `mapStyle`. So today a view
 * authoring `map: { style: '<url>' }` arrives as a top-level `mapStyle` and is
 * READ; before #9950 it arrived as a top-level string `style` and was dropped.
 * A `map: { mapStyle: '<url>' }` block arrives as NOTHING — `mapStyle` is not a
 * member of that schema, so the whitelist never picks it up (the remedy text
 * that used to prescribe it is objectui#10002; the end-to-end measurement of
 * both keys, through the real `ListView`, is in
 * `ObjectMap.styleRemedyText-10002.test.tsx`).
 *
 * ⇒ this describe block feeds both literal top-level shapes to the consumer and
 * states the half a producer pin cannot: what each key MEANS once it arrives. A
 * top-level string `style` is no longer emitted by either producer, but it stays
 * runtime-reachable from a node authored (or host-composed) with one written
 * directly on it — spec-invalid, not absent.
 */
describe('ObjectMap — the ObjectView/ListView flatten product (objectui#5017)', () => {
  it('ignores the `style` a flattened `map: { style }` lands at the top level', async () => {
    await renderMap({
      type: 'object-map',
      objectName: 'store',
      className: 'h-full w-full',
      locationField: 'location',
      latitudeField: 'latitude',
      longitudeField: 'longitude',
      // A string `style` written directly on the node. Until objectui#9950 the
      // flatten also landed a view's `map: { style }` here; it no longer does.
      style: 'https://flattened.example.com/style.json',
      data: { provider: 'value', items: mockData },
    });

    expect(capturedProps.mapStyle).toBe(DEMO_STYLE);
    expect(styleWarnings()).toHaveLength(1);
    // ⛔ NO string snapshot of the remedy here. This assertion used to pin a
    // phrase out of that sentence, which is how a remedy naming a key nothing
    // reads stayed green for as long as it did (objectui#10002). The remedy is
    // EXECUTED instead — every key it prescribes is parsed out of this same
    // warning and written into a real `map` block, on both paths, in
    // `ObjectMap.styleRemedyText-10002.test.tsx`.
  });

  it('honours the flattened `mapStyle`, which is the spelling that survives', async () => {
    await renderMap({
      type: 'object-map',
      objectName: 'store',
      className: 'h-full w-full',
      locationField: 'location',
      latitudeField: 'latitude',
      longitudeField: 'longitude',
      // What a view's declared `map: { style: '<url>' }` flattens to since
      // objectui#9950 — `mapStyle` is that key's flat spelling.
      mapStyle: 'https://flattened.example.com/style.json',
      data: { provider: 'value', items: mockData },
    });

    expect(capturedProps.mapStyle).toBe('https://flattened.example.com/style.json');
    expect(styleWarnings()).toEqual([]);
  });
});
