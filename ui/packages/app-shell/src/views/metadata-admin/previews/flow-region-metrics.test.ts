// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  predictRegionsHeight,
  predictExpandedNodeHeight,
  REGION_BLOCK_BORDER,
  REGION_BLOCK_PAD,
  REGION_LABEL_H,
  REGION_GAP,
  NODE_REGION_GAP,
  REGION_PANEL_BORDER,
  REGION_PANEL_PAD,
  EXPANDED_REGION_MAX_W,
} from './flow-region-metrics';
import { NODE_W, NODE_H, H_GAP, PADDING, type LabeledRegion } from './flow-canvas-layout';

/** A 1-node region: mini-canvas is (NODE_W + 2·PADDING) × (NODE_H + 2·PADDING). */
const oneNode = (label?: string): LabeledRegion => ({
  key: label ?? 'body',
  label,
  nodes: [{ id: 'x', type: 'http' }],
  edges: [],
});

const INNER_W = NODE_W + 2 * PADDING; // 1-node region canvas width  (296)
const INNER_H = NODE_H + 2 * PADDING; // 1-node region canvas height (122)
const BLOCK_CHROME = 2 * (REGION_BLOCK_BORDER + REGION_BLOCK_PAD);
const PANEL_CHROME = NODE_REGION_GAP + 2 * (REGION_PANEL_BORDER + REGION_PANEL_PAD);

describe('predictExpandedNodeHeight (#2670 — the layout/renderer contract)', () => {
  it('is NODE_H for a node with no regions (plain / collapsed card)', () => {
    expect(predictExpandedNodeHeight([])).toBe(NODE_H);
  });

  it('predicts a single unlabeled loop body exactly (scaled to fit width)', () => {
    const scaledH = INNER_H * (EXPANDED_REGION_MAX_W / INNER_W); // downscaled, no label row
    const expected = NODE_H + PANEL_CHROME + BLOCK_CHROME + scaledH;
    expect(predictExpandedNodeHeight([oneNode()])).toBeCloseTo(expected, 6);
    expect(expected).toBeCloseTo(187.38, 1); // human-scale sanity: ≈187px card
    expect(expected).toBeGreaterThan(NODE_H);
  });

  it('adds a label row and a gap per extra labeled region (two branches)', () => {
    const single = predictRegionsHeight([oneNode()], EXPANDED_REGION_MAX_W);
    const two = predictRegionsHeight([oneNode('Branch 1'), oneNode('Branch 2')], EXPANDED_REGION_MAX_W);
    expect(two).toBeCloseTo(2 * (single + REGION_LABEL_H) + REGION_GAP, 6);
  });
});

describe('predictRegionsHeight — scaling', () => {
  it('never upscales: at a huge maxWidth the region renders 1:1', () => {
    expect(predictRegionsHeight([oneNode()], 10_000)).toBeCloseTo(BLOCK_CHROME + INNER_H, 6);
  });

  it('downscales a wide region (two side-by-side roots) to fit', () => {
    const wide: LabeledRegion = {
      key: 'body',
      nodes: [{ id: 'a', type: 'http' }, { id: 'b', type: 'http' }],
      edges: [],
    };
    const wideW = 2 * NODE_W + H_GAP + 2 * PADDING; // both roots share one layer
    const expected = BLOCK_CHROME + INNER_H * (EXPANDED_REGION_MAX_W / wideW);
    expect(predictRegionsHeight([wide], EXPANDED_REGION_MAX_W)).toBeCloseTo(expected, 6);
  });
});
