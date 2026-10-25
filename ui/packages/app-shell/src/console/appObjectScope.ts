/**
 * Which objects an app route reads (objectui#12811).
 *
 * Reading `useMetadata().objects` loads the whole object registry
 * (`GET /api/v1/meta/object`). On the routes {@link APP_OBJECT_SCOPE_ROUTES}
 * names, inside an app whose served item carries its package, the route and
 * the chrome around it read the app's object scope instead
 * (`MetadataContextValue.readObjectScope`): the package's objects, plus by
 * name the route's object and its lookup targets when the package does not
 * hold them, the objects the app's navigation and area entries require
 * (`requiresObject`), and the navigation's objects while the command palette
 * is open.
 *
 * A page (`page/:pageName`, objectui#12980) reads only the objects its page
 * definition binds ({@link pageObjectNames}), by name, beside the app's
 * package list when the app names a package and as the names-only scope when
 * it does not; never the whole registry, whatever its package holds. An object
 * a block names outside that set is read by name when the block asks for it
 * (`PageView`).
 *
 * An object's list in an app whose package holds no objects of its own
 * (objectui#13046: cloud's control-plane app, whose package ships only the
 * app, and Setup, whose every entry opens another package's object) reads the
 * same names by name once the package list has answered empty: the route's
 * object, its lookup targets and the app's `requiresObject` entries, never the
 * whole registry. Only the route's object holds the route. The app's ROOT in
 * such a package keeps the whole registry: measured on Setup's landing, asking
 * the entries' objects by name cost a request each and the landing loaded the
 * whole registry anyway (objectui#12811).
 *
 * A record route (`:objectName/record/:recordId`, and its named-page sibling)
 * whose record page is declared as a full page reads the objects that page
 * binds, by name, the way a page route does (objectui#13046), once the page
 * list has answered; the page it picks is the page `RecordDetailView` renders
 * (`usePageAssignment`'s choice). A record route with no declared record page,
 * or a slotted one, reads the whole registry: its synthesized page derives
 * the related lists from every object that points at the record's object, in
 * any package.
 *
 * Everywhere else the route reads the whole registry, as before. For the
 * related lists' reason a record overlay (`?recordId=`, `?form=`) reads the
 * whole registry, and so does a list whose views open records in an in-page
 * overlay the URL does not carry (`modal`, `split`, `popover`). An app item
 * without a package id has no package to scope by.
 *
 * Two readers ask the same question with the same answer: `AppContent`, which
 * renders the route, and the console root (`ConsoleShell`), which asks it as
 * soon as the app list lands, so the scope loads beside the session's
 * permission read rather than after it, as the whole list used to.
 */

import { matchRoutes, useLocation } from 'react-router-dom';
import { isRecordPageOf, useMetadata, type MetadataContextValue } from '@object-ui/react';
import { defaultRecordPageObject } from '@objectstack/spec/ui';
import { APP_ROUTE_METADATA_READS } from './appRouteMetadataReads.js';
import { matchAppBySegment } from '../utils/appRoute.js';
import { COMMAND_PALETTE_PARAM, RECORD_DRAWER_PARAM, RECORD_FORM_OBJECT_PARAM, RECORD_FORM_PARAM } from '../urlParams.js';

type ReadObjectScope = NonNullable<MetadataContextValue['readObjectScope']>;
export type AppObjectScope = ReturnType<ReadObjectScope>;

/**
 * objectui#13052 — what this package's `MetadataProvider` adds to a scope read
 * beside the published shape, a package-local hand-off between it and this
 * module: `failed`, the asked names whose by-name read obtained no answer
 * (reported once nothing else is in flight; `settled` stays false for them),
 * and `refused`, each refused name in `missing` with its ADR-0112 code. A
 * provider that does not carry them (a test double, a host's own) reads as
 * none, which is the behaviour before this card.
 */
interface ScopeReadOutcomes {
  failed?: readonly string[];
  refused?: Readonly<Record<string, string>>;
}

function failedNamesOf(scope: AppObjectScope): readonly string[] {
  return (scope as AppObjectScope & ScopeReadOutcomes).failed ?? [];
}

function refusalOf(scope: AppObjectScope, name: string | undefined): AppObjectScopeRead['routeObjectRefusal'] {
  if (!name || !scope.missing.includes(name)) return null;
  const code = (scope as AppObjectScope & ScopeReadOutcomes).refused?.[name];
  return code ? { objectName: name, code } : null;
}

/**
 * Whether the route may render on this read of the names it waits for: they
 * answered, or their reads failed and nothing else is in flight (objectui#13052:
 * a failed read settles the route, which draws the failure, never the splash).
 */
function routeReadDone(scope: AppObjectScope): boolean {
  return scope.settled || failedNamesOf(scope).length > 0;
}

/**
 * The routes under `/apps/:appName` whose element, and the chrome around it,
 * read the app's object scope: the app's root (its landing reads only the
 * navigation's gates), an object's list, a page, and a record (objectui#13046:
 * the objects its declared record page binds). Paths as
 * `APP_ROUTE_METADATA_READS` spells them, and matched against that table, so a
 * more specific route (`search`, `create-app`, a host route) is never taken
 * for `:objectName`.
 */
export const APP_OBJECT_SCOPE_ROUTES: readonly string[] = [
  '/',
  ':objectName',
  ':objectName/view/:viewId',
  'page/:pageName',
  ':objectName/record/:recordId',
  ':objectName/record/:recordId/page/:pageName',
];

function matchObjectScopeRoute(
  subPath: string,
  hostPaths: readonly string[],
): { objectName?: string; pageName?: string; recordId?: string } | null {
  const routes = [...APP_ROUTE_METADATA_READS.map(({ path }) => ({ path })), ...hostPaths.map((path) => ({ path }))];
  const matches = matchRoutes(routes, `/${subPath.replace(/^\/+/, '')}`);
  const match = matches?.[matches.length - 1];
  if (!match || !APP_OBJECT_SCOPE_ROUTES.includes(match.route.path)) return null;
  return { objectName: match.params.objectName, pageName: match.params.pageName, recordId: match.params.recordId };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

type BlockObjectArms = (props: Record<string, unknown>) => unknown[];

/**
 * The object names a block's own renderer reads off its `properties` bag,
 * beyond the `objectName` and data-source arms every block shares
 * (objectui#12980). Keyed by the spec's block type; each reads what its
 * renderer reads as an object, and nothing else:
 *
 *  - `element:metadata_viewer` — `object`, which the state-machine view reads
 *    by name (`useMetadataItem('object', object)`); the flow and permission
 *    views do not read it.
 *  - `record:line_items` — `childObject`, the object whose rows the panel
 *    lists and whose schema it reads, and `parentObject`, the object the
 *    panel's save writes the parent leg to.
 *
 * ⛔ `record:related_list`'s `add.picker.object` is not here: the panel reads
 * it only once the user opens the picker, never while the page renders, so
 * collecting it would hold the route on a read its open does not use.
 */
const BLOCK_OBJECT_ARMS: ReadonlyMap<string, BlockObjectArms> = new Map<string, BlockObjectArms>([
  ['element:metadata_viewer', (props) => (props.type === 'state_machine' ? [props.object] : [])],
  ['record:line_items', (props) => [props.childObject, props.parentObject]],
]);

/**
 * The objects a page definition binds (objectui#12980), derived from the page
 * itself, never listed by hand: the page's own `object` (a record page), its
 * interface source (`interfaceConfig.source`), and, at any depth of its
 * regions and blocks, every `objectName`, every `dataSource.object` and
 * `parentDataSource.object` (`ElementDataSourceSchema`), every `data.object`
 * of the `ViewDataSchema` object arm (`data: { provider: 'object', object }`,
 * the record source the `object-*` blocks resolve first), and the object arms
 * a block's renderer reads off its `properties` ({@link BLOCK_OBJECT_ARMS}).
 * Only a string names an object: an expression envelope or any other value
 * binds none, and neither does an `api` data source. A block that names an
 * object some other way reads it by name when it asks (`PageView`).
 */
export function pageObjectNames(page: unknown): string[] {
  const out = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value === 'string' && value) out.add(value);
  };
  const walk = (node: unknown, key: string | undefined) => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item, key);
      return;
    }
    if (!isRecord(node)) return;
    add(node.objectName);
    if (key === 'dataSource' || key === 'parentDataSource') add(node.object);
    if (key === 'interfaceConfig') add(node.source);
    // `data` as one config object, never an array of pre-fetched records.
    if (isRecord(node.data) && node.data.provider === 'object') add(node.data.object);
    const arms = typeof node.type === 'string' ? BLOCK_OBJECT_ARMS.get(node.type) : undefined;
    if (arms && isRecord(node.properties)) arms(node.properties).forEach(add);
    for (const [childKey, child] of Object.entries(node)) walk(child, childKey);
  };
  if (page && typeof page === 'object') add((page as Record<string, unknown>).object);
  walk(page, undefined);
  return [...out];
}

/** No objects, and nothing to wait for: a page that binds none, in an app with no package. */
const NO_OBJECT_SCOPE: AppObjectScope = Object.freeze({
  objects: [],
  served: [],
  missing: [],
  settled: true,
}) as unknown as AppObjectScope;

/** The page has not landed yet: nothing is known, and nothing is read. */
const PENDING_OBJECT_SCOPE: AppObjectScope = Object.freeze({
  objects: [],
  served: [],
  missing: [],
  settled: false,
}) as unknown as AppObjectScope;

/** The page definition a page route resolves to, and whether the `page` type has answered. */
export interface PageRead {
  page: unknown;
  settled: boolean;
}

/**
 * The objects a page reads (objectui#12980): the names it binds, plus
 * `extraNames` (the chrome's, or what a block asked for), by name. In an app
 * that names a package they ride its scope, so the package list the chrome
 * reads anyway is read once; without one they are the names-only scope. No
 * name at all, and no package, reads nothing. `ready` is true once the page's
 * own objects have answered; the extras and the lookup targets of the page's
 * objects are asked beside them and not waited for.
 */
export function readPageObjectScope(
  readObjectScope: ReadObjectScope,
  app: Record<string, any> | undefined,
  page: unknown,
  extraNames: readonly string[] = [],
): { scope: AppObjectScope; ready: boolean; failedNames: readonly string[] } {
  const packageId = typeof app?._packageId === 'string' && app._packageId ? app._packageId : undefined;
  const read = (names: readonly string[]): AppObjectScope =>
    packageId ? readObjectScope({ packageId, names }) : names.length > 0 ? readObjectScope({ names }) : NO_OBJECT_SCOPE;
  const bound = pageObjectNames(page);
  const boundRead = read(bound);
  const ready = routeReadDone(boundRead);
  const names = [...new Set([...bound, ...extraNames])];
  const first = read(names);
  const lookups = bound.flatMap((name) => lookupTargetNames(first.objects.find((o: any) => o?.name === name)));
  return {
    scope: lookups.length > 0 ? read([...new Set([...names, ...lookups])]) : first,
    ready,
    failedNames: failedNamesOf(boundRead),
  };
}

/** The page list, and whether the `page` type has answered (objectui#13046). */
export interface PagesRead {
  pages: readonly unknown[];
  settled: boolean;
}

/**
 * The record page a record route of `objectName` renders (objectui#13046), as
 * `RecordDetailView` picks it through `usePageAssignment`: the page the route
 * names, when it is a record page of the object; otherwise the object's
 * default record page (`defaultRecordPageObject`), else its first record page.
 * Only a full page is returned. A slotted page, or none, returns `null`: the
 * view synthesizes that page, and derives its related lists from every object
 * that points at the record's object.
 */
function declaredRecordPage(pages: readonly unknown[], objectName: string, pageName: string | undefined): unknown {
  const page = pageName
    ? pages.find((p) => isRecord(p) && p.name === pageName && isRecordPageOf(p, objectName))
    : (() => {
        const candidates = pages.filter((p) => isRecordPageOf(p, objectName));
        return candidates.find((p) => defaultRecordPageObject(p) === objectName) ?? candidates[0];
      })();
  return isRecord(page) && page.kind !== 'slotted' ? page : null;
}

/** A record overlay the URL carries: the detail drawer, or the record form. */
function hasRecordOverlay(search: string): boolean {
  const sp = new URLSearchParams(search);
  return sp.has(RECORD_DRAWER_PARAM) || sp.has(RECORD_FORM_PARAM) || sp.has(RECORD_FORM_OBJECT_PARAM);
}

const IN_PAGE_RECORD_OVERLAYS = new Set(['modal', 'split', 'popover']);

/**
 * Whether a list of this object opens a record in an overlay the URL does not
 * carry: `ObjectView` mounts `RecordDetailView` inside it with the list's
 * objects, so such a list reads the whole registry.
 */
function opensRecordsInPageOverlay(def: any): boolean {
  const views = [def?.list, ...Object.values((def?.listViews ?? {}) as Record<string, any>)];
  return views.some((view) => IN_PAGE_RECORD_OVERLAYS.has(view?.navigation?.mode));
}

/** The objects an object's lookup and master-detail fields point at. */
function lookupTargetNames(def: any): string[] {
  const fields = def?.fields;
  const defs: any[] = Array.isArray(fields) ? fields : Object.values((fields ?? {}) as Record<string, any>);
  const out = new Set<string>();
  for (const field of defs) {
    if ((field?.type === 'lookup' || field?.type === 'master_detail') && typeof field.reference === 'string' && field.reference) {
      out.add(field.reference);
    }
  }
  return [...out];
}

/** The names a navigation tree carries under `key` on its entries, at every group depth. */
export function navigationNames(navigation: unknown, pick: (item: Record<string, unknown>) => unknown): string[] {
  const out: string[] = [];
  const walk = (items: unknown) => {
    if (!Array.isArray(items)) return;
    for (const item of items as Array<Record<string, unknown>>) {
      const name = item ? pick(item) : undefined;
      if (typeof name === 'string' && name) out.push(name);
      walk(item?.children);
    }
  };
  walk(navigation);
  return out;
}

/**
 * The objects an app's entries require (`requiresObject`), in its `navigation`
 * and in every `areas[].navigation`: the sidebar draws and gates both
 * (objectui#12980), so an area entry requiring an object outside the package
 * is asked by name and answered exactly.
 */
function appRequiredObjectNames(app: Record<string, unknown> | undefined): string[] {
  const pick = (item: Record<string, unknown>) => item.requiresObject;
  const areas: unknown[] = Array.isArray(app?.areas) ? app.areas : [];
  return [
    ...navigationNames(app?.navigation, pick),
    ...areas.flatMap((area) => navigationNames(isRecord(area) ? area.navigation : undefined, pick)),
  ];
}

export interface AppObjectScopeRead {
  /** The route reads a scope when its app names a package: an app route on the scope list, no record overlay. */
  candidate: boolean;
  /** The app's object scope, or `null` when this route reads the whole registry. */
  scope: AppObjectScope | null;
  /**
   * The route can render: the package list and the route's own object have
   * answered. The other names (lookup targets, required objects, the
   * palette's) are asked beside it, not waited for: until they land, a lookup
   * cell draws its value without a link, and a `requiresObject` entry stays
   * shown, as it did while the whole list loaded. A route object whose read
   * failed counts as answered here (objectui#13052): see `failedNames`.
   */
  ready: boolean;
  /**
   * objectui#13052 — the names the route waits for (its object, or the
   * objects its page binds) whose by-name read obtained no answer. The route
   * draws its failed-read state for them, with a Retry that asks them again.
   */
  failedNames: readonly string[];
  /**
   * objectui#13052 — the ADR-0112 code the server refused the route's own
   * object with, when it answered with a refusal rather than a plain absence
   * (`OBJECT_PACKAGE_DISABLED`); `null` otherwise.
   */
  routeObjectRefusal: { objectName: string; code: string } | null;
}

const NOT_READ = { failedNames: [] as readonly string[], routeObjectRefusal: null };

/**
 * The object scope the route at `subPath` (below `/apps/:appName`) reads, in
 * `app`. Reading it starts what it needs (see `readObjectScope`).
 */
export function readAppObjectScope(
  readObjectScope: ReadObjectScope | undefined,
  app: Record<string, any> | undefined,
  subPath: string,
  search: string,
  hostPaths: readonly string[] = [],
  readPage?: (pageName: string) => PageRead,
  readPages?: () => PagesRead,
): AppObjectScopeRead {
  const route = matchObjectScopeRoute(subPath, hostPaths);
  const candidate = !!route && !!readObjectScope && !hasRecordOverlay(search);
  const packageId = typeof app?._packageId === 'string' && app._packageId ? app._packageId : undefined;
  if (candidate && readObjectScope && route && route.recordId !== undefined && route.objectName) {
    // objectui#13046 — a record route: the app list, then the page list, then
    // either the objects the record's declared page binds, by name, or the
    // whole registry. Nothing is read while the page list is out: a route that
    // turns out to have no declared page asks exactly what it asked before.
    if (!app) return { candidate, scope: null, ready: false, ...NOT_READ };
    const pagesRead = readPages?.();
    if (!pagesRead?.settled) return { candidate, scope: PENDING_OBJECT_SCOPE, ready: false, ...NOT_READ };
    const page = declaredRecordPage(pagesRead.pages, route.objectName, route.pageName);
    if (!page) return { candidate, scope: null, ready: false, ...NOT_READ };
    const extra = [route.objectName, ...appRequiredObjectNames(app)];
    if (new URLSearchParams(search).has(COMMAND_PALETTE_PARAM)) {
      extra.push(...navigationNames(app.navigation, (item) => (item.type === 'object' ? item.objectName : undefined)));
    }
    return { candidate, ...readPageObjectScope(readObjectScope, app, page, extra), routeObjectRefusal: null };
  }
  if (candidate && readObjectScope && route && route.pageName !== undefined) {
    // objectui#12980 — a page route: the app list first (it names the
    // package), then the page, then the objects the page binds.
    if (!app) return { candidate, scope: null, ready: false, ...NOT_READ };
    const pageRead = readPage?.(route.pageName);
    if (!pageRead?.page) {
      // Not landed: the package list starts beside the page. Landed without
      // the page: `PageView` draws its not-found, and reads no object.
      if (pageRead?.settled) return { candidate, scope: NO_OBJECT_SCOPE, ready: true, ...NOT_READ };
      return { candidate, scope: packageId ? readObjectScope({ packageId }) : PENDING_OBJECT_SCOPE, ready: false, ...NOT_READ };
    }
    const extra = appRequiredObjectNames(app);
    if (new URLSearchParams(search).has(COMMAND_PALETTE_PARAM)) {
      extra.push(...navigationNames(app.navigation, (item) => (item.type === 'object' ? item.objectName : undefined)));
    }
    return { candidate, ...readPageObjectScope(readObjectScope, app, pageRead.page, extra), routeObjectRefusal: null };
  }
  if (!candidate || !packageId || !readObjectScope || !route) return { candidate, scope: null, ready: false, ...NOT_READ };
  // The package list first: no name is asked until it has answered.
  const own = readObjectScope({ packageId });
  if (!own.settled) return { candidate, scope: own, ready: false, ...NOT_READ };
  // objectui#13046 — a package that holds no objects of its own: an object's
  // route reads its names by name all the same, below; the app's root keeps the
  // whole registry (the header says why).
  if (!route.objectName && !own.served.some((o: any) => o?._packageId === packageId)) {
    return { candidate, scope: null, ready: false, ...NOT_READ };
  }
  const routeRead = readObjectScope({ packageId, names: route.objectName ? [route.objectName] : [] });
  const ready = routeReadDone(routeRead);
  const routeOutcome = { failedNames: failedNamesOf(routeRead), routeObjectRefusal: refusalOf(routeRead, route.objectName) };
  // The objects the app's own navigation entries require, in its `navigation`
  // and its `areas`: the sidebar's capability gate answers from this scope.
  const names = appRequiredObjectNames(app);
  if (route.objectName) names.push(route.objectName);
  if (new URLSearchParams(search).has(COMMAND_PALETTE_PARAM)) {
    names.push(...navigationNames(app?.navigation, (item) => (item.type === 'object' ? item.objectName : undefined)));
  }
  const first = readObjectScope({ packageId, names });
  const routeDef = route.objectName ? first.objects.find((o: any) => o?.name === route.objectName) : undefined;
  if (routeDef && opensRecordsInPageOverlay(routeDef)) return { candidate, scope: null, ready: false, ...NOT_READ };
  const lookups = routeDef ? lookupTargetNames(routeDef) : [];
  return {
    candidate,
    scope: lookups.length > 0 ? readObjectScope({ packageId, names: [...names, ...lookups] }) : first,
    ready,
    ...routeOutcome,
  };
}

/**
 * The console root's half: on an app route, start the app's object scope as
 * soon as the app list names the app, before `AppContent` mounts (it mounts
 * below the session's permission read). It reads nothing else and renders
 * nothing; `AppContent` reads the same scope entry when it renders.
 */
export function useAppObjectScopePrefetch(): void {
  const { apps, readObjectScope } = useMetadata();
  const { pathname, search } = useLocation();
  const segments = pathname.split('/').filter(Boolean);
  if (segments[0] !== 'apps' || !segments[1] || !readObjectScope) return;
  const app = matchAppBySegment(apps, segments[1]);
  if (app) readAppObjectScope(readObjectScope, app, segments.slice(2).join('/'), search);
}
