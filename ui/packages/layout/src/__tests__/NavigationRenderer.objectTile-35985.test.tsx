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
 * object's), on the colour `resolveTargetColor` answers for the object.
 * objectstack#36141 — every other entry is the neutral tile of the same shape.
 */

import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { NavigationItem } from '@object-ui/types';
import { SidebarProvider } from '@object-ui/components';
import { NavigationRenderer, NAV_KIND_ICON, resolveNavKindIcon, type NavTargetColorResolver } from '../NavigationRenderer';

const COLORS: Record<string, string> = { account: 'orange', invoice: 'teal' };
const colors: NavTargetColorResolver = (t) => COLORS[t.objectName];

function tileOf(label: string): Element | null {
  return screen.getByText(label).closest('[data-sidebar="menu-button"]')!.querySelector('[data-object-icon-tile]');
}

function neutralTileOf(label: string): Element | null {
  return screen.getByText(label).closest('[data-sidebar="menu-button"]')!.querySelector('[data-neutral-icon-tile]');
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

  it('a dashboard row is the neutral tile, not an object tile', () => {
    renderNav(items, { resolveTargetColor: colors });
    expect(tileOf('Overview')).toBeNull();
    expect(neutralTileOf('Overview')).not.toBeNull();
  });
});

describe('objectstack#36141 — every menu row is a tile of one shape', () => {
  const kinds: NavigationItem[] = [
    { id: 'nav_dash', type: 'dashboard', dashboardName: 'sales', label: 'Overview' },
    { id: 'nav_report', type: 'report', reportName: 'won', label: 'Won deals' },
    { id: 'nav_page', type: 'page', pageName: 'catalog', label: 'Catalog' },
    { id: 'nav_url', type: 'url', url: 'https://example.com', label: 'Website' },
    { id: 'nav_component', type: 'component', componentRef: 'approvals:inbox', label: 'Inbox' },
    { id: 'nav_doc', type: 'doc', book: 'manual', label: 'Manual' },
    { id: 'nav_action', type: 'action', label: 'Run sync', actionDef: { actionName: 'sync' } },
    { id: 'nav_my_deals', type: 'object', objectName: 'account', viewName: 'mine', label: 'My accounts' },
    { id: 'nav_sep', type: 'separator' },
    {
      id: 'grp_more', type: 'group', label: 'More',
      children: [{ id: 'nav_home', type: 'dashboard', dashboardName: 'home', label: 'Home', icon: 'home' }],
    },
  ] as NavigationItem[];
  const nonObject = ['Overview', 'Won deals', 'Catalog', 'Website', 'Inbox', 'Manual', 'Run sync', 'Home'];

  it('draws every non-object row, an action and a row inside a group included, on the neutral tile', () => {
    renderNav(kinds, { resolveTargetColor: colors, onAction: () => {} });
    for (const label of nonObject) {
      expect(neutralTileOf(label), label).not.toBeNull();
      expect(tileOf(label), label).toBeNull();
    }
  });

  it('a view of an object is that object’s tile, in its colour', () => {
    renderNav(kinds, { resolveTargetColor: colors });
    expect(tileOf('My accounts')?.getAttribute('data-object-icon-tile')).toBe('orange');
    expect(neutralTileOf('My accounts')).toBeNull();
  });

  it('a group heading and a separator draw no tile', () => {
    const { container } = renderNav(kinds, { resolveTargetColor: colors });
    const heading = screen.getByText('More').closest('[data-sidebar="group-label"]')!;
    expect(heading.querySelector('[data-neutral-icon-tile], [data-object-icon-tile]')).toBeNull();
    const separatorItem = container.querySelector('li[aria-hidden="true"]')!;
    expect(separatorItem.querySelector('[data-neutral-icon-tile], [data-object-icon-tile]')).toBeNull();
  });

  it('a row with no icon of its own draws its kind’s; an authored icon wins', () => {
    for (const item of kinds) {
      if (item.type === 'object' || item.type === 'group' || item.type === 'separator') {
        expect(resolveNavKindIcon(item), item.id).toBeUndefined();
        continue;
      }
      expect(resolveNavKindIcon(item), item.id).toBe(NAV_KIND_ICON[item.type]);
    }
    expect(resolveNavKindIcon({ id: 'h', type: 'dashboard', dashboardName: 'home', icon: 'home' })).toBe('home');
    expect(new Set(Object.values(NAV_KIND_ICON)).size).toBe(Object.keys(NAV_KIND_ICON).length);
  });
});
