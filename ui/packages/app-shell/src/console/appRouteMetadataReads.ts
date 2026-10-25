/**
 * Which lazy metadata buckets each route under `/apps/:appName/*` reads at
 * render (objectui#12809).
 *
 * `MetadataProvider` loads `app` and `view` eagerly. `object`, `dashboard`,
 * `report` and `page` load on first read, and until they land a reader sees
 * `[]`: for most route elements that is a "not found" or an empty state, not a
 * skeleton. `AppContent` used to hold the splash until all four had loaded,
 * whatever the route. It now waits only for the buckets the CURRENT route
 * reads: the boot splash holds for them, and a later navigation to a route
 * whose buckets are not in yet shows a skeleton in the route slot.
 *
 * ⛔ A route `AppContent` declares that is missing from
 * {@link APP_ROUTE_METADATA_READS} fails `appRouteMetadataReads.test.ts`,
 * which reads the route table out of `AppContent.tsx` itself. So a new route
 * cannot skip its wait by being forgotten here; declare what its element reads.
 *
 * A route the host adds (`extraRoutes`, `extraRoutesNoApp`) is not known here,
 * so it waits for all four, the console's behaviour before this table.
 */

import { Children, Fragment, isValidElement, type ReactNode } from 'react';
import { matchRoutes } from 'react-router-dom';

export type LazyMetadataType = 'object' | 'dashboard' | 'report' | 'page';

/** Every lazy bucket: what an unknown route waits for. */
export const ALL_LAZY_METADATA_TYPES: readonly LazyMetadataType[] = ['object', 'dashboard', 'report', 'page'];

const NONE: readonly LazyMetadataType[] = [];
const OBJECT: readonly LazyMetadataType[] = ['object'];

/**
 * One row per `<Route path>` `AppContent` declares, in both of its branches
 * (paths relative to `/apps/:appName`, nested routes joined). `reads` is what
 * the route's element reads on first paint, the children it renders included.
 */
export const APP_ROUTE_METADATA_READS: ReadonlyArray<{ path: string; reads: readonly LazyMetadataType[] }> = [
  // AppRootLanding: the nav prune of `useNavMemberGates` reads `objects`.
  { path: '/', reads: OBJECT },
  // Metadata admin: the position-holder section and the form-screen preview
  // read `objects`.
  { path: 'metadata', reads: OBJECT },
  { path: 'metadata/_diagnostics', reads: OBJECT },
  { path: 'metadata/:type', reads: OBJECT },
  { path: 'metadata/:type/new', reads: OBJECT },
  { path: 'metadata/:type/:name', reads: OBJECT },
  { path: 'metadata/:type/:name/history', reads: OBJECT },
  { path: 'metadata/package/*', reads: NONE },
  // ObjectView, ObjectDataPage, RecordFormPage: the object definition.
  { path: ':objectName', reads: OBJECT },
  { path: ':objectName/new', reads: OBJECT },
  { path: ':objectName/view/:viewId', reads: OBJECT },
  { path: ':objectName/data', reads: OBJECT },
  { path: ':objectName/record/:recordId/edit', reads: OBJECT },
  // RecordDetailView: the object definition and its page assignment.
  { path: ':objectName/record/:recordId', reads: ['object', 'page'] },
  { path: ':objectName/record/:recordId/page/:pageName', reads: ['object', 'page'] },
  // DashboardView, ReportView, PageView: their own bucket and the objects
  // their widgets, columns and record actions resolve against.
  { path: 'dashboard/:dashboardName', reads: ['dashboard', 'object'] },
  { path: 'report/:reportName', reads: ['report', 'object'] },
  // AppReportIndexView (objectui#13020): the report list, and the dataset
  // list its read verdict needs, which it waits for itself; never the objects.
  { path: 'reports', reads: ['report'] },
  // A page reads the objects its page binds, through its object scope
  // (`appObjectScope.ts`, objectui#12980), not the whole registry; `object`
  // stays for the routes where the scope does not apply (a record overlay).
  { path: 'page/:pageName', reads: ['page', 'object'] },
  // ComponentNavView renders whatever component the registry holds.
  { path: 'component/:ns/:name/*', reads: ALL_LAZY_METADATA_TYPES },
  { path: 'component/metadata/directory', reads: NONE },
  { path: 'component/metadata/resource/*', reads: NONE },
  { path: 'design/dashboard/:dashboardName', reads: ['dashboard'] },
  // SearchResultsPage: record-search targets, and nav labels for dashboards.
  { path: 'search', reads: ['object', 'dashboard'] },
  // The app designer's object pickers.
  { path: 'create-app', reads: OBJECT },
  { path: 'edit-app/:editAppName', reads: OBJECT },
  { path: 'system/marketplace', reads: NONE },
  { path: 'system/marketplace/:packageId', reads: NONE },
  // A redirect: the route it lands on carries its own row.
  { path: ':objectName/:maybeRecordId', reads: NONE },
  { path: '*', reads: NONE },
];

/**
 * The `path` of every `<Route>` in a route fragment, nested paths joined and
 * an index route spelled as its parent's path.
 */
export function collectRoutePaths(node: ReactNode, parent = ''): string[] {
  const out: string[] = [];
  Children.forEach(node, (child) => {
    if (!isValidElement(child)) return;
    const props = child.props as { path?: string; index?: boolean; children?: ReactNode };
    if (child.type === Fragment) {
      out.push(...collectRoutePaths(props.children, parent));
      return;
    }
    const own = typeof props.path === 'string' ? props.path : '';
    const path = own ? (parent ? `${parent}/${own}` : own) : parent;
    if (props.index || own) out.push(path || '/');
    if (props.children) out.push(...collectRoutePaths(props.children, path));
  });
  return out;
}

/**
 * The buckets the route at `subPath` (the path below `/apps/:appName`) reads,
 * ranked the way `<Routes>` ranks them. `hostPaths` are the paths of the host's
 * extra routes, which wait for every bucket.
 */
export function metadataReadsForAppRoute(
  subPath: string,
  hostPaths: readonly string[] = [],
): readonly LazyMetadataType[] {
  const routes = [
    ...APP_ROUTE_METADATA_READS,
    ...hostPaths.map((path) => ({ path, reads: ALL_LAZY_METADATA_TYPES })),
  ];
  const matches = matchRoutes(routes, `/${subPath.replace(/^\/+/, '')}`);
  return matches ? matches[matches.length - 1].route.reads : ALL_LAZY_METADATA_TYPES;
}
