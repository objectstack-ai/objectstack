// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * useResponsiveSidebar — the sidebar folds to its icon rail on a window
 * narrower than `CONSOLE_SIDEBAR_RAIL_BELOW_WIDTH` and unfolds when it widens
 * (objectstack#27593). The wide window's open state survives the fold, a
 * reader's "keep open" turns the fold off, and the phone drawer is left alone.
 * Only an open or close on a wide window is kept as the wide-window choice
 * (objectstack#28079).
 */

import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SidebarProvider, useSidebar } from '@object-ui/components';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useResponsiveSidebar } from '../useResponsiveSidebar';
import {
  CONSOLE_SIDEBAR_KEEP_OPEN_PREFERENCE,
  readWideWindowOpen,
} from '../../layout/consoleSidebarRail';
import { writeWorkspacePreference } from '../../utils/workspacePreference';

/**
 * Size the test window: happy-dom's own viewport, so `innerWidth`, the
 * `resize` event and every media query answer the same width.
 */
function setViewportWidth(width: number) {
  (window as unknown as { happyDOM: { setViewport: (v: { width: number; height: number }) => void } }).happyDOM.setViewport({
    width,
    height: 900,
  });
}

/** Resize a mounted window; happy-dom dispatches the `resize` its media queries answer. */
function resizeTo(width: number) {
  act(() => {
    setViewportWidth(width);
  });
}

function Harness() {
  useResponsiveSidebar();
  const { open, setOpen, toggleSidebar } = useSidebar();

  return (
    <>
      <div data-testid="sidebar-open">{String(open)}</div>
      <button type="button" onClick={() => setOpen(true)}>
        Expand sidebar
      </button>
      <button type="button" onClick={toggleSidebar}>
        Toggle sidebar
      </button>
    </>
  );
}

function renderAt(width: number) {
  setViewportWidth(width);
  return render(
    <SidebarProvider defaultOpen>
      <Harness />
    </SidebarProvider>,
  );
}

const openState = () => screen.getByTestId('sidebar-open').textContent;

beforeEach(() => {
  localStorage.clear();
  document.cookie = 'sidebar_state=; path=/; max-age=0';
});

afterEach(() => {
  cleanup();
  setViewportWidth(1024);
  localStorage.clear();
  document.cookie = 'sidebar_state=; path=/; max-age=0';
});

describe('useResponsiveSidebar (objectstack#27593)', () => {
  it('folds the sidebar on a 1280 px window and leaves it open on a 1440 px one', () => {
    renderAt(1280);
    expect(openState()).toBe('false');
    cleanup();

    renderAt(1440);
    expect(openState()).toBe('true');
  });

  it('keeps a manual expand on a narrow window (the rail expanded over the content)', () => {
    renderAt(970);
    expect(openState()).toBe('false');

    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }));
    expect(openState()).toBe('true');
  });

  it('hands the wide state back when the window widens, and folds again when it narrows', () => {
    renderAt(1440);
    expect(openState()).toBe('true');

    resizeTo(1280);
    expect(openState()).toBe('false');
    expect(readWideWindowOpen()).toBe(true);

    resizeTo(1440);
    expect(openState()).toBe('true');
    expect(readWideWindowOpen()).toBe(true);
  });

  it('hands back a collapsed wide state as collapsed', () => {
    renderAt(1440);
    fireEvent.click(screen.getByRole('button', { name: 'Toggle sidebar' }));
    expect(openState()).toBe('false');

    resizeTo(1280);
    // The reader expands the rail over the content on the narrow window…
    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }));
    expect(openState()).toBe('true');

    // …and the wide window gets back the state the reader left it in.
    resizeTo(1440);
    expect(openState()).toBe('false');
  });

  it('a load that opens wide after a narrow one gets the wide state back, not the fold', () => {
    renderAt(1280);
    expect(openState()).toBe('false');
    cleanup();

    // The primitive's cookie recorded the fold; the wide-window choice is kept apart.
    renderAt(1440);
    expect(openState()).toBe('true');
    expect(readWideWindowOpen()).toBe(true);
  });

  it('"keep open" turns the fold off: a narrow window keeps the sidebar open', () => {
    writeWorkspacePreference(CONSOLE_SIDEBAR_KEEP_OPEN_PREFERENCE, 'user', 'on');
    renderAt(1280);
    expect(openState()).toBe('true');
    expect(readWideWindowOpen()).toBeUndefined();
  });

  it('leaves the open state alone below the phone breakpoint, where the drawer takes over', () => {
    renderAt(700);
    expect(openState()).toBe('true');
    expect(readWideWindowOpen()).toBeUndefined();
  });
});
