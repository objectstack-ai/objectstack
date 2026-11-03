// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * UnmatchedRoute — element for the Console's catch-all `<Route path="*" />`.
 *
 * A path no route matches used to go straight to `/`. That is still the answer
 * for a stale Console link (`/dev/x`, `/home/x`): see
 * `isAppRelativeUnmatchedPath`. An APP-RELATIVE path is a record the person was
 * sent to, and dropping it on Home loses it (objectstack#29750): a push route
 * such as `/opportunity/123` arrives here as the page's first URL when the
 * mobile shell re-creates its WebView at a held route, or full-loads it because
 * no navigate listener answered; and the Console's own navigate listener hands
 * a route over here when it cannot name the host app (a cold start, before any
 * app opened).
 *
 * Such a path is hosted the way the inbox hosts a notification's link:
 * `resolveNotificationTarget(path, resolveHostAppSegment(apps, currentAppName))`
 * — the app the person is in or last had open, re-checked against the active
 * apps, else the first active app. That needs the app list, so the hop runs
 * under `ProtectedRoute` (`requireOrganization={false}`, like `/`, because it
 * only redirects; the destination's route owns the organization gate) and
 * waits until the list has settled (`isAppListConclusive`, the landing
 * route's own reading). A signed-out visitor goes to the login page first and
 * comes back to the same path. An app list that failed to load is no answer
 * to host under; that case keeps the old redirect to `/`, whose landing
 * resolver owns the retry.
 */
import { useLocation } from 'react-router-dom';
import {
  LoadingFallback,
  RedirectWithSplash,
  resolveHostAppSegment,
  resolveNotificationTarget,
  useMetadata,
  useNavigationContext,
} from '@object-ui/app-shell';
import { ProtectedRoute } from './ProtectedRoute';
import { isAppListConclusive } from './RootLandingRedirect';
import { isAppRelativeUnmatchedPath } from '../nativeShellRoute';

export function UnmatchedRoute() {
  const location = useLocation();
  if (!isAppRelativeUnmatchedPath(location.pathname)) {
    return <RedirectWithSplash to="/" replace />;
  }
  return (
    <ProtectedRoute requireOrganization={false}>
      <HostAppRelativeRedirect />
    </ProtectedRoute>
  );
}

function HostAppRelativeRedirect() {
  const location = useLocation();
  const { apps, loading, getTypeStatus } = useMetadata();
  const { currentAppName } = useNavigationContext();
  // The list is the answer only once it settled: a session-cached list keeps
  // `loading` false while its re-read is still in flight (status `loading`),
  // and hosting under it then could name an app the re-read drops.
  const status = getTypeStatus?.('app');
  if (status === 'error') return <RedirectWithSplash to="/" replace />;
  if (loading || !isAppListConclusive(status)) return <LoadingFallback />;
  const target = resolveNotificationTarget(
    `${location.pathname}${location.search}${location.hash}`,
    resolveHostAppSegment(apps, currentAppName),
  );
  return <RedirectWithSplash to={target?.kind === 'route' ? target.path : '/'} replace />;
}
