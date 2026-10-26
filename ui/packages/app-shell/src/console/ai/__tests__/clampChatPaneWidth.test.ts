import { describe, expect, it } from 'vitest';
import { clampChatPaneWidth } from '../AiChatPage';

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
