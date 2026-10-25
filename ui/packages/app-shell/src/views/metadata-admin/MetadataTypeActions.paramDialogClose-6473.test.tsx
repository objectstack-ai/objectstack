// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `MetadataTypeActions` is the THIRD `ActionParamDialog` consumer in app-shell
 * — pin that its close no longer blanks the dialog mid-fade (objectui#6473).
 *
 * The other two (`hooks/useConsoleActionRuntime.tsx` and
 * `views/RecordDetailView.tsx`) converged on a field-preserving close in
 * objectui#6431 and are pinned in
 * `views/RecordDetailView.paramRuntimeParity-6431.test.tsx`. This file was
 * neither in that card's premise nor its file face, and stayed on
 * `setParamState({ open: false, params: [] })` — replacing the whole object,
 * dropping `title` / `resolve` and emptying `params`.
 *
 * ## Why the first `describe` asserts on the DOM, not on the state object
 *
 * The claim that matters is about pixels during a 200ms window, not about which
 * object a setter wrote. `DialogContent` carries `duration-200
 * data-[state=closed]:animate-out`, so Radix holds the content mounted through
 * the exit animation and `ActionParamDialog` goes on rendering off `state` for
 * the whole fade-out. A test that only checked the end state — that the dialog
 * eventually unmounts — is green under BOTH shapes and is not coverage.
 *
 * happy-dom has no CSS engine, so `getComputedStyle(node).animationName` is
 * always `'none'` and Radix's `Presence` unmounts the content synchronously —
 * the exit window does not exist unless it is modelled. `animationName` is
 * therefore derived from the node's own live `data-state`, which is exactly what
 * the two shipped classes do. `Presence` compares the name captured at mount
 * against the one read at close and suspends the unmount only when they DIFFER,
 * which is why a constant stub does not work and `data-state` is the only
 * faithful source. The model's premise is read off the shipped `DialogContent`
 * rather than assumed, by the first test below.
 *
 * ## What this site can and cannot lose (a correction to the card)
 *
 * The card and the dispatch both say "title, description and param rows".
 * `title` and `params` are real here — `run()` opens with `action.label ??
 * action.name`. `description` is NOT: this consumer never puts one in
 * `paramState`, so the dialog falls back to the generic
 * `actionDialog.description` under both shapes. The assertions below therefore
 * pin `title` and the param rows, and the state-shape test states the missing
 * `description` explicitly rather than letting a reader infer parity that is
 * not there.
 *
 * ## The `resolve?.(null)` sub-decision, and why it is a test rather than a note
 *
 * The old close settled the promise itself (`paramState.resolve?.(null)`) before
 * resetting. That line is gone, and the licence for dropping it is an
 * ENUMERATION of every path into this callback — not "resolving twice is a
 * no-op", which is true of promises and beside the point. `onOpenChange` is
 * called from exactly three places, all inside `ActionParamDialog`:
 *
 *   1. `handleSubmit`  — `state.resolve?.(collected)` (the serialized values) first.
 *   2. `handleCancel`  — `state.resolve?.(null)` first.
 *   3. the Radix root's own `onOpenChange`, which delegates to `handleCancel`
 *      and is the single route taken by Escape, an overlay/outside click, and
 *      the header's X close button.
 *
 * The second `describe` drives every one of those routes through the real
 * component and asserts the settle precedes the callback, plus a census over
 * `ActionParamDialog.tsx` so a fourth, unsettled call site added later is red
 * here instead of leaving a promise pending forever.
 */

import * as React from 'react';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
// Module scope as well as where a test awaits it below: the cold transform is paid
// during collection, which no test or hook timeout clocks (AGENTS.md, flaky-test discipline).
import '@object-ui/components';
import { render, screen, act, cleanup, fireEvent } from '@testing-library/react';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createAuthenticatedFetch: () => vi.fn(async () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({ success: true, data: { message: 'done' } }),
  })),
}));

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(), error: vi.fn(), info: vi.fn(),
    warning: vi.fn(), loading: vi.fn(), dismiss: vi.fn(),
  }),
}));

vi.mock('../ActionResultDialog', () => ({ ActionResultDialog: () => null }));

/**
 * The assertion seam. It WRAPS the real `ActionParamDialog` rather than
 * replacing it, so the DOM half renders the genuine dialog (and the genuine
 * Radix presence machinery) while the state half still sees every object the
 * component hands it. A stub would pin this test's idea of the dialog instead
 * of the dialog.
 */
let dialogStates: any[] = [];
vi.mock('../ActionParamDialog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ActionParamDialog')>();
  return {
    ...actual,
    ActionParamDialog: (props: any) => {
      dialogStates.push(props.state);
      return React.createElement(actual.ActionParamDialog as any, props);
    },
  };
});

import { MetadataTypeActions } from './MetadataTypeActions';

/**
 * A MULTI-FIELD fixture with a non-generic title, deliberately: with a single
 * param and no title the blanking and the preserving shapes produce nearly the
 * same render and the assertions below would pass without measuring anything.
 * The non-degeneracy guard at the bottom applies that requirement to THIS
 * fixture.
 */
const PARAMS = [
  { name: 'reason', label: 'Reason', type: 'text', required: true },
  { name: 'region', label: 'Region', type: 'text', defaultValue: 'us-east' },
] as unknown[];

const ACTION = {
  name: 'sync',
  label: 'Sync datasource',
  type: 'api',
  target: '/api/v1/datasources/${ctx.recordId}/sync',
  locations: ['record_header'],
  params: PARAMS,
};

function renderActions(params: unknown[] = PARAMS) {
  return render(
    <MetadataTypeActions
      location="record_header"
      recordId="ds1"
      entry={{ actions: [{ ...ACTION, params }] as never }}
    />,
  );
}

/**
 * Model the missing CSS engine on the two classes the real `DialogContent`
 * carries, so `Presence` suspends the unmount the way it does in a browser.
 * Deriving the name from the node's live `data-state` is what makes the
 * mount-time and close-time reads DIFFER, which is the condition `Presence`
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

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));

/**
 * The dialog's own chrome is labelled through `useObjectTranslation`, and the
 * light DOM setup mounts no i18n provider — so `t('actionDialog.cancel')`
 * returns the raw KEY here and the plain string `'Cancel'` matches nothing.
 * Matching case-insensitively on the distinguishing word hits both spellings,
 * so these queries neither depend on nor forbid a provider. (`Close` on the
 * header X is not translated through that hook at all: `CloseSrLabel` carries
 * its own no-provider default.)
 */
const cancelButton = () => screen.getByRole('button', { name: /cancel/i });
const confirmButton = () => screen.getByRole('button', { name: /confirm/i });
const closeXButton = () => screen.getByRole('button', { name: /close/i });

const dialogNode = () => document.querySelector('[role="dialog"]');
const headingText = () => document.querySelector('[role="dialog"] h2')?.textContent ?? null;
const paragraphTexts = () =>
  [...document.querySelectorAll('[role="dialog"] p')].map((p) => p.textContent);
const paramLabels = () =>
  [...document.querySelectorAll('[role="dialog"] label')].map((l) => l.textContent);

/**
 * The generic heading and description the dialog falls back to when `state`
 * carries no `title` / `description` — MEASURED off the real component rather
 * than hard-coded, for the same reason as the button queries above: with no
 * i18n provider these are raw keys, with one they are English sentences, and
 * this file should be red on the close handler rather than on the test setup.
 * Renders and tears down its own tree, so call it before rendering a subject.
 */
async function genericChrome() {
  const { ActionParamDialog } = await import('../ActionParamDialog');
  render(<ActionParamDialog state={{ open: true, params: [] } as any} onOpenChange={() => {}} />);
  await screen.findByRole('dialog');
  const measured = { title: headingText(), description: paragraphTexts()[0] ?? null };
  cleanup();
  expect(measured.title).toBeTruthy();
  expect(measured.description).toBeTruthy();
  return measured;
}

/** Open the dialog through the real button, and wait for the lazy widgets. */
async function openDialog() {
  fireEvent.click(screen.getByTitle('Sync datasource'));
  await screen.findByLabelText(/Reason/);
}

/** Close it the way a user does — the real Cancel button inside the dialog. */
async function cancelDialog() {
  await act(async () => {
    fireEvent.click(cancelButton());
    await Promise.resolve();
  });
}

beforeEach(() => {
  cleanup();
  dialogStates = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('MetadataTypeActions — what ActionParamDialog RENDERS while it fades out (objectui#6473)', () => {
  it('the exit-animation window is real in production, not just modelled here', async () => {
    // The premise the model rests on, read off the SHIPPED component rather
    // than assumed. Without a non-zero exit animation there is no window in
    // which the post-close `state` is visible and this whole card is moot.
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

  it('the closing dialog keeps the action title and every param row through the exit animation', async () => {
    // THE regression pin. Red against the pre-fix handler
    // (`setParamState({ open: false, params: [] })`): the heading reverts to the
    // generic `actionDialog.title` and every label disappears while the dialog
    // is still on screen.
    modelExitAnimation();
    renderActions();
    await openDialog();
    expect(headingText()).toBe('Sync datasource');
    expect(paramLabels()).toEqual(['Reason*', 'Region']);

    await cancelDialog();

    // The exit window exists: content still mounted, Radix already in `closed`.
    const node = dialogNode();
    expect(node).toBeTruthy();
    expect(node!.getAttribute('data-state')).toBe('closed');

    // …and the close did not rewrite what it shows mid-fade.
    expect(headingText()).toBe('Sync datasource');
    expect(paramLabels()).toEqual(['Reason*', 'Region']);
    expect(document.querySelectorAll('[role="dialog"] input').length).toBe(2);
  });

  it('the close flips `open` and keeps every field this site puts in the state', async () => {
    // The state-object half, by NAME: a shape that drops keys is red on the key
    // set, and a shape that empties `params` is red on the value even if the key
    // survives. `description` is absent BY CONSTRUCTION here — this consumer
    // never supplies one — so the dialog shows the generic description under
    // both shapes and it is not part of what the fix recovers.
    renderActions();
    await openDialog();
    const opened = [...dialogStates].reverse().find((s) => s?.open);
    expect(opened).toBeTruthy();
    expect(Object.keys(opened).sort()).toEqual(['open', 'params', 'resolve', 'title']);

    const before = dialogStates.length;
    await cancelDialog();
    const closed = dialogStates[dialogStates.length - 1];
    expect(dialogStates.length).toBeGreaterThan(before);

    expect(closed.open).toBe(false);
    expect(Object.keys(closed).sort()).toEqual(['open', 'params', 'resolve', 'title']);
    expect(closed.title).toBe('Sync datasource');
    expect(closed.params.map((p: any) => p.name)).toEqual(['reason', 'region']);
    expect(typeof closed.resolve).toBe('function');
    expect(closed).not.toHaveProperty('description');
  });

  it('the blanking shape is what this replaced: it empties and re-titles the fading dialog', async () => {
    // The negative half of the measurement, kept executable. It drives the
    // dialog DIRECTLY with the object the old close handler wrote, so it is
    // green on either side of the fix by construction — it is the evidence for
    // WHY the pin above targets the fields it does, and it fails the day
    // `ActionParamDialog` stops reading one of them (at which point the pin
    // above would be guarding nothing).
    modelExitAnimation();
    const generic = await genericChrome();
    const { ActionParamDialog } = await import('../ActionParamDialog');
    const opened = {
      open: true,
      params: PARAMS,
      title: 'Sync datasource',
      resolve: () => {},
    } as any;
    const { rerender } = render(<ActionParamDialog state={opened} onOpenChange={() => {}} />);
    await screen.findByLabelText(/Reason/);

    rerender(<ActionParamDialog state={{ open: false, params: [] } as any} onOpenChange={() => {}} />);
    await act(async () => { await Promise.resolve(); });

    expect(dialogNode()?.getAttribute('data-state')).toBe('closed');
    expect(headingText()).not.toBe('Sync datasource');
    expect(headingText()).toBe(generic.title);
    expect(paramLabels()).toEqual([]);
    expect(document.querySelectorAll('[role="dialog"] input').length).toBe(0);
    // The generic description is what this site shows under BOTH shapes, so it
    // is the one field the fix does not recover here.
    expect(paragraphTexts()).toContain(generic.description);
  });

  it('CONTROL — reopening still starts from the param defaults, not the previous run', async () => {
    // Must stay green. Preserving `params` on close must not accidentally make
    // a reopen inherit what the user typed: those values never lived in
    // `paramState`, they live in the dialog's own `values`, reseeded from the
    // param defaults on every `state.open` false→true edge.
    renderActions();
    await openDialog();
    const reason = () => screen.getByLabelText(/Reason/) as HTMLInputElement;
    const region = () => screen.getByLabelText(/Region/) as HTMLInputElement;
    expect(reason().value).toBe('');
    expect(region().value).toBe('us-east');

    fireEvent.change(reason(), { target: { value: 'typed-by-user' } });
    fireEvent.change(region(), { target: { value: 'eu-west' } });
    await act(async () => { await Promise.resolve(); });
    expect(reason().value).toBe('typed-by-user');
    expect(region().value).toBe('eu-west');

    await cancelDialog();
    await openDialog();

    expect(reason().value).toBe('');
    expect(region().value).toBe('us-east');
  });

  it('the fixture is multi-field and titled, so the two reset shapes are distinguishable here', async () => {
    // Non-degeneracy guard. With no params and no title, "blanked" and
    // "preserved" render the same dialog and every assertion above passes
    // without measuring anything.
    const generic = await genericChrome();
    renderActions();
    await openDialog();
    const opened = [...dialogStates].reverse().find((s) => s?.open);
    const blanked: any = { open: false, params: [] };
    const preserved: any = { ...opened, open: false };

    expect(Object.keys(blanked).sort()).not.toEqual(Object.keys(preserved).sort());
    expect(blanked).not.toHaveProperty('title');
    expect(blanked).not.toHaveProperty('resolve');
    expect(blanked.params).toEqual([]);
    expect(preserved.params.length).toBeGreaterThan(1);
    expect(preserved.title).toBe('Sync datasource');
    expect(preserved.title).not.toBe(generic.title);
  });
});

describe('MetadataTypeActions — every path into onOpenChange(false) has already settled the promise (objectui#6473)', () => {
  /**
   * Drive one close route through the REAL dialog and return the interleaved
   * order of `resolve` and `onOpenChange`. The old host-side
   * `paramState.resolve?.(null)` was dropped on the strength of this order
   * holding on every route.
   */
  async function orderFor(closeRoute: () => void) {
    const order: string[] = [];
    const { ActionParamDialog } = await import('../ActionParamDialog');
    const state = {
      open: true,
      // No `required` here: the submit route must be able to complete without
      // the required-field guard short-circuiting it before it settles.
      params: [{ name: 'region', label: 'Region', type: 'text' }] as unknown[],
      title: 'Sync datasource',
      resolve: (v: unknown) => order.push(v === null ? 'resolve(null)' : 'resolve(values)'),
    } as any;
    render(
      <ActionParamDialog
        state={state}
        onOpenChange={(open: boolean) => order.push(`onOpenChange(${open})`)}
      />,
    );
    await screen.findByLabelText(/Region/);
    await act(async () => {
      closeRoute();
      await Promise.resolve();
    });
    cleanup();
    return order;
  }

  it('route 1/3 — handleSubmit (the Confirm button) settles with the values first', async () => {
    expect(await orderFor(() => fireEvent.click(confirmButton())))
      .toEqual(['resolve(values)', 'onOpenChange(false)']);
  });

  it('route 2/3 — handleCancel (the Cancel button) settles with null first', async () => {
    expect(await orderFor(() => fireEvent.click(cancelButton())))
      .toEqual(['resolve(null)', 'onOpenChange(false)']);
  });

  it('route 3/3a — the Radix root (Escape) delegates to handleCancel, so it settles first', async () => {
    expect(await orderFor(() => fireEvent.keyDown(document, { key: 'Escape' })))
      .toEqual(['resolve(null)', 'onOpenChange(false)']);
  });

  it('route 3/3b — the Radix root (the header X button) takes the same delegation', async () => {
    expect(await orderFor(() => fireEvent.click(closeXButton())))
      .toEqual(['resolve(null)', 'onOpenChange(false)']);
  });

  it('the routes above are ALL of them — census over ActionParamDialog.tsx', async () => {
    // Non-degeneracy for the enumeration itself. Four driven routes prove
    // nothing about a FIFTH that someone adds later without a settle, and the
    // cost of one is a promise pending forever — strictly worse than the
    // redundant settle that was removed. `ActionParamDialog.tsx` is read-only
    // for this card; this reads it.
    const source = readFileSync(path.resolve(THIS_DIR, '../ActionParamDialog.tsx'), 'utf8');

    // (a) Direct calls of the host's prop: exactly two, both `false`, and each
    //     preceded by the settle in the same handler.
    const calls = [...source.matchAll(/onOpenChange\(/g)].map((m) => m.index as number);
    expect(calls).toHaveLength(2);
    expect(source.match(/onOpenChange\(false\)/g)).toHaveLength(2);
    for (const idx of calls) {
      expect(source.slice(Math.max(0, idx - 200), idx)).toContain('state.resolve?.(');
    }

    // (b) The Radix root's own handler: exactly one, and it delegates to
    //     `handleCancel` rather than calling the host prop itself. This is the
    //     route Escape, an overlay/outside click and the X button all take, so
    //     the two driven above cover the third one's siblings.
    const collapsed = source.replace(/\s+/g, '');
    expect(collapsed.match(/onOpenChange=\{/g)).toHaveLength(1);
    expect(collapsed).toContain('onOpenChange={(open)=>{if(!open)handleCancel();}}');
  });
});
