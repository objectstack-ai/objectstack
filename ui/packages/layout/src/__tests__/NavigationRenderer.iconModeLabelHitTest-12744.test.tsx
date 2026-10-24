/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12744 — in the collapsed (icon-mode) sidebar a hidden group label
 * takes no pointer events, so it no longer swallows the click on the row
 * just above its group.
 *
 * The `SidebarGroupLabel` primitive hides a label there with `opacity-0` and
 * `-mt-8` and nothing else. The invisible label stays hit-testable and lies
 * over the lower half of the row above; a collapsible group's label is its
 * disclosure button, so a centre click on that row's icon toggled the group
 * instead of navigating. The browser readings (`elementFromPoint` and a click
 * on every icon, before and after) are on the pull request.
 *
 * Instrument: the REAL `SidebarProvider` / `Sidebar` / `SidebarGroupLabel`
 * from `@object-ui/components` and the real `NavigationRenderer`. The test DOM
 * computes no Tailwind, so the pins read the label's class list. The
 * pointer-events variant must be the very condition the primitive hides the
 * label under: the expected token is DERIVED from the primitive's own
 * `…:opacity-0` token, so a primitive that changes its hiding condition turns
 * this red instead of leaving a variant that no longer matches.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { NavigationItem } from '@object-ui/types';
import { Sidebar, SidebarContent, SidebarProvider } from '@object-ui/components';
import { NavigationRenderer } from '../NavigationRenderer';

const BASE = '/apps/crm';

const entry = (id: string, extra: Partial<NavigationItem> = {}): NavigationItem =>
  ({ id, type: 'object', objectName: id, label: id.toUpperCase(), ...extra }) as NavigationItem;

/** The measured shape: a top-level row, then a collapsible group right below it. */
const ITEMS: NavigationItem[] = [
  entry('nav_home'),
  entry('nav_cases', { pinned: true } as Partial<NavigationItem>),
  {
    id: 'grp_sales',
    type: 'group',
    label: 'Sales',
    expanded: true,
    children: [entry('nav_accounts'), entry('nav_contacts')],
  } as NavigationItem,
];

function renderSidebar(open: boolean) {
  return render(
    <MemoryRouter initialEntries={[BASE]}>
      <SidebarProvider defaultOpen={open}>
        <Sidebar collapsible="icon">
          <SidebarContent>
            <NavigationRenderer items={ITEMS} basePath={BASE} enablePinning onPinToggle={() => {}} />
          </SidebarContent>
        </Sidebar>
      </SidebarProvider>
    </MemoryRouter>,
  );
}

const tokens = (el: Element) => el.className.split(/\s+/).filter(Boolean);

/** The variant prefix the primitive hides this label under, read off its `…:opacity-0` token. */
function hidingPrefix(label: Element): string {
  const hide = tokens(label).find((t) => t.endsWith(':opacity-0'));
  expect(hide, 'the primitive hides the label with a variant-scoped opacity-0').toBeDefined();
  return hide!.slice(0, -'opacity-0'.length);
}

const groupLabel = () => screen.getByRole('button', { name: /Sales/ });
const favoritesLabel = () =>
  screen.getByText('Favorites').closest('[data-sidebar="group-label"]') as HTMLElement;

afterEach(cleanup);

describe('NavigationRenderer — a hidden group label takes no pointer events in icon mode (objectui#12744)', () => {
  it('collapsed to icons: the collapsible group label and the Favorites label stop taking pointer events exactly where the primitive hides them', () => {
    const { container } = renderSidebar(false);
    // The condition the variant names really holds in this render.
    const peer = container.querySelector('.group.peer[data-state]');
    expect(peer).toHaveAttribute('data-state', 'collapsed');
    expect(peer).toHaveAttribute('data-collapsible', 'icon');

    for (const label of [groupLabel(), favoritesLabel()]) {
      expect(label).toHaveAttribute('data-sidebar', 'group-label');
      expect(tokens(label)).toContain(`${hidingPrefix(label)}pointer-events-none`);
    }
  });

  it('expanded: the collapsible group label still takes pointer events and toggles its group by mouse and keyboard', async () => {
    const user = userEvent.setup();
    renderSidebar(true);
    const label = groupLabel();

    // Never an unconditional pointer-events-none: every such token sits behind the hiding variant.
    const prefix = hidingPrefix(label);
    for (const t of tokens(label).filter((x) => x.endsWith('pointer-events-none'))) {
      expect(t).toBe(`${prefix}pointer-events-none`);
    }
    expect(tokens(favoritesLabel())).not.toContain('pointer-events-none');

    expect(label).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('link', { name: 'NAV_ACCOUNTS' })).toBeInTheDocument();

    await user.click(label);
    expect(label).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('link', { name: 'NAV_ACCOUNTS' })).not.toBeInTheDocument();

    label.focus();
    expect(label).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(label).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('link', { name: 'NAV_ACCOUNTS' })).toBeInTheDocument();
  });
});
