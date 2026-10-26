// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#2600 B4 — field-level bulk + filter. Expanding a wide object used to
 * mean toggling two checkboxes per field, one field at a time. The sub-table
 * now carries a field filter and Read-all / Write-all / Clear shortcuts that
 * act over the VISIBLE (filtered) fields — mirroring the per-object row.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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

// Eight fields → wide enough that the filter shows (threshold is > 6).
const FIELDS = ['amount', 'email', 'name', 'owner', 'phone', 'region', 'revenue', 'status'];

function makeClient() {
  return {
    layered: async () => ({
      effective: { name: 'sales_perms', label: 'Sales', objects: { a_account: { allowRead: true } }, fields: {} },
      code: null,
      overlay: null,
      overlayScope: null,
    }),
    getDraft: async () => null,
    list: async (type: string) => (type === 'object' ? [{ item: { name: 'a_account' } }] : []),
    get: async (type: string) =>
      type === 'object' ? { fields: FIELDS.map((name) => ({ name })) } : null,
    save: async (_t: string, _n: string, payload: Record<string, unknown>) => payload,
  } as any;
}

async function renderExpanded() {
  clientImpl = makeClient();
  render(
    <MemoryRouter>
      <PermissionMatrixEditPage type="permission" name="sales_perms" packageId="app.a" />
    </MemoryRouter>,
  );
  // Expand the object row, then wait for its fields to load.
  fireEvent.click(await screen.findByRole('button', { name: /a_account/ }));
  await screen.findByLabelText('a_account.email readable');
}

describe('PermissionMatrixEditPage — field-level bulk + filter (objectui#2600 B4)', () => {
  it('Write all grants read+write to every visible field', async () => {
    await renderExpanded();

    expect(screen.getByLabelText('a_account.email editable')).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Write all' }));

    for (const f of FIELDS) {
      expect(screen.getByLabelText(`a_account.${f} readable`)).toBeChecked();
      expect(screen.getByLabelText(`a_account.${f} editable`)).toBeChecked();
    }
  });

  it('the filter narrows the field set and bulk acts only on what is visible', async () => {
    await renderExpanded();

    // Grant write to everyone first.
    fireEvent.click(screen.getByRole('button', { name: 'Write all' }));
    expect(screen.getByLabelText('a_account.email editable')).toBeChecked();

    // Filter to just the "re*" fields — region + revenue.
    fireEvent.change(screen.getByLabelText('Filter fields…'), { target: { value: 're' } });
    expect(screen.getByLabelText('a_account.region readable')).toBeInTheDocument();
    expect(screen.getByLabelText('a_account.revenue readable')).toBeInTheDocument();
    expect(screen.queryByLabelText('a_account.email readable')).toBeNull();
    expect(screen.getByText('2 / 8')).toBeInTheDocument();

    // Read-all now only revokes write on the visible (filtered) fields.
    fireEvent.click(screen.getByRole('button', { name: 'Read all' }));
    expect(screen.getByLabelText('a_account.region editable')).not.toBeChecked();
    expect(screen.getByLabelText('a_account.region readable')).toBeChecked();

    // Clearing the filter reveals the untouched fields still holding write.
    fireEvent.change(screen.getByLabelText('Filter fields…'), { target: { value: '' } });
    expect(screen.getByLabelText('a_account.email editable')).toBeChecked();
  });

  it('Clear drops the overrides so fields fall back to the read-only default', async () => {
    await renderExpanded();

    fireEvent.click(screen.getByRole('button', { name: 'Write all' }));
    expect(screen.getByLabelText('a_account.name editable')).toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    // Default field posture: readable, not editable.
    expect(screen.getByLabelText('a_account.name readable')).toBeChecked();
    expect(screen.getByLabelText('a_account.name editable')).not.toBeChecked();
  });
});
