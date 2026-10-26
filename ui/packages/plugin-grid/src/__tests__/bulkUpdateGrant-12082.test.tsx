/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12082 — a grid's bulk field update reads the `rowEdit` row of the
 * affordance-to-grant map, as its bulk Delete reads `rowDelete`.
 *
 * A `bulkActionDefs` entry with `operation: 'update'` writes a patch to every
 * selected record (`useBulkExecutor`'s per-row update, and its undo and retry,
 * which re-run the same write). The selection bar drew it whatever the caller
 * held: only the `delete` operation was filtered, on the object's delete
 * verdict. So a read-only caller could select rows, run the update, and get
 * one server refusal per row. The bar now draws an update def only when the
 * object's edit verdict — the policy, the effective operation set and the
 * caller's update grant — allows it; a closed verdict removes the button, and
 * with it the dialog, its undo and its retry.
 *
 * Measured through the REAL `ObjectGrid` and `MePermissionsProvider`, over the
 * map pin's four grant shapes: the bar's buttons after one row is selected.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import React from 'react';

import { MePermissionsProvider, type MePermissionsResponse } from '@object-ui/permissions';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider, SchemaRendererProvider } from '@object-ui/react';
import { ObjectGrid } from '../ObjectGrid';
import { __clearRecordCrudVerdictCache } from '../hooks/useRecordCrudVerdicts';
import { installExplainDouble } from './explainDouble';

registerAllFields();

const OBJECT = 'crm_deal';
const ROWS = [
  { id: 'd1', name: 'Alpha', stage: 'open' },
  { id: 'd2', name: 'Beta', stage: 'open' },
];

const DEFS = [
  { name: 'mark_won', label: 'Mark won', operation: 'update', patch: { stage: 'won' } },
  { name: 'purge', label: 'Purge', operation: 'delete' },
  { name: 'notify', label: 'Notify', operation: 'custom' },
];

const SHAPES: Array<{ shape: string; bits: Record<string, boolean>; update: boolean; remove: boolean }> = [
  { shape: 'create-only', bits: { allowCreate: true, allowRead: true, allowEdit: false, allowDelete: false }, update: false, remove: false },
  { shape: 'edit-only', bits: { allowCreate: false, allowRead: true, allowEdit: true, allowDelete: false }, update: true, remove: false },
  { shape: 'read-only', bits: { allowCreate: false, allowRead: true, allowEdit: false, allowDelete: false }, update: false, remove: false },
  { shape: 'full', bits: { allowCreate: true, allowRead: true, allowEdit: true, allowDelete: true }, update: true, remove: true },
];

const envelope = (bits: Record<string, unknown>): MePermissionsResponse => ({
  authenticated: true,
  userId: 'u-pin',
  tenantId: null,
  roles: ['member'],
  permissionSets: ['member'],
  objects: { [OBJECT]: bits as never },
  fields: {},
});

function mount(perms: MePermissionsResponse | null, objectSchema: Record<string, unknown> = {}) {
  const dataSource: any = {
    getObjectSchema: async (name: string) => ({
      name,
      fields: { id: { type: 'text' }, name: { type: 'text', label: 'Name' }, stage: { type: 'text', label: 'Stage' } },
      ...objectSchema,
    }),
  };
  const grid = (
    <ActionProvider>
      <SchemaRendererProvider dataSource={dataSource}>
        <ObjectGrid
          schema={{
            type: 'object-grid',
            objectName: OBJECT,
            columns: [{ field: 'name', label: 'Name' }],
            data: { provider: 'value', items: ROWS },
            bulkActionDefs: DEFS,
          } as any}
          dataSource={dataSource}
        />
      </SchemaRendererProvider>
    </ActionProvider>
  );
  return render(perms ? <MePermissionsProvider initialPermissions={perms}>{grid}</MePermissionsProvider> : grid);
}

/** Select the last row and report which bulk buttons the bar draws. */
async function barOffers(): Promise<{ update: boolean; remove: boolean; custom: boolean }> {
  await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument());
  await waitFor(() => expect(screen.getByText('Beta')).toBeInTheDocument());
  const boxes = screen.queryAllByRole('checkbox');
  expect(boxes.length, 'the custom def keeps selection on').toBeGreaterThan(0);
  await userEvent.click(boxes[boxes.length - 1]);
  await waitFor(() => expect(screen.getByTestId('bulk-action-notify')).toBeInTheDocument());
  return {
    update: screen.queryByTestId('bulk-action-mark_won') !== null,
    remove: screen.queryByTestId('bulk-action-purge') !== null,
    custom: true,
  };
}

beforeEach(() => {
  __clearRecordCrudVerdictCache();
  installExplainDouble();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe.each(SHAPES)('the grid bulk bar under a $shape grant (objectui#12082)', ({ bits, update, remove }) => {
  it('a bulk field update is offered exactly when the update grant allows it; a bulk delete when the delete grant does', async () => {
    mount(envelope(bits));
    expect(await barOffers()).toEqual({ update, remove, custom: true });
  });
});

describe("the grid bulk bar: the map's other layers and fail-open (objectui#12082)", () => {
  it('fail-open: with no permission provider every def is offered, as before', async () => {
    mount(null);
    expect(await barOffers()).toEqual({ update: true, remove: true, custom: true });
  });

  it('an effective operation set without update withholds the bulk field update under the full grant', async () => {
    mount(envelope({ ...SHAPES[3].bits, apiOperations: ['get', 'list', 'create', 'delete'] }));
    expect(await barOffers()).toEqual({ update: false, remove: true, custom: true });
  });

  it('an object policy that closes edit withholds the bulk field update under the full grant', async () => {
    mount(envelope(SHAPES[3].bits), { userActions: { edit: false } });
    await barOffers();
    // The policy half reads the object schema, which settles after the rows
    // paint; wait for the verdict that reads it rather than the first frame.
    await waitFor(() => expect(screen.queryByTestId('bulk-action-mark_won')).not.toBeInTheDocument());
    expect(screen.getByTestId('bulk-action-purge')).toBeInTheDocument();
  });
});
