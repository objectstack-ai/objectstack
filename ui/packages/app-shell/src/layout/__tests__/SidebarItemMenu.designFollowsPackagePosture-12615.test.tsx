// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The sidebar ⋯ menu's Design entry follows the app bar's Edit app rule
 * (objectui#12615): it is listed only when the package the entry's designer
 * opens is one Studio lists as writable, for a principal who may author
 * metadata. A Setup entry and a read-only package's entry list no Design; a
 * writable base's entry does. A favorite is judged by the package its own
 * designer opens, which need not be the sidebar's.
 *
 * Harness: the real component in a real `SidebarMenuItem` row under the real
 * router, as `SidebarItemMenu-12427` draws it; the two principal answers are
 * stand-ins and the package list is served the way `GET /api/v1/packages`
 * serves it. Each menu is opened after the list has answered.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { NavigationItem } from '@object-ui/types';

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      String(options?.defaultValue ?? key).replace(/\{\{(\w+)\}\}/g, (_hole, name: string) =>
        String(options?.[name] ?? ''),
      ),
    language: 'en',
  }),
}));

const viewer = vi.hoisted(() => ({ isAdmin: true, canAuthorMetadata: true }));
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useWorkspaceAdminStatus: () => ({ isAdmin: viewer.isAdmin, isResolved: true }),
}));
vi.mock('../../hooks/useCanAuthorMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useCanAuthorMetadata: () => viewer.canAuthorMetadata,
}));

import { SidebarMenu, SidebarMenuItem, SidebarProvider } from '@object-ui/components';
import { SidebarItemMenu, sidebarItemDesignPath, favoriteDesignPath } from '../SidebarItemMenu';
import { appStudioRoutePath } from '../../utils/appRoute';
import { studioPathPackageId } from '../../hooks/useStudioDesignGate';

const SETUP = { name: 'setup', _packageId: 'com.objectstack.setup' };
const HOTCRM = { name: 'crm', _packageId: 'app.objectstack.hotcrm' };
const BASE_APP = { name: 'my_app', _packageId: 'com.example.my_base' };
const APPS = [SETUP, HOTCRM, BASE_APP];

/** `GET /api/v1/packages`: the kernel Setup package, a read-only code package, a writable base. */
const PACKAGES = {
  success: true,
  data: {
    packages: [
      { manifest: { id: 'com.objectstack.setup', name: 'Setup', scope: 'system' }, writable: false },
      { manifest: { id: 'app.objectstack.hotcrm', name: 'HotCRM', scope: 'project' }, writable: false },
      { manifest: { id: 'com.example.my_base', name: 'My Base' }, writable: true },
    ],
  },
};

const LEADS = { id: 'nav_leads', type: 'object', objectName: 'lead', label: 'Leads' } as NavigationItem;

/** One sidebar row whose menu's Design opens `designPath`. */
function renderRow(designPath: string | null) {
  return render(
    <MemoryRouter initialEntries={['/apps/x']}>
      <SidebarProvider>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarItemMenu
              label="Leads"
              href="/apps/x/lead"
              isFavorite={false}
              onToggleFavorite={vi.fn()}
              designPath={designPath}
            />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarProvider>
    </MemoryRouter>,
  );
}

/** One macrotask: every read the stub answers has settled. */
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

/** The menu's entries, opened once the package list has answered. */
async function menuOf(designPath: string | null): Promise<string[]> {
  renderRow(designPath);
  await settle();
  fireEvent.keyDown(screen.getByTestId('sidebar-item-menu-trigger'), { key: 'Enter' });
  const items = (await screen.findAllByRole('menuitem')).map((el) => el.textContent ?? '');
  cleanup();
  return items;
}

const WITH_DESIGN = ['Add to favorites', 'Open in new tab', 'Copy link', 'Design'];
const WITHOUT_DESIGN = ['Add to favorites', 'Open in new tab', 'Copy link'];

beforeEach(() => {
  viewer.isAdmin = true;
  viewer.canAuthorMetadata = true;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown) => ({
      ok: true,
      status: 200,
      json: async () => (String(url).endsWith('/api/v1/packages') ? PACKAGES : { data: [] }),
    })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the sidebar\'s Design entry follows the app bar\'s Edit app rule (objectui#12615)', () => {
  it('no Design for an entry of the Setup app', async () => {
    expect(await menuOf(sidebarItemDesignPath(LEADS, SETUP))).toEqual(WITHOUT_DESIGN);
  });

  it('no Design for an entry of a read-only package\'s app', async () => {
    expect(await menuOf(sidebarItemDesignPath(LEADS, HOTCRM))).toEqual(WITHOUT_DESIGN);
  });

  it('CONTROL — Design for an entry of a writable base\'s app', async () => {
    expect(await menuOf(sidebarItemDesignPath(LEADS, BASE_APP))).toEqual(WITH_DESIGN);
  });

  it('a favorite is judged by the package its own designer opens', async () => {
    const readOnly = favoriteDesignPath({ id: 'object:deal', href: '/apps/app.objectstack.hotcrm/deal' }, APPS);
    const writable = favoriteDesignPath({ id: 'object:deal', href: '/apps/com.example.my_base/deal' }, APPS);
    expect(await menuOf(readOnly)).toEqual(WITHOUT_DESIGN);
    expect(await menuOf(writable)).toEqual(WITH_DESIGN);
  });

  it('the principal half still stands: no Design for an admin the server refuses authoring', async () => {
    viewer.canAuthorMetadata = false;
    expect(await menuOf(sidebarItemDesignPath(LEADS, BASE_APP))).toEqual(WITHOUT_DESIGN);
  });
});

describe('studioPathPackageId reads the package back off the path appStudioRoutePath builds (objectui#12615)', () => {
  it('for each route shape the bridge builds', () => {
    for (const route of [{ type: 'dashboard', name: 'pipeline' }, { type: 'lead' }, { type: 'system' }]) {
      expect(studioPathPackageId(appStudioRoutePath(BASE_APP, true, route))).toBe('com.example.my_base');
    }
  });

  it('a path that names no Studio package answers null', () => {
    expect(studioPathPackageId(null)).toBeNull();
    expect(studioPathPackageId('/apps/com.example.my_base/lead')).toBeNull();
    expect(studioPathPackageId('/studio')).toBeNull();
  });
});
