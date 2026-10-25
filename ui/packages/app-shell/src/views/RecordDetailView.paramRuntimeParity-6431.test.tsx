/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `app-shell` mounts TWO action runtimes into ONE `ActionParamDialog` — pin
 * that they reset it the same way on CLOSE (objectui#6431).
 *
 * - `hooks/useConsoleActionRuntime.tsx` builds a `paramCollectionHandler` and
 *   renders `<ActionParamDialog>` from its own `dialogs` element.
 * - `views/RecordDetailView.tsx` does NOT consume that hook. It builds a
 *   second, near-identical handler and renders its own `<ActionParamDialog>`.
 *
 * They agreed on open and disagreed on close: the hook wrote
 * `setParamState({ open: false, params: [] })` — replacing the whole object,
 * emptying `params` and dropping `title` / `description` / `resolve` — while
 * the view wrote `setParamState(s => ({ ...s, open: false }))`. Same family as
 * objectui#6034 (the confirm pair, pinned in the sibling
 * `RecordDetailView.confirmRuntimeParity-5835.test.tsx`), objectui#5610 and
 * objectui#3320: this view re-implementing a shared runtime and then drifting
 * from it with nothing red in between.
 *
 * ## Which shape won, and why it was re-measured rather than inherited
 *
 * #6034's ruling transfers in FORM but not automatically in SUBSTANCE.
 * `ConfirmDialogState` is display-ish text; `ParamDialogState` carries a form's
 * `params`, so "blank it on close" could plausibly have been the deliberate
 * choice here — dropping a stale form rather than re-rendering it for 200ms.
 * Deciding that needed two readings, and the first `describe` below IS the
 * first of them, kept as an executable measurement rather than a note:
 *
 *  1. **What the dialog renders off `state` after `open` flips false.** Radix
 *     keeps the content mounted through the exit animation, and under the
 *     blanking shape the dialog re-titles itself to the generic
 *     `actionDialog.title`, swaps the action's description for the generic one,
 *     and drops every param row — a form the user just filled in empties out
 *     and re-labels itself while it fades. Under the preserving shape it fades
 *     out intact. Strictly more visible damage than the confirm case, which
 *     only blanked one line of text.
 *
 *  2. **Whether anything depends on `params` NOT surviving the close.** Nothing
 *     does, and in particular the user's typed values are not in `paramState`
 *     at all: they live in `ActionParamDialog`'s own `values` state, which its
 *     `useEffect` reseeds from the param defaults on every `state.open`
 *     false→true edge. A reopen therefore starts blank under BOTH shapes —
 *     pinned by `reopens blank under either reset shape` below, which is the
 *     reading that rules out a product-semantics fork ("should reopening retain
 *     what I typed?"). Nothing a user can observe beyond the fade-out frame
 *     differs between the two shapes, so this stayed a convergence and did not
 *     become a decision card.
 *
 * So: field-preserving wins on this dialog too, on this dialog's own evidence.
 *
 * ## Why the first `describe` asserts on the DOM, not on the state object
 *
 * "The runtime writes the right object" is one inference away from the claim
 * that matters, which is about pixels during a 200ms window. The sibling #6034
 * file asserts at the state object and is right to — it pins a contract between
 * two runtimes. This file additionally drives the REAL `ActionParamDialog`
 * through the REAL Radix presence machinery, so the thing being asserted is the
 * rendered output the user actually sees while the dialog fades.
 *
 * jsdom has no CSS engine, so `getComputedStyle(node).animationName` is always
 * `'none'` and Radix's `Presence` unmounts the content synchronously — the exit
 * window does not exist unless it is modelled. `animationName` is therefore
 * stubbed to be derived from the node's own live `data-state`, which is exactly
 * what the two real classes do (`data-[state=open]:animate-in` /
 * `data-[state=closed]:animate-out`). That model is what `Presence` needs: it
 * compares the animation name captured at mount against the one read at close,
 * and suspends the unmount only when they DIFFER — which is also why a constant
 * stub does not work, and why `data-state` is the only faithful source. The
 * model's premise (those classes exist, with a real duration) is not assumed:
 * `the exit-animation window is real in production` reads them off the shipped
 * `DialogContent`.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
// Module scope as well as where a test awaits it below: the cold transform is paid
// during collection, which no test or hook timeout clocks (AGENTS.md, flaky-test discipline).
import '@object-ui/components';
import { render, screen, waitFor, act, cleanup, fireEvent } from '@testing-library/react';
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
    success: vi.fn(), error: vi.fn(), info: vi.fn(),
    warning: vi.fn(), loading: vi.fn(), dismiss: vi.fn(),
  }),
}));

/**
 * The assertion subjects. ONE seam serves both halves and both importers (the
 * hook imports `../views/ActionParamDialog.js`, the view imports
 * `./ActionParamDialog.js` — one module, one spy), and it WRAPS the real
 * component rather than replacing it, so the DOM half renders the genuine
 * dialog while the state half still sees every object handed to it.
 *
 * - `dialogStates` records every `state` the dialog is handed, so the object
 *   written on close is observable.
 * - `closeViaRuntime` is the runtime's OWN `onOpenChange` prop — the real seam,
 *   not a re-spelling of it. A test that called `setParamState` itself would
 *   pin the test's idea of the reset shape rather than the runtime's.
 */
let dialogStates: any[] = [];
const NO_DIALOG_RENDERED = () => {
  throw new Error('ActionParamDialog never rendered — no runtime close seam to drive');
};
let closeViaRuntime: (open: boolean) => void = NO_DIALOG_RENDERED;

vi.mock('./ActionParamDialog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./ActionParamDialog')>();
  return {
    ...actual,
    ActionParamDialog: (props: any) => {
      dialogStates.push(props.state);
      closeViaRuntime = props.onOpenChange;
      return React.createElement(actual.ActionParamDialog as any, props);
    },
  };
});

vi.mock('./ActionConfirmDialog', () => ({ ActionConfirmDialog: () => null }));
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
const captured: Array<{ onParamCollection: any; context: any }> = [];
vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/react')>();
  return {
    ...actual,
    ActionProvider: (props: any) => {
      captured.push({ onParamCollection: props.onParamCollection, context: props.context });
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
    fields: { id: { type: 'text', label: 'Id' }, name: { type: 'text', label: 'Name' } },
  },
];

const METADATA = {
  objects: OBJECTS, pages: [], loading: false, error: null,
  refresh: async () => {}, invalidate: () => {}, ensureType: async () => [],
  getItem: async () => null, getItemsByType: () => [],
} as any;

/**
 * A MULTI-FIELD fixture, deliberately. With a single-field param state the
 * blanking and the preserving shapes produce the SAME object and every
 * assertion below passes without measuring anything — see the non-degeneracy
 * guard at the bottom, which applies that requirement to THIS fixture.
 */
const PARAMS = [
  { name: 'env_name', label: 'Environment name', type: 'text', required: true },
  { name: 'region', label: 'Region', type: 'text' },
] as any[];

const ACTION = {
  name: 'create_environment',
  label: 'Create environment',
  description: 'Provisions a new environment for this org.',
} as any;

/** The fields `ActionParamDialog.tsx` reads off `state`. Written out rather
 *  than derived, so two equally empty field sets cannot satisfy the parity
 *  assertions, and a runtime that stops supplying one is red here rather than
 *  silently blank in the dialog. */
const DIALOG_READS = [
  'description',
  // The runner's template filler for each param's `helpText` (objectui#12967).
  // This suite's handlers are called without one, so it is written `undefined`;
  // the key is still on both runtimes' state, which is what parity reads.
  'interpolate',
  'open',
  'params',
  'resolve',
  // The runner's `run` (objectui#13161): Confirm runs the action from inside
  // the dialog, so a refusal keeps the typed values. Called without one here,
  // so it is written `undefined`; the key is on both runtimes' state.
  'run',
  'title',
];

function makeDataSource() {
  return {
    find: vi.fn(async () => ({ data: [] })),
    findOne: vi.fn(async () => ({ id: RECORD_ID, name: 'Intro call' })),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  } as any;
}

/** Path A — `RecordDetailView`'s own runtime. */
async function openViaRecordDetailView() {
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
    [...captured].reverse().find((c) => c.onParamCollection && c.context?.record?.id === RECORD_ID)
      ?.onParamCollection;
  await waitFor(() => expect(pick()).toBeTruthy());
  return openThrough(pick()!);
}

/** Path B — `useConsoleActionRuntime`, mounted WITH its `dialogs` element. */
function ConsoleHarness({ onReady }: { onReady: (fn: any) => void }) {
  const runtime = useConsoleActionRuntime({ dataSource: {}, objects: [] } as any);
  const ready = React.useRef(false);
  if (!ready.current) {
    ready.current = true;
    onReady(runtime.paramCollectionHandler);
  }
  return <>{runtime.dialogs}</>;
}

async function openViaConsoleRuntime() {
  let handler: any;
  // The hook reaches for `useNavigate`, so it needs a router in scope — the
  // console mounts it under one too.
  render(
    <MemoryRouter initialEntries={['/app/demo']}>
      <ConsoleHarness onReady={(fn) => { handler = fn; }} />
    </MemoryRouter>,
  );
  return openThrough(handler);
}

/**
 * Drive a runtime's real param-collection handler and return the `state` it
 * handed the dialog. The promise stays pending on purpose — that is the real
 * shape: nothing proceeds until the dialog resolves it.
 */
async function openThrough(handler: any) {
  const before = dialogStates.length;
  await act(async () => {
    void handler(PARAMS, ACTION);
    await Promise.resolve();
  });
  const opened = [...dialogStates.slice(before)].reverse().find((s) => s?.open);
  expect(opened).toBeTruthy();
  return opened;
}

/**
 * Close path — hand the runtime its own `onOpenChange(false)` and return the
 * `state` object it writes in response.
 *
 * The call ORDER mirrors `ActionParamDialog.handleCancel` exactly: the dialog
 * settles the promise FIRST and only then calls `onOpenChange(false)`. That
 * order is the whole reason a `resolve` retained past the close is inert — a
 * second call on a settled promise is a no-op — so a close-path pin that
 * skipped the settle would be pinning a sequence production never runs.
 */
async function closeFromRuntime(openState: any) {
  const before = dialogStates.length;
  await act(async () => {
    openState.resolve?.(null);
    closeViaRuntime(false);
    await Promise.resolve();
  });
  const written = dialogStates.slice(before);
  expect(written.length).toBeGreaterThan(0);
  return written[written.length - 1];
}

/**
 * Model jsdom's missing CSS engine on the two classes the real `DialogContent`
 * carries, so Radix's `Presence` suspends the unmount the way it does in a
 * browser. Deriving the name from the node's live `data-state` is what makes
 * the mount-time and close-time reads DIFFER, which is the condition `Presence`
 * actually tests.
 */
function modelExitAnimation() {
  const real = window.getComputedStyle.bind(window);
  vi.spyOn(window, 'getComputedStyle').mockImplementation(((node: any, pe?: any) => {
    const styles = real(node, pe);
    return new Proxy(styles, {
      get(target, prop) {
        if (prop === 'animationName') {
          const state = node?.getAttribute?.('data-state');
          if (state === 'open') return 'os-enter';
          if (state === 'closed') return 'os-exit';
          return 'none';
        }
        const value = (target as any)[prop];
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }) as any;
  }) as any);
}

const dialogNode = () => document.querySelector('[role="dialog"]');
const headingText = () => document.querySelector('[role="dialog"] h2')?.textContent ?? null;
const paragraphTexts = () =>
  [...document.querySelectorAll('[role="dialog"] p')].map((p) => p.textContent);
const paramLabels = () =>
  [...document.querySelectorAll('[role="dialog"] label')].map((l) => l.textContent);

beforeEach(() => {
  cleanup();
  captured.length = 0;
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
  vi.restoreAllMocks();
});

describe('app-shell — what ActionParamDialog RENDERS while it fades out (objectui#6431)', () => {
  it('the exit-animation window is real in production, not just modelled here', async () => {
    // The premise the model rests on, read off the SHIPPED component rather
    // than assumed. Without a non-zero exit animation there is no window in
    // which the post-close `state` is visible and this whole card is moot; if
    // `DialogContent` ever drops these classes the model above stops matching
    // production and this test says so before the pins start lying.
    const { Dialog, DialogContent } = await import('@object-ui/components');
    render(
      <Dialog open>
        <DialogContent>content</DialogContent>
      </Dialog>,
    );
    const classes = (await screen.findByRole('dialog')).className;
    expect(classes).toContain('data-[state=closed]:animate-out');
    expect(classes).toContain('duration-200');
    // The enter side too — `Presence` suspends the unmount only when the
    // mount-time and close-time animation names DIFFER, so a content node with
    // only one of the two would never hold through the fade.
    expect(classes).toContain('data-[state=open]:animate-in');
  });

  it('console runtime: the closing dialog keeps the action title, description and every param row', async () => {
    modelExitAnimation();
    const opened = await openViaConsoleRuntime();
    expect(opened.open).toBe(true);

    // Ghost-assertion guard: reach the post-close reads only after a REAL
    // render is confirmed. A zero-render dialog times out here instead of
    // sailing through the "nothing was blanked" assertions below.
    await screen.findByLabelText(/Environment name/);
    expect(headingText()).toBe('Create environment');

    await act(async () => {
      opened.resolve?.(null);
      closeViaRuntime(false);
      await Promise.resolve();
    });

    // The exit window exists: content still mounted, Radix already in `closed`.
    const node = dialogNode();
    expect(node).toBeTruthy();
    expect(node!.getAttribute('data-state')).toBe('closed');

    // …and the runtime did not rewrite what it shows mid-fade.
    expect(headingText()).toBe('Create environment');
    expect(paragraphTexts()).toContain('Provisions a new environment for this org.');
    expect(paramLabels()).toEqual(['Environment name*', 'Region']);
  });

  it('RecordDetailView runtime: same, through the second runtime (control — green before the fix too)', async () => {
    // CONTROL, stated as such. `RecordDetailView` already closed field-preserving,
    // so this case does not distinguish the two shapes and is not evidence for
    // the ruling. It earns its place by making the case above attributable: it
    // shows the dialog, the model and the harness all behave for a runtime that
    // was never broken, so a failure above is the close handler and not the rig.
    modelExitAnimation();
    const opened = await openViaRecordDetailView();
    await screen.findByLabelText(/Environment name/);

    await act(async () => {
      opened.resolve?.(null);
      closeViaRuntime(false);
      await Promise.resolve();
    });

    expect(dialogNode()?.getAttribute('data-state')).toBe('closed');
    expect(headingText()).toBe('Create environment');
    expect(paramLabels()).toEqual(['Environment name*', 'Region']);
  });

  it('the blanking shape is what this replaced: it empties and re-titles the fading dialog', async () => {
    // The negative half of the measurement, kept executable. This drives the
    // dialog DIRECTLY with the object the old close handler wrote, so it is
    // green on either side of the fix by construction — it is the evidence for
    // WHY the pin above targets the fields it does, and it fails the day
    // `ActionParamDialog` stops reading one of them (at which point the pin
    // above would be guarding nothing).
    modelExitAnimation();
    const { ActionParamDialog } = await import('./ActionParamDialog');
    const opened = {
      open: true, params: PARAMS,
      title: 'Create environment',
      description: 'Provisions a new environment for this org.',
      resolve: () => {},
    } as any;
    const { rerender } = render(
      <ActionParamDialog state={opened} onOpenChange={() => {}} />,
    );
    await screen.findByLabelText(/Environment name/);

    rerender(
      <ActionParamDialog state={{ open: false, params: [] } as any} onOpenChange={() => {}} />,
    );
    await act(async () => { await Promise.resolve(); });

    expect(dialogNode()?.getAttribute('data-state')).toBe('closed');
    // Every field the old shape dropped shows up as a visible rewrite:
    expect(headingText()).not.toBe('Create environment');
    expect(paragraphTexts()).not.toContain('Provisions a new environment for this org.');
    expect(paramLabels()).toEqual([]);
    expect(document.querySelectorAll('[role="dialog"] input').length).toBe(0);
  });

  it('reopens blank under either reset shape — so no user-visible difference outlives the fade', async () => {
    // The reading that ruled out a product-semantics fork. The typed value is
    // not in `paramState` at all; it is in the dialog's own `values`, reseeded
    // on every open. Both shapes are driven through a full close→reopen round
    // trip and must agree.
    const { ActionParamDialog } = await import('./ActionParamDialog');
    const opened = {
      open: true, params: PARAMS, title: 'Create environment',
      description: 'Provisions a new environment for this org.', resolve: () => {},
    } as any;

    const typeThenRoundTrip = async (closedState: any) => {
      const { rerender } = render(
        <ActionParamDialog state={opened} onOpenChange={() => {}} />,
      );
      const input = (await screen.findByLabelText(/Environment name/)) as HTMLInputElement;
      fireEvent.change(input, { target: { value: 'typed-by-user' } });
      await act(async () => { await Promise.resolve(); });
      expect((await screen.findByLabelText(/Environment name/)) as HTMLInputElement)
        .toHaveValue('typed-by-user');

      rerender(<ActionParamDialog state={closedState} onOpenChange={() => {}} />);
      await act(async () => { await Promise.resolve(); });
      rerender(<ActionParamDialog state={{ ...opened }} onOpenChange={() => {}} />);
      await act(async () => { await Promise.resolve(); });
      const reopened = (await screen.findByLabelText(/Environment name/)) as HTMLInputElement;
      const value = reopened.value;
      cleanup();
      return value;
    };

    const afterBlanking = await typeThenRoundTrip({ open: false, params: [] });
    const afterPreserving = await typeThenRoundTrip({ ...opened, open: false });

    expect(afterBlanking).toBe('');
    expect(afterPreserving).toBe('');
    expect(afterBlanking).toBe(afterPreserving);
  });
});

describe('app-shell — both param runtimes reset ActionParamDialog the same way on CLOSE (objectui#6431)', () => {
  it('useConsoleActionRuntime: the close flips `open` and keeps every other dialog-read field', async () => {
    const opened = await openViaConsoleRuntime();
    expect(opened.open).toBe(true);

    const closed = await closeFromRuntime(opened);
    expect(closed.open).toBe(false);
    // By NAME, not by count: a shape that drops keys is red on the key set, and
    // a shape that empties `params` is red on the value even if the key stays.
    expect(Object.keys(closed).sort()).toEqual(DIALOG_READS);
    expect(closed.title).toBe('Create environment');
    expect(closed.description).toBe('Provisions a new environment for this org.');
    expect(closed.params.map((p: any) => p.name)).toEqual(['env_name', 'region']);
    expect(typeof closed.resolve).toBe('function');
  });

  it('RecordDetailView: the close flips `open` and keeps every other dialog-read field', async () => {
    const opened = await openViaRecordDetailView();
    expect(opened.open).toBe(true);

    const closed = await closeFromRuntime(opened);
    expect(closed.open).toBe(false);
    expect(Object.keys(closed).sort()).toEqual(DIALOG_READS);
    expect(closed.title).toBe('Create environment');
    expect(closed.description).toBe('Provisions a new environment for this org.');
    expect(closed.params.map((p: any) => p.name)).toEqual(['env_name', 'region']);
    expect(typeof closed.resolve).toBe('function');
  });

  it('the two runtimes write the same post-close state, field for field', async () => {
    const viewClosed = await closeFromRuntime(await openViaRecordDetailView());
    cleanup();
    dialogStates = [];
    const hookClosed = await closeFromRuntime(await openViaConsoleRuntime());

    expect(Object.keys(viewClosed).sort()).toEqual(Object.keys(hookClosed).sort());
    expect(Object.keys(viewClosed).sort()).toEqual(DIALOG_READS);
    expect(viewClosed.open).toBe(hookClosed.open);
    expect(viewClosed.title).toBe(hookClosed.title);
    expect(viewClosed.description).toBe(hookClosed.description);
    expect(viewClosed.params.map((p: any) => p.name))
      .toEqual(hookClosed.params.map((p: any) => p.name));
    expect(typeof viewClosed.resolve).toBe(typeof hookClosed.resolve);
  });

  it('the close-path fixture is multi-field, so the two reset shapes are distinguishable here', async () => {
    // Non-degeneracy guard. With an empty or single-field param state,
    // "blanked" and "preserved" produce the SAME object and every assertion
    // above passes without measuring anything. Applied to THIS fixture, the two
    // shapes app-shell actually shipped must disagree — on the key set AND on a
    // value — or the pins above are decorative.
    const opened = await openViaConsoleRuntime();
    const blanked: any = { open: false, params: [] };
    const preserved: any = { ...opened, open: false };

    expect(Object.keys(blanked).sort()).not.toEqual(Object.keys(preserved).sort());
    expect(blanked).not.toHaveProperty('title');
    expect(blanked).not.toHaveProperty('description');
    expect(blanked).not.toHaveProperty('resolve');
    expect(blanked.params).toEqual([]);
    expect(preserved.params.length).toBeGreaterThan(0);

    // …and the fixture itself is what makes those inequalities real.
    expect(PARAMS.length).toBeGreaterThan(1);
    expect(ACTION.label.length).toBeGreaterThan(0);
    expect(ACTION.description.length).toBeGreaterThan(0);
  });
});
