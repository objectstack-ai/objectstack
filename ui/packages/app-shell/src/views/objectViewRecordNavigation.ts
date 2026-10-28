/**
 * Record navigation of the Console `ObjectView` (`./ObjectView.tsx`): how a
 * row opens its record (the drawer, or the page an object declares), the drawer's
 * `?recordId=` URL state, "expand to full page", and the record links the
 * list publishes, moved out of `ObjectViewInner` verbatim (objectstack#25992,
 * slice 6). Every input is passed in; the component reads the returned values.
 */

import { useMemo, useCallback, useEffect } from 'react';
import type { NavigateFunction, Location, SetURLSearchParams } from 'react-router-dom';
import { overlayWidthFor } from '@object-ui/plugin-view';
import { useNavigationOverlay } from '@object-ui/react';
import type { ViewNavigationConfig } from '@object-ui/types';
import { RECORD_DRAWER_PARAM } from '../urlParams.js';
import { viewTabLabel } from './viewTabLabel.js';
import { listRecordDetailUrl, listRecordActionsValue } from './objectViewRecordLinks.js';
import type { useServedViewItems } from '../hooks/useServedViewItems.js';
import type { useObjectLabel, useObjectTranslation } from '@object-ui/i18n';
import type { buildViewTabs } from './objectViewTabs.js';
import type { ConsoleObjectViewProps } from './ObjectView.js';

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
                // bucket (or 'auto') to a viewport-clamped width when no explicit
                // width was given — objectstack-ai/objectstack#2578: a pixel width can't be authored blind.
                if (authored.mode === 'page') return authored;
                return {
                    ...authored,
                    width: authored.width ?? overlayWidthFor(
                        (authored as { size?: 'auto' | 'sm' | 'md' | 'lg' | 'xl' | 'full' }).size,
                        objectDef,
                    ),
                };
            }
            // No authored navigation: the drawer, whatever the object's field
            // count. Until objectstack#26677 a field-heavy object paged here by
            // itself (`deriveRecordSurface`, objectstack-ai/objectstack#2578), a
            // surface no author chose; `page` is now a declaration only. The
            // drawer's WIDTH still follows the field count (`size: 'auto'`),
            // clamped to the viewport.
            return { mode: 'drawer', width: overlayWidthFor('auto', objectDef) };
        },
        [activeView?.navigation, objectDef]
    );
    const drawerRecordId = searchParams.get(RECORD_DRAWER_PARAM);
    // Memoize onNavigate to prevent stale closure in useNavigationOverlay's handleClick
    const handleNavOverlayNavigate = useCallback(
        (recordId: string | number, action?: string) => {
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
            const originState = {
              from: {
                pathname: location.pathname + (location.search || ''),
                label: viewTabLabel({ id: activeView?.id, name: activeView?.name, label: activeView?.label }, objectDef.name, servedViews, viewLabel, unlabelledViewText, language),
              },
            };
            if (viewId) {
                navigate(`../../record/${encodeURIComponent(String(recordId))}`, { relative: 'path', state: originState });
            } else {
                navigate(`record/${encodeURIComponent(String(recordId))}`, { state: originState });
            }
        },
        [navigate, viewId, location.pathname, location.search, objectDef, activeView?.id, activeView?.name, activeView?.label, viewLabel, unlabelledViewText, servedViews, language]
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
    const handleDrawerClose = () => {
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
    const handleRowClick = useCallback(
        (record: any, event?: React.MouseEvent | { metaKey?: boolean; ctrlKey?: boolean; button?: number }) => {
            // Cmd/Ctrl/middle-click — let the hook open in a new tab (full page)
            // regardless of configured mode. Matches browser link convention.
            const isModifier = !!(
                event && ((event as any).metaKey || (event as any).ctrlKey || (event as any).button === 1)
            );
            if (isModifier) {
                navOverlay.handleClick(record, event as any);
                return;
            }
            // Drawer mode → URL is the source of truth. Push `?recordId=…`
            // and let the existing URL-sync effect open the overlay.
            if (navOverlay.mode === 'drawer') {
                const id = (record?.id ?? record?._id) as string | number | undefined;
                if (id != null) {
                    const next = new URLSearchParams(searchParams);
                    next.set(RECORD_DRAWER_PARAM, String(id));
                    setSearchParams(next);
                    return;
                }
            }
            // All other modes (page / new_window / none) — delegate to the hook.
            navOverlay.handleClick(record, event as any);
        },
        [navOverlay, searchParams, setSearchParams]
    );
    /**
     * "Expand to full page" — invoked from the drawer header chevron. Closes
     * the drawer (which clears `?recordId=…`) and router-pushes to the
     * dedicated `/record/:id` route. Mirrors Linear/Notion peek-to-page.
     */
    const handleExpandDrawer = useCallback(() => {
        const rec = navOverlay.selectedRecord as Record<string, unknown> | null;
        const id = rec && ((rec as any).id ?? (rec as any)._id);
        if (id == null) return;
        handleDrawerClose();
        handleNavOverlayNavigate(id as string | number);
    }, [navOverlay.selectedRecord, handleNavOverlayNavigate]);
    // Sync URL-based recordId to overlay state
    useEffect(() => {
        if (drawerRecordId && !navOverlay.isOpen) {
            navOverlay.open({ id: drawerRecordId });
        } else if (!drawerRecordId && navOverlay.isOpen) {
            navOverlay.close();
        }
    }, [drawerRecordId]);
    return { listRecordActions, navOverlay, handleDrawerClose, handleRowClick, handleExpandDrawer };
}
