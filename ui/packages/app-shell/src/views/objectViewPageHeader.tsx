/**
 * The page header of the Console `ObjectView` (`./ObjectView.tsx`): the
 * title (the view switcher, or the object's plural), managed-by badge,
 * description and icon, with the
 * header's actions (the create button, Import, the schema-driven toolbar and
 * the overflow menu with favorites and "Reset view") and their folded face,
 * moved out of `ObjectViewInner`'s JSX verbatim (objectstack#25992, slice 10).
 * Every value is passed in as a prop.
 */

import { createElement } from 'react';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@object-ui/components';
import { Upload, MoreHorizontal, RotateCcw } from 'lucide-react';
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
import type { useObjectViewListUrlState } from './objectViewListUrlState.js';
import type { useObjectViewHeaderChrome } from './objectViewHeaderChrome.js';
import type { ConsoleObjectViewProps } from './ObjectView.js';

export function ObjectViewPageHeader({
    objectDef,
    titleSwitcher,
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
    activeViewHasPreference,
    handleResetView,
    foldedHeaderActions,
}: {
    objectDef: ConsoleObjectViewProps['objects'][number];
    /** The list's view switcher (`./objectViewTitleSwitcher.tsx`), or `null` with no view to switch. */
    titleSwitcher: ReactNode;
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
    activeViewHasPreference: ReturnType<typeof useObjectViewListUrlState>['activeViewHasPreference'];
    handleResetView: ReturnType<typeof useObjectViewListUrlState>['handleResetView'];
    foldedHeaderActions: ReturnType<typeof useObjectViewHeaderChrome>['foldedHeaderActions'];
}) {
    return (
             <div className="hidden sm:block">
             <PageHeader
                 // The title is the view switcher, 「VIEW ▾ · COUNT」
                 // (objectstack#27594); the object stays named by the
                 // sidebar's active entry and this header's icon. A view with
                 // no label is called by the plural (objectui#12774); with no
                 // view to switch, the page lists the object's records and is
                 // titled with the plural, as the nav entry that opens it is
                 // (objectui#11696); the record page keeps the singular.
                 title={titleSwitcher ?? objectPluralLabel(objectDef)}
                 // The kind chip, in the header's own slot after the title
                 // (objectui#12606).
                 badge={<ManagedByBadge managedBy={(objectDef as any)?.managedBy} />}
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
                        "Reset view" (objectui#12418) is the same kind of act and
                        lives beside it, so the one-row header keeps its shape
                        as the user sorts. The ⋯ is drawn when either applies. */}
                    {(listFavorite || activeViewHasPreference) && (
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
                          {listFavorite && (
                            <FavoriteMenuItem
                              isFavorite={listFavorite.isFavorite}
                              onToggle={listFavorite.toggle}
                              testId="object-view-favorite"
                            />
                          )}
                          {/* objectui#12418 — the user's own list state for
                              this view (sort, filters, column layout) back to
                              the view's. Only while they have stored some. */}
                          {activeViewHasPreference && (
                            <DropdownMenuItem
                              onSelect={handleResetView}
                              title={t('console.objectView.resetViewTitle')}
                              data-testid="object-view-reset-view-button"
                            >
                              <RotateCcw className="h-4 w-4" />
                              <span>{t('console.objectView.resetView')}</span>
                            </DropdownMenuItem>
                          )}
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
