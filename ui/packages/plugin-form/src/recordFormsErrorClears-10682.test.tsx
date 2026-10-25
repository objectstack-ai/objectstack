/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10682 — a failed read must not keep a record form on its error
 * screen after a later read of the same source succeeds (the objectui#10578
 * shape, applied per source).
 *
 * Every layout `ObjectForm` routes to (the default arm, `DrawerForm`,
 * `ModalForm`, `SplitForm`, `TabbedForm`, `WizardForm`) renders its error
 * screen ahead of the form whenever its load error is set. Each wrote that
 * error from two reads, the object schema (`getObjectSchema`) and the record
 * (`findOne`), and cleared it nowhere, so one failed read kept the form off
 * screen until a remount.
 *
 * What clears it, and which run may touch it:
 *
 *   - PER SOURCE. A read's failure is cleared when a later run of the SAME
 *     read commits. A record read that succeeds says nothing about the object
 *     schema: it can only run over the schema of an EARLIER object (the one
 *     already in state), so it must not clear a schema failure.
 *   - Only the CURRENT run of a read writes its failure at all. A run a newer
 *     one of the same read has superseded may neither clear the current
 *     failure nor raise its own over the current values.
 *   - A failed BACKGROUND re-read of the record does NOT keep the last good
 *     values on screen. No form has a silent mode, so the failure is reported
 *     like any other, and the next re-read that succeeds takes the screen
 *     back. The default arm's background re-read here is the data-invalidation
 *     bus (objectui#10572). For the five other layouts this file drives a host
 *     re-render that rebuilds `initialValues`, which re-runs their record read
 *     in place; since objectui#10715 they read the bus too, pinned per arm in
 *     `formArmsInvalidation-10715.test.tsx`.
 *
 * The seventh site is `record:line_items` (`LineItemsPanel`, objectui#10683
 * folded in). It makes one read that can fail on screen, its rows, and writes
 * the same banner from its save:
 *
 *   - Only the CURRENT load writes the banner. When it commits rows it clears
 *     whatever the banner shows, a failed load or a failed save: the rows on
 *     screen are then the ones it read, and the edits a failed save was about
 *     have been replaced by them (and Save is off again, nothing being dirty).
 *   - A load that fails replaces what the banner shows with its own failure.
 *   - A load a newer one has superseded (another `parentId` while it was in
 *     flight) neither raises the banner nor clears it.
 *
 * Rendered through the real `SchemaRenderer` and this package's own
 * registration (`object-form` is the one door all six forms are reached
 * through, `record:line_items` the panel's).
 * Every `getObjectSchema` and `findOne` is held open by hand, so each
 * in-flight assertion is made while the read really is in flight. The error
 * screen is read through the message the adapter threw; its English heading
 * is not what this card is about.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { SchemaRenderer, SchemaRendererProvider, notifyDataChanged } from '@object-ui/react';
// Registers `object-form` through this package's own entry.
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

type SchemaRead = Deferred<any> & { objectName: string };
type RecordRead = Deferred<any> & { objectName: string; recordId: string };

/** Every schema read and record read returns a promise the test settles by hand. */
function makeDeferredDataSource() {
  const schemaReads: SchemaRead[] = [];
  const recordReads: RecordRead[] = [];
  const dataSource = {
    getObjectSchema: vi.fn((objectName: string) => {
      const d = deferred<any>();
      schemaReads.push({ ...d, objectName });
      return d.promise;
    }),
    findOne: vi.fn((objectName: string, recordId: string) => {
      const d = deferred<any>();
      recordReads.push({ ...d, objectName, recordId });
      return d.promise;
    }),
    find: vi.fn(async () => ({ data: [], total: 0 })),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
  return { dataSource, schemaReads, recordReads };
}

type DS = ReturnType<typeof makeDeferredDataSource>['dataSource'];

/** The `n`-th read (1-based) once it has been issued. */
async function nth<T>(reads: T[], n: number): Promise<T> {
  await waitFor(() => {
    if (reads.length < n) throw new Error(`read ${n} not issued yet (${reads.length} so far)`);
  });
  return reads[n - 1];
}

async function settle(fn: () => void) {
  await act(async () => {
    fn();
    await Promise.resolve();
  });
}

const answerSchema = (read: SchemaRead) =>
  settle(() => read.resolve({ name: read.objectName, fields: { name: { type: 'text', label: 'Name' } } }));
const answerRecord = (read: RecordRead, name: string) =>
  settle(() => read.resolve({ id: read.recordId, name }));
const fail = (read: Deferred<any>, message: string) => settle(() => read.reject(new Error(message)));

async function invalidate() {
  await act(async () => {
    notifyDataChanged({ objectName: '*' });
  });
}

/** The six layouts, each reached through `object-form`; `undefined` is the default arm. */
const FORMS: ReadonlyArray<{ form: string; formType: string | undefined }> = [
  { form: 'ObjectForm (default arm)', formType: undefined },
  { form: 'DrawerForm', formType: 'drawer' },
  { form: 'ModalForm', formType: 'modal' },
  { form: 'SplitForm', formType: 'split' },
  { form: 'TabbedForm', formType: 'tabbed' },
  { form: 'WizardForm', formType: 'wizard' },
];

/** An edit-mode form over one `name` field; every layout takes sections. */
const blockFor = (formType: string | undefined, over: Record<string, unknown> = {}) => ({
  type: 'object-form',
  objectName: 'deal',
  mode: 'edit',
  recordId: 'r1',
  sections: [{ name: 'main', label: 'Main', fields: ['name'] }],
  ...(formType ? { formType } : {}),
  ...over,
});

function mount(dataSource: DS, block: Record<string, unknown>) {
  const tree = (b: Record<string, unknown>) => (
    <SchemaRendererProvider dataSource={dataSource as any}>
      <SchemaRenderer schema={b as any} />
    </SchemaRendererProvider>
  );
  const view = render(tree(block));
  return { rerender: (next: Record<string, unknown>) => view.rerender(tree(next)) };
}

/** The error screen's text, or `null` when none is on screen (drawer and modal portal out). */
function shownError(): string | null {
  const heading = Array.from(document.body.querySelectorAll('h3')).find(
    (h) => h.textContent === 'Error loading form',
  );
  return heading ? (heading.parentElement?.textContent ?? '') : null;
}

const shownValue = () =>
  (document.body.querySelector('input[name="name"]') as HTMLInputElement | null)?.value ?? null;

/**
 * The form's own same-record re-read, the one that runs in the background over
 * values already on screen: the data-invalidation bus on the default arm, a host
 * re-render that rebuilds `initialValues` on the other five.
 */
async function backgroundReread(
  formType: string | undefined,
  view: ReturnType<typeof mount>,
  over: Record<string, unknown> = {},
) {
  if (formType === undefined) {
    await invalidate();
  } else {
    view.rerender(blockFor(formType, { ...over, initialValues: {} }));
  }
}

/** Mounts one form and lands its first schema read and first record read. */
async function mountShowing(formType: string | undefined, name: string) {
  const ds = makeDeferredDataSource();
  const view = mount(ds.dataSource, blockFor(formType));
  await answerSchema(await nth(ds.schemaReads, 1));
  await answerRecord(await nth(ds.recordReads, 1), name);
  await waitFor(() => expect(shownValue()).toBe(name));
  return { ...ds, view };
}

beforeEach(() => {
  // Best-effort metadata probes are not what these cases are about.
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '{}' })));
  // Each failure below is logged by the form; keep the run readable.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  cleanup();
});

describe.each(FORMS)('$form clears its load error per source (objectui#10682)', ({ formType }) => {
  it('lit control: a form that never failed draws its record and no error screen', async () => {
    const { dataSource } = await mountShowing(formType, 'Record one');

    expect(shownError()).toBeNull();
    expect(dataSource.getObjectSchema).toHaveBeenCalledTimes(1);
    expect(dataSource.findOne).toHaveBeenCalledTimes(1);
  });

  it('a record read fails, then a later record read succeeds: the value is shown and the error screen is gone', async () => {
    const { dataSource, schemaReads, recordReads } = makeDeferredDataSource();
    const view = mount(dataSource, blockFor(formType));
    await answerSchema(await nth(schemaReads, 1));
    await fail(await nth(recordReads, 1), 'record read failed');
    await waitFor(() => expect(shownError(), 'the first failure was not reported').toContain('record read failed'));

    // The caller asks for another record (a drawer or modal opened over a list
    // row, say), and that read succeeds.
    view.rerender(blockFor(formType, { recordId: 'r2' }));
    await answerRecord(await nth(recordReads, 2), 'Record two');

    await waitFor(() => expect(shownError(), 'the error screen outlived a record read that succeeded').toBeNull());
    expect(shownValue()).toBe('Record two');
  });

  it('a failed BACKGROUND re-read over good values is reported, not hidden; the next re-read that succeeds takes the screen back', async () => {
    const { recordReads, view } = await mountShowing(formType, 'Record one');

    await backgroundReread(formType, view);
    await fail(await nth(recordReads, 2), 're-read failed');
    // No silent mode on any form: the failure is reported, and the last good
    // values stay in state but are not drawn.
    await waitFor(() => expect(shownError()).toContain('re-read failed'));
    expect(shownValue()).toBeNull();

    await backgroundReread(formType, view);
    await answerRecord(await nth(recordReads, 3), 'Record one, again');
    await waitFor(() => expect(shownError(), 'the error screen outlived a re-read that succeeded').toBeNull());
    expect(shownValue()).toBe('Record one, again');
  });

  it('per source: a schema read fails, then a RECORD read succeeds: the schema error stays', async () => {
    const { schemaReads, recordReads, view } = await mountShowing(formType, 'Record one');

    // The form is pointed at another object. Its record read runs over the
    // schema of the PREVIOUS object, still in state.
    view.rerender(blockFor(formType, { objectName: 'lead' }));
    const leadSchema = await nth(schemaReads, 2);
    const leadRecord = await nth(recordReads, 2);
    expect(leadSchema.objectName).toBe('lead');
    expect(leadRecord.objectName).toBe('lead');

    await fail(leadSchema, 'lead schema read failed');
    await waitFor(() => expect(shownError()).toContain('lead schema read failed'));
    await answerRecord(leadRecord, 'Lead one');
    // Give the record commit every chance to land before reading the screen.
    await settle(() => {});

    expect(shownError(), 'a record read cleared a schema failure it says nothing about').toContain(
      'lead schema read failed',
    );
  });

  it('per source: a record read fails, then a SCHEMA read succeeds: the record error stays', async () => {
    const { schemaReads, recordReads, view } = await mountShowing(formType, 'Record one');

    // The same object swap, settled the other way round: the record read fails
    // while the new object's schema read is still in flight.
    view.rerender(blockFor(formType, { objectName: 'lead' }));
    const leadSchema = await nth(schemaReads, 2);
    const leadRecord = await nth(recordReads, 2);
    expect(leadSchema.objectName).toBe('lead');
    expect(leadRecord.objectName).toBe('lead');

    await fail(leadRecord, 'lead record read failed');
    await waitFor(() => expect(shownError()).toContain('lead record read failed'));
    await answerSchema(leadSchema);
    // Give the schema commit every chance to land before reading the screen.
    await settle(() => {});

    expect(shownError(), 'a schema read cleared a record failure it says nothing about').toContain(
      'lead record read failed',
    );
  });

  it('control: a record read fails, then another fails: the newer failure is shown', async () => {
    const { dataSource, schemaReads, recordReads } = makeDeferredDataSource();
    const view = mount(dataSource, blockFor(formType));
    await answerSchema(await nth(schemaReads, 1));
    await fail(await nth(recordReads, 1), 'first failure');
    await waitFor(() => expect(shownError()).toContain('first failure'));

    view.rerender(blockFor(formType, { recordId: 'r2' }));
    await fail(await nth(recordReads, 2), 'second failure');

    await waitFor(() => expect(shownError()).toContain('second failure'));
    expect(shownError()).not.toContain('first failure');
  });

  it('a SUPERSEDED record read that fails does not raise the error screen over the current record', async () => {
    const { dataSource, schemaReads, recordReads } = makeDeferredDataSource();
    const view = mount(dataSource, blockFor(formType));
    await answerSchema(await nth(schemaReads, 1));
    const first = await nth(recordReads, 1);

    // Another record is asked for while the first read is still in flight.
    view.rerender(blockFor(formType, { recordId: 'r2' }));
    await answerRecord(await nth(recordReads, 2), 'Record two');
    await waitFor(() => expect(shownValue()).toBe('Record two'));
    await fail(first, 'superseded read failed');
    await settle(() => {});

    expect(shownError(), 'a superseded failure took the current record off screen').toBeNull();
    expect(shownValue()).toBe('Record two');
  });

  it('a SUPERSEDED record read that succeeds does not clear the error the current record read reported', async () => {
    const { dataSource, schemaReads, recordReads } = makeDeferredDataSource();
    const view = mount(dataSource, blockFor(formType));
    await answerSchema(await nth(schemaReads, 1));
    const first = await nth(recordReads, 1);

    view.rerender(blockFor(formType, { recordId: 'r2' }));
    await fail(await nth(recordReads, 2), 'current read failed');
    await waitFor(() => expect(shownError()).toContain('current read failed'));
    await answerRecord(first, 'Superseded record');
    await settle(() => {});

    expect(shownError(), 'a superseded answer cleared the current failure').toContain('current read failed');
  });

  it('a SUPERSEDED schema read that fails does not raise the error screen over the current object', async () => {
    const { dataSource, schemaReads, recordReads } = makeDeferredDataSource();
    const view = mount(dataSource, blockFor(formType));
    const dealSchema = await nth(schemaReads, 1);

    // The form is pointed at another object while the first schema read is in flight.
    view.rerender(blockFor(formType, { objectName: 'lead' }));
    await answerSchema(await nth(schemaReads, 2));
    const leadRecord = await nth(recordReads, 1);
    expect(leadRecord.objectName).toBe('lead');
    await answerRecord(leadRecord, 'Lead one');
    await waitFor(() => expect(shownValue()).toBe('Lead one'));

    await fail(dealSchema, 'superseded schema read failed');
    await settle(() => {});

    expect(shownError(), 'a superseded schema failure took the current form off screen').toBeNull();
    expect(shownValue()).toBe('Lead one');
  });

  it('a SUPERSEDED schema read that succeeds does not clear the schema failure the current read reported', async () => {
    const { dataSource, schemaReads } = makeDeferredDataSource();
    const view = mount(dataSource, blockFor(formType));
    const dealSchema = await nth(schemaReads, 1);

    view.rerender(blockFor(formType, { objectName: 'lead' }));
    await fail(await nth(schemaReads, 2), 'current schema read failed');
    await waitFor(() => expect(shownError()).toContain('current schema read failed'));
    await answerSchema(dealSchema);
    await settle(() => {});

    expect(shownError(), 'a superseded schema answer cleared the current schema failure').toContain(
      'current schema read failed',
    );
  });
});

describe('the default arm re-reads on the data-invalidation bus (objectui#10682, the filed probe)', () => {
  it('a record read fails, then a bus re-read succeeds: the value is shown and the error screen is gone', async () => {
    const { dataSource, schemaReads, recordReads } = makeDeferredDataSource();
    mount(dataSource, blockFor(undefined));
    await answerSchema(await nth(schemaReads, 1));
    await fail(await nth(recordReads, 1), 'record read failed');
    await waitFor(() => expect(shownError()).toContain('record read failed'));

    await invalidate();
    await answerRecord(await nth(recordReads, 2), 'Recovered');

    await waitFor(() => expect(shownError(), 'the error screen outlived a bus re-read that succeeded').toBeNull());
    expect(shownValue()).toBe('Recovered');
    expect(dataSource.findOne).toHaveBeenCalledTimes(2);
  });
});

// ── The seventh site: `record:line_items` (`LineItemsPanel`) ─────────────────

type LinesRead = Deferred<any> & { parentId: unknown };

/**
 * Every row load (`find`) and every save (`batchTransaction`) returns a promise
 * the test settles by hand. The child schema read is answered at once: the
 * panel reports no failure of it, so it is not what these cases are about.
 */
function makeLinesDataSource() {
  const lineReads: LinesRead[] = [];
  const saves: Deferred<any>[] = [];
  const dataSource = {
    getObjectSchema: vi.fn(async () => null),
    find: vi.fn((_objectName: string, query: any) => {
      const d = deferred<any>();
      lineReads.push({ ...d, parentId: query?.$filter?.po });
      return d.promise;
    }),
    batchTransaction: vi.fn(() => {
      const d = deferred<any>();
      saves.push(d);
      return d.promise;
    }),
  };
  return { dataSource, lineReads, saves };
}

type LinesDS = ReturnType<typeof makeLinesDataSource>['dataSource'];

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

function mountLines(dataSource: LinesDS, block: Record<string, unknown> = linesBlock()) {
  return mount(dataSource as unknown as DS, block);
}

const answerLines = (read: LinesRead, ...labels: string[]) =>
  settle(() => read.resolve({ data: labels.map((label, i) => ({ id: `${String(read.parentId)}-${i + 1}`, label })) }));

/** The lines the grid draws (its trailing blank row is not a line). */
const shownLines = () =>
  (Array.from(document.body.querySelectorAll('input[aria-label="Line"]')) as HTMLInputElement[])
    .map((input) => input.value)
    .filter((value) => value !== '');

/** Whether the panel's banner reports `message` (the text the adapter threw). */
const bannerShows = (message: string) =>
  Array.from(document.body.querySelectorAll('p')).some((p) => p.textContent === message);

/** Mounts a panel on `p1` and lands its first load. */
async function mountLinesShowing(...labels: string[]) {
  const ds = makeLinesDataSource();
  const view = mountLines(ds.dataSource);
  await answerLines(await nth(ds.lineReads, 1), ...labels);
  await waitFor(() => expect(shownLines()).toEqual(labels));
  return { ...ds, view };
}

/** Edits the first line and presses Save; the save's batch is left in flight. */
async function editAndSave(saves: Deferred<any>[], to: string) {
  const issued = saves.length;
  const first = document.body.querySelector('input[aria-label="Line"]') as HTMLInputElement;
  await act(async () => {
    fireEvent.change(first, { target: { value: to } });
  });
  const save = Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent === 'Save');
  expect(save, 'no Save button').toBeTruthy();
  await act(async () => {
    fireEvent.click(save!);
  });
  return nth(saves, issued + 1);
}

describe('LineItemsPanel clears its load error when a later load commits (objectui#10682, objectui#10683 folded in)', () => {
  it('lit control: a panel that never failed draws its lines and no banner', async () => {
    const { dataSource } = await mountLinesShowing('p1 line');

    expect(bannerShows('Failed to load line items')).toBe(false);
    expect(dataSource.find).toHaveBeenCalledTimes(1);
  });

  it('a load fails, then a later load succeeds: its lines are shown and the banner is gone', async () => {
    const { dataSource, lineReads } = makeLinesDataSource();
    const view = mountLines(dataSource);
    await fail(await nth(lineReads, 1), 'p1 load failed');
    await waitFor(() => expect(bannerShows('p1 load failed'), 'the first failure was not reported').toBe(true));

    // The panel is pointed at another parent record, and that load succeeds.
    view.rerender(linesBlock({ parentId: 'p2' }));
    const second = await nth(lineReads, 2);
    expect(second.parentId).toBe('p2');
    await answerLines(second, 'p2 line');

    await waitFor(() => expect(shownLines()).toEqual(['p2 line']));
    expect(bannerShows('p1 load failed'), 'the banner outlived a load that succeeded').toBe(false);
  });

  it('control: a load fails, then another fails: the newer failure is shown', async () => {
    const { dataSource, lineReads } = makeLinesDataSource();
    const view = mountLines(dataSource);
    await fail(await nth(lineReads, 1), 'first failure');
    await waitFor(() => expect(bannerShows('first failure')).toBe(true));

    view.rerender(linesBlock({ parentId: 'p2' }));
    await fail(await nth(lineReads, 2), 'second failure');

    await waitFor(() => expect(bannerShows('second failure')).toBe(true));
    expect(bannerShows('first failure')).toBe(false);
  });

  it('a SUPERSEDED load that fails does not raise the banner over the current lines', async () => {
    const { dataSource, lineReads } = makeLinesDataSource();
    const view = mountLines(dataSource);
    const first = await nth(lineReads, 1);

    // Another parent is asked for while the first load is still in flight.
    view.rerender(linesBlock({ parentId: 'p2' }));
    await answerLines(await nth(lineReads, 2), 'p2 line');
    await waitFor(() => expect(shownLines()).toEqual(['p2 line']));
    await fail(first, 'superseded load failed');
    await settle(() => {});

    expect(bannerShows('superseded load failed'), 'a superseded failure was raised over the current lines').toBe(false);
    expect(shownLines()).toEqual(['p2 line']);
  });

  it('a SUPERSEDED load that succeeds does not clear the failure the current load reported', async () => {
    const { dataSource, lineReads } = makeLinesDataSource();
    const view = mountLines(dataSource);
    const first = await nth(lineReads, 1);

    view.rerender(linesBlock({ parentId: 'p2' }));
    await fail(await nth(lineReads, 2), 'current load failed');
    await waitFor(() => expect(bannerShows('current load failed')).toBe(true));
    await answerLines(first, 'superseded line');
    await settle(() => {});

    // Only the banner is read here: which lines a superseded answer leaves on
    // screen is objectui#10712's row, not this card's.
    expect(bannerShows('current load failed'), 'a superseded answer cleared the current failure').toBe(true);
  });

  describe('its save writes the same banner', () => {
    it('lit control: a save fails and nothing reloads: its failure is shown over the edited lines', async () => {
      const { saves } = await mountLinesShowing('p1 line');

      await fail(await editAndSave(saves, 'edited line'), 'save batch refused');

      await waitFor(() => expect(bannerShows('save batch refused')).toBe(true));
      expect(shownLines()).toEqual(['edited line']);
    });

    it('a save fails, then a later load commits: the lines are the loaded ones and the save failure is gone', async () => {
      const { lineReads, saves, view } = await mountLinesShowing('p1 line');
      await fail(await editAndSave(saves, 'edited line'), 'save batch refused');
      await waitFor(() => expect(bannerShows('save batch refused')).toBe(true));

      // The load replaces the edited lines the save failed on (and nothing is
      // dirty after it), so the save failure no longer describes the panel.
      view.rerender(linesBlock({ parentId: 'p2' }));
      await answerLines(await nth(lineReads, 2), 'p2 line');

      await waitFor(() => expect(shownLines()).toEqual(['p2 line']));
      expect(bannerShows('save batch refused'), 'a save failure outlived the lines it was about').toBe(false);
    });

    it('a save fails, then a later load fails: the load failure is shown instead', async () => {
      const { lineReads, saves, view } = await mountLinesShowing('p1 line');
      await fail(await editAndSave(saves, 'edited line'), 'save batch refused');
      await waitFor(() => expect(bannerShows('save batch refused')).toBe(true));

      view.rerender(linesBlock({ parentId: 'p2' }));
      await fail(await nth(lineReads, 2), 'p2 load failed');

      await waitFor(() => expect(bannerShows('p2 load failed')).toBe(true));
      expect(bannerShows('save batch refused')).toBe(false);
    });
  });
});
