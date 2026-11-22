/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The ⌘K palette's footer (objectstack#36286): what Enter does to the entry
 * the keyboard is on — open the record, create one, switch app, apply a
 * theme, add the current page to the favorites or take it off, or open the
 * page the entry names.
 *
 * The entry is named by its cmdk `value`, and every palette entry's value
 * starts with the word for its kind (`record …`, `create …`, `app …`); the
 * hint is read off that word, so an entry kind added without a word here
 * reads "Open", the answer for every navigation entry.
 */

import { Kbd } from '@object-ui/components';
import { useObjectTranslation } from '@object-ui/i18n';

/** What Enter does, by the leading word of the selected entry's value. */
export type PaletteEnterAction =
  | 'openRecord'
  | 'create'
  | 'switchApp'
  | 'applyTheme'
  | 'addFavorite'
  | 'removeFavorite'
  | 'open';

/** The leading word of a current-page favorites row's value (`PaletteCurrentPage`). */
export const FAVORITE_ADD_KIND = 'favorite-add';
export const FAVORITE_REMOVE_KIND = 'favorite-remove';

const ACTION_BY_KIND: Record<string, PaletteEnterAction> = {
  record: 'openRecord',
  recent: 'openRecord',
  create: 'create',
  app: 'switchApp',
  theme: 'applyTheme',
  [FAVORITE_ADD_KIND]: 'addFavorite',
  [FAVORITE_REMOVE_KIND]: 'removeFavorite',
};

/** The action Enter runs on the entry whose cmdk value is `value`; `null` when nothing is selected. */
export function paletteEnterAction(value: string | null | undefined): PaletteEnterAction | null {
  const kind = (value ?? '').trim().split(/\s+/, 1)[0]?.toLowerCase() ?? '';
  if (kind === '') return null;
  return ACTION_BY_KIND[kind] ?? 'open';
}

export function PaletteEnterHint({ value }: { value: string | null | undefined }) {
  const { t } = useObjectTranslation();
  const action = paletteEnterAction(value);
  // One literal key per action, so every key this asks for is greppable.
  const label = (): string => {
    switch (action) {
      case 'openRecord':
        return t('console.commandPalette.enterOpenRecord', { defaultValue: 'Open record' });
      case 'create':
        return t('console.commandPalette.enterCreate', { defaultValue: 'Create' });
      case 'switchApp':
        return t('console.commandPalette.enterSwitchApp', { defaultValue: 'Switch app' });
      case 'applyTheme':
        return t('console.commandPalette.enterApplyTheme', { defaultValue: 'Apply theme' });
      // The favorites entry's own words, as the page's menu shows them.
      case 'addFavorite':
        return t('common.addToFavorites', { defaultValue: 'Add to favorites' });
      case 'removeFavorite':
        return t('common.removeFromFavorites', { defaultValue: 'Remove from favorites' });
      default:
        return t('console.commandPalette.enterOpen', { defaultValue: 'Open' });
    }
  };
  return (
    <div
      data-testid="palette-enter-hint"
      data-enter-action={action ?? undefined}
      className="col-span-2 flex min-h-9 items-center justify-end gap-2 border-t px-3 py-1.5 text-xs text-muted-foreground"
    >
      {action && (
        <>
          <span>{label()}</span>
          <Kbd aria-hidden="true">↵</Kbd>
        </>
      )}
    </div>
  );
}
