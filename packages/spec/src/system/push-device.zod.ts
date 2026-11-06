// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { lazySchema } from '../shared/lazy-schema';
import { PushVendorSchema } from './push-config.zod';
import { LocaleSchema } from './translation.zod';
import { PUSH_DEVICE_PLATFORMS } from './push-device-platform';
import { PUSH_SERVER_ORIGIN_MESSAGE, PUSH_SERVER_ORIGIN_PATTERN } from './push-server-origin';

/**
 * Push Device Protocol — the stored device shape of the push device registry
 * (ADR-0012 §6, narrowed to what core ships).
 *
 * One row per (user, app install): what a device registration
 * (`RegisterDeviceRequestSchema`, `api/protocol.zod.ts`) produces, what the
 * push channel reads to address a phone, and what the registry's listing
 * answers (`INotificationService.listDevices`).
 *
 * Stored in `sys_user_device`, the device registry's table (ADR-0012 §11),
 * which `@objectstack/service-messaging` owns: its `INotificationService`
 * device members write it, the device routes under
 * `/api/v1/notifications/devices` are the only door to it from outside, and
 * its `push` channel reads it to address a phone and retires dead tokens in
 * it. `@objectstack/service-push` holds only the vendor transports and never
 * touches the table.
 *
 * Three rules the registry owes, stated here because they decide the shape:
 *
 * - **(a) A device belongs to a user, not to an organization.** The row has no
 *   organization member. A phone signed in to one person receives that
 *   person's notifications whichever organization they come from; the
 *   organization travels on the notification, never on the device. The
 *   identity of a row is (`userId`, `deviceId`).
 * - **(b) One live row per token.** A vendor token is delivered to one row
 *   only. A token this user already holds under another `deviceId` (the app's
 *   storage was cleared, so the registration carries no `deviceId`) refreshes
 *   that row and answers its `deviceId`; it never makes a second live row.
 *   When a second user registers a token another user's device holds, the
 *   token moves to the second user and the first user's row for it is
 *   removed, so a push meant for the phone's previous user never reaches its
 *   new one.
 * - **(c) A dead token keeps its row.** When the vendor reports a token dead
 *   (APNs `BadDeviceToken` / `Unregistered`, FCM `UNREGISTERED`), the row is
 *   kept with `enabled: false` and `invalidatedAt` set, so "why did this phone
 *   stop getting pushes" stays answerable. Nothing is delivered to a disabled
 *   row, and a later registration of the same device re-enables it and clears
 *   `invalidatedAt`.
 *
 * Narrowed from the ADR-0012 §6 sketch: `vendor` is the core pair (`apns` |
 * `fcm`; it is the token type the sender routes on: the direct transport
 * today, the hosted relay (the default) once served, and the domestic Android
 * vendors (HMS / Honor / Xiaomi / OPPO / vivo) join it in phase 2 behind the
 * relay, ADR-0012 §6.1) and
 * `platform` is the registration's own three (`ios` | `android` | `web`).
 */
export const UserDeviceSchema = lazySchema(() => z.object({
  deviceId: z.string().min(1).describe(
    'Client-held device id, stable per app install: the one the registration carried or the server minted. Unique per user',
  ),
  userId: z.string().min(1).describe('The user the device belongs to: the session user who registered it. No organization member'),
  vendor: PushVendorSchema.describe('Push vendor the token belongs to: the registration\'s vendor, or the one derived from platform'),
  token: z.string().min(1).describe('Vendor push token. Held by one live device at a time: a second user\'s registration moves it'),
  platform: z.enum(PUSH_DEVICE_PLATFORMS).describe('Device platform, as the registration named it'),
  appId: z.string().optional().describe('App the token was issued to: the iOS bundle ID or the Android application ID'),
  locale: LocaleSchema.optional().describe(
    'Device locale (BCP 47, for example zh-CN), as the registration named it. Stored for the device; no push renders by it: '
    + 'a push arrives in the recipient\'s language (sys_user.locale, then the deployment default)',
  ),
  name: z.string().optional().describe('Device friendly name, as the registration named it'),
  origin: z.string().regex(PUSH_SERVER_ORIGIN_PATTERN, { message: PUSH_SERVER_ORIGIN_MESSAGE }).optional().describe(
    'The origin the Console was loaded from, as the registration named it (for example '
    + 'https://crm.example.com). The device registry keeps it on the row and the push channel copies it into every push '
    + 'to this device, where the mobile shell picks the saved server by it. Absent on a device registered without one',
  ),
  enabled: z.boolean().describe('False once the vendor reported the token dead; nothing is delivered to a disabled device'),
  invalidatedAt: z.string().datetime().optional().describe(
    'When the vendor reported the token dead. Present exactly while enabled is false: absent on an enabled device, '
    + 'and cleared by the registration that re-enables it',
  ),
  lastSeenAt: z.string().datetime().optional().describe(
    'When the device last registered or refreshed. Every registration and refresh sets it, so it is absent only on a '
    + 'row no registration wrote; listDevices answers such a device last',
  ),
}).describe('A push device of one user: one row per app install'));
export type UserDevice = z.input<typeof UserDeviceSchema>;
