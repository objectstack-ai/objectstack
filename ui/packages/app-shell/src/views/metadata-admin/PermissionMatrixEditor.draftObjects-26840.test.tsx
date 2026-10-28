// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#26840 — the package door's Access matrix lists the package's
 * DRAFT objects too, so a new package can be secured before its first
 * publish.
 *
 * The fake client behaves like the server's two reads of one package:
 *
 *   • the published door (`list` / `get`) knows only the published object;
 *   • the draft-overlaid door (`withPreviewDrafts(true)`, `?preview=draft`)
 *     also serves each pending draft, with its `_draft` mark.
 *
 * The draft-only row carries the object picker's draft mark, its fields come
 * from its draft, and its grants write into the set's draft. The environment
 * door keeps the published list and its rows carry no mark.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

interface Server {
  set: Record<string, unknown>;
  saved: Array<Record<string, unknown>>;
  savedOpts: Array<Record<string, unknown> | undefined>;
  listCalls: Array<{ preview: boolean; opts?: Record<string, unknown> }>;
}

const PUBLISHED = { name: 'a_account', label: 'Account', fields: { name: { label: 'Name' } } };
const DRAFT_ONLY = {
  name: 'a_invoice',
  label: 'Invoice',
  fields: { amount: { label: 'Amount' } },
  _draft: true,
  _packageId: 'app.a',
};

function makeClient(server: Server, preview = false): any {
  return {
    withPreviewDrafts: (on: boolean) => makeClient(server, on),
    layered: async () => ({ effective: server.set, code: null, overlay: null, overlayScope: null }),
    getDraft: async () => null,
    list: async (type: string, opts?: Record<string, unknown>) => {
      if (type !== 'object') return [];
      server.listCalls.push({ preview, opts });
      return preview ? [PUBLISHED, DRAFT_ONLY] : [PUBLISHED];
    },
    get: async (type: string, name: string) => {
      if (type !== 'object') return null;
      if (name === PUBLISHED.name) return PUBLISHED;
      // A draft-only object has no published definition.
      return preview && name === DRAFT_ONLY.name ? DRAFT_ONLY : null;
    },
    save: async (_type: string, _name: string, payload: Record<string, unknown>, opts?: Record<string, unknown>) => {
      server.saved.push(payload);
      server.savedOpts.push(opts);
      server.set = payload;
      return payload;
    },
  };
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

vi.mock('./AssignedUsersSection', () => ({ AssignedUsersSection: () => null }));

import { PermissionMatrixEditPage } from './PermissionMatrixEditor';

afterEach(cleanup);

function freshServer(): Server {
  return {
    set: { name: 'sales_perms', label: 'Sales', objects: {}, fields: {} },
    saved: [],
    savedOpts: [],
    listCalls: [],
  };
}

function renderMatrix(opts: { packageId?: string; studio?: boolean } = {}) {
  return render(
    <MemoryRouter>
      <PermissionMatrixEditPage
        type="permission"
        name="sales_perms"
        packageId={opts.packageId}
        studio={opts.studio ? { tab: 'objects', onTabChange: () => {} } : undefined}
      />
    </MemoryRouter>,
  );
}

const rowOf = (text: string) => screen.getByText(text).closest('tr')!;
const draftMarks = (row: HTMLElement) => row.querySelectorAll('[data-draft-marker]');

describe('PermissionMatrixEditPage — draft objects at the package door (objectstack#26840)', () => {
  it('lists a draft-only object badged as a draft, and a published one without the badge', async () => {
    clientImpl = makeClient(freshServer());
    renderMatrix({ packageId: 'app.a' });

    await screen.findByText('Invoice');
    const invoiceMarks = draftMarks(rowOf('Invoice'));
    expect(invoiceMarks).toHaveLength(1);
    expect(invoiceMarks[0]).toHaveTextContent('(draft)');
    expect(draftMarks(rowOf('Account'))).toHaveLength(0);
  });

  it('badges the draft-only row in the Studio layout too', async () => {
    clientImpl = makeClient(freshServer());
    renderMatrix({ packageId: 'app.a', studio: true });

    await screen.findByText('Invoice');
    expect(draftMarks(rowOf('Invoice'))).toHaveLength(1);
    expect(draftMarks(rowOf('Account'))).toHaveLength(0);
  });

  it("writes the draft-only object's grants into the set's draft", async () => {
    const server = freshServer();
    clientImpl = makeClient(server);
    renderMatrix({ packageId: 'app.a' });

    await screen.findByText('Invoice');
    fireEvent.click(within(rowOf('Invoice')).getByLabelText('a_invoice Read'));

    await waitFor(() => expect(server.saved).toHaveLength(1), { timeout: 4000 });
    expect((server.saved[0] as any).objects.a_invoice).toMatchObject({ allowRead: true });
    expect(server.savedOpts[0]).toMatchObject({ mode: 'draft', packageId: 'app.a' });
  });

  it("reads a draft-only object's fields from its draft", async () => {
    clientImpl = makeClient(freshServer());
    renderMatrix({ packageId: 'app.a' });

    fireEvent.click(await screen.findByRole('button', { name: /a_invoice/ }));
    await screen.findByLabelText('a_invoice.amount readable');
  });
});

describe('PermissionMatrixEditPage — environment door (objectstack#26840)', () => {
  it('keeps the published list: no preview read, no draft rows, no badge', async () => {
    const server = freshServer();
    clientImpl = makeClient(server);
    renderMatrix();

    await screen.findByText('Account');
    expect(screen.queryByText('Invoice')).not.toBeInTheDocument();
    expect(document.querySelectorAll('[data-draft-marker]')).toHaveLength(0);
    expect(server.listCalls.length).toBeGreaterThan(0);
    expect(server.listCalls.every((c) => !c.preview)).toBe(true);
  });
});
