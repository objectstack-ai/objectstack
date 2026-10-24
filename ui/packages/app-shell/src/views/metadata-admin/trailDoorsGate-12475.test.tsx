// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12475 — Setup's catalog item editors show History and Audit only to
 * a caller the authoring-trail doors admit. objectstack#23546 (ruling A1)
 * narrowed `GET /meta/:type/:name/history`, `/audit` and `/diff` to `system`,
 * `studio.access` and `manage_metadata`, so an organization admin holding
 * `setup.access` alone would be offered two buttons that always answer 403.
 *
 * Real subjects: both editors under the real `MePermissionsProvider`, seeded
 * with a persona, and the real `useCanReadAuthoringTrail` predicate. The
 * metadata client is the only stub.
 *
 *  - a `setup.access`-only caller sees neither entry;
 *  - a `studio.access` author sees both, and so does a `manage_metadata` holder;
 *  - CONTROL: create mode is unchanged (no trail entries, for anyone);
 *  - an unreported capability set fails open, as `useCanAuthorMetadata` does.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MePermissionsProvider, type MePermissionsResponse } from '@object-ui/permissions';

const POSITION = { name: 'env_position', label: 'Environment Position' };
const SET = { name: 'sales_perms', label: 'Sales', objects: {}, fields: {} };

const mockClient = {
  list: vi.fn(async () => []),
  listDrafts: vi.fn(async () => []),
  get: vi.fn(async () => null),
  getDraft: vi.fn(async () => null),
  references: vi.fn(async () => []),
  history: vi.fn(async () => ({ events: [] })),
  audit: vi.fn(async () => ({ events: [] })),
  save: vi.fn(async (_t: string, _n: string, payload: unknown) => payload),
  layered: vi.fn(async (type: string) => {
    const doc = type === 'permission' ? SET : POSITION;
    return { code: null, overlay: doc, overlayScope: null, effective: doc, provenance: 'org' };
  }),
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
      { type: 'permission', name: 'permission', label: 'Permission', allowEnvironmentOverlay: true },
    ],
  }),
}));
vi.mock('./AssignedUsersSection', () => ({ AssignedUsersSection: () => null }));

import { MetadataResourceEditPage } from './ResourceEditPage';
import { PermissionMatrixEditPage } from './PermissionMatrixEditor';

/** `/me/permissions` for a persona; `undefined` = a backend that reports none. */
function mePermissions(systemPermissions: string[] | undefined): MePermissionsResponse {
  return {
    authenticated: true,
    userId: 'u1',
    tenantId: 'org_1',
    roles: [],
    permissionSets: [],
    ...(systemPermissions ? { systemPermissions } : {}),
    objects: {},
    fields: {},
  };
}

/** An organization admin under a wall: Setup, no Studio, no authoring. */
const SETUP_ONLY = mePermissions(['manage_org_users', 'setup.access', 'setup.write']);
const STUDIO_AUTHOR = mePermissions(['studio.access']);
const METADATA_AUTHOR = mePermissions(['manage_metadata']);
const UNREPORTED = mePermissions(undefined);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function mountEdit(perms: MePermissionsResponse, opts: { createMode?: boolean } = {}) {
  render(
    <MePermissionsProvider initialPermissions={perms}>
      <MemoryRouter initialEntries={[`/apps/setup/metadata/dashboard/env_position`]}>
        <MetadataResourceEditPage type="dashboard" name={opts.createMode ? '' : 'env_position'} createMode={opts.createMode} />
      </MemoryRouter>
    </MePermissionsProvider>,
  );
  if (!opts.createMode) {
    await waitFor(() => expect(mockClient.layered).toHaveBeenCalled());
    // The toolbar paints once the item has loaded; References is ungated.
    await screen.findByTitle('References');
  }
}

async function mountMatrix(perms: MePermissionsResponse, embedded = false) {
  render(
    <MePermissionsProvider initialPermissions={perms}>
      <MemoryRouter initialEntries={['/current']}>
        <PermissionMatrixEditPage type="permission" name="sales_perms" packageId="app.a" embedded={embedded} />
      </MemoryRouter>
    </MePermissionsProvider>,
  );
  await screen.findByText('Sales');
}

describe('ResourceEditPage — History and Audit follow the trail doors (objectui#12475)', () => {
  it('a setup.access-only caller sees neither entry', async () => {
    await mountEdit(SETUP_ONLY);
    expect(screen.queryByTestId('history-button')).toBeNull();
    expect(screen.queryByTestId('audit-button')).toBeNull();
  });

  it('a studio.access author sees both', async () => {
    await mountEdit(STUDIO_AUTHOR);
    expect(screen.getByTestId('history-button')).toBeInTheDocument();
    expect(screen.getByTestId('audit-button')).toBeInTheDocument();
  });

  it('a manage_metadata holder sees both', async () => {
    await mountEdit(METADATA_AUTHOR);
    expect(screen.getByTestId('history-button')).toBeInTheDocument();
    expect(screen.getByTestId('audit-button')).toBeInTheDocument();
  });

  it('an unreported capability set fails open', async () => {
    await mountEdit(UNREPORTED);
    expect(screen.getByTestId('history-button')).toBeInTheDocument();
    expect(screen.getByTestId('audit-button')).toBeInTheDocument();
  });

  it('CONTROL: create mode is unchanged — no trail entries, for an author either', async () => {
    await mountEdit(STUDIO_AUTHOR, { createMode: true });
    // The create form has painted (its subtitle) before an absence is asserted.
    await screen.findByText('Create new');
    expect(screen.queryByTestId('history-button')).toBeNull();
    expect(screen.queryByTestId('audit-button')).toBeNull();
    expect(screen.queryByTitle('References')).toBeNull();
  });
});

describe('PermissionMatrixEditor — History follows the trail doors (objectui#12475)', () => {
  it('a setup.access-only caller sees no History, routed or embedded', async () => {
    await mountMatrix(SETUP_ONLY);
    expect(screen.queryByTestId('history-button')).toBeNull();
    cleanup();
    await mountMatrix(SETUP_ONLY, true);
    expect(screen.queryByTestId('history-button')).toBeNull();
  });

  it('a studio.access author sees History', async () => {
    await mountMatrix(STUDIO_AUTHOR);
    expect(screen.getByTestId('history-button')).toBeInTheDocument();
  });
});
