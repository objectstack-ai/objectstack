/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Record-surface derivation — now sourced from `@objectstack/spec/data`
 * (objectstack-ai/objectstack#2578 / objectstack-ai/objectstack#2604). The local mirror this file used to carry existed
 * only because objectui pinned a spec that predated the export; with the spec
 * bump to `^12.2.0` the real derivation is available, so we re-export it and
 * delete the copy (restoring the single-source guarantee the mirror stood in
 * for).
 *
 * Only the OVERLAY-SIZE helpers below (`deriveOverlaySize` / `overlayWidthFor`
 * / `OverlaySize`) stay objectui-local: they map a size bucket to a
 * viewport-clamped CSS width, which is a renderer concern the protocol does
 * not (and should not) own. `deriveOverlaySize` also maps a field count to a
 * bucket for a caller that asks for one; the console's `navigation.size:
 * 'auto'` never does, it is the side preview's fixed width whatever the
 * field count. They reuse spec's `countAuthorableFields` so the field set
 * stays in lockstep with `deriveRecordSurface`.
 */

export {
  deriveRecordSurface,
  deriveRecordFlowSurface,
  countAuthorableFields,
  RECORD_SURFACE_PAGE_THRESHOLD,
} from '@objectstack/spec/data';
export type {
  RecordSurface,
  RecordSurfaceOptions,
  RecordSurfaceViewport,
  RecordFlow,
  RecordFlowContainer,
  RecordFlowSurface,
} from '@objectstack/spec/data';

import { countAuthorableFields } from '@objectstack/spec/data';

/**
 * Overlay size bucket for a drawer (the buckets of spec `NavigationConfig.size`
 * other than `'auto'`). objectstack-ai/objectstack#2578: width is a runtime concern — the author can't
 * know the client viewport — so buckets map to a pixel CAP that the renderer
 * always clamps to the viewport (`min(cap, 92vw)`).
 */
export type OverlaySize = 'sm' | 'md' | 'lg' | 'xl' | 'full';

/** Pixel cap per bucket; always clamped to the viewport at render (min(cap, 92vw)). */
const OVERLAY_SIZE_PX: Record<OverlaySize, number> = {
  sm: 480, md: 720, lg: 960, xl: 1200, full: 1600,
};

/**
 * A size bucket from the object's field count. Not what `navigation.size:
 * 'auto'` means: the console opens an `auto` record drawer at the side
 * preview's fixed width, whatever the field count.
 */
export function deriveOverlaySize(objectSchema: unknown): OverlaySize {
  const n = countAuthorableFields(objectSchema);
  if (n <= 3) return 'sm';
  if (n <= 8) return 'md';
  if (n <= 15) return 'lg';
  return 'xl';
}

/**
 * Resolve an overlay `size` bucket to a viewport-clamped CSS width. Given
 * `'auto'` or nothing it falls back to {@link deriveOverlaySize}; the console
 * never passes either, because it resolves `auto` to the side preview's fixed
 * width before calling. The `min(cap, 92vw)` clamp is why the AUTHOR never
 * needs the client width — the client applies it.
 */
export function overlayWidthFor(size: 'auto' | OverlaySize | undefined, objectSchema: unknown): string {
  const bucket = (!size || size === 'auto') ? deriveOverlaySize(objectSchema) : size;
  return `min(92vw, ${OVERLAY_SIZE_PX[bucket]}px)`;
}
