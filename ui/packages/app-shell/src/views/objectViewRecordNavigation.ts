/**
 * Record navigation of the Console `ObjectView` (`./ObjectView.tsx`): how a
 * row opens its record, the drawer's `?recordId=` URL state, "expand to full
 * page", and the record links the list publishes, moved out of
 * `ObjectViewInner` verbatim (objectstack#25992, slice 6). Every input is
 * passed in; the component reads the returned values.
 *
 * ONE rule since objectstack#35854 (maintainer 2026-11-20: 「点击才从右侧打开，
 * 否则都是进全屏打开。这样就不需要任何设置」): the record's name opens the full
 * page (`handleRowClick`), and the name cell's hover icon 「在侧边打开」 opens the
 * side drawer over the list (`handleOpenRowInPanel`). No reader preference
 * and no authored `navigation.mode` picks between them: the key is deprecated
 * (maintainer 2026-11-20: 「废弃」), and a view or object that declares
 * `drawer`, `page` or `new_window` behaves as one that declares nothing. An
 * authored `none` (or `preventNavigation`) still opens nothing.
 *
 * The page a list opens knows that list (its provenance): the history state's
 * `from` carries the list's URL — its view, filters, sort, search and grouping
 * — its name, the rows it shows and the count it matched. History state
 * survives a reload of the tab, so the page's top bar keeps saying where it
 * came from, and its ✕ returns to that list, where the list's own per-URL
 * scroll memory puts the reader back where they were. A page opened any other
 * way (a link, a notification, a search, a new tab) carries no `from`.
 *
 * The drawer is a stack since objectstack#26679 (`./recordDrawerStack.tsx`):
 * `?recordId=` addresses its ROOT — the list row — and the levels a related
 * row or a lookup opens above it live in memory, so a reload shows the root.
 * Its one `⤢` opens the level shown as the full page (`handleOpenAsPage`).
 *
 * On a phone (objectstack#27058) none of that applies: the record is always a
 * page. The spec's own rule says so (`deriveRecordSurface` with
 * `viewport: 'mobile'` answers `page`), a row tap navigates to the record
 * route with the list as its origin, and the pane is never mounted, so the
 * reader's Open records preference and the drawer's `?recordId=` state do not
 * apply: a `?recordId=` link opened on a phone lands on that record's page,
 * and the record form the link carries (`?form=`, `?formObject=`,
 * `?formLink=`) opens over that page (objectstack#32750).
 *
 * An object the server does not read one record of — its served operations
 * leave `get` out (`servesRecordRead`), a list-only object — has no record
 * surface at all: its rows resolve to the `none` mode on every viewport, a
 * modifier click opens no tab, its link column draws plain values, and a
 * `?recordId=` link opens nothing. Its row menu (`list_item` actions) is
 * untouched: it acts on the row the list already holds.
 */

import { useMemo, useCallback, useEffect, useRef, useState } from 'react';
import type { NavigateFunction, Location, SetURLSearchParams } from 'react-router-dom';
import { deriveRecordSurface, overlayWidthFor } from '@object-ui/plugin-view/core';
import { useNavigationOverlay } from '@object-ui/react';
import { usePermissions } from '@object-ui/permissions';
import type { ViewNavigationConfig } from '@object-ui/types';
import { RECORD_DRAWER_PARAM, RECORD_FORM_PARAM, RECORD_FORM_OBJECT_PARAM, RECORD_FORM_LINK_PARAM } from '../urlParams.js';
import { RECORD_FORM_CREATE_VALUES_STATE } from '../utils/recordFormNavigation.js';
import { viewTabLabel } from './viewTabLabel.js';
import { listRecordDetailUrl, listRecordActionsValue } from './objectViewRecordLinks.js';
import { RECORD_PAGE_PUSHED_STATE } from './recordPagePush.js';
import { servesRecordRead } from '../utils/recordReadServed.js';
import {
    expandedRecordPath,
    useTakenRestore,
    type RecordDrawerLevel,
} from './recordDrawerStack.js';
import type { useServedViewItems } from '../hooks/useServedViewItems.js';
import type { useObjectLabel, useObjectTranslation } from '@object-ui/i18n';
import type { buildViewTabs } from './objectViewTabs.js';
import type { ConsoleObjectViewProps } from './ObjectView.js';

/**
 * The rows a list shows, as the object page holds them (objectstack#26679):
 * their ids in order, and on a grouped grid or a board the groups they sit in
 * (objectstack#28461), each with its heading. `key` is the content's key.
 */
export interface ListShownRows {
    key: string;
    ids: readonly string[];
    groups: ReadonlyArray<{ label: string; ids: readonly string[] }> | null;
}

const NO_LIST_ROWS: ListShownRows = { key: '', ids: [], groups: null };

const rowIdsOf = (rows: ReadonlyArray<Record<string, unknown>>): string[] =>
    rows
        .map((row) => (row?.id ?? row?._id) as string | number | undefined)
        .filter((id): id is string | number => id != null && id !== '')
        .map(String);

/** `ListView`'s `onRowsChange` report, as {@link ListShownRows}. */
export function listShownRowsOf(
    rows: ReadonlyArray<Record<string, unknown>>,
    groups?: ReadonlyArray<{ label: string; rows: ReadonlyArray<Record<string, unknown>> }>,
): ListShownRows {
    const ids = rowIdsOf(rows);
    const held = groups ? groups.map((group) => ({ label: group.label, ids: rowIdsOf(group.rows) })) : null;
    return { key: JSON.stringify([ids, held]), ids, groups: held };
}

/**
 * The set a record's `↑` `↓` step through, and the name its counter's tooltip
 * says: on a grouped list the rows of the record's own group, named by the
 * group (objectstack#28461, 「Acme Corporation 中第 1 条，共 3 条」); otherwise
 * every row the list shows, and no name of its own — the host names the list.
 * `undefined` when the list does not show the record.
 */
export function listSiblingSetOf(
    rows: ListShownRows,
    recordId: string,
): { siblings: readonly string[]; scope?: string } | undefined {
    if (rows.groups) {
        const group = rows.groups.find((candidate) => candidate.ids.includes(recordId));
        return group ? { siblings: group.ids, scope: group.label } : undefined;
    }
    return rows.ids.includes(recordId) ? { siblings: rows.ids } : undefined;
}

/** The URL parameters the record-form overlay reads (`AppContent`, `urlParams.ts`). */
const RECORD_FORM_PARAMS = [RECORD_FORM_PARAM, RECORD_FORM_OBJECT_PARAM, RECORD_FORM_LINK_PARAM] as const;

/**
 * The record-form task a list URL carries, split from the list
 * (objectstack#32750): `form` is the record-form overlay's search — the
 * reserved `form`, `formObject` and `formLink` parameters, in the URL's order
 * — and `origin` is the list's own search without them. A URL that carries no
 * form answers `form: ''` and its search unchanged.
 */
function splitRecordFormSearch(search: string): { form: string; origin: URLSearchParams } {
    const origin = new URLSearchParams(search);
    const form = new URLSearchParams();
    for (const [key, value] of origin) {
        if ((RECORD_FORM_PARAMS as readonly string[]).includes(key)) form.append(key, value);
    }
    for (const key of RECORD_FORM_PARAMS) origin.delete(key);
    return { form: form.toString(), origin };
}

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
    phone,
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
    /** The console is on a phone (`usePhoneViewport`, objectstack#27058): every record opens as a page. */
    phone: boolean;
}) {
    // Whether the server reads one record of this object at all: a list-only
    // object's record page and drawer could only answer
    // `OBJECT_API_METHOD_NOT_ALLOWED`, so its records open nowhere.
    const perms = usePermissions();
    const recordServed = servesRecordRead(objectDef.name, perms);
    // Navigation overlay for record detail: whether this list's rows open a
    // record at all, and the side drawer's width. `drawer` here means "the
    // record has both faces": the name opens the page and the hover icon the
    // drawer (objectstack#35854); `none` means rows open nothing.
    const detailNavigation: ViewNavigationConfig = useMemo(
        () => {
            // No record surface to open, on any viewport, whatever is authored.
            if (!recordServed) return { mode: 'none' };
            // objectstack#27058 — on a phone the spec's rule decides, and it
            // answers `page` whatever the view or the object declares.
            if (phone) return { mode: deriveRecordSurface(objectDef, { viewport: 'mobile' }) as ViewNavigationConfig['mode'] };
            const authored = activeView?.navigation ?? objectDef.navigation;
            // `preventNavigation: true` ("Disable standard navigation
            // entirely") outranks every mode: the row resolves to `none`, so
            // no click opens it, a modifier click included, and the list
            // draws no link face for it (`rowOpensRecord`, objectstack#33549).
            if (authored?.preventNavigation) return { mode: 'none' };
            // An authored `none` is "No navigation (read-only list)": rows
            // open nothing (objectstack#33548). It outlives the deprecation of
            // `navigation.mode` as an open-mode switch (objectstack#35854).
            if (authored?.mode === 'none') return { mode: 'none' };
            // objectstack#35854 — `navigation.mode` is deprecated: `drawer`,
            // `page` and `new_window` no longer pick how a record opens, so a
            // view that declares one behaves as one that declares nothing.
            // The drawer's width still reads the authored `size` bucket (or the
            // deprecated pixel `width`, objectstack-ai/objectstack#2578): `auto`
            // is the pane's 720 (objectstack#27545), clamped to the viewport.
            return {
                mode: 'drawer',
                width: authored?.width ?? overlayWidthFor(
                    recordPaneSize((authored as { size?: 'auto' | OverlaySizeBucket } | undefined)?.size),
                    objectDef,
                ),
            };
        },
        [activeView?.navigation, objectDef, phone, recordServed]
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
    const listRowsRef = useRef<ListShownRows>(NO_LIST_ROWS);
    // The count the list's query matched (`handleListTotalChange` below): the
    // M of the page's 「第 N 条，共 M 条」 (objectstack#35853). The shown rows
    // are the windows the list has loaded, which can be fewer.
    const listTotalRef = useRef<number | undefined>(undefined);
    // The list's name — its view's tab label: what the page's way back says,
    // and the set the pane's counter names (objectstack#27524, Target 7).
    const listLabel = useMemo(
        () => viewTabLabel({ id: activeView?.id, name: activeView?.name, label: activeView?.label }, objectDef.name, servedViews, viewLabel, unlabelledViewText, language),
        [activeView?.id, activeView?.name, activeView?.label, objectDef.name, servedViews, viewLabel, unlabelledViewText, language],
    );
    // Memoize onNavigate to prevent stale closure in useNavigationOverlay's handleClick
    const handleNavOverlayNavigate = useCallback(
        (recordId: string | number, action?: string, extraState?: Record<string, unknown>, replace?: boolean) => {
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
            const { pathname, search, state } = locationRef.current;
            // The rows the list shows go along when the record is one of
            // them: the page's top bar counts and steps through them
            // (objectstack#27524, Target 7).
            const set = listSiblingSetOf(listRowsRef.current, String(recordId));
            // The list's matched count goes along with an ungrouped set: on a
            // grouped list the set is the record's group, counted by itself.
            const total = set && !set.scope && listTotalRef.current != null && listTotalRef.current >= set.siblings.length
                ? listTotalRef.current
                : undefined;
            // The drawer link a phone answers moves the record form it
            // carries onto the record's page, where the form opens over the
            // page as it opens over the drawer on a desktop (objectstack#32750),
            // with the seeded create values its history entry holds. The
            // list, as the page's origin, keeps no form of its own.
            const movesForm = phone && replace === true;
            const split = movesForm ? splitRecordFormSearch(search) : null;
            const formSearch = split?.form ? `?${split.form}` : '';
            const createValues = formSearch && state && typeof state === 'object'
                ? (state as Record<string, unknown>)[RECORD_FORM_CREATE_VALUES_STATE]
                : undefined;
            // The list as the page's origin, without the drawer's
            // `?recordId=` a phone redirect leaves behind (objectstack#27058).
            const originParams = split?.form ? split.origin : new URLSearchParams(search);
            originParams.delete(RECORD_DRAWER_PARAM);
            const originSearch = originParams.toString();
            const originState = {
              ...extraState,
              from: {
                pathname: pathname + (originSearch ? `?${originSearch}` : ''),
                label: listLabel,
                ...(set ?? {}),
                ...(total !== undefined ? { total } : {}),
              },
              // A phone pushes the page over its list, so the page's 「‹」
              // goes back in the history to that list entry, as a page a
              // related row pushes does (objectstack#29074). Not on a
              // replace: the drawer link a phone answers takes the list's
              // place, so there is no list entry below to go back to.
              ...(phone && !replace ? { [RECORD_PAGE_PUSHED_STATE]: true } : {}),
              ...(createValues !== undefined ? { [RECORD_FORM_CREATE_VALUES_STATE]: createValues } : {}),
            };
            if (viewId) {
                navigate(`../../record/${encodeURIComponent(String(recordId))}${formSearch}`, { relative: 'path', state: originState, replace });
            } else {
                navigate(`record/${encodeURIComponent(String(recordId))}${formSearch}`, { state: originState, replace });
            }
        },
        [navigate, viewId, listLabel, phone]
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
                perms,
            }),
        [objectDef.name, handleNavOverlayNavigate, appName, objects, navigate, routerRootHref, perms],
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
     * this object view — the record's NAME (objectstack#35854): it opens the
     * full page, with this list as the page's origin. A ⌘/Ctrl or middle click
     * opens that page in a new tab (the hook's own modifier branch). On a
     * phone the record is a page too (objectstack#27058).
     */
    // What the row click reads at click time. The handler itself never changes
    // (objectstack#27545): the list it is handed to must not re-render when
    // `?recordId=` changes, and the overlay state changes with it.
    const rowClickInputs = useRef({ navOverlay, handleNavOverlayNavigate, recordServed });
    rowClickInputs.current = { navOverlay, handleNavOverlayNavigate, recordServed };
    const handleRowClick = useCallback(
        (record: any, event?: React.MouseEvent | { metaKey?: boolean; ctrlKey?: boolean; button?: number }) => {
            const { navOverlay: overlay, handleNavOverlayNavigate: navigateTo, recordServed: served } = rowClickInputs.current;
            // No record surface: not even a modifier click opens one in a new tab.
            if (!served) return;
            // An authored `none` is no navigation (the spec's "No navigation
            // (read-only list)"): no click opens the record, a ⌘/Ctrl or
            // middle click included (objectstack#33548).
            if (overlay.mode === 'none') return;
            // Cmd/Ctrl/middle-click — let the hook open in a new tab (full page).
            // Matches browser link convention.
            const isModifier = !!(
                event && ((event as any).metaKey || (event as any).ctrlKey || (event as any).button === 1)
            );
            if (isModifier) {
                overlay.handleClick(record, event as any);
                return;
            }
            const id = (record?.id ?? record?._id) as string | number | undefined;
            if (id != null && id !== '') navigateTo(id);
        },
        []
    );
    /**
     * The name cell's hover icon 「在侧边打开」 (objectstack#35854): the record
     * in the side drawer over the list, which stays. The URL is the drawer's
     * source of truth: `?recordId=…` is pushed and the URL-sync effect below
     * opens it, so it is shareable, refresh-safe and walks with back/forward;
     * an icon clicked while the drawer is open swaps its root record.
     */
    const panelInputs = useRef({ searchParams, setSearchParams, recordServed, mode: navOverlay.mode });
    panelInputs.current = { searchParams, setSearchParams, recordServed, mode: navOverlay.mode };
    const handleOpenRowInPanel = useCallback((recordId: string | number) => {
        const { searchParams: params, setSearchParams: setParams, recordServed: served, mode } = panelInputs.current;
        if (!served || mode !== 'drawer') return;
        const next = new URLSearchParams(params);
        next.set(RECORD_DRAWER_PARAM, String(recordId));
        setParams(next);
    }, []);
    /**
     * The drawer's one `⤢` 「Open as full page」 at any level of the pane's
     * stack (objectstack#35854): closes the pane (which clears `?recordId=…`)
     * and router-pushes to the record's page. The root keeps its list-relative
     * route and the list as its origin — its counter, its ↓ ↑ and the ✕ back to
     * the list; a level above it opens `/apps/:app/:object/record/:id` with the
     * levels below it as its `?from=` trail.
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
     * The rows the list shows, in its order (`ListView`'s `onRowsChange`,
     * objectstack#26679), and on a grouped grid or a board its groups
     * (objectstack#28461): the root level's sibling set, which the drawer's
     * `↑` `↓` step through. Held with its content's key so an equal report
     * changes nothing.
     */
    const [listRows, setListRows] = useState<ListShownRows>(NO_LIST_ROWS);
    listRowsRef.current = listRows;
    const handleListRowsChange = useCallback((
        rows: ReadonlyArray<Record<string, unknown>>,
        groups?: ReadonlyArray<{ label: string; rows: ReadonlyArray<Record<string, unknown>> }>,
    ) => {
        const next = listShownRowsOf(rows, groups);
        setListRows((prev) => (prev.key === next.key ? prev : next));
    }, []);
    /**
     * The count the list's query matched (`ListView`'s `onTotalChange`): the M
     * of 「第 N 条，共 M 条」 on the drawer and on the page this list opens
     * (objectstack#35853), which can exceed the rows loaded so far.
     */
    const [listTotal, setListTotal] = useState<number | undefined>(undefined);
    listTotalRef.current = listTotal;
    const handleListTotalChange = useCallback((total: number) => setListTotal(total), []);
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
     * list's shown rows as its sibling set when the list reported any. Always
     * `null` for an object with no record surface.
     */
    const drawerRoot = useMemo<RecordDrawerLevel | null>(
        () => {
            if (!drawerRecordId || !recordServed) return null;
            const set = listSiblingSetOf(listRows, drawerRecordId);
            // The matched count belongs to the whole list, not to one group.
            const total = set && !set.scope && listTotal != null && listTotal >= set.siblings.length ? listTotal : undefined;
            return {
                objectName: objectDef.name,
                recordId: drawerRecordId,
                ...(set ?? {}),
                ...(total !== undefined ? { total } : {}),
            };
        },
        [drawerRecordId, objectDef.name, listRows, listTotal, recordServed],
    );
    // Sync URL-based recordId to overlay state. On a phone there is no pane to
    // open: the drawer link is answered by the record's page, in its place in
    // the history (objectstack#27058).
    // A `?recordId=` link to an object with no record surface opens nothing.
    useEffect(() => {
        const openedId = recordServed ? drawerRecordId : null;
        if (phone) {
            if (openedId) handleNavOverlayNavigate(openedId, undefined, undefined, true);
            return;
        }
        if (openedId && !navOverlay.isOpen) {
            navOverlay.open({ id: openedId });
        } else if (!openedId && navOverlay.isOpen) {
            navOverlay.close();
        }
    }, [drawerRecordId, phone, recordServed]);
    return { listRecordActions, navOverlay, handleDrawerClose, handleRowClick, handleOpenAsPage, handleOpenRowInPanel, drawerRoot, drawerRestore, handleListRowsChange, handleListTotalChange, handleRootStep, listLabel };
}
