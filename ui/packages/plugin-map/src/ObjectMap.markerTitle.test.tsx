/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#5953 — marker titles resolve through ADR-0079's unified
 * `getRecordDisplayName`, not a hard-coded `'name'` key.
 *
 * ## What this file pins that `ObjectMap.listViewMapConfigReach.test.tsx` does not
 *
 * That file pins REACH: a declared `map` block arrives at `getMapConfig` and
 * drives the read. Every one of its arms declares `titleField: 'title'` and
 * asserts a positive title, so it exercises exactly the one path that was never
 * broken — an AUTHORED binding. It never asserts the defect (its `'Marker'` /
 * `undefined` mention is prose in a comment, not an assertion), and nothing in
 * it changes here.
 *
 * The uncovered half, and this file's subject, is the path with NO authored
 * binding, where `getMapConfig` used to forge one:
 *
 *   - the FLAT form (`ObjectView` / `ListView`'s flatten product) without a
 *     `titleField`, which forged `'name'` and rendered `undefined` for every
 *     object whose display field is not literally `name` — the card's symptom;
 *   - a DECLARED `map` block without a `titleField`, which rendered the
 *     `'Marker'` placeholder for every record alike;
 *   - `titleFormat`, and the record-key probe — precedence steps a static
 *     field-name binding structurally cannot carry, so no upstream deriver
 *     (`defaultMapFromObject`, objectui#5909/PR#5955) can reach them either.
 *
 * The two placeholder arms at the bottom pin the resolution of the competing
 * placeholders: `Record #<id>` where the record has an id, this component's own
 * `'Marker'` only where it has none.
 */

import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { SchemaRendererProvider } from '@object-ui/react';
import { ObjectMap } from './ObjectMap';
import './__tests__/webgl2Available';

vi.mock('react-map-gl/maplibre', () => ({
  default: ({ children }: any) => <div aria-label="Map">{children}</div>,
  Map: ({ children }: any) => <div aria-label="Map">{children}</div>,
  NavigationControl: () => <div data-testid="nav-control" />,
  Marker: ({ children, longitude, latitude, onClick }: any) => (
    <div
      data-testid="map-marker"
      data-lng={longitude}
      data-lat={latitude}
      onClick={() => onClick?.({ originalEvent: { stopPropagation() {} } })}
    >
      {children}
    </div>
  ),
  Popup: ({ children }: any) => <div data-testid="map-popup">{children}</div>,
}));

/**
 * The card's object shape: the display field is `site_name`, NOT `name`, and no
 * record carries a `name` key at all — so the deleted `'name'` literal read
 * `undefined` on every one of them.
 */
const SITES = [
  { id: '1', site_name: 'Harbour Depot', code_label: 'HD-01', latitude: 47.6062, longitude: -122.3321 },
  { id: '2', site_name: 'Ridge Yard', code_label: 'RY-02', latitude: 37.7749, longitude: -122.4194 },
];

const makeDataSource = (objectDef: any, records: any[] = SITES) => ({
  find: vi.fn().mockResolvedValue(records),
  findOne: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getObjectSchema: vi.fn().mockResolvedValue(objectDef),
});

/** Mount the real `ObjectMap`, settle its two fetches, and open marker 0's popup. */
async function openFirstPopup(schema: Record<string, unknown>, dataSource?: any) {
  render(
    <SchemaRendererProvider dataSource={dataSource}>
      <ObjectMap schema={schema as never} dataSource={dataSource} />
    </SchemaRendererProvider>,
  );
  await waitFor(() => expect(screen.queryByLabelText('Map')).not.toBeNull());
  await waitFor(() => expect(screen.getAllByTestId('map-marker').length).toBeGreaterThan(0));
  fireEvent.click(screen.getAllByTestId('map-marker')[0]);
  await waitFor(() => expect(screen.queryByTestId('map-popup')).not.toBeNull());
  return screen.getByTestId('map-popup');
}

/** The object-provider data config every arm below fetches through. */
const OBJECT_DATA = { provider: 'object', object: 'site' };

describe('marker titles resolve through getRecordDisplayName (objectui#5953)', () => {
  // ── THE DISCRIMINATING ARM ────────────────────────────────────────────────
  // The FLAT form the ObjectView / ListView flatten product emits, with no
  // `titleField` in it. `getMapConfig` used to fill that absence with `'name'`
  // and the read site did `record['name']` — `undefined`, on every marker.
  it('flat config with no `titleField`: resolves the declared `nameField`', async () => {
    const ds = makeDataSource({
      name: 'site',
      nameField: 'site_name',
      fields: { site_name: { type: 'text' }, code_label: { type: 'text' } },
    });

    const popup = await openFirstPopup(
      { type: 'object-map', latitudeField: 'latitude', longitudeField: 'longitude', data: OBJECT_DATA },
      ds,
    );

    expect(popup.textContent).toContain('Harbour Depot');
    // The precise regression: not merely "something rendered", but that the
    // hard-coded key is gone. `undefined` reaches the DOM as the string.
    expect(popup.textContent).not.toContain('undefined');
  });

  // The same absence through the DECLARED block, whose read-site symptom was
  // the other, differently-shaped placeholder: `'Marker'` on every record.
  it('declared `map` block with no `titleField`: resolves the declared `nameField`', async () => {
    const ds = makeDataSource({
      name: 'site',
      nameField: 'site_name',
      fields: { site_name: { type: 'text' }, code_label: { type: 'text' } },
    });

    const popup = await openFirstPopup(
      { type: 'object-map', map: { latitudeField: 'latitude', longitudeField: 'longitude' }, data: OBJECT_DATA },
      ds,
    );

    expect(popup.textContent).toContain('Harbour Depot');
    expect(popup.textContent).not.toContain('Marker');
  });

  // ── THE RULING THIS FIX MUST NOT BREAK ────────────────────────────────────
  // An authored `titleField` keeps winning outright. This is a bug fix, not a
  // widening: the accepted authoring set is unchanged and the author's choice
  // still outranks the object's own declaration.
  it("an authored `titleField` still wins over the object's `nameField`", async () => {
    const ds = makeDataSource({
      name: 'site',
      nameField: 'site_name',
      fields: { site_name: { type: 'text' }, code_label: { type: 'text' } },
    });

    const popup = await openFirstPopup(
      {
        type: 'object-map',
        map: { latitudeField: 'latitude', longitudeField: 'longitude', titleField: 'code_label' },
        data: OBJECT_DATA,
      },
      ds,
    );

    expect(popup.textContent).toContain('HD-01');
    expect(popup.textContent).not.toContain('Harbour Depot');
  });

  // ── STEPS A STATIC FIELD-NAME BINDING CANNOT CARRY ────────────────────────
  // A composite `titleFormat` template. No upstream deriver can bind this to a
  // `titleField`, because there is no single field to name — which is why the
  // fix has to live at the read site.
  it('resolves a `titleFormat` template, which no field-name binding can express', async () => {
    const ds = makeDataSource(
      {
        name: 'site',
        titleFormat: '{code_label} — {site_name}',
        fields: { site_name: { type: 'text' }, code_label: { type: 'text' } },
      },
    );

    const popup = await openFirstPopup(
      { type: 'object-map', latitudeField: 'latitude', longitudeField: 'longitude', data: OBJECT_DATA },
      ds,
    );

    expect(popup.textContent).toContain('HD-01 — Harbour Depot');
  });

  // Inline `value` data never fetches an object definition at all (the schema
  // effect is gated on `!hasInlineData`), so `objectSchema` stays `null` here.
  // The resolver's record-key probe still finds the name off the record's own
  // `*_name` key — a path the old bare `record['name']` read had no way to reach.
  it('inline `value` data with no object definition: the record-key probe resolves it', async () => {
    const popup = await openFirstPopup({
      type: 'object-map',
      latitudeField: 'latitude',
      longitudeField: 'longitude',
      data: { provider: 'value', items: SITES },
    });

    expect(popup.textContent).toContain('Harbour Depot');
    expect(popup.textContent).not.toContain('undefined');
  });

  // ── THE PLACEHOLDER RESOLUTION ────────────────────────────────────────────
  // Two placeholders were in play once the resolver arrived: this component's
  // `'Marker'` and the resolver's `Record #<id>` floor. They are split by
  // whether the record has an id, because that is exactly the split in how much
  // either can say. `Record #<id>` names ONE record; `'Marker'` describes every
  // pin on the map equally and so distinguishes none of them.
  it('no resolvable name, but an id: titles itself `Record #<id>`, not the old placeholder', async () => {
    const ds = makeDataSource(
      { name: 'site', fields: { latitude: { type: 'number' }, longitude: { type: 'number' } } },
      [{ id: '77', latitude: 10, longitude: 20 }],
    );

    const popup = await openFirstPopup(
      { type: 'object-map', latitudeField: 'latitude', longitudeField: 'longitude', data: OBJECT_DATA },
      ds,
    );

    expect(popup.textContent).toContain('Record #77');
    expect(popup.textContent).not.toContain('Marker');
  });

  it("no resolvable name and no id: keeps this component's `Marker` placeholder", async () => {
    const ds = makeDataSource(
      { name: 'site', fields: { latitude: { type: 'number' }, longitude: { type: 'number' } } },
      [{ latitude: 10, longitude: 20 }],
    );

    const popup = await openFirstPopup(
      { type: 'object-map', latitudeField: 'latitude', longitudeField: 'longitude', data: OBJECT_DATA },
      ds,
    );

    // `'Marker'` is passed as the resolver's `fallback`, displacing its generic
    // `'Untitled'`. Asserting the NEGATIVE too is what makes this a pin on the
    // choice rather than on "some string appeared".
    expect(popup.textContent).toContain('Marker');
    expect(popup.textContent).not.toContain('Untitled');
  });
});
