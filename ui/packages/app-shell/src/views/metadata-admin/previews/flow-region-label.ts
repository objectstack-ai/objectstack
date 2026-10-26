// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * flow-region-label — the ONE place a structured region's English fallback
 * header (`Try` / `Catch` / `Branch N` / `Body`) is translated for display.
 *
 * `extractRegions` (the canvas layout helper) and `regionLabelOf` (the
 * nested-node selection codec in `../inspectors/flow-nested-selection.ts`) are
 * pure, i18n-free, and bake the same English structural fallbacks. Both of their
 * readers translate here, at render, keyed off the stable region `key`:
 *   - the canvas region header (`FlowRegionView`);
 *   - the nested-node inspector breadcrumb (`FlowNodeInspector`, objectui#10696).
 * So a zh-CN author reads the same word above the region on the canvas and in
 * the inspector's container › region › node crumb.
 *
 * A user-supplied `parallel` branch name (anything other than the `Branch N`
 * auto-label) is author content and passes through untouched. A loop / map
 * `body` reads its own row, `engine.flowRegion.body` (objectui#10748 — the two
 * older `Body` rows are page-block body text, another concept). `extractRegions`
 * gives a body no label, so the canvas still draws no header for it; the
 * nested-node crumb, whose `regionLabelOf` bakes `Body`, is its reader.
 */

import type { LabeledRegion } from './flow-canvas-layout.js';
import { t as tr, tFormat } from '../i18n.js';

export function displayRegionLabel(region: Pick<LabeledRegion, 'key' | 'label'>, locale?: string): string | undefined {
  const { key, label } = region;
  if (key === 'try') return tr('engine.flowRegion.try', locale);
  if (key === 'catch') return tr('engine.flowRegion.catch', locale);
  if (key === 'body') return label === 'Body' ? tr('engine.flowRegion.body', locale) : label;
  const m = /^branch-(\d+)$/.exec(key);
  if (m) {
    const n = Number(m[1]) + 1;
    if (label === `Branch ${n}`) return tFormat('engine.flowRegion.branchN', locale, { n });
  }
  return label;
}
