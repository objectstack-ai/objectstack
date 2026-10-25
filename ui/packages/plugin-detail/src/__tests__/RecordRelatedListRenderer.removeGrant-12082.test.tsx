/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * The related list's FALLBACK remove reads the affordance-to-grant map
 * (objectui#12082, the census backlog's leg B).
 *
 * `record:related_list` falls back to a generic link-row remove when an `add`
 * config is present and no host handed over a delete. It deleted with no grant
 * read — and on a record page it put back exactly the delete the host had
 * withheld: the record page's bridge withholds `onDelete` when the child's
 * `relatedRowDelete` row is closed for the caller, and the fallback then
 * offered the same delete with no grant read at all. It now reads that row
 * itself, asked of the list's object with its registered schema.
 *
 * Captures the props the renderer hands `RelatedList`, the way
 * `RecordRelatedListRenderer.hostactions.test.tsx` does, under the REAL
 * `MePermissionsProvider`. Sibling pin for the list's Add existing:
 * `RelatedList.addGrant-12082.test.tsx`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import * as React from 'react';
import {
  RecordContextProvider,
  RelatedRecordActionsProvider,
  type RelatedRecordActionsValue,
} from '@object-ui/react';
import { MePermissionsProvider, type MePermissionsResponse } from '@object-ui/permissions';
import { RecordRelatedListRenderer } from '../renderers/record-related-list';

const h = vi.hoisted(() => ({ captured: null as any }));
vi.mock('../RelatedList', () => ({
  RelatedList: (props: any) => {
    h.captured = props;
    return null;
  },
}));

const JUNCTION = 'sys_user_permission_set';
const ADD = { picker: { object: 'sys_permission_set', labelField: 'label' }, linkField: 'permission_set_id' };

/** The four grant shapes of the map's enumeration pin. */
const SHAPE = {
  createOnly: { allowRead: true, allowCreate: true, allowEdit: false, allowDelete: false },
  editOnly: { allowRead: true, allowCreate: false, allowEdit: true, allowDelete: false },
  readOnly: { allowRead: true, allowCreate: false, allowEdit: false, allowDelete: false },
  full: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true },
} as const;

function answer(bits: Record<string, unknown>): MePermissionsResponse {
  return {
    authenticated: true,
    userId: 'u-pin',
    tenantId: null,
    roles: ['member'],
    permissionSets: ['member'],
    objects: { [JUNCTION]: bits },
    fields: {},
  } as MePermissionsResponse;
}

const ds = { find: vi.fn(async () => []), delete: vi.fn(async () => undefined) };

/** Mounts the block under a parent record, with or without a host bridge, and lets its lookups answer. */
async function mount(perms: MePermissionsResponse | null, host: RelatedRecordActionsValue | null) {
  const list = <RecordRelatedListRenderer schema={{ objectName: JUNCTION, relationshipField: 'user_id', add: ADD } as any} />;
  const tree = (
    <RecordContextProvider objectName="sys_user" recordId="u_1" dataSource={ds as any}>
      {host ? <RelatedRecordActionsProvider value={host}>{list}</RelatedRecordActionsProvider> : list}
    </RecordContextProvider>
  );
  render(perms ? <MePermissionsProvider initialPermissions={perms}>{tree}</MePermissionsProvider> : tree);
  await waitFor(() => expect(h.captured).not.toBeNull());
  // The object lookup the fallback waits on resolves in a microtask.
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  h.captured = null;
  ds.delete.mockClear();
});

describe("the related list's fallback remove reads relatedRowDelete (objectui#12082)", () => {
  it.each([
    ['create-only', SHAPE.createOnly, false],
    ['edit-only', SHAPE.editOnly, false],
    ['read-only', SHAPE.readOnly, false],
    ['full', SHAPE.full, true],
  ] as const)('with no host, under a %s grant on the list object the remove is offered exactly when delete is held', async (_s, bits, offered) => {
    await mount(answer(bits), null);
    expect(typeof h.captured.onRowDelete === 'function').toBe(offered);
  });

  it('on a record page whose host withheld the delete, the fallback does not put it back', async () => {
    // The host resolved the child and handed over no `onDelete`: the record
    // page's bridge does that exactly when `relatedRowDelete` is closed.
    await mount(answer(SHAPE.readOnly), { resolve: () => ({ onView: vi.fn() }) });
    expect(h.captured.onRowDelete).toBeUndefined();
  });

  it("CONTROL — the host's own delete is wired as before, whatever the fallback would answer", async () => {
    const onDelete = vi.fn();
    await mount(answer(SHAPE.readOnly), { resolve: () => ({ onView: vi.fn(), onDelete }) });
    h.captured.onRowDelete({ id: 'row_9' });
    expect(onDelete).toHaveBeenCalledWith('row_9', { id: 'row_9' });
  });

  it('CONTROL — with no host and no permission provider the fallback remove is offered, and deletes the link row', async () => {
    await mount(null, null);
    expect(typeof h.captured.onRowDelete).toBe('function');
    await h.captured.onRowDelete({ id: 'row_7' });
    expect(ds.delete).toHaveBeenCalledWith(JUNCTION, 'row_7');
  });
});
