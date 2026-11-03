// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Where a route the native shell hands the Console lands (objectstack#29750).
 *
 * A push delivery's `route` is the notification's `actionUrl`, the value the
 * inbox serves (`packages/spec/src/api/push-delivery.zod.ts`): app-relative
 * (`/opportunity/123`) or already a Console route (`/apps/crm/opportunity/123`).
 * The contract says the tap is resolved "as the inbox does, never verbatim",
 * and the inbox's resolver is `resolveNotificationTarget` with a host app
 * segment. Navigated verbatim, `/opportunity/123` matched no route and the
 * catch-all dropped the person on Home.
 *
 * Two sites resolve it, both through that one resolver:
 *
 * - the native navigate listener (`NativeShellRouting` in `App.tsx`), when it
 *   can name the host app: {@link nativeShellRouteTarget};
 * - the unmatched-route guard (`components/UnmatchedRoute.tsx`), for everything
 *   else: an app-relative path arriving as the page's first URL (the shell
 *   re-creates its WebView at a held route, or full-loads it when no listener
 *   answered), and a route the listener handed over because it could not name
 *   the app. {@link isAppRelativeUnmatchedPath} decides which unmatched paths
 *   are hosted.
 *
 * @module
 */
import {
  CONSOLE_ROOT_SEGMENTS,
  resolveHostAppSegment,
  resolveNotificationTarget,
} from '@object-ui/app-shell';

/** The app records `resolveHostAppSegment` reads, derived from its signature. */
type HostApps = Parameters<typeof resolveHostAppSegment>[0];

/**
 * The path the native navigate listener moves the router to, or `null` to stay
 * where the person is.
 *
 * `hostHint` is the app the person is in or last had open: the shell's
 * published `currentAppName`, else the `:appName` of the current URL, the same
 * hint every inbox door passes. `apps` is whatever app list is in reach; the
 * listener renders outside every `MetadataProvider`, so there it is the empty
 * list, and `resolveHostAppSegment` then answers the hint itself (its step 3).
 *
 * - No hint: the route as given. Nothing in reach can name the default app
 *   (that needs the app list), so the route goes to the router unchanged and
 *   the unmatched-route guard, which waits for the list, hosts it there. A
 *   Console route (`/apps/…`, `/home`, …) simply matches its own route.
 * - A hint: `resolveNotificationTarget(route, segment)`. A `route` answer is
 *   the path; `null` (no url) and `external` (a scheme or `//host`) are
 *   `null`, so nothing moves. Neither is reachable through the listener: the
 *   shell's event is only taken (and cancelled) for an `isInAppRoute` path,
 *   which is never blank and never carries a scheme or a second leading `/`.
 */
export function nativeShellRouteTarget(
  route: string,
  hostHint: string | null | undefined,
  apps: HostApps,
): string | null {
  if (!hostHint) return route;
  const target = resolveNotificationTarget(route, resolveHostAppSegment(apps, hostHint));
  return target?.kind === 'route' ? target.path : null;
}

/**
 * Is an unmatched pathname app-relative, so the catch-all hosts it under an app
 * instead of redirecting to `/`?
 *
 * Yes unless its first segment names a Console route served outside an app
 * (`CONSOLE_ROOT_SEGMENTS`, the empty segment included) or is `apps`, which
 * `resolveNotificationTarget` passes through unchanged and so has nothing to
 * host. Those keep the catch-all's redirect to `/`: an unknown `/dev/x` or
 * `/home/x` is a stale Console link, not a record.
 */
export function isAppRelativeUnmatchedPath(pathname: string): boolean {
  if (!pathname.startsWith('/')) return false;
  const firstSegment = pathname.slice(1).split('/', 1)[0];
  return firstSegment !== 'apps' && !CONSOLE_ROOT_SEGMENTS.has(firstSegment);
}
