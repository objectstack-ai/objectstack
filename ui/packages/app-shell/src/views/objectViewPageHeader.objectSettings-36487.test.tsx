// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The list page's ⋮ More leads with Object settings (objectstack#36487): the
 * object in Studio's Data surface, above the object's description and the
 * favorites entry. A workspace admin who may author metadata gets it on an app
 * built here (a writable package) and on an installed one (a read-only
 * package); a member, and an app of a kernel package, get none. Leaving asks
 * first when the page holds unsaved edits (`confirmUnsavedLeave`).
 *
 * Harness: the real page-bar acts and the real Radix menu under the real
 * router, on the list's own route; the real Studio gate reads a package list
 * served the way `GET /api/v1/packages` serves it. The principal answers and
 * the app catalog are stand-ins; the translator returns each call site's
 * inline default.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key),
    language: 'en',
  }),
}));

const viewer = vi.hoisted(() => ({ isAdmin: true, canAuthorMetadata: true }));
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useWorkspaceAdminStatus: () => ({ isAdmin: viewer.isAdmin, isResolved: true }),
}));
vi.mock('../hooks/useCanAuthorMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useCanAuthorMetadata: () => viewer.canAuthorMetadata,
}));

/** An app built here, an installed one, and the console's own Setup. */
const BASE_APP = { name: 'my_app', _packageId: 'com.example.my_base' };
const HOTCRM = { name: 'crm', _packageId: 'app.objectstack.hotcrm' };
const SETUP = { name: 'setup', _packageId: 'com.objectstack.setup' };
vi.mock('../providers/MetadataProvider', () => ({
  useMetadata: () => ({ apps: [BASE_APP, HOTCRM, SETUP] }),
}));

import { ObjectViewPageBarActions, type ObjectViewPageBarProps } from './objectViewPageHeader';
import { registerUnsavedEdits } from '../chrome/unsavedEdits';

const PACKAGES = {
  data: {
    packages: [
      { manifest: { id: 'com.example.my_base', name: 'My Base' }, writable: true },
      { manifest: { id: 'app.objectstack.hotcrm', name: 'HotCRM', scope: 'project' }, writable: false },
      { manifest: { id: 'com.objectstack.setup', name: 'Setup', scope: 'system' }, writable: false },
    ],
  },
};

function Where() {
  const location = useLocation();
  return <output data-testid="where">{`${location.pathname}${location.search}`}</output>;
}

const t = ((key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key)) as ObjectViewPageBarProps['t'];

/** The list's acts on `/apps/<app>/account`, with ⋮ More's description and favorites entry. */
function renderBar(appSegment: string) {
  const props = {
    objectDef: { name: 'account', label: 'Account', description: 'Companies we sell to.' },
    objectDesc: (def: { description?: string }) => def.description ?? '',
    createButton: null,
    importShown: false,
    setShowImport: vi.fn(),
    importDisabled: false,
    t,
    listActions: [],
    isEnvironmentList: false,
    headerToolbarActions: [],
    environmentEntitlements: undefined,
    toolbarBar: { type: 'action:bar', actions: [] },
    listFavorite: { isFavorite: false, toggle: vi.fn() },
    foldedHeaderActions: undefined,
  } as unknown as ObjectViewPageBarProps;
  return render(
    <MemoryRouter initialEntries={[`/apps/${appSegment}/account`]}>
      <Routes>
        <Route
          path="/apps/:appName/:objectName"
          element={
            <>
              <ObjectViewPageBarActions {...props} />
              <Where />
            </>
          }
        />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

/** ⋮ More's entries, opened once the package list has answered. */
async function openMore(appSegment: string): Promise<string[]> {
  renderBar(appSegment);
  await settle();
  fireEvent.keyDown(screen.getByTestId('object-view-more-actions'), { key: 'Enter' });
  return (await screen.findAllByRole('menuitem')).map((el) => el.textContent ?? '');
}

let release: (() => void) | null = null;

beforeEach(() => {
  viewer.isAdmin = true;
  viewer.canAuthorMetadata = true;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown) => ({
      ok: true,
      status: 200,
      json: async () => (String(url).endsWith('/api/v1/packages') ? PACKAGES : { data: [] }),
    })),
  );
});

afterEach(() => {
  cleanup();
  release?.();
  release = null;
  vi.unstubAllGlobals();
});

describe('the list page\'s ⋮ More leads with Object settings (objectstack#36487)', () => {
  it('first, above the description, for an admin on an app built here', async () => {
    expect(await openMore('com.example.my_base')).toEqual(['Object settings', 'Add to favorites']);
    const entry = screen.getByTestId('object-view-object-settings');
    const description = screen.getByTestId('object-view-description');
    expect(entry.compareDocumentPosition(description) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('first for an admin on an installed (read-only) app too', async () => {
    expect(await openMore('app.objectstack.hotcrm')).toEqual(['Object settings', 'Add to favorites']);
  });

  it('none for a member', async () => {
    viewer.isAdmin = false;
    expect(await openMore('com.example.my_base')).toEqual(['Add to favorites']);
  });

  it('none for an admin the server refuses authoring', async () => {
    viewer.canAuthorMetadata = false;
    expect(await openMore('com.example.my_base')).toEqual(['Add to favorites']);
  });

  it('none on an app of a kernel package', async () => {
    expect(await openMore('com.objectstack.setup')).toEqual(['Add to favorites']);
  });

  it('opens the object in Studio, asking first while the page holds unsaved edits', async () => {
    const confirm = vi.fn((_message?: string) => false);
    vi.stubGlobal('confirm', confirm);
    release = registerUnsavedEdits('Discard your changes?');
    await openMore('com.example.my_base');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Object settings' }));
    expect(confirm).toHaveBeenCalledWith('Discard your changes?');
    await settle();
    expect(screen.getByTestId('where')).toHaveTextContent('/apps/com.example.my_base/account');

    confirm.mockReturnValue(true);
    fireEvent.keyDown(screen.getByTestId('object-view-more-actions'), { key: 'Enter' });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Object settings' }));
    await waitFor(() =>
      expect(screen.getByTestId('where')).toHaveTextContent('/studio/com.example.my_base/data?surface=object:account'),
    );
  });

  it('CONTROL — with nothing registered it opens Studio at once and asks nothing', async () => {
    const confirm = vi.fn((_message?: string) => true);
    vi.stubGlobal('confirm', confirm);
    await openMore('app.objectstack.hotcrm');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Object settings' }));
    await waitFor(() =>
      expect(screen.getByTestId('where')).toHaveTextContent('/studio/app.objectstack.hotcrm/data?surface=object:account'),
    );
    expect(confirm).not.toHaveBeenCalled();
  });
});
