// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * consoleSidebarRail — the fold width is derived from what covers the content
 * and from the sidebar it folds (objectstack#27593, re-derived on
 * objectstack#29109 once the split pane retired). `CONSOLE_EXPANDED_SIDEBAR_WIDTH`
 * restates the sidebar primitive's `--sidebar-width` and `RECORD_DRAWER_WIDTH`
 * restates plugin-view's default drawer width, so this reads both off their
 * owners and holds them equal: a wider or narrower sidebar or drawer moves the
 * fold width with it, or this goes red.
 */

import '@testing-library/jest-dom/vitest';
import { render } from '@testing-library/react';
import { SidebarProvider } from '@object-ui/components';
import { overlayWidthFor } from '@object-ui/plugin-view';
import { describe, expect, it } from 'vitest';
import {
  CONSOLE_EXPANDED_SIDEBAR_WIDTH,
  CONSOLE_SIDEBAR_RAIL_BELOW_WIDTH,
  LIST_MIN_COLUMNS_WIDTH,
  RECORD_DRAWER_MIN_CONTENT_WIDTH,
  RECORD_DRAWER_WIDTH,
} from '../consoleSidebarRail';

/** A CSS length in px: `rem` against the 16 px root the console renders at. */
function toPx(length: string): number {
  const match = /^([\d.]+)(rem|px)$/.exec(length.trim());
  expect(match, `a rem or px length, got "${length}"`).not.toBeNull();
  const value = Number(match![1]);
  return match![2] === 'rem' ? value * 16 : value;
}

/** The sidebar primitive's expanded and rail widths, read off a mounted provider. */
function primitiveSidebarWidths(): { expanded: number; rail: number } {
  const { container } = render(
    <SidebarProvider>
      <div />
    </SidebarProvider>,
  );
  const wrapper = container.firstElementChild as HTMLElement;
  return {
    expanded: toPx(wrapper.style.getPropertyValue('--sidebar-width')),
    rail: toPx(wrapper.style.getPropertyValue('--sidebar-width-icon')),
  };
}

/** The list left beside the open drawer in a window `width` px wide, the sidebar `sidebar` px wide. */
function listBesideDrawer(width: number, sidebar: number): number {
  return width - sidebar - RECORD_DRAWER_WIDTH;
}

describe('the console sidebar fold width (objectstack#27593, #29109)', () => {
  it('restates the primitive’s expanded sidebar width', () => {
    expect(primitiveSidebarWidths().expanded).toBe(CONSOLE_EXPANDED_SIDEBAR_WIDTH);
  });

  it('restates the drawer a list record opens in (plugin-view’s md bucket)', () => {
    // `min(92vw, 720px)`: the px term is the drawer's width on any window the fold applies to.
    const match = /^min\(92vw, (\d+)px\)$/.exec(overlayWidthFor('md', {}));
    expect(match, 'overlayWidthFor answers min(92vw, Npx)').not.toBeNull();
    expect(Number(match![1])).toBe(RECORD_DRAWER_WIDTH);
  });

  it('is the drawer beside the narrowest list that draws its columns, plus the expanded sidebar', () => {
    expect(RECORD_DRAWER_MIN_CONTENT_WIDTH).toBe(LIST_MIN_COLUMNS_WIDTH + RECORD_DRAWER_WIDTH);
    expect(CONSOLE_SIDEBAR_RAIL_BELOW_WIDTH).toBe(RECORD_DRAWER_MIN_CONTENT_WIDTH + CONSOLE_EXPANDED_SIDEBAR_WIDTH);
    // The value the maintainer kept when the split pane retired: 440 + 720 + 256.
    expect(CONSOLE_SIDEBAR_RAIL_BELOW_WIDTH).toBe(1416);
    // At the threshold the expanded sidebar leaves exactly the list's floor beside the drawer.
    expect(listBesideDrawer(CONSOLE_SIDEBAR_RAIL_BELOW_WIDTH, CONSOLE_EXPANDED_SIDEBAR_WIDTH)).toBe(
      LIST_MIN_COLUMNS_WIDTH,
    );
  });

  it('folds a 1280 px and a 1366 px window, whose rail leaves the list its columns beside the drawer', () => {
    const { expanded, rail } = primitiveSidebarWidths();
    for (const width of [1280, 1366]) {
      expect(width).toBeLessThan(CONSOLE_SIDEBAR_RAIL_BELOW_WIDTH);
      expect(listBesideDrawer(width, expanded)).toBeLessThan(LIST_MIN_COLUMNS_WIDTH);
      expect(listBesideDrawer(width, rail)).toBeGreaterThanOrEqual(LIST_MIN_COLUMNS_WIDTH);
    }
  });

  it('leaves a 1440 px window’s sidebar expanded', () => {
    expect(1440).toBeGreaterThanOrEqual(CONSOLE_SIDEBAR_RAIL_BELOW_WIDTH);
    expect(listBesideDrawer(1440, CONSOLE_EXPANDED_SIDEBAR_WIDTH)).toBeGreaterThanOrEqual(LIST_MIN_COLUMNS_WIDTH);
  });
});
