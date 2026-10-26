// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11196 — the open leaf's Surface names a label-less nav entry by what
 * it inherits, so the canvas caption and the breadcrumb read what the rail
 * reads.
 *
 * `resolveSurface` resolves a leaf's display text once, when the leaf is
 * opened. It read the authored label only, so a label-less leaf's Surface
 * carried `''` and the caption and breadcrumb fell back to the target's
 * internal name, while the rail row beside them (slice 1) already showed the
 * target's current label. It now takes the console's resolver
 * (`useNavTargetLabel`) through all three ways a leaf opens: the load's
 * first-leaf pick, the `?surface=` restore, and a click on a rail row.
 *
 * The pillar is the real `InterfacesPillar` over a mocked metadata client (the
 * harness of `StudioDesignSurface.surfaceIdentity.test.tsx`), under a real
 * `MetadataCtx` whose dashboards carry labels. The authored-label leaf is the
 * control: its label differs from its dashboard's, and it renders verbatim.
 * The copilot chip's half is pinned in `StudioDesignSurface.aiChipLabel.test.tsx`.
 */
import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { NavigationItemSchema } from '@objectstack/spec/ui';
import { I18nProvider } from '@object-ui/i18n';
import { MetadataCtx } from '@object-ui/react';

const NAV = [
  // The first leaf, so the load opens it: what the platform writes since
  // objectui#9868, no `label`.
  { id: 'nav_customers', type: 'dashboard', dashboardName: 'b2r4_customer_dashboard' },
  {
    id: 'nav_more',
    type: 'group',
    label: '更多',
    children: [
      // Control: an authored label, spelled unlike its dashboard's label.
      { id: 'nav_pipeline', type: 'dashboard', label: '我的漏斗', dashboardName: 'b2r4_pipeline_dashboard' },
      // Nested and not first, so only the `?surface=` restore or a click opens it.
      { id: 'nav_sales', type: 'dashboard', dashboardName: 'b2r4_sales_dashboard' },
    ],
  },
];

const mockClient = {
  list: vi.fn(async (type: string) => (type === 'app' ? [{ name: 'acme_app', label: '客户管理' }] : [])),
  listDrafts: vi.fn(async () => []),
  layered: vi.fn(async (type: string, name: string) => {
    if (type === 'app') return { effective: { name: 'acme_app', label: '客户管理', navigation: NAV } };
    if (type === 'dashboard') return { effective: { name, widgets: [] } };
    return { effective: { name } };
  }),
  getDraft: vi.fn(async () => null),
  save: vi.fn(async () => ({})),
  get: vi.fn(async () => undefined),
};

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return { ...mod, useMetadataClient: () => mockClient, useMetadataTypes: () => ({ entries: [] }) };
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

/** The host's metadata cache, as `MetadataProvider` serves it: every dashboard carries a label. */
const METADATA = {
  apps: [],
  objects: [],
  dashboards: [
    { name: 'b2r4_customer_dashboard', label: '客户仪表盘' },
    { name: 'b2r4_pipeline_dashboard', label: '销售漏斗' },
    { name: 'b2r4_sales_dashboard', label: '销售仪表盘' },
  ],
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

function renderZhPillar(search = '') {
  return render(
    <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }} persistLanguage={false}>
      <MetadataCtx.Provider value={METADATA as never}>
        <MemoryRouter initialEntries={[`/studio/com.acme.app/interfaces${search}`]}>
          <InterfacesPillar packageId="com.acme.app" />
        </MemoryRouter>
      </MetadataCtx.Provider>
    </I18nProvider>,
  );
}

const caption = () => screen.getByTestId('if-canvas-caption');
const crumb = () => screen.getByTestId('if-breadcrumb');

describe('objectui#11196 — the fixture is what the spec accepts', () => {
  it('every nav item parses against NavigationItemSchema, the label-less ones included', () => {
    for (const item of NAV) expect(NavigationItemSchema.safeParse(item).success).toBe(true);
  });
});

describe('objectui#11196 — the open leaf names a label-less entry by what it inherits', () => {
  it("the load's first-leaf pick: the caption and breadcrumb read the dashboard's label, the identity stays on the tooltip", async () => {
    renderZhPillar();
    await waitFor(() => expect(caption()).toHaveTextContent('客户仪表盘'), { timeout: 8000 });
    expect(crumb()).toHaveTextContent('客户仪表盘');
    expect(caption().textContent).not.toContain('b2r4_customer_dashboard');
    expect(crumb().textContent).not.toContain('b2r4_customer_dashboard');
    // objectui#7254's reachable half.
    expect(caption()).toHaveAttribute('title', '内部标识: dashboard · b2r4_customer_dashboard');
    expect(crumb()).toHaveAttribute('title', '内部标识: dashboard · b2r4_customer_dashboard');
  });

  it('the `?surface=` restore of a nested label-less leaf reads its dashboard label', async () => {
    renderZhPillar('?surface=dashboard:b2r4_sales_dashboard');
    await waitFor(() => expect(caption()).toHaveTextContent('销售仪表盘'), { timeout: 8000 });
    expect(crumb()).toHaveTextContent('销售仪表盘');
    expect(caption().textContent).not.toContain('b2r4_sales_dashboard');
  });

  it('a click on a label-less rail row opens a Surface named as the row is', async () => {
    renderZhPillar();
    await waitFor(() => expect(caption()).toHaveTextContent('客户仪表盘'), { timeout: 8000 });
    fireEvent.click(screen.getByRole('button', { name: '销售仪表盘 仪表板' }));
    await waitFor(() => expect(caption()).toHaveTextContent('销售仪表盘'), { timeout: 8000 });
    expect(crumb()).toHaveTextContent('销售仪表盘');
  });

  it('CONTROL: an authored label reads verbatim, never swapped for its dashboard’s label', async () => {
    renderZhPillar('?surface=dashboard:b2r4_pipeline_dashboard');
    await waitFor(() => expect(caption()).toHaveTextContent('我的漏斗'), { timeout: 8000 });
    expect(crumb()).toHaveTextContent('我的漏斗');
    expect(caption()).not.toHaveTextContent('销售漏斗');
  });
});
