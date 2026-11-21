// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36075, item 4 — where the comment panel is drawn: beside the
 * record from a 1280 window (the record gives way 380), over its right edge
 * below that; inside a drawer, beside the record from a 760 drawer body
 * (the record keeps at least the panel's width), over the whole body below.
 */

import { describe, it, expect } from 'vitest';
import {
  COMMENTS_PANEL_BESIDE_MIN_WINDOW,
  COMMENTS_PANEL_DRAWER_SPLIT_MIN_WIDTH,
  COMMENTS_PANEL_WIDTH,
  commentsPanelPlacement,
} from './recordCommentsPanel';

describe('commentsPanelPlacement', () => {
  it('the page: beside from a 1280 window, over below it', () => {
    expect(COMMENTS_PANEL_WIDTH).toBe(380);
    expect(COMMENTS_PANEL_BESIDE_MIN_WINDOW).toBe(1280);
    expect(commentsPanelPlacement({ embedded: false, windowWidth: 1280, hostWidth: 0 })).toBe('beside');
    expect(commentsPanelPlacement({ embedded: false, windowWidth: 1279, hostWidth: 2000 })).toBe('over');
  });

  it('the drawer: beside from a 760 body, a cover of the body below it (the default 720 drawer)', () => {
    expect(COMMENTS_PANEL_DRAWER_SPLIT_MIN_WIDTH).toBe(760);
    expect(commentsPanelPlacement({ embedded: true, windowWidth: 1920, hostWidth: 760 })).toBe('beside');
    expect(commentsPanelPlacement({ embedded: true, windowWidth: 1920, hostWidth: 720 })).toBe('cover');
  });
});
