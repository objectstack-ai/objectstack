// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { I18nLabelSchema } from './i18n.zod';

/**
 * Notification Type Schema
 * Defines the visual presentation style of the notification.
 */
import { lazySchema } from '../shared/lazy-schema';
export const NotificationTypeSchema = lazySchema(() => z.enum([
  'toast',
  'snackbar',
  'banner',
  'alert',
  'inline',
]).describe('Notification presentation style'));

export type NotificationType = z.infer<typeof NotificationTypeSchema>;

/**
 * Notification Severity Schema
 * Indicates the urgency and visual treatment of the notification.
 */
export const NotificationSeveritySchema = lazySchema(() => z.enum([
  'info',
  'success',
  'warning',
  'error',
]).describe('Notification severity level'));

export type NotificationSeverity = z.infer<typeof NotificationSeveritySchema>;

/**
 * Notification Position Schema
 * Screen position for rendering notifications.
 */
export const NotificationPositionSchema = lazySchema(() => z.enum([
  'top_left',
  'top_center',
  'top_right',
  'bottom_left',
  'bottom_center',
  'bottom_right',
]).describe('Screen position for notification placement'));

export type NotificationPosition = z.infer<typeof NotificationPositionSchema>;

/**
 * Notification Action Schema
 * Defines an interactive action button within a notification.
 *
 * ⛔ **DELIBERATELY NOT `strictObject` — this shape has NO AUTHORING DOOR**
 * (#4001 批 14, ADR-0078 completeness gate). It is a **vocabulary**, consumed by
 * reading its `.shape`, never by parsing an authored payload. Three independent
 * measurements on 2026-08-03, each with a positive control that passed in the
 * same run:
 *
 * 1. **Carrier key** — nothing in `packages/spec/src` imports this schema except
 *    the `ui/index.ts` barrel. No metadata type declares a notification-actions
 *    key; the `./ui` "notification instance" and "notification system config"
 *    wrappers that once could have carried it were deleted in #4610 for having
 *    zero consumers (see the note at the bottom of this file).
 * 2. **Graph reachability** — BFS from the 24 metadata-type roots plus
 *    `defineStack`'s `ObjectStackSchema` (the closure `build-schemas.ts` uses for
 *    the #4650 deletion check) visits 6860 nodes and never reaches it. Controls
 *    `PageSchema` / `ActionSchema` / `DashboardWidgetSchema` / `WebhookSchema`
 *    were all `root-graph` in the same run, and injecting a synthetic carrier
 *    flipped this schema to `root-graph` — so "unreachable" is a fact about the
 *    graph, not a broken instrument.
 * 3. **Call sites** — no `.parse()` in framework or objectui outside this
 *    module's own `notification.test.ts`. objectui's use is the opposite of a
 *    parse: `animation-notification-spec-parity.test.tsx` reads
 *    `NotificationActionSchema.shape.variant` to pin its own hand-written
 *    `NotificationActionButton` interface against this enum, both ways. That pin
 *    depends on the SHAPE and is unaffected by the posture — which is precisely
 *    why closing the shape would buy nothing.
 *
 * `.strict()` is a property of a PARSE, and nothing parses this. Closing it
 * would spend a v17 breaking change to make the file look finished and leave a
 * precisely-validated dead slot — *"the more convincing lie"* (#4583). The
 * verdict this shape actually needs is ADR-0049 enforce-or-remove; filed as #5015
 * and recorded in the strictness ledger's `no door` class.
 *
 * The pin in `notification.test.ts` goes RED the moment anyone gives this shape
 * a carrier key — at which point it becomes authorable and this comment is wrong.
 */
export const NotificationActionSchema = lazySchema(() => z.object({
  label: I18nLabelSchema.describe('Action button label'),
  action: z.string().describe('Action identifier to execute'),
  variant: z.enum(['primary', 'secondary', 'link']).default('primary')
    .describe('Button variant style'),
}).describe('Notification action button'));

export type NotificationAction = z.infer<typeof NotificationActionSchema>;

// [#4610] `NotificationSchema` / `Notification` and `NotificationConfigSchema`
// / `NotificationConfig` were removed from this module (dual-source cleanup,
// #4535 C3). The `./ui` "notification instance" and "notification system
// config" wrappers had ZERO consumers across framework, cloud and objectui —
// only the presentation vocabulary above (type/severity/position/action) is
// consumed (objectui pins its toaster implementation against it). The bare
// name `Notification(Schema)` now belongs to `@objectstack/spec/api` alone:
// the REST inbox-row contract served by `/api/v1/notifications` (ADR-0030's
// bell reads that shape). `NotificationConfig(Schema)` left the export
// surface entirely — its `./system` twin was equally consumer-free and
// contradicted ADR-0030's accepted delivery model.
