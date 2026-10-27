/**
 * The plugin schema of the Console `ObjectView` (`./ObjectView.tsx`): the views
 * array with the open draft merged in, and the `ObjectViewSchema` handed to the
 * plugin `ObjectView`, with the active view's toolbar policy read from
 * `userActions`, moved out of `ObjectViewInner` verbatim (objectstack#25992,
 * slice 9). Every input is passed in; the component reads the returned values.
 */

import { useMemo } from 'react';
import type { NavigateFunction, Location } from 'react-router-dom';
import { normalizeListViewSchema } from '@object-ui/core';
import type { useObjectLabel, useObjectTranslation } from '@object-ui/i18n';
import type { useServedViewItems } from '../hooks/useServedViewItems.js';
import { viewTabLabel } from './viewTabLabel.js';
import type { buildViewTabs } from './objectViewTabs.js';
import type { ConsoleObjectViewProps } from './ObjectView.js';

export function useObjectViewPluginSchema({
    views,
    activeViewId,
    viewDraft,
    activeView,
    objectDef,
    onEdit,
    isAdmin,
    location,
    navigate,
    viewId,
    servedViews,
    viewLabel,
    unlabelledViewText,
    language,
}: {
    views: ReturnType<typeof buildViewTabs>;
    activeViewId: string;
    viewDraft: Partial<ReturnType<typeof buildViewTabs>[number]> | null;
    activeView: ReturnType<typeof buildViewTabs>[number];
    objectDef: ConsoleObjectViewProps['objects'][number];
    onEdit: ConsoleObjectViewProps['onEdit'];
    isAdmin: boolean;
    location: Location;
    navigate: NavigateFunction;
    viewId: string | undefined;
    servedViews: ReturnType<typeof useServedViewItems>;
    viewLabel: ReturnType<typeof useObjectLabel>['viewLabel'];
    unlabelledViewText: string;
    language: ReturnType<typeof useObjectTranslation>['language'];
}) {
    // Memoize the merged views array so PluginObjectView doesn't get a new
    // reference on every render (which would trigger unnecessary data refetches).
    const mergedViews = useMemo(() =>
        views.map((v: any) =>
            v.id === activeViewId && viewDraft && viewDraft.id === v.id
                ? { ...v, ...viewDraft }
                : v
        ),
        [views, activeViewId, viewDraft]
    );

    // objectui#11013 — the active view's toolbar policy, read under its declared
    // spelling `userActions.search` / `.filter` / `.sort`. These used to be read
    // as the bare `showSearch` / `showFilters` / `showSort` flags, so a view
    // that declared `userActions: { search: false }` still got a search box
    // here. A stored view that still carries a bare flag is folded onto
    // `userActions` by `normalizeListViewSchema`, the one fold the relay's own
    // `userActions` rung already runs; this read names no legacy key. Not
    // memoised: `activeView` is a fresh object on every render while a draft is
    // open, and the schema below keys on the three booleans, not on this value.
    const activeViewUserActions = (normalizeListViewSchema(activeView ?? {}) as {
        userActions?: { search?: boolean; filter?: boolean; sort?: boolean };
    }).userActions;
    const activeViewSearch = activeViewUserActions?.search !== false;
    const activeViewFilter = activeViewUserActions?.filter !== false;
    const activeViewSort = activeViewUserActions?.sort !== false;

    // Build the ObjectViewSchema for the plugin — reads from activeView (which merges draft)
    const objectViewSchema = useMemo(() => ({
        type: 'object-view' as const,
        objectName: objectDef.name,
        layout: 'page' as const,
        showSearch: activeViewSearch,
        showFilters: activeViewFilter,
        showSort: activeViewSort,
        showCreate: false, // We render our own create button in the header
        allowCreateView: isAdmin,
        viewActions: isAdmin ? [
            { type: 'settings' as const },
            { type: 'share' as const },
            { type: 'delete' as const },
        ] : [],
        onNavigate: (recordId: string | number, mode: 'view' | 'edit') => {
            if (mode === 'edit') {
                onEdit?.({ id: recordId });
            } else if (mode === 'view') {
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
            }
        },
    }), [objectDef, onEdit, activeViewSearch, activeViewFilter, activeViewSort, activeView?.id, activeView?.name, activeView?.label, navigate, viewId, isAdmin, location.pathname, location.search, viewLabel, unlabelledViewText, servedViews, language]);

    return { mergedViews, objectViewSchema };
}
