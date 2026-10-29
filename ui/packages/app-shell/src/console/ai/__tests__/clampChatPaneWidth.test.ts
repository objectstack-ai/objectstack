import { describe, expect, it } from 'vitest';
import { clampChatPaneWidth, isTooNarrowForSplit } from '../AiChatPage';

const opts = (containerWidth: number) => ({ min: 360, previewMin: 420, containerWidth });

describe('clampChatPaneWidth', () => {
  it('floors at the minimum chat width', () => {
    expect(clampChatPaneWidth(200, opts(1200))).toBe(360);
  });

  it('caps so the preview keeps its minimum room', () => {
    // container 1200 - previewMin 420 = 780 max
    expect(clampChatPaneWidth(1000, opts(1200))).toBe(780);
  });

  it('leaves an in-range width untouched', () => {
    expect(clampChatPaneWidth(560, opts(1200))).toBe(560);
  });

  it('never lets the cap fall below the minimum on a tiny container', () => {
    // 600 - 420 = 180 < min 360 → min wins
    expect(clampChatPaneWidth(500, opts(600))).toBe(360);
  });

  it('applies only the floor when the container is unmeasured (0)', () => {
    expect(clampChatPaneWidth(5000, opts(0))).toBe(5000);
    expect(clampChatPaneWidth(100, opts(0))).toBe(360);
  });
});

// objectstack#27420 — below the two minimums together (360 + 420) the pane
// previews the way a phone does instead of overflowing.
describe('isTooNarrowForSplit', () => {
  it('is narrow below the chat and preview minimums together', () => {
    expect(isTooNarrowForSplit(779)).toBe(true);
    expect(isTooNarrowForSplit(300)).toBe(true);
  });

  it('keeps the split at and above them', () => {
    expect(isTooNarrowForSplit(780)).toBe(false);
    expect(isTooNarrowForSplit(1200)).toBe(false);
  });

  it('treats an unmeasured container (0) as wide enough', () => {
    expect(isTooNarrowForSplit(0)).toBe(false);
  });
});
