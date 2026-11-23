/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The ⌘K palette's "Current page" group (objectstack#36286): drawn at the top
 * of the empty palette, it offers what the page behind the palette offers.
 *
 * Each row runs the page's own entry, behind the page's own condition, and is
 * drawn only where the page draws that entry:
 *
 * - On an object's list (`ObjectView`), the list's favorites entry of its ⋮
 *   More menu: `useObjectListFavorite`, with the plural label the list is
 *   titled by.
 * - On a record page (`RecordDetailView`), the star beside the record's name:
 *   the `record` favorite `recordFavoriteItem` builds, named by the title the
 *   record was last visited under.
 *
 * The page is read off the address, matched against the route table the
 * console's own route reads are matched against (`APP_ROUTE_METADATA_READS`),
 * so a static route that shadows `:objectName` (`search`, `reports`) is not a
 * list. An object the console does not serve opens the not-found state, which
 * offers neither entry, so it has no group either.
 */

import { matchPath, matchRoutes } from 'react-router-dom';
import { CommandGroup, CommandItem } from '@object-ui/components';
import { Star, StarOff } from 'lucide-react';
import { useObjectLabel, useObjectTranslation } from '@object-ui/i18n';
import { APP_ROUTE_METADATA_READS } from '../console/appRouteMetadataReads.js';
import { objectViewRouteObject } from '../console/appObjectScope.js';
import { recordFavoriteItem } from '../context/FavoritesProvider.js';
import { useFavorites } from '../hooks/useFavorites.js';
import { useRecentItems } from '../context/RecentItemsProvider.js';
import { useRecentItemLabel } from '../hooks/useRecentItemLabel.js';
import { useObjectListFavorite } from '../layout/SidebarItemMenu.js';
import { servedObjectPluralLabel } from '../hooks/servedObjectLabel.js';
import { FAVORITE_ADD_KIND, FAVORITE_REMOVE_KIND } from './PaletteEnterHint.js';

/** The page behind the palette, when it is one the group offers entries for. */
export type PaletteCurrentPage =
  | { kind: 'list'; appSegment: string; objectName: string }
  | { kind: 'record'; appSegment: string; objectName: string; recordId: string };

/** The route paths (below `/apps/:appName`) whose element is `RecordDetailView`. */
const RECORD_PAGE_ROUTES: readonly string[] = [
  ':objectName/record/:recordId',
  ':objectName/record/:recordId/page/:pageName',
];

/**
 * The page at `pathname`: an object's list or a record page, of an object
 * `isServedObject` knows; `null` on every other page.
 */
export function paletteCurrentPage(
  pathname: string,
  isServedObject: (objectName: string) => boolean,
): PaletteCurrentPage | null {
  const app = matchPath('/apps/:appSegment/*', pathname);
  const appSegment = app?.params.appSegment;
  if (!appSegment) return null;
  const subPath = app.params['*'] ?? '';

  const listObject = objectViewRouteObject(subPath);
  if (listObject) return isServedObject(listObject) ? { kind: 'list', appSegment, objectName: listObject } : null;

  const matches = matchRoutes(
    APP_ROUTE_METADATA_READS.map(({ path }) => ({ path })),
    `/${subPath.replace(/^\/+/, '')}`,
  );
  const match = matches?.[matches.length - 1];
  if (!match || !RECORD_PAGE_ROUTES.includes(match.route.path ?? '')) return null;
  const { objectName, recordId } = match.params;
  if (!objectName || !recordId || !isServedObject(objectName)) return null;
  return { kind: 'record', appSegment, objectName, recordId };
}

/** The object definition keys the group reads. */
interface CurrentPageObjectDef {
  name: string;
  label?: unknown;
  pluralLabel?: unknown;
}

/**
 * The group's rows for `page`. `run` closes the palette and runs the entry,
 * as every palette command does.
 */
export function PaletteCurrentPageGroup({
  page,
  objectDef,
  run,
}: {
  page: PaletteCurrentPage;
  objectDef: CurrentPageObjectDef;
  run: (command: () => void) => void;
}) {
  const { t, language } = useObjectTranslation();
  const { objectPluralLabel } = useObjectLabel();
  const onList = page.kind === 'list';
  // The list's ⋮ More entry, with the title the list is drawn under.
  const listFavorite = useObjectListFavorite({
    appSegment: onList ? page.appSegment : undefined,
    objectName: onList ? page.objectName : undefined,
    label: servedObjectPluralLabel(objectDef, language, objectPluralLabel),
  });
  const { isFavorite, toggleFavorite } = useFavorites();
  const { recentItems } = useRecentItems();
  const recentLabel = useRecentItemLabel();

  let favorite: { isFavorite: boolean; toggle: () => void } | null = listFavorite;
  if (page.kind === 'record') {
    const id = recordFavoriteItem(page.appSegment, page.objectName, page.recordId, undefined).id;
    // The record page records its visit under the favorite's id, with its title.
    const visit = recentItems.find((item) => item.type === 'record' && item.id === id);
    const item = recordFavoriteItem(page.appSegment, page.objectName, page.recordId, visit ? recentLabel(visit) : undefined);
    favorite = { isFavorite: isFavorite(item.id), toggle: () => toggleFavorite(item) };
  }
  if (!favorite) return null;

  const { isFavorite: starred, toggle } = favorite;
  return (
    <CommandGroup heading={t('console.commandPalette.currentPage', { defaultValue: 'Current page' })}>
      <CommandItem
        data-testid="palette-current-page-favorite"
        value={`${starred ? FAVORITE_REMOVE_KIND : FAVORITE_ADD_KIND} current page ${page.kind} ${page.objectName}`}
        onSelect={() => run(toggle)}
      >
        {starred ? <StarOff className="mr-2 h-4 w-4" /> : <Star className="mr-2 h-4 w-4" />}
        <span className="truncate">
          {starred
            ? t('common.removeFromFavorites', { defaultValue: 'Remove from favorites' })
            : t('common.addToFavorites', { defaultValue: 'Add to favorites' })}
        </span>
      </CommandItem>
    </CommandGroup>
  );
}
