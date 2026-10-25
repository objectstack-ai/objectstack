// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11196 — the Studio Interfaces rail names a label-less nav entry the
 * way the console's sidebar does.
 *
 * Since objectui#9868 the platform writes nav entries with NO `label`: absent
 * ⇒ the entry shows its target's CURRENT label at render time. The rail's rows
 * read the raw label. A label-less leaf fell back to its target's internal
 * name (objectui#7254), and a label-less group heading was blank. Each row now
 * asks the runtime's rule with the console's own target resolver
 * (`useNavTargetLabel`), under a real `MetadataCtx` that labels the object:
 *
 *  - a label-less object leaf shows its object's metadata label;
 *  - a label-less page leaf shows its `pageName`, and a label-less group
 *    heading its `id`;
 *  - CONTROL: an authored label renders verbatim;
 *  - the internal identity stays on the row's tooltip (objectui#7254).
 *
 * Without metadata for the object, the rail still shows the internal name, as
 * `StudioDesignSurface.surfaceIdentity.test.tsx` pins.
 */
import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '@object-ui/i18n';
import { MetadataCtx } from '@object-ui/react';

const NAV = [
  // Control: an authored label. The pillar opens this first leaf on load.
  { id: 'nav_dash', type: 'dashboard', label: '客户仪表盘', dashboardName: 'b2r4_customer_dashboard' },
  // What the platform writes since objectui#9868: no `label`.
  { id: 'nav_obj', type: 'object', objectName: 'b2r4_customer' },
  { id: 'nav_admin', type: 'group', children: [{ id: 'nav_home', type: 'page', pageName: 'home_page' }] },
];

const mockClient = {
  list: vi.fn(async (type: string) => (type === 'app' ? [{ name: 'acme_app', label: '客户管理' }] : [])),
  listDrafts: vi.fn(async () => []),
  layered: vi.fn(async (type: string, name: string) => {
    if (type === 'app') return { effective: { name: 'acme_app', label: '客户管理', navigation: NAV } };
    if (type === 'dashboard') return { effective: { name, label: '客户仪表盘', widgets: [] } };
    return { effective: { name } };
  }),
  getDraft: vi.fn(async () => null),
  save: vi.fn(async () => ({})),
  get: vi.fn(async () => undefined),
};

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return {
    ...mod,
    useMetadataClient: () => mockClient,
    useMetadataTypes: () => ({ entries: [] }),
  };
});

vi.mock('./packages-io', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./packages-io')>();
  return { ...mod, fetchPackages: vi.fn(async () => []) };
});

vi.mock('@object-ui/react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/react')>();
  return { ...mod, useAdapter: () => ({}) };
});

import { InterfacesPillar } from './StudioDesignSurface';

afterEach(cleanup);

/** The host's metadata cache, as `MetadataProvider` serves it: the object carries a label. */
const METADATA = {
  apps: [],
  objects: [{ name: 'b2r4_customer', label: '客户' }],
  dashboards: [{ name: 'b2r4_customer_dashboard', label: '客户仪表盘' }],
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

function renderZhPillar() {
  return render(
    <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }}>
      <MetadataCtx.Provider value={METADATA as never}>
        <MemoryRouter initialEntries={['/studio/com.acme.app/interfaces']}>
          <InterfacesPillar packageId="com.acme.app" />
        </MemoryRouter>
      </MetadataCtx.Provider>
    </I18nProvider>,
  );
}

describe('objectui#11196 — the Studio rail names a label-less entry by what it inherits', () => {
  it("a label-less object leaf shows its object's metadata label, and keeps its identity on the tooltip", async () => {
    renderZhPillar();
    const row = await screen.findByRole('button', { name: '客户 对象' });
    expect(row).toHaveAccessibleDescription('object · b2r4_customer');
    expect(screen.queryByRole('button', { name: 'b2r4_customer 对象' })).not.toBeInTheDocument();
  });

  it("a label-less group heading shows its id, and its label-less page leaf its pageName", async () => {
    renderZhPillar();
    await screen.findByRole('button', { name: '客户 对象' });
    expect(screen.getByText('nav_admin')).toBeInTheDocument();
    // objectui#12455 — the row's kind tag follows its label in its name.
    expect(screen.getByRole('button', { name: 'home_page 页面' })).toHaveAccessibleDescription('page · home_page');
  });

  it('CONTROL: an authored label renders verbatim', async () => {
    renderZhPillar();
    expect(await screen.findByRole('button', { name: '客户仪表盘 仪表板' })).toBeInTheDocument();
  });
});
