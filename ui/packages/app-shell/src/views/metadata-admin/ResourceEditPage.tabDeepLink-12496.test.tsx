// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12496 — a `?tab=SHEET` deep link on a metadata item page opens that
 * sheet, and the URL keeps `tab` afterwards: the round trip the page's URL-sync
 * effect promises. Before the fix the sync effect's mount pass ran with no sheet
 * open and deleted `tab` before the first-mount reader could see it, so no link
 * opened anything and a refresh lost an open sheet.
 *
 * Only a sheet the page offers THIS caller is accepted: History and Audit stay
 * behind objectui#12475's trail gate (`useCanReadAuthoringTrail`), so a
 * `setup.access`-only caller gets nothing from a link naming them, and the
 * value is dropped from the URL.
 *
 * Real subjects: the page under the real `MePermissionsProvider`, seeded with a
 * persona. The metadata client is the only stub.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, within, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MePermissionsProvider, type MePermissionsResponse } from '@object-ui/permissions';

const POSITION = { name: 'env_position', label: 'Environment Position' };

const mockClient = {
  list: vi.fn(async () => []),
  listDrafts: vi.fn(async () => []),
  get: vi.fn(async () => null),
  getDraft: vi.fn(async () => null),
  references: vi.fn(async () => []),
  history: vi.fn(async () => ({ events: [] })),
  audit: vi.fn(async () => ({ events: [] })),
  save: vi.fn(async (_t: string, _n: string, payload: unknown) => payload),
  layered: vi.fn(async () => ({
    code: null,
    overlay: POSITION,
    overlayScope: null,
    effective: POSITION,
    provenance: 'org',
  })),
};

const SCHEMA = { type: 'object', properties: { name: { type: 'string' }, label: { type: 'string' } } };

vi.mock('./useMetadata', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./useMetadata')>()),
  useMetadataClient: () => mockClient,
  useMetadataTypes: () => ({
    loading: false,
    error: null,
    entries: [
      { type: 'dashboard', name: 'dashboard', label: 'Dashboard', allowEnvironmentOverlay: true, allowRuntimeCreate: true, schema: SCHEMA },
    ],
  }),
}));

import { MetadataResourceEditPage } from './ResourceEditPage';

function mePermissions(systemPermissions: string[]): MePermissionsResponse {
  return {
    authenticated: true,
    userId: 'u1',
    tenantId: 'org_1',
    roles: [],
    permissionSets: [],
    systemPermissions,
    objects: {},
    fields: {},
  };
}

/** An organization admin under a wall: Setup, no Studio, no authoring. */
const SETUP_ONLY = mePermissions(['manage_org_users', 'setup.access', 'setup.write']);
const STUDIO_AUTHOR = mePermissions(['studio.access']);

const PATH = '/apps/setup/metadata/dashboard/env_position';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.history.replaceState({}, '', '/');
});

/** Mounts the page with `search` on the real window location (the page reads it there). */
async function mountAt(search: string, perms: MePermissionsResponse) {
  window.history.replaceState({}, '', `${PATH}${search}`);
  render(
    <MePermissionsProvider initialPermissions={perms}>
      <MemoryRouter initialEntries={[`${PATH}${search}`]}>
        <MetadataResourceEditPage type="dashboard" name="env_position" />
      </MemoryRouter>
    </MePermissionsProvider>,
  );
  await waitFor(() => expect(mockClient.layered).toHaveBeenCalled());
  // The toolbar paints once the item has loaded; References is ungated.
  await screen.findByTitle('References');
}

const tabParam = () => new URLSearchParams(window.location.search).get('tab');

describe('ResourceEditPage — a ?tab= deep link opens its sheet (objectui#12496)', () => {
  it('?tab=audit opens Audit for a studio.access caller, and the URL keeps tab=audit', async () => {
    await mountAt('?tab=audit', STUDIO_AUTHOR);
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByText('Audit log')).toBeInTheDocument();
    expect(tabParam()).toBe('audit');
  });

  it('?tab=history opens History for a studio.access caller, and the URL keeps tab=history', async () => {
    await mountAt('?tab=history', STUDIO_AUTHOR);
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByText('History')).toBeInTheDocument();
    expect(tabParam()).toBe('history');
  });

  it('?tab=history opens nothing for a setup.access-only caller (the objectui#12475 gate), and tab is dropped', async () => {
    await mountAt('?tab=history', SETUP_ONLY);
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(tabParam()).toBeNull());
  });

  it('an unknown ?tab= value opens nothing, and tab is dropped', async () => {
    await mountAt('?tab=nonsense', STUDIO_AUTHOR);
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(tabParam()).toBeNull());
  });

  it('CONTROL: no ?tab= opens nothing', async () => {
    await mountAt('', STUDIO_AUTHOR);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(tabParam()).toBeNull();
  });

  it('closing the deep-linked sheet removes tab from the URL', async () => {
    await mountAt('?tab=audit', STUDIO_AUTHOR);
    const sheet = await screen.findByRole('dialog');
    fireEvent.click(within(sheet).getByRole('button', { name: /close/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(tabParam()).toBeNull();
  });
});
