/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10740 — the `record:line_items` panel (`LineItemsPanel`) never draws,
 * and never saves, lines it holds for ANOTHER parent.
 *
 * The panel holds one set of `rows` / `original`, replaced when a load commits.
 * Its load committed them only on success, and its `catch` left them as they
 * were. So when the host moved the panel to another parent record (a new
 * `parentId` without a remount) and that parent's load failed, the PREVIOUS
 * parent's lines stayed on screen, edits included, drawn editable with Save
 * enabled — and `save` built its batch from those rows under the CURRENT
 * `parentId`. An edit batch's child rows carry the parent id directly, so the
 * batch was `update l1 { …, po: 'p2' }`: it moved `p1`'s line to `p2`.
 *
 * Now the panel records which parent the held rows belong to, in the same
 * commit as the rows. While that parent is not the current one, no held line is
 * drawn (a placeholder stands where the grid would be), the Save button is off,
 * and `save` itself returns before it builds a batch. The rule is on the ROWS,
 * not on the load's failure, so a load that DECLINES for the new parent (a
 * refused filter) is refused the same way — that path never reaches the
 * load's `catch`, which is why clearing the rows there would not have closed
 * it.
 *
 * Two things the rule must leave alone, pinned as controls:
 *   - a load for the new parent that SUCCEEDS replaces the rows as before, and
 *     saves that parent's lines only;
 *   - a RE-load of the SAME parent that fails (a transient failure on a refresh)
 *     keeps the author's unsaved edits drawn, editable and saveable — under
 *     that parent — exactly as it did before this card. Since objectui#10712
 *     the same-parent re-read that can run while edits are held is the
 *     post-save reload (a sort, limit or filter change is held while the
 *     panel has unsaved edits, pinned in `LineItemsPanel.dirtyReloadHold-10712`),
 *     so that row's trigger is a save whose reload fails.
 *
 * The owner is written wherever the rows are written. A grid offered with no
 * adapter (the load declines before any fetch) holds rows nobody loaded; a line
 * typed into it takes the parent on screen as its owner at the edit, so the
 * first parent whose load later fails cannot adopt it as its own (the
 * adapter-less row below).
 *
 * Rendered through the real `SchemaRenderer` and this package's own
 * registration of `record:line_items`. Every `find` and every `batchTransaction`
 * returns a promise the test settles by hand, so each assertion is made in the
 * state it names. The banner is read through the message the adapter threw; the
 * placeholder through its test id, never its wording.
 *
 * The panel's `save` carries the same refusal as the Save button, on the
 * function itself. No row here reaches it: the button and the function read the
 * same render's predicate, so a click through the rendered UI cannot reach
 * `save` while the button is off. It is the write contract's own guard, as the
 * `childObject` guard on `save` is, and is not pinned by this file.
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

type LinesRead = Deferred<any> & { parentId: unknown };
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
      lineReads.push({ ...d, parentId: query?.$filter?.po });
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

/** `mountP1Edited`, then the swap to `p2` whose load fails. */
async function mountP1EditedThenP2Failed() {
  const held = await mountP1Edited();
  held.view.rerender(linesBlock({ parentId: 'p2' }));
  const second = await nth(held.lineReads, 2);
  expect(second.parentId).toBe('p2');
  await fail(second, 'p2 load failed');
  await waitFor(() => expect(bannerShows('p2 load failed')).toBe(true));
  return held;
}

beforeEach(() => {
  // Each failure below is logged by the panel; keep the run readable.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

describe('LineItemsPanel refuses the lines it holds for another parent (objectui#10740)', () => {
  it('p1 edited, then a swap to p2 whose load FAILS: no p1 line is drawn, Save is off, and no batch is sent', async () => {
    const { dataSource } = await mountP1EditedThenP2Failed();

    expect(shownLines(), "the previous parent's edited line stayed on screen").toEqual([]);
    expect(lineInputs(), "the previous parent's lines were drawn editable").toHaveLength(0);
    expect(placeholder()).toBeTruthy();
    expect(saveButton()?.disabled, 'Save stayed enabled over another parent’s lines').toBe(true);

    // A click on the disabled control reaches nothing.
    await clickSave();
    await settle(() => {});
    expect(dataSource.batchTransaction).not.toHaveBeenCalled();
    expect(dataSource.find).toHaveBeenCalledTimes(2);
  });

  it('the same through a load that DECLINES: a swap to p2 with a refused filter leaves Save off and sends nothing', async () => {
    const { dataSource, view } = await mountP1Edited();

    // `$regex` has no lowering, so the panel's load declines before any fetch:
    // this path never reaches the load's `catch`.
    view.rerender(linesBlock({ parentId: 'p2', filter: { note: { $regex: 'a.c' } } }));
    await waitFor(() =>
      expect(document.body.querySelector('[data-testid="line-items-malformed-filter"]')).toBeTruthy(),
    );

    expect(dataSource.find).toHaveBeenCalledTimes(1);
    expect(shownLines()).toEqual([]);
    expect(saveButton()?.disabled, 'Save stayed enabled after a declined load for another parent').toBe(true);
    await clickSave();
    await settle(() => {});
    expect(dataSource.batchTransaction).not.toHaveBeenCalled();
  });

  it('a line added under a FIRST load that failed, then a swap to p2 whose load fails: the added line is not drawn under p2 and Save is off', async () => {
    const { dataSource, lineReads } = makeLinesDataSource();
    const view = mount(dataSource, linesBlock());
    await fail(await nth(lineReads, 1), 'p1 load failed');
    await waitFor(() => expect(bannerShows('p1 load failed')).toBe(true));
    // The first failure leaves the empty grid on screen (its entry row is
    // there), as before this card. A line typed into it is p1's.
    await waitFor(() => expect(lineInputs().length).toBeGreaterThan(0));
    await editFirstLine('new p1 line');
    await waitFor(() => expect(shownLines()).toEqual(['new p1 line']));
    expect(saveButton()?.disabled).toBe(false);

    view.rerender(linesBlock({ parentId: 'p2' }));
    await fail(await nth(lineReads, 2), 'p2 load failed');
    await waitFor(() => expect(bannerShows('p2 load failed')).toBe(true));

    expect(shownLines(), 'a line added under p1 was drawn under p2').toEqual([]);
    expect(placeholder()).toBeTruthy();
    expect(saveButton()?.disabled).toBe(true);
    await clickSave();
    await settle(() => {});
    expect(dataSource.batchTransaction).not.toHaveBeenCalled();
  });

  it('a line typed under an adapter-less mount on p1, a swap to p2 with no adapter, then the adapter arrives and p2’s load fails: no line drawn under p2, Save off, no batch', async () => {
    const { dataSource, lineReads } = makeLinesDataSource();
    const tree = (b: Record<string, unknown>, ds: unknown) => (
      <SchemaRendererProvider dataSource={ds as any}>
        <SchemaRenderer schema={b as any} />
      </SchemaRendererProvider>
    );
    // No adapter: the load declines before any fetch and the panel offers its
    // empty grid (its entry row) for p1. A line typed there is p1's.
    const view = render(tree(linesBlock(), null));
    await waitFor(() => expect(lineInputs().length).toBeGreaterThan(0));
    await editFirstLine('typed under p1');
    await waitFor(() => expect(shownLines()).toEqual(['typed under p1']));
    expect(dataSource.find).not.toHaveBeenCalled();

    // The host moves to p2, still with no adapter.
    view.rerender(tree(linesBlock({ parentId: 'p2' }), null));
    await settle(() => {});
    expect(shownLines(), 'a line typed under p1 was drawn under p2 before any load').toEqual([]);
    expect(saveButton()?.disabled).toBe(true);

    // The adapter arrives, and p2's load fails.
    view.rerender(tree(linesBlock({ parentId: 'p2' }), dataSource));
    const first = await nth(lineReads, 1);
    expect(first.parentId).toBe('p2');
    await fail(first, 'p2 load failed');
    await waitFor(() => expect(bannerShows('p2 load failed')).toBe(true));

    expect(shownLines(), 'a line typed under p1 was adopted by p2').toEqual([]);
    expect(placeholder()).toBeTruthy();
    expect(saveButton()?.disabled).toBe(true);
    await clickSave();
    await settle(() => {});
    expect(dataSource.batchTransaction).not.toHaveBeenCalled();
  });
});

describe('what the rule leaves alone (objectui#10740 controls)', () => {
  it('a swap to p2 whose load SUCCEEDS: p2’s lines replace p1’s, Save is off, and a save after editing p2’s line carries l2 under p2 and nothing of l1', async () => {
    const { lineReads, saves, view } = await mountP1Edited();

    view.rerender(linesBlock({ parentId: 'p2' }));
    const second = await nth(lineReads, 2);
    expect(second.parentId).toBe('p2');
    await answerLines(second, { id: 'l2', label: 'p2 line' });
    await waitFor(() => expect(shownLines()).toEqual(['p2 line']));

    expect(placeholder()).toBeNull();
    expect(saveButton()?.disabled, 'a clean panel offered Save').toBe(true);

    await editFirstLine('p2 line edited');
    await clickSave();
    const save = await nth(saves, 1);
    expect(save.ops).toEqual([
      { object: 'po_line', action: 'update', id: 'l2', data: { label: 'p2 line edited', po: 'p2' } },
    ]);
    expect(save.ops.some((op) => op.id === 'l1'), 'p1’s line rode in p2’s batch').toBe(false);
  });

  it('a RE-load of the SAME parent that fails keeps the held edits: the edited line is drawn editable, Save is on, and the save carries l1 under p1', async () => {
    const { lineReads, saves } = await mountP1Edited();

    // The same-parent re-read that can still run while p1's edit is held is
    // the post-save reload: since objectui#10712 a change to a load input other
    // than the parent (the row cap, say) is HELD while the panel has unsaved
    // edits for the current parent, so it issues no read. The property this
    // row keeps is unchanged: a same-parent re-read that fails leaves the
    // author's lines drawn, editable and saveable under that parent. So Save
    // is pressed, its batch lands, and the reload that follows fails.
    await clickSave();
    const landed = await nth(saves, 1);
    await settle(() => landed.resolve({ results: [] }));
    const reload = await nth(lineReads, 2);
    expect(reload.parentId).toBe('p1');
    await fail(reload, 'p1 reload failed');
    await waitFor(() => expect(bannerShows('p1 reload failed')).toBe(true));

    expect(shownLines(), 'a transient failure discarded the author’s unsaved edit').toEqual(['p1 line edited']);
    expect(lineInputs().every((input) => !input.disabled)).toBe(true);
    expect(placeholder()).toBeNull();
    expect(saveButton()?.disabled).toBe(false);

    await clickSave();
    const save = await nth(saves, 2);
    expect(save.ops).toEqual([
      { object: 'po_line', action: 'update', id: 'l1', data: { label: 'p1 line edited', po: 'p1' } },
    ]);
  });

  it('after a refused state, a load for the CURRENT parent that commits takes the grid back', async () => {
    const { lineReads, view } = await mountP1EditedThenP2Failed();
    expect(placeholder()).toBeTruthy();

    // A load input other than the parent moves; p2's re-read succeeds.
    view.rerender(linesBlock({ parentId: 'p2', limit: 200 }));
    const third = await nth(lineReads, 3);
    expect(third.parentId).toBe('p2');
    await answerLines(third, { id: 'l2', label: 'p2 line' });

    await waitFor(() => expect(shownLines()).toEqual(['p2 line']));
    expect(placeholder()).toBeNull();
    expect(bannerShows('p2 load failed')).toBe(false);
    expect(saveButton()?.disabled).toBe(true);
  });

  it('a swap BACK to p1 whose load fails again draws p1’s held edit again: the same-parent rule', async () => {
    const { lineReads, view } = await mountP1EditedThenP2Failed();

    view.rerender(linesBlock({ parentId: 'p1' }));
    const third = await nth(lineReads, 3);
    expect(third.parentId).toBe('p1');
    await fail(third, 'p1 load failed again');
    await waitFor(() => expect(bannerShows('p1 load failed again')).toBe(true));

    expect(shownLines()).toEqual(['p1 line edited']);
    expect(placeholder()).toBeNull();
    expect(saveButton()?.disabled).toBe(false);
  });

  it('a FIRST load that fails draws the banner and the empty grid, as before', async () => {
    const { dataSource, lineReads } = makeLinesDataSource();
    mount(dataSource, linesBlock());
    await fail(await nth(lineReads, 1), 'p1 load failed');
    await waitFor(() => expect(bannerShows('p1 load failed')).toBe(true));

    expect(placeholder()).toBeNull();
    // The grid is on screen: its entry row is drawn, no line is.
    await waitFor(() => expect(lineInputs().length).toBeGreaterThan(0));
    expect(shownLines()).toEqual([]);
    expect(saveButton()?.disabled, 'a clean panel offered Save').toBe(true);
  });
});
