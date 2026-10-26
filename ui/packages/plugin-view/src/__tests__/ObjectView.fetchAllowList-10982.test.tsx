/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10982 — `ObjectView`'s non-grid fetch runs only for the view types
 * whose renderer draws the rows it reads, and a re-read keeps those rows on
 * screen.
 *
 * (b) `fetchDrawsView` was a deny-list (`grid`, `tree`, `chart`), so every
 * other view type was read on mount and re-read on every data-invalidation
 * event. That included `gantt`, whose registered wrapper hands its component
 * the schema alone (plugin-gantt pins it in `ObjectGantt.hostDataProp-7210`),
 * and the `ViewType` members `generateViewSchema` has no case for (`page`,
 * `list`, `detail`), which fall through to `ObjectGrid`. Nothing drew those
 * rows. The gate is now the allow-list `VIEW_TYPES_DRAWING_FETCHED_ROWS`.
 *
 * (c) Every run of the fetch set `loading`, bus re-reads included, and a
 * calendar handed rows swaps them for its loading placeholder while that is
 * true (`object-calendar` declares `loading` as honoured alongside an array
 * `data`). A run that issues the request the rows on screen already answer
 * now leaves `loading` false; a first load still sets it.
 *
 * Harness: the component composed the way a host composes it (a `views` prop,
 * so the host-only and case-less types are reachable), rendering through the
 * real `SchemaRenderer` and registry. The inner views are stand-ins in that
 * registry, since this package does not depend on the plugins that register
 * them. The data-drawing stand-in follows the calendar's contract: an array
 * `data` with `loading` true paints the placeholder, anything else paints the
 * rows, and every paint is logged. `ObjectGrid` is a stand-in that never
 * queries, so every `find` counted here is this component's own. `find`
 * answers after a short delay, so a `loading` that is set does paint.
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup, screen, waitFor } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRendererProvider, notifyDataChanged, useDataInvalidation } from '@object-ui/react';
import { ObjectView } from '../ObjectView';

vi.mock('@object-ui/plugin-grid', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ObjectGrid: () => <div data-testid="grid-stand-in" />,
}));

/** The types whose renderer draws the handed rows, read off each renderer. */
const DRAWING = ['kanban', 'calendar', 'gallery', 'timeline', 'map'] as const;
/** Cased types whose renderer queries for itself. */
const SELF_QUERYING = ['gantt', 'tree', 'chart'] as const;
/** `ViewType` members `generateViewSchema` has no case for: the grid path. */
const CASELESS = ['page', 'list', 'detail'] as const;

interface Paint {
  placeholder: boolean;
  rows: number;
}
const paints: Paint[] = [];

function DrawingStandIn({ schema, data, loading }: { schema?: { type?: string }; data?: unknown; loading?: boolean }) {
  const handed = Array.isArray(data);
  const placeholder = handed && loading === true;
  const rows = handed ? (data as unknown[]).length : -1;
  paints.push({ placeholder, rows });
  return placeholder ? (
    <div data-testid="placeholder" data-type={schema?.type} />
  ) : (
    <div data-testid="inner-view" data-type={schema?.type} data-rows={rows} />
  );
}
function SelfQueryingStandIn({ schema }: { schema?: { type?: string } }) {
  return <div data-testid="inner-view" data-type={schema?.type} />;
}
for (const t of DRAWING) ComponentRegistry.register(`object-${t}`, DrawingStandIn as never);
for (const t of SELF_QUERYING) ComponentRegistry.register(`object-${t}`, SelfQueryingStandIn as never);

/** The positive control: a bare reader of the view's object. */
function BusControl() {
  return <span data-testid="bus-control">{useDataInvalidation('deal')}</span>;
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Answers one row more on every read, so a later delivery is distinguishable. */
function makeDataSource() {
  let answered = 0;
  const subscribers: ((event: { type: string; resource: string; id?: string }) => void)[] = [];
  return {
    subscribers,
    // The parameters are declared so `mock.calls[i][1]` below is typed.
    find: vi.fn(async (_objectName: string, _query?: unknown) => {
      await delay(20);
      answered += 1;
      const rows = Array.from({ length: answered }, (_, i) => ({ id: String(i + 1), name: `Deal ${i + 1}` }));
      return { data: rows, total: rows.length };
    }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => ({ name: 'deal', fields: { name: { type: 'text' } } })),
    onMutation: vi.fn((cb: (event: { type: string; resource: string; id?: string }) => void) => {
      subscribers.push(cb);
      return () => {};
    }),
  };
}

function view(type: string, filter?: unknown) {
  return [{ id: 'v', label: 'V', type, ...(filter ? { filter } : {}) }] as never;
}

function mount(type: string, ds = makeDataSource()) {
  const tree = (views: never) => (
    <SchemaRendererProvider dataSource={ds as never}>
      <BusControl />
      <ObjectView schema={{ type: 'object-view', objectName: 'deal' } as never} views={views} dataSource={ds as never} />
    </SchemaRendererProvider>
  );
  const { rerender } = render(tree(view(type)));
  return { ds, rerender: (views: never) => rerender(tree(views)) };
}

const rest = () => act(() => delay(80));
const emit = (change: { objectName: string; recordId?: string }) =>
  act(async () => {
    notifyDataChanged(change);
  });
const rowsOnScreen = () => screen.queryByTestId('inner-view')?.getAttribute('data-rows');
const placeholderPaints = () => paints.filter((p) => p.placeholder);

beforeEach(() => {
  paints.length = 0;
  // Best-effort metadata probes are not what these cases are about.
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '{}' })));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  cleanup();
});

describe('ObjectView reads rows only for a view that draws them (objectui#10982 b)', () => {
  for (const type of DRAWING) {
    it(`control — ${type}: read on mount, and re-read once on a bus event`, async () => {
      const { ds } = mount(type);
      await waitFor(() => expect(rowsOnScreen()).toBe('1'));
      await rest();
      expect(ds.find, 'one read on mount').toHaveBeenCalledTimes(1);

      await emit({ objectName: 'deal' });
      await rest();

      expect(ds.find, 'a data-drawing view was not re-read on the bus').toHaveBeenCalledTimes(2);
      await waitFor(() => expect(rowsOnScreen()).toBe('2'));
    });
  }

  for (const type of [...SELF_QUERYING, ...CASELESS]) {
    it(`${type}: never read by this component, on mount or on a bus event`, async () => {
      const { ds } = mount(type);
      if ((CASELESS as readonly string[]).includes(type)) {
        await waitFor(() => expect(screen.getByTestId('grid-stand-in')).toBeTruthy());
      } else {
        await waitFor(() => expect(screen.getByTestId('inner-view').getAttribute('data-type')).toBe(`object-${type}`));
      }
      // The fetch is gated on the settled object schema; wait it out, so the
      // zero below is not the gate still being closed.
      await waitFor(() => expect(ds.getObjectSchema).toHaveBeenCalled());
      await rest();

      await emit({ objectName: 'deal' });
      await rest();

      expect(screen.getByTestId('bus-control').textContent, 'control: the event never reached a subscriber').toBe('1');
      expect(ds.find, `the ${type} view was read for rows its renderer never draws`).not.toHaveBeenCalled();
    });
  }
});

describe('a re-read keeps the drawn rows on screen (objectui#10982 c)', () => {
  it('calendar: a bus re-read never paints the placeholder, and the first load does', async () => {
    const { ds } = mount('calendar');
    await waitFor(() => expect(rowsOnScreen()).toBe('1'));
    await rest();
    const firstRows = paints.findIndex((p) => p.rows === 1);
    expect(
      paints.slice(0, firstRows).some((p) => p.placeholder),
      'control: the first load never painted the placeholder',
    ).toBe(true);

    paints.length = 0;
    await emit({ objectName: 'deal' });
    await waitFor(() => expect(rowsOnScreen()).toBe('2'));
    await rest();

    expect(ds.find).toHaveBeenCalledTimes(2);
    expect(paints.some((p) => p.rows === 2), 'the re-read rows were never painted').toBe(true);
    expect(placeholderPaints(), 'the bus re-read swapped the rows on screen for the placeholder').toEqual([]);
  });

  it('calendar: a re-read on a write the data source announces (`onMutation`) keeps the rows too', async () => {
    const { ds } = mount('calendar');
    await waitFor(() => expect(rowsOnScreen()).toBe('1'));
    await rest();

    paints.length = 0;
    await act(async () => {
      ds.subscribers.forEach((cb) => cb({ type: 'update', resource: 'deal', id: '1' }));
    });
    await waitFor(() => expect(rowsOnScreen()).toBe('2'));
    await rest();

    expect(ds.find, 'one write, one re-read').toHaveBeenCalledTimes(2);
    expect(placeholderPaints(), 'the re-read after a write swapped the rows for the placeholder').toEqual([]);
  });

  it('control: a CHANGED request is a first load, so a new filter still paints the placeholder', async () => {
    const { ds, rerender } = mount('calendar');
    await waitFor(() => expect(rowsOnScreen()).toBe('1'));
    await rest();

    paints.length = 0;
    rerender(view('calendar', [['name', '=', 'Deal 1']]));
    await waitFor(() => expect(ds.find).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(rowsOnScreen()).toBe('2'));
    await rest();

    expect(ds.find.mock.calls[1][1], 'control: the new filter never reached the query').toMatchObject({ $filter: expect.anything() });
    expect(placeholderPaints().length, 'a changed request kept the previous request\'s rows up as if they answered it').toBeGreaterThan(0);
  });

  it('calendar: a failed re-read surfaces as a failed first load does — logged, rows kept, no placeholder', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { ds } = mount('calendar');
    await waitFor(() => expect(rowsOnScreen()).toBe('1'));
    await rest();

    const failure = new Error('re-read refused');
    ds.find.mockImplementationOnce(async () => {
      await delay(20);
      throw failure;
    });
    paints.length = 0;
    await emit({ objectName: 'deal' });
    await rest();

    expect(ds.find).toHaveBeenCalledTimes(2);
    expect(errorSpy, 'the failed re-read was swallowed').toHaveBeenCalledWith(expect.anything(), failure);
    expect(rowsOnScreen(), 'the failed re-read dropped the rows already drawn').toBe('1');
    expect(placeholderPaints()).toEqual([]);

    // The next event re-reads as normal.
    await emit({ objectName: 'deal' });
    await waitFor(() => expect(rowsOnScreen()).toBe('2'));
  });

  it('control: a failed first load is logged and does not leave the placeholder up', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ds = makeDataSource();
    const failure = new Error('first load refused');
    ds.find.mockImplementationOnce(async () => {
      await delay(20);
      throw failure;
    });
    mount('calendar', ds);
    await waitFor(() => expect(errorSpy).toHaveBeenCalledWith(expect.anything(), failure));
    await rest();

    expect(placeholderPaints().length, 'control: the first load never painted the placeholder').toBeGreaterThan(0);
    expect(screen.queryByTestId('placeholder'), 'the failed first load left the placeholder up').toBeNull();
    expect(rowsOnScreen()).toBe('0');
  });
});
