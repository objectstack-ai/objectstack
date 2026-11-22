/**
 * The body of the list's view dropdown (the view bar's switcher opens it):
 *
 * - a search box over every view's name;
 * - the reader's pinned view and the views they opened lately, then their own
 *   views (My views) and the shared views, each a group of its own; every row
 *   leads with its view type's icon, and a long name wraps rather than being
 *   cut, so two names that share their first words still read apart;
 * - 「Add view」 at the bottom, which turns the dropdown into the in-place
 *   create card ({@link CreateViewCard}) — Save as my view folds into it — and
 *   Manage views for a reader the host offers it to.
 *
 * Each row offers on hover the reader's ☆ (sidebar Favorites) and 📌 (the
 * view this object's list opens by default), and on the reader's own views
 * Rename and Delete. For a reader who may share views (objectstack#36371),
 * the reader's own views add 「Make shared」 and a shared view saved here adds
 * 「Unshare」 (`./objectViewViewSharing.ts`). The trigger (type icon, name, count, caret) and the
 * popover around this body are the switcher's (`./objectViewTitleSwitcher.tsx`).
 */

import { lazy, Suspense, useState, type ComponentType, type ReactNode } from 'react';
import { cn, Input } from '@object-ui/components';
import type { useObjectTranslation } from '@object-ui/i18n';
import { Check, ListOrdered, Lock, Pencil, Pin, Plus, Share2, Star, Trash2 } from 'lucide-react';
import type { ListViewFavorites } from '../layout/listViewFavorites.js';
import { VIEW_TYPE_ICONS } from './objectViewHelpers.js';
import type { CreateViewCardProps } from './CreateViewDialog.js';
import type { TitleSwitcherView } from './objectViewTitleSwitcher.js';

// The create card shares its module with the Create View dialog, which loads
// on demand; the card does too, when the reader asks to add a view.
const CreateViewCard = lazy(() =>
    import('./CreateViewDialog.js').then((m) => ({ default: m.CreateViewCard })),
);

type TFn = ReturnType<typeof useObjectTranslation>['t'];

/** How many views the Recent group lists at most. */
const RECENT_VIEW_LIMIT = 3;

/** What the create card needs from the host; the card's names and keys come from `views`. */
export type SwitcherCreateOptions = Omit<CreateViewCardProps, 'onBack' | 'existingLabels' | 'existingKeys'>;

export interface ObjectViewSwitcherMenuProps {
    /** The views, in the order the list keeps them. */
    views: readonly TitleSwitcherView[];
    /** The open view, or `''` when none is. */
    activeViewId: string;
    /** Switch to a view; the host closes the dropdown. */
    onChoose: (viewId: string) => void;
    /** Close the dropdown (after a create, or before a dialog opens). */
    onClose: () => void;
    pinnedViewId?: string | null;
    /** Pin a view, or `null` to unpin. Absent ⇒ no 📌 and no Pinned group. */
    onPinnedViewChange?: (viewId: string | null) => void;
    recentViewIds?: readonly string[];
    favorites: ListViewFavorites | null;
    viewTypeIcons?: Record<string, ComponentType<{ className?: string }>>;
    /** Manage views. Absent ⇒ not offered. */
    onManageViews?: () => void;
    onRenamePersonalView?: (viewId: string) => void;
    onDeletePersonalView?: (viewId: string) => void;
    /** objectstack#36371 — 「Make shared」 on the reader's own views. Absent ⇒ not offered. */
    onMakeSharedView?: (viewId: string) => void;
    /** objectstack#36371 — 「Unshare」 on the shared views marked `unsharable`. Absent ⇒ not offered. */
    onUnshareView?: (viewId: string) => void;
    /** 「Add view」 and its card. Absent ⇒ `onAddView`, if any. */
    create?: SwitcherCreateOptions;
    /** 「Add view」 for a host with no card to offer: the dropdown closes and this runs (the Create View dialog). */
    onAddView?: () => void;
    /**
     * objectstack#35884 — the phone's view panel: the views take the sheet's
     * height, the search box comes last and does not take focus (no keyboard
     * rises over the views), and `footerEnd` follows 「Add view」.
     */
    phone?: boolean;
    /** A last footer row (the phone's 「View settings」, objectstack#35883). */
    footerEnd?: ReactNode;
    t: TFn;
}

/** The authored views first, then the saved ones, each in the list's order; the reader's own last. */
function authoredFirst(views: readonly TitleSwitcherView[]): TitleSwitcherView[] {
    return [
        ...views.filter((v) => v.authored),
        ...views.filter((v) => !v.authored && !v.personal),
        ...views.filter((v) => v.personal),
    ];
}

function GroupLabel({ children, icon }: { children: ReactNode; icon?: ReactNode }) {
    return (
        <div className="flex items-center gap-1.5 px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground">
            {icon}
            {children}
        </div>
    );
}

export const FOOTER_ITEM = 'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-sm:min-h-11';

export function ObjectViewSwitcherMenu({
    views,
    activeViewId,
    onChoose,
    onClose,
    pinnedViewId = null,
    onPinnedViewChange,
    recentViewIds = [],
    favorites,
    viewTypeIcons = VIEW_TYPE_ICONS,
    onManageViews,
    onRenamePersonalView,
    onDeletePersonalView,
    onMakeSharedView,
    onUnshareView,
    create,
    onAddView,
    phone = false,
    footerEnd,
    t,
}: ObjectViewSwitcherMenuProps) {
    const [mode, setMode] = useState<'list' | 'create'>('list');
    const [query, setQuery] = useState('');

    const byId = new Map(views.map((v) => [v.id, v]));
    const all = authoredFirst(views);
    const shared = all.filter((v) => !v.personal);
    const mine = all.filter((v) => v.personal);
    const pinned = pinnedViewId && onPinnedViewChange ? byId.get(pinnedViewId) : undefined;
    const recent = recentViewIds
        .filter((id) => id !== pinned?.id)
        .map((id) => byId.get(id))
        .filter((v): v is TitleSwitcherView => !!v)
        .slice(0, RECENT_VIEW_LIMIT);
    const needle = query.trim().toLocaleLowerCase();
    const matches = needle ? all.filter((v) => v.label.toLocaleLowerCase().includes(needle)) : all;

    if (mode === 'create' && create) {
        return (
            <Suspense fallback={<div className="h-48" aria-busy="true" />}>
                <CreateViewCard
                    {...create}
                    existingLabels={views.map((v) => v.label)}
                    existingKeys={views.map((v) => v.id)}
                    onBack={() => setMode('list')}
                    onCreate={async (request) => {
                        const created = await create.onCreate(request);
                        if (created) onClose();
                        return created;
                    }}
                />
            </Suspense>
        );
    }

    const row = (view: TitleSwitcherView, group: string) => {
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
        const renameLabel = t('view.rename', { defaultValue: 'Rename' });
        const deleteLabel = t('view.deleteView', { defaultValue: 'Delete View' });
        const makeSharedLabel = t('view.switcher.makeShared', { defaultValue: 'Make shared' });
        const unshareLabel = t('view.switcher.unshare', { defaultValue: 'Unshare' });
        const iconButton = 'flex h-7 w-7 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground max-sm:h-11 max-sm:w-11 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
        // Shown on hover or focus, and always while set; a touch screen has no
        // hover, so there they always show.
        const reveal = 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100';
        return (
            <div
                key={`${group}:${view.id}`}
                data-testid={`view-switcher-row-${view.id}`}
                data-section={group}
                className="group flex items-start gap-0.5 rounded-sm hover:bg-muted"
            >
                <button
                    type="button"
                    onClick={() => onChoose(view.id)}
                    aria-current={active ? 'true' : undefined}
                    title={view.label}
                    className={cn(
                        'flex min-w-0 flex-1 items-start gap-2 rounded-sm px-2 py-1.5 text-left text-sm max-sm:min-h-11',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        active ? 'font-medium text-foreground' : 'text-foreground/90',
                    )}
                >
                    <span className="flex h-[1.25rem] w-4 shrink-0 items-center justify-center text-muted-foreground" data-testid="view-switcher-type-icon">
                        {Icon ? <Icon className="h-4 w-4" /> : null}
                    </span>
                    {/* The whole name, wrapped: a cut name hides what tells two views apart. */}
                    <span className="min-w-0 break-words [overflow-wrap:anywhere]" data-testid="view-switcher-name">{view.label}</span>
                    {active && <Check className="ml-auto mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
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
                            'flex h-7 w-7 shrink-0 items-center justify-center rounded-sm max-sm:h-11 max-sm:w-11',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                            inMenu ? 'cursor-default text-muted-foreground/40' : 'text-muted-foreground hover:text-foreground',
                            !starred && reveal,
                        )}
                    >
                        <Star className={cn('h-3.5 w-3.5', starred && 'fill-current text-amber-500')} />
                    </button>
                )}
                {onPinnedViewChange && (
                    <button
                        type="button"
                        data-testid="view-switcher-pin"
                        aria-label={pinLabel}
                        title={pinLabel}
                        aria-pressed={isPinned}
                        onClick={() => onPinnedViewChange(isPinned ? null : view.id)}
                        className={cn(iconButton, isPinned ? 'text-foreground' : reveal)}
                    >
                        <Pin className={cn('h-3.5 w-3.5', isPinned && 'fill-current')} />
                    </button>
                )}
                {view.personal && onRenamePersonalView && (
                    <button
                        type="button"
                        data-testid="view-switcher-rename"
                        aria-label={renameLabel}
                        title={renameLabel}
                        onClick={() => { onClose(); onRenamePersonalView(view.id); }}
                        className={cn(iconButton, reveal)}
                    >
                        <Pencil className="h-3.5 w-3.5" />
                    </button>
                )}
                {view.personal && onMakeSharedView && (
                    <button
                        type="button"
                        data-testid="view-switcher-make-shared"
                        aria-label={makeSharedLabel}
                        title={makeSharedLabel}
                        onClick={() => { onClose(); onMakeSharedView(view.id); }}
                        className={cn(iconButton, reveal)}
                    >
                        <Share2 className="h-3.5 w-3.5" />
                    </button>
                )}
                {!view.personal && view.unsharable && onUnshareView && (
                    <button
                        type="button"
                        data-testid="view-switcher-unshare"
                        aria-label={unshareLabel}
                        title={unshareLabel}
                        onClick={() => { onClose(); onUnshareView(view.id); }}
                        className={cn(iconButton, reveal)}
                    >
                        <Lock className="h-3.5 w-3.5" />
                    </button>
                )}
                {view.personal && onDeletePersonalView && (
                    <button
                        type="button"
                        data-testid="view-switcher-delete"
                        aria-label={deleteLabel}
                        title={deleteLabel}
                        onClick={() => { onClose(); onDeletePersonalView(view.id); }}
                        className={cn(iconButton, reveal)}
                    >
                        <Trash2 className="h-3.5 w-3.5" />
                    </button>
                )}
            </div>
        );
    };

    const searchBox = (
    <div className={phone ? 'border-t p-2' : 'border-b p-2'}>
        <Input
            autoFocus={!phone}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('view.searchViews', { defaultValue: 'Search views' })}
            aria-label={t('view.searchViews', { defaultValue: 'Search views' })}
            data-testid="list-view-switcher-search"
            className="h-8 text-sm max-sm:h-11"
        />
    </div>
    );

    return (
        <div data-testid="list-view-switcher-body">
            {!phone && searchBox}
            <div className={phone ? 'p-1' : 'max-h-80 overflow-y-auto p-1'}>
                {needle ? (
                    matches.length > 0
                        ? matches.map((v) => row(v, 'match'))
                        : (
                            <p className="px-2 py-3 text-center text-xs text-muted-foreground" data-testid="list-view-switcher-empty">
                                {t('view.noViewsFound', { defaultValue: 'No views match your search.' })}
                            </p>
                        )
                ) : (
                    <>
                        {pinned && (
                            <div data-testid="list-view-switcher-pinned">
                                <GroupLabel icon={<Pin className="h-3 w-3" aria-hidden="true" />}>
                                    {t('view.switcher.pinned', { defaultValue: 'Pinned' })}
                                </GroupLabel>
                                {row(pinned, 'pinned')}
                            </div>
                        )}
                        {recent.length > 0 && (
                            <div data-testid="list-view-switcher-recent">
                                <GroupLabel>{t('view.switcher.recent', { defaultValue: 'Recent' })}</GroupLabel>
                                {recent.map((v) => row(v, 'recent'))}
                            </div>
                        )}
                        {mine.length > 0 && (
                            <div data-testid="list-view-switcher-mine">
                                <GroupLabel>{t('view.switcher.myViews', { defaultValue: 'My views' })}</GroupLabel>
                                {mine.map((v) => row(v, 'mine'))}
                            </div>
                        )}
                        {shared.length > 0 && (
                            <div data-testid="list-view-switcher-all">
                                <GroupLabel>{t('view.switcher.sharedViews', { defaultValue: 'Shared views' })}</GroupLabel>
                                {shared.map((v) => row(v, 'all'))}
                            </div>
                        )}
                    </>
                )}
            </div>
            {(create || onAddView || onManageViews || footerEnd) && (
                <div className="border-t p-1">
                    {(create || onAddView) && (
                        <button
                            type="button"
                            data-testid="list-view-switcher-new"
                            onClick={() => {
                                if (create) setMode('create');
                                else { onClose(); onAddView?.(); }
                            }}
                            className={FOOTER_ITEM}
                        >
                            <Plus className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                            {t('view.switcher.addView', { defaultValue: 'Add view' })}
                        </button>
                    )}
                    {onManageViews && (
                        <button
                            type="button"
                            data-testid="list-view-switcher-manage"
                            onClick={() => { onClose(); onManageViews(); }}
                            className={FOOTER_ITEM}
                        >
                            <ListOrdered className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                            {t('view.manageViews', { defaultValue: 'Manage views' })}
                        </button>
                    )}
                    {footerEnd}
                </div>
            )}
            {phone && searchBox}
        </div>
    );
}
