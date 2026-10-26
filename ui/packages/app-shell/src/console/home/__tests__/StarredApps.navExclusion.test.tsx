// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * StarredApps nav exclusion (objectui#6335).
 *
 * `FavoriteItem['type']` is a six-member union — `object | dashboard | page |
 * report | record | nav` — but `home.recentApps.itemType.*` (the namespace
 * `StarredApps` resolves its type label through) declares only five keys
 * (no `nav`). `FavoritesProvider.tsx` documents `nav` favorites as "Excluded
 * from Home/Starred and from the generic sidebar Favorites list so it
 * doesn't render twice" — but until this fix `StarredApps` filtered nothing
 * by type, so a `nav` favorite handed to it rendered anyway, hit the missing
 * key, and fell through to the raw-string fallback.
 *
 * The pin below hands a `nav` item in directly (not just documents the
 * exclusion) and asserts it does not render — a filter with no test
 * exercising the excluded kind is indistinguishable from no filter.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';

import type { FavoriteItem } from '../../../hooks/useFavorites.js';

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key),
    language: 'en',
  }),
}));

import { StarredApps } from '../StarredApps.js';

const NAV_ITEM: FavoriteItem = {
  id: 'nav:pinned-report',
  label: 'Pinned nav entry',
  href: '/x/nav',
  type: 'nav',
  favoritedAt: new Date().toISOString(),
  navId: 'pinned-report',
};

const OBJECT_ITEM: FavoriteItem = {
  id: 'object:contact',
  label: 'Contact',
  href: '/x/object',
  type: 'object',
  favoritedAt: new Date().toISOString(),
};

describe('StarredApps nav exclusion', () => {
  it('THE PIN: a nav favorite handed in does not render, while sibling kinds still do', () => {
    render(<StarredApps items={[NAV_ITEM, OBJECT_ITEM]} />);

    expect(screen.queryByTestId(`starred-item-${NAV_ITEM.id}`)).toBeNull();
    expect(screen.queryByText(NAV_ITEM.label)).toBeNull();

    expect(screen.getByTestId(`starred-item-${OBJECT_ITEM.id}`)).toBeTruthy();
    expect(screen.getByText(OBJECT_ITEM.label)).toBeTruthy();
  });

  it('an all-nav favorites list renders nothing, matching the documented exclusion', () => {
    const { container } = render(<StarredApps items={[NAV_ITEM]} />);

    // `items.length` is nonzero, so a naive `items.length === 0` empty-guard
    // would not catch this — it is the post-filter length that must gate the
    // section, or an all-nav list would render an empty "Starred" heading
    // with no cards under it.
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText('Starred')).toBeNull();
  });

  it('control: a non-nav kind with no dedicated icon (report) still renders', () => {
    const reportItem: FavoriteItem = {
      id: 'report:quarterly',
      label: 'Quarterly report',
      href: '/x/report',
      type: 'report',
      favoritedAt: new Date().toISOString(),
    };

    render(<StarredApps items={[reportItem]} />);

    expect(screen.getByTestId(`starred-item-${reportItem.id}`)).toBeTruthy();
  });
});
