/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10712 — the `record:line_items` panel (`LineItemsPanel`) commits
 * only the answer to its CURRENT load, and its save commits only to the
 * parent it was issued for.
 *
 * The panel's `load` is numbered (`loadSeqRef`, PR objectui#10738), and since
 * that PR only the current run writes the failure banner. This pin is about
 * the rest of what a run writes — the rows commit (`setRows` / `setOriginal` /
 * `setDirty`, with `rowsHeldFor` beside them since objectui#10740) and the
 * `loading` release — and about the save, which called the `load` it captured
 * at the click:
 *
 *   - A load a newer one has superseded (another `parentId` while it was in
 *     flight) commits nothing. It neither replaces the current parent's lines
 *     nor ends the loading state the current load is still in. Before this
 *     card a superseded answer landing last replaced the current lines (since
 *     objectui#10740 the held-for-another-parent placeholder stood where the
 *     current lines had been; either way the current answer was gone), and
 *     one landing first ended the loading state, and drew the grid, while the
 *     current load was still pending.
 *   - A save that lands after the panel has moved to another parent re-reads
 *     nothing and reports nothing: its reload and its failure belong to the
 *     parent it saved, which is no longer on screen. Before this card it
 *     re-read the OLD parent through the captured `load` — a run numbered
 *     latest, so it committed over the new parent's panel — and wrote its
 *     failure there. A save whose parent is still on screen reloads it with the
 *     panel's CURRENT inputs (sort, limit, filter), not the ones captured at
 *     the click.
 *
 * Rendered through the real `SchemaRenderer` and this package's own
 * registration of `record:line_items`. Every `find` and every
 * `batchTransaction` returns a promise the test settles by hand, so each
 * ordering below is the ordering the answers really land in; no timer decides
 * it. The loading state is read through the grid's absence together with the
 * panel's own loading paragraph; the refused state through its test id; the
 * banner through the message the adapter threw.
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

type LinesRead = Deferred<any> & { parentId: unknown; top: unknown };
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
    find: vi.fn((_objectName: string, query: any) => {
      const d = deferred<any>();
      lineReads.push({ ...d, parentId: query?.$filter?.po, top: query?.$top });
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

function mount(dataSource: unknown, block: Record<string, unknown>) {
  const tree = (b: Record<string, unknown>) => (
    <SchemaRendererProvider dataSource={dataSource as any}>
      <SchemaRenderer schema={b as any} />
    </SchemaRendererProvider>
  );
  const view = render(tree(block));
  return { rerender: (next: Record<string, unknown>) => view.rerender(tree(next)) };
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
/** Whether the panel's banner reports `message` (the text the adapter threw). */
const bannerShows = (message: string) =>
  Array.from(document.body.querySelectorAll('p')).some((p) => p.textContent === message);
const placeholder = () => document.body.querySelector('[data-testid="line-items-held-for-another-parent"]');
/** The panel's own loading paragraph, drawn while no grid is. */
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

/** Mounts a panel on `p1` whose first read is still in flight. */
async function mountP1Pending() {
  const ds = makeLinesDataSource();
  const view = mount(ds.dataSource, linesBlock());
  const first = await nth(ds.lineReads, 1);
  expect(first.parentId).toBe('p1');
  return { ...ds, view, first };
}

/** Mounts a panel on `p1`, lands `l1`, and edits it; Save is then enabled. */
async function mountP1Edited() {
  const ds = makeLinesDataSource();
  const view = mount(ds.dataSource, linesBlock());
  const first = await nth(ds.lineReads, 1);
  expect(first.parentId).toBe('p1');
  await answerLines(first, { id: 'l1', label: 'p1 line' });
  await waitFor(() => expect(shownLines()).toEqual(['p1 line']));
  await editFirstLine('p1 line edited');
  await waitFor(() => expect(saveButton()?.disabled).toBe(false));
  return { ...ds, view };
}

/** `mountP1Edited`, then Save with its batch left in flight. */
async function mountP1Saving() {
  const held = await mountP1Edited();
  await clickSave();
  const save = await nth(held.saves, 1);
  expect(save.ops).toEqual([
    { object: 'po_line', action: 'update', id: 'l1', data: { label: 'p1 line edited', po: 'p1' } },
  ]);
  expect(held.dataSource.find).toHaveBeenCalledTimes(1);
  return { ...held, save };
}

beforeEach(() => {
  // Each failure below is logged by the panel; keep the run readable.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

describe('LineItemsPanel commits only the answer to its CURRENT load (objectui#10712)', () => {
  it('control: a single load draws its lines, ends loading, and leaves Save off', async () => {
    const { dataSource, first } = await mountP1Pending();
    expect(loadingShown()).toBe(true);
    expect(lineInputs()).toHaveLength(0);

    await answerLines(first, { id: 'l1', label: 'p1 line' });

    await waitFor(() => expect(shownLines()).toEqual(['p1 line']));
    expect(loadingShown()).toBe(false);
    expect(placeholder()).toBeNull();
    expect(saveButton()?.disabled).toBe(true);
    expect(dataSource.find).toHaveBeenCalledTimes(1);
  });

  it('values: a SUPERSEDED load that lands LAST leaves the current parent’s lines on screen', async () => {
    const { lineReads, view, first } = await mountP1Pending();

    // Another parent is asked for while the first load is still in flight.
    view.rerender(linesBlock({ parentId: 'p2' }));
    const second = await nth(lineReads, 2);
    expect(second.parentId).toBe('p2');
    await answerLines(second, { id: 'l2', label: 'p2 line' });
    await waitFor(() => expect(shownLines()).toEqual(['p2 line']));

    await answerLines(first, { id: 'l1', label: 'p1 line (stale)' });
    await settle(() => {});

    expect(shownLines(), 'the superseded load for p1 replaced the lines of p2').toEqual(['p2 line']);
    expect(placeholder(), 'the superseded rows were held for p1 and refused in p2’s panel').toBeNull();
    expect(saveButton()?.disabled).toBe(true);
  });

  it('loading: a SUPERSEDED load that FAILS first does not end the loading state the current load is in', async () => {
    const { lineReads, view, first } = await mountP1Pending();

    view.rerender(linesBlock({ parentId: 'p2' }));
    const second = await nth(lineReads, 2);
    await fail(first, 'superseded load failed');
    await settle(() => {});

    expect(loadingShown(), 'a superseded failure ended the loading state the current load was in').toBe(true);
    expect(lineInputs(), 'a superseded failure drew the grid while the current load was pending').toHaveLength(0);
    expect(bannerShows('superseded load failed')).toBe(false);

    await answerLines(second, { id: 'l2', label: 'p2 line' });
    await waitFor(() => expect(shownLines(), 'the current load did not end the loading state').toEqual(['p2 line']));
    expect(loadingShown()).toBe(false);
  });

  it('loading: a SUPERSEDED load that SUCCEEDS first neither draws nor ends the loading state the current load is in', async () => {
    const { lineReads, view, first } = await mountP1Pending();

    view.rerender(linesBlock({ parentId: 'p2' }));
    const second = await nth(lineReads, 2);
    await answerLines(first, { id: 'l1', label: 'p1 line (stale)' });
    await settle(() => {});

    expect(loadingShown(), 'a superseded answer ended the loading state the current load was in').toBe(true);
    expect(lineInputs()).toHaveLength(0);
    expect(placeholder(), 'a superseded answer was committed and then refused as another parent’s').toBeNull();

    await answerLines(second, { id: 'l2', label: 'p2 line' });
    await waitFor(() => expect(shownLines()).toEqual(['p2 line']));
    expect(loadingShown()).toBe(false);
  });
});

describe('LineItemsPanel’s save commits only to the parent it was issued for (objectui#10712)', () => {
  it('control: a save whose parent is still on screen reloads it and draws the reloaded lines', async () => {
    const { dataSource, lineReads, save } = await mountP1Saving();
    expect(lineInputs().every((input) => input.disabled)).toBe(true);

    await landSave(save);
    const reload = await nth(lineReads, 2);
    expect(reload.parentId).toBe('p1');
    await answerLines(reload, { id: 'l1', label: 'p1 line saved' });

    await waitFor(() => expect(shownLines()).toEqual(['p1 line saved']));
    expect(lineInputs().every((input) => !input.disabled)).toBe(true);
    expect(saveButton()?.disabled).toBe(true);
    expect(dataSource.find).toHaveBeenCalledTimes(2);
  });

  it('a save started on p1 that LANDS after the swap to p2 re-reads nothing and leaves p2’s lines on screen', async () => {
    const { dataSource, lineReads, view, save } = await mountP1Saving();

    // The host moves the panel to p2 while p1's batch is in flight; p2 loads.
    view.rerender(linesBlock({ parentId: 'p2' }));
    const second = await nth(lineReads, 2);
    expect(second.parentId).toBe('p2');
    await answerLines(second, { id: 'l2', label: 'p2 line' });
    await waitFor(() => expect(shownLines()).toEqual(['p2 line']));

    await landSave(save);
    await settle(() => {});

    expect(dataSource.find, 'the landed save re-read the OLD parent through the load it captured').toHaveBeenCalledTimes(2);
    expect(shownLines()).toEqual(['p2 line']);
    expect(placeholder()).toBeNull();
    await waitFor(() => expect(lineInputs().every((input) => !input.disabled), 'the save never ended').toBe(true));
    expect(saveButton()?.disabled).toBe(true);
  });

  it('a save started on p1 that FAILS after the swap to p2 does not raise its failure over p2’s panel', async () => {
    const { dataSource, lineReads, view, save } = await mountP1Saving();

    view.rerender(linesBlock({ parentId: 'p2' }));
    const second = await nth(lineReads, 2);
    await answerLines(second, { id: 'l2', label: 'p2 line' });
    await waitFor(() => expect(shownLines()).toEqual(['p2 line']));

    await settle(() => save.reject(new Error('p1 save failed')));
    await settle(() => {});

    expect(bannerShows('p1 save failed'), 'a save failure for p1 was raised over p2’s panel').toBe(false);
    expect(shownLines()).toEqual(['p2 line']);
    expect(dataSource.find).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(lineInputs().every((input) => !input.disabled)).toBe(true));
  });

  it('a save started on p1 that lands after a swap to p2 whose load FAILED re-reads nothing, and p2’s failure banner stays', async () => {
    const { dataSource, lineReads, view, save } = await mountP1Saving();

    view.rerender(linesBlock({ parentId: 'p2' }));
    const second = await nth(lineReads, 2);
    await fail(second, 'p2 load failed');
    await waitFor(() => expect(bannerShows('p2 load failed')).toBe(true));
    // The rows are still p1's, held for p1: the objectui#10740 placeholder.
    expect(placeholder()).toBeTruthy();

    await landSave(save);
    await settle(() => {});

    expect(dataSource.find, 'the landed save re-read p1 into p2’s panel').toHaveBeenCalledTimes(2);
    expect(bannerShows('p2 load failed'), 'the save’s re-read of p1 cleared p2’s failure').toBe(true);
    expect(placeholder()).toBeTruthy();
    expect(shownLines()).toEqual([]);
  });

  it('control: a save whose parent is still on screen FAILS: its failure is shown over the edited lines', async () => {
    const { dataSource, save } = await mountP1Saving();

    await settle(() => save.reject(new Error('p1 save failed')));

    await waitFor(() => expect(bannerShows('p1 save failed')).toBe(true));
    expect(shownLines()).toEqual(['p1 line edited']);
    expect(dataSource.find).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(saveButton()?.disabled).toBe(false));
  });

  it('the reload after a save reads the panel’s CURRENT inputs, not the ones captured at the click', async () => {
    const { dataSource, lineReads, view, save } = await mountP1Saving();

    // A load input other than the parent moves while the batch is in flight
    // (the row cap). The panel holds unsaved edits for p1, so the change is
    // HELD (objectui#10712 R3, `LineItemsPanel.dirtyReloadHold-10712`): no read
    // is issued for it, and the post-save reload is what carries it.
    view.rerender(linesBlock({ limit: 200 }));
    await settle(() => {});
    expect(dataSource.find).toHaveBeenCalledTimes(1);

    await landSave(save);
    const afterSave = await nth(lineReads, 2);
    expect(afterSave.parentId).toBe('p1');
    expect(afterSave.top, 'the save reloaded with the row cap captured at the click').toBe(200);

    await answerLines(afterSave, { id: 'l1', label: 'p1 line saved' });
    await waitFor(() => expect(shownLines()).toEqual(['p1 line saved']));
    expect(saveButton()?.disabled).toBe(true);
  });
});
