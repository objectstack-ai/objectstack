/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27594 — `ObjectViewTitleSwitcher`, the dropdown the list title
 * opens: its sections (📌 pinned, recent, all), the authored views before the
 * views saved at runtime, the ☆ and 📌 of a row, and its foot (New view, and
 * Manage views for an admin). `ObjectView.titleViewSwitcher-27594.test.tsx`
 * drives it on the real page.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent, within } from '@testing-library/react';
import { ObjectViewTitleSwitcher, type ObjectViewTitleSwitcherProps, type TitleSwitcherView } from './objectViewTitleSwitcher';
import type { ListViewFavorites } from '../layout/listViewFavorites';

const t = ((key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key) as never;

/** Saved views interleaved with authored ones, as the list's own order can hold them. */
const VIEWS: TitleSwitcherView[] = [
  { id: 'saved_a', label: 'Saved A', type: 'grid', authored: false },
  { id: 'all', label: 'All Leads', type: 'grid', authored: true },
  { id: 'board', label: 'Board', type: 'kanban', authored: true },
  { id: 'saved_b', label: 'Saved B', type: 'calendar', authored: false },
  { id: 'mine', label: 'My Leads', type: 'grid', authored: true },
];

function mount(props: Partial<ObjectViewTitleSwitcherProps> = {}) {
  const handlers = {
    onViewChange: vi.fn(),
    onPinnedViewChange: vi.fn(),
  };
  render(
    <ObjectViewTitleSwitcher
      views={VIEWS}
      activeViewId="all"
      activeLabel="All Leads"
      pinnedViewId={null}
      recentViewIds={[]}
      favorites={null}
      t={t}
      {...handlers}
      {...props}
    />,
  );
  fireEvent.click(screen.getByTestId('list-view-switcher'));
  return { menu: screen.getByTestId('list-view-switcher-menu'), ...handlers };
}

const sectionIds = (testId: string) =>
  Array.from(screen.getByTestId(testId).querySelectorAll('[data-testid^="view-switcher-row-"]')).map((el) =>
    el.getAttribute('data-testid')!.replace('view-switcher-row-', ''));

afterEach(cleanup);

describe('objectstack#27594 — the title switcher dropdown', () => {
  it('the title is the open view\'s label with ▾, and the count beside it once the list reported one', () => {
    render(
      <ObjectViewTitleSwitcher
        views={VIEWS}
        activeViewId="all"
        activeLabel="All Leads"
        count={1234}
        pinnedViewId={null}
        onPinnedViewChange={() => {}}
        recentViewIds={[]}
        favorites={null}
        onViewChange={() => {}}
        t={t}
      />,
    );
    expect(screen.getByTestId('list-view-switcher')).toHaveTextContent('All Leads');
    // Formatted in the display locale (en here), never the machine's.
    expect(screen.getByTestId('list-view-switcher-count')).toHaveTextContent('· 1,234');
  });

  it('CONTROL: no count is drawn until the list reports one', () => {
    mount();
    expect(screen.queryByTestId('list-view-switcher-count')).toBeNull();
  });

  it('All lists the authored views first, then the saved ones, each in the list\'s order', () => {
    mount();
    expect(sectionIds('list-view-switcher-all')).toEqual(['all', 'board', 'mine', 'saved_a', 'saved_b']);
  });

  it('a search box is always there; with no pin and no recent view, All is the only section', () => {
    const { menu } = mount();
    expect(within(menu).getByTestId('list-view-switcher-search')).toBeInTheDocument();
    expect(within(menu).queryByTestId('list-view-switcher-pinned')).toBeNull();
    expect(within(menu).queryByTestId('list-view-switcher-recent')).toBeNull();
  });

  it('📌 Pinned, then Recent (at most three, without the pinned one), then All', () => {
    mount({ pinnedViewId: 'board', recentViewIds: ['mine', 'board', 'saved_b', 'saved_a', 'all', 'gone'] });
    const sections = Array.from(screen.getByTestId('list-view-switcher-menu').querySelectorAll('[data-testid^="list-view-switcher-"]'))
      .map((el) => el.getAttribute('data-testid'))
      .filter((id) => id === 'list-view-switcher-pinned' || id === 'list-view-switcher-recent' || id === 'list-view-switcher-all');
    expect(sections).toEqual(['list-view-switcher-pinned', 'list-view-switcher-recent', 'list-view-switcher-all']);
    expect(sectionIds('list-view-switcher-pinned')).toEqual(['board']);
    expect(sectionIds('list-view-switcher-recent')).toEqual(['mine', 'saved_b', 'saved_a']);
  });

  it('a pinned view the list no longer offers draws no Pinned section', () => {
    const { menu } = mount({ pinnedViewId: 'gone' });
    expect(within(menu).queryByTestId('list-view-switcher-pinned')).toBeNull();
  });

  it('searching narrows to the matching views in All\'s order, case-insensitively', () => {
    const { menu } = mount({ pinnedViewId: 'board', recentViewIds: ['mine'] });
    fireEvent.change(within(menu).getByTestId('list-view-switcher-search'), { target: { value: 'LEADS' } });
    const rows = within(menu).getAllByTestId(/^view-switcher-row-/).map((el) => el.getAttribute('data-testid'));
    expect(rows).toEqual(['view-switcher-row-all', 'view-switcher-row-mine']);
    expect(within(menu).queryByTestId('list-view-switcher-pinned')).toBeNull();
  });

  it('choosing a view switches to it and closes; choosing the open one only closes', () => {
    const { menu, onViewChange } = mount();
    fireEvent.click(within(within(menu).getByTestId('view-switcher-row-board')).getAllByRole('button')[0]);
    expect(onViewChange).toHaveBeenCalledWith('board');
    expect(screen.queryByTestId('list-view-switcher-menu')).toBeNull();

    fireEvent.click(screen.getByTestId('list-view-switcher'));
    fireEvent.click(within(screen.getByTestId('view-switcher-row-all')).getAllByRole('button')[0]);
    expect(onViewChange).toHaveBeenCalledTimes(1);
  });

  it('📌 pins a view, and on the pinned view unpins it', () => {
    const first = mount();
    fireEvent.click(within(within(first.menu).getByTestId('view-switcher-row-mine')).getByTestId('view-switcher-pin'));
    expect(first.onPinnedViewChange).toHaveBeenLastCalledWith('mine');
    cleanup();

    const second = mount({ pinnedViewId: 'mine' });
    const pin = within(within(screen.getByTestId('list-view-switcher-pinned')).getByTestId('view-switcher-row-mine'))
      .getByTestId('view-switcher-pin');
    expect(pin).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(pin);
    expect(second.onPinnedViewChange).toHaveBeenLastCalledWith(null);
  });

  it('☆ toggles a star; a view the menu already opens shows its ☆ disabled, with the reason', () => {
    const favorites: ListViewFavorites = {
      isFavorite: (id) => id === 'saved_a',
      inMenu: (id) => id === 'mine',
      toggle: vi.fn(),
    };
    const { menu } = mount({ favorites });
    const starOf = (id: string) => within(within(menu).getByTestId(`view-switcher-row-${id}`)).getByTestId('view-switcher-star');

    expect(starOf('saved_a')).toHaveAttribute('aria-pressed', 'true');
    expect(starOf('board')).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(starOf('board'));
    expect(favorites.toggle).toHaveBeenCalledWith('board', 'Board');

    expect(starOf('mine')).toHaveAttribute('aria-disabled', 'true');
    expect(starOf('mine')).toHaveAttribute('title', 'Already in the menu');
    fireEvent.click(starOf('mine'));
    expect(favorites.toggle).toHaveBeenCalledTimes(1);
  });

  it('CONTROL: off an app route (no favorites) no row draws a ☆', () => {
    const { menu } = mount();
    expect(within(menu).queryAllByTestId('view-switcher-star')).toHaveLength(0);
    expect(within(menu).getAllByTestId('view-switcher-pin')).toHaveLength(VIEWS.length);
  });

  it('the foot offers New view and Manage views when handed, and each closes the dropdown', () => {
    const onAddView = vi.fn();
    const onManageViews = vi.fn();
    mount({ onAddView, onManageViews });
    fireEvent.click(screen.getByTestId('list-view-switcher-new'));
    expect(onAddView).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('list-view-switcher-menu')).toBeNull();

    fireEvent.click(screen.getByTestId('list-view-switcher'));
    fireEvent.click(screen.getByTestId('list-view-switcher-manage'));
    expect(onManageViews).toHaveBeenCalledTimes(1);
  });

  it('CONTROL: with neither handed (a reader who is no admin), the dropdown has no foot', () => {
    const { menu } = mount();
    expect(within(menu).queryByTestId('list-view-switcher-new')).toBeNull();
    expect(within(menu).queryByTestId('list-view-switcher-manage')).toBeNull();
  });
});
