/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11168 slice 3 — what `object-map` PUBLISHES, and what its renderer
 * does with each member of each structured key.
 *
 * `@objectstack/spec` 17.5.0 gave `object-map` a `ComponentPropsMap` row, and
 * the repo-wide parity guard
 * (`apps/console/src/__tests__/registry-inputs-spec-parity.test.ts`) now loads
 * this plugin, so it judges the registration in both directions. Under
 * objectui#11111 decision 3 = B every key is decided by its own measurement.
 * The judgment found three spec keys the registration did not publish —
 * `mapStyle`, `navigation` and `enableClustering` — and the renderer honours
 * all three, so they are declared. It also owes a member pin for every
 * structured key the block publishes; this file carries six of them (`map`,
 * `data`, `staticData`, `filter`, `sort`, `navigation`). The seventh,
 * `dataSource`, is `ObjectMap.elementDataSource.test.tsx`.
 *
 * Every behavioural row mounts the block the way a page does — through the
 * REAL `SchemaRenderer` and this package's own registration — with MapLibre
 * stubbed (no WebGL here): the stub records the props the map hands MapGL and
 * renders each marker as a clickable element, so every row asserts what was
 * plotted, what was queried, or what a click opened.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ComponentRegistry } from '@object-ui/core';
import {
  RelatedRecordActionsProvider,
  SchemaRenderer,
  SchemaRendererProvider,
  type RelatedRecordActionsValue,
} from '@object-ui/react';
import { manifestFromConfigs, validateTree } from '@object-ui/sdui-parser';
import { ComponentPropsMap } from '@objectstack/spec/ui';

/** The props `ObjectMap` handed the MapGL component on its last render. */
const mapGl = vi.hoisted(() => ({ props: null as Record<string, unknown> | null }));

vi.mock('react-map-gl/maplibre', () => ({
  default: (props: Record<string, unknown>) => {
    mapGl.props = props;
    return <div aria-label="Map">{props.children as React.ReactNode}</div>;
  },
  Map: ({ children }: { children?: React.ReactNode }) => <div aria-label="Map">{children}</div>,
  NavigationControl: () => <div data-testid="nav-control" />,
  // A marker is a clickable element here, so a click reaches the map's own
  // `onClick` with the `originalEvent` it stops.
  Marker: ({ children, onClick }: { children?: React.ReactNode; onClick?: (e: unknown) => void }) => (
    <div data-testid="map-marker" onClick={() => onClick?.({ originalEvent: { stopPropagation() {} } })}>
      {children}
    </div>
  ),
  Popup: ({ children }: { children?: React.ReactNode }) => <div data-testid="map-popup">{children}</div>,
}));

// Registers `object-map` through this package's own entry, at module scope.
import '../index';
import './webgl2Available';

const OBJECT = 'store';
const MAP = { latitudeField: 'lat', longitudeField: 'lng', titleField: 'name' };
const DEMO_STYLE = 'https://demotiles.maplibre.org/style.json';

/**
 * Three stores. `owner` is drawn by nothing on the map itself — only by the
 * overlay that lists the clicked record's fields — so its text on screen means
 * "the marker's record opened".
 */
const ROWS = [
  { id: 'm1', name: 'Alpha', lat: 40, lng: -74, status: 'open', owner: 'Ada Lovelace', note: 'Flagship' },
  { id: 'm2', name: 'Beta', lat: 41, lng: -75, status: 'closed', owner: 'Grace Hopper', note: 'Outlet' },
  { id: 'm3', name: 'Gamma', lat: 42, lng: -76, status: 'open', owner: 'Alan Turing', note: 'Kiosk' },
];
const OPENED_RECORD_TEXT = 'Ada Lovelace';

function makeDataSource() {
  return {
    find: vi.fn(async (_object: string, _query?: Record<string, unknown>) => ({
      data: [{ id: 'q1', name: 'Queried', lat: 10, lng: 10 }],
      total: 1,
    })),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => ({ name: OBJECT, fields: { name: { type: 'text' } } })),
  };
}

const mount = (
  schema: Record<string, unknown>,
  ds = makeDataSource(),
  hostProps: Record<string, unknown> = {},
) => {
  render(
    <SchemaRendererProvider dataSource={ds as never}>
      <SchemaRenderer schema={{ type: 'object-map', ...schema } as never} {...hostProps} />
    </SchemaRendererProvider>,
  );
  return ds;
};

/** Wait for the map to leave its placeholder. */
const mapDrawn = () => waitFor(() => expect(screen.getByLabelText('Map')).toBeInTheDocument());

/** The single-record markers plotted (a cluster renders its own element). */
const pins = () => screen.queryAllByTestId('map-marker').filter((marker) => marker.textContent === '📍');
const clusters = () => screen.queryAllByTestId('map-cluster');

/** Give a click (or a query) every chance to have happened before asserting it did not. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

/** The diagnostics the page validator raises, over the manifest the registry publishes. */
const diagnose = (node: Record<string, unknown>) =>
  validateTree(
    node as never,
    manifestFromConfigs(
      ComponentRegistry.getKnownTypes().map((type) => {
        const meta = ComponentRegistry.getMeta(type);
        return { type, namespace: meta?.namespace, isContainer: meta?.isContainer, inputs: meta?.inputs };
      }) as unknown as Parameters<typeof manifestFromConfigs>[0],
    ),
  ).diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.message]);

const inputOf = (name: string) =>
  ((ComponentRegistry.getConfig('object-map', 'plugin-map') as { inputs?: Array<Record<string, unknown>> } | undefined)
    ?.inputs ?? []).find((input) => input.name === name);

const specRow = (ComponentPropsMap as unknown as Record<string, { safeParse: (v: unknown) => { success: boolean } }>)[
  'object-map'
];

beforeEach(() => {
  mapGl.props = null;
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '{}' })));
  try { window.localStorage.clear(); } catch { /* private mode */ }
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ── The registration ────────────────────────────────────────────────────────

describe('object-map publishes the three spec keys its renderer honours (objectui#11168)', () => {
  it('declares `mapStyle`, `navigation` and `enableClustering` with the spec row\'s kinds', () => {
    expect(inputOf('mapStyle')?.type).toBe('string');
    expect(inputOf('navigation')?.type).toBe('object');
    expect(inputOf('enableClustering')?.type).toBe('boolean');
  });

  it('the page validator accepts all three, and a bogus key is still reported (the control)', () => {
    // Before this slice each of the three was an `unknown-prop` warning.
    expect(
      diagnose({
        type: 'object-map',
        objectName: OBJECT,
        map: MAP,
        mapStyle: 'https://tiles.example.com/style.json',
        navigation: { mode: 'drawer' },
        enableClustering: true,
      }),
    ).toEqual([]);
    expect(diagnose({ type: 'object-map', objectName: OBJECT, map: MAP, bogusProp: 1 })).toEqual([
      ['unknown-prop', '<object-map> has no prop "bogusProp"'],
    ]);
  });

  it('the installed spec row accepts every shape the rows below author', () => {
    expect(
      specRow.safeParse({
        objectName: OBJECT,
        map: { ...MAP, descriptionField: 'note', zoom: 5, center: [40, -74], style: 'https://b.example/s.json' },
        mapStyle: 'https://a.example/s.json',
        navigation: { mode: 'drawer', size: 'lg' },
        enableClustering: true,
        filter: [{ field: 'status', operator: 'equals', value: 'open' }],
        sort: [{ field: 'name', order: 'desc' }],
      }).success,
    ).toBe(true);
    expect(specRow.safeParse({ staticData: ROWS }).success).toBe(true);
    expect(specRow.safeParse({ data: { provider: 'value', items: ROWS } }).success).toBe(true);
    // CONTROL: the row is not accepting everything.
    expect(specRow.safeParse({ objectName: OBJECT, bogusProp: 1 }).success).toBe(false);
  });
});

describe('`object-map.mapStyle` is read BEFORE `map.style` — the spec row\'s own describe (objectui#11168, ruling A)', () => {
  const A = 'https://a.example/style.json';
  const B = 'https://b.example/style.json';

  it('the registration publishes the installed spec row\'s describe, verbatim', () => {
    // Read through `_def` for the reason `ObjectMap.dataArmSpecRow-8348` gives:
    // the row is a lazy schema, and `_def` is the internal the spec publishes no type for.
    type Member = { description?: string };
    const def = (ComponentPropsMap as unknown as Record<string, { _def: { shape: Record<string, Member> | (() => Record<string, Member>) } }>)['object-map']._def;
    const shape = typeof def.shape === 'function' ? def.shape() : def.shape;
    const describe = shape.mapStyle?.description;
    expect(describe).toContain('Read before `map.style`');
    expect(inputOf('mapStyle')?.description).toBe(describe);
  });

  it.each([
    ['both written: `mapStyle` draws', { mapStyle: A, map: { ...MAP, style: B } }, A],
    ['only `map.style`: it draws', { map: { ...MAP, style: B } }, B],
    ['only `mapStyle`: it draws', { mapStyle: A, map: MAP }, A],
    ['neither: the public demo tiles (the control)', { map: MAP }, DEMO_STYLE],
  ])('%s', async (_label, schema, drawn) => {
    mount({ ...schema, staticData: ROWS });
    await mapDrawn();
    expect(mapGl.props?.mapStyle).toBe(drawn);
  });
});

describe('`enableClustering` — as described (objectui#11168)', () => {
  it('`enableClustering: true` clusters nearby markers; absent, a map of a few markers draws each one', async () => {
    const near = [ROWS[0], { ...ROWS[1], lat: 40.001, lng: -74.001 }];
    mount({ map: MAP, staticData: near, enableClustering: true });
    await mapDrawn();
    expect(clusters()).toHaveLength(1);
    expect(pins()).toHaveLength(0);
    cleanup();
    mount({ map: MAP, staticData: near });
    await mapDrawn();
    expect(clusters()).toHaveLength(0);
    expect(pins()).toHaveLength(2);
  });

  it('absent, the map clusters above 100 markers — and `enableClustering: false` turns that off', async () => {
    const many = Array.from({ length: 120 }, (_, i) => ({ id: `x${i}`, name: `N${i}`, lat: 40 + i * 0.0001, lng: -74 }));
    mount({ map: MAP, staticData: many });
    await mapDrawn();
    expect(clusters().length).toBeGreaterThan(0);
    cleanup();
    mount({ map: MAP, staticData: many, enableClustering: false });
    await mapDrawn();
    expect(clusters()).toHaveLength(0);
    expect(pins()).toHaveLength(120);
  });
});

// ── map ─────────────────────────────────────────────────────────────────────

describe('`object-map.map` — the members are field names and the camera (objectui#11168)', () => {
  it('`latitudeField` / `longitudeField` place one marker per record; fields that hold no number place none', async () => {
    mount({ map: MAP, staticData: ROWS });
    await mapDrawn();
    expect(pins()).toHaveLength(3);
    cleanup();
    // CONTROL: the same rows under a binding that names no coordinate field.
    mount({ map: { ...MAP, latitudeField: 'status' }, staticData: ROWS });
    await mapDrawn();
    expect(pins()).toHaveLength(0);
  });

  it.each([
    ['a "lat,lng" string', '40,-74'],
    ['a { lat, lng } object', { lat: 40, lng: -74 }],
    ['a [lat, lng] pair', [40, -74]],
  ])('`locationField` reads %s', async (_label, location) => {
    mount({ map: { locationField: 'where', titleField: 'name' }, staticData: [{ id: 'l1', name: 'Loc', where: location }] });
    await mapDrawn();
    expect(pins()).toHaveLength(1);
  });

  it('`titleField` and `descriptionField` name the record fields the marker popup shows', async () => {
    mount({ map: { ...MAP, descriptionField: 'note' }, staticData: [ROWS[0]] });
    await mapDrawn();
    fireEvent.click(pins()[0]);
    const popup = await screen.findByTestId('map-popup');
    expect(popup.querySelector('h3')?.textContent).toBe('Alpha');
    expect(popup).toHaveTextContent('Flagship');
    cleanup();
    mount({ map: { ...MAP, titleField: 'status' }, staticData: [ROWS[0]] });
    await mapDrawn();
    fireEvent.click(pins()[0]);
    expect((await screen.findByTestId('map-popup')).querySelector('h3')?.textContent).toBe('open');
  });

  it('`zoom` and `center` (`[latitude, longitude]`) are the initial camera; absent, the camera fits the markers', async () => {
    mount({ map: { ...MAP, zoom: 5, center: [48.85, 2.35] }, staticData: ROWS });
    await mapDrawn();
    expect(mapGl.props?.initialViewState).toEqual({ latitude: 48.85, longitude: 2.35, zoom: 5 });
    cleanup();
    mount({ map: MAP, staticData: ROWS });
    await mapDrawn();
    expect(mapGl.props?.initialViewState).toHaveProperty('bounds');
  });
});

// ── data / staticData ───────────────────────────────────────────────────────

describe('`object-map.data` — the members are the `{ provider, … }` configurations (objectui#11168)', () => {
  it('`{ provider: "value", items }` plots those records and queries nothing', async () => {
    const ds = mount({ map: MAP, data: { provider: 'value', items: ROWS } });
    await mapDrawn();
    expect(pins()).toHaveLength(3);
    expect(ds.find).not.toHaveBeenCalled();
  });

  it('`{ provider: "object", object }` queries THAT object and plots what it returns', async () => {
    const ds = mount({ map: MAP, data: { provider: 'object', object: OBJECT } });
    await waitFor(() => expect(ds.find).toHaveBeenCalledWith(OBJECT, expect.anything()));
    await waitFor(() => expect(pins()).toHaveLength(1));
  });

  it('`{ provider: "api" }` plots nothing and queries nothing — the map reads no request', async () => {
    const ds = mount({ map: MAP, data: { provider: 'api', read: { url: '/api/stores' } } });
    await settle();
    expect(pins()).toHaveLength(0);
    expect(ds.find).not.toHaveBeenCalled();
  });

  it('it is read FIRST: a `data` configuration wins over `staticData` and over `objectName`', async () => {
    const ds = mount({
      map: MAP,
      objectName: OBJECT,
      staticData: [ROWS[0]],
      data: { provider: 'value', items: ROWS },
    });
    await mapDrawn();
    expect(pins()).toHaveLength(3);
    expect(ds.find).not.toHaveBeenCalled();
  });
});

describe('`object-map.staticData` — the members are RECORDS (objectui#11168)', () => {
  it('each record is plotted by the `map` block\'s fields, and one without coordinates is skipped, not invented', async () => {
    mount({ map: MAP, staticData: [...ROWS, { id: 'm4', name: 'Nowhere' }] });
    await mapDrawn();
    expect(pins()).toHaveLength(3);
  });

  it('it is read SECOND, above `objectName`: a map carrying both plots these rows and never queries the object', async () => {
    const ds = mount({ map: MAP, objectName: OBJECT, staticData: ROWS });
    await mapDrawn();
    await settle();
    expect(pins()).toHaveLength(3);
    expect(ds.find).not.toHaveBeenCalled();
    cleanup();
    // CONTROL: without the inline rows the same node queries the object.
    const live = mount({ map: MAP, objectName: OBJECT });
    await waitFor(() => expect(live.find).toHaveBeenCalledWith(OBJECT, expect.anything()));
  });
});

// ── filter / sort ───────────────────────────────────────────────────────────

describe('`object-map.filter` — the members are `{ field, operator, value }` rules (objectui#11168)', () => {
  const OPEN = [{ field: 'status', operator: 'equals', value: 'open' }];

  it('a rule narrows the inline records plotted, and `operator` is read', async () => {
    mount({ map: MAP, staticData: ROWS, filter: OPEN });
    await mapDrawn();
    expect(pins()).toHaveLength(2);
    cleanup();
    mount({ map: MAP, staticData: ROWS, filter: [{ ...OPEN[0], operator: 'not_equals' }] });
    await mapDrawn();
    expect(pins()).toHaveLength(1);
  });

  it('on the object query the rule reaches `$filter` with its members unchanged; with no `filter`, no `$filter`', async () => {
    const ds = mount({ map: MAP, objectName: OBJECT, filter: OPEN });
    await waitFor(() => expect(ds.find).toHaveBeenCalled());
    expect(ds.find.mock.calls[0][1]?.$filter).toEqual(OPEN);
    cleanup();
    const bare = mount({ map: MAP, objectName: OBJECT });
    await waitFor(() => expect(bare.find).toHaveBeenCalled());
    expect(bare.find.mock.calls[0][1]?.$filter).toBeUndefined();
  });
});

describe('`object-map.sort` — the members are `{ field, order }` (objectui#11168)', () => {
  it('each member lowers to `field -> direction` on `$orderby`, in authored order, an omitted `order` reading ascending', async () => {
    const ds = mount({
      map: MAP,
      objectName: OBJECT,
      sort: [{ field: 'status', order: 'desc' }, { field: 'name' }],
    });
    await waitFor(() => expect(ds.find).toHaveBeenCalled());
    const orderby = ds.find.mock.calls[0][1]?.$orderby as Record<string, string>;
    expect(orderby).toEqual({ status: 'desc', name: 'asc' });
    expect(Object.keys(orderby)).toEqual(['status', 'name']);
  });

  it('CONTROL: with no `sort` the query carries no ordering', async () => {
    const ds = mount({ map: MAP, objectName: OBJECT });
    await waitFor(() => expect(ds.find).toHaveBeenCalled());
    const orderby = ds.find.mock.calls[0][1]?.$orderby as Record<string, string> | undefined;
    expect(orderby === undefined || Object.keys(orderby).length === 0).toBe(true);
  });
});

// ── navigation ──────────────────────────────────────────────────────────────

/** Mount one map with an authored `navigation` (or none), click its one marker, and hand back the `window.open` spy. */
async function clickMarker(navigation: Record<string, unknown> | undefined, hostProps: Record<string, unknown> = {}) {
  const open = vi.fn();
  vi.stubGlobal('open', open);
  mount({ map: MAP, objectName: OBJECT, staticData: [ROWS[0]], ...(navigation ? { navigation } : {}) }, makeDataSource(), hostProps);
  await mapDrawn();
  fireEvent.click(pins()[0]);
  return { open };
}

const dialog = () => document.querySelector('[role="dialog"]') as HTMLElement | null;
const openedRecord = () => screen.queryByText(OPENED_RECORD_TEXT);

async function expectNothingOpened(open: ReturnType<typeof vi.fn>, why: string) {
  await settle();
  expect(dialog(), `${why}: an overlay opened`).toBeNull();
  expect(openedRecord(), `${why}: the record was drawn`).toBeNull();
  expect(open, `${why}: a tab was opened`).not.toHaveBeenCalled();
}

/** The resolved overlay width, read off the `--ov-w` custom property the shared shell publishes. */
function panelWidth(): string {
  const panel = dialog();
  expect(panel, 'overlay panel').not.toBeNull();
  return panel!.style.getPropertyValue('--ov-w').trim();
}

describe('`object-map.navigation` — the members decide what a marker click opens (objectui#11168)', () => {
  it('LIT CONTROL: `mode: "drawer"` opens the marker\'s record in a drawer', async () => {
    const { open } = await clickMarker({ mode: 'drawer' });
    await waitFor(() => expect(dialog()).not.toBeNull());
    expect(openedRecord()).not.toBeNull();
    expect(open).not.toHaveBeenCalled();
  });

  it.each(['modal', 'popover'] as const)('`mode: "%s"` opens the marker\'s record in that overlay', async (mode) => {
    const { open } = await clickMarker({ mode });
    await waitFor(() => expect(dialog()).not.toBeNull());
    expect(openedRecord()).not.toBeNull();
    expect(open).not.toHaveBeenCalled();
  });

  it('`mode: "split"` opens NOTHING — the map hands the split shell no main panel', async () => {
    const { open } = await clickMarker({ mode: 'split' });
    await expectNothingOpened(open, 'split');
  });

  it('`mode: "none"` and `preventNavigation: true` open nothing, the flag outranking an overlay mode', async () => {
    const none = await clickMarker({ mode: 'none' });
    await expectNothingOpened(none.open, 'none');
    cleanup();
    const prevented = await clickMarker({ mode: 'drawer', preventNavigation: true });
    await expectNothingOpened(prevented.open, 'preventNavigation');
  });

  it('`mode: "new_window"` opens the record page in a new tab, and `openNewTab` outranks an overlay mode but not `none`', async () => {
    const tab = await clickMarker({ mode: 'new_window' });
    await waitFor(() => expect(tab.open).toHaveBeenCalledWith(`/${OBJECT}/record/m1`, '_blank'));
    expect(dialog()).toBeNull();
    cleanup();
    const forced = await clickMarker({ mode: 'drawer', openNewTab: true });
    await waitFor(() => expect(forced.open).toHaveBeenCalledTimes(1));
    expect(dialog()).toBeNull();
    cleanup();
    const none = await clickMarker({ mode: 'none', openNewTab: true });
    await expectNothingOpened(none.open, 'none beside openNewTab');
  });

  it('`size` and `width` are one width decision: `width` wins, a bucket resolves, `auto` lands on the default', async () => {
    await clickMarker({ mode: 'drawer' });
    await waitFor(() => expect(dialog()).not.toBeNull());
    const unsized = panelWidth();
    cleanup();
    await clickMarker({ mode: 'drawer', size: 'lg' });
    await waitFor(() => expect(dialog()).not.toBeNull());
    expect(panelWidth()).not.toBe(unsized);
    cleanup();
    await clickMarker({ mode: 'drawer', size: 'sm', width: '720px' });
    await waitFor(() => expect(dialog()).not.toBeNull());
    expect(panelWidth()).toContain('720px');
    cleanup();
    await clickMarker({ mode: 'drawer', size: 'auto' });
    await waitFor(() => expect(dialog()).not.toBeNull());
    expect(panelWidth()).toBe(unsized);
  });

  it('a parent view\'s click handler OUTRANKS the whole key, overlay mode included', async () => {
    const onRowClick = vi.fn();
    const { open } = await clickMarker({ mode: 'drawer' }, { onRowClick });
    await waitFor(() => expect(onRowClick).toHaveBeenCalledTimes(1));
    expect(onRowClick.mock.calls[0][0]).toMatchObject({ id: 'm1' });
    await expectNothingOpened(open, 'parent handler');
  });

  it('with NO host navigator, the key ABSENT, `page`, or a block without `mode` opens nothing — there is no record page to open', async () => {
    const absent = await clickMarker(undefined);
    await expectNothingOpened(absent.open, 'absent key');
    cleanup();
    const page = await clickMarker({ mode: 'page' });
    await expectNothingOpened(page.open, 'page');
    cleanup();
    const modeless = await clickMarker({ size: 'lg' });
    await expectNothingOpened(modeless.open, 'mode-less block');
  });
});

/**
 * A host that publishes its record navigator the way the console does on its
 * custom pages, record pages and list views (`RelatedRecordActionsContext`):
 * `openRecord` is the spy a `page` click must reach. The same host the
 * board's and the calendar's `NavigationMembers-8652` pins mount.
 */
function recordNavigatorHost() {
  const openRecord = vi.fn();
  const value: RelatedRecordActionsValue = {
    resolve: () => ({}),
    recordHref: (objectName, recordId) => `/apps/demo/${objectName}/record/${recordId}`,
    openRecord,
  };
  return { value, openRecord };
}

/** `clickMarker`, with the map mounted through the real `SchemaRenderer` UNDER that host. */
async function clickMarkerUnderHost(
  navigation: Record<string, unknown> | undefined,
  host: RelatedRecordActionsValue,
  { namesObject = true } = {},
) {
  const open = vi.fn();
  vi.stubGlobal('open', open);
  render(
    <RelatedRecordActionsProvider value={host}>
      <SchemaRendererProvider dataSource={makeDataSource() as never}>
        <SchemaRenderer
          schema={{
            type: 'object-map',
            map: MAP,
            ...(namesObject ? { objectName: OBJECT } : {}),
            staticData: [ROWS[0]],
            ...(navigation ? { navigation } : {}),
          } as never}
        />
      </SchemaRendererProvider>
    </RelatedRecordActionsProvider>,
  );
  await mapDrawn();
  fireEvent.click(pins()[0]);
  return { open };
}

describe('`object-map.navigation` `page` under the host\'s record navigator (objectui#11168, objectui#11293)', () => {
  it('LIT CONTROL: under the same host, `mode: "drawer"` opens the drawer and does not navigate', async () => {
    // First, because the rows below would be vacuous against a map whose
    // markers are not clickable under this host.
    const { value, openRecord } = recordNavigatorHost();
    const { open } = await clickMarkerUnderHost({ mode: 'drawer' }, value);
    await waitFor(() => expect(dialog()).not.toBeNull());
    expect(openRecord).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it('`mode: "page"` opens the record page of the map\'s object through the host, and no overlay', async () => {
    const { value, openRecord } = recordNavigatorHost();
    const { open } = await clickMarkerUnderHost({ mode: 'page' }, value);
    await waitFor(() => expect(openRecord).toHaveBeenCalledTimes(1));
    expect(openRecord).toHaveBeenCalledWith(OBJECT, 'm1');
    expect(dialog()).toBeNull();
    expect(open).not.toHaveBeenCalled();
  });

  it('a block WITHOUT `mode` resolves to `page`, and navigates the same way', async () => {
    const { value, openRecord } = recordNavigatorHost();
    const { open } = await clickMarkerUnderHost({ size: 'lg' }, value);
    await waitFor(() => expect(openRecord).toHaveBeenCalledTimes(1));
    expect(openRecord).toHaveBeenCalledWith(OBJECT, 'm1');
    expect(dialog()).toBeNull();
    expect(open).not.toHaveBeenCalled();
  });

  it.each([
    ['the key ABSENT', undefined],
    ['`mode: "none"`', { mode: 'none' }],
    ['`mode: "split"`', { mode: 'split' }],
  ] as const)('%s still opens nothing under the host, and does not navigate', async (why, navigation) => {
    const { value, openRecord } = recordNavigatorHost();
    const { open } = await clickMarkerUnderHost(navigation, value);
    await expectNothingOpened(open, String(why));
    expect(openRecord).not.toHaveBeenCalled();
  });

  it('a map that names no `objectName` (inline rows alone) has no record page to open, even under the host', async () => {
    const { value, openRecord } = recordNavigatorHost();
    const { open } = await clickMarkerUnderHost({ mode: 'page' }, value, { namesObject: false });
    await expectNothingOpened(open, 'page without objectName');
    expect(openRecord).not.toHaveBeenCalled();
  });
});
