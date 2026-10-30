// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `automation:connector-credentials` — the component-registry key the Setup
 * entry contributed by `@objectstack/service-automation` names (ruling A on
 * objectstack#27230). The same three properties as the packaged-automation
 * entry's file:
 *
 *   1. the key is registered by the production registration module, imported
 *      the way `index.ts` does;
 *   2. it addresses `component/automation/connector-credentials`, the URL the
 *      install step links to, built from the ref by the same helper;
 *   3. the page mounts through that route.
 *
 * ⛔ No bespoke `<Route>`: the Setup nav contribution is the one way in.
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
import { CONNECTOR_CREDENTIALS_REF, connectorCredentialsPagePath } from './connectorCredentials.js';

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: { credentialRefs: [], total: 0 } }),
    }) as unknown as Response),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the connector-credentials Setup nav contribution', () => {
  it('registers the ref, owned by app-shell', () => {
    expect(CONNECTOR_CREDENTIALS_REF).toBe('automation:connector-credentials');
    const entry = getAppComponent(CONNECTOR_CREDENTIALS_REF);
    expect(entry).toBeDefined();
    expect(entry?.source).toBe('@object-ui/app-shell');
  });

  it('addresses component/automation/connector-credentials', () => {
    expect(componentRefToUrlSegments(CONNECTOR_CREDENTIALS_REF)).toEqual(['automation', 'connector-credentials']);
  });

  it('mounts the page through the component route the ref builds', async () => {
    render(
      <MemoryRouter initialEntries={[connectorCredentialsPagePath()]}>
        <Routes>
          <Route path="/apps/:appName/component/:ns/:name/*" element={<ComponentNavView />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Connector credentials' })).toBeInTheDocument();
    expect(await screen.findByTestId('connector-credentials-empty')).toBeInTheDocument();
    expect(screen.queryByText('Component not registered')).toBeNull();
  });
});
