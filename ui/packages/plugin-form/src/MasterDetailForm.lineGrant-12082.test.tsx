/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12082 — a `MasterDetailForm`'s line grids read the
 * affordance-to-grant map, asked of the CHILD object, the same two rows a
 * `record:line_items` panel reads for the same two writes: adding a line is
 * `relatedNew` (a child created under this parent), removing one is
 * `relatedRowDelete` (a child deleted).
 *
 * Before, neither read a grant, so a caller who may not create (or delete) the
 * child was offered Add, the entry row, Duplicate and Remove, and Save sent a
 * batch the server refused.
 *
 * Remove asks the delete grant only on an EDIT form. Measured below rather than
 * assumed: a CREATE form's batch is the parent's create followed by one create
 * per line (`buildMasterDetailBatch`), so a line removed before the first Save
 * is a draft dropped from that batch and never a server delete. Withholding
 * Remove there would be a client rule the server does not have, and would
 * leave a create-only caller unable to take back a line they just added.
 *
 * Measured through the REAL `MasterDetailForm`, `GridField` and
 * `MePermissionsProvider`, over the map pin's four grant shapes on the child;
 * the parent is fully granted, so only the child's grant decides.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';

import { MePermissionsProvider, type MePermissionsResponse } from '@object-ui/permissions';
import { registerAllFields } from '@object-ui/fields';
import { MasterDetailForm } from './MasterDetailForm';

registerAllFields();
afterEach(cleanup);

const PARENT = 'sales_order';
const CHILD = 'sales_order_line';
const COLUMNS = [{ name: 'qty', label: 'Qty', type: 'number' }];
const LINE = { id: 'L1', order: 'SO1', qty: 3 };

const SHAPES: Array<{ shape: string; bits: Record<string, boolean>; create: boolean; remove: boolean }> = [
  { shape: 'create-only', bits: { allowCreate: true, allowRead: true, allowEdit: false, allowDelete: false }, create: true, remove: false },
  { shape: 'edit-only', bits: { allowCreate: false, allowRead: true, allowEdit: true, allowDelete: false }, create: false, remove: false },
  { shape: 'read-only', bits: { allowCreate: false, allowRead: true, allowEdit: false, allowDelete: false }, create: false, remove: false },
  { shape: 'full', bits: { allowCreate: true, allowRead: true, allowEdit: true, allowDelete: true }, create: true, remove: true },
];

const envelope = (child: Record<string, unknown>): MePermissionsResponse => ({
  authenticated: true,
  userId: 'u-pin',
  tenantId: null,
  roles: ['member'],
  permissionSets: ['member'],
  objects: {
    [PARENT]: { allowCreate: true, allowRead: true, allowEdit: true, allowDelete: true },
    [CHILD]: child as never,
  },
  fields: {},
});

function makeDS(mode: 'create' | 'edit') {
  return {
    getObjectSchema: vi.fn(async (obj: string) =>
      obj === PARENT ? { name: PARENT, fields: { ref: { type: 'text', label: 'Ref' } } } : null,
    ),
    findOne: vi.fn().mockResolvedValue({ id: 'SO1', ref: 'SO-1' }),
    find: vi.fn().mockResolvedValue({ data: mode === 'edit' ? [LINE] : [] }),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    batchTransaction: vi.fn().mockResolvedValue({ results: [{ id: 'SO2' }] }),
  };
}

function mount(mode: 'create' | 'edit', perms: MePermissionsResponse | null, ds = makeDS(mode)) {
  const form = (
    <MasterDetailForm
      schema={{
        objectName: PARENT,
        mode,
        ...(mode === 'edit' ? { recordId: 'SO1' } : {}),
        fields: ['ref'],
        details: [{ childObject: CHILD, relationshipField: 'order', columns: COLUMNS }],
      } as any}
      dataSource={ds as any}
    />
  );
  const view = render(perms ? <MePermissionsProvider initialPermissions={perms}>{form}</MePermissionsProvider> : form);
  return { ds, ...view };
}

const offered = () => ({
  add: screen.queryByTestId('line-items-add') !== null,
  duplicate: screen.queryAllByRole('button', { name: 'Duplicate row' }).length > 0,
  remove: screen.queryAllByRole('button', { name: 'Remove row' }).length > 0,
});

/** An edit form: wait until the loaded line is drawn. */
async function lineLoaded() {
  await waitFor(() => expect(screen.getByDisplayValue('3')).toBeTruthy());
}

/** A create form: wait for the grid, then type into the entry row so it becomes a line. */
async function addLineViaEntryRow(value: string) {
  const cells = await waitFor(() => {
    const els = screen.getAllByLabelText('Qty') as HTMLInputElement[];
    if (els.length === 0) throw new Error('grid not drawn yet');
    return els;
  });
  fireEvent.change(cells[cells.length - 1], { target: { value } });
  await waitFor(() => expect(screen.getByDisplayValue(value)).toBeTruthy());
}

describe.each(SHAPES)('MasterDetailForm under a $shape grant on the child (objectui#12082)', ({ bits, create, remove }) => {
  it('edit form: add and duplicate follow the child create grant; remove follows the child delete grant', async () => {
    mount('edit', envelope(bits));
    await lineLoaded();
    expect(offered()).toEqual({ add: create, duplicate: create, remove });
  });

  it('create form: add follows the child create grant; a drafted line can always be removed', async () => {
    mount('create', envelope(bits));
    await waitFor(() => expect(screen.getByText('Ref')).toBeTruthy());
    if (!create) {
      // No add affordance at all: no Add button, no entry row, so no line.
      await waitFor(() => expect(screen.queryByTestId('line-items-add')).toBeNull());
      expect(screen.queryAllByLabelText('Qty')).toHaveLength(0);
      return;
    }
    await addLineViaEntryRow('7');
    expect(offered()).toEqual({ add: true, duplicate: true, remove: true });
  });
});

describe("MasterDetailForm: remove in a create form, and the map's other layers (objectui#12082)", () => {
  it("MEASURED: a create form's removed line is never a server delete — the batch holds only creates", async () => {
    const { ds, container } = mount('create', envelope(SHAPES[3].bits));
    await addLineViaEntryRow('7');
    await addLineViaEntryRow('9');
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove row' })[0]);
    await waitFor(() => expect(screen.queryByDisplayValue('7')).toBeNull());
    const ref = container.querySelector('input[name="ref"]') as HTMLInputElement;
    fireEvent.change(ref, { target: { value: 'SO-2' } });
    fireEvent.click(screen.getByRole('button', { name: /create/i }));
    await waitFor(() => expect(ds.batchTransaction).toHaveBeenCalledTimes(1));
    const ops = ds.batchTransaction.mock.calls[0][0] as Array<{ object: string; action: string; data?: Record<string, unknown> }>;
    expect(ops.map((o) => `${o.object}:${o.action}`)).toEqual([`${PARENT}:create`, `${CHILD}:create`]);
    expect(Number(ops[1].data?.qty)).toBe(9);
  });

  it('fail-open: with no permission provider add and remove are offered, as before', async () => {
    mount('edit', null);
    await lineLoaded();
    expect(offered()).toEqual({ add: true, duplicate: true, remove: true });
  });

  it('an effective operation set without create and delete withholds both under the full grant', async () => {
    mount('edit', envelope({ ...SHAPES[3].bits, apiOperations: ['get', 'list', 'update'] }));
    await lineLoaded();
    expect(offered()).toEqual({ add: false, duplicate: false, remove: false });
  });
});
