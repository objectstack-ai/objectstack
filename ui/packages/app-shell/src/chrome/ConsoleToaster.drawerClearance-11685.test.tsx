/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11685 — with a drawer open, the success toast landed on the
 * drawer's expand and close buttons and its title: the toaster's `top-right`
 * corner (objectui#7482) is also where every right-side drawer keeps its
 * chrome.
 *
 * The fix anchors the toaster top-right and offsets it while a right-edge
 * drawer is open (with none open it sits top-centre since objectui#13340): into the strip of page left of the drawer when a toast fits there,
 * otherwise below the drawer's header. This file pins that MECHANISM — which
 * dialogs count as a right-edge drawer, and which sonner offset each case
 * produces, appearing on open and gone on close.
 *
 * ⚠️ What it cannot pin is the geometry itself. happy-dom has no layout
 * engine, so every size here is assigned, not measured: the drawer's
 * `offsetWidth` and its header's `offsetTop` / `offsetHeight` are set to the
 * values Chromium measured for the record drawer (`NavigationOverlay` drawer
 * mode, header 45px tall). The real-layout reading — toast and drawer header
 * bounding boxes before and after, across viewports and drawer sizes — was a
 * one-off Chromium measurement recorded on the pull request that landed this
 * file; nothing re-runs it.
 */
import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, act, cleanup, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import { ConsoleToaster } from './ConsoleToaster.js';
import { ThemeProvider } from './ThemeProvider.js';

/** The record drawer's header height, as Chromium lays it out. */
const HEADER_HEIGHT = 45;

/** Inline layout of a `side="right"` sheet: fixed to the top, right and bottom edges. */
const RIGHT_SHEET = 'position: fixed; top: 0px; right: 0px; bottom: 0px;';

const mounted: HTMLElement[] = [];
const innerWidthDescriptor = Object.getOwnPropertyDescriptor(window, 'innerWidth');

function setViewportWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
}

/**
 * A Radix-shaped dialog: `role="dialog"`, `data-state`, and an
 * `aria-labelledby` title nested inside a header block, the way
 * `NavigationOverlay` nests its `SheetTitle` inside its `SheetHeader`.
 */
function mountDialog({ layout, width }: { layout: string; width: number }): HTMLElement {
  const n = mounted.length;
  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('data-state', 'open');
  dialog.setAttribute('aria-labelledby', `probe-title-${n}`);
  dialog.setAttribute('style', layout);
  const header = document.createElement('div');
  const titleColumn = document.createElement('div');
  const title = document.createElement('h2');
  title.id = `probe-title-${n}`;
  title.textContent = 'Product';
  titleColumn.append(title);
  header.append(titleColumn);
  const body = document.createElement('div');
  dialog.append(header, body);
  Object.defineProperty(dialog, 'offsetWidth', { configurable: true, value: width });
  Object.defineProperty(header, 'offsetTop', { configurable: true, value: 0 });
  Object.defineProperty(header, 'offsetHeight', { configurable: true, value: HEADER_HEIGHT });
  document.body.append(dialog);
  mounted.push(dialog);
  return dialog;
}

async function renderWithToast(props: Record<string, unknown> = {}): Promise<HTMLElement> {
  render(
    <ThemeProvider>
      <ConsoleToaster {...props} />
    </ThemeProvider>,
  );
  act(() => {
    toast.success('Product created');
  });
  return waitFor(() => {
    const el = document.querySelector<HTMLElement>('[data-sonner-toaster]');
    expect(el, 'sonner did not mount its toaster region').toBeTruthy();
    return el as HTMLElement;
  });
}

/**
 * The toaster region as it is NOW. Sonner keys its `<ol>` by position, so the
 * move between top-centre (no drawer, objectui#13340) and top-right (a drawer
 * to clear) mounts a new element: a handle taken before the move goes stale.
 */
const region = (): HTMLElement => {
  const el = document.querySelector<HTMLElement>('[data-sonner-toaster]');
  expect(el, 'sonner did not mount its toaster region').toBeTruthy();
  return el as HTMLElement;
};

const offsets = (_toaster?: HTMLElement) => ({
  top: region().style.getPropertyValue('--offset-top'),
  right: region().style.getPropertyValue('--offset-right'),
  mobileTop: region().style.getPropertyValue('--mobile-offset-top'),
});

/**
 * The toaster with no drawer to clear: top-centre, below the console's 48px
 * top bar (objectui#13340); sonner's own offsets on the other sides and on
 * phones.
 */
const DEFAULTS = { top: '56px', right: '24px', mobileTop: '16px' };

afterEach(() => {
  act(() => {
    toast.dismiss();
  });
  cleanup();
  for (const el of mounted.splice(0)) el.remove();
  if (innerWidthDescriptor) Object.defineProperty(window, 'innerWidth', innerWidthDescriptor);
});

describe('ConsoleToaster clears an open right-edge drawer (objectui#11685)', () => {
  it('the control: with no drawer open it sits top-centre, below the top bar', async () => {
    setViewportWidth(1440);
    const toaster = await renderWithToast();
    expect(toaster.getAttribute('data-x-position')).toBe('center');
    expect(toaster.getAttribute('data-y-position')).toBe('top');
    expect(offsets(toaster)).toEqual(DEFAULTS);
  });

  it('moves into the strip left of the drawer when a toast fits there, from the top-right corner', async () => {
    // 1440px window, 864px drawer: 576px of page left of it, room for a 356px toast.
    setViewportWidth(1440);
    const toaster = await renderWithToast();
    mountDialog({ layout: RIGHT_SHEET, width: 864 });
    await waitFor(() => expect(offsets(toaster).right).toBe('888px'));
    expect(offsets(toaster).top).toBe('24px');
    expect(region().getAttribute('data-x-position')).toBe('right');
    expect(region().getAttribute('data-y-position')).toBe('top');
  });

  it('drops below the drawer header when the strip beside it is too narrow', async () => {
    // 1024px window, 720px drawer: 304px left of it, narrower than a toast.
    setViewportWidth(1024);
    const toaster = await renderWithToast();
    mountDialog({ layout: RIGHT_SHEET, width: 720 });
    await waitFor(() => expect(offsets(toaster).top).toBe(`${HEADER_HEIGHT + 24}px`));
    expect(offsets(toaster).right).toBe('24px');
    // Phones: sonner spans the toaster across the viewport, so always below.
    expect(offsets(toaster).mobileTop).toBe(`${HEADER_HEIGHT + 16}px`);
  });

  it('goes back to top-centre when the drawer closes, and when it unmounts', async () => {
    setViewportWidth(1440);
    const toaster = await renderWithToast();
    const drawer = mountDialog({ layout: RIGHT_SHEET, width: 864 });
    await waitFor(() => expect(offsets(toaster).right).toBe('888px'));

    drawer.setAttribute('data-state', 'closed');
    await waitFor(() => expect(offsets(toaster)).toEqual(DEFAULTS));
    expect(region().getAttribute('data-x-position')).toBe('center');

    drawer.setAttribute('data-state', 'open');
    await waitFor(() => expect(offsets(toaster).right).toBe('888px'));

    drawer.remove();
    await waitFor(() => expect(offsets(toaster)).toEqual(DEFAULTS));
  });

  it('ignores dialogs that are not right-edge drawers', async () => {
    setViewportWidth(1440);
    const toaster = await renderWithToast();
    // A centred modal, a left sheet, and a popover (Radix popover content is
    // `role="dialog"` too, positioned by a wrapper rather than fixed itself).
    mountDialog({ layout: 'position: fixed; top: 50%; left: 50%;', width: 512 });
    mountDialog({ layout: 'position: fixed; top: 0px; bottom: 0px; left: 0px; right: 400px;', width: 320 });
    mountDialog({ layout: 'position: relative;', width: 288 });
    // Give the observers a frame to have run, then confirm nothing moved.
    await act(() => new Promise((resolve) => window.requestAnimationFrame(() => resolve(undefined))));
    await act(() => new Promise((resolve) => window.requestAnimationFrame(() => resolve(undefined))));
    expect(offsets(toaster)).toEqual(DEFAULTS);

    // Non-vacuity: the observers were live all along — a right sheet beside
    // those three moves the toaster at once.
    mountDialog({ layout: RIGHT_SHEET, width: 864 });
    await waitFor(() => expect(offsets(toaster).right).toBe('888px'));
  });

  it('a caller`s own `offset` still wins — the spread contract is unchanged', async () => {
    setViewportWidth(1440);
    const toaster = await renderWithToast({ offset: 8 });
    mountDialog({ layout: RIGHT_SHEET, width: 864 });
    await act(() => new Promise((resolve) => window.requestAnimationFrame(() => resolve(undefined))));
    await act(() => new Promise((resolve) => window.requestAnimationFrame(() => resolve(undefined))));
    expect(offsets(toaster).right).toBe('8px');
    expect(offsets(toaster).top).toBe('8px');
  });
});
