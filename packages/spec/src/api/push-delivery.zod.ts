// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { lazySchema } from '../shared/lazy-schema';

/**
 * Push delivery data — what a push carries to the shell.
 *
 * The shell reads it when the user taps the push: `notificationId` names the
 * notification (the same id the inbox lists and `markRead` takes), and
 * `route` is the notification's `actionUrl`, the link the inbox serves for it.
 *
 * **Where it sits in the vendor payload.** ADR-0012 §8 names it the `data`
 * member of the push renderer's output; that is the renderer's shape, not the
 * vendor payload. On FCM (HTTP v1) these members go in `message.data`, a map
 * of string values. On APNs they sit at the top level of the payload, beside
 * `aps`, and never under a `data` key.
 *
 * **Declared ahead of its producer.** No push channel delivers yet, so
 * nothing produces this data today; {@link PushDeliveryDataSchema} carries a
 * `[PLANNED — not yet served]` marker in its `.describe()` until the push
 * channel ships. The route rule below is the contract that channel owes.
 *
 * **What `route` is — the inbox's `actionUrl`, derived, never authored.**
 * There is no `notify` key for it. It is the value the inbox already serves:
 * an explicit `url` / `actionUrl` in the notification's payload, else
 * `/OBJECT/ID` built from the notification's source record, else none. So it
 * is either app-relative (`/opportunity/123`) or already a Console route
 * (`/apps/crm/opportunity/123`). When that value passes
 * {@link PushRouteSchema} the push carries it as `route`; when it does not
 * (an absolute URL to another site, say) or there is none, the push carries
 * no `route` and the tap opens the shell's default screen. The delivery is
 * never failed for it.
 *
 * **The shell never navigates it verbatim.** On tap it resolves `route`
 * exactly as the inbox bell and Home do for the same notification: through
 * `resolveNotificationTarget` (`ui/packages/app-shell/src/utils/appRoute.ts`)
 * with its host app segment, which hosts an app-relative path under
 * `/apps/APP/` and passes an `/apps/…` route through. One resolver, so a
 * push and the inbox row open the same screen.
 *
 * A shell with no app list of its own (a native shell that has not loaded
 * the Console's catalog, say) does not guess either. It hands `route` to the
 * Console to resolve, or hosts it under the segment the Console would answer
 * (`resolveHostAppSegment` in the same file: the preferred app the user last
 * had open, re-checked against the active apps, then the first active app,
 * then `setup`). It never re-implements the resolver and never opens `route`
 * verbatim.
 *
 * Not to be confused with the `PushNotificationSchema` that `system/` once
 * declared and then removed (ADR-0049): that was an authoring template shape;
 * this is the wire data of a delivery, produced by the platform.
 */

/**
 * A same-server relative path: it starts with exactly one `/`, so it carries
 * no scheme and no host, and it contains no backslash, whitespace or control
 * character — a URL parser reads `\` as `/` and strips tab and newline, which
 * would turn `/\host` — or `/`, a tab, then `/host` — into a
 * protocol-relative reference to another site.
 *
 * Its path (the part before any `?` or `#`) also carries no dot segment (`.`
 * or `..`), no percent-encoded `/`, `\` or `.` (`%2F`, `%5C`, `%2E`, either
 * case) and no encoded `%` (`%25`), which closes the double-encoded forms
 * (`%252F`, `%252E`, `%255C`): a router that normalises or decodes the path,
 * once or more, would move it somewhere the notification did not point. A
 * path that needs a literal `%` is refused with them, so its push carries no
 * `route` and the tap opens the shell's default screen. Both rules are
 * patterns, so the published JSON Schema carries them too. A query or
 * fragment keeps its own encoding.
 */
export const PushRouteSchema = z.string()
  .regex(/^\/(?![/\\])[^\s\\\x00-\x1f\x7f]*$/, {
    message: 'A push route is a same-server relative path: it starts with a single "/" and carries no scheme, host, '
      + 'backslash, whitespace or control character.',
  })
  .regex(/^(?![^?#]*(?:\/\.\.?(?:[/?#]|$)|%(?:2[eEfF]|5[cC]|25)))/, {
    message: 'A push route path carries no dot segment ("." or "..") and no percent-encoded "/", "\\", "." or "%" '
      + '(%2F, %5C, %2E, %25): a router that normalises or decodes the path would open somewhere else.',
  })
  .describe(
    'The notification actionUrl as a same-server relative path: app-relative (/opportunity/123) or a Console route '
    + '(/apps/crm/opportunity/123). The shell resolves it on tap as the inbox does, never verbatim; never an absolute or '
    + 'off-server URL',
  );
export type PushRoute = z.input<typeof PushRouteSchema>;

/** The data a push delivery carries to the shell. */
// The marker comes off when the push channel (#29041) produces this data.
export const PushDeliveryDataSchema = lazySchema(() => z.object({
  notificationId: z.string().min(1).describe('Notification id — the one the inbox lists and markRead takes'),
  route: PushRouteSchema.optional().describe(
    'The notification actionUrl, the value the inbox serves, when it is a same-server relative path; absent otherwise. '
    + 'The shell resolves it on tap as the inbox bell and Home do, never verbatim',
  ),
}).describe(
  '[PLANNED — not yet served] The data a push delivery carries to the shell: the notification id and its actionUrl as a '
  + 'same-server route. No push channel delivers yet',
));
export type PushDeliveryData = z.input<typeof PushDeliveryDataSchema>;
