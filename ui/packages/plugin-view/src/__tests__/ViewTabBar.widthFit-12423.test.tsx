/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12423 — the view strip shows as many tabs as its width holds.
 *
 * jsdom lays nothing out, so the widths are stubbed on
 * `getBoundingClientRect`: the strip (`view-tab-strip`) answers the width it
 * has, every tab frame (`data-view-tab-frame`) answers its own. With no stub
 * every width reads `0`, which is the "no layout" answer: every tab shows and
 * `maxVisibleTabs` alone can fold them.
 *
 * Also here: a table tab is its label alone while any other type carries the
 * icon the host maps it to, and a view's filter/sort flags draw nothing.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import React from 'react';
import { KanbanSquare, Calendar, LayoutGrid, Table } from 'lucide-react';
import { ViewTabBar, fitVisibleTabCount, type ViewTabItem, type ViewTabBarProps } from '../ViewTabBar';

const EIGHT: ViewTabItem[] = Array.from({ length: 8 }, (_, i) => ({
  id: `v${i + 1}`,
  label: `View ${i + 1}`,
  type: 'grid',
}));

const ICONS: ViewTabBarProps['viewTypeIcons'] = {
  grid: Table,
  kanban: KanbanSquare,
  calendar: Calendar,
  gallery: LayoutGrid,
};

/** A tab draws 98 px; with the strip's 2 px gap that is 100 px a tab. */
const TAB_PX = 98;

/** The ▾ actions button on the current tab adds this much to its frame. */
const CHEVRON_PX = 24;

/**
 * Lay the strip out at `stripPx`: 612 px holds six tabs (6 × 100) plus a
 * trigger of up to 88 px at 700, and never seven (714 + trigger). A frame
 * holding the current tab's actions button is `CHEVRON_PX` wider.
 */
function layOut(stripPx: number) {
  return vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const width =
      this.getAttribute('data-testid') === 'view-tab-strip'
        ? stripPx
        : this.hasAttribute('data-view-tab-frame')
          ? TAB_PX + (this.querySelector('[data-testid^="view-tab-actions-"]') ? CHEVRON_PX : 0)
          : 0;
    return { width, height: 0, top: 0, left: 0, right: width, bottom: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
  });
}

function bar(props: Partial<ViewTabBarProps> = {}) {
  return (
    <ViewTabBar
      views={EIGHT}
      activeViewId="v1"
      onViewChange={vi.fn()}
      viewTypeIcons={ICONS}
      {...props}
    />
  );
}

/** The tabs on the strip, by view id, in order. */
const shownTabs = () =>
  Array.from(document.querySelectorAll('[data-view-tab-frame]')).map((el) => el.getAttribute('data-view-tab-frame'));

function openOverflow() {
  const trigger = screen.getByTestId('view-tab-overflow');
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
  fireEvent.click(trigger);
  return screen.getByRole('menu');
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ViewTabBar fits its tabs to the strip width (objectui#12423)', () => {
  it('a width that fits six of eight views shows six, and "2 more" lists the other two', () => {
    layOut(700);
    render(bar());
    expect(shownTabs()).toEqual(['v1', 'v2', 'v3', 'v4', 'v5', 'v6']);
    const trigger = screen.getByTestId('view-tab-overflow');
    expect(trigger).toHaveTextContent('2 more');
    const menu = openOverflow();
    expect(within(menu).getByTestId('view-tab-overflow-v7')).toBeInTheDocument();
    expect(within(menu).getByTestId('view-tab-overflow-v8')).toBeInTheDocument();
  });

  it('choosing a folded view reports it, and once it is current it is swapped onto the strip', () => {
    layOut(700);
    const onViewChange = vi.fn();
    const { rerender } = render(bar({ onViewChange }));
    fireEvent.click(within(openOverflow()).getByTestId('view-tab-overflow-v8'));
    expect(onViewChange).toHaveBeenCalledWith('v8');

    rerender(bar({ onViewChange, activeViewId: 'v8' }));
    expect(shownTabs()).toEqual(['v1', 'v2', 'v3', 'v4', 'v5', 'v8']);
    expect(screen.getByTestId('view-tab-v8')).toHaveAttribute('aria-current', 'true');
    expect(screen.getByTestId('view-tab-overflow')).toHaveTextContent('2 more');
  });

  it('maxVisibleTabs caps the count on top of the width: 3 at a width that holds six', () => {
    layOut(700);
    render(bar({ config: { maxVisibleTabs: 3 } }));
    expect(shownTabs()).toEqual(['v1', 'v2', 'v3']);
    expect(screen.getByTestId('view-tab-overflow')).toHaveTextContent('5 more');
  });

  it('the current tab\'s ▾ menu button counts toward the width: six plain tabs fit, five once it is drawn', () => {
    layOut(700);
    render(bar({ onRenameView: vi.fn() }));
    // 124 + 4 × 100 = 524, + 80 for the trigger = 604 ≤ 700; a sixth tab makes 704.
    expect(screen.getByTestId('view-tab-actions-v1')).toBeInTheDocument();
    expect(shownTabs()).toEqual(['v1', 'v2', 'v3', 'v4', 'v5']);
    expect(screen.getByTestId('view-tab-overflow')).toHaveTextContent('3 more');
  });

  it('a width that holds every view draws no "more" trigger', () => {
    layOut(1200);
    render(bar());
    expect(shownTabs()).toHaveLength(8);
    expect(screen.queryByTestId('view-tab-overflow')).toBeNull();
  });

  it('with no layout to measure (every width 0) every tab shows, so the width never hides a view by itself', () => {
    render(bar());
    expect(shownTabs()).toHaveLength(8);
    expect(screen.queryByTestId('view-tab-overflow')).toBeNull();
  });
});

describe('fitVisibleTabCount (objectui#12423)', () => {
  it('everything that fits shows, with no room kept for a trigger', () => {
    expect(fitVisibleTabCount([100, 100, 100], 300, 80, 0)).toBe(3);
  });

  it('otherwise the largest head that fits beside the trigger', () => {
    expect(fitVisibleTabCount([100, 100, 100, 100], 300, 80, 0)).toBe(2);
  });

  it('counts the current view in place of the head\'s last tab when it sits in the tail', () => {
    // Head of two is 200 + 80 = 280 ≤ 300, but the wide current view swaps in:
    // 100 + 150 + 80 = 330 > 300, so only one tab fits beside the trigger.
    expect(fitVisibleTabCount([100, 100, 100, 150], 300, 80, 3)).toBe(1);
  });

  it('never fewer than one', () => {
    expect(fitVisibleTabCount([400, 400], 100, 80, 0)).toBe(1);
  });
});

describe('ViewTabBar tab faces (objectui#12423)', () => {
  const MIXED: ViewTabItem[] = [
    { id: 'all', label: 'All', type: 'grid', hasActiveFilters: true, hasActiveSort: true },
    { id: 'board', label: 'Board', type: 'kanban' },
    { id: 'cal', label: 'Calendar', type: 'calendar' },
    { id: 'pics', label: 'Pictures', type: 'gallery' },
    { id: 'odd', label: 'Unmapped', type: 'timeline' },
  ];

  it('a board, calendar or gallery tab draws its type icon; a grid tab draws none', () => {
    render(bar({ views: MIXED, activeViewId: 'board' }));
    expect(screen.getByTestId('view-tab-type-icon-board')).toBeInTheDocument();
    expect(screen.getByTestId('view-tab-type-icon-cal')).toBeInTheDocument();
    expect(screen.getByTestId('view-tab-type-icon-pics')).toBeInTheDocument();
    expect(screen.queryByTestId('view-tab-type-icon-all')).toBeNull();
    // A type the host maps no icon to draws none, rather than a table glyph.
    expect(screen.queryByTestId('view-tab-type-icon-odd')).toBeNull();
  });

  it('the default view draws no star on its tab; its "Set as default" entry carries the state', () => {
    const views: ViewTabItem[] = [
      { id: 'all', label: 'All', type: 'grid', isDefault: true },
      { id: 'mine', label: 'Mine', type: 'grid' },
    ];
    const { rerender } = render(bar({ views, activeViewId: 'all', onSetDefaultView: vi.fn() }));
    expect(screen.getByTestId('view-tab-all').querySelectorAll('svg')).toHaveLength(0);

    const openMenu = (id: string) => {
      const trigger = screen.getByTestId(`view-tab-actions-${id}`);
      fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
      fireEvent.click(trigger);
      return screen.getByRole('menu');
    };
    const onDefault = within(openMenu('all')).getByTestId('view-tab-menu-default-all');
    expect(onDefault).toHaveAttribute('aria-current', 'true');
    expect(within(onDefault).getByTestId('view-tab-default-check-all')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });

    // Control: a view that is not the default says nothing of the kind.
    rerender(bar({ views, activeViewId: 'mine', onSetDefaultView: vi.fn() }));
    const offDefault = within(openMenu('mine')).getByTestId('view-tab-menu-default-mine');
    expect(offDefault).not.toHaveAttribute('aria-current');
    expect(within(offDefault).queryByTestId('view-tab-default-check-mine')).toBeNull();
  });

  it('a view passed with hasActiveFilters / hasActiveSort draws no filter or sort glyph on its tab', () => {
    render(bar({ views: MIXED, activeViewId: 'board' }));
    const tab = screen.getByTestId('view-tab-all');
    expect(tab).toHaveTextContent('All');
    expect(tab.querySelectorAll('svg')).toHaveLength(0);
    expect(screen.queryByTestId('view-tab-indicator-all')).toBeNull();
  });
});
