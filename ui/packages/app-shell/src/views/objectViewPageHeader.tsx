/**
 * The page bar of the Console `ObjectView` (`./ObjectView.tsx`), 44px tall
 * (objectstack#35548, `PageHeader`'s list posture): the object's icon tile
 * (objectstack#35985) and its plural name with the managed-by badge on the left.
 * Above a list it is the page's first row and carries no acts of its own
 * (objectstack#36113): the shell's button group ends it, as it ends every
 * console page, and the page's acts end the list's view bar under it
 * (`ObjectViewBarTrailing`). Where no view bar draws them it carries them on
 * the right — the schema-driven toolbar, the ⋮ menu and the create button,
 * or their folded face. The view switcher is not here: it leads the view bar.
 * Moved out of `ObjectViewInner`'s JSX (objectstack#25992, slice 10). Every
 * value is passed in as a prop.
 */

import { createContext, useCallback, useContext, useLayoutEffect, useState } from 'react';
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
  ObjectIconTile,
} from '@object-ui/components';
import { ArrowUpDown, ChevronDown, Download, Loader2, Upload, MoreVertical } from 'lucide-react';
import type { ListExportDoor } from '@object-ui/plugin-list';
import type { useObjectLabel, useObjectTranslation } from '@object-ui/i18n';
import { FavoriteMenuItem } from '../layout/SidebarItemMenu.js';
import type { useObjectListFavorite } from '../layout/SidebarItemMenu.js';
import { PageHeader } from '../layout/PageHeader.js';
import { ManagedByBadge } from '../components/ManagedByBadge.js';
import { EnvironmentListToolbar } from '../environment/EnvironmentListToolbar.js';
import { ListHeaderActionBar } from './objectViewHeaderLaunchGate.js';
import { pinnedHeaderActions, type ActionBarSchema } from '@object-ui/types';
import { DesignModeHeaderPins, useObjectPins } from '../layout/DesignModeHeaderPins.js';
import type { PinCandidate } from '../layout/designModeHeaderPins.js';
import type { useObjectViewToolbarAffordances } from './objectViewToolbarAffordances.js';
import type { useObjectViewHeaderToolbar } from './objectViewHeaderToolbar.js';
import type { useObjectViewHeaderChrome } from './objectViewHeaderChrome.js';
import type { ConsoleObjectViewProps } from './ObjectView.js';
import { useListPageScope } from '@object-ui/plugin-grid';

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
 * objectstack#36113 — how the page's acts sit at the view bar's end: the
 * list's export door (`ListView`'s `toolbarTrailing` state), and whether the
 * bar is too narrow for 「Import / Export」, which then folds into ⋮ More.
 */
export interface ObjectViewBarEnd {
    exportDoor?: ListExportDoor;
    folded: boolean;
}

/**
 * objectstack#35878 — the page's own acts, after the list's search at the
 * right end of the view bar (or of the page bar where no view bar draws them):
 * the schema-driven toolbar, the create button, then ⋮ More, last at the right
 * edge (objectstack#35678). The ⋮ menu holds what is not used every time: the
 * object's description and the favorites entry (objectui#12427).
 *
 * objectstack#36113 — at the view bar's end (`barEnd`), Import and the list's
 * export are one 「Import / Export」 menu before the rest, folded into ⋮ More
 * on a narrow bar; on the page bar Import stays in ⋮ More.
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
    barEnd,
}: ObjectViewPageBarProps & { barEnd?: ObjectViewBarEnd }) {
    const description = objectDef.description ? objectDesc(objectDef) : undefined;
    // objectstack#36366 — the object's list-page pins (`pinnedActions.list`):
    // the header's buttons, in order, the page's Import and Export among them
    // (`$import`, `$export`). Absent: the header's own choice, as before.
    // Under the design mode the pins staged there are drawn (`useObjectPins`).
    const objectPins = useObjectPins(objectDef);
    const listPins = isEnvironmentList ? undefined : objectPins.list;
    const importPinned = !!listPins?.includes('$import') && importShown;
    const exportPinned = !!listPins?.includes('$export') && !!barEnd?.exportDoor;
    // A pinned Import or Export is a button of its own, out of the menus.
    const importInMenus = importShown && !importPinned;
    const exportDoor = exportPinned ? undefined : barEnd?.exportDoor;
    // 「Import / Export」 is drawn at the view bar's end while it fits; folded,
    // and on the page bar, its entries are ⋮ More's.
    const ioAtEnd = !!barEnd && !barEnd.folded && (importInMenus || !!exportDoor);
    const ioInMore = !ioAtEnd;
    // The ⋮ menu: the description (no longer a resident subtitle), Import and
    // the favorites entry — the page's once-in-a-while acts.
    const moreShown = !!description || !!listFavorite || (ioInMore && (importInMenus || !!exportDoor));
    const drawsToolbar = !!listActions?.some((a: any) => a.locations?.includes('list_toolbar'));
    return (
        <>
            {ioAtEnd && (
              <ObjectViewImportExportMenu
                importShown={importInMenus}
                setShowImport={setShowImport}
                importDisabled={importDisabled}
                exportDoor={exportDoor}
                t={t}
              />
            )}

            {listPins ? (
              <PinnedListHeaderActions
                pins={listPins}
                toolbarBar={drawsToolbar ? toolbarBar : undefined}
                importButton={importPinned ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="shadow-none h-7 gap-1 px-2 text-sm font-normal"
                    onClick={() => setShowImport(true)}
                    disabled={importDisabled}
                    title={t('console.objectView.importTitle')}
                    data-testid="object-view-import-pinned"
                  >
                    <Upload className="h-3.5 w-3.5" />
                    <span>{t('console.objectView.import')}</span>
                  </Button>
                ) : null}
                exportButton={exportPinned && barEnd?.exportDoor ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        size="sm"
                        variant="outline"
                        className="shadow-none h-7 gap-1 px-2 text-sm font-normal"
                        data-testid="object-view-export-pinned"
                      >
                        <Download className="h-3.5 w-3.5" />
                        <span>{t('list.export', { defaultValue: 'Export' })}</span>
                        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                      <ExportMenuItems exportDoor={barEnd.exportDoor} t={t} />
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              />
            ) : (
              /* Schema-driven toolbar actions */
              drawsToolbar && (
                isEnvironmentList ? (
                  <EnvironmentListToolbar
                    actions={headerToolbarActions}
                    entitlements={environmentEntitlements}
                  />
                ) : (
                <ListHeaderActionBar schema={toolbarBar} />
                )
              )
            )}

            {/* Primary action (see `createButton`), then ⋮ More last. */}
            {createButton}

            {moreShown && (
              <ObjectViewMoreMenu
                description={description}
                importShown={ioInMore && importInMenus}
                setShowImport={setShowImport}
                importDisabled={importDisabled}
                exportDoor={ioInMore ? exportDoor : undefined}
                listFavorite={listFavorite}
                t={t}
              />
            )}

            {/* objectstack#36366 — the design mode's 「Header buttons」, last. */}
            {!isEnvironmentList && (
              <DesignModeHeaderPins
                objectDef={objectDef}
                page="list"
                actions={(headerToolbarActions ?? []) as Record<string, unknown>[]}
                builtins={listPinBuiltins(importShown, !!barEnd?.exportDoor, t)}
              />
            )}
        </>
    );
}

/** The list page's built-ins this reader is offered to pin: its Import and its Export, where the page draws them. */
function listPinBuiltins(importShown: boolean, exportShown: boolean, t: ObjectViewPageBarProps['t']): PinCandidate[] {
    return [
        ...(importShown ? [{ id: '$import', label: String(t('console.objectView.import')) }] : []),
        ...(exportShown ? [{ id: '$export', label: String(t('list.export', { defaultValue: 'Export' })) }] : []),
    ];
}

/**
 * objectstack#36366 — the list header's pinned buttons, in pin order: each
 * pinned action of the toolbar (`pinnedHeaderActions`), and the page's pinned
 * Import and Export where they are offered. Every other toolbar action is in
 * the toolbar's own ⋯ menu, drawn after them. A pin naming nothing this
 * reader is offered draws nothing.
 */
function PinnedListHeaderActions({
    pins,
    toolbarBar,
    importButton,
    exportButton,
}: {
    pins: readonly string[];
    toolbarBar?: ActionBarSchema;
    importButton: ReactNode;
    exportButton: ReactNode;
}) {
    const arranged = pinnedHeaderActions<any>((toolbarBar?.actions ?? []) as any[], pins, 'list');
    const byName = new Map<string, any>();
    for (const action of arranged) {
        if (action?.component !== 'action:menu' && typeof action?.name === 'string') byName.set(action.name, action);
    }
    const rest = arranged.filter((action) => action?.component === 'action:menu');
    // Runs of adjacent pinned actions share one bar, so a built-in pinned
    // between two actions sits between their buttons.
    const parts: ReactNode[] = [];
    let run: any[] = [];
    const flush = () => {
        if (run.length === 0 || !toolbarBar) return;
        parts.push(
            <ListHeaderActionBar
                key={`run-${parts.length}`}
                schema={{ ...toolbarBar, actions: run, maxVisible: run.length, mobileMaxVisible: run.length }}
            />,
        );
        run = [];
    };
    for (const pin of pins) {
        if (pin === '$import' || pin === '$export') {
            flush();
            const button = pin === '$import' ? importButton : exportButton;
            if (button) parts.push(<span key={pin} className="contents">{button}</span>);
            continue;
        }
        const action = byName.get(pin);
        if (action) run.push(action);
    }
    flush();
    if (rest.length > 0 && toolbarBar) {
        parts.push(<ListHeaderActionBar key="rest" schema={{ ...toolbarBar, actions: rest }} />);
    }
    return <>{parts}</>;
}

export interface ObjectViewMoreMenuProps extends Pick<ObjectViewPageBarProps, 'importShown' | 'setShowImport' | 'importDisabled' | 'listFavorite' | 't'> {
    /** The object's description, the menu's first line; absent ⇒ none. */
    description?: string;
    /** The list's export door, after Import (objectstack#36113: a narrow view bar); absent ⇒ none. */
    exportDoor?: ListExportDoor;
    /** Items before the rest (the phone's 「Select」, objectstack#35883). */
    leading?: ReactNode;
    /** The trigger's class: the page bar's 28 px, or the phone top row's 44 px. */
    triggerClassName?: string;
}

/**
 * The page's ⋮ More: the object's description, Import and the favorites
 * entry (objectui#12427), at the right edge of the view bar from `sm` up and of
 * the phone's top row below it (objectstack#35883), where 「Select」 leads it.
 * From `sm` up Import, with the list's export after it, is here only while the
 * view bar is too narrow for 「Import / Export」 (objectstack#36113).
 */
export function ObjectViewMoreMenu({
    description,
    importShown,
    setShowImport,
    importDisabled,
    exportDoor,
    listFavorite,
    leading,
    triggerClassName = 'shadow-none h-7 w-7 px-0',
    t,
}: ObjectViewMoreMenuProps) {
    const rest = !!description || importShown || !!exportDoor || !!listFavorite;
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
                        className="text-xs font-normal leading-5 text-muted-foreground whitespace-normal"
                        data-testid="object-view-description"
                      >
                        {description}
                      </DropdownMenuLabel>
                      {(importShown || exportDoor || listFavorite) && <DropdownMenuSeparator />}
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
                  {exportDoor && <ExportMenuItems exportDoor={exportDoor} t={t} />}
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

/**
 * The list's export entries, one per format, then the last export's failure —
 * what the 视图设置 footer offers too, through the same door
 * (`ListExportDoor`).
 */
function ExportMenuItems({ exportDoor, t }: { exportDoor: ListExportDoor; t: ObjectViewPageBarProps['t'] }) {
    return (
        <>
            {exportDoor.formats.map((format) => (
                <DropdownMenuItem
                    key={format}
                    disabled={exportDoor.busy}
                    onSelect={() => exportDoor.run(format)}
                    data-testid={`object-view-export-${format}`}
                >
                    {exportDoor.busy
                        ? <Loader2 className="h-4 w-4 animate-spin" />
                        : <Download className="h-4 w-4" />}
                    <span>{t('list.exportAs', { format: format.toUpperCase(), defaultValue: 'Export as {{format}}' })}</span>
                </DropdownMenuItem>
            ))}
            {exportDoor.error && (
                <DropdownMenuLabel role="alert" className="text-xs font-normal text-destructive whitespace-normal" data-testid="object-view-export-error">
                    {exportDoor.error}
                </DropdownMenuLabel>
            )}
        </>
    );
}

/**
 * objectstack#36113 — 「Import / Export」 at the view bar's end: Import, then
 * one entry per export format. Named for what it holds: only 「Import」 or only
 * 「Export」 when the reader is offered one of the two.
 */
export function ObjectViewImportExportMenu({
    importShown,
    setShowImport,
    importDisabled,
    exportDoor,
    t,
}: Pick<ObjectViewMoreMenuProps, 'importShown' | 'setShowImport' | 'importDisabled' | 'exportDoor' | 't'>) {
    const label = importShown && exportDoor
        ? t('console.objectView.importExport', { defaultValue: 'Import / Export' })
        : importShown
            ? t('console.objectView.import', { defaultValue: 'Import' })
            : t('list.export', { defaultValue: 'Export' });
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    size="sm"
                    variant="outline"
                    // 28px and 14px, like every control of the list's bars
                    // (objectstack#35548).
                    className="shadow-none h-7 gap-1 px-2 text-sm font-normal"
                    data-testid="object-view-import-export"
                >
                    <ArrowUpDown className="h-3.5 w-3.5" />
                    <span>{label}</span>
                    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
                {/* [#5142] the same verdict pair as the page bar's Import. */}
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
                {importShown && exportDoor && <DropdownMenuSeparator />}
                {exportDoor && <ExportMenuItems exportDoor={exportDoor} t={t} />}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

export function ObjectViewPageHeader({ hosted = false, ...props }: ObjectViewPageBarProps & {
    /**
     * objectstack#36113 — the list's view bar carries the page's acts
     * (`ListViewBarHostContext`): this bar is the page's first row, the
     * object's icon and name, and draws none of them.
     */
    hosted?: boolean;
}) {
    const { objectDef, objectPluralLabel, foldedHeaderActions } = props;
    const actionProps = props;
    const pluralLabel = objectPluralLabel(objectDef);
    // objectstack#35554 — this page column is a list page's scope
    // (`useListPageScope`, `@object-ui/plugin-grid`): the list in it draws no
    // row-end controls. A selection changes nothing up here: the list floats
    // its own selection bar at its bottom (objectstack#35678).
    const [pageColumn, setPageColumn] = useState<HTMLElement | null>(null);
    const headerRootRef = useCallback((el: HTMLDivElement | null) => {
        setPageColumn(el?.parentElement ?? null);
    }, []);
    useListPageScope(pageColumn);
    return (
             <div className="hidden sm:block" ref={headerRootRef}>
             <PageHeader
                 posture="list"
                 // The object's plural: the page lists its records (objectui#11696).
                 // The view is named in the view bar below, by its switcher.
                 title={pluralLabel}
                 // The kind chip, in the header's own slot after the title
                 // (objectui#12606).
                 badge={<ManagedByBadge managedBy={(objectDef as any)?.managedBy} />}
                 // The object's tile, in the colour the menu draws it in
                 // (objectstack#35985).
                 iconTile={<ObjectIconTile icon={(objectDef as any)?.icon} color={(objectDef as any)?.color} />}
                 actions={hosted ? undefined : <ObjectViewPageBarActions {...actionProps} />}
                 foldedActions={hosted ? undefined : foldedHeaderActions}
                 compactBelow={hosted ? undefined : LIST_HEADER_COMPACT_WIDTH}
             />
             </div>
    );
}

/**
 * objectstack#35878 — told when the list's view bar draws the page's acts
 * (`ObjectViewBarTrailing` is mounted): the page bar then draws none of its
 * own, only the object's icon and name (objectstack#36113: the object's row,
 * then the view bar, then the condition row). Provided by the page column;
 * absent ⇒ nothing listens and the page bar keeps its acts.
 */
export const ListViewBarHostContext = createContext<((hosted: boolean) => void) | null>(null);

/** The page column's marker: the scope a view bar's selection slot speaks for. */
export const OBJECT_VIEW_PAGE_COLUMN_ATTR = 'data-object-view-page-column';

/**
 * The view bar's right end, added in both faces: the bar ends 8px in, and the
 * last control there is ⋮, a 28px box around a 16px icon, so 2px more puts
 * that icon's edge 16px in, where the footer's padding ends (objectstack#35663).
 */
export const VIEW_BAR_END_INSET = 'sm:pr-0.5';

/**
 * objectstack#36113 — the list's width under which 「Import / Export」 folds
 * into ⋮ More: `56rem`, where the 视图设置 trigger drops its label too
 * (`ListView`'s `@[56rem]/list`).
 */
export const VIEW_BAR_IO_FOLD_WIDTH = 896;

/** The list's own box: `ListView`'s root, the `list` query container. */
const LIST_CONTAINER_SELECTOR = '[class~="@container/list"]';

/** Is `el` narrower than `width`? `false` until it is laid out. */
function useNarrowerThan(el: HTMLElement | null, width: number): boolean {
    const [narrow, setNarrow] = useState(false);
    useLayoutEffect(() => {
        if (!el) return undefined;
        // A box not laid out (zero wide) is not narrow: nothing is measured.
        const read = () => {
            const measured = el.getBoundingClientRect().width;
            setNarrow(measured > 0 && measured < width);
        };
        read();
        if (typeof ResizeObserver === 'undefined') return undefined;
        const observer = new ResizeObserver(read);
        observer.observe(el);
        return () => observer.disconnect();
    }, [el, width]);
    return narrow;
}

/**
 * objectstack#35878 — the right end of the view bar: the list's own tools (its
 * search), then the page's acts (`ObjectViewPageBarActions`: create, then ⋮
 * More at the edge, objectstack#35678). A selection changes nothing here: the
 * list floats its own selection bar at its bottom (objectstack#35678). The
 * page column is registered as a list page's scope (`useListPageScope`), so
 * its list draws no row-end controls. The page's acts are drawn from `sm` up;
 * a phone keeps its floating create button.
 *
 * objectstack#36113 — the bar is the page's second row: the object's row above
 * it ends with the shell's button group (`PageHeader`). Its end reads
 * 「search · Import / Export · New Account · ⋮」; while the list is narrower
 * than `VIEW_BAR_IO_FOLD_WIDTH`, 「Import / Export」 folds into ⋮ More (the
 * search's keyword hides first below `48rem`, in `ListView`'s own bar).
 */
export function ObjectViewBarTrailing({ tools, exportDoor, ...props }: ObjectViewPageBarProps & { tools: ReactNode; exportDoor?: ListExportDoor }) {
    const setHosted = useContext(ListViewBarHostContext);
    useLayoutEffect(() => {
        if (!setHosted) return undefined;
        setHosted(true);
        return () => setHosted(false);
    }, [setHosted]);
    const [pageColumn, setPageColumn] = useState<HTMLElement | null>(null);
    const [list, setList] = useState<HTMLElement | null>(null);
    const rootRef = useCallback((el: HTMLDivElement | null) => {
        setPageColumn(el?.closest<HTMLElement>(`[${OBJECT_VIEW_PAGE_COLUMN_ATTR}]`) ?? null);
        // The list's own box, the `@container/list` its bar's container
        // queries read, so this fold and theirs read one width.
        setList(el?.closest<HTMLElement>(LIST_CONTAINER_SELECTOR) ?? null);
    }, []);
    useListPageScope(pageColumn);
    const folded = useNarrowerThan(list, VIEW_BAR_IO_FOLD_WIDTH);
    return (
        <div
            ref={rootRef}
            className={cn(VIEW_BAR_END_INSET, 'flex shrink-0 items-center gap-0.5')}
            data-testid="list-view-bar-end"
        >
            <div className="flex items-center gap-0.5" data-testid="list-view-bar-tools">
                {tools}
                <span className="hidden items-center gap-1 pl-1 sm:flex" data-testid="list-view-bar-actions">
                    <ObjectViewPageBarActions {...props} barEnd={{ exportDoor, folded }} />
                </span>
            </div>
        </div>
    );
}
