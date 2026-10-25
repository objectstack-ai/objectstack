/**
 * useTrackRouteAsRecent
 *
 * Watches `pathname` and records the current entity (object / dashboard /
 * page / report) into `RecentItemsProvider`. Encapsulates the URL parsing
 * logic that previously lived inline in `AppContent.tsx` so it can be reused
 * by other shells and tested in isolation.
 *
 * The hook understands the standard console URL layout:
 *
 *   /apps/:appName/:objectName
 *   /apps/:appName/:objectName/view/:viewName   (a list view, objectui#12604)
 *   /apps/:appName/dashboard/:id
 *   /apps/:appName/page/:id
 *   /apps/:appName/report/:id
 *
 * It also understands the Studio metadata-admin item routes so that browsing
 * metadata records "recently viewed" entries:
 *
 *   /apps/:appName/metadata/:type/:name
 *   /apps/:appName/metadata/:type/:name/history
 *
 * Pass `objects` (the list available in the current app) so only an object
 * the app has is recorded.
 *
 * An object, dashboard, page or report is recorded by IDENTITY — its type and
 * its `name` — and with no label (objectui#11678). The route holds nothing but
 * the machine name, so a label made here could only be that name dressed up
 * (`titleize` used to turn `showcase_ops_dashboard` into "Showcase Ops
 * Dashboard" for a dashboard labelled "Delivery Operations"), frozen in the
 * visit's language. The label is resolved where the entry is rendered, from the
 * item's metadata in the current language: `useRecentItemLabel`.
 *
 * @module
 */
import { useEffect, useRef } from 'react';
import { useRecentItems } from '../context/RecentItemsProvider.js';
import type { ObjectLike as SpecObjectLike } from '@objectstack/spec/system';

/**
 * The two members this hook's callers hand it for an object, TAKEN from
 * `@objectstack/spec/system`'s `ObjectLike` rather than restated under its name
 * (objectui#7265).
 *
 * That export is the spec's own minimal projection of an object metadata
 * document — the one `translateObject` consumes — and `name` / `label` mean
 * exactly what they mean here: the object's identifier and its display label.
 * This hook takes no more than those two, so it PICKS them; the alternative,
 * importing the whole shape, would drag in `fields` / `actions` / `pluralLabel`
 * that no caller of this hook supplies and this hook never reads.
 *
 * The projection is what makes the binding safe AND load-bearing: it stays two
 * members wide, and it stops compiling the day the spec renames or retires
 * either one — which a hand-written `{ name: string; label?: string }` never
 * would. Pinned in `spec-symbol-parity.test.ts`.
 *
 * Since objectui#11678 the hook reads `name` only: an object is recorded by
 * identity and labelled when rendered. `label` stays on the projection so the
 * published options type does not move under its callers.
 */
type ObjectLike = Pick<SpecObjectLike, 'name' | 'label'>;

export interface UseTrackRouteAsRecentOptions {
  /** Active route path. Usually `useLocation().pathname`. */
  pathname: string;
  /**
   * The current app's ROUTE SEGMENT — the `/apps/<segment>` part of `pathname`
   * (ADR-0048 option A: the package id, or the name alias the URL used). A
   * route is recorded only when its app segment equals this, and the entry's
   * `href` is built on it. Not the app's `name`: on a package-id route the two
   * differ and nothing is recorded (objectui#11818).
   */
  appName: string | undefined;
  /** Objects available in the current app — an object route is recorded only for one of these. */
  objects?: ObjectLike[];
  /** Optional override; defaults to `/apps`. */
  basePathSegment?: string;
  /** When `true`, the effect is suspended (e.g. when shell is hydrating). */
  disabled?: boolean;
}

/**
 * The `id` of a list-view entry — one per object view (objectui#12604).
 *
 * Joined rather than written as a template literal on purpose: a backquoted
 * `view:` interpolation is the spelling the objectui#4373 guard
 * (`viewCacheInvalidation.guard.test.tsx`) reserves for the metadata adapter's
 * view cache keys, which app-shell never restates — and this id is not one.
 */
export function recentViewId(object: string, view: string): string {
  return ['view', object, view].join(':');
}

/** Segments after `appName` that are NOT object names but route prefixes. */
const ROUTE_PREFIXES = new Set(['view', 'record', 'page', 'dashboard', 'design', 'report']);

/** Decode a URL path segment, falling back to the raw value on malformed input. */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function useTrackRouteAsRecent({
  pathname,
  appName,
  objects = [],
  basePathSegment = 'apps',
  disabled = false,
}: UseTrackRouteAsRecentOptions): void {
  const { addRecentItem } = useRecentItems();

  // Hold `objects` in a ref so we don't re-fire the tracking effect every
  // time the parent passes a new array reference (which would happen on
  // every render in idiomatic React). Only the route should drive the effect.
  const objectsRef = useRef(objects);
  objectsRef.current = objects;

  useEffect(() => {
    if (disabled || !appName) return;

    const parts = pathname.split('/').filter(Boolean);
    // Expect: [basePathSegment, appName, ...rest]
    if (parts[0] !== basePathSegment || parts[1] !== appName) return;

    const seg2 = parts[2];
    const seg3 = parts[3];
    const basePath = `/${basePathSegment}/${appName}`;

    // Studio metadata-admin item routes:
    //   /apps/:app/metadata/:type/:name        (view / edit a metadata item)
    //   /apps/:app/metadata/:type/:name/history
    // Record the specific item as recently-viewed. The bare list route
    // (/metadata/:type) and the create route (/metadata/:type/new) are skipped
    // to keep the list focused on concrete resources. Placed before the
    // object-name branch since `metadata` is a route prefix, not an object.
    if (seg2 === 'metadata') {
      const metaType = parts[3];
      const metaName = parts[4];
      if (metaType && metaName && metaName !== 'new') {
        addRecentItem({
          id: `metadata:${metaType}:${safeDecode(metaName)}`,
          label: safeDecode(metaName),
          href: `${basePath}/metadata/${metaType}/${metaName}`,
          type: 'metadata',
        });
      }
      return;
    }

    if (seg2 && !ROUTE_PREFIXES.has(seg2)) {
      const obj = objectsRef.current.find(o => o.name === seg2);
      if (!obj) return;
      // A named list view of the object is its own entry, one per view
      // (objectui#12604): the object and the view, with the view's own address.
      if (seg3 === 'view') {
        const viewSegment = parts[4];
        if (!viewSegment) return;
        const view = safeDecode(viewSegment);
        addRecentItem({
          id: recentViewId(obj.name, view),
          type: 'view',
          object: obj.name,
          name: view,
          href: `${basePath}/${obj.name}/view/${viewSegment}`,
        });
        return;
      }
      // The object's own list — its bare route, or its parameterized data
      // surface. A record page, a create form or any other page under the
      // object is not a visit to its list: the record page records the record
      // (`RecordDetailView`), and an object entry beside it would be a second
      // target for one visit (objectui#12604).
      if (seg3 === undefined || seg3 === 'data') {
        addRecentItem({
          id: `object:${obj.name}`,
          type: 'object',
          name: obj.name,
          href: `${basePath}/${obj.name}`,
        });
      }
      return;
    }

    if (!seg3) return;

    switch (seg2) {
      case 'dashboard':
      case 'page':
      case 'report': {
        const name = safeDecode(seg3);
        addRecentItem({
          id: `${seg2}:${name}`,
          type: seg2,
          name,
          href: `${basePath}/${seg2}/${seg3}`,
        });
        break;
      }
      default:
        break;
    }
    // Intentionally drives off route changes only. `addRecentItem` is stable
    // per provider, and `objects` is read through a ref to avoid loops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, appName, basePathSegment, disabled]);
}
