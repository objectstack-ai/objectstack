// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#30043 — what a console page shows, in the shape the chat sends
 * as `context.surface`.
 *
 * The shape is cloud#1610's, the one the spec declares as
 * `ToolExecutionContext.surfaceContext` and the agent route sanitizes field by
 * field: a Studio pillar, the artifact WITH its metadata type, a finer
 * selection inside it, and a canvas mode. ⛔ There is no second shape: the
 * console dock fills the same keys the Studio copilot fills, so one sanitizer
 * and one prompt block read both.
 *
 * The console's app routes are read off the URL, the single source of what the
 * user is looking at, so the dock (which sits beside the route, not inside it)
 * and the route element can never disagree. The route table is
 * `APP_ROUTE_METADATA_READS`, the one `AppContent` is held equal to, ranked
 * the way `<Routes>` ranks it, so a static route (`search`, `reports`) or a
 * host route never reads as an object named like it.
 *
 * Advisory only: grounding for the agent and the composer's "discussing" chip,
 * never an access decision.
 */

import { matchRoutes } from 'react-router-dom';
import { APP_ROUTE_METADATA_READS } from '../console/appRouteMetadataReads.js';

/** cloud#1610's `context.surface` — see the module doc. */
export interface ChatSurfaceContext {
  /** Studio pillar / console area. */
  pillar?: string;
  /** The artifact under discussion, with its metadata type. */
  artifact?: { type: string; name: string };
  /** A finer selection inside the artifact (a record of an object, a saved list view). */
  selection?: { kind: string; id: string };
  /** Canvas mode where applicable: 'design' | 'run'. */
  mode?: string;
}

type Params = Readonly<Record<string, string | undefined>>;

const object = (p: Params): ChatSurfaceContext | undefined =>
  p.objectName ? { artifact: { type: 'object', name: p.objectName } } : undefined;

const record = (p: Params): ChatSurfaceContext | undefined =>
  p.objectName && p.recordId
    ? { artifact: { type: 'object', name: p.objectName }, selection: { kind: 'record', id: p.recordId } }
    : undefined;

const named =
  (type: string, param: string, mode?: string) =>
  (p: Params): ChatSurfaceContext | undefined =>
    p[param] ? { artifact: { type, name: p[param] as string }, ...(mode ? { mode } : {}) } : undefined;

/**
 * The app route paths (relative to `/apps/:appName`, spelled exactly as
 * `APP_ROUTE_METADATA_READS` spells them) that show one artifact, and how
 * each one's params read as a surface. A path not listed (the app landing, a
 * component page, search, the metadata admin, a redirect) names no artifact
 * and sends no surface.
 */
export const APP_ROUTE_SURFACES: Readonly<Record<string, (p: Params) => ChatSurfaceContext | undefined>> = {
  ':objectName': object,
  ':objectName/data': object,
  ':objectName/new': object,
  ':objectName/view/:viewId': (p) => {
    const base = object(p);
    return base && p.viewId ? { ...base, selection: { kind: 'view', id: p.viewId } } : base;
  },
  ':objectName/record/:recordId': record,
  ':objectName/record/:recordId/edit': record,
  ':objectName/record/:recordId/page/:pageName': record,
  'dashboard/:dashboardName': named('dashboard', 'dashboardName'),
  'design/dashboard/:dashboardName': named('dashboard', 'dashboardName', 'design'),
  'report/:reportName': named('report', 'reportName'),
  'page/:pageName': named('page', 'pageName'),
};

/**
 * The surface the console page at `pathname` shows, or `undefined` when it
 * shows no one artifact. `pathname` is the router's (below any basename);
 * only `/apps/:appName/…` pages have one. `hostPaths` are the host's extra
 * app routes (`AppContent`'s `extraRoutes`): one that matches wins the way it
 * wins in `<Routes>`, and names no surface.
 */
export function consoleChatSurface(
  pathname: string,
  hostPaths: readonly string[] = [],
): ChatSurfaceContext | undefined {
  const segments = pathname.split('/').filter(Boolean);
  if (segments[0] !== 'apps' || segments.length < 3) return undefined;
  const routes = [
    ...APP_ROUTE_METADATA_READS.map(({ path }) => ({ path, host: false })),
    ...hostPaths.map((path) => ({ path, host: true })),
  ];
  const matches = matchRoutes(routes, `/${segments.slice(2).join('/')}`);
  const hit = matches?.[matches.length - 1];
  if (!hit || hit.route.host) return undefined;
  return APP_ROUTE_SURFACES[hit.route.path]?.(hit.params);
}
