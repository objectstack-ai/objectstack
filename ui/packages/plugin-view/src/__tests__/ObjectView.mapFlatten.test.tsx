/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The map schema this view PRODUCES — and the one property that makes
 * objectui#5018's precedence flip safe.
 *
 * `generateViewSchema('map')` builds an `object-map` schema by spreading the
 * CONTENTS of `options.map` at the top level. The product therefore carries the
 * flat spelling and **no `map` key at all**. (It used to add a `locationField`
 * floored at `'location'`; that floor was deleted by objectui#8169 together
 * with `getMapConfig`'s own coordinate guesses — bindings are never
 * fabricated.)
 *
 * That is load-bearing, not incidental. The maintainer ruling on objectui#5018
 * (2026-08-17, 「同意」) made the `map` block outrank the flat spelling inside
 * `ObjectMap.getMapConfig`, reversing the previous order. The flip can only
 * change what a view renders if some schema carries BOTH spellings — so the
 * question "is the flip safe for the producer path" reduces exactly to "does the
 * flattener emit a `map` key", and the answer is pinned here rather than left to
 * be re-derived by whoever next edits this branch.
 *
 * If a future change makes this branch emit `map: {...}` (a reasonable-looking
 * cleanup!), the flat keys it emits alongside would become silently ignored
 * shadows. This test goes red first, which is the point.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import { ObjectView, FLAT_MAP_CONFIG_SPELLING } from '../ObjectView';
import type { ObjectViewSchema } from '@object-ui/types';
// Test-only: `ObjectView.tsx` hand-writes `FLAT_MAP_CONFIG_SPELLING` rather
// than importing this schema at runtime, precisely so this module never
// appears in `examples/console-starter`'s walked import graph (see the comment
// on the constant). A test file is explicitly excluded from that walk, so
// pinning against the real declaration HERE is safe.
import { ObjectMapConfigSchema } from '@object-ui/types/zod';

/** Every schema the view hands to SchemaRenderer, in order. */
const rendered: any[] = [];

vi.mock('@object-ui/react', async (importOriginal) => {
  const React = await import('react');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    SchemaRenderer: ({ schema }: any) => {
      rendered.push(schema);
      return <div data-testid="schema-renderer">{schema?.type}</div>;
    },
    SchemaRendererContext: React.createContext(null),
    subscribeDataChanges: () => () => {},
    notifyDataChanged: () => {},
  };
});
vi.mock('@object-ui/plugin-grid', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ObjectGrid: () => <div data-testid="object-grid" />,
}));
vi.mock('@object-ui/plugin-form', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ObjectForm: () => <div data-testid="object-form" />,
}));

async function renderMapView(mapOptions: Record<string, unknown>) {
  rendered.length = 0;
  const ds: any = {
    find: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue({ name: 'store', fields: {} }),
  };
  render(
    <ObjectView
      schema={{ type: 'object-view', objectName: 'store' } as ObjectViewSchema}
      views={[{ id: 'm', label: 'Map', type: 'map' as any, map: mapOptions }]}
      dataSource={ds}
    />,
  );
  await waitFor(() => expect(rendered.length).toBeGreaterThan(0));
  return rendered[rendered.length - 1];
}

describe('ObjectView flattens `options.map` and emits NO `map` key (objectui#5018)', () => {
  it('produces an object-map schema carrying the FLAT spelling', async () => {
    const schema = await renderMapView({
      latitudeField: 'lat',
      longitudeField: 'lng',
      titleField: 'store_name',
    });

    expect(schema.type).toBe('object-map');
    expect(schema.latitudeField).toBe('lat');
    expect(schema.longitudeField).toBe('lng');
    expect(schema.titleField).toBe('store_name');
  });

  it('emits no `map` key, so the `map`-block-wins rule cannot shadow it', async () => {
    const schema = await renderMapView({
      latitudeField: 'lat',
      longitudeField: 'lng',
    });

    expect(Object.prototype.hasOwnProperty.call(schema, 'map')).toBe(false);
    expect(schema.map).toBeUndefined();
  });

  it('emits NO `locationField` floor when nothing is configured (objectui#8169)', async () => {
    const schema = await renderMapView({});

    // Ruled 2026-09-07 「同意」 (option B): the floor and `getMapConfig`'s
    // coordinate guesses went in one change, so an undeclared map view now
    // produces a schema with no binding in it and `ObjectMap` refuses rather
    // than painting an empty map. ⛔ Deleting this floor alone would have
    // WIDENED the guess (the floor forced the component's flat branch, which
    // carries no `latitudeField` / `longitudeField`); the joined behaviour is
    // pinned in `plugin-map/src/ObjectMap.unboundRefusal-8169.test.tsx`.
    expect(schema.locationField).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(schema, 'locationField')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(schema, 'map')).toBe(false);
  });
});

/**
 * objectui#5177 — the flatten above used to be a WHOLE-BAG spread
 * (`...(viewOptions.map || {})`), so any key an author wrote in the `map`
 * block landed at the top level, including keys `ObjectMap`'s
 * `FlatMapConfigKeys = Omit<ObjectMapConfig, 'style'>` declares OUT of this
 * flat form. `style` is the specimen the card measured: it collides with
 * `BaseSchema.style` (inline CSS, legal on every node), so a `map: { style:
 * '<url>' }` authoring intent arrived as a top-level CSS-shaped key.
 *
 * These pin the whitelist (`FLAT_MAP_CONFIG_SPELLING`, hand-written in
 * `ObjectView.tsx` itself — ⛔ NOT derived from `ObjectMapConfigSchema` at
 * runtime there, see the comment on that constant for why) rather than the raw
 * spread: a declared key still travels, an arbitrary undeclared one does not,
 * and the top-level `style` namespace is never written.
 *
 * objectui#9950 — `style` is no longer DROPPED either. It is delivered under
 * its flat spelling `mapStyle`, which is what `ObjectMap.getMapConfig` reads
 * (`schema.mapStyle || schema.map?.style`) and a declared member of
 * `ObjectMapSchema`; the top-level `style` it must not collide with stays the
 * base face's inline CSS.
 */
describe('ObjectView flattens `map` through a whitelist, not a raw spread (objectui#5177)', () => {
  it('still reaches a declared key (locationField) in the flattened product', async () => {
    const schema = await renderMapView({ locationField: 'geo' });

    expect(schema.locationField).toBe('geo');
  });

  it('does NOT let `style` in the `map` block reach the TOP-LEVEL `style` — it travels as `mapStyle`', async () => {
    const schema = await renderMapView({
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
    const schema = await renderMapView({
      latitudeField: 'lat',
      totallyUndeclaredKey: 'nope',
    });

    expect(schema.latitudeField).toBe('lat');
    expect(schema.totallyUndeclaredKey).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(schema, 'totallyUndeclaredKey')).toBe(false);
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
    const schema = await renderMapView(authoredEverything);

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
    const schema = await renderMapView({ style: 'https://tiles.example.com/only.json' });

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
    const withNothing = await renderMapView({});
    const baselineKeys = Object.keys(withNothing);
    cleanup();

    const withEverything = await renderMapView({
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
 * `FLAT_MAP_CONFIG_SPELLING` is hand-written in `ObjectView.tsx` itself (not derived
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
