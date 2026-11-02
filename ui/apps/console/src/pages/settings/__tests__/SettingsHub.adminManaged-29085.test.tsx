// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Settings hub — an empty list says who it is empty for.
 *
 * `GET /api/settings` lists only the manifests the caller may read, and a
 * manifest that declares no `readPermission` reads at the spec's default, so a
 * plain member is answered an empty list while the settings exist. The hub drew
 * one developer sentence for every empty list ("No settings registered. Plugins
 * can register settings manifests via the SettingsService."). Now:
 *
 *   - a caller without the default read capability is told an administrator
 *     manages the settings;
 *   - a caller who holds it and still gets none keeps a no-settings message;
 *   - a caller with manifests sees the list, unchanged.
 *
 * The capability answer is the real `MePermissionsProvider`'s, fed the
 * `/auth/me/permissions` payload it would fetch. No i18n provider is mounted,
 * so each call site renders its key, as in the sibling `pageHeader` suite.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import {
  MePermissionsProvider,
  type MePermissionsAuthenticatedResponse,
  type MePermissionsResponse,
} from '@object-ui/permissions';
import { SettingsManifestSchema } from '@objectstack/spec/system';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { SettingsHub, SETTINGS_DEFAULT_READ_CAPABILITY } from '../SettingsHub';

const MANIFESTS = [
  { namespace: 'localization', version: 1, label: 'Localization', category: 'Platform', specifiers: [] },
];

const MEMBER: string[] = [];
const ADMIN = ['manage_org_users', 'setup.access', 'setup.write'];

function serveManifests(manifests: unknown[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ success: true, data: { manifests } }),
    })),
  );
}

function permissionsPayload(systemPermissions: string[]): MePermissionsResponse {
  const base: MePermissionsAuthenticatedResponse = {
    authenticated: true,
    userId: 'u_1',
    tenantId: 'org_1',
    positions: [],
    hasAnyQueue: false,
    permissionSets: [],
    objects: {},
    fields: {},
  };
  return { ...base, systemPermissions };
}

function renderHub(systemPermissions: string[]) {
  return render(
    <MemoryRouter>
      <MePermissionsProvider initialPermissions={permissionsPayload(systemPermissions)}>
        <SettingsHub />
      </MePermissionsProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Settings hub — an empty list says who it is empty for', () => {
  it('the capability the hub asks is the one a manifest reads at by default in the spec', () => {
    expect(SettingsManifestSchema.shape.readPermission.parse(undefined)).toBe(SETTINGS_DEFAULT_READ_CAPABILITY);
  });

  it('a member answered no manifests is told an administrator manages the settings', async () => {
    serveManifests([]);
    renderHub(MEMBER);
    const panel = await screen.findByTestId('settings-hub-admin-managed');
    expect(panel).toHaveTextContent('console.settingsHub.adminManaged');
    expect(panel).toHaveTextContent('console.settingsHub.adminManagedDescription');
    expect(screen.queryByTestId('settings-hub-empty')).toBeNull();
    expect(screen.queryByText('console.settingsHub.empty')).toBeNull();
  });

  it('an admin answered no manifests is told none are available, not that an administrator manages them', async () => {
    serveManifests([]);
    renderHub(ADMIN);
    expect(await screen.findByTestId('settings-hub-empty')).toHaveTextContent('console.settingsHub.empty');
    expect(screen.queryByTestId('settings-hub-admin-managed')).toBeNull();
  });

  it('an admin answered manifests sees the list', async () => {
    serveManifests(MANIFESTS);
    renderHub(ADMIN);
    expect(await screen.findByText('Localization')).toBeInTheDocument();
    expect(screen.queryByTestId('settings-hub-empty')).toBeNull();
    expect(screen.queryByTestId('settings-hub-admin-managed')).toBeNull();
  });

  it('a member answered manifests (a namespace it may read) sees the list too', async () => {
    serveManifests(MANIFESTS);
    renderHub(MEMBER);
    expect(await screen.findByText('Localization')).toBeInTheDocument();
    expect(screen.queryByTestId('settings-hub-admin-managed')).toBeNull();
  });
});
