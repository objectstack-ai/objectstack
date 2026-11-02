/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#29074 — the list title's view switcher at phone width.
 *
 * Below `sm` its trigger, the menu's search, every view row with its ☆ and 📌,
 * and New view / Manage views are 44 px touch targets. From `sm` up the
 * compact sizes stay. On a touch screen (no hover) a row's ☆ and 📌 always
 * show; with a mouse they still appear on hover only.
 *
 * happy-dom applies no Tailwind, so these read the class tokens; the live
 * measurement at 375 and 390 px is in the pull request's run record.
 */
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent, within } from '@testing-library/react';
import { ObjectViewTitleSwitcher, type TitleSwitcherView } from './objectViewTitleSwitcher';

const t = ((key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key) as never;

const VIEWS: TitleSwitcherView[] = [
  { id: 'all', label: 'All Records', type: 'grid', authored: true },
  { id: 'mine', label: 'My Records', type: 'grid', authored: true },
];

afterEach(cleanup);

const tokens = (el: Element) => (el.getAttribute('class') ?? '').split(/\s+/);

function mount() {
  render(
    <ObjectViewTitleSwitcher
      views={VIEWS}
      activeViewId="all"
      activeLabel="All Records"
      pinnedViewId={null}
      recentViewIds={[]}
      favorites={{ isFavorite: () => false, inMenu: () => false, toggle: vi.fn() }}
      t={t}
      onViewChange={vi.fn()}
      onPinnedViewChange={vi.fn()}
      onAddView={vi.fn()}
      onManageViews={vi.fn()}
    />,
  );
  const trigger = screen.getByTestId('list-view-switcher');
  fireEvent.click(trigger);
  return { trigger, menu: screen.getByTestId('list-view-switcher-menu') };
}

describe('view switcher touch targets below sm (objectstack#29074)', () => {
  it('the trigger is at least 44 px below sm', () => {
    const { trigger } = mount();
    expect(tokens(trigger)).toEqual(expect.arrayContaining(['max-sm:min-h-11', 'max-sm:min-w-11']));
  });

  it('search, rows, star, pin, New view and Manage views are 44 px below sm', () => {
    const { menu } = mount();
    expect(tokens(within(menu).getByTestId('list-view-switcher-search'))).toEqual(expect.arrayContaining(['h-8', 'max-sm:h-11']));
    const row = within(menu).getAllByTestId(/^view-switcher-row-/)[0];
    expect(tokens(within(row).getAllByRole('button')[0])).toEqual(expect.arrayContaining(['py-1.5', 'max-sm:min-h-11']));
    for (const id of ['view-switcher-star', 'view-switcher-pin']) {
      const button = within(row).getByTestId(id);
      expect(tokens(button), id).toEqual(expect.arrayContaining(['h-7', 'w-7', 'max-sm:h-11', 'max-sm:w-11']));
    }
    for (const id of ['list-view-switcher-new', 'list-view-switcher-manage']) {
      expect(tokens(within(menu).getByTestId(id)), id).toEqual(expect.arrayContaining(['max-sm:min-h-11']));
    }
  });

  it('an unset star and pin show on a touch screen and stay hover-only with a mouse', () => {
    const { menu } = mount();
    const row = within(menu).getAllByTestId(/^view-switcher-row-/)[0];
    for (const id of ['view-switcher-star', 'view-switcher-pin']) {
      expect(tokens(within(row).getByTestId(id)), id).toEqual(
        expect.arrayContaining(['opacity-0', 'group-hover:opacity-100', 'pointer-coarse:opacity-100']),
      );
    }
  });
});
