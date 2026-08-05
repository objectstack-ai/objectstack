// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

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

// [#5015] `NotificationActionSchema` / `NotificationAction` were REMOVED per
// ADR-0049 enforce-or-remove, ruled REMOVE on 2026-08-04.
//
// The shape declared an interactive action button inside a notification —
// `{ label, action, variant }` — and had **no authoring door anywhere**. #4001
// 批 14 measured it three ways on 2026-08-03, each with a positive control that
// passed in the same run, and this retirement re-ran all three against
// `origin/main` before removing anything:
//
//   1. **Carrier key** — no schema in `packages/spec/src` declared a
//      notification-actions key; the barrel was this module's only non-test
//      importer. The `./ui` "notification instance" and "notification system
//      config" wrappers that could have carried it were themselves deleted in
//      #4610 for having zero consumers (see the note below), which is what left
//      this shape an orphan.
//   2. **Graph reachability** — BFS from the 24 metadata-type roots plus
//      `defineStack`'s `ObjectStackSchema` (the closure `build-schemas.ts` uses
//      for the #4650 deletion check, including its derived-clone bridge) never
//      reached it, while `Page` / `Action` / `DashboardWidget` / `Webhook` /
//      `SharingConfig` all resolved `root-graph` in the same run and injecting a
//      synthetic carrier flipped it to `root-graph`.
//   3. **Call sites** — zero `.parse()` in objectstack, cloud or objectui
//      outside this module's own unit test.
//
// So nobody could author one and nothing ever validated one: it was a published
// vocabulary with no recipient, which #3950 records as the shape an AI author
// reads as a capability. `.strict()` was deliberately NOT applied instead —
// strictness is a property of a PARSE, and closing a shape nothing parses only
// buys *"a precisely-validated dead slot, the more convincing lie"* (#4583).
//
// What stays: the three presentation enums above (`NotificationType` /
// `NotificationSeverity` / `NotificationPosition`). objectui consumes them as a
// vocabulary for its own toaster, and they are unaffected.
//
// objectui's `animation-notification-spec-parity.test.tsx` read
// `NotificationActionSchema.shape.variant` to pin its hand-written
// `NotificationActionButton` interface. That is a vocabulary read, not a parse,
// and it is why "has a consumer" never meant "has an authoring door" here — the
// pin loses its spec-side anchor when objectui refreshes this dependency, and
// adapting it is tracked on the objectui side.
//
// If notification actions are ever wanted as METADATA, they return via the
// enforce route of ADR-0049 — a carrier key on a real metadata type, with a
// renderer that reads it, in one change. Vocabulary second, never first.

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
