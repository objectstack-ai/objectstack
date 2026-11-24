/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import { resizedSpan } from './designAffordances';

/**
 * objectstack#36372 — a corner drag snaps to whole grid tracks: each axis
 * moves by the drag over one track's pitch (the card's size plus the gap,
 * over its span), rounded.
 */
describe('resizedSpan', () => {
  // A 2×1 card, 200×80 px, in a grid with a 16 px gap: one column is 108 px
  // of pitch, one row 96 px.
  const start = { w: 2, h: 1 };
  const box = { width: 200, height: 80 };

  it('keeps the span under half a track', () => {
    expect(resizedSpan(start, box, 16, { dx: 50, dy: 40 }, 4)).toEqual({ w: 2, h: 1 });
  });

  it('adds a track once the pointer crosses half of one', () => {
    expect(resizedSpan(start, box, 16, { dx: 60, dy: 50 }, 4)).toEqual({ w: 3, h: 2 });
  });

  it('shrinks by a dragged-back track, never under one', () => {
    expect(resizedSpan(start, box, 16, { dx: -110, dy: 0 }, 4)).toEqual({ w: 1, h: 1 });
    expect(resizedSpan(start, box, 16, { dx: -900, dy: -900 }, 4)).toEqual({ w: 1, h: 1 });
  });

  it('never grows past the grid\'s columns', () => {
    expect(resizedSpan(start, box, 16, { dx: 900, dy: 0 }, 4)).toEqual({ w: 4, h: 1 });
  });

  it('moves nothing for a box it could not measure', () => {
    expect(resizedSpan(start, { width: 0, height: 0 }, 0, { dx: 300, dy: 300 }, 4)).toEqual(start);
  });
});
