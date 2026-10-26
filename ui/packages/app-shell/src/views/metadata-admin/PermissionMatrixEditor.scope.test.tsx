// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0086 P0 — closed-loop integration test for the package-scoped Access
 * matrix. Drives the REAL `PermissionMatrixEditPage` (load effect + doSave)
 * against a fake metadata client that behaves like the server:
 *
 *   • `list('object', { packageId })` returns only the package's objects, and
 *   • `layered()` reflects the last saved payload (so "reopen" reads it back).
 *
 * It proves both directions the issue asks for:
 *   1. Opening package A's panel shows ONLY package A's objects (no
 *      environment leak — package B's `b_order` never appears).
 *   2. Editing + saving in package A writes back a merged payload in which
 *      package B's row survives byte-for-byte.
 *   3. Reopening still shows only package A's slice.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// ── Server state shared with the mocked client ──────────────────────────────
interface Server {
  set: Record<string, unknown>;
  packageObjects: Array<{ name: string; label?: string }>;
  // Keyed by object name → the merged object definition returned by
  // get('object', name). `fields` may be an array or a `{ [name]: def }` map.
  objectFields: Record<string, { fields?: unknown } | undefined>;
  saved: Array<Record<string, unknown>>;
  savedOpts: Array<Record<string, unknown> | undefined>;
}

function makeClient(server: Server) {
  return {
    layered: async () => ({
      effective: server.set,
      code: null,
      overlay: null,
      overlayScope: null,
    }),
    // ADR-0086 P2: the package door reads any pending draft first. This fixture
    // models the published baseline only (no pending draft) → null.
    getDraft: async () => null,
    list: async (type: string, opts?: { packageId?: string }) => {
      if (type === 'object') {
        // The server scopes to the package — the panel must not see anything
        // outside `server.packageObjects` regardless of what the set contains.
        void opts;
        return server.packageObjects.map((o) => ({ item: o }));
      }
      // The field-level editor no longer lists the `field` type; it reads the
      // merged object definition via get('object', name). A bare list('field')
      // returning [] would reproduce the "no fields" bug this suite guards.
      return [];
    },
    get: async (type: string, name: string) => {
      // Mirror `GET /api/v1/meta/object/<name>` — the merged definition whose
      // `fields` reflect the published object (inline + standalone fields).
      if (type === 'object') return server.objectFields[name] ?? null;
      return null;
    },
    save: async (_type: string, _name: string, payload: Record<string, unknown>, opts?: Record<string, unknown>) => {
      server.saved.push(payload);
      server.savedOpts.push(opts);
      server.set = payload; // becomes the new effective (reopen reads this)
      return payload;
    },
  } as any;
}

let clientImpl: any;

vi.mock('./useMetadata', () => ({
  useMetadataClient: () => clientImpl,
  useMetadataTypes: () => ({
    loading: false,
    error: null,
    entries: [{ type: 'permission', label: 'Permission', allowEnvironmentOverlay: true }],
  }),
}));

// AssignedUsersSection makes its own adapter calls — irrelevant here.
vi.mock('./AssignedUsersSection', () => ({ AssignedUsersSection: () => null }));

import { PermissionMatrixEditPage } from './PermissionMatrixEditor';

afterEach(cleanup);

function freshServer(): Server {
  return {
    packageObjects: [{ name: 'a_account' }, { name: 'a_contact' }],
    // a_account carries its fields inline on the published object definition
    // (array form); a_contact uses the keyed-map form. Both must surface.
    objectFields: {
      a_account: {
        fields: [
          { name: 'name', label: 'Name' },
          { name: 'industry', label: 'Industry' },
        ],
      },
      a_contact: {
        fields: {
          email: { label: 'Email' },
          phone: { label: 'Phone' },
        },
      },
    },
    saved: [],
    savedOpts: [],
    set: {
      name: 'sales_perms',
      label: 'Sales',
      isProfile: false,
      systemPermissions: ['api_enabled'],
      objects: {
        a_account: { allowRead: true, allowCreate: true },
        a_contact: { allowRead: true },
        // Package B's row — must never appear, must survive saves.
        b_order: { allowRead: true, allowEdit: true, viewAllRecords: true },
      },
      fields: { 'b_order.total': { readable: true, editable: true } },
    },
  };
}

function renderMatrix() {
  return render(
    <MemoryRouter>
      <PermissionMatrixEditPage type="permission" name="sales_perms" packageId="app.a" />
    </MemoryRouter>,
  );
}

describe('PermissionMatrixEditPage — package scope + slice merge (ADR-0086 P0)', () => {
  it('lists only the package objects, then merges the slice on save', async () => {
    const server = freshServer();
    clientImpl = makeClient(server);
    const view = renderMatrix();

    // 1) Only package A's objects are listed — no 84-object leak.
    await screen.findByText('a_account');
    expect(screen.getByText('a_contact')).toBeInTheDocument();
    expect(screen.queryByText('b_order')).not.toBeInTheDocument();

    // 2) Edit package A: clear a_account's grants via its row "None" button.
    const row = screen.getByText('a_account').closest('tr')!;
    fireEvent.click(within(row).getByRole('button', { name: 'None' }));

    // 3) Save — the package door autosaves the edit to its draft after the
    // shared autosave's pause (objectui#11787); it has no Save button.
    await waitFor(() => expect(server.saved).toHaveLength(1), { timeout: 4000 });

    const saved = server.saved[0] as any;
    // Package B's contributed rows are preserved byte-for-byte.
    expect(saved.objects.b_order).toEqual({
      allowRead: true,
      allowEdit: true,
      viewAllRecords: true,
    });
    expect(saved.fields['b_order.total']).toEqual({ readable: true, editable: true });
    // Package A's edit landed; a_contact (untouched, in-scope) retained.
    expect(saved.objects.a_account).toEqual({});
    expect(saved.objects.a_contact).toEqual({ allowRead: true });
    // Set-level identity/extras carried through from the fresh base.
    expect(saved.systemPermissions).toEqual(['api_enabled']);
    // ADR-0086 P2 (D6): the package door writes a DRAFT stamped with the
    // package — not a live record — so the package Publish promotes it.
    expect(server.savedOpts[0]).toMatchObject({ mode: 'draft', packageId: 'app.a' });

    view.unmount();

    // 4) Reopen against the same (now-saved) server: still scoped to A.
    clientImpl = makeClient(server);
    renderMatrix();
    await screen.findByText('a_account');
    expect(screen.queryByText('b_order')).not.toBeInTheDocument();
    // The saved server state still carries package B's row.
    expect((server.set as any).objects.b_order).toEqual({
      allowRead: true,
      allowEdit: true,
      viewAllRecords: true,
    });
  });

  // Regression: expanding an object row for field-level read/write must list
  // the object's published fields (read via get('object', name)) — not fall
  // back to "no fields" because list('field') was empty.
  it('lists an object\'s published fields when its row is expanded', async () => {
    const server = freshServer();
    clientImpl = makeClient(server);
    renderMatrix();

    // Expand a_account (fields provided as an array on the object def).
    const accountToggle = await screen.findByRole('button', { name: /a_account/ });
    fireEvent.click(accountToggle);

    // Both inline fields surface with their labels — never "no fields".
    await screen.findByLabelText('a_account.name readable');
    expect(screen.getByLabelText('a_account.name editable')).toBeInTheDocument();
    expect(screen.getByLabelText('a_account.industry readable')).toBeInTheDocument();
    expect(
      screen.queryByText('No fields registered for this object.'),
    ).not.toBeInTheDocument();

    // Expand a_contact (fields provided as a keyed map) — same outcome.
    fireEvent.click(screen.getByRole('button', { name: /a_contact/ }));
    await screen.findByLabelText('a_contact.email readable');
    expect(screen.getByLabelText('a_contact.phone editable')).toBeInTheDocument();
  });
});

describe('PermissionMatrixEditor — private posture badge (ADR-0066 ④)', () => {
  it('shows a Private badge only on rows whose object declares access.default=private', async () => {
    const server = freshServer();
    server.packageObjects = [
      { name: 'a_account', label: 'Account', access: { default: 'private' } } as any,
      { name: 'a_contact' },
    ];
    clientImpl = makeClient(server);
    renderMatrix();

    await screen.findByText('Account');
    // The private object's row carries the badge (with the wildcard hint)…
    // (every row also shows an ADR-0090 OWD badge, so match the exact posture
    // badge text, not the substring)
    const badges = screen.getAllByText('Private', { exact: true });
    expect(badges).toHaveLength(1);
    expect(badges[0].closest('tr')!.textContent).toContain('a_account');
    expect(badges[0]).toHaveAttribute('title', expect.stringContaining('wildcard'));
    // …and the public row does not carry the posture badge.
    const contactRow = screen.getByText('a_contact').closest('tr')!;
    expect(within(contactRow).queryByText('Private', { exact: true })).toBeNull();
  });

  it('shows an OWD badge on every row (authored value or the D1 private default)', async () => {
    const server = freshServer();
    server.packageObjects = [
      { name: 'a_account', label: 'Account', sharingModel: 'public_read' } as any,
      { name: 'a_contact' },
    ];
    clientImpl = makeClient(server);
    renderMatrix();

    await screen.findByText('Account');
    // An authored OWD renders its value…
    const accountRow = screen.getByText('Account').closest('tr')!;
    expect(accountRow.textContent).toContain('OWD Public read');
    // …an unset OWD renders the fail-closed D1 default.
    const contactRow = screen.getByText('a_contact').closest('tr')!;
    expect(contactRow.textContent).toContain('OWD Private (default)');
  });
});
