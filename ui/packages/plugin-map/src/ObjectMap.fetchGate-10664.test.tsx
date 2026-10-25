/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10664 — `object-map` issues ONE `find` per mount, and that first
 * read already carries the lookup `$expand`.
 *
 * The fetch effect listed the object definition among its dependencies while a
 * separate effect loaded that definition into a local `useState`. The
 * definition lands after the first query, so every mount read twice: once with
 * `buildExpandFields` seeing no fields (no `$expand` at all), and once after.
 * Without a lookup field the two reads were the same query. `object-timeline`
 * (objectui#7895) and `object-gallery` (objectui#7903) gate the same query on a
 * SETTLED definition through the shared `useSettledSchema`; the map now does
 * too, on the branch that issues the object query.
 *
 * Rendered through the real `SchemaRenderer` and this package's own
 * registration, over a fake data source that counts reads.
 *
 * ⚠️ The gate is only safe because `useSettledSchema` settles on EVERY exit: a
 * read that throws, and an adapter with no `getObjectSchema`, both settle with
 * no definition. The two cases for them are the trap, pinned: a map that never
 * loads is the failure a gate can introduce.
 *
 * The CONTROL is a definition that changes after mount. It is green before and
 * after the gate, and it goes red for a gate that forgot to keep the definition
 * in the dependency list: then the re-read would never carry the new expansion.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup, screen, waitFor } from '@testing-library/react';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';

// No WebGL in the test env: the same stub the sibling ObjectMap tests use.
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
  vi.restoreAllMocks();
  cleanup();
});

const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 150)));

const BASE_FIELDS = { name: { type: 'text' }, lat: { type: 'number' }, lng: { type: 'number' } };
const WITH_OWNER = { name: 'store', fields: { ...BASE_FIELDS, owner: { type: 'lookup', reference: 'user' } } };
const WITH_OWNER_AND_REGION = {
  name: 'store',
  fields: { ...BASE_FIELDS, owner: { type: 'lookup', reference: 'user' }, region: { type: 'lookup', reference: 'region' } },
};
const NO_LOOKUP = { name: 'store', fields: BASE_FIELDS };
const DEPOT_FIELDS = { name: 'depot', fields: { ...BASE_FIELDS, manager: { type: 'lookup', reference: 'user' } } };

type Def = { name: string; fields: Record<string, unknown> };

/**
 * `definitions` answers `getObjectSchema` per object. `hold` makes that read
 * wait until `release()`; `schema: 'reject'` makes it throw; `schema: 'absent'`
 * gives the adapter no `getObjectSchema` at all.
 */
function makeDataSource(
  definitions: Record<string, Def>,
  opts: { hold?: boolean; schema?: 'reject' | 'absent' } = {},
) {
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const sequence: string[] = [];
  const ds: any = {
    sequence,
    release: () => release(),
    find: vi.fn(async (object: string) => {
      sequence.push(`find:${object}`);
      return { data: [{ id: '1', name: 'Depot', lat: 10, lng: 20 }], total: 1 };
    }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
  if (opts.schema !== 'absent') {
    ds.getObjectSchema = vi.fn(async (object: string) => {
      if (opts.hold) await held;
      if (opts.schema === 'reject') throw new Error('metadata unavailable');
      sequence.push(`schema:${object}`);
      return definitions[object];
    });
  }
  return ds;
}

/** The `find` calls this map issued for `object`, as their query params. */
const findsFor = (ds: any, object: string): any[] =>
  ds.find.mock.calls.filter((c: any[]) => c[0] === object).map((c: any[]) => c[1]);

const MAP = { latitudeField: 'lat', longitudeField: 'lng', titleField: 'name' };
const blockFor = (objectName: string) => ({ type: 'object-map', objectName, map: MAP });

type HostHandle = { setDataSource: (ds: any) => void; setObjectName: (name: string) => void };

/** Holds the adapter and the bound object as state, so a test can change either in one commit. */
const Host = React.forwardRef<HostHandle, { ds: any; objectName?: string }>(function Host(props, ref) {
  const [ds, setDataSource] = React.useState<any>(props.ds);
  const [objectName, setObjectName] = React.useState(props.objectName ?? 'store');
  React.useImperativeHandle(ref, () => ({ setDataSource, setObjectName }), []);
  const schema = React.useMemo(() => blockFor(objectName), [objectName]);
  return (
    <SchemaRendererProvider dataSource={ds}>
      <SchemaRenderer schema={schema as any} />
    </SchemaRendererProvider>
  );
});

describe('object-map reads once per mount, expanded on the first read (objectui#10664)', () => {
  it('SUBJECT: one `find` per mount, and it carries the lookup `$expand`', async () => {
    const ds = makeDataSource({ store: WITH_OWNER });
    render(<Host ds={ds} />);
    await waitFor(() => expect(screen.getAllByTestId('map-marker')).toHaveLength(1));
    await settle();

    expect(findsFor(ds, 'store'), 'a mount read the store more than once').toHaveLength(1);
    expect(findsFor(ds, 'store')[0].$expand, 'the first read went out unexpanded').toEqual(['owner']);
  });

  it('SUBJECT: without a lookup field it is still one `find` (the two reads were the same query)', async () => {
    const ds = makeDataSource({ store: NO_LOOKUP });
    render(<Host ds={ds} />);
    await waitFor(() => expect(screen.getAllByTestId('map-marker')).toHaveLength(1));
    await settle();

    expect(findsFor(ds, 'store')).toHaveLength(1);
    expect(findsFor(ds, 'store')[0].$expand).toBeUndefined();
  });

  it('SUBJECT: the query WAITS for the definition, then goes out once', async () => {
    const ds = makeDataSource({ store: WITH_OWNER }, { hold: true });
    render(<Host ds={ds} />);
    await settle();
    expect(findsFor(ds, 'store'), 'the map queried before its definition settled').toHaveLength(0);

    await act(async () => { ds.release(); });
    await waitFor(() => expect(screen.getAllByTestId('map-marker')).toHaveLength(1));
    await settle();

    expect(ds.sequence).toEqual(['schema:store', 'find:store']);
    expect(findsFor(ds, 'store')[0].$expand).toEqual(['owner']);
  });

  it('SUBJECT: switching the bound object reads the new object once, with ITS expansion', async () => {
    const ds = makeDataSource({ store: WITH_OWNER, depot: DEPOT_FIELDS });
    const host = React.createRef<HostHandle>();
    render(<Host ref={host} ds={ds} />);
    await waitFor(() => expect(screen.getAllByTestId('map-marker')).toHaveLength(1));
    await settle();

    await act(async () => { host.current!.setObjectName('depot'); });
    await waitFor(() => expect(screen.getAllByTestId('map-marker')).toHaveLength(1));
    await settle();

    // Never the previous object's expansion on the new object's query.
    expect(findsFor(ds, 'depot').map((q) => q.$expand ?? null)).toEqual([['manager']]);
  });

  it('SETTLES ON A THROWN READ: a failed definition read still loads the markers, unexpanded', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const ds = makeDataSource({ store: WITH_OWNER }, { schema: 'reject' });
    render(<Host ds={ds} />);
    await waitFor(() => expect(screen.getAllByTestId('map-marker')).toHaveLength(1));
    await settle();

    expect(findsFor(ds, 'store')).toHaveLength(1);
    expect(findsFor(ds, 'store')[0].$expand).toBeUndefined();
  });

  it('SETTLES WITH NO SOURCE: an adapter without `getObjectSchema` still loads the markers', async () => {
    const ds = makeDataSource({ store: WITH_OWNER }, { schema: 'absent' });
    render(<Host ds={ds} />);
    await waitFor(() => expect(screen.getAllByTestId('map-marker')).toHaveLength(1));
    await settle();

    expect(findsFor(ds, 'store')).toHaveLength(1);
  });

  it('CONTROL: a definition that changes after mount still re-reads, with the new expansion', async () => {
    const first = makeDataSource({ store: WITH_OWNER });
    const host = React.createRef<HostHandle>();
    render(<Host ref={host} ds={first} />);
    await waitFor(() => expect(screen.getAllByTestId('map-marker')).toHaveLength(1));
    await settle();

    const second = makeDataSource({ store: WITH_OWNER_AND_REGION });
    await act(async () => { host.current!.setDataSource(second); });
    await settle();

    const reads = findsFor(second, 'store');
    expect(reads.length, 'the new definition never reached a read').toBeGreaterThan(0);
    expect(reads[reads.length - 1].$expand).toEqual(['owner', 'region']);
  });
});
