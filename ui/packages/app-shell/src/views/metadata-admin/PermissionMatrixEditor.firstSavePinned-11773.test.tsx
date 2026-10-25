// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11773 — the permission matrix's PACKAGE door pins its first draft
 * save to what its load read.
 *
 * The load reads the set's draft at the package the save writes
 * (`getDraft(type, name, { packageId })`), and its answer pins the first
 * autosave: `If-Match` with the version a pending draft's read served, or
 * `If-None-Match: *` when no draft was pending. The ENVIRONMENT door writes live
 * config, reads no draft and pins nothing, as before (the control).
 *
 * The client double answers as the published `@objectstack/*` 18.0.0-next.0
 * door was measured to (readings on the pull request): the draft read serves
 * `version`, and no draft at all is `null`.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const PUBLISHED = {
  name: 'sales_perms',
  label: 'Sales',
  objects: { a_account: { allowRead: true, allowCreate: true } },
  fields: {},
};

const LAYERED = { effective: PUBLISHED, code: null, overlay: null, overlayScope: null };

interface Server {
  draft: { body: Record<string, unknown>; version: string } | null;
  draftReads: unknown[][];
  savedOpts: Array<Record<string, unknown> | undefined>;
}

type FakeClient = Record<string, (...args: never[]) => Promise<unknown>>;

function makeClient(server: Server): FakeClient {
  return {
    layered: async () => LAYERED,
    getDraft: async (...args: unknown[]) => {
      server.draftReads.push(args);
      return server.draft ? { type: 'permission', name: 'sales_perms', item: server.draft.body, version: server.draft.version } : null;
    },
    list: async (type: string) => (type === 'object' ? [{ item: { name: 'a_account' } }] : type === 'permission' ? [PUBLISHED] : []),
    get: async () => null,
    save: async (_type: string, _name: string, payload: Record<string, unknown>, saveOpts?: Record<string, unknown>) => {
      server.savedOpts.push(saveOpts);
      return { success: true, version: 'hmac-sha256:receipt', state: 'draft', payload };
    },
  };
}

let clientImpl: FakeClient;

vi.mock('./useMetadata', () => ({
  useMetadataClient: () => clientImpl,
  useMetadataTypes: () => ({
    loading: false,
    error: null,
    entries: [{ type: 'permission', label: 'Permission', allowEnvironmentOverlay: true }],
  }),
}));

vi.mock('./AssignedUsersSection', () => ({ AssignedUsersSection: () => null }));

import { PermissionMatrixEditPage } from './PermissionMatrixEditor';

afterEach(cleanup);

const AUTOSAVE = { timeout: 4000 };

function renderDoor(packageId: string | undefined) {
  return render(
    <MemoryRouter>
      <PermissionMatrixEditPage type="permission" name="sales_perms" packageId={packageId} />
    </MemoryRouter>,
  );
}

const accountRow = () => screen.getByText('a_account').closest('tr')!;

describe('the package door pins its first draft save to its load (objectui#11773)', () => {
  it('no pending draft: the first autosave sends If-None-Match: *, read at the package the save writes', async () => {
    const server: Server = { draft: null, draftReads: [], savedOpts: [] };
    clientImpl = makeClient(server);
    renderDoor('app.a');
    await screen.findByText('a_account');

    fireEvent.click(within(accountRow()).getByRole('button', { name: 'None' }));
    await waitFor(() => expect(server.savedOpts).toHaveLength(1), AUTOSAVE);
    expect(server.savedOpts[0]).toMatchObject({ mode: 'draft', packageId: 'app.a', ifNoneMatch: '*' });
    expect(server.savedOpts[0]).not.toHaveProperty('ifMatch');
    expect(server.draftReads).toContainEqual(['permission', 'sales_perms', { packageId: 'app.a' }]);
  });

  it('a pending draft: the first autosave sends If-Match with the version the read served', async () => {
    const server: Server = { draft: { body: PUBLISHED, version: 'hmac-sha256:pending' }, draftReads: [], savedOpts: [] };
    clientImpl = makeClient(server);
    renderDoor('app.a');
    await screen.findByText('a_account');

    fireEvent.click(within(accountRow()).getByRole('button', { name: 'None' }));
    await waitFor(() => expect(server.savedOpts).toHaveLength(1), AUTOSAVE);
    expect(server.savedOpts[0]).toMatchObject({ mode: 'draft', packageId: 'app.a', ifMatch: 'hmac-sha256:pending' });
    expect(server.savedOpts[0]).not.toHaveProperty('ifNoneMatch');
  });

  it('control: the environment door reads no draft and its live Save carries no pin, as before', async () => {
    const server: Server = { draft: null, draftReads: [], savedOpts: [] };
    clientImpl = makeClient(server);
    renderDoor(undefined);
    await screen.findByText('a_account');

    fireEvent.click(within(accountRow()).getByRole('button', { name: 'None' }));
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));
    await waitFor(() => expect(server.savedOpts).toHaveLength(1));
    expect(server.savedOpts[0]).toEqual({ force: false });
    expect(server.draftReads).toEqual([]);
  });
});
