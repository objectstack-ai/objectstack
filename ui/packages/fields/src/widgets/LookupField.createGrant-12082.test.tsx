/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A lookup picker offers "Create new" only to a caller who may create the
 * TARGET object (objectui#12082, folding in objectui#12081 item 6).
 *
 * ## The defect
 *
 * The built-in quick-create writes a record of the object the field
 * references. Its button read `allowCreate` — whether the field OFFERS
 * quick-create — and whether a host could carry the create out, and no grant
 * at all. Measured in a metadata app's intake wizard: a requester whose
 * permission set cannot create contract types was offered "Create new" in the
 * contract-type picker, and the create would have been refused.
 *
 * ## What it reads now
 *
 * The `lookupCreateNew` row of the affordance-to-grant map in `@object-ui/core`,
 * asked of the TARGET: its managed-object policy, the server's effective API
 * operation set for it, and the caller's create grant on it.
 *
 * ## The rows
 *
 * - the card's reading: create denied on the target → no "Create new";
 * - CONTROL, create granted on the target → "Create new" shows (a gate that
 *   always hid it cannot pass);
 * - the grant read is the TARGET's: create on the form's own object does not
 *   open it, and its absence there does not close it;
 * - the target's effective operation set without `create` closes it;
 * - no permission provider at all leaves it shown (fail-open — the existing
 *   quick-create rows in `complex-widgets.test.tsx` run provider-less).
 */
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { MePermissionsProvider, type MePermissionsResponse } from '@object-ui/permissions';
import { LookupField } from './LookupField';

afterEach(cleanup);

const TARGET = 'clm_contract_type';
const SOURCE = 'clm_contract';

const field = {
  name: 'contract_type',
  label: 'Contract Type',
  reference: TARGET,
  reference_field: 'name',
} as any;

function makeDataSource() {
  return {
    find: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
}

type Grant = { allowCreate: boolean; apiOperations?: string[] };

/** `/me/permissions` with `target` and `source` grants on the two objects. */
const envelope = (target: Grant, source: Grant = { allowCreate: true }): MePermissionsResponse => ({
  authenticated: true,
  userId: 'u-requester',
  tenantId: null,
  roles: ['clm_requester'],
  permissionSets: ['clm_requester'],
  objects: {
    [TARGET]: { allowRead: true, allowEdit: false, allowDelete: false, ...target },
    [SOURCE]: { allowRead: true, allowEdit: true, allowDelete: false, ...source },
  },
  fields: {},
});

/** Open the picker, type a query that matches nothing, and report whether "Create new" is offered. */
async function offersCreateNew(perms: MePermissionsResponse | null): Promise<boolean> {
  const ds = makeDataSource();
  const widget = <LookupField field={field} value={undefined} onChange={vi.fn()} readonly={false} dataSource={ds as any} />;
  render(perms ? <MePermissionsProvider initialPermissions={perms}>{widget}</MePermissionsProvider> : widget);
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /Select/i }));
  });
  const input = await screen.findByRole('combobox');
  await act(async () => {
    fireEvent.change(input, { target: { value: 'NDA' } });
  });
  await waitFor(() => expect(screen.getByText('No options found')).toBeInTheDocument());
  return screen.queryByText(/Create new/) !== null;
}

describe('LookupField "Create new" reads the target object\'s create grant (objectui#12082)', () => {
  it('objectui#12081 item 6: create denied on the target → no "Create new"', async () => {
    expect(await offersCreateNew(envelope({ allowCreate: false }))).toBe(false);
  });

  it('CONTROL — create granted on the target → "Create new" shows', async () => {
    expect(await offersCreateNew(envelope({ allowCreate: true }))).toBe(true);
  });

  it('the grant read is the TARGET\'s, not the form object\'s', async () => {
    expect(await offersCreateNew(envelope({ allowCreate: false }, { allowCreate: true }))).toBe(false);
    cleanup();
    expect(await offersCreateNew(envelope({ allowCreate: true }, { allowCreate: false }))).toBe(true);
  });

  it('the target\'s effective operation set without `create` closes it, whatever the grant', async () => {
    expect(
      await offersCreateNew(envelope({ allowCreate: true, apiOperations: ['get', 'list', 'update'] })),
    ).toBe(false);
  });

  it('no permission provider → shown (fail-open; the server still enforces)', async () => {
    expect(await offersCreateNew(null)).toBe(true);
  });
});
