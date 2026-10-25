/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11196 — the Navigation Designer and the app wizard's Navigation
 * step name a label-less nav entry by the runtime's rule, not a blank.
 *
 * Since objectui#9868 the platform writes nav entries with NO `label`: absent
 * ⇒ the entry shows the CURRENT label of what it opens. Both surfaces read
 * `resolveKeyedI18nLabel(item.label)`, which answers `undefined` for an absent
 * label, so such an entry drew an empty row. They now call the runtime's own
 * `resolveNavItemLabel` (`@object-ui/layout`). They are handed bare items and
 * no metadata, so a target is named by the rule's machine-name rung — what the
 * console's renderer shows for a host that supplies no target resolver:
 *
 *  - a label-less page shows its `pageName`, a dashboard its `dashboardName`,
 *    a group its `id`;
 *  - the wizard holds its objects' labels, and hands them to the rule as the
 *    host's target resolver: a label-less object entry shows its object's
 *    label, and one whose object the wizard does not list shows its
 *    `objectName`;
 *  - CONTROL: an authored label renders verbatim;
 *  - the row's inline rename shows the inherited text as a placeholder, and
 *    leaving it empty writes nothing.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import type { NavigationItem } from '@object-ui/types';
import { NavigationDesigner } from '../NavigationDesigner';
import { AppCreationWizard } from '../AppCreationWizard';

afterEach(cleanup);

const ITEMS: NavigationItem[] = [
  { id: 'nav_home', type: 'page', pageName: 'home_page' },
  { id: 'nav_sales', type: 'dashboard', dashboardName: 'sales_overview' },
  { id: 'nav_admin', type: 'group', children: [] },
  // Control: an authored label.
  { id: 'nav_accounts', type: 'object', objectName: 'account', label: 'Customers' },
];

const INHERITED: Array<[string, string]> = [
  ['nav_home', 'home_page'],
  ['nav_sales', 'sales_overview'],
  ['nav_admin', 'nav_admin'],
  ['nav_accounts', 'Customers'],
];

describe('objectui#11196 — NavigationDesigner names a label-less entry by the runtime rule', () => {
  it('each row shows the entry\'s inherited text, and an authored label verbatim', () => {
    render(<NavigationDesigner items={ITEMS} onChange={() => {}} />);
    for (const [id, text] of INHERITED) {
      expect(within(screen.getByTestId(`nav-designer-item-${id}`)).getByText(text)).toBeTruthy();
    }
  });

  it('the live preview shows the same text', () => {
    render(<NavigationDesigner items={ITEMS} onChange={() => {}} />);
    const preview = screen.getByTestId('nav-designer-preview');
    for (const [, text] of INHERITED) {
      expect(within(preview).getByText(text)).toBeTruthy();
    }
  });

  it('the inline rename shows the inherited text as a placeholder, and an empty commit writes nothing', () => {
    const onChange = vi.fn();
    render(<NavigationDesigner items={ITEMS} onChange={onChange} />);
    fireEvent.doubleClick(within(screen.getByTestId('nav-designer-item-nav_home')).getByText('home_page'));
    const input = screen.getByTestId('nav-designer-label-input-nav_home') as HTMLInputElement;
    expect(input.value).toBe('');
    expect(input.placeholder).toBe('home_page');
    fireEvent.blur(input);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("objectui#11196 — the app wizard's Navigation step names a label-less entry by the runtime rule", () => {
  it('lists each entry by its inherited text, and an authored label verbatim', () => {
    render(
      <AppCreationWizard
        // Selected: leaving the Objects step drops the entry of an object listed but deselected.
        availableObjects={[{ name: 'contact', label: 'Contact', pluralLabel: 'Contacts', selected: true }]}
        initialDraft={{
          name: 'acme_crm',
          title: 'Acme CRM',
          navigation: [
            ...ITEMS,
            { id: 'nav_contacts', type: 'object', objectName: 'contact' },
            { id: 'nav_leads', type: 'object', objectName: 'lead' },
          ],
        }}
        onComplete={() => {}}
      />,
    );
    // The step indicator only goes back or one step on: Basic → Objects → Navigation.
    fireEvent.click(screen.getByTestId('wizard-next'));
    fireEvent.click(screen.getByTestId('wizard-next'));
    const step = screen.getByTestId('wizard-step-navigation-content');
    for (const [id, text] of INHERITED) {
      expect(within(step).getByTestId(`nav-item-${id}`).textContent).toContain(text);
    }
    // The object's label, from the wizard's own list, as the console's sidebar shows it.
    // Exact text: the object's `label`, never the `pluralLabel` the old generated entries stored.
    expect(within(within(step).getByTestId('nav-item-nav_contacts')).getByText('Contact')).toBeTruthy();
    // An object the wizard does not list: the rule's machine-name rung.
    expect(within(within(step).getByTestId('nav-item-nav_leads')).getByText('lead')).toBeTruthy();
  });
});
