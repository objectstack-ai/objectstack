/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4163 part 1 — `ViewTab.label` is the spec's `I18nLabel`, widened by
 * `@objectstack/spec` 17.0.0-rc.6 from `string` to
 * `string | Record<string, string>`.
 *
 * Three read sites were exposed by the bump, and they are three DIFFERENT
 * surfaces rather than one repeated: the inline pill row (`TabBar`), the mobile
 * dropdown's trigger (`TabBarSelect`, showing only the ACTIVE tab), and that
 * dropdown's menu items. Each is pinned separately, because a fix applied to
 * one leaves the others rendering `[object Object]` with every type and every
 * other assertion still green.
 */

import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { TabBar, TabBarSelect, type ViewTab } from '../TabBar';

const tabs: ViewTab[] = [
  { name: 'open', label: { en: 'All Active', 'zh-CN': '全部活跃' }, isDefault: true },
  { name: 'mine', label: 'My Records' },
];

describe('TabBar — inline per-locale tab labels (#4163)', () => {
  it('renders the resolved locale string for a map-valued label', () => {
    render(<TabBar tabs={tabs} />);
    expect(screen.getByText('All Active')).toBeTruthy();
  });

  it('never renders the stringified object', () => {
    const { container } = render(<TabBar tabs={tabs} />);
    expect(container.innerHTML).not.toContain('[object Object]');
  });

  it('leaves a plain-string label exactly as authored', () => {
    // Non-vacuity: a resolver that returned '' for everything would pass the
    // `[object Object]` assertion above and fail this one.
    render(<TabBar tabs={tabs} />);
    expect(screen.getByText('My Records')).toBeTruthy();
  });

  it('still renders an empty pill for a label-less tab, as before', () => {
    // The spec makes `label` optional and `name` the identifier. This card
    // deliberately did NOT add a `|| tab.name` fallback, so the observable
    // behaviour for a label-less tab is unchanged — pinned so a later "tidy-up"
    // is a deliberate decision rather than a drive-by.
    render(<TabBar tabs={[{ name: 'untitled' }]} />);
    const pill = screen.getByTestId('view-tab-untitled');
    expect(pill.textContent).toBe('');
  });
});

describe('TabBarSelect — inline per-locale tab labels (#4163)', () => {
  it('resolves the ACTIVE tab label in the dropdown trigger', () => {
    render(<TabBarSelect tabs={tabs} activeTab="open" />);
    expect(screen.getByText('All Active')).toBeTruthy();
  });

  it('never renders the stringified object in the trigger', () => {
    const { container } = render(<TabBarSelect tabs={tabs} activeTab="open" />);
    expect(container.innerHTML).not.toContain('[object Object]');
  });

  it('resolves the label of every tab in the open menu', async () => {
    // The third site, and the one most easily left vacuous: the menu is a Radix
    // portal that does not exist until the trigger is opened, so the menu-item
    // node is asserted FIRST — an assertion about `[object Object]` over a menu
    // that never rendered passes on nothing.
    render(<TabBarSelect tabs={tabs} activeTab="mine" />);
    const trigger = screen.getByLabelText('Switch view');
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });

    const item = await screen.findByTestId('view-tab-select-open');
    // The trigger shows the ACTIVE tab ('My Records'), so this text can only
    // have come from the menu item — the site under test.
    expect(item.textContent).toBe('All Active');
    expect(document.body.innerHTML).not.toContain('[object Object]');
  });
});
