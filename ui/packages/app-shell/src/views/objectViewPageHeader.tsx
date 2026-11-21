/**
 * The page bar of the Console `ObjectView` (`./ObjectView.tsx`), 44px tall
 * (objectstack#35548, `PageHeader`'s list posture): the object's icon in one
 * colour and its plural name with the managed-by badge on the left; on the
 * right the schema-driven toolbar, the ⋮ menu and the create button, or their
 * folded face. The view switcher is not here: it leads the list's view bar.
 * The ⋮ menu holds what is not used every time: the object's description,
 * Import and the favorites entry (objectui#12427).
 * Moved out of `ObjectViewInner`'s JSX (objectstack#25992, slice 10). Every
 * value is passed in as a prop.
 */

import { createContext, createElement, useCallback, useContext, useLayoutEffect, useState } from 'react';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@object-ui/components';
import { Upload, MoreVertical } from 'lucide-react';
import type { useObjectLabel, useObjectTranslation } from '@object-ui/i18n';
import { FavoriteMenuItem } from '../layout/SidebarItemMenu.js';
import type { useObjectListFavorite } from '../layout/SidebarItemMenu.js';
import { getIcon } from '../utils/getIcon.js';
import { PageHeader } from '../layout/PageHeader.js';
import { ManagedByBadge } from '../components/ManagedByBadge.js';
import { EnvironmentListToolbar } from '../environment/EnvironmentListToolbar.js';
import { ListHeaderActionBar } from './objectViewHeaderLaunchGate.js';
import type { useObjectViewToolbarAffordances } from './objectViewToolbarAffordances.js';
import type { useObjectViewHeaderToolbar } from './objectViewHeaderToolbar.js';
import type { useObjectViewHeaderChrome } from './objectViewHeaderChrome.js';
import type { ConsoleObjectViewProps } from './ObjectView.js';
import { useListPageBarHost } from '@object-ui/plugin-grid';

/**
 * objectstack#35446 — the list header's width under which it takes
 * `PageHeader`'s compact form: the folded actions (New labelled, Import and
 * the rest in the 「⋯」 menu). The `md` breakpoint, read against the header's
 * own width, so a main area narrowed by the AI panel, a small window or the
 * record drawer gets it, and a full-width list does not. (Since
 * objectstack#35548 the list bar draws no description at any width: it waits
 * in the ⋮.)
 */
const LIST_HEADER_COMPACT_WIDTH = 768;

export interface ObjectViewPageBarProps {
    objectDef: ConsoleObjectViewProps['objects'][number];
    objectPluralLabel: ReturnType<typeof useObjectLabel>['objectPluralLabel'];
    objectDesc: ReturnType<typeof useObjectLabel>['objectDescription'];
    createButton: ReturnType<typeof useObjectViewHeaderChrome>['createButton'];
    importShown: ReturnType<typeof useObjectViewHeaderChrome>['importShown'];
    setShowImport: Dispatch<SetStateAction<boolean>>;
    importDisabled: ReturnType<typeof useObjectViewToolbarAffordances>['importDisabled'];
    t: ReturnType<typeof useObjectTranslation>['t'];
    listActions: ReturnType<typeof useObjectViewToolbarAffordances>['listActions'];
    isEnvironmentList: ReturnType<typeof useObjectViewToolbarAffordances>['isEnvironmentList'];
    headerToolbarActions: ReturnType<typeof useObjectViewHeaderToolbar>['headerToolbarActions'];
    environmentEntitlements: ReturnType<typeof useObjectViewToolbarAffordances>['environmentEntitlements'];
    toolbarBar: ReturnType<typeof useObjectViewHeaderToolbar>['toolbarBar'];
    listFavorite: ReturnType<typeof useObjectListFavorite>;
    foldedHeaderActions: ReturnType<typeof useObjectViewHeaderChrome>['foldedHeaderActions'];
}

/**
 * objectstack#35878 — the page's own acts, after the list's search at the
 * right end of the view bar (or of the page bar where no view bar draws them):
 * the schema-driven toolbar, the create button, then ⋮ More, last at the right
 * edge (objectstack#35678). The ⋮ menu holds what is not used every time: the
 * object's description, Import and the favorites entry (objectui#12427).
 */
export function ObjectViewPageBarActions({
    objectDef,
    objectDesc,
    createButton,
    importShown,
    setShowImport,
    importDisabled,
    t,
    listActions,
    isEnvironmentList,
    headerToolbarActions,
    environmentEntitlements,
    toolbarBar,
    listFavorite,
}: ObjectViewPageBarProps) {
    const description = objectDef.description ? objectDesc(objectDef) : undefined;
    // The ⋮ menu: the description (no longer a resident subtitle), Import and
    // the favorites entry — the page's once-in-a-while acts.
    const moreShown = !!description || importShown || !!listFavorite;
    return (
        <>
            {/* Schema-driven toolbar actions */}
            {listActions?.some((a: any) => a.locations?.includes('list_toolbar')) && (
              isEnvironmentList ? (
                <EnvironmentListToolbar
                  actions={headerToolbarActions}
                  entitlements={environmentEntitlements}
                />
              ) : (
              <ListHeaderActionBar schema={toolbarBar} />
              )
            )}

            {/* Primary action (see `createButton`), then ⋮ More last. */}
            {createButton}

            {moreShown && (
              <ObjectViewMoreMenu
                description={description}
                importShown={importShown}
                setShowImport={setShowImport}
                importDisabled={importDisabled}
                listFavorite={listFavorite}
                t={t}
              />
            )}

        </>
    );
}

export interface ObjectViewMoreMenuProps extends Pick<ObjectViewPageBarProps, 'importShown' | 'setShowImport' | 'importDisabled' | 'listFavorite' | 't'> {
    /** The object's description, the menu's first line; absent ⇒ none. */
    description?: string;
    /** Items before the rest (the phone's 「Select」, objectstack#35883). */
    leading?: ReactNode;
    /** The trigger's class: the page bar's 28 px, or the phone top row's 44 px. */
    triggerClassName?: string;
}

/**
 * The page's ⋮ More: the object's description, Import and the favorites
 * entry (objectui#12427), at the right edge of the view bar from `sm` up and of
 * the phone's top row below it (objectstack#35883), where 「Select」 leads it.
 */
export function ObjectViewMoreMenu({
    description,
    importShown,
    setShowImport,
    importDisabled,
    listFavorite,
    leading,
    triggerClassName = 'shadow-none h-7 w-7 px-0',
    t,
}: ObjectViewMoreMenuProps) {
    const rest = !!description || importShown || !!listFavorite;
    return (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    className={triggerClassName}
                    aria-label={t('detail.moreActions', { defaultValue: 'More actions' })}
                    data-testid="object-view-more-actions"
                  >
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64">
                  {leading}
                  {leading && rest && <DropdownMenuSeparator />}
                  {description && (
                    <>
                      <DropdownMenuLabel
                        className="text-[13px] font-normal leading-5 text-muted-foreground whitespace-normal"
                        data-testid="object-view-description"
                      >
                        {description}
                      </DropdownMenuLabel>
                      {(importShown || listFavorite) && <DropdownMenuSeparator />}
                    </>
                  )}
                  {/* [#5142] `objectCanImport && importVisible` — the object-level
                      verdict, then the toolbar-scope `visibleWhen` layer on top of
                      it. Greyed, not gone, is the `disabledWhen` case. */}
                  {importShown && (
                    <DropdownMenuItem
                      onSelect={() => setShowImport(true)}
                      disabled={importDisabled}
                      title={t('console.objectView.importTitle')}
                      data-testid="object-view-import-button"
                    >
                      <Upload className="h-4 w-4" />
                      <span>{t('console.objectView.import')}</span>
                    </DropdownMenuItem>
                  )}
                  {listFavorite && (
                    <FavoriteMenuItem
                      isFavorite={listFavorite.isFavorite}
                      onToggle={listFavorite.toggle}
                      testId="object-view-favorite"
                    />
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
    );
}

export function ObjectViewPageHeader(props: ObjectViewPageBarProps) {
    const { objectDef, objectPluralLabel, foldedHeaderActions } = props;
    const actionProps = props;
    const pluralLabel = objectPluralLabel(objectDef);
    // objectstack#35554 — the page bar's selection slot (`useListPageBarHost`,
    // `@object-ui/plugin-grid`). The list in this page column fills it while
    // rows are selected — 「已选 N 条」, Cancel and the actions for what is
    // selected — and this bar shows it in place of its title and actions.
    const [selectionSlot, setSelectionSlot] = useState<HTMLDivElement | null>(null);
    const [pageColumn, setPageColumn] = useState<HTMLElement | null>(null);
    const headerRootRef = useCallback((el: HTMLDivElement | null) => {
        setPageColumn(el?.parentElement ?? null);
    }, []);
    const pageBar = useListPageBarHost(selectionSlot, pageColumn);
    return (
             <div className="hidden sm:block" ref={headerRootRef}>
             {/* objectstack#35554 — the selection face: the object's name, then
                 what the list draws into the slot. Always mounted, so the slot
                 is there the moment a row is ticked; shown only while one is. */}
             <div
                 className={pageBar.selecting
                     ? 'relative shrink-0 border-b bg-background z-10'
                     : 'hidden'}
                 data-testid="list-selection-page-bar"
                 aria-hidden={pageBar.selecting ? undefined : true}
             >
                 {/* The list bar's measure (objectstack#35548): 44px, 13px type. */}
                 <div className="flex h-11 items-center gap-2 px-4">
                     <span className="shrink-0 text-[13px] font-semibold leading-5 text-muted-foreground">
                         {pluralLabel}
                     </span>
                     <span aria-hidden="true" className="shrink-0 text-muted-foreground/60">/</span>
                     <div ref={setSelectionSlot} className="flex min-w-0 flex-1 items-center" />
                 </div>
             </div>
             <PageHeader
                 className={pageBar.selecting ? 'hidden' : undefined}
                 posture="list"
                 // The object's plural: the page lists its records (objectui#11696).
                 // The view is named in the view bar below, by its switcher.
                 title={pluralLabel}
                 // The kind chip, in the header's own slot after the title
                 // (objectui#12606).
                 badge={<ManagedByBadge managedBy={(objectDef as any)?.managedBy} />}
                 // `createElement`, not a JSX tag: the looked-up icon is a value,
                 // which react-hooks/static-components refuses in tag position
                 // (the convention ObjectDataPage set).
                 icon={createElement(getIcon((objectDef as any)?.icon), { className: 'h-4 w-4' })}
                 actions={<ObjectViewPageBarActions {...actionProps} />}
                 foldedActions={foldedHeaderActions}
                 compactBelow={LIST_HEADER_COMPACT_WIDTH}
             />
             </div>
    );
}

/**
 * objectstack#35878 — told when the list's view bar draws the page's name and
 * acts (`ObjectViewBarTrailing` is mounted): the page then draws no page bar
 * of its own, so the list has two rows above it, not three. Provided by the
 * page column; absent ⇒ nothing listens and the page bar stays.
 */
export const ListViewBarHostContext = createContext<((hosted: boolean) => void) | null>(null);

/** The page column's marker: the scope a view bar's selection slot speaks for. */
export const OBJECT_VIEW_PAGE_COLUMN_ATTR = 'data-object-view-page-column';

/**
 * The view bar's object name. `pl-1.5` matches the switcher's own 6px padding,
 * so the object's icon starts on the list page's 16px line (objectstack#35663):
 * the bar's left padding is 10px from `sm` up.
 */
export const VIEW_BAR_OBJECT_NAME = 'hidden min-w-0 shrink items-center gap-1.5 sm:flex sm:pl-1.5';

/**
 * The view bar's right end, added in both faces: the bar ends 8px in, and the
 * last control there is ⋮, a 28px box around a 16px icon, so 2px more puts
 * that icon's edge 16px in, where the footer's padding ends (objectstack#35663).
 */
export const VIEW_BAR_END_INSET = 'sm:pr-0.5';

/**
 * objectstack#35878 — the start of the view bar: the object's icon and plural
 * name, then 「/」, then the view switcher. Clicking the name does nothing: it
 * names the page. From `sm` up only; a phone names the object in its top bar.
 */
export function ObjectViewBarObjectName({
    objectDef,
    objectPluralLabel,
}: Pick<ObjectViewPageBarProps, 'objectDef' | 'objectPluralLabel'>) {
    return (
        <span className={VIEW_BAR_OBJECT_NAME} data-testid="list-view-bar-object">
            <span className="flex shrink-0 items-center text-muted-foreground" aria-hidden="true">
                {createElement(getIcon((objectDef as any)?.icon), { className: 'h-4 w-4' })}
            </span>
            {/* The page's heading: the page bar that held the `h1` is not drawn. */}
            <h1 className="min-w-0 truncate text-[13px] font-medium leading-5 text-muted-foreground" data-testid="list-view-bar-object-name">
                {objectPluralLabel(objectDef)}
            </h1>
            <ManagedByBadge managedBy={(objectDef as any)?.managedBy} />
            <span aria-hidden="true" className="shrink-0 text-muted-foreground/60">/</span>
        </span>
    );
}

/**
 * objectstack#35878 — the right end of the view bar: the list's own tools (its
 * search), then the page's acts (`ObjectViewPageBarActions`: create, then ⋮
 * More at the edge, objectstack#35678). While rows are selected the end shows
 * what the selection offers instead (objectstack#35554's slot,
 * `useListPageBarHost`), and ⋮ More stays the last control with the same
 * icon. The page's acts are drawn from `sm` up; a phone keeps its floating
 * create button.
 */
export function ObjectViewBarTrailing({ tools, ...props }: ObjectViewPageBarProps & { tools: ReactNode }) {
    const setHosted = useContext(ListViewBarHostContext);
    useLayoutEffect(() => {
        if (!setHosted) return undefined;
        setHosted(true);
        return () => setHosted(false);
    }, [setHosted]);
    const [selectionSlot, setSelectionSlot] = useState<HTMLDivElement | null>(null);
    const [pageColumn, setPageColumn] = useState<HTMLElement | null>(null);
    const rootRef = useCallback((el: HTMLDivElement | null) => {
        setPageColumn(el?.closest<HTMLElement>(`[${OBJECT_VIEW_PAGE_COLUMN_ATTR}]`) ?? null);
    }, []);
    const pageBar = useListPageBarHost(selectionSlot, pageColumn);
    return (
        <div
            ref={rootRef}
            className={cn(VIEW_BAR_END_INSET, pageBar.selecting ? 'flex min-w-0 flex-1 items-center' : 'flex shrink-0 items-center gap-0.5')}
            data-testid="list-view-bar-end"
        >
            {/* Always mounted, so the slot is there the moment a row is ticked. */}
            <div
                ref={setSelectionSlot}
                className={pageBar.selecting ? 'flex min-w-0 flex-1 items-center' : 'hidden'}
                data-testid="list-selection-page-bar"
                aria-hidden={pageBar.selecting ? undefined : true}
            />
            {/* Hidden, not unmounted, while rows are selected: the search keeps
                its term and the header acts keep following the selection. */}
            <div className={pageBar.selecting ? 'hidden' : 'flex items-center gap-0.5'} data-testid="list-view-bar-tools">
                {tools}
                <span className="hidden items-center gap-1 pl-1 sm:flex" data-testid="list-view-bar-actions">
                    <ObjectViewPageBarActions {...props} />
                </span>
            </div>
        </div>
    );
}
