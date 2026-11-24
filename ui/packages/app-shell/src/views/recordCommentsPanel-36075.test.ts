// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36075, item 4 — where the comment panel is drawn on the record
 * page: beside the record from a 1280 window (the record gives way 380), over
 * its right edge below that. A drawer or pane draws no panel
 * (objectstack#36225), so the page's window is the only width asked.
 */

import { describe, it, expect } from 'vitest';
import { COMMENTS_PANEL_BESIDE_MIN_WINDOW, COMMENTS_PANEL_WIDTH, commentsPanelPlacement } from './recordCommentsPanel';

describe('commentsPanelPlacement', () => {
  it('the page: beside from a 1280 window, over below it', () => {
    expect(COMMENTS_PANEL_WIDTH).toBe(380);
    expect(COMMENTS_PANEL_BESIDE_MIN_WINDOW).toBe(1280);
    expect(commentsPanelPlacement(1280)).toBe('beside');
    expect(commentsPanelPlacement(1279)).toBe('over');
  });
});
