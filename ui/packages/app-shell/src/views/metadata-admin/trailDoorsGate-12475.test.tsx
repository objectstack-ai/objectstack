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
// The page reaches a dynamic `@objectstack/lint` import; its first load is paid
// here, at collection, never inside a case's clock (`check:test-source-alias`).
import '@objectstack/lint';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MePermissionsProvider, type MePermissionsResponse, type MePermissionsAuthenticatedResponse } from '@object-ui/permissions';

const POSITION = { name: 'env_position', label: 'Environment Position' };
const SET = { name: 'sales_perms', label: 'Sales', objects: {}, fields: {} };

const mockClient = {
  // objectstack#26840 — the Access matrix reads its objects through the draft-overlaid door.
  withPreviewDrafts() { return this; },
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
function mePermissions(systemPermissions: string[] | undefined): MePermissionsAuthenticatedResponse {
  return {
    authenticated: true,
    userId: 'u1',
    tenantId: 'org_1',
    positions: [],
    hasAnyQueue: false,
    objectsUsingQueues: [],
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
    // The tab row paints once the item has loaded; References is ungated.
    await screen.findByTestId('item-tab-references');
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

/**
 * The item tools are tabs since objectstack#36901: the audit log is read
 * inside the History tab, so one gate decides both — the tab is offered, or
 * neither is.
 */
async function expectBoth() {
  fireEvent.click(screen.getByTestId('item-tab-history'));
  expect(await screen.findByTestId('item-tab-panel-history')).toBeInTheDocument();
  expect(screen.getByTestId('item-tab-view-audit')).toBeInTheDocument();
}

describe('ResourceEditPage — History and Audit follow the trail doors (objectui#12475)', () => {
  it('a setup.access-only caller sees neither entry', async () => {
    await mountEdit(SETUP_ONLY);
    expect(screen.queryByTestId('item-tab-history')).toBeNull();
    expect(screen.queryByTestId('item-tab-panel-history')).toBeNull();
  });

  it('a studio.access author sees both', async () => {
    await mountEdit(STUDIO_AUTHOR);
    await expectBoth();
  });

  it('a manage_metadata holder sees both', async () => {
    await mountEdit(METADATA_AUTHOR);
    await expectBoth();
  });

  it('an unreported capability set fails open', async () => {
    await mountEdit(UNREPORTED);
    await expectBoth();
  });

  it('CONTROL: create mode is unchanged — no trail entries, for an author either', async () => {
    await mountEdit(STUDIO_AUTHOR, { createMode: true });
    // The create form has painted (its title) before an absence is asserted.
    await screen.findAllByText('Create new');
    expect(screen.queryByTestId('item-tab-history')).toBeNull();
    expect(screen.queryByTestId('item-tab-references')).toBeNull();
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
