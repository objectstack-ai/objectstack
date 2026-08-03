// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { I18nLabelSchema, AriaPropsSchema } from './i18n.zod';
import { lazySchema } from '../shared/lazy-schema';

// ---------------------------------------------------------------------------
// NOT CLOSED AGAINST UNKNOWN KEYS -- AND THAT IS THE MEASURED VERDICT
// (#4001 batch 13 / 批 13, ADR-0078). Read this before "finishing" the file.
//
// The strictness ledger scheduled this file's 7 object sites as `authorable
// (p)` -- provisional. #4001's own rule is verify-before-tightening, and here
// the verification came back NEGATIVE: no metadata document is ever parsed
// against these shapes, because nothing in the protocol carries them.
//
// Three independent measurements, 2026-08-03:
//
//   1. STATIC -- nothing under `packages/spec/src` imports this module except
//      the `ui/index.ts` barrel. No schema anywhere declares a `component.touch / page.touch`
//      slot, so there is no key an author can write to reach these shapes.
//   2. GRAPH -- a BFS over this build's in-memory Zod graph from all 24
//      metadata-type roots (`listMetadataTypeSchemaTypes`) plus
//      `ObjectStackSchema` (`defineStack`) -- the closure `build-schemas.ts`
//      uses for the #4650 deletion check -- reaches none of them. Its three
//      positive controls resolve `root-graph` in the same run: `PageSchema`,
//      `WebhookSchema` (batch 11's `defineStack({ webhooks })` door) and
//      `StateMachineSchema` (batch 10's `agent.lifecycle` door). So
//      "unreachable" is a fact about the graph, not a broken instrument.
//   3. CALL SITES -- no `.parse()` / `.safeParse()` on any schema here exists
//      in `objectstack`, `objectui` or the example apps, outside this file's
//      own unit test. objectui re-exports the inferred TYPES only and says so
//      (`@object-ui/types`, the #2561 note: the validators are deliberately
//      NOT re-exported).
//
// `.strict()` would therefore gate nothing -- strictness is a property of a
// PARSE, and there is no parse. Adding it would spend a v17 breaking change to
// make this file LOOK finished, and leave behind the artefact the ledger
// itself warns about: "a *precisely validated* dead slot is the more
// convincing lie" (#4583). The real question is ADR-0049 enforce-or-remove --
// retire this vocabulary or give it a carrier -- filed as #4988, with the same
// verdict recorded in this file's ledger row.
//
// DO NOT convert these sites to `strictObject` before #4988 is decided: a
// strict shape reads as load-bearing and makes the retirement harder, which is
// the opposite of what the measurement asks for.
// ---------------------------------------------------------------------------

/**
 * Touch Target Configuration Schema
 * Ensures touch targets meet WCAG 2.5.5 minimum size requirements (44x44px).
 */
export const TouchTargetConfigSchema = lazySchema(() => z.object({
  minWidth: z.number().default(44).describe('Minimum touch target width in pixels (WCAG 2.5.5: 44px)'),
  minHeight: z.number().default(44).describe('Minimum touch target height in pixels (WCAG 2.5.5: 44px)'),
  padding: z.number().optional().describe('Additional padding around touch target in pixels'),
  hitSlop: z.object({
    top: z.number().optional().describe('Extra hit area above the element'),
    right: z.number().optional().describe('Extra hit area to the right of the element'),
    bottom: z.number().optional().describe('Extra hit area below the element'),
    left: z.number().optional().describe('Extra hit area to the left of the element'),
  }).optional().describe('Invisible hit area extension beyond the visible bounds'),
}).describe('Touch target sizing configuration (WCAG accessible)'));

export type TouchTargetConfig = z.infer<typeof TouchTargetConfigSchema>;

/**
 * Gesture Type Enum
 * Supported touch gesture types.
 */
export const GestureTypeSchema = lazySchema(() => z.enum([
  'swipe',
  'pinch',
  'long_press',
  'double_tap',
  'drag',
  'rotate',
  'pan',
]).describe('Touch gesture type'));

export type GestureType = z.infer<typeof GestureTypeSchema>;

/**
 * Swipe Direction Enum
 */
export const SwipeDirectionSchema = lazySchema(() => z.enum(['up', 'down', 'left', 'right']));

export type SwipeDirection = z.infer<typeof SwipeDirectionSchema>;

/**
 * Swipe Gesture Configuration Schema
 */
export const SwipeGestureConfigSchema = lazySchema(() => z.object({
  direction: z.array(SwipeDirectionSchema).describe('Allowed swipe directions'),
  threshold: z.number().optional().describe('Minimum distance in pixels to recognize swipe'),
  velocity: z.number().optional().describe('Minimum velocity (px/ms) to trigger swipe'),
}).describe('Swipe gesture recognition settings'));

export type SwipeGestureConfig = z.infer<typeof SwipeGestureConfigSchema>;

/**
 * Pinch Gesture Configuration Schema
 */
export const PinchGestureConfigSchema = lazySchema(() => z.object({
  minScale: z.number().optional().describe('Minimum scale factor (e.g., 0.5 for 50%)'),
  maxScale: z.number().optional().describe('Maximum scale factor (e.g., 3.0 for 300%)'),
}).describe('Pinch/zoom gesture recognition settings'));

export type PinchGestureConfig = z.infer<typeof PinchGestureConfigSchema>;

/**
 * Long Press Gesture Configuration Schema
 */
export const LongPressGestureConfigSchema = lazySchema(() => z.object({
  duration: z.number().default(500).describe('Hold duration in milliseconds to trigger long press'),
  moveTolerance: z.number().optional().describe('Max movement in pixels allowed during press'),
}).describe('Long press gesture recognition settings'));

export type LongPressGestureConfig = z.infer<typeof LongPressGestureConfigSchema>;

/**
 * Gesture Configuration Schema
 * Unified configuration for all supported gesture types.
 */
export const GestureConfigSchema = lazySchema(() => z.object({
  type: GestureTypeSchema.describe('Gesture type to configure'),
  label: I18nLabelSchema.optional().describe('Descriptive label for the gesture action'),
  enabled: z.boolean().default(true).describe('Whether this gesture is active'),
  swipe: SwipeGestureConfigSchema.optional().describe('Swipe gesture settings (when type is swipe)'),
  pinch: PinchGestureConfigSchema.optional().describe('Pinch gesture settings (when type is pinch)'),
  longPress: LongPressGestureConfigSchema.optional().describe('Long press settings (when type is long_press)'),
}).describe('Per-gesture configuration'));

export type GestureConfig = z.infer<typeof GestureConfigSchema>;

/**
 * Touch Interaction Schema
 * Top-level touch and gesture interaction configuration for a component.
 */
export const TouchInteractionSchema = lazySchema(() => z.object({
  gestures: z.array(GestureConfigSchema).optional().describe('Configured gesture recognizers'),
  touchTarget: TouchTargetConfigSchema.optional().describe('Touch target sizing and hit area'),
  hapticFeedback: z.boolean().optional().describe('Enable haptic feedback on touch interactions'),
}).merge(AriaPropsSchema.partial()).describe('Touch and gesture interaction configuration'));

export type TouchInteraction = z.infer<typeof TouchInteractionSchema>;
