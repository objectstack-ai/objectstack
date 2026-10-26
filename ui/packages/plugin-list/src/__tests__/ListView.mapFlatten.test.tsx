/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#5177 — `ListView`'s `case 'map'` flattener used to be a WHOLE-BAG
 * spread (`...(schema.options?.map || {})`), so any key an author wrote in
 * the `map` block landed at the top level of the `object-map` schema it
 * builds — including keys `ObjectMap`'s `FlatMapConfigKeys = Omit<
 * ObjectMapConfig, 'style' >` declares OUT of this flat form. `style` is the
 * specimen the card measured: it is ALSO `BaseSchema.style` (inline CSS,
 * legal on every node), so a `map: { style: '<url>' }` authoring intent
 * arrived at the top level as that CSS-shaped key.
 *
 * These pin the whitelist (`FLAT_MAP_CONFIG_SPELLING`, hand-written in
 * `ListView.tsx` itself — see the comment on that constant for why it is not
 * derived from `ObjectMapConfigSchema` at runtime there) rather than the raw
 * spread: a declared key still travels, an arbitrary undeclared one does not,
 * and the top-level `style` namespace is never written.
 *
 * objectui#9950 — `style` is no longer DROPPED either. It is delivered under
 * its flat spelling `mapStyle`, which is what `ObjectMap.getMapConfig` reads
 * (`schema.mapStyle || schema.map?.style`) and a declared member of
 * `ObjectMapSchema`; the top-level `style` it must not collide with stays the
 * base face's inline CSS. The bottom of this file pins the spelling table
 * against the WHOLE declaration and asserts the relation "every declared key
 * is delivered" — the pin it replaces compared the hand list against
 * `shape` MINUS `style`, so it was green exactly while an authored map style
 * was being discarded before the renderer.
 *
 * Mirrors `ObjectView.mapFlatten.test.tsx`'s coverage for the sibling
 * flattener.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ComponentRegistry } from '@object-ui/core';
import { render, waitFor, cleanup } from '@testing-library/react';
import { ListView, FLAT_MAP_CONFIG_SPELLING } from '../ListView';
import { SchemaRendererProvider } from '@object-ui/react';
// Test-only: `ListView.tsx` hand-writes `FLAT_MAP_CONFIG_SPELLING` rather than
// importing this schema at runtime, precisely so this module never appears in
// `examples/console-starter`'s walked import graph (see the comment on the
// constant). A test file is explicitly excluded from that walk, so pinning
// against the real declaration HERE is safe.
import { ObjectMapConfigSchema } from '@object-ui/types/zod';

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

/** Mount ListView on a `map`-typed view and return the schema handed to `object-map`. */
async function mapSchemaFor(mapOptions: Record<string, unknown>) {
  captured = [];
  const dataSource = makeDataSource() as any;
  render(
    <SchemaRendererProvider dataSource={dataSource}>
      <ListView
        schema={{ ...BASE, options: { map: mapOptions } } as never}
        dataSource={dataSource}
      />
    </SchemaRendererProvider>,
  );
  await waitFor(() => expect(captured.length).toBeGreaterThan(0));
  return captured[captured.length - 1].schema as Record<string, unknown>;
}

describe('ListView flattens `options.map` through a whitelist, not a raw spread (objectui#5177)', () => {
  beforeEach(() => {
    captured = [];
  });

  it('produces an object-map schema and still reaches a declared key', async () => {
    const schema = await mapSchemaFor({ latitudeField: 'lat', longitudeField: 'lng' });

    expect(schema.type).toBe('object-map');
    expect(schema.latitudeField).toBe('lat');
    expect(schema.longitudeField).toBe('lng');
  });

  it('does NOT let `style` in the `map` block reach the TOP-LEVEL `style` — it travels as `mapStyle`', async () => {
    const schema = await mapSchemaFor({
      latitudeField: 'lat',
      longitudeField: 'lng',
      style: 'https://tiles.example.com/style.json',
    });

    expect(schema.latitudeField).toBe('lat');
    // objectui#5177 — the top-level `style` namespace belongs to
    // `BaseSchema.style` (inline CSS) and the flatten never writes it.
    expect(schema.style).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(schema, 'style')).toBe(false);
    // objectui#9950 — and the authored map style is no longer discarded on
    // the way: it arrives under the spelling `getMapConfig` reads.
    expect(schema.mapStyle).toBe('https://tiles.example.com/style.json');
  });

  it('does NOT let an arbitrary undeclared key reach the top level', async () => {
    const schema = await mapSchemaFor({ latitudeField: 'lat', totallyUndeclaredKey: 'nope' });

    expect(schema.latitudeField).toBe('lat');
    expect(schema.totallyUndeclaredKey).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(schema, 'totallyUndeclaredKey')).toBe(false);
  });

  it('emits NO `locationField` floor when nothing is configured (objectui#8169)', async () => {
    const schema = await mapSchemaFor({});

    // The floor that used to stand here — `locationField: … || 'location'` —
    // was deleted with `getMapConfig`'s own coordinate guesses in one change
    // (maintainer ruling 2026-09-07 「同意」, option B): bindings are never
    // fabricated, and an unbound map renders `ObjectMap`'s "Map configuration
    // required" refusal instead of an empty one.
    //
    // ⛔ Deleting this floor ALONE would have widened the guess rather than
    // closed it — the floor forced `getMapConfig`'s flat branch, which carries
    // no `latitudeField` / `longitudeField`, so dropping it on its own handed
    // undeclared views the component's three-name default branch instead of
    // one name. The joined behaviour is pinned in
    // `plugin-map/src/ObjectMap.unboundRefusal-8169.test.tsx`; what this row
    // holds is the producer half: the flatten emits exactly what the view
    // declared, and nothing else.
    expect(schema.locationField).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(schema, 'locationField')).toBe(false);
  });
});

/**
 * objectui#9950 — THE RELATION, replacing a pin that could not see the defect.
 *
 * The pin this supersedes read
 * `Object.keys(ObjectMapConfigSchema.shape).filter((key) => key !== 'style')`
 * and compared the hand list to THAT. The subtraction in the comparison set is
 * the defect itself, spelled a second time: the list was measured against a
 * declaration that had already had `style` removed from it, so the assertion
 * was green precisely while an authored map style was dropped before the
 * renderer and the map painted the public demo tiles. A pin narrowed to match
 * the bug reports "the list is correct" to the next reader.
 *
 * What is asserted instead is a RELATION over the declaration read WHOLE:
 * every key `ObjectMapConfigSchema` declares is delivered by the flatten,
 * under its flat spelling. There is no literal key list here to narrow.
 *
 * The whitelist's own reason survives unchanged, in the file's own words
 * (objectui#5177): `style` is ALSO `BaseSchema.style` — inline CSS, legal on
 * every node — so a whole-bag spread put two namespaces on one key. The map
 * style is therefore delivered as `mapStyle`: the spelling
 * `ObjectMap.getMapConfig` actually reads (`schema.mapStyle || schema.map?.style`,
 * never a top-level `style` — objectui#5017) and a declared member of
 * `ObjectMapSchema`. Honouring the declaration and keeping the collision shut
 * are not in tension; the old flattener just did neither for this key.
 */
describe('every declared ObjectMapConfigSchema key is delivered by the flatten (objectui#9950)', () => {
  /** The declaration, read WHOLE. Nothing is filtered out of it here. */
  const declared = Object.keys(ObjectMapConfigSchema.shape);

  /**
   * One value per declared key, chosen by asking the DECLARATION which shapes
   * it accepts rather than hand-listing a type per key. A key added later with
   * a shape none of these fit fails loudly here instead of being skipped.
   */
  const CANDIDATE_VALUES: unknown[] = ['probe-value', 7, [1, 2]];
  function sampleFor(key: string): unknown {
    const member = (ObjectMapConfigSchema.shape as Record<string, { safeParse: (v: unknown) => { success: boolean } }>)[key];
    for (const candidate of CANDIDATE_VALUES) {
      if (member.safeParse(candidate).success) return candidate;
    }
    throw new Error(`No sample value is accepted by ObjectMapConfigSchema.${key} — extend CANDIDATE_VALUES`);
  }

  /** An authored `map` block carrying EVERY declared key, legal by the declaration. */
  const authoredEverything: Record<string, unknown> = Object.fromEntries(declared.map((key) => [key, sampleFor(key)]));

  /** Which declared keys did NOT arrive, under their flat spelling, carrying the authored value. */
  function undeliveredKeys(product: Record<string, unknown>): string[] {
    return declared.filter((key) => {
      const flat = (FLAT_MAP_CONFIG_SPELLING as Record<string, string>)[key];
      if (!flat || !(flat in product)) return true;
      return JSON.stringify(product[flat]) !== JSON.stringify(authoredEverything[key]);
    });
  }

  /**
   * The PRE-FIX flattener, reproduced: the hand list narrowed by the very
   * `key !== 'style'` subtraction the old pin also used on its comparison set.
   */
  function preFixFlatten(source: Record<string, unknown>): Record<string, unknown> {
    const preFixKeys = declared.filter((key) => key !== 'style');
    return Object.fromEntries(preFixKeys.filter((key) => key in source).map((key) => [key, source[key]]));
  }

  it('the probe config is legal by the declaration, and the declaration does carry `style`', () => {
    // The card's shape: an authored map style PARSES GREEN. If this stopped
    // being true the relation below would be measuring an illegal document.
    expect(ObjectMapConfigSchema.safeParse(authoredEverything).success).toBe(true);
    expect(declared).toContain('style');
  });

  it('delivers every declared key, from a config carrying every declared key', async () => {
    const schema = await mapSchemaFor(authoredEverything);

    expect(undeliveredKeys(schema)).toEqual([]);
    // The map style specifically: it reaches the renderer under the spelling
    // `getMapConfig` reads, and the top-level CSS namespace stays untouched.
    expect(schema.mapStyle).toBe(authoredEverything.style);
    expect(Object.prototype.hasOwnProperty.call(schema, 'style')).toBe(false);
  });

  it('CONTROL — the same assertion REJECTS the pre-fix flatten, so the instrument can fail', () => {
    const preFixProduct = preFixFlatten(authoredEverything);

    // Named, not merely non-empty: the one key the pre-fix whitelist drops.
    expect(undeliveredKeys(preFixProduct)).toEqual(['style']);
    expect(() => expect(undeliveredKeys(preFixProduct)).toEqual([])).toThrow();
  });

  it('CONTROL — the narrowed `declared` set is what let the old pin pass', () => {
    // Reproduced from the pin this file replaces. Against THIS set the
    // pre-fix hand list was a perfect match, which is why it was green.
    const narrowed = declared.filter((key) => key !== 'style').sort();

    expect(narrowed).not.toContain('style');
    expect(preFixFlatten(authoredEverything)).not.toHaveProperty('style');
    expect(Object.keys(FLAT_MAP_CONFIG_SPELLING).sort()).not.toEqual(narrowed);
  });

  it('a config authoring ONLY `style` still delivers it — the single-key case a whitelist drops silently', async () => {
    const schema = await mapSchemaFor({ style: 'https://tiles.example.com/only.json' });

    expect(schema.mapStyle).toBe('https://tiles.example.com/only.json');
    expect(Object.prototype.hasOwnProperty.call(schema, 'style')).toBe(false);
  });

  it('forwards NO key the declaration does not carry — objectui#5177 still holds', async () => {
    // The keys the `map` block CONTRIBUTES to the product: what a fully
    // authored block adds over what an empty one produces. That set must be
    // exactly the image of the spelling table — nothing undeclared added,
    // nothing declared missing. Both directions, one assertion.
    // ⛔ `cleanup()` between the two renders is load-bearing, not tidiness: the
    // spy collects from EVERY mounted tree, so a second `render` in one test
    // leaves the first one free to re-render and append, and the baseline read
    // below would then be the other config's product (measured: `contributed`
    // came back empty, i.e. the assertion silently compared a product to
    // itself).
    const withNothing = await mapSchemaFor({});
    const baselineKeys = Object.keys(withNothing);
    cleanup();

    const withEverything = await mapSchemaFor({
      ...authoredEverything,
      totallyUndeclaredKey: 'nope',
      style2: 'nope',
      // ⛔ `mapStyle` is the flat OUTPUT spelling, not a declared member of
      // `ObjectMapConfigSchema` — writing it INSIDE the block is undeclared
      // authoring and must not travel. The whitelist is keyed on declared
      // SOURCE names; only `style` produces the `mapStyle` output below.
      mapStyle: 'nope',
    });
    const contributed = Object.keys(withEverything).filter((key) => !baselineKeys.includes(key));

    expect(contributed.sort()).toEqual([...Object.values(FLAT_MAP_CONFIG_SPELLING)].sort());
    expect(Object.prototype.hasOwnProperty.call(withEverything, 'totallyUndeclaredKey')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(withEverything, 'style2')).toBe(false);
    expect(withEverything.mapStyle).toBe(authoredEverything.style);
  });
});

/**
 * `FLAT_MAP_CONFIG_SPELLING` is hand-written in `ListView.tsx` itself (not derived
 * at runtime — see the comment on the constant for why), so THIS is the
 * mechanism that keeps it from silently drifting off `ObjectMapConfigSchema` —
 * the same role `packages/core/src/actions/__tests__/actionKeys.pin.test.ts`
 * plays for `SPEC_ACTION_KEYS`. A key added to or removed from the schema fails
 * this test by name, without requiring a runtime import of
 * `@object-ui/types/zod` from production code that reaches
 * `examples/console-starter`.
 *
 * The comparison set is the WHOLE declaration (objectui#9950). Nothing is
 * filtered out of it — that filter is what made the previous version of this
 * pin agree with the bug it was supposed to catch.
 */
describe('FLAT_MAP_CONFIG_SPELLING pins against ObjectMapConfigSchema (objectui#5177, objectui#9950)', () => {
  it('covers the declaration in full, so the table cannot silently drift', () => {
    const declared = Object.keys(ObjectMapConfigSchema.shape).sort();

    expect(Object.keys(FLAT_MAP_CONFIG_SPELLING).sort()).toEqual(declared);
  });
});
