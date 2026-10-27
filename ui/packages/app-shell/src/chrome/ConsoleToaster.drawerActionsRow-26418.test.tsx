/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#26418 — on a window too narrow for a toast beside the record
 * drawer (1024px window, 720px drawer), the success toast cleared only the
 * drawer's own header and landed on the record's Edit and ⋯ buttons right
 * under it, for its whole 4s life.
 *
 * The fallback now drops below the drawer's first row of controls too. This
 * file pins that: in the card's case the toast's rect stays off the actions
 * row; the wide-window case keeps objectui#11685's beside-the-drawer
 * placement; a row that renders after the drawer opens still moves the toast;
 * and controls that are not a header row (hidden, or down in the drawer's
 * lower half) do not.
 *
 * ⚠️ As in `ConsoleToaster.drawerClearance-11685`, happy-dom has no layout
 * engine: every size here is assigned, not measured. The numbers are the
 * card's Chromium reading of the record drawer at 1024×768: drawer header
 * 0–45, Edit at 93–129, toast 54px tall.
 */
import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, act, cleanup, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import { ConsoleToaster } from './ConsoleToaster.js';
import { ThemeProvider } from './ThemeProvider.js';

const VIEWPORT_HEIGHT = 768;
const DRAWER_HEADER_HEIGHT = 45;
/** The record's actions row (Edit, ⋯), as the card measured it. */
const ACTIONS_ROW = { top: 93, bottom: 129 };
/** sonner's toast width, and the toast height the card measured. */
const TOAST = { width: 356, height: 54 };

const RIGHT_SHEET = 'position: fixed; top: 0px; right: 0px; bottom: 0px;';

const mounted: HTMLElement[] = [];
const innerWidthDescriptor = Object.getOwnPropertyDescriptor(window, 'innerWidth');

function setViewportWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
}

function layout(el: HTMLElement, box: { offsetParent?: Element | null; offsetTop?: number; offsetHeight?: number }) {
  for (const [key, value] of Object.entries(box)) Object.defineProperty(el, key, { configurable: true, value });
}

/**
 * A right-edge drawer shaped like `NavigationOverlay`'s: a header block holding
 * the `aria-labelledby` title and the expand/close buttons, then a scrolling
 * body. The drawer is fixed, so it is every descendant's `offsetParent`.
 */
function mountDrawer(width: number): { drawer: HTMLElement; body: HTMLElement } {
  const n = mounted.length;
  const drawer = document.createElement('div');
  drawer.setAttribute('role', 'dialog');
  drawer.setAttribute('data-state', 'open');
  drawer.setAttribute('aria-labelledby', `drawer-title-${n}`);
  drawer.setAttribute('style', RIGHT_SHEET);
  const header = document.createElement('div');
  const title = document.createElement('h2');
  title.id = `drawer-title-${n}`;
  title.textContent = 'Project';
  const close = document.createElement('button');
  close.textContent = 'Close';
  header.append(title, close);
  const body = document.createElement('div');
  drawer.append(header, body);
  layout(drawer, { offsetHeight: VIEWPORT_HEIGHT });
  Object.defineProperty(drawer, 'offsetWidth', { configurable: true, value: width });
  layout(header, { offsetTop: 0, offsetHeight: DRAWER_HEADER_HEIGHT });
  layout(close, { offsetParent: drawer, offsetTop: 8, offsetHeight: 28 });
  document.body.append(drawer);
  mounted.push(drawer);
  return { drawer, body };
}

/**
 * The record's own header inside the drawer body: the title row with its
 * small star button, and the actions row with Edit and ⋯, taller, beside it.
 */
function appendRecordHeader(drawer: HTMLElement, body: HTMLElement) {
  const recordHeader = document.createElement('div');
  const star = document.createElement('button');
  star.setAttribute('aria-label', 'Add to favorites');
  const edit = document.createElement('button');
  edit.textContent = 'Edit';
  const more = document.createElement('button');
  more.setAttribute('aria-label', 'More');
  recordHeader.append(star, edit, more);
  layout(star, { offsetParent: drawer, offsetTop: 97, offsetHeight: 24 });
  layout(edit, { offsetParent: drawer, offsetTop: ACTIONS_ROW.top, offsetHeight: ACTIONS_ROW.bottom - ACTIONS_ROW.top });
  layout(more, { offsetParent: drawer, offsetTop: ACTIONS_ROW.top, offsetHeight: ACTIONS_ROW.bottom - ACTIONS_ROW.top });
  body.append(recordHeader);
}

async function renderWithToast(): Promise<void> {
  render(
    <ThemeProvider>
      <ConsoleToaster />
    </ThemeProvider>,
  );
  act(() => {
    toast.success('Project created');
  });
  await waitFor(() => expect(document.querySelector('[data-sonner-toaster]')).toBeTruthy());
}

const region = (): HTMLElement => {
  const el = document.querySelector<HTMLElement>('[data-sonner-toaster]');
  expect(el, 'sonner did not mount its toaster region').toBeTruthy();
  return el as HTMLElement;
};

const px = (name: string) => parseFloat(region().style.getPropertyValue(name));

/** The front toast's rect, from the top-right toaster's offsets. */
function toastRect() {
  const right = window.innerWidth - px('--offset-right');
  const top = px('--offset-top');
  return { left: right - TOAST.width, right, top, bottom: top + TOAST.height };
}

/** The actions row's rect: Edit and ⋯ sit at the drawer's right edge, inside its 16px padding. */
function actionsRowRect() {
  const right = window.innerWidth - 16;
  return { left: right - 160, right, ...ACTIONS_ROW };
}

const intersects = (a: ReturnType<typeof toastRect>, b: ReturnType<typeof actionsRowRect>) =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

afterEach(() => {
  act(() => {
    toast.dismiss();
  });
  cleanup();
  for (const el of mounted.splice(0)) el.remove();
  if (innerWidthDescriptor) Object.defineProperty(window, 'innerWidth', innerWidthDescriptor);
});

describe('ConsoleToaster clears the record header actions in a narrow window (objectstack#26418)', () => {
  it('1024px window, 720px drawer: the toast stays off the Edit / ⋯ row', async () => {
    setViewportWidth(1024);
    await renderWithToast();
    const { drawer, body } = mountDrawer(720);
    appendRecordHeader(drawer, body);
    await waitFor(() => expect(region().getAttribute('data-x-position')).toBe('right'));
    await waitFor(() => expect(px('--offset-top')).toBe(ACTIONS_ROW.bottom + 24));
    expect(intersects(toastRect(), actionsRowRect())).toBe(false);
    // Phones span the toaster across the window: it drops below the row too.
    expect(px('--mobile-offset-top')).toBe(ACTIONS_ROW.bottom + 16);
  });

  it('the control: a wide window keeps the toast in the strip beside the drawer', async () => {
    setViewportWidth(1440);
    await renderWithToast();
    const { drawer, body } = mountDrawer(864);
    appendRecordHeader(drawer, body);
    await waitFor(() => expect(px('--offset-right')).toBe(888));
    expect(px('--offset-top')).toBe(24);
    expect(toastRect().right).toBeLessThanOrEqual(1440 - 864);
  });

  it('a record header that renders after the drawer opens still moves the toast', async () => {
    setViewportWidth(1024);
    await renderWithToast();
    const { drawer, body } = mountDrawer(720);
    // Only the drawer's header so far: the toast sits just below it.
    await waitFor(() => expect(px('--offset-top')).toBe(DRAWER_HEADER_HEIGHT + 24));
    appendRecordHeader(drawer, body);
    await waitFor(() => expect(px('--offset-top')).toBe(ACTIONS_ROW.bottom + 24));
  });

  it('a hidden control or one in the drawer`s lower half is not a header row', async () => {
    setViewportWidth(1024);
    await renderWithToast();
    const { drawer, body } = mountDrawer(720);
    const hidden = document.createElement('button');
    layout(hidden, { offsetParent: null, offsetTop: 0, offsetHeight: 0 });
    const footer = document.createElement('button');
    layout(footer, { offsetParent: drawer, offsetTop: VIEWPORT_HEIGHT - 60, offsetHeight: 36 });
    body.append(hidden, footer);
    await waitFor(() => expect(px('--offset-top')).toBe(DRAWER_HEADER_HEIGHT + 24));
    // Non-vacuity: the same drawer with a real header row moves the toast.
    appendRecordHeader(drawer, body);
    await waitFor(() => expect(px('--offset-top')).toBe(ACTIONS_ROW.bottom + 24));
  });
});
