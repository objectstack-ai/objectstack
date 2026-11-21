/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The tile a Recent, Favorites or Starred row draws (objectstack#36141), by the
 * rule the menu's rows follow: an entry about an object (the object, one of its
 * list views, one of its records) is that object's tile, in the object's icon
 * and colour; every other entry (a dashboard, a page, a report) is the neutral
 * tile with its kind's icon. One rule, so a row looks the same wherever the
 * thing it opens appears.
 */

import * as React from 'react';
import { NeutralIconTile, ObjectIconTile, type ObjectIconTileSize } from '@object-ui/components';
import { NAV_KIND_ICON, type NavTargetColorResolver, type NavTargetIconResolver } from '@object-ui/layout';
import type { FavoriteItem } from '../context/FavoritesProvider.js';
import { getIcon } from '../utils/getIcon.js';

/**
 * The icon a content entry's neutral tile draws, per kind: the menu's glyphs
 * ({@link NAV_KIND_ICON}) for the kinds the menu has, and one each for the
 * Studio kinds only Recent holds.
 */
export const CONTENT_KIND_ICON: Readonly<Record<string, string>> = {
  ...NAV_KIND_ICON,
  package: 'package',
  metadata: 'file-code',
};

/**
 * The object a favourite is about, read off its id (`object:NAME`,
 * `view:OBJECT:VIEW`, `record:OBJECT:ID`, written by the pages that star them),
 * or `undefined` for a kind that has none.
 */
export function favoriteItemObject(item: Pick<FavoriteItem, 'id' | 'type'>): string | undefined {
  if (item.type !== 'object' && item.type !== 'view' && item.type !== 'record') return undefined;
  const [prefix, name] = item.id.split(':');
  return prefix === item.type && name ? name : undefined;
}

export interface ContentItemTileProps {
  /** The entry's kind (`dashboard`, `page`, `report`, …): its neutral tile's icon. */
  kind: string;
  /** The object the entry is about, when it is about one: the tile is then that object's. */
  objectName?: string;
  /** An icon the entry carries itself (a view favourite's), else the object's, else the kind's. */
  icon?: string;
  /**
   * The object's definition may be read by name (`readRecentObjects` answered
   * `read`). Otherwise (`unread`, `absent`) the row draws the object tile in
   * its neutral colour and the generic glyph, and asks nothing about the
   * object by name (objectstack#34692). Default `true`.
   */
  objectRead?: boolean;
  targetIcon: NavTargetIconResolver;
  targetColor: NavTargetColorResolver;
  size?: ObjectIconTileSize;
  className?: string;
}

export function ContentItemTile({ kind, objectName, icon, objectRead = true, targetIcon, targetColor, size = 'sm', className }: ContentItemTileProps) {
  if (objectName && !objectRead) {
    return <ObjectIconTile icon={icon} glyph={getIcon(icon)} size={size} className={className} />;
  }
  if (objectName) {
    const target = { kind: 'object', objectName } as const;
    const name = icon ?? targetIcon(target);
    return <ObjectIconTile icon={name} glyph={getIcon(name)} color={targetColor(target)} size={size} className={className} />;
  }
  const name = icon ?? CONTENT_KIND_ICON[kind] ?? 'file';
  return <NeutralIconTile icon={name} glyph={getIcon(name)} size={size} className={className} />;
}
