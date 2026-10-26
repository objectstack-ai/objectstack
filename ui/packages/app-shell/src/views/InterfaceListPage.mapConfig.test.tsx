// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#5042, the interface-page seam.
 *
 * `ListView` learned to read the spec's view-level `map` block
 * (`ListMapConfigSchema`), but an ADR-0047 interface page builds the list-view
 * schema itself, and its map binding was assembled from `options.map` alone:
 *
 *     const mapCfg = (view.options as any)?.map ?? (allowedSet.has('map') ? … )
 *
 * So a referenced view declaring the typed block had it dropped one seam ABOVE
 * `ListView`, and the auto-derivation silently stood in for it — the same
 * declared-but-inert shape the card is about, on the path the showcase map page
 * actually renders through.
 *
 * The block is forwarded as `map` rather than folded into `mapCfg` with `??`
 * like the sibling bindings, and the third case here is why: `??` would let a
 * PARTIAL authored block replace the derivation wholesale, so
 * `map: { titleField: 'title' }` alone would drop the auto-derived
 * `locationField` and the page would render no markers at all. Forwarding both
 * lets `ListView` merge them per key, which is the precedence the card settled.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

vi.mock('react-router-dom', () => ({
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
  useNavigate: () => vi.fn(),
  useParams: () => ({}),
}));

vi.mock('@object-ui/i18n', async (importOriginal) => {
  const actual = await (importOriginal as any)();
  return {
    ...actual,
    useObjectTranslation: () => ({ t: (_k: string, o?: any) => o?.defaultValue ?? _k }),
  };
});

vi.mock('@object-ui/auth', async (importOriginal) => {
  const actual = await (importOriginal as any)();
  return { ...actual, useAuth: () => ({}) };
});

// Only the map-config half of the schema this page builds is under test.
vi.mock('@object-ui/plugin-list', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-list')>()),
  ListView: (props: any) => (
    <div
      data-testid="list-view-map-config"
      data-map={JSON.stringify(props?.schema?.map ?? null)}
      data-options-map={JSON.stringify(props?.schema?.options?.map ?? null)}
    />
  ),
}));

let testDataSource: any;
let testObjects: any[];

vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await (importOriginal as any)();
  return {
    ...actual,
    useAdapter: () => testDataSource,
    useMetadata: () => ({ objects: testObjects }),
  };
});

import { getRecordDisplayName } from '@object-ui/core';
import { InterfaceListPage, defaultMapFromObject } from './InterfaceListPage';

const OBJECT_NAME = 'showcase_task';
const VIEW_ID = `${OBJECT_NAME}.work_map`;

/** An object with a location-typed field, so `defaultMapFromObject` can derive. */
const makeObjectDef = (view: Record<string, unknown>) => ({
  name: OBJECT_NAME,
  fields: {
    title: { type: 'text' },
    location: { type: 'location' },
  },
  listViews: {
    [VIEW_ID]: { name: VIEW_ID, type: 'map', columns: ['title', 'location'], ...view },
  },
});

const page = {
  name: 'showcase_task_map',
  label: 'Work Map',
  interfaceConfig: {
    source: OBJECT_NAME,
    sourceView: 'work_map',
    recordAction: 'none',
    appearance: { allowedVisualizations: ['map'] },
  },
};

async function renderWith(view: Record<string, unknown>) {
  testDataSource = {};
  testObjects = [makeObjectDef(view)];
  render(<InterfaceListPage page={page as any} />);
  await waitFor(() => expect(screen.queryByTestId('list-view-map-config')).not.toBeNull());
  const el = screen.getByTestId('list-view-map-config');
  return {
    map: JSON.parse(el.getAttribute('data-map') || 'null'),
    optionsMap: JSON.parse(el.getAttribute('data-options-map') || 'null'),
  };
}

describe('InterfaceListPage forwards the view-level `map` block (objectui#5042)', () => {
  beforeEach(() => {
    testDataSource = undefined;
    testObjects = [];
  });

  // THE DISCRIMINATING ARM — before the fix `map` was `null` here.
  it('forwards the referenced view’s spec `map` block verbatim', async () => {
    const { map } = await renderWith({
      map: { locationField: 'location', titleField: 'title', zoom: 9 },
    });

    expect(map).toEqual({ locationField: 'location', titleField: 'title', zoom: 9 });
  });

  it('CONTROL: with no view-level block, no `map` key is emitted at all', async () => {
    const { map, optionsMap } = await renderWith({});

    expect(map).toBeNull();
    // …and the ADR-0047 auto-derivation still fires — with `locationField`, the
    // map's own required binding, and nothing else. The derived `titleField`
    // that objectui#5909 added to this product was removed in objectui#6343:
    // it reached `getRecordDisplayName` as `options.titleField`, i.e. step 0,
    // where a name this page guessed outranked the object's own declaration.
    expect(optionsMap).toEqual({ locationField: 'location' });
  });

  it('keeps the auto-derived binding ALONGSIDE a partial authored block', async () => {
    // The case that rules out folding the block into `mapCfg` with `??`: the
    // author declared only a marker-title field, and the coordinate binding
    // still has to come from the derivation. `ListView` merges the two per
    // key; a `??` here would have discarded one of them.
    //
    // Sharper since objectui#6343 removed the derived title: the two sides no
    // longer overlap at all. The AUTHOR owns `titleField` — declared, and
    // honoured at the resolver's step 0 — and the derivation owns
    // `locationField`. Each key has exactly one source.
    const { map, optionsMap } = await renderWith({ map: { titleField: 'title' } });

    expect(map).toEqual({ titleField: 'title' });
    expect(optionsMap).toEqual({ locationField: 'location' });
  });

  it('CONTROL: the legacy `options.map` bag is still forwarded on its own path', async () => {
    const { map, optionsMap } = await renderWith({
      options: { map: { locationField: 'location', titleField: 'legacy_title' } },
    });

    expect(map).toBeNull();
    expect(optionsMap).toEqual({ locationField: 'location', titleField: 'legacy_title' });
  });
});

/**
 * objectui#6343 — the derived marker-title binding is GONE, and the object's
 * own declaration keeps its authority.
 *
 * ## Why the binding was removed rather than re-narrated
 *
 * It was added (objectui#5909) to route around a forge that no longer exists:
 * `getMapConfig` used to fill an absent `titleField` with the literal `'name'`
 * and the marker title was a plain `record[titleField]` read, so an object
 * whose display field was not `name` titled every popup `undefined`.
 * objectui#5953 deleted that forge — `ObjectMap` now resolves marker titles
 * through `@object-ui/core#getRecordDisplayName`, exactly like `ObjectKanban`,
 * `ObjectCalendar` and `ObjectGantt` do, and exactly like no sibling deriver
 * binds a title.
 *
 * What was left behind was not a redundancy but an INVERSION. The binding
 * arrives at the resolver as `options.titleField`, which is precedence **step
 * 0** — ahead of the declared `nameField` pointer and its `displayNameField`
 * alias at step 1/2, ahead of the legacy `titleFormat` template at step 3, and
 * ahead of the type-aware derivation from `objectDef.fields` at step 4.
 * Measured against the resolver's ladder, a field name this page picked can
 * only ever change the answer by OUT-RANKING something the object itself
 * declared; in every other case it reproduces, at step 0, the string the
 * resolver already computes at step 1/2/4. That is the whole of its effect,
 * which is why it goes rather than gets described.
 *
 * The ladder carries NO object-level `titleField` rung — the middle term this
 * passage used to name. It was never a step of its own: it was a second `??`
 * leg inside step 0, deleted in objectui#6531 because `@objectstack/spec`'s
 * object schema is a `strictObject` that REJECTS the key with
 * `unrecognized_keys` — the same issue code a nonsense key gets — so no
 * spec-compliant object could ever supply it. See the `getRecordDisplayName`
 * docblock in `@object-ui/core`'s `record-title.ts` for the ladder in full.
 *
 * These arms pin both halves: the product no longer carries a title binding
 * (shape), and the declared side therefore decides at the read site
 * (semantics). The arms that used to pin the derivation are retired with it.
 */
describe('defaultMapFromObject binds no marker title (objectui#6343)', () => {
  const loc = { type: 'location' };

  // THE DISCRIMINATING ARM — the exact fixture objectui#5909 introduced the
  // binding for. An object whose display field is `title`, not `name`: the
  // deriver used to answer `{ locationField, titleField: 'title' }`.
  it('binds only `locationField` when a display field IS derivable', () => {
    const derived = defaultMapFromObject({ fields: { title: { type: 'text' }, location: loc } });
    expect(derived).toEqual({ locationField: 'location' });
    expect(derived && 'titleField' in derived).toBe(false);
  });

  // A DECLARED pointer is not a licence to bind either — the resolver reads
  // `nameField` itself, at step 1, from the same object definition.
  it('binds nothing from a declared `nameField` / `displayNameField` either', () => {
    const fields = { headline: { type: 'text' }, title: { type: 'text' }, location: loc };
    expect(defaultMapFromObject({ nameField: 'headline', fields })).toEqual({
      locationField: 'location',
    });
    expect(defaultMapFromObject({ displayNameField: 'headline', fields })).toEqual({
      locationField: 'location',
    });
  });

  // THE AUTHORITY ARM — semantics, not shape, and the reason this is a
  // behaviour change rather than a comment repair. `titleFormat` is a DECLARED
  // (deprecated, still live) object key that the resolver honours at step 3.
  // A derived binding at step 0 outranked it; with no binding, the object's
  // own declaration decides.
  it('leaves a declared `titleFormat` its authority at the read site', () => {
    const objectDef = {
      titleFormat: '{code} · {city}',
      fields: {
        code: { type: 'text' },
        city: { type: 'text' },
        title: { type: 'text' },
        location: loc,
      },
    };
    const record = { code: 'D4', city: 'Leeds', title: 'Raw title', location: 'x' };
    const product = defaultMapFromObject(objectDef);

    expect(product).toEqual({ locationField: 'location' });

    // `ObjectMap`'s read site, verbatim: the product's `titleField` (now
    // absent) is passed as `options.titleField`.
    expect(
      getRecordDisplayName(objectDef, record, { titleField: (product as any)?.titleField }),
    ).toBe('D4 · Leeds');

    // …and this is what the derived binding used to force instead: the field
    // `deriveTitleField` ranks first, evaluated at step 0, silently beating the
    // template the object declared. Pinned so the inversion cannot come back
    // unnoticed.
    expect(getRecordDisplayName(objectDef, record, { titleField: 'title' })).toBe('Raw title');
  });

  // POSITIVE CONTROL — removal loses no titles. With nothing declared, the
  // resolver's own step 4 is the same scan the binding used to hoist to step 0,
  // so the marker still reads the affix-convention display field.
  it('CONTROL: the resolver alone still answers what the binding used to force', () => {
    const objectDef = { fields: { site_name: { type: 'text' }, location: loc } };
    const record = { site_name: 'Depot 4', location: 'x' };

    expect(defaultMapFromObject(objectDef)).toEqual({ locationField: 'location' });
    expect(getRecordDisplayName(objectDef, record)).toBe('Depot 4');
  });

  // CONTROL — the deriver's own required field is untouched by this change:
  // no location field still derives nothing at all.
  it('CONTROL: no location field still derives nothing at all', () => {
    expect(defaultMapFromObject({ fields: { title: { type: 'text' } } })).toBeUndefined();
  });
});
