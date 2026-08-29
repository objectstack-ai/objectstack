// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { lazySchema } from '../shared/lazy-schema';

/**
 * Notification Channel Enum
 *
 * Supported notification delivery channels.
 *
 * ⚠️ PARTIALLY ENFORCED — the delivery channels actually registered by
 * `service-messaging` are `inbox`, `email`, and `sms` (#3197). `push`,
 * `slack`, `teams`, and `webhook` have no delivery implementation, and the
 * dispatcher dead-letters any message addressed to an unregistered channel.
 * Note also the naming drift: this enum says `in-app` while the implemented
 * channel registers as `inbox` (which this enum does not contain) —
 * reconcile before wiring this enum into the runtime.
 */
export const NotificationChannelSchema = lazySchema(() => z.enum([
  'email',
  'sms',
  'push',
  'in-app',
  'slack',
  'teams',
  'webhook',
]).describe('Notification delivery channel '));

// [#4610] `NotificationConfigSchema` / `NotificationConfig` were removed from
// this module (dual-source cleanup, #4535 C3). The "unified notification
// management protocol" wrapper (channel + template + recipients + schedule +
// retryPolicy + tracking) had ZERO consumers across framework, cloud and
// objectui, was wired into no parent schema, and predates ADR-0030's accepted
// delivery architecture: the real vocabulary is `NotificationService.emit`
// (single ingress, `@objectstack/spec/contracts`), the `notify` flow node
// (`NotifyConfigSchema`, `@objectstack/spec/automation`) and the sys_*
// notification objects. Its `./ui` twin was removed in the same change; the
// bare name left the spec export surface entirely.
//
// [#4616] `EmailTemplateSchema` / `EmailTemplate`, `SMSTemplateSchema` /
// `SMSTemplate`, `PushNotificationSchema` / `PushNotification` and
// `InAppNotificationSchema` / `InAppNotification` were removed from this
// module too (ADR-0049 enforce-or-remove, v17 window). They existed ONLY as
// the member shapes of the `NotificationConfigSchema.template` union #4610
// deleted, so #4610 left them reachable from no parent schema and from no
// metadata-type root — declared capability the runtime never read.
//
// What actually delivers, per channel, so the next reader does not re-derive
// it (this vocabulary is where the confusion kept starting):
//   - email  — the `email_template` metadata kind, whose ONE canonical schema
//     is `EmailTemplateDefinitionSchema` (`system/email-template.zod.ts`,
//     registered in `BUILTIN_METADATA_TYPE_SCHEMAS`), materialized into
//     `sys_email_template` rows by `plugin-email`. The `EmailTemplateSchema`
//     removed here was the *legacy* shape spec 7.1.0 explicitly demoted when
//     it resolved that Prime Directive #8 double-declaration, keeping it
//     "only as an inline sub-shape inside `Notification`" — the holder #4610
//     removed.
//   - sms    — `sys_notification_template` rows resolved by (topic, 'sms',
//     locale) in `service-messaging/src/sms-channel.ts`, rendered by
//     `template-renderer.ts`; the provider-side template is Aliyun's
//     pre-registered `TemplateCode` in `service-sms` (`aliyun.ts`), a vendor
//     API shape, not a spec constant.
//   - push / in-app — no delivery implementation at all (#3197): the
//     dispatcher dead-letters them. Declaring their payload shapes here
//     advertised a capability nothing delivers.
//
// The channel vocabulary above stays: `NotificationChannel` is re-exported by
// `@objectstack/spec/contracts` and consumed by `service-messaging`.

// Type exports
export type NotificationChannel = z.input<typeof NotificationChannelSchema>;
