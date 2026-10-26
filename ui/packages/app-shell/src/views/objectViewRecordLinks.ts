/**
 * The record links the Console `ObjectView` (`./ObjectView.tsx`) list page
 * publishes, moved out of that file verbatim (objectstack#25992, slice 1).
 * `ObjectView.tsx` re-exports every name it exported before.
 */

import type { RelatedRecordActionsValue, RelatedRecordHandlers } from '@object-ui/react';
import { appRecordPath, routableObjectNames } from './RelatedRecordActionsBridge.js';
import { documentHref } from './documentHref.js';

/**
 * THE record-detail URL this list surface builds — one route shape, one place.
 *
 * Derived from the LIST's own pathname rather than re-assembled from route
 * params, because that is what the "open in new window" navigation action has
 * always used here: strip a trailing `/view/:viewId` and append
 * `/record/:recordId`. It therefore works wherever this page is mounted, and —
 * more to the point — every affordance that opens a record in a new tab from
 * this page addresses the SAME URL by construction.
 *
 * Since objectui#4490 it also backs the href the list's link column publishes
 * through {@link RelatedRecordActionsValue.recordHref}, so the anchor a user
 * middle-clicks and the tab the row's ⌘-click opens cannot drift apart.
 *
 * Exported for the pin test.
 */
export function listRecordDetailUrl(pathname: string, recordId: string | number): string {
    const basePath = pathname.replace(/\/view\/.*$/, '');
    return `${basePath}/record/${encodeURIComponent(String(recordId))}`;
}

/** No related-list handlers — see {@link listRecordActionsValue}. */
const NO_RELATED_HANDLERS: RelatedRecordHandlers = Object.freeze({});

/**
 * What the object LIST page publishes on `RelatedRecordActionsContext`
 * (objectui#4490).
 *
 * `RelatedRecordActionsProvider` was mounted only on the record DETAIL body
 * (by `RelatedRecordActionsBridge`), which is why PR #4489's real anchors
 * reached lookup values there and the list page's own `link: true` column was
 * left with a click-only `span role="link"`. The list host publishes the same
 * pair here, so `LinkCell` can render a real anchor without knowing anything
 * about routes — one mechanism, all three surfaces.
 *
 * One deliberate limit:
 *
 *  - **`resolve` returns no handlers.** This surface has no related lists — a
 *    list page's rows are not a child collection — so there is nothing to
 *    resolve. An empty handler set is exactly what the context documents as
 *    "capability unavailable", i.e. the same read-only outcome a consumer gets
 *    with no provider at all, so nothing that renders under this page gains an
 *    affordance it did not have.
 *
 * **Any routable object, through the record page's builder (objectui#12673).**
 * A lookup cell or a record-pointer (`referenceVia`) cell names a record of
 * ANOTHER object, and the list used to answer `null` for it, so the name was
 * readable and could not be opened. With `routes` the list now answers those
 * the way the record page's `RelatedRecordActionsBridge` does, through the
 * same builder (`appRecordPath` over `routableObjectNames`, both exported by
 * the bridge): `/apps/:app/:object/record/:id`, published as a document href
 * (`documentHref`) so a new tab or a copied link carries the router's
 * basename, and navigated by its router path on a plain click. A list page
 * has no parent record, so no `?from=` trail entry is added. An object this
 * console cannot route to still answers `null`, which consumers render as the
 * plain value, so no link points at a page that would refuse.
 *
 * The listed object itself keeps its own route: {@link listRecordDetailUrl}
 * derived from the current pathname, opened through the page's own record
 * navigation (which carries the list as the record's origin). Without
 * `routes`, only that object is addressable, as before.
 *
 * `pathname` is read at CALL time (not captured) so a view switch or a drill-in
 * cannot leave a stale base behind — the same freshness rule the bridge's
 * builder documents for its `?from=` trail.
 *
 * Exported for the pin test.
 */
export function listRecordActionsValue(
    objectName: string,
    openRecordPage: (recordId: string | number) => void,
    getPathname: () => string = () => window.location.pathname,
    routes?: ListRecordRoutes,
): RelatedRecordActionsValue {
    const hasId = (recordId: string | number) => recordId != null && recordId !== '';
    const routable = routes ? routableObjectNames(routes.objects) : null;
    /** The router path of another object's record, or `null` when unroutable. */
    const otherRecordPath = (targetObjectName: string, recordId: string | number): string | null =>
        routes && routable && targetObjectName !== objectName && hasId(recordId)
            ? appRecordPath(routes.appName, routable, targetObjectName, recordId)
            : null;
    return {
        resolve: () => NO_RELATED_HANDLERS,
        recordHref: (targetObjectName, recordId) => {
            if (targetObjectName === objectName) {
                return hasId(recordId) ? listRecordDetailUrl(getPathname(), recordId) : null;
            }
            const path = otherRecordPath(targetObjectName, recordId);
            return routes && path !== null ? documentHref(routes.routerRootHref, path) : null;
        },
        openRecord: (targetObjectName, recordId) => {
            if (targetObjectName === objectName) {
                if (hasId(recordId)) openRecordPage(recordId);
                return;
            }
            const path = otherRecordPath(targetObjectName, recordId);
            if (path !== null) routes?.navigate(path);
        },
    };
}

/**
 * What {@link listRecordActionsValue} needs to address records of objects other
 * than the listed one: the inputs the record page's bridge reads (objectui#12673).
 */
export interface ListRecordRoutes {
    /** The current app segment (`/apps/:appName/...`); no app, no route. */
    appName: string | undefined;
    /** The console's object definitions; their names are the routable set. */
    objects: ReadonlyArray<unknown>;
    /** SPA navigation by router path (the router applies its basename). */
    navigate: (to: string) => void;
    /** `useHref('/')`: the router's root href, basename included. */
    routerRootHref: string;
}
