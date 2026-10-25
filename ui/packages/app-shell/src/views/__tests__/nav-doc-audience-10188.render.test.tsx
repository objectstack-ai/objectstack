/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10188 — a `doc` navigation entry the member may not read is not
 * drawn, on BOTH surfaces that render an app's navigation: the sidebar's
 * `NavigationRenderer` and the `nav:menu` page block. `nav:menu` keeps its own
 * copy of the item guards, so this measures that the two agree.
 *
 * Both are wired as the shell wires them — the same `useNavDocTargetCheck`
 * hook reading the same `MetadataCtx` — over an app document that still
 * carries every entry (a server that did not prune it; on a current server
 * objectstack#19790 already has), for a member whose `doc` / `book` lists omit
 * the staff targets.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

// Module scope, never a `beforeAll` (AGENTS.md §测试纪律, objectui#3010).
import '@object-ui/components';
import { SidebarProvider } from '@object-ui/components';
import { SchemaRenderer, MetadataCtx } from '@object-ui/react';
import { NavigationRenderer } from '@object-ui/layout';
import '../nav-menu-renderer';
import { useNavDocTargetCheck } from '../../hooks/useNavDocTargetCheck';

const NAVIGATION = [
  { id: 'nav_open_doc', type: 'doc', label: 'Open doc', doc: 'crm_gs_welcome' },
  { id: 'nav_open_book', type: 'doc', label: 'Open book', book: 'crm_manual' },
  { id: 'nav_staff_doc', type: 'doc', label: 'Staff doc', doc: 'crm_staff_secret' },
  { id: 'nav_staff_book', type: 'doc', label: 'Staff book', book: 'crm_staff_manual' },
  { id: 'nav_staff_both', type: 'doc', label: 'Staff doc in book', book: 'crm_staff_manual', doc: 'crm_staff_secret' },
  { id: 'nav_leads', type: 'object', label: 'Leads', objectName: 'crm_lead' },
];

function metadata(status: 'ready' | 'loading') {
  const lists: Record<string, unknown[]> = {
    doc: [{ name: 'crm_gs_welcome', _packageId: 'com.example.crm' }],
    book: [{ name: 'crm_manual', _packageId: 'com.example.crm' }],
  };
  return {
    apps: [{ name: 'crm', label: 'CRM', navigation: NAVIGATION }],
    objects: [{ name: 'crm_lead', label: 'Leads' }],
    dashboards: [],
    reports: [],
    pages: [],
    loading: false,
    error: null,
    refresh: async () => {},
    invalidate: () => {},
    ensureType: async () => [],
    getItem: async () => null,
    getItemsByType: (type: string) => (status === 'ready' ? lists[type] ?? [] : []),
    getTypeStatus: (type: string) => (type === 'doc' || type === 'book' ? status : 'ready'),
  };
}

/** The sidebar surface, wired the way `UnifiedSidebar` wires it. */
function SidebarSurface() {
  const checkDocTarget = useNavDocTargetCheck([NAVIGATION as never]);
  return (
    <SidebarProvider defaultOpen>
      <nav aria-label="Sidebar">
        <NavigationRenderer items={NAVIGATION as never} basePath="/apps/crm" checkDocTarget={checkDocTarget} />
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

describe('objectui#10188 — a `doc` entry follows the member\'s own reads, on both surfaces', () => {
  it('the staff page, book and page-in-book are not drawn; the readable entries are', () => {
    render(tree(metadata('ready')));
    for (const surface of surfaces()) {
      const q = within(surface);
      expect(q.queryByRole('link', { name: 'Staff doc' })).toBeNull();
      expect(q.queryByRole('link', { name: 'Staff book' })).toBeNull();
      expect(q.queryByRole('link', { name: 'Staff doc in book' })).toBeNull();
      expect(q.getByRole('link', { name: 'Open doc' })).toHaveAttribute('href', '/apps/crm/docs/crm_gs_welcome');
      expect(q.getByRole('link', { name: 'Open book' })).toHaveAttribute('href', '/apps/crm/docs/crm_manual');
      expect(q.getByRole('link', { name: 'Leads' })).toBeInTheDocument();
    }
  });

  it('while the member\'s lists are loading, the server\'s answer stands — nothing is hidden on a missing answer', () => {
    render(tree(metadata('loading')));
    for (const surface of surfaces()) {
      expect(within(surface).getByRole('link', { name: 'Staff doc' })).toBeInTheDocument();
      expect(within(surface).getByRole('link', { name: 'Open doc' })).toBeInTheDocument();
    }
  });
});
