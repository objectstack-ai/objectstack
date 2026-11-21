/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#35985 — an `object` navigation entry is drawn as its object's
 * tile: the glyph `resolveNavItemIcon` answers (the entry's own icon, else the
 * object's), on the colour `resolveTargetColor` answers for the object. Other
 * entries keep the line icon: only objects carry a colour.
 */

import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { NavigationItem } from '@object-ui/types';
import { SidebarProvider } from '@object-ui/components';
import { NavigationRenderer, type NavTargetColorResolver } from '../NavigationRenderer';

const COLORS: Record<string, string> = { account: 'orange', invoice: 'teal' };
const colors: NavTargetColorResolver = (t) => COLORS[t.objectName];

function tileOf(label: string): Element | null {
  return screen.getByText(label).closest('[data-sidebar="menu-button"]')!.querySelector('[data-object-icon-tile]');
}

function renderNav(items: NavigationItem[], props: Record<string, unknown> = {}) {
  return render(
    <MemoryRouter initialEntries={['/apps/crm']}>
      <SidebarProvider defaultOpen>
        <NavigationRenderer items={items} basePath="/apps/crm" {...props} />
      </SidebarProvider>
    </MemoryRouter>,
  );
}

describe('objectstack#35985 — object navigation entries are tiles', () => {
  const items: NavigationItem[] = [
    { id: 'nav_accounts', type: 'object', objectName: 'account', label: 'Accounts' },
    { id: 'nav_key', type: 'object', objectName: 'account', label: 'Key accounts', icon: 'star' },
    {
      id: 'grp_money', type: 'group', label: 'Money',
      children: [{ id: 'nav_invoices', type: 'object', objectName: 'invoice', label: 'Invoices' }],
    },
    { id: 'nav_notes', type: 'object', objectName: 'note', label: 'Notes' },
    { id: 'nav_dash', type: 'dashboard', dashboardName: 'sales', label: 'Overview' },
  ];

  it('draws each object row in its object’s colour, inside a group too; an authored icon keeps the object’s colour', () => {
    renderNav(items, { resolveTargetColor: colors });
    expect(tileOf('Accounts')?.getAttribute('data-object-icon-tile')).toBe('orange');
    expect(tileOf('Key accounts')?.getAttribute('data-object-icon-tile')).toBe('orange');
    expect(tileOf('Invoices')?.getAttribute('data-object-icon-tile')).toBe('teal');
  });

  it('an object with no colour, and every object row with no resolver, is the neutral gray tile', () => {
    const { unmount } = renderNav(items, { resolveTargetColor: colors });
    expect(tileOf('Notes')?.getAttribute('data-object-icon-tile')).toBe('gray');
    unmount();
    renderNav(items);
    expect(tileOf('Accounts')?.getAttribute('data-object-icon-tile')).toBe('gray');
  });

  it('control: a dashboard row keeps its line icon, no tile', () => {
    renderNav(items, { resolveTargetColor: colors });
    expect(tileOf('Overview')).toBeNull();
    expect(screen.getByText('Overview').closest('[data-sidebar="menu-button"]')!.querySelector('svg')).not.toBeNull();
  });
});
