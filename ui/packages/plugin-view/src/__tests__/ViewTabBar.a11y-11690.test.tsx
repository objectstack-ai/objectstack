/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The view tab bar passes axe, and keeps every control reachable
 * (objectui#11690).
 *
 * axe (wcag2a + wcag2aa) on a stock object list page measured three faults in
 * this component: the "+" add button had no accessible name (`button-name`;
 * an icon, and a tooltip that is not a name), every view was a `role="tab"`
 * with no `tablist` (`aria-required-parent`), and the active view's actions
 * button sat INSIDE its tab, a control inside a control (`nested-interactive`).
 *
 * The views are now buttons in a frame, the actions button the frame's second
 * child — see the comment over `buildTabContent` for why tab roles could not
 * host that button at all. So this file pins both halves: axe finds nothing,
 * AND what a keyboard reached before it still reaches — a view switches on
 * click, the actions menu is its own named button, the current view says so.
 *
 * `color-contrast` is off: it needs layout happy-dom does not compute, and it
 * is outside the card.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import axe from 'axe-core';
import { I18nProvider } from '@object-ui/i18n';
import { zh } from '@object-ui/i18n/locales';
import { ViewTabBar, type ViewTabBarProps, type ViewTabItem } from '../ViewTabBar';

afterEach(cleanup);

const VIEWS: ViewTabItem[] = [
  { id: 'all', label: 'All', type: 'grid', isDefault: true, hasActiveFilters: true },
  { id: 'system', label: 'System', type: 'grid', readonly: true },
  { id: 'board', label: 'Board', type: 'kanban', visibility: 'private' },
  { id: 'cal', label: 'Calendar', type: 'calendar' },
];

/** The console's prop set: an admin, every management callback wired. */
function bar(extra: Partial<ViewTabBarProps> = {}) {
  return (
    <ViewTabBar
      views={VIEWS}
      activeViewId="all"
      onViewChange={vi.fn()}
      config={{ reorderable: false, showAddButton: true, showPinnedSection: true, showVisibilityGroups: true }}
      onAddView={vi.fn()}
      onRenameView={vi.fn()}
      onDeleteView={vi.fn()}
      onPinView={vi.fn()}
      onSetDefaultView={vi.fn()}
      onConfigView={vi.fn()}
      onManageViews={vi.fn()}
      {...extra}
    />
  );
}

async function axeRun(container: HTMLElement) {
  return axe.run(container, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
    rules: { 'color-contrast': { enabled: false } },
  });
}

const violations = (res: axe.AxeResults) =>
  res.violations.map((v) => ({ rule: v.id, nodes: v.nodes.map((n) => n.html) }));

describe('ViewTabBar passes axe (objectui#11690)', () => {
  it.each([
    ['static tabs', { reorderable: false }],
    ['drag-reorderable tabs', { reorderable: true }],
  ] as const)('%s: no wcag2a/aa violation, and the name rules really ran', async (_shape, cfg) => {
    const { container } = render(
      bar({
        config: { ...cfg, showAddButton: true, showPinnedSection: true, showVisibilityGroups: true },
        onReorderViews: vi.fn(),
      }),
    );
    const res = await axeRun(container);
    expect(violations(res)).toEqual([]);
    // Control: a zero above is a reading only if the rules found nodes to judge.
    const passed = res.passes.map((p) => p.id);
    expect(passed).toEqual(expect.arrayContaining(['button-name', 'nested-interactive']));
  });

  it('while a view is being renamed, the rename box is named and stands outside any button', async () => {
    const { container } = render(bar());
    fireEvent.doubleClick(screen.getByTestId('view-tab-all'));
    const input = screen.getByTestId('view-tab-rename-input-all');
    expect(input.closest('button')).toBeNull();
    expect(violations(await axeRun(container))).toEqual([]);
  });
});

describe('ViewTabBar keeps every control reachable (objectui#11690)', () => {
  it('each view is a button; the current one carries aria-current, the others none', () => {
    render(bar());
    const views = VIEWS.map((v) => screen.getByTestId(`view-tab-${v.id}`));
    for (const el of views) expect(el.tagName).toBe('BUTTON');
    expect(views.map((el) => el.getAttribute('aria-current'))).toEqual(['true', null, null, null]);
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
  });

  it('clicking a view switches to it', () => {
    const onViewChange = vi.fn();
    render(bar({ onViewChange }));
    fireEvent.click(screen.getByTestId('view-tab-board'));
    expect(onViewChange).toHaveBeenCalledWith('board');
  });

  it('the actions button is a sibling of the view button, named for the view, and opens the menu', () => {
    render(bar());
    const view = screen.getByTestId('view-tab-all');
    const actions = screen.getByRole('button', { name: 'View actions for All' });
    expect(actions).toBe(screen.getByTestId('view-tab-actions-all'));
    expect(view.contains(actions)).toBe(false);
    expect(actions.parentElement).toBe(view.parentElement);
    fireEvent.pointerDown(actions, { button: 0, ctrlKey: false });
    fireEvent.click(actions);
    expect(within(screen.getByRole('menu')).getByTestId('view-tab-menu-config-all')).toBeInTheDocument();
  });

  it('the add button is named through `view.addView`, in the viewer\'s language', () => {
    render(
      <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }} persistLanguage={false}>
        {bar()}
      </I18nProvider>,
    );
    const add = screen.getByTestId('view-tab-add');
    expect(zh.view.addView).toBeTruthy();
    expect(add).toHaveAccessibleName(zh.view.addView);
  });
});
