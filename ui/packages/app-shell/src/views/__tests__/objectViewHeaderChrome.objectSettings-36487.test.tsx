// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The list header's folded ⋯ menu leads with Object settings (objectstack#36487):
 * the object in Studio's Data surface, for a workspace admin who may author
 * metadata, on an app built here and on an installed one alike; a member gets
 * none. Leaving asks first when the page holds unsaved edits.
 *
 * Harness: the real hook under the real router on the list's own route, the
 * real Studio gate reading a package list served the way
 * `GET /api/v1/packages` serves it; the principal answers and the app catalog
 * are stand-ins. The folded menu is read off the bar schema the hook hands
 * `ListHeaderActionBar`, which draws every entry of `actions` in order.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { ActionBarSchema } from '@object-ui/types';

const viewer = vi.hoisted(() => ({ isAdmin: true, canAuthorMetadata: true }));
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useWorkspaceAdminStatus: () => ({ isAdmin: viewer.isAdmin, isResolved: true }),
}));
vi.mock('../../hooks/useCanAuthorMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useCanAuthorMetadata: () => viewer.canAuthorMetadata,
}));

/** An app built here (writable package) and an installed one (read-only package). */
const BASE_APP = { name: 'my_app', _packageId: 'com.example.my_base' };
const HOTCRM = { name: 'crm', _packageId: 'app.objectstack.hotcrm' };
vi.mock('../../providers/MetadataProvider', () => ({
  useMetadata: () => ({ apps: [BASE_APP, HOTCRM] }),
}));

import { useObjectViewHeaderChrome } from '../objectViewHeaderChrome';
import { registerUnsavedEdits } from '../../chrome/unsavedEdits';

const PACKAGES = {
  data: {
    packages: [
      { manifest: { id: 'com.example.my_base', name: 'My Base' }, writable: true },
      { manifest: { id: 'app.objectstack.hotcrm', name: 'HotCRM', scope: 'project' }, writable: false },
    ],
  },
};

const t = (key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key);

let where = '';
function Where() {
  const location = useLocation();
  where = `${location.pathname}${location.search}`;
  return null;
}

/** The hook on `/apps/<app>/account`, with New shown so the header has a folded face. */
function renderChrome(appSegment: string) {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <MemoryRouter initialEntries={[`/apps/${appSegment}/account`]}>
      <Routes>
        <Route path="/apps/:appName/:objectName" element={<>{children}</>} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>
  );
  const props = {
    objectCanCreate: true,
    createVisible: true,
    createDisabled: false,
    actions: { create: vi.fn() },
    t,
    listActions: [],
    toolbarActionsWithDeepLink: [],
    identityImportEnabled: false,
    objectCanImport: false,
    importVisible: false,
    importDisabled: false,
    setShowImport: vi.fn(),
    listFavorite: null,
    isEnvironmentList: false,
    toolbarBar: { type: 'action:bar', actions: [] },
    viewAccess: { refusal: null },
    createLabel: 'New Account',
  } as unknown as Parameters<typeof useObjectViewHeaderChrome>[0];
  return renderHook(() => useObjectViewHeaderChrome(props), { wrapper });
}

/** The folded ⋯ menu's bar: the `ListHeaderActionBar` whose schema carries no inline slot. */
function foldedMenu(folded: React.ReactNode): ActionBarSchema {
  const children = React.Children.toArray((folded as React.ReactElement<{ children: React.ReactNode }>).props.children);
  const bar = children
    .map((child) => (child as React.ReactElement<{ schema?: ActionBarSchema }>).props?.schema)
    .find((schema) => schema && schema.maxVisible === 0);
  if (!bar) throw new Error('no folded menu bar');
  return bar;
}

const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

let release: (() => void) | null = null;

beforeEach(() => {
  viewer.isAdmin = true;
  viewer.canAuthorMetadata = true;
  where = '';
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

describe('the folded list menu leads with Object settings (objectstack#36487)', () => {
  it('first entry for an admin on an app built here', async () => {
    const { result } = renderChrome('com.example.my_base');
    await settle();
    const first = foldedMenu(result.current.foldedHeaderActions).actions?.[0];
    expect(first?.name).toBe('object_view_object_settings');
    expect(first?.label).toBe('Object settings');
  });

  it('first entry for an admin on an installed app too', async () => {
    const { result } = renderChrome('app.objectstack.hotcrm');
    await settle();
    expect(foldedMenu(result.current.foldedHeaderActions).actions?.[0]?.name).toBe('object_view_object_settings');
  });

  it('none for a member', async () => {
    viewer.isAdmin = false;
    const { result } = renderChrome('com.example.my_base');
    await settle();
    expect(foldedMenu(result.current.foldedHeaderActions).actions?.map((a) => a.name)).not.toContain(
      'object_view_object_settings',
    );
  });

  it('opens the object in Studio, and asks first while the page holds unsaved edits', async () => {
    const confirm = vi.fn((_message?: string) => false);
    vi.stubGlobal('confirm', confirm);
    release = registerUnsavedEdits('Discard your changes?');
    const { result } = renderChrome('com.example.my_base');
    await settle();
    const entry = foldedMenu(result.current.foldedHeaderActions).actions?.[0] as unknown as { onClick: () => void };

    act(() => entry.onClick());
    expect(confirm).toHaveBeenCalledWith('Discard your changes?');
    expect(where).toBe('');

    confirm.mockReturnValue(true);
    act(() => entry.onClick());
    expect(where).toBe('/studio/com.example.my_base/data?surface=object:account');
  });
});
