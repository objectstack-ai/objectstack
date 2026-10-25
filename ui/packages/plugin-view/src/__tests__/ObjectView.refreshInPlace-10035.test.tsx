/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10035 — a write refreshes the view's DATA; it does not rebuild the
 * view (AGENTS.md #8's corollary).
 *
 * ## The defect this pins
 *
 * `renderContent` keyed every view it rendered on
 * `objectName-view-type-refreshKey`, and `refreshKey` moves on every write
 * this component hears about (`onMutation`, a form save, a delete). So each
 * write REMOUNTED the view: a fresh instance, every piece of component state in
 * it gone. The rows were refetched too — through the remount — which is why
 * nothing looked broken: the damage was the remount, not a missing refetch.
 *
 * ## Two kinds of view, one rule
 *
 * - DATA-FED views (`kanban`, `calendar`, `gallery`, `timeline`, `map`) draw
 *   the `data` this component fetches; its non-grid fetch effect re-reads on
 *   `refreshKey`.
 * - SELF-FETCHING views (`gantt`, `tree`, `chart`, the grid branch) render a
 *   component that queries for itself. `tree` sat in the list above until
 *   objectui#10982: `ObjectTree` runs its own query ahead of any rows it is
 *   handed, so this component no longer reads rows for it at all (see
 *   `VIEW_TYPES_DRAWING_FETCHED_ROWS`). They read the data-invalidation bus
 *   (`useDataInvalidation`), which every site that moves `refreshKey` also
 *   notifies. That half used to be missing — they kept `refreshKey` in their
 *   key instead (`REMOUNT_TO_REFRESH_VIEW_TYPES`), and these cases asserted a
 *   fresh instance until the renderers gained the bus input.
 *
 * Every case asserts BOTH:
 *   (a) the rendered view is the SAME instance after the write, and
 *   (b) it received rows read after the write.
 * The self-fetching cases also assert (c): the write costs exactly ONE refetch
 * of that view (no refetch storm).
 *
 * The stand-ins carry an instance id from a `useState` initializer, which runs
 * once per mount: a changed id IS a remount. The self-fetching stand-in reads
 * the REAL bus hook and queries on it exactly as `ObjectGrid` / `ObjectGantt` /
 * `ObjectChart` now do, and `ObjectTree` does since objectui#10778 — each
 * renderer's own pin (`*.invalidationRefetch-*.test.tsx` in its package)
 * proves the real component does that; this file proves the HOST keeps them
 * mounted and tells the bus.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act, cleanup, fireEvent, within } from '@testing-library/react';
import { useDataInvalidation } from '@object-ui/react';
import { ObjectView } from '../ObjectView';
import type { ObjectViewSchema, DataSourceMutationEvent } from '@object-ui/types';

let instanceSeq = 0;

function useInstanceId(): number {
  const [id] = React.useState(() => ++instanceSeq);
  return id;
}

/**
 * A view that queries for itself and refetches on the bus — the idiom the
 * four real self-fetching renderers follow. Its own reads go through
 * `selfQuery`, so they are counted apart from the host's non-grid fetch.
 */
function SelfFetchingStandIn({ renderedType, objectName, dataSource }: any) {
  const id = useInstanceId();
  const nonce = useDataInvalidation(objectName);
  const [rows, setRows] = React.useState(-1);
  React.useEffect(() => {
    let live = true;
    void dataSource.selfQuery().then((n: number) => {
      if (live) setRows(n);
    });
    return () => {
      live = false;
    };
  }, [dataSource, objectName, nonce]);
  return <div data-testid="rendered-view" data-type={renderedType} data-instance={id} data-rows={rows} />;
}

vi.mock('@object-ui/react', async (importOriginal) => {
  const ReactMod = await import('react');
  function ViewStandIn({ schema, data, dataSource }: any) {
    const id = useInstanceId();
    if (schema?.type === 'object-gantt' || schema?.type === 'object-chart' || schema?.type === 'object-tree') {
      return <SelfFetchingStandIn renderedType={schema.type} objectName={schema.objectName} dataSource={dataSource} />;
    }
    return (
      <div
        data-testid="rendered-view"
        data-type={schema?.type}
        data-instance={id}
        data-rows={Array.isArray(data) ? data.length : -1}
      />
    );
  }
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    SchemaRenderer: ViewStandIn,
    SchemaRendererContext: ReactMod.createContext(null),
  };
});
vi.mock('@object-ui/plugin-grid', async (importOriginal) => {
  function GridStandIn({ schema, dataSource, onDelete }: any) {
    return (
      <>
        <SelfFetchingStandIn renderedType="object-grid" objectName={schema?.objectName} dataSource={dataSource} />
        <button type="button" data-testid="grid-delete-row" onClick={() => onDelete?.({ id: '1', name: 'Row 1' })} />
      </>
    );
  }
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    ObjectGrid: GridStandIn,
  };
});
vi.mock('@object-ui/plugin-form', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ObjectForm: () => <div data-testid="object-form" />,
}));

/**
 * A DataSource that answers one row, then two — so a later delivery is
 * distinguishable from the first — and hands its `onMutation` subscribers back
 * to the test, so a write can be announced the way a real adapter does.
 * `selfQuery` is the self-fetching stand-ins' own read, counted separately.
 */
function makeDataSource() {
  const subscribers: ((event: DataSourceMutationEvent) => void)[] = [];
  let answered = 0;
  const find = vi.fn(async () => {
    answered += 1;
    const rows = Array.from({ length: answered }, (_, i) => ({ id: String(i + 1), name: `Row ${i + 1}` }));
    return { data: rows, total: rows.length };
  });
  let selfAnswered = 0;
  const selfQuery = vi.fn(async () => {
    selfAnswered += 1;
    return selfAnswered;
  });
  const ds: any = {
    find,
    selfQuery,
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    // Resolves WITHOUT announcing itself on `onMutation`: the delete case below
    // needs a write only the host's own declaration reports.
    delete: vi.fn(async () => ({})),
    getObjectSchema: vi.fn().mockResolvedValue({ name: 'task', fields: {} }),
    onMutation: vi.fn((cb: (event: DataSourceMutationEvent) => void) => {
      subscribers.push(cb);
      return () => {};
    }),
  };
  return {
    ds,
    find,
    selfQuery,
    write: async () => {
      await act(async () => {
        subscribers.forEach((cb) => cb({ type: 'create', resource: 'task', id: 'new' }));
      });
    },
  };
}

function renderView(type: string, ds: unknown) {
  render(
    <ObjectView
      schema={{ type: 'object-view', objectName: 'task' } as ObjectViewSchema}
      views={[{ id: 'v', label: 'V', type } as never]}
      dataSource={ds as never}
    />,
  );
}

const view = () => screen.getByTestId('rendered-view');
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 100)));

beforeEach(() => {
  cleanup();
  instanceSeq = 0;
});

describe('ObjectView refreshes a data-fed view in place after a write (objectui#10035)', () => {
  // Every non-grid type whose renderer draws the `data` this component fetches.
  // Every case goes through a `views` prop, as the host-only types below must
  // (objectui#5321).
  it.each(['kanban', 'calendar', 'gallery', 'timeline', 'map'])(
    '%s: the same view instance receives the refetched rows',
    async (type) => {
      const { ds, find, write } = makeDataSource();
      renderView(type, ds);
      await waitFor(() => expect(view().dataset.rows).toBe('1'));
      const before = view().dataset.instance;

      await write();

      await waitFor(() => expect(find).toHaveBeenCalledTimes(2));
      await waitFor(() =>
        expect(
          view().dataset.rows,
          '(b) The view never received the rows refetched after the write. The refresh\n'
            + 'signal (`refreshKey`) must still reach the non-grid fetch effect once it\n'
            + 'no longer rides in the key.',
        ).toBe('2'),
      );
      expect(
        view().dataset.instance,
        '(a) The write REMOUNTED the view. `refreshKey` is back in its `key`, so every\n'
          + 'save throws the view\'s component state away (AGENTS.md #8: refresh data,\n'
          + 'don\'t rebuild UI).',
      ).toBe(before);
    },
  );
});

describe('ObjectView keeps a self-fetching view mounted and tells the bus instead (objectui#10035)', () => {
  it.each([
    ['gantt', 'object-gantt'],
    ['tree', 'object-tree'],
    ['chart', 'object-chart'],
    ['grid', 'object-grid'],
  ])('%s: after a data-source write, the same instance refetches once', async (type, renderedType) => {
    const { ds, selfQuery, write } = makeDataSource();
    renderView(type, ds);
    await waitFor(() => expect(view().dataset.type).toBe(renderedType));
    await waitFor(() => expect(view().dataset.rows).toBe('1'));
    await settle();
    const before = view().dataset.instance;
    const queriesBefore = selfQuery.mock.calls.length;

    await write();

    await waitFor(() =>
      expect(
        view().dataset.rows,
        `(b) The ${type} view never refetched after the write. Its renderer queries for\n`
          + 'itself and reads the data-invalidation bus, so the host must publish the write\n'
          + 'there (the `onMutation` subscription) now that it no longer remounts the view.',
      ).toBe('2'),
    );
    await settle();
    expect(selfQuery.mock.calls.length - queriesBefore, '(c) one write, one refetch').toBe(1);
    expect(
      view().dataset.instance,
      `(a) The write REMOUNTED the ${type} view: \`refreshKey\` is back in its key.`,
    ).toBe(before);
  });

  it('grid: the host\'s own delete is announced even when the data source does not announce it', async () => {
    const { ds, selfQuery } = makeDataSource();
    renderView('grid', ds);
    await waitFor(() => expect(view().dataset.rows).toBe('1'));
    await settle();
    const before = view().dataset.instance;
    const queriesBefore = selfQuery.mock.calls.length;

    fireEvent.click(screen.getByTestId('grid-delete-row'));
    const dialog = await screen.findByRole('alertdialog');
    const buttons = within(dialog).getAllByRole('button');
    await act(async () => {
      fireEvent.click(buttons[buttons.length - 1]);
    });

    await waitFor(() => expect(ds.delete).toHaveBeenCalledWith('task', '1'));
    await waitFor(() =>
      expect(
        view().dataset.rows,
        '(b) The grid never refetched after the host deleted a row. The delete\'s\n'
          + '`onRefresh` must declare the write on the bus (`announceOwnWrite`).',
      ).toBe('2'),
    );
    await settle();
    expect(selfQuery.mock.calls.length - queriesBefore, '(c) one write, one refetch').toBe(1);
    expect(view().dataset.instance, '(a) the delete REMOUNTED the grid').toBe(before);
  });
});
