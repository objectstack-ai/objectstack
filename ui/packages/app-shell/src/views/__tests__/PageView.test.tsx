/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * PageView mounts the shared console action runtime (#1605), so a metadata
 * `action:button` rendered on a page can collect params and call an
 * authenticated API — the same runtime ObjectView uses. We render PageView with
 * a stubbed SchemaRenderer that consumes `useAction()` (as action:button does)
 * and assert the api action reaches the authenticated fetch.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

vi.mock('react-router-dom', () => ({
  useParams: () => ({ pageName: 'home' }),
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
  useNavigate: () => vi.fn(),
  // PageView reads the router's root href for its record navigator (objectui#12233).
  useHref: () => '/',
  useLocation: () => ({ pathname: '/apps/cloud/page/home', search: '' }),
}));

const authFetchSpy = vi.fn();
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1', name: 'User', role: 'user', image: null }, activeOrganization: null }),
  useWorkspaceAdminStatus: () => ({ isAdmin: false, isResolved: true }),
  createAuthenticatedFetch: () => authFetchSpy,
}));

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({ t: (k: string, o?: any) => o?.defaultValue ?? o?.name ?? k }),
  useObjectLabel: () => ({
    fieldLabel: (_o: any, _n: any, l: any) => l,
    fieldOptionLabel: (_o: any, _f: any, _v: any, l: any) => l,
    actionParamText: (_o: any, _a: any, _p: any, _attr: any, fallback: any) => fallback,
  }),
  // ObjectForm → Modal/DrawerForm build their discard-guard strings with this;
  // return a hook that just echoes the supplied English defaults.
  createSafeTranslation:
    (defaults: Record<string, string>) => () => ({
      t: (k: string) => defaults?.[k] ?? k,
    }),
}));

vi.mock('../../providers/MetadataProvider', () => ({
  useMetadata: () => ({ pages: [{ name: 'home', type: 'page', label: 'Home' }], objects: [] }),
}));

vi.mock('../MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false }),
}));

// Keep ActionProvider + useAction real; stub the renderer to a consumer that
// fires an api action exactly like an `action:button` would, and stub the
// adapter so PageView can mount.
vi.mock('@object-ui/react', async (orig) => {
  const actual = await (orig as any)();
  return {
    ...actual,
    useAdapter: () => ({}),
    SchemaRenderer: () => {
      const { execute } = actual.useAction();
      return (
        <button
          data-testid="page-api-action"
          onClick={() => execute({ type: 'api', name: 'createEnv', target: '/api/v1/environments' })}
        >
          Create environment
        </button>
      );
    },
  };
});

import { PageView } from '../PageView';

beforeEach(() => {
  authFetchSpy.mockReset();
  authFetchSpy.mockResolvedValue({ ok: true, json: async () => ({ id: 'env_1' }) });
});

describe('PageView — console action runtime', () => {
  it('renders the page and runs a page-level api action through the authenticated runtime', async () => {
    render(<PageView />);

    const btn = await screen.findByTestId('page-api-action');
    fireEvent.click(btn);

    await waitFor(() => expect(authFetchSpy).toHaveBeenCalled());
    expect(String(authFetchSpy.mock.calls[0][0])).toContain('/api/v1/environments');
  });
});
