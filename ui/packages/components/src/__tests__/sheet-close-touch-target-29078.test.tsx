/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#29078 — a Sheet's Close button is a 44 px touch target at phone
 * width.
 *
 * Measured on a real Console at 375 and 390 px (the dashboard drill drawer),
 * the Close button was its 16 px glyph and nothing more, under the 44 px floor
 * the #29040 phone-width audit holds every control to. Every Sheet draws this
 * one button, so the floor lives here. jsdom has no layout, so it is pinned as
 * drawn: a 44 px box below `sm`, and from `sm` up the class list the desktop
 * had before, unchanged.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '../ui/sheet';

afterEach(() => cleanup());

describe('#29078 — the Sheet Close button on a phone', () => {
  it('is a 44 px box below sm and keeps its desktop placement from sm up', () => {
    render(
      <Sheet open>
        <SheetContent>
          <SheetTitle>Fabrikam</SheetTitle>
          <SheetDescription>Drill drawer</SheetDescription>
        </SheetContent>
      </Sheet>,
    );
    const close = screen.getByRole('button', { name: 'Close' });
    const cls = close.className.split(/\s+/);
    for (const c of ['max-sm:size-11', 'max-sm:flex', 'max-sm:items-center', 'max-sm:justify-center', 'max-sm:right-1', 'max-sm:top-1']) {
      expect(cls).toContain(c);
    }
    // Desktop: unprefixed placement as before.
    expect(cls).toContain('right-4');
    expect(cls).toContain('top-4');
    // The glyph itself stays 16 px.
    expect(close.querySelector('svg')?.getAttribute('class')).toContain('h-4 w-4');
  });
});
