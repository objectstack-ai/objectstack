// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Setup → People & organization → Permission set assignment (ADR-0146 D7):
 * pick a permission set from the registry's catalog, then list, assign and
 * unassign its users through the section the set's own editor renders. The
 * picked set lives in the URL; a refused write is shown in the server's own
 * words, the delegated-administration gate's included.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

// The picker stands in as one button, rendered while it is open, that selects
// `pickedUsers` — the same `onSelectRecords` hand-off the real dialog makes.
vi.mock('@object-ui/fields', async (importOriginal) => {
  const { createElement } = await import('react');
  return {
    ...(await importOriginal<typeof import('@object-ui/fields')>()),
    RecordPickerDialog: (props: { open: boolean; onSelectRecords?: (records: unknown[]) => void }) =>
      props.open
        ? createElement('button', { type: 'button', onClick: () => props.onSelectRecords?.(pickedUsers) }, 'pick')
        : null,
  };
});
const pickedUsers = [{ id: 'u_new', name: 'New Nora' }];

const permissionSets = [
  { name: 'sales_user', label: 'Sales user' },
  { name: 'auditor_read', label: 'Auditor read' },
];
const positions = [{ name: 'sales_rep', label: 'Sales rep', permissionSets: ['sales_user'] }];

let data: Record<string, any[]> = {};
function resetData() {
  data = {
    sys_user_permission_set: [{ id: 'grant_1', permission_set: 'sales_user', user_id: 'u_direct' }],
    sys_user_position: [{ id: 'up_1', user_id: 'u_held', position: 'sales_rep' }],
    sys_user: [
      { id: 'u_direct', name: 'Direct Dana', email: 'dana@example.com' },
      { id: 'u_held', name: 'Held Henry', email: 'henry@example.com' },
      { id: 'u_new', name: 'New Nora', email: 'nora@example.com' },
    ],
  };
}

const adapter = {
  find: vi.fn(async (object: string, query: any) => {
    const rows = data[object] ?? [];
    const filter = query?.$filter ?? {};
    return rows.filter((r) =>
      Object.entries(filter).every(([k, v]: [string, any]) => {
        if (v && typeof v === 'object' && Array.isArray(v.$in)) return v.$in.includes(r[k]);
        return r[k] === v;
      }),
    );
  }),
  create: vi.fn(async (object: string, row: Record<string, unknown>) => {
    const created = { id: `grant_${(data[object]?.length ?? 0) + 10}`, ...row };
    data[object] = [...(data[object] ?? []), created];
    return created;
  }),
  delete: vi.fn(async (object: string, id: string) => {
    data[object] = (data[object] ?? []).filter((r) => r.id !== id);
    return {};
  }),
};

const metadata = {
  objects: [],
  ensureType: vi.fn(async (type: string) =>
    type === 'permission' ? permissionSets : type === 'position' ? positions : [],
  ),
  getTypeStatus: vi.fn(() => 'ready' as const),
  refresh: vi.fn(async () => {}),
};
vi.mock('@object-ui/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => adapter,
  useMetadata: () => metadata,
}));

import { PermissionSetAssignmentPage } from './PermissionSetAssignmentPage';

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.search}</output>;
}

function renderPage(search = '') {
  return render(
    <MemoryRouter initialEntries={[`/apps/setup/component/security/permission-set-assignment${search}`]}>
      <PermissionSetAssignmentPage />
      <LocationProbe />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  resetData();
  adapter.find.mockClear();
  adapter.create.mockClear();
  adapter.delete.mockClear();
  metadata.ensureType.mockClear();
});

afterEach(cleanup);

describe('Setup → Permission set assignment', () => {
  it('lists the catalog permission sets and asks for a pick before reading any grant', async () => {
    renderPage();
    const list = await screen.findByRole('list', { name: 'Permission sets' });
    expect(within(list).getByRole('button', { name: /Sales user/ })).toBeInTheDocument();
    expect(within(list).getByRole('button', { name: /Auditor read/ })).toBeInTheDocument();
    expect(screen.getByTestId('setup-permission-set-assignment-pick')).toBeInTheDocument();
    expect(metadata.ensureType).toHaveBeenCalledWith('permission');
    expect(adapter.find).not.toHaveBeenCalled();
  });

  it('picking a set puts it in the URL and lists its direct and position-held users', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Sales user/ }));
    expect(screen.getByTestId('location')).toHaveTextContent('?set=sales_user');
    expect(await screen.findByText('Direct Dana')).toBeInTheDocument();
    expect(screen.getByText('Held Henry')).toBeInTheDocument();
  });

  it('assigns a user by the set name and the list reads it back', async () => {
    renderPage('?set=sales_user');
    await screen.findByText('Direct Dana');
    fireEvent.click(screen.getByRole('button', { name: 'Add user' }));
    fireEvent.click(await screen.findByRole('button', { name: 'pick' }));
    await waitFor(() =>
      expect(adapter.create).toHaveBeenCalledWith('sys_user_permission_set', {
        user_id: 'u_new',
        permission_set: 'sales_user',
      }),
    );
    expect(await screen.findByText('New Nora')).toBeInTheDocument();
  });

  it('unassigns a direct grant after the confirm and the list reads it gone', async () => {
    renderPage('?set=sales_user');
    await screen.findByText('Direct Dana');
    fireEvent.click(screen.getByLabelText('Remove'));
    fireEvent.click(await screen.findByTestId('assigned-user-remove-confirm'));
    await waitFor(() => expect(adapter.delete).toHaveBeenCalledWith('sys_user_permission_set', 'grant_1'));
    await waitFor(() => expect(screen.queryByText('Direct Dana')).toBeNull());
    // The holder through a position stays: a position's holder is not unassigned here.
    expect(screen.getByText('Held Henry')).toBeInTheDocument();
  });

  it("shows a delegated administrator's out-of-scope refusal verbatim", async () => {
    // The delegated-administration gate's refusal as the server throws it; the
    // console shows its sentence without the `[Security] ` machine prefix, as
    // every write refusal is read (`extractWriteErrorMessage`).
    const sentence = "Outside your delegated scope: granting permission set 'sales_user' — the row belongs to organization 'org_b', not the one you administer.";
    const refusal = Object.assign(new Error(`[Security] ${sentence}`), {
      code: 'DELEGATION_SCOPE_VIOLATION',
      httpStatus: 403,
    });
    adapter.create.mockRejectedValueOnce(refusal);
    renderPage('?set=sales_user');
    await screen.findByText('Direct Dana');
    fireEvent.click(screen.getByRole('button', { name: 'Add user' }));
    fireEvent.click(await screen.findByRole('button', { name: 'pick' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(sentence);
    expect(screen.queryByText('New Nora')).toBeNull();
  });
});
