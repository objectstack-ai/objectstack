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

import { createElement } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import {
  Button,
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

export function ObjectViewPageHeader({
    objectDef,
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
    foldedHeaderActions,
}: {
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
}) {
    const pluralLabel = objectPluralLabel(objectDef);
    const description = objectDef.description ? objectDesc(objectDef) : undefined;
    // The ⋮ menu: the description (no longer a resident subtitle), Import and
    // the favorites entry — the page's once-in-a-while acts.
    const moreShown = !!description || importShown || !!listFavorite;
    return (
             <div className="hidden sm:block">
             <PageHeader
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
                 actions={
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

                    {moreShown && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="shadow-none h-7 w-7 px-0"
                            aria-label={t('detail.moreActions', { defaultValue: 'More actions' })}
                            data-testid="object-view-more-actions"
                          >
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-64">
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
                    )}

                    {/* Primary action (see `createButton`), last in the bar. */}
                    {createButton}
                   </>
                 }
                 foldedActions={foldedHeaderActions}
             />
             </div>
    );
}
