// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PermissionMatrixEditPage `onDirtyChange` contract — the hook the Studio
 * Access pillar's unsaved-changes guard hangs on. The pillar keys this page
 * per set (`key={current}`), so a rail switch REMOUNTS it; the host can only
 * warn before discarding edits if the editor reports its dirty state up:
 *
 *   • clean after the initial load,
 *   • dirty as soon as a matrix cell changes,
 *   • clean again after a successful save (draft becomes the new baseline) —
 *     on this door the save is the autosave (objectui#11787),
 *   • reset to false on unmount (a confirmed discard must clear the guard).
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

let clientImpl: any;

vi.mock('./useMetadata', () => ({
  useMetadataClient: () => clientImpl,
  useMetadataTypes: () => ({
    loading: false,
    error: null,
    entries: [{ type: 'permission', label: 'Permission', allowEnvironmentOverlay: true }],
  }),
}));

import { PermissionMatrixEditPage } from './PermissionMatrixEditor';

afterEach(cleanup);

interface Server {
  set: Record<string, unknown>;
  saved: Array<Record<string, unknown>>;
}

function freshServer(): Server {
  return {
    saved: [],
    set: {
      name: 'sales_perms',
      label: 'Sales',
      objects: {
        a_account: { allowRead: true, allowCreate: true },
      },
      fields: {},
    },
  };
}

function makeClient(server: Server) {
  return {
    layered: async () => ({
      effective: server.set,
      code: null,
      overlay: null,
      overlayScope: null,
    }),
    getDraft: async () => null,
    list: async (type: string) => {
      if (type === 'object') return [{ item: { name: 'a_account' } }];
      return [];
    },
    get: async (type: string) =>
      type === 'object' ? { fields: [{ name: 'name', label: 'Name' }] } : null,
    save: async (_t: string, _n: string, payload: Record<string, unknown>) => {
      server.saved.push(payload);
      server.set = payload;
      return payload;
    },
  } as any;
}

function renderMatrix(onDirtyChange: (dirty: boolean) => void) {
  return render(
    <MemoryRouter>
      <PermissionMatrixEditPage
        type="permission"
        name="sales_perms"
        packageId="app.a"
        onDirtyChange={onDirtyChange}
      />
    </MemoryRouter>,
  );
}

describe('PermissionMatrixEditPage — onDirtyChange', () => {
  it('reports clean on load, dirty on edit, clean again after save', async () => {
    const server = freshServer();
    clientImpl = makeClient(server);
    const onDirtyChange = vi.fn();
    renderMatrix(onDirtyChange);

    await screen.findByText('a_account');
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);

    // Any matrix mutation flips the report to dirty.
    const row = screen.getByText('a_account').closest('tr')!;
    fireEvent.click(within(row).getByRole('button', { name: 'None' }));
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);

    // The save re-anchors the baseline — clean again, no reload needed. On
    // this door the save is the autosave, after its pause (objectui#11787).
    await waitFor(() => expect(server.saved).toHaveLength(1), { timeout: 4000 });
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
  });

  it('resets the report to false on unmount (discard must clear the guard)', async () => {
    const server = freshServer();
    clientImpl = makeClient(server);
    const onDirtyChange = vi.fn();
    const view = renderMatrix(onDirtyChange);

    await screen.findByText('a_account');
    const row = screen.getByText('a_account').closest('tr')!;
    fireEvent.click(within(row).getByRole('button', { name: 'None' }));
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);

    // The host remounts this page (key switch) after a confirmed discard —
    // the outgoing instance must not leave the guard armed.
    view.unmount();
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });
});
