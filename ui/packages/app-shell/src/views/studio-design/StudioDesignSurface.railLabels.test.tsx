// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Interfaces rail and its labels: pins that render the real
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
 * Isolation between blocks: React Testing Library's `cleanup()` runs after
 * every test (each block registers it, and so does the `dom` setup), and
 * react-i18next's global instance is put back after every test
 * (`vitest.setup.i18n-global.ts`). No block registers into a metadata or
 * component registry.
 *
 * A new pin that renders `InterfacesPillar` over this harness, and registers
 * nothing in a metadata or component registry, joins this file as its own
 * `describe`.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { NavigationItemSchema } from '@objectstack/spec/ui';
import { I18nProvider } from '@object-ui/i18n';
import { MetadataCtx } from '@object-ui/react';
import { SidebarProvider, badgeVariants } from '@object-ui/components';
import { NavigationRenderer } from '@object-ui/layout';
import type { NavigationItem } from '@object-ui/types';

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
      return screen.getByRole('textbox') as HTMLInputElement;
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
