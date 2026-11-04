// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * An object permission that edits or deletes a record also reads it, and the
 * permission set editor authors only that shape: the spec refuses an entry
 * granting `allowEdit` or `allowDelete` without read, so the matrix never
 * hands the save door one.
 *
 *  - Ticking Edit or Delete ticks Read.
 *  - Unticking Read unticks Edit and Delete — unless View All or Modify All
 *    still grants the read, where the entry stays valid as it is (and clearing
 *    Delete beside Modify All would author the pair the spec refuses).
 *
 * Every assertion reads the SAVED payload, the only thing either save door
 * persists.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PermissionSetSchema } from '@objectstack/spec/security';

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

describe('an object permission that edits or deletes a record also reads it', () => {
  for (const [bit, label] of [['allowEdit', 'Edit'], ['allowDelete', 'Delete']] as const) {
    it(`ticking ${label} on a row without read ticks Read too`, async () => {
      const server = await renderSet({ crm_case: {} });
      expect(screen.getByLabelText('crm_case Read').getAttribute('data-state')).toBe('unchecked');

      fireEvent.click(screen.getByLabelText(`crm_case ${label}`));
      expect(screen.getByLabelText('crm_case Read').getAttribute('data-state')).toBe('checked');
      const payload = await save(server);
      expect(payload.objects.crm_case).toEqual({ [bit]: true, allowRead: true });
      expect(PermissionSetSchema.safeParse(payload).success).toBe(true);
    });
  }

  it('unticking Read unticks Edit and Delete', async () => {
    const server = await renderSet({ crm_case: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } });

    fireEvent.click(screen.getByLabelText('crm_case Read'));
    expect(screen.getByLabelText('crm_case Edit').getAttribute('data-state')).toBe('unchecked');
    expect(screen.getByLabelText('crm_case Delete').getAttribute('data-state')).toBe('unchecked');
    const payload = await save(server);
    // Create is not part of the rule and keeps its value.
    expect(payload.objects.crm_case).toEqual({ allowRead: false, allowCreate: true, allowEdit: false, allowDelete: false });
    expect(PermissionSetSchema.safeParse(payload).success).toBe(true);
  });

  it('unticking Read on a row that grants neither writes neither key in', async () => {
    const server = await renderSet({ crm_case: { allowRead: true } });
    fireEvent.click(screen.getByLabelText('crm_case Read'));
    const payload = await save(server);
    expect(payload.objects.crm_case).toEqual({ allowRead: false });
  });

  it('unticking Read beside Modify All keeps Edit and Delete: the bypass still reads', async () => {
    const server = await renderSet({
      crm_case: { allowRead: true, allowEdit: true, allowDelete: true, viewAllRecords: true, modifyAllRecords: true },
    });
    fireEvent.click(within(row('crm_case')).getByLabelText('crm_case Read'));
    const payload = await save(server);
    expect(payload.objects.crm_case).toMatchObject({ allowRead: false, allowEdit: true, allowDelete: true, modifyAllRecords: true });
    expect(PermissionSetSchema.safeParse(payload).success).toBe(true);
  });
});
