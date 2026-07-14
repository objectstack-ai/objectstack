// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Metadata conversion layer (ADR-0087 D2) — public surface.
 *
 * The versioned, declarative table that lets a consumer authoring an old
 * (N−1) metadata shape keep loading with zero action under protocol N, while
 * the runtime sees only the canonical shape. See {@link ./types} for the design
 * rationale and the PD #12 boundary.
 */

export {
  CONVERSION_CONFLICT_CODE,
  CONVERSION_NOTICE_CODE,
  type ConversionApplication,
  type ConversionConflictDetail,
  type ConversionConflictNotice,
  type ConversionContext,
  type ConversionFixture,
  type ConversionNotice,
  type MetadataConversion,
} from './types.js';
export { ALL_CONVERSIONS, CONVERSIONS_BY_MAJOR } from './registry.js';
export {
  applyConversions,
  applyConversionsToFlow,
  collectConversionNotices,
  type ApplyConversionsOptions,
} from './apply.js';
