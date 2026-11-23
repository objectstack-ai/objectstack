// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `forms:public-forms` — the component-registry key the Setup → Configuration
 * → Public forms entry names (objectstack#36444). The same three properties as
 * the other Setup pages' files:
 *
 *   1. the key is registered by the production registration module, imported
 *      the way `index.ts` does;
 *   2. it addresses `component/forms/public-forms`, the URL its entry opens,
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
import { PUBLIC_FORMS_CAPABILITY, PUBLIC_FORMS_REF, publicFormsPagePath } from './publicFormsRef.js';

afterEach(cleanup);

describe('the Public forms page as a Setup nav contribution (objectstack#36444)', () => {
  it('registers forms:public-forms, owned by app-shell, asking the Setup entry\'s capability', () => {
    expect(PUBLIC_FORMS_REF).toBe('forms:public-forms');
    expect(PUBLIC_FORMS_CAPABILITY).toBe('manage_platform_settings');
    expect(getAppComponent(PUBLIC_FORMS_REF)?.source).toBe('@object-ui/app-shell');
  });

  it('addresses component/forms/public-forms', () => {
    expect(componentRefToUrlSegments(PUBLIC_FORMS_REF)).toEqual(['forms', 'public-forms']);
    expect(publicFormsPagePath()).toBe('/apps/setup/component/forms/public-forms');
  });

  it('mounts through the component route its ref builds', async () => {
    render(
      <MemoryRouter initialEntries={[publicFormsPagePath()]}>
        <Routes>
          <Route path="/apps/:appName/component/:ns/:name/*" element={<ComponentNavView />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByTestId('public-forms-setup-page')).toBeInTheDocument();
    expect(screen.queryByText('Component not registered')).toBeNull();
  });
});
