// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#26732 — the Interfaces nav-item inspector's *Link to object*
 * picker and *Label* input are named by their visible labels.
 *
 * Before: both labels were drawn above their controls without `htmlFor`, so
 * the picker's trigger and the text input were anonymous to assistive tech.
 * Each now closes the pair with a `useId()`, as the inspector's target, URL
 * and icon fields already did.
 */
import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MetadataCtx } from '@object-ui/react';

import { StudioNavItemInspector } from './StudioDesignSurface';
import { t } from '../metadata-admin/i18n';

afterEach(cleanup);

const METADATA = {
  apps: [],
  objects: [{ name: 'account', label: 'Customers' }],
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

describe('objectstack#26732 — the nav-item inspector names its object picker and label input', () => {
  it('an object entry: the picker and the Label field are found by their labels', () => {
    render(
      <MetadataCtx.Provider value={METADATA as never}>
        <StudioNavItemInspector
          navId="navigation[0]"
          appDraft={{ navigation: [{ id: 'nav_account', type: 'object', objectName: 'account', label: 'Accounts' }] }}
          objects={[{ name: 'account', label: 'Customers' }]}
          packageId="com.acme.app"
          onNavPatch={vi.fn()}
          onClear={vi.fn()}
        />
      </MetadataCtx.Provider>,
    );
    expect(screen.getByRole('combobox', { name: t('engine.studio.nav.linkObject', 'en-US') })).toBe(
      screen.getByTestId('nav-link-object'),
    );
    expect(screen.getByRole('textbox', { name: t('engine.studio.nav.label', 'en-US') })).toHaveValue('Accounts');
  });
});
