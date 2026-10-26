/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6661 — a page that declares `app:launcher` or `nav:menu` renders a
 * WORKING block, not the "Component Placeholder" scaffold.
 *
 * Phase 1 of the 2026-08-26 maintainer ruling on objectstack#12183. The sibling
 * file `global-page-blocks.render.test.tsx` is the Phase 2 (objectui#6757)
 * equivalent and this one deliberately follows its shape.
 *
 * ## Why "not the placeholder" is not the assertion
 *
 * An empty render is also not the placeholder, and so is a red unknown-type
 * panel with the wrong text. Each case below therefore asserts CONTENT that
 * only the real renderer can produce, and content that had to travel through
 * the block's data path to get there:
 *
 *   - `app:launcher` — a tile per app the metadata app REGISTRY holds, with the
 *     registry's own `active`/`hidden` filter applied (the deactivated and the
 *     hidden app are absent), and clicking one routes to that app's segment.
 *   - `nav:menu` — the active app's navigation tree, with each item's href
 *     resolved by `@object-ui/layout`'s `resolveHref` (so a `viewName` entry
 *     lands on `/view/<name>`, not on the bare list), and with the three
 *     item-level guards applied: `visible`, `requiredPermissions` and the
 *     `requiresObject` runtime-capability gate.
 *
 * The placeholder assertion is kept as a second, weaker line in each case,
 * because it is the literal symptom the card reported.
 *
 * ## The two members are NOT symmetric before the fix — measured, not assumed
 *
 * `placeholders.tsx` puts `nav:menu` in `PALETTE_PLACEHOLDER_BLOCKS` (registered
 * EAGERLY on import of `@object-ui/components`) but `app:launcher` only in
 * `PROTOCOL_COMPONENTS` (registered solely when a host opts in via
 * `registerPlaceholders()`, which only `apps/console` does). So before this
 * change, in THIS harness, `nav:menu` drew the dashed scaffold and
 * `app:launcher` drew `SchemaRenderer`'s red unknown-type panel — the same
 * asymmetry `global:search` / `global:notifications` had in the Phase 2 file.
 * Both failure texts are asserted absent below so either regression is caught.
 *
 * ## Ablation (per member)
 *
 * Comment out the `ComponentRegistry.register(...)` call in the renderer under
 * test and the matching case goes red: `nav:menu` falls back to the eager
 * palette placeholder ("Component Placeholder"), `app:launcher` to the red
 * unknown-type panel.
 *
 * ## Harness notes
 *
 * Real `@object-ui/components`, real `SchemaRenderer`, real registry — the
 * ORDER this file's imports produce is the production order (app-shell depends
 * on components, so `placeholders.tsx` registers before these two overwrite
 * it), and asserting through `SchemaRenderer` is what makes this a page-render
 * test rather than a component unit test.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

// Module scope, never a `beforeAll`: the cold transform of these graphs is
// billed to the import phase, which has no test/hook timeout (AGENTS.md
// §测试纪律, objectui#3010).
import '@object-ui/components';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRenderer, MetadataCtx } from '@object-ui/react';
import '../app-launcher-renderer';
import '../nav-menu-renderer';

/* ── Fixtures ─────────────────────────────────────────────────────────────── */

/**
 * The app registry, in the shape `MetadataProvider` publishes it (it fetches
 * `GET /api/v1/meta/app` eagerly — `EAGER_TYPES`). Two openable apps, one
 * deactivated and one hidden: the launcher must show exactly the first two.
 */
const APPS = [
  {
    name: 'crm',
    label: 'CRM',
    icon: 'Building2',
    navigation: [
      { id: 'accounts', type: 'object', label: 'Accounts', objectName: 'crm_account', icon: 'Building2' },
      { id: 'pipeline', type: 'object', label: 'Pipeline', objectName: 'crm_deal', viewName: 'kanban' },
      { id: 'handbook', type: 'url', label: 'Handbook', url: 'https://example.com/handbook', target: '_blank' },
      {
        id: 'insights',
        type: 'group',
        label: 'Insights',
        children: [{ id: 'win_rate', type: 'report', label: 'Win rate', reportName: 'win_rate' }],
      },
      // Guard 1 — `visible: false` is honoured by the expression evaluator.
      { id: 'draft_area', type: 'object', label: 'Draft area', objectName: 'crm_account', visible: false },
      // Guard 2 — `requiresObject` names an object the runtime has not
      // registered, so the runtime-capability gate drops it.
      {
        id: 'billing',
        type: 'object',
        label: 'Billing',
        objectName: 'sys_invoice',
        requiresObject: 'sys_invoice',
      },
      { id: 'divider_1', type: 'separator' },
    ],
  },
  { name: 'ops', label: 'Operations', icon: 'Wrench', navigation: [] },
  { name: 'legacy_hr', label: 'Legacy HR', active: false, navigation: [] },
  { name: 'account', label: 'Account', hidden: true, navigation: [] },
];

/**
 * Stable module-level value: `MetadataCtx` consumers list the context value in
 * effect deps, and a fresh object per render re-runs them forever.
 *
 * `objects` is what the runtime-capability gate probes. `sys_invoice` is
 * deliberately absent so the `requiresObject` guard has something to do — and
 * the set is non-empty, which is what takes the "metadata still loading, show
 * everything" short-circuit out of the picture.
 */
const METADATA = {
  apps: APPS,
  objects: [
    { name: 'crm_account', label: 'Account', icon: 'Building2' },
    { name: 'crm_deal', label: 'Deal', icon: 'Handshake' },
  ],
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
  getTypeStatus: () => 'ready' as const,
};

/** Publishes the current pathname so a click-through can be asserted. */
function LocationProbe() {
  const { pathname } = useLocation();
  return <div data-testid="pathname">{pathname}</div>;
}

/** A page that DECLARES the member, rendered through the normal recursion. */
const page = (type: string) => ({
  type: 'page:section',
  id: 'section_1',
  children: [{ type, id: `blk_${type}` }],
});

function renderPage(type: string) {
  return render(
    <MemoryRouter initialEntries={['/apps/crm']}>
      <MetadataCtx.Provider value={METADATA as never}>
        <LocationProbe />
        <Routes>
          <Route
            path="/apps/:appName"
            element={<SchemaRenderer schema={page(type) as never} />}
          />
          <Route path="*" element={<div>navigated away</div>} />
        </Routes>
      </MetadataCtx.Provider>
    </MemoryRouter>,
  );
}

/* ── The two members ──────────────────────────────────────────────────────── */

describe('objectui#6661 — spec `PageComponentType` members that had no renderer', () => {
  it('registers both members under their namespaces, not the bare names', () => {
    // A registration under bare `launcher` / `menu` would claim two far more
    // generic tags; `skipFallback: true` is what prevents it.
    expect(ComponentRegistry.get('app:launcher')).toBeTruthy();
    expect(ComponentRegistry.get('nav:menu')).toBeTruthy();
    expect(ComponentRegistry.get('launcher')).toBeFalsy();
    expect(ComponentRegistry.get('menu')).toBeFalsy();
  });

  it('overwrites the protocol placeholder rather than sitting behind it', () => {
    // `registerPlaceholder` refuses to overwrite a real implementation, and the
    // eager `PALETTE_PLACEHOLDER_BLOCKS` pass for `nav:menu` runs FIRST (this
    // file imports `@object-ui/components` above). So the namespace on the live
    // registration is the proof that the real renderer won the key.
    expect(ComponentRegistry.getConfig('app:launcher')?.namespace).toBe('app');
    expect(ComponentRegistry.getConfig('nav:menu')?.namespace).toBe('nav');
  });

  it('publishes NO `inputs` for either — both spec shapes are empty', () => {
    // `ComponentPropsMap['app:launcher'|'nav:menu']` declare no props at all.
    // Declaring one here would advertise an authoring key the contract rejects
    // by name (the forward direction of
    // `apps/console/src/__tests__/registry-inputs-spec-parity.test.ts`).
    expect(ComponentRegistry.getConfig('app:launcher')?.inputs ?? []).toEqual([]);
    expect(ComponentRegistry.getConfig('nav:menu')?.inputs ?? []).toEqual([]);
  });

  describe('app:launcher', () => {
    it('renders a tile per openable app from the metadata app registry', () => {
      renderPage('app:launcher');

      // 1. Real content: the launcher grid, with a tile per app.
      const launcher = screen.getByRole('navigation', { name: 'App launcher' });
      expect(within(launcher).getByTestId('app-tile-crm')).toBeInTheDocument();
      expect(within(launcher).getByTestId('app-tile-ops')).toBeInTheDocument();
      expect(within(launcher).getByText('CRM')).toBeInTheDocument();
      expect(within(launcher).getByText('Operations')).toBeInTheDocument();

      // 2. Real content that had to travel the data path: the registry's own
      //    `active`/`hidden` filter was applied to the list it read. A static
      //    or unfiltered render would show these two.
      expect(screen.queryByTestId('app-tile-legacy_hr')).toBeNull();
      expect(screen.queryByTestId('app-tile-account')).toBeNull();

      // 3. The literal symptom the card reported, plus the OTHER failure shape:
      //    `app:launcher` is NOT in the eager placeholder set, so with no
      //    registration at all it draws SchemaRenderer's red unknown-type panel.
      expect(screen.queryByText('Component Placeholder')).toBeNull();
      expect(screen.queryByText(/Unknown component type/i)).toBeNull();
    });

    it('opens the app it was clicked on, by route segment', () => {
      renderPage('app:launcher');

      expect(screen.getByTestId('pathname')).toHaveTextContent('/apps/crm');
      // objectui#12305 — the tile is a link to that segment, so it can also be
      // opened in a new tab or copied; a plain click still navigates in place.
      expect(screen.getByRole('link', { name: 'Operations' })).toHaveAttribute('href', '/apps/ops');
      fireEvent.click(screen.getByTestId('app-tile-ops'));
      expect(screen.getByTestId('pathname')).toHaveTextContent('/apps/ops');
    });
  });

  describe('nav:menu', () => {
    it('renders the active app’s navigation tree with hrefs from `resolveHref`', () => {
      renderPage('nav:menu');

      // 1. Real content: the menu itself, with its accessible name.
      const menu = screen.getByRole('navigation', { name: 'App navigation' });
      expect(menu).toBeInTheDocument();

      // 2. Real content that had to travel the data path: the items are the
      //    ACTIVE app's own navigation, and each href is what
      //    `@object-ui/layout`'s `resolveHref` produces for that item type —
      //    note `/view/kanban`, which only the shared resolver produces.
      expect(within(menu).getByRole('link', { name: 'Accounts' })).toHaveAttribute(
        'href',
        '/apps/crm/crm_account',
      );
      expect(within(menu).getByRole('link', { name: 'Pipeline' })).toHaveAttribute(
        'href',
        '/apps/crm/crm_deal/view/kanban',
      );
      expect(within(menu).getByRole('link', { name: 'Win rate' })).toHaveAttribute(
        'href',
        '/apps/crm/report/win_rate',
      );
      // A `url` item keeps its absolute target and opens out of the SPA.
      const handbook = within(menu).getByRole('link', { name: 'Handbook' });
      expect(handbook).toHaveAttribute('href', 'https://example.com/handbook');
      expect(handbook).toHaveAttribute('target', '_blank');
      // Group labels render, so the tree is a tree and not a flattened list.
      expect(within(menu).getByText('Insights')).toBeInTheDocument();

      // 3. The item-level guards ran. Both entries are in the tree above and
      //    both are gated away — the `visible` expression and the
      //    `requiresObject` runtime-capability probe respectively.
      expect(screen.queryByText('Draft area')).toBeNull();
      expect(screen.queryByText('Billing')).toBeNull();

      // 4. The literal symptom the card reported. `nav:menu` IS in the eager
      //    placeholder set, so this is the text it drew before the fix.
      expect(screen.queryByText('Component Placeholder')).toBeNull();
      expect(screen.queryByText(/Unknown component type/i)).toBeNull();
    });

    it('navigates in-app when a navigation item is clicked', () => {
      renderPage('nav:menu');

      expect(screen.getByTestId('pathname')).toHaveTextContent('/apps/crm');
      fireEvent.click(screen.getByRole('link', { name: 'Accounts' }));
      expect(screen.getByTestId('pathname')).toHaveTextContent('/apps/crm/crm_account');
    });
  });
});
