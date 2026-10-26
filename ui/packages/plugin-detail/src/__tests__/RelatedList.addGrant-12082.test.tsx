/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * A related list's Add existing reads the affordance-to-grant map
 * (objectui#12082, the census backlog's leg B).
 *
 * The Add button (`add`, the picker) read no grant: it showed to every caller,
 * and the write it ends in went to the server regardless. Measured where that
 * write goes, it is one of two, and each is a row the map already has, asked
 * of the object the write goes to:
 *
 *  - with a `linkField`, a link row of the list's own object (the junction) is
 *    created — `relatedNew`, the create grant on the list's object;
 *  - without one, the picked record is re-parented — `relatedRowEdit`, the
 *    update grant on the picked object.
 *
 * Real subject: `RelatedList`, under the REAL `MePermissionsProvider` holding
 * the caller's `/me/permissions` answer. Sibling pin for the list's fallback
 * remove: `RecordRelatedListRenderer.removeGrant-12082.test.tsx`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import * as React from 'react';
import { MePermissionsProvider, type MePermissionsResponse } from '@object-ui/permissions';
import { RelatedList } from '../RelatedList';

const JUNCTION = 'sys_user_permission_set';
const PICKED = 'sys_permission_set';
const CHILD = 'crm_contact';

/** The four grant shapes of the map's enumeration pin. */
const SHAPE = {
  createOnly: { allowRead: true, allowCreate: true, allowEdit: false, allowDelete: false },
  editOnly: { allowRead: true, allowCreate: false, allowEdit: true, allowDelete: false },
  readOnly: { allowRead: true, allowCreate: false, allowEdit: false, allowDelete: false },
  full: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true },
} as const;

function answer(objects: Record<string, Record<string, unknown>>): MePermissionsResponse {
  return {
    authenticated: true,
    userId: 'u-pin',
    tenantId: null,
    roles: ['member'],
    permissionSets: ['member'],
    objects,
    fields: {},
  } as MePermissionsResponse;
}

/**
 * The legacy raw-URL branch is not taken (a `dataSource` is passed), but the
 * stub keeps any stray request hermetic, as `RelatedList.addGateDataSource`
 * does.
 */
let originalFetch: typeof globalThis.fetch;
beforeEach(() => {
  originalFetch = globalThis.fetch;
  globalThis.fetch = vi.fn(async () => ({ json: async () => [] }) as any) as any;
});
afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

/** An authored label, so the button has a name with no i18n provider mounted. */
const ADD_LABEL = 'Grant permission set';
const queryAdd = () => screen.queryByRole('button', { name: ADD_LABEL });

const JUNCTION_ADD = { picker: { object: PICKED, labelField: 'label' }, linkField: 'permission_set_id', label: ADD_LABEL };
const REPARENT_ADD = { picker: { object: CHILD, labelField: 'name' }, label: ADD_LABEL };

function makeDS() {
  return {
    find: vi.fn(async () => [{ id: 'row_1', permission_set_id: 'ps_1' }]),
    getObjectSchema: vi.fn(async (name: string) => ({ name, fields: {} })),
    create: vi.fn(async (_o: string, data: any) => data),
    update: vi.fn(async () => ({})),
  };
}

/** Mounts the list and lets its schema read settle (the row fetch waits on it). */
async function mountList(perms: MePermissionsResponse | null, add: Record<string, unknown>) {
  const ds = makeDS();
  const list = (
    <RelatedList
      title="Related"
      type="table"
      api={JUNCTION}
      objectName={JUNCTION}
      referenceField="user_id"
      parentId="u_1"
      columns={[{ accessorKey: 'permission_set_id', header: 'Permission Set' }]}
      dataSource={ds as any}
      add={add as any}
    />
  );
  render(perms ? <MePermissionsProvider initialPermissions={perms}>{list}</MePermissionsProvider> : list);
  await waitFor(() => expect(screen.getByText('Related')).toBeInTheDocument());
  // The rows are fetched once the list's schema has settled, so a fetch is the
  // signal the schema the verdict reads has landed.
  await waitFor(() => expect(ds.find).toHaveBeenCalled());
  return ds;
}

describe("a related list's Add existing reads relatedNew when it creates a link row (objectui#12082)", () => {
  it.each([
    ['create-only', SHAPE.createOnly, true],
    ['edit-only', SHAPE.editOnly, false],
    ['read-only', SHAPE.readOnly, false],
    ['full', SHAPE.full, true],
  ] as const)('under a %s grant on the junction the Add button shows exactly when create is held', async (_s, bits, shown) => {
    // The picked object's grant is not this write's: read-only here.
    await mountList(answer({ [JUNCTION]: bits, [PICKED]: SHAPE.readOnly }), JUNCTION_ADD);
    expect(!!queryAdd()).toBe(shown);
  });

  it('an effective operation set without create on the junction closes it, whatever the grant', async () => {
    await mountList(answer({ [JUNCTION]: { ...SHAPE.full, apiOperations: ['get', 'list', 'delete'] } }), JUNCTION_ADD);
    expect(queryAdd()).toBeNull();
  });

  it('CONTROL — with no permission provider the Add button shows, as before', async () => {
    await mountList(null, JUNCTION_ADD);
    expect(queryAdd()).not.toBeNull();
  });
});

describe("a related list's Add existing reads relatedRowEdit when it re-parents the picked record (objectui#12082)", () => {
  it.each([
    ['create-only', SHAPE.createOnly, false],
    ['edit-only', SHAPE.editOnly, true],
    ['read-only', SHAPE.readOnly, false],
    ['full', SHAPE.full, true],
  ] as const)('under a %s grant on the picked object the Add button shows exactly when update is held', async (_s, bits, shown) => {
    // The list's own object is fully granted: the write goes to the picked one.
    await mountList(answer({ [JUNCTION]: SHAPE.full, [CHILD]: bits }), REPARENT_ADD);
    expect(!!queryAdd()).toBe(shown);
  });
});
