// Copyright (c) 2026 ObjectStack. Licensed under the MIT license.
//
// objectui#2382 — the 已分配用户 section must count EFFECTIVE holders:
// direct grants ∪ holders of every position bound to the set. A
// direct-grants-only list told the admin "0 users" for any
// normally-administered set (positions are THE distribution channel in
// ADR-0090), right before they edit or delete it.
//
// objectui#7611 — by NAME, against the registry: grants are read by their
// `permission_set` name column, and the positions that distribute the set are
// the registry's position definitions whose `permissionSets` names it
// (ADR-0131 D4) — never `sys_position_permission_set` / `sys_position` rows.
// A new grant is written by name alone, and the fixture is a database with no
// `sys_permission_set` row at all (objectstack ADR-0131 D10, stage 6b-2-pre).

import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { normaliseClientError } from '@object-ui/data-objectstack';
import { AssignedUsersSection } from './AssignedUsersSection';

vi.mock('@object-ui/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => mockAdapter,
  useMetadata: () => mockMetadataStore,
}));
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

// The registry's position definitions — the binding is part of the definition.
const registryPositions = [
  { name: 'contributor', label: 'Contributor', permissionSets: ['showcase_contributor'] },
  { name: 'everyone', label: 'Everyone', permissionSets: ['member_default', 'showcase_contributor'] },
  { name: 'auditor', label: 'Auditor', permissionSets: ['showcase_auditor'] },
];
const mockMetadataStore = { ensureType: vi.fn(async () => registryPositions) };

const data: Record<string, any[]> = {
  sys_user_permission_set: [{ id: 'grant_1', permission_set: 'showcase_contributor', user_id: 'u_direct' }],
  sys_user_position: [
    { id: 'up_1', user_id: 'u_held', position: 'contributor' },
    // The direct grantee ALSO holds the position — must merge into one row.
    { id: 'up_2', user_id: 'u_direct', position: 'contributor' },
  ],
  sys_user: [
    { id: 'u_direct', name: 'Direct Dana', email: 'dana@example.com' },
    { id: 'u_held', name: 'Held Henry', email: 'henry@example.com' },
  ],
};

const mockAdapter = {
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
  create: vi.fn(),
  delete: vi.fn(),
};

describe('AssignedUsersSection — effective holders (objectui#2382)', () => {
  it('lists direct grantees AND position-held users, with via badges', async () => {
    render(<AssignedUsersSection permissionSetName="showcase_contributor" />);

    await waitFor(() => expect(screen.getByText('Direct Dana')).toBeTruthy());
    // Position-held user appears even with no direct grant.
    expect(screen.getByText('Held Henry')).toBeTruthy();
    // Count = deduped users (u_direct merged), not junction rows.
    expect(screen.getByText('2')).toBeTruthy();
    // Attribution badges.
    expect(screen.getAllByText('direct').length).toBeGreaterThan(0);
    // The chip reads the position's label from the registry (objectui#13477).
    expect(screen.getAllByText('via position Contributor').length).toBeGreaterThan(0);
  });

  it('surfaces the everyone-anchor binding as a note instead of enumerating members', async () => {
    render(<AssignedUsersSection permissionSetName="showcase_contributor" />);
    await waitFor(() =>
      expect(screen.getByText(/every signed-in member holds this set/i)).toBeTruthy(),
    );
  });

  it('keeps the remove affordance only on direct grants', async () => {
    render(<AssignedUsersSection permissionSetName="showcase_contributor" />);
    await waitFor(() => expect(screen.getByText('Held Henry')).toBeTruthy());
    // One removable (direct grant) row → exactly one Remove button.
    expect(screen.getAllByLabelText('Remove')).toHaveLength(1);
  });
});

describe('AssignedUsersSection — by name, against the registry (objectui#7611)', () => {
  it('reads grants by the set NAME and the distributing positions from the registry', async () => {
    mockAdapter.find.mockClear();
    render(<AssignedUsersSection permissionSetName="showcase_contributor" />);
    await waitFor(() => expect(screen.getByText('Held Henry')).toBeTruthy());

    const reads = mockAdapter.find.mock.calls.map(([object]) => object);
    // No catalog row is read to LIST holders.
    expect(reads).not.toContain('sys_position_permission_set');
    expect(reads).not.toContain('sys_position');
    expect(reads).not.toContain('sys_permission_set');
    const grantQuery = mockAdapter.find.mock.calls.find(([o]) => o === 'sys_user_permission_set')?.[1];
    expect(grantQuery?.$filter).toEqual({ permission_set: 'showcase_contributor' });
    expect(mockMetadataStore.ensureType).toHaveBeenCalledWith('position');
  });

  it('a position whose definition does not name the set contributes nobody', async () => {
    render(<AssignedUsersSection permissionSetName="showcase_auditor" />);
    // `auditor` names `showcase_auditor`, but nobody holds it in the fixture,
    // and the direct grant above is for another set: an empty list.
    await waitFor(() => expect(screen.getByText(/No users assigned yet/)).toBeTruthy());
  });
});

/** Open the picker and select `pickedUsers` (the stand-in above). */
async function addThroughPicker() {
  await waitFor(() => expect(screen.getByText('Held Henry')).toBeTruthy());
  fireEvent.click(screen.getByText('Add user'));
  fireEvent.click(await screen.findByText('pick'));
}

describe('AssignedUsersSection — a grant by name, on a database with no catalog row (objectui#7611)', () => {
  it('ADD writes { user_id, permission_set } alone and reads no sys_permission_set row', async () => {
    mockAdapter.find.mockClear();
    mockAdapter.create.mockClear();
    render(<AssignedUsersSection permissionSetName="showcase_contributor" />);
    await addThroughPicker();

    await waitFor(() => expect(mockAdapter.create).toHaveBeenCalledTimes(1));
    // Exactly these two keys: no legacy `permission_set_id`, whatever its value.
    expect(mockAdapter.create).toHaveBeenCalledWith('sys_user_permission_set', {
      user_id: 'u_new',
      permission_set: 'showcase_contributor',
    });
    const reads = mockAdapter.find.mock.calls.map(([object]) => object);
    expect(reads).not.toContain('sys_permission_set');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it("shows the server's refusal of a name its catalog does not hold, in the server's words", async () => {
    // The error as the adapter throws it: the client's error for a
    // `400 VALIDATION_FAILED` with one `reference_not_found` entry at
    // `permission_set`, through the adapter's own `normaliseClientError`.
    const said = "Permission Set: no permission set is named 'showcase_contributor'.";
    const clientError = Object.assign(new Error(said), {
      code: 'VALIDATION_FAILED',
      httpStatus: 400,
      details: { fields: [{ field: 'permission_set', code: 'reference_not_found', message: said }] },
    });
    mockAdapter.create.mockClear();
    mockAdapter.create.mockRejectedValueOnce(normaliseClientError(clientError));
    render(<AssignedUsersSection permissionSetName="showcase_contributor" />);
    await addThroughPicker();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(said);
  });

  it('REMOVE deletes the direct grant by its row id', async () => {
    mockAdapter.delete.mockClear();
    render(<AssignedUsersSection permissionSetName="showcase_contributor" />);
    await waitFor(() => expect(screen.getByText('Held Henry')).toBeTruthy());
    fireEvent.click(screen.getByLabelText('Remove'));
    // Remove confirms first (objectui#13408); the delete follows the confirm.
    fireEvent.click(await screen.findByTestId('assigned-user-remove-confirm'));

    await waitFor(() => expect(mockAdapter.delete).toHaveBeenCalledTimes(1));
    expect(mockAdapter.delete).toHaveBeenCalledWith('sys_user_permission_set', 'grant_1');
  });
});

describe('AssignedUsersSection — reports each holders read to its host (objectui#13272)', () => {
  it('reports the listed count (direct grants and position holders, one per person) with the set it read', async () => {
    const onHoldersRead = vi.fn();
    render(<AssignedUsersSection permissionSetName="showcase_contributor" onHoldersRead={onHoldersRead} />);

    await waitFor(() => expect(onHoldersRead).toHaveBeenCalledWith(2, 'showcase_contributor'));
  });

  it('control: a set nobody holds reports 0', async () => {
    const onHoldersRead = vi.fn();
    render(<AssignedUsersSection permissionSetName="showcase_auditor" onHoldersRead={onHoldersRead} />);

    await waitFor(() => expect(onHoldersRead).toHaveBeenCalledWith(0, 'showcase_auditor'));
  });

  it('the read after an Add reports again', async () => {
    const onHoldersRead = vi.fn();
    render(<AssignedUsersSection permissionSetName="showcase_contributor" onHoldersRead={onHoldersRead} />);
    await addThroughPicker();

    await waitFor(() => expect(onHoldersRead).toHaveBeenCalledTimes(2));
  });

  it('a failed read reports nothing: it is not "held by nobody"', async () => {
    const onHoldersRead = vi.fn();
    mockAdapter.find.mockRejectedValueOnce(new Error('[Security] Access denied'));
    render(<AssignedUsersSection permissionSetName="showcase_contributor" onHoldersRead={onHoldersRead} />);

    await screen.findByTestId('assigned-users-read-failed');
    expect(onHoldersRead).not.toHaveBeenCalled();
  });
});
