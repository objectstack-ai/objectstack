/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#25876 — a collapsed navigation group shows how many entries it
 * holds.
 *
 * Before: a closed group drew its label and a chevron and nothing else, so a
 * closed group holding one entry looked exactly like one holding ten, and new
 * users never opened it. Now, while the group is collapsed, a count badge sits
 * beside the label.
 *
 * The count is what opening the group would reveal: the entries that pass the
 * same per-item guards the renderer applies (`visible`, `requiredPermissions`,
 * the capability gates, an `action` needing a dispatcher), recursing into
 * nested groups. Separators and the groups themselves are not entries. The
 * badge is `aria-hidden`, so the disclosure's accessible name stays the label
 * alone (the disclosure already announces collapsed / expanded).
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { NavigationItem } from '@object-ui/types';
import { Sidebar, SidebarContent, SidebarProvider } from '@object-ui/components';
import { NavigationRenderer } from '../NavigationRenderer';

const BASE = '/apps/crm';

const entry = (id: string, extra: Partial<NavigationItem> = {}): NavigationItem =>
  ({ id, type: 'object', objectName: id, label: id.toUpperCase(), ...extra }) as NavigationItem;

/**
 * Seven nodes, four of them reachable: two plain entries and the two inside
 * the nested group. Not counted: an entry hidden by its `visible` expression,
 * an entry whose permission is denied, a separator, an `action` with no
 * dispatcher, a nested entry hidden by `visible`, and the nested group itself.
 */
const children = (): NavigationItem[] => [
  entry('nav_campaigns'),
  entry('nav_leads'),
  entry('nav_hidden', { visible: 'hide' } as Partial<NavigationItem>),
  entry('nav_denied', { requiredPermissions: ['marketing.admin'] } as Partial<NavigationItem>),
  { id: 'sep_1', type: 'separator' } as NavigationItem,
  { id: 'act_import', type: 'action', label: 'Import', actionDef: { actionName: 'import' } } as unknown as NavigationItem,
  {
    id: 'grp_nested',
    type: 'group',
    label: 'Forecasts',
    children: [entry('nav_forecast'), entry('nav_quota'), entry('nav_nested_hidden', { visible: 'hide' } as Partial<NavigationItem>)],
  } as NavigationItem,
];

const group = (id: string, label: string, extra: Partial<NavigationItem> = {}): NavigationItem =>
  ({ id, type: 'group', label, children: children(), ...extra }) as NavigationItem;

const evaluateVisibility = (expr: unknown) => expr !== 'hide';
const checkPermission = (perms: string[]) => !perms.includes('marketing.admin');

function renderNav(items: NavigationItem[], path = BASE) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SidebarProvider defaultOpen>
        <NavigationRenderer
          items={items}
          basePath={BASE}
          evaluateVisibility={evaluateVisibility}
          checkPermission={checkPermission}
        />
      </SidebarProvider>
    </MemoryRouter>,
  );
}

const disclosure = (label: string) => screen.getByRole('button', { name: label });
/** Any count drawn inside a disclosure: a run of digits as an element's whole text. */
const countIn = (button: HTMLElement) => within(button).queryByText(/^\d+$/);

afterEach(cleanup);

describe('NavigationRenderer — a collapsed group shows its reachable child count (objectstack#25876)', () => {
  it('a collapsed group shows the guarded count: hidden, denied, separator, dispatcher-less action and the nested group itself are not counted; nested entries are', () => {
    renderNav([group('grp_marketing', 'Marketing', { expanded: false })]);
    const button = disclosure('Marketing');
    expect(button).toHaveAttribute('aria-expanded', 'false');

    const count = countIn(button);
    expect(count, 'a collapsed group draws a count').not.toBeNull();
    expect(count).toHaveTextContent(/^4$/);
    expect(count).toHaveAttribute('aria-hidden', 'true');
  });

  it('the count is the badge, not part of the disclosure\'s accessible name', () => {
    renderNav([group('grp_marketing', 'Marketing', { expanded: false })]);
    // Exact name: the label alone, the badge's digits are not read into it.
    expect(screen.getByRole('button', { name: 'Marketing' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /4/ })).not.toBeInTheDocument();
  });

  it('an expanded group shows no count; collapsing it shows the count, expanding hides it again', async () => {
    const user = userEvent.setup();
    renderNav([group('grp_marketing', 'Marketing')]);
    const button = disclosure('Marketing');
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(countIn(button)).toBeNull();

    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(countIn(button)).toHaveTextContent(/^4$/);

    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(countIn(button)).toBeNull();
  });

  it('a nested group collapsed inside an open one shows its own count', async () => {
    const user = userEvent.setup();
    renderNav([group('grp_marketing', 'Marketing')]);
    const nested = disclosure('Forecasts');
    expect(countIn(nested)).toBeNull();
    await user.click(nested);
    expect(countIn(nested)).toHaveTextContent(/^2$/);
  });

  it('a group declared closed that holds the current route is forced open, so it shows no count', () => {
    renderNav([group('grp_marketing', 'Marketing', { expanded: false })], `${BASE}/nav_leads`);
    const button = disclosure('Marketing');
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(countIn(button)).toBeNull();
  });

  it('collapsed to icons: the count carries the very icon-mode hiding classes the group label carries', () => {
    const { container } = render(
      <MemoryRouter initialEntries={[BASE]}>
        <SidebarProvider defaultOpen={false}>
          <Sidebar collapsible="icon">
            <SidebarContent>
              <NavigationRenderer
                items={[group('grp_marketing', 'Marketing', { expanded: false })]}
                basePath={BASE}
                evaluateVisibility={evaluateVisibility}
                checkPermission={checkPermission}
              />
            </SidebarContent>
          </Sidebar>
        </SidebarProvider>
      </MemoryRouter>,
    );
    const peer = container.querySelector('.group.peer[data-state]');
    expect(peer).toHaveAttribute('data-state', 'collapsed');
    expect(peer).toHaveAttribute('data-collapsible', 'icon');

    const label = disclosure('Marketing');
    const tokens = (el: Element) => el.className.split(/\s+/).filter(Boolean);
    // The label's own icon-mode hiding tokens (pointer, focus / a11y tree, transition), read off it.
    const hiding = tokens(label).filter((t) => t.startsWith('group-data-[state=collapsed]:group-data-[collapsible=icon]:'));
    expect(hiding).toEqual(expect.arrayContaining([
      expect.stringMatching(/:invisible$/),
      expect.stringMatching(/:pointer-events-none$/),
    ]));

    const count = countIn(label);
    expect(count).not.toBeNull();
    for (const t of hiding) expect(tokens(count!)).toContain(t);
  });
});
