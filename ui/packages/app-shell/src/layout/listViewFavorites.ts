// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A reader's starred list views (objectstack#27594): the ☆ on a row of the list
 * title's view switcher puts that view in the sidebar's Favorites section (「收藏」),
 * the section objectui#12427 draws at the top of the sidebar.
 *
 * A starred view is a favorite of the one favorites store
 * (`FavoritesProvider`, the `ui.favorites` preference row), type `view`, id
 * `view:OBJECT:VIEW`, at the view's own address; the sidebar draws it in the
 * app that address names. The store is the one every other favorite lives in,
 * so the section holds one list, ordered by one drag, on every device.
 *
 * A view the app's own navigation already opens (an `object` entry naming the
 * object and the view in `viewName`) is not starred a second time: the author
 * put it in the menu, and the switcher shows its ☆ disabled.
 *
 * @module
 */

import { useMemo } from 'react';
import { resolveViewId } from '@object-ui/core';
import type { NavigationItem } from '@object-ui/types';
import { useFavorites } from '../hooks/useFavorites.js';
import { useNavMemberGates, navEntriesShownToMember } from '../hooks/useNavMemberGates.js';
import { useMetadata } from '../providers/MetadataProvider.js';
import { matchAppBySegment } from '../utils/index.js';

/** The favorite id of `objectName`'s list view `viewId`. */
export function listViewFavoriteId(objectName: string, viewId: string): string {
  return ['view', objectName, viewId].join(':');
}

/** The app segment a console address names (`/apps/APP/...`), or `undefined`. */
export function favoriteAppSegment(href: string): string | undefined {
  return /^\/apps\/([^/?#]+)/.exec(href)?.[1];
}

/** The object a `view` favorite's id names (`view:OBJECT:VIEW`), or `undefined`. */
export function listViewFavoriteObject(id: string): string | undefined {
  const match = /^view:([^:]+):/.exec(id);
  return match?.[1];
}

type NavApp = {
  name?: unknown;
  active?: unknown;
  navigation?: NavigationItem[];
  areas?: Array<{ navigation?: NavigationItem[] }>;
} & Record<string, unknown>;

/**
 * The `viewName`s of the entries of `app`'s navigation, as the member is shown
 * it, that open a view of `objectName`'s list: `object` entries naming the
 * object and a view, no single record. The areas are searched, then the app's
 * own navigation, groups included.
 */
function authoredViewNames(
  app: NavApp | undefined,
  objectName: string,
  gates: ReturnType<typeof useNavMemberGates>,
): string[] {
  if (!app) return [];
  const names: string[] = [];
  const walk = (items: NavigationItem[]) => {
    for (const item of items) {
      if (item.type === 'object' && item.objectName === objectName && item.viewName && !item.recordId) {
        names.push(item.viewName);
      }
      if (item.type === 'group' && item.children?.length) walk(item.children);
    }
  };
  for (const tree of [...(app.areas ?? []).map((area) => area.navigation ?? []), app.navigation ?? []]) {
    walk(navEntriesShownToMember(tree, gates));
  }
  return names;
}

export interface ListViewFavorites {
  /** Whether the reader starred view `viewId`. */
  isFavorite: (viewId: string) => boolean;
  /** Whether the app's navigation already opens view `viewId` (its ☆ is disabled). */
  inMenu: (viewId: string) => boolean;
  /** Star view `viewId` (shown as `label`), or take its star off. */
  toggle: (viewId: string, label: string) => void;
}

/**
 * The ☆ of the view switcher of `objectName`'s list in the app at
 * `appSegment`; `null` off an app route. `viewIds` are the ids the switcher
 * offers, which an authored `viewName` (short or qualified) resolves against.
 */
export function useListViewFavorites({
  appSegment,
  objectName,
  objectIcon,
  viewIds,
}: {
  appSegment: string | undefined;
  objectName: string | undefined;
  /** The object's icon, which the sidebar entry draws beside the view's label. */
  objectIcon?: string;
  viewIds: readonly string[];
}): ListViewFavorites | null {
  const { apps } = useMetadata();
  const gates = useNavMemberGates();
  const { isFavorite, toggleFavorite } = useFavorites();
  const app = appSegment
    ? matchAppBySegment(((apps ?? []) as NavApp[]).filter((a) => a.active !== false), appSegment)
    : undefined;
  const viewIdsKey = viewIds.join('\n');
  const menuViewIds = useMemo(() => {
    const ids = viewIdsKey ? viewIdsKey.split('\n') : [];
    const out = new Set<string>();
    if (!objectName) return out;
    for (const name of authoredViewNames(app, objectName, gates)) {
      const id = resolveViewId(name, ids, objectName);
      if (id) out.add(id);
    }
    return out;
  }, [app, objectName, gates, viewIdsKey]);
  if (!appSegment || !objectName) return null;
  const basePath = `/apps/${appSegment}`;
  return {
    isFavorite: (viewId) => isFavorite(listViewFavoriteId(objectName, viewId)),
    inMenu: (viewId) => menuViewIds.has(viewId),
    toggle: (viewId, label) => {
      if (menuViewIds.has(viewId)) return;
      toggleFavorite({
        id: listViewFavoriteId(objectName, viewId),
        label,
        href: `${basePath}/${objectName}/view/${viewId}`,
        type: 'view',
        ...(objectIcon ? { icon: objectIcon } : {}),
      });
    },
  };
}
