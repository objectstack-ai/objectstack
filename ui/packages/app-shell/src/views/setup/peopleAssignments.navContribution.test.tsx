// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `security:position-holders` and `security:permission-set-assignment` — the
 * component-registry keys the Setup → People & organization entries name
 * (ADR-0146 D7). The same three properties as the other Setup pages' files:
 *
 *   1. each key is registered by the production registration module, imported
 *      the way `index.ts` does;
 *   2. each addresses `component/security/<name>`, the URL its entry opens,
 *      built from the ref by the same helper;
 *   3. each page mounts through that route.
 *
 * ⛔ No bespoke `<Route>`: the Setup nav contribution is the one way in.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
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
import {
  PERMISSION_SET_ASSIGNMENT_REF,
  POSITION_HOLDERS_REF,
  permissionSetAssignmentPagePath,
  positionHoldersPagePath,
} from './peopleAssignments.js';

afterEach(cleanup);

function mount(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/apps/:appName/component/:ns/:name/*" element={<ComponentNavView />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('the People & organization assignment pages as Setup nav contributions', () => {
  it('registers both refs, owned by app-shell', () => {
    expect(POSITION_HOLDERS_REF).toBe('security:position-holders');
    expect(PERMISSION_SET_ASSIGNMENT_REF).toBe('security:permission-set-assignment');
    for (const ref of [POSITION_HOLDERS_REF, PERMISSION_SET_ASSIGNMENT_REF]) {
      expect(getAppComponent(ref)?.source).toBe('@object-ui/app-shell');
    }
  });

  it('addresses component/security/<name>, and the item rides the page-scoped param', () => {
    expect(componentRefToUrlSegments(POSITION_HOLDERS_REF)).toEqual(['security', 'position-holders']);
    expect(componentRefToUrlSegments(PERMISSION_SET_ASSIGNMENT_REF)).toEqual(['security', 'permission-set-assignment']);
    expect(positionHoldersPagePath('sales rep')).toBe('/apps/setup/component/security/position-holders?position=sales%20rep');
    expect(permissionSetAssignmentPagePath()).toBe('/apps/setup/component/security/permission-set-assignment');
  });

  it('mounts the Position holders page through the component route its ref builds', async () => {
    mount(positionHoldersPagePath());
    expect(await screen.findByRole('heading', { name: 'Position holders' })).toBeInTheDocument();
    expect(await screen.findByTestId('setup-position-holders-empty')).toBeInTheDocument();
    expect(screen.queryByText('Component not registered')).toBeNull();
  });

  it('mounts the Permission set assignment page through the component route its ref builds', async () => {
    mount(permissionSetAssignmentPagePath());
    expect(await screen.findByRole('heading', { name: 'Permission set assignment' })).toBeInTheDocument();
    expect(await screen.findByTestId('setup-permission-set-assignment-empty')).toBeInTheDocument();
    expect(screen.queryByText('Component not registered')).toBeNull();
  });
});
