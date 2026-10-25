/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#5157 — `ObjectMapConfigSchema` is `.strict()`, so an `object-map`
 * node whose `map` block carries an undeclared key is REFUSED on the validate
 * face, by name, instead of parsing clean with the key stripped.
 *
 * Ruled letter A on objectui#5157 (carrying the earlier ruling that limits the
 * change to the `map` block): `.strict()` goes on the schema itself, so the
 * declared face, the runtime check `ObjectMap` performs and the validate face
 * keep ONE accept set. The runtime half (the component still renders and warns,
 * naming the key) is pinned beside the renderer, in `plugin-map`'s
 * `ObjectMap.strictConfigWarn-5157.test.tsx`.
 *
 * Three things are pinned here:
 *
 *  (ii) the validate face — `safeValidateSchema` refuses a `map` block carrying
 *       the card's typo with ONE `unrecognized_keys` issue at the block, naming
 *       the key, and still accepts the clean block;
 *  (iii) the pre-landing sweep, held rather than remembered — every `map`
 *       block the sweep found in authored metadata parses clean under strict;
 *  and the boundary: `.shape` did not move, so every key list read from it
 *  sees the same keys.
 */

import { describe, it, expect } from 'vitest';
import { ObjectMapConfigSchema, ObjectMapSchema } from '../zod/objectql.zod.js';
import { safeValidateSchema } from '../zod/index.zod.js';

/** The card's own typo: `latitudeFieId`, capital i where the l belongs. */
const TYPO_KEY = 'latitudeFieId';

/**
 * The node as `ObjectMap` reads it — the flat `ObjectMapSchema` mirror's
 * spelling, after `SchemaRenderer` hoists `properties` (objectui#10859 batch 5).
 */
const CLEAN_NODE = {
  type: 'object-map',
  objectName: 'stores',
  map: { latitudeField: 'lat', longitudeField: 'lng' },
};

const TYPO_NODE = {
  type: 'object-map',
  objectName: 'stores',
  map: { [TYPO_KEY]: 'lat', longitudeField: 'lng' },
};

/**
 * The same two nodes as an author writes them, which is what the validate face
 * judges: since objectui#10859 batch 5 an authored `object-map` takes its props
 * in the spec's `properties` bag, and the flat spelling above is refused by
 * name. The `map` block inside the bag is the spec row's `map` member, which
 * declares the same eight keys and is closed the same way.
 */
const AUTHORED_CLEAN = { type: 'object-map', properties: { objectName: 'stores', map: CLEAN_NODE.map } };
const AUTHORED_TYPO = { type: 'object-map', properties: { objectName: 'stores', map: TYPO_NODE.map } };

/** The authored node, one level down: what a page or a view actually carries. */
const NESTED_TYPO = { type: 'div', children: [AUTHORED_TYPO] };
const NESTED_CLEAN = { type: 'div', children: [AUTHORED_CLEAN] };

/** Each issue reduced to what a consumer keys off: its kind, its place, the keys it names. */
function issues(result: { success: boolean; error?: { issues: ReadonlyArray<{ code: string; path: PropertyKey[]; keys?: string[] }> } }) {
  return (result.error?.issues ?? []).map((i) => ({ code: i.code, path: i.path, keys: i.keys }));
}

describe('(ii) the validate face refuses an undeclared `map` key, by name (objectui#5157)', () => {
  it('refuses the typo block with one `unrecognized_keys` issue at `properties.map`, naming the key', () => {
    const result = safeValidateSchema(AUTHORED_TYPO);
    expect(result.success).toBe(false);
    expect(issues(result)).toEqual([{ code: 'unrecognized_keys', path: ['properties', 'map'], keys: [TYPO_KEY] }]);
  });

  it('refuses the typo block on the flat mirror too, at `map`', () => {
    const result = ObjectMapSchema.safeParse(TYPO_NODE);
    expect(result.success).toBe(false);
    expect(issues(result)).toEqual([{ code: 'unrecognized_keys', path: ['map'], keys: [TYPO_KEY] }]);
  });

  it('refuses the typo block on the config schema, naming the key at the block root', () => {
    const result = ObjectMapConfigSchema.safeParse(TYPO_NODE.map);
    expect(result.success).toBe(false);
    expect(issues(result)).toEqual([{ code: 'unrecognized_keys', path: [], keys: [TYPO_KEY] }]);
  });

  it('refuses the typo block one level down, inside a container', () => {
    // The nested refusal arrives as the child slot's union issue, not as a
    // named key: that is how the undiscriminated `children` union reports.
    // Only the verdict is pinned here; how `objectui validate` renders it is
    // measured on the pull request, not pinned.
    expect(safeValidateSchema(NESTED_TYPO).success).toBe(false);
  });

  it('still accepts the clean block, alone and nested (control)', () => {
    expect(issues(safeValidateSchema(AUTHORED_CLEAN))).toEqual([]);
    expect(safeValidateSchema(AUTHORED_CLEAN).success).toBe(true);
    expect(safeValidateSchema(NESTED_CLEAN).success).toBe(true);
    expect(issues(ObjectMapSchema.safeParse(CLEAN_NODE))).toEqual([]);
  });
});

describe('`.strict()` closes the block without moving its shape (objectui#5157)', () => {
  it('declares the same eight keys, so every key list read from `.shape` is unchanged', () => {
    // `ObjectMap`'s `FLAT_MAP_CONFIG_KEYS` is this list minus `style`; the view
    // flatten whitelists are pinned against it in their own packages.
    expect(Object.keys(ObjectMapConfigSchema.shape).sort()).toEqual([
      'center',
      'descriptionField',
      'latitudeField',
      'locationField',
      'longitudeField',
      'style',
      'titleField',
      'zoom',
    ]);
  });

  it('accepts every declared key together', () => {
    const everything = {
      latitudeField: 'lat',
      longitudeField: 'lng',
      locationField: 'location',
      titleField: 'name',
      descriptionField: 'address',
      zoom: 12,
      center: [37.7749, -122.4194],
      style: 'https://tiles.example.com/style.json',
    };
    expect(issues(ObjectMapConfigSchema.safeParse(everything))).toEqual([]);
  });
});

/**
 * (iii) The pre-landing sweep the first ruling on objectui#5157 required, held
 * as a fixture so its verdict is re-derived on every run instead of quoted.
 *
 * ⚠️ The POPULATION is a snapshot, and nothing here re-enumerates it: it is
 * every `map` block the sweep found in authored metadata, enumerated with
 * `git ls-tree` and a `git grep` for a `map` key over objectui `examples` /
 * `apps` / `content` at `40c076fc2d` and objectstack `examples` / `apps` at
 * `3cf6449389`, with every grep hit reconciled by hand (translation labels,
 * view names and catalog entry ids keyed `map` are not config blocks). A block
 * added after those commits is NOT in this list. The three catalog entries are
 * also re-read live from disk and validated whole by `plugin-map`'s
 * `ObjectMap.catalogRecordSource-6939.test.tsx`.
 *
 * Each row names its source by path and a quoted anchor — ⛔ never a line
 * address (AGENTS.md #11).
 */
const SWEEP: ReadonlyArray<{ repo: 'objectui' | 'objectstack'; path: string; anchor: string; block: Record<string, unknown> }> = [
  { repo: 'objectui', path: 'content/docs/plugins/plugin-map.mdx', anchor: '### Basic Usage with ObjectQL', block: { latitudeField: 'lat', longitudeField: 'lng', titleField: 'name', descriptionField: 'address' } },
  { repo: 'objectui', path: 'content/docs/plugins/plugin-map.mdx', anchor: '### With Static Data', block: { latitudeField: 'lat', longitudeField: 'lng', titleField: 'name', descriptionField: 'address' } },
  { repo: 'objectui', path: 'content/docs/plugins/plugin-map.mdx', anchor: 'const storeMap', block: { latitudeField: 'latitude', longitudeField: 'longitude', titleField: 'storeName', descriptionField: 'storeAddress' } },
  { repo: 'objectui', path: 'content/docs/plugins/plugin-map.mdx', anchor: 'const placeMap', block: { locationField: 'coordinates', titleField: 'placeName', descriptionField: 'description' } },
  { repo: 'objectui', path: 'content/docs/plugins/plugin-map.mdx', anchor: 'const cameraMap', block: { latitudeField: 'lat', longitudeField: 'lng', titleField: 'name', zoom: 12, center: [37.7749, -122.4194] } },
  { repo: 'objectui', path: 'content/docs/plugins/plugin-map.mdx', anchor: 'const retailStores', block: { latitudeField: 'store_lat', longitudeField: 'store_lng', titleField: 'store_name', descriptionField: 'store_address' } },
  { repo: 'objectui', path: 'content/docs/plugins/plugin-map.mdx', anchor: 'const staticLocations', block: { latitudeField: 'lat', longitudeField: 'lng', titleField: 'name' } },
  { repo: 'objectui', path: 'content/docs/plugins/plugin-map.mdx', anchor: 'const clickableMap', block: { latitudeField: 'lat', longitudeField: 'lng', titleField: 'name' } },
  { repo: 'objectui', path: 'content/docs/plugins/plugin-map.mdx', anchor: 'const storeLocator', block: { latitudeField: 'latitude', longitudeField: 'longitude', titleField: 'storeName', descriptionField: 'fullAddress', zoom: 10, center: [37.7749, -122.4194] } },
  { repo: 'objectui', path: 'content/docs/plugins/plugin-map.mdx', anchor: 'const deliveryMap', block: { latitudeField: 'current_lat', longitudeField: 'current_lng', titleField: 'driver_name', descriptionField: 'delivery_address' } },
  { repo: 'objectui', path: 'content/docs/plugins/plugin-map.mdx', anchor: 'const propertyMap', block: { latitudeField: 'property_lat', longitudeField: 'property_lng', titleField: 'property_address', descriptionField: 'property_details', zoom: 12 } },
  { repo: 'objectui', path: 'content/docs/plugins/plugin-map.mdx', anchor: 'const venueMap', block: { latitudeField: 'lat', longitudeField: 'lng', titleField: 'venueName', descriptionField: 'details', zoom: 11 } },
  { repo: 'objectui', path: 'content/docs/plugins/plugin-map.mdx', anchor: 'const serviceMap', block: { latitudeField: 'customer_latitude', longitudeField: 'customer_longitude', titleField: 'customer_name', descriptionField: 'service_type', zoom: 10 } },
  { repo: 'objectui', path: 'content/docs/plugins/plugin-map.mdx', anchor: 'const mapConfig: ObjectMapConfig', block: { latitudeField: 'lat', longitudeField: 'lng', titleField: 'name', descriptionField: 'description', zoom: 12, center: [37.7749, -122.4194] } },
  { repo: 'objectui', path: 'content/docs/fields/location.mdx', anchor: '**2. The map over the same field.**', block: { locationField: 'location', titleField: 'name', zoom: 12, center: [37.7749, -122.4194] } },
  { repo: 'objectui', path: 'examples/schema-catalog/src/schemas/plugin-map/event-venue-finder.json', anchor: '"map"', block: { latitudeField: 'latitude', longitudeField: 'longitude', titleField: 'venue', descriptionField: 'info', zoom: 11 } },
  { repo: 'objectui', path: 'examples/schema-catalog/src/schemas/plugin-map/real-time-delivery-tracking.json', anchor: '"map"', block: { latitudeField: 'current_lat', longitudeField: 'current_lng', titleField: 'driver', descriptionField: 'destination', zoom: 12 } },
  { repo: 'objectui', path: 'examples/schema-catalog/src/schemas/plugin-map/store-locator-map.json', anchor: '"map"', block: { latitudeField: 'lat', longitudeField: 'lng', titleField: 'name', descriptionField: 'address', zoom: 9 } },
  { repo: 'objectstack', path: 'examples/app-showcase/src/ui/views/task.view.ts', anchor: "label: 'Work Locations (Map)'", block: { titleField: 'title', locationField: 'location' } },
  { repo: 'objectstack', path: 'examples/app-showcase/test/task-map-marker-title.test.ts', anchor: "name: 'showcase_task_map_direct_probe'", block: { titleField: 'title', locationField: 'location' } },
];

describe('(iii) every `map` block the pre-landing sweep found parses clean under strict (objectui#5157)', () => {
  it('holds the swept population, split as the sweep found it', () => {
    // Non-vacuity, not a live count: the sweep's own population at the two
    // commits named above. A row removed here without a reason turns this red.
    expect(SWEEP.filter((row) => row.repo === 'objectui')).toHaveLength(18);
    expect(SWEEP.filter((row) => row.repo === 'objectstack')).toHaveLength(2);
  });

  it.each(SWEEP.map((row) => [`${row.repo} ${row.path} (${row.anchor})`, row.block] as const))(
    '%s parses clean as a map block',
    (_label, block) => {
      expect(issues(ObjectMapConfigSchema.safeParse(block))).toEqual([]);
    },
  );

  it.each(SWEEP.map((row) => [`${row.repo} ${row.path} (${row.anchor})`, row.block] as const))(
    '%s validates as the `map` block of an object-map node',
    (_label, block) => {
      // The authored spelling (objectui#10859 batch 5): the block in the bag.
      expect(issues(safeValidateSchema({ type: 'object-map', properties: { objectName: 'stores', map: block } }))).toEqual([]);
    },
  );
});
