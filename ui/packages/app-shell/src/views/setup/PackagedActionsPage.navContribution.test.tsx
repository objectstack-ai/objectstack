// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `automation:packaged-actions` — the component-registry key the Setup
 * navigation names for the Packaged actions page (ADR-0126 §7.4; objectstack
 * ADR-0146 D4 keeps the action switch in Setup), and the retired
 * `automation:packaged` key it replaced (D11).
 *
 * The page is reached the way every other framework-contributed Setup surface
 * is: app navigation names a REGISTRY KEY, and `ComponentNavView` resolves it.
 * Three properties, in the order a nav item exercises them:
 *
 *   1. the key is registered at all — by importing the registration module the
 *      way `index.ts` does, as a side effect, so what is measured is the
 *      production registration and not a re-creation of it;
 *   2. the key addresses `component/automation/packaged-actions`, so the URL a
 *      sidebar builds and the key the framework's metadata declares cannot
 *      drift apart. The URL below is BUILT from the ref through the same
 *      helper `AppContent` uses rather than spelled out;
 *   3. the page actually mounts through that route.
 *
 * The framework half (the `nav_packaged_actions` entry naming this key) is
 * pinned in platform-objects' `setup-packaged-actions-nav.test.ts`.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

// Side effect: the production registration, imported the way `index.ts` does.
import '../../services/builtinComponents.js';
import {
  componentRefToUrlSegments,
  getAppComponent,
} from '../../services/componentRegistry.js';
import { ComponentNavView } from '../ComponentNavView.js';

const REF = 'automation:packaged-actions';

beforeEach(() => {
  // The section loads its lists on mount. Empty answers are enough: what this
  // file measures is that the route resolves to the page at all.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ success: true, data: [] }) }) as unknown as Response),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the packaged-actions Setup nav contribution', () => {
  it('registers the ref, owned by app-shell', () => {
    const entry = getAppComponent(REF);
    expect(entry).toBeDefined();
    expect(entry?.source).toBe('@object-ui/app-shell');
  });

  it('addresses component/automation/packaged-actions', () => {
    expect(componentRefToUrlSegments(REF)).toEqual(['automation', 'packaged-actions']);
  });

  it('mounts the page through the component route the ref builds, under one heading', async () => {
    const url = `/apps/setup/component/${componentRefToUrlSegments(REF).join('/')}`;

    render(
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/apps/:appName/component/:ns/:name/*" element={<ComponentNavView />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Packaged actions' })).toBeInTheDocument();
    // The page header names the page; the section does not name it twice.
    expect(screen.getAllByRole('heading', { name: 'Packaged actions' })).toHaveLength(1);
    expect(await screen.findByTestId('packaged-actions-section')).toBeInTheDocument();
    // The "Component not registered" empty state is what an unresolved ref
    // renders; its absence is the other half of the assertion above.
    expect(screen.queryByText('Component not registered')).toBeNull();
  });

  it('the retired `automation:packaged` key resolves to nothing (ADR-0146 D11)', () => {
    expect(getAppComponent('automation:packaged')).toBeUndefined();
  });
});
