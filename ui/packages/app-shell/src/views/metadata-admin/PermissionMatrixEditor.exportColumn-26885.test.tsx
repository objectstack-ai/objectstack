// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#26885 — the permission-set editor shows every axis the set
 * carries, Export included, and the Setup page's Assigned Users panel no
 * longer takes the grid's height.
 *
 *  - Export (`allowExport`) is a column on both renderings — the routed page's
 *    table and the Studio Access pillar's Objects tab — found by its header
 *    and toggled like Transfer; the saved payload carries the bit.
 *  - Export is an opt-in, high-privilege grant (`@objectstack/spec`
 *    `security/high-privilege.ts`), so the granting bulk buttons leave it as
 *    it is: "All" does not grant it, and none of them clears it. "None" still
 *    empties the whole row (pinned in `PermissionMatrixEditor.bulkMergeKeys`).
 *  - Assigned Users renders in the matrix's own scroll, after the grid, not
 *    as a strip pinned under it.
 *
 * Every grant assertion reads the SAVED payload, the only thing either save
 * door persists.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

interface FakeServer {
  set: Record<string, any>;
  saved: Record<string, any> | null;
}

function makeClient(server: FakeServer) {
  return {
    layered: async () => ({ effective: server.set, code: null, overlay: null, overlayScope: null }),
    getDraft: async () => null,
    list: async (type: string) =>
      type === 'object' ? Object.keys(server.set.objects).map((name) => ({ item: { name } })) : [],
    get: async (type: string) => (type === 'object' ? { fields: [] } : null),
    save: async (_t: string, _n: string, payload: Record<string, any>) => {
      server.saved = payload;
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
vi.mock('./AssignedUsersSection', () => ({
  AssignedUsersSection: () => <div data-testid="assigned-users-stub" />,
}));
vi.mock('@object-ui/fields', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/fields')>()),
  CapabilityMultiSelectField: () => <div data-testid="cap-picker" />,
  parseCapabilityNames: (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : []),
}));

import { PermissionMatrixEditPage } from './PermissionMatrixEditor';

afterEach(cleanup);

async function renderSet(
  objects: Record<string, unknown>,
  opts: { search?: string; studio?: boolean } = {},
): Promise<FakeServer> {
  const server: FakeServer = { set: { name: 'sales_rep', label: 'Sales Rep', objects, fields: {} }, saved: null };
  clientImpl = makeClient(server);
  render(
    <MemoryRouter initialEntries={[`/apps/setup/metadata/permission/sales_rep${opts.search ?? ''}`]}>
      <PermissionMatrixEditPage
        type="permission"
        name="sales_rep"
        studio={opts.studio ? { tab: 'objects', onTabChange: () => {} } : undefined}
      />
    </MemoryRouter>,
  );
  await screen.findByText('crm_case');
  return server;
}

/** Click Save and return the payload the client was handed. */
async function save(server: FakeServer) {
  fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));
  await waitFor(() => expect(server.saved).not.toBeNull());
  return server.saved!;
}

function row(objectName: string) {
  const found = screen.getAllByRole('row').find((r) => within(r).queryByText(objectName) != null);
  expect(found, `row for ${objectName}`).toBeTruthy();
  return found!;
}

describe('the Export column (objectstack#26885)', () => {
  it('has a header, between Delete and Transfer, as the position summary orders it', async () => {
    await renderSet({ crm_case: { allowRead: true } });
    const headers = screen.getAllByRole('columnheader').map((th) => th.textContent?.trim() ?? '');
    const e = headers.indexOf('E');
    expect(e).toBeGreaterThan(0);
    expect(headers[e - 1]).toBe('D');
    expect(headers[e + 1]).toBe('Tr');
    expect(screen.getAllByRole('columnheader')[e].getAttribute('title')).toBe('Export records');
  });

  it('shows a stored grant, and unticking it saves allowExport: false', async () => {
    const server = await renderSet({ crm_case: { allowRead: true, allowExport: true } });
    const box = screen.getByLabelText('crm_case Export records');
    expect(box.getAttribute('data-state')).toBe('checked');

    fireEvent.click(box);
    const payload = await save(server);
    expect(payload.objects.crm_case).toEqual({ allowRead: true, allowExport: false });
  });

  it('ticking it saves allowExport: true and nothing else', async () => {
    const server = await renderSet({ crm_case: { allowRead: true } });
    const box = screen.getByLabelText('crm_case Export records');
    expect(box.getAttribute('data-state')).toBe('unchecked');

    fireEvent.click(box);
    const payload = await save(server);
    expect(payload.objects.crm_case).toEqual({ allowRead: true, allowExport: true });
  });

  it('the Studio Objects tab has the column too, with its legend entry', async () => {
    const server = await renderSet({ crm_case: { allowRead: true } }, { studio: true });
    const matrix = screen.getByTestId('perm-studio-matrix');
    const headers = within(matrix).getAllByRole('columnheader').map((th) => th.textContent?.trim() ?? '');
    expect(headers).toContain('E');
    expect(within(screen.getByTestId('perm-objects-toolbar')).getByText('Export')).toBeTruthy();

    fireEvent.click(within(matrix).getByLabelText('crm_case Export records'));
    const payload = await save(server);
    expect(payload.objects.crm_case.allowExport).toBe(true);
  });
});

describe('the bulk buttons leave Export as it is (objectstack#26885)', () => {
  const bulk = (label: string) => within(row('crm_case')).getByRole('button', { name: new RegExp(`^${label}$`) });

  it('"All" grants every other column but not Export, and says so on the button', async () => {
    const server = await renderSet({ crm_case: { allowRead: true } });
    expect(bulk('All').getAttribute('title')).toMatch(/except Export/);

    fireEvent.click(bulk('All'));
    const payload = await save(server);
    expect(payload.objects.crm_case).toEqual({
      allowCreate: true,
      allowRead: true,
      allowEdit: true,
      allowDelete: true,
      allowTransfer: true,
      viewAllRecords: true,
      modifyAllRecords: true,
    });
  });

  for (const label of ['R', 'CRUD', 'All']) {
    it(`"${label}" keeps a granted Export ticked`, async () => {
      const server = await renderSet({ crm_case: { allowRead: true, allowExport: true } });
      fireEvent.click(bulk(label));
      expect(screen.getByLabelText('crm_case Export records').getAttribute('data-state')).toBe('checked');
      const payload = await save(server);
      expect(payload.objects.crm_case.allowExport).toBe(true);
    });
  }
});

describe('Assigned Users does not take the grid’s height (objectstack#26885)', () => {
  it('renders in the matrix’s own scroll, after the grid', async () => {
    await renderSet({ crm_case: { allowRead: true } }, { search: '?scope=environment' });
    const panel = screen.getByTestId('perm-assignments');
    const table = screen.getByRole('table');
    // The table's parent is the matrix's scroll box: the panel scrolls with
    // the grid instead of standing beside it as a fixed-height strip.
    const scroller = table.parentElement!;
    expect(scroller.className).toMatch(/\boverflow-auto\b/);
    expect(scroller.contains(panel)).toBe(true);
    expect(table.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Control: the panel is the Setup scope's — the stub really mounted in it.
    expect(within(panel).getByTestId('assigned-users-stub')).toBeTruthy();
  });
});
