/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10816 — a re-read of the SAME source keeps the tree's rows on
 * screen, with `RefreshIndicator` over them; only a tree that holds no rows for
 * the source it is bound to now draws the "Loading…" placeholder.
 *
 * Before this card the render returned the placeholder whenever `loading` was
 * true, and the record effect sets it on every read. objectui#10809 made the
 * tree re-read on every data-invalidation event for its object, so each event
 * swapped the whole scroll container (`data-testid="object-tree"`) for the
 * placeholder and back: the rows flashed, and a scrolled tree lost its offset.
 *
 * The rule, one case each:
 *  - a re-read of the source the rows were read for (here: a bus event) keeps
 *    the rows, the scroll container and the user's expansion on screen while
 *    the read is pending, and shows the refresh bar;
 *  - a first mount has no rows for its source, so it draws the placeholder
 *    (the control);
 *  - a switch to another object or another provider has no rows for the NEW
 *    source either, so it draws the placeholder too — the previous source's
 *    rows are never drawn under the new one.
 *
 * Rendered through the real `SchemaRenderer` and this package's own
 * registration, over a fake data source whose next read the test holds
 * pending by hand, so the "read in flight" window is observed rather than
 * raced.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup, screen, waitFor } from '@testing-library/react';
import { SchemaRenderer, SchemaRendererProvider, notifyDataChanged } from '@object-ui/react';
import { ValueDataSource } from '@object-ui/core';
// Registers `object-tree` through this package's own entry.
import './index';

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

/** A gate the test opens by hand: the window in which a read is pending. */
function makeGate() {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

function makeDataSource() {
  const tables: Record<string, Array<Record<string, unknown>>> = {
    category: [
      { id: '1', name: 'Acme', parent_id: null },
      { id: '2', name: 'Engineering', parent_id: '1' },
    ],
    department: [{ id: 'd1', name: 'Finance', parent_id: null }],
  };
  // `armed` is the gate the NEXT read will take; `taken` is the one a read is
  // waiting on now. Two slots, so `release` opens the gate a read actually holds.
  let armed: ReturnType<typeof makeGate> | null = null;
  let taken: ReturnType<typeof makeGate> | null = null;
  return {
    tables,
    /** The NEXT read stays pending until {@link release} is called. */
    holdNextRead() {
      armed = makeGate();
    },
    release() {
      (taken ?? armed)?.open();
    },
    find: vi.fn(async (object: string, _query?: unknown) => {
      const held = armed;
      armed = null;
      if (held) {
        taken = held;
        await held.promise;
      }
      const rows = tables[object] ?? [];
      return { data: rows.map((r) => ({ ...r })), total: rows.length };
    }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async (object: string) => ({
      name: object,
      fields: { name: { type: 'text' }, parent_id: { type: 'text' } },
    })),
  };
}

const tree = (schema: Record<string, unknown>, ds: ReturnType<typeof makeDataSource>) => (
  <SchemaRendererProvider dataSource={ds as any}>
    <SchemaRenderer schema={schema as any} />
  </SchemaRendererProvider>
);

const BLOCK = { type: 'object-tree', objectName: 'category', parentField: 'parent_id', labelField: 'name' };

/** The refresh bar, by role — its accessible name is whatever the locale says. */
const refreshBar = () => screen.queryByRole('progressbar');

describe('object-tree keeps its rows on a re-read of the same source (objectui#10816)', () => {
  it('a bus-driven re-read keeps the rows and the scroll container on screen, with the refresh bar over them', async () => {
    const ds = makeDataSource();
    render(tree(BLOCK, ds));
    await waitFor(() => expect(screen.getByText('Acme')).toBeTruthy());
    await settle();
    expect(ds.find).toHaveBeenCalledTimes(1);
    expect(refreshBar(), 'a settled tree shows no refresh bar').toBeNull();
    const scroller = screen.getByTestId('object-tree');

    ds.holdNextRead();
    ds.tables.category[0].name = 'Acme (renamed)';
    await act(async () => {
      notifyDataChanged({ objectName: 'category' });
    });
    await settle();

    // The read is in flight: asked for, not answered.
    expect(ds.find).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('Loading…'), 'the re-read swapped the rows for the placeholder').toBeNull();
    // Before this card React REUSED the container's `div` for the placeholder
    // (same type, same position) but stripped its `data-testid` and its
    // `overflow-auto` and unmounted the whole table under it, so the scroll
    // offset collapsed with the content.
    expect(
      screen.queryByTestId('object-tree'),
      'the scroll container was stripped to the placeholder by the re-read, so its scroll offset is gone',
    ).toBe(scroller);
    expect(screen.getByText('Acme')).toBeTruthy();
    expect(screen.getByText('Engineering')).toBeTruthy();
    const bar = refreshBar();
    expect(bar, 'no refresh bar while the rows are being re-read').not.toBeNull();
    // Named through the locale seam: never empty, never the raw key.
    expect(bar!.getAttribute('aria-label')).toBeTruthy();
    expect(bar!.getAttribute('aria-label')).not.toBe('grid.refreshing');
    expect(scroller.contains(bar)).toBe(true);

    await act(async () => {
      ds.release();
    });
    await settle();

    expect(screen.getByText('Acme (renamed)')).toBeTruthy();
    expect(screen.getByTestId('object-tree')).toBe(scroller);
    expect(refreshBar(), 'the refresh bar outlived the read').toBeNull();
  });

  it('the user’s flipped expansion stays on screen through the read, and the new value paints once it resolves', async () => {
    const ds = makeDataSource();
    render(tree(BLOCK, ds));
    await waitFor(() => expect(screen.getByText('Engineering')).toBeTruthy());
    await settle();

    // The user collapses the root: component state that a placeholder swap
    // takes off the screen and a remount would lose outright.
    const toggle = screen.getByRole('button', { name: /Expand|Collapse/ });
    const before = toggle.getAttribute('aria-label');
    await act(async () => {
      toggle.click();
    });
    const flipped = screen.getByRole('button', { name: /Expand|Collapse/ }).getAttribute('aria-label');
    expect(flipped).not.toBe(before);
    expect(screen.queryByText('Engineering'), 'control: the collapse hid the child').toBeNull();

    ds.holdNextRead();
    ds.tables.category[0].name = 'Acme (renamed)';
    await act(async () => {
      notifyDataChanged({ objectName: 'category' });
    });
    await settle();
    expect(ds.find).toHaveBeenCalledTimes(2);

    const during = screen.queryByRole('button', { name: /Expand|Collapse/ });
    expect(during, 'the expansion toggle left the screen while the read was pending').not.toBeNull();
    expect(during!.getAttribute('aria-label')).toBe(flipped);
    expect(screen.queryByText('Engineering')).toBeNull();

    await act(async () => {
      ds.release();
    });
    await settle();

    expect(screen.getByText('Acme (renamed)')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Expand|Collapse/ }).getAttribute('aria-label')).toBe(flipped);
    expect(screen.queryByText('Engineering'), 'the re-read re-seeded over the user’s collapse').toBeNull();
  });

  it('control: a first mount draws the placeholder while its read is pending, and no refresh bar', async () => {
    const ds = makeDataSource();
    ds.holdNextRead();
    render(tree(BLOCK, ds));
    await waitFor(() => expect(ds.find).toHaveBeenCalledTimes(1));
    await settle();

    expect(screen.getByText('Loading…')).toBeTruthy();
    expect(screen.queryByTestId('object-tree')).toBeNull();
    expect(refreshBar()).toBeNull();

    await act(async () => {
      ds.release();
    });
    await settle();
    expect(screen.getByText('Acme')).toBeTruthy();
    expect(screen.queryByText('Loading…')).toBeNull();
  });

  it('a switch to another object draws the placeholder, never the previous object’s rows', async () => {
    const ds = makeDataSource();
    const { rerender } = render(tree(BLOCK, ds));
    await waitFor(() => expect(screen.getByText('Acme')).toBeTruthy());
    await settle();

    ds.holdNextRead();
    rerender(tree({ ...BLOCK, objectName: 'department' }, ds));
    await waitFor(() => expect(ds.find).toHaveBeenCalledTimes(2));
    await settle();
    expect(ds.find.mock.calls[1][0]).toBe('department');

    expect(screen.queryByText('Acme'), 'the previous object’s rows were drawn under the new object').toBeNull();
    expect(screen.queryByText('Engineering')).toBeNull();
    expect(screen.getByText('Loading…')).toBeTruthy();
    expect(refreshBar()).toBeNull();

    await act(async () => {
      ds.release();
    });
    await settle();
    expect(screen.getByText('Finance')).toBeTruthy();
    expect(screen.queryByText('Acme')).toBeNull();
  });

  it('a switch to another provider draws the placeholder, never the previous provider’s rows', async () => {
    const ds = makeDataSource();
    const { rerender } = render(tree(BLOCK, ds));
    await waitFor(() => expect(screen.getByText('Acme')).toBeTruthy());
    await settle();

    // Hold the inline provider's own query, so its pending window is observed.
    const gate = makeGate();
    const inlineFind = ValueDataSource.prototype.find;
    vi.spyOn(ValueDataSource.prototype, 'find').mockImplementation(async function (this: ValueDataSource<any>, ...args) {
      await gate.promise;
      return inlineFind.apply(this, args);
    });

    const { objectName: _bound, ...rest } = BLOCK;
    rerender(
      tree(
        { ...rest, data: { provider: 'value', items: [{ id: 'v1', name: 'Inline root', parent_id: null }] } },
        ds,
      ),
    );
    await settle();

    expect(screen.queryByText('Acme'), 'the previous provider’s rows were drawn under the new provider').toBeNull();
    expect(screen.getByText('Loading…')).toBeTruthy();
    expect(refreshBar()).toBeNull();

    await act(async () => {
      gate.open();
    });
    await settle();
    expect(screen.getByText('Inline root')).toBeTruthy();
    expect(screen.queryByText('Acme')).toBeNull();
  });
});
