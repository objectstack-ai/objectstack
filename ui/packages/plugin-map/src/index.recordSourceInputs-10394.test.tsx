/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10394 — the map registration declares the two record sources
 * `ObjectMapSchema` already declares: `data` and `staticData`.
 *
 * Without an input, `sdui-parser`'s `validateTree` reported a block authored on
 * either key as `unknown-prop` (the objectui#7712 shape) while the schema
 * accepted it and the renderer drew it. objectui#7470 dropped `required` from
 * `objectName` and did not order these two, so they were left out then.
 *
 * ## The rows
 *
 * Declaration, on the one registration key (`object-map`; the bare `map` key
 * is retired, objectui#10393):
 * 1. The html tier accepts a block authored on `staticData` alone, and on a
 *    `data` configuration alone — no diagnostic at all.
 * 2. Control for row 1: a bogus key is still reported, on a node bound by
 *    `objectName` so the row holds before and after the fix alike.
 * 3. The registration declares both keys (`objectName` as non-vacuity).
 * 4. Each declared ARM is the schema's own, read from `ObjectMapSchema` with
 *    the refused spelling as the control, and the html tier enforces it: a
 *    bare array under `data` draws `type-mismatch`.
 * 5. Each description names the position it is true about.
 *
 * Behaviour, through the real `SchemaRenderer` — the claims the descriptions
 * make, measured rather than assumed:
 * 6. `data` wins over `staticData` and `objectName`; `staticData` wins over
 *    `objectName`; neither inline source queries the object.
 * 7. A bare array under `data` is not a record source: `staticData` beside it
 *    is what is plotted.
 * 8. A block that still says the retired view-level `api` provider
 *    (objectstack#23082, objectui#12325) plots no markers here, queries
 *    nothing, and still shadows `staticData`. The `data` description does not
 *    name it: a view binds `object` or `value` (objectui#12364).
 *
 * `filter` / `sort` on the inline rungs are pinned by
 * `ObjectMap.inlineQueryKeys-9061.test.tsx` (its `staticDataSpelling` row),
 * not repeated here.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('react-map-gl/maplibre', () => ({
  default: (props: any) => <div aria-label="Map">{props.children}</div>,
  Map: ({ children }: any) => <div aria-label="Map">{children}</div>,
  NavigationControl: () => null,
  Marker: ({ children, longitude, latitude }: any) => (
    <div data-testid="map-marker" data-lat={latitude} data-lng={longitude}>
      {children}
    </div>
  ),
  Popup: () => null,
}));

import { ComponentRegistry } from '@object-ui/core';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
import { ObjectMapSchema } from '@object-ui/types/zod';
import { manifestFromConfigs, validateTree } from '@object-ui/sdui-parser';
import type { DataSource } from '@object-ui/types';
// Module scope, not a hook: this import IS the registration (AGENTS.md
// test-discipline section).
import './index';
import './__tests__/webgl2Available';

const MAP_KEYS = [
  { label: 'object-map', type: 'object-map', namespace: 'plugin-map' },
] as const;

const MAP = { latitudeField: 'latitude', longitudeField: 'longitude', titleField: 'name' };
const DATA_ROWS = [
  { id: 'd1', name: 'D1', latitude: 40, longitude: -74 },
  { id: 'd2', name: 'D2', latitude: 41, longitude: -75 },
];
const STATIC_ROWS = [{ id: 's1', name: 'S1', latitude: 51, longitude: -1 }];
const VALUE_CONFIG = { provider: 'value', items: DATA_ROWS };

const declaredInputs = (type: string, namespace: string): any[] =>
  ((ComponentRegistry.getConfig(type, namespace) as any)?.inputs ?? []);

const declaredInput = (type: string, namespace: string, key: string): any =>
  declaredInputs(type, namespace).find((i: any) => i.name === key);

const liveManifest = () =>
  manifestFromConfigs(
    ComponentRegistry.getKnownTypes().map((type) => {
      const meta = ComponentRegistry.getMeta(type);
      return { type, namespace: meta?.namespace, isContainer: meta?.isContainer, inputs: meta?.inputs };
    }) as unknown as Parameters<typeof manifestFromConfigs>[0],
  );

const diagnosticsOf = (node: Record<string, unknown>) =>
  validateTree(node as never, liveManifest()).diagnostics;

const schemaAccepts = (props: Record<string, unknown>): boolean =>
  ObjectMapSchema.safeParse({ type: 'object-map', map: MAP, ...props }).success;

/** The clause each description must keep — fragments, so a wording pass does not red this file. */
const POSITION_PHRASES: Record<string, string[]> = {
  data: [
    '`{ provider, … }` data-source configuration',
    'read FIRST',
    'never reaches `staticData`',
    'A bare array is not this key’s shape',
  ],
  staticData: ['read SECOND', 'a `data` configuration wins', '`objectName` is read AFTER it'],
};

describe('objectui#10394 — the map registration declares data and staticData', () => {
  it.each(MAP_KEYS)('$label — the html tier accepts a staticData-only map', ({ type }) => {
    expect(diagnosticsOf({ type, map: MAP, staticData: STATIC_ROWS })).toEqual([]);
  });

  it.each(MAP_KEYS)('$label — the html tier accepts a map on a data configuration alone', ({ type }) => {
    expect(diagnosticsOf({ type, map: MAP, data: VALUE_CONFIG })).toEqual([]);
  });

  it.each(MAP_KEYS)('$label — control: a bogus key is still reported', ({ type }) => {
    expect(
      diagnosticsOf({ type, map: MAP, objectName: 'store', bogusProp: 'x' }).map((d) => [d.code, d.message]),
    ).toEqual([['unknown-prop', `<${type}> has no prop "bogusProp"`]]);
  });

  it.each(MAP_KEYS)('$label — the registration declares data and staticData', ({ type, namespace }) => {
    const names = declaredInputs(type, namespace).map((i: any) => i.name);
    expect(names, `${type} inputs`).toContain('objectName');
    expect(names, `${type} inputs`).toContain('data');
    expect(names, `${type} inputs`).toContain('staticData');
  });

  it.each(MAP_KEYS)(
    '$label — each declared arm is the schema arm, and the html tier enforces it',
    ({ type, namespace }) => {
      expect(declaredInput(type, namespace, 'data').type).toBe('object');
      expect(declaredInput(type, namespace, 'staticData').type).toBe('array');
      // The schema's verdicts, each with the spelling it refuses as the control.
      expect(schemaAccepts({ data: VALUE_CONFIG }), 'ObjectMapSchema refuses a data configuration').toBe(true);
      expect(schemaAccepts({ data: DATA_ROWS }), 'ObjectMapSchema accepts a bare array under data').toBe(false);
      expect(schemaAccepts({ staticData: STATIC_ROWS }), 'ObjectMapSchema refuses staticData rows').toBe(true);
      expect(schemaAccepts({ staticData: VALUE_CONFIG }), 'ObjectMapSchema accepts an object under staticData').toBe(false);
      // The html tier says the same about the bare array.
      expect(diagnosticsOf({ type, map: MAP, data: DATA_ROWS }).map((d) => d.code)).toEqual(['type-mismatch']);
    },
  );

  it.each(MAP_KEYS)('$label — each description names the position it is true about', ({ type, namespace }) => {
    for (const [key, phrases] of Object.entries(POSITION_PHRASES)) {
      const description: string = declaredInput(type, namespace, key)?.description ?? '';
      expect(description.length, `${key} publishes no description`).toBeGreaterThan(40);
      for (const phrase of phrases) {
        expect(description, `${key}'s description lost "${phrase}"`).toContain(phrase);
      }
    }
  });
});

const makeDataSource = (): DataSource =>
  ({
    find: vi.fn().mockResolvedValue({ data: [{ id: 'f1', name: 'F1', latitude: 1, longitude: 2 }] }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue({ fields: {} }),
  }) as unknown as DataSource;

/** Render one node through the real `SchemaRenderer` and read what it plotted. */
async function plot(type: string, node: Record<string, unknown>) {
  const dataSource = makeDataSource();
  render(
    <SchemaRendererProvider dataSource={dataSource}>
      <SchemaRenderer schema={{ type, map: MAP, ...node } as any} />
    </SchemaRendererProvider>,
  );
  await waitFor(() => expect(screen.queryByText('Loading map...')).toBeNull());
  const lats = screen.queryAllByTestId('map-marker').map((m) => m.getAttribute('data-lat'));
  const queried = (dataSource.find as any).mock.calls.map((call: any[]) => call[0]);
  return { lats, queried };
}

const latsOf = (rows: Array<{ latitude: number }>) => rows.map((r) => String(r.latitude));

describe('objectui#10394 — what the declared descriptions claim, through SchemaRenderer', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  afterEach(() => warn?.mockRestore());

  it.each(MAP_KEYS)('$label — data wins over staticData and objectName, and queries nothing', async ({ type }) => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { lats, queried } = await plot(type, {
      data: VALUE_CONFIG,
      staticData: STATIC_ROWS,
      objectName: 'account',
    });
    expect(lats).toEqual(latsOf(DATA_ROWS));
    expect(queried).toEqual([]);
  });

  it.each(MAP_KEYS)('$label — staticData wins over objectName, and queries nothing', async ({ type }) => {
    const { lats, queried } = await plot(type, { staticData: STATIC_ROWS, objectName: 'account' });
    expect(lats).toEqual(latsOf(STATIC_ROWS));
    expect(queried).toEqual([]);
  });

  it.each(MAP_KEYS)('$label — control: objectName alone is queried', async ({ type }) => {
    const { queried } = await plot(type, { objectName: 'account' });
    expect(queried).toContain('account');
  });

  it.each(MAP_KEYS)('$label — an object provider queries its object, never objectName', async ({ type }) => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { queried } = await plot(type, {
      data: { provider: 'object', object: 'store' },
      objectName: 'account',
    });
    expect(queried).toContain('store');
    expect(queried).not.toContain('account');
  });

  it.each(MAP_KEYS)('$label — a bare array under data is not a record source', async ({ type }) => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { lats } = await plot(type, { data: DATA_ROWS, staticData: STATIC_ROWS });
    expect(lats).toEqual(latsOf(STATIC_ROWS));
  });

  // objectui#12325 — the view-level `api` data source is retired in the spec
  // (objectstack#23082). The map's `api` arm, which only warned "not yet
  // implemented", is deleted: a block that still says `api` plots nothing,
  // queries nothing, still shadows `staticData`, and no arm answers for it.
  it.each(MAP_KEYS)('$label — a retired api block plots no markers, still shadows staticData, and has no arm', async ({ type }) => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { lats, queried } = await plot(type, {
      data: { provider: 'api', read: { url: '/api/stores' } },
      staticData: STATIC_ROWS,
    });
    expect(lats).toEqual([]);
    expect(queried).toEqual([]);
    expect(warn.mock.calls.map((call: unknown[]) => String(call[0]))).not.toContain(
      'API provider not yet implemented for ObjectMap',
    );
  });
});
