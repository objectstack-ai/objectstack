/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10623 — an `object-map` block re-reads its markers when the
 * data-invalidation bus (`notifyDataChanged` from `@object-ui/react`) reports a
 * write to the object it queries, and it does so without unmounting the map.
 *
 * Before this card the fetch effect named no nonce, so a write declared on the
 * bus (a page action over raw HTTP, a flow, a server action) left the markers
 * stale until something remounted the map. The effect now names the
 * `useDataInvalidation` nonce for the object it queries (the objectui#10494
 * shape), and the re-read it causes is SILENT: the `loading` gate unmounts
 * `MapGL` for a fetch, and a bus re-read that went through it would reset the
 * camera the user panned — see the comment on the nonce in `ObjectMap.tsx`.
 *
 * ⚠️ Counted as a DELTA, not an absolute. How many `find` calls a mount issues
 * is not this file's subject: it is pinned by `ObjectMap.fetchGate-10664.test.tsx`
 * (objectui#10664 gated the query on a settled definition, so a mount reads
 * once). What is pinned here is that one bus event adds exactly one query.
 *
 * Rendered through the real `SchemaRenderer` and this package's own
 * registration, over a fake data source that counts reads. The bare
 * `useDataInvalidation` reader mounted beside the block is the positive
 * control: it proves the event reached subscribers in this harness.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup, screen, waitFor } from '@testing-library/react';
import { SchemaRenderer, SchemaRendererProvider, notifyDataChanged, useDataInvalidation } from '@object-ui/react';

// No WebGL in the test env — same stub the sibling ObjectMap tests use. The
// stub's node stands in for the map canvas: if the re-read unmounted `MapGL`,
// the node after it is a different one.
vi.mock('react-map-gl/maplibre', () => ({
  default: ({ children }: any) => <div aria-label="Map">{children}</div>,
  Map: ({ children }: any) => <div aria-label="Map">{children}</div>,
  NavigationControl: () => <div data-testid="nav-control" />,
  Marker: ({ children }: any) => <div data-testid="map-marker">{children}</div>,
  Popup: ({ children }: any) => <div data-testid="map-popup">{children}</div>,
}));

// Registers `object-map` through this package's own entry.
import './index';
import './__tests__/webgl2Available';

beforeEach(() => {
  // Best-effort metadata probes are not what these cases are about.
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '{}' })));
});
afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 150)));

function makeDataSource() {
  let rows = [{ id: '1', name: 'Depot', lat: 10, lng: 20 }];
  return {
    addRow(row: { id: string; name: string; lat: number; lng: number }) {
      rows = [...rows, row];
    },
    find: vi.fn(async () => ({ data: rows, total: rows.length })),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => ({
      name: 'store',
      fields: { name: { type: 'text' }, lat: { type: 'number' }, lng: { type: 'number' } },
    })),
  };
}

/** The positive control: a bare reader of the same object, beside the block. */
function BusControl() {
  const nonce = useDataInvalidation('store');
  return <span data-testid="bus-control">{nonce}</span>;
}

const renderBlock = (schema: Record<string, unknown>, ds: ReturnType<typeof makeDataSource>) =>
  render(
    <SchemaRendererProvider dataSource={ds as any}>
      <BusControl />
      <SchemaRenderer schema={schema as any} />
    </SchemaRendererProvider>,
  );

const MAP = { latitudeField: 'lat', longitudeField: 'lng', titleField: 'name' };
const BLOCK = { type: 'object-map', objectName: 'store', map: MAP };

describe('object-map re-reads on the data-invalidation bus (objectui#10623)', () => {
  it('an unscoped change (objectName "*") adds one query, and the map stays mounted', async () => {
    const ds = makeDataSource();
    renderBlock(BLOCK, ds);
    await waitFor(() => expect(screen.getAllByTestId('map-marker')).toHaveLength(1));
    await settle();
    const onMount = ds.find.mock.calls.length;
    const canvas = screen.getByLabelText('Map');

    ds.addRow({ id: '2', name: 'Harbour', lat: 11, lng: 21 });
    await act(async () => {
      notifyDataChanged({ objectName: '*' });
    });
    await settle();

    expect(screen.getByTestId('bus-control').textContent, 'control: the event never reached a subscriber').toBe('1');
    expect(ds.find.mock.calls.length - onMount, 'the block did not re-read exactly once after the bus reported a change').toBe(1);
    expect(screen.getAllByTestId('map-marker')).toHaveLength(2);
    // Silent: the map node is the same one, so the user's camera survives.
    expect(screen.getByLabelText('Map'), 'the re-read unmounted the map').toBe(canvas);
  });

  it('a change to its own object adds one query; another object adds none', async () => {
    const ds = makeDataSource();
    renderBlock(BLOCK, ds);
    await waitFor(() => expect(screen.getAllByTestId('map-marker')).toHaveLength(1));
    await settle();
    const onMount = ds.find.mock.calls.length;

    await act(async () => {
      notifyDataChanged({ objectName: 'some_other_object' });
    });
    await settle();
    expect(ds.find.mock.calls.length - onMount, 'a change to another object re-read this block').toBe(0);

    await act(async () => {
      notifyDataChanged({ objectName: 'store', recordId: '1' });
    });
    await settle();
    expect(screen.getByTestId('bus-control').textContent).toBe('1');
    expect(ds.find.mock.calls.length - onMount).toBe(1);
  });

  it('a block drawing an inline value set queries nothing on an invalidation', async () => {
    const ds = makeDataSource();
    renderBlock(
      { type: 'object-map', map: MAP, data: { provider: 'value', items: [{ id: '9', name: 'Inline', lat: 1, lng: 2 }] } },
      ds,
    );
    await waitFor(() => expect(screen.getAllByTestId('map-marker')).toHaveLength(1));

    await act(async () => {
      notifyDataChanged({ objectName: '*' });
    });
    await settle();

    expect(screen.getByTestId('bus-control').textContent).toBe('1');
    expect(ds.find).not.toHaveBeenCalled();
  });
});
