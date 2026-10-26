/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#5042 — the spec's VIEW-LEVEL `map` block was authorable and
 * validated, and inert.
 *
 * `ListMapConfigSchema` (objectstack#9340) flows into this repo's own
 * `ListViewSchema` by reference — it is absent from `LIST_VIEW_LOCAL_OVERRIDES`,
 * so `specFieldsExcept` imports it — which means `map: { … }` on a list view
 * PARSED, type-checked and travelled all the way to `ListView`. It just was not
 * read: `case 'map'` forwarded `schema.options?.map` and nothing else, so
 * authoring the key changed nothing at runtime. The switcher had the same hole
 * one level up, and a worse consequence: the capability gate that decides which
 * visualizations are offered also looked only at `options.map`, so a view whose
 * coordinates were bound in the spec block was filtered OUT of its own
 * `appearance.allowedVisualizations` and fell back to `['grid']`.
 *
 * These pin the forward, the precedence, and the switcher gate. The end-to-end
 * consequence — the block reaching `getMapConfig` and driving the seven reads —
 * is pinned in `plugin-map`'s `ObjectMap.listViewMapConfigReach.test.tsx`,
 * where the real reader and the maplibre mock live.
 *
 * PRECEDENCE, and why it is not a new rule: every sibling visualization in
 * `ListView.tsx` already puts the view-level block ahead of the legacy
 * `options.<kind>` bag. Five of them (`kanban`, `calendar`, `gallery`,
 * `timeline`, `gantt`) spread `options` first and the view-level block last —
 * a per-key override. Two (`tree`, `chart`) use `||`, replacing the bag
 * wholesale. The DIRECTION is unanimous across all seven; only the granularity
 * differs, and `map` follows the five that merge — which are also the five that
 * flatten config into props the way the map branch does.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ComponentRegistry } from '@object-ui/core';
import { render, waitFor, screen, fireEvent } from '@testing-library/react';
import { ListView } from '../ListView';
import { SchemaRendererProvider } from '@object-ui/react';


/** objectui#12423 — Display is the toolbar default; this file drives the WIDE form's buttons. */
const WIDE_TOOLBAR = { compactToolbar: false } as const;

let captured: Array<Record<string, any>> = [];

ComponentRegistry.register(
  'object-map',
  (props: Record<string, any>) => {
    captured.push(props);
    return <div data-testid="map-spy" />;
  },
  { namespace: 'test', label: 'Map spy', category: 'view' },
);

const makeDataSource = () => ({
  find: vi.fn().mockResolvedValue([]),
  findOne: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getObjectSchema: vi.fn().mockResolvedValue({ name: 'store', fields: {} }),
});

const BASE = {
  type: 'list-view',
  objectName: 'store',
  viewType: 'map',
  columns: ['name'],
} as const;

/** Mount `ListView` on the given view and return the schema handed to `object-map`. */
async function mapSchemaFor(view: Record<string, unknown>) {
  captured = [];
  const dataSource = makeDataSource() as any;
  render(
    <SchemaRendererProvider dataSource={dataSource}>
      <ListView schema={{ ...WIDE_TOOLBAR, ...BASE, ...view } as never} dataSource={dataSource} />
    </SchemaRendererProvider>,
  );
  await waitFor(() => expect(captured.length).toBeGreaterThan(0));
  return captured[captured.length - 1].schema as Record<string, unknown>;
}

describe('ListView forwards the view-level `map` block to plugin-map (objectui#5042)', () => {
  beforeEach(() => {
    captured = [];
  });

  // THE DISCRIMINATING ARM. Before the fix every one of these assertions read
  // `undefined`: the block was parsed and then dropped on the floor.
  it('forwards every one of the seven declared keys from the view-level block alone', async () => {
    const schema = await mapSchemaFor({
      map: {
        latitudeField: 'lat',
        longitudeField: 'lng',
        locationField: 'geo',
        titleField: 'title',
        descriptionField: 'blurb',
        zoom: 12,
        center: [40.7128, -74.006],
      },
    });

    expect(schema.type).toBe('object-map');
    expect(schema.latitudeField).toBe('lat');
    expect(schema.longitudeField).toBe('lng');
    expect(schema.locationField).toBe('geo');
    expect(schema.titleField).toBe('title');
    expect(schema.descriptionField).toBe('blurb');
    expect(schema.zoom).toBe(12);
    expect(schema.center).toEqual([40.7128, -74.006]);
  });

  it('emits the FLAT form, never a nested `map` key', async () => {
    // Not cosmetic. `getMapConfig` treats a nested `map` block as winning
    // OUTRIGHT over the flat spelling (objectui#5018) — emitting one here would
    // turn this per-key merge into whole-block replacement of the legacy bag
    // and would trip `warnOnShadowedFlatMapKeys`. That precedence rule is
    // written around the flattener: "neither flattener emits a `map` key at
    // all". This keeps that sentence true.
    const schema = await mapSchemaFor({ map: { locationField: 'geo' } });

    expect(schema.locationField).toBe('geo');
    expect(Object.prototype.hasOwnProperty.call(schema, 'map')).toBe(false);
  });

  describe('precedence — view-level block over `options.map`, per key', () => {
    it('lets the view-level block win on a key both declare', async () => {
      const schema = await mapSchemaFor({
        options: { map: { locationField: 'geo', titleField: 'bag_title' } },
        map: { titleField: 'spec_title' },
      });

      expect(schema.titleField).toBe('spec_title');
    });

    it('keeps a key only the legacy bag declares — it is a merge, not a replacement', async () => {
      // The arm that separates the five merging siblings from the two that use
      // `||`. Under whole-block replacement `locationField` would be gone here
      // and the map would render no markers at all.
      const schema = await mapSchemaFor({
        options: { map: { locationField: 'geo', titleField: 'bag_title' } },
        map: { titleField: 'spec_title' },
      });

      expect(schema.locationField).toBe('geo');
    });
  });

  describe('controls', () => {
    it('CONTROL: `options.map` alone still works, unchanged', async () => {
      const schema = await mapSchemaFor({
        options: { map: { latitudeField: 'lat', longitudeField: 'lng', titleField: 'bag_title' } },
      });

      expect(schema.latitudeField).toBe('lat');
      expect(schema.longitudeField).toBe('lng');
      expect(schema.titleField).toBe('bag_title');
    });

    it('CONTROL: with no map config at all, NOTHING is emitted — not even a binding', async () => {
      const schema = await mapSchemaFor({});

      // objectui#8169 (ruled 2026-09-07 「同意」, option B): the
      // `locationField: … || 'location'` floor that used to be the one key this
      // arm emitted is gone, together with `getMapConfig`'s own coordinate
      // guesses. An undeclared map view now produces a schema with no binding
      // in it and `ObjectMap` renders its "Map configuration required" refusal
      // — pinned end-to-end in
      // `plugin-map/src/ObjectMap.unboundRefusal-8169.test.tsx`.
      expect(schema.locationField).toBeUndefined();
      expect(Object.prototype.hasOwnProperty.call(schema, 'locationField')).toBe(false);
      // objectui#5000 / objectui#4941: no camera is synthesized anywhere on
      // this path. `zoom`/`center` carry no spec default precisely so that
      // "no declaration" stays distinguishable from a declared camera at the
      // read site — declaring one here would silently overrule that and
      // suppress the fit-to-records the absence is supposed to trigger.
      expect(Object.prototype.hasOwnProperty.call(schema, 'zoom')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(schema, 'center')).toBe(false);
    });

    it('forwards a declared camera, and only the half the author wrote', async () => {
      const schema = await mapSchemaFor({ map: { locationField: 'geo', zoom: 3 } });

      expect(schema.zoom).toBe(3);
      expect(Object.prototype.hasOwnProperty.call(schema, 'center')).toBe(false);
    });

    it('applies the objectui#5177 whitelist to the view-level block too', async () => {
      // `style` is also `BaseSchema.style` (inline CSS, legal on every node).
      // The spec block is strict and could not carry it from a validated
      // author, but `ListView` never parses — it renders what it is handed —
      // so the new source goes through the same whitelist as the old one.
      const schema = await mapSchemaFor({
        map: { locationField: 'geo', style: 'https://tiles.example.com/style.json', bogusKey: 'nope' },
      });

      expect(schema.locationField).toBe('geo');
      expect(Object.prototype.hasOwnProperty.call(schema, 'style')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(schema, 'bogusKey')).toBe(false);
    });
  });
});

/**
 * The switcher half. `appearance.allowedVisualizations` is the author
 * whitelist (ADR-0047) and the offered set is `whitelist ∩ resolvable` — so a
 * capability gate that cannot see the spec block does not merely fail to offer
 * `map`, it filters the author's own whitelist down to nothing and falls back
 * to `['grid']`. That is the switcher consequence of the same missing read.
 */
describe('ListView offers `map` in the switcher from the view-level block (objectui#5042)', () => {
  beforeEach(() => {
    captured = [];
  });

  /** Mount a grid-typed view with the switcher shown, then open it. */
  const renderSwitcher = (view: Record<string, unknown>) => {
    const dataSource = makeDataSource() as any;
    render(
      <SchemaRendererProvider dataSource={dataSource}>
        <ListView
          schema={{ ...WIDE_TOOLBAR, ...BASE, viewType: 'grid', ...view } as never}
          dataSource={dataSource}
          showViewSwitcher
        />
      </SchemaRendererProvider>,
    );
    const trigger = screen.queryByTestId('view-switcher-dropdown');
    if (trigger) fireEvent.click(trigger);
  };

  /**
   * Find a visualization option by accessible name, in either switcher form —
   * the inline segmented control exposes `role="tab"`, the collapsed dropdown
   * plain buttons. Mirrors `ListView.test.tsx`'s helper.
   */
  const queryViewOption = (name: string) =>
    screen.queryByRole('tab', { name }) ?? screen.queryByRole('button', { name });

  it('offers `map` when the binding is in the view-level block', () => {
    renderSwitcher({
      appearance: { allowedVisualizations: ['grid', 'map'] },
      map: { locationField: 'geo' },
    });

    expect(queryViewOption('Map')).toBeTruthy();
  });

  it('CONTROL: `options.map` alone still resolves the capability', () => {
    renderSwitcher({
      appearance: { allowedVisualizations: ['grid', 'map'] },
      options: { map: { locationField: 'geo' } },
    });

    expect(queryViewOption('Map')).toBeTruthy();
  });

  it('CONTROL: no binding anywhere leaves `map` unresolvable', () => {
    renderSwitcher({ appearance: { allowedVisualizations: ['grid', 'map'] } });

    expect(queryViewOption('Map')).toBeNull();
  });

  it('resolves a binding SPLIT across the two sources, the way it will render', () => {
    // The gate asks the merged config, so a split lat/lng pair is judged the
    // same way the render seam resolves it. Asking `options.map` alone said
    // "not resolvable" while the seam would have rendered it fine.
    renderSwitcher({
      appearance: { allowedVisualizations: ['grid', 'map'] },
      options: { map: { latitudeField: 'lat' } },
      map: { longitudeField: 'lng' },
    });

    expect(queryViewOption('Map')).toBeTruthy();
  });
});
