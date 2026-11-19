/**
 * The view switcher of the Console `ObjectView` (`./ObjectView.tsx`): it leads
 * the list's view bar (objectstack#35548) and reads, as ONE trigger, the open
 * layout's type icon, the view label, the record count and the caret
 * 「▦ VIEW LABEL 23 ▾」. The count is the list's own (`ListRecordCountContext`,
 * provided where the list hands the switcher its slot), so the switcher draws
 * none where no list counts for it (a chart). It opens a dropdown — a search box, then the
 * reader's pinned view (📌), the views they opened lately, and every view, the
 * authored ones first — so an object with many views is switched the way it is
 * with two. It replaced the flat view-tab row (`ViewTabBar`), which overflowed
 * at five and was cramped beside an open record.
 *
 * Each row offers, on hover:
 * - ☆, the reader's star: the view becomes an entry of the sidebar's
 *   Favorites section (`../layout/listViewFavorites.ts`). A view the app's own
 *   navigation already opens shows its ☆ disabled: it is in the menu already.
 * - 📌, the reader's pin: the pinned view is the one this object's list opens
 *   when the address names none (`LIST_PINNED_VIEW_PREFERENCE`, per object).
 *
 * The reader's own views, My views (objectstack#29635, `./personalViews.ts`),
 * are a section of their own, My views, beside the views the object's
 * packages and environment declare. Their rows offer Rename and Delete too,
 * and their 📌 is the same pin: a personal view pinned is the reader's default.
 *
 * The dropdown's body is `./objectViewSwitcherMenu.tsx` (objectstack#35553).
 * It ends with 「Add view」, which turns the dropdown into the in-place create
 * card (Save as my view folds into it: one of the reader's own views by
 * default, a shared draft for a reader who may create one), and, for an
 * admin, Manage views (`ManageViewsDialog`): the rename, delete, shared
 * default and configure acts that each tab's ▾ menu used to carry.
 *
 * At every width the switcher leads the list's toolbar row (`ListView`'s
 * `toolbarLeading`) or heads a chart (objectstack#27058, objectstack#35548):
 * one switcher on every width, and neither the page bar nor the app bar draws
 * a view dropdown of its own.
 */

import { createContext, createElement, useContext, useMemo, useState, type ComponentType, type Dispatch, type SetStateAction } from 'react';
import { cn, Popover, PopoverContent, PopoverTrigger } from '@object-ui/components';
import type { ViewTabItem } from '@object-ui/plugin-view';
import { resolveViewId } from '@object-ui/core';
import { useDisplayLocale, pickLocalized } from '@object-ui/i18n';
import type { useObjectLabel, useObjectTranslation } from '@object-ui/i18n';
import { ChevronDown } from 'lucide-react';
import { viewRowId } from '../utils/viewIdentity.js';
import { useRecentItems } from '../hooks/useRecentItems.js';
import { useListViewFavorites, type ListViewFavorites } from '../layout/listViewFavorites.js';
import type { useMetaItemRefusal } from '../hooks/useMetaItemRefusal.js';
import type { useServedViewItems } from '../hooks/useServedViewItems.js';
import { VIEW_TYPE_ICONS } from './objectViewHelpers.js';
import { viewTabLabel } from './viewTabLabel.js';
import type { buildViewTabs } from './objectViewTabs.js';
import type { ConsoleObjectViewProps } from './ObjectView.js';
import { ObjectViewSwitcherMenu, type SwitcherCreateOptions } from './objectViewSwitcherMenu.js';
import { useCreateViewInPlace } from './objectViewViewCrud.js';

type TFn = ReturnType<typeof useObjectTranslation>['t'];

/**
 * What the list on screen tells the switcher that leads its view bar
 * (objectstack#35548): how many records it holds (`null` while it does not say)
 * and the layout it draws, which a reader's personal layout change can make
 * differ from the view's own type. Absent (no provider) ⇒ the switcher shows
 * no count and the view's own type icon.
 */
export interface ListRecordCountState {
    count: number | null;
    layout?: string;
}

export const ListRecordCountContext = createContext<ListRecordCountState | null>(null);

/** One view the switcher offers. */
export interface TitleSwitcherView {
    id: string;
    label: string;
    type: string;
    /** Authored in the object's metadata (read-only), as opposed to a view saved at runtime. */
    authored: boolean;
    /** One of the reader's own views (My views, a `sys_personal_view` row). */
    personal?: boolean;
}

export interface ObjectViewTitleSwitcherProps {
    /** The views, in the order the list keeps them (the reader's Manage views order included). */
    views: readonly TitleSwitcherView[];
    /** The open view, or `''` when none is (a view the server refused). */
    activeViewId: string;
    /** The title's text: the open view's label, or the object's when none is open. */
    activeLabel: string;
    /** The open view's description, the trigger's tooltip (objectstack#35548: on every face). */
    description?: string;
    onViewChange: (viewId: string) => void;
    /** The reader's pinned view for this object, if any. */
    pinnedViewId?: string | null;
    /**
     * Pin a view (it opens by default), or `null` to unpin. Absent ⇒ no row
     * offers 📌 and no Pinned section is listed: a host with no reader of its
     * own (the Studio, objectstack#30046) has no default to pin.
     */
    onPinnedViewChange?: (viewId: string | null) => void;
    /** The views the reader opened lately, most recent first; absent ⇒ no Recent section. */
    recentViewIds?: readonly string[];
    /** The ☆ of each row; absent off an app route, where no row offers one. */
    favorites: ListViewFavorites | null;
    viewTypeIcons?: Record<string, ComponentType<{ className?: string }>>;
    /** 「Add view」 with no create card: the Create View dialog. Absent ⇒ only the card, if any. */
    onAddView?: () => void;
    /** Manage views: the admin's dialog. Absent ⇒ not offered. */
    onManageViews?: () => void;
    /** Rename one of the reader's own views. Absent ⇒ not offered. */
    onRenamePersonalView?: (viewId: string) => void;
    /** Delete one of the reader's own views. Absent ⇒ not offered. */
    onDeletePersonalView?: (viewId: string) => void;
    /**
     * 「Add view」 as the in-place create card (objectstack#35553); Save as my
     * view folds into it. Absent ⇒ `onAddView`, if any.
     */
    create?: SwitcherCreateOptions;
    t: TFn;
}

export function ObjectViewTitleSwitcher({
    views,
    activeViewId,
    activeLabel,
    description,
    onViewChange,
    pinnedViewId = null,
    onPinnedViewChange,
    recentViewIds = [],
    favorites,
    viewTypeIcons = VIEW_TYPE_ICONS,
    onAddView,
    onManageViews,
    onRenamePersonalView,
    onDeletePersonalView,
    create,
    t,
}: ObjectViewTitleSwitcherProps) {
    const [open, setOpen] = useState(false);
    const listState = useContext(ListRecordCountContext);
    const displayLocale = useDisplayLocale();

    const byId = useMemo(() => new Map(views.map((v) => [v.id, v])), [views]);
    const activeType = listState?.layout ?? byId.get(activeViewId)?.type;
    const ActiveIcon = activeType ? viewTypeIcons[activeType] : undefined;
    const count = listState?.count ?? null;

    const choose = (viewId: string) => {
        setOpen(false);
        if (viewId !== activeViewId) onViewChange(viewId);
    };

    return (
        <span className="inline-flex min-w-0 max-w-full items-baseline gap-1.5">
            <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                    <button
                        type="button"
                        data-testid="list-view-switcher"
                        title={description}
                        // No negative margin: the title's width is its content's, and a
                        // margin pulled out of it truncated the label it was sized for.
                        className={cn(
                            // Below `sm` the trigger is a 44 px touch target.
                            // One trigger, 28px tall and 13px like every control of the
                            // view bar (objectstack#35548): type icon, label, count, caret.
                            'inline-flex h-7 min-w-0 max-w-full items-center gap-1.5 rounded-md px-1.5 text-left text-[13px] font-medium leading-none max-sm:min-h-11 max-sm:min-w-11',
                            // Inset: the title clips what overflows it (`truncate`), an outer ring included.
                            'hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                            open && 'bg-muted',
                        )}
                    >
                        {ActiveIcon && (
                            <span className="flex shrink-0 text-muted-foreground" data-testid="list-view-switcher-type-icon" aria-hidden="true">
                                {createElement(ActiveIcon, { className: 'h-4 w-4' })}
                            </span>
                        )}
                        <span className="truncate" data-testid="list-view-switcher-label">{activeLabel}</span>
                        {count !== null && (
                            <span className="shrink-0 font-normal tabular-nums text-muted-foreground max-sm:hidden" data-testid="list-view-switcher-count">
                                {count.toLocaleString(displayLocale)}
                            </span>
                        )}
                        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" data-testid="list-view-switcher-caret" aria-hidden="true" />
                    </button>
                </PopoverTrigger>
                {/* The dropdown's body (objectstack#35553): the views, grouped, and
                    「Add view」, which turns it into the in-place create card. */}
                <PopoverContent
                    align="start"
                    className="w-72 p-0"
                    data-testid="list-view-switcher-menu"
                    aria-label={t('view.switcher.label', { defaultValue: 'Views' })}
                >
                    <ObjectViewSwitcherMenu
                        views={views}
                        activeViewId={activeViewId}
                        onChoose={choose}
                        onClose={() => setOpen(false)}
                        pinnedViewId={pinnedViewId}
                        onPinnedViewChange={onPinnedViewChange}
                        recentViewIds={recentViewIds}
                        favorites={favorites}
                        viewTypeIcons={viewTypeIcons}
                        onManageViews={onManageViews}
                        onRenamePersonalView={onRenamePersonalView}
                        onDeletePersonalView={onDeletePersonalView}
                        create={create}
                        onAddView={onAddView}
                        t={t}
                    />
                </PopoverContent>
            </Popover>
        </span>
    );
}

// The doors of a host that offers no in-place create: never called, since no
// card is drawn without `create`.
const NO_LIST_STATE = () => ({ url: {} });
const REFUSE_SAVE = async (): Promise<string> => { throw new Error('no personal views here'); };
const IGNORE = () => {};
const REFUSE_CREATE = async (): Promise<boolean> => false;

/**
 * The view items (which `ManageViewsDialog` lists too) and the title switcher
 * of an object's list. Every input is passed in; the component reads the
 * returned values. Replaces the view tab strip (objectstack#27594).
 */
export function useObjectViewTitleSwitcher({
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
    setManageViewsOpen,
    pinnedViewId,
    setPinnedViewId,
    appSegment,
    personalViewIds,
    create,
    onRenamePersonalView,
    onDeletePersonalView,
}: {
    views: ReturnType<typeof buildViewTabs>;
    savedViews: Parameters<typeof buildViewTabs>[0]['savedViews'];
    objectDef: ConsoleObjectViewProps['objects'][number];
    servedViews: ReturnType<typeof useServedViewItems>;
    viewLabel: ReturnType<typeof useObjectLabel>['viewLabel'];
    unlabelledViewText: string;
    language: ReturnType<typeof useObjectTranslation>['language'];
    t: TFn;
    viewAccess: ReturnType<typeof useMetaItemRefusal>;
    activeViewId: string | undefined;
    handleViewChange: (viewId: string) => void;
    isAdmin: boolean;
    handleAddView: () => void;
    setManageViewsOpen: Dispatch<SetStateAction<boolean>>;
    /** The reader's pinned view for this object (`LIST_PINNED_VIEW_PREFERENCE`). */
    pinnedViewId: string | null;
    setPinnedViewId: (viewId: string | null) => void;
    /** The app segment of the route, for the ☆ (`/apps/APP/...`). */
    appSegment: string | undefined;
    /** The ids of the reader's own views among `views` (objectstack#29635). */
    personalViewIds: ReadonlySet<string>;
    /**
     * The in-place create of the dropdown's 「Add view」 (objectstack#35553):
     * who may create which kind, whether the list holds unsaved filters or
     * sort, and the host's doors (`useCreateViewInPlace`). Neither kind
     * allowed ⇒ no card, and an admin keeps the Create View dialog.
     */
    create?: Omit<Parameters<typeof useCreateViewInPlace>[0], 'objectName' | 't'> & {
        canCreatePersonal: boolean;
        canCreateShared: boolean;
        hasUnsavedConditions: boolean;
    };
    onRenamePersonalView?: (viewId: string) => void;
    onDeletePersonalView?: (viewId: string) => void;
}) {
    const createInPlace = useCreateViewInPlace({
        objectName: objectDef.name,
        activeView: create?.activeView,
        readListState: create?.readListState ?? NO_LIST_STATE,
        savePersonal: create?.savePersonal ?? REFUSE_SAVE,
        openPersonal: create?.openPersonal ?? IGNORE,
        createShared: create?.createShared ?? REFUSE_CREATE,
        clearSourceListState: create?.clearSourceListState,
        t,
    });
    const createOptions: SwitcherCreateOptions | undefined = create && (create.canCreatePersonal || create.canCreateShared)
        ? {
            objectDef,
            canCreatePersonal: create.canCreatePersonal,
            canCreateShared: create.canCreateShared,
            hasUnsavedConditions: create.hasUnsavedConditions,
            onCreate: createInPlace,
        }
        : undefined;
    // objectui#12528 — the view's description is shown once. It rides on the
    // switcher, as the trigger's tooltip, on every face: since
    // objectstack#35548 the switcher leads the list's view bar (the list's
    // `toolbarLeading`), and a list with a leading node draws no info control
    // of its own. Resolved the way `ListView` resolves the same text
    // (`pickLocalized` on the display locale), and gated on the same switch
    // the relay hands `ListView` as `appearance.showDescription`: `false`
    // shows it nowhere.
    const displayLocale = useDisplayLocale();
    const viewItems: ViewTabItem[] = views.map((view: any) => {
        const saved = savedViews.find((sv: any) => viewRowId(sv) === view.id);
        // objectstack#29635 — the reader's own view is named by the name its
        // owner gave it, drawn as given: it is no package's view to translate.
        const personal = personalViewIds.has(view.id);
        // System views (loaded from objectDef.listViews / metadata) are
        // *read-only*. Only sys_view-backed records can be mutated by
        // the user; admins must duplicate a system view to customize it.
        const isSystem = !saved;
        return {
            id: view.id,
            label: personal
                ? String(view.label ?? '')
                : viewTabLabel(view, objectDef.name, servedViews, viewLabel, unlabelledViewText, language),
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

    // The reader's own views are switched to here but are no view the admin's
    // Manage views lists: they are each reader's data, not the object's views.
    const viewTabItems = viewItems.filter((item) => !personalViewIds.has(item.id));
    const switcherViews: TitleSwitcherView[] = viewItems.map((item) => {
        const personal = personalViewIds.has(item.id);
        return {
            id: item.id,
            label: item.label,
            type: item.type,
            authored: !personal && !!item.readonly,
            ...(personal ? { personal: true } : {}),
        };
    });
    const viewIds = switcherViews.map((v) => v.id);

    // The views the reader opened lately (objectui#12604 records each list
    // view visit), resolved against this list's ids: a visit is recorded by
    // the address's view segment, which may be the short or the qualified name.
    const { recentItems } = useRecentItems();
    const recentViewIds: string[] = [];
    for (const item of recentItems) {
        if (item.type !== 'view' || item.object !== objectDef.name) continue;
        const id = resolveViewId(item.name, viewIds, objectDef.name);
        if (id && !recentViewIds.includes(id)) recentViewIds.push(id);
    }

    const favorites = useListViewFavorites({
        appSegment,
        objectName: objectDef.name,
        objectIcon: typeof (objectDef as { icon?: unknown }).icon === 'string' ? (objectDef as { icon: string }).icon : undefined,
        viewIds,
    });

    const openViewId = viewAccess.refusal ? '' : activeViewId ?? '';
    const openView = viewItems.find((item) => item.id === openViewId);
    const titleLabel = openView?.label ?? unlabelledViewText;
    const titleSwitcher = views.length >= 1 ? (
        <ObjectViewTitleSwitcher
            views={switcherViews}
            activeViewId={openViewId}
            activeLabel={titleLabel}
            description={openView?.description}
            onViewChange={handleViewChange}
            pinnedViewId={pinnedViewId}
            onPinnedViewChange={setPinnedViewId}
            recentViewIds={recentViewIds}
            favorites={favorites}
            onAddView={isAdmin ? handleAddView : undefined}
            onManageViews={isAdmin ? () => setManageViewsOpen(true) : undefined}
            create={createOptions}
            onRenamePersonalView={onRenamePersonalView}
            onDeletePersonalView={onDeletePersonalView}
            t={t}
        />
    ) : null;

    return { viewTabItems, titleSwitcher, titleLabel };
}
