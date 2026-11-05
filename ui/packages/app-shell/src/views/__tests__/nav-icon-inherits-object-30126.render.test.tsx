/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#30126 row 4 — an app navigation entry of type `object` that names
 * no `icon` draws the icon its object declares, on both surfaces that render an
 * app's navigation: the sidebar's `NavigationRenderer` (wired with
 * `useNavTargetIcon`, as `UnifiedSidebar` wires it) and the `nav:menu` page
 * block. Both read the same `MetadataCtx`, so every case asserts both.
 *
 * Controls: an authored icon stays; an object with no icon and a dashboard
 * entry keep each surface's generic icon; a changed object icon shows on the
 * next render with the navigation unchanged.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

// Module scope, never a `beforeAll` (AGENTS.md §测试纪律, objectui#3010).
import '@object-ui/components';
import { SidebarProvider } from '@object-ui/components';
import { SchemaRenderer, MetadataCtx } from '@object-ui/react';
import { NavigationRenderer } from '@object-ui/layout';
import '../nav-menu-renderer';
import { useNavTargetIcon } from '../../hooks/useNavTargetIcon';

const NAVIGATION = [
  { id: 'nav_projects', type: 'object', objectName: 'project', label: 'Projects' },
  { id: 'nav_open_invoices', type: 'object', objectName: 'invoice', viewName: 'open', label: 'Open invoices' },
  { id: 'nav_starred', type: 'object', objectName: 'project', label: 'Starred', icon: 'star' },
  { id: 'nav_notes', type: 'object', objectName: 'note', label: 'Notes' },
  { id: 'nav_dash', type: 'dashboard', dashboardName: 'overview', label: 'Overview' },
];

function metadata(projectIcon: string) {
  return {
    apps: [{ name: 'crm', label: 'CRM', navigation: NAVIGATION }],
    objects: [
      { name: 'project', label: 'Projects', icon: projectIcon },
      { name: 'invoice', label: 'Invoices', icon: 'receipt' },
      { name: 'note', label: 'Notes' },
    ],
    dashboards: [{ name: 'overview', label: 'Overview' }],
    reports: [],
    pages: [],
    loading: false,
    error: null,
    refresh: async () => {},
    invalidate: () => {},
    ensureType: async () => [],
    getItem: async () => null,
    getItemsByType: () => [],
    getTypeStatus: () => 'ready' as const,
  };
}

function SidebarSurface() {
  const resolveTargetIcon = useNavTargetIcon();
  return (
    <SidebarProvider defaultOpen>
      <nav aria-label="Sidebar">
        <NavigationRenderer items={NAVIGATION as never} basePath="/apps/crm" resolveTargetIcon={resolveTargetIcon} />
      </nav>
    </SidebarProvider>
  );
}

function tree(value: ReturnType<typeof metadata>) {
  return (
    <MemoryRouter initialEntries={['/apps/crm']}>
      <MetadataCtx.Provider value={value as never}>
        <Routes>
          <Route
            path="/apps/:appName"
            element={
              <>
                <SidebarSurface />
                <SchemaRenderer
                  schema={{ type: 'page:section', id: 's1', children: [{ type: 'nav:menu', id: 'blk_nav' }] } as never}
                />
              </>
            }
          />
        </Routes>
      </MetadataCtx.Provider>
    </MemoryRouter>
  );
}

const surfaces = () => [
  screen.getByRole('navigation', { name: 'Sidebar' }),
  screen.getByRole('navigation', { name: 'App navigation' }),
];

/** The `lucide-*` glyph token of the icon in the link named `name` inside `surface`. */
function glyph(surface: HTMLElement, name: string): string {
  const link = within(surface).getByRole('link', { name });
  return Array.from(link.querySelector('svg')?.classList ?? [])
    .filter((c) => c.startsWith('lucide-') && c !== 'lucide-icon')
    .sort()
    .join(' ');
}

describe('objectstack#30126 — an object nav entry with no icon draws its object’s icon, on both surfaces', () => {
  it('an object entry, and one naming a view of it, draw the object’s icon; an authored icon stays', async () => {
    render(tree(metadata('folder-kanban')));
    for (const surface of surfaces()) {
      await waitFor(() => expect(glyph(surface, 'Projects')).toContain('lucide-folder-kanban'));
      await waitFor(() => expect(glyph(surface, 'Open invoices')).toContain('lucide-receipt'));
      await waitFor(() => expect(glyph(surface, 'Starred')).toContain('lucide-star'));
    }
  });

  it('controls: an object with no icon and a dashboard entry draw the same generic icon each surface draws for no icon', async () => {
    render(tree(metadata('folder-kanban')));
    for (const surface of surfaces()) {
      await waitFor(() => expect(glyph(surface, 'Projects')).toContain('lucide-folder-kanban'));
      expect(glyph(surface, 'Notes')).toBe(glyph(surface, 'Overview'));
      expect(glyph(surface, 'Notes')).not.toContain('lucide-folder-kanban');
    }
  });

  it('a changed object icon shows on the next render; the navigation is not written to', async () => {
    const utils = render(tree(metadata('folder-kanban')));
    utils.rerender(tree(metadata('rocket')));
    for (const surface of surfaces()) {
      await waitFor(() => expect(glyph(surface, 'Projects')).toContain('lucide-rocket'));
    }
    expect(NAVIGATION[0]).not.toHaveProperty('icon');
  });
});
