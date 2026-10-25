// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * flow-region-metrics — the deterministic box model shared by the inline
 * region renderer (`flow-region-view.tsx` + the NodeCard region tray) and the
 * layout height predictor (#2670 Phase 2).
 *
 * An expanded container card's height must be known BEFORE render so
 * `computeLayoutWithGeometry` can push the layers below it down — there is no
 * measure-then-reflow pass (no ResizeObserver). That only works if predictor
 * and renderer agree to the pixel, so:
 *
 *   ⚠️ These constants ARE the region renderer's box model. Every height-stack
 *   dimension in the renderer is an explicit px style sourced from here —
 *   change either side only together.
 *
 * Pure module: imports only from `flow-canvas-layout` (no React), keeping the
 * dependency chain one-directional: layout ← metrics ← {region-view, parts,
 * FlowCanvas}.
 */

import {
  computeLayout,
  diagramSize,
  NODE_W,
  NODE_H,
  type LabeledRegion,
} from './flow-canvas-layout.js';

/** Dashed border of one region block, per side (`border` = 1px). */
export const REGION_BLOCK_BORDER = 1;
/** Padding inside one region block (replaces rem-based `p-1.5`). */
export const REGION_BLOCK_PAD = 6;
/** Region label row: 12px pinned line-height + 4px bottom padding (border-box). */
export const REGION_LABEL_H = 16;
/** Vertical gap between region blocks (replaces `gap-2`). */
export const REGION_GAP = 8;
/** Gap between the NODE_H header card and the region tray below it. */
export const NODE_REGION_GAP = 6;
/** Region tray border, per side. */
export const REGION_PANEL_BORDER = 1;
/** Region tray padding. */
export const REGION_PANEL_PAD = 6;
/** Width handed to FlowRegionView inside an expanded card (tray + block chrome off NODE_W). */
export const EXPANDED_REGION_MAX_W =
  NODE_W - 2 * (REGION_PANEL_BORDER + REGION_PANEL_PAD) - 2 * (REGION_BLOCK_BORDER + REGION_BLOCK_PAD);

/**
 * Predicted rendered height of `<FlowRegionView regions maxWidth={canvasMaxWidth}/>`.
 * Mirrors the renderer exactly — same float expressions, so no rounding skew:
 * each block = border + padding + optional label row + the region mini-canvas
 * scaled down (never up) to fit `canvasMaxWidth`; blocks separated by REGION_GAP.
 */
export function predictRegionsHeight(regions: LabeledRegion[], canvasMaxWidth: number): number {
  let total = 0;
  regions.forEach((region, i) => {
    const { width, height } = diagramSize(computeLayout(region.nodes, region.edges));
    const scale = Math.min(1, canvasMaxWidth / Math.max(width, 1));
    total +=
      (i > 0 ? REGION_GAP : 0) +
      2 * (REGION_BLOCK_BORDER + REGION_BLOCK_PAD) +
      (region.label ? REGION_LABEL_H : 0) +
      height * scale;
  });
  return total;
}

/**
 * Predicted total height of an EXPANDED container card: the NODE_H header band
 * plus the region tray (gap + tray chrome + regions). `NODE_H` when there is
 * nothing to expand — the collapsed/plain-card height.
 */
export function predictExpandedNodeHeight(regions: LabeledRegion[]): number {
  if (regions.length === 0) return NODE_H;
  return (
    NODE_H +
    NODE_REGION_GAP +
    2 * (REGION_PANEL_BORDER + REGION_PANEL_PAD) +
    predictRegionsHeight(regions, EXPANDED_REGION_MAX_W)
  );
}
