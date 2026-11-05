/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#30126 row 4 — an `object` navigation entry that names no `icon`
 * draws the icon its object declares, so the rows of an app whose navigation
 * names no icons are told apart. The host answers through `resolveTargetIcon`;
 * these pins drive that resolver directly.
 *
 * Controls: an authored icon wins and the resolver is not asked for it; an
 * entry that opens something other than an object keeps the generic icon; an
 * object that declares no icon, and a host with no resolver, keep the generic
 * icon too.
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { NavigationItem } from '@object-ui/types';
import { SidebarProvider } from '@object-ui/components';
import {
  NavigationRenderer,
  resolveNavItemIcon,
  type NavIconTarget,
  type NavTargetIconResolver,
} from '../NavigationRenderer';

const OBJECT_ICONS: Record<string, string> = { project: 'folder-kanban', invoice: 'receipt' };
const icons: NavTargetIconResolver = (target: NavIconTarget) => OBJECT_ICONS[target.objectName];

describe('objectstack#30126 — resolveNavItemIcon: an object entry with no icon takes its object’s', () => {
  it('an object entry, and one naming a view of it, answers the object’s icon', () => {
    expect(resolveNavItemIcon({ id: 'a', type: 'object', objectName: 'project' }, icons)).toBe('folder-kanban');
    expect(resolveNavItemIcon({ id: 'b', type: 'object', objectName: 'invoice', viewName: 'open' }, icons)).toBe('receipt');
  });

  it('an authored icon wins, and the resolver is not asked for it', () => {
    const spy = vi.fn(icons);
    expect(resolveNavItemIcon({ id: 'a', type: 'object', objectName: 'project', icon: 'star' }, spy)).toBe('star');
    expect(spy).not.toHaveBeenCalled();
  });

  it('controls: no object icon, no resolver, and a non-object entry answer undefined (the generic icon)', () => {
    expect(resolveNavItemIcon({ id: 'a', type: 'object', objectName: 'note' }, icons)).toBeUndefined();
    expect(resolveNavItemIcon({ id: 'a', type: 'object', objectName: 'project' })).toBeUndefined();
    expect(resolveNavItemIcon({ id: 'd', type: 'dashboard', dashboardName: 'project' }, icons)).toBeUndefined();
    expect(resolveNavItemIcon({ id: 's', type: 'separator' } as NavigationItem, icons)).toBeUndefined();
  });
});

/** The `lucide-*` tokens of the icon in the row labelled `label`: which glyph it is. */
function glyphOf(label: string): string {
  const row = screen.getByText(label).closest('[data-sidebar="menu-button"]');
  return Array.from(row?.querySelector('svg')?.classList ?? [])
    .filter((c) => c.startsWith('lucide-'))
    .sort()
    .join(' ');
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

describe('objectstack#30126 — NavigationRenderer draws the inherited icon', () => {
  const items: NavigationItem[] = [
    { id: 'nav_projects', type: 'object', objectName: 'project', label: 'Projects' },
    {
      id: 'grp_money',
      type: 'group',
      label: 'Money',
      children: [{ id: 'nav_invoices', type: 'object', objectName: 'invoice', viewName: 'open', label: 'Open invoices' }],
    },
    { id: 'nav_starred', type: 'object', objectName: 'project', label: 'Starred projects', icon: 'star' },
    { id: 'nav_notes', type: 'object', objectName: 'note', label: 'Notes' },
    { id: 'nav_dash', type: 'dashboard', dashboardName: 'project', label: 'Overview' },
  ];

  it('a top-level row and a row inside a group draw their object’s icon; the authored one stays', async () => {
    renderNav(items, { resolveTargetIcon: icons });
    await waitFor(() => expect(glyphOf('Projects')).toContain('lucide-folder-kanban'));
    await waitFor(() => expect(glyphOf('Open invoices')).toContain('lucide-receipt'));
    await waitFor(() => expect(glyphOf('Starred projects')).toContain('lucide-star'));
  });

  it('controls: an object with no icon and a dashboard row keep the generic icon, as every row does with no resolver', async () => {
    const { unmount } = renderNav(items, { resolveTargetIcon: icons });
    const generic = 'lucide-file-text';
    expect(glyphOf('Notes')).toBe(generic);
    expect(glyphOf('Overview')).toBe(generic);
    unmount();

    renderNav(items);
    expect(glyphOf('Projects')).toBe(generic);
    expect(glyphOf('Open invoices')).toBe(generic);
  });
});
