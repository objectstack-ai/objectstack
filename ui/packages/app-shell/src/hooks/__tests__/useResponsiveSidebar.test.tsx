// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * useResponsiveSidebar — a window starts in the reader's choice for its side
 * of `CONSOLE_SIDEBAR_RAIL_BELOW_WIDTH` (1280 px), else expanded on a wide
 * window and collapsed on a narrow one (objectstack#27593, ruling 7069868269
 * on objectstack#36112). The two choices are kept apart: an open or close on a
 * wide window is the wide-window choice (objectstack#28079), a close of the
 * docked sidebar on a narrow window the narrow-window choice; the phone drawer
 * is left alone.
 */

import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SidebarProvider, useSidebar } from '@object-ui/components';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useResponsiveSidebar } from '../useResponsiveSidebar';
import {
  CONSOLE_SIDEBAR_NARROW_OPEN_PREFERENCE,
  readWideWindowOpen,
} from '../../layout/consoleSidebarRail';
import { readWorkspacePreference, writeWorkspacePreference } from '../../utils/workspacePreference';

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

const narrowChoice = () => readWorkspacePreference(CONSOLE_SIDEBAR_NARROW_OPEN_PREFERENCE, 'user');

describe('useResponsiveSidebar (objectstack#27593, objectstack#36112)', () => {
  it('starts collapsed on a 1279 px window and expanded on a 1280 px one', () => {
    renderAt(1279);
    expect(openState()).toBe('false');
    cleanup();

    renderAt(1280);
    expect(openState()).toBe('true');
  });

  it('a state it gives a window is not a choice: nothing is kept until the reader toggles', () => {
    renderAt(1440);
    resizeTo(1024);
    resizeTo(1440);
    expect(readWideWindowOpen()).toBeUndefined();
    expect(narrowChoice()).toBeUndefined();
  });

  it('hands each side its own state as the window crosses the threshold', () => {
    renderAt(1440);
    expect(openState()).toBe('true');

    resizeTo(1279);
    expect(openState()).toBe('false');

    resizeTo(1280);
    expect(openState()).toBe('true');
  });

  it('keeps a collapse on a wide window, and gives it back when the window widens again', () => {
    renderAt(1440);
    fireEvent.click(screen.getByRole('button', { name: 'Toggle sidebar' }));
    expect(openState()).toBe('false');
    expect(readWideWindowOpen()).toBe(false);

    resizeTo(1024);
    expect(openState()).toBe('false');
    resizeTo(1440);
    expect(openState()).toBe('false');
  });

  it('keeps a collapse of the docked sidebar on a narrow window as the narrow-window choice', () => {
    writeWorkspacePreference(CONSOLE_SIDEBAR_NARROW_OPEN_PREFERENCE, 'user', 'on');
    renderAt(1024);
    expect(openState()).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Toggle sidebar' }));
    expect(openState()).toBe('false');
    expect(narrowChoice()).toBe('off');
    // The wide-window choice is not touched.
    expect(readWideWindowOpen()).toBeUndefined();
  });

  it('a narrow-window choice turned collapsed elsewhere collapses an open sidebar', () => {
    writeWorkspacePreference(CONSOLE_SIDEBAR_NARROW_OPEN_PREFERENCE, 'user', 'on');
    renderAt(1024);
    expect(openState()).toBe('true');

    act(() => {
      writeWorkspacePreference(CONSOLE_SIDEBAR_NARROW_OPEN_PREFERENCE, 'user', 'off');
    });
    expect(openState()).toBe('false');
  });

  it('leaves the open state alone below the phone breakpoint, where the drawer takes over', () => {
    renderAt(700);
    expect(openState()).toBe('true');
    expect(readWideWindowOpen()).toBeUndefined();
    expect(narrowChoice()).toBeUndefined();
  });
});
