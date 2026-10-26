/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10887 member 1 — an `object-view` in a non-grid view re-reads its
 * rows when the data-invalidation bus (`notifyDataChanged` from
 * `@object-ui/react`) reports a change to the object it queries.
 *
 * For every non-grid view `ObjectView` fetches the rows itself and hands them
 * to the inner view as `data`, which switches off that view's own bus reader.
 * Before this card the fetch effect keyed on `refreshKey`, which moves only on
 * the view's own write and `dataSource.onMutation`. A page action over raw HTTP
 * fires neither, so the rows were re-read only because `PageView` remounted
 * the page, and objectui#10519 removes that remount. The effect now names the
 * `useDataInvalidation` nonce for `schema.objectName`, the objectui#10623 /
 * #10778 / #10853 shape.
 *
 * Rendered through the real `SchemaRenderer` and this package's own
 * registration of `object-view`, in the page-region shape (`properties`). The
 * fake data source counts reads and implements no `onMutation`, as a page
 * action's raw HTTP write announces none. The inner views are stand-ins
 * registered in the real registry: this package does not depend on the
 * plugins that register them, and the rows are this component's read. Each
 * stand-in carries an instance id from a `useState` initializer, so a changed
 * id is a remount.
 *
 * Controls: the bare `useDataInvalidation` reader beside the view and a grid
 * `object-view` (`ObjectGrid` reads the bus itself) move on every event, a
 * view with no object never reads, and the view types whose renderers query
 * for themselves (`gantt`, and the host-only `tree` and `chart`) are not
 * re-read by this fetch. `gantt` was in the re-read list until objectui#10982:
 * its stand-in here drew the handed rows, but the registered `object-gantt`
 * wrapper hands its component the schema alone, so nothing drew them
 * (`ObjectView.fetchAllowList-10982.test.tsx` pins the whole allow-list).
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup, screen, waitFor } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import {
  SchemaRenderer,
  SchemaRendererProvider,
  notifyDataChanged,
  useDataInvalidation,
} from '@object-ui/react';
// Module scope, not a hook: this import IS the registration of `object-view`.
import '../index';
import { ObjectView } from '../ObjectView';

const NON_GRID_TYPES = ['kanban', 'calendar', 'gallery', 'timeline', 'map'] as const;

let instanceSeq = 0;
function InnerViewStandIn({ schema, data }: { schema?: { type?: string }; data?: unknown }) {
  const [id] = React.useState(() => ++instanceSeq);
  return (
    <div
      data-testid="inner-view"
      data-type={schema?.type}
      data-instance={id}
      data-rows={Array.isArray(data) ? data.length : -1}
    />
  );
}
for (const t of [...NON_GRID_TYPES, 'gantt', 'tree', 'chart']) ComponentRegistry.register(`object-${t}`, InnerViewStandIn as never);

/** The positive control: a bare reader of the view's object. */
function BusControl() {
  return <span data-testid="bus-control">{useDataInvalidation('deal')}</span>;
}

beforeEach(() => {
  // Best-effort metadata probes are not what these cases are about.
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '{}' })));
});
afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

/** Answers one row more on every read, so a later delivery is distinguishable. */
function makeDataSource() {
  let answered = 0;
  return {
    // The parameters are declared so `mock.calls[i][0]` below is typed.
    find: vi.fn(async (_objectName: string, _query?: unknown) => {
      answered += 1;
      const rows = Array.from({ length: answered }, (_, i) => ({ id: String(i + 1), name: `Deal ${i + 1}` }));
      return { data: rows, total: rows.length };
    }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => ({ name: 'deal', fields: { name: { type: 'text' } } })),
  };
}

function mount(properties: Record<string, unknown>) {
  const ds = makeDataSource();
  render(
    <SchemaRendererProvider dataSource={ds as never}>
      <BusControl />
      <SchemaRenderer schema={{ type: 'object-view', properties } as never} />
    </SchemaRendererProvider>,
  );
  return ds;
}

const rest = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 60)));
const emit = (change: { objectName: string; recordId?: string }) =>
  act(async () => {
    notifyDataChanged(change);
  });
const inner = () => screen.getByTestId('inner-view');

async function mountAtRest(viewType: string) {
  const ds = mount({ objectName: 'deal', defaultViewType: viewType });
  await waitFor(() => expect(ds.find).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(inner().getAttribute('data-rows')).toBe('1'));
  await rest();
  expect(ds.find, 'one read on mount').toHaveBeenCalledTimes(1);
  return ds;
}

describe('object-view non-grid views re-read on the data-invalidation bus (objectui#10887)', () => {
  for (const viewType of NON_GRID_TYPES) {
    it(`${viewType}: an unscoped change ("*") re-reads once, in place`, async () => {
      const ds = await mountAtRest(viewType);
      const instance = inner().getAttribute('data-instance');

      await emit({ objectName: '*' });
      await rest();

      expect(screen.getByTestId('bus-control').textContent, 'control: the event never reached a subscriber').toBe('1');
      expect(ds.find, 'the rows never re-read after the bus reported a change').toHaveBeenCalledTimes(2);
      expect(ds.find.mock.calls[1][0]).toBe('deal');
      await waitFor(() => expect(inner().getAttribute('data-rows'), 'the re-read rows never reached the view').toBe('2'));
      expect(inner().getAttribute('data-type')).toBe(`object-${viewType}`);
      expect(inner().getAttribute('data-instance'), 'the re-read remounted the view').toBe(instance);
    });

    it(`${viewType}: a change to its own object re-reads once; an unrelated object does not`, async () => {
      const ds = await mountAtRest(viewType);

      await emit({ objectName: 'unrelated_object' });
      await rest();
      expect(ds.find, 'a change to another object re-read the rows').toHaveBeenCalledTimes(1);

      await emit({ objectName: 'deal', recordId: '1' });
      await rest();
      expect(ds.find, 'a change to its own object did not re-read the rows exactly once').toHaveBeenCalledTimes(2);
      await waitFor(() => expect(inner().getAttribute('data-rows')).toBe('2'));
    });
  }

  it('lit control: a grid object-view re-reads on the same event through its own reader (ObjectGrid)', async () => {
    const ds = mount({ objectName: 'deal', defaultViewType: 'grid' });
    await waitFor(() => expect(ds.find).toHaveBeenCalled());
    await rest();
    const before = ds.find.mock.calls.length;

    await emit({ objectName: '*' });
    await rest();

    expect(ds.find, 'the grid never re-read: the event did not reach a block that reads the bus').toHaveBeenCalledTimes(before + 1);
  });

  it('control: an object-view with no object reads nothing, on mount or on an invalidation', async () => {
    const ds = mount({ defaultViewType: 'kanban' });
    await rest();

    await emit({ objectName: '*' });
    await rest();

    expect(screen.getByTestId('bus-control').textContent).toBe('1');
    expect(ds.find).not.toHaveBeenCalled();
  });

  // objectui#10982 — `gantt` is authorable, so this goes through the registered
  // renderer. Its stand-in above would draw rows, but the real `object-gantt`
  // wrapper forwards none: the chart queries for itself and reads the bus
  // itself, so a read here only added one beside it.
  it('control: an object-view drawn as a gantt is not re-read by this fetch', async () => {
    const ds = mount({ objectName: 'deal', defaultViewType: 'gantt' });
    await waitFor(() => expect(inner().getAttribute('data-type')).toBe('object-gantt'));
    await waitFor(() => expect(ds.getObjectSchema).toHaveBeenCalled());
    await rest();
    const before = ds.find.mock.calls.length;

    await emit({ objectName: '*' });
    await rest();

    expect(screen.getByTestId('bus-control').textContent).toBe('1');
    expect(ds.find, "the gantt view's rows were re-read beside its own reader").toHaveBeenCalledTimes(before);
  });

  // `tree` and `chart` are reachable only from a host `views` prop, not through
  // the registered renderer, so these compose the component the way a host
  // does. Their renderers query for themselves and read the bus themselves:
  // `ObjectTree` runs its own query ahead of the rows handed to it and
  // re-queries when that array changes, and `ObjectChart` never reads them. A
  // re-read of this component's rows would only add reads beside theirs.
  for (const hostType of ['tree', 'chart'] as const) {
    it(`control: a host-composed ${hostType} view is not re-read by this fetch`, async () => {
      const ds = makeDataSource();
      render(
        <SchemaRendererProvider dataSource={ds as never}>
          <BusControl />
          <ObjectView
            schema={{ type: 'object-view', objectName: 'deal' } as never}
            views={[{ id: hostType, label: hostType, type: hostType }] as never}
            dataSource={ds as never}
          />
        </SchemaRendererProvider>,
      );
      await waitFor(() => expect(inner().getAttribute('data-type')).toBe(`object-${hostType}`));
      await rest();
      const before = ds.find.mock.calls.length;

      await emit({ objectName: '*' });
      await rest();

      expect(screen.getByTestId('bus-control').textContent).toBe('1');
      expect(ds.find, `the ${hostType} view's rows were re-read beside its own reader`).toHaveBeenCalledTimes(before);
    });
  }
});
