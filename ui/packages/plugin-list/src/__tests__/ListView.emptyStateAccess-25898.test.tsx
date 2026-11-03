/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#25898 — the list empty state tells "no records you can see" and
 * "nothing of yours yet" apart from "no records".
 *
 * Measured on the console: a sales rep who may read none of 38 cases opened
 * the case list and was told "Nothing here yet / Create your first record to
 * get started." beside no New button; and every "my …" view (`owner` equals
 * the current user) told an owner of nothing "No records match this view's
 * filter."
 *
 * Three cases, chosen by what the list knows:
 * - no filter, and the caller holds the create grant: today's first-run copy
 *   and the add-record action;
 * - no filter, and the caller is KNOWN not to hold it (the `listNew` row of the
 *   affordance-to-grant map, once permissions have loaded): "No records you can
 *   see", and no add-record action even when the view enables one;
 * - the view's declared filter names the signed-in user: "Nothing of yours
 *   yet", with the action only under the create grant.
 *
 * SUITE DIRECTION, predicted before running: the read-only and "my view" cases
 * are RED against the base commit (first-run copy / view-filter copy, and the
 * action drawn for a read-only caller); the create-grant, no-provider and
 * plain-filter cases are green in both worlds and pin that the fix leaves them
 * alone.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import { ListView } from '../ListView';
import { filterNamesCurrentUser } from '../ListEmptyState';
import { SchemaRendererProvider, FilterScopeProvider } from '@object-ui/react';
import { MePermissionsProvider, type MePermissionsAuthenticatedResponse } from '@object-ui/permissions';
import type { ListViewSchema } from '@object-ui/types';

afterEach(cleanup);

const OBJECT = 'crm_case';
const USER = 'u-rep';

function emptyDataSource() {
  return {
    find: vi.fn().mockResolvedValue([]),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
}

const READ_ONLY = { allowCreate: false, allowRead: true, allowEdit: false, allowDelete: false };
const FULL = { allowCreate: true, allowRead: true, allowEdit: true, allowDelete: true };

const envelope = (bits: Record<string, boolean>): MePermissionsAuthenticatedResponse => ({
  authenticated: true,
  userId: USER,
  tenantId: null,
  hasAnyQueue: false,
  positions: ['member'],
  permissionSets: ['member'],
  objects: { [OBJECT]: bits },
  fields: {},
});

/** A `list-view` node as an author writes it (FilterNode-array filters). */
const authored = (node: Record<string, unknown>): ListViewSchema =>
  ({ type: 'list-view', objectName: OBJECT, fields: ['name'], addRecord: { enabled: true }, ...node }) as unknown as ListViewSchema;

async function emptyState(
  schema: ListViewSchema,
  { bits, currentUserId }: { bits?: Record<string, boolean>; currentUserId?: string } = {},
): Promise<HTMLElement> {
  const ds = emptyDataSource();
  let tree: React.ReactNode = (
    <SchemaRendererProvider dataSource={ds as any}>
      <ListView schema={schema} dataSource={ds as any} onAddRecord={() => {}} />
    </SchemaRendererProvider>
  );
  if (currentUserId) tree = <FilterScopeProvider currentUserId={currentUserId}>{tree}</FilterScopeProvider>;
  if (bits) tree = <MePermissionsProvider initialPermissions={envelope(bits)}>{tree}</MePermissionsProvider>;
  const { container } = render(<>{tree}</>);
  await waitFor(() => {
    expect(container.querySelector('[data-testid="empty-state"]')).not.toBeNull();
  });
  return container.querySelector('[data-testid="empty-state"]') as HTMLElement;
}

const addAction = (panel: HTMLElement) => panel.querySelector('[data-testid="empty-state-add-record"]');

describe('ListView empty state — no access vs no records (objectstack#25898)', () => {
  it('a caller without the create grant is told there is nothing they can see, and offered no Create', async () => {
    const panel = await emptyState(authored({}), { bits: READ_ONLY });
    expect(panel.textContent).toMatch(/No records you can see/);
    expect(panel.textContent).toMatch(/ask your administrator/);
    expect(panel.textContent).not.toMatch(/Nothing here yet/);
    expect(panel.textContent).not.toMatch(/Create your first record/);
    expect(addAction(panel)).toBeNull();
  });

  it('a caller with the create grant still gets the first-run copy and the action', async () => {
    const panel = await emptyState(authored({}), { bits: FULL });
    expect(panel.textContent).toMatch(/Nothing here yet/);
    expect(panel.textContent).toMatch(/Create your first record/);
    expect(addAction(panel)).not.toBeNull();
  });

  it('with no permission provider the copy is unchanged (fail-open)', async () => {
    const panel = await emptyState(authored({}));
    expect(panel.textContent).toMatch(/Nothing here yet/);
    expect(addAction(panel)).not.toBeNull();
  });

  it('a "my" view — its filter resolved to the caller\'s id — says the caller has none yet', async () => {
    const panel = await emptyState(
      authored({ filter: [['owner', '=', USER]] }),
      { bits: FULL, currentUserId: USER },
    );
    expect(panel.textContent).toMatch(/Nothing of yours yet/);
    expect(panel.textContent).not.toMatch(/No records match this view/);
    expect(addAction(panel)).not.toBeNull();
  });

  it('a "my" view for a caller without the create grant offers no Create', async () => {
    const panel = await emptyState(
      authored({ filter: [['owner', '=', USER]] }),
      { bits: READ_ONLY, currentUserId: USER },
    );
    expect(panel.textContent).toMatch(/Nothing of yours yet/);
    expect(addAction(panel)).toBeNull();
  });

  it('a filter that does not name the caller keeps the view-filter copy', async () => {
    const panel = await emptyState(
      authored({ filter: [['status', '=', 'open']] }),
      { bits: FULL, currentUserId: USER },
    );
    expect(panel.textContent).toMatch(/No matching records/);
    expect(panel.textContent).toMatch(/No records match this view/);
  });
});

describe('filterNamesCurrentUser (objectstack#25898)', () => {
  it('finds the caller in every filter shape a list receives', () => {
    expect(filterNamesCurrentUser([['owner', '=', USER]], USER)).toBe(true);
    expect(filterNamesCurrentUser([{ field: 'owner', operator: 'equals', value: USER }], USER)).toBe(true);
    expect(filterNamesCurrentUser({ owner: { $eq: USER } }, USER)).toBe(true);
    expect(filterNamesCurrentUser(['and', ['status', '=', 'open'], ['owner', '=', USER]], USER)).toBe(true);
  });

  it('reads the unresolved placeholder in both spellings', () => {
    expect(filterNamesCurrentUser([['owner', '=', '{current_user_id}']], undefined)).toBe(true);
    expect(filterNamesCurrentUser({ owner: '${current_user_id}' }, null)).toBe(true);
  });

  it('answers false for a filter about someone or something else, and with no id to compare', () => {
    expect(filterNamesCurrentUser([['owner', '=', 'u-other']], USER)).toBe(false);
    expect(filterNamesCurrentUser([['status', '=', 'open']], USER)).toBe(false);
    expect(filterNamesCurrentUser([['owner', '=', '']], '')).toBe(false);
    expect(filterNamesCurrentUser(undefined, USER)).toBe(false);
    expect(filterNamesCurrentUser([['note', '=', 'user-{current_user_id}']], USER)).toBe(false);
  });
});
