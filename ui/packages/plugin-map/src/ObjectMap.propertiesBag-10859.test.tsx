/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * An authored `object-map` writes its props in the spec's `properties` bag,
 * and the bag draws what the flat spelling drew (objectui#10859, batch 5).
 *
 * `@object-ui/types` now arms the authored node from
 * `ComponentPropsMap['object-map']`: `{ type: 'object-map', properties: { … } }`
 * validates, and the flat spelling is refused by name
 * (`object-map-properties-bag-10859-b5.test.ts` holds both faces). That move is
 * only safe if the renderer reads the bag, so this file renders the node
 * through the real registry and a recording adapter:
 *
 *  - the bag queries its `objectName` with its own `filter` and `sort`, and
 *    plots one marker per returned row;
 *  - the flat spelling, which code still composes (`ObjectView` / `ListView`
 *    flatten a stored map view), makes the identical call and draws the same
 *    markers: `SchemaRenderer` hoists the bag onto the node before `ObjectMap`
 *    reads it;
 *  - a bag bound through the node's `dataSource` queries the bound object;
 *  - control: a bag naming a different object queries that object and never
 *    the fixture's, so the first row cannot pass on a fetch the bag did not
 *    drive.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import React from 'react';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
import type { DataSource, DeclaredNode, ObjectMapBlockNode } from '@object-ui/types';
import { safeValidateSchema } from '@object-ui/types/zod';

type StandInProps = { children?: React.ReactNode; latitude?: number; longitude?: number };

// No WebGL in the test env — the stand-in the sibling ObjectMap tests use.
vi.mock('react-map-gl/maplibre', () => ({
  default: ({ children }: StandInProps) => <div aria-label="Map">{children}</div>,
  Map: ({ children }: StandInProps) => <div aria-label="Map">{children}</div>,
  NavigationControl: () => <div data-testid="nav-control" />,
  Marker: ({ children, latitude, longitude }: StandInProps) => (
    <div data-testid="map-marker" data-lat={latitude} data-lng={longitude}>
      {children}
    </div>
  ),
  Popup: ({ children }: StandInProps) => <div data-testid="map-popup">{children}</div>,
}));

// Module scope, not a hook: this import IS the registration (AGENTS.md
// test-discipline section).
import './index';
import './__tests__/webgl2Available';

const MAP = { latitudeField: 'lat', longitudeField: 'lng', titleField: 'name' };
// `as const` keeps `operator` the literal the bag's filter row declares; a
// widened `string` is refused there (objectui#8347 took away the index
// signature that used to admit the bag on the post-hoist node type).
const FILTER = [{ field: 'region', operator: 'equals' as const, value: 'west' }];
const SORT: Array<{ field: string; order: 'asc' | 'desc' }> = [{ field: 'name', order: 'desc' }];
const ROWS = [
  { id: 's1', name: 'North Store', lat: 37.8044, lng: -122.2711, region: 'west' },
  { id: 's2', name: 'South Store', lat: 37.3382, lng: -121.8863, region: 'west' },
];

/** The authored spelling, spec-valid. */
const BAG: ObjectMapBlockNode = { type: 'object-map', properties: { objectName: 'store', map: MAP, filter: FILTER, sort: SORT } };
/** The same props written flat — what a code composer builds. */
const FLAT: DeclaredNode = { type: 'object-map', objectName: 'store', map: MAP, filter: FILTER, sort: SORT };
/** The bag with its object supplied by the node's binding instead. */
const BOUND_BAG: DeclaredNode = { type: 'object-map', dataSource: { object: 'store' }, properties: { map: MAP } };

function makeAdapter() {
  return {
    find: vi.fn().mockResolvedValue({ data: ROWS }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockImplementation(async (name: string) => ({
      name,
      fields: { name: { type: 'text' }, lat: { type: 'number' }, lng: { type: 'number' }, region: { type: 'text' } },
    })),
  };
}

async function renderNode(schema: DeclaredNode) {
  const adapter = makeAdapter();
  const view = render(
    <SchemaRendererProvider dataSource={adapter as unknown as DataSource}>
      {/* No cast (objectui#11466): each fixture is a `DeclaredNode`. The bag
          spellings are the authored `object-map` node; `FLAT` is the
          `ObjectMapSchema` twin, the node as code composes it, which the
          validator refuses as authored metadata and the renderer reads all
          the same (objectui#11355). */}
      <SchemaRenderer schema={schema} />
    </SchemaRendererProvider>,
  );
  await waitFor(() => expect(adapter.find).toHaveBeenCalled());
  return { adapter, ...view };
}

describe('object-map renders from its `properties` bag (objectui#10859 batch 5)', () => {
  it('the fixtures are the two spellings the validator now tells apart (lit control)', () => {
    expect(safeValidateSchema(BAG).success).toBe(true);
    expect(safeValidateSchema(BOUND_BAG).success).toBe(true);
    expect(safeValidateSchema(FLAT).success).toBe(false);
  });

  it('the bag queries its object with its own filter and sort, and plots one marker per row', async () => {
    const { adapter, container } = await renderNode(BAG);
    const [object, params] = adapter.find.mock.calls[0] as [string, { $filter?: unknown; $orderby?: unknown }];
    expect(object).toBe('store');
    expect(JSON.stringify(params.$filter)).toContain('region');
    expect(params.$orderby).toEqual({ name: 'desc' });
    await waitFor(() => expect(container.querySelectorAll('[data-testid="map-marker"]')).toHaveLength(ROWS.length));
  });

  it('the flat spelling a composer builds makes the identical call and draws the same markers', async () => {
    const bag = await renderNode(BAG);
    await waitFor(() => expect(bag.container.querySelectorAll('[data-testid="map-marker"]')).toHaveLength(ROWS.length));
    const flat = await renderNode(FLAT);
    await waitFor(() => expect(flat.container.querySelectorAll('[data-testid="map-marker"]')).toHaveLength(ROWS.length));
    expect(flat.adapter.find.mock.calls[0]).toEqual(bag.adapter.find.mock.calls[0]);
    const coordinates = (container: HTMLElement) =>
      Array.from(container.querySelectorAll('[data-testid="map-marker"]')).map(
        (marker) => `${marker.getAttribute('data-lat')},${marker.getAttribute('data-lng')}`,
      );
    expect(coordinates(flat.container)).toEqual(coordinates(bag.container));
  });

  it('a bag bound through the node\'s `dataSource` queries the bound object', async () => {
    const { adapter, container } = await renderNode(BOUND_BAG);
    expect(adapter.find.mock.calls[0][0]).toBe('store');
    await waitFor(() => expect(container.querySelectorAll('[data-testid="map-marker"]')).toHaveLength(ROWS.length));
  });

  it('control: a bag naming another object queries that object, never the fixture\'s', async () => {
    const { adapter } = await renderNode({ ...BAG, properties: { ...BAG.properties, objectName: 'warehouse' } });
    const objects = adapter.find.mock.calls.map((call) => call[0]);
    expect(objects).toContain('warehouse');
    expect(objects).not.toContain('store');
  });
});
