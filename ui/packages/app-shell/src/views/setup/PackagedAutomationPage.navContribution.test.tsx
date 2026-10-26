// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `automation:packaged` — the component-registry key the Setup navigation
 * names for the packaged-automation page (ADR-0126 §7.4).
 *
 * The page is reached the way every other framework-contributed Setup surface
 * is: app navigation names a REGISTRY KEY, and `ComponentNavView` resolves it.
 * Three properties, in the order a nav item exercises them:
 *
 *   1. the key is registered at all — by importing the registration module the
 *      way `index.ts` does, as a side effect, so what is measured is the
 *      production registration and not a re-creation of it;
 *   2. `automation:packaged` addresses `component/automation/packaged`, so the
 *      URL a sidebar builds and the key the framework's metadata declares
 *      cannot drift apart. The URL below is BUILT from the ref through the same
 *      helper `AppContent` uses rather than spelled out, so a change to either
 *      moves both;
 *   3. the page actually mounts through that route.
 *
 * ⛔ No bespoke `<Route>` is added for this page, and none is asserted here: a
 * second way in is a URL the app metadata does not know about, and the Setup
 * nav contribution is the mechanism the card asks for.
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

const REF = 'automation:packaged';

beforeEach(() => {
  // The page loads its two lists on mount. Empty answers are enough: what this
  // file measures is that the route resolves to the page at all.
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.endsWith('/meta/flow') ? { items: [] } : { success: true, data: { flows: [] } };
      return { ok: true, status: 200, json: async () => body } as unknown as Response;
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the packaged-automation Setup nav contribution', () => {
  it('registers the ref, owned by app-shell', () => {
    const entry = getAppComponent(REF);
    expect(entry).toBeDefined();
    expect(entry?.source).toBe('@object-ui/app-shell');
  });

  it('addresses component/automation/packaged', () => {
    expect(componentRefToUrlSegments(REF)).toEqual(['automation', 'packaged']);
  });

  it('mounts the page through the component route the ref builds', async () => {
    const url = `/apps/setup/component/${componentRefToUrlSegments(REF).join('/')}`;

    render(
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/apps/:appName/component/:ns/:name/*" element={<ComponentNavView />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Packaged automation' })).toBeInTheDocument();
    // The "Component not registered" empty state is what an unresolved ref
    // renders; its absence is the other half of the assertion above.
    expect(screen.queryByText('Component not registered')).toBeNull();
  });
});
