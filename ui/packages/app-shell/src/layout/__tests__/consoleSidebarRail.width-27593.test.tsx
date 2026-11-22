// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * consoleSidebarRail — the threshold and what it costs (objectstack#27593,
 * objectstack#29109, objectstack#36112). The threshold was derived from the
 * record drawer, the list beside it and the expanded sidebar (1416 px); the
 * ruling on objectstack#36112 (7069868269) moved it to 1280 px and accepted
 * the cost. `CONSOLE_EXPANDED_SIDEBAR_WIDTH` restates the sidebar primitive's
 * `--sidebar-width` (fixed at 256, objectstack#36112 F2) and
 * `RECORD_DRAWER_WIDTH` the side preview's default width (objectstack#36149),
 * so this reads both off their owners and holds them equal, and the cost the
 * code pays is the one stated beside the threshold.
 */

import '@testing-library/jest-dom/vitest';
import { render } from '@testing-library/react';
import { SidebarProvider } from '@object-ui/components';
import { RECORD_PREVIEW_DEFAULT_WIDTH } from '../../views/recordDrawerContext';
import { describe, expect, it } from 'vitest';
import {
  CONSOLE_EXPANDED_SIDEBAR_WIDTH,
  CONSOLE_SIDEBAR_RAIL_BELOW_WIDTH,
  LIST_MIN_COLUMNS_WIDTH,
  RECORD_DRAWER_WIDTH,
} from '../consoleSidebarRail';

/** A CSS length in px: `rem` against the 16 px root the console renders at. */
function toPx(length: string): number {
  const match = /^([\d.]+)(rem|px)$/.exec(length.trim());
  expect(match, `a rem or px length, got "${length}"`).not.toBeNull();
  const value = Number(match![1]);
  return match![2] === 'rem' ? value * 16 : value;
}

/** The sidebar primitive's expanded width, read off a mounted provider. */
function primitiveSidebarWidths(): { expanded: number } {
  const { container } = render(
    <SidebarProvider>
      <div />
    </SidebarProvider>,
  );
  const wrapper = container.firstElementChild as HTMLElement;
  return {
    expanded: toPx(wrapper.style.getPropertyValue('--sidebar-width')),
  };
}

/** The list left beside the open drawer in a window `width` px wide, the sidebar `sidebar` px wide. */
function listBesideDrawer(width: number, sidebar: number): number {
  return width - sidebar - RECORD_DRAWER_WIDTH;
}

describe('the console sidebar threshold (objectstack#27593, #29109, #36112)', () => {
  it('restates the primitive’s expanded sidebar width, fixed at 256', () => {
    expect(primitiveSidebarWidths().expanded).toBe(CONSOLE_EXPANDED_SIDEBAR_WIDTH);
    expect(CONSOLE_EXPANDED_SIDEBAR_WIDTH).toBe(256);
  });

  it('restates the drawer a list record opens in (the side preview’s default, objectstack#36149)', () => {
    // `min(92vw, 460px)`: the px term is the drawer's width on any desktop window.
    const match = /^min\(92vw, (\d+)px\)$/.exec(RECORD_PREVIEW_DEFAULT_WIDTH);
    expect(match, 'the default answers min(92vw, Npx)').not.toBeNull();
    expect(Number(match![1])).toBe(RECORD_DRAWER_WIDTH);
  });

  it('is 1280 px, the ruling’s number (7069868269)', () => {
    expect(CONSOLE_SIDEBAR_RAIL_BELOW_WIDTH).toBe(1280);
  });

  it('at 1280 px the expanded sidebar leaves the list 564 px beside the 460 px preview, the collapsed one 820: the cost the ruling accepted at 720 is gone', () => {
    const { expanded } = primitiveSidebarWidths();
    expect(listBesideDrawer(CONSOLE_SIDEBAR_RAIL_BELOW_WIDTH, expanded)).toBe(564);
    expect(listBesideDrawer(CONSOLE_SIDEBAR_RAIL_BELOW_WIDTH, expanded)).toBeGreaterThanOrEqual(LIST_MIN_COLUMNS_WIDTH);
    // Collapsed, the sidebar is hidden and takes no width (objectstack#35062).
    expect(listBesideDrawer(CONSOLE_SIDEBAR_RAIL_BELOW_WIDTH, 0)).toBe(820);
  });

  it('a 1440 px window’s expanded sidebar still leaves the list its columns beside the drawer', () => {
    expect(listBesideDrawer(1440, CONSOLE_EXPANDED_SIDEBAR_WIDTH)).toBeGreaterThanOrEqual(LIST_MIN_COLUMNS_WIDTH);
  });
});
