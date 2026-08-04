// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { I18nLabelSchema, AriaPropsSchema } from './i18n.zod';
import { lazySchema } from '../shared/lazy-schema';

// ---------------------------------------------------------------------------
// NOT CLOSED AGAINST UNKNOWN KEYS -- AND THAT IS THE MEASURED VERDICT
// (#4001 batch 13 / 批 13, ADR-0078). Read this before "finishing" the file.
//
// The strictness ledger scheduled this file's 4 object sites as `authorable
// (p)` -- provisional. #4001's own rule is verify-before-tightening, and here
// the verification came back NEGATIVE: no metadata document is ever parsed
// against these shapes, because nothing in the protocol carries them.
//
// Three independent measurements, 2026-08-03:
//
//   1. STATIC -- nothing under `packages/spec/src` imports this module except
//      the `ui/index.ts` barrel. No schema anywhere declares a `component.animation / app.motion`
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
 * Transition Preset Schema
 * Common animation transition presets.
 */
export const TransitionPresetSchema = lazySchema(() => z.enum([
  'fade',
  'slide_up',
  'slide_down',
  'slide_left',
  'slide_right',
  'scale',
  'rotate',
  'flip',
  'none',
]).describe('Transition preset type'));

export type TransitionPreset = z.infer<typeof TransitionPresetSchema>;

/**
 * Easing Function Schema
 * Supported animation easing/timing functions.
 */
export const EasingFunctionSchema = lazySchema(() => z.enum([
  'linear',
  'ease',
  'ease_in',
  'ease_out',
  'ease_in_out',
  'spring',
]).describe('Animation easing function'));

export type EasingFunction = z.infer<typeof EasingFunctionSchema>;

/**
 * Transition Configuration Schema
 * Defines a single animation transition with timing and easing options.
 */
export const TransitionConfigSchema = lazySchema(() => z.object({
  preset: TransitionPresetSchema.optional().describe('Transition preset to apply'),
  duration: z.number().optional().describe('Transition duration in milliseconds'),
  easing: EasingFunctionSchema.optional().describe('Easing function for the transition'),
  delay: z.number().optional().describe('Delay before transition starts in milliseconds'),
  customKeyframes: z.string().optional().describe('CSS @keyframes name for custom animations'),
  themeToken: z.string().optional().describe('Reference to a theme animation token (e.g. "animation.duration.fast")'),
}).describe('Animation transition configuration'));

export type TransitionConfig = z.infer<typeof TransitionConfigSchema>;

/**
 * Animation Trigger Schema
 * Events that can trigger an animation.
 */
export const AnimationTriggerSchema = lazySchema(() => z.enum([
  'on_mount',
  'on_unmount',
  'on_hover',
  'on_focus',
  'on_click',
  'on_scroll',
  'on_visible',
]).describe('Event that triggers the animation'));

export type AnimationTrigger = z.infer<typeof AnimationTriggerSchema>;

/**
 * Component Animation Schema
 * Animation configuration for an individual UI component.
 */
export const ComponentAnimationSchema = lazySchema(() => z.object({
  label: I18nLabelSchema.optional().describe('Descriptive label for this animation configuration'),
  enter: TransitionConfigSchema.optional().describe('Enter/mount animation'),
  exit: TransitionConfigSchema.optional().describe('Exit/unmount animation'),
  hover: TransitionConfigSchema.optional().describe('Hover state animation'),
  trigger: AnimationTriggerSchema.optional().describe('When to trigger the animation'),
  reducedMotion: z.enum(['respect', 'disable', 'alternative']).default('respect')
    .describe('Accessibility: how to handle prefers-reduced-motion'),
}).merge(AriaPropsSchema.partial()).describe('Component-level animation configuration'));

export type ComponentAnimation = z.infer<typeof ComponentAnimationSchema>;

/**
 * Page Transition Schema
 * Defines the animation used when navigating between pages.
 */
export const PageTransitionSchema = lazySchema(() => z.object({
  type: TransitionPresetSchema.default('fade').describe('Page transition type'),
  duration: z.number().default(300).describe('Transition duration in milliseconds'),
  easing: EasingFunctionSchema.default('ease_in_out').describe('Easing function for the transition'),
  crossFade: z.boolean().default(false).describe('Whether to cross-fade between pages'),
}).describe('Page-level transition configuration'));

export type PageTransition = z.infer<typeof PageTransitionSchema>;

/**
 * Motion Configuration Schema
 * Top-level animation and motion design configuration.
 */
export const MotionConfigSchema = lazySchema(() => z.object({
  label: I18nLabelSchema.optional().describe('Descriptive label for the motion configuration'),
  defaultTransition: TransitionConfigSchema.optional().describe('Default transition applied to all animations'),
  pageTransitions: PageTransitionSchema.optional().describe('Page navigation transition settings'),
  componentAnimations: z.record(z.string(), ComponentAnimationSchema).optional()
    .describe('Component name to animation configuration mapping'),
  reducedMotion: z.boolean().default(false).describe('When true, respect prefers-reduced-motion and suppress animations globally'),
  enabled: z.boolean().default(true).describe('Enable or disable all animations globally'),
}).describe('Top-level motion and animation design configuration'));

export type MotionConfig = z.infer<typeof MotionConfigSchema>;
