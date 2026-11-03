/**
 * The page header of the Console `ObjectView` (`./ObjectView.tsx`): the
 * title (the object's plural ahead of the view switcher, or the plural alone),
 * managed-by badge, description and icon, with the
 * header's actions (the create button, Import, the schema-driven toolbar and
 * the overflow menu with favorites) and their folded face, the 「Personalized」
 * marker beside the title (objectstack#28950),
 * moved out of `ObjectViewInner`'s JSX verbatim (objectstack#25992, slice 10).
 * Every value is passed in as a prop.
 */

import { createElement } from 'react';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import { Link } from 'react-router-dom';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@object-ui/components';
import { Upload, MoreHorizontal } from 'lucide-react';
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

/**
 * The list title 「OBJECT / VIEW ▾ · COUNT」 (objectstack#27950): the page
 * header is the one place a page is named (objectui#12461), and with the view
 * switcher as the title (objectstack#27594) it names the object too, with the
 * sidebar collapsed or the list opened from a link alike. The object's plural
 * links to its default list. It never shrinks: when the row is short the view
 * label truncates first, inside the switcher.
 */
function ObjectListTitle({
    objectLabel,
    objectListHref,
    titleSwitcher,
}: {
    objectLabel: string;
    objectListHref: string | undefined;
    titleSwitcher: ReactNode;
}) {
    const crumbClass = 'shrink-0 whitespace-nowrap text-muted-foreground';
    return (
        <span className="flex min-w-0 max-w-full items-baseline gap-1.5" data-testid="object-list-title">
            {objectListHref ? (
                <Link
                    to={objectListHref}
                    className={`${crumbClass} rounded-sm hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring`}
                    data-testid="object-list-crumb"
                >
                    {objectLabel}
                </Link>
            ) : (
                <span className={crumbClass} data-testid="object-list-crumb">{objectLabel}</span>
            )}
            <span aria-hidden="true" className="shrink-0 font-normal text-muted-foreground/60">/</span>
            {titleSwitcher}
        </span>
    );
}

export function ObjectViewPageHeader({
    objectDef,
    titleSwitcher,
    titleLabel,
    objectListHref,
    objectPluralLabel,
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
    personalizedMarker,
    foldedHeaderActions,
}: {
    objectDef: ConsoleObjectViewProps['objects'][number];
    /** The list's view switcher (`./objectViewTitleSwitcher.tsx`), or `null` with no view to switch. */
    titleSwitcher: ReactNode;
    /** The switcher's text: the open view's label, or the plural for a view with none. */
    titleLabel: string;
    /** The object's default list (`/apps/APP/OBJECT`), or `undefined` off an app route. */
    objectListHref: string | undefined;
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
    /**
     * objectstack#28950 — the 「Personalized」 marker (`./ListPersonalizedMarker.tsx`),
     * or `null` while the reader's list is the view's own. Drawn in the
     * header's badge slot, beside the title, in both of the header's faces.
     */
    personalizedMarker: ReactNode;
    foldedHeaderActions: ReturnType<typeof useObjectViewHeaderChrome>['foldedHeaderActions'];
}) {
    const pluralLabel = objectPluralLabel(objectDef);
    // A view with no label is already called by the plural (objectui#12774):
    // the switcher names the object, and a crumb would say it twice.
    const title = titleSwitcher == null
        ? pluralLabel
        : titleLabel === pluralLabel
            ? titleSwitcher
            : <ObjectListTitle objectLabel={pluralLabel} objectListHref={objectListHref} titleSwitcher={titleSwitcher} />;
    return (
             <div className="hidden sm:block">
             <PageHeader
                 // The title is the object's plural ahead of the view switcher,
                 // 「OBJECT / VIEW ▾ · COUNT」 (objectstack#27594,
                 // objectstack#27950). A view with no label is called by the
                 // plural (objectui#12774); with no view to switch, the page
                 // lists the object's records and is titled with the plural, as
                 // the nav entry that opens it is (objectui#11696); the record
                 // page keeps the singular.
                 title={title}
                 // The kind chip, in the header's own slot after the title
                 // (objectui#12606).
                 // objectstack#28950 — and, before it, the 「Personalized」
                 // marker while the reader's list differs from the view.
                 badge={<>{personalizedMarker}<ManagedByBadge managedBy={(objectDef as any)?.managedBy} /></>}
                 subtitle={objectDef.description ? objectDesc(objectDef) : undefined}
                 // `createElement`, not a JSX tag: the looked-up icon is a value,
                 // which react-hooks/static-components refuses in tag position
                 // (the convention ObjectDataPage set).
                 icon={createElement(getIcon((objectDef as any)?.icon), { className: 'h-4 w-4' })}
                 actions={
                   <>
                    {/* No favorite star here since objectui#12423: the one-row
                        header is icon, title, description and these actions.
                        The favorites entry is in the overflow menu at the end
                        of this row (objectui#12427). */}

                    {/* Primary action (see `createButton`). */}
                    {createButton}

                    {/* Data import — desktop only on phones. CSV imports
                        are inherently a desk/laptop workflow; the button
                        was eating header space on mobile next to the
                        primary "+" action. */}
                    {/* [#5142] `objectCanImport && importVisible` — the object-level
                        verdict, then the toolbar-scope `visibleWhen` layer on top of
                        it. Greyed, not gone, is the `disabledWhen` case below. */}
                    {importShown && (
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setShowImport(true)}
                        disabled={importDisabled}
                        className="hidden sm:inline-flex shadow-none gap-1.5 sm:gap-2 h-8 sm:h-9"
                        title={t('console.objectView.importTitle')}
                        data-testid="object-view-import-button"
                    >
                        <Upload className="h-4 w-4" />
                        <span className="hidden sm:inline">{t('console.objectView.import')}</span>
                    </Button>
                    )}

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

                    {/* The page's overflow menu (objectui#12427), last in the
                        row: the favorites entry that replaced the header star.
                        Favorites is a once-and-forget act, so it lives behind
                        the ⋯ rather than in the header's most prominent slot.
                        The list's way back to its view is the 「Personalized」
                        marker beside the title (objectstack#28950), not an
                        entry here. */}
                    {listFavorite && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="shadow-none h-8 sm:h-9 px-2"
                            aria-label={t('detail.moreActions', { defaultValue: 'More actions' })}
                            data-testid="object-view-more-actions"
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <FavoriteMenuItem
                            isFavorite={listFavorite.isFavorite}
                            onToggle={listFavorite.toggle}
                            testId="object-view-favorite"
                          />
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}

                    {/*
                       Design Tools dropdown removed — its items were redundant:
                       - "Edit view"  → use chevron menu's "Edit view config"
                       - "Add view"   → use the `+` button on the tab bar or the "Add new view" footer in Manage Views
                       - "Metadata inspector" → still toggleable via the `?__debug` URL flag (see useMetadataInspector)
                    */}
                   </>
                 }
                 foldedActions={foldedHeaderActions}
             />
             </div>
    );
}
