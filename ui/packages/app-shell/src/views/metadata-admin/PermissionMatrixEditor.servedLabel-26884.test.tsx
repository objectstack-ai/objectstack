// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#26884 — the permission-set header names the set by the label
 * the published list serves. `GET /meta/permission` is localized at the REST
 * boundary (the server's permission-set translator), so under zh-CN Setup →
 * 权限集 lists the set as 销售代表; the layered read the editor's draft is
 * built from carries the authored text, and the header used to print that —
 * "Sales Representative" on a zh-CN page.
 *
 * The served label is display only: a save sends the authored label back
 * unchanged, a set the list does not hold keeps its draft label, and an edit
 * to the label shows the edit.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

interface Server {
  set: Record<string, unknown>;
  served: Array<Record<string, unknown>>;
  saved: Array<Record<string, unknown>>;
}

function freshServer(served: Array<Record<string, unknown>>): Server {
  return {
    saved: [],
    served,
    set: {
      name: 'sales_rep',
      label: 'Sales Representative',
      objects: { a_account: { allowRead: true, allowCreate: true } },
      fields: {},
    },
  };
}

function makeClient(server: Server) {
  return {
    layered: async () => ({ effective: server.set, code: null, overlay: null, overlayScope: null }),
    getDraft: async () => null,
    list: async (type: string) => {
      if (type === 'object') return [{ item: { name: 'a_account' } }];
      if (type === 'permission') return server.served;
      return [];
    },
    get: async (type: string) => (type === 'object' ? { fields: [{ name: 'name', label: 'Name' }] } : null),
    save: async (_t: string, _n: string, payload: Record<string, unknown>) => {
      server.saved.push(payload);
      server.set = payload;
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

let localeFixture: 'zh-CN' | 'ja-JP' = 'zh-CN';
vi.mock('./i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataLocale: () => localeFixture,
}));

vi.mock('./AssignedUsersSection', () => ({ AssignedUsersSection: () => null }));

import { PermissionMatrixEditPage } from './PermissionMatrixEditor';

// The editor's `perm.*` rows live in `@object-ui/i18n`'s `studio` namespace,
// whose `zh` catalogue is fetched on demand (objectstack#25922). Resident
// before any case, so the zh chrome reads synchronously.
import { loadStudioCatalogue } from '@object-ui/i18n/namespaces/studio';
await loadStudioCatalogue('zh');

afterEach(() => {
  cleanup();
  localeFixture = 'zh-CN';
});

function renderSet() {
  return render(
    <MemoryRouter>
      <PermissionMatrixEditPage type="permission" name="sales_rep" packageId="app.a" />
    </MemoryRouter>,
  );
}

describe('PermissionMatrixEditPage — header shows the served label (objectstack#26884)', () => {
  it('zh-CN: the header reads the served 销售代表, and a save keeps the authored label', async () => {
    const server = freshServer([{ name: 'sales_rep', label: '销售代表' }]);
    clientImpl = makeClient(server);
    renderSet();

    expect(await screen.findByText('销售代表')).toBeInTheDocument();
    expect(screen.queryByText('Sales Representative')).toBeNull();

    // Any matrix edit → the autosave sends the draft (objectui#11787).
    const row = screen.getByText('a_account').closest('tr')!;
    fireEvent.click(within(row).getByRole('button', { name: /None|无/ }));
    await waitFor(() => expect(server.saved).toHaveLength(1), { timeout: 4000 });
    expect(server.saved[0].label).toBe('Sales Representative');
    // The header still names the set by the served label after the save.
    expect(screen.getByText('销售代表')).toBeInTheDocument();
  });

  it('ja-JP: the header reads the label the served row carries', async () => {
    localeFixture = 'ja-JP';
    clientImpl = makeClient(freshServer([{ name: 'sales_rep', label: '営業担当' }]));
    renderSet();

    expect(await screen.findByText('営業担当')).toBeInTheDocument();
    expect(screen.queryByText('Sales Representative')).toBeNull();
  });

  it('a set the published list does not hold keeps its draft label', async () => {
    clientImpl = makeClient(freshServer([{ name: 'other_set', label: '其他' }]));
    renderSet();

    expect(await screen.findByText('Sales Representative')).toBeInTheDocument();
  });

  it('an edit to the label shows the edit, not the served label', async () => {
    clientImpl = makeClient(freshServer([{ name: 'sales_rep', label: '销售代表' }]));
    renderSet();

    fireEvent.click(await screen.findByRole('button', { name: /销售代表/ }));
    fireEvent.change(screen.getByDisplayValue('Sales Representative'), { target: { value: 'Field Sales' } });
    expect(screen.getByText('Field Sales')).toBeInTheDocument();
    expect(screen.queryByText('销售代表')).toBeNull();
  });
});
