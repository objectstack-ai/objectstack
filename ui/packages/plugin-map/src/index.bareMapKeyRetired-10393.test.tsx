/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The bare `map` NODE TYPE key is retired; `object-map` is the one spelling
 * this plugin serves (objectui#10393, executing the objectui#8008 family ruling
 * of 2026-09-09, route 3).
 *
 * ## ⚠️ Why this is a plain unregistration and not a named refusal
 *
 * `BaseSchema` is `.passthrough()`, so a dropped MEMBER key is KEPT, not
 * refused, and a retirement that forgets it ships a document that validates
 * green and renders nothing (objectui#7664). That hazard needs a schema face to
 * arise on. This key never had one: `@object-ui/types` names the literal
 * `'map'` only in the STORED view-type unions, never as a component node type,
 * and `AnyComponentSchema` has no `map` arm. ⇒ Unregistering IS the
 * retirement, exactly as it was for `gantt` (objectui#8008).
 *
 * ## What the retirement changes, measured on both authoring faces
 *
 * Before it, the two faces disagreed about one document: the html tier
 * (`sdui-parser`'s `validateTree` over the live registry) accepted a `map` node
 * because the registry mounted it, while the Zod face refused the same node
 * with `invalid_union`. Row 2 pins that they now AGREE, and its control is the
 * same content spelled `object-map`, which both faces accept.
 *
 * ## ⛔ The layer this does not touch
 *
 * `map` also names a STORED `NamedListView.type`. `plugin-view`'s `ObjectView`
 * and `plugin-list`'s `ListView` map a stored `map` view onto the node type
 * `object-map` already, so no saved view moves. That is pinned where it can be
 * seen — `plugin-view`'s `ObjectView.mapFlatten.test.tsx` (a stored `map` view
 * emits an `object-map` node) and this package's
 * `ObjectMap.listViewMapConfigReach.test.tsx` (a `viewType: 'map'` list view
 * draws its markers through `object-map`) — and deliberately not restated here.
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// `src/index.tsx` pulls in the real map bindings; stub them so a plain module
// import needs no WebGL canvas (same stub as `index.registration.test.tsx`).
vi.mock('react-map-gl/maplibre', () => ({
  default: () => null,
  Map: () => null,
  NavigationControl: () => null,
  Marker: () => null,
  Popup: () => null,
}));

import { ComponentRegistry } from '@object-ui/core';
import { safeValidateSchema } from '@object-ui/types/zod';
import { manifestFromConfigs, validateTree } from '@object-ui/sdui-parser';
// Module scope, not a hook: this import IS the registration (AGENTS.md
// test-discipline section).
import './index';
// @ts-expect-error — plain-JS shared helper, intentionally untyped (`allowJs: false`)
import { maskComments } from '../../../scripts/js-comment-mask.mjs';

/** Local annotation, since the import above is untyped — the call site stays checked. */
const mask: (source: string) => string = maskComments;

const INDEX_TSX = join(dirname(fileURLToPath(import.meta.url)), 'index.tsx');

/** One document, spelled under whichever type key the row names. */
const node = (type: string) => ({
  type,
  map: { latitudeField: 'lat', longitudeField: 'lng', titleField: 'name' },
  staticData: [{ id: '1', name: 'HQ', lat: 37.77, lng: -122.42 }],
});

const liveManifest = () =>
  manifestFromConfigs(
    ComponentRegistry.getKnownTypes().map((type) => {
      const meta = ComponentRegistry.getMeta(type);
      return { type, namespace: meta?.namespace, isContainer: meta?.isContainer, inputs: meta?.inputs };
    }) as unknown as Parameters<typeof manifestFromConfigs>[0],
  );

const htmlTierCodes = (type: string) =>
  validateTree(node(type) as never, liveManifest()).diagnostics.map((d) => d.code);

describe('the bare `map` node type key is retired (objectui#10393)', () => {
  it('1. `map` resolves to nothing, under the bare AND the namespaced spelling', () => {
    // `register(key, C, { namespace })` stores BOTH, so checking one spelling
    // would leave the other resolving.
    expect(ComponentRegistry.has('map')).toBe(false);
    expect(ComponentRegistry.has('view:map')).toBe(false);
    expect(ComponentRegistry.getConfig('map', 'view')).toBeFalsy();
  });

  it('1. FIRING CONTROL — `object-map` still resolves, so the `false` above is a reading', () => {
    // Without this the assertion above would also pass against a registry that
    // had failed to load this package at all.
    expect(ComponentRegistry.has('object-map')).toBe(true);
    expect(ComponentRegistry.getConfig('object-map', 'plugin-map')).toBeTruthy();
  });

  it('2. both authoring faces now REFUSE a `map` node — the html tier by name, the Zod face as before', () => {
    expect(htmlTierCodes('map')).toEqual(['unknown-component']);
    expect(htmlTierCodes('view:map')).toEqual(['unknown-component']);
    expect(safeValidateSchema(node('map')).success).toBe(false);
  });

  it('2. CONTROL — the same content spelled `object-map` passes both faces', () => {
    expect(htmlTierCodes('object-map')).toEqual([]);
    // The Zod face judges an authored JSON document, which takes the same
    // content in the spec's `properties` bag since objectui#10859 batch 5; the
    // html tier's attributes are the node's own keys.
    const { type, ...props } = node('object-map');
    expect(safeValidateSchema({ type, properties: props }).success).toBe(true);
  });

  it('3. the source registers ONE key, measured off disk rather than through the registry', () => {
    // The registry answer above is about this process; this one is about the
    // file, so a registration added in a form the registry happens not to reach
    // still shows up. Comments are STRIPPED first: the retirement left a
    // tombstone docblock that quotes the removed
    // `ComponentRegistry.register('map', …)` call verbatim, so a raw scan would
    // read the retired key back out of the prose that records its removal.
    const src = mask(readFileSync(INDEX_TSX, 'utf8'));
    const keys = [...src.matchAll(/ComponentRegistry\.register\(\s*'([^']+)'/g)].map((m) => m[1]);
    // Anti-vacuity for the extraction: a regex that matched nothing would make
    // the equality below hold forever.
    expect(keys.length).toBeGreaterThan(0);
    expect(keys).toEqual(['object-map']);
    // And the stripper is not eating the code: the surviving registration's own
    // renderer name survives the strip.
    expect(src).toContain('ObjectMapRenderer');
  });
});
