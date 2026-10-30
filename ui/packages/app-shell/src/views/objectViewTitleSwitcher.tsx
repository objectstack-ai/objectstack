/**
 * The view switcher of the Console `ObjectView` (`./ObjectView.tsx`): the list
 * title is the switcher (objectstack#27594). The title reads
 * 「VIEW LABEL ▾ · COUNT」 and opens a dropdown — a search box, then the
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
 * The dropdown ends with New view (the Create View dialog) and, for an admin,
 * Manage views (`ManageViewsDialog`): the rename, delete, shared default and
 * configure acts that each tab's ▾ menu used to carry.
 *
 * Below `sm` the page header is not drawn; the app bar's view switcher
 * (`MobileViewSwitcherContext`) stays the phone's control.
 */

import { useMemo, useState, type ComponentType, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { cn, Input, Popover, PopoverContent, PopoverTrigger } from '@object-ui/components';
import type { ViewTabItem } from '@object-ui/plugin-view';
import { resolveViewId } from '@object-ui/core';
import { useDisplayLocale, pickLocalized } from '@object-ui/i18n';
import type { useObjectLabel, useObjectTranslation } from '@object-ui/i18n';
import { Check, ChevronDown, ListOrdered, Pin, Plus, Star } from 'lucide-react';
import { viewRowId } from '../utils/viewIdentity.js';
import { useRecentItems } from '../hooks/useRecentItems.js';
import { useListViewFavorites, type ListViewFavorites } from '../layout/listViewFavorites.js';
import type { useMetaItemRefusal } from '../hooks/useMetaItemRefusal.js';
import type { useServedViewItems } from '../hooks/useServedViewItems.js';
import { VIEW_TYPE_ICONS } from './objectViewHelpers.js';
import { viewTabLabel } from './viewTabLabel.js';
import type { buildViewTabs } from './objectViewTabs.js';
import type { ConsoleObjectViewProps } from './ObjectView.js';

type TFn = ReturnType<typeof useObjectTranslation>['t'];

/** How many views the dropdown's Recent section lists at most. */
const RECENT_VIEW_LIMIT = 3;

/** One view the switcher offers. */
export interface TitleSwitcherView {
    id: string;
    label: string;
    type: string;
    /** Authored in the object's metadata (read-only), as opposed to a view saved at runtime. */
    authored: boolean;
}

export interface ObjectViewTitleSwitcherProps {
    /** The views, in the order the list keeps them (the reader's Manage views order included). */
    views: readonly TitleSwitcherView[];
    /** The open view, or `''` when none is (a view the server refused). */
    activeViewId: string;
    /** The title's text: the open view's label, or the object's when none is open. */
    activeLabel: string;
    /** The records the open view matched, when the list reported them. */
    count?: number;
    /** The open view's description, the title's tooltip. */
    description?: string;
    onViewChange: (viewId: string) => void;
    /** The reader's pinned view for this object, if any. */
    pinnedViewId: string | null;
    /** Pin a view (it opens by default), or `null` to unpin. */
    onPinnedViewChange: (viewId: string | null) => void;
    /** The views the reader opened lately, most recent first. */
    recentViewIds: readonly string[];
    /** The ☆ of each row; absent off an app route, where no row offers one. */
    favorites: ListViewFavorites | null;
    viewTypeIcons?: Record<string, ComponentType<{ className?: string }>>;
    /** New view: the Create View dialog. Absent ⇒ not offered. */
    onAddView?: () => void;
    /** Manage views: the admin's dialog. Absent ⇒ not offered. */
    onManageViews?: () => void;
    t: TFn;
}

/** The authored views first, then the saved ones, each in the list's order. */
function authoredFirst(views: readonly TitleSwitcherView[]): TitleSwitcherView[] {
    return [...views.filter((v) => v.authored), ...views.filter((v) => !v.authored)];
}

function SectionLabel({ children, icon }: { children: ReactNode; icon?: ReactNode }) {
    return (
        <div className="flex items-center gap-1.5 px-2 pt-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {icon}
            {children}
        </div>
    );
}

export function ObjectViewTitleSwitcher({
    views,
    activeViewId,
    activeLabel,
    count,
    description,
    onViewChange,
    pinnedViewId,
    onPinnedViewChange,
    recentViewIds,
    favorites,
    viewTypeIcons = VIEW_TYPE_ICONS,
    onAddView,
    onManageViews,
    t,
}: ObjectViewTitleSwitcherProps) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');

    const byId = useMemo(() => new Map(views.map((v) => [v.id, v])), [views]);
    const all = useMemo(() => authoredFirst(views), [views]);
    const pinned = pinnedViewId ? byId.get(pinnedViewId) : undefined;
    const recent = recentViewIds
        .filter((id) => id !== pinned?.id)
        .map((id) => byId.get(id))
        .filter((v): v is TitleSwitcherView => !!v)
        .slice(0, RECENT_VIEW_LIMIT);
    const needle = query.trim().toLocaleLowerCase();
    const matches = needle ? all.filter((v) => v.label.toLocaleLowerCase().includes(needle)) : all;

    const onOpenChange = (next: boolean) => {
        setOpen(next);
        if (!next) setQuery('');
    };
    const choose = (viewId: string) => {
        onOpenChange(false);
        if (viewId !== activeViewId) onViewChange(viewId);
    };

    const row = (view: TitleSwitcherView, section: string) => {
        const Icon = viewTypeIcons[view.type];
        const active = view.id === activeViewId;
        const isPinned = view.id === pinned?.id;
        const inMenu = !!favorites?.inMenu(view.id);
        const starred = !inMenu && !!favorites?.isFavorite(view.id);
        const starLabel = inMenu
            ? t('view.switcher.inMenu', { defaultValue: 'Already in the menu' })
            : starred
                ? t('common.removeFromFavorites', { defaultValue: 'Remove from favorites' })
                : t('common.addToFavorites', { defaultValue: 'Add to favorites' });
        const pinLabel = isPinned
            ? t('view.switcher.unpin', { defaultValue: 'Unpin: the list opens its default view again' })
            : t('view.switcher.pin', { defaultValue: 'Pin: open this view by default' });
        // Shown on hover or focus, and always while set, so a starred or pinned
        // view says so without a hover.
        const reveal = 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100';
        return (
            <div
                key={`${section}:${view.id}`}
                data-testid={`view-switcher-row-${view.id}`}
                data-section={section}
                className="group flex items-center gap-0.5 rounded-sm hover:bg-muted"
            >
                <button
                    type="button"
                    onClick={() => choose(view.id)}
                    aria-current={active ? 'true' : undefined}
                    className={cn(
                        'flex min-w-0 flex-1 items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        active ? 'font-medium text-foreground' : 'text-foreground/90',
                    )}
                >
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground">
                        {Icon ? <Icon className="h-4 w-4" /> : null}
                    </span>
                    <span className="truncate">{view.label}</span>
                    {active && <Check className="ml-auto h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
                </button>
                {favorites && (
                    <button
                        type="button"
                        data-testid="view-switcher-star"
                        aria-label={starLabel}
                        title={starLabel}
                        aria-pressed={starred}
                        aria-disabled={inMenu || undefined}
                        onClick={() => { if (!inMenu) favorites.toggle(view.id, view.label); }}
                        className={cn(
                            'flex h-7 w-7 shrink-0 items-center justify-center rounded-sm',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                            inMenu
                                ? 'cursor-default text-muted-foreground/40'
                                : 'text-muted-foreground hover:text-foreground',
                            !starred && reveal,
                        )}
                    >
                        <Star className={cn('h-3.5 w-3.5', starred && 'fill-current text-amber-500')} />
                    </button>
                )}
                <button
                    type="button"
                    data-testid="view-switcher-pin"
                    aria-label={pinLabel}
                    title={pinLabel}
                    aria-pressed={isPinned}
                    onClick={() => onPinnedViewChange(isPinned ? null : view.id)}
                    className={cn(
                        'flex h-7 w-7 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        isPinned ? 'text-foreground' : reveal,
                    )}
                >
                    <Pin className={cn('h-3.5 w-3.5', isPinned && 'fill-current')} />
                </button>
            </div>
        );
    };

    return (
        <span className="inline-flex min-w-0 max-w-full items-baseline gap-1.5">
            <Popover open={open} onOpenChange={onOpenChange}>
                <PopoverTrigger asChild>
                    <button
                        type="button"
                        data-testid="list-view-switcher"
                        title={description}
                        className={cn(
                            '-mx-1 inline-flex min-w-0 max-w-full items-center gap-1 rounded-md px-1 text-left',
                            'hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                            open && 'bg-muted',
                        )}
                    >
                        <span className="truncate">{activeLabel}</span>
                        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    </button>
                </PopoverTrigger>
                <PopoverContent
                    align="start"
                    className="w-72 p-0"
                    data-testid="list-view-switcher-menu"
                    aria-label={t('view.switcher.label', { defaultValue: 'Views' })}
                >
                    <div className="border-b p-2">
                        <Input
                            autoFocus
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder={t('view.searchViews', { defaultValue: 'Search views' })}
                            aria-label={t('view.searchViews', { defaultValue: 'Search views' })}
                            data-testid="list-view-switcher-search"
                            className="h-8"
                        />
                    </div>
                    <div className="max-h-80 overflow-y-auto p-1">
                        {needle ? (
                            matches.length > 0
                                ? matches.map((v) => row(v, 'match'))
                                : (
                                    <p className="px-2 py-3 text-center text-sm text-muted-foreground" data-testid="list-view-switcher-empty">
                                        {t('view.noViewsFound', { defaultValue: 'No views match your search.' })}
                                    </p>
                                )
                        ) : (
                            <>
                                {pinned && (
                                    <div data-testid="list-view-switcher-pinned">
                                        <SectionLabel icon={<Pin className="h-3 w-3" aria-hidden="true" />}>
                                            {t('view.switcher.pinned', { defaultValue: 'Pinned' })}
                                        </SectionLabel>
                                        {row(pinned, 'pinned')}
                                    </div>
                                )}
                                {recent.length > 0 && (
                                    <div data-testid="list-view-switcher-recent">
                                        <SectionLabel>{t('view.switcher.recent', { defaultValue: 'Recent' })}</SectionLabel>
                                        {recent.map((v) => row(v, 'recent'))}
                                    </div>
                                )}
                                <div data-testid="list-view-switcher-all">
                                    <SectionLabel>{t('view.switcher.all', { defaultValue: 'All views' })}</SectionLabel>
                                    {all.map((v) => row(v, 'all'))}
                                </div>
                            </>
                        )}
                    </div>
                    {(onAddView || onManageViews) && (
                        <div className="border-t p-1">
                            {onAddView && (
                                <button
                                    type="button"
                                    data-testid="list-view-switcher-new"
                                    onClick={() => { onOpenChange(false); onAddView(); }}
                                    className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                >
                                    <Plus className="h-4 w-4 text-muted-foreground" />
                                    {t('view.addNewView', { defaultValue: 'Add new view' })}
                                </button>
                            )}
                            {onManageViews && (
                                <button
                                    type="button"
                                    data-testid="list-view-switcher-manage"
                                    onClick={() => { onOpenChange(false); onManageViews(); }}
                                    className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                >
                                    <ListOrdered className="h-4 w-4 text-muted-foreground" />
                                    {t('view.manageViews', { defaultValue: 'Manage views' })}
                                </button>
                            )}
                        </div>
                    )}
                </PopoverContent>
            </Popover>
            {typeof count === 'number' && (
                <span className="shrink-0 font-normal text-muted-foreground" data-testid="list-view-switcher-count">
                    · {count.toLocaleString()}
                </span>
            )}
        </span>
    );
}

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
    viewTotal,
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
    /** The records the list reported for a view, when it did. */
    viewTotal: { viewId: string; total: number } | null;
}) {
    // objectui#12528 — the view's description rides on the switcher (the
    // title's tooltip). Resolved the way `ListView` resolves the same text
    // (`pickLocalized` on the display locale), and gated on the same switch
    // the relay hands `ListView` as `appearance.showDescription`: `false`
    // shows it nowhere.
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

    const switcherViews: TitleSwitcherView[] = viewTabItems.map((item) => ({
        id: item.id,
        label: item.label,
        type: item.type,
        authored: !!item.readonly,
    }));
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
    const openView = viewTabItems.find((item) => item.id === openViewId);
    const titleSwitcher = views.length >= 1 ? (
        <ObjectViewTitleSwitcher
            views={switcherViews}
            activeViewId={openViewId}
            activeLabel={openView?.label ?? unlabelledViewText}
            count={viewTotal && viewTotal.viewId === openViewId ? viewTotal.total : undefined}
            description={openView?.description}
            onViewChange={handleViewChange}
            pinnedViewId={pinnedViewId}
            onPinnedViewChange={setPinnedViewId}
            recentViewIds={recentViewIds}
            favorites={favorites}
            onAddView={isAdmin ? handleAddView : undefined}
            onManageViews={isAdmin ? () => setManageViewsOpen(true) : undefined}
            t={t}
        />
    ) : null;

    return { viewTabItems, titleSwitcher };
}
