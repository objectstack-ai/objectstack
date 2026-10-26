/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { resolveNotificationTarget } from './appRoute.js';

/**
 * The first path segments the console serves OUTSIDE an app — the top-level
 * routes of `apps/console/src/App.tsx` (plus `/studio`, which that file mounts
 * through `studioRoutes`), the empty segment being the landing route `/`.
 * `apps` is not listed: `resolveNotificationTarget` already passes `/apps/…`
 * through as a console route.
 *
 * Why an action navigator needs the list and the inbox does not
 * (objectui#13379): a notification's `action_url` is app-relative by contract,
 * so everything the resolver does not recognise is a record. An action
 * runner's navigator is that runner's ONE navigator — `onSuccess.navigate`,
 * `type: 'url'` / `navigation` targets and `type: 'form'` all reach it — and
 * the runner itself hands it the console route `/forms/:name`
 * (`ActionRunner.executeForm`). Hosting that under an app would turn a working
 * form route into `/apps/<app>/forms/<name>`, which the app router reads as a
 * record of an object named `forms`.
 *
 * Two navigators read it: the console action runtime's
 * (`useConsoleActionRuntime`, objectui#13379) and the record page's own
 * (`RecordDetailView`, objectui#13396), whose `ActionProvider` shadows the
 * console runtime for every action on the record page.
 *
 * `useConsoleActionRuntime.onSuccessNavigateHost-13379.test.tsx` reads that
 * route table and fails on a top-level route missing here. A route a host adds
 * outside that file is not read by it.
 */
export const CONSOLE_ROOT_SEGMENTS: ReadonlySet<string> = new Set([
  '',
  'accept-invitation',
  'ai',
  'auth',
  'dev',
  'docs',
  'f',
  'forgot-password',
  'forms',
  'home',
  'login',
  'oauth',
  'organizations',
  'register',
  'reset-password',
  's',
  'set-password',
  'setup',
  'studio',
  'system',
  'verify-email',
  'verify-email-prompt',
]);

/**
 * The first segment of the form route, `/forms/:name` outside an app and
 * `/apps/:appName/forms/:name` inside one (objectui#13433). The console mounts
 * both; see {@link hostInConsolePath} for which one a hop takes.
 */
export const FORM_ROUTE_SEGMENT = 'forms';

/**
 * Where an in-place hop handed to an action navigator lands (objectui#13379).
 *
 * A rooted path that names no console route outside an app — the
 * `onSuccess: { navigate: '/crm_opportunity/${result.id}' }` shape — is
 * app-relative, and is hosted under `hostAppSegment` by the inbox's resolver,
 * `resolveNotificationTarget`, the one place that sorts the three shapes
 * (external, already `/apps/…`, app-relative). Handed to the router verbatim,
 * it matched no route under the `/_console` basename and the catch-all sent
 * the user to Home.
 *
 * Left exactly as written: a console route outside an app (see
 * {@link CONSOLE_ROOT_SEGMENTS}), and a `./` path, which react-router resolves
 * against the current route. Anything not rooted at `/` — a scheme such as
 * `mailto:` or `https:` included — is returned unchanged too.
 *
 * One console route has an in-app twin: `/forms/:name`, the page a
 * `type: 'form'` action opens (objectui#13433). Fired from inside an app, the
 * app-less route dropped the user out of the app's shell — no sidebar, no app
 * branding — onto a page that has no app to show (objectui#4109 kept it in
 * `DefaultHomeLayout` for exactly that reason). So when the caller names the
 * app its own ROUTE is under (`routeAppSegment`, the URL's `:appName`), the
 * form opens at `/apps/<app>/forms/<name>` instead, query string and hash
 * kept. The app is never inferred: `hostAppSegment` is a resolver's answer
 * (the last app the shell published, else the first active one) and is NOT
 * used for this, because a form fired from Home would then open in whichever
 * app that answer guessed. Without `routeAppSegment` the form keeps the
 * app-less route, which still serves every cold deep link.
 */
export function hostInConsolePath(
  url: string,
  hostAppSegment: string,
  routeAppSegment?: string,
): string {
  if (!url.startsWith('/')) return url;
  const firstSegment = url.slice(1).split(/[/?#]/, 1)[0];
  if (firstSegment === FORM_ROUTE_SEGMENT && routeAppSegment) {
    return `/apps/${routeAppSegment}${url}`;
  }
  if (CONSOLE_ROOT_SEGMENTS.has(firstSegment)) return url;
  const target = resolveNotificationTarget(url, hostAppSegment);
  return target?.kind === 'route' ? target.path : url;
}
