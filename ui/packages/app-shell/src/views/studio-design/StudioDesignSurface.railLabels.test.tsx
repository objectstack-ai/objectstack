// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Interfaces rail and its labels: ten pins that render the real
 * `InterfacesPillar` over one mocked metadata harness, folded into one file
 * (objectstack#25911).
 *
 * Each block below was its own file, named in its `describe`, with the
 * same three mocks: `useMetadataClient` / `useMetadataTypes`, `fetchPackages`
 * and `useAdapter`. Only the metadata client's answers differed. Under the
 * `dom` project's `isolate: true`, each of those files paid the whole module
 * graph's import again, and the import was most of a file's time. Here the
 * graph loads once, and each block installs its own client double in a
 * `beforeEach`, through the `studio` slot the mocks read. Every block keeps
 * its fixtures, hooks and assertions as they were, and its issue number in
 * its `describe`.
 *
 * Isolation between blocks:
 *  - React Testing Library's `cleanup()` runs after every test (each block
 *    registers it, and so does the `dom` setup).
 *  - react-i18next's global instance is put back after every test
 *    (`vitest.setup.i18n-global.ts`).
 *  - The one block that registers a component (`navEntryIdentity-11774`, an
 *    `object-view` recorder in its `beforeAll`) comes last, so no other
 *    block renders after that registration.
 *
 * A new pin that renders `InterfacesPillar` over this harness, and registers
 * nothing in a metadata registry, joins this file as its own `describe`.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { AppSchema, NavigationItemSchema } from '@objectstack/spec/ui';
import { I18nProvider, useObjectTranslation } from '@object-ui/i18n';
import { MetadataCtx, type MetadataContextValue } from '@object-ui/react';
import { ComponentRegistry } from '@object-ui/core';
import { SidebarProvider, badgeVariants } from '@object-ui/components';
import { NavigationRenderer } from '@object-ui/layout';
import type { NavigationItem } from '@object-ui/types';
// @ts-expect-error — plain-JS gate script, intentionally untyped (`allowJs: false`)
import { readDesignerPairs } from '../../../../../scripts/check-i18n-designer-table-parity.mjs';

/** The metadata client the open block installed; the mocks below read it. */
const studio = vi.hoisted(() => ({ client: undefined as unknown }));

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return { ...mod, useMetadataClient: () => studio.client, useMetadataTypes: () => ({ entries: [] }) };
});

vi.mock('./packages-io', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./packages-io')>();
  return { ...mod, fetchPackages: vi.fn(async () => []) };
});

vi.mock('@object-ui/react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/react')>();
  return { ...mod, useAdapter: () => ({}) };
});

import { InterfacesPillar, StudioNavItemInspector } from './StudioDesignSurface';
import { t } from '../metadata-admin/i18n';
import { listStudioCanvasPreviewTypes } from './studio-canvas-preview';

// The designer rows this suite reads in zh live in `@object-ui/i18n`'s `studio`
// namespace, whose `zh` catalogue is fetched on demand (objectstack#25922).
// Resident before any case, so the zh rows below read synchronously.
import { loadStudioCatalogue } from '@object-ui/i18n/namespaces/studio';
await loadStudioCatalogue('zh');

// ── StudioDesignSurface.railLabelInherits-11196 ──────────────────────────────

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
 * the `StudioDesignSurface.surfaceIdentity` block in this file pins.
 */
describe('StudioDesignSurface.railLabelInherits-11196', () => {
  beforeEach(() => {
    studio.client = mockClient;
  });

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
});

// ── StudioDesignSurface.surfaceLabelInherits-11196 ───────────────────────────

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
 * harness of the `StudioDesignSurface.surfaceIdentity` block in this file), under a real
 * `MetadataCtx` whose dashboards carry labels. The authored-label leaf is the
 * control: its label differs from its dashboard's, and it renders verbatim.
 * The copilot chip's half is pinned in `StudioDesignSurface.aiChipLabel.test.tsx`.
 */
describe('StudioDesignSurface.surfaceLabelInherits-11196', () => {
  beforeEach(() => {
    studio.client = mockClient;
  });

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
});

// ── StudioDesignSurface.surfaceIdentity ──────────────────────────────────────

/**
 * objectui#7254 — the Interfaces workbench spoke two vocabularies at once.
 *
 * The rail heading said 「客户管理 · 导航」 while, one strip away, the
 * breadcrumb chip printed `dashboard · customer_dashboard` and the canvas
 * caption printed the same pair — raw metadata type and internal name, beside
 * a Chinese label, for a customer who has never seen either.
 *
 * The ruling: the top bar / breadcrumb / rail show the metadata LABEL; the
 * internal name belongs in a developer view or a tooltip. So these pins assert
 * both halves — the label and translated KIND are what is READ, and the
 * internal identity is still REACHABLE on the tooltip (removing it outright
 * would take the one handle a developer debugging a binding actually uses).
 */
describe('StudioDesignSurface.surfaceIdentity', () => {
  beforeEach(() => {
    studio.client = mockClient;
  });

  const NAV = [
    { id: 'nav_dash', type: 'dashboard', label: '客户仪表盘', dashboardName: 'b2r4_customer_dashboard' },
    // A leaf the author never labelled — the rail used to render an EMPTY row.
    { id: 'nav_obj', type: 'object', objectName: 'b2r4_customer' },
  ];

  const mockClient = {
    list: vi.fn(async (type: string) =>
      type === 'app' ? [{ name: 'acme_app', label: '客户管理' }] : [],
    ),
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

  afterEach(cleanup);

  function renderZhPillar() {
    return render(
      <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }}>
        <MemoryRouter initialEntries={['/studio/com.acme.app/interfaces']}>
          <InterfacesPillar packageId="com.acme.app" />
        </MemoryRouter>
      </I18nProvider>,
    );
  }

  describe('Interfaces workbench — labels on screen, internal names on the tooltip', () => {
    it('the rail names an unlabelled leaf by its object name instead of rendering a blank row', async () => {
      renderZhPillar();
      // The dashboard leaf carries a label; the object leaf does not. (The
      // labelled one also appears in the breadcrumb/caption once the pillar
      // auto-selects it, hence `findAllByText`.)
      expect((await screen.findAllByText('客户仪表盘')).length).toBeGreaterThan(0);
      expect(await screen.findByText('b2r4_customer')).toBeInTheDocument();
    });

    it('the rail kind chip is translated, not the raw English metadata type', async () => {
      renderZhPillar();
      await screen.findAllByText('客户仪表盘');
      expect(screen.getAllByText('仪表板').length).toBeGreaterThan(0);
      expect(screen.queryByText('DASHBOARD')).not.toBeInTheDocument();
      expect(screen.queryByText('dashboard')).not.toBeInTheDocument();
    });

    it('the breadcrumb reads label + translated kind, with the internal pair on its tooltip', async () => {
      renderZhPillar();
      fireEvent.click(await screen.findByTitle('dashboard · b2r4_customer_dashboard'));
      const crumb = await waitFor(() => screen.getByTestId('if-breadcrumb'), { timeout: 4000 });
      expect(crumb).toHaveTextContent('客户仪表盘');
      expect(crumb).toHaveTextContent('仪表板');
      // The pair is reachable, but not printed at the customer.
      // Prefixed, so the tooltip SAYS what the pair is — and so the rail item,
      // the breadcrumb and the caption stop sharing one addressable string.
      expect(crumb).toHaveAttribute('title', '内部标识: dashboard · b2r4_customer_dashboard');
      expect(crumb.textContent).not.toContain('b2r4_customer_dashboard');
    });

    it('the canvas caption follows the same rule', async () => {
      renderZhPillar();
      fireEvent.click(await screen.findByTitle('dashboard · b2r4_customer_dashboard'));
      const caption = await waitFor(() => screen.getByTestId('if-canvas-caption'), { timeout: 4000 });
      expect(caption).toHaveTextContent('客户仪表盘');
      expect(caption).toHaveAttribute('title', '内部标识: dashboard · b2r4_customer_dashboard');
      expect(caption.textContent).not.toContain('b2r4_customer_dashboard');
    });
  });
});

// ── StudioDesignSurface.navRailLabels-11862 ──────────────────────────────────

/**
 * objectui#11862 — the Studio Interfaces rail shows a nav entry's label as the
 * primary text and its target's machine name as secondary text, and never
 * names an entry by the `nav_item_N` id the editor minted for it.
 *
 * On the maintainer's word 「所有地方以标签为主，机器名只作为次要信息」:
 *
 *  - a label-less object entry shows its object's label, with the object's
 *    machine name as the secondary information on the row's tooltip;
 *  - an authored label shows verbatim, with the target's machine name on the
 *    tooltip;
 *  - an entry that names no target yet ("Add nav item" left unbound) reads as
 *    the editor's untitled wording, "Item N" by its place, never its id;
 *  - CONTROL: a target with no label in hand shows its machine name alone,
 *    once;
 *  - the secondary name is not part of the row's accessible name, which stays
 *    the label and the kind it was.
 *
 * objectui#12455 (epic objectui#12446, decision 5) moved the machine name from
 * a second line under the label to the row's tooltip: the rail is the app's
 * navigation as the shipped sidebar draws it, one 32 px row per entry, and the
 * card keeps "the id and the bound target in the row's title". The tooltip is
 * still secondary information beside a primary label, which is what the
 * ruling asks; the assertions below read it there.
 *
 * The inspector beside the rail offers the same untitled wording as its Label
 * placeholder for an unbound entry.
 */
describe('StudioDesignSurface.navRailLabels-11862', () => {
  beforeEach(() => {
    studio.client = mockClient;
  });

  const NAV = [
    // An authored label. The pillar opens this first leaf on load.
    { id: 'nav_dash', type: 'dashboard', label: 'Ops board', dashboardName: 'ops_board' },
    // What the platform writes since objectui#9868: no `label`.
    { id: 'nav_obj', type: 'object', objectName: 'b2r4_customer' },
    // "Add nav item" left unbound, kept in its place by the editor. Its id's
    // number (7) differs from its place (3), so the wording is not read off the id.
    { id: 'nav_item_7', type: 'object' },
    // A target the host's metadata does not label (a draft-only object).
    { id: 'nav_ticket', type: 'object', objectName: 'repairs_ticket' },
  ];

  const mockClient = {
    list: vi.fn(async (type: string) => (type === 'app' ? [{ name: 'acme_app', label: 'Acme' }] : [])),
    listDrafts: vi.fn(async () => []),
    layered: vi.fn(async (type: string, name: string) => {
      if (type === 'app') return { effective: { name: 'acme_app', label: 'Acme', navigation: NAV } };
      if (type === 'dashboard') return { effective: { name, label: 'Ops board', widgets: [] } };
      return { effective: { name } };
    }),
    getDraft: vi.fn(async () => null),
    save: vi.fn(async () => ({})),
    get: vi.fn(async () => undefined),
  };

  afterEach(cleanup);

  /** The host's metadata cache: `b2r4_customer` carries a label, `repairs_ticket` is not in it. */
  const METADATA = {
    apps: [],
    objects: [{ name: 'b2r4_customer', label: 'Customers' }],
    dashboards: [{ name: 'ops_board', label: 'Ops board' }],
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

  function renderPillar() {
    return render(
      <MetadataCtx.Provider value={METADATA as never}>
        <MemoryRouter initialEntries={['/studio/com.acme.app/interfaces']}>
          <InterfacesPillar packageId="com.acme.app" />
        </MemoryRouter>
      </MetadataCtx.Provider>,
    );
  }

  describe('objectui#11862 — the Interfaces rail: label first, machine name second', () => {
    it("a label-less object entry shows its object's label, its machine name as secondary text", async () => {
      renderPillar();
      // The accessible name is the label and the kind, as before: the machine
      // name is its description, on the tooltip, never the visible text.
      const row = await screen.findByRole('button', { name: 'Customers Object' });
      expect(within(row).getByText('Customers')).toBeInTheDocument();
      expect(row).toHaveAttribute('title', 'object · b2r4_customer');
      expect(row).toHaveAccessibleDescription('object · b2r4_customer');
      expect(row).not.toHaveTextContent('b2r4_customer');
    });

    it("an authored label shows verbatim, the target's machine name beneath it", async () => {
      renderPillar();
      const row = await screen.findByRole('button', { name: 'Ops board Dashboard' });
      expect(row).toHaveAttribute('title', 'dashboard · ops_board');
      expect(row).not.toHaveTextContent('ops_board');
    });

    it('an entry that names no target reads as the untitled wording by its place, never its id', async () => {
      renderPillar();
      // objectui#12455 — its kind is known (it was born an object entry), so
      // its tag says so.
      const row = await screen.findByRole('button', { name: 'Item 3 Object' });
      expect(row).toBeDisabled();
      expect(row).not.toHaveTextContent('nav_item_7');
      expect(row).not.toHaveAttribute('title', 'nav_item_7');
    });

    it('CONTROL: a target with no label in hand shows its machine name alone, once', async () => {
      renderPillar();
      const row = await screen.findByRole('button', { name: 'repairs_ticket Object' });
      expect(within(row).getAllByText('repairs_ticket')).toHaveLength(1);
    });
  });

  describe('objectui#11862 — the nav-item inspector offers the untitled wording for an unbound entry', () => {
    function renderInspector(navigation: Array<Record<string, unknown>>, navId: string) {
      render(
        <MetadataCtx.Provider value={METADATA as never}>
          <StudioNavItemInspector
            navId={navId}
            appDraft={{ navigation }}
            objects={[{ name: 'b2r4_customer', label: 'Customers' }]}
            packageId="com.acme.app"
            onNavPatch={vi.fn()}
            onClear={vi.fn()}
          />
        </MetadataCtx.Provider>,
      );
      // objectstack#26740 — the inspector also has a Badge textbox, so the Label field is found by its name.
      return screen.getByRole('textbox', { name: 'Label' }) as HTMLInputElement;
    }

    it("an unbound entry's Label placeholder is \"Item N\" by its place, not its id", () => {
      const field = renderInspector([NAV[1], { id: 'nav_item_7', type: 'object' }], 'navigation[1]');
      expect(field).toHaveAttribute('placeholder', 'Item 2');
    });

    it("CONTROL: a bound label-less entry's placeholder is still its object's label", () => {
      const field = renderInspector([NAV[1]], 'navigation[0]');
      expect(field).toHaveAttribute('placeholder', 'Customers');
    });
  });
});

// ── StudioDesignSurface.railSeparatorBadge-11791 ─────────────────────────────

/**
 * objectui#11791 — the Studio Interfaces rail draws a `separator` and a leaf's
 * `badge` / `badgeVariant` as the running app's sidebar draws them.
 *
 * The sidebar this mirrors is `NavigationRenderer` in
 * `packages/layout/src/NavigationRenderer.tsx`, the renderer the console's
 * `UnifiedSidebar` mounts. Its decisions, read there when this card landed:
 *
 *  - a `separator` is a rule, not an entry: a decorative `Separator`, hidden
 *    from assistive tech (objectui#11690), no row and no link;
 *  - a present `badge` (`!= null`, so a count `0` too) is a `Badge` in the
 *    entry's row, its variant the entry's `badgeVariant`, an absent one
 *    `Badge`'s own default.
 *
 * The rail's `NavTree` had a group branch and a leaf branch only, so a
 * separator fell into the leaf branch: `resolveSurface` answers `null` for it,
 * and the row drew as a disabled, unlabeled button. `badge` was never read.
 *
 * This pin renders BOTH surfaces from one fixture and compares them, so a
 * change to the sidebar's decision turns it red here as well, naming the file
 * to mirror. The rail mirrors the decision, not the sidebar's markup: its rows
 * are buttons, the sidebar's are `SidebarMenu` links.
 */
describe('StudioDesignSurface.railSeparatorBadge-11791', () => {
  beforeEach(() => {
    studio.client = mockClient;
  });

  const PKG = 'com.acme.app';

  const NAV = [
    // The first leaf: the pillar opens it on load.
    { id: 'nav_home', type: 'page', label: 'Home', pageName: 'home' },
    // The card's showcase pair: a separator, then a report carrying `NEW`.
    { id: 'nav_sep_reports', type: 'separator' },
    {
      id: 'nav_report_summary',
      type: 'report',
      label: 'Hours by Status',
      reportName: 'hours_by_status',
      icon: 'sigma',
      badge: 'NEW',
      badgeVariant: 'secondary',
    },
    // A count with no variant: `Badge`'s own default on both surfaces.
    { id: 'nav_tasks', type: 'page', label: 'Tasks', pageName: 'tasks', badge: 3 },
    // A count of zero is a present badge.
    { id: 'nav_inbox', type: 'page', label: 'Inbox', pageName: 'inbox', badge: 0, badgeVariant: 'destructive' },
    {
      id: 'nav_more',
      type: 'group',
      label: 'More',
      children: [
        // Control: no badge, none drawn.
        { id: 'nav_alpha', type: 'page', label: 'Alpha', pageName: 'alpha' },
        { id: 'nav_sep_more', type: 'separator' },
        // No design surface, so a disabled rail row; it keeps its badge.
        { id: 'nav_docs', type: 'url', label: 'Docs', url: 'https://example.com/docs', badge: 'ext', badgeVariant: 'outline' },
      ],
    },
  ];

  /** The rows that carry a badge, by label, with the variant the sidebar must draw. */
  const BADGED: ReadonlyArray<{ label: string; text: string; variant: string }> = [
    { label: 'Hours by Status', text: 'NEW', variant: 'secondary' },
    { label: 'Tasks', text: '3', variant: 'default' },
    { label: 'Inbox', text: '0', variant: 'destructive' },
    { label: 'Docs', text: 'ext', variant: 'outline' },
  ];

  const mockClient = {
    list: vi.fn(async (type: string) => (type === 'app' ? [{ name: 'acme_app', label: 'Acme' }] : [])),
    listDrafts: vi.fn(async () => []),
    layered: vi.fn(async (type: string, name: string) => {
      if (type === 'app') return { effective: { name: 'acme_app', label: 'Acme', navigation: NAV } };
      if (type === 'page') return { effective: { name, label: name, type: 'app', regions: [{ name: 'main', components: [] }] } };
      return { effective: { name } };
    }),
    getDraft: vi.fn(async () => null),
    save: vi.fn(async () => ({})),
    get: vi.fn(async () => undefined),
  };

  afterEach(cleanup);

  /** The Studio rail, once its rows have rendered; returns the rail's `nav`. */
  async function renderRail(): Promise<HTMLElement> {
    render(
      <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
        <MemoryRouter initialEntries={[`/studio/${PKG}/interfaces`]}>
          <InterfacesPillar packageId={PKG} />
        </MemoryRouter>
      </I18nProvider>,
    );
    // objectui#12455 — a page row is named by its label and its kind tag.
    const home = await screen.findByRole('button', { name: 'Home Page' }, { timeout: 8000 });
    const rail = home.closest('nav');
    expect(rail).not.toBeNull();
    return rail as HTMLElement;
  }

  /** The running app's sidebar over the same entries. */
  function renderSidebar(): HTMLElement {
    const { container } = render(
      <MemoryRouter initialEntries={['/apps/acme_app']}>
        <SidebarProvider defaultOpen>
          <NavigationRenderer items={NAV as NavigationItem[]} basePath="/apps/acme_app" />
        </SidebarProvider>
      </MemoryRouter>,
    );
    return container;
  }

  /** The row named by `label`: a rail button, or a sidebar link. */
  const railRow = (rail: HTMLElement, label: string) =>
    within(rail).getByRole('button', { name: new RegExp(`^${label}\\b`) });
  const sidebarRow = (sidebar: HTMLElement, label: string) =>
    within(sidebar).getByRole('link', { name: new RegExp(`^${label}\\b`) });

  /**
   * The class tokens that tell each `Badge` variant apart, derived from
   * `badgeVariants` itself, so the classification follows the primitive.
   */
  const VARIANTS = ['default', 'secondary', 'destructive', 'outline'] as const;
  const tokensOf = (variant: (typeof VARIANTS)[number]) => new Set(badgeVariants({ variant }).split(/\s+/));
  const DISTINCT: Record<string, string[]> = Object.fromEntries(
    VARIANTS.map((v) => {
      const others = VARIANTS.filter((o) => o !== v).flatMap((o) => [...tokensOf(o)]);
      return [v, [...tokensOf(v)].filter((tok) => !others.includes(tok))];
    }),
  );

  /** The one `Badge` inside `row` (a `div`: neither surface draws another in a row), and its variant. */
  function badgeIn(row: HTMLElement): { text: string; variant: string } | null {
    const badges = Array.from(row.querySelectorAll('div'));
    expect(badges.length).toBeLessThanOrEqual(1);
    const badge = badges[0];
    if (!badge) return null;
    const matched = VARIANTS.filter((v) => DISTINCT[v].length > 0 && DISTINCT[v].every((tok) => badge.classList.contains(tok)));
    expect(matched).toHaveLength(1);
    return { text: badge.textContent ?? '', variant: matched[0] };
  }

  /** The drawn rules: the decorative `Separator` primitive's element. */
  const rulesIn = (el: HTMLElement) => Array.from(el.querySelectorAll<HTMLElement>('[data-orientation="horizontal"]'));

  describe('the objectui#11791 fixture is what the spec accepts', () => {
    it('every nav item, separators and badges included, parses against NavigationItemSchema', () => {
      for (const item of NAV) expect(NavigationItemSchema.safeParse(item).success).toBe(true);
    });

    it('the variant classification can tell all four variants apart', () => {
      for (const v of VARIANTS) expect(DISTINCT[v].length).toBeGreaterThan(0);
    });
  });

  describe('objectui#11791 — the rail draws a separator as the sidebar does (packages/layout/src/NavigationRenderer.tsx)', () => {
    it('a separator is a decorative rule in both, never a row, a link or an announced separator', async () => {
      const sidebar = renderSidebar();
      const sidebarRules = rulesIn(sidebar);
      // Measured on the sidebar first: one rule per separator, decorative.
      expect(sidebarRules).toHaveLength(2);
      for (const rule of sidebarRules) expect(rule).toHaveAttribute('role', 'none');
      expect(within(sidebar).queryAllByRole('separator')).toEqual([]);

      const rail = await renderRail();
      const railRules = rulesIn(rail);
      expect(railRules).toHaveLength(sidebarRules.length);
      for (const [i, rule] of railRules.entries()) {
        expect(rule.tagName).toBe(sidebarRules[i].tagName);
        expect(rule.getAttribute('role')).toBe(sidebarRules[i].getAttribute('role'));
        // Not a stop for the keyboard, and not inside a row.
        expect(rule).not.toHaveAttribute('tabindex');
        expect(rule.closest('button')).toBeNull();
      }
      expect(within(rail).queryAllByRole('separator')).toEqual([]);
    });

    it('the rail draws no unlabeled row: every button in it has a name, and only the url entry is disabled', async () => {
      const rail = await renderRail();
      const buttons = within(rail).getAllByRole('button') as HTMLButtonElement[];
      for (const button of buttons) expect(button).not.toHaveAccessibleName('');
      // The two separators drew as two more disabled, nameless buttons.
      expect(buttons.filter((b) => b.disabled)).toEqual([railRow(rail, 'Docs')]);
      // Every entry that is not a separator is still a row.
      for (const label of ['Home', 'Hours by Status', 'Tasks', 'Inbox', 'Alpha', 'Docs']) {
        expect(railRow(rail, label)).toBeInTheDocument();
      }
    });

    it('a rule is not selectable: clicking it leaves the open surface where it was', async () => {
      const rail = await renderRail();
      const caption = await waitFor(() => screen.getByTestId('if-canvas-caption'), { timeout: 8000 });
      expect(caption).toHaveTextContent('Home');
      fireEvent.click(rulesIn(rail)[0]);
      expect(screen.getByTestId('if-canvas-caption')).toHaveTextContent('Home');
    });
  });

  describe('objectui#11791 — the rail draws `badge` / `badgeVariant` as the sidebar does (packages/layout/src/NavigationRenderer.tsx)', () => {
    it('each badged entry: the same text, and the same variant the sidebar row draws', async () => {
      const sidebar = renderSidebar();
      const fromSidebar = BADGED.map(({ label }) => badgeIn(sidebarRow(sidebar, label)));
      // Measured on the sidebar first, so the comparison below can fail.
      expect(fromSidebar).toEqual(BADGED.map(({ text, variant }) => ({ text, variant })));

      const rail = await renderRail();
      expect(BADGED.map(({ label }) => badgeIn(railRow(rail, label)))).toEqual(fromSidebar);
    });

    it('control: an entry with no badge draws none on either surface', async () => {
      const sidebar = renderSidebar();
      expect(badgeIn(sidebarRow(sidebar, 'Alpha'))).toBeNull();
      expect(badgeIn(sidebarRow(sidebar, 'Home'))).toBeNull();

      const rail = await renderRail();
      expect(badgeIn(railRow(rail, 'Alpha'))).toBeNull();
      expect(badgeIn(railRow(rail, 'Home'))).toBeNull();
    });
  });
});

// ── StudioDesignSurface.interfacesRailLabelMap-11158 ─────────────────────────

/**
 * objectui#11158: the Interfaces pillar's nav rail renders a nav item whose
 * `label` is a locale map, and the open leaf's canvas caption and breadcrumb
 * print its text in the designer locale.
 *
 * The spec types a nav item's `label` as `I18nLabel`: a plain string or an
 * inline locale map. `NavTree` rendered the label raw, so a map threw
 * "Objects are not valid as a React child" and the pillar's rail was gone;
 * `resolveSurface` read `String(label)`, so the caption printed
 * `[object Object]`. Both now read the label through `navItemLabelText`, the
 * helper the canvas card and the nav-item inspector already share
 * (objectui#11128, objectui#11148), and `resolveSurface` resolves it once, so
 * the rail, the first-leaf auto-open and the `?surface=` restore carry the
 * same text.
 *
 * The pillar is the real `InterfacesPillar` over a mocked metadata client (the
 * harness of the `StudioDesignSurface.surfaceIdentity` block in this file).
 * Every nav item of the fixture parses against the spec, so each map is an input the
 * designer must handle. The plain-string item is the control in every case.
 */
describe('StudioDesignSurface.interfacesRailLabelMap-11158', () => {
  beforeEach(() => {
    studio.client = mockClient;
  });

  const PKG = 'com.acme.app';

  const NAV = [
    // The first leaf: the pillar auto-opens it when no `?surface=` is given.
    { id: 'nav_home', type: 'page', label: { en: 'Home', 'zh-CN': '首页' }, pageName: 'home' },
    {
      id: 'nav_main',
      type: 'group',
      label: { en: 'Main', 'zh-CN': '主要' },
      children: [
        // The control: a plain-string label renders as authored in any locale.
        { id: 'nav_landing', type: 'page', label: 'Landing', pageName: 'landing' },
        // Nested and not first, so only the `?surface=` restore opens it.
        { id: 'nav_reports', type: 'page', label: { en: 'Reports', 'zh-CN': '报表' }, pageName: 'reports' },
      ],
    },
    // No design surface: a disabled row whose `title` is the label.
    { id: 'nav_docs', type: 'url', label: { en: 'Docs', 'zh-CN': '文档' }, url: 'https://example.com/docs' },
  ];

  const mockClient = {
    list: vi.fn(async (type: string) => (type === 'app' ? [{ name: 'acme_app', label: 'Acme' }] : [])),
    listDrafts: vi.fn(async () => []),
    layered: vi.fn(async (type: string, name: string) => {
      if (type === 'app') return { effective: { name: 'acme_app', label: 'Acme', navigation: NAV } };
      if (type === 'page') return { effective: { name, label: name, type: 'app', regions: [{ name: 'main', components: [] }] } };
      return { effective: { name } };
    }),
    getDraft: vi.fn(async () => null),
    save: vi.fn(async () => ({})),
    get: vi.fn(async () => undefined),
  };

  type Language = 'en' | 'zh';

  let consoleError: MockInstance<typeof console.error>;

  beforeEach(() => {
    consoleError = vi.spyOn(console, 'error');
  });

  afterEach(() => {
    cleanup();
    consoleError.mockRestore();
  });

  function renderPillar(language: Language, search = '') {
    return render(
      <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }} persistLanguage={false}>
        <MemoryRouter initialEntries={[`/studio/${PKG}/interfaces${search}`]}>
          <InterfacesPillar packageId={PKG} />
        </MemoryRouter>
      </I18nProvider>,
    );
  }

  /** Every `console.error` the render logged that is React refusing a child. */
  function invalidChildErrors(): unknown[][] {
    return consoleError.mock.calls.filter((args) =>
      args.some((a) => String(a instanceof Error ? a.message : a).includes('not valid as a React child')),
    );
  }

  // objectui#12455 — every rail row carries its kind as a tag after the label,
  // so a page row is named by its label and "Page".
  const TEXT: Record<Language, { home: string; main: string; reports: string; docs: string; page: string }> = {
    en: { home: 'Home', main: 'Main', reports: 'Reports', docs: 'Docs', page: 'Page' },
    zh: { home: '首页', main: '主要', reports: '报表', docs: '文档', page: '页面' },
  };

  describe('the objectui#11158 fixture is what the spec accepts', () => {
    it('every nav item of the fixture, maps included, parses against NavigationItemSchema', () => {
      for (const item of NAV) expect(NavigationItemSchema.safeParse(item).success).toBe(true);
    });
  });

  for (const language of ['en', 'zh'] as const) {
    const text = TEXT[language];

    describe(`the Interfaces rail renders locale-map labels under ${language} (objectui#11158)`, () => {
      it('renders every row, maps as their text, the plain string as authored, with no React error', async () => {
        renderPillar(language);

        expect(await screen.findByRole('button', { name: `${text.home} ${text.page}` }, { timeout: 8000 })).toBeEnabled();
        expect(screen.getByRole('button', { name: `Landing ${text.page}` })).toBeEnabled();
        expect(screen.getByRole('button', { name: `${text.reports} ${text.page}` })).toBeEnabled();
        expect(screen.getByText(text.main)).toBeInTheDocument();
        // A row with no design surface is disabled and titled by its label.
        expect(screen.getByTitle(text.docs)).toBeDisabled();

        expect(invalidChildErrors()).toEqual([]);
        expect(document.body.textContent).not.toContain('[object Object]');
      });

      it('the first-leaf auto-open prints the map text in the canvas caption and the breadcrumb', async () => {
        renderPillar(language);

        const caption = await waitFor(() => screen.getByTestId('if-canvas-caption'), { timeout: 8000 });
        expect(caption).toHaveTextContent(text.home);
        expect(screen.getByTestId('if-breadcrumb')).toHaveTextContent(text.home);
        expect(caption.textContent).not.toContain('[object Object]');
        expect(invalidChildErrors()).toEqual([]);
      });

      it('a `?surface=` restore on a map-labelled leaf still opens it, captioned in the designer locale', async () => {
        renderPillar(language, '?surface=page:reports');

        await waitFor(() => expect(screen.getByTestId('if-canvas-caption')).toHaveTextContent(text.reports), {
          timeout: 8000,
        });
        expect(screen.getByTestId('if-breadcrumb')).toHaveTextContent(text.reports);
        expect(screen.getByTestId('if-canvas-caption')).not.toHaveTextContent(text.home);
        expect(invalidChildErrors()).toEqual([]);
      });
    });
  }
});

// ── StudioDesignSurface.interfacesAppLabelMap-11181 ──────────────────────────

/**
 * objectui#11181: the Interfaces rail heading prints an app's own `label` in
 * the designer locale when that label is a locale map.
 *
 * The spec types `AppSchema.label` as `I18nLabel`: a plain string or an inline
 * locale map. `InterfacesPillar` read it through `String()` twice, once from
 * the package's app list row and once from the loaded app body, so a map
 * printed `[object Object] · Navigation`. The pillar now holds the label as the
 * spec types it and resolves it at render through `navItemLabelText`, the
 * helper the Studio's nav readers already share (objectui#11128,
 * objectui#11148, objectui#11158), so the heading also follows a
 * designer-language switch.
 *
 * The pillar is the real `InterfacesPillar` over a mocked metadata client (the
 * harness of the `StudioDesignSurface.interfacesRailLabelMap-11158` block in this file).
 * Every app of the fixture parses against the spec, so each map is an input
 * the designer must handle. The plain-string app is the control.
 */
describe('StudioDesignSurface.interfacesAppLabelMap-11181', () => {
  beforeEach(() => {
    studio.client = mockClient;
  });

  const PKG = 'com.acme.app';

  const NAV = [{ id: 'nav_home', type: 'page', label: 'Home', pageName: 'home' }];

  const MAP_LABEL = { en: 'Acme', 'zh-CN': '顶点' };

  /** What the mocked server answers: the app list row, and the app body. */
  const state: {
    label: unknown;
    /** `false` holds the app body's read open, so only the list row is known. */
    bodyLoads: boolean;
  } = { label: MAP_LABEL, bodyLoads: true };

  const appDoc = () => ({ name: 'acme_app', label: state.label, navigation: NAV });

  const mockClient = {
    list: vi.fn(async (type: string) => (type === 'app' ? [{ name: 'acme_app', label: state.label }] : [])),
    listDrafts: vi.fn(async () => []),
    layered: vi.fn((type: string, name: string) => {
      if (type === 'app') {
        return state.bodyLoads ? Promise.resolve({ effective: appDoc() }) : new Promise<never>(() => {});
      }
      if (type === 'page') {
        return Promise.resolve({ effective: { name, label: name, type: 'app', regions: [{ name: 'main', components: [] }] } });
      }
      return Promise.resolve({ effective: { name } });
    }),
    getDraft: vi.fn(async () => null),
    save: vi.fn(async () => ({})),
    get: vi.fn(async () => undefined),
  };

  type Language = 'en' | 'zh';

  /** The provider's own language switch, handed to the case by the probe below. */
  let switchLanguage: ((lang: string) => Promise<void>) | null = null;
  function LanguageProbe() {
    const { changeLanguage } = useObjectTranslation();
    React.useEffect(() => {
      switchLanguage = changeLanguage;
    }, [changeLanguage]);
    return null;
  }

  beforeEach(() => {
    state.label = MAP_LABEL;
    state.bodyLoads = true;
    switchLanguage = null;
    for (const fn of Object.values(mockClient)) fn.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  function renderPillar(language: Language) {
    return render(
      <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }} persistLanguage={false}>
        <MemoryRouter initialEntries={[`/studio/${PKG}/interfaces`]}>
          <InterfacesPillar packageId={PKG} />
        </MemoryRouter>
        <LanguageProbe />
      </I18nProvider>,
    );
  }

  const HEADING: Record<Language, (app: string) => string> = {
    en: (app) => `${app} · Navigation`,
    zh: (app) => `${app} · 导航`,
  };

  const MAP_TEXT: Record<Language, string> = { en: 'Acme', zh: '顶点' };

  describe('the objectui#11181 fixture is what the spec accepts', () => {
    it('the map-labelled app and the plain-string app both parse against AppSchema', () => {
      for (const label of [MAP_LABEL, 'Acme']) {
        state.label = label;
        expect(AppSchema.safeParse(appDoc()).success).toBe(true);
      }
    });
  });

  for (const language of ['en', 'zh'] as const) {
    describe(`the Interfaces rail heading prints a map-labelled app under ${language} (objectui#11181)`, () => {
      it('the loaded app body: the map resolves in the designer locale, beside a string name', async () => {
        renderPillar(language);

        expect(await screen.findByText(HEADING[language](MAP_TEXT[language]), undefined, { timeout: 8000 })).toBeInTheDocument();
        // The body load settled (the first leaf auto-opened), so this is the body's label.
        await waitFor(() => expect(screen.getByTestId('if-canvas-caption')).toHaveTextContent('Home'), { timeout: 8000 });
        expect(screen.getByText(HEADING[language](MAP_TEXT[language]))).toBeInTheDocument();
        expect(document.body.textContent).not.toContain('[object Object]');
      });

      it('the app list row, while the body is still loading: the map resolves the same way', async () => {
        state.bodyLoads = false;
        renderPillar(language);

        expect(await screen.findByText(HEADING[language](MAP_TEXT[language]), undefined, { timeout: 8000 })).toBeInTheDocument();
        expect(mockClient.layered).toHaveBeenCalledWith('app', 'acme_app');
        expect(document.body.textContent).not.toContain('[object Object]');
      });

      it('the control: a plain-string label prints as authored', async () => {
        state.label = 'Acme';
        renderPillar(language);

        await waitFor(() => expect(screen.getByTestId('if-canvas-caption')).toHaveTextContent('Home'), { timeout: 8000 });
        expect(screen.getByText(HEADING[language]('Acme'))).toBeInTheDocument();
      });
    });
  }

  describe('the heading follows a designer-language switch (objectui#11181)', () => {
    it('resolves the held map again in the new locale, without reloading the app', async () => {
      renderPillar('en');

      await waitFor(() => expect(screen.getByTestId('if-canvas-caption')).toHaveTextContent('Home'), { timeout: 8000 });
      expect(screen.getByText(HEADING.en('Acme'))).toBeInTheDocument();
      const loads = mockClient.layered.mock.calls.filter(([type]) => type === 'app').length;

      expect(switchLanguage).toBeTypeOf('function');
      await act(async () => {
        await switchLanguage!('zh');
      });

      expect(await screen.findByText(HEADING.zh('顶点'))).toBeInTheDocument();
      expect(mockClient.layered.mock.calls.filter(([type]) => type === 'app').length).toBe(loads);
    });
  });
});

// ── StudioDesignSurface.railServedLabels-12688 ───────────────────────────────

/**
 * objectui#12688 — on a zh-CN session the Studio Interfaces rail draws the
 * navigation labels the server's `/meta` boundary localized, as the runtime
 * sidebar does, while every editor keeps the authored label.
 *
 * The rail drew the app's navigation from the nav editor's buffer: the app's
 * pending draft, else its `/layers` code layer. No server localizes that
 * layer, so the rail read "Capability Map" beside a sidebar reading 能力地图.
 * The pillar's app load already lists the package's apps through `/meta`,
 * which the server answers translated; the rail now draws that answer's label
 * for every entry whose authored label still equals the published one.
 *
 * The mocked client answers as objectstack does (measured against the
 * showcase): `list('app')` is the `/meta/app?package=…` row, translated for
 * the session's language; `layered('app')` is the authored English layer. The
 * pillar is the real `InterfacesPillar` (the harness of
 * the `StudioDesignSurface.interfacesRailLabelMap-11158` block in this file).
 *
 *  - zh: the rail heading, the group headings and the rows draw the served
 *    labels, and the leaf the pillar opens is captioned as its row reads;
 *  - zh: the nav editor's card and the nav-item inspector's Label input keep
 *    the authored label, so an edit can never write a served text;
 *  - zh: an entry changed in the draft, and one added there, draw their
 *    authored text beside a served sibling;
 *  - en: the served row equals the authored layer, and the rail reads as
 *    before.
 */
describe('StudioDesignSurface.railServedLabels-12688', () => {
  beforeEach(() => {
    studio.client = mockClient;
  });

  const PKG = 'com.example.showcase';

  /** The published layer, as `/layers` serves it: authored, never localized. */
  const CODE = {
    name: 'showcase_app',
    label: 'Showcase',
    navigation: [
      // The first leaf: the pillar opens it when no `?surface=` is given.
      { id: 'nav_capability_map', type: 'page', label: 'Capability Map', pageName: 'capability_map' },
      { id: 'nav_start_here', type: 'page', label: 'Page Authoring', pageName: 'start_here' },
      {
        id: 'grp_workspace',
        type: 'group',
        label: 'Workspace',
        children: [{ id: 'nav_my_work', type: 'page', label: 'My Work', pageName: 'my_work' }],
      },
    ],
  };

  /** The same app as `/meta/app?package=…` answers a zh-CN request (`translateApp`). */
  const SERVED_ZH = {
    name: 'showcase_app',
    label: '功能展示',
    navigation: [
      { id: 'nav_capability_map', type: 'page', label: '能力地图', pageName: 'capability_map' },
      { id: 'nav_start_here', type: 'page', label: '页面搭建', pageName: 'start_here' },
      {
        id: 'grp_workspace',
        type: 'group',
        label: '工作区',
        children: [{ id: 'nav_my_work', type: 'page', label: '我的工作', pageName: 'my_work' }],
      },
    ],
  };

  /** What the server answers an en-US request: the showcase's English bundle repeats the authored labels. */
  const SERVED_EN = JSON.parse(JSON.stringify(CODE)) as typeof CODE;

  const state: { served: unknown; draft: unknown } = { served: SERVED_ZH, draft: null };

  const mockClient = {
    list: vi.fn(async (type: string) => (type === 'app' ? [JSON.parse(JSON.stringify(state.served))] : [])),
    listDrafts: vi.fn(async () => []),
    layered: vi.fn(async (type: string, name: string) => {
      if (type === 'app') return { effective: JSON.parse(JSON.stringify(CODE)) };
      if (type === 'page') return { effective: { name, label: name, type: 'app', regions: [{ name: 'main', components: [] }] } };
      return { effective: { name } };
    }),
    getDraft: vi.fn(async (type: string) => (type === 'app' && state.draft ? { item: JSON.parse(JSON.stringify(state.draft)) } : null)),
    save: vi.fn(async () => ({})),
    get: vi.fn(async () => undefined),
  };

  beforeEach(() => {
    state.served = SERVED_ZH;
    state.draft = null;
    for (const fn of Object.values(mockClient)) fn.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  function renderPillar(language: 'en' | 'zh') {
    return render(
      <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }} persistLanguage={false}>
        <MemoryRouter initialEntries={[`/studio/${PKG}/interfaces`]}>
          <InterfacesPillar packageId={PKG} />
        </MemoryRouter>
      </I18nProvider>,
    );
  }

  /** Render the pillar in `language`, and return its rail once `firstRow` has rendered. */
  async function rail(language: 'en' | 'zh', firstRow: string): Promise<HTMLElement> {
    renderPillar(language);
    const el = await screen.findByTestId('studio-rail-interfaces', undefined, { timeout: 8000 });
    await within(el).findByText(firstRow, undefined, { timeout: 8000 });
    return el;
  }

  describe('the objectui#12688 fixture is what the spec accepts', () => {
    it('the authored layer, the zh-CN answer and an edited draft all parse against AppSchema', () => {
      expect(AppSchema.safeParse(CODE).success).toBe(true);
      expect(AppSchema.safeParse(SERVED_ZH).success).toBe(true);
      expect(AppSchema.safeParse(editedDraft()).success).toBe(true);
    });
  });

  describe('objectui#12688 — the zh-CN Interfaces rail draws the served navigation labels', () => {
    it('the heading, the group heading and the rows read as the server localized them', async () => {
      const el = await rail('zh', '能力地图');

      expect(el).toHaveTextContent('功能展示 · 导航');
      expect(within(el).getByText('页面搭建')).toBeInTheDocument();
      expect(within(el).getByText('工作区')).toBeInTheDocument();
      expect(within(el).getByText('我的工作')).toBeInTheDocument();
      for (const authored of ['Showcase', 'Capability Map', 'Page Authoring', 'Workspace', 'My Work']) {
        expect(el).not.toHaveTextContent(authored);
      }
    });

    it('the leaf the pillar opens is captioned with the text its row reads', async () => {
      await rail('zh', '能力地图');
      await waitFor(() => expect(screen.getByTestId('if-canvas-caption')).toHaveTextContent('能力地图'), { timeout: 8000 });
      expect(screen.getByTestId('if-breadcrumb')).toHaveTextContent('能力地图');
    });
  });

  describe('objectui#12688 — every editor keeps the authored label on the same zh-CN session', () => {
    it('the nav editor card and the nav-item inspector Label input read the authored label', async () => {
      const el = await rail('zh', '能力地图');

      fireEvent.click(within(el).getByTitle('编辑导航(拖拽排序 / 重命名 / 增删)'));
      // The edit-mode card reads the buffer: the authored label, never the served one.
      const card = await within(el).findByTitle(/^Capability Map · /, undefined, { timeout: 8000 });
      expect(within(el).queryByText('能力地图')).toBeNull();
      fireEvent.click(card);

      expect(await screen.findByDisplayValue('Capability Map', undefined, { timeout: 8000 })).toBeInTheDocument();
      expect(screen.queryByDisplayValue('能力地图')).toBeNull();
    });
  });

  /** The app's pending draft: one entry renamed, one added. */
  function editedDraft() {
    const draft = JSON.parse(JSON.stringify(CODE)) as typeof CODE & { navigation: Array<Record<string, unknown>> };
    draft.navigation[1] = { ...draft.navigation[1], label: 'Page Builder' };
    draft.navigation.push({ id: 'nav_release_notes', type: 'page', label: 'Release Notes', pageName: 'release_notes' });
    return draft;
  }

  describe('objectui#12688 — an entry changed or added in the draft draws its authored text', () => {
    it('the renamed entry and the added one read as authored, beside a served sibling', async () => {
      state.draft = editedDraft();
      const el = await rail('zh', '能力地图');

      expect(within(el).getByText('Page Builder')).toBeInTheDocument();
      expect(within(el).getByText('Release Notes')).toBeInTheDocument();
      expect(within(el).queryByText('页面搭建')).toBeNull();
      // The unchanged group keeps its served heading.
      expect(within(el).getByText('工作区')).toBeInTheDocument();
    });
  });

  describe('objectui#12688 — an English session reads as before', () => {
    it('the en-US answer repeats the authored labels, and the rail draws them unchanged', async () => {
      state.served = SERVED_EN;
      const el = await rail('en', 'Capability Map');

      expect(el).toHaveTextContent('Showcase · Navigation');
      for (const authored of ['Page Authoring', 'Workspace', 'My Work']) {
        expect(within(el).getByText(authored)).toBeInTheDocument();
      }
      await waitFor(() => expect(screen.getByTestId('if-canvas-caption')).toHaveTextContent('Capability Map'), { timeout: 8000 });
    });
  });
});

// ── StudioDesignSurface.zhPillarNames-11801 ──────────────────────────────────

/**
 * objectui#11801, item 1 — zh-CN names a Studio pillar by the label its tab
 * shows, never by a literal translation of the internal word "pillar" and
 * never by the English tab name.
 *
 * ## What was broken
 *
 * The pillar tab bar renders `t('engine.studio.pillar.<key>', locale)`, which
 * in zh-CN reads 数据 / 自动化 / 界面 / 权限. Two Studio hints named a pillar
 * otherwise: the nav-item inspector's "no objects" line read
 * 「先到 Data 支柱创建」, and the Interfaces pillar's object-leaf hint read
 * 「改字段 / 结构请到 Data 支柱」. 支柱 is a literal rendering of the code word
 * "pillar" that no tab shows, and "Data" is the English tab name. In the
 * second hint "Data" was not in the string table at all: it was a literal
 * `<span>` between the two translated halves, so it read English in every
 * locale whatever the table said.
 *
 * ## The three pins
 *
 * 1. No zh value in the designer string tables contains 支柱. Read through
 *    the extractor `check:i18n-designer-parity` reads with
 *    (`readDesignerPairs`), so the population is the whole table rather than
 *    a list of keys this block would have to keep. Its lit control: the
 *    extractor's zh value for `engine.studio.pillar.data` must be the one
 *    `t()` serves, so an extractor that read nothing cannot pass for "no 支柱".
 * 2. The "no objects" line names the Data pillar by its zh tab label.
 * 3. The object-leaf hint, rendered in zh-CN, names the Data pillar by its zh
 *    tab label and holds no English "Data"; rendered in en-US it is unchanged.
 *
 * ## Why the render pin mounts the pillar rather than composing three `t()`s
 *
 * Composing `pre + label + post` in the test would pass with the literal
 * `<span>Data</span>` still in the component, because the test would be
 * supplying the label the component did not. Only a render reads what the
 * component actually puts between the halves.
 */
describe('StudioDesignSurface.zhPillarNames-11801', () => {
  beforeEach(() => {
    studio.client = mockClient;
  });

  /** Local annotation, since the import above is untyped — the call site stays checked. */
  const readTables: (root: string) => Map<string, Map<string, string>> = readDesignerPairs;

  const objectDef = {
    name: 'showcase_task',
    label: 'Task',
    fields: [{ name: 'title', label: 'Title', type: 'text' }],
  };

  const NAV = [{ id: 'nav_obj', type: 'object', label: 'Tasks', objectName: 'showcase_task' }];

  const mockClient = {
    save: vi.fn(async () => ({})),
    list: vi.fn(async (type: string) => {
      if (type === 'app') return [{ name: 'acme_app', label: 'Acme' }];
      if (type === 'object') return [{ name: 'showcase_task', label: 'Task' }];
      return [];
    }),
    listDrafts: vi.fn(async () => []),
    layered: vi.fn(async (type: string, name: string) => {
      if (type === 'app') return { effective: { name: 'acme_app', label: 'Acme', navigation: NAV } };
      if (type === 'object') return { effective: objectDef, code: objectDef };
      return { effective: { name } };
    }),
    getDraft: vi.fn(async () => null),
    get: vi.fn(async () => undefined),
    withPreviewDrafts() { return this; },
  };

  afterEach(cleanup);

  const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');

  const ZH_DATA = t('engine.studio.pillar.data', 'zh-CN');

  describe('zh-CN names a pillar by its tab label (objectui#11801)', () => {
    it('no zh value in the designer string tables says 支柱', () => {
      const tables = readTables(REPO_ROOT);
      const zh = tables.get('ENGINE_STRINGS_ZH');
      // Lit control: the extractor reads the table `t()` serves.
      expect(zh?.get('engine.studio.pillar.data')).toBe(ZH_DATA);
      expect(ZH_DATA).toBe('数据');

      const offenders: string[] = [];
      for (const [name, table] of tables) {
        if (!name.endsWith('_ZH')) continue;
        for (const [key, value] of table) if (value.includes('支柱')) offenders.push(`${name} ${key}`);
      }
      expect(offenders).toEqual([]);
    });

    it('the "no objects" hint names the Data pillar by its zh tab label', () => {
      const zh = t('engine.studio.nav.noObjects', 'zh-CN');
      expect(zh).toContain(`「${ZH_DATA}」`);
      expect(zh).not.toMatch(/\bData\b/);
    });
  });

  function mountPillar(language: 'en' | 'zh') {
    return render(
      <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
        <MemoryRouter initialEntries={['/studio/com.acme.app/interfaces']}>
          <InterfacesPillar packageId="com.acme.app" />
        </MemoryRouter>
      </I18nProvider>,
    );
  }

  /** The hint paragraph under the canvas, found by the words it opens with in either locale. */
  const hintText = () =>
    Array.from(document.querySelectorAll('p'))
      .map((p) => (p.textContent ?? '').replace(/\s+/g, ' ').trim())
      .find((text) => text.startsWith('运行态列表预览') || text.startsWith('Runtime list preview')) ?? '';

  describe('the Interfaces object-leaf hint names the Data pillar by its tab label (objectui#11801)', () => {
    it('reads the zh tab label, and no English "Data", under zh-CN', async () => {
      expect(listStudioCanvasPreviewTypes()).toContain('object');
      mountPillar('zh');
      fireEvent.click(await screen.findByTitle('object · showcase_task'));
      await waitFor(() => expect(hintText()).toContain('运行态列表预览'), { timeout: 4000 });
      expect(hintText()).toBe(`运行态列表预览 · 改字段 / 结构请到「${ZH_DATA}」`);
      expect(hintText()).not.toMatch(/\bData\b|支柱/);
    });

    it('is unchanged under en-US', async () => {
      mountPillar('en');
      fireEvent.click(await screen.findByTitle('object · showcase_task'));
      await waitFor(() => expect(hintText()).toContain('Runtime list preview'), { timeout: 4000 });
      expect(hintText()).toBe('Runtime list preview · edit fields / structure in the Data pillar');
    });
  });
});

// ── StudioDesignSurface.navEntryIdentity-11774 ───────────────────────────────

/**
 * objectui#11774 — the Interfaces rail's surface is the nav ENTRY, not its
 * target.
 *
 * The showcase app's nav holds five entries on one object, `showcase_task`:
 * the plain list, three data slices (`filters`) and one named view
 * (`viewName`). The pillar identified a surface by `{type, name}` alone, so
 * for the filer, clicking *Urgent Tasks* previewed every task (Low and Medium
 * included), highlighted all five rows, and a reload landed on *Tasks*.
 *
 * These pins mount the real `InterfacesPillar` over a mocked metadata client
 * and keep the DEFAULT object canvas, so what is asserted is the schema that
 * canvas hands the list renderer: `object-view` is replaced by a recorder.
 * Each pin is one of the claim's acceptance points; the last is the control,
 * an app whose entries each open a distinct object.
 */
describe('StudioDesignSurface.navEntryIdentity-11774', () => {
  beforeEach(() => {
    studio.client = mockClient;
  });

  const PKG = 'com.example.showcase';

  /** The showcase nav, abridged to the entries on `showcase_task` and a first leaf ahead of them. */
  const SHOWCASE_NAV = [
    { id: 'nav_home', type: 'page', pageName: 'home', label: 'Home' },
    {
      id: 'grp_data',
      type: 'group',
      label: 'Data Model',
      children: [{ id: 'nav_tasks', type: 'object', objectName: 'showcase_task', label: 'Tasks' }],
    },
    {
      id: 'grp_slices',
      type: 'group',
      label: 'Data Slices (filters)',
      children: [
        { id: 'nav_slice_in_progress', type: 'object', objectName: 'showcase_task', filters: { status: 'in_progress' }, label: 'In-Progress Tasks' },
        { id: 'nav_slice_urgent', type: 'object', objectName: 'showcase_task', filters: { priority: 'urgent' }, label: 'Urgent Tasks' },
        { id: 'nav_slice_review', type: 'object', objectName: 'showcase_task', filters: { status: 'in_review' }, label: 'In-Review Tasks' },
      ],
    },
    {
      id: 'grp_analytics',
      type: 'group',
      label: 'Analytics',
      children: [{ id: 'nav_report_tabular', type: 'object', objectName: 'showcase_task', viewName: 'tabular', label: 'Task List' }],
    },
  ];

  /** The control: every entry opens a distinct object. */
  const DISTINCT_NAV = [
    { id: 'nav_projects', type: 'object', objectName: 'showcase_project', label: 'Projects' },
    { id: 'nav_tasks', type: 'object', objectName: 'showcase_task', label: 'Tasks' },
    { id: 'nav_accounts', type: 'object', objectName: 'showcase_account', label: 'Accounts' },
  ];

  let nav: unknown[] = SHOWCASE_NAV;

  const mockClient = {
    list: vi.fn(async (type: string) => (type === 'app' ? [{ name: 'showcase_app', label: 'Showcase' }] : [])),
    listDrafts: vi.fn(async () => []),
    layered: vi.fn(async (type: string, name: string) => {
      if (type === 'app') return { effective: { name: 'showcase_app', label: 'Showcase', navigation: nav } };
      if (type === 'page') return { effective: { name, label: name, type: 'app', regions: [{ name: 'main', components: [] }] } };
      return { effective: { name, label: name } };
    }),
    getDraft: vi.fn(async () => null),
    save: vi.fn(async () => ({})),
    get: vi.fn(async () => undefined),
    withPreviewDrafts() { return this; },
  };

  /** The object's merged `listViews`, as the shell's metadata cache holds them. */
  const TABULAR = {
    name: 'showcase_task.tabular',
    label: 'Task List',
    type: 'grid',
    columns: [{ field: 'title' }, { field: 'status' }],
    sort: [{ field: 'estimate_hours', order: 'desc' }],
  };
  const METADATA: MetadataContextValue = {
    apps: [],
    objects: [{ name: 'showcase_task', label: 'Task', listViews: { 'showcase_task.tabular': TABULAR } }],
    dashboards: [],
    reports: [],
    pages: [],
    loading: false,
    error: null,
    refresh: async () => {},
    invalidate: () => {},
    ensureType: async () => [],
    getItem: async () => null,
    getItemsByType: () => [],
  };

  /** Stands in for `plugin-view`'s `object-view`: records the schema the canvas hands it. */
  function ObjectViewRecorder({ schema }: { schema: Record<string, unknown> }) {
    return <pre data-testid="object-view-schema">{JSON.stringify(schema)}</pre>;
  }

  function LocationProbe() {
    const location = useLocation();
    return <output data-testid="location-search">{location.search}</output>;
  }

  beforeAll(() => {
    ComponentRegistry.register('object-view', ObjectViewRecorder as never, { namespace: 'plugin-view' });
  });

  afterEach(() => {
    cleanup();
    nav = SHOWCASE_NAV;
  });

  function mountPillar(search = '') {
    return render(
      <MetadataCtx.Provider value={METADATA}>
        <MemoryRouter initialEntries={[`/studio/${PKG}/interfaces${search}`]}>
          <InterfacesPillar packageId={PKG} />
          <LocationProbe />
        </MemoryRouter>
      </MetadataCtx.Provider>,
    );
  }

  /** Every rail row that opens a surface (its `title` is the `type · name` pair). */
  function railRows(): HTMLElement[] {
    return screen.getAllByRole('button').filter((b) => /^(object|page) · /.test(b.getAttribute('title') ?? ''));
  }

  /** The rail row whose label is `label`, exactly. */
  function railRow(label: string): HTMLElement {
    const row = railRows().find((r) => within(r).queryByText(label, { exact: true }) !== null);
    if (!row) throw new Error(`no rail row labelled ${label}`);
    return row;
  }

  /** The labels of the rows the rail shows as active. */
  function activeLabels(): string[] {
    return railRows()
      .filter((r) => r.className.includes('font-medium'))
      .map((r) => r.querySelector('.truncate')?.textContent ?? '');
  }

  function canvasSchema(): unknown {
    return JSON.parse(screen.getByTestId('object-view-schema').textContent ?? 'null');
  }

  const search = () => new URLSearchParams(screen.getByTestId('location-search').textContent ?? '');

  const PLAIN = { type: 'object-view', objectName: 'showcase_task' };
  const sliced = (field: string, value: string) => ({ ...PLAIN, table: { filter: [[field, '=', value]] } });

  /** Each `showcase_task` entry and the schema its preview must hand the list renderer. */
  const ENTRIES: Array<{ label: string; navId: string; schema: unknown }> = [
    { label: 'Tasks', navId: 'nav_tasks', schema: PLAIN },
    { label: 'In-Progress Tasks', navId: 'nav_slice_in_progress', schema: sliced('status', 'in_progress') },
    { label: 'Urgent Tasks', navId: 'nav_slice_urgent', schema: sliced('priority', 'urgent') },
    { label: 'In-Review Tasks', navId: 'nav_slice_review', schema: sliced('status', 'in_review') },
    {
      label: 'Task List',
      navId: 'nav_report_tabular',
      schema: { ...PLAIN, listViews: { 'showcase_task.tabular': TABULAR }, defaultListView: 'showcase_task.tabular' },
    },
  ];

  describe('the objectui#11774 fixtures are what the spec accepts', () => {
    it('every nav item of both apps parses against NavigationItemSchema', () => {
      for (const item of [...SHOWCASE_NAV, ...DISTINCT_NAV]) {
        expect(NavigationItemSchema.safeParse(item).success).toBe(true);
      }
    });
  });

  describe('Interfaces rail — one object, five entries (objectui#11774)', () => {
    it('clicking each entry makes exactly that entry active, and the preview gets its slice or view', async () => {
      mountPillar();
      await waitFor(() => expect(activeLabels()).toEqual(['Home']), { timeout: 4000 });
      for (const entry of ENTRIES) {
        fireEvent.click(railRow(entry.label));
        await waitFor(() => expect(activeLabels()).toEqual([entry.label]), { timeout: 4000 });
        await waitFor(() => expect(canvasSchema()).toEqual(entry.schema), { timeout: 4000 });
        expect(search().get('nav')).toBe(entry.navId);
      }
    });

    it('the deep link round-trips: Urgent Tasks, read back from the URL, is the entry that opens', async () => {
      mountPillar();
      await waitFor(() => expect(activeLabels()).toEqual(['Home']), { timeout: 4000 });
      fireEvent.click(railRow('Urgent Tasks'));
      await waitFor(() => expect(search().get('nav')).toBe('nav_slice_urgent'), { timeout: 4000 });
      expect(search().get('surface')).toBe('object:showcase_task');
      const link = `?${search().toString()}`;
      cleanup();

      mountPillar(link);
      await waitFor(() => expect(activeLabels()).toEqual(['Urgent Tasks']), { timeout: 4000 });
      await waitFor(() => expect(canvasSchema()).toEqual(sliced('priority', 'urgent')), { timeout: 4000 });
    });

    it('BACK-COMPAT: a `?surface=object:showcase_task` link with no entry id opens the first match, as before', async () => {
      mountPillar('?surface=object:showcase_task');
      await waitFor(() => expect(activeLabels()).toEqual(['Tasks']), { timeout: 4000 });
      await waitFor(() => expect(canvasSchema()).toEqual(PLAIN), { timeout: 4000 });
    });

    it('an entry id that no longer exists falls back exactly as the same link without it', async () => {
      mountPillar('?surface=object:showcase_task&nav=nav_deleted');
      await waitFor(() => expect(activeLabels()).toEqual(['Tasks']), { timeout: 4000 });
      // The URL heals to the entry that opened.
      await waitFor(() => expect(search().get('nav')).toBe('nav_tasks'), { timeout: 4000 });
      cleanup();

      // An unknown target as well: the pillar opens its first leaf, as it does for the bare link.
      mountPillar('?surface=object:deleted_object&nav=nav_deleted');
      await waitFor(() => expect(activeLabels()).toEqual(['Home']), { timeout: 4000 });
      cleanup();
      mountPillar('?surface=object:deleted_object');
      await waitFor(() => expect(activeLabels()).toEqual(['Home']), { timeout: 4000 });
    });
  });

  describe('Interfaces rail — CONTROL: entries on distinct objects (objectui#11774)', () => {
    it('one row active per click, the plain list of that object, and a `?surface=` link opens its entry', async () => {
      nav = DISTINCT_NAV;
      mountPillar();
      await waitFor(() => expect(activeLabels()).toEqual(['Projects']), { timeout: 4000 });
      for (const [label, objectName] of [
        ['Tasks', 'showcase_task'],
        ['Accounts', 'showcase_account'],
        ['Projects', 'showcase_project'],
      ]) {
        fireEvent.click(railRow(label));
        await waitFor(() => expect(activeLabels()).toEqual([label]), { timeout: 4000 });
        await waitFor(() => expect(canvasSchema()).toEqual({ type: 'object-view', objectName }), { timeout: 4000 });
        expect(search().get('surface')).toBe(`object:${objectName}`);
      }
      cleanup();

      mountPillar('?surface=object:showcase_account');
      await waitFor(() => expect(activeLabels()).toEqual(['Accounts']), { timeout: 4000 });
    });
  });
});
