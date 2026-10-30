// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * consoleSidebarRail — the fold width is derived from the sidebar it folds
 * (objectstack#27593). `CONSOLE_EXPANDED_SIDEBAR_WIDTH` restates the sidebar
 * primitive's `--sidebar-width`, so this reads the primitive's value off a
 * mounted provider and holds the two equal: a wider or narrower sidebar moves
 * the fold width with it, or this goes red.
 */

import '@testing-library/jest-dom/vitest';
import { render } from '@testing-library/react';
import { SidebarProvider } from '@object-ui/components';
import { describe, expect, it } from 'vitest';
import {
  CONSOLE_EXPANDED_SIDEBAR_WIDTH,
  CONSOLE_SIDEBAR_RAIL_BELOW_WIDTH,
  RECORD_SPLIT_MIN_CONTENT_WIDTH,
} from '../consoleSidebarRail';

/** A CSS length in px: `rem` against the 16 px root the console renders at. */
function toPx(length: string): number {
  const match = /^([\d.]+)(rem|px)$/.exec(length.trim());
  expect(match, `a rem or px length, got "${length}"`).not.toBeNull();
  const value = Number(match![1]);
  return match![2] === 'rem' ? value * 16 : value;
}

describe('the console sidebar fold width (objectstack#27593)', () => {
  it('restates the primitive’s expanded sidebar width', () => {
    const { container } = render(
      <SidebarProvider>
        <div />
      </SidebarProvider>,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    const primitiveWidth = wrapper.style.getPropertyValue('--sidebar-width');
    expect(toPx(primitiveWidth)).toBe(CONSOLE_EXPANDED_SIDEBAR_WIDTH);
  });

  it('is the split’s content beside the expanded sidebar', () => {
    expect(CONSOLE_SIDEBAR_RAIL_BELOW_WIDTH).toBe(RECORD_SPLIT_MIN_CONTENT_WIDTH + CONSOLE_EXPANDED_SIDEBAR_WIDTH);
  });

  it('folds a 1280 px window and leaves a 1440 px one alone, as the card accepts', () => {
    expect(1280).toBeLessThan(CONSOLE_SIDEBAR_RAIL_BELOW_WIDTH);
    expect(1440).toBeGreaterThanOrEqual(CONSOLE_SIDEBAR_RAIL_BELOW_WIDTH);
  });
});
