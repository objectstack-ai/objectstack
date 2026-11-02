// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { lazySchema } from '../shared/lazy-schema';

/**
 * Push delivery data — what a push carries to the shell (ADR-0012 §8: the
 * `data` member of the push channel's rendered body).
 *
 * The shell reads it when the user taps the push: `notificationId` names the
 * notification (the same id the inbox lists and `markRead` takes), and
 * `route` is the Console path the shell opens.
 *
 * **Where `route` comes from — derived, never authored.** There is no
 * `notify` key for it. It is the notification's existing `actionUrl`, the
 * value the inbox already serves: an explicit `url` / `actionUrl` in the
 * notification's payload, else `/OBJECT/ID` built from the notification's
 * source record, else none. When that value passes {@link PushRouteSchema}
 * the push carries it as `route`; when it does not (an absolute URL to
 * another site, say) or there is none, the push carries no `route` and the
 * tap opens the shell's default screen. The delivery is never failed for it.
 *
 * Not to be confused with the `PushNotificationSchema` that `system/` once
 * declared and then removed (ADR-0049): that was an authoring template shape;
 * this is the wire data of a delivery, produced by the platform.
 */

/**
 * A same-server relative path the shell may open: it starts with exactly one
 * `/`, so it carries no scheme and no host, and it contains no backslash,
 * whitespace or control character — a URL parser reads `\` as `/` and strips
 * tab and newline, which would turn `/\host` — or `/`, a tab, then `/host` —
 * into a protocol-relative reference to another site.
 */
export const PushRouteSchema = z.string()
  .regex(/^\/(?![/\\])[^\s\\\x00-\x1f\x7f]*$/, {
    message: 'A push route is a same-server relative path: it starts with a single "/" and carries no scheme, host, '
      + 'backslash, whitespace or control character.',
  })
  .describe('Same-server relative path the shell opens on tap (for example /apps/crm/opportunity/123); never an absolute or off-server URL');

/** The data a push delivery carries to the shell. */
export const PushDeliveryDataSchema = lazySchema(() => z.object({
  notificationId: z.string().min(1).describe('Notification id — the one the inbox lists and markRead takes'),
  route: PushRouteSchema.optional()
    .describe('Console route opened on tap: the notification actionUrl when it is a same-server relative path, absent otherwise'),
}));
export type PushDeliveryData = z.input<typeof PushDeliveryDataSchema>;
