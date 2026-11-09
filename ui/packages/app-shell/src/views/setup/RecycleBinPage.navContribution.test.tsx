// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `data:recycle-bin` — the component-registry key the Setup → Configuration →
 * Recycle bin entry names (objectstack#30239). The same three properties as
 * the other Setup pages' files:
 *
 *   1. the key is registered by the production registration module, imported
 *      the way `index.ts` does;
 *   2. it addresses `component/data/recycle-bin`, the URL its entry opens,
 *      built from the ref by the same helper;
 *   3. the page mounts through that route.
 *
 * ⛔ No bespoke `<Route>`: the Setup nav contribution is the one way in.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

// Paid at collection, not inside a clocked case: the registration reaches
// `celAuthoring.ts`, which loads the linter on first use.
import '@objectstack/lint';
// Side effect: the production registration, imported the way `index.ts` does.
import '../../services/builtinComponents.js';
import { componentRefToUrlSegments, getAppComponent } from '../../services/componentRegistry.js';
import { ComponentNavView } from '../ComponentNavView.js';
import { RECYCLE_BIN_REF, recycleBinPagePath } from './recycleBin.js';

afterEach(cleanup);

describe('the Recycle bin page as a Setup nav contribution (objectstack#30239)', () => {
  it('registers data:recycle-bin, owned by app-shell', () => {
    expect(RECYCLE_BIN_REF).toBe('data:recycle-bin');
    expect(getAppComponent(RECYCLE_BIN_REF)?.source).toBe('@object-ui/app-shell');
  });

  it('addresses component/data/recycle-bin, and the object rides the page-scoped param', () => {
    expect(componentRefToUrlSegments(RECYCLE_BIN_REF)).toEqual(['data', 'recycle-bin']);
    expect(recycleBinPagePath('crm_lead')).toBe('/apps/setup/component/data/recycle-bin?object=crm_lead');
    expect(recycleBinPagePath()).toBe('/apps/setup/component/data/recycle-bin');
  });

  it('mounts through the component route its ref builds', async () => {
    render(
      <MemoryRouter initialEntries={[recycleBinPagePath()]}>
        <Routes>
          <Route path="/apps/:appName/component/:ns/:name/*" element={<ComponentNavView />} />
        </Routes>
      </MemoryRouter>,
    );
    // No permissions provider here: the page waits for the effective map.
    expect(await screen.findByTestId('setup-recycle-bin-loading')).toBeInTheDocument();
    expect(screen.queryByText('Component not registered')).toBeNull();
  });
});
