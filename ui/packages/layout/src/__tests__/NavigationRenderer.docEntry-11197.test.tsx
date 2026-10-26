/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11197 — a `doc` navigation entry (ADR-0046) DRAWS as a link into the
 * console docs portal.
 *
 * `objectui validate` accepts a `doc` entry since this card, so the renderer has
 * to honour one (「声明即强制」): before it, `resolveHref` had no `doc` branch and
 * every `doc` entry rendered as a dead `#` link named after its `id`.
 *
 * The href uses the portal's own two route shapes under the entry's `basePath`
 * — `/docs/:slug` and `/docs/:slug/:name` — which the console mounts both at the
 * top level and inside the package container (`/apps/:appName/docs`, where the
 * app route segment is the package id — `AppHeader`'s "This app's docs" entry
 * opens the same tree). The entry is gated by the base keys its siblings carry
 * and nothing else: the book audience gate is the server's read layer
 * (ADR-0046 §6.7), never a client enum.
 */

import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { NavigationItem } from '@object-ui/types';
import { SidebarProvider } from '@object-ui/components';
import { AppSchemaRenderer } from '../AppSchemaRenderer';
import { NavigationRenderer, resolveHref, resolveNavItemLabel } from '../NavigationRenderer';

const APP = '/apps/com.example.crm';

const BOOK: NavigationItem = { id: 'nav_help', type: 'doc', label: 'Help Centre', book: 'crm_manual' };
const PAGE: NavigationItem = { id: 'nav_lead_guide', type: 'doc', doc: 'crm_lead_guide' };
const PAGE_IN_BOOK: NavigationItem = { id: 'nav_lead_in_manual', type: 'doc', book: 'crm_manual', doc: 'crm_lead_guide' };

describe('objectui#11197 — resolveHref sends a `doc` entry to the docs portal', () => {
  it.each([
    ['a book → the book landing', BOOK, `${APP}/docs/crm_manual`],
    ['a page → the flat-doc permalink (redirects to its canonical in-book URL)', PAGE, `${APP}/docs/crm_lead_guide`],
    ['a page in a book → that page in that book', PAGE_IN_BOOK, `${APP}/docs/crm_manual/crm_lead_guide`],
    ['the package\'s implicit book, keyed by its package id', { id: 'nav_docs', type: 'doc', book: 'com.example.crm' } as NavigationItem, `${APP}/docs/com.example.crm`],
  ])('%s', (_name, item, href) => {
    expect(resolveHref(item, APP)).toEqual({ href, external: false });
  });

  it('home navigation (basePath "") reaches the top-level /docs portal', () => {
    expect(resolveHref(BOOK, '').href).toBe('/docs/crm_manual');
    expect(resolveHref(PAGE, '').href).toBe('/docs/crm_lead_guide');
  });

  it('an entry naming no target — which the validator refuses — gets no route', () => {
    expect(resolveHref({ id: 'nav_help', type: 'doc' } as NavigationItem, APP).href).toBe('#');
  });
});

describe('objectui#11197 — an unlabelled `doc` entry shows its target\'s machine name', () => {
  it('the page it opens, else the book; an authored label verbatim (control)', () => {
    const { label: _drop, ...unlabelledBook } = BOOK as NavigationItem & { label?: string };
    expect(resolveNavItemLabel(unlabelledBook as NavigationItem)).toBe('crm_manual');
    expect(resolveNavItemLabel(PAGE)).toBe('crm_lead_guide');
    expect(resolveNavItemLabel(PAGE_IN_BOOK)).toBe('crm_lead_guide');
    expect(resolveNavItemLabel(BOOK)).toBe('Help Centre');
  });
});

function renderNav(items: NavigationItem[], props: Record<string, unknown> = {}) {
  return render(
    <MemoryRouter initialEntries={[APP]}>
      <SidebarProvider defaultOpen>
        <NavigationRenderer items={items} basePath={APP} {...props} />
      </SidebarProvider>
    </MemoryRouter>,
  );
}

describe('objectui#11197 — NavigationRenderer draws a `doc` entry', () => {
  it('draws each entry as a link to its portal href', () => {
    renderNav([BOOK, PAGE, PAGE_IN_BOOK]);
    expect(screen.getByRole('link', { name: 'Help Centre' }).getAttribute('href')).toBe(`${APP}/docs/crm_manual`);
    const pages = screen.getAllByRole('link', { name: 'crm_lead_guide' }).map((a) => a.getAttribute('href'));
    expect(pages).toEqual([`${APP}/docs/crm_lead_guide`, `${APP}/docs/crm_manual/crm_lead_guide`]);
  });

  it('is gated by the base keys its siblings carry — `requiredPermissions`, `visible`, `requiresService`', () => {
    const gated: NavigationItem[] = [
      { ...BOOK, id: 'nav_perm', label: 'Admin Guide', requiredPermissions: ['crm_admin'] },
      { ...BOOK, id: 'nav_vis', label: 'Hidden Guide', visible: 'false' },
      { ...BOOK, id: 'nav_svc', label: 'Service Guide', requiresService: 'docs' },
      { ...PAGE, id: 'nav_open', label: 'Open Guide' },
    ];
    renderNav(gated, {
      checkPermission: () => false,
      checkCapability: () => false,
    });
    expect(screen.queryByRole('link', { name: 'Admin Guide' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Hidden Guide' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Service Guide' })).toBeNull();
    // Control: the ungated entry under the same guards still draws.
    expect(screen.getByRole('link', { name: 'Open Guide' }).getAttribute('href')).toBe(`${APP}/docs/crm_lead_guide`);
  });
});

describe('objectui#11197 — AppSchemaRenderer\'s mobile tab bar links a `doc` entry', () => {
  it('uses the same href as the sidebar, not `#`', () => {
    const { container } = render(
      <MemoryRouter initialEntries={[APP]}>
        <AppSchemaRenderer
          schema={{ type: 'app', name: 'crm', title: 'CRM', navigation: [BOOK] }}
          basePath={APP}
          mobileNavMode="bottom_nav"
        >
          <div />
        </AppSchemaRenderer>
      </MemoryRouter>,
    );
    const bar = container.querySelector('[role="navigation"][aria-label="Mobile navigation"]');
    expect(bar).not.toBeNull();
    expect(Array.from(bar!.querySelectorAll('a')).map((a) => a.getAttribute('href'))).toEqual([`${APP}/docs/crm_manual`]);
  });
});
