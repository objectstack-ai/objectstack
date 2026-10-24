/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8220 — the two QUERY keys `ObjectMap` lowers onto its fetch,
 * `filter` and `sort`, are DECLARED authoring surface on the one tag this
 * renderer is published under. The `object-map` sibling of the pins with the
 * same name in `@object-ui/plugin-gantt` and `@object-ui/plugin-timeline`, and
 * the same defect objectui#7712 (`filter`) and objectui#8171 (`sort`) closed on
 * the kanban and the calendar.
 *
 * ## The defect this pins closed
 *
 * `ObjectMap.tsx` sends both authored keys to the query — `$filter:
 * queryFilter` (the authored `filter`, its context tokens resolved by
 * `useResolvedFilter`) and `$orderby: convertSortToQueryParams(schema.sort)`,
 * on the object fetch and on the inline rows alike. The registration listed
 * neither in `inputs`, so `sdui-parser`'s `validateTree` answered each with
 * `unknown-prop`: the html tier told an author that two keys the renderer
 * honours are unknown, steering them to delete working metadata.
 *
 * ## Why declaring is not a widening past the contract
 *
 * `@objectstack/spec` 17.5.0 maps `object-map` in `ComponentPropsMap`, and the
 * row declares both keys — `filter` as the `ViewFilterRule` ARRAY
 * (`[{ field, operator, value }, ...]`, the record form refused by name) and
 * `sort` as the `SortItem` array. The spec-first order this card was held for
 * is met on the INSTALLED package, which row 6 below reads rather than
 * assumes. `type: 'array'` is the arm declared for both: for `filter` that is
 * the rule-array arm and nothing else, so the record form draws a
 * `type-mismatch` here exactly as the spec refuses it (row 3).
 *
 * ## The rows, and what makes each a reading
 *
 * 1. THE HTML TIER ACCEPTS IT — the real validator over a manifest built from
 *    the LIVE registry, never a hand-written one that could agree with itself.
 *    Red before this change, green after it.
 * 2. THE DECLARED ARM FITS — no `type-mismatch` for the shape the spec accepts.
 * 3. THE RECORD FORM IS REFUSED ON BOTH FACES — the html tier draws
 *    `type-mismatch` on a MongoDB-style `filter` record and the spec refuses it
 *    at `filter`, so the declaration did not land the retired shape.
 * 4. THE CONTROL — a key nobody declares is still `unknown-prop`, so row 1's
 *    empty answer is a verdict and not a validator that reports nothing.
 * 5. THE DECLARATION, read straight off the registry, with `objectName` as its
 *    non-vacuity control.
 * 6. THE CONTRACT AGREES — a full `safeParse` of the spec row succeeds on the
 *    authored values (a VALUE verdict: the arm, not only the key), and the same
 *    strict row still refuses an undeclared key.
 * 7. THE RENDERER HONOURS IT — mounted through the real `SchemaRenderer` and the
 *    registered renderer, the authored rule array reaches `find` as `$filter`
 *    and the sort items reach it as the `field -> direction` map on `$orderby`;
 *    the unauthored control sends neither. "Declared = enforced", per
 *    registration.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
import { ComponentPropsMap } from '@objectstack/spec/ui';
import { manifestFromConfigs, validateTree } from '@object-ui/sdui-parser';

// No WebGL in the test env — same stub the sibling ObjectMap pins use. Every
// assertion here is about the declaration or the QUERY, not the canvas.
vi.mock('react-map-gl/maplibre', () => ({
  default: ({ children }: any) => <div aria-label="Map">{children}</div>,
  Map: ({ children }: any) => <div aria-label="Map">{children}</div>,
  NavigationControl: () => <div data-testid="nav-control" />,
  Marker: ({ children }: any) => <div data-testid="map-marker">{children}</div>,
  Popup: ({ children }: any) => <div data-testid="map-popup">{children}</div>,
}));

// Module scope, not a hook: this import IS the registration (AGENTS.md's
// test-discipline section).
import '../index';

afterEach(cleanup);

/** The one tag this renderer is published under since objectui#10393. */
const MAP_TAGS = [{ tagLabel: 'object-map', type: 'object-map', namespace: 'plugin-map' }] as const;

const SPEC_ROW = 'object-map';
const OBJECT = 'store';
const MAP = { latitudeField: 'lat', longitudeField: 'lng', titleField: 'name' };

/** The spec's `ViewFilterRule` array — the one arm `filter` is declared on. */
const AUTHORED_FILTER = [{ field: 'rating', operator: 'equals', value: 'hot' }];
/** The spec's `SortItem` array. */
const AUTHORED_SORT = [{ field: 'name', order: 'desc' }];
/** The MongoDB-style record form the spec refuses at every `filter` door. */
const RECORD_FORM_FILTER = { rating: 'hot' };

const QUERY_KEYS = [
  { key: 'filter', lowersTo: '$filter', authored: AUTHORED_FILTER },
  { key: 'sort', lowersTo: '$orderby', authored: AUTHORED_SORT },
] as const;

/** Every (tag, key) pair — so a registration that omits one key reddens alone. */
const CASES = MAP_TAGS.flatMap((tag) =>
  QUERY_KEYS.map((k) => ({ ...tag, ...k, label: `${tag.tagLabel} · ${k.key}` })),
);

const declaredInputs = (type: string, namespace?: string): any[] =>
  ((ComponentRegistry.getConfig(type, namespace) as any)?.inputs ?? []);

/** A manifest built from the live registry, the way `gen-manifest.ts` builds it. */
const liveManifest = () =>
  manifestFromConfigs(
    ComponentRegistry.getKnownTypes().map((type) => {
      const meta = ComponentRegistry.getMeta(type);
      return { type, namespace: meta?.namespace, isContainer: meta?.isContainer, inputs: meta?.inputs };
    }) as unknown as Parameters<typeof manifestFromConfigs>[0],
  );

/** Messages of one diagnostic code that a one-node document draws for `props`. */
const diagnosticsOf = (type: string, props: Record<string, unknown>, code: string): string[] =>
  validateTree({ type, objectName: OBJECT, map: MAP, ...props } as never, liveManifest())
    .diagnostics.filter((d) => d.code === code)
    .map((d) => d.message);

const specRow = () => (ComponentPropsMap as Record<string, any>)[SPEC_ROW];

describe('objectui#8220 — object-map publishes the query keys it reads', () => {
  it.each(CASES)('$label — the html tier accepts the authored key', ({ type, key, lowersTo, authored }) => {
    expect(
      diagnosticsOf(type, { [key]: authored }, 'unknown-prop'),
      `<${type}> reports the spec-declared \`${key}\` as unknown while ObjectMap.tsx sends it as ${lowersTo}`,
    ).toEqual([]);
  });

  it.each(CASES)('$label — the declared `array` arm accepts the spec shape', ({ type, key, authored }) => {
    expect(diagnosticsOf(type, { [key]: authored }, 'type-mismatch')).toEqual([]);
  });

  it.each(MAP_TAGS)('$tagLabel — the record-form filter is refused on both faces', ({ type }) => {
    expect(diagnosticsOf(type, { filter: RECORD_FORM_FILTER }, 'type-mismatch')).toHaveLength(1);
    const parsed = specRow().safeParse({ objectName: OBJECT, filter: RECORD_FORM_FILTER });
    expect(parsed.success).toBe(false);
    expect(parsed.error.issues.map((issue: any) => issue.path[0])).toEqual(['filter']);
  });

  it.each(MAP_TAGS)('$tagLabel — control: a genuinely unknown prop is still reported', ({ type }) => {
    expect(diagnosticsOf(type, { bogusProp: AUTHORED_FILTER }, 'unknown-prop')).toEqual([
      `<${type}> has no prop "bogusProp"`,
    ]);
  });

  it.each(CASES)('$label — the registration declares it as an array', ({ type, namespace, key }) => {
    const inputs = declaredInputs(type, namespace);
    const names = inputs.map((i: any) => i.name);
    // Non-vacuity: an empty read (wrong type/namespace) fails both lines rather
    // than silently passing one.
    expect(names, `${type} inputs`).toContain('objectName');
    expect(names, `${type} inputs`).toContain(key);
    expect(inputs.find((i: any) => i.name === key)?.type).toBe('array');
  });

  it('the spec row accepts both authored values, so this declares rather than widens', () => {
    expect(specRow(), `${SPEC_ROW} is not in the installed ComponentPropsMap`).toBeDefined();
    const parsed = specRow().safeParse({ objectName: OBJECT, filter: AUTHORED_FILTER, sort: AUTHORED_SORT });
    expect(parsed.error?.issues ?? []).toEqual([]);
    expect(parsed.success).toBe(true);
    // The control for that verdict: the same strict row DOES refuse a key it
    // never declared, so "accepted" is a reading and not a schema that takes
    // everything.
    const bogus = specRow().safeParse({ objectName: OBJECT, bogusProp: AUTHORED_FILTER });
    expect(bogus.success).toBe(false);
    expect(bogus.error.issues.flatMap((issue: any) => issue.keys ?? [])).toContain('bogusProp');
  });
});

function makeDataSource() {
  return {
    find: vi.fn().mockResolvedValue({ data: [] }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue({
      name: OBJECT,
      fields: {
        name: { type: 'text' },
        rating: { type: 'text' },
        lat: { type: 'number' },
        lng: { type: 'number' },
      },
    }),
  };
}

/** Mount one node through the real `SchemaRenderer` and read the first query. */
async function firstQuery(node: Record<string, unknown>): Promise<[string, any]> {
  const dataSource = makeDataSource();
  render(
    <SchemaRendererProvider dataSource={dataSource as any}>
      <SchemaRenderer schema={{ objectName: OBJECT, map: MAP, ...node } as any} />
    </SchemaRendererProvider>,
  );
  await waitFor(() => expect(dataSource.find).toHaveBeenCalled());
  return dataSource.find.mock.calls[0] as [string, any];
}

describe('objectui#8220 — the object-map registration honours the keys it declares', () => {
  it.each(MAP_TAGS)('$tagLabel — the rule array reaches $filter and the sort items reach $orderby', async ({ type }) => {
    const [object, params] = await firstQuery({ type, filter: AUTHORED_FILTER, sort: AUTHORED_SORT });
    expect(object).toBe(OBJECT);
    expect(params.$filter).toEqual(AUTHORED_FILTER);
    expect(params.$orderby).toEqual({ name: 'desc' });
  });

  it.each(MAP_TAGS)('$tagLabel — control: an unauthored filter and sort reach the wire as undefined', async ({ type }) => {
    const [object, params] = await firstQuery({ type });
    // Non-vacuity: the call really happened against the object.
    expect(object).toBe(OBJECT);
    expect(params.$filter).toBeUndefined();
    expect(params.$orderby).toBeUndefined();
  });
});
