/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10712 (R3) — the `record:line_items` panel (`LineItemsPanel`) holds
 * a same-parent reload while it has unsaved edits.
 *
 * The panel re-reads its rows whenever a load input moves: the parent, and the
 * query's shape (sort, limit, filter). A read's commit replaces the rows and
 * clears `dirty`. So when the host re-rendered the node with another sort,
 * limit or filter while the author had unsaved lines, the re-read discarded
 * those lines with no signal: the grid drew the server's rows, Save went off,
 * and nothing said an edit had been lost.
 *
 * Now the rule the default form already applies to its own background re-read
 * (`ObjectForm.tsx`, `formDirtyRef` / `heldChangeRef`: unsaved input holds the
 * re-read; one is replayed when the form is pristine again or its save lands)
 * applies here. A change to a load input other than the parent is HELD while
 * the panel holds unsaved edits for the CURRENT parent — `dirty`, the rows
 * held for `parentId`, and the last run's parent (and adapter, child object
 * and relationship field) equal to the current ones. A held change issues no
 * read; the next read that runs reads the panel's current inputs, so it
 * replays the held change: the post-save reload (which since objectui#10712
 * reads the current inputs, not the click's), a parent move, or — when a
 * same-parent read was in flight at the hold — that read's commit, which
 * replays one read.
 *
 * What the rule leaves alone, pinned as controls: a change while the panel is
 * clean reloads as before; a parent move while dirty behaves as objectui#10740
 * set (the new parent is read, and the held rows are refused there); a swap
 * back to the edited parent after a move is read (the last run's parent was
 * the other one); a change of adapter or child object is read (the held rows
 * are not that adapter's or that object's).
 *
 * The cost, stated: while a change is held, the grid shows the rows under the
 * previous sort, filter or limit until the panel saves, with no signal.
 *
 * Rendered through the real `SchemaRenderer` and this package's own
 * registration of `record:line_items`. Every `find` and every
 * `batchTransaction` returns a promise the test settles by hand; no timer
 * decides an ordering.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
// Registers `record:line_items` through this package's own entry.
import './index';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

type LinesRead = Deferred<any> & { objectName: string; query: any; parentId: unknown };
type Save = Deferred<any> & { ops: any[] };

/**
 * Every row load (`find`) and every save (`batchTransaction`) returns a promise
 * the test settles by hand. The child schema read is answered at once with no
 * schema, so child payloads are persisted as the grid holds them.
 */
function makeLinesDataSource() {
  const lineReads: LinesRead[] = [];
  const saves: Save[] = [];
  const dataSource = {
    getObjectSchema: vi.fn(async () => null),
    find: vi.fn((objectName: string, query: any) => {
      const d = deferred<any>();
      lineReads.push({ ...d, objectName, query, parentId: parentOf(query) });
      return d.promise;
    }),
    batchTransaction: vi.fn((ops: any[]) => {
      const d = deferred<any>();
      saves.push({ ...d, ops });
      return d.promise;
    }),
  };
  return { dataSource, lineReads, saves };
}

/** The parent a query is scoped to: the plain `po` key, or the first leg of the AND-merged node. */
function parentOf(query: any): unknown {
  const f = query?.$filter;
  if (f && !Array.isArray(f)) return f.po;
  if (Array.isArray(f) && f[0] === 'and') {
    const leg = f.find((x: any) => Array.isArray(x) && x[0] === 'po' && x[1] === '=');
    return leg?.[2];
  }
  return undefined;
}

/** A panel on an existing parent record, over one text column. */
const linesBlock = (over: Record<string, unknown> = {}) => ({
  type: 'record:line_items',
  childObject: 'po_line',
  relationshipField: 'po',
  parentObject: 'po',
  parentId: 'p1',
  columns: [{ name: 'label', label: 'Line', type: 'text' }],
  ...over,
});

const tree = (b: Record<string, unknown>, ds: unknown) => (
  <SchemaRendererProvider dataSource={ds as any}>
    <SchemaRenderer schema={b as any} />
  </SchemaRendererProvider>
);

function mount(dataSource: unknown, block: Record<string, unknown>) {
  const view = render(tree(block, dataSource));
  return {
    rerender: (next: Record<string, unknown>, ds: unknown = dataSource) => view.rerender(tree(next, ds)),
  };
}

/** The `n`-th read or save (1-based) once it has been issued. */
async function nth<T>(items: T[], n: number): Promise<T> {
  await waitFor(() => {
    if (items.length < n) throw new Error(`item ${n} not issued yet (${items.length} so far)`);
  });
  return items[n - 1];
}

async function settle(fn: () => void) {
  await act(async () => {
    fn();
    await Promise.resolve();
  });
}

const answerLines = (read: LinesRead, ...lines: Array<{ id: string; label: string }>) =>
  settle(() => read.resolve({ data: lines }));
const fail = (read: Deferred<any>, message: string) => settle(() => read.reject(new Error(message)));
const landSave = (save: Save) => settle(() => save.resolve({ results: [] }));

/** The grid's line inputs; the grid always trails one blank entry row. */
const lineInputs = () =>
  Array.from(document.body.querySelectorAll('input[aria-label="Line"]')) as HTMLInputElement[];
/** The lines the grid draws (its trailing blank row is not a line). */
const shownLines = () => lineInputs().map((input) => input.value).filter((value) => value !== '');
const saveButton = () =>
  Array.from(document.body.querySelectorAll('button')).find((b) => /^(Save|Saving…)$/.test(b.textContent ?? '')) as
    | HTMLButtonElement
    | undefined;
const bannerShows = (message: string) =>
  Array.from(document.body.querySelectorAll('p')).some((p) => p.textContent === message);
const placeholder = () => document.body.querySelector('[data-testid="line-items-held-for-another-parent"]');
const loadingShown = () => Array.from(document.body.querySelectorAll('p')).some((p) => p.textContent === 'Loading…');

async function editFirstLine(to: string) {
  await act(async () => {
    fireEvent.change(lineInputs()[0], { target: { value: to } });
  });
}

async function clickSave() {
  const button = saveButton();
  expect(button, 'no Save button').toBeTruthy();
  await act(async () => {
    fireEvent.click(button!);
  });
}

/** Mounts a panel on `p1` and lands `l1`; the panel is clean. */
async function mountP1Clean() {
  const ds = makeLinesDataSource();
  const view = mount(ds.dataSource, linesBlock());
  const first = await nth(ds.lineReads, 1);
  expect(first.parentId).toBe('p1');
  await answerLines(first, { id: 'l1', label: 'p1 line' });
  await waitFor(() => expect(shownLines()).toEqual(['p1 line']));
  expect(saveButton()?.disabled).toBe(true);
  return { ...ds, view };
}

/** `mountP1Clean`, then edits `l1`; Save is then enabled. */
async function mountP1Edited() {
  const held = await mountP1Clean();
  await editFirstLine('p1 line edited');
  await waitFor(() => expect(saveButton()?.disabled).toBe(false));
  return held;
}

/** The three load inputs other than the parent, each as a re-render of the same node. */
const INPUT_CHANGES: ReadonlyArray<{ input: string; over: Record<string, unknown>; carried: (q: any) => void }> = [
  { input: 'sort', over: { sort: [{ field: 'label', order: 'asc' }] }, carried: (q) => expect(q.$orderby).toEqual({ label: 'asc' }) },
  { input: 'limit', over: { limit: 200 }, carried: (q) => expect(q.$top).toBe(200) },
  {
    input: 'filter',
    over: { filter: { note: 'x' } },
    carried: (q) => expect(q.$filter).toEqual(['and', ['po', '=', 'p1'], ['note', '=', 'x']]),
  },
];

/** Holds the edits still: the edited line drawn editable, Save on, no read pending, no placeholder. */
function expectEditsHeld() {
  expect(shownLines(), 'the unsaved edit was discarded').toEqual(['p1 line edited']);
  expect(lineInputs().every((input) => !input.disabled)).toBe(true);
  expect(loadingShown()).toBe(false);
  expect(placeholder()).toBeNull();
  expect(saveButton()?.disabled, 'Save went off over an unsaved edit').toBe(false);
}

beforeEach(() => {
  // Each failure below is logged by the panel; keep the run readable.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

describe.each(INPUT_CHANGES)('LineItemsPanel holds a $input change while it has unsaved edits (objectui#10712 R3)', ({ over, carried }) => {
  it('control: the change while the panel is CLEAN reloads with it, as before', async () => {
    const { dataSource, lineReads, view } = await mountP1Clean();

    view.rerender(linesBlock(over));
    const reload = await nth(lineReads, 2);
    expect(reload.parentId).toBe('p1');
    carried(reload.query);
    await answerLines(reload, { id: 'l1', label: 'p1 line again' });

    await waitFor(() => expect(shownLines()).toEqual(['p1 line again']));
    expect(dataSource.find).toHaveBeenCalledTimes(2);
    expect(saveButton()?.disabled).toBe(true);
  });

  it('while DIRTY: the change issues no read, keeps the edited line drawn editable, and leaves Save on', async () => {
    const { dataSource, view } = await mountP1Edited();

    view.rerender(linesBlock(over));
    await settle(() => {});

    expect(dataSource.find, 'a same-parent reload ran over unsaved edits').toHaveBeenCalledTimes(1);
    expectEditsHeld();
  });

  it('the post-save reload then reads the CURRENT inputs, and the held change is replayed by it', async () => {
    const { dataSource, lineReads, saves, view } = await mountP1Edited();
    view.rerender(linesBlock(over));
    await settle(() => {});
    expect(dataSource.find).toHaveBeenCalledTimes(1);

    await clickSave();
    const save = await nth(saves, 1);
    expect(save.ops).toEqual([
      { object: 'po_line', action: 'update', id: 'l1', data: { label: 'p1 line edited', po: 'p1' } },
    ]);
    await landSave(save);

    const reload = await nth(lineReads, 2);
    expect(reload.parentId).toBe('p1');
    carried(reload.query);
    await answerLines(reload, { id: 'l1', label: 'p1 line saved' });

    await waitFor(() => expect(shownLines()).toEqual(['p1 line saved']));
    expect(dataSource.find, 'the held change was replayed twice').toHaveBeenCalledTimes(2);
    expect(saveButton()?.disabled).toBe(true);
  });
});

describe('what the hold leaves alone (objectui#10712 R3 controls)', () => {
  it('a parent move while dirty is read, and the held rows are refused there (objectui#10740): p2 is read, its failure draws the placeholder, Save is off', async () => {
    const { dataSource, lineReads, view } = await mountP1Edited();
    view.rerender(linesBlock({ sort: [{ field: 'label', order: 'asc' }] }));
    await settle(() => {});
    expect(dataSource.find).toHaveBeenCalledTimes(1);

    view.rerender(linesBlock({ parentId: 'p2', sort: [{ field: 'label', order: 'asc' }] }));
    const second = await nth(lineReads, 2);
    expect(second.parentId).toBe('p2');
    expect(second.query.$orderby).toEqual({ label: 'asc' });
    await fail(second, 'p2 load failed');

    await waitFor(() => expect(bannerShows('p2 load failed')).toBe(true));
    expect(placeholder()).toBeTruthy();
    expect(shownLines()).toEqual([]);
    expect(saveButton()?.disabled).toBe(true);
  });

  it('a swap BACK to the edited parent after a move is read: the last run’s parent was the other one', async () => {
    const { dataSource, lineReads, view } = await mountP1Edited();

    view.rerender(linesBlock({ parentId: 'p2' }));
    await fail(await nth(lineReads, 2), 'p2 load failed');
    await waitFor(() => expect(bannerShows('p2 load failed')).toBe(true));

    view.rerender(linesBlock({ parentId: 'p1' }));
    const third = await nth(lineReads, 3);
    expect(third.parentId, 'the swap back to p1 was held as a same-parent change').toBe('p1');
    expect(dataSource.find).toHaveBeenCalledTimes(3);
    // objectui#10740's same-parent rule: its failure keeps p1's held edit drawn.
    await fail(third, 'p1 load failed again');
    await waitFor(() => expect(bannerShows('p1 load failed again')).toBe(true));
    expect(shownLines()).toEqual(['p1 line edited']);
    expect(saveButton()?.disabled).toBe(false);
  });

  it('a change held while a same-parent read was IN FLIGHT is replayed when that read commits', async () => {
    const { dataSource, lineReads, view } = await mountP1Edited();

    // The host moves away and back while p2's read is pending; p1's third read
    // is in flight, its answer for the inputs it was issued with.
    view.rerender(linesBlock({ parentId: 'p2' }));
    await nth(lineReads, 2);
    view.rerender(linesBlock({ parentId: 'p1' }));
    const third = await nth(lineReads, 3);
    expect(third.parentId).toBe('p1');
    expect(third.query.$top).toBe(500);

    // A limit change lands while that read is in flight: held (dirty, held for
    // p1, last run p1), so it supersedes nothing.
    view.rerender(linesBlock({ parentId: 'p1', limit: 200 }));
    await settle(() => {});
    expect(dataSource.find).toHaveBeenCalledTimes(3);

    // The in-flight read commits; the held change is replayed by one read
    // that carries the current limit.
    await answerLines(third, { id: 'l1', label: 'p1 line' });
    const fourth = await nth(lineReads, 4);
    expect(fourth.parentId).toBe('p1');
    expect(fourth.query.$top, 'the replayed read did not carry the held change').toBe(200);
    await answerLines(fourth, { id: 'l1', label: 'p1 line at 200' });

    await waitFor(() => expect(shownLines()).toEqual(['p1 line at 200']));
    expect(dataSource.find).toHaveBeenCalledTimes(4);
    expect(saveButton()?.disabled).toBe(true);
  });

  it('a change of ADAPTER while dirty is read: the held rows are not the new adapter’s', async () => {
    const { dataSource, view } = await mountP1Edited();
    const other = makeLinesDataSource();

    view.rerender(linesBlock(), other.dataSource);
    const read = await nth(other.lineReads, 1);
    expect(read.parentId).toBe('p1');
    expect(dataSource.find).toHaveBeenCalledTimes(1);
    await answerLines(read, { id: 'l1', label: 'p1 line from the other adapter' });

    await waitFor(() => expect(shownLines()).toEqual(['p1 line from the other adapter']));
  });

  it('a change of CHILD OBJECT while dirty is read: the held rows are not that object’s', async () => {
    const { dataSource, lineReads, view } = await mountP1Edited();

    view.rerender(linesBlock({ childObject: 'po_fee' }));
    const read = await nth(lineReads, 2);
    expect(read.objectName).toBe('po_fee');
    expect(read.parentId).toBe('p1');
    await answerLines(read, { id: 'f1', label: 'p1 fee' });

    await waitFor(() => expect(shownLines()).toEqual(['p1 fee']));
    expect(dataSource.find).toHaveBeenCalledTimes(2);
  });
});
