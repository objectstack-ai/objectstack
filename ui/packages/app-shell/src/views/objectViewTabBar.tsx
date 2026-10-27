/**
 * The view tab strip of the Console `ObjectView` (`./ObjectView.tsx`): the tab
 * items, the `ViewTabBar` handed to the list toolbar as `toolbarLeading`, and
 * its own-row face for the views that have no list toolbar, moved out of
 * `ObjectViewInner` verbatim (objectstack#25992, slice 9). Every input is
 * passed in; the component reads the returned values.
 */

import type { Dispatch, SetStateAction } from 'react';
import { ViewTabBar } from '@object-ui/plugin-view';
import type { ViewTabBarProps, ViewTabItem } from '@object-ui/plugin-view';
import { useDisplayLocale, pickLocalized } from '@object-ui/i18n';
import type { useObjectLabel, useObjectTranslation } from '@object-ui/i18n';
import { viewRowId } from '../utils/viewIdentity.js';
import type { useMetaItemRefusal } from '../hooks/useMetaItemRefusal.js';
import type { useServedViewItems } from '../hooks/useServedViewItems.js';
import { VIEW_TYPE_ICONS } from './objectViewHelpers.js';
import { useViewTabsFit } from './objectViewChrome.js';
import { viewTabLabel } from './viewTabLabel.js';
import type { buildViewTabs } from './objectViewTabs.js';
import type { ConsoleObjectViewProps } from './ObjectView.js';

export function useObjectViewTabBar({
    views,
    savedViews,
    objectDef,
    servedViews,
    viewLabel,
    unlabelledViewText,
    language,
    t,
    viewAccess,
    activeViewId,
    handleViewChange,
    isAdmin,
    handleAddView,
    handleRenameView,
    handleDeleteView,
    handlePinView,
    handleSetDefaultView,
    handleConfigView,
    setManageViewsOpen,
}: {
    views: ReturnType<typeof buildViewTabs>;
    savedViews: Parameters<typeof buildViewTabs>[0]['savedViews'];
    objectDef: ConsoleObjectViewProps['objects'][number];
    servedViews: ReturnType<typeof useServedViewItems>;
    viewLabel: ReturnType<typeof useObjectLabel>['viewLabel'];
    unlabelledViewText: string;
    language: ReturnType<typeof useObjectTranslation>['language'];
    t: ReturnType<typeof useObjectTranslation>['t'];
    viewAccess: ReturnType<typeof useMetaItemRefusal>;
    activeViewId: ViewTabBarProps['activeViewId'];
    handleViewChange: ViewTabBarProps['onViewChange'];
    isAdmin: boolean;
    handleAddView: NonNullable<ViewTabBarProps['onAddView']>;
    handleRenameView: NonNullable<ViewTabBarProps['onRenameView']>;
    handleDeleteView: NonNullable<ViewTabBarProps['onDeleteView']>;
    handlePinView: NonNullable<ViewTabBarProps['onPinView']>;
    handleSetDefaultView: NonNullable<ViewTabBarProps['onSetDefaultView']>;
    handleConfigView: NonNullable<ViewTabBarProps['onConfigView']>;
    setManageViewsOpen: Dispatch<SetStateAction<boolean>>;
}) {
    /*
     * View Tabs — Airtable-style switcher with rename / delete / duplicate /
     * pin / set-default / drag-reorder. Built-in views (sourced from
     * objectDef.listViews) only support switching; mutating callbacks
     * short-circuit with a toast.
     *
     * objectui#12440 — the strip is no longer a row of its own above the list:
     * it is handed to `ListView` as its `toolbarLeading` host prop, so the tabs
     * and the list's Filter · Sort · Display · Search share one row. From
     * `sm` up only; below it nothing is handed over and the app bar's mobile
     * view switcher (registered above) stays the phone's view control.
     */
    const viewTabsFit = useViewTabsFit();
    // objectui#12528 — the view's description rides on its tab (the active
    // tab's tooltip and ▾ menu header) instead of a row above the toolbar.
    // Resolved the way `ListView` resolves the same text (`pickLocalized` on
    // the display locale), and gated on the same switch the relay below hands
    // `ListView` as `appearance.showDescription`: `false` shows it nowhere.
    const displayLocale = useDisplayLocale();
    const viewTabItems: ViewTabItem[] = views.map((view: any) => {
        const saved = savedViews.find((sv: any) => viewRowId(sv) === view.id);
        // System views (loaded from objectDef.listViews / metadata) are
        // *read-only*. Only sys_view-backed records can be mutated by
        // the user; admins must duplicate a system view to customize it.
        const isSystem = !saved;
        return {
            id: view.id,
            label: viewTabLabel(view, objectDef.name, servedViews, viewLabel, unlabelledViewText, language),
            type: view.type,
            hasActiveFilters: Array.isArray(view.filter) && view.filter.length > 0,
            hasActiveSort: Array.isArray(view.sort) && view.sort.length > 0,
            isDefault: !!(saved?.isDefault ?? view.isDefault),
            isPinned: !!(saved?.isPinned ?? view.isPinned),
            visibility: saved?.visibility ?? view.visibility,
            readonly: isSystem,
            readonlyReason: isSystem
                ? t('console.objectView.systemViewReadonly')
                : undefined,
            description: (view.showDescription ?? view.appearance?.showDescription) === false
                ? undefined
                : pickLocalized(view.description, displayLocale) || undefined,
        } as ViewTabItem;
    });
    const viewTabBar = viewTabsFit && views.length >= 1 ? (
        <ViewTabBar
            views={viewTabItems}
            activeViewId={viewAccess.refusal ? '' : activeViewId}
            onViewChange={handleViewChange}
            viewTypeIcons={VIEW_TYPE_ICONS}
            config={{
                reorderable: false,
                showAddButton: isAdmin,
                showPinnedSection: true,
                showVisibilityGroups: true,
            }}
            onAddView={isAdmin ? handleAddView : undefined}
            onRenameView={isAdmin ? handleRenameView : undefined}
            onDeleteView={isAdmin ? handleDeleteView : undefined}
            onPinView={isAdmin ? handlePinView : undefined}
            onSetDefaultView={isAdmin ? handleSetDefaultView : undefined}
            onConfigView={isAdmin ? handleConfigView : undefined}
            onManageViews={isAdmin ? () => setManageViewsOpen(true) : undefined}
        />
    ) : null;

    // objectui#13114 — the strip as a row of its own, for the faces that have
    // no `ListView` toolbar to carry it: a view the server refused (drawn
    // page-level below) and a `type: 'chart'` view (drawn above the chart in
    // `renderListView`'s chart branch, which returns before `ListView`). Every
    // other face gets the strip in the list's toolbar row instead, so no face
    // ever draws two. Gated on `viewTabBar`, so below `sm` it is absent too.
    const viewTabRow = viewTabBar ? (
        <div className="border-b px-3 sm:px-4 bg-background overflow-x-auto shrink-0" data-testid="view-tab-row">
            {viewTabBar}
        </div>
    ) : null;

    return { viewTabItems, viewTabBar, viewTabRow };
}
