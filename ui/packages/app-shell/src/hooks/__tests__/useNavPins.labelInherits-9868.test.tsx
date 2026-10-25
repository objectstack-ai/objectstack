/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Pinning a navigation entry with NO `label` stores text, not `undefined`
 * (objectui#9868).
 *
 * `togglePin` writes a portable `type: 'nav'` favorite record. It used to copy
 * `item.label` verbatim, which is `undefined` for an entry that inherits its
 * target's label at render time — a record whose `label: string` member then
 * held nothing. It now stores `resolveNavItemLabel(item)`: the machine-name
 * text the renderer falls back to (the sidebar renders the live nav tree's
 * label for a nav pin, so this stored text is a placeholder, like the one
 * `migrateLegacyNavPins` writes). CONTROL: an authored label is stored verbatim.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const favorites = vi.hoisted(() => ({
  addFavorite: vi.fn(),
  removeFavorite: vi.fn(),
  setPinned: vi.fn(),
}));

vi.mock('../../context/FavoritesProvider', () => ({
  useFavorites: () => ({ favorites: [], pinnedNavIds: new Set<string>(), ...favorites }),
}));

import { useNavPins } from '../useNavPins';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('objectui#9868 — pinning a label-less nav entry', () => {
  it('stores the machine-name text the renderer falls back to, never undefined', () => {
    const { result } = renderHook(() => useNavPins());
    result.current.togglePin('nav_page', true, { id: 'nav_page', type: 'page', pageName: 'my_page' }, '/apps/crm');

    expect(favorites.addFavorite).toHaveBeenCalledTimes(1);
    const record = favorites.addFavorite.mock.calls[0][0];
    expect(record).toMatchObject({ id: 'nav:nav_page', type: 'nav', navId: 'nav_page', label: 'my_page' });
    expect(typeof record.label).toBe('string');
  });

  it('control: an authored label is stored verbatim', () => {
    const { result } = renderHook(() => useNavPins());
    result.current.togglePin(
      'nav_home',
      true,
      { id: 'nav_home', type: 'page', pageName: 'home', label: 'Team Home' },
      '/apps/crm',
    );
    expect(favorites.addFavorite.mock.calls[0][0]).toMatchObject({ label: 'Team Home' });
  });
});
