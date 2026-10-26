/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10715 — every layout `object-form` routes to re-reads its record on
 * the data-invalidation bus (`notifyDataChanged` from `@object-ui/react`),
 * gated on pristine, the way the default arm does (objectui#10572).
 *
 * Measured before this card: only the default arm read the bus. After a good
 * first read, `notifyDataChanged` for the record's object left `findOne` at 1
 * on `DrawerForm`, `ModalForm`, `SplitForm`, `TabbedForm` and `WizardForm`,
 * while the default arm went to 2. The pending objectui#10572 changeset says
 * `object-form` in edit mode re-reads; this pin is what makes that sentence
 * true of every `formType`.
 *
 * Per arm, the default arm included as the lit control:
 *   (a) a pristine form re-reads IN PLACE on a change to its record, to its
 *       object, or to `'*'`: 1 → 2 reads, the same input shows the new value;
 *   (b) a dirty form HOLDS the change: the typed value stays, the save sends
 *       the `ifMatch` the edit started from, and ONE re-read is replayed once
 *       the save lands;
 *   (c) a change to another object, or to another record of the object,
 *       reads nothing;
 *   (d) a create form reads nothing;
 *   (e) the re-read goes through the arm's own record read effect, so
 *       objectui#10712 still holds: of two re-reads in flight, only the
 *       latest commits.
 * Then the arms with state of their own: the wizard keeps its current step
 * and the answers of steps not yet saved; a closed drawer or modal reads while
 * closed and opens on the fresh values.
 *
 * Rendered through the real `SchemaRenderer` and this package's registration,
 * over a fake data source whose record moves on the server.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { SchemaRenderer, SchemaRendererProvider, notifyDataChanged } from '@object-ui/react';
// Registers `object-form`, the one door all six layouts are reached through.
import './index';

beforeEach(() => {
  // Best-effort metadata probes are not what these cases are about.
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '{}' })));
});
afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

const settle = (ms = 150) => act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));

const TOKEN_V1 = '2026-01-01T00:00:00.000Z';

/** A server holding one `deal` record whose fields and version can move. */
function makeServer() {
  const record = { id: 'r1', name: 'Server v1', note: 'Note v1', updated_at: TOKEN_V1 };
  const ds = {
    find: vi.fn(async () => ({ data: [], total: 0 })),
    findOne: vi.fn(async () => ({ ...record })),
    create: vi.fn(async (_object: string, data: Record<string, unknown>) => ({ id: 'new', ...data })),
    update: vi.fn(async (_object: string, _id: string, data: Record<string, unknown>) => {
      Object.assign(record, data, { updated_at: '2026-01-03T00:00:00.000Z' });
      return { ...record };
    }),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => ({
      name: 'deal',
      fields: { name: { type: 'text', label: 'Name' }, note: { type: 'text', label: 'Note' } },
    })),
  };
  /** Another writer moves the record on the server. */
  const moveOnServer = () => {
    record.name = 'Server v2';
    record.note = 'Note v2';
    record.updated_at = '2026-01-02T00:00:00.000Z';
  };
  return { ds, moveOnServer };
}

type ServerDS = ReturnType<typeof makeServer>['ds'];

/** The six layouts, each reached through `object-form`; `undefined` is the default arm. */
const ARMS: ReadonlyArray<{ form: string; formType: string | undefined }> = [
  { form: 'ObjectForm (default arm, the lit control)', formType: undefined },
  { form: 'DrawerForm', formType: 'drawer' },
  { form: 'ModalForm', formType: 'modal' },
  { form: 'SplitForm', formType: 'split' },
  { form: 'TabbedForm', formType: 'tabbed' },
  { form: 'WizardForm', formType: 'wizard' },
];

const FIVE_ARMS = ARMS.filter((arm) => arm.formType !== undefined);

/** An edit-mode form over `name` and `note`; every layout takes sections. */
const blockFor = (formType: string | undefined, over: Record<string, unknown> = {}) => ({
  type: 'object-form',
  objectName: 'deal',
  mode: 'edit',
  recordId: 'r1',
  sections: [{ name: 'main', label: 'Main', fields: ['name', 'note'] }],
  ...(formType ? { formType } : {}),
  ...over,
});

function mount(ds: unknown, block: Record<string, unknown>) {
  const tree = (b: Record<string, unknown>) => (
    <SchemaRendererProvider dataSource={ds as any}>
      <SchemaRenderer schema={b as any} />
    </SchemaRendererProvider>
  );
  const view = render(tree(block));
  return { rerender: (next: Record<string, unknown>) => view.rerender(tree(next)) };
}

/** The named input, wherever the layout drew it (drawer and modal portal out). */
const input = (name: string) => document.body.querySelector(`input[name="${name}"]`) as HTMLInputElement | null;
const nameInput = () => input('name') as HTMLInputElement;

async function mountEditForm(formType: string | undefined, over: Record<string, unknown> = {}) {
  const server = makeServer();
  const view = mount(server.ds, blockFor(formType, over));
  await settle(400);
  expect(nameInput()?.value).toBe('Server v1');
  expect(server.ds.findOne).toHaveBeenCalledTimes(1);
  return { ...server, view };
}

async function type(name: string, value: string) {
  fireEvent.change(input(name) as HTMLInputElement, { target: { value } });
  await settle();
}

async function bus(change: { objectName: string; recordId?: string }) {
  await act(async () => {
    notifyDataChanged(change);
  });
  await settle();
}

/** Submits the one form on screen: the flat renderer's, the drawer's or modal's inner form, or the wizard's step form. */
async function submitForm() {
  const form = document.body.querySelector('form') as HTMLFormElement | null;
  expect(form, 'no form on screen to submit').toBeTruthy();
  await act(async () => {
    fireEvent.submit(form as HTMLFormElement);
  });
  await settle(300);
}

const updateCall = (ds: ServerDS) =>
  ds.update.mock.calls[0] as unknown as [string, string, Record<string, unknown>, { ifMatch?: string } | undefined];

// ── (a)–(d): the same rule on every arm ─────────────────────────────────────

describe.each(ARMS)('$form reads the data-invalidation bus, gated on pristine (objectui#10715)', ({ formType }) => {
  it.each([
    { scope: "the record's object", change: { objectName: 'deal' } },
    { scope: "'*'", change: { objectName: '*' } },
    { scope: 'the record itself', change: { objectName: 'deal', recordId: 'r1' } },
  ])('(a) a pristine form re-reads in place on a change to $scope: findOne 1 → 2, the same input shows the new value', async ({ change }) => {
    const { ds, moveOnServer } = await mountEditForm(formType);
    const before = nameInput();
    moveOnServer();

    await bus(change);

    expect(ds.findOne, 'a pristine form never re-read after the bus reported a change').toHaveBeenCalledTimes(2);
    expect(nameInput().value).toBe('Server v2');
    expect(nameInput(), 'the re-read went through the loading branch and remounted the form').toBe(before);
  });

  it('(b) a dirty form holds the change: the typed value stays, the save sends the original token, then one held re-read is replayed', async () => {
    const { ds, moveOnServer } = await mountEditForm(formType);
    await type('name', 'User typed');
    moveOnServer();

    await bus({ objectName: 'deal' });
    await bus({ objectName: '*' });

    expect(nameInput().value, 'the bus event overwrote a dirty field').toBe('User typed');
    expect(ds.findOne, 'a dirty form re-read while it held unsaved input').toHaveBeenCalledTimes(1);

    await submitForm();

    expect(ds.update).toHaveBeenCalledTimes(1);
    const [, , payload, options] = updateCall(ds);
    expect(payload.name).toBe('User typed');
    expect(options?.ifMatch, 'the held change advanced the OCC token under the dirty edit').toBe(TOKEN_V1);
    expect(ds.findOne, 'two held changes are replayed as ONE re-read after the save').toHaveBeenCalledTimes(2);
  });

  it('(c) a change to another object, or to another record of the object, reads nothing', async () => {
    const { ds } = await mountEditForm(formType);

    await bus({ objectName: 'some_other_object' });
    await bus({ objectName: 'deal', recordId: 'r2' });

    expect(ds.findOne).toHaveBeenCalledTimes(1);
  });

  it('(d) a create form reads nothing on the bus', async () => {
    const { ds } = makeServer();
    mount(ds, blockFor(formType, { mode: 'create', recordId: undefined }));
    await settle(400);
    expect(ds.getObjectSchema).toHaveBeenCalledTimes(1);
    expect(ds.findOne).toHaveBeenCalledTimes(0);

    await bus({ objectName: 'deal' });
    await bus({ objectName: '*' });

    expect(ds.findOne, 'a create form read a record on the bus').toHaveBeenCalledTimes(0);
  });
});

// ── (e): the re-read rides the arm's own record read effect (objectui#10712) ─

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

type RecordRead = Deferred<any> & { recordId: string };

/** Every record read returns a promise the test settles by hand; the schema read answers at once. */
function makeDeferredDataSource() {
  const recordReads: RecordRead[] = [];
  const dataSource = {
    getObjectSchema: vi.fn(async () => ({
      name: 'deal',
      fields: { name: { type: 'text', label: 'Name' }, note: { type: 'text', label: 'Note' } },
    })),
    findOne: vi.fn((_objectName: string, recordId: string) => {
      const d = deferred<any>();
      recordReads.push({ ...d, recordId });
      return d.promise;
    }),
    find: vi.fn(async () => ({ data: [], total: 0 })),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
  return { dataSource, recordReads };
}

/** The `n`-th read (1-based) once it has been issued. */
async function nth<T>(reads: T[], n: number): Promise<T> {
  await waitFor(() => {
    if (reads.length < n) throw new Error(`read ${n} not issued yet (${reads.length} so far)`);
  });
  return reads[n - 1];
}

const answerRecord = (read: RecordRead, name: string) =>
  act(async () => {
    read.resolve({ id: read.recordId, name, note: 'n', updated_at: TOKEN_V1 });
    await Promise.resolve();
  });

describe.each(ARMS)('$form: a bus re-read a later bus re-read has superseded commits nothing (objectui#10715, objectui#10712)', ({ formType }) => {
  it('(e) of two re-reads in flight, only the latest lands on screen', async () => {
    const { dataSource, recordReads } = makeDeferredDataSource();
    mount(dataSource, blockFor(formType));
    await answerRecord(await nth(recordReads, 1), 'Record one');
    await waitFor(() => expect(nameInput()?.value).toBe('Record one'));

    await bus({ objectName: 'deal' });
    const second = await nth(recordReads, 2);
    await bus({ objectName: 'deal' });
    const third = await nth(recordReads, 3);
    expect(dataSource.findOne).toHaveBeenCalledTimes(3);

    await answerRecord(third, 'Record three');
    await waitFor(() => expect(nameInput().value).toBe('Record three'));
    await answerRecord(second, 'Record two');
    await settle();

    expect(nameInput().value, 'a superseded re-read landed over the current one').toBe('Record three');
  });
});

// ── The wizard: its current step and the answers of steps not yet saved ──────

const TWO_STEP_WIZARD = {
  formType: 'wizard',
  sections: [
    { name: 'first', label: 'First', fields: ['name'] },
    { name: 'second', label: 'Second', fields: ['note'] },
  ],
};

const stepCounter = () =>
  Array.from(document.body.querySelectorAll('span')).find((s) => /^Step \d+ of \d+$/.test(s.textContent ?? ''))?.textContent ?? null;

describe('WizardForm: a bus re-read keeps the current step and the answers of steps not yet saved (objectui#10715)', () => {
  it('a step submitted with Next but not yet saved holds the re-read; the save carries it, then the held re-read is replayed', async () => {
    const { ds, moveOnServer } = await mountEditForm('wizard', TWO_STEP_WIZARD);
    expect(stepCounter()).toBe('Step 1 of 2');
    await type('name', 'Step one typed');
    await submitForm(); // Next: merges step one into the wizard's record, draws step two
    expect(stepCounter()).toBe('Step 2 of 2');
    expect(input('note')?.value).toBe('Note v1');
    expect(input('name'), 'step one is still drawn after Next').toBeNull();
    moveOnServer();

    await bus({ objectName: 'deal' });
    await bus({ objectName: '*' });

    expect(ds.findOne, 'a wizard holding an unsaved step re-read and discarded it').toHaveBeenCalledTimes(1);
    expect(stepCounter(), 'the bus event moved the wizard off its current step').toBe('Step 2 of 2');
    expect(input('note')?.value).toBe('Note v1');

    await submitForm(); // Update: the final commit

    expect(ds.update).toHaveBeenCalledTimes(1);
    const [, , payload, options] = updateCall(ds);
    expect(payload.name, 'the answer of step one was lost before the save').toBe('Step one typed');
    expect(options?.ifMatch).toBe(TOKEN_V1);
    expect(ds.findOne, 'the held re-read was not replayed after the save').toHaveBeenCalledTimes(2);
  });

  it('a wizard walked with Next but not edited is pristine: it re-reads in place and stays on its current step', async () => {
    const { ds, moveOnServer } = await mountEditForm('wizard', TWO_STEP_WIZARD);
    await submitForm(); // Next, nothing typed
    expect(stepCounter()).toBe('Step 2 of 2');
    const noteBefore = input('note');
    expect(noteBefore?.value).toBe('Note v1');
    moveOnServer();

    await bus({ objectName: 'deal' });

    expect(ds.findOne, 'a pristine wizard did not re-read').toHaveBeenCalledTimes(2);
    expect(stepCounter(), 'the re-read moved the wizard off its current step').toBe('Step 2 of 2');
    expect(input('note')?.value).toBe('Note v2');
    expect(input('note'), 'the re-read remounted the step form').toBe(noteBefore);
  });
});

// ── The drawer and the modal: a re-read while closed ─────────────────────────

describe.each(FIVE_ARMS.filter((arm) => arm.formType === 'drawer' || arm.formType === 'modal'))(
  '$form: a bus change while closed (objectui#10715)',
  ({ formType }) => {
    it('reads while closed, and opens on the fresh values with no further read', async () => {
      const { ds, moveOnServer } = makeServer();
      const view = mount(ds, blockFor(formType, { open: false }));
      await settle(400);
      // The layout is mounted and read its record; nothing is drawn while closed.
      expect(ds.findOne).toHaveBeenCalledTimes(1);
      expect(input('name')).toBeNull();
      moveOnServer();

      await bus({ objectName: 'deal' });

      expect(ds.findOne, 'a closed form did not re-read the record it holds').toHaveBeenCalledTimes(2);
      expect(input('name')).toBeNull();

      view.rerender(blockFor(formType, { open: true }));
      await settle(300);

      expect(nameInput().value, 'the form opened on stale values').toBe('Server v2');
      expect(ds.findOne, 'opening read the record again').toHaveBeenCalledTimes(2);
    });
  },
);
