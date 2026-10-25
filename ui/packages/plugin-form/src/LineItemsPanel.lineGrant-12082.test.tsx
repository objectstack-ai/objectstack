/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12082 — a `record:line_items` panel's add and remove read the
 * affordance-to-grant map, asked of the CHILD object: adding a line is the
 * `relatedNew` row (a child created under this parent), removing one the
 * `relatedRowDelete` row (a child deleted).
 *
 * Before, both read `schema.readonly` and nothing else, so a caller who may not
 * create or delete the child object was offered both, and Save sent a batch the
 * server refused. Cell editing is not this card's: it already asks the field
 * question per column through `applyColumnPermissions`
 * (`LineItemsPanel.fieldWriteGate-10163.test.tsx`).
 *
 * The grid's add affordances are the Add button, the always-present entry row
 * and the per-row Duplicate (all three follow `allowAdd` in `GridField`); its
 * remove affordance is the per-row Remove. Measured through the REAL
 * `MePermissionsProvider` over the map pin's four grant shapes, on the child.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import React from 'react';

import { MePermissionsProvider, type MePermissionsResponse } from '@object-ui/permissions';
import { registerAllFields } from '@object-ui/fields';
import { SchemaRendererProvider } from '@object-ui/react';
import { LineItemsPanel } from './LineItemsPanel';

registerAllFields();
afterEach(cleanup);

const CHILD = 'invoice_line';

const SCHEMA = {
  childObject: CHILD,
  relationshipField: 'invoice',
  parentObject: 'invoice',
  parentId: 'INV1',
  columns: [
    { name: 'description', label: 'Description', type: 'text' },
    { name: 'amount', label: 'Amount', type: 'number' },
  ],
} as any;

const ROWS = [
  { id: 'L1', invoice: 'INV1', description: 'Hosting', amount: 40 },
  { id: 'L2', invoice: 'INV1', description: 'Support', amount: 12 },
];

const SHAPES: Array<{ shape: string; bits: Record<string, boolean>; add: boolean; remove: boolean }> = [
  { shape: 'create-only', bits: { allowCreate: true, allowRead: true, allowEdit: false, allowDelete: false }, add: true, remove: false },
  { shape: 'edit-only', bits: { allowCreate: false, allowRead: true, allowEdit: true, allowDelete: false }, add: false, remove: false },
  { shape: 'read-only', bits: { allowCreate: false, allowRead: true, allowEdit: false, allowDelete: false }, add: false, remove: false },
  { shape: 'full', bits: { allowCreate: true, allowRead: true, allowEdit: true, allowDelete: true }, add: true, remove: true },
];

const envelope = (bits: Record<string, unknown>): MePermissionsResponse => ({
  authenticated: true,
  userId: 'u-pin',
  tenantId: null,
  roles: ['member'],
  permissionSets: ['member'],
  // The parent is fully granted: only the CHILD's grant may decide.
  objects: {
    [CHILD]: bits as never,
    invoice: { allowCreate: true, allowRead: true, allowEdit: true, allowDelete: true },
  },
  fields: {},
});

function mount(perms: MePermissionsResponse | null, childSchema: Record<string, unknown> | null = null) {
  const panel = (
    <SchemaRendererProvider
      dataSource={{
        getObjectSchema: vi.fn().mockResolvedValue(childSchema),
        find: vi.fn().mockResolvedValue({ data: ROWS }),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      } as any}
    >
      <LineItemsPanel schema={SCHEMA} />
    </SchemaRendererProvider>
  );
  return render(perms ? <MePermissionsProvider initialPermissions={perms}>{panel}</MePermissionsProvider> : panel);
}

/** Wait until the loaded rows are drawn. */
async function settled() {
  await waitFor(() => expect(screen.getByDisplayValue('Hosting')).toBeTruthy());
}

const offered = () => ({
  add: screen.queryByTestId('line-items-add') !== null,
  duplicate: screen.queryAllByRole('button', { name: 'Duplicate row' }).length > 0,
  remove: screen.queryAllByRole('button', { name: 'Remove row' }).length > 0,
});

describe.each(SHAPES)('LineItemsPanel under a $shape grant on the child (objectui#12082)', ({ bits, add, remove }) => {
  it('add and duplicate follow the child create grant; remove follows the child delete grant', async () => {
    mount(envelope(bits));
    await settled();
    expect(offered()).toEqual({ add, duplicate: add, remove });
  });
});

describe('LineItemsPanel: the map\'s other layers and fail-open (objectui#12082)', () => {
  it('fail-open: with no permission provider add and remove are offered, as before', async () => {
    mount(null);
    await settled();
    expect(offered()).toEqual({ add: true, duplicate: true, remove: true });
  });

  it('an effective operation set without create and delete withholds both under the full grant', async () => {
    mount(envelope({ allowCreate: true, allowRead: true, allowEdit: true, allowDelete: true, apiOperations: ['read', 'update'] }));
    await settled();
    expect(offered()).toEqual({ add: false, duplicate: false, remove: false });
  });

  // The contract review's rider: the panel already loads the child's schema
  // (for the save's sanitize), so it hands that schema to the affordance
  // source, as `RelatedRecordActionsBridge` does, and the child's own policy is
  // read too — not only its grant and operation set.
  it("the child object's policy closes add and remove under the full grant", async () => {
    mount(
      envelope({ allowCreate: true, allowRead: true, allowEdit: true, allowDelete: true }),
      { name: CHILD, userActions: { create: false, delete: false }, fields: { description: { type: 'text' }, amount: { type: 'number' } } },
    );
    await settled();
    // The child schema settles after the rows paint; wait for the verdict that reads it.
    await waitFor(() => expect(offered()).toEqual({ add: false, duplicate: false, remove: false }));
  });

  it('CONTROL: a child schema whose policy leaves create and delete open keeps both', async () => {
    mount(
      envelope({ allowCreate: true, allowRead: true, allowEdit: true, allowDelete: true }),
      { name: CHILD, fields: { description: { type: 'text' }, amount: { type: 'number' } } },
    );
    await settled();
    expect(offered()).toEqual({ add: true, duplicate: true, remove: true });
  });
});
