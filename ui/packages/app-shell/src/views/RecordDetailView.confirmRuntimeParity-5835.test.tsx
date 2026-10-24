/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `app-shell` mounts TWO confirm runtimes into ONE dialog — pin that they feed
 * it the same fields (objectui#5835).
 *
 * - `hooks/useConsoleActionRuntime.tsx` builds a `confirmHandler` and renders
 *   `<ActionConfirmDialog>` from its own `dialogs` element.
 * - `views/RecordDetailView.tsx` does NOT consume that hook. It builds a second,
 *   near-identical `confirmHandler` and renders its own `<ActionConfirmDialog>`.
 *
 * This file pins BOTH halves of that relationship. The OPEN half is #5835's and
 * comes first; the CLOSE half (objectui#6034) is the second `describe` at the
 * bottom, with its own header explaining which reset shape won and why. They
 * live in ONE file on purpose: two parity pins for one relationship could
 * disagree with each other, which is the very defect the two runtimes had.
 *
 * Merging the two is a larger refactor and is deliberately NOT this file's job.
 * What this file buys instead is the property the duplication threatens: the
 * dialog is one component with one set of reads, so whichever runtime opened it
 * must hand it the same field set. objectui#5610 and objectui#3320 are the same
 * family — this view re-implementing a shared runtime and then drifting from it
 * with nothing red in between.
 *
 * ## Why this asserts at the DIALOG, not at the two declarations
 *
 * "Both runtimes feed the dialog the same fields" is trivially satisfiable by a
 * test that reads neither runtime — comparing the two handler TYPES to each
 * other proves nothing about what reaches the dialog at runtime, and two empty
 * field sets are "the same" too. So: `ActionConfirmDialog` is doubled once, for
 * BOTH importers (the hook imports `../views/ActionConfirmDialog.js`, this view
 * imports `./ActionConfirmDialog.js` — one module, one double), each runtime is
 * driven for real, and the assertions run against the `state` object that
 * actually ARRIVED at the dialog. The expected field set is written out as a
 * literal, so "both sides are empty" fails rather than passes, and the last test
 * ties that literal to what `ActionConfirmDialog.tsx` genuinely reads.
 *
 * ## Both arities are pinned, because the parameter is live on only one path
 *
 * The action runner calls a confirm handler with ONE argument (`ActionRunner.ts`
 * — the structured `confirm` arm that forwarded a bag was retired,
 * objectui#4314), and that is how `RecordDetailView`'s handler is reached: it
 * goes to `<ActionProvider onConfirm={...}>`, and its one other caller, the
 * header's `sys_delete` action (objectui#11001), passes ONE argument too. The
 * second parameter is live through a different door — `handleDeleteView` in
 * `ObjectView.tsx` calls a `ConfirmationHandler` directly with all three fields
 * localized (settled KEEP, 2026-08-22 ruling on objectui#5205). Pinning both
 * arities is what keeps the two runtimes interchangeable from the dialog's side
 * regardless of which door a future producer comes through.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, act, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1', name: 'Ada', image: null }, activeOrganization: null }),
  createAuthenticatedFetch: () => vi.fn(async () =>
    new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  ),
}));

vi.mock('@object-ui/collaboration', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRecordPresence: () => [],
  PresenceAvatars: () => null,
}));

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

/**
 * The assertion subject: the `state` each runtime hands the dialog. One double
 * serves both importers, so the two paths are observed through the SAME seam —
 * a per-path double could drift exactly the way the runtimes did.
 */
let dialogState: any = null;

/**
 * The CLOSE path's subject (objectui#6034). `dialogState` above only records
 * while `open` is true, so it structurally cannot see what a runtime writes
 * when the dialog CLOSES — the exact half these two runtimes disagreed on.
 *
 * - `dialogStates` records EVERY `state` the dialog is handed, so the object
 *   that arrives after the close is observable.
 * - `closeViaRuntime` is the runtime's OWN `onOpenChange` prop — driving the
 *   real seam, not a re-spelling of it. A test that called `setConfirmState`
 *   itself would pin the test's idea of the reset shape, not the runtime's.
 */
let dialogStates: any[] = [];
const NO_DIALOG_RENDERED = () => {
  throw new Error('ActionConfirmDialog never rendered — no runtime close seam to drive');
};
let closeViaRuntime: (open: boolean) => void = NO_DIALOG_RENDERED;

vi.mock('./ActionConfirmDialog', () => ({
  ActionConfirmDialog: ({ state, onOpenChange }: any) => {
    if (state?.open) dialogState = state;
    dialogStates.push(state);
    closeViaRuntime = onOpenChange;
    return null;
  },
}));
vi.mock('./ActionParamDialog', () => ({ ActionParamDialog: () => null }));
vi.mock('./ActionResultDialog', () => ({ ActionResultDialog: () => null }));
vi.mock('./FlowRunner', () => ({ FlowRunner: () => null }));
vi.mock('./MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false, toggle: () => {} }),
}));

vi.mock('../hooks/useActionModal', () => ({
  useActionModal: () => ({
    modalHandler: vi.fn(async () => ({ success: true })),
    modalElement: null,
    closeModal: () => {},
    resolveModalTarget: vi.fn(async () => null),
  }),
}));

vi.mock('../utils/consoleServerAction', () => ({
  createConsoleServerActionHandler: () => vi.fn(async () => ({ success: true })),
}));

/** Capture every `<ActionProvider>`'s props while keeping the real provider. */
const captured: Array<{ onConfirm: any; context: any }> = [];
vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/react')>();
  return {
    ...actual,
    ActionProvider: (props: any) => {
      captured.push({ onConfirm: props.onConfirm, context: props.context });
      return React.createElement(actual.ActionProvider as any, props);
    },
    SchemaRenderer: () => null,
  };
});

import { MetadataCtx } from '@object-ui/react';
import { RecordDetailView } from './RecordDetailView';
import { useConsoleActionRuntime } from '../hooks/useConsoleActionRuntime';

const OBJECT_NAME = 'crm_call';
const RECORD_ID = 'rec-call-1';

const OBJECTS = [
  {
    name: OBJECT_NAME,
    label: 'Call',
    fields: {
      id: { type: 'text', label: 'Id' },
      name: { type: 'text', label: 'Name' },
    },
  },
];

const METADATA = {
  objects: OBJECTS,
  pages: [],
  loading: false,
  error: null,
  refresh: async () => {},
  invalidate: () => {},
  ensureType: async () => [],
  getItem: async () => null,
  getItemsByType: () => [],
} as any;

const MESSAGE = 'Delete this call?';

/**
 * The out-of-runner producer's shape, verbatim in kind: `handleDeleteView` in
 * `ObjectView.tsx` passes all three fields, already localized.
 */
const BAG = { title: 'Delete view', confirmText: 'Delete', cancelText: 'Cancel' };

/**
 * The fields `ActionConfirmDialog.tsx` reads off `state`. Written out rather
 * than derived, so the parity assertions below cannot be satisfied by two
 * equally empty field sets — and so a runtime that stops supplying one of them
 * is red here rather than silently blank in the dialog.
 */
const DIALOG_READS = ['message', 'open', 'options', 'resolve'];

function makeDataSource() {
  return {
    find: vi.fn(async () => ({ data: [] })),
    findOne: vi.fn(async () => ({ id: RECORD_ID, name: 'Intro call' })),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  } as any;
}

/**
 * Path A — `RecordDetailView`'s own runtime. Mount the view and take the
 * `onConfirm` off the provider whose context carries THIS record, which is the
 * only handle a caller ever gets on this handler.
 */
async function confirmViaRecordDetailView(...args: unknown[]) {
  render(
    <MemoryRouter initialEntries={[`/app/demo/${OBJECT_NAME}/${RECORD_ID}`]}>
      <MetadataCtx.Provider value={METADATA}>
        <RecordDetailView
          dataSource={makeDataSource()}
          objects={OBJECTS}
          onEdit={() => {}}
          objectNameOverride={OBJECT_NAME}
          recordIdOverride={RECORD_ID}
          embedded
        />
      </MetadataCtx.Provider>
    </MemoryRouter>,
  );
  const pick = () =>
    [...captured].reverse().find((c) => c.onConfirm && c.context?.record?.id === RECORD_ID)?.onConfirm;
  await waitFor(() => expect(pick()).toBeTruthy());
  const confirm = pick()!;
  dialogState = null;
  await act(async () => {
    // The promise stays pending on purpose — that is the real shape: nothing
    // proceeds until the dialog's own Confirm resolves it.
    void (confirm as any)(...args);
    await Promise.resolve();
  });
  return dialogState;
}

/** Path B — `useConsoleActionRuntime`, mounted WITH its `dialogs` element. */
function ConsoleHarness({ onReady }: { onReady: (fn: any) => void }) {
  const runtime = useConsoleActionRuntime({ dataSource: {}, objects: [] } as any);
  const ready = React.useRef(false);
  if (!ready.current) {
    ready.current = true;
    onReady(runtime.actionProviderProps.onConfirm);
  }
  return <>{runtime.dialogs}</>;
}

async function confirmViaConsoleRuntime(...args: unknown[]) {
  let confirm: any;
  // The hook reaches for `useNavigate`, so it needs a router in scope — the
  // console mounts it under one too.
  render(
    <MemoryRouter initialEntries={['/app/demo']}>
      <ConsoleHarness onReady={(fn) => { confirm = fn; }} />
    </MemoryRouter>,
  );
  dialogState = null;
  await act(async () => {
    void confirm(...args);
    await Promise.resolve();
  });
  return dialogState;
}

/**
 * Close path — hand the runtime its own `onOpenChange(false)` and return the
 * `state` object it writes in response (objectui#6034).
 *
 * The call ORDER mirrors `ActionConfirmDialog.handleCancel` exactly: the dialog
 * settles the promise FIRST and only then calls `onOpenChange(false)`. That
 * order is the whole reason a `resolve` retained past the close is inert — a
 * second call on a settled promise is a no-op — so a close-path pin that
 * skipped the settle would be pinning a sequence production never runs.
 */
async function closeFromRuntime(openState: any) {
  const before = dialogStates.length;
  await act(async () => {
    openState.resolve?.(false);
    closeViaRuntime(false);
    await Promise.resolve();
  });
  const written = dialogStates.slice(before);
  expect(written.length).toBeGreaterThan(0);
  return written[written.length - 1];
}

beforeEach(() => {
  cleanup();
  captured.length = 0;
  dialogState = null;
  dialogStates = [];
  closeViaRuntime = NO_DIALOG_RENDERED;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('app-shell — both confirm runtimes feed ActionConfirmDialog the same fields (objectui#5835)', () => {
  it('one argument (the runner arity): RecordDetailView hands the dialog exactly the dialog-read field set', async () => {
    const state = await confirmViaRecordDetailView(MESSAGE);
    expect(state).toBeTruthy();
    expect(Object.keys(state).sort()).toEqual(DIALOG_READS);
    expect(state.open).toBe(true);
    expect(state.message).toBe(MESSAGE);
    // Inert on THIS path — the runner passes no bag (objectui#4314). The key is
    // still present and still declared; that is the point of objectui#5835.
    expect(state.options).toBeUndefined();
    expect(typeof state.resolve).toBe('function');
  });

  it('one argument (the runner arity): useConsoleActionRuntime hands it the same field set', async () => {
    const state = await confirmViaConsoleRuntime(MESSAGE);
    expect(state).toBeTruthy();
    expect(Object.keys(state).sort()).toEqual(DIALOG_READS);
    expect(state.open).toBe(true);
    expect(state.message).toBe(MESSAGE);
    expect(state.options).toBeUndefined();
    expect(typeof state.resolve).toBe('function');
  });

  it('two arguments (the out-of-runner producer): both runtimes forward the same bag, field for field', async () => {
    const fromView = await confirmViaRecordDetailView(MESSAGE, BAG);
    const fromHook = await confirmViaConsoleRuntime(MESSAGE, BAG);

    expect(Object.keys(fromView).sort()).toEqual(Object.keys(fromHook).sort());
    expect(Object.keys(fromView).sort()).toEqual(DIALOG_READS);
    expect(fromView.options).toEqual(BAG);
    expect(fromHook.options).toEqual(BAG);
    expect(fromView.message).toBe(fromHook.message);
    expect(fromView.open).toBe(fromHook.open);
  });

  it('the field set is the same one across the two runtimes, and it is not empty', async () => {
    const fromView = await confirmViaRecordDetailView(MESSAGE);
    const fromHook = await confirmViaConsoleRuntime(MESSAGE);

    const viewFields = Object.keys(fromView).sort();
    const hookFields = Object.keys(fromHook).sort();
    expect(viewFields).toEqual(hookFields);
    // Guard against the vacuous pass: two runtimes that both supply nothing
    // also "supply the same fields". Every field the dialog reads must be on
    // BOTH sides, and the list itself must be the non-trivial one.
    expect(DIALOG_READS.length).toBeGreaterThan(0);
    for (const field of DIALOG_READS) {
      expect(viewFields).toContain(field);
      expect(hookFields).toContain(field);
    }
  });
});

/**
 * ## The CLOSE half (objectui#6034)
 *
 * The block above is the OPEN half and it is #5835's. Its assertions stay green
 * under either reset shape, so within this file they are **controls, not
 * evidence** — they establish that both runtimes still reach the dialog at all,
 * which is what makes a difference measured after the close attributable to the
 * close handler.
 *
 * The divergence this half pins: `useConsoleActionRuntime` used to close with
 * `setConfirmState({ open: false, message: '' })` — replacing the whole object,
 * blanking `message` and dropping the `options` / `resolve` keys outright —
 * while `RecordDetailView` closed with `setConfirmState(s => ({ ...s, open:
 * false }))`, flipping one flag and keeping every field.
 *
 * **Field-preserving is the shape that won, because of who reads the state
 * after the close.** `AlertDialogContent` carries `data-[state=closed]:
 * animate-out … duration-200`, so Radix's `Presence` keeps the dialog MOUNTED
 * through its exit animation — `ActionConfirmDialog` goes on reading
 * `state.message` into `AlertDialogDescription` and `state.options` into the
 * title and both button labels for the whole fade-out. Blanking rewrites the
 * dialog's visible text mid-fade; preserving fades it out intact. The cost of
 * preserving is a settled promise's `resolve` left reachable in state, which is
 * inert: the dialog settles it before it ever asks for the close, and the open
 * path replaces the entire state object, so nothing stale survives a reopen.
 */
describe('app-shell — both confirm runtimes reset ActionConfirmDialog the same way on CLOSE (objectui#6034)', () => {
  it('RecordDetailView: the close flips `open` and keeps every other dialog-read field', async () => {
    const opened = await confirmViaRecordDetailView(MESSAGE, BAG);
    expect(opened.open).toBe(true);

    const closed = await closeFromRuntime(opened);
    expect(closed.open).toBe(false);
    // By NAME, not by count: a shape that drops keys is red on the key set, and
    // a shape that blanks `message` is red on the value even if the key stays.
    expect(Object.keys(closed).sort()).toEqual(DIALOG_READS);
    expect(closed.message).toBe(MESSAGE);
    expect(closed.options).toEqual(BAG);
    expect(typeof closed.resolve).toBe('function');
  });

  it('useConsoleActionRuntime: the close flips `open` and keeps every other dialog-read field', async () => {
    const opened = await confirmViaConsoleRuntime(MESSAGE, BAG);
    expect(opened.open).toBe(true);

    const closed = await closeFromRuntime(opened);
    expect(closed.open).toBe(false);
    expect(Object.keys(closed).sort()).toEqual(DIALOG_READS);
    expect(closed.message).toBe(MESSAGE);
    expect(closed.options).toEqual(BAG);
    expect(typeof closed.resolve).toBe('function');
  });

  it('the two runtimes write the same post-close state, field for field', async () => {
    const viewClosed = await closeFromRuntime(await confirmViaRecordDetailView(MESSAGE, BAG));
    cleanup();
    const hookClosed = await closeFromRuntime(await confirmViaConsoleRuntime(MESSAGE, BAG));

    expect(Object.keys(viewClosed).sort()).toEqual(Object.keys(hookClosed).sort());
    expect(Object.keys(viewClosed).sort()).toEqual(DIALOG_READS);
    expect(viewClosed.open).toBe(hookClosed.open);
    expect(viewClosed.message).toBe(hookClosed.message);
    expect(viewClosed.options).toEqual(hookClosed.options);
    expect(typeof viewClosed.resolve).toBe(typeof hookClosed.resolve);
  });

  it('the close-path fixture is multi-field, so the two reset shapes are distinguishable here', async () => {
    // Non-degeneracy guard. With an empty or single-field confirm state,
    // "blanked" and "preserved" produce the SAME object and every assertion
    // above passes without measuring anything. Applied to THIS fixture, the two
    // shapes app-shell actually shipped must disagree — on the key set AND on a
    // value — or the pin above is decorative.
    const opened = await confirmViaRecordDetailView(MESSAGE, BAG);
    const blanked: any = { open: false, message: '' };
    const preserved: any = { ...opened, open: false };

    expect(Object.keys(blanked).sort()).not.toEqual(Object.keys(preserved).sort());
    expect(blanked).not.toHaveProperty('options');
    expect(blanked).not.toHaveProperty('resolve');
    expect(blanked.message).not.toBe(preserved.message);
    expect(preserved.options).toEqual(BAG);

    // …and the fixture itself is what makes those inequalities real.
    expect(MESSAGE.length).toBeGreaterThan(0);
    expect(Object.keys(BAG).length).toBeGreaterThan(1);
  });
});
