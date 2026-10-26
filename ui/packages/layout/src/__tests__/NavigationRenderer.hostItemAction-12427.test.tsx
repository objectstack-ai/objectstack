/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12427: two additive props let a host put its own control on every
 * entry and its own rows in the Favorites section.
 *
 * - `renderItemAction` is drawn on every leaf and `action` row where the pin
 *   action sits, in its place, with the row's address and label. Groups and
 *   separators get none. It is drawn whatever `enablePinning` says.
 * - `extraFavorites` are rows appended to the Favorites section after the
 *   pinned entries. The section renders when either kind is there.
 *
 * A host that passes neither gets today's renderer: the pin action under
 * `enablePinning` + `onPinToggle`, and a section of pinned entries only.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { NavigationItem } from '@object-ui/types';
import { SidebarMenuAction, SidebarMenuButton, SidebarMenuItem, SidebarProvider } from '@object-ui/components';
import { NavigationRenderer, type NavigationRendererProps, type NavItemActionContext } from '../NavigationRenderer';

const BASE = '/apps/crm';

const ITEMS: NavigationItem[] = [
  { id: 'nav_leads', type: 'object', objectName: 'crm_lead', label: 'Leads', pinned: true },
  { id: 'nav_help', type: 'url', url: 'https://example.com/help', target: '_blank', label: 'Help' },
  { id: 'nav_run', type: 'action', label: 'Run' },
  { id: 'nav_rule', type: 'separator' },
  {
    id: 'grp_sales',
    type: 'group',
    label: 'Sales',
    children: [{ id: 'nav_accounts', type: 'object', objectName: 'account', label: 'Accounts' }],
  },
] as NavigationItem[];

function renderNav(props: Partial<NavigationRendererProps> = {}) {
  return render(
    <MemoryRouter initialEntries={[BASE]}>
      <SidebarProvider defaultOpen>
        <NavigationRenderer items={ITEMS} basePath={BASE} onAction={() => {}} {...props} />
      </SidebarProvider>
    </MemoryRouter>,
  );
}

/** A host control that reports what the renderer told it. */
function recordingAction(seen: Array<[string, NavItemActionContext]>) {
  return (item: NavigationItem, context: NavItemActionContext) => {
    seen.push([item.id, context]);
    return <SidebarMenuAction data-testid={`host-action-${item.id}`} aria-label={`Host ${context.label}`} />;
  };
}

const favoritesSection = () =>
  (screen.queryByText('Favorites')?.closest('[data-sidebar="group"]') as HTMLElement | null | undefined) ?? null;

const hostRow = (id: string, label: string) => (
  <SidebarMenuItem key={id}>
    <SidebarMenuButton asChild>
      <a href={`/x/${id}`}>{label}</a>
    </SidebarMenuButton>
  </SidebarMenuItem>
);

afterEach(cleanup);

describe('NavigationRenderer: the host control in place of the pin action (objectui#12427)', () => {
  it('draws the host control on every leaf and action row, and no pin action anywhere', () => {
    const seen: Array<[string, NavItemActionContext]> = [];
    renderNav({ enablePinning: true, onPinToggle: () => {}, renderItemAction: recordingAction(seen) });

    expect(screen.queryAllByRole('button', { name: /^(Pin|Unpin) / })).toHaveLength(0);
    // The menu's four rows (Leads, Help, Run, Accounts) and the pinned Leads row
    // in the Favorites section; the separator and the group get none.
    expect(screen.getAllByTestId('host-action-nav_leads')).toHaveLength(2);
    for (const id of ['nav_help', 'nav_run', 'nav_accounts']) {
      expect(screen.getAllByTestId(`host-action-${id}`)).toHaveLength(1);
    }
    expect(screen.queryByTestId('host-action-nav_rule')).toBeNull();
    expect(screen.queryByTestId('host-action-grp_sales')).toBeNull();
  });

  it('tells the control the row\'s address and label; an action row has no address', () => {
    const seen: Array<[string, NavItemActionContext]> = [];
    renderNav({ renderItemAction: recordingAction(seen) });
    const byId = new Map(seen.map(([id, context]) => [id, context]));

    expect(byId.get('nav_leads')).toEqual({ href: '/apps/crm/crm_lead', external: false, label: 'Leads', basePath: BASE });
    expect(byId.get('nav_help')).toEqual({ href: 'https://example.com/help', external: true, label: 'Help', basePath: BASE });
    expect(byId.get('nav_run')).toEqual({ external: false, label: 'Run', basePath: BASE });
  });

  it('is drawn with pinning off too: enablePinning keeps deciding the Favorites section only', () => {
    renderNav({ renderItemAction: recordingAction([]) });
    expect(screen.getAllByTestId('host-action-nav_leads')).toHaveLength(1);
    expect(favoritesSection()).toBeNull();
  });

  it('a host that passes none keeps the pin action', () => {
    renderNav({ enablePinning: true, onPinToggle: () => {} });
    expect(screen.getAllByRole('button', { name: 'Unpin Leads' }).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Pin Accounts' })).toBeInTheDocument();
  });
});

describe('NavigationRenderer: host rows in the Favorites section (objectui#12427)', () => {
  it('appends the host rows after the pinned entries, in the same section', () => {
    renderNav({ enablePinning: true, onPinToggle: () => {}, extraFavorites: [hostRow('r1', 'Acme'), hostRow('r2', 'Globex')] });
    const section = favoritesSection();
    expect(section).not.toBeNull();
    expect(within(section!).getAllByRole('link').map((a) => a.textContent)).toEqual(['Leads', 'Acme', 'Globex']);
    expect(screen.getAllByText('Favorites')).toHaveLength(1);
  });

  it('renders the section for host rows alone, with pinning off', () => {
    renderNav({ extraFavorites: [hostRow('r1', 'Acme')] });
    const section = favoritesSection();
    expect(section).not.toBeNull();
    expect(within(section!).getAllByRole('link').map((a) => a.textContent)).toEqual(['Acme']);
  });

  it('null, false and an empty array are no rows: no section without a pinned entry', () => {
    for (const extraFavorites of [null, false, []]) {
      renderNav({ extraFavorites });
      expect(favoritesSection()).toBeNull();
      cleanup();
    }
  });

  it('a host that passes none keeps a section of pinned entries only', () => {
    renderNav({ enablePinning: true, onPinToggle: () => {} });
    expect(within(favoritesSection()!).getAllByRole('link').map((a) => a.textContent)).toEqual(['Leads']);
  });
});
