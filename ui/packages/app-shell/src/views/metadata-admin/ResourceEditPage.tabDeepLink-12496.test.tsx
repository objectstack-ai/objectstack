// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12496, objectstack#36901 — a `?tab=` deep link on a metadata item
 * page opens that tab, and the URL keeps `tab` afterwards. The item tools are
 * tabs of the page since objectstack#36901 (epic objectstack#36890 decision 8):
 * the values the retired side sheets wrote still land where they pointed —
 * `audit` on History's audit log, `layers` on Source's layered comparison.
 *
 * Only a tab the page offers THIS caller is accepted: History stays behind
 * objectui#12475's trail gate (`useCanReadAuthoringTrail`), so a
 * `setup.access`-only caller is not offered it, a link naming it opens the
 * details, and the value is dropped from the URL.
 *
 * Real subjects: the page under the real `MePermissionsProvider`, seeded with a
 * persona. The metadata client is the only stub.
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

function mePermissions(systemPermissions: string[]): MePermissionsAuthenticatedResponse {
  return {
    authenticated: true,
    userId: 'u1',
    tenantId: 'org_1',
    positions: [],
    hasAnyQueue: false,
    objectsUsingQueues: [],
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
  // The tab row paints once the item has loaded; References is ungated.
  await screen.findByTestId('item-tab-references');
}

const tabParam = () => new URLSearchParams(window.location.search).get('tab');
const pressed = (tab: string) => screen.getByTestId(`item-tab-${tab}`).getAttribute('aria-pressed');

describe('ResourceEditPage — a ?tab= deep link opens its tab (objectui#12496, objectstack#36901)', () => {
  it('?tab=audit opens History on the audit log for a studio.access caller, and the URL keeps tab=audit', async () => {
    await mountAt('?tab=audit', STUDIO_AUTHOR);
    expect(pressed('history')).toBe('true');
    expect(await screen.findByTestId('item-tab-panel-history')).toBeInTheDocument();
    expect(screen.getByTestId('item-tab-view-audit')).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(mockClient.audit).toHaveBeenCalled());
    expect(tabParam()).toBe('audit');
  });

  it('?tab=history opens History on the versions, and the URL keeps tab=history', async () => {
    await mountAt('?tab=history', STUDIO_AUTHOR);
    expect(pressed('history')).toBe('true');
    expect(screen.getByTestId('item-tab-view-versions')).toHaveAttribute('aria-pressed', 'true');
    expect(tabParam()).toBe('history');
  });

  it('?tab=layers opens Source on the layered comparison', async () => {
    await mountAt('?tab=layers', STUDIO_AUTHOR);
    expect(pressed('source')).toBe('true');
    expect(screen.getByTestId('item-tab-view-layers')).toHaveAttribute('aria-pressed', 'true');
    expect(tabParam()).toBe('layers');
  });

  it('a setup.access-only caller is offered no History (the objectui#12475 gate): ?tab=history opens the details, and tab is dropped', async () => {
    await mountAt('?tab=history', SETUP_ONLY);
    expect(screen.queryByTestId('item-tab-history')).toBeNull();
    expect(pressed('details')).toBe('true');
    await waitFor(() => expect(tabParam()).toBeNull());
  });

  it('a setup.access-only caller still opens Source and its layers (decision 8: read-only callers see the layers)', async () => {
    await mountAt('?tab=layers', SETUP_ONLY);
    expect(pressed('source')).toBe('true');
    expect(screen.getByTestId('item-tab-view-layers')).toHaveAttribute('aria-pressed', 'true');
  });

  it('an unknown ?tab= value opens the details, and tab is dropped', async () => {
    await mountAt('?tab=nonsense', STUDIO_AUTHOR);
    expect(pressed('details')).toBe('true');
    await waitFor(() => expect(tabParam()).toBeNull());
  });

  it('CONTROL: no ?tab= opens the details of a type without a canvas, and writes no tab', async () => {
    await mountAt('', STUDIO_AUTHOR);
    expect(pressed('details')).toBe('true');
    expect(tabParam()).toBeNull();
  });

  it('choosing a tab writes it to the URL, and choosing Details again removes it', async () => {
    await mountAt('', STUDIO_AUTHOR);
    fireEvent.click(screen.getByTestId('item-tab-references'));
    expect(await screen.findByTestId('item-tab-panel-references')).toBeInTheDocument();
    await waitFor(() => expect(tabParam()).toBe('references'));
    fireEvent.click(screen.getByTestId('item-tab-details'));
    await waitFor(() => expect(tabParam()).toBeNull());
  });

  it('no item tool is a side sheet any more: opening a tool opens no dialog', async () => {
    await mountAt('?tab=references', STUDIO_AUTHOR);
    await screen.findByTestId('item-tab-panel-references');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
