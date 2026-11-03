// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#29148 — the permission matrix's PACKAGE door takes a pending
 * draft the server refuses to read (`403 PERMISSION_DENIED`) for what it is,
 * never for "no draft". It installs no matrix over it: the published set is
 * not offered to edit, the refusal strip says why with the server's sentence
 * behind Details, and the autosave sends nothing, so the draft keeps every
 * change it holds. Both presentations: the routed page and the Studio Access
 * pillar's (`studio`).
 *
 * The client double refuses the draft read as the metadata client throws a
 * refused read (an `Error` carrying `status` and `code`), and resolves `null`
 * for no draft (the client's reading of a 404).
 */

import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { t } from './i18n';

const PUBLISHED = {
  name: 'sales_perms',
  label: 'Sales',
  objects: { a_account: { allowRead: true, allowCreate: true } },
  fields: {},
};
const LAYERED = { effective: PUBLISHED, code: null, overlay: null, overlayScope: null };
const GATE_REFUSAL = "You do not have permission to read the pending draft of 'sales_perms'.";

interface Server {
  /** The read refuses the pending draft as the read gate does. */
  refused: boolean;
  draftReads: unknown[][];
  savedOpts: Array<Record<string, unknown> | undefined>;
}

// `withPreviewDrafts` answers the client itself, not a promise (objectstack#26840).
type FakeClient = Record<string, (...args: never[]) => unknown>;

function makeClient(server: Server): FakeClient {
  return {
    layered: async () => LAYERED,
    getDraft: async (...args: unknown[]) => {
      server.draftReads.push(args);
      if (server.refused) {
        throw Object.assign(new Error(GATE_REFUSAL), {
          status: 403,
          code: 'PERMISSION_DENIED',
          body: { success: false, error: { code: 'PERMISSION_DENIED', message: GATE_REFUSAL } },
        });
      }
      return null;
    },
    withPreviewDrafts() {
      return this;
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

function renderDoor({ studio = false }: { studio?: boolean } = {}) {
  return render(
    <MemoryRouter>
      <PermissionMatrixEditPage
        type="permission"
        name="sales_perms"
        packageId="app.a"
        {...(studio ? { studio: { tab: 'objects' as const, onTabChange: () => {} } } : {})}
      />
    </MemoryRouter>,
  );
}

/** Longer than the autosave's debounce, so a save that was going to leave has left. */
async function pastTheAutosave() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 2500));
  });
}

async function expectRefusedAndHeld(server: Server) {
  // Red on base: the refusal was read as "no draft", and the published set
  // was installed as the matrix and offered to edit.
  const strip = await screen.findByTestId('perm-draft-unreadable', undefined, { timeout: 8000 });
  expect(strip).toHaveTextContent(t('engine.studio.refusal.draftUnreadable', 'en-US'));
  // The server's own sentence stays reachable, behind Details.
  expect(strip.querySelector('details')).toHaveTextContent(GATE_REFUSAL);
  expect(server.draftReads).toContainEqual(['permission', 'sales_perms', { packageId: 'app.a' }]);
  expect(screen.queryByText('a_account')).toBeNull();
  await pastTheAutosave();
  expect(server.savedOpts).toEqual([]);
}

describe('the package door opens no matrix over a draft the server refuses to read (objectstack#29148)', () => {
  it('the routed page: the strip says why, nothing is editable, and no save is sent', async () => {
    const server: Server = { refused: true, draftReads: [], savedOpts: [] };
    clientImpl = makeClient(server);
    renderDoor();
    await expectRefusedAndHeld(server);
  });

  it('the Studio Access pillar: the strip says why, nothing is editable, and no save is sent', async () => {
    const server: Server = { refused: true, draftReads: [], savedOpts: [] };
    clientImpl = makeClient(server);
    renderDoor({ studio: true });
    await expectRefusedAndHeld(server);
  });

  it('CONTROL: with no pending draft the published set opens, and an edit saves pinned to "no draft row"', async () => {
    const server: Server = { refused: false, draftReads: [], savedOpts: [] };
    clientImpl = makeClient(server);
    renderDoor();
    await screen.findByText('a_account', undefined, { timeout: 8000 });
    expect(screen.queryByTestId('perm-draft-unreadable')).toBeNull();

    const row = screen.getByText('a_account').closest('tr')!;
    fireEvent.click(within(row).getByRole('button', { name: 'None' }));
    await waitFor(() => expect(server.savedOpts).toHaveLength(1), AUTOSAVE);
    expect(server.savedOpts[0]).toMatchObject({ mode: 'draft', packageId: 'app.a', ifNoneMatch: '*' });
    expect(server.savedOpts[0]).not.toHaveProperty('ifMatch');
  });
});
