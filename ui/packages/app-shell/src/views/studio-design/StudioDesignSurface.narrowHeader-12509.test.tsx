// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12509, objectstack#36899 — the Studio shell header on a narrow
 * window.
 *
 * objectui#12509 measured a 558 px window where the one 48 px row put the
 * pillar switcher's Access segment under Changes and clipped Publish, and gave
 * the switcher a second row below 640 px. objectstack#36899 moved navigation
 * out of the header into the left menu (a drawer below 768 px), so the header
 * holds two things at every width: the menu toggle with 「‹ Back to app」 and
 * the package name on the left, the package actions on the right. It is one
 * 48 px row of two columns: the left one shrinks to nothing (the name
 * truncates), the right one never drops below its content, so nothing sits
 * under anything.
 *
 * jsdom has no layout, so the pin reads the Tailwind classes of the token. The
 * wide / narrow / collapsed screenshots in the PR are the layout evidence.
 */

import { describe, expect, it } from 'vitest';
import { STUDIO_HEADER } from './studio-tokens';

describe('Studio shell header at every width (objectui#12509, objectstack#36899)', () => {
  it('is one 48 px row of two columns: a left column that shrinks, a right column that never drops below its content', () => {
    const classes = STUDIO_HEADER.split(/\s+/).filter(Boolean);
    expect(classes).toEqual(expect.arrayContaining(['grid', 'h-12', 'shrink-0', 'items-center', 'grid-cols-[minmax(0,1fr)_auto]']));
    // No breakpoint re-lays it out: the switcher's second row is gone.
    expect(classes.filter((c) => /^[a-z0-9]+:/.test(c) && !c.startsWith('@container'))).toEqual([]);
  });
});
