/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @object-ui/types/zod - Feedback Component Zod Validators
 * 
 * Zod validation schemas for feedback and status indication components.
 * Following @objectstack/spec UI specification format.
 * 
 * @module zod/feedback
 * @packageDocumentation
 */

import { z } from 'zod';
import { handlerKeyRefusal, retirementTombstone } from './tombstone.zod.js';
import { BaseSchema, SchemaNodeSchema } from './base.zod.js';

/**
 * Loading Schema - Loading indicator component
 */
export const LoadingSchema = BaseSchema.extend({
  type: z.literal('loading'),
  label: z.string().optional().describe('Loading label text'),
  size: z.enum(['sm', 'default', 'lg']).optional().describe('Loading indicator size'),
  variant: z.enum(['spinner', 'dots', 'pulse']).optional().describe('Loading variant'),
  fullscreen: z.boolean().optional().describe('Whether to show fullscreen overlay'),
  body: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `loading` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `fullscreen`, `label`, `size`.',
  ),
  children: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `loading` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `fullscreen`, `label`, `size`.',
  ),
});

/**
 * Progress Schema - Progress bar component
 */
export const ProgressSchema = BaseSchema.extend({
  type: z.literal('progress'),
  value: z.number().optional().describe('Progress value'),
  max: z.number().optional().describe('Maximum value'),
  variant: z.enum(['default', 'success', 'warning', 'error']).optional().describe('Progress variant'),
  showLabel: z.boolean().optional().describe('Show progress label'),
  size: z.enum(['sm', 'default', 'lg']).optional().describe('Progress bar size'),
  indeterminate: z.boolean().optional().describe('Indeterminate progress'),
  body: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `progress` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `value`.',
  ),
  children: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `progress` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `value`.',
  ),
});

/**
 * Skeleton Schema - Skeleton loading placeholder
 */
export const SkeletonSchema = BaseSchema.extend({
  type: z.literal('skeleton'),
  variant: z.enum(['text', 'circular', 'rectangular']).optional().describe('Skeleton variant'),
  width: z.union([z.string(), z.number()]).optional().describe('Skeleton width'),
  height: z.union([z.string(), z.number()]).optional().describe('Skeleton height'),
  lines: z.number().optional().describe('Number of text lines'),
  animate: z.boolean().optional().describe('Enable animation'),
  body: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `skeleton` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `height`, `width`.',
  ),
  children: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `skeleton` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `height`, `width`.',
  ),
});

/**
 * Toast Schema - Toast notification component
 */
export const ToastSchema = BaseSchema.extend({
  type: z.literal('toast'),
  title: z.string().optional().describe('Toast title'),
  description: z.string().optional().describe('Toast description'),
  variant: z.enum(['default', 'success', 'warning', 'error', 'info']).optional().describe('Toast variant'),
  duration: z.number().optional().describe('Auto-dismiss duration (ms)'),
  position: z.enum([
    'top-left',
    'top-center',
    'top-right',
    'bottom-left',
    'bottom-center',
    'bottom-right',
  ]).optional().describe('Toast position'),
  // ADR-0049 RETIREMENT TOMBSTONE (objectui#8338). ⛔ NOT `handlerKeyRefusal()`,
  // the neighbour one line below: `action` is not a handler key, it is a VALUE
  // key whose nested member was a function, so this is a retirement from the
  // contract on both faces (`invalid_type`, and `?: never` on `../feedback.ts`)
  // and not the #6124 named-refusal arm (`custom`, TS twin sometimes callable).
  // A plain deletion would NOT refuse it: `BaseSchema` is `.passthrough()`, so
  // an authored value would be KEPT unvalidated and silently inert.
  // ⛔ First fragment on the CALL line, never alone on its own: an indented bare
  // quoted string that ends a line is `check-widening-tells.mjs`'s T2 arm
  // (`BARE_STRING_ELEMENT`), which read this NARROWING as a closed set gaining a
  // member. Continuations carry `+ `, which is why 1 tell fired and not 8.
  // ⛔ Never an array + `.join(' ')` (every element alone on a line = 8 tells),
  // and ⛔ never edit the TEXT — `../__tests__/toast-button-keys.test.ts` pins it.
  action: retirementTombstone('RETIRED (objectui#8338, ADR-0049 enforce-or-remove) — `action` had two published faces whose '
    + 'accept sets were DISJOINT and one of them EMPTY: this mirror admitted a node or a list of '
    + 'nodes, while `ToastSchema` declared `{ label: string; onClick: () => void }` with both members '
    + 'required, which no JSON document can satisfy. The `toast` renderer read neither face. There is '
    + 'NO replacement spelling and the capability was never fulfilled — objectui#6250 moved the toast '
    + 'demos off an in-toast action entirely, and an in-toast action button is a capability expansion '
    + 'with zero runtime today. Raise the toast from the node itself (`title`, `description`, '
    + '`variant`, `duration`) and label its trigger with `buttonLabel` / `buttonVariant`.',
  ),
  onDismiss: handlerKeyRefusal('onDismiss', 'retired', 'Dismiss handler'),
  // The trigger button the `toast` renderer draws in place. `buttonVariant`
  // is an ENUM and not `z.string()`: the renderer hands the value straight to
  // `<Button variant={…}>`, whose vocabulary is the six keys of
  // `buttonVariants`. `cva` contributes no variant class for an unrecognised
  // key, so a non-empty string outside the six renders an unstyled button —
  // and `''` is silently resolved to `default` by cva's falsy fallback
  // (objectui#6496). `SonnerSchema` below carries the same pair of keys and
  // now the same enum: it spelled `buttonVariant` as `z.string()` while its TS
  // face declared the six-member union, and objectui#6541 closed that gap.
  buttonLabel: z.string().optional().describe('Trigger button label'),
  buttonVariant: z
    .enum(['default', 'secondary', 'destructive', 'outline', 'ghost', 'link'])
    .optional()
    .describe('Trigger button variant'),
  body: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `toast` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `buttonLabel`, `buttonVariant`, `className`, `description`, `duration`, '
    + '`title`, `variant`.',
  ),
  children: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `toast` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `buttonLabel`, `buttonVariant`, `className`, `description`, `duration`, '
    + '`title`, `variant`.',
  ),
});

/**
 * Toaster Schema - Toast container component
 */
export const ToasterSchema = BaseSchema.extend({
  type: z.literal('toaster'),
  position: z.enum([
    'top-left',
    'top-center',
    'top-right',
    'bottom-left',
    'bottom-center',
    'bottom-right',
  ]).optional().describe('Toaster position'),
  limit: z.number().optional().describe('Maximum number of toasts'),
  body: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `toaster` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `limit`, `position`.',
  ),
  children: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `toaster` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `limit`, `position`.',
  ),
});

/**
 * Spinner Schema - Spinner component
 */
export const SpinnerSchema = BaseSchema.extend({
  type: z.literal('spinner'),
  size: z.enum(['sm', 'md', 'lg', 'xl']).optional().describe('Spinner size'),
  body: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `spinner` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `className`, `size`.',
  ),
  children: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `spinner` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `className`, `size`.',
  ),
});

/**
 * Empty Schema - Empty state component
 */
export const EmptySchema = BaseSchema.extend({
  type: z.literal('empty'),
  title: z.string().optional().describe('Empty state title'),
  description: z.string().optional().describe('Empty state description'),
  icon: z.string().optional().describe('Empty state icon'),
  // The mirror half of `EmptySchema.action` (objectui#7105). `SchemaNodeSchema`,
  // matching the TypeScript face and every sibling node slot — NOT the
  // `{ label, onClick }` object `ToastSchema.action` above happens to spell, a
  // different interface with a different shape.
  //
  // What this buys is the VALUE, not key membership: `BaseSchema` is
  // `.passthrough()` and `.extend()` carries that through, so `action` already
  // parsed green here as an unexamined key. It is now judged — an `action` that
  // is neither a node object with a `type` nor a primitive is refused, where
  // before it was admitted.
  action: SchemaNodeSchema.optional().describe('Call-to-action node rendered below the description'),
  body: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `empty` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `action`, `className`, `description`, `title`.',
  ),
  children: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `empty` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `action`, `className`, `description`, `title`.',
  ),
});

/**
 * Sonner Schema - Sonner toast component
 */
export const SonnerSchema = BaseSchema.extend({
  type: z.literal('sonner'),
  message: z.string().optional().describe('Toast message'),
  title: z.string().optional().describe('Toast title'),
  description: z.string().optional().describe('Toast description'),
  variant: z.enum(['default', 'success', 'warning', 'error', 'info']).optional().describe('Toast variant'),
  buttonLabel: z.string().optional().describe('Action button label'),
  // Narrowed from `z.string()` by objectui#6541 — an accept-set NARROWING on a
  // published surface, not a widening. The reason is the one spelled out on
  // `ToastSchema` above: `renderers/feedback/sonner.tsx` hands this value
  // straight to `<Button variant={…}>`, whose vocabulary is the six keys of
  // `buttonVariants`, and `cva` contributes no variant class outside them. The
  // TS face in `../feedback.ts` has declared exactly these six all along — this
  // mirror is what disagreed with it. Pinned against the Button's own
  // vocabulary, in BOTH directions, in
  // `components/src/__tests__/toast-button-variant-parity.test.ts`.
  buttonVariant: z
    .enum(['default', 'secondary', 'destructive', 'outline', 'ghost', 'link'])
    .optional()
    .describe('Action button variant'),
  body: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `sonner` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `buttonLabel`, `buttonVariant`, `className`, `description`, `message`, '
    + '`title`, `variant`.',
  ),
  children: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `sonner` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `buttonLabel`, `buttonVariant`, `className`, `description`, `message`, '
    + '`title`, `variant`.',
  ),
});

/**
 * Feedback Schema Union - All feedback component schemas
 */
const FeedbackSchemaInferred = z.discriminatedUnion('type', [
  LoadingSchema,
  ProgressSchema,
  SkeletonSchema,
  ToastSchema,
  ToasterSchema,
  SpinnerSchema,
  EmptySchema,
  SonnerSchema,
]);

/**
 * The TYPE of {@link FeedbackSchema}, NAMED so declaration emit prints it by
 * reference (objectui#11573): see "Why every category union's TYPE is named"
 * on `AnyComponentSchema` (`index.zod.ts`). It adds no member.
 */
export interface FeedbackZodType extends FeedbackSchemaInferredType {
  options: FeedbackSchemaInferredType['options'];
}
type FeedbackSchemaInferredType = typeof FeedbackSchemaInferred;

/** The union above, typed by its named {@link FeedbackZodType}. */
export const FeedbackSchema: FeedbackZodType = FeedbackSchemaInferred;
