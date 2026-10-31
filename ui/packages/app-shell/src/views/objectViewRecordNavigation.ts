/**
 * Record navigation of the Console `ObjectView` (`./ObjectView.tsx`): how a
 * row opens its record (the drawer, or the page an object declares), the drawer's
 * `?recordId=` URL state, "expand to full page", and the record links the
 * list publishes, moved out of `ObjectViewInner` verbatim (objectstack#25992,
 * slice 6). Every input is passed in; the component reads the returned values.
 *
 * The drawer is a stack since objectstack#26679 (`./recordDrawerStack.tsx`):
 * `?recordId=` addresses its ROOT — the list row — and the levels a related
 * row or a lookup opens above it live in memory, so a reload shows the root.
 *
 * Since objectstack#27545 the pane never routes: its `⤢` maximizes in place.
 * The full page is reached from the row's `↗`, whose page offers
 * 「Collapse to drawer」 back to this list with that record open
 * (`drawerRestore`), and from the record header's `⋯` menu
 * (`handleOpenAsPage`), at any level of the stack.
 */

import { useMemo, useCallback, useEffect, useRef, useState } from 'react';
import type { NavigateFunction, Location, SetURLSearchParams } from 'react-router-dom';
import { overlayWidthFor } from '@object-ui/plugin-view';
import { useNavigationOverlay } from '@object-ui/react';
import type { ViewNavigationConfig } from '@object-ui/types';
import { RECORD_DRAWER_PARAM } from '../urlParams.js';
import { viewTabLabel } from './viewTabLabel.js';
import { listRecordDetailUrl, listRecordActionsValue } from './objectViewRecordLinks.js';
import {
    expandedRecordPath,
    recordDrawerReturnState,
    useTakenRestore,
    type RecordDrawerLevel,
} from './recordDrawerStack.js';
import type { useServedViewItems } from '../hooks/useServedViewItems.js';
import type { useObjectLabel, useObjectTranslation } from '@object-ui/i18n';
import type { buildViewTabs } from './objectViewTabs.js';
import type { ConsoleObjectViewProps } from './ObjectView.js';
import type { RecordOpenPreference } from '../utils/recordOpenPreference.js';

type OverlaySizeBucket = 'sm' | 'md' | 'lg' | 'xl' | 'full';

/**
 * The record pane's size bucket (objectstack#27545): `auto` — or no size —
 * is `md` (720 px) whatever the object's field count; an authored bucket
 * stands as authored.
 */
function recordPaneSize(size: 'auto' | OverlaySizeBucket | undefined): OverlaySizeBucket {
    return !size || size === 'auto' ? 'md' : size;
}

export function useObjectViewRecordNavigation({
    activeView,
    objectDef,
    objects,
    appName,
    viewId,
    searchParams,
    setSearchParams,
    location,
    navigate,
    routerRootHref,
    servedViews,
    viewLabel,
    unlabelledViewText,
    language,
    recordOpenPreference,
}: {
    activeView: ReturnType<typeof buildViewTabs>[number];
    objectDef: ConsoleObjectViewProps['objects'][number];
    objects: ConsoleObjectViewProps['objects'];
    appName: string | undefined;
    viewId: string | undefined;
    searchParams: URLSearchParams;
    setSearchParams: SetURLSearchParams;
    location: Location;
    navigate: NavigateFunction;
    routerRootHref: string;
    servedViews: ReturnType<typeof useServedViewItems>;
    viewLabel: ReturnType<typeof useObjectLabel>['viewLabel'];
    unlabelledViewText: string;
    language: ReturnType<typeof useObjectTranslation>['language'];
    /** The reader's own way of opening a drawer-mode record (objectstack#27545). */
    recordOpenPreference: RecordOpenPreference;
}) {
    // Navigation overlay for record detail.
    // Priority: activeView.navigation > objectDef.navigation > default drawer.
    //
    // Default mode = 'drawer' (objectstack#26677, maintainer ruling 2026-10-27:
    // an object opens its records in the drawer, which expands to the full
    // page — the same record page at two widths — and `page` only where the
    // object declares it). Direct URL access (`/record/:id`) still opens as a
    // full page because RecordDetailView owns its own route — only same-page
    // click navigation is drawer-by-default. A view or object that declares
    // `navigation.mode: 'page'` navigates to that route instead. The
    // side-by-side pane is the reader's preference, read by `ObjectView`.
    const detailNavigation: ViewNavigationConfig = useMemo(
        () => {
            const authored = activeView?.navigation ?? objectDef.navigation;
            if (authored) {
                // Authored config wins. For an overlay, resolve the `size`
                // bucket to a viewport-clamped width when no explicit width was
                // given — objectstack-ai/objectstack#2578: a pixel width can't
                // be authored blind. `auto` is the pane's 720 (objectstack#27545).
                if (authored.mode === 'page') return authored;
                return {
                    ...authored,
                    width: authored.width ?? overlayWidthFor(
                        recordPaneSize((authored as { size?: 'auto' | OverlaySizeBucket }).size),
                        objectDef,
                    ),
                };
            }
            // No authored navigation: the drawer, whatever the object's field
            // count. Until objectstack#26677 a field-heavy object paged here by
            // itself (`deriveRecordSurface`, objectstack-ai/objectstack#2578), a
            // surface no author chose; `page` is now a declaration only. Since
            // objectstack#27545 the pane's width no longer follows the field
            // count either: `md` (720 px), clamped to the viewport, which the
            // reader drags and `⤢` widens.
            return { mode: 'drawer', width: overlayWidthFor(recordPaneSize(undefined), objectDef) };
        },
        [activeView?.navigation, objectDef]
    );
    const drawerRecordId = searchParams.get(RECORD_DRAWER_PARAM);
    // The location as of the latest render, read when a handler runs: the
    // handlers below reach the list (its row click, its ↗, the record links it
    // publishes), which must not re-render when `?recordId=` changes
    // (objectstack#27545) — and the location changes with it.
    const locationRef = useRef(location);
    locationRef.current = location;
    // The rows the list shows (`handleListRowsChange` below), read when a
    // handler runs: a page this list opens steps through them
    // (objectstack#27524, Target 7).
    const listRowIdsRef = useRef<readonly string[]>([]);
    // The list's name — its view's tab label: what the page's way back says,
    // and the set the pane's counter names (objectstack#27524, Target 7).
    const listLabel = useMemo(
        () => viewTabLabel({ id: activeView?.id, name: activeView?.name, label: activeView?.label }, objectDef.name, servedViews, viewLabel, unlabelledViewText, language),
        [activeView?.id, activeView?.name, activeView?.label, objectDef.name, servedViews, viewLabel, unlabelledViewText, language],
    );
    // Memoize onNavigate to prevent stale closure in useNavigationOverlay's handleClick
    const handleNavOverlayNavigate = useCallback(
        (recordId: string | number, action?: string, extraState?: Record<string, unknown>) => {
            if (action === 'new_window') {
                // Open record detail in a new browser tab with Console-correct URL.
                // Same builder the list's link column publishes as its href
                // (objectui#4490) — one record-route shape for this surface.
                window.open(listRecordDetailUrl(window.location.pathname, recordId), '_blank');
                return;
            }
            // Default: navigate to record detail page.
            // `action` is a navigation-MODE token — 'view' / 'page' / undefined
            // — and every non-`new_window` value lands on the record detail
            // route.
            //
            // ⛔ It is NOT a view name, and this comment used to say a custom
            // one could arrive here "forwarded from `navigation.view` (e.g.
            // 'detail_form')", resolved "by RecordDetailView from its own
            // config". No layer ever resolved a view by that name — which is
            // why `@objectstack/spec` 17.5.0 retired the key under ADR-0049,
            // and why `useNavigationOverlay` stopped forwarding it
            // (objectui#9874). Nothing here changes behaviour: this branch
            // already treated the name and the token identically, which is
            // exactly what made the substitution inaudible on this surface.
            const { pathname, search } = locationRef.current;
            // The rows the list shows go along when the record is one of
            // them: the page's top bar counts and steps through them
            // (objectstack#27524, Target 7).
            const siblings = listRowIdsRef.current;
            const originState = {
              ...extraState,
              from: {
                pathname: pathname + (search || ''),
                label: listLabel,
                ...(siblings.includes(String(recordId)) ? { siblings } : {}),
              },
            };
            if (viewId) {
                navigate(`../../record/${encodeURIComponent(String(recordId))}`, { relative: 'path', state: originState });
            } else {
                navigate(`record/${encodeURIComponent(String(recordId))}`, { state: originState });
            }
        },
        [navigate, viewId, listLabel]
    );
    /**
     * The list surface's half of the record-link mechanism (objectui#4490):
     * publish this page's record-URL builder so the grid's `link: true` column
     * can render a real anchor instead of a click-only `span role="link"`.
     * See {@link listRecordActionsValue} for what this does and does NOT claim.
     *
     * The record drawer/overlay below mounts `RecordDetailView`, which brings
     * its own `RelatedRecordActionsBridge` around the whole detail body — that
     * nearer provider keeps owning the detail surface, exactly as before.
     */
    const listRecordActions = useMemo(
        () =>
            listRecordActionsValue(objectDef.name, handleNavOverlayNavigate, undefined, {
                appName,
                objects,
                navigate,
                routerRootHref,
            }),
        [objectDef.name, handleNavOverlayNavigate, appName, objects, navigate, routerRootHref],
    );
    const navOverlay = useNavigationOverlay({
        navigation: detailNavigation,
        objectName: objectDef.name,
        onNavigate: handleNavOverlayNavigate,
    });
    // A ⤢ return's stack, taken out of the history state once (objectstack#26679).
    const [drawerRestore, clearDrawerRestore] = useTakenRestore();
    const handleDrawerClose = () => {
        clearDrawerRestore();
        navOverlay.close();
        const newParams = new URLSearchParams(searchParams);
        newParams.delete(RECORD_DRAWER_PARAM);
        setSearchParams(newParams);
    };
    /**
     * Row-click handler used by all list/grid/gallery/kanban surfaces inside
     * this object view. Wraps `navOverlay.handleClick` so that drawer-mode
     * opens are URL-driven (writes `?recordId=…`) — making the drawer state
     * shareable, refresh-safe, and respected by browser back/forward. The
     * URL→state sync effect below handles actually opening the drawer.
     */
    // What the row click reads at click time. The handler itself never changes
    // (objectstack#27545): the list it is handed to must not re-render when
    // `?recordId=` changes, and the overlay state, the search params and their
    // setter all change with it.
    const rowClickInputs = useRef({ navOverlay, searchParams, setSearchParams, recordOpenPreference, handleNavOverlayNavigate });
    rowClickInputs.current = { navOverlay, searchParams, setSearchParams, recordOpenPreference, handleNavOverlayNavigate };
    const handleRowClick = useCallback(
        (record: any, event?: React.MouseEvent | { metaKey?: boolean; ctrlKey?: boolean; button?: number }) => {
            const { navOverlay: overlay, searchParams: params, setSearchParams: setParams, recordOpenPreference: preference, handleNavOverlayNavigate: navigateTo } = rowClickInputs.current;
            // Cmd/Ctrl/middle-click — let the hook open in a new tab (full page)
            // regardless of configured mode. Matches browser link convention.
            const isModifier = !!(
                event && ((event as any).metaKey || (event as any).ctrlKey || (event as any).button === 1)
            );
            if (isModifier) {
                overlay.handleClick(record, event as any);
                return;
            }
            if (overlay.mode === 'drawer') {
                const id = (record?.id ?? record?._id) as string | number | undefined;
                if (id != null) {
                    // The reader who prefers the page gets it from a row click
                    // (objectstack#27545); the object still opens in the drawer.
                    if (preference === 'page') {
                        navigateTo(id);
                        return;
                    }
                    // Drawer and split → URL is the source of truth. Push
                    // `?recordId=…` and let the URL-sync effect open the pane;
                    // a row clicked while it is open swaps its root record.
                    const next = new URLSearchParams(params);
                    next.set(RECORD_DRAWER_PARAM, String(id));
                    setParams(next);
                    return;
                }
            }
            // All other modes (page / new_window / none) — delegate to the hook.
            overlay.handleClick(record, event as any);
        },
        []
    );
    /**
     * The record header's 「Open as full page」 at any level of the pane's stack
     * (objectstack#27545, the `⋯` menu's last item; the bar's `⤢` no longer
     * routes): closes the pane (which clears `?recordId=…`) and router-pushes
     * to the record's page. The root keeps its list-relative route and the
     * list as its origin; a level above it opens `/apps/:app/:object/record/:id`
     * with the levels below it as its `?from=` trail.
     */
    const handleOpenAsPage = useCallback((path: RecordDrawerLevel[]) => {
        const target = path[path.length - 1];
        if (!target) return;
        if (path.length === 1) {
            handleDrawerClose();
            handleNavOverlayNavigate(target.recordId);
            return;
        }
        const to = expandedRecordPath(appName, objects, path);
        if (to === null) return;
        handleDrawerClose();
        navigate(to);
    }, [handleNavOverlayNavigate, appName, objects, navigate, handleDrawerClose]);
    /**
     * The row's `↗` (objectstack#26681): the record's page, handed the way back
     * to this list with that record open — the page's 「Collapse to drawer」
     * (`recordDrawerReturnState`), drawn only for a reader who arrived this
     * way (objectstack#27545) — and the rows the list shows, which that page's
     * top bar steps through with its counter and ↓ ↑ (objectstack#27524,
     * Target 7). Read at click time: the handler never changes with the rows.
     */
    const handleOpenRowAsPage = useCallback((recordId: string | number) => {
        const { pathname, search, state } = locationRef.current;
        const back = new URLSearchParams(search);
        back.set(RECORD_DRAWER_PARAM, String(recordId));
        const siblings = listRowIdsRef.current;
        const returnState = recordDrawerReturnState(
            { pathname, search: `?${back.toString()}`, state },
            [{
                objectName: objectDef.name,
                recordId: String(recordId),
                ...(siblings.includes(String(recordId)) ? { siblings } : {}),
            }],
        );
        handleNavOverlayNavigate(recordId, undefined, returnState);
    }, [objectDef.name, handleNavOverlayNavigate]);
    /**
     * The rows the list shows, in its order (`ListView`'s `onRowsChange`,
     * objectstack#26679): the root level's sibling set, which the drawer's
     * `↑` `↓` step through. Held as the ids' joined key so an equal report
     * changes nothing.
     */
    const [listRowIds, setListRowIds] = useState<{ key: string; ids: readonly string[] }>({ key: '', ids: [] });
    listRowIdsRef.current = listRowIds.ids;
    const handleListRowsChange = useCallback((rows: ReadonlyArray<Record<string, unknown>>) => {
        const ids = rows
            .map((row) => (row?.id ?? row?._id) as string | number | undefined)
            .filter((id): id is string | number => id != null && id !== '')
            .map(String);
        const key = JSON.stringify(ids);
        setListRowIds((prev) => (prev.key === key ? prev : { key, ids }));
    }, []);
    /** `↑` `↓` at the root: the sibling becomes the row `?recordId=` names. */
    const handleRootStep = useCallback((recordId: string) => {
        setSearchParams((prev) => {
            const next = new URLSearchParams(prev);
            next.set(RECORD_DRAWER_PARAM, recordId);
            return next;
        }, { replace: true });
    }, [setSearchParams]);
    /**
     * The drawer's root — the list row `?recordId=` names — or `null`, with the
     * list's shown rows as its sibling set when the list reported any.
     */
    const drawerRoot = useMemo<RecordDrawerLevel | null>(
        () => (drawerRecordId
            ? {
                objectName: objectDef.name,
                recordId: drawerRecordId,
                ...(listRowIds.ids.length > 0 ? { siblings: listRowIds.ids } : {}),
            }
            : null),
        [drawerRecordId, objectDef.name, listRowIds],
    );
    // Sync URL-based recordId to overlay state
    useEffect(() => {
        if (drawerRecordId && !navOverlay.isOpen) {
            navOverlay.open({ id: drawerRecordId });
        } else if (!drawerRecordId && navOverlay.isOpen) {
            navOverlay.close();
        }
    }, [drawerRecordId]);
    return { listRecordActions, navOverlay, handleDrawerClose, handleRowClick, handleOpenAsPage, handleOpenRowAsPage, drawerRoot, drawerRestore, handleListRowsChange, handleRootStep, listLabel };
}
