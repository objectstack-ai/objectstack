// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * consoleSidebarRail — the docking model of objectstack#36112 (ruling
 * 7069868269): one threshold, 1280 px; with no choice kept a window 1280 px
 * wide and up starts with the sidebar expanded and one from 768 to 1279 px
 * collapsed; the reader's own choice wins on each side, and the two choices
 * are kept apart; a "Keep sidebar open" stored before this change reads as
 * "expanded on a narrow window"; and the switch itself is gone.
 *
 * The starting state is read where the console's first frame takes it
 * (`primeConsoleSidebarOpen`, which writes the sidebar primitive's cookie) and
 * where the layout hands it to a mounted provider (`useResponsiveSidebar`).
 */

import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { SidebarProvider, useSidebar } from '@object-ui/components';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useResponsiveSidebar } from '../../hooks/useResponsiveSidebar';
import {
  CONSOLE_SIDEBAR_RAIL_BELOW_WIDTH,
  primeConsoleSidebarOpen,
  startingSidebarOpen,
  writeWideWindowOpen,
} from '../consoleSidebarRail';

function setViewportWidth(width: number) {
  (window as unknown as { happyDOM: { setViewport: (v: { width: number; height: number }) => void } }).happyDOM.setViewport({
    width,
    height: 900,
  });
}

const sidebarCookie = () => /(?:^|;\s*)sidebar_state=(\w+)/.exec(document.cookie)?.[1];

/** What the first frame of a page load at `width` draws: the cookie the console primes. */
function firstFrameAt(width: number): string | undefined {
  setViewportWidth(width);
  primeConsoleSidebarOpen();
  return sidebarCookie();
}

/**
 * The narrow-window choice exactly as the retired "Keep sidebar open" switch
 * stored it: the workspace preference `console.sidebar.keepOpen`, a v1 switch
 * record. Written raw, so a renamed key or a new record shape reds here.
 */
const KEEP_OPEN_STORAGE_KEY = 'os:pref:console.sidebar.keepOpen';
const storeLegacyKeepOpen = (value: 'on' | 'off') =>
  localStorage.setItem(KEEP_OPEN_STORAGE_KEY, JSON.stringify({ value, v: 1 }));

function Probe() {
  useResponsiveSidebar();
  return <div data-testid="open">{String(useSidebar().open)}</div>;
}

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

describe('the default each window starts in (objectstack#36112, ruling 7069868269)', () => {
  it('the threshold is 1280 px', () => {
    expect(CONSOLE_SIDEBAR_RAIL_BELOW_WIDTH).toBe(1280);
  });

  it('a 1279 px window starts collapsed, a 1280 px one expanded, whatever the last page left in the cookie', () => {
    document.cookie = 'sidebar_state=true; path=/';
    expect(firstFrameAt(1279)).toBe('false');
    document.cookie = 'sidebar_state=false; path=/';
    expect(firstFrameAt(1280)).toBe('true');
    // Both edges of each side.
    expect(firstFrameAt(768)).toBe('false');
    expect(firstFrameAt(1920)).toBe('true');
  });

  it('the mounted layout hands a 1279 px window the collapsed sidebar and a 1280 px one the expanded sidebar', () => {
    setViewportWidth(1279);
    render(
      <SidebarProvider defaultOpen>
        <Probe />
      </SidebarProvider>,
    );
    expect(screen.getByTestId('open')).toHaveTextContent('false');
    // happy-dom's `MediaQueryList` starts tracking at "no match", so a query that
    // matched at mount reports no change on its first resize: a resize at the
    // current width first sets it right (as `UnifiedSidebar.hiddenCollapse-35062`'s `resizeTo`).
    act(() => {
      window.dispatchEvent(new Event('resize'));
      setViewportWidth(1280);
    });
    expect(screen.getByTestId('open')).toHaveTextContent('true');
  });

  it('below 768 px the phone keeps what the cookie says', () => {
    document.cookie = 'sidebar_state=true; path=/';
    expect(firstFrameAt(767)).toBe('true');
  });
});

describe('a choice the reader made wins over the default, on each side (objectstack#36112)', () => {
  it('collapsed on a wide window: a 1280 px window starts collapsed; the narrow side keeps its own default', () => {
    writeWideWindowOpen(false);
    expect(startingSidebarOpen(true)).toBe(false);
    expect(firstFrameAt(1280)).toBe('false');
    expect(firstFrameAt(1279)).toBe('false');
  });

  it('expanded on a narrow window: a 1279 px window starts expanded; the wide side keeps its own choice', () => {
    storeLegacyKeepOpen('on');
    writeWideWindowOpen(false);
    expect(startingSidebarOpen(false)).toBe(true);
    expect(firstFrameAt(1279)).toBe('true');
    expect(firstFrameAt(1280)).toBe('false');
  });

  it('collapsed on a narrow window by choice: a 1279 px window starts collapsed', () => {
    storeLegacyKeepOpen('off');
    expect(firstFrameAt(1279)).toBe('false');
  });
});

describe('a "Keep sidebar open" stored before this change (objectstack#36112)', () => {
  it('reads as "expanded on a narrow window", from the first frame and in the mounted layout', () => {
    storeLegacyKeepOpen('on');
    expect(firstFrameAt(1024)).toBe('true');
    render(
      <SidebarProvider>
        <Probe />
      </SidebarProvider>,
    );
    expect(screen.getByTestId('open')).toHaveTextContent('true');
  });
});
